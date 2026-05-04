# Windows release & testing runbook

Companion to [CLAUDE.md](CLAUDE.md). This is the plan for shipping Codemaxxing
on Windows (and, as a freebie, Linux) once the Mac DMG has been through a full
QA pass.

Written: 2026-04-24, after the `Codemaxxing-1.0.0-arm64.dmg` build.

## TL;DR

The bones are cross-platform. A "walking skeleton" `.exe` installer is ~30
minutes of work. A polished, signed, auto-updating Windows release is ~1–2 days
plus the cost of a code-signing certificate.

## Status snapshot

| | macOS | Windows | Linux |
|---|---|---|---|
| Build script | `electron:build:mac` ✅ shipped | `electron:build:win` ready, not run | `electron:build:linux` ready, not run |
| Native deps (`better-sqlite3`) | rebuilt ad-hoc | prebuilt `.node` binaries exist | prebuilt `.node` binaries exist |
| Window chrome | tuned (traffic-light padding) | needs conditional padding | needs conditional padding |
| Icon | `icon.icns` **missing** (default Electron icon) | `icon.ico` **missing** | `icon.png` **missing** |
| Signing | ad-hoc (Gatekeeper warns) | unsigned (SmartScreen warns) | unsigned (no signing needed) |
| Auto-update | not wired | not wired | not wired |

## What's already portable — zero work

- `package.json` has `electron:build:win` and `electron:build:linux` scripts
  and the `build.mac` block in electron-builder; cross-targeting is a matter
  of adding `build.win` / `build.linux` sections.
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

## What needs changing — by file

### 1. Traffic-light padding (cosmetic, ~10 lines)

macOS reserves the top-left 80ish pixels for traffic-light buttons. Three
files hardcode this:

- [src/components/Layout/Layout.tsx:143](src/components/Layout/Layout.tsx)
  — `pl-[92px]` on the sidebar header
- [src/components/Layout/Layout.tsx:301](src/components/Layout/Layout.tsx)
  — `pl-[84px]` on the main header when sidebar closed
- [src/components/Files/FilesPanel.tsx](src/components/Files/FilesPanel.tsx)
  — any drag region reserved space (check before shipping)
- [src/components/Preview/PreviewPanel.tsx](src/components/Preview/PreviewPanel.tsx)
  — same check

On Windows and Linux, window controls are top-*right*, so this padding is
wasted space and the sidebar title gets pushed off-center.

**Fix:** introduce a `usePlatform()` hook that reads
`window.electron.app.getPlatform()` once on mount, and conditionally apply the
padding. Pseudocode:

```ts
// src/hooks/usePlatform.ts
import { useEffect, useState } from 'react'
export function usePlatform() {
  const [p, setP] = useState<'darwin' | 'win32' | 'linux' | null>(null)
  useEffect(() => { (window as any).electron?.app?.getPlatform?.().then(setP) }, [])
  return p
}
```

Then `className={platform === 'darwin' ? 'pl-[92px]' : 'pl-4'}`.

**Lazier alternative:** set `frame: true` on Windows in the `BrowserWindow`
constructor, use the native Windows titlebar, and skip the custom drag region
entirely on non-Mac. Also tidier for alt-tab and snap layouts.

### 2. Icons

- Add `public/icon.icns` (macOS) — currently missing, DMG ships with default
  Electron icon
- Add `public/icon.ico` (Windows)
- Add `public/icon.png` at 512×512 or 1024×1024 (Linux)
- Online converters (e.g. cloudconvert) turn a single 1024×1024 PNG into all
  three formats
- Reference in `package.json`:
  ```json
  "mac":   { "icon": "public/icon.icns" },
  "win":   { "icon": "public/icon.ico"  },
  "linux": { "icon": "public/icon.png"  }
  ```

### 3. electron-builder config additions

Add to `package.json` → `build`:

```json
"win": {
  "target": [
    { "target": "nsis", "arch": ["x64", "arm64"] },
    { "target": "portable", "arch": ["x64"] }
  ],
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
  "target": ["AppImage", "deb"],
  "icon": "public/icon.png",
  "category": "Development"
}
```

`nsis` = Windows installer. `portable` = single `.exe` you can run without
installing (handy for testing). `perMachine: false` = installs into the user
profile so it doesn't need admin rights.

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

Create `.github/workflows/build.yml`:

```yaml
name: Build
on:
  push:
    tags: ['v*']
  workflow_dispatch: {}

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Build (Mac)
        if: matrix.os == 'macos-latest'
        run: npm run electron:build:mac
      - name: Build (Windows)
        if: matrix.os == 'windows-latest'
        run: npm run electron:build:win
      - name: Build (Linux)
        if: matrix.os == 'ubuntu-latest'
        run: npm run electron:build:linux
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.os }}-build
          path: |
            release/*.dmg
            release/*.exe
            release/*.AppImage
            release/*.deb
          if-no-files-found: ignore
```

Push a `v1.0.0` tag → three runners build in parallel → download artifacts.
~5 minutes per platform.

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
- [ ] Edit mode: ⌘S works (actually Ctrl+S on Windows — verify both
      `e.metaKey || e.ctrlKey` handlers fire correctly)
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
- [ ] Session database at `%APPDATA%/codemaxxing-mac/` — sqlite file exists
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

1. **Windows path separators.** Anywhere we pass paths around, make sure
   they're normalized. `relative()` and `join()` from `path` already do this,
   but hardcoded `/` in strings will break. Grep for `.split('/')` and
   `'/' +` before shipping — I found one in Layout.tsx header showing
   `cwd.split('/').slice(-2).join('/')` that'll show nothing on Windows.
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
- Adds `.AppImage` (double-clickable, no install) and `.deb` (Debian/Ubuntu)
  when `build.linux.target` is set (see config snippet above)
- No signing required; `.AppImage` just works
- Same traffic-light padding fix applies (GNOME puts close button top-right,
  KDE varies)
- Estimated total effort: ~15 minutes on top of Windows work

## Future work (not blocking release)

- **Auto-update.** electron-builder supports `GitHub Releases` + `electron-updater`
  for drop-in auto-updates. ~30 min to wire up once you have signed builds.
- **ARM64 Windows.** Already in the `build.win.target` arch array above — test
  on a Copilot+ PC / Surface Pro 11 before claiming support.
- **MSIX package** for Microsoft Store distribution. electron-builder has an
  `appx` target. Probably not worth the overhead until there's demand.
- **Homebrew cask** for Mac install UX parity with `brew install codemaxxing`.

## Rollout suggestion

1. Ship Mac DMG as v1.0.0 → gather QA bugs from personal testing
2. Fix critical Mac bugs → DMG v1.0.1
3. Land the Windows prerequisites (platform hook, icons, electron-builder
   config) as v1.1.0
4. Set up GH Actions workflow, cut a v1.1.0 tag, download Windows artifact
5. Test on a Windows 11 VM using this checklist
6. Fix Windows-specific bugs
7. v1.1.0 release across Mac + Windows + Linux simultaneously
