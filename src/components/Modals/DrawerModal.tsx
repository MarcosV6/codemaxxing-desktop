import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import {
  X, BookmarkCheck, Bot, Clock, Plus, Trash2, Loader2, CheckCircle2,
  AlertCircle, PlayCircle,
} from 'lucide-react'

export function DrawerModal() {
  const activeDrawer = useAppStore((s) => s.activeDrawer)
  const setDrawer = useAppStore((s) => s.setDrawer)

  useEffect(() => {
    if (!activeDrawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeDrawer, setDrawer])

  if (!activeDrawer) return null

  const titleMap = {
    checkpoints: { title: 'Checkpoints', icon: <BookmarkCheck size={14} /> },
    'bg-agents': { title: 'Background agents', icon: <Bot size={14} /> },
    cron: { title: 'Scheduled tasks', icon: <Clock size={14} /> },
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
