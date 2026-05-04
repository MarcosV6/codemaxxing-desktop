<!--
Thanks for the contribution! Please fill out as much of this as makes sense.
First-time contributors: don't worry about getting every section perfect —
we'll iterate in review.
-->

## Description

<!-- What does this PR do? Why? Link any related issue. -->

Closes #

## Type of change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Refactor (no functional change)
- [ ] Documentation only
- [ ] Build / tooling

## Test plan

<!-- How did you verify this works? Be specific — "I clicked around and it seemed fine" is not a test plan. -->

- [ ] `npm run typecheck` is clean
- [ ] Tested on: <!-- macOS / Windows / Linux + version -->
- [ ] Provider used: <!-- e.g. LM Studio + qwen2.5-coder-32b, Anthropic + claude-sonnet-4-6 -->

**Steps I exercised:**

1.
2.
3.

## Screenshots / screen recording

<!-- Required for any UI change. Drag-and-drop into the editor. Before/after if you can. -->

## Checklist

- [ ] Code follows the conventions in [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] No emojis added to source files (unless explicitly requested)
- [ ] If adding an IPC handler: type added in `src/types/electron.d.ts` AND stub in `src/dev-mocks/electron-browser.ts`
- [ ] If adding a `mainWindow.webContents.send` for an `agent:*` event: routed through the `emit()` fan-out helper
- [ ] No `console.log` debug statements left behind
- [ ] No new `any` types except where unavoidable (and commented if so)

## Notes for the reviewer

<!-- Anything you're unsure about, alternatives you considered, edge cases worth flagging. Optional but useful. -->
