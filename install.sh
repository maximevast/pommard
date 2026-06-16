#!/usr/bin/env sh
# pommard installer — detects your OS/arch and installs the latest release.
#
#   curl -fsSL https://pommard.sh/install.sh | bash
#
# Overrides (env vars):
#   POMMARD_VERSION=v1.2.3   install a specific tag (default: latest)
#   BIN_DIR=$HOME/.local/bin install location  (default: /usr/local/bin)
set -eu

REPO="maximevast/pommard"
BINARY="pommard"
BASE="https://github.com/${REPO}"

# ---- output helpers ---------------------------------------------------------
if [ -t 1 ]; then
  C_WINE="$(printf '\033[38;5;88m')"; C_DIM="$(printf '\033[2m')"
  C_GREEN="$(printf '\033[32m')"; C_RED="$(printf '\033[31m')"; C_OFF="$(printf '\033[0m')"
else
  C_WINE=""; C_DIM=""; C_GREEN=""; C_RED=""; C_OFF=""
fi
info()    { printf '%s🍷 %s%s\n' "$C_WINE" "$1" "$C_OFF"; }
note()    { printf '%s   %s%s\n' "$C_DIM" "$1" "$C_OFF"; }
success() { printf '%s✓ %s%s\n' "$C_GREEN" "$1" "$C_OFF"; }
err()     { printf '%s✗ %s%s\n' "$C_RED" "$1" "$C_OFF" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # url -> stdout
  if have curl; then curl -fsSL "$1"
  elif have wget; then wget -qO- "$1"
  else err "need either curl or wget installed"; fi
}

download() { # url dest
  if have curl; then curl -fsSL -o "$2" "$1"
  elif have wget; then wget -qO "$2" "$1"
  else err "need either curl or wget installed"; fi
}

latest_version() {
  fetch "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

install_binary() { # src dir
  src="$1"; dir="$2"
  chmod +x "$src" 2>/dev/null || true
  if mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; then
    mv "$src" "$dir/$BINARY"
  elif have sudo; then
    note "writing to ${dir} requires sudo…"
    sudo mkdir -p "$dir" && sudo mv "$src" "$dir/$BINARY"
  else
    err "no write access to ${dir} — re-run with BIN_DIR=\$HOME/.local/bin"
  fi
}

main() {
  os="$(uname -s)"; arch="$(uname -m)"
  case "$os" in
    Linux)  os="linux" ;;
    Darwin) os="darwin" ;;
    *) err "unsupported OS '${os}' — try: go install github.com/${REPO}@latest" ;;
  esac
  case "$arch" in
    x86_64|amd64)   arch="amd64" ;;
    arm64|aarch64)  arch="arm64" ;;
    *) err "unsupported architecture '${arch}'" ;;
  esac

  version="${POMMARD_VERSION:-latest}"
  [ "$version" = "latest" ] && version="$(latest_version)"
  [ -n "$version" ] || err "could not determine the latest version (is there a published release?)"

  ver="${version#v}"
  archive="${BINARY}_${ver}_${os}_${arch}.tar.gz"
  url="${BASE}/releases/download/${version}/${archive}"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  info "Pouring ${BINARY} ${version} (${os}/${arch})…"
  download "$url" "$tmp/$archive" || err "download failed: ${url}"
  tar -xzf "$tmp/$archive" -C "$tmp" || err "could not extract ${archive}"
  [ -f "$tmp/$BINARY" ] || err "binary not found inside the archive"

  bindir="${BIN_DIR:-/usr/local/bin}"
  install_binary "$tmp/$BINARY" "$bindir"

  success "Installed ${BINARY} ${version} → ${bindir}/${BINARY}"
  case ":${PATH}:" in
    *":${bindir}:"*) ;;
    *) note "add ${bindir} to your PATH:  export PATH=\"${bindir}:\$PATH\"" ;;
  esac
  printf '\n  Pour your first glass:\n    %s%s taste charmbracelet/lipgloss%s\n\n' "$C_WINE" "$BINARY" "$C_OFF"
}

main "$@"
