// Package scorer turns raw repository signals into a wine tasting Card:
// five descriptive sections plus a weighted final score out of 100.
package scorer

import (
	"math"
	"sort"
	"strings"
	"time"

	"github.com/maximevast/pommard/internal/github"
)

// LangShare is a single language and its share of the codebase by bytes.
type LangShare struct {
	Name string
	Pct  float64
}

// Card is the fully scored tasting card, ready to render.
type Card struct {
	Repo string

	// 🍇 Millésime
	FirstCommitYear int
	AgeYears        float64
	Millesime       string

	// 🎨 Robe
	PrimaryLanguage string
	Languages       []LangShare
	FileCount       int
	FileTruncated   bool
	SizeKB          int
	Robe            string

	// 👃 Nez
	HasReadme      bool
	HasLicense     bool
	HasCI          bool
	HasTopics      bool
	HasDescription bool
	LicenseName    string
	NezScore       int
	Nez            string

	// 👄 Bouche
	Commits90    int
	Contributors int
	OpenIssues   int
	ClosedIssues int
	LastRelease  *time.Time
	Bouche       string

	// 🏁 Finale
	Stars         int
	Forks         int
	Watchers      int
	StarsPerMonth float64
	Finale        string

	// 🏆 Note finale
	Score int
	Label string
}

// Weights for the final score (must sum to 100).
const (
	weightNez    = 20.0
	weightBouche = 40.0
	weightFinale = 40.0
)

// Score evaluates the raw repository data into a tasting Card.
func Score(rd *github.RepoData) Card {
	now := time.Now()
	c := Card{Repo: rd.Owner + "/" + rd.Name}

	// 🍇 Millésime — age from the first commit (fall back to repo creation).
	start := rd.FirstCommit
	if start.IsZero() {
		start = rd.CreatedAt
	}
	if !start.IsZero() {
		c.FirstCommitYear = start.Year()
		c.AgeYears = now.Sub(start).Hours() / 24 / 365.25
		c.Millesime = millesime(c.AgeYears)
	} else {
		c.Millesime = "Inconnu"
	}

	// 🎨 Robe — languages and codebase size.
	c.PrimaryLanguage = rd.PrimaryLanguage
	c.Languages = langShares(rd.Languages)
	c.FileCount = rd.FileCount
	c.FileTruncated = rd.FileTruncated
	c.SizeKB = rd.SizeKB
	c.Robe = robe(rd.FileCount)

	// 👃 Nez — surface quality signals.
	c.HasReadme = rd.HasReadme
	c.HasLicense = rd.HasLicense
	c.LicenseName = rd.LicenseName
	c.HasCI = rd.HasCI
	c.HasTopics = len(rd.Topics) > 0
	c.HasDescription = strings.TrimSpace(rd.Description) != ""
	c.NezScore = b2i(c.HasReadme) + b2i(c.HasLicense) + b2i(c.HasCI) + b2i(c.HasTopics) + b2i(c.HasDescription)
	c.Nez = nez(c.NezScore)

	// 👄 Bouche — activity.
	c.Commits90 = rd.Commits90
	c.Contributors = rd.Contributors
	c.OpenIssues = rd.OpenIssues
	c.ClosedIssues = rd.ClosedIssues
	c.LastRelease = rd.LastRelease
	boucheNorm := boucheScore(rd, now)
	c.Bouche = boucheDesc(boucheNorm)

	// 🏁 Finale — community reach.
	c.Stars = rd.Stars
	c.Forks = rd.Forks
	c.Watchers = rd.Watchers
	months := c.AgeYears * 12
	if months < 1 {
		months = 1
	}
	c.StarsPerMonth = float64(rd.Stars) / months
	finaleNorm := finaleScore(rd, c.StarsPerMonth)
	c.Finale = finaleDesc(rd.Stars)

	// 🏆 Note finale — weighted blend.
	nezNorm := float64(c.NezScore) / 5
	total := weightNez*nezNorm + weightBouche*boucheNorm + weightFinale*finaleNorm
	c.Score = clampInt(int(math.Round(total)), 0, 100)
	c.Label = label(c.Score)

	return c
}

