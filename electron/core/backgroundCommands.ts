import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

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
  try { job.child.kill('SIGTERM') } catch { /* ignore */ }
  setTimeout(() => { try { job.child.kill('SIGKILL') } catch { /* ignore */ } }, 2000).unref()
  return true
}

export function listBackground(): Array<Pick<BackgroundJob, 'id' | 'pid' | 'command' | 'cwd' | 'startedAt' | 'exitCode' | 'closed'>> {
  return [...jobs.values()].map(j => ({ id: j.id, pid: j.pid, command: j.command, cwd: j.cwd, startedAt: j.startedAt, exitCode: j.exitCode, closed: j.closed }))
}
