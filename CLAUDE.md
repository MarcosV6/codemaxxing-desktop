# Codemaxxing for Mac

Native macOS GUI for [codemaxxing](https://github.com/) — an open-source coding agent. This repo is the Electron desktop app; the CLI lives in a separate repo at `~/Projects/codemaxxing/`.

## Stack

- **Electron 36** main + preload, contextBridge IPC
- **React 19** + **TypeScript 5.5** + **Vite 7** renderer
- **Zustand 5** state, **Tailwind 3** styling with CSS custom properties
- **SQLite** (`better-sqlite3`) for sessions / memory (FTS5) / checkpoints / bg-agents / cron
- **lucide-react** icons, **react-markdown** for message rendering
- **electron-builder** for packaging (DMG, ZIP, win, linux)

## Directory layout

```
electron/
  main.ts              IPC handlers: sessions, agent runs, git, memory, hooks,
                       skills, checkpoints, bg-agents, cron, MCP, themes
  preload.ts           contextBridge exposing window.electron.*
  core/                Agent orchestration, provider adapters, tool registry,
                       approval/ask/plan state machines, subagent runner
src/
  App.tsx              Entry — delegates to Layout, triggers store init
  main.tsx             React root, installs dev-mocks when window.electron missing
  store/appStore.ts    Single Zustand store — all session, config, auth, theme,
                       live-run, checkpoints, bg-agents, cron, drawers,
                       slash-command dispatch
  components/
    Layout/            Sidebar (sessions, drawers, settings), header, chat panel
    Chat/              ChatArea, InputArea (slash-command popup), ThinkingBlock,
                       PlanBanner, AskUserPrompt, ToolCallBlock
    Modals/            SettingsModal (General/Agent/Skills/Hooks/Providers/
                       Appearance), DrawerModal (Checkpoints/BG Agents/Cron),
                       ApprovalModal, NewSessionModal
    Preview/           Right-side command preview panel
    Shared/            StatusBar, primitives
  dev-mocks/           electron-browser.ts — mock window.electron for plain
                       vite dev (no Electron shell)
  types/               electron.d.ts (IPC surface), index.ts (domain types)
  styles/globals.css   Tailwind + theme variables
public/                Static assets (icon goes here as icon.icns for signing)
dist/                  Renderer build output (gitignored)
dist-electron/         Main + preload build output (gitignored)
release/               electron-builder output — DMG/ZIP (gitignored)
```

## Commands

```bash
npm install                     # first time
npm run electron:dev            # vite dev + electron shell
npm run dev                     # vite only (plain browser, uses dev-mocks)
npm run typecheck               # tsc --noEmit (must stay clean)
npm run build:app               # renderer + main/preload build
npm run electron:build:mac      # full build + DMG → release/
```

## IPC surface (contract)

Renderer talks to main only through `window.electron.*`. Shape lives in [src/types/electron.d.ts](src/types/electron.d.ts). Major namespaces:

- `session` — create/list/get/delete/updateTitle/updateModel/setCwd
- `agent` — send/abort/approvalResponse/askUserResponse + event streams (onText, onThinking, onToolCall, onIteration, onUsage, onTasks, onApprovalRequest, onAskUser, onPlanExit, onDone, onError)
- `auth` — credential CRUD + OAuth/device-flow/setup-token runners, onStatus stream
- `config` / `themes` — persisted app config, 16 built-in themes
- `memory` — list/recall/remember/forget/stats (FTS5-backed)
- `hooks` — global hook list + save (events: PreToolUse, PostToolUse, UserPromptSubmit, SessionStart, SessionEnd)
- `git` — summary/status/diff/log/commit/push/undo (runs in session cwd)
- `skills` — list/search
- `checkpoints` — save/list/restore/delete per-session message snapshots
- `bgAgents` — headless background runs with onText/onToolCall/onUpdate streams
- `cron` — scheduled tasks (5-field cron), onFired stream
- `subagent` — one-shot LLM calls with separate tool scope
- `sessionOps.compact` — summarize old messages and fork into a new session

## Architectural notes

- **One Zustand store.** All state lives in [appStore.ts](src/store/appStore.ts). Live-run state (`currentAssistantText`, `currentThinkingText`, `currentToolCalls`, `currentIteration`, `currentUsage`, `currentTasks`) is cleared on `onDone`/`onError` and flushed into the session's messages.
- **Init is idempotent.** Called from both `main.tsx` (top-level) and `App.tsx` useEffect. Guards with `initialized || loading`, and defensively installs the browser mock if `window.electron` is missing.
- **Approval modes**: `suggest` (ask every edit + shell), `auto-edit` (auto file writes, ask for shell/git), `full-auto` (auto everything — only in sandboxed dirs).
- **Reasoning effort**: `off | low | medium | high | max` → budget 0/2048/6000/12000/24000 tokens, passed per-run to providers that support extended thinking.
- **Slash commands.** Messages starting with `/` are intercepted by `dispatchSlashCommand` in the store before hitting the agent. 17 commands: `/diff`, `/status`, `/log`, `/commit`, `/push`, `/undo`, `/cost`, `/compact`, `/checkpoint`, `/checkpoints`, `/skills`, `/think`, `/memory`, `/bg`, `/cron`, `/settings`, `/help`. Popup in [InputArea.tsx](src/components/Chat/InputArea.tsx) handles keyboard nav.
- **Themes** are CSS custom properties on `:root` (`--theme-bg`, `--theme-primary`, etc.). Components reference them via inline `style` or `color-mix(in srgb, var(--theme-X) N%, transparent)` for tints. 16 themes defined in both [electron/main.ts](electron/main.ts) (`themes:list` IPC) and mirrored in [src/dev-mocks/electron-browser.ts](src/dev-mocks/electron-browser.ts) for browser preview parity.

## Build & distribute

Configured in [package.json](package.json) under `build`:

- `productName: Codemaxxing`, `appId: com.codemaxxing.app`
- Mac targets: `dmg` + `zip`, arm64 by default
- **Ad-hoc signed** — no Developer ID yet. Gatekeeper will flag on first open. Either right-click → Open, or `xattr -cr /Applications/Codemaxxing.app`.
- Icon: drop `icon.icns` into `public/` (not yet set — currently uses Electron default).

## Relationship to the CLI

- The CLI at `~/Projects/codemaxxing/` is the conceptual source of truth for agent behavior.
- This repo **does not import from the CLI** — logic was ported, not shared. If a feature changes in the CLI, it needs a parallel update here.
- See [~/Projects/codemaxxing/src/themes.ts](../codemaxxing/src/themes.ts) for the canonical theme list the Electron themes were ported from.

## Gotchas

- Vite dev server sometimes caches stale module URLs after big file rewrites — if HMR seems out of sync, hard-reload the preview (or stop/start vite).
- `better-sqlite3` is a native module. `postinstall` runs `electron-rebuild -f -w better-sqlite3` so it matches the Electron binary's Node ABI. If you see "invalid ELF / NODE_MODULE_VERSION mismatch," rerun `npm install` or `npx electron-rebuild`.
- macOS keychain access (for provider OAuth tokens) prompts the user on first read per app identity. Ad-hoc signed builds get a fresh keychain identity on each build → tokens don't persist across DMG versions until you codesign with a stable Developer ID.
