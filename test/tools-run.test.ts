import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

// Same stub as tools-edit.test.ts — edit/run tools never touch the DB.
vi.mock('better-sqlite3', () => ({ default: class MockDatabase {} }))

import { executeTool, TaskTracker } from '../electron/core/tools'

const ctx = () => ({ cwd: tmpdir(), taskTracker: new TaskTracker() })

describe('run_command', () => {
  it('returns command output', async () => {
    const r = await executeTool('run_command', { command: 'echo hello-cmx' }, ctx())
    expect(r).toContain('hello-cmx')
  })

  it('reports failures without throwing', async () => {
    const r = await executeTool('run_command', { command: 'exit 3' }, ctx())
    expect(r).toContain('Command failed')
  })

  it('does NOT block the event loop while a command runs (the app-freeze regression)', async () => {
    // With the old execSync implementation, this timer could not fire until
    // the child exited — the whole main process (all IPC) froze with it.
    const start = Date.now()
    const running = executeTool('run_command', { command: 'sleep 1' }, ctx())
    await new Promise((r) => setTimeout(r, 100))
    const elapsedWhileRunning = Date.now() - start
    expect(elapsedWhileRunning).toBeLessThan(600) // timer fired mid-command
    const out = await running
    expect(out).toBeDefined()
  })
})
