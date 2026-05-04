import Database from 'better-sqlite3'
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const DB_PATH = join(CONFIG_DIR, 'cron.db')

export interface ScheduledTask {
  id: string
  name: string
  schedule: string // cron expression
  cwd: string
  provider: string
  model: string
  prompt: string
  enabled: number
  last_run: string | null
  last_status: string | null
  created_at: string
  updated_at: string
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  db = new Database(DB_PATH)
  try { chmodSync(DB_PATH, 0o600) } catch { /* best-effort */ }
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      cwd TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  return db
}

function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'sch_'
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

/**
 * Minimal 5-field cron (minute hour day-of-month month day-of-week).
 * Supports: *, a single integer, comma-separated list, a/step, or range.
 * Returns true when `now` matches the expression.
 */
export function cronMatches(expr: string, now = new Date()): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [min, hour, dom, mon, dow] = parts
  return (
    matchField(min, now.getMinutes(), 0, 59) &&
    matchField(hour, now.getHours(), 0, 23) &&
    matchField(dom, now.getDate(), 1, 31) &&
    matchField(mon, now.getMonth() + 1, 1, 12) &&
    matchField(dow, now.getDay(), 0, 6)
  )
}

function matchField(field: string, value: number, lo: number, hi: number): boolean {
  if (field === '*') return true
  for (const piece of field.split(',')) {
    if (piece === '*') return true
    let step = 1
    let rangeStr = piece
    if (piece.includes('/')) {
      const [r, s] = piece.split('/')
      rangeStr = r
      step = parseInt(s, 10) || 1
    }
    let from = lo, to = hi
    if (rangeStr !== '*') {
      if (rangeStr.includes('-')) {
        const [a, b] = rangeStr.split('-').map(v => parseInt(v, 10))
        if (Number.isNaN(a) || Number.isNaN(b)) continue
        from = a; to = b
      } else {
        const v = parseInt(rangeStr, 10)
        if (Number.isNaN(v)) continue
        from = v; to = v
      }
    }
    for (let v = from; v <= to; v += step) {
      if (v === value) return true
    }
  }
  return false
}

export function createScheduledTask(opts: {
  name: string
  schedule: string
  cwd: string
  provider: string
  model: string
  prompt: string
}): string {
  if (!cronMatches(opts.schedule, new Date()) && opts.schedule.trim().split(/\s+/).length !== 5) {
    throw new Error(`Invalid cron expression: ${opts.schedule}`)
  }
  const id = genId()
  getDb().prepare(
    `INSERT INTO scheduled_tasks (id, name, schedule, cwd, provider, model, prompt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, opts.name, opts.schedule, opts.cwd, opts.provider, opts.model, opts.prompt)
  return id
}

export function updateScheduledTask(id: string, patch: Partial<Omit<ScheduledTask, 'id' | 'created_at' | 'updated_at'>>): boolean {
  const fields: string[] = []
  const params: any[] = []
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`)
    params.push(v)
  }
  if (fields.length === 0) return false
  fields.push(`updated_at = datetime('now')`)
  const r = getDb().prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params, id)
  return r.changes > 0
}

export function listScheduledTasks(): ScheduledTask[] {
  return getDb().prepare(`SELECT * FROM scheduled_tasks ORDER BY updated_at DESC`).all() as ScheduledTask[]
}

export function getScheduledTask(id: string): ScheduledTask | null {
  return (getDb().prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id) as ScheduledTask) || null
}

export function deleteScheduledTask(id: string): boolean {
  return getDb().prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id).changes > 0
}

export function markRun(id: string, status: string): void {
  getDb().prepare(
    `UPDATE scheduled_tasks SET last_run = datetime('now'), last_status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, id)
}

export function dueTasks(now = new Date()): ScheduledTask[] {
  return listScheduledTasks().filter(t => t.enabled === 1 && cronMatches(t.schedule, now))
}

let tickerTimer: NodeJS.Timeout | null = null
let lastTickMinute = -1

export function startTicker(onDue: (task: ScheduledTask) => void): void {
  if (tickerTimer) return
  const tick = () => {
    const now = new Date()
    const currentMinute = now.getHours() * 60 + now.getMinutes()
    if (currentMinute === lastTickMinute) return
    lastTickMinute = currentMinute
    const due = dueTasks(now)
    for (const t of due) onDue(t)
  }
  // Check every 20 seconds, dedup per minute
  tickerTimer = setInterval(tick, 20_000)
  tick()
}

export function stopTicker(): void {
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null }
}

export function closeDb(): void {
  stopTicker()
  if (db) { db.close(); db = null }
}
