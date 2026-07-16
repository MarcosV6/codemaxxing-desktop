import React, { useEffect, useMemo, useState } from 'react'
import { MOD } from '../../utils/platform'
import { useAppStore } from '../../store/appStore'
import { AlertTriangle, Check, X, Zap, FileText, Terminal, Rows2, Rows3, Copy } from 'lucide-react'

function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const path = (args.path ?? args.file_path ?? '') as string
  if (name === 'write_file') return path || '(no path)'
  if (name === 'edit_file') return path || '(no path)'
  if (name === 'run_command' || name === 'run_background_command') {
    return (args.command as string) ?? ''
  }
  return Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`)
    .join(' · ')
}

// ── Diff parsing ───────────────────────────────────────────────────────────
// Unified diff → parallel lanes. Context lines appear on both sides; `-`
// only on the left, `+` only on the right. Within a hunk we pair consecutive
// runs of minus/plus so row counts balance.
type DiffRow = {
  left: { kind: 'context' | 'del' | 'empty'; text: string; ln: number | null }
  right: { kind: 'context' | 'add' | 'empty'; text: string; ln: number | null }
}

function parseUnifiedDiff(raw: string): { rows: DiffRow[]; hunkHeaders: string[] } {
  const lines = raw.split('\n')
  const rows: DiffRow[] = []
  const hunkHeaders: string[] = []
  let leftLn = 0
  let rightLn = 0
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff ') || l.startsWith('index ')) {
      i++; continue
    }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
    if (m) {
      hunkHeaders.push(l)
      leftLn = parseInt(m[1], 10)
      rightLn = parseInt(m[2], 10)
      // Emit a hunk separator row
      rows.push({
        left: { kind: 'context', text: l, ln: null },
        right: { kind: 'context', text: '', ln: null },
      })
      i++; continue
    }
    if (l.startsWith('-')) {
      // Gather run of deletions then matching additions
      const dels: string[] = []
      while (i < lines.length && lines[i].startsWith('-') && !lines[i].startsWith('---')) {
        dels.push(lines[i].slice(1)); i++
      }
      const adds: string[] = []
      while (i < lines.length && lines[i].startsWith('+') && !lines[i].startsWith('+++')) {
        adds.push(lines[i].slice(1)); i++
      }
      const pairs = Math.max(dels.length, adds.length)
      for (let k = 0; k < pairs; k++) {
        rows.push({
          left: dels[k] !== undefined
            ? { kind: 'del', text: dels[k], ln: leftLn++ }
            : { kind: 'empty', text: '', ln: null },
          right: adds[k] !== undefined
            ? { kind: 'add', text: adds[k], ln: rightLn++ }
            : { kind: 'empty', text: '', ln: null },
        })
      }
      continue
    }
    if (l.startsWith('+')) {
      // Orphan additions (no preceding deletions)
      while (i < lines.length && lines[i].startsWith('+') && !lines[i].startsWith('+++')) {
        rows.push({
          left: { kind: 'empty', text: '', ln: null },
          right: { kind: 'add', text: lines[i].slice(1), ln: rightLn++ },
        })
        i++
      }
      continue
    }
    // Context line (leading space) or empty
    const text = l.startsWith(' ') ? l.slice(1) : l
    rows.push({
      left: { kind: 'context', text, ln: leftLn++ },
      right: { kind: 'context', text, ln: rightLn++ },
    })
    i++
  }
  return { rows, hunkHeaders }
}

function UnifiedDiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <div
      className="font-mono text-[11.5px] leading-[1.5] rounded-md overflow-auto max-h-[420px]"
      style={{
        border: '1px solid var(--theme-hairline-strong)',
        backgroundColor: 'var(--theme-bg-subtle)',
      }}
    >
      {lines.map((line, i) => {
        let color = 'var(--theme-muted)'
        let bg: string | undefined
        if (line.startsWith('+') && !line.startsWith('+++')) { color = 'var(--theme-success)'; bg = 'color-mix(in srgb, var(--theme-success) 10%, transparent)' }
        else if (line.startsWith('-') && !line.startsWith('---')) { color = 'var(--theme-error)'; bg = 'color-mix(in srgb, var(--theme-error) 10%, transparent)' }
        else if (line.startsWith('@@')) { color = 'var(--theme-secondary)' }
        else if (line.startsWith('+++') || line.startsWith('---')) { color = 'var(--theme-muted)' }
        return (
          <div
            key={i}
            className="px-3 whitespace-pre"
            style={{ color, backgroundColor: bg }}
          >
            {line || '\u00A0'}
          </div>
        )
      })}
    </div>
  )
}

function SideBySideDiffView({ diff }: { diff: string }) {
  const { rows } = useMemo(() => parseUnifiedDiff(diff), [diff])
  const lnWidth = 'w-[44px]'
  return (
    <div
      className="rounded-md overflow-auto max-h-[420px]"
      style={{
        border: '1px solid var(--theme-hairline-strong)',
        backgroundColor: 'var(--theme-bg-subtle)',
      }}
    >
      <div className="grid grid-cols-2 font-mono text-[11.5px] leading-[1.5]">
        {rows.map((r, i) => {
          // Hunk separator (left holds the @@ line)
          if (r.left.ln === null && r.left.text.startsWith('@@')) {
            return (
              <React.Fragment key={i}>
                <div
                  className="col-span-2 px-3 py-0.5 whitespace-pre"
                  style={{
                    color: 'var(--theme-secondary)',
                    backgroundColor: 'color-mix(in srgb, var(--theme-secondary) 6%, transparent)',
                    borderTop: i > 0 ? '1px solid var(--theme-hairline)' : undefined,
                  }}
                >
                  {r.left.text}
                </div>
              </React.Fragment>
            )
          }
          const leftBg = r.left.kind === 'del' ? 'color-mix(in srgb, var(--theme-error) 12%, transparent)' : undefined
          const rightBg = r.right.kind === 'add' ? 'color-mix(in srgb, var(--theme-success) 12%, transparent)' : undefined
          const leftColor = r.left.kind === 'del' ? 'var(--theme-error)' : 'var(--theme-text)'
          const rightColor = r.right.kind === 'add' ? 'var(--theme-success)' : 'var(--theme-text)'
          return (
            <React.Fragment key={i}>
              <div
                className="flex whitespace-pre"
                style={{
                  backgroundColor: leftBg,
                  borderRight: '1px solid var(--theme-hairline)',
                }}
              >
                <span
                  className={`${lnWidth} shrink-0 pr-2 text-right opacity-40 select-none`}
                  style={{ color: 'var(--theme-muted)' }}
                >
                  {r.left.ln ?? ''}
                </span>
                <span style={{ color: leftColor }}>{r.left.text || '\u00A0'}</span>
              </div>
              <div className="flex whitespace-pre" style={{ backgroundColor: rightBg }}>
                <span
                  className={`${lnWidth} shrink-0 pr-2 text-right opacity-40 select-none`}
                  style={{ color: 'var(--theme-muted)' }}
                >
                  {r.right.ln ?? ''}
                </span>
                <span style={{ color: rightColor }}>{r.right.text || '\u00A0'}</span>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

type DiffMode = 'unified' | 'split'

function DiffView({ diff }: { diff: string }) {
  const [mode, setMode] = useState<DiffMode>('split')

  // Stats: counts of +/- lines
  const stats = useMemo(() => {
    let plus = 0, minus = 0
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) plus++
      else if (line.startsWith('-') && !line.startsWith('---')) minus++
    }
    return { plus, minus }
  }, [diff])

  const copy = async () => {
    try { await (window as any).electron?.clipboard?.writeText?.(diff) } catch { /* noop */ }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--theme-muted)' }}>
          <span style={{ color: 'var(--theme-success)' }}>+{stats.plus}</span>
          <span style={{ color: 'var(--theme-error)' }}>−{stats.minus}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={copy}
            className="p-1 rounded hover:bg-white/5 transition-colors"
            style={{ color: 'var(--theme-muted)' }}
            title="Copy diff"
          >
            <Copy size={11} />
          </button>
          <div
            className="flex rounded-md overflow-hidden"
            style={{ border: '1px solid var(--theme-hairline-strong)' }}
          >
            <button
              onClick={() => setMode('unified')}
              className="flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-mono transition-colors"
              style={{
                backgroundColor: mode === 'unified' ? 'color-mix(in srgb, var(--theme-primary) 18%, transparent)' : 'transparent',
                color: mode === 'unified' ? 'var(--theme-primary)' : 'var(--theme-muted)',
              }}
            >
              <Rows3 size={10} /> Unified
            </button>
            <button
              onClick={() => setMode('split')}
              className="flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-mono transition-colors"
              style={{
                backgroundColor: mode === 'split' ? 'color-mix(in srgb, var(--theme-primary) 18%, transparent)' : 'transparent',
                color: mode === 'split' ? 'var(--theme-primary)' : 'var(--theme-muted)',
              }}
            >
              <Rows2 size={10} /> Split
            </button>
          </div>
        </div>
      </div>
      {mode === 'split' ? <SideBySideDiffView diff={diff} /> : <UnifiedDiffView diff={diff} />}
    </div>
  )
}

export function ApprovalModal() {
  const pendingApproval = useAppStore((s) => s.pendingApproval)
  const respond = useAppStore((s) => s.respondToApproval)

  const summary = useMemo(() => {
    if (!pendingApproval) return ''
    return summarizeArgs(pendingApproval.call.name, pendingApproval.call.args)
  }, [pendingApproval])

  useEffect(() => {
    if (!pendingApproval) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); void respond('no') }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void respond('yes') }
      else if (e.key === 'a' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void respond('always') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingApproval, respond])

  if (!pendingApproval) return null
  const { call } = pendingApproval
  const isCommand = call.name === 'run_command' || call.name === 'run_background_command'
  const Icon = isCommand ? Terminal : FileText

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'color-mix(in srgb, black 55%, transparent)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) void respond('no') }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
          border: '1px solid var(--theme-hairline-strong)',
        }}
      >
        <div
          className="flex items-center gap-2.5 px-4 py-3"
          style={{ borderBottom: '1px solid var(--theme-hairline)' }}
        >
          <AlertTriangle size={15} style={{ color: 'var(--theme-warning)' }} />
          <span className="text-[13px]" style={{ color: 'var(--theme-text)' }}>
            Approve <span className="font-mono" style={{ color: 'var(--theme-primary)' }}>{call.name}</span>?
          </span>
          <span className="ml-auto text-[10.5px] font-mono opacity-60" style={{ color: 'var(--theme-muted)' }}>
            ⏎ allow · {MOD}A always · ⎋ deny
          </span>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <div
              className="text-[10px] uppercase font-mono tracking-wider mb-1.5 flex items-center gap-1.5"
              style={{ color: 'var(--theme-muted)' }}
            >
              <Icon size={10} />
              {isCommand ? 'Command' : call.name === 'write_file' || call.name === 'edit_file' ? 'Target file' : 'Arguments'}
            </div>
            <div
              className="font-mono text-[12px] rounded-md px-3 py-2 break-all whitespace-pre-wrap"
              style={{
                backgroundColor: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-hairline)',
                color: 'var(--theme-text)',
              }}
            >
              {summary || '(no args)'}
            </div>
          </div>
          {call.diff && (
            <div>
              <div
                className="text-[10px] uppercase font-mono tracking-wider mb-1.5"
                style={{ color: 'var(--theme-muted)' }}
              >
                Changes
              </div>
              <DiffView diff={call.diff} />
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--theme-hairline)' }}
        >
          <button
            onClick={() => void respond('no')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-mono transition-colors hover:bg-white/5"
            style={{
              border: '1px solid var(--theme-hairline-strong)',
              color: 'var(--theme-error)',
            }}
          >
            <X size={12} /> Deny
          </button>
          <button
            onClick={() => void respond('always')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-mono transition-colors hover:bg-white/5"
            style={{
              border: '1px solid var(--theme-hairline-strong)',
              color: 'var(--theme-warning)',
            }}
          >
            <Zap size={12} /> Always
          </button>
          <button
            onClick={() => void respond('yes')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium font-mono transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              backgroundColor: 'var(--theme-primary)',
              color: 'var(--theme-bg)',
              boxShadow: '0 2px 12px color-mix(in srgb, var(--theme-primary) 40%, transparent)',
            }}
          >
            <Check size={12} /> Allow
          </button>
        </div>
      </div>
    </div>
  )
}

export function MCPApprovalModal() {
  const pending = useAppStore((s) => s.pendingMCPApproval)
  const respond = useAppStore((s) => s.respondToMCPApproval)

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); respond(false) }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); respond(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, respond])

  if (!pending) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'color-mix(in srgb, black 55%, transparent)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) respond(false) }}
    >
      <div
        className="w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
          border: '1px solid var(--theme-hairline-strong)',
        }}
      >
        <div
          className="flex items-center gap-2.5 px-4 py-3"
          style={{ borderBottom: '1px solid var(--theme-hairline)' }}
        >
          <AlertTriangle size={15} style={{ color: 'var(--theme-warning)' }} />
          <span className="text-[13px]" style={{ color: 'var(--theme-text)' }}>
            Approve MCP server: <span className="font-mono" style={{ color: 'var(--theme-primary)' }}>{pending.name}</span>?
          </span>
        </div>
        <div
          className="p-4 space-y-1.5 text-[12px] font-mono"
          style={{ color: 'var(--theme-text)' }}
        >
          <div><span className="opacity-60">command:</span> {pending.command}</div>
          {pending.args && pending.args.length > 0 && (
            <div><span className="opacity-60">args:</span> {pending.args.join(' ')}</div>
          )}
          {pending.env && Object.keys(pending.env).length > 0 && (
            <div className="break-all"><span className="opacity-60">env:</span> {Object.keys(pending.env).join(', ')}</div>
          )}
        </div>
        <div
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--theme-hairline)' }}
        >
          <button
            onClick={() => respond(false)}
            className="px-3 py-1.5 rounded-md text-[12px] font-mono transition-colors hover:bg-white/5"
            style={{ border: '1px solid var(--theme-hairline-strong)', color: 'var(--theme-error)' }}
          >
            Deny
          </button>
          <button
            onClick={() => respond(true)}
            className="px-3 py-1.5 rounded-md text-[12px] font-mono transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              backgroundColor: 'var(--theme-primary)',
              color: 'var(--theme-bg)',
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
