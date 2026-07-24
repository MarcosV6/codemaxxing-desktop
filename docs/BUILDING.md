# Building from source

Step-by-step for macOS, Windows, and Linux. If you're testing the project for a friend or contributing a fix, this is the right doc.

> **Common to all platforms:** Node.js 22+, npm 10+, git. Electron's renderer needs ~2GB of free disk for `node_modules` and the build outputs. The whole flow is `clone → install → build` and takes 5-15 minutes depending on your machine.

## macOS

If you're testing the released binary, see the [README install section](../README.md#install) — that's faster. The instructions below are for **building from source** (e.g. you want to test a PR, or build for an unreleased commit).

```bash
# Prereqs (skip if you already have these)
brew install node git

# Clone + install + build
git clone https://github.com/MarcosV6/codemaxxing-desktop.git
cd codemaxxing-desktop
npm install                     # postinstall rebuilds better-sqlite3 for Electron's ABI
npm run electron:build:mac      # produces release/*.zip and (if gettext is installed) *.dmg
```

**Output:** a package for the current Mac architecture:
`release/Codemaxxing-<version>-arm64-mac.zip` on Apple Silicon or
`release/Codemaxxing-<version>-mac.zip` on Intel.

**Known wrinkle:** the DMG target needs Homebrew's `gettext` installed (`brew install gettext`). If it's missing, the DMG step fails but the zip succeeds — which is fine for testing.

## Windows

The official beta target is Windows 10 and 11 on x64. ARM64 is not yet part of
the native release gate.

### 1. Prereqs

You need **Node.js**, **git**, and **a C++ compiler** (for native modules — `better-sqlite3` falls back to compiling from source if no prebuilt binary matches your environment).

The fastest path is `winget` (built into Windows 10 1709+ and Windows 11):

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

After that, **close and reopen your terminal** so PATH picks up the new tools.

> **Don't have winget?** Download manually:
> - Node.js LTS → https://nodejs.org
> - Git → https://git-scm.com/download/win
> - VS Build Tools → https://visualstudio.microsoft.com/visual-cpp-build-tools/ (during install, check "Desktop development with C++")

Verify:

```powershell
node --version          # Should be v22 or higher
npm --version           # 10+
git --version
```

### 2. Clone + install + build

```powershell
git clone https://github.com/MarcosV6/codemaxxing-desktop.git
cd codemaxxing-desktop
npm install
npm run electron:build:win
```

The first `npm install` takes longer than on macOS because `electron-rebuild` may need to compile `better-sqlite3` for Windows. Plan for 5-10 minutes the first time.

### 3. What you get

Files appear in `release\`:

- `Codemaxxing.Setup.<version>.exe` — NSIS installer (the friendly one)
- `Codemaxxing-<version>-win.zip` — portable zip (extract anywhere, run `Codemaxxing.exe`)

The default command builds for the current machine architecture. Official beta
releases currently publish the x64 build.

### 4. Test the install

Run `Codemaxxing.Setup.<version>.exe`. You'll see **"Windows protected your PC"** — same situation as macOS without a Developer ID. Click **More info** → **Run anyway**.

Once installed, the app launches normally. SmartScreen only nags on first run.

### 5. Common Windows troubleshooting

| Error | Fix |
|---|---|
| `gyp ERR! find Python` during `npm install` | `winget install Python.Python.3.12`, reopen terminal, retry |
| `MSBUILD : error MSB4019` | VS Build Tools didn't install the C++ workload. Re-run the installer with the C++ workload checkbox |
| `Error: Cannot find module @rollup/rollup-win32-x64-msvc` | Known npm bug with optional deps. `rm -rf node_modules package-lock.json` then `npm install` again |
| `electron-builder` complains about icons | Confirm `public/icon.ico` exists and rerun `npm ci` |
| App opens but SQLite is broken | `npx electron-rebuild -f -w better-sqlite3` then rebuild |

## Linux

Tested on Ubuntu 22.04 and 24.04, x64. AppImage works on most distros (Fedora, Arch, openSUSE, etc.).

### 1. Prereqs

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y nodejs npm git build-essential libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libxshmfence1

# Fedora
sudo dnf install -y nodejs npm git gcc-c++ make alsa-lib nss atk at-spi2-atk cups-libs libdrm libgbm libxkbcommon libXcomposite libXdamage libXrandr

# Arch / Manjaro
sudo pacman -S --needed nodejs npm git base-devel nss atk at-spi2-atk libcups libdrm libxkbcommon libxcomposite libxdamage libxrandr
```

