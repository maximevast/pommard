// Package github is a tiny, purpose-built client for the GitHub REST API.
// It fetches only the signals pommard needs to build a tasting card and
// degrades gracefully: secondary signals that fail are simply omitted,
// while not-found and rate-limit conditions are surfaced to the caller.
package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

const (
	apiBase   = "https://api.github.com"
	userAgent = "pommard-cli"
	timeout   = 10 * time.Second
)

// ErrNotFound is returned when a repository (or sub-resource) is a 404.
var ErrNotFound = errors.New("not found")

// ErrEmptyRepo is returned when a repository exists but has no commits (409).
var ErrEmptyRepo = errors.New("empty repository")

// RateLimitError is returned when GitHub rejects a request for rate limiting.
type RateLimitError struct {
	Reset    time.Time
	HasToken bool
}

func (e *RateLimitError) Error() string { return "github api rate limit exceeded" }

// Client talks to the GitHub REST API with an optional bearer token.
type Client struct {
	http  *http.Client
	token string
}

// NewClient builds a client. An empty token means unauthenticated requests.
func NewClient(token string) *Client {
	return &Client{
		http:  &http.Client{Timeout: timeout},
		token: token,
	}
}

// RepoData is the raw, un-scored bundle of signals for one repository.
type RepoData struct {
	Owner       string
	Name        string
	Description string
	CreatedAt   time.Time
	PushedAt    time.Time
	SizeKB      int

	PrimaryLanguage string
	Languages       map[string]int
	FileCount       int
	FileTruncated   bool

	Stars         int
	Forks         int
	Watchers      int
	OpenIssuesAPI int // from the repo endpoint; includes pull requests

	HasLicense  bool
	LicenseName string
	Topics      []string
	HasReadme   bool
	HasCI       bool

	FirstCommit  time.Time
	Commits90    int
	Contributors int
	OpenIssues   int // issues only, via search
	ClosedIssues int // issues only, via search
	LastRelease  *time.Time
}

type apiRepo struct {
	Size            int       `json:"size"`
	Language        string    `json:"language"`
	StargazersCount int       `json:"stargazers_count"`
	ForksCount      int       `json:"forks_count"`
	SubscribersCount int      `json:"subscribers_count"`
	OpenIssuesCount int       `json:"open_issues_count"`
	Description     string    `json:"description"`
	Topics          []string  `json:"topics"`
	CreatedAt       time.Time `json:"created_at"`
	PushedAt        time.Time `json:"pushed_at"`
	DefaultBranch   string    `json:"default_branch"`
	License         *struct {
		SPDXID string `json:"spdx_id"`
		Name   string `json:"name"`
	} `json:"license"`
}

