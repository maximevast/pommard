<div align="center">
  <img src="pommard_sh.png" alt="pommard.sh" width="220" />
  <h1>pommard</h1>
  <p><em>Taste a GitHub repository like a fine wine.</em> 🍷</p>
</div>

---

`pommard` reads the public signals of any GitHub repository and pours them into a
five-part wine tasting card — Millésime, Robe, Nez, Bouche, Finale — topped with a
weighted final score out of 100.

```
$ pommard taste polarsource/polar
```

```
    🍷 pommard · polarsource/polar

   🍇  Millésime   En développement
      First commit: 2023   3.4 yrs

   🎨  Robe   Structurée
      Cépage: Python 65.9% · TypeScript 27.7% · MDX 3.6%
      Size: 4 510 files   424.3 MB

   👃  Nez   Expressif (5/5)
      ✓ README   ✓ LICENSE (Apache-2.0)   ✓ CI   ✓ Topics   ✓ Description

   👄  Bouche   Puissant
      Commits (90d): 1 822   Contributors: 133
      Issues: 71 open / 2 274 closed
      Latest release: 2026-05-25

   🏁  Finale   Longue
      ⭐ Stars: 9 948   Forks: 727   Watchers: 26
      Growth: 244.7 stars/mo

   🏆  Final score
      92/100   Grand cru
      Nez 20 · Bouche 40 · Finale 40
```

> Live output for `polarsource/polar` — your numbers will vary.

## The tasting card

| Section          | Reads                                                            |
| ---------------- | ---------------------------------------------------------------- |
| 🍇 **Millésime** | Age from the first commit                                        |
| 🎨 **Robe**      | Primary language(s) and codebase size                            |
| 👃 **Nez**       | README, LICENSE, CI, topics, description — scored /5             |
| 👄 **Bouche**    | Commits (90d), contributors, issue health, last release          |
| 🏁 **Finale**    | Stars, forks, watchers, star growth rate                         |
| 🏆 **Note**      | Weighted score /100 — Nez 20 · Bouche 40 · Finale 40             |

Final labels: **Piquette** (0–40) · **Correct** (41–60) · **Bon cru** (61–80) · **Grand cru** (81–100).

## Install

### curl | bash

```sh
# placeholder — install script to be published
curl -fsSL https://pommard.sh/install.sh | bash
```

### From source

```sh
git clone https://github.com/maximevast/pommard
cd pommard
make install          # installs into $GOBIN / $GOPATH/bin
```

Or grab a one-off binary:

```sh
make build            # → ./bin/pommard
```

## Usage

```sh
pommard taste <owner/repo>

pommard taste polarsource/polar
pommard taste https://github.com/polarsource/polar   # full URLs work too
```

### Rate limits & `GITHUB_TOKEN`

Unauthenticated requests share GitHub's low hourly limit. Export a personal
access token (no scopes required for public repos) for comfortable use:

```sh
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx
```

`pommard` picks it up automatically and tells you when you've been throttled.

## Requirements

- Go 1.22+ (to build from source)
- Network access to `api.github.com`

## How the score is built

- **Nez** (20 pts): one point per surface signal (README, LICENSE, CI, topics, description), scaled to 20.
- **Bouche** (40 pts): recent commits, contributors, closed/open issue ratio, and release recency.
- **Finale** (40 pts): a log-scaled blend of stars, star growth, forks, and watchers.

## License

MIT — see [LICENSE](LICENSE).
