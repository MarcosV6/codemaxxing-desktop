import Database from 'better-sqlite3'
import { existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const DB_PATH = join(CONFIG_DIR, 'memory.db')

export type MemoryType = 'user' | 'project' | 'feedback' | 'reference' | 'preference' | 'fact'

export interface Memory {
  id: number
  type: MemoryType
  key: string
  content: string
  scope: string | null
  importance: number
  created_at: string
  updated_at: string
  expires_at: string | null
}

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  db = new Database(DB_PATH)
  try { chmodSync(DB_PATH, 0o600) } catch { /* best-effort */ }
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      key,
      type UNINDEXED,
      content='memories',
      content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, key, type) VALUES (new.id, new.content, new.key, new.type);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, key, type) VALUES ('delete', old.id, old.content, old.key, old.type);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, key, type) VALUES ('delete', old.id, old.content, old.key, old.type);
      INSERT INTO memories_fts(rowid, content, key, type) VALUES (new.id, new.content, new.key, new.type);
    END;
  `)
  return db
}

export interface RememberOptions {
  scope?: string | null
  importance?: number
  expiresAt?: string | null
}

export function remember(type: MemoryType, key: string, content: string, opts: RememberOptions = {}): number {
  const d = getDb()
  const existing = d.prepare(`SELECT id FROM memories WHERE type = ? AND key = ? AND (scope IS ? OR scope = ?)`)
    .get(type, key, opts.scope ?? null, opts.scope ?? null) as { id: number } | undefined
  if (existing) {
    d.prepare(`UPDATE memories SET content = ?, importance = ?, updated_at = datetime('now'), expires_at = ? WHERE id = ?`)
      .run(content, opts.importance ?? 0.5, opts.expiresAt ?? null, existing.id)
    return existing.id
  }
  const r = d.prepare(`INSERT INTO memories (type, key, content, scope, importance, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(type, key, content, opts.scope ?? null, opts.importance ?? 0.5, opts.expiresAt ?? null)
  return Number(r.lastInsertRowid)
}

export function forget(id: number): boolean {
  const r = getDb().prepare(`DELETE FROM memories WHERE id = ?`).run(id)
  return r.changes > 0
}

export function forgetByKey(type: MemoryType, key: string, scope?: string | null): number {
  const r = getDb().prepare(`DELETE FROM memories WHERE type = ? AND key = ? AND (scope IS ? OR scope = ?)`)
    .run(type, key, scope ?? null, scope ?? null)
  return r.changes
}

export function recall(query: string, type?: MemoryType, scope?: string | null, limit = 10): Memory[] {
  const d = getDb()
  if (!query || query.trim() === '') {
    const whereParts: string[] = []
    const params: any[] = []
    if (type) { whereParts.push(`type = ?`); params.push(type) }
    if (scope !== undefined) { whereParts.push(`(scope IS ? OR scope = ?)`); params.push(scope ?? null, scope ?? null) }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    return d.prepare(`SELECT * FROM memories ${where} ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(...params, limit) as Memory[]
  }
  // Strip FTS5 operators: prefix/phrase/near are fine, but bare punctuation breaks
  const safeQuery = query.replace(/["]/g, '').trim()
  try {
    const rows = d.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts f ON f.rowid = m.id
      WHERE memories_fts MATCH ?
      ${type ? `AND m.type = ?` : ''}
      ${scope !== undefined ? `AND (m.scope IS ? OR m.scope = ?)` : ''}
      ORDER BY rank, m.importance DESC LIMIT ?
    `).all(...[safeQuery, type, scope !== undefined ? scope : undefined, scope !== undefined ? scope : undefined, limit].filter(v => v !== undefined))
    return rows as Memory[]
  } catch {
    // Fallback to LIKE search if FTS5 query fails (e.g., malformed operators)
    const whereParts: string[] = [`(content LIKE ? OR key LIKE ?)`]
    const like = `%${safeQuery}%`
    const params: any[] = [like, like]
    if (type) { whereParts.push(`type = ?`); params.push(type) }
    if (scope !== undefined) { whereParts.push(`(scope IS ? OR scope = ?)`); params.push(scope ?? null, scope ?? null) }
    return d.prepare(`SELECT * FROM memories WHERE ${whereParts.join(' AND ')} ORDER BY importance DESC LIMIT ?`)
      .all(...params, limit) as Memory[]
  }
}

export function listAll(type?: MemoryType, scope?: string | null): Memory[] {
  const d = getDb()
  const whereParts: string[] = []
  const params: any[] = []
  if (type) { whereParts.push(`type = ?`); params.push(type) }
  if (scope !== undefined) { whereParts.push(`(scope IS ? OR scope = ?)`); params.push(scope ?? null, scope ?? null) }
  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
  return d.prepare(`SELECT * FROM memories ${where} ORDER BY type, importance DESC, updated_at DESC`).all(...params) as Memory[]
}

export function getById(id: number): Memory | null {
  return (getDb().prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Memory) || null
}

export function stats(): { total: number; byType: Record<string, number> } {
  const d = getDb()
  const total = (d.prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }).c
  const rows = d.prepare(`SELECT type, COUNT(*) as c FROM memories GROUP BY type`).all() as Array<{ type: string; c: number }>
  const byType: Record<string, number> = {}
  for (const r of rows) byType[r.type] = r.c
  return { total, byType }
}

/** Build a condensed memory-context block to inject into the system prompt. */
export function buildMemoryContext(scope?: string | null, maxChars = 4000): string | null {
  const d = getDb()
  const rows = d.prepare(`
    SELECT * FROM memories
    WHERE (scope IS NULL OR scope = ?)
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY importance DESC, updated_at DESC
    LIMIT 40
  `).all(scope ?? null) as Memory[]
  if (rows.length === 0) return null
  const grouped: Record<string, Memory[]> = {}
  for (const m of rows) (grouped[m.type] ||= []).push(m)
  const parts: string[] = []
  for (const [type, mems] of Object.entries(grouped)) {
    parts.push(`### ${type}`)
    for (const m of mems) {
      const content = m.content.length > 250 ? m.content.slice(0, 250) + '…' : m.content
      parts.push(`- **${m.key}**: ${content}`)
    }
  }
  const full = parts.join('\n')
  return full.length > maxChars ? full.slice(0, maxChars) + '\n…(truncated)' : full
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
