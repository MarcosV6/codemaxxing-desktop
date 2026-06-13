import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, Search, Loader2, Globe } from 'lucide-react'
import { MarkdownText } from '../Chat/MessageBubble'

interface Step { id: string; kind: 'search' | 'read'; label: string }

/**
 * Deep Research — ask a question; the agent plans, runs web_search / web_fetch
 * across multiple sources, and synthesizes a cited Markdown report. Progress
 * (the search/read trail + streamed synthesis) arrives over research:progress.
 */
export function ResearchModal() {
  const open = useAppStore((s) => s.researchOpen)
  const close = useAppStore((s) => s.closeResearch)
  const activeSession = useAppStore((s) => s.activeSession)

  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [liveText, setLiveText] = useState('')
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const unsub = window.electron.research.onProgress((e) => {
      if (e.kind === 'tool' && e.call && (e.call.name === 'web_search' || e.call.name === 'web_fetch')) {
        const a = (e.call.args || {}) as Record<string, unknown>
        const label = e.call.name === 'web_search' ? String(a.query ?? '') : String(a.url ?? '')
        setSteps((prev) => [...prev, { id: e.call!.id || `${Date.now()}-${prev.length}`, kind: e.call!.name === 'web_search' ? 'search' : 'read', label }])
      } else if (e.kind === 'text' && e.delta) {
        setLiveText((prev) => prev + e.delta)
      }
    })
    return unsub
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [liveText, steps])

  // Escape closes — matches the drawer behavior.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const canRun = !running && !!query.trim() && !!activeSession
  const run = async () => {
    setRunning(true); setSteps([]); setLiveText(''); setReport(null); setError(null)
    try {
      const res = await window.electron.research.run({ sessionId: activeSession?.id, cwd: activeSession?.cwd ?? undefined, query: query.trim() })
      if (res.ok) setReport(res.report ?? '')
      else setError(res.error ?? 'Research failed')
    } finally {
      setRunning(false)
    }
  }

  const started = running || steps.length > 0 || report != null || error != null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="w-full max-w-[860px] h-full max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
      >
        <div className="h-12 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div className="flex items-center gap-2">
            <Search size={14} style={{ color: 'var(--theme-primary)' }} />
            <span className="text-[13px] font-medium tracking-tight">Deep Research</span>
          </div>
          <button onClick={close} className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5"><X size={14} /></button>
        </div>

        <div className="p-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canRun) void run() }}
              placeholder="What should I research? (searches the web across multiple sources)"
              className="flex-1 bg-transparent outline-none text-[13.5px] rounded-xl px-3 py-2.5"
              style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
            />
            <button
              onClick={run}
              disabled={!canRun}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} {running ? 'Researching…' : 'Research'}
            </button>
          </div>
          {!activeSession && <div className="text-[11.5px] mt-2" style={{ color: 'var(--theme-warning)' }}>Open a session first — research uses its model.</div>}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {!started && (
            <div className="h-full flex items-center justify-center text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>
              Ask a question — I'll search the web, read sources, and write a cited report.
            </div>
          )}
          {steps.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider opacity-50" style={{ color: 'var(--theme-muted)' }}>Research trail</div>
              {steps.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>
                  {s.kind === 'search' ? <Search size={11} style={{ color: 'var(--theme-primary)' }} /> : <Globe size={11} style={{ color: 'var(--theme-primary)' }} />}
                  <span className="truncate">{s.kind === 'search' ? 'Searched' : 'Read'}: {s.label}</span>
                </div>
              ))}
            </div>
          )}
          {error && <div className="text-[12.5px]" style={{ color: 'var(--theme-error)' }}>{error}</div>}
          {report != null ? (
            <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--theme-text)' }}>
              <MarkdownText text={report} />
            </div>
          ) : running ? (
            <div className="text-[13px] leading-[1.6] whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>
              {liveText}
              <span className="inline-flex items-center ml-1 opacity-60 align-middle"><Loader2 size={12} className="animate-spin" /></span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
