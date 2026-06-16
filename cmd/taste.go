package cmd

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/maximevast/pommard/internal/github"
	"github.com/maximevast/pommard/internal/renderer"
	"github.com/maximevast/pommard/internal/scorer"
	"github.com/spf13/cobra"
)

var tasteCmd = &cobra.Command{
	Use:   "taste <owner/repo>",
	Short: "Pour a tasting card for a GitHub repository",
	Long: "Fetch the public signals of a GitHub repository and present them\n" +
		"as a five-part wine tasting card with a weighted final score.\n\n" +
		"Set GITHUB_TOKEN in your environment for higher API rate limits.",
	Example: "  pommard taste charmbracelet/lipgloss\n" +
		"  pommard taste https://github.com/spf13/cobra",
	Args: cobra.ExactArgs(1),
	RunE: runTaste,
}

func runTaste(cmd *cobra.Command, args []string) error {
	owner, repo, ok := splitRepo(args[0])
	if !ok {
		return fmt.Errorf("invalid repository %q: expected format <owner/repo>", args[0])
	}

	client := github.NewClient(os.Getenv("GITHUB_TOKEN"))

	data, err := client.Fetch(context.Background(), owner, repo)
	if err != nil {
		return prettyError(err, owner, repo)
	}

	card := scorer.Score(data)
	fmt.Fprintln(cmd.OutOrStdout(), renderer.Render(card))
	return nil
}

// splitRepo accepts "owner/repo", a full github URL, or a trailing ".git".
func splitRepo(s string) (owner, repo string, ok bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "https://github.com/")
	s = strings.TrimPrefix(s, "http://github.com/")
	s = strings.TrimPrefix(s, "github.com/")
	s = strings.TrimSuffix(s, ".git")
	s = strings.Trim(s, "/")

	parts := strings.Split(s, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// prettyError turns transport and API errors into actionable messages.
func prettyError(err error, owner, repo string) error {
	switch {
	case errors.Is(err, github.ErrNotFound):
		return fmt.Errorf("repository %s/%s not found — check the spelling, or it may be private", owner, repo)

	case errors.Is(err, github.ErrEmptyRepo):
		return fmt.Errorf("repository %s/%s appears to be empty (no commits to taste)", owner, repo)
	}

	var rl *github.RateLimitError
	if errors.As(err, &rl) {
		var b strings.Builder
		b.WriteString("GitHub API rate limit exceeded")
		if !rl.Reset.IsZero() {
			b.WriteString(fmt.Sprintf(" (resets at %s)", rl.Reset.Local().Format("15:04:05")))
		}
		b.WriteString(".")
		if !rl.HasToken {
			b.WriteString("\n  Set a personal access token to raise your limit:")
			b.WriteString("\n      export GITHUB_TOKEN=ghp_xxxxxxxxxxxx")
		}
		return errors.New(b.String())
	}

	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() || errors.Is(err, context.DeadlineExceeded) {
		return errors.New("request to GitHub timed out after 10s — check your connection and try again")
	}

	return err
}