// Fetch gathers all signals for owner/repo. The primary repository call is
// fatal on error; secondary calls are best-effort, except that a rate-limit
// hit on any core call is surfaced so the user can set a token.
func (c *Client) Fetch(ctx context.Context, owner, repo string) (*RepoData, error) {
	rd := &RepoData{Owner: owner, Name: repo}

	_, body, err := c.do(ctx, fmt.Sprintf("/repos/%s/%s", owner, repo))
	if err != nil {
		return nil, err
	}
	var ar apiRepo
	if err := json.Unmarshal(body, &ar); err != nil {
		return nil, fmt.Errorf("decoding repository: %w", err)
	}
	rd.Description = ar.Description
	rd.CreatedAt = ar.CreatedAt
	rd.PushedAt = ar.PushedAt
	rd.SizeKB = ar.Size
	rd.PrimaryLanguage = ar.Language
	rd.Stars = ar.StargazersCount
	rd.Forks = ar.ForksCount
	rd.Watchers = ar.SubscribersCount
	rd.OpenIssuesAPI = ar.OpenIssuesCount
	rd.Topics = ar.Topics
	if ar.License != nil && ar.License.SPDXID != "" && ar.License.SPDXID != "NOASSERTION" {
		rd.HasLicense = true
		rd.LicenseName = ar.License.SPDXID
	}
	branch := ar.DefaultBranch
	if branch == "" {
		branch = "HEAD"
	}

	// Secondary, best-effort signals. abort returns the error only when it is
	// a rate-limit condition worth surfacing; everything else is swallowed.
	abort := func(err error) error {
		var rl *RateLimitError
		if err != nil && errors.As(err, &rl) {
			return rl
		}
		return nil
	}

	if langs, err := c.languages(ctx, owner, repo); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.Languages = langs
		if rd.PrimaryLanguage == "" {
			rd.PrimaryLanguage = topLang(langs)
		}
	}

	if n, truncated, err := c.fileCount(ctx, owner, repo, branch); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.FileCount = n
		rd.FileTruncated = truncated
	}

	if ok, err := c.exists(ctx, fmt.Sprintf("/repos/%s/%s/readme", owner, repo)); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.HasReadme = ok
	}

	if ok, err := c.hasCI(ctx, owner, repo); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.HasCI = ok
	}

	if t, err := c.firstCommit(ctx, owner, repo); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.FirstCommit = t
	}

	if n, err := c.commitsSince(ctx, owner, repo, time.Now().AddDate(0, 0, -90)); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.Commits90 = n
	}

	if n, err := c.contributors(ctx, owner, repo); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.Contributors = n
	}

	if t, err := c.latestRelease(ctx, owner, repo); err != nil {
		if e := abort(err); e != nil {
			return nil, e
		}
	} else {
		rd.LastRelease = t
	}

	// Issue counts use the Search API, which has its own (tight) rate limit.
	// Treat all failures as "unknown" so the card still renders.
	rd.OpenIssues, _ = c.issueCount(ctx, owner, repo, "open")
	rd.ClosedIssues, _ = c.issueCount(ctx, owner, repo, "closed")

	return rd, nil
}

func (c *Client) languages(ctx context.Context, owner, repo string) (map[string]int, error) {
	_, body, err := c.do(ctx, fmt.Sprintf("/repos/%s/%s/languages", owner, repo))
	if err != nil {
		return nil, err
	}
	var m map[string]int
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *Client) fileCount(ctx context.Context, owner, repo, branch string) (int, bool, error) {
	_, body, err := c.do(ctx, fmt.Sprintf("/repos/%s/%s/git/trees/%s?recursive=1", owner, repo, branch))
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrEmptyRepo) {
			return 0, false, nil
		}
		return 0, false, err
	}
	var r struct {
		Tree []struct {
			Type string `json:"type"`
		} `json:"tree"`
		Truncated bool `json:"truncated"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return 0, false, err
	}
	n := 0
	for _, t := range r.Tree {
		if t.Type == "blob" {
			n++
		}
	}
	return n, r.Truncated, nil
}

// exists reports whether a GET to path returns 2xx (404 -> false).
func (c *Client) exists(ctx context.Context, path string) (bool, error) {
	_, _, err := c.do(ctx, path)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (c *Client) hasCI(ctx context.Context, owner, repo string) (bool, error) {
	_, body, err := c.do(ctx, fmt.Sprintf("/repos/%s/%s/actions/workflows?per_page=1", owner, repo))
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var r struct {
		TotalCount int `json:"total_count"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return false, err
	}
	return r.TotalCount > 0, nil
}

