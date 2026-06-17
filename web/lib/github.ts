// TypeScript port of internal/github/client.go — fetches only the signals the
// scorer needs. The primary repo call is fatal; secondary calls degrade
// gracefully so the card still renders when an optional signal is missing.

import type { RepoData } from "./scorer.ts";

const API = "https://api.github.com";
const USER_AGENT = "pommard-web";
const TIMEOUT_MS = 10_000;

export class NotFoundError extends Error {}
export class EmptyRepoError extends Error {}
export class RateLimitError extends Error {
  reset?: Date;
  hasToken: boolean;
  constructor(hasToken: boolean, reset?: Date) {
    super("github api rate limit exceeded");
    this.hasToken = hasToken;
    this.reset = reset;
  }
}

function buildHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

interface Raw {
  res: Response;
  body: string;
}

async function getRaw(path: string, token?: string): Promise<Raw> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API + path, { headers: buildHeaders(token), signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();

  if (res.status === 404) throw new NotFoundError(path);
  if (res.status === 409) throw new EmptyRepoError(path);
  if (res.status === 403 || res.status === 429) {
    if (res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0") {
      throw rateLimitFrom(res, token);
    }
    throw new Error(`github api: ${res.status}`);
  }
  if (res.status >= 400) throw new Error(`github api: ${res.status}`);

  return { res, body };
}

function rateLimitFrom(res: Response, token?: string): RateLimitError {
  let reset: Date | undefined;
  const v = res.headers.get("x-ratelimit-reset");
  if (v) {
    const sec = Number.parseInt(v, 10);
    if (!Number.isNaN(sec)) reset = new Date(sec * 1000);
  }
  return new RateLimitError(!!token, reset);
}

/** Run fn, swallowing any error and returning fallback (best-effort signal). */
async function soft<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const LINK_LAST = /[?&]page=(\d+)[^>]*>;\s*rel="last"/;
function parseLastPage(link: string | null): number {
  if (!link) return 0;
  const m = LINK_LAST.exec(link);
  return m ? Number.parseInt(m[1]!, 10) : 0;
}

/** Request one item per page and read the rel="last" page number as the count. */
async function countViaPagination(path: string, token?: string): Promise<number> {
  const { res, body } = await getRaw(path, token);
  const last = parseLastPage(res.headers.get("link"));
  if (last > 0) return last;
  const arr = JSON.parse(body) as unknown[];
  return Array.isArray(arr) ? arr.length : 0;
}

interface ApiRepo {
  size: number;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
  description: string | null;
  topics?: string[];
  created_at: string;
  default_branch: string;
  license?: { spdx_id?: string; name?: string } | null;
}

export async function fetchRepoData(
  owner: string,
  repo: string,
  token?: string,
): Promise<RepoData> {
  // Primary call — fatal on error (404 / rate limit / network).
  const { body } = await getRaw(`/repos/${owner}/${repo}`, token);
  const ar = JSON.parse(body) as ApiRepo;
  const branch = ar.default_branch || "HEAD";

  const hasLicense =
    !!ar.license?.spdx_id && ar.license.spdx_id !== "NOASSERTION";

  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Secondary calls — best-effort, run concurrently.
  const [
    languages,
    fileInfo,
    hasReadme,
    hasCI,
    firstCommit,
    commits90,
    contributors,
    lastRelease,
    openIssues,
    closedIssues,
  ] = await Promise.all([
    soft(() => fetchLanguages(owner, repo, token), {} as Record<string, number>),
    soft(() => fetchFileCount(owner, repo, branch, token), { count: 0, truncated: false }),
    soft(() => exists(`/repos/${owner}/${repo}/readme`, token), false),
    soft(() => fetchHasCI(owner, repo, token), false),
    soft(() => fetchFirstCommit(owner, repo, token), null as Date | null),
    soft(() => countViaPagination(
      `/repos/${owner}/${repo}/commits?per_page=1&since=${since90.toISOString()}`, token), 0),
    soft(() => countViaPagination(
      `/repos/${owner}/${repo}/contributors?per_page=1&anon=1`, token), 0),
    soft(() => fetchLatestRelease(owner, repo, token), null as Date | null),
    soft(() => fetchIssueCount(owner, repo, "open", token), 0),
    soft(() => fetchIssueCount(owner, repo, "closed", token), 0),
  ]);

  let primaryLanguage = ar.language ?? "";
  if (!primaryLanguage) primaryLanguage = topLang(languages);

  return {
    owner,
    name: repo,
    description: ar.description ?? "",
    createdAt: ar.created_at ? new Date(ar.created_at) : null,
    sizeKB: ar.size,
    primaryLanguage,
    languages,
    fileCount: fileInfo.count,
    fileTruncated: fileInfo.truncated,
    stars: ar.stargazers_count,
    forks: ar.forks_count,
    watchers: ar.subscribers_count,
    hasLicense,
    licenseName: hasLicense ? ar.license!.spdx_id! : "",
    topics: ar.topics ?? [],
    hasReadme,
    hasCI,
    firstCommit,
    commits90,
    contributors,
    openIssues,
    closedIssues,
    lastRelease,
  };
}

