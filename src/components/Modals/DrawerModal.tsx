import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import {
  X, BookmarkCheck, Bot, Clock, Plus, Trash2, Loader2, CheckCircle2,
  AlertCircle, PlayCircle, BookOpen, Cpu, HardDrive, Download,
  StickyNote, ListTodo, Circle, Gauge, Scissors,
} from 'lucide-react'
import type { HardwareProfile, Recommendation, FitClass, PullProgress } from '../../types'

export function DrawerModal() {
  const activeDrawer = useAppStore((s) => s.activeDrawer)
  const setDrawer = useAppStore((s) => s.setDrawer)

  useEffect(() => {
    if (!activeDrawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeDrawer, setDrawer])

  // 'notes' is now a full-page workspace (NotesView), not a drawer.
  if (!activeDrawer || activeDrawer === 'notes') return null

  const titleMap = {
    checkpoints: { title: 'Checkpoints', icon: <BookmarkCheck size={14} /> },
    'bg-agents': { title: 'Background agents', icon: <Bot size={14} /> },
    cron: { title: 'Scheduled tasks', icon: <Clock size={14} /> },
    cookbook: { title: 'Cookbook', icon: <BookOpen size={14} /> },
    notes: { title: 'Notes & Tasks', icon: <StickyNote size={14} /> },
    cockpit: { title: 'Context cockpit', icon: <Gauge size={14} /> },
  } as const
  const meta = titleMap[activeDrawer]

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) setDrawer(null) }}
    >
      <div
        className="h-full w-full max-w-[520px] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--theme-bg)', borderLeft: '1px solid var(--theme-border)' }}
      >
        <div
          className="h-12 flex items-center justify-between px-4 shrink-0"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          <div className="flex items-center gap-2">
            {meta.icon}
            <span className="text-[13px] font-medium tracking-tight">{meta.title}</span>
          </div>
          <button
            onClick={() => setDrawer(null)}
            className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {activeDrawer === 'checkpoints' && <CheckpointsPane />}
          {activeDrawer === 'bg-agents' && <BgAgentsPane />}
          {activeDrawer === 'cron' && <CronPane />}
          {activeDrawer === 'cookbook' && <CookbookPane />}
          {activeDrawer === 'cockpit' && <CockpitPane />}
        </div>
      </div>
    </div>
  )
}

// ── Context cockpit (glass-box: see the model's window + the levers) ─────────
function estimateTokens(m: { content?: string; toolCalls?: Array<{ result?: string | null; diff?: string | null; args?: Record<string, unknown> }> }): number {
  let chars = (m.content || '').length
  for (const t of m.toolCalls || []) {
    chars += (t.result || '').length + (t.diff || '').length + JSON.stringify(t.args || {}).length
  }
  return Math.max(1, Math.round(chars / 4))
}

