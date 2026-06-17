// GET /{org}/{repo}  →  HTML page: full tasting card + og:image meta + actions.
import { fetchRepoData, NotFoundError, RateLimitError } from "../lib/github";
import { score, type Card } from "../lib/scorer";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  const org = (url.searchParams.get("org") ?? "").trim();
  const repo = (url.searchParams.get("repo") ?? "").trim();

  if (!org || !repo) {
    return html(errorPage(origin, "Invalid repository", "Use the form below to taste a repo.", "", ""), 400);
  }

  try {
    const rd = await fetchRepoData(org, repo, process.env.GITHUB_TOKEN);
    const card = score(rd);
    return html(cardPage(origin, card), 200, "public, s-maxage=21600, stale-while-revalidate=86400");
  } catch (err) {
    if (err instanceof NotFoundError) {
      return html(errorPage(origin, "🤷 Repository not found", `Couldn't find ${esc(org)}/${esc(repo)} — check the spelling, or it may be private.`, org, repo), 404);
    }
    if (err instanceof RateLimitError) {
      return html(errorPage(origin, "🍷 The cellar's busy", "GitHub rate limit reached. Try again in a little while.", org, repo), 429);
    }
    return html(errorPage(origin, "Something went wrong", "Couldn't pour this one. Try again shortly.", org, repo), 500);
  }
}

function html(body: string, status: number, cache = "public, s-maxage=300"): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache },
  });
}

// ---- pages ------------------------------------------------------------------

function cardPage(origin: string, c: Card): string {
  const pageUrl = `${origin}/${c.repo}`;
  const ogImage = `${pageUrl}/og.png`;
  const title = `${c.repo} — ${c.score}/100 · ${c.label}`;
  const desc = `${c.repo} tasted like wine: ${c.score}/100 (${c.label}). Millésime ${c.millesime} · Robe ${c.robe} · Nez ${c.nez} · Bouche ${c.bouche} · Finale ${c.finale}.`;
  const tweet =
     `https://twitter.com/intent/tweet?text=${encodeURIComponent(`🍷 ${c.repo} — tasted like wine: ${c.score}/100 (${c.label})`)}&url=${encodeURIComponent(pageUrl)}`;

  return shell(
    title,
    desc,
    pageUrl,
    ogImage,
    /* html */ `
    ${nav()}
    <main class="wrap">
      <section class="card">
        <div class="bar">
          <span class="dot dot--r"></span><span class="dot dot--a"></span><span class="dot dot--g"></span>
          <span class="bar__t">pommard taste ${esc(c.repo)}</span>
        </div>
        <div class="body">
          <div><span class="chip">🍷 pommard · ${esc(c.repo)}</span></div>

          <div class="cols">
            <div class="left">
              ${section("🍇", "Millésime", c.millesime, [
                `${key("First commit")} ${c.firstCommitYear || "unknown"}   ${dim(c.ageYears > 0 ? c.ageYears.toFixed(1) + " yrs" : "")}`,
              ])}
              ${section("🎨", "Robe", c.robe, [
                `${key("Cépage")} ${esc(langs(c))}`,
                `${key("Size")} ${humanInt(c.fileCount)} files${c.fileTruncated ? "+" : ""}   ${dim(humanSize(c.sizeKB))}`,
              ])}
              ${section("👃", "Nez", `${c.nez} (${c.nezScore}/5)`, [
                [
                  check(c.hasReadme, "README"),
                  check(c.hasLicense, c.hasLicense && c.licenseName ? `LICENSE (${esc(c.licenseName)})` : "LICENSE"),
                  check(c.hasCI, "CI"),
                  check(c.hasTopics, "Topics"),
                  check(c.hasDescription, "Description"),
                ].join("   "),
              ])}
              ${section("👄", "Bouche", c.bouche, [
                `${key("Commits (90d)")} ${humanInt(c.commits90)}   ${key("Contributors")} ${humanInt(c.contributors)}`,
                `${key("Issues")} ${humanInt(c.openIssues)} open / ${humanInt(c.closedIssues)} closed`,
                `${key("Latest release")} ${c.lastRelease ? fmtDate(c.lastRelease) : "none"}`,
              ])}
              ${section("🏁", "Finale", c.finale, [
                `${key("⭐ Stars")} ${humanInt(c.stars)}   ${key("Forks")} ${humanInt(c.forks)}   ${key("Watchers")} ${humanInt(c.watchers)}`,
                `${key("Growth")} ${c.starsPerMonth.toFixed(1)} stars/mo`,
              ])}
            </div>

            <div class="scorebox">
              <div class="score">${c.score}</div>
              <div class="score__d">/ 100</div>
              <div class="badge ${labelClass(c.label)}">${esc(c.label)}</div>
              <div class="score__w">Nez 20 · Bouche 40 · Finale 40</div>
            </div>
          </div>
        </div>
      </section>

      <section class="actions">
        <form id="taste" class="taste">
          <input id="q" type="text" placeholder="owner/repo" autocomplete="off" spellcheck="false" />
          <button type="submit">Taste 🍷</button>
        </form>

        <div class="row">
          <div class="cmd" data-copy="curl -fsSL https://pommard.sh/install.sh | bash">
            <code><span class="p">$</span> curl -fsSL https://pommard.sh/install.sh | bash</code>
            <button class="copy" type="button">Copy</button>
          </div>
        </div>

        <div class="links">
          <a class="btn" href="${esc(tweet)}">Share on X</a>
          <a class="btn ghost" href="https://github.com/${esc(c.repo)}">View repo ↗</a>
        </div>
      </section>
    </main>
    ${footer()}
    ${scriptTag()}
    `,
  );
}

