# Contributing

Thanks for considering a contribution! This doc covers the dev setup, the code-style ground rules, and what to expect from PRs.

If you're here to file a bug or propose a feature, use the issue templates instead — they pre-fill the right info.

## Dev setup

Tested on **Node.js 18+**. macOS, Windows (with WSL2 or native), and Linux all work for development.

```bash
git clone https://github.com/MarcosV6/codemaxxing-desktop.git
cd codemaxxing-desktop
npm install                   # postinstall rebuilds better-sqlite3 against Electron's node ABI
npm run electron:dev          # vite + electron in dev mode
```

That's it — the dev server hot-reloads the renderer; main-process changes restart Electron automatically.

If you don't have an Electron shell handy and just want to poke at the renderer:

```bash
npm run dev                   # vite only — uses src/dev-mocks/electron-browser.ts as a fake IPC layer
```

## Common scripts

| Script | What it does |
|---|---|
| `npm run electron:dev` | Vite dev server + Electron shell (the normal dev command) |
| `npm run dev` | Renderer only (browser + dev-mocks) |
| `npm run build:app` | Build renderer + main + preload (no installer) |
| `npm run typecheck` | `tsc --noEmit` — must stay clean before any PR |
| `npm run lint` | ESLint over `src/` |
| `npm run electron:build:mac` | macOS DMG + zip → `release/` |
| `npm run electron:build:win` | Windows NSIS installer + portable zip → `release/` |
| `npm run electron:build:linux` | Linux AppImage + tar.gz → `release/` |

## Repo layout

```
electron/             Electron main + preload (Node-side)
  main.ts             IPC handlers, window/tray, remote server, auto-launch
  preload.ts          contextBridge → window.electron.*
  core/               Agent runtime, providers, tools, sessions, memory, skills, hooks, MCP, remote server
src/                  Renderer (React + Vite)
  App.tsx             Entry — delegates to Layout
  store/appStore.ts   Single Zustand store — all renderer state
  components/         UI (Layout, Chat, Modals, Preview, Shared)
  dev-mocks/          Browser-only fake IPC for `npm run dev`
  types/              Shared types + electron.d.ts (the IPC contract)
docs/                 Wire protocol + design docs
public/               Static assets (icons go here)
```

`CLAUDE.md` has more architectural notes and is kept current.

## Code style

- **TypeScript strict mode.** `npm run typecheck` must be clean before merging.
- **No emojis in source files** unless the user explicitly requested them. (Markdown docs aimed at humans are fine.)
- **No documentation-only PRs as the first contribution.** Helpful, but we'd rather see a real fix or feature first so we can verify the dev workflow works on your machine.
- **Keep the IPC contract honest.** If you add a new IPC handler in `electron/main.ts`, add the type in `src/types/electron.d.ts` AND add a stub in `src/dev-mocks/electron-browser.ts` so the browser-only dev mode keeps working.
- **Respect the existing `emit()` fan-out helper.** `agent:*` events should go through `emit()` in main.ts (which fans out to both the renderer and the remote API's `agentBus`), not directly through `webContents.send`. Otherwise remote clients miss events.
- **Comments belong on non-obvious code.** Why, not what. Skip "increment x by 1" — explain "we increment here because Anthropic's stream sends an extra terminator on retry."

## Testing

We don't currently ship a test suite (yes, that's a known gap). For now, every PR should include a **manual test plan** in the PR description: what scenarios you exercised, on what platform, with what model. Bonus points for screenshots/screencasts of UI changes.

Adding automated tests is a welcome contribution category — talk to us in an issue first about which subsystem to start with.

## Pull requests

1. Fork, branch off `main`.
2. Make the change. Keep commits focused — small atomic commits beat one giant "fix stuff" commit.
3. `npm run typecheck` must pass.
4. Open the PR. The template will prompt you for a description, change type, test plan, and screenshots if UI.
5. Expect a review with comments. We're not picky about style nits — reviews focus on correctness and architectural fit.

## What kinds of contributions are most welcome

- **Bug fixes for things you actually hit** — these come with a built-in repro
- **Provider / model adapter additions** in `electron/core/agent.ts`
- **Cross-platform fixes** — anything that makes Windows or Linux feel more native
- **Wire-protocol clients** — phone apps, PWAs, CLIs that talk to the remote API. Build them as separate repos but link from this README's docs section
- **Performance** — the agent loop, the IPC fan-out, the renderer paint path

## What's NOT a great first contribution

- Sweeping renames or restructures
- Style/formatting-only PRs
- "Modernize this whole subsystem" PRs without prior discussion in an issue

## License

By contributing, you agree your code is licensed under the project's [MIT license](LICENSE).
