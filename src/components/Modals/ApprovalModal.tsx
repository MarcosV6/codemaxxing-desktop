import React, { useEffect, useMemo } from 'react'
import { useAppStore } from '../../store/appStore'
import { AlertTriangle, Check, X, Zap } from 'lucide-react'

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

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <div className="font-mono text-[11px] leading-tight rounded border overflow-auto max-h-64"
         style={{ borderColor: 'var(--theme-border, #334155)', backgroundColor: 'var(--theme-bg-subtle, #0d0d14)' }}>
      {lines.map((line, i) => {
        let cls = 'text-gray-500'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-green-400'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-red-400'
        else if (line.startsWith('@@')) cls = 'text-purple-400'
        else if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-gray-400'
        return (
          <div key={i} className={`px-2 ${cls}`}>
            {line || '\u00A0'}
          </div>
        )
      })}
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) void respond('no') }}>
      <div className="w-full max-w-2xl rounded-lg border shadow-2xl"
           style={{ backgroundColor: 'var(--theme-bg, #0a0a0f)', borderColor: 'var(--theme-border, #334155)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--theme-border, #334155)' }}>
          <AlertTriangle size={16} className="text-yellow-400" />
          <span className="text-sm font-mono" style={{ color: 'var(--theme-text, #C0CAF5)' }}>
            Approve {call.name}?
          </span>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <div className="text-[10px] uppercase font-mono mb-1" style={{ color: 'var(--theme-muted, #9AA5CE)' }}>
              {isCommand ? 'Command' : 'Arguments'}
            </div>
            <div className="font-mono text-xs rounded border p-2 break-all whitespace-pre-wrap"
                 style={{
                   backgroundColor: 'var(--theme-bg-subtle, #0d0d14)',
                   borderColor: 'var(--theme-border, #334155)',
                   color: 'var(--theme-text, #C0CAF5)',
                 }}>
              {summary || '(no args)'}
            </div>
          </div>
          {call.diff && (
            <div>
              <div className="text-[10px] uppercase font-mono mb-1" style={{ color: 'var(--theme-muted, #9AA5CE)' }}>
                Diff
              </div>
              <DiffView diff={call.diff} />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t"
             style={{ borderColor: 'var(--theme-border, #334155)' }}>
          <button
            onClick={() => void respond('no')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-colors"
            style={{ borderColor: 'var(--theme-border, #334155)', color: 'var(--theme-error, #F7768E)' }}
          >
            <X size={12} /> Deny (Esc)
          </button>
          <button
            onClick={() => void respond('always')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-colors"
            style={{ borderColor: 'var(--theme-border, #334155)', color: 'var(--theme-warning, #E0AF68)' }}
          >
            <Zap size={12} /> Always (⌘A)
          </button>
          <button
            onClick={() => void respond('yes')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono bg-green-700 hover:bg-green-600 text-white transition-colors"
          >
            <Check size={12} /> Allow (Enter)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) respond(false) }}>
      <div className="w-full max-w-xl rounded-lg border shadow-2xl"
           style={{ backgroundColor: 'var(--theme-bg, #0a0a0f)', borderColor: 'var(--theme-border, #334155)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--theme-border, #334155)' }}>
          <AlertTriangle size={16} className="text-yellow-400" />
          <span className="text-sm font-mono">Approve MCP server: {pending.name}?</span>
        </div>
        <div className="p-4 space-y-2 text-xs font-mono"
             style={{ color: 'var(--theme-text, #C0CAF5)' }}>
          <div>
            <span className="opacity-60">command:</span> {pending.command}
          </div>
          {pending.args && pending.args.length > 0 && (
            <div>
              <span className="opacity-60">args:</span> {pending.args.join(' ')}
            </div>
          )}
          {pending.env && Object.keys(pending.env).length > 0 && (
            <div className="break-all">
              <span className="opacity-60">env:</span> {Object.keys(pending.env).join(', ')}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t"
             style={{ borderColor: 'var(--theme-border, #334155)' }}>
          <button
            onClick={() => respond(false)}
            className="px-3 py-1.5 rounded text-xs font-mono border"
            style={{ borderColor: 'var(--theme-border, #334155)', color: 'var(--theme-error, #F7768E)' }}
          >
            Deny
          </button>
          <button
            onClick={() => respond(true)}
            className="px-3 py-1.5 rounded text-xs font-mono bg-green-700 hover:bg-green-600 text-white"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