function errorPage(origin: string, title: string, msg: string, org: string, repo: string): string {
  const pageUrl = org && repo ? `${origin}/${org}/${repo}` : origin;
  const ogImage = org && repo ? `${pageUrl}/og.png` : `${origin}/og.png`;
  return shell(
    `${title} — pommard.sh`,
    msg,
    pageUrl,
    ogImage,
    /* html */ `
    ${nav()}
    <main class="wrap">
      <section class="err">
        <h1>${title}</h1>
        <p>${msg}</p>
        <form id="taste" class="taste">
          <input id="q" type="text" placeholder="owner/repo" autocomplete="off" spellcheck="false" />
          <button type="submit">Taste 🍷</button>
        </form>
        <p class="muted"><a href="/">← back to pommard.sh</a></p>
      </section>
    </main>
    ${footer()}
    ${scriptTag()}
    `,
  );
}

// ---- fragments --------------------------------------------------------------

function section(emoji: string, name: string, desc: string, lines: string[]): string {
  return `<div class="sec">
    <div class="sec__h"><span class="sec__e">${emoji}</span><span class="sec__n">${name}</span><span class="badge">${esc(desc)}</span></div>
    ${lines.map((l) => `<div class="sec__l">${l}</div>`).join("")}
  </div>`;
}

const key = (k: string) => `<span class="k">${esc(k)}:</span>`;
const dim = (s: string) => (s ? `<span class="dimt">${esc(s)}</span>` : "");
const check = (ok: boolean, label: string) =>
  ok ? `<span class="ok">✓</span> ${label}` : `<span class="no">✗</span> <span class="dimt">${label}</span>`;

function langs(c: Card): string {
  if (c.languages.length === 0) return c.primaryLanguage || "unknown";
  return c.languages.map((l) => `${l.name} ${l.pct.toFixed(1)}%`).join(" · ");
}

function labelClass(label: string): string {
  if (label === "Grand cru" || label === "Bon cru") return "badge--gold";
  if (label === "Correct") return "badge--navy";
  return "badge--mute";
}

function nav(): string {
  return `<header class="nav">
    <a class="brand" href="/">pommard.sh</a>
    <nav class="nlinks"><a href="/#install">Install</a><a href="https://github.com/maximevast/pommard">GitHub ↗</a></nav>
  </header>`;
}

function footer(): string {
  return `<footer class="foot"><a href="https://github.com/maximevast/pommard">github.com/maximevast/pommard</a> · MIT · poured with 🍷 and Go</footer>`;
}

function scriptTag(): string {
  return `<script>
    document.querySelectorAll('.cmd').forEach(function(el){
      var b=el.querySelector('.copy'); if(!b) return;
      b.addEventListener('click',function(){navigator.clipboard.writeText(el.dataset.copy||'').then(function(){var p=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=p;},1300);});});
    });
    var f=document.getElementById('taste');
    if(f) f.addEventListener('submit',function(e){
      e.preventDefault();
      var v=document.getElementById('q').value.trim();
      v=v.replace(/^https?:\\/\\/github\\.com\\//,'').replace(/\\.git$/,'').replace(/^\\/+|\\/+$/g,'');
      var parts=v.split('/');
      if(parts.length>=2 && parts[0] && parts[1]) location.href='/'+parts[0]+'/'+parts[1];
    });
  </script>`;
}

// ---- html shell + styles ----------------------------------------------------

