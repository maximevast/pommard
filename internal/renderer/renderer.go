// Package renderer formats a scored Card into a colourful terminal tasting card.
// Colours are stripped automatically by lipgloss when output is not a TTY.
package renderer

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/maximevast/pommard/internal/scorer"
)

// Brand palette, drawn from the pommard.sh logo.
var (
	wine = lipgloss.Color("#7C2D40") // burgundy
	navy = lipgloss.Color("#1E2A44") // ink
	gold = lipgloss.Color("#C9A227") // medal
)

var (
	headerStyle  = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF")).Background(navy).Padding(0, 1)
	titleStyle   = lipgloss.NewStyle().Bold(true).Foreground(wine)
	badgeStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FFFFFF")).Background(wine).Padding(0, 1)
	keyStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	valStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("252"))
	noteStyle    = lipgloss.NewStyle().Bold(true).Foreground(gold)
	subtleStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("240")).Italic(true)
	yesStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	noStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("203"))
	boxStyle     = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(wine).Padding(1, 3)
)

// Render builds the full multi-section tasting card.
func Render(c scorer.Card) string {
	var b strings.Builder

	b.WriteString(headerStyle.Render("🍷 pommard · "+c.Repo) + "\n\n")

	section(&b, "🍇", "Millésime", c.Millesime, millesimeLines(c))
	section(&b, "🎨", "Robe", c.Robe, robeLines(c))
	section(&b, "👃", "Nez", fmt.Sprintf("%s (%d/5)", c.Nez, c.NezScore), nezLines(c))
	section(&b, "👄", "Bouche", c.Bouche, boucheLines(c))
	section(&b, "🏁", "Finale", c.Finale, finaleLines(c))

	// 🏆 Final score — the headline (functional, so English).
	b.WriteString(titleStyle.Render("🏆  Final score") + "\n")
	score := noteStyle.Render(fmt.Sprintf("%d/100", c.Score))
	b.WriteString("   " + score + "  " + badgeStyle.Render(c.Label) + "\n")
	b.WriteString("   " + subtleStyle.Render("Nez 20 · Bouche 40 · Finale 40") + "\n")

	return boxStyle.Render(strings.TrimRight(b.String(), "\n"))
}

func section(b *strings.Builder, emoji, name, desc string, lines []string) {
	b.WriteString(titleStyle.Render(emoji+"  "+name) + "  " + badgeStyle.Render(desc) + "\n")
	for _, l := range lines {
		b.WriteString("   " + l + "\n")
	}
	b.WriteString("\n")
}

func millesimeLines(c scorer.Card) []string {
	year := "unknown"
	if c.FirstCommitYear > 0 {
		year = fmt.Sprintf("%d", c.FirstCommitYear)
	}
	age := subtleStyle.Render("age unknown")
	if c.AgeYears > 0 {
		age = valStyle.Render(fmt.Sprintf("%.1f yrs", c.AgeYears))
	}
	return []string{
		kv("First commit", valStyle.Render(year)) + "   " + age,
	}
}

func robeLines(c scorer.Card) []string {
	lang := c.PrimaryLanguage
	if len(c.Languages) > 0 {
		parts := make([]string, 0, len(c.Languages))
		for _, l := range c.Languages {
			parts = append(parts, fmt.Sprintf("%s %.1f%%", l.Name, l.Pct))
		}
		lang = strings.Join(parts, " · ")
	}
	if lang == "" {
		lang = "unknown"
	}

	files := "unknown"
	if c.FileCount > 0 {
		files = humanInt(c.FileCount) + " files"
		if c.FileTruncated {
			files += "+"
		}
	}
	files += "   " + subtleStyle.Render(humanSize(c.SizeKB))

	return []string{
		kv("Cépage", valStyle.Render(lang)),
		kv("Size", valStyle.Render(files)),
	}
}

func nezLines(c scorer.Card) []string {
	license := "LICENSE"
	if c.HasLicense && c.LicenseName != "" {
		license = "LICENSE (" + c.LicenseName + ")"
	}
	checks := []string{
		check(c.HasReadme, "README"),
		check(c.HasLicense, license),
		check(c.HasCI, "CI"),
		check(c.HasTopics, "Topics"),
		check(c.HasDescription, "Description"),
	}
	return []string{strings.Join(checks, "   ")}
}

func boucheLines(c scorer.Card) []string {
	issues := fmt.Sprintf("%s open / %s closed", humanInt(c.OpenIssues), humanInt(c.ClosedIssues))
	release := "none"
	if c.LastRelease != nil {
		release = c.LastRelease.Format("2006-01-02")
	}
	return []string{
		kv("Commits (90d)", valStyle.Render(humanInt(c.Commits90))) + "   " +
			kv("Contributors", valStyle.Render(humanInt(c.Contributors))),
		kv("Issues", valStyle.Render(issues)),
		kv("Latest release", valStyle.Render(release)),
	}
}

func finaleLines(c scorer.Card) []string {
	return []string{
		kv("⭐ Stars", valStyle.Render(humanInt(c.Stars))) + "   " +
			kv("Forks", valStyle.Render(humanInt(c.Forks))) + "   " +
			kv("Watchers", valStyle.Render(humanInt(c.Watchers))),
		kv("Growth", valStyle.Render(fmt.Sprintf("%.1f stars/mo", c.StarsPerMonth))),
	}
}

func kv(k, v string) string { return keyStyle.Render(k+": ") + v }

func check(ok bool, name string) string {
	if ok {
		return yesStyle.Render("✓") + " " + name
	}
	return noStyle.Render("✗") + " " + subtleStyle.Render(name)
}

// humanInt formats an integer with thin thousands separators (e.g. 12 345).
func humanInt(n int) string {
	s := fmt.Sprintf("%d", n)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}

// humanSize renders a KB count (GitHub's repo size unit) as KB/MB/GB.
func humanSize(kb int) string {
	switch {
	case kb <= 0:
		return ""
	case kb < 1024:
		return fmt.Sprintf("%d KB", kb)
	case kb < 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(kb)/1024)
	default:
		return fmt.Sprintf("%.1f GB", float64(kb)/1024/1024)
	}
}
