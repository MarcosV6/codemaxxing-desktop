import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Check, X, AlertCircle } from 'lucide-react'
import type { ToolCallRecord } from '../../types'

function argsPreview(name: string, args: Record<string, unknown>): string {
  const path = (args.path ?? args.file_path ?? '') as string
  if (name === 'read_file' || name === 'write_file' || name === 'edit_file') return path || '(no path)'
  if (name === 'list_files') return (args.path as string) || '.'
  if (name === 'search_files') return `"${args.pattern ?? ''}" in ${args.path ?? '.'}`
  if (name === 'glob') return (args.pattern as string) ?? ''
  if (name === 'run_command' || name === 'run_background_command') {
    const cmd = (args.command as string) ?? ''
    return cmd.length > 100 ? cmd.slice(0, 100) + '…' : cmd
  }
  if (name === 'web_fetch') return (args.url as string) ?? ''
  if (name === 'web_search') return (args.query as string) ?? ''
  if (name === 'think') return (args.thought as string)?.slice(0, 80) ?? ''
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  return keys.map(k => `${k}=${String(args[k]).slice(0, 40)}`).join(' · ')
}

function StatusIcon({ status }: { status: ToolCallRecord['status'] }) {
  switch (status) {
    case 'pending':
      return <AlertCircle size={12} style={{ color: 'var(--theme-warning)' }} />
    case 'running':
      return <Loader2 size={12} className="animate-spin" style={{ color: 'var(--theme-primary)' }} />
    case 'done':
      return <Check size={12} style={{ color: 'var(--theme-success)' }} />
    case 'error':
    case 'denied':
      return <X size={12} style={{ color: 'var(--theme-error)' }} />
    default:
      return <span className="w-3" />
  }
}

function DiffLines({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <div className="font-mono text-[11.5px] leading-[1.55] overflow-auto max-h-64">
      {lines.map((line, i) => {
        const style: React.CSSProperties = { color: 'var(--theme-muted)' }
        if (line.startsWith('+') && !line.startsWith('+++')) style.color = 'var(--theme-success)'
        else if (line.startsWith('-') && !line.startsWith('---')) style.color = 'var(--theme-error)'
        else if (line.startsWith('@@')) style.color = 'var(--theme-secondary)'
        return <div key={i} className="px-2" style={style}>{line || '\u00A0'}</div>
      })}
    </div>
  )
}

export function ToolCallBlock({ call }: { call: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false)
  const preview = argsPreview(call.name, call.args)
  const hasBody = !!(call.result || call.diff)

  return (
    <div
      className="rounded-lg text-[12px] transition-colors"
      style={{
        backgroundColor: 'var(--theme-bg-subtle)',
        border: '1px solid var(--theme-border)',
      }}
    >
      <button
        onClick={() => hasBody && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-2.5 py-2 text-left ${hasBody ? 'cursor-pointer hover:bg-white/[0.02]' : 'cursor-default'}`}
      >
        {hasBody ? (
          expanded ? <ChevronDown size={11} style={{ color: 'var(--theme-muted)' }} /> : <ChevronRight size={11} style={{ color: 'var(--theme-muted)' }} />
        ) : (
          <span className="w-[11px]" />
        )}
        <StatusIcon status={call.status} />
        <span className="font-mono" style={{ color: 'var(--theme-tool)' }}>{call.name}</span>
        {preview && (
          <span className="truncate flex-1 font-mono" style={{ color: 'var(--theme-muted)' }}>
            {preview}
          </span>
        )}
      </button>
      {expanded && hasBody && (
        <div
          className="px-2.5 py-2"
          style={{ borderTop: '1px solid var(--theme-border)' }}
        >
          {call.diff && (
            <div className="mb-2">
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--theme-muted)', opacity: 0.7 }}>
                Diff
              </div>
              <DiffLines diff={call.diff} />
            </div>
          )}
          {call.result && (
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--theme-muted)', opacity: 0.7 }}>
                Output
              </div>
              <pre
                className="whitespace-pre-wrap break-all max-h-64 overflow-auto font-mono text-[11.5px] leading-[1.55]"
                style={{ color: 'var(--theme-muted)' }}
              >
                {call.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
