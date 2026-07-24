import React, { useEffect, useState, useCallback, useRef } from 'react'
import { MarkdownText } from '../Chat/MessageBubble'
import { useAppStore } from '../../store/appStore'
import { WorkspaceAssistant } from './WorkspaceAssistant'
import { ResizeHandle } from '../Shared/Resizable'
import { useResizablePanel } from '../Shared/useResizablePanel'
import { PAD_TRAFFIC_80 } from '../../utils/platform'
import {
  ArrowLeft, FileText, Plus, Trash2, Save, Loader2,
  Heading1, Heading2, Bold, Italic, List, ListChecks, Quote, Eye, Pencil, Download,
} from 'lucide-react'

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
  const [preview, setPreview] = useState(false)
  const [exportedTo, setExportedTo] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const left = useResizablePanel({ storageKey: 'docs-list', defaultWidth: 240, min: 180, max: 380, dock: 'left' })

  // ── Word-lite toolbar: markdown insertion at the textarea selection ──
  const applyEdit = (next: string, selStart: number, selEnd: number) => {
    setContent(next); setDirty(true)
    requestAnimationFrame(() => {
      const el = editorRef.current
      if (el) { el.focus(); el.setSelectionRange(selStart, selEnd) }
    })
  }
  /** Wrap the selection (or insert placeholder) — bold/italic. */
  const wrapSelection = (mark: string, placeholder: string) => {
    const el = editorRef.current; if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = content.slice(a, b) || placeholder
    const next = content.slice(0, a) + mark + sel + mark + content.slice(b)
    applyEdit(next, a + mark.length, a + mark.length + sel.length)
  }
  /** Prefix each selected line — headings/lists/quotes. Toggles off if present. */
  const prefixLines = (prefix: string) => {
    const el = editorRef.current; if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const lineStart = content.lastIndexOf('\n', a - 1) + 1
    const lineEndIdx = content.indexOf('\n', b)
    const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx
    const block = content.slice(lineStart, lineEnd)
    const allPrefixed = block.split('\n').every((l) => l.startsWith(prefix))
    const nextBlock = block.split('\n').map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l)).join('\n')
    const next = content.slice(0, lineStart) + nextBlock + content.slice(lineEnd)
    applyEdit(next, lineStart, lineStart + nextBlock.length)
  }

  const exportDoc = async () => {
    const r = await window.electron.documents.export({ title: title || 'Untitled', content })
    if (r.ok && r.path) { setExportedTo(r.path); setTimeout(() => setExportedTo(null), 6000) }
  }

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
        <div className={`h-12 flex items-center gap-2 ${PAD_TRAFFIC_80} pr-2 shrink-0`} style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--theme-hairline)' } as React.CSSProperties}>
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
              <button onClick={exportDoc} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium hover:bg-white/5" style={{ color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }} title="Export as a Markdown file on disk">
                <Download size={12} /> Export
              </button>
              <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {dirty ? 'Save' : 'Saved'}
              </button>
            </div>

            {/* formatting toolbar — Word-lite, markdown-backed */}
            <div className="h-9 flex items-center gap-0.5 px-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
              {([
                { icon: Heading1, title: 'Heading 1', act: () => prefixLines('# ') },
                { icon: Heading2, title: 'Heading 2', act: () => prefixLines('## ') },
                { icon: Bold, title: 'Bold', act: () => wrapSelection('**', 'bold text') },
                { icon: Italic, title: 'Italic', act: () => wrapSelection('*', 'italic text') },
                { icon: List, title: 'Bullet list', act: () => prefixLines('- ') },
                { icon: ListChecks, title: 'Checklist', act: () => prefixLines('- [ ] ') },
                { icon: Quote, title: 'Quote', act: () => prefixLines('> ') },
              ] as const).map(({ icon: Icon, title: t, act }) => (
                <button key={t} onClick={act} disabled={preview} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 disabled:opacity-30" style={{ color: 'var(--theme-muted)' }} title={t}>
                  <Icon size={14} />
                </button>
              ))}
              <span className="flex-1" />
              {exportedTo && <span className="text-[10.5px] truncate max-w-[260px]" style={{ color: 'var(--theme-success)' }} title={exportedTo}>Saved to {exportedTo}</span>}
              <button onClick={() => setPreview((v) => !v)} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] hover:bg-white/5" style={{ color: preview ? 'var(--theme-primary)' : 'var(--theme-muted)' }} title={preview ? 'Back to editing' : 'Preview formatted document'}>
                {preview ? <Pencil size={12} /> : <Eye size={12} />} {preview ? 'Edit' : 'Preview'}
              </button>
            </div>

            {preview ? (
              <div className="flex-1 overflow-y-auto px-8 py-6">
                <MarkdownText text={content || '*Nothing to preview yet.*'} />
              </div>
            ) : (
              <textarea ref={editorRef} value={content} onChange={(e) => { setContent(e.target.value); setDirty(true) }} placeholder="Start writing… (Markdown supported — use the toolbar above)" className="flex-1 bg-transparent outline-none resize-none p-6 text-[13.5px] leading-[1.7] font-mono" style={{ color: 'var(--theme-text)' }} />
            )}
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
