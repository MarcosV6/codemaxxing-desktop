#!/bin/bash
#
# Codemaxxing Desktop — one-line macOS installer and updater.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/MarcosV6/codemaxxing-desktop/main/install-mac.sh)
#
# What it does:
#   1. Detects your Mac's architecture (Apple Silicon vs Intel)
#   2. Downloads the matching zip from the latest GitHub release
#   3. Verifies it against the release's SHA256SUMS.txt
#   4. Installs or replaces the app in /Applications
#   5. Strips the quarantine attribute (xattr -cr) so Gatekeeper doesn't
#      block first launch — the app isn't signed with an Apple Developer
#      ID yet, so without this you'd see the "Apple could not verify"
#      dialog and have to do the System Settings dance.
#   6. Opens the app.
#
# This script does NOT require sudo. It works in /Applications because
# /Applications is writable by anyone in the admin group on most Macs.
# If you've locked that down, the script will fall back to ~/Applications.

set -euo pipefail

REPO="MarcosV6/codemaxxing-desktop"
APP_NAME="Codemaxxing.app"

# Pretty output without depending on tput / nice colors. Plain ANSI.
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# Sanity check: macOS only.
if [[ "$(uname -s)" != "Darwin" ]]; then
  red "This installer is for macOS only. On Windows/Linux, build from source:"
  red "  https://github.com/${REPO}#install"
  exit 1
fi

# Architecture detection. uname -m → arm64 (Apple Silicon) or x86_64 (Intel).
# Note: on Apple Silicon Macs running under Rosetta, uname -m says x86_64 even
# though the CPU is arm64. Catch that with sysctl.
ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then
  if sysctl -n sysctl.proc_translated 2>/dev/null | grep -q '^1$'; then
    yellow "→ Detected Intel architecture, but this shell is running under Rosetta."
    yellow "  Treating as Apple Silicon."
    ARCH="arm64"
  fi
fi

case "$ARCH" in
  arm64)  ARCH_LABEL="Apple Silicon" ;;
  x86_64) ARCH_LABEL="Intel" ;;
  *)
    red "Unsupported architecture: $ARCH"
    red "Expected arm64 or x86_64."
    exit 1
    ;;
esac

bold "Codemaxxing Desktop — installer / updater"
echo "  Architecture: ${ARCH_LABEL} (${ARCH})"
echo ""

# Resolve the real asset name from the latest release via the GitHub API —
# asset filenames embed the version (Codemaxxing-1.2.3-arm64-mac.zip), so a
# hard-coded name would break on every release. No jq dependency: grep/sed
# the JSON for asset names.
bold "0/5 Finding the latest release…"
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" || true)"
ASSET_NAMES="$(printf '%s' "$RELEASE_JSON" | grep -o '"name": *"[^"]*\.zip"' | sed 's/.*"name": *"//;s/"$//' || true)"
RELEASE_TAG="$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"tag_name": *"//;s/"$//' || true)"

if [[ "$ARCH" == "arm64" ]]; then
  ASSET="$(printf '%s\n' "$ASSET_NAMES" | grep -E '^Codemaxxing-.*-arm64-mac\.zip$' | head -1 || true)"
else
  # Intel asset has no arch suffix — exclude the arm64 one explicitly.
  ASSET="$(printf '%s\n' "$ASSET_NAMES" | grep -E '^Codemaxxing-.*-mac\.zip$' | grep -v 'arm64' | head -1 || true)"
fi

if [[ -z "$ASSET" ]]; then
  if [[ "$ARCH" == "x86_64" ]]; then
    red "No Intel macOS build in the latest release yet — Apple Silicon only for now."
    red "You can build from source instead: https://github.com/${REPO}#install"
  else
    red "Couldn't find a macOS asset in the latest release (GitHub API may be rate-limiting)."
    red "Download manually from https://github.com/${REPO}/releases/latest"
  fi
  exit 1
fi
echo "  Asset: ${ASSET}"
[[ -n "$RELEASE_TAG" ]] && echo "  Release: ${RELEASE_TAG}"
echo ""

# `releases/latest/download/<asset>` follows the Latest redirect at install
# time, so the URL never goes stale.
DL_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

# Decide install location. /Applications is the canonical home; if the user
# can't write there (rare but happens on locked-down Macs / managed devices)
# fall back to ~/Applications.
INSTALL_DIR="/Applications"
if [[ ! -w "$INSTALL_DIR" ]]; then
  yellow "→ /Applications isn't writable; using ~/Applications instead."
  INSTALL_DIR="${HOME}/Applications"
  mkdir -p "$INSTALL_DIR"
fi

TMP_DIR="$(mktemp -d -t codemaxxing-install)"
trap 'rm -rf "$TMP_DIR"' EXIT
ZIP_PATH="${TMP_DIR}/codemaxxing.zip"

bold "1/5 Downloading…"
echo "  $DL_URL"
# -L follows redirects (releases/latest → tagged release); -f fails fast on
# 404 instead of saving an HTML error page; -# shows a progress bar.
if ! curl -fL# -o "$ZIP_PATH" "$DL_URL"; then
  red "Download failed."
  red "Check https://github.com/${REPO}/releases for the latest assets and try again."
  exit 1
fi

bold "2/5 Verifying checksum…"
CHECKSUMS_PATH="${TMP_DIR}/SHA256SUMS.txt"
CHECKSUMS_URL="https://github.com/${REPO}/releases/latest/download/SHA256SUMS.txt"
if ! curl -fsSL -o "$CHECKSUMS_PATH" "$CHECKSUMS_URL"; then
  red "Couldn't download SHA256SUMS.txt; refusing to install an unverified archive."
  red "Verify the release manually at https://github.com/${REPO}/releases/latest"
  exit 1
fi

EXPECTED_SHA="$(awk -v asset="$ASSET" '$2 == asset { print $1; exit }' "$CHECKSUMS_PATH")"
ACTUAL_SHA="$(shasum -a 256 "$ZIP_PATH" | awk '{ print $1 }')"
if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-fA-F]{64}$ ]]; then
  red "No valid checksum was published for ${ASSET}; refusing to continue."
  exit 1