async function fetchLanguages(owner: string, repo: string, token?: string) {
  const { body } = await getRaw(`/repos/${owner}/${repo}/languages`, token);
  return JSON.parse(body) as Record<string, number>;
}

async function fetchFileCount(owner: string, repo: string, branch: string, token?: string) {
  const { body } = await getRaw(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token,
  );
  const tree = JSON.parse(body) as { tree?: { type: string }[]; truncated?: boolean };
  const count = (tree.tree ?? []).filter((t) => t.type === "blob").length;
  return { count, truncated: !!tree.truncated };
}

async function exists(path: string, token?: string): Promise<boolean> {
  await getRaw(path, token); // throws NotFoundError -> caught by soft()
  return true;
}

async function fetchHasCI(owner: string, repo: string, token?: string): Promise<boolean> {
  const { body } = await getRaw(
    `/repos/${owner}/${repo}/actions/workflows?per_page=1`,
    token,
  );
  const r = JSON.parse(body) as { total_count?: number };
  return (r.total_count ?? 0) > 0;
}

async function fetchFirstCommit(owner: string, repo: string, token?: string): Promise<Date | null> {
  const first = await getRaw(`/repos/${owner}/${repo}/commits?per_page=1`, token);
  const last = parseLastPage(first.res.headers.get("link"));
  const body =
    last > 1
      ? (await getRaw(`/repos/${owner}/${repo}/commits?per_page=1&page=${last}`, token)).body
      : first.body;
  return commitDate(body);
}

function commitDate(body: string): Date | null {
  const arr = JSON.parse(body) as { commit?: { author?: { date?: string } } }[];
  const date = arr[0]?.commit?.author?.date;
  return date ? new Date(date) : null;
}

async function fetchLatestRelease(owner: string, repo: string, token?: string): Promise<Date | null> {
  const { body } = await getRaw(`/repos/${owner}/${repo}/releases/latest`, token);
  const r = JSON.parse(body) as { published_at?: string };
  return r.published_at ? new Date(r.published_at) : null;
}

async function fetchIssueCount(
  owner: string,
  repo: string,
  state: "open" | "closed",
  token?: string,
): Promise<number> {
  const q = `repo:${owner}/${repo}+type:issue+state:${state}`;
  const { body } = await getRaw(`/search/issues?q=${q}&per_page=1`, token);
  const r = JSON.parse(body) as { total_count?: number };
  return r.total_count ?? 0;
}

function topLang(m: Record<string, number>): string {
  let best = "";
  let max = -1;
  for (const [k, v] of Object.entries(m)) {
    if (v > max) {
      best = k;
      max = v;
    }
  }
  return best;
}
