import Database from 'better-sqlite3'
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const DB_PATH = join(CONFIG_DIR, 'checkpoints.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  db = new Database(DB_PATH)
  try { chmodSync(DB_PATH, 0o600) } catch { /* best-effort */ }
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      label TEXT,
      message_count INTEGER NOT NULL,
      messages TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at DESC);
  `)
  return db
}

export interface Checkpoint {
  id: number
  session_id: string
  label: string | null
  message_count: number
  created_at: string
}

export function saveCheckpoint(sessionId: string, messages: ChatCompletionMessageParam[], label?: string): number {
  const r = getDb().prepare(
    `INSERT INTO checkpoints (session_id, label, message_count, messages) VALUES (?, ?, ?, ?)`,
  ).run(sessionId, label ?? null, messages.length, JSON.stringify(messages))
  return Number(r.lastInsertRowid)
}

export function listCheckpoints(sessionId: string, limit = 50): Checkpoint[] {
  return getDb().prepare(
    `SELECT id, session_id, label, message_count, created_at FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).all(sessionId, limit) as Checkpoint[]
}

export function loadCheckpoint(id: number): { checkpoint: Checkpoint; messages: ChatCompletionMessageParam[] } | null {
  const row = getDb().prepare(
    `SELECT id, session_id, label, message_count, messages, created_at FROM checkpoints WHERE id = ?`,
  ).get(id) as (Checkpoint & { messages: string }) | undefined
  if (!row) return null
  let messages: ChatCompletionMessageParam[] = []
  try { messages = JSON.parse(row.messages) } catch { /* fallback to empty */ }
  return {
    checkpoint: { id: row.id, session_id: row.session_id, label: row.label, message_count: row.message_count, created_at: row.created_at },
    messages,
  }
}

export function deleteCheckpoint(id: number): boolean {
  return getDb().prepare(`DELETE FROM checkpoints WHERE id = ?`).run(id).changes > 0
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