fi
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  red "Checksum mismatch for ${ASSET}; the download may be incomplete or unsafe."
  red "  Expected: ${EXPECTED_SHA}"
  red "  Actual:   ${ACTUAL_SHA}"
  exit 1
fi
green "✓ Checksum verified"
echo ""

bold "3/5 Unzipping…"
# Use ditto instead of unzip — preserves resource forks / Finder metadata,
# which matters for .app bundles. On modern macOS, unzip works too, but
# ditto is the supported path and what Apple's own installers use.
if ! ditto -x -k "$ZIP_PATH" "$TMP_DIR/extract"; then
  red "Failed to extract the downloaded zip."
  exit 1
fi

EXTRACTED_APP="$(find "$TMP_DIR/extract" -maxdepth 3 -name "$APP_NAME" -type d -print -quit || true)"
if [[ -z "$EXTRACTED_APP" ]]; then
  red "Couldn't find ${APP_NAME} inside the downloaded zip."
  red "The release format may have changed — please report:"
  red "  https://github.com/${REPO}/issues"
  exit 1
fi

bold "4/5 Installing to ${INSTALL_DIR}…"
TARGET="${INSTALL_DIR}/${APP_NAME}"
if [[ -d "$TARGET" ]]; then
  yellow "→ Replacing existing ${APP_NAME}."
  # Move-then-delete so we don't leave the user app-less if the rename fails.
  rm -rf "${TARGET}.old" 2>/dev/null || true
  mv "$TARGET" "${TARGET}.old"
  if ! mv "$EXTRACTED_APP" "$TARGET"; then
    red "Install failed; restoring previous version."
    mv "${TARGET}.old" "$TARGET" 2>/dev/null || true
    exit 1
  fi
  rm -rf "${TARGET}.old"
else
  if ! mv "$EXTRACTED_APP" "$TARGET"; then
    red "Install failed."
    exit 1
  fi
fi

bold "5/5 Approving for first launch…"
# `xattr -cr` strips the com.apple.quarantine extended attribute that
# Gatekeeper checks. Without this, the user would see "Apple could not
# verify…" and have to walk through System Settings → Privacy & Security →
# Open Anyway. Stripping the attribute up-front skips that dance entirely.
#
# Why this is safe here: the user explicitly invoked this script (curl |
# bash) — there's already an established trust relationship. We're not
# installing a random downloaded zip.
xattr -cr "$TARGET" 2>/dev/null || true

green "✓ Installed to ${TARGET}"
echo ""
echo "Opening Codemaxxing…"
open "$TARGET"

echo ""
echo "If anything looks broken, file a bug:"
echo "  https://github.com/${REPO}/issues"