func (c *Client) latestRelease(ctx context.Context, owner, repo string) (*time.Time, error) {
	_, body, err := c.do(ctx, fmt.Sprintf("/repos/%s/%s/releases/latest", owner, repo))
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var r struct {
		PublishedAt time.Time `json:"published_at"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, err
	}
	if r.PublishedAt.IsZero() {
		return nil, nil
	}
	t := r.PublishedAt
	return &t, nil
}

func (c *Client) firstCommit(ctx context.Context, owner, repo string) (time.Time, error) {
	resp, body, err := c.do(ctx, fmt.Sprintf("/repos/%s/%s/commits?per_page=1", owner, repo))
	if err != nil {
		return time.Time{}, err
	}
	last := parseLastPage(resp.Header.Get("Link"))
	if last <= 1 {
		return commitDate(body)
	}
	_, body, err = c.do(ctx, fmt.Sprintf("/repos/%s/%s/commits?per_page=1&page=%d", owner, repo, last))
	if err != nil {
		return time.Time{}, err
	}
	return commitDate(body)
}

func commitDate(body []byte) (time.Time, error) {
	var arr []struct {
		Commit struct {
			Author struct {
				Date time.Time `json:"date"`
			} `json:"author"`
		} `json:"commit"`
	}
	if err := json.Unmarshal(body, &arr); err != nil {
		return time.Time{}, err
	}
	if len(arr) == 0 {
		return time.Time{}, nil
	}
	return arr[0].Commit.Author.Date, nil
}

func (c *Client) commitsSince(ctx context.Context, owner, repo string, since time.Time) (int, error) {
	path := fmt.Sprintf("/repos/%s/%s/commits?per_page=1&since=%s", owner, repo, since.UTC().Format(time.RFC3339))
	return c.countViaPagination(ctx, path)
}

func (c *Client) contributors(ctx context.Context, owner, repo string) (int, error) {
	path := fmt.Sprintf("/repos/%s/%s/contributors?per_page=1&anon=1", owner, repo)
	return c.countViaPagination(ctx, path)
}

// countViaPagination requests one item per page and reads the rel="last" page
// number from the Link header to get the total count cheaply.
func (c *Client) countViaPagination(ctx context.Context, path string) (int, error) {
	resp, body, err := c.do(ctx, path)
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrEmptyRepo) {
			return 0, nil
		}
		return 0, err
	}
	if last := parseLastPage(resp.Header.Get("Link")); last > 0 {
		return last, nil
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(body, &arr); err != nil {
		return 0, nil
	}
	return len(arr), nil
}

func (c *Client) issueCount(ctx context.Context, owner, repo, state string) (int, error) {
	path := fmt.Sprintf("/search/issues?q=repo:%s/%s+type:issue+state:%s&per_page=1", owner, repo, state)
	_, body, err := c.do(ctx, path)
	if err != nil {
		return 0, err
	}
	var r struct {
		TotalCount int `json:"total_count"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return 0, err
	}
	return r.TotalCount, nil
}

// do performs a GET and maps status codes to sentinel errors.
func (c *Client) do(ctx context.Context, path string) (*http.Response, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+path, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, nil, err
	}

	switch {
	case resp.StatusCode == http.StatusNotFound:
		return resp, body, ErrNotFound
	case resp.StatusCode == http.StatusConflict:
		return resp, body, ErrEmptyRepo
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		if resp.StatusCode == http.StatusTooManyRequests || resp.Header.Get("X-RateLimit-Remaining") == "0" {
			return resp, body, c.rateLimitErr(resp)
		}
		return resp, body, fmt.Errorf("github api: %s", resp.Status)
	case resp.StatusCode >= 400:
		return resp, body, fmt.Errorf("github api: %s", resp.Status)
	}
	return resp, body, nil
}

func (c *Client) rateLimitErr(resp *http.Response) error {
	e := &RateLimitError{HasToken: c.token != ""}
	if v := resp.Header.Get("X-RateLimit-Reset"); v != "" {
		if sec, err := strconv.ParseInt(v, 10, 64); err == nil {
			e.Reset = time.Unix(sec, 0)
		}
	}
	return e
}

var linkLastRe = regexp.MustCompile(`[?&]page=(\d+)[^>]*>;\s*rel="last"`)

// parseLastPage extracts the rel="last" page number from a Link header.
func parseLastPage(link string) int {
	m := linkLastRe.FindStringSubmatch(link)
	if len(m) < 2 {
		return 0
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

func topLang(m map[string]int) string {
	best, max := "", -1
	for k, v := range m {
		if v > max {
			best, max = k, v
		}
	}
	return best
}
