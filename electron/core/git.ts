import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP('git', args, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (e: any) {
    return { stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? String(e?.message ?? e), code: typeof e.code === 'number' ? e.code : 1 }
  }
}

export function isGitRepo(cwd: string): boolean {
  return existsSync(join(cwd, '.git')) || existsSync(join(cwd, '.git/HEAD'))
}

export async function gitStatus(cwd: string): Promise<string> {
  const r = await git(cwd, ['status', '--porcelain=v1', '-b'])
  return r.stdout.trim() || '(clean)'
}

export async function gitDiff(cwd: string, staged = false): Promise<string> {
  const args = staged ? ['diff', '--staged', '--no-color'] : ['diff', '--no-color']
  const r = await git(cwd, args, 30_000)
  return r.stdout || '(no diff)'
}

export async function gitLog(cwd: string, limit = 20): Promise<string> {
  const r = await git(cwd, ['log', `-n`, String(limit), '--pretty=format:%h %ad %s', '--date=short'])
  return r.stdout || '(no history)'
}

export async function gitBranch(cwd: string): Promise<string> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return r.stdout.trim() || 'HEAD'
}

export async function gitStageAll(cwd: string): Promise<string> {
  const r = await git(cwd, ['add', '-A'])
  return r.code === 0 ? 'Staged all changes.' : `git add failed: ${r.stderr}`
}

export async function gitStage(cwd: string, paths: string[]): Promise<string> {
  if (paths.length === 0) return 'No paths provided.'
  const r = await git(cwd, ['add', '--', ...paths])
  return r.code === 0 ? `Staged: ${paths.join(', ')}` : `git add failed: ${r.stderr}`
}

export async function gitCommit(cwd: string, message: string, allowEmpty = false): Promise<string> {
  const args = ['commit', '-m', message]
  if (allowEmpty) args.push('--allow-empty')
  const r = await git(cwd, args, 60_000)
  return r.code === 0 ? r.stdout.trim() : `git commit failed: ${r.stderr || r.stdout}`
}

export async function gitPush(cwd: string, remote = 'origin', branch?: string): Promise<string> {
  const args = ['push', remote]
  if (branch) args.push(branch)
  const r = await git(cwd, args, 60_000)
  return r.code === 0 ? (r.stdout + r.stderr).trim() : `git push failed: ${r.stderr}`
}

export async function gitUndo(cwd: string): Promise<string> {
  const r = await git(cwd, ['reset', '--soft', 'HEAD~1'])
  return r.code === 0 ? 'Reset HEAD to HEAD~1 (changes preserved as staged).' : `git undo failed: ${r.stderr}`
}

export async function gitCurrentCommit(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', 'HEAD'])
  return r.code === 0 ? r.stdout.trim() : null
}

export interface GitSummary {
  isRepo: boolean
  branch?: string
  status?: string
  staged?: number
  modified?: number
  untracked?: number
}

export async function gitSummary(cwd: string): Promise<GitSummary> {
  if (!isGitRepo(cwd)) return { isRepo: false }
  const [branch, status] = await Promise.all([gitBranch(cwd), gitStatus(cwd)])
  let staged = 0, modified = 0, untracked = 0
  for (const line of status.split('\n')) {
    if (!line.trim() || line.startsWith('##')) continue
    const x = line.charAt(0), y = line.charAt(1)
    if (x !== ' ' && x !== '?') staged++
    if (y === 'M' || y === 'D') modified++
    if (x === '?' && y === '?') untracked++
  }
  return { isRepo: true, branch, status, staged, modified, untracked }
}
