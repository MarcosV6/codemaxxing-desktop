# codemaxxing-desktop 💪

> same agent. native app. every platform.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![desktop](https://img.shields.io/badge/desktop-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](#install)
[![CLI sibling](https://img.shields.io/badge/cli%20sibling-codemaxxing-7AA2F7.svg)](https://github.com/MarcosV6/codemaxxing)

Native desktop app for [codemaxxing](https://github.com/MarcosV6/codemaxxing) — the open-source coding agent. Connect **any** LLM (local or remote), drive a real agent loop, and do it from a polished GUI instead of the terminal. macOS first, Windows + Linux supported by the same codebase.

> _Looking for the terminal version? It lives at [MarcosV6/codemaxxing](https://github.com/MarcosV6/codemaxxing) — same brain, different surface._

## Why this exists

Claude Desktop is locked to Anthropic. Codex Desktop is locked to OpenAI. Every other "AI assistant" app either ships you to one provider, or hides the agent loop behind a chat-only UX. The terminal `codemaxxing` solves the lock-in part — but a lot of people want a real GUI: drag-and-drop attachments, a sidebar of sessions, themes, command palette, dock notifications. So here's that.

- **Any LLM.** Anthropic, OpenAI, OpenRouter, Qwen, GitHub Copilot, LM Studio, Ollama — and any custom OpenAI-compatible endpoint.
- **Real agent loop.** Files, shell, git, web search, MCP servers. Plan mode. Approval modes (`suggest` / `auto-edit` / `full-auto`). Reasoning effort tiers.
- **Local-first by default.** Sessions, memory (FTS5 search), checkpoints, and skills all live in a SQLite DB on your machine.
- **Talk to it from anywhere.** A built-in HTTP+SSE remote API server with per-device pairing means a future phone client (or any tool) can drive the agent over your LAN or a tunnel.
- **24/7-friendly.** Optional background mode — close the window, the agent keeps running. Tray icon, launch-at-login, never miss an approval.

## Install

> **Status:** v1.0.0 preview. macOS Apple Silicon + Intel ship from GitHub Releases; Windows/Linux build from source. Signed installers + auto-update will follow.

### macOS

Pick the build for your Mac from the latest [release](https://github.com/MarcosV6/codemaxxing-desktop/releases):

| Mac | Download |
|---|---|
| **Apple Silicon** (M1, M2, M3, M4) | [`Codemaxxing-1.0.0-arm64-mac.zip`](https://github.com/MarcosV6/codemaxxing-desktop/releases/download/v1.0.0/Codemaxxing-1.0.0-arm64-mac.zip) |
| **Intel** | [`Codemaxxing-1.0.0-mac.zip`](https://github.com/MarcosV6/codemaxxing-desktop/releases/download/v1.0.0/Codemaxxing-1.0.0-mac.zip) |

> Not sure which you have? Click the **Apple menu** (top-left) → **About This Mac**. If "Chip" says **Apple M…** use the Apple Silicon link. If "Processor" says **Intel** use the Intel one.

#### One-liner install (Terminal)

The fastest path — handles download, unzip, drop into `/Applications`, and removes the quarantine flag so Gatekeeper doesn't block it:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/MarcosV6/codemaxxing-desktop/main/install-mac.sh)
```

Then launch from Applications. Done.

#### Manual install (no Terminal)

1. Download the zip for your Mac (links above).
2. Unzip it. Drag **Codemaxxing.app** into your **Applications** folder.
3. Double-click the app → macOS will say _"Apple could not verify…"_ → click **Done**.
4. Open **System Settings → Privacy & Security → scroll to the bottom**.
5. You'll see _"Codemaxxing was blocked to protect your Mac"_ → click **Open Anyway**.
6. Confirm with Touch ID or password.
7. App opens. Future launches won't show the warning.

> **Why?** The app isn't signed by an Apple Developer ID yet (that's a $99/year subscription that hasn't been bought). macOS treats anything unsigned as suspicious by default. The above is a one-time approval — Apple's intended workflow for trusted software you're choosing to run.

### Windows / Linux

A signed installer isn't published yet. Build from source — it works on both:

```bash
git clone https://github.com/MarcosV6/codemaxxing-desktop.git
cd codemaxxing-desktop
npm install
# Pick one:
npm run electron:build:win        # NSIS installer + portable zip
npm run electron:build:linux      # AppImage + tar.gz + .deb
```

Output lands in `release/`. **Detailed step-by-step (prereqs, troubleshooting, smoke tests):** [docs/BUILDING.md](docs/BUILDING.md). For known platform-specific UI gotchas (traffic-light padding etc.), see [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md).

### From source (any platform — dev workflow)

```bash
git clone https://github.com/MarcosV6/codemaxxing-desktop.git
cd codemaxxing-desktop
npm install
npm run electron:dev
```

## Quick start

1. Launch Codemaxxing.
2. **Settings → Providers** → add an API key, sign in via OAuth, or just start LM Studio / Ollama locally — the app auto-detects them.
3. **New Session** → pick a project directory → pick a model → start chatting.

The first thing to try: drop a file into the chat area. It becomes an `@mention` in your prompt. Works for code files, screenshots, PDFs.

## Features

| | |
|---|---|
| **Agent loop** | files, shell, git, web search, MCP, plan mode, subagents |
| **Approval modes** | `suggest` (ask each tool) · `auto-edit` (auto file writes) · `full-auto` (sandboxed dirs only) |
| **Reasoning** | per-session effort: off / low / medium / high / max — for models that support extended thinking |
| **Sessions** | persistent SQLite, cross-session search, fork-and-compact, checkpoints |
| **Memory** | FTS5-backed long-term memory, per-project scoping, `/memory` slash command |
| **Skills** | reusable prompts/tools you can `/`-invoke; supports the [agentskills.io](https://agentskills.io) format |
| **Hooks** | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd` |
| **Background agents** | headless tasks that run while you do something else |
| **Cron** | scheduled tasks with full agent powers (`/cron`) |
| **Themes** | 16 built-in, theme-aware everywhere |
| **Slash commands** | `/diff` `/status` `/log` `/commit` `/push` `/undo` `/cost` `/compact` `/checkpoint` `/checkpoints` `/skills` `/think` `/memory` `/bg` `/cron` `/settings` `/help` |
| **Remote API** | HTTP+SSE server with per-device pairing — any client can drive the agent. See [docs/REMOTE_API.md](docs/REMOTE_API.md) |
| **24/7 mode** | keep agent alive when window is closed, launch at login, menubar/tray icon |

## Remote access

The desktop ships an HTTP+SSE API for clients on the same LAN (or routed via Tailscale/Cloudflare Tunnel for off-LAN). Pair a device with a 6-character one-time code; each device gets its own bearer token, revokable individually.

Full wire-protocol docs: **[docs/REMOTE_API.md](docs/REMOTE_API.md)**.

This is the foundation for the upcoming native phone clients. Today you can drive it with `curl`, a PWA, or any HTTP client.

## Stack

- **Electron 36** main + preload, contextBridge IPC, sandboxed renderer
- **React 19** + **TypeScript 5.5** + **Vite 7** renderer
- **Zustand 5** state management
- **Tailwind 3** styling with CSS custom properties for theming
- **SQLite** (`better-sqlite3`) for sessions, memory, checkpoints, background agents, cron
- **Hono** for the remote API server
- **electron-builder** for packaging

## Relationship to the CLI

The terminal version at [`MarcosV6/codemaxxing`](https://github.com/MarcosV6/codemaxxing) is the conceptual source of truth for agent behavior. Today, the desktop has its own port of the agent runtime (it doesn't import from the CLI). Long-term plan: extract a shared `@codemaxxing/core` package both repos depend on. For now, behavior parity is maintained manually — file an issue if you spot drift.

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first — the dev workflow is `npm run electron:dev`, the typecheck must stay clean (`npm run typecheck`), and we don't add emojis to source unless asked.

## Security

If you find a vulnerability, please **don't** open a public issue. See [SECURITY.md](SECURITY.md) for the disclosure process.

The threat model in short: this app holds API keys (in keychain or platform-equivalent), executes shell commands (with user approval), runs an HTTP server when remote access is on, and the paired devices control the agent. It deserves the same care you'd give a remote-administration tool.

## License

MIT — see [LICENSE](LICENSE).

Built by [Marcos Vallejo](https://github.com/MarcosV6).
