#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT/apps/desktop"
RELEASE_DIR="$DESKTOP_DIR/release"

step() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' was not found in PATH."
}

[[ "$(uname -s)" == "Linux" ]] || fail "Linux build must be run on Linux."
[[ "$(uname -m)" == "x86_64" ]] || fail "This builder currently targets Linux x64."

cd "$ROOT"

step "Checking required tools"
require_command node
require_command npm
require_command kubectl

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' ||
  fail "Node.js 22.12 or newer is required for Electron 43 tooling."

ROOT_VERSION="$(node -p 'require("./package.json").version')"
DESKTOP_VERSION="$(node -p 'require("./apps/desktop/package.json").version')"
[[ "$ROOT_VERSION" == "$DESKTOP_VERSION" ]] || fail "Version mismatch: root=$ROOT_VERSION desktop=$DESKTOP_VERSION"

node -e "require('node-pty')" >/dev/null 2>&1 || fail "node-pty is not usable for linux x64. Reinstall npm dependencies on this machine."

printf 'Node: %s\n' "$(node -v)"
printf 'npm: %s\n' "$(npm -v)"
printf 'kubectl: %s\n' "$(kubectl version --client --output=yaml 2>/dev/null | awk '/gitVersion:/ {print $2; exit}')"
printf 'KubeDeck: %s\n' "$ROOT_VERSION"

step "Cleaning Linux release output"
rm -rf "$RELEASE_DIR"

step "Running source verification gate"
npm run verify

step "Checking release invariants"
npm run verify:release

step "Rebuilding node-pty for Electron"
ELECTRON_VERSION="$(node -p 'require("./apps/desktop/package.json").devDependencies.electron.replace(/^[^0-9]*/, "")')"
ELECTRON_REBUILD="$ROOT/node_modules/.bin/electron-rebuild"
ELECTRON_BIN="$ROOT/node_modules/.bin/electron"

[[ -x "$ELECTRON_REBUILD" ]] ||
  fail "@electron/rebuild is unavailable. Run: npm ci --no-audit --no-fund"
[[ -x "$ELECTRON_BIN" ]] ||
  fail "Electron executable is unavailable. Run: npm ci --no-audit --no-fund"

node "$ROOT/scripts/ensure-electron.cjs"

export npm_config_fetch_retries=5
export npm_config_fetch_retry_mintimeout=20000
export npm_config_fetch_retry_maxtimeout=120000
export npm_config_fetch_timeout=300000

"$ELECTRON_REBUILD" \
  --force \
  --only node-pty \
  --version "$ELECTRON_VERSION" \
  --arch x64 \
  --module-dir "$ROOT"

step "Packaging Linux x64 AppImage"
npm --workspace apps/desktop run dist:linux

step "Validating release artifacts"
APPIMAGE="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name "KubeDeck-${ROOT_VERSION}-*.AppImage" -print -quit)"
[[ -n "${APPIMAGE:-}" && -f "$APPIMAGE" ]] || fail "AppImage was not produced in: $RELEASE_DIR"
chmod +x "$APPIMAGE"

node "$ROOT/scripts/verify-release.cjs" --release-dir "$RELEASE_DIR" --artifact linux

printf '\nBuild completed successfully.\n'
printf 'AppImage: %s\n' "$APPIMAGE"
printf '\nThe AppImage needs FUSE 2 to run. On distributions that ship only FUSE 3, install libfuse2\n'
printf 'or extract the image with: %s --appimage-extract\n' "$(basename "$APPIMAGE")"
