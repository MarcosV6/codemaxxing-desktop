import { spawn, execSync, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

/**
 * Kill a spawned command AND everything it started. `child.kill()` only
 * signals the shell — a `npm run dev` grandchild survives it and squats the
 * port. POSIX: signal the process group (children are spawned detached, so
 * the pid IS the group id). Windows: taskkill /T walks the tree.
 */
export function killTree(pid: number, force: boolean): void {
  if (!pid || pid <= 0) return
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${pid} /T${force ? ' /F' : ''}`, { stdio: 'ignore' }) } catch { /* already gone */ }
  } else {
    const sig = force ? 'SIGKILL' : 'SIGTERM'
    try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* already gone */ } }
  }
}

export interface BackgroundJob {
  id: string
  pid: number
  command: string
  cwd: string
  startedAt: number
  child: ChildProcess
  stdout: string
  stderr: string
  exitCode: number | null
  closed: boolean
}

const jobs = new Map<string, BackgroundJob>()
const MAX_BUFFER = 1_000_000

export function startBackground(command: string, cwd: string): { id: string; pid: number | undefined } {
  const id = randomUUID()
  const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : true
  const child = spawn(command, [], { shell, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const job: BackgroundJob = {
    id,
    pid: child.pid ?? -1,
    command,
    cwd,
    startedAt: Date.now(),
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    closed: false,
  }
  child.stdout?.on('data', (d) => { job.stdout += d.toString('utf-8'); if (job.stdout.length > MAX_BUFFER) job.stdout = job.stdout.slice(-MAX_BUFFER) })
  child.stderr?.on('data', (d) => { job.stderr += d.toString('utf-8'); if (job.stderr.length > MAX_BUFFER) job.stderr = job.stderr.slice(-MAX_BUFFER) })
  child.on('exit', (code) => { job.exitCode = code; job.closed = true })
  jobs.set(id, job)
  child.unref()
  return { id, pid: child.pid }
}

export function readBackground(id: string, sinceBytes = 0): { stdout: string; stderr: string; exitCode: number | null; closed: boolean } | null {
  const job = jobs.get(id)
  if (!job) return null
  return {
    stdout: sinceBytes > 0 ? job.stdout.slice(sinceBytes) : job.stdout,
    stderr: job.stderr,
    exitCode: job.exitCode,
    closed: job.closed,
  }
}

export function killBackground(id: string): boolean {
  const job = jobs.get(id)
  if (!job) return false
  killTree(job.pid, false)
  setTimeout(() => { if (!job.closed) killTree(job.pid, true) }, 2000).unref()
  return true
}

/** Kill every still-running job — called on app quit so agent-started dev
 *  servers don't outlive the app and squat their ports. */
export function killAllBackground(): void {
  for (const job of jobs.values()) {
    if (!job.closed) killTree(job.pid, true)
  }
}

export function listBackground(): Array<Pick<BackgroundJob, 'id' | 'pid' | 'command' | 'cwd' | 'startedAt' | 'exitCode' | 'closed'>> {
  return [...jobs.values()].map(j => ({ id: j.id, pid: j.pid, command: j.command, cwd: j.cwd, startedAt: j.startedAt, exitCode: j.exitCode, closed: j.closed }))
}
