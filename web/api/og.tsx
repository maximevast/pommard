// GET /{org}/{repo}/og.png  →  1200×630 tasting-card image for link unfurls.
// Styled to match the landing page's terminal card.
import { ImageResponse } from "@vercel/og";
import { fetchRepoData, NotFoundError, RateLimitError } from "../lib/github";
import { score, type Card } from "../lib/scorer";

export const config = { runtime: "edge" };

const WINE = "#7c2d40";
const NAVY = "#1e2a44";
const GOLD = "#c9a227";
const CREAM = "#faf6f0";
const PAPER = "#fbfaf8";
const BAR = "#f0ebe4";
const LINE = "#ece3da";
const MUTED = "#6b6470";

const BG_GRADIENT = "radial-gradient(1200px 520px at 50% -20%, #fbeef0 0%, rgba(250,246,240,0) 62%)";

// JetBrains Mono (ttf) fetched once per instance and reused.
const FONT_REGULAR =
  "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Regular.ttf";
const FONT_BOLD =
  "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/JetBrainsMono-Bold.ttf";

let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;
async function loadFonts() {
  if (fontCache) return fontCache;
  const [r, b] = await Promise.all([fetch(FONT_REGULAR), fetch(FONT_BOLD)]);
  fontCache = { regular: await r.arrayBuffer(), bold: await b.arrayBuffer() };
  return fontCache;
}

function imageOptions(fonts: { regular: ArrayBuffer; bold: ArrayBuffer }) {
  return {
    width: 1200,
    height: 630,
    emoji: "twemoji" as const,
    fonts: [
      { name: "JetBrains Mono", data: fonts.regular, weight: 400 as const, style: "normal" as const },
      { name: "JetBrains Mono", data: fonts.bold, weight: 700 as const, style: "normal" as const },
    ],
  };
}

export default async function handler(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const org = (searchParams.get("org") ?? "").trim();
  const repo = (searchParams.get("repo") ?? "").trim();
  const fonts = await loadFonts();

  if (!org || !repo) {
    return new ImageResponse(<Fallback title="pommard.sh" sub="Taste a GitHub repo like a fine wine" />, imageOptions(fonts));
  }

  try {
    const rd = await fetchRepoData(org, repo, process.env.GITHUB_TOKEN);
    const card = score(rd);
    return new ImageResponse(<CardImage card={card} />, imageOptions(fonts));
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new ImageResponse(<Fallback title="🤷 not found" sub={`${org}/${repo}`} />, imageOptions(fonts));
    }
    if (err instanceof RateLimitError) {
      return new ImageResponse(<Fallback title="🍷 cellar's busy" sub="rate limited — try again shortly" />, imageOptions(fonts));
    }
    return new ImageResponse(<Fallback title="🍷 pommard.sh" sub={`${org}/${repo}`} />, imageOptions(fonts));
  }
}

function labelColors(label: string): { bg: string; fg: string } {
  switch (label) {
    case "Grand cru":
    case "Bon cru":
      return { bg: GOLD, fg: "#2a2000" };
    case "Correct":
      return { bg: NAVY, fg: CREAM };
    default:
      return { bg: "#8a7f86", fg: "#ffffff" };
  }
}

function ForkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 16 16" fill={MUTED}>
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
    </svg>
  );
}

function humanInt(n: number): string {
  return n.toLocaleString("en-US").replace(/,/g, " "); // thin space thousands
}

function CardImage({ card }: { card: Card }) {
  const rows = [
    { emoji: "🍇", name: "Millésime", val: card.millesime },
    { emoji: "🎨", name: "Robe", val: card.robe },
    { emoji: "👃", name: "Nez", val: `${card.nez} (${card.nezScore}/5)` },
    { emoji: "👄", name: "Bouche", val: card.bouche },
    { emoji: "🏁", name: "Finale", val: card.finale },
  ];
  const lc = labelColors(card.label);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 44,
        backgroundColor: CREAM,
        backgroundImage: BG_GRADIENT,
        fontFamily: "JetBrains Mono",
      }}
    >
      {/* terminal window */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          backgroundColor: PAPER,
          border: `1px solid ${LINE}`,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(30,42,68,0.16)",
        }}
      >
        {/* title bar */}
        <div style={{ display: "flex", alignItems: "center", padding: "16px 22px", backgroundColor: BAR, borderBottom: `1px solid ${LINE}` }}>
          <span style={{ width: 13, height: 13, borderRadius: 99, backgroundColor: "#ff5f57", marginRight: 8 }} />
          <span style={{ width: 13, height: 13, borderRadius: 99, backgroundColor: "#febc2e", marginRight: 8 }} />
          <span style={{ width: 13, height: 13, borderRadius: 99, backgroundColor: "#28c840" }} />
          <span style={{ marginLeft: 16, fontSize: 22, color: MUTED }}>pommard taste {card.repo}</span>
        </div>

        {/* body */}
        <div style={{ display: "flex", flex: 1, padding: "32px 40px", justifyContent: "space-between" }}>
          {/* left: chip + stats + descriptors */}
          <div style={{ display: "flex", flexDirection: "column", width: 720 }}>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 26, fontWeight: 700, color: "#ffffff", backgroundColor: NAVY, padding: "6px 16px", borderRadius: 8 }}>
                🍷 pommard · {card.repo}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", fontSize: 23, color: MUTED, marginTop: 22, paddingLeft: 4 }}>
              <span style={{ marginRight: 24 }}>⭐ {humanInt(card.stars)}</span>
              <span style={{ display: "flex", alignItems: "center", marginRight: 24 }}>
                <ForkIcon />
                <span style={{ marginLeft: 8 }}>{humanInt(card.forks)}</span>
              </span>
              <span style={{ marginRight: 24 }}>👥 {humanInt(card.contributors)}</span>
              <span style={{ marginRight: 24 }}>👁 {humanInt(card.watchers)}</span>
              <span>🎂 {card.ageYears.toFixed(1)} yrs</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
              {rows.map((r) => (
                <div key={r.name} style={{ display: "flex", alignItems: "center", marginBottom: 13 }}>
                  <span style={{ fontSize: 28, width: 44 }}>{r.emoji}</span>
                  <span style={{ fontSize: 26, width: 200, color: WINE, fontWeight: 700 }}>{r.name}</span>
                  <span style={{ fontSize: 24, fontWeight: 700, color: "#ffffff", backgroundColor: WINE, padding: "3px 15px", borderRadius: 7 }}>
                    {r.val}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* right: score */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 150, fontWeight: 700, color: GOLD, lineHeight: 1 }}>{card.score}</span>
            <span style={{ fontSize: 26, color: MUTED, marginTop: 2 }}>/ 100</span>
            <span style={{ fontSize: 30, fontWeight: 700, backgroundColor: lc.bg, color: lc.fg, padding: "7px 22px", borderRadius: 999, marginTop: 18 }}>
              {card.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fallback({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: CREAM,
        backgroundImage: BG_GRADIENT,
        fontFamily: "JetBrains Mono",
        color: NAVY,
      }}
    >
      <span style={{ fontSize: 34, fontWeight: 700, color: WINE }}>🍷 pommard.sh</span>
      <span style={{ fontSize: 60, fontWeight: 700, marginTop: 20 }}>{title}</span>
      <span style={{ fontSize: 28, color: MUTED, marginTop: 14 }}>{sub}</span>
    </div>
  );
}
