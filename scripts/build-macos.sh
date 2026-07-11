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

[[ "$(uname -s)" == "Darwin" ]] || fail "macOS build must be run on macOS."
[[ "$(uname -m)" == "arm64" ]] || fail "This builder currently targets Apple Silicon (arm64)."

cd "$ROOT"

step "Checking required tools"
require_command node
require_command npm
require_command xcode-select
require_command kubectl
xcode-select -p >/dev/null 2>&1 || fail "Xcode Command Line Tools are not installed."

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' ||
  fail "Node.js 22.12 or newer is required for Electron 43 tooling."

ROOT_VERSION="$(node -p 'require("./package.json").version')"
DESKTOP_VERSION="$(node -p 'require("./apps/desktop/package.json").version')"
[[ "$ROOT_VERSION" == "$DESKTOP_VERSION" ]] || fail "Version mismatch: root=$ROOT_VERSION desktop=$DESKTOP_VERSION"

SEVEN_ZA="$(command -v 7za || true)"
[[ -n "$SEVEN_ZA" && -x "$SEVEN_ZA" ]] ||
  fail "7za is required. Install it with: brew install p7zip"

mkdir -p "$ROOT/node_modules/7zip-bin/mac/arm64"
ln -sf "$SEVEN_ZA" "$ROOT/node_modules/7zip-bin/mac/arm64/7za"

node -e "require('node-pty')" >/dev/null 2>&1 || fail "node-pty is not usable for darwin arm64. Reinstall npm dependencies on this Mac."

printf 'Node: %s\n' "$(node -v)"
printf 'npm: %s\n' "$(npm -v)"
printf 'kubectl: %s\n' "$(kubectl version --client --output=yaml 2>/dev/null | awk '/gitVersion:/ {print $2; exit}')"
printf 'KubeDeck: %s\n' "$ROOT_VERSION"

step "Cleaning macOS release output"
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
  --arch arm64 \
  --module-dir "$ROOT"

ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" \
  -e "require('node-pty'); console.log('node-pty Electron OK:', process.versions.electron, process.arch)"

SPAWN_HELPER="$ROOT/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
[[ -f "$SPAWN_HELPER" ]] || fail "node-pty spawn-helper is missing: $SPAWN_HELPER"
chmod 755 "$SPAWN_HELPER"

step "Packaging unsigned macOS arm64 DMG and ZIP"
export CSC_IDENTITY_AUTO_DISCOVERY=false
export npm_config_fetch_retries=5
export npm_config_fetch_retry_mintimeout=20000
export npm_config_fetch_retry_maxtimeout=120000
export npm_config_fetch_timeout=300000
ELECTRON_CACHE_ZIP="$HOME/Library/Caches/electron/electron-v${ELECTRON_VERSION}-darwin-arm64.zip"
BUILDER_ARGS=()
if [[ -f "$ELECTRON_CACHE_ZIP" ]] && unzip -tqq "$ELECTRON_CACHE_ZIP" >/dev/null 2>&1; then
  printf 'Using cached Electron archive: %s\n' "$ELECTRON_CACHE_ZIP"
  BUILDER_ARGS+=("--config.electronDist=$ELECTRON_CACHE_ZIP")
fi
npm --workspace apps/desktop run dist:mac -- "${BUILDER_ARGS[@]}"

step "Validating release artifacts"
DMG="$RELEASE_DIR/KubeDeck-${ROOT_VERSION}-arm64.dmg"
ZIP="$RELEASE_DIR/KubeDeck-${ROOT_VERSION}-arm64.zip"

[[ -f "$DMG" ]] || fail "DMG was not produced: $DMG"
if [[ ! -f "$ZIP" ]]; then
  ZIP="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name "KubeDeck-${ROOT_VERSION}-arm64*.zip" -print -quit)"
fi
[[ -n "${ZIP:-}" && -f "$ZIP" ]] || fail "macOS ZIP was not produced in: $RELEASE_DIR"

PACKAGED_SPAWN_HELPER="$RELEASE_DIR/mac-arm64/KubeDeck.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
[[ -x "$PACKAGED_SPAWN_HELPER" ]] ||
  fail "Packaged node-pty spawn-helper is not executable: $PACKAGED_SPAWN_HELPER"

node "$ROOT/scripts/verify-release.cjs" --release-dir "$RELEASE_DIR" --artifact mac

printf '\nBuild completed successfully.\n'
printf 'DMG: %s\n' "$DMG"
printf 'ZIP: %s\n' "$ZIP"
printf '\nThe build is unsigned. On first launch use Control-click -> Open in Finder if macOS blocks it.\n'
