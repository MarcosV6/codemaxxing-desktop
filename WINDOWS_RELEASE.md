# Windows release & testing runbook

Companion to [CLAUDE.md](CLAUDE.md). This is the native Windows QA checklist;
packaging and GitHub release automation are already configured.

Updated: 2026-07-24.

## TL;DR

Windows x64 and Linux x64 packages are built by GitHub Actions for version
tags. They must still pass this checklist on clean native machines before the
beta is described as fully validated. Authenticode signing and auto-update are
separate post-beta work.

## Status snapshot

| | macOS | Windows | Linux |
|---|---|---|---|
| Build script | `electron:build:mac` verified | `electron:build:win` + native CI configured | `electron:build:linux` + native CI configured |
| Native deps (`better-sqlite3`) | locally verified | release runner rebuilds natively | release runner rebuilds natively |
| Window chrome | inset traffic lights | native title bar + Windows padding | native title bar + Linux padding |
| Icon | `icon.icns` present | `icon.ico` present | `icon.png` present |
| Signing | ad-hoc (Gatekeeper warns) | unsigned (SmartScreen warns) | unsigned (no signing needed) |
| Auto-update | not wired | not wired | not wired |

## What's already portable — zero work

- `package.json` has complete macOS, Windows, and Linux target blocks plus
  `electron:build:*` scripts.
- Credentials use `conf` / `electron-store` — JSON in the platform-appropriate
  user data dir. **No Keychain/keytar dependency**, no native credential
  manager lock-in.
- `better-sqlite3` ships prebuilt binaries for win32-x64 and linux-x64 via
  their release pipeline; `postinstall` runs `electron-rebuild -f -w
  better-sqlite3` per-platform.
