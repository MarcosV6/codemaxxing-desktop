import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { WorkspaceAssistant } from './WorkspaceAssistant'
import { PAD_TRAFFIC_80 } from '../../utils/platform'
import { ArrowLeft, Plus, Trash2, CheckSquare, Square } from 'lucide-react'

interface Note { id: string; text: string; createdAt: number }
interface Task { id: string; text: string; done: boolean; createdAt: number }

/**
 * Notes & Tasks as a full-page workspace: quick-capture notes + a task list as
 * the main page, the agent assistant docked on the right. The assistant can add
 * notes/tasks via note_* / task_* tools; the page reloads on notes:changed.
 */
export function NotesView({ onNewSession }: { onNewSession: () => void }) {
  const setDrawer = useAppStore((s) => s.setDrawer)
  const [notes, setNotes] = useState<Note[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [taskDraft, setTaskDraft] = useState('')

  const load = useCallback(async () => {
    const r = await window.electron.notes.get()
    if (r.ok) { setNotes(r.notes || []); setTasks(r.tasks || []) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => window.electron.notes.onChanged(() => void load()), [load])

  const addNote = async () => { const t = noteDraft.trim(); if (!t) return; setNoteDraft(''); await window.electron.notes.addNote(t); void load() }
  const addTask = async () => { const t = taskDraft.trim(); if (!t) return; setTaskDraft(''); await window.electron.notes.addTask(t); void load() }
  const toggleTask = async (id: string) => { await window.electron.notes.toggleTask(id); void load() }
  const delNote = async (id: string) => { await window.electron.notes.deleteNote(id); void load() }
  const delTask = async (id: string) => { await window.electron.notes.deleteTask(id); void load() }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 340 }}>
        <div className={`h-12 flex items-center gap-2 ${PAD_TRAFFIC_80} pr-3 shrink-0`} style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--theme-hairline)' } as React.CSSProperties}>
          <button onClick={() => setDrawer(null)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5 transition-colors" style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="Exit Notes">
            <ArrowLeft size={13} /> exit
          </button>
          <span className="text-[13px] font-medium" style={{ color: 'var(--theme-text)' }}>Notes &amp; Tasks</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-6 py-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Notes */}
            <section>
              <div className="text-[10.5px] uppercase tracking-wider opacity-40 mb-2" style={{ color: 'var(--theme-muted)' }}>Notes</div>
              <div className="flex items-center gap-2 mb-3">
                <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote() }} placeholder="Add a note…" className="flex-1 rounded-lg px-2.5 py-2 text-[12.5px] outline-none" style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }} />
                <button onClick={addNote} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}><Plus size={15} /></button>
              </div>
              <div className="space-y-1.5">
                {notes.length === 0 && <div className="text-[12px] opacity-50" style={{ color: 'var(--theme-muted)' }}>No notes yet.</div>}
                {notes.map((n) => (
                  <div key={n.id} className="group flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
                    <span className="flex-1 whitespace-pre-wrap leading-[1.5]">{n.text}</span>
                    <button onClick={() => delNote(n.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 mt-0.5" style={{ color: 'var(--theme-muted)' }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </section>

            {/* Tasks */}
            <section>
              <div className="text-[10.5px] uppercase tracking-wider opacity-40 mb-2" style={{ color: 'var(--theme-muted)' }}>Tasks</div>
              <div className="flex items-center gap-2 mb-3">
                <input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTask() }} placeholder="Add a task…" className="flex-1 rounded-lg px-2.5 py-2 text-[12.5px] outline-none" style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }} />
                <button onClick={addTask} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}><Plus size={15} /></button>
              </div>
              <div className="space-y-1.5">
                {tasks.length === 0 && <div className="text-[12px] opacity-50" style={{ color: 'var(--theme-muted)' }}>No tasks yet.</div>}
                {tasks.map((t) => (
                  <div key={t.id} className="group flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ backgroundColor: 'var(--theme-bg-subtle)' }}>
                    <button onClick={() => toggleTask(t.id)} className="shrink-0" style={{ color: t.done ? 'var(--theme-success)' : 'var(--theme-muted)' }}>
                      {t.done ? <CheckSquare size={15} /> : <Square size={15} />}
                    </button>
                    <span className="flex-1" style={{ color: t.done ? 'var(--theme-muted)' : 'var(--theme-text)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
                    <button onClick={() => delTask(t.id)} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" style={{ color: 'var(--theme-muted)' }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      <WorkspaceAssistant onNewSession={onNewSession} hint="adds notes & tasks" />
    </div>
  )
}
