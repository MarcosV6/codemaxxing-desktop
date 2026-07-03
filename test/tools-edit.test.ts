import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// memory.ts loads the better-sqlite3 native binding at import; it's built for
// Electron's ABI, so stub it out — edit_file never touches the DB anyway.
vi.mock('better-sqlite3', () => ({ default: class MockDatabase {} }))

import { executeTool, TaskTracker } from '../electron/core/tools'

let dir: string
const ctx = () => ({ cwd: dir, taskTracker: new TaskTracker() })
const edit = (args: Record<string, unknown>) => executeTool('edit_file', args, ctx())

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cmx-edit-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('edit_file', () => {
  it('replaces exact text and returns a diff', async () => {
    writeFileSync(join(dir, 'a.ts'), 'const x = 1\nconst y = 2\n')
    const r = await edit({ path: 'a.ts', oldText: 'const y = 2', newText: 'const y = 3' })
    expect(r).toContain('✅ Edited a.ts (1 replacement)')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('const x = 1\nconst y = 3\n')
  })

  it('rejects ambiguous exact matches without replaceAll', async () => {
    writeFileSync(join(dir, 'a.ts'), 'foo()\nbar()\nfoo()\n')
    const r = await edit({ path: 'a.ts', oldText: 'foo()', newText: 'baz()' })
    expect(r).toContain('matches 2 locations')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('foo()\nbar()\nfoo()\n') // untouched
  })

  it('replaceAll replaces every exact match', async () => {
    writeFileSync(join(dir, 'a.ts'), 'foo()\nbar()\nfoo()\n')
    const r = await edit({ path: 'a.ts', oldText: 'foo()', newText: 'baz()', replaceAll: true })
    expect(r).toContain('2 replacements')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('baz()\nbar()\nbaz()\n')
  })

  it('falls back to trailing-whitespace-tolerant matching', async () => {
    // File has trailing spaces the model's copy won't include — the #1
    // real-world cause of exact-match failures.
    writeFileSync(join(dir, 'a.ts'), 'function f() {  \n  return 1\t\n}\n')
    const r = await edit({ path: 'a.ts', oldText: 'function f() {\n  return 1\n}', newText: 'function f() {\n  return 2\n}' })
    expect(r).toContain('trailing-whitespace tolerance')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe('function f() {\n  return 2\n}\n')
  })

  it('errors on ambiguous whitespace-tolerant matches instead of guessing', async () => {
    // Trailing whitespace breaks the exact substring match; the tolerant
    // line-window search then finds TWO candidates — must refuse, not guess.
    const original = 'x = 1  \ny\nz\nx = 1\t\ny\n'
    writeFileSync(join(dir, 'a.ts'), original)
    const r = await edit({ path: 'a.ts', oldText: 'x = 1\ny', newText: 'x = 9\ny' })
    expect(r).toContain('2 candidate locations')
    expect(readFileSync(join(dir, 'a.ts'), 'utf-8')).toBe(original) // untouched
  })

  it('tells the model to re-read when nothing matches at all', async () => {
    writeFileSync(join(dir, 'a.ts'), 'const x = 1\n')
    const r = await edit({ path: 'a.ts', oldText: 'const z = 42', newText: 'const z = 43' })
    expect(r).toContain('call read_file again')
  })
})
