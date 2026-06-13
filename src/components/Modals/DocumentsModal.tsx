import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, FileText, Plus, Trash2, Save, Sparkles, Loader2 } from 'lucide-react'

interface Doc { id: string; title: string; content: string; updatedAt: number }

/**
 * Documents — a JSON-backed multi-document editor with an AI-assist bar.
 * Pick/create a doc on the left, edit on the right, and ask a model to revise
 * the whole document via documents:assist (runs in safe chat mode).
 */
export function DocumentsModal() {
  const open = useAppStore((s) => s.documentsOpen)
  const close = useAppStore((s) => s.closeDocuments)
  const activeSession = useAppStore((s) => s.activeSession)

  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [assisting, setAssisting] = useState(false)

  const loadList = useCallback(async (): Promise<Doc[]> => {
    const r = await window.electron.documents.list()
    const list = r.ok ? (r.documents || []) : []
    setDocs(list)
    return list
  }, [])

  const selectDoc = (d: Doc) => { setActiveId(d.id); setTitle(d.title); setContent(d.content); setDirty(false); setInstruction('') }
  const clearEditor = () => { setActiveId(null); setTitle(''); setContent(''); setDirty(false) }

  useEffect(() => {
    if (!open) return
    void (async () => {
      const list = await loadList()
      if (list.length > 0) selectDoc(list[0])
      else clearEditor()
    })()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes — matches the drawer behavior.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const newDoc = async () => {
    const r = await window.electron.documents.save({ title: 'Untitled', content: '' })
    if (r.ok && r.doc) { await loadList(); selectDoc(r.doc) }
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await window.electron.documents.save({ id: activeId ?? undefined, title: title || 'Untitled', content })
      if (r.ok && r.doc) { setActiveId(r.doc.id); setDirty(false); await loadList() }
    } finally { setSaving(false) }
  }
  const del = async (id: string) => {
    await window.electron.documents.delete(id)
    const list = await loadList()
    if (id === activeId) { if (list.length > 0) selectDoc(list[0]); else clearEditor() }
  }
  const assist = async () => {
    const ins = instruction.trim()
    if (!ins) return
    setAssisting(true)
    try {
      const r = await window.electron.documents.assist({ sessionId: activeSession?.id, content, instruction: ins })
      if (r.ok && r.content != null) { setContent(r.content); setDirty(true); setInstruction('') }
    } finally { setAssisting(false) }
  }

  const hasEditor = activeId !== null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="w-full max-w-[1000px] h-full max-h-[88vh] flex flex-col rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}>
        <div className="h-12 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div className="flex items-center gap-2"><FileText size={14} style={{ color: 'var(--theme-primary)' }} /><span className="text-[13px] font-medium tracking-tight">Documents</span></div>
          <button onClick={close} className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5"><X size={14} /></button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-[220px] shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--theme-border)' }}>
            <button onClick={newDoc} className="m-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 16%, transparent)', color: 'var(--theme-primary)' }}><Plus size={13} /> New document</button>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {docs.length === 0 && <div className="text-[12px] opacity-50 px-2 py-2" style={{ color: 'var(--theme-muted)' }}>No documents yet.</div>}
              {docs.map((d) => (
                <button key={d.id} onClick={() => selectDoc(d)} className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] transition-colors" style={{ backgroundColor: d.id === activeId ? 'color-mix(in srgb, var(--theme-primary) 12%, transparent)' : 'transparent', color: d.id === activeId ? 'var(--theme-primary)' : 'var(--theme-text)' }}>
                  <FileText size={12} className="shrink-0 opacity-60" />
                  <span className="flex-1 truncate">{d.title || 'Untitled'}</span>
                  <span onClick={(e) => { e.stopPropagation(); void del(d.id) }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Delete"><Trash2 size={11} /></span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            {hasEditor ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
                  <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} placeholder="Untitled" className="flex-1 bg-transparent outline-none text-[14px] font-medium" style={{ color: 'var(--theme-text)' }} />
                  <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}>{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {dirty ? 'Save' : 'Saved'}</button>
                </div>
                <textarea value={content} onChange={(e) => { setContent(e.target.value); setDirty(true) }} placeholder="Start writing… (Markdown supported)" className="flex-1 bg-transparent outline-none resize-none p-4 text-[13px] leading-[1.6] font-mono" style={{ color: 'var(--theme-text)' }} />
                <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderTop: '1px solid var(--theme-border)' }}>
                  <Sparkles size={13} style={{ color: 'var(--theme-primary)' }} className="shrink-0" />
                  <input value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !assisting && instruction.trim()) void assist() }} placeholder="Ask AI to edit this doc (e.g. 'tighten the intro', 'add a summary')…" className="flex-1 bg-transparent outline-none text-[12.5px] rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
                  <button onClick={assist} disabled={assisting || !instruction.trim() || !activeSession} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }} title={activeSession ? 'Apply AI edit' : 'Open a session first'}>{assisting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Apply</button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>Create or select a document to start.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
