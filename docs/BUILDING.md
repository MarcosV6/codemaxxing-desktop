# Building from source

Step-by-step for macOS, Windows, and Linux. If you're testing the project for a friend or contributing a fix, this is the right doc.

> **Common to all platforms:** Node.js 18+, npm 9+, git. Electron's renderer needs ~2GB of free disk for `node_modules` and the build outputs. The whole flow is `clone → install → build` and takes 5-15 minutes depending on your machine.

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

**Output:** `release/Codemaxxing-<version>-arm64-mac.zip` (Apple Silicon) and `release/Codemaxxing-<version>-mac.zip` (Intel).

**Known wrinkle:** the DMG target needs Homebrew's `gettext` installed (`brew install gettext`). If it's missing, the DMG step fails but the zip succeeds — which is fine for testing.

## Windows

Tested on Windows 10 and 11, x64. arm64 should work but is less battle-tested.

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
node --version          # Should be v18 or higher
npm --version           # 9+
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

- `Codemaxxing Setup <version>.exe` — NSIS installer (the friendly one)
- `Codemaxxing-<version>-win.zip` — portable zip (extract anywhere, run `Codemaxxing.exe`)

Both x64 and arm64 builds if your machine can produce both.

### 4. Test the install

Run `Codemaxxing Setup <version>.exe`. You'll see **"Windows protected your PC"** — same situation as macOS without a Developer ID. Click **More info** → **Run anyway**.

Once installed, the app launches normally. SmartScreen only nags on first run.

### 5. Common Windows troubleshooting

| Error | Fix |
|---|---|
| `gyp ERR! find Python` during `npm install` | `winget install Python.Python.3.12`, reopen terminal, retry |
| `MSBUILD : error MSB4019` | VS Build Tools didn't install the C++ workload. Re-run the installer with the C++ workload checkbox |
| `Error: Cannot find module @rollup/rollup-win32-x64-msvc` | Known npm bug with optional deps. `rm -rf node_modules package-lock.json` then `npm install` again |
| `electron-builder` complains about icons | Drop `icon.ico` into `public/`, or temporarily comment out the `win.icon` line in `package.json` |
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

> **Distro packages too old?** Use [nvm](https://github.com/nvm-sh/nvm) to install Node 18+:
> ```bash
> curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
> source ~/.bashrc
> nvm install --lts
> ```

Verify:

```bash
node --version          # v18+
npm --version           # 9+
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

Once you've built on each platform, attach to the existing v1.0.0 release:

```bash
# One-time: log in if not already (uses your Mac's token if you have it copy-pasted, or runs an OAuth flow)
gh auth login

# Add to existing release
cd codemaxxing-desktop
gh release upload v1.0.0 release/<file-1> release/<file-2> --repo MarcosV6/codemaxxing-desktop
```

If you'd rather use the web UI: go to https://github.com/MarcosV6/codemaxxing-desktop/releases/tag/v1.0.0 → **Edit** → drag the binaries into the assets area.

## CI alternative (when you have an extra hour)

Eventually you'll want GitHub Actions to build all three platforms automatically on every release tag. Sketched out in [`docs/CI.md`](CI.md) when that lands. For now, manual builds are fine.
