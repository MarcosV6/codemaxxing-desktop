import Database from 'better-sqlite3'
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const DB_PATH = join(CONFIG_DIR, 'background.db')

export type BackgroundAgentStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface BackgroundAgent {
  id: string
  name: string
  cwd: string
  provider: string
  model: string
  prompt: string
  status: BackgroundAgentStatus
  result: string | null
  error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
  iterations: number
  prompt_tokens: number
  completion_tokens: number
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
    CREATE TABLE IF NOT EXISTS background_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      result TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      iterations INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bg_status ON background_agents(status);
  `)
  return db
}

function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'bg_'
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function createBackgroundAgent(opts: {
  name: string
  cwd: string
  provider: string
  model: string
  prompt: string
}): string {
  const id = genId()
  getDb().prepare(
    `INSERT INTO background_agents (id, name, cwd, provider, model, prompt) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, opts.name, opts.cwd, opts.provider, opts.model, opts.prompt)
  return id
}

export function markRunning(id: string): void {
  getDb().prepare(
    `UPDATE background_agents SET status = 'running', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(id)
}

export function markDone(id: string, result: string, usage: { iterations: number; promptTokens: number; completionTokens: number }): void {
  getDb().prepare(
    `UPDATE background_agents SET status = 'done', result = ?, finished_at = datetime('now'), updated_at = datetime('now'),
     iterations = ?, prompt_tokens = ?, completion_tokens = ? WHERE id = ?`,
  ).run(result, usage.iterations, usage.promptTokens, usage.completionTokens, id)
}

export function markError(id: string, error: string): void {
  getDb().prepare(
    `UPDATE background_agents SET status = 'error', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(error, id)
}

export function markCancelled(id: string): void {
  getDb().prepare(
    `UPDATE background_agents SET status = 'cancelled', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(id)
}

export function getBackgroundAgent(id: string): BackgroundAgent | null {
  return (getDb().prepare(`SELECT * FROM background_agents WHERE id = ?`).get(id) as BackgroundAgent) || null
}

export function listBackgroundAgents(limit = 100): BackgroundAgent[] {
  return getDb().prepare(`SELECT * FROM background_agents ORDER BY updated_at DESC LIMIT ?`).all(limit) as BackgroundAgent[]
}

export function deleteBackgroundAgent(id: string): boolean {
  return getDb().prepare(`DELETE FROM background_agents WHERE id = ?`).run(id).changes > 0
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