- Platform-conditional logic is already present in:
  - [electron/core/tools.ts:21](electron/core/tools.ts) — sandbox path check
    for `\` vs `/` separators
  - [electron/core/backgroundCommands.ts:22](electron/core/backgroundCommands.ts)
    — shell selection (`cmd.exe` on win32)
  - [electron/core/auth.ts:285](electron/core/auth.ts) — uses `where` on
    win32, `which` elsewhere
  - [electron/main.ts:168](electron/main.ts) — standard `if
    (process.platform !== 'darwin') app.quit()` pattern on window-all-closed
  - [electron/main.ts:980](electron/main.ts) — child-process `.kill()` on
    win32
- Renderer (React, Vite, Zustand, Tailwind, lucide, highlight.js, the whole
  `src/` tree) is platform-agnostic.

## Completed cross-platform prerequisites

### 1. Window chrome and traffic-light padding

The renderer uses [`src/utils/platform.ts`](src/utils/platform.ts) for
platform-appropriate shortcut labels and header padding. `electron/main.ts`
uses the inset title bar only on macOS; Windows and Linux keep their native
title bars and window controls.

Windows-style backslash paths are normalized for renderer display, file
mentions, image loading, and glob results.

### 2. Icons

- Platform icons are present as `public/icon.icns`, `public/icon.ico`, and
  `public/icon.png`, with `public/icon-1024.png` retained as the high-resolution
  source.
- Keep these references in `package.json`:
  ```json
  "mac":   { "icon": "public/icon.icns" },
  "win":   { "icon": "public/icon.ico"  },
  "linux": { "icon": "public/icon.png"  }
  ```

### 3. electron-builder configuration

The active `package.json` configuration includes:

```json
"win": {
  "target": ["nsis", "zip"],
  "icon": "public/icon.ico"
},
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "perMachine": false,
  "createDesktopShortcut": "always",
  "createStartMenuShortcut": true,
  "shortcutName": "Codemaxxing"
},
"linux": {
  "target": ["AppImage", "tar.gz", "deb"],
  "icon": "public/icon.png",
  "category": "Development"
}
```

`nsis` is the Windows installer; `zip` is the extract-and-run option.
`perMachine: false` installs into the user profile so it doesn't need admin
rights.

### 4. Codex CLI token import (optional gap)

[electron/core/auth.ts:343](electron/core/auth.ts) uses macOS's `security
find-generic-password` CLI to read Codex tokens from the Keychain. Already
guarded `if (process.platform === 'darwin')`, so it's a no-op on Windows —
**not a bug**, just a feature gap. Codex CLI stores its tokens in
`%APPDATA%/codex/` on Windows anyway, and the file-based detection above it
already picks those up.

## Build logistics

### Option A — local cross-build (fast but flaky)

From this Mac:
```bash
npm run electron:build:win
```

electron-builder will use wine to stub Windows signatures. Produces a valid
`.exe` installer, but:
- You can't actually run it on macOS to test
- wine has to be installed (`brew install --cask wine-stable`)
- Occasionally fails on native module resigning

Useful for quick iteration if you have a Windows VM (Parallels, UTM, VMware
Fusion) to copy the artifact into.

### Option B — GitHub Actions (recommended)

The checked-in `.github/workflows/release.yml` builds macOS arm64, Windows
x64, and Linux x64 on native runners. Push a version tag matching
`package.json` (for example `v1.3.8`) to package all three platforms and attach
the assets plus checksums to the GitHub Release. A failure on any platform
prevents publication.

## Code signing (Windows)

Three options, pick one:

1. **Ship unsigned.** SmartScreen shows "Unknown publisher" on first launch.
   User clicks "More info" → "Run anyway." Same UX friction as current Mac
   ad-hoc. Zero cost. **Recommended for early beta.**

2. **Standard code-signing cert** ($200–400/year, e.g. Sectigo, SSL.com).
   Removes the warning after ~3000 downloads build SmartScreen reputation.
   Instant trust if you use an EV cert, but those need a physical USB HSM
   token ($50–100 one-time) and cost more.

3. **Azure Trusted Signing** (~$10/month, newer option from Microsoft). No
   physical token, instant reputation. Worth checking if still in GA by the
   time you ship.

To sign in electron-builder:
```json
"win": {
  "certificateFile": "path/to/cert.pfx",
  "certificatePassword": "${env.CSC_KEY_PASSWORD}"
}
```

## Testing checklist for first Windows build

Run through this on a clean Windows 11 machine (or a fresh VM snapshot) with
the `.exe` installer. Parity with the Mac QA pass but with Windows-specific
additions.

### Install + launch
- [ ] Installer runs, user-profile install works without admin prompt
- [ ] Start Menu shortcut appears
- [ ] Desktop shortcut appears (if enabled)
- [ ] App launches, window is sized/positioned reasonably (not offscreen)
- [ ] SmartScreen warning is dismissable (click More info → Run anyway)
- [ ] No blank renderer / white screen on launch
- [ ] DevTools console has no red errors

### Window chrome
- [ ] Traffic-light padding isn't wasting 80px on the left (bug before fix)
- [ ] Title bar is dragable
- [ ] Minimize / maximize / close all work
- [ ] Window snap (drag to screen edge) works
- [ ] Alt-Tab shows app icon + title correctly
- [ ] Window remembers size/position across restarts

### Core agent flow
- [ ] New session — directory picker opens Windows file dialog (not broken)
- [ ] Model picker loads providers
- [ ] Send a message, streaming works, no encoding glitches in output
- [ ] Stop/abort works
- [ ] Tool calls render with correct icons/status
- [ ] Approval modal appears for edits/shell; decisions respected

### Filesystem
- [ ] Files panel: tree loads root
- [ ] Tree expand/collapse
- [ ] File viewer: syntax highlighting correct
- [ ] Edit mode: Ctrl+S works and is labeled correctly
- [ ] Esc discards
- [ ] Conflict detection: edit a file, modify it externally (Notepad), save
      → banner appears with Keep mine / Reload / Dismiss
- [ ] Selection "Ask about this" button appears and sends correctly
- [ ] Path separators: tree shows Windows-style `\` OR normalizes to `/` —
      decide which, either is fine but must be consistent
- [ ] @-mentions in chat — file picker popup, paths are correct

### Shell / tools
- [ ] `/status`, `/diff`, `/log` work against a git repo
- [ ] `/commit`, `/push` work (requires git installed on Windows)
- [ ] Shell command approvals — command runs in `cmd.exe` / PowerShell as
      expected (see [electron/core/backgroundCommands.ts:22](electron/core/backgroundCommands.ts))
- [ ] Background agents can start + stream output
- [ ] Cron tasks fire (node-cron is platform-neutral but worth a spot check)

### Persistence
- [ ] Close app, reopen — sessions persist
- [ ] Session database at `%USERPROFILE%\.codemaxxing-mac\` — sqlite file exists
- [ ] Memory (FTS5 recall) works
- [ ] Checkpoints save + restore
- [ ] Themes persist across restart

### Auth
- [ ] API key entry saves + survives restart
- [ ] OAuth (OpenRouter) — external browser opens, callback lands
- [ ] Device flow (Copilot) works
- [ ] No Keychain-style prompts (Windows DPAPI is transparent)
- [ ] Codex CLI import correctly reports "not found" rather than crashing

### UI parity
- [ ] All themes render correctly (check 3–4 at random)
- [ ] Command palette ⌘K / Ctrl+K opens
- [ ] Command palette search works across files/sessions/commands
- [ ] Drag-drop a file from Explorer into chat → becomes @mention
- [ ] Sidebar show/hide
- [ ] Files panel resize drag handle
- [ ] Preview panel opens
- [ ] Both Files + Preview open simultaneously — layout doesn't break
- [ ] Settings modal: all tabs load (General, Agent, Skills, Hooks,
      Providers, Appearance)
- [ ] Font rendering is acceptable (Windows GDI vs Mac CoreText differ —
      check for blurry/crowded text, consider `-webkit-font-smoothing` tweaks)

### Uninstall
- [ ] Add/Remove Programs shows Codemaxxing
- [ ] Uninstaller removes app files
- [ ] User data at `%APPDATA%/codemaxxing-mac/` is *not* deleted (we want
      this — reinstalls should keep sessions)

## Known gotchas

1. **Windows path separators.** Renderer path display and dropped-file
   mentions normalize `\` to `/`; keep new path manipulation in the main
   process on Node's `path` APIs where possible.
2. **`ComSpec` shell.** backgroundCommands already uses it; good. But commands
   that assume bash syntax (`foo && bar`, backticks, `~`) will break under
   `cmd.exe`. Consider preferring PowerShell on win32 instead.
3. **`better-sqlite3` ABI mismatch.** If you build the `.exe` on a Windows
   runner with one Node version but the Electron binary uses another, you'll
   hit `NODE_MODULE_VERSION mismatch` at runtime. `@electron/rebuild` in
   electron-builder's postinstall handles this, but verify the first build.
4. **Renderer crashes on first launch** — same "GPU cache corruption" pattern
   we hit on Mac during dev. Much less common on fresh Windows installs, but
   if it happens: `%APPDATA%/codemaxxing-mac/GPUCache/` is the cache to clear.
5. **Antivirus false positives.** Unsigned Electron apps occasionally get
   flagged by Defender / third-party AV, especially anything that spawns
   shells (we do, a lot). Code signing dramatically reduces this.
6. **High-DPI scaling.** Test on a 150% / 200% DPI monitor. Electron generally
   handles this fine, but verify no blurry assets.
7. **Font stack.** Our Tailwind defaults fall back through
   `-apple-system, BlinkMacSystemFont, 'Segoe UI', …`. On Windows this lands
   on Segoe UI which is fine. Mono font is `ui-monospace` which falls back
   to Consolas on Windows.

## Linux (freebie)

Basically the same as Windows minus signing hassle.

- `electron:build:linux` already exists
- Produces `.AppImage`, `.deb`, and `.tar.gz` assets on the Linux runner
- No signing required; `.AppImage` just works
- Same traffic-light padding fix applies (GNOME puts close button top-right,
  KDE varies)
- Estimated total effort: ~15 minutes on top of Windows work

## Future work (not blocking release)

- **Auto-update.** electron-builder supports `GitHub Releases` + `electron-updater`
  for drop-in auto-updates. ~30 min to wire up once you have signed builds.
- **ARM64 Windows.** Add a native `windows-11-arm` release runner and test on
  a Copilot+ PC / Surface Pro before claiming support.
- **MSIX package** for Microsoft Store distribution. electron-builder has an
  `appx` target. Probably not worth the overhead until there's demand.
- **Homebrew cask** for Mac install UX parity with `brew install codemaxxing`.

## Rollout suggestion

1. Commit the beta-readiness changes and bump the version.
2. Push the matching version tag and wait for all three release jobs.
3. Verify `SHA256SUMS.txt`, then test the Windows installer on clean Windows
   11 and the AppImage/`.deb` on clean Linux.
4. Fix any native-only failures and replace the prerelease assets if needed.
5. Promote the release after all platform checklists pass.
