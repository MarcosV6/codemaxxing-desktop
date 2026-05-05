#!/bin/bash
#
# Codemaxxing Desktop — one-line macOS installer.
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/MarcosV6/codemaxxing-desktop/main/install-mac.sh)
#
# What it does:
#   1. Detects your Mac's architecture (Apple Silicon vs Intel)
#   2. Downloads the matching zip from the latest GitHub release
#   3. Unzips into /Applications
#   4. Strips the quarantine attribute (xattr -cr) so Gatekeeper doesn't
#      block first launch — the app isn't signed with an Apple Developer
#      ID yet, so without this you'd see the "Apple could not verify"
#      dialog and have to do the System Settings dance.
#   5. Opens the app.
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
  arm64)
    ASSET="Codemaxxing-1.0.0-arm64-mac.zip"
    ARCH_LABEL="Apple Silicon"
    ;;
  x86_64)
    ASSET="Codemaxxing-1.0.0-mac.zip"
    ARCH_LABEL="Intel"
    ;;
  *)
    red "Unsupported architecture: $ARCH"
    red "Expected arm64 or x86_64."
    exit 1
    ;;
esac

bold "Codemaxxing Desktop — installer"
echo "  Architecture: ${ARCH_LABEL} (${ARCH})"
echo "  Asset:        ${ASSET}"
echo ""

# Download URL. We resolve via the GitHub `releases/latest` redirect so the
# script doesn't go stale every release — it always grabs whatever's tagged
# as Latest at install time.
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

bold "1/4 Downloading…"
echo "  $DL_URL"
# -L follows redirects (releases/latest → tagged release); -f fails fast on
# 404 instead of saving an HTML error page; -# shows a progress bar.
if ! curl -fL# -o "$ZIP_PATH" "$DL_URL"; then
  red "Download failed."
  red "Check https://github.com/${REPO}/releases for the latest assets and try again."
  exit 1
fi

bold "2/4 Unzipping…"
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

bold "3/4 Installing to ${INSTALL_DIR}…"
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

bold "4/4 Approving for first launch…"
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