function shell(title: string, desc: string, pageUrl: string, ogImage: string, body: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/pommard_sh.png">
<style>${STYLES}</style>
</head><body>${body}</body></html>`;
}

const STYLES = `
:root{--wine:#7c2d40;--navy:#1e2a44;--gold:#c9a227;--cream:#faf6f0;--paper:#fbfaf8;--bar:#f0ebe4;--line:#ece3da;--muted:#6b6470;--ink:#20242e;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
*{box-sizing:border-box}
body{margin:0;font-family:var(--sans);color:var(--ink);background:radial-gradient(1200px 520px at 50% -15%,#fbeef0 0,transparent 60%),var(--cream);line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--wine);text-decoration:none}a:hover{text-decoration:underline}
.nav{display:flex;align-items:center;justify-content:space-between;max-width:840px;margin:0 auto;padding:18px 22px}
.brand{font-weight:700;color:var(--navy);font-size:1.1rem}.brand:hover{text-decoration:none}
.nlinks a{color:var(--muted);margin-left:20px;font-size:.95rem}
.wrap{max-width:840px;margin:0 auto;padding:8px 22px 0}
.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 22px 56px rgba(30,42,68,.14)}
.bar{display:flex;align-items:center;gap:8px;padding:14px 18px;background:var(--bar);border-bottom:1px solid var(--line)}
.dot{width:12px;height:12px;border-radius:50%}.dot--r{background:#ff5f57}.dot--a{background:#febc2e}.dot--g{background:#28c840}
.bar__t{margin-left:10px;font-family:var(--mono);font-size:.84rem;color:var(--muted)}
.body{padding:24px 26px;font-family:var(--mono)}
.chip{display:inline-block;background:var(--navy);color:#fff;font-weight:700;padding:5px 14px;border-radius:8px;font-size:.95rem}
.cols{display:flex;justify-content:space-between;gap:24px;margin-top:20px;flex-wrap:wrap}
.left{flex:1;min-width:300px}
.sec{margin-bottom:18px}
.sec__h{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.sec__e{font-size:1.1rem}.sec__n{color:var(--wine);font-weight:700}
.sec__l{padding-left:32px;font-size:.9rem;color:var(--ink);overflow-wrap:anywhere}
.k{color:var(--muted)}.dimt{color:#a99fa0;font-style:italic}
.ok{color:#2f9e54;font-weight:700}.no{color:#cf4b4b;font-weight:700}
.badge{background:var(--wine);color:#fff;font-weight:700;font-size:.8rem;padding:2px 10px;border-radius:6px}
.badge--gold{background:var(--gold);color:#2a2000}.badge--navy{background:var(--navy);color:var(--cream)}.badge--mute{background:#8a7f86;color:#fff}
.scorebox{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:160px}
.score{font-size:5rem;font-weight:700;color:var(--gold);line-height:1}
.score__d{color:var(--muted);font-size:.9rem;margin-top:2px}
.score__w{color:#a99fa0;font-style:italic;font-size:.72rem;margin-top:12px;text-align:center}
.scorebox .badge{font-size:1rem;padding:6px 16px;border-radius:999px;margin-top:14px}
.actions{margin:26px auto 0;max-width:680px}
.taste{display:flex;gap:10px}
.taste input{flex:1;min-width:0;font-family:var(--mono);font-size:1rem;padding:12px 16px;border:1.5px solid var(--line);border-radius:12px;background:#fff;color:var(--ink)}
.taste input:focus{outline:none;border-color:var(--wine)}
.taste button{flex:none;border:0;background:var(--wine);color:#fff;font-weight:700;font-size:1rem;padding:0 22px;border-radius:12px;cursor:pointer}
.row{margin-top:14px}
.cmd{display:flex;align-items:center;gap:12px;background:var(--navy);color:#f3eef0;font-family:var(--mono);font-size:.9rem;padding:12px 12px 12px 16px;border-radius:12px}
.cmd code{flex:1;min-width:0;white-space:normal;overflow-wrap:anywhere}.cmd .p{color:var(--gold);margin-right:8px}
.copy{margin-left:auto;flex:none;border:0;background:rgba(255,255,255,.14);color:#fff;font:inherit;font-size:.8rem;padding:6px 12px;border-radius:8px;cursor:pointer}
.links{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.btn{display:inline-block;background:var(--wine);color:#fff;font-weight:600;padding:10px 18px;border-radius:999px}.btn:hover{text-decoration:none}
.btn.ghost{background:transparent;color:var(--navy);border:1.5px solid var(--line)}
.err{text-align:center;padding:40px 0}.err h1{color:var(--navy);font-size:1.6rem}.err .muted{color:var(--muted)}.err .taste{max-width:420px;margin:22px auto 0}
.foot{text-align:center;color:var(--muted);font-size:.86rem;padding:50px 22px 40px}.foot a{color:var(--muted)}
@media(max-width:560px){.nav,.wrap{padding-left:16px;padding-right:16px}.cols{flex-direction:column}.left{min-width:0}.body{padding:20px 16px}.scorebox{align-items:flex-start;margin-top:8px}.sec__l{padding-left:0}}
`;

// ---- helpers ----------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function humanInt(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

function humanSize(kb: number): string {
  if (kb <= 0) return "";
  if (kb < 1024) return `${kb} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