function CockpitPane() {
  const activeSession = useAppStore((s) => s.activeSession)
  const currentStats = useAppStore((s) => s.currentStats)
  const saveCheckpoint = useAppStore((s) => s.saveCheckpoint)
  const compactSession = useAppStore((s) => s.compactSession)
  const setDrawer = useAppStore((s) => s.setDrawer)
  const [threshold, setThreshold] = useState(0.85)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Pull the real auto-compact threshold (falls back to 0.85).
  useEffect(() => {
    window.electron.config.get()
      .then((r) => { const t = (r?.config as any)?.autoCompactThreshold; if (typeof t === 'number') setThreshold(t) })
      .catch(() => {})
  }, [])

  const messages = activeSession?.messages ?? []
  const rows = useMemo(
    () => messages.map((m) => ({
      id: m.id,
      type: m.type,
      tokens: estimateTokens(m),
      preview: (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    })),
    [messages],
  )

  if (!activeSession) {
    return <div className="text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>Open a session to inspect its context window.</div>
  }

  const windowSize = currentStats?.contextWindow || 128_000
  const windowAssumed = !currentStats?.contextWindow
  const convoTokens = rows.reduce((a, r) => a + r.tokens, 0)
  // Rough fixed overhead for the system prompt + tool schemas (not visible here).
  const overhead = activeSession.mode === 'chat' ? 600 : 3200
  const total = convoTokens + overhead
  const pct = Math.min(100, (total / windowSize) * 100)
  const thresholdPct = threshold * 100
  const overThreshold = pct >= thresholdPct

  const color = (t: string) =>
    t === 'user' ? 'var(--theme-primary)'
      : t === 'assistant' ? 'var(--theme-secondary)'
        : t === 'tool' ? 'var(--theme-tool)'
          : 'var(--theme-error)'

  return (
    <div className="space-y-5">
      {/* Budget gauge */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--theme-muted)' }}>Context window</span>
          <span className="text-[11.5px] font-mono" style={{ color: overThreshold ? 'var(--theme-warning)' : 'var(--theme-text)' }}>
            ~{total.toLocaleString()} / {windowSize.toLocaleString()} ({pct.toFixed(1)}%)
          </span>
        </div>
        <div className="relative h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: overThreshold ? 'var(--theme-warning)' : 'var(--theme-primary)' }} />
          <div className="absolute top-0 bottom-0" style={{ left: `${thresholdPct}%`, width: 2, backgroundColor: 'var(--theme-error)', opacity: 0.75 }} title={`Auto-compacts at ${thresholdPct.toFixed(0)}%`} />
        </div>
        <div className="flex items-center justify-between mt-1 text-[10px]" style={{ color: 'var(--theme-muted)' }}>
          <span>{messages.length} msgs · ~{overhead.toLocaleString()}t instructions/tools{windowAssumed ? ' · window assumed' : ''}</span>
          <span style={{ color: 'var(--theme-error)', opacity: 0.8 }}>compacts at {thresholdPct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Levers */}
      <div className="flex items-center gap-2">
        <button
          onClick={async () => { setBusy('compact'); try { await compactSession(6) } finally { setBusy(null) } }}
          disabled={busy !== null || messages.length < 4}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40"
          style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
          title="Summarize older turns into a fresh session, keeping the last few verbatim"
        >
          {busy === 'compact' ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />} Compact now
        </button>
        <button
          onClick={async () => { setBusy('save'); try { await saveCheckpoint(activeSession.id); setSaved(true); setTimeout(() => setSaved(false), 1800) } finally { setBusy(null) } }}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40"
          style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
          title="Snapshot this session so you can time-travel back to it"
        >
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <BookmarkCheck size={13} />} {saved ? 'Saved!' : 'Checkpoint'}
        </button>
        <button
          onClick={() => setDrawer('checkpoints')}
          className="ml-auto text-[11.5px] underline-offset-2 hover:underline"
          style={{ color: 'var(--theme-muted)' }}
        >
          Time-travel →
        </button>
      </div>

      {/* Per-message breakdown */}
      <div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted)' }}>What&apos;s in the window</div>
        {rows.length === 0 ? (
          <div className="text-[12px] opacity-50" style={{ color: 'var(--theme-muted)' }}>No messages yet.</div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => {
              const rowPct = Math.min(100, (r.tokens / windowSize) * 100)
              return (
                <div key={r.id} className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] uppercase tracking-wider font-mono" style={{ color: color(r.type) }}>{r.type}</span>
                    <span className="text-[10.5px] font-mono" style={{ color: 'var(--theme-muted)' }}>~{r.tokens.toLocaleString()}t · {rowPct < 0.1 ? '<0.1' : rowPct.toFixed(1)}%</span>
                  </div>
                  {r.preview && <div className="text-[11.5px] truncate mb-1" style={{ color: 'var(--theme-text)', opacity: 0.7 }}>{r.preview}</div>}
                  <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)' }}>
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, rowPct)}%`, backgroundColor: color(r.type), opacity: 0.6 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="mt-2 text-[10px]" style={{ color: 'var(--theme-muted)', opacity: 0.7 }}>
          Estimates (~chars/4). The system prompt + tool schemas (~{overhead.toLocaleString()}t) aren&apos;t broken out.
        </div>
      </div>
    </div>
  )
}

// ── Cookbook (local model manager) ──────────────────────────────────────────
interface CookbookData {
  profile: HardwareProfile | null
  recommendations: Recommendation[]
  ollama: { installed: boolean; running: boolean; models: Array<{ name: string; size: number }> }
}

const fmtGb = (gb: number) => (Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`)

