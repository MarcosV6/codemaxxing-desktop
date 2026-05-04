import React, { useState } from 'react'
import {
  ChevronDown, ChevronRight, Loader2, Check, X, AlertCircle,
  FileText, FileEdit, FilePlus, FolderTree, Search, Terminal, Globe, Brain, Sparkles,
} from 'lucide-react'
import type { ToolCallRecord } from '../../types'

/** Map a tool name to an accent color key + icon so each tool reads at a
 *  glance. Keeps the surface uniform (same rounded bg, same row geometry)
 *  while letting `read_file` vs `run_command` feel visually distinct. */
type ToolKind = {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties; className?: string }>
  accent: string
  label: string
}

function toolKind(name: string): ToolKind {
  // Accent colors map through theme vars so each stays cohesive per theme.
  const primary = 'var(--theme-primary)'
  const tool = 'var(--theme-tool)'
  const secondary = 'var(--theme-secondary)'
  const success = 'var(--theme-success)'
  const warning = 'var(--theme-warning)'
  switch (name) {
    case 'read_file':  return { Icon: FileText,   accent: tool,      label: 'Read' }
    case 'write_file': return { Icon: FilePlus,   accent: success,   label: 'Write' }
    case 'edit_file':  return { Icon: FileEdit,   accent: primary,   label: 'Edit' }
    case 'list_files': return { Icon: FolderTree, accent: tool,      label: 'List' }
    case 'search_files':
    case 'grep':       return { Icon: Search,     accent: tool,      label: 'Search' }
    case 'glob':       return { Icon: Search,     accent: tool,      label: 'Glob' }
    case 'run_command':
    case 'run_background_command':
                       return { Icon: Terminal,   accent: warning,   label: 'Shell' }
    case 'web_fetch':
    case 'web_search': return { Icon: Globe,      accent: secondary, label: 'Web' }
    case 'think':      return { Icon: Brain,      accent: secondary, label: 'Think' }
    default:           return { Icon: Sparkles,   accent: primary,   label: 'Tool' }
  }
}

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

function StatusIcon({ status, accent }: { status: ToolCallRecord['status']; accent: string }) {
  switch (status) {
    case 'pending':
      return <AlertCircle size={11} style={{ color: 'var(--theme-warning)' }} />
    case 'running':
      return <Loader2 size={11} className="animate-spin" style={{ color: accent }} />
    case 'done':
      return <Check size={11} style={{ color: 'var(--theme-success)' }} />
    case 'error':
    case 'denied':
      return <X size={11} style={{ color: 'var(--theme-error)' }} />
    default:
      return <span className="w-[11px]" />
  }
}

/** Cap how much tool-result text we shove into the DOM at once. ~80KB
 *  covers ~2000 lines of typical CLI output and keeps render snappy.
 *  Beyond that, render a head + tail with a "show full" button so users
 *  can still get to the truncated middle if they need it. */
const TOOL_RESULT_LIMIT = 80_000

function ToolResultPre({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const tooLarge = text.length > TOOL_RESULT_LIMIT
  const display = !expanded && tooLarge
    ? text.slice(0, TOOL_RESULT_LIMIT / 2) +
      `\n\n…[${(text.length - TOOL_RESULT_LIMIT).toLocaleString()} chars truncated]…\n\n` +
      text.slice(-TOOL_RESULT_LIMIT / 2)
    : text
  return (
    <>
      <pre
        className="whitespace-pre-wrap break-all max-h-64 overflow-auto font-mono text-[11.5px] leading-[1.55] px-2 py-1.5 rounded"
        style={{
          color: 'var(--theme-muted)',
          backgroundColor: 'color-mix(in srgb, var(--theme-bg) 55%, transparent)',
        }}
      >
        {display}
      </pre>
      {tooLarge && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[10.5px] font-mono uppercase tracking-wider opacity-70 hover:opacity-100 transition-opacity focus-ring"
          style={{ color: 'var(--theme-muted)' }}
        >
          {expanded ? 'collapse' : `show full (${text.length.toLocaleString()} chars)`}
        </button>
      )}
    </>
  )
}

function DiffLines({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <div className="font-mono text-[11.5px] leading-[1.55] overflow-auto max-h-64 rounded"
         style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg) 60%, transparent)' }}>
      {lines.map((line, i) => {
        const style: React.CSSProperties = { color: 'var(--theme-muted)', paddingLeft: 8, paddingRight: 8 }
        if (line.startsWith('+') && !line.startsWith('+++')) {
          style.color = 'var(--theme-success)'
          style.backgroundColor = 'color-mix(in srgb, var(--theme-success) 8%, transparent)'
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          style.color = 'var(--theme-error)'
          style.backgroundColor = 'color-mix(in srgb, var(--theme-error) 8%, transparent)'
        } else if (line.startsWith('@@')) style.color = 'var(--theme-secondary)'
        return <div key={i} style={style}>{line || '\u00A0'}</div>
      })}
    </div>
  )
}

/**
 * Memoized so a tool call rendered inside a historical message bubble
 * doesn't re-render on every live token. Compares `call` by reference —
 * the live stream ALWAYS replaces the call object on update (see
 * `currentToolCalls` updates in appStore), so this still re-renders
 * correctly while the call is in-flight.
 */
export const ToolCallBlock = React.memo(ToolCallBlockInner, (prev, next) => prev.call === next.call)

function ToolCallBlockInner({ call }: { call: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false)
  const preview = argsPreview(call.name, call.args)
  const hasBody = !!(call.result || call.diff)
  const { Icon, accent, label } = toolKind(call.name)
  const running = call.status === 'running'

  return (
    <div
      className="group/tool rounded-lg text-[12px] transition-all overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--theme-bg-subtle) 65%, transparent)',
        // A thin 2px colored rail on the left tells you the tool family at a
        // glance without adding a full border around every block.
        boxShadow: `inset 2px 0 0 0 color-mix(in srgb, ${accent} ${running ? 75 : 45}%, transparent)`,
      }}
    >
      <button
        onClick={() => hasBody && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${hasBody ? 'cursor-pointer hover:bg-white/[0.025]' : 'cursor-default'}`}
      >
        {hasBody ? (
          expanded
            ? <ChevronDown size={10} style={{ color: 'var(--theme-muted)' }} />
            : <ChevronRight size={10} style={{ color: 'var(--theme-muted)' }} />
        ) : (
          <span className="w-[10px]" />
        )}
        <Icon size={11} strokeWidth={2} style={{ color: accent }} />
        <StatusIcon status={call.status} accent={accent} />
        <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: accent, opacity: 0.9 }}>
          {label}
        </span>
        {preview && (
          <span className="truncate flex-1 font-mono text-[11.5px]" style={{ color: 'var(--theme-text)', opacity: 0.8 }}>
            {preview}
          </span>
        )}
        {running && (
          <span
            className="text-[10px] font-mono uppercase tracking-wider shrink-0 animate-pulse"
            style={{ color: accent, opacity: 0.8 }}
          >
            running
          </span>
        )}
        {call.status === 'denied' && (
          <span className="text-[10px] font-mono uppercase tracking-wider shrink-0"
                style={{ color: 'var(--theme-error)', opacity: 0.8 }}>
            denied
          </span>
        )}
      </button>
      {expanded && hasBody && (
        <div
          className="px-2.5 py-2 animate-fade-in"
          style={{ borderTop: '1px solid var(--theme-hairline)' }}
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
              <ToolResultPre text={call.result} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