> **Distro packages too old?** Use [nvm](https://github.com/nvm-sh/nvm) to install Node 22+:
> ```bash
> curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
> source ~/.bashrc
> nvm install --lts
> ```

Verify:

```bash
node --version          # v22+
npm --version           # 10+
```

### 2. Clone + install + build

```bash
git clone https://github.com/MarcosV6/codemaxxing-desktop.git
cd codemaxxing-desktop
npm install
npm run electron:build:linux
```

### 3. What you get

Files in `release/`:

- `Codemaxxing-<version>.AppImage` — universal, works on most distros
- `codemaxxing-desktop_<version>_amd64.deb` — for Debian/Ubuntu
- `codemaxxing-desktop-<version>.tar.gz` — extract + run

### 4. Run it

**AppImage** (works anywhere):

```bash
chmod +x release/Codemaxxing-*.AppImage
./release/Codemaxxing-*.AppImage
```

> **AppImage on modern Ubuntu/Fedora throws "AppImage requires FUSE"?** Install FUSE 2:
> ```bash
> sudo apt install -y libfuse2          # Ubuntu/Debian
> sudo dnf install -y fuse-libs         # Fedora
> ```

**.deb** (Debian/Ubuntu):

```bash
sudo dpkg -i release/codemaxxing-desktop_*_amd64.deb
codemaxxing-desktop                    # launches it
```

### 5. Common Linux troubleshooting

| Error | Fix |
|---|---|
| `error while loading shared libraries: libnss3.so` | Install the prereqs from step 1 — that list isn't optional, Electron needs all of them |
| `Failed to launch chrome process` | Usually missing `libgbm1` or `libxkbcommon0`. Install via the prereqs list |
| AppImage won't start, says "AppImages require FUSE" | `sudo apt install libfuse2` (FUSE 2, not 3) |
| `electron-builder` errors about `dpkg` | Install `dpkg` and `fakeroot` — they're packaged separately on some minimal distros |
| `Error: Cannot find module @rollup/rollup-linux-x64-gnu` | `rm -rf node_modules package-lock.json && npm install` |

## Smoke-testing your build

Once the app launches, verify these in order — first failure here is most likely cross-platform-specific:

1. **Window appears.** No black flash, no "blank renderer" pause longer than 2 seconds.
2. **Provider list loads.** Settings → Providers shows the 7+ providers. (If empty, IPC is broken.)
3. **New Session works.** Click + → pick a provider → see the dropdown populate.
4. **Send a message.** Pick any provider you have credentials for, send "say hi", get a streaming reply.
5. **Tool call approval.** Send "list files in this directory" — approval modal pops up — approve — tool runs.
6. **Settings → Remote** loads (this is the new-since-v1.0.0 panel — confirms the new code shipped).
7. **Tray icon.** Toggle "Keep running in background" → close window → tray icon stays in menubar (Mac) / system tray (Win/Linux).

## Uploading binaries to the GitHub release

Once you've built on each platform, attach files to the matching version tag:

```bash
# One-time: log in if not already (uses your Mac's token if you have it copy-pasted, or runs an OAuth flow)
gh auth login

# Add to an existing release (replace the example tag and filenames)
cd codemaxxing-desktop
gh release upload v1.3.10 release/<file-1> release/<file-2> --repo MarcosV6/codemaxxing-desktop
```

If you'd rather use the web UI, open the matching entry under GitHub
**Releases**, choose **Edit**, and drag the binaries into the assets area.

## Releasing (automated)

CI builds every platform for you. Two workflows live in [`.github/workflows`](../.github/workflows):

- **`ci.yml`** — runs typecheck, lint, and unit tests on native macOS, Windows,
  and Linux runners for every push/PR to `main`.
- **`release.yml`** — runs when you push a tag like `v1.3.10`. It packages in
  parallel on macOS arm64, Windows x64, and Linux x64 runners, then attaches
  all installers and `SHA256SUMS.txt` to the GitHub Release. No release is
  published if any platform build fails.

### Cut a release

```bash
# bump "version" in package.json first, commit, then use the same version:
git tag v1.3.10
git push origin v1.3.10
```

Watch it under the repo's **Actions** tab. When the matrix finishes, the **Publish GitHub Release** job creates/updates the release and uploads:

- macOS: `*-arm64-mac.zip`
- Windows: `Codemaxxing.Setup.*.exe`, `*-win.zip`
- Linux: `*.AppImage`, `*.deb`, `*.tar.gz`
- Verification: `SHA256SUMS.txt`

`workflow_dispatch` (the **Run workflow** button) runs the build matrix without publishing — handy for checking a platform still builds before you tag.

> **Native arch only.** CI builds each platform for its runner's native arch (no Windows/Linux arm64 yet) because `better-sqlite3` is a native addon and `electron-rebuild` only compiles for the host arch. Cross-arch builds need a cross toolchain — a later addition.

### Manual fallback

The per-platform `npm run electron:build:*` commands above still work if you'd rather build by hand, then `gh release upload` (see the previous section).

## Code signing & notarization

Without certificate secrets, macOS builds are **ad-hoc signed** and Windows
builds are unsigned. They run, but macOS Gatekeeper and Windows SmartScreen
warn on first open. To remove those warnings, configure platform certificates.

### macOS (Apple Developer ID + notarization — $99/yr)

1. Enroll at https://developer.apple.com, create a **Developer ID Application** certificate, export it as a `.p12`.
2. Create an **app-specific password** for your Apple ID (appleid.apple.com → Sign-In & Security).
3. Hardened runtime and [`build/entitlements.mac.plist`](../build/entitlements.mac.plist)
   are already enabled in `package.json`.
4. Add these as **repo secrets** (Settings → Secrets and variables → Actions).
   `release.yml` already passes them through:

   | Secret | Value |
   |---|---|
   | `CSC_LINK` | base64 of your `.p12` (`base64 -i cert.p12 \| pbcopy`) |
   | `CSC_KEY_PASSWORD` | the `.p12` export password |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 2 |
   | `APPLE_TEAM_ID` | your 10-character Team ID |

### Windows (Authenticode — price varies by CA)

Buy a code-signing certificate (OV, or EV to skip SmartScreen reputation entirely), then add:

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | base64 of your `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |

With the secrets present, the next tagged release is signed (and, on macOS, notarized) automatically — no workflow edits needed.
