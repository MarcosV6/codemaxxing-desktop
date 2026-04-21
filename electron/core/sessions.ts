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
  return db
}

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
}

export function createSession(cwd: string, provider: string, model: string, title?: string): string {
  const id = generateId()
  getDb()
    .prepare(`INSERT INTO sessions (id, title, cwd, provider, model) VALUES (?, ?, ?, ?, ?)`)
    .run(id, title || null, cwd, provider, model)
  return id
}

export function updateSessionTitle(sessionId: string, title: string): void {
  getDb().prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run(title, sessionId)
}

export function updateSessionModel(sessionId: string, provider: string, model: string): void {
  getDb().prepare(`UPDATE sessions SET provider = ?, model = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(provider, model, sessionId)
}

export function updateSessionCwd(sessionId: string, cwd: string): void {
  getDb().prepare(`UPDATE sessions SET cwd = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(cwd, sessionId)
}

export function saveMessage(sessionId: string, message: ChatCompletionMessageParam): void {
  const d = getDb()
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  const toolCalls = 'tool_calls' in message && message.tool_calls ? JSON.stringify(message.tool_calls) : null
  const toolCallId = 'tool_call_id' in message ? (message as any).tool_call_id : null
  const tx = d.transaction(() => {
    d.prepare(`INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)`)
      .run(sessionId, message.role, content, toolCalls, toolCallId)
    const row = d.prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ?`).get(sessionId) as { c: number }
    d.prepare(`UPDATE sessions SET updated_at = datetime('now'), message_count = ? WHERE id = ?`)
      .run(row.c, sessionId)
  })
  tx()
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

export function listSessions(limit = 100): SessionInfo[] {
  return getDb().prepare(`SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`).all(limit) as SessionInfo[]
}

export function getSession(sessionId: string): SessionInfo | null {
  return (getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionInfo) || null
}

export function deleteSession(sessionId: string): boolean {
  const d = getDb()
  d.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId)
  const result = d.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId)
  return result.changes > 0
}

export function updateSessionCost(sessionId: string, promptTokens: number, completionTokens: number, cost: number): void {
  getDb()
    .prepare(`UPDATE sessions SET prompt_tokens = prompt_tokens + ?, completion_tokens = completion_tokens + ?, estimated_cost = estimated_cost + ? WHERE id = ?`)
    .run(promptTokens, completionTokens, cost, sessionId)
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