function FitBadge({ fit }: { fit: FitClass }) {
  const map = {
    comfortable: { label: 'Fits well', color: 'var(--theme-success)' },
    tight: { label: 'Tight', color: 'var(--theme-warning)' },
    'too-big': { label: 'Heavy', color: 'var(--theme-error)' },
  } as const
  const m = map[fit]
  return (
    <span
      className="text-[9.5px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ color: m.color, backgroundColor: `color-mix(in srgb, ${m.color} 14%, transparent)` }}
    >
      {m.label}
    </span>
  )
}

function CookbookPane() {
  const [data, setData] = useState<CookbookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<Record<string, PullProgress>>({})

  const reload = useCallback(async () => {
    const api = window.electron.cookbook
    const [p, o] = await Promise.all([api.profile(), api.ollama()])
    setData({
      profile: p.ok ? p.profile ?? null : null,
      recommendations: p.ok ? p.recommendations ?? [] : [],
      ollama: { installed: !!o.installed, running: !!o.running, models: o.models ?? [] },
    })
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const unsub = window.electron.cookbook.onPullProgress((pp) => {
      setProgress((prev) => ({ ...prev, [pp.id]: pp }))
      if (pp.done) void reload()
    })
    return unsub
  }, [reload])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] opacity-60">
        <Loader2 size={13} className="animate-spin" /> Scanning your hardware…
      </div>
    )
  }

  const profile = data?.profile
  const ollama = data?.ollama
  const installed = new Set((ollama?.models ?? []).map((m) => m.name))

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3.5" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={14} style={{ color: 'var(--theme-primary)' }} />
          <span className="text-[12.5px] font-medium truncate">{profile?.chip || `${profile?.platform} · ${profile?.arch}`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>
          <span className="flex items-center gap-1"><HardDrive size={11} /> {profile?.totalRamGb ?? '?'} GB RAM</span>
          <span>{profile?.unifiedMemory ? 'Unified memory' : 'Discrete / unknown GPU'}</span>
          <span>~{profile?.vramBudgetGb ?? '?'} GB model budget</span>
        </div>
      </div>

      {!ollama?.installed ? (
        <div className="rounded-lg p-3 text-[12px]" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-warning) 30%, transparent)' }}>
          <div className="font-medium mb-1" style={{ color: 'var(--theme-warning)' }}>Ollama not detected</div>
          <span style={{ color: 'var(--theme-text)' }}>Install Ollama to download &amp; serve local models — grab it from <span className="font-mono">ollama.com</span>, then reopen this panel.</span>
        </div>
      ) : !ollama.running ? (
        <div className="text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>
          Ollama installed but idle — <span className="font-mono">ollama serve</span> starts automatically when you download a model.
        </div>
      ) : (
        <div className="text-[11.5px] flex items-center gap-1.5" style={{ color: 'var(--theme-success)' }}>
          <CheckCircle2 size={12} /> Ollama running · {ollama.models.length} model{ollama.models.length === 1 ? '' : 's'} installed
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-wider opacity-50 mb-2" style={{ color: 'var(--theme-muted)' }}>
          Recommended for your machine
        </div>
        {(data?.recommendations ?? []).length === 0 && (
          <div className="text-[12px] opacity-50" style={{ color: 'var(--theme-muted)' }}>
            Couldn't read your hardware profile — no recommendations to show.
          </div>
        )}
        <div className="space-y-2">
          {(data?.recommendations ?? []).map(({ model, fit }) => {
            const pp = progress[model.id]
            const pulling = !!pp && !pp.done
            const done = installed.has(model.id) || (!!pp?.done && !!pp.ok)
            return (
              <div key={model.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12.5px] font-medium">{model.label}</span>
                      {model.coder && (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ color: 'var(--theme-primary)', backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)' }}>coder</span>
                      )}
                      <FitBadge fit={fit} />
                    </div>
                    <div className="text-[11px] mt-0.5 opacity-70" style={{ color: 'var(--theme-muted)' }}>{model.blurb}</div>
                    <div className="text-[10.5px] mt-1 font-mono opacity-60" style={{ color: 'var(--theme-muted)' }}>
                      {fmtGb(model.sizeGb)} · {model.quant} · {Math.round(model.contextWindow / 1000)}k ctx
                    </div>
                  </div>
                  <div className="shrink-0">
                    {done ? (
                      <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--theme-success)' }}><CheckCircle2 size={13} /> Installed</span>
                    ) : (
                      <button
                        onClick={() => { setProgress((prev) => ({ ...prev, [model.id]: { id: model.id, status: 'Starting…', percent: 0 } })); void window.electron.cookbook.pull(model.id) }}
                        disabled={pulling || !ollama?.installed}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 16%, transparent)', color: 'var(--theme-primary)' }}
                        title={ollama?.installed ? `ollama pull ${model.id}` : 'Install Ollama first'}
                      >
                        {pulling ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        {pulling ? `${pp?.percent ?? 0}%` : 'Download'}
                      </button>
                    )}
                  </div>
                </div>
                {pulling && (
                  <div className="mt-2">
                    <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--theme-border)' }}>
                      <div className="h-full transition-all" style={{ width: `${pp?.percent ?? 0}%`, backgroundColor: 'var(--theme-primary)' }} />
                    </div>
                    {pp?.status && <div className="text-[10px] mt-1 font-mono truncate opacity-60" style={{ color: 'var(--theme-muted)' }}>{pp.status}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Notes & Tasks ──────────────────────────────────────────────────────────
interface NoteRow { id: string; text: string; createdAt: number }
interface TaskRow { id: string; text: string; done: boolean; createdAt: number }

function NotesPane() {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [noteText, setNoteText] = useState('')
  const [taskText, setTaskText] = useState('')

  const reload = useCallback(async () => {
    const r = await window.electron.notes.get()
    if (r.ok) { setNotes(r.notes || []); setTasks(r.tasks || []) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const addNote = async () => { const t = noteText.trim(); if (!t) return; setNoteText(''); await window.electron.notes.addNote(t); void reload() }
  const addTask = async () => { const t = taskText.trim(); if (!t) return; setTaskText(''); await window.electron.notes.addTask(t); void reload() }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] uppercase tracking-wider opacity-50 mb-2 flex items-center gap-1.5" style={{ color: 'var(--theme-muted)' }}>
          <ListTodo size={12} /> Tasks
        </div>
        <div className="flex items-center gap-2 mb-2">
          <input
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addTask() }}
            placeholder="Add a task…"
            className="flex-1 bg-transparent outline-none text-[12.5px] rounded-lg px-2.5 py-2"
            style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
          />
          <button onClick={addTask} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 16%, transparent)', color: 'var(--theme-primary)' }}><Plus size={14} /></button>
        </div>
        <div className="space-y-1">
          {tasks.length === 0 && <div className="text-[12px] opacity-50" style={{ color: 'var(--theme-muted)' }}>No tasks yet.</div>}
          {tasks.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--theme-bg-subtle)' }}>
              <button onClick={async () => { await window.electron.notes.toggleTask(t.id); void reload() }} className="shrink-0">
                {t.done ? <CheckCircle2 size={15} style={{ color: 'var(--theme-success)' }} /> : <Circle size={15} style={{ color: 'var(--theme-muted)' }} />}
              </button>
              <span className={`flex-1 text-[12.5px] ${t.done ? 'line-through opacity-50' : ''}`} style={{ color: 'var(--theme-text)' }}>{t.text}</span>
              <button onClick={async () => { await window.electron.notes.deleteTask(t.id); void reload() }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Delete"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider opacity-50 mb-2 flex items-center gap-1.5" style={{ color: 'var(--theme-muted)' }}>
          <StickyNote size={12} /> Notes
        </div>
        <div className="flex items-center gap-2 mb-2">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addNote() }}
            placeholder="Jot a note…"
            className="flex-1 bg-transparent outline-none text-[12.5px] rounded-lg px-2.5 py-2"
            style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
          />
          <button onClick={addNote} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 16%, transparent)', color: 'var(--theme-primary)' }}><Plus size={14} /></button>
        </div>
        <div className="space-y-1.5">
          {notes.length === 0 && <div className="text-[12px] opacity-50" style={{ color: 'var(--theme-muted)' }}>No notes yet.</div>}
          {notes.map((n) => (
            <div key={n.id} className="group flex items-start gap-2 px-2.5 py-2 rounded-lg" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
              <span className="flex-1 text-[12.5px] whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>{n.text}</span>
              <button onClick={async () => { await window.electron.notes.deleteNote(n.id); void reload() }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 mt-0.5" title="Delete"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Checkpoints ────────────────────────────────────────────────────────────
function CheckpointsPane() {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const checkpoints = useAppStore((s) => s.checkpoints)
  const loadCheckpoints = useAppStore((s) => s.loadCheckpoints)
  const saveCheckpoint = useAppStore((s) => s.saveCheckpoint)
  const restoreCheckpoint = useAppStore((s) => s.restoreCheckpoint)
  const deleteCheckpoint = useAppStore((s) => s.deleteCheckpoint)
  const setDrawer = useAppStore((s) => s.setDrawer)
  const [label, setLabel] = useState('')

  useEffect(() => {
    if (activeSessionId) void loadCheckpoints(activeSessionId)
  }, [activeSessionId, loadCheckpoints])

  if (!activeSessionId) {
    return <div className="text-[12.5px] opacity-60">Open a session to manage checkpoints.</div>
  }

  const save = async () => {
    await saveCheckpoint(activeSessionId, label.trim() || undefined)
    setLabel('')
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
          className="flex-1 text-[12.5px] px-3 py-2 rounded-md outline-none"
          style={{
            backgroundColor: 'var(--theme-bg-subtle)',
            color: 'var(--theme-text)',
            border: '1px solid var(--theme-border)',
          }}
        />
        <button
          onClick={save}
          className="flex items-center gap-1 px-3 py-2 rounded-md text-[12.5px] font-medium"
          style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
        >
          <Plus size={12} /> Save checkpoint
        </button>
      </div>

      {checkpoints.length === 0 ? (
        <div className="text-[12.5px] opacity-60 py-8 text-center rounded-lg" style={{ border: '1px dashed var(--theme-border)' }}>
          No checkpoints yet for this session.
        </div>
      ) : (
        <div className="space-y-2">
          {checkpoints.map((cp) => (
            <div
              key={cp.id}
              className="rounded-lg p-3 flex items-center justify-between gap-3"
              style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
            >
              <div className="min-w-0">
                <div className="text-[13px] truncate">{cp.label || `Checkpoint #${cp.id}`}</div>
                <div className="text-[11px] opacity-60 mt-0.5">
                  {cp.message_count} messages · {formatDate(cp.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={async () => { await restoreCheckpoint(cp.id); setDrawer(null) }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5"
                  style={{ border: '1px solid var(--theme-border)' }}
                  title="Open a read-only view in a fresh session"
                >
                  Restore
                </button>
                <button
                  onClick={() => void deleteCheckpoint(cp.id)}
                  className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100"
                  style={{ color: 'var(--theme-error)' }}
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Background Agents ──────────────────────────────────────────────────────
function BgAgentsPane() {
  const bgAgentList = useAppStore((s) => s.bgAgentList)
  const loadBgAgents = useAppStore((s) => s.loadBgAgents)
  const createBgAgent = useAppStore((s) => s.createBgAgent)
  const deleteBgAgent = useAppStore((s) => s.deleteBgAgent)
  const activeSession = useAppStore((s) => s.activeSession)
  const [form, setForm] = useState({ name: '', prompt: '' })
  const [open, setOpen] = useState(false)

  useEffect(() => { void loadBgAgents() }, [loadBgAgents])

  const submit = async () => {
    if (!activeSession) return
    if (!form.name.trim() || !form.prompt.trim()) return
    await createBgAgent({
      name: form.name.trim(),
      cwd: activeSession.cwd,
      provider: activeSession.provider,
      model: activeSession.model,
      prompt: form.prompt.trim(),
    })
    setForm({ name: '', prompt: '' })
    setOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11.5px] opacity-70">
          Headless runs that execute in the background with the same credentials as the current session.
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/5"
          style={{ border: '1px solid var(--theme-border)' }}
        >
          <Plus size={12} /> New
        </button>
      </div>

      {open && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
        >
          <input
            placeholder="Name (e.g. nightly lint fix)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full text-[12.5px] px-3 py-2 rounded-md outline-none"
            style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
          />
          <textarea
            placeholder="Prompt — describe the task in detail."
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={4}
            className="w-full text-[12.5px] px-3 py-2 rounded-md outline-none resize-y"
            style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
          />
          <div className="text-[11px] opacity-60">
            Runs in {activeSession?.cwd || '—'} with {activeSession?.model || '—'}.
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setOpen(false); setForm({ name: '', prompt: '' }) }}
              className="px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/5"
              style={{ border: '1px solid var(--theme-border)' }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!form.name.trim() || !form.prompt.trim() || !activeSession}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
            >
              Launch
            </button>
          </div>
        </div>
      )}

      {bgAgentList.length === 0 ? (
        <div className="text-[12.5px] opacity-60 py-8 text-center rounded-lg" style={{ border: '1px dashed var(--theme-border)' }}>
          No background agents yet.
        </div>
      ) : (
        <div className="space-y-2">
          {bgAgentList.map((a) => (
            <div
              key={a.id}
              className="rounded-lg p-3"
              style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={a.status} />
                    <span className="text-[13px] font-medium truncate">{a.name}</span>
                  </div>
                  <div className="text-[11px] opacity-60 mt-0.5 truncate font-mono">{a.cwd}</div>
                </div>
                <button
                  onClick={() => void deleteBgAgent(a.id)}
                  className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100"
                  style={{ color: 'var(--theme-error)' }}
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              {(a.result || a.error) && (
                <div
                  className="mt-2 text-[11.5px] whitespace-pre-wrap max-h-[140px] overflow-y-auto font-mono rounded p-2"
                  style={{
                    backgroundColor: 'var(--theme-bg)',
                    color: a.error ? 'var(--theme-error)' : 'var(--theme-muted)',
                    border: '1px solid var(--theme-border)',
                  }}
                >
                  {a.error || a.result}
                </div>
              )}
              <div className="flex items-center justify-between mt-2 text-[11px] opacity-60">
                <span>{formatDate(a.created_at)}</span>
                <span>{a.iterations} iter · {(a.prompt_tokens + a.completion_tokens).toLocaleString()} tok</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': return <Loader2 size={12} className="animate-spin" style={{ color: 'var(--theme-primary)' }} />
    case 'done': return <CheckCircle2 size={12} style={{ color: 'var(--theme-success)' }} />
    case 'error': return <AlertCircle size={12} style={{ color: 'var(--theme-error)' }} />
    case 'cancelled': return <X size={12} style={{ color: 'var(--theme-muted)' }} />
    default: return <PlayCircle size={12} style={{ color: 'var(--theme-muted)' }} />
  }
}

// ── Scheduled tasks ────────────────────────────────────────────────────────
function CronPane() {
  const cronTasks = useAppStore((s) => s.cronTasks)
  const loadCronTasks = useAppStore((s) => s.loadCronTasks)
  const createCronTask = useAppStore((s) => s.createCronTask)
  const updateCronTask = useAppStore((s) => s.updateCronTask)
  const deleteCronTask = useAppStore((s) => s.deleteCronTask)
  const activeSession = useAppStore((s) => s.activeSession)
  const [form, setForm] = useState({ name: '', schedule: '0 9 * * *', prompt: '' })
  const [open, setOpen] = useState(false)

  useEffect(() => { void loadCronTasks() }, [loadCronTasks])

  const submit = async () => {
    if (!activeSession) return
    if (!form.name.trim() || !form.prompt.trim() || !form.schedule.trim()) return
    await createCronTask({
      name: form.name.trim(),
      schedule: form.schedule.trim(),
      cwd: activeSession.cwd,
      provider: activeSession.provider,
      model: activeSession.model,
      prompt: form.prompt.trim(),
    })
    setForm({ name: '', schedule: '0 9 * * *', prompt: '' })
    setOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11.5px] opacity-70">
          Cron-triggered background runs. Schedule uses 5-field cron (<span className="font-mono">min hr dom mon dow</span>).
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/5"
          style={{ border: '1px solid var(--theme-border)' }}
        >
          <Plus size={12} /> New
        </button>
      </div>

      {open && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
        >
          <input
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full text-[12.5px] px-3 py-2 rounded-md outline-none"
            style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
          />
          <input
            placeholder="Schedule (cron: 0 9 * * *)"
            value={form.schedule}
            onChange={(e) => setForm({ ...form, schedule: e.target.value })}
            className="w-full text-[12.5px] font-mono px-3 py-2 rounded-md outline-none"
            style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
          />
          <textarea
            placeholder="Prompt"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={4}
            className="w-full text-[12.5px] px-3 py-2 rounded-md outline-none resize-y"
            style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setOpen(false); setForm({ name: '', schedule: '0 9 * * *', prompt: '' }) }}
              className="px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/5"
              style={{ border: '1px solid var(--theme-border)' }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!form.name.trim() || !form.prompt.trim() || !form.schedule.trim() || !activeSession}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-40"
              style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
            >
              Schedule
            </button>
          </div>
        </div>
      )}

      {cronTasks.length === 0 ? (
        <div className="text-[12.5px] opacity-60 py-8 text-center rounded-lg" style={{ border: '1px dashed var(--theme-border)' }}>
          No scheduled tasks yet.
        </div>
      ) : (
        <div className="space-y-2">
          {cronTasks.map((t) => (
            <div
              key={t.id}
              className="rounded-lg p-3"
              style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{t.name}</div>
                  <div className="text-[11px] opacity-70 mt-0.5 font-mono">{t.schedule}</div>
                </div>
                <div className="flex items-center gap-1">
                  <label className="flex items-center gap-1 text-[11px] opacity-70">
                    <input
                      type="checkbox"
                      checked={!!t.enabled}
                      onChange={(e) => void updateCronTask(t.id, { enabled: e.target.checked ? 1 : 0 })}
                    />
                    enabled
                  </label>
                  <button
                    onClick={() => void deleteCronTask(t.id)}
                    className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100"
                    style={{ color: 'var(--theme-error)' }}
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div
                className="mt-2 text-[11.5px] whitespace-pre-wrap max-h-[80px] overflow-y-auto opacity-80"
                style={{ color: 'var(--theme-muted)' }}
              >
                {t.prompt}
              </div>
              <div className="text-[11px] opacity-60 mt-2">
                {t.last_run ? `Last run: ${formatDate(t.last_run)}${t.last_status ? ` — ${t.last_status}` : ''}` : 'Never run'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
