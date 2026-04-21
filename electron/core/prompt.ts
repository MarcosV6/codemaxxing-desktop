import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { buildSkillsPrompt } from './skills.js'
import { buildMemoryContext } from './memory.js'

const BASE_PROMPT = `You are CODEMAXXING, an AI coding assistant running in a Mac desktop app.

You help developers understand, write, debug, and refactor code. You have access to tools that let you read files, write files, list directories, search code, and run shell commands.

## Rules
- Always read relevant files before making changes
- Explain what you're about to do before doing it
- When writing files, show the user what will change
- Be concise but thorough
- If you're unsure, ask — don't guess
- Use the run_command tool for building, testing, and linters
- Use write_file/edit_file for project files; do not scaffold source files with shell heredocs, echo redirection, or tee
- If the user asks you to run, preview, serve, launch, or verify an app, you must actually do it with tools and report the real result
- For long-running dev servers, use run_background_command and report the PID plus any detected URL/port or startup output
- Never claim something is running, installed, or working unless command output confirmed it
- Never delete files without explicit confirmation

## Task Progress
When working on multi-step tasks, use create_task and update_task to show the user a live progress checklist. Create tasks at the start, mark them in_progress as you work, and completed when done. This helps the user see what you're doing. Only use for multi-step work (3+ steps), not simple questions.
Tasks are only progress indicators, not proof that work is complete.

## Editing Strategy
- Prefer edit_file for small or localized changes — use it when you only need to change part of a file.
- edit_file requires the exact text to be found in the file, so read the file first to confirm the exact content.
- Use write_file only when creating a new file or when the changes affect most of the file.
- When in doubt about scope, prefer edit_file — it is safer and easier to review.

## Tool-Calling Behavior
- Do not narrate before every tool call. If the next action is obvious, call the tool directly.
- Do not repeat the same status update across tool turns.
- Only give a pre-tool note when it adds new information, and keep it to one short sentence.

## Behavior
- Respond in markdown
- Use code blocks with language tags
- Be direct and helpful
- If the user asks to "just do it", skip explanations and execute`

export interface SystemPromptOptions {
  cwd: string
  includeRepoMap?: boolean
  activeSkillIds?: string[]
  memoryScope?: string | null
  includeMemory?: boolean
}

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const parts = [BASE_PROMPT]

  const rules = loadProjectRules(opts.cwd)
  if (rules) parts.push(`\n## Project Rules\n${rules}`)

  if (opts.activeSkillIds && opts.activeSkillIds.length > 0) {
    const skills = buildSkillsPrompt(opts.activeSkillIds)
    if (skills) parts.push(`\n## Active Skill Packs\n${skills}`)
  }

  if (opts.includeMemory !== false) {
    try {
      const mem = buildMemoryContext(opts.memoryScope ?? null, 3000)
      if (mem) parts.push(`\n## Memory (from prior sessions)\n${mem}`)
    } catch { /* memory module may not be initialized */ }
  }

  if (opts.includeRepoMap !== false) {
    const map = buildRepoMap(opts.cwd)
    if (map) parts.push(`\n## Project Context\nWorking directory: ${opts.cwd}\n\n${map}`)
  } else {
    parts.push(`\n## Project Context\nWorking directory: ${opts.cwd}`)
  }

  return parts.join('\n')
}

function loadProjectRules(cwd: string): string | null {
  const candidates = [
    join(cwd, 'CODEMAXXING.md'),
    join(cwd, '.codemaxxing', 'CODEMAXXING.md'),
    join(cwd, '.cursorrules'),
    join(cwd, 'CLAUDE.md'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8').trim()
        if (content.length > 0) return content.slice(0, 8000)
      } catch { /* ignore */ }
    }
  }
  return null
}

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', '.next', '__pycache__',
  'release', 'build', '.cache', '.turbo', 'coverage', '.vscode', '.idea',
])

function buildRepoMap(cwd: string, maxEntries = 80): string | null {
  const entries: string[] = []
  function walk(dir: string, depth: number) {
    if (depth > 3 || entries.length >= maxEntries) return
    let items
    try { items = readdirSync(dir) } catch { return }
    items.sort()
    for (const name of items) {
      if (name.startsWith('.') && name !== '.env.example') continue
      if (IGNORE.has(name)) continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      const rel = relative(cwd, full)
      if (st.isDirectory()) {
        entries.push(`${'  '.repeat(depth)}${rel}/`)
        walk(full, depth + 1)
      } else {
        entries.push(`${'  '.repeat(depth)}${rel}`)
      }
      if (entries.length >= maxEntries) return
    }
  }
  try { walk(cwd, 0) } catch { return null }
  if (entries.length === 0) return null
  const truncated = entries.length >= maxEntries ? `\n... (truncated, showing first ${maxEntries})` : ''
  return entries.join('\n') + truncated
}