func millesime(age float64) string {
	switch {
	case age < 2:
		return "Jeune"
	case age < 5:
		return "En développement"
	case age < 10:
		return "En pleine maturité"
	default:
		return "Grand âge"
	}
}

func robe(files int) string {
	switch {
	case files <= 0:
		return "Inconnue"
	case files < 1000:
		return "Légère"
	case files < 10000:
		return "Structurée"
	default:
		return "Complexe"
	}
}

func nez(score int) string {
	switch {
	case score <= 1:
		return "Fermé"
	case score <= 3:
		return "Discret"
	case score == 4:
		return "Ouvert"
	default:
		return "Expressif"
	}
}

// boucheScore returns an activity score in [0,1].
//
//	commits (90d)   -> up to 0.40
//	contributors    -> up to 0.25 (log scale)
//	issue health    -> up to 0.15 (closed / total, neutral 0.5 if none)
//	release recency -> up to 0.20
func boucheScore(rd *github.RepoData, now time.Time) float64 {
	commits := math.Min(float64(rd.Commits90), 200) / 200 * 0.40

	contrib := math.Min(math.Log10(float64(rd.Contributors)+1)/math.Log10(101), 1) * 0.25

	ratio := 0.5
	if total := rd.OpenIssues + rd.ClosedIssues; total > 0 {
		ratio = float64(rd.ClosedIssues) / float64(total)
	}
	health := ratio * 0.15

	rel := 0.0
	if rd.LastRelease != nil {
		days := now.Sub(*rd.LastRelease).Hours() / 24
		switch {
		case days <= 90:
			rel = 0.20
		case days <= 365:
			rel = 0.12
		case days <= 730:
			rel = 0.06
		}
	}

	return commits + contrib + health + rel
}

func boucheDesc(n float64) string {
	switch {
	case n < 0.15:
		return "Plat"
	case n < 0.40:
		return "Souple"
	case n < 0.70:
		return "Charnu"
	default:
		return "Puissant"
	}
}

// finaleScore returns a community reach score in [0,1].
func finaleScore(rd *github.RepoData, starsPerMonth float64) float64 {
	stars := clamp(math.Log10(float64(rd.Stars)+1)/math.Log10(50001), 0, 1)
	growth := clamp(starsPerMonth/200, 0, 1)
	forks := clamp(math.Log10(float64(rd.Forks)+1)/math.Log10(10001), 0, 1)
	watch := clamp(math.Log10(float64(rd.Watchers)+1)/math.Log10(5001), 0, 1)
	return 0.5*stars + 0.2*growth + 0.2*forks + 0.1*watch
}

func finaleDesc(stars int) string {
	switch {
	case stars < 100:
		return "Courte"
	case stars < 1000:
		return "Moyenne"
	case stars < 10000:
		return "Longue"
	default:
		return "Persistante"
	}
}

func label(score int) string {
	switch {
	case score <= 40:
		return "Piquette"
	case score <= 60:
		return "Correct"
	case score <= 80:
		return "Bon cru"
	default:
		return "Grand cru"
	}
}

func langShares(m map[string]int) []LangShare {
	if len(m) == 0 {
		return nil
	}
	total := 0
	for _, v := range m {
		total += v
	}
	shares := make([]LangShare, 0, len(m))
	for k, v := range m {
		pct := 0.0
		if total > 0 {
			pct = float64(v) / float64(total) * 100
		}
		shares = append(shares, LangShare{Name: k, Pct: pct})
	}
	sort.Slice(shares, func(i, j int) bool {
		if shares[i].Pct == shares[j].Pct {
			return shares[i].Name < shares[j].Name
		}
		return shares[i].Pct > shares[j].Pct
	})
	if len(shares) > 3 {
		shares = shares[:3]
	}
	return shares
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
