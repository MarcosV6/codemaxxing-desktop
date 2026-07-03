import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../../store/appStore'
import { WorkspaceAssistant } from './WorkspaceAssistant'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'
import { ArrowLeft, FileText, Plus, Trash2, Save, Loader2 } from 'lucide-react'

interface Doc { id: string; title: string; content: string; updatedAt: number }

/**
 * Documents as a full-page workspace: doc list on the left, the open document
 * as the main editor, the agent assistant docked on the right. The editor
 * reports the open doc (with live content) to main so the agent's document_*
 * tools act on "this doc", and reloads when the agent writes.
 */
export function DocumentsView({ onNewSession }: { onNewSession: () => void }) {
  const close = useAppStore((s) => s.closeDocuments)

  const [docs, setDocs] = useState<Doc[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const left = useResizablePanel({ storageKey: 'docs-list', defaultWidth: 240, min: 180, max: 380, dock: 'left' })

  const loadList = useCallback(async (): Promise<Doc[]> => {
    const r = await window.electron.documents.list()
    const list = r.ok ? (r.documents || []) : []
    setDocs(list)
    return list
  }, [])
  const selectDoc = (d: Doc) => { setActiveId(d.id); setTitle(d.title); setContent(d.content); setDirty(false) }
  const clearEditor = () => { setActiveId(null); setTitle(''); setContent(''); setDirty(false) }

  useEffect(() => {
    void (async () => { const list = await loadList(); if (list.length) selectDoc(list[0]); else clearEditor() })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // report the open doc (live content) so the agent's document_* tools target it
  useEffect(() => { window.electron.documents.setActive({ id: activeId, title, content }) }, [activeId, title, content])

  // reload when the agent edits — refresh the list, and the open doc if unchanged locally
  const activeIdRef = useRef(activeId); useEffect(() => { activeIdRef.current = activeId }, [activeId])
  const dirtyRef = useRef(dirty); useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => {
    return window.electron.documents.onChanged(async () => {
      const list = await loadList()
      const cur = activeIdRef.current
      if (cur && !dirtyRef.current) { const d = list.find((x) => x.id === cur); if (d) selectDoc(d) }
    })
  }, [loadList])

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
    if (id === activeId) { if (list.length) selectDoc(list[0]); else clearEditor() }
  }

  const hasEditor = activeId !== null

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* left: document list */}
      <aside className="relative flex flex-col shrink-0 h-full" style={{ width: left.width, backgroundColor: 'var(--theme-bg-subtle)', borderRight: '1px solid var(--theme-hairline)' }}>
        <ResizeHandle handleProps={left.handleProps} label="documents list" />
        <div className="h-12 flex items-center gap-2 pl-[80px] pr-2 shrink-0" style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--theme-hairline)' } as React.CSSProperties}>
          <button onClick={() => close()} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5 transition-colors" style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="Exit Documents">
            <ArrowLeft size={13} /> exit
          </button>
          <span className="flex-1" />
          <button onClick={newDoc} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors" style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="New document">
            <Plus size={15} />
          </button>
        </div>
        <div className="text-[10.5px] uppercase tracking-wider opacity-40 px-4 pb-1.5 shrink-0" style={{ color: 'var(--theme-muted)' }}>Documents</div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
          {docs.length === 0 && <div className="text-[12px] opacity-50 px-2 py-2" style={{ color: 'var(--theme-muted)' }}>No documents yet.</div>}
          {docs.map((d) => (
            <button key={d.id} onClick={() => selectDoc(d)} className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[12.5px] transition-colors"
              style={{ backgroundColor: d.id === activeId ? 'var(--theme-bg-raised)' : 'transparent', borderLeft: d.id === activeId ? '2px solid var(--theme-primary)' : '2px solid transparent', color: d.id === activeId ? 'var(--theme-text)' : 'var(--theme-muted)' }}>
              <FileText size={12} className="shrink-0 opacity-60" />
              <span className="flex-1 truncate">{d.title || 'Untitled'}</span>
              <span onClick={(e) => { e.stopPropagation(); void del(d.id) }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0" title="Delete"><Trash2 size={11} /></span>
            </button>
          ))}
        </div>
      </aside>

      {/* main: editor */}
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 340 }}>
        {hasEditor ? (
          <>
            <div className="h-12 flex items-center gap-2 px-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
              <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} placeholder="Untitled" className="flex-1 bg-transparent outline-none text-[15px] font-medium" style={{ color: 'var(--theme-text)' }} />
              <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {dirty ? 'Save' : 'Saved'}
              </button>
            </div>
            <textarea value={content} onChange={(e) => { setContent(e.target.value); setDirty(true) }} placeholder="Start writing… (Markdown supported)" className="flex-1 bg-transparent outline-none resize-none p-6 text-[13.5px] leading-[1.7] font-mono" style={{ color: 'var(--theme-text)' }} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>Create or select a document to start.</div>
        )}
      </div>

      {/* right: docked assistant */}
      <WorkspaceAssistant onNewSession={onNewSession} hint="edits this doc" />
    </div>
  )
}
