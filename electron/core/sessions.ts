import Database from 'better-sqlite3'
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const DB_PATH = join(CONFIG_DIR, 'sessions.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  db = new Database(DB_PATH)
  try { chmodSync(DB_PATH, 0o600) } catch { /* best-effort */ }
  db.pragma('journal_mode = WAL')
  // NORMAL is durable across app crashes; only sacrifices durability across
  // OS crashes — acceptable trade-off for ~3-5x write throughput on the hot
  // saveMessage path. busy_timeout retries instead of throwing SQLITE_BUSY
  // when WAL writers contend (briefly) with checkpoint reads. foreign_keys
  // turns on the ON DELETE CASCADE we declared in the schema.
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      cwd TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_count INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
  `)

  // ── Migrations: add columns to existing DBs ──
  // SQLite ALTER TABLE ADD COLUMN is idempotent only when it's missing — wrap
  // in a try/catch so a re-run on an already-migrated DB doesn't crash.
  try {
    const cols = (db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>).map(c => c.name)
    if (!cols.includes('mode')) {
      db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'code'`)
    }
  } catch { /* best-effort migration */ }

  return db
}

export type SessionMode = 'code' | 'chat' | 'browser'

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export interface SessionInfo {
  id: string
  title: string | null
  cwd: string
  provider: string
  model: string
  created_at: string
  updated_at: string
  message_count: number
  prompt_tokens: number
  completion_tokens: number
  estimated_cost: number
  /** 'code' (default) — full coding agent. 'chat' — plain LLM chat with web tools only. */
  mode: SessionMode
}

export function createSession(
  cwd: string,
  provider: string,
  model: string,
  title?: string,
  mode: SessionMode = 'code',
): string {
  const id = generateId()
  getDb()
    .prepare(`INSERT INTO sessions (id, title, cwd, provider, model, mode) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, title || null, cwd, provider, model, mode)
  return id
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb().prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run(title, sessionId)
}

export function updateSessionModel(sessionId: string, provider: string, model: string): void {
  getDb().prepare(`UPDATE sessions SET provider = ?, model = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(provider, model, sessionId)
}

export function updateSessionMode(sessionId: string, mode: 'code' | 'chat'): void {
  getDb().prepare(`UPDATE sessions SET mode = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(mode, sessionId)
}

export function updateSessionCwd(sessionId: string, cwd: string): void {
  getDb().prepare(`UPDATE sessions SET cwd = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(cwd, sessionId)
}

// Prepared statements live at module scope so we don't pay parse cost on
// every saveMessage. The returns are lazily initialized on first use after
// `getDb()` runs, which is when the pragmas + schema are applied.
let _stmtInsertMessage: Database.Statement | null = null
let _stmtTouchSession: Database.Statement | null = null
let _stmtSaveMessageTx: ((args: { sessionId: string; role: string; content: string; toolCalls: string | null; toolCallId: string | null }) => void) | null = null

function ensureSaveMessageStatements(): void {
  if (_stmtSaveMessageTx) return
  const d = getDb()
  _stmtInsertMessage = d.prepare(
    `INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)`,
  )
  // Increment message_count in-place rather than re-counting the whole
  // table for the session — saves an O(N) scan on every assistant turn.
  _stmtTouchSession = d.prepare(
    `UPDATE sessions SET updated_at = datetime('now'), message_count = message_count + 1 WHERE id = ?`,
  )
  const insert = _stmtInsertMessage
  const touch = _stmtTouchSession
  _stmtSaveMessageTx = d.transaction((a: { sessionId: string; role: string; content: string; toolCalls: string | null; toolCallId: string | null }) => {
    insert.run(a.sessionId, a.role, a.content, a.toolCalls, a.toolCallId)
    touch.run(a.sessionId)
  })
}

export function saveMessage(sessionId: string, message: ChatCompletionMessageParam): void {
  ensureSaveMessageStatements()
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  const toolCalls = 'tool_calls' in message && message.tool_calls ? JSON.stringify(message.tool_calls) : null
  const toolCallId = 'tool_call_id' in message ? (message as any).tool_call_id : null
  _stmtSaveMessageTx!({ sessionId, role: message.role, content, toolCalls, toolCallId })
}

export function loadMessages(sessionId: string): ChatCompletionMessageParam[] {
  const rows = getDb().prepare(
    `SELECT role, content, tool_calls, tool_call_id FROM messages WHERE session_id = ? ORDER BY id ASC`,
  ).all(sessionId) as Array<{ role: string; content: string | null; tool_calls: string | null; tool_call_id: string | null }>
  return rows.map((row) => {
    let content: any = row.content
    if (typeof content === 'string' && (content.startsWith('[') || content.startsWith('{'))) {
      try { content = JSON.parse(content) } catch { /* keep as string */ }
    }
    const msg: any = { role: row.role, content }
    if (row.tool_calls) {
      try { msg.tool_calls = JSON.parse(row.tool_calls) } catch { /* ignore */ }
    }
    if (row.tool_call_id) msg.tool_call_id = row.tool_call_id
    return msg as ChatCompletionMessageParam
  })
}

function normalizeRow(row: any): SessionInfo {
  return { ...row, mode: (row?.mode === 'chat' ? 'chat' : row?.mode === 'browser' ? 'browser' : 'code') as SessionMode }
}

export function listSessions(limit = 100): SessionInfo[] {
  const rows = getDb().prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`).all(limit) as any[]
  return rows.map(normalizeRow)
}

export function getSession(sessionId: string): SessionInfo | null {
  const row = getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as any
  return row ? normalizeRow(row) : null
}

export function deleteSession(sessionId: string): boolean {
  const d = getDb()
  // Wrap in a transaction so a crash between the two statements can't leave
  // us with orphan messages — and so the row count we return reflects the
  // committed state. With foreign_keys=ON the DELETE on sessions would
  // cascade on its own, but the explicit messages DELETE is kept as
  // belt-and-braces against a future migration that drops the FK.
  const tx = d.transaction((id: string) => {
    d.prepare(`DELETE FROM messages WHERE session_id = ?`).run(id)
    return d.prepare(`DELETE FROM sessions WHERE id = ?`).run(id).changes
  })
  return tx(sessionId) > 0
}

export function updateSessionCost(sessionId: string, promptTokens: number, completionTokens: number, cost: number): void {
  getDb()
    .prepare(`UPDATE sessions SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ?, estimated_cost = estimated_cost + ? WHERE id = ?`)
    .run(promptTokens, completionTokens, cost, sessionId)
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
  // Cached prepared statements hold a reference to the now-closed db.
  // Drop them so the next getDb() rebuild re-prepares against the fresh handle.
  _stmtInsertMessage = null
  _stmtTouchSession = null
  _stmtSaveMessageTx = null
}
