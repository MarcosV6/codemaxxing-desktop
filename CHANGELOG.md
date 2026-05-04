# Changelog

All notable changes to Codemaxxing Desktop will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it hits v1.0.0 stable.

## [Unreleased]

## [1.0.0] — 2026-05-04

First public release. macOS arm64 zip ships from GitHub Releases; Windows + Linux are buildable from source.

### Added

- **Native desktop GUI for the codemaxxing agent loop.** Sessions, chat, sidebar, themes (16 built-in), drag-and-drop attachments, slash-command popup, command palette.
- **Multi-provider support.** Anthropic, OpenAI, OpenRouter, Qwen, GitHub Copilot, LM Studio, Ollama, plus any custom OpenAI-compatible endpoint.
- **Approval modes** — `suggest`, `auto-edit`, `full-auto` — surfaced via a real modal instead of TUI prompts.
- **Reasoning effort tiers** for models that support extended thinking.
- **Memory** with FTS5-backed search, project-scoped recall, `/memory` slash command.
- **Skills system** compatible with the [agentskills.io](https://agentskills.io) format.
- **Hooks**: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`.
- **Background agents** and **cron-scheduled tasks** with full agent capabilities.
- **Checkpoints** — per-session message snapshots, restore + fork.
- **MCP integration** — connect any MCP server as a tool surface.
- **Plan mode** with structured task tracking.
- **Subagent** primitive — one-shot LLM calls with isolated tool scope.
- **24/7 mode** — `keepAliveInBackground`, launch-at-login, menubar/tray icon, `powerSaveBlocker`.
- **Remote API server** — HTTP+SSE on a configurable port (default `7843`), with per-device pairing tokens and a deep-linkable pairing URI scheme. See [`docs/REMOTE_API.md`](docs/REMOTE_API.md).
- **Cross-platform code paths** — Windows (login items via `--hidden` argv, regular tray icons) and Linux (no autoLaunch primitive — graceful no-op) ready alongside macOS.

### Known issues

- Builds are ad-hoc signed on macOS (no Apple Developer ID yet) — Gatekeeper warns on first launch. Workaround in [README.md](README.md#install).
- Windows + Linux installers are not yet published to GitHub Releases. Build from source with `npm run electron:build:win` / `electron:build:linux`.
- App icon is the default Electron icon. Drop `icon.icns` / `icon.ico` / `icon.png` into `public/` to override.
- Approval prompts auto-raise the desktop window for visibility — this is intentional (so you don't miss prompts when working in another app) but means a paired remote device can interrupt your foreground app.
- Cosmetic: traffic-light padding in the renderer is currently macOS-tuned. Windows/Linux users see a small gap on the top-left of the sidebar header. Tracked in [WINDOWS_RELEASE.md](WINDOWS_RELEASE.md).
- macOS may suspend the agent loop on battery when the lid is closed — `powerSaveBlocker` prevents app suspension but not system sleep.

[Unreleased]: https://github.com/MarcosV6/codemaxxing-desktop/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/MarcosV6/codemaxxing-desktop/releases/tag/v1.0.0
