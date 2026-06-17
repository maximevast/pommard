import { test } from "node:test";
import assert from "node:assert/strict";
import { score, type RepoData } from "./scorer.ts";

// Pinned "now" so age-dependent maths are deterministic.
const NOW = new Date("2025-06-17T00:00:00Z");

function base(overrides: Partial<RepoData> = {}): RepoData {
  return {
    owner: "acme",
    name: "widget",
    description: "",
    createdAt: null,
    sizeKB: 0,
    primaryLanguage: "",
    languages: {},
    fileCount: 0,
    fileTruncated: false,
    stars: 0,
    forks: 0,
    watchers: 0,
    hasLicense: false,
    licenseName: "",
    topics: [],
    hasReadme: false,
    hasCI: false,
    firstCommit: null,
    commits90: 0,
    contributors: 0,
    openIssues: 0,
    closedIssues: 0,
    lastRelease: null,
    ...overrides,
  };
}

test("a thriving repo scores a Grand cru", () => {
  const card = score(
    base({
      firstCommit: new Date("2019-06-17T00:00:00Z"), // ~6 yrs
      languages: { Go: 900, Makefile: 100 },
      fileCount: 412,
      hasReadme: true,
      hasLicense: true,
      licenseName: "MIT",
      hasCI: true,
      topics: ["cli"],
      description: "a tasting cli",
      commits90: 200,
      contributors: 100,
      openIssues: 10,
      closedIssues: 90,
      lastRelease: new Date("2025-05-17T00:00:00Z"), // within 90d
      stars: 20000,
      forks: 1000,
      watchers: 200,
    }),
    NOW,
  );

  assert.equal(card.millesime, "En pleine maturité");
  assert.equal(card.robe, "Légère");
  assert.equal(card.nezScore, 5);
  assert.equal(card.nez, "Expressif");
  assert.equal(card.bouche, "Puissant");
  assert.equal(card.finale, "Persistante");
  assert.equal(card.label, "Grand cru");
  assert.equal(card.score, 94);
  assert.equal(card.languages[0]?.name, "Go");
  assert.equal(Math.round(card.languages[0]!.pct), 90);
});

test("a sleepy young repo scores a Piquette", () => {
  const card = score(
    base({
      firstCommit: new Date("2024-12-01T00:00:00Z"), // ~0.5 yr
      languages: { Shell: 100 },
      fileCount: 5,
      hasReadme: true,
      stars: 5,
    }),
    NOW,
  );

  assert.equal(card.millesime, "Jeune");
  assert.equal(card.robe, "Légère");
  assert.equal(card.nezScore, 1);
  assert.equal(card.nez, "Fermé");
  assert.equal(card.bouche, "Plat");
  assert.equal(card.finale, "Courte");
  assert.equal(card.label, "Piquette");
  assert.equal(card.score, 10);
});

test("descriptor thresholds match the Go boundaries", () => {
  // Robe by file count
  assert.equal(score(base({ fileCount: 0 }), NOW).robe, "Inconnue");
  assert.equal(score(base({ fileCount: 999 }), NOW).robe, "Légère");
  assert.equal(score(base({ fileCount: 1000 }), NOW).robe, "Structurée");
  assert.equal(score(base({ fileCount: 10000 }), NOW).robe, "Complexe");

  // Finale by stars
  assert.equal(score(base({ stars: 99 }), NOW).finale, "Courte");
  assert.equal(score(base({ stars: 100 }), NOW).finale, "Moyenne");
  assert.equal(score(base({ stars: 1000 }), NOW).finale, "Longue");
  assert.equal(score(base({ stars: 10000 }), NOW).finale, "Persistante");

  // Millésime by age (relative to NOW)
  assert.equal(score(base({ firstCommit: new Date("2024-06-17Z") }), NOW).millesime, "Jeune");
  assert.equal(score(base({ firstCommit: new Date("2022-06-17Z") }), NOW).millesime, "En développement");
  assert.equal(score(base({ firstCommit: new Date("2018-06-17Z") }), NOW).millesime, "En pleine maturité");
  assert.equal(score(base({ firstCommit: new Date("2010-06-17Z") }), NOW).millesime, "Grand âge");
});
