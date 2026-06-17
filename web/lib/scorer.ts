// TypeScript port of internal/scorer/scorer.go — keep the two in sync.
// Turns raw repository signals into a wine tasting Card: five descriptive
// sections plus a weighted final score out of 100.

export interface RepoData {
  owner: string;
  name: string;
  description: string;
  createdAt: Date | null;
  sizeKB: number;

  primaryLanguage: string;
  languages: Record<string, number>;
  fileCount: number;
  fileTruncated: boolean;

  stars: number;
  forks: number;
  watchers: number;

  hasLicense: boolean;
  licenseName: string;
  topics: string[];
  hasReadme: boolean;
  hasCI: boolean;

  firstCommit: Date | null;
  commits90: number;
  contributors: number;
  openIssues: number;
  closedIssues: number;
  lastRelease: Date | null;
}

export interface LangShare {
  name: string;
  pct: number;
}

export interface Card {
  repo: string;

  // 🍇 Millésime
  firstCommitYear: number;
  ageYears: number;
  millesime: string;

  // 🎨 Robe
  primaryLanguage: string;
  languages: LangShare[];
  fileCount: number;
  fileTruncated: boolean;
  sizeKB: number;
  robe: string;

  // 👃 Nez
  hasReadme: boolean;
  hasLicense: boolean;
  hasCI: boolean;
  hasTopics: boolean;
  hasDescription: boolean;
  licenseName: string;
  nezScore: number;
  nez: string;

  // 👄 Bouche
  commits90: number;
  contributors: number;
  openIssues: number;
  closedIssues: number;
  lastRelease: Date | null;
  bouche: string;

  // 🏁 Finale
  stars: number;
  forks: number;
  watchers: number;
  starsPerMonth: number;
  finale: string;

  // 🏆 Note finale
  score: number;
  label: string;
}

// Weights for the final score (must sum to 100).
const WEIGHT_NEZ = 20;
const WEIGHT_BOUCHE = 40;
const WEIGHT_FINALE = 40;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function score(rd: RepoData, now: Date = new Date()): Card {
  // 🍇 Millésime — age from the first commit (fall back to repo creation).
  const start = rd.firstCommit ?? rd.createdAt;
  let firstCommitYear = 0;
  let ageYears = 0;
  let millesimeDesc = "Inconnu";
  if (start) {
    firstCommitYear = start.getUTCFullYear();
    ageYears = (now.getTime() - start.getTime()) / MS_PER_DAY / 365.25;
    millesimeDesc = millesime(ageYears);
  }

  // 👃 Nez — surface quality signals.
  const hasTopics = rd.topics.length > 0;
  const hasDescription = rd.description.trim() !== "";
  const nezScore =
    b2i(rd.hasReadme) +
    b2i(rd.hasLicense) +
    b2i(rd.hasCI) +
    b2i(hasTopics) +
    b2i(hasDescription);

  // 👄 Bouche — activity.
  const boucheNorm = boucheScore(rd, now);

  // 🏁 Finale — community reach.
  const months = Math.max(ageYears * 12, 1);
  const starsPerMonth = rd.stars / months;
  const finaleNorm = finaleScore(rd, starsPerMonth);

  // 🏆 Note finale — weighted blend.
  const nezNorm = nezScore / 5;
  const total =
    WEIGHT_NEZ * nezNorm + WEIGHT_BOUCHE * boucheNorm + WEIGHT_FINALE * finaleNorm;
  const finalScore = clampInt(Math.round(total), 0, 100);

  return {
    repo: `${rd.owner}/${rd.name}`,

    firstCommitYear,
    ageYears,
    millesime: millesimeDesc,

    primaryLanguage: rd.primaryLanguage,
    languages: langShares(rd.languages),
    fileCount: rd.fileCount,
    fileTruncated: rd.fileTruncated,
    sizeKB: rd.sizeKB,
    robe: robe(rd.fileCount),

    hasReadme: rd.hasReadme,
    hasLicense: rd.hasLicense,
    hasCI: rd.hasCI,
    hasTopics,
    hasDescription,
    licenseName: rd.licenseName,
    nezScore,
    nez: nez(nezScore),

    commits90: rd.commits90,
    contributors: rd.contributors,
    openIssues: rd.openIssues,
    closedIssues: rd.closedIssues,
    lastRelease: rd.lastRelease,
    bouche: boucheDesc(boucheNorm),

    stars: rd.stars,
    forks: rd.forks,
    watchers: rd.watchers,
    starsPerMonth,
    finale: finaleDesc(rd.stars),

    score: finalScore,
    label: label(finalScore),
  };
}

