import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, Play, Loader2, Plus, Trash2, Eye, EyeOff, Trophy, Zap, Gavel } from 'lucide-react'
import type { CompareResult } from '../../types'
import { MarkdownText } from '../Chat/MessageBubble'

interface Column { provider: string; model: string }

/**
 * Compare — send one prompt to 2–3 models and view answers side-by-side, with
 * latency/token stats and A/B/tie voting. Models run in safe chat mode (no
 * destructive tools) via the `compare:run` IPC.
 */
export function CompareModal() {
  const open = useAppStore((s) => s.compareOpen)
  const close = useAppStore((s) => s.closeCompare)
  const providers = useAppStore((s) => s.providers)
  const activeSession = useAppStore((s) => s.activeSession)

  const authed = useMemo(() => providers.filter((p) => p.authed), [providers])
  const [columns, setColumns] = useState<Column[]>([])
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<CompareResult[] | null>(null)
  const [blind, setBlind] = useState(false)
  const [vote, setVote] = useState<number | 'tie' | null>(null)
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({})
  // Council layer: the chair's synthesized verdict + a live progress stage.
  const [verdict, setVerdict] = useState<{ provider: string; model: string; text: string } | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [chairIdx, setChairIdx] = useState(0)

  // Seed two columns the first time the modal opens; reset any prior verdict.
  useEffect(() => {
    if (!open) return
    setResults(null)
    setVote(null)
    setVerdict(null)
    setStage(null)
    if (columns.length === 0 && authed.length > 0) {
      const a = authed[0].id
      const b = authed[1]?.id || a
      setColumns([
        { provider: a, model: activeSession?.model || '' },
        { provider: b, model: '' },
      ])
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes — matches the drawer behavior.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // Live progress while the council deliberates ("Consulting…", "weighing…").
  useEffect(() => {
    if (!open) return
    return window.electron.council?.onProgress?.((p) => setStage(p.stage === 'Done' ? null : p.stage))
  }, [open])

  // Lazily fetch the model list for each selected provider (cached).
  useEffect(() => {
    const needed = Array.from(new Set(columns.map((c) => c.provider))).filter((p) => p && !(p in modelsByProvider))
    needed.forEach(async (p) => {
      try {
        const res = await window.electron.llm.listModels(p)
        setModelsByProvider((prev) => ({ ...prev, [p]: res.ok && res.models ? res.models.map((m) => m.id) : [] }))
      } catch {
        setModelsByProvider((prev) => ({ ...prev, [p]: [] }))
      }
    })
  }, [columns, modelsByProvider])

  if (!open) return null

  const setCol = (i: number, patch: Partial<Column>) =>
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const addCol = () => setColumns((cols) => (cols.length >= 3 ? cols : [...cols, { provider: authed[0]?.id || '', model: '' }]))
  const removeCol = (i: number) => setColumns((cols) => cols.filter((_, idx) => idx !== i))

  const canRun = !running && !!prompt.trim() && columns.length >= 2 && columns.every((c) => c.provider && c.model)

  const run = async () => {
    setRunning(true)
    setResults(null)
    setVote(null)
    try {
      const res = await window.electron.compare.run({
        prompt: prompt.trim(),
        cwd: activeSession?.cwd ?? undefined,
        entries: columns,
      })
      setResults(res.ok && res.results ? res.results : [])
    } finally {
      setRunning(false)
    }
  }

  // Convene the council: gather candidate answers, then the chair synthesizes
  // one combined verdict (a single `council:run` call does both phases).
  const runCouncil = async () => {
    setRunning(true)
    setResults(null)
    setVote(null)
    setVerdict(null)
    try {
      const res = await window.electron.council.run({
        prompt: prompt.trim(),
        cwd: activeSession?.cwd ?? undefined,
        entries: columns,
        judge: columns[chairIdx] || columns[0],
      })
      setResults(res.ok && res.candidates ? res.candidates : [])
      setVerdict(res.verdict ?? null)
    } finally {
      setRunning(false)
      setStage(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="w-full max-w-[1100px] h-full max-h-[88vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
      >
        {/* header */}
        <div className="h-12 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: 'var(--theme-primary)' }} />
            <span className="text-[13px] font-medium tracking-tight">Compare &amp; council</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBlind((b) => !b)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] transition-colors hover:bg-white/5"
              style={{ color: 'var(--theme-muted)' }}
              title="Hide model names until you vote"
            >
              {blind ? <EyeOff size={12} /> : <Eye size={12} />} {blind ? 'Blind' : 'Named'}
            </button>
            <button onClick={close} className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* prompt + model pickers */}
        <div className="p-4 space-y-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to send to every model…"
            className="w-full bg-transparent resize-none outline-none text-[13.5px] leading-[1.5] rounded-xl px-3 py-2.5 min-h-[64px] max-h-[160px]"
            style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
          />
          {authed.length < 2 && (
            <div className="text-[11.5px]" style={{ color: 'var(--theme-warning)' }}>
              Tip: add credentials for more providers in Settings to compare across them.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {columns.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <span className="text-[10px] font-mono opacity-50">{String.fromCharCode(65 + i)}</span>
                <select
                  value={c.provider}
                  onChange={(e) => setCol(i, { provider: e.target.value, model: '' })}
                  className="bg-transparent text-[11.5px] outline-none"
                  style={{ color: 'var(--theme-text)' }}
                >
                  {authed.map((p) => <option key={p.id} value={p.id} style={{ color: '#000' }}>{p.name}</option>)}
                </select>
                <span className="opacity-30">·</span>
                {(modelsByProvider[c.provider]?.length ?? 0) > 0 ? (
                  <select
                    value={c.model}
                    onChange={(e) => setCol(i, { model: e.target.value })}
                    className="bg-transparent text-[11.5px] outline-none max-w-[170px]"
                    style={{ color: 'var(--theme-text)' }}
                  >
                    <option value="" style={{ color: '#000' }}>Pick model…</option>
                    {modelsByProvider[c.provider].map((m) => <option key={m} value={m} style={{ color: '#000' }}>{m}</option>)}
                  </select>
                ) : (
                  <input
                    value={c.model}
                    onChange={(e) => setCol(i, { model: e.target.value })}
                    placeholder="model id"
                    className="bg-transparent text-[11.5px] outline-none w-[130px]"
                    style={{ color: 'var(--theme-text)' }}
                  />
                )}
                {columns.length > 2 && (
                  <button onClick={() => removeCol(i)} className="opacity-50 hover:opacity-100" title="Remove"><Trash2 size={11} /></button>
                )}
              </div>
            ))}
            {columns.length < 3 && (
              <button
                onClick={addCol}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11.5px] opacity-70 hover:opacity-100"
                style={{ border: '1px dashed var(--theme-border)', color: 'var(--theme-muted)' }}
              >
                <Plus size={12} /> Add
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg px-2 py-1.5" style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }} title="Which model chairs the council (synthesizes the final verdict)">
                <Gavel size={11} />
                <span className="text-[10px] uppercase tracking-wider opacity-70">chair</span>
                <select
                  value={chairIdx}
                  onChange={(e) => setChairIdx(Number(e.target.value))}
                  className="bg-transparent text-[11px] outline-none max-w-[120px]"
                  style={{ color: 'var(--theme-text)' }}
                >
                  {columns.map((c, i) => (
                    <option key={i} value={i} style={{ color: '#000' }}>{c.model || `Model ${String.fromCharCode(65 + i)}`}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={runCouncil}
                disabled={!canRun}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                style={{ border: '1px solid var(--theme-primary)', color: 'var(--theme-primary)' }}
                title="Every model answers, then the chair critiques + synthesizes one best answer"
              >
                <Gavel size={13} /> Convene council
              </button>
              <button
                onClick={run}
                disabled={!canRun}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
                title="Run side-by-side only (no synthesis)"
              >
                {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {running ? 'Running…' : 'Run'}
              </button>
            </div>
          </div>
        </div>

        {/* results */}
        <div className="flex-1 overflow-y-auto p-4">
          {running && stage && (
            <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--theme-primary)' }}>
              <Loader2 size={13} className="animate-spin" /> {stage}
            </div>
          )}
          {verdict && (
            <div className="mb-4 rounded-xl p-4" style={{ border: '1px solid var(--theme-primary)', backgroundColor: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Gavel size={13} style={{ color: 'var(--theme-primary)' }} />
                <span className="text-[12px] font-semibold" style={{ color: 'var(--theme-primary)' }}>Council verdict</span>
                <span className="text-[10.5px] font-mono opacity-60" style={{ color: 'var(--theme-muted)' }}>chair · {verdict.model}</span>
              </div>
              <div className="text-[13px] leading-[1.6]" style={{ color: 'var(--theme-text)' }}>
                <MarkdownText text={verdict.text} />
              </div>
            </div>
          )}
          {!results && !running ? (
            <div className="h-full flex items-center justify-center text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>
              Enter a prompt, pick at least two models, and hit Run.
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
              {columns.map((c, i) => {
                const r = results ? results[i] : undefined
                const won = vote === i
                const revealName = !blind || vote !== null
                return (
                  <div
                    key={i}
                    className="rounded-xl p-3 flex flex-col min-h-[220px]"
                    style={{ backgroundColor: 'var(--theme-bg-subtle)', border: won ? '1px solid var(--theme-primary)' : '1px solid var(--theme-border)' }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11.5px] font-medium truncate">
                        {revealName ? (r?.model || c.model) : `Model ${String.fromCharCode(65 + i)}`}
                      </span>
                      {r?.ok && (
                        <span className="text-[10px] font-mono opacity-60 shrink-0 flex items-center gap-1" style={{ color: 'var(--theme-muted)' }}>
                          {r.latencyMs != null && <span>{(r.latencyMs / 1000).toFixed(1)}s</span>}
                          {r.completionTokens != null && <span>· {r.completionTokens}t</span>}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto text-[12.5px] leading-[1.55] whitespace-pre-wrap pr-1" style={{ color: 'var(--theme-text)' }}>
                      {running && !results ? (
                        <span className="opacity-50 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> thinking…</span>
                      ) : r?.ok ? (
                        r.text
                      ) : (
                        <span style={{ color: 'var(--theme-error)' }}>{r?.error || 'No response'}</span>
                      )}
                    </div>
                    {results && (
                      <button
                        onClick={() => setVote(i)}
                        className="mt-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                        style={{
                          backgroundColor: won ? 'color-mix(in srgb, var(--theme-primary) 18%, transparent)' : 'transparent',
                          color: won ? 'var(--theme-primary)' : 'var(--theme-muted)',
                          border: '1px solid var(--theme-border)',
                        }}
                      >
                        <Trophy size={11} /> {won ? 'Winner' : 'Vote'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {results && (
            <div className="flex justify-center mt-3">
              <button
                onClick={() => setVote('tie')}
                className="px-3 py-1.5 rounded-lg text-[11px] transition-colors"
                style={{
                  color: vote === 'tie' ? 'var(--theme-primary)' : 'var(--theme-muted)',
                  border: '1px solid var(--theme-border)',
                  backgroundColor: vote === 'tie' ? 'color-mix(in srgb, var(--theme-primary) 14%, transparent)' : 'transparent',
                }}
              >
                Call it a tie
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
