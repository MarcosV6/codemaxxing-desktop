import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const GLOBAL_HOOKS_PATH = join(CONFIG_DIR, 'hooks.json')

export type HookEvent =
  | 'pre-tool' | 'post-tool'
  | 'pre-send' | 'post-response'
  | 'on-error' | 'on-edit' | 'on-commit'
  | 'on-start' | 'on-exit'

export interface Hook {
  id: string
  event: HookEvent
  command: string
  /** Only fire if the tool name (for pre-tool/post-tool/on-edit) matches this glob. */
  toolMatch?: string
  /** Only fire if a touched file path matches this glob (applies to on-edit/post-tool). */
  pathMatch?: string
  /** Timeout in ms (default: 30_000). */
  timeout?: number
  /** Block the agent loop on failure (pre-tool only). */
  blocking?: boolean
  /** Feed stdout back to the agent as additional tool-result context. */
  feedToAgent?: boolean
  /** Whether the hook is enabled. */
  enabled?: boolean
  /** Human-readable label. */
  label?: string
}

export interface HookRunResult {
  hookId: string
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  blocked?: boolean
}

interface HooksFile { hooks: Hook[] }

function loadHooksFile(path: string): Hook[] {
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as HooksFile
    return Array.isArray(data.hooks) ? data.hooks : []
  } catch {
    return []
  }
}

export function loadHooks(cwd: string): Hook[] {
  const global = loadHooksFile(GLOBAL_HOOKS_PATH)
  const project = loadHooksFile(join(cwd, '.codemaxxing', 'hooks.json'))
  return [...global, ...project].filter(h => h.enabled !== false)
}

export function saveGlobalHooks(hooks: Hook[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(GLOBAL_HOOKS_PATH, JSON.stringify({ hooks }, null, 2))
}

export function getGlobalHooks(): Hook[] {
  return loadHooksFile(GLOBAL_HOOKS_PATH)
}

function matchGlob(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§DOUBLE§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§DOUBLE§§/g, '.*')
    .replace(/\?/g, '.')
  const re = new RegExp(`^${escaped}$`, 'i')
  return re.test(value)
}

export async function runHooksForEvent(
  event: HookEvent,
  context: { cwd: string; toolName?: string; args?: Record<string, unknown>; path?: string; payload?: Record<string, unknown> },
): Promise<HookRunResult[]> {
  const hooks = loadHooks(context.cwd).filter(h => h.event === event)
  const results: HookRunResult[] = []
  for (const hook of hooks) {
    if (hook.toolMatch && context.toolName && !matchGlob(hook.toolMatch, context.toolName)) continue
    if (hook.pathMatch && context.path && !matchGlob(hook.pathMatch, context.path)) continue
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      CODEMAXXING_EVENT: event,
      CODEMAXXING_CWD: context.cwd,
      CODEMAXXING_TOOL: context.toolName || '',
      CODEMAXXING_PATH: context.path || '',
      CODEMAXXING_ARGS: context.args ? JSON.stringify(context.args) : '',
      CODEMAXXING_PAYLOAD: context.payload ? JSON.stringify(context.payload) : '',
    }
    const result = await new Promise<HookRunResult>((resolve) => {
      const timeout = hook.timeout ?? 30_000
      // Platform shell: `sh` doesn't exist on Windows — spawning it there
      // failed EVERY hook, and a blocking hook then blocked every tool call.
      const [shell, shellArgs] = process.platform === 'win32'
        ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', hook.command]]
        : ['sh', ['-c', hook.command]]
      const child = execFile(shell, shellArgs, { cwd: context.cwd, env, timeout }, (err, stdout, stderr) => {
        resolve({
          hookId: hook.id,
          ok: !err,
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          exitCode: err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0,
          blocked: !!(err && hook.blocking),
        })
      })
      child.on('error', () => resolve({ hookId: hook.id, ok: false, stdout: '', stderr: 'spawn error', exitCode: 1, blocked: !!hook.blocking }))
    })
    results.push(result)
    if (result.blocked) break
  }
  return results
}