function millesime(age: number): string {
  if (age < 2) return "Jeune";
  if (age < 5) return "En développement";
  if (age < 10) return "En pleine maturité";
  return "Grand âge";
}

function robe(files: number): string {
  if (files <= 0) return "Inconnue";
  if (files < 1000) return "Légère";
  if (files < 10000) return "Structurée";
  return "Complexe";
}

function nez(s: number): string {
  if (s <= 1) return "Fermé";
  if (s <= 3) return "Discret";
  if (s === 4) return "Ouvert";
  return "Expressif";
}

// boucheScore returns an activity score in [0,1].
//   commits (90d)   -> up to 0.40
//   contributors    -> up to 0.25 (log scale)
//   issue health    -> up to 0.15 (closed / total, neutral 0.5 if none)
//   release recency -> up to 0.20
function boucheScore(rd: RepoData, now: Date): number {
  const commits = (Math.min(rd.commits90, 200) / 200) * 0.4;

  const contrib =
    Math.min(Math.log10(rd.contributors + 1) / Math.log10(101), 1) * 0.25;

  let ratio = 0.5;
  const totalIssues = rd.openIssues + rd.closedIssues;
  if (totalIssues > 0) ratio = rd.closedIssues / totalIssues;
  const health = ratio * 0.15;

  let rel = 0;
  if (rd.lastRelease) {
    const days = (now.getTime() - rd.lastRelease.getTime()) / MS_PER_DAY;
    if (days <= 90) rel = 0.2;
    else if (days <= 365) rel = 0.12;
    else if (days <= 730) rel = 0.06;
  }

  return commits + contrib + health + rel;
}

function boucheDesc(n: number): string {
  if (n < 0.15) return "Plat";
  if (n < 0.4) return "Souple";
  if (n < 0.7) return "Charnu";
  return "Puissant";
}

// finaleScore returns a community reach score in [0,1].
function finaleScore(rd: RepoData, starsPerMonth: number): number {
  const stars = clamp(Math.log10(rd.stars + 1) / Math.log10(50001), 0, 1);
  const growth = clamp(starsPerMonth / 200, 0, 1);
  const forks = clamp(Math.log10(rd.forks + 1) / Math.log10(10001), 0, 1);
  const watch = clamp(Math.log10(rd.watchers + 1) / Math.log10(5001), 0, 1);
  return 0.5 * stars + 0.2 * growth + 0.2 * forks + 0.1 * watch;
}

function finaleDesc(stars: number): string {
  if (stars < 100) return "Courte";
  if (stars < 1000) return "Moyenne";
  if (stars < 10000) return "Longue";
  return "Persistante";
}

function label(s: number): string {
  if (s <= 40) return "Piquette";
  if (s <= 60) return "Correct";
  if (s <= 80) return "Bon cru";
  return "Grand cru";
}

function langShares(m: Record<string, number>): LangShare[] {
  const entries = Object.entries(m);
  if (entries.length === 0) return [];
  const total = entries.reduce((acc, [, v]) => acc + v, 0);
  const shares = entries.map(([name, v]) => ({
    name,
    pct: total > 0 ? (v / total) * 100 : 0,
  }));
  shares.sort((a, b) => (b.pct === a.pct ? a.name.localeCompare(b.name) : b.pct - a.pct));
  return shares.slice(0, 3);
}

function b2i(b: boolean): number {
  return b ? 1 : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
