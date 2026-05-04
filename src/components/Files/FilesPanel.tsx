import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import {
  PanelRightClose,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  Image as ImageIcon,
  RefreshCw,
  AtSign,
  Copy,
  Loader2,
  FileWarning,
  Pencil,
  Save,
  X as XIcon,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'

// ── Types ──────────────────────────────────────────────────────────────────
type Entry = { name: string; path: string; dir: boolean; size: number; hidden: boolean }

type NodeState = {
  entries: Entry[] | null
  expanded: boolean
  loading: boolean
  error?: string
}

// Map file ext → lucide icon for the tree
function iconForEntry(e: Entry, expanded: boolean): React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number }> {
  if (e.dir) return expanded ? FolderOpen : Folder
  const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
  if (['json', 'jsonc'].includes(ext)) return FileJson
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return ImageIcon
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'html', 'sh', 'toml', 'yml', 'yaml', 'xml'].includes(ext)) return FileCode
  return FileText
}

// Map ext → highlight.js language id
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', cc: 'cpp',
  h: 'c', hpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin',
  json: 'json', jsonc: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini',
  md: 'markdown', mdx: 'markdown', html: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less', sass: 'scss',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', dockerfile: 'dockerfile', ini: 'ini', conf: 'ini',
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function relTo(cwd: string, abs: string): string {
  if (!cwd) return abs
  if (abs === cwd) return '.'
  if (abs.startsWith(cwd + '/')) return abs.slice(cwd.length + 1)
  return abs
}

// ── Tree node ─────────────────────────────────────────────────────────────
interface TreeNodeProps {
  entry: Entry
  depth: number
  state: Map<string, NodeState>
  setState: React.Dispatch<React.SetStateAction<Map<string, NodeState>>>
  selectedPath: string | null
  onSelect: (entry: Entry) => void
  dirtyPaths: Set<string>
}

function TreeNode({ entry, depth, state, setState, selectedPath, onSelect, dirtyPaths }: TreeNodeProps) {
  const s = state.get(entry.path)
  const expanded = !!s?.expanded
  const isSelected = selectedPath === entry.path
  const isDirty = dirtyPaths.has(entry.path)
  const Icon = iconForEntry(entry, expanded)

  const toggleOrOpen = useCallback(async () => {
    if (!entry.dir) { onSelect(entry); return }
    const cur = state.get(entry.path)
    if (cur?.expanded) {
      setState((prev) => new Map(prev).set(entry.path, { ...(cur), expanded: false }))
      return
    }
    if (cur?.entries) {
      setState((prev) => new Map(prev).set(entry.path, { ...cur, expanded: true }))
      return
    }
    setState((prev) => new Map(prev).set(entry.path, { entries: null, expanded: true, loading: true }))
    try {
      const res = await (window as any).electron?.files?.tree?.({ path: entry.path })
      setState((prev) => new Map(prev).set(entry.path, {
        entries: res?.ok ? res.entries ?? [] : [],
        expanded: true,
        loading: false,
        error: res?.ok ? undefined : (res?.error ?? 'Failed to read'),
      }))
    } catch (err: any) {
      setState((prev) => new Map(prev).set(entry.path, {
        entries: [],
        expanded: true,
        loading: false,
        error: err?.message ?? String(err),
      }))
    }
  }, [entry, state, setState, onSelect])

  return (
    <>
      <button
        onClick={toggleOrOpen}
        className="w-full flex items-center gap-1 py-[3px] pr-2 text-left text-[12.5px] transition-colors rounded-sm"
        style={{
          paddingLeft: depth * 12 + 6,
          backgroundColor: isSelected ? 'color-mix(in srgb, var(--theme-primary) 16%, transparent)' : undefined,
          color: isSelected ? 'var(--theme-primary)' : 'var(--theme-text)',
          opacity: entry.hidden ? 0.7 : 1,
        }}
        title={entry.path}
      >
        {entry.dir ? (
          expanded ? (
            <ChevronDown size={11} strokeWidth={2} style={{ color: 'var(--theme-muted)' }} />
          ) : (
            <ChevronRight size={11} strokeWidth={2} style={{ color: 'var(--theme-muted)' }} />
          )
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        <Icon
          size={12}
          strokeWidth={1.8}
          style={{ color: entry.dir ? 'var(--theme-secondary)' : isSelected ? 'var(--theme-primary)' : 'var(--theme-muted)' }}
        />
        <span className="truncate font-mono">{entry.name}</span>
        {isDirty && (
          <span
            className="ml-1 w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: 'var(--theme-warning)' }}
            title="Unsaved changes"
          />
        )}
        {s?.loading && <Loader2 size={10} className="ml-auto animate-spin opacity-60" />}
      </button>
      {expanded && s?.entries && (
        <>
          {s.error && (
            <div
              className="text-[11px] py-0.5"
              style={{ paddingLeft: (depth + 1) * 12 + 6, color: 'var(--theme-error)' }}
            >
              {s.error}
            </div>
          )}
          {s.entries.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              state={state}
              setState={setState}
              selectedPath={selectedPath}
              onSelect={onSelect}
              dirtyPaths={dirtyPaths}
            />
          ))}
        </>
      )}
    </>
  )
}

// ── Viewer ─────────────────────────────────────────────────────────────────
interface ViewerProps {
  selectedPath: string | null
  cwd: string
  onDirtyChange: (path: string, dirty: boolean) => void
}

type ConflictState = {
  currentMtime: number
  currentContent: string
  truncated?: boolean
}

function CodeViewer({ selectedPath, cwd, onDirtyChange }: ViewerProps) {
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [ext, setExt] = useState('')
  const [binary, setBinary] = useState(false)
  const [size, setSize] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mtime, setMtime] = useState<number>(0)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState('')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Selection state (for read-only "ask agent about this")
  const [selection, setSelection] = useState('')

  const preRef = useRef<HTMLPreElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const dirty = editing && buffer !== content

  // Notify parent when dirtiness changes
  useEffect(() => {
    if (!selectedPath) return
    onDirtyChange(selectedPath, dirty)
  }, [selectedPath, dirty, onDirtyChange])

  // Load the file whenever selectedPath changes
  useEffect(() => {
    if (!selectedPath) { setContent(''); setError(null); return }
    let cancelled = false
    setLoading(true); setError(null)
    setEditing(false); setConflict(null); setSaveError(null); setSelection('')
    ;(async () => {
      try {
        const res = await (window as any).electron?.files?.read?.({ path: selectedPath })
        if (cancelled) return
        if (!res?.ok) { setError(res?.error ?? 'Failed to read'); setContent(''); return }
        setContent(res.content ?? '')
        setBuffer(res.content ?? '')
        setExt(res.ext ?? '')
        setBinary(!!res.binary)
        setSize(res.size ?? 0)
        setTruncated(!!res.truncated)
        setMtime(res.mtime ?? 0)
      } catch (err: any) {
        if (!cancelled) { setError(err?.message ?? String(err)); setContent('') }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedPath])

  // Keep the highlighted <pre> scrolled in sync with the textarea while editing.
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    const pre = preRef.current
    if (!ta || !pre) return
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }, [])

  const highlighted = useMemo(() => {
    const src = editing ? buffer : content
    if (!src || binary) return ''
    const lang = EXT_LANG[ext]
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(src, { language: lang, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(src).value
    } catch {
      return ''
    }
  }, [editing, buffer, content, ext, binary])

  const sendMessage = useAppStore((s) => s.sendMessage)

  const askAboutFile = useCallback(async () => {
    if (!selectedPath) return
    const rel = relTo(cwd, selectedPath)
    const q = `Help me understand @${rel}`
    await sendMessage(q)
  }, [selectedPath, cwd, sendMessage])

  const askAboutSelection = useCallback(async () => {
    if (!selectedPath || !selection.trim()) return
    const rel = relTo(cwd, selectedPath)
    const lang = EXT_LANG[ext] ?? ''
    const q = `Help me understand this snippet from @${rel}:\n\n\`\`\`${lang}\n${selection}\n\`\`\``
    setSelection('')
    await sendMessage(q)
  }, [selectedPath, cwd, selection, ext, sendMessage])

  const copyPath = useCallback(async () => {
    if (!selectedPath) return
    const rel = relTo(cwd, selectedPath)
    try { await (window as any).electron?.clipboard?.writeText?.(rel) } catch { /* noop */ }
  }, [selectedPath, cwd])

  const enterEdit = useCallback(() => {
    if (!selectedPath || binary || truncated) return
    setBuffer(content)
    setEditing(true)
    setSaveError(null)
    setConflict(null)
    setSelection('')
    // Focus the textarea after the next paint
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [selectedPath, binary, truncated, content])

  const discardEdit = useCallback(() => {
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes?')
      if (!ok) return
    }
    setEditing(false)
    setBuffer(content)
    setConflict(null)
    setSaveError(null)
  }, [dirty, content])

  const save = useCallback(async (opts?: { force?: boolean }) => {
    if (!selectedPath || !cwd) return
    setSaving(true); setSaveError(null)
    try {
      const res = await (window as any).electron?.files?.write?.({
        path: selectedPath,
        cwd,
        content: buffer,
        expectedMtime: opts?.force ? undefined : mtime,
        force: !!opts?.force,
      })
      if (!res?.ok) {
        if (res?.conflict) {
          setConflict({
            currentMtime: res.currentMtime ?? 0,
            currentContent: res.currentContent ?? '',
            truncated: !!res.truncated,
          })
          return
        }
        setSaveError(res?.error ?? 'Failed to save')
        return
      }
      setContent(buffer)
      setMtime(res.mtime ?? Date.now())
      setSize(res.size ?? buffer.length)
      setConflict(null)
      setSaveError(null)
    } catch (err: any) {
      setSaveError(err?.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }, [selectedPath, cwd, buffer, mtime])

  const reloadFromDisk = useCallback(() => {
    if (!conflict) return
    setContent(conflict.currentContent)
    setBuffer(conflict.currentContent)
    setMtime(conflict.currentMtime)
    if (conflict.truncated) setTruncated(true)
    setConflict(null)
    setSaveError(null)
  }, [conflict])

  // Keyboard shortcuts while this viewer has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedPath) return
      const metaOrCtrl = e.metaKey || e.ctrlKey
      // Cmd/Ctrl+E → toggle edit mode (only if viewer is visible and this isn't in a chat input)
      const active = document.activeElement as HTMLElement | null
      const inField = active && (active.tagName === 'INPUT' || (active.tagName === 'TEXTAREA' && active !== textareaRef.current))
      if (metaOrCtrl && e.key.toLowerCase() === 's' && editing) {
        e.preventDefault()
        void save()
        return
      }
      if (!inField && metaOrCtrl && e.key.toLowerCase() === 'e' && !editing && !binary && !truncated) {
        e.preventDefault()
        enterEdit()
        return
      }
      if (e.key === 'Escape' && editing && active === textareaRef.current) {
        e.preventDefault()
        discardEdit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPath, editing, binary, truncated, save, enterEdit, discardEdit])

  // Capture text selection inside the read-only viewer for "ask agent about this"
  const captureSelection = useCallback(() => {
    if (editing) return
    const sel = window.getSelection()?.toString() ?? ''
    // Require the selection to be inside our <pre>
    if (!sel.trim()) { setSelection(''); return }
    const anchor = window.getSelection()?.anchorNode
    if (!anchor || !preRef.current?.contains(anchor.nodeType === 3 ? anchor.parentNode : anchor)) {
      return
    }
    setSelection(sel)
  }, [editing])

  if (!selectedPath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-2">
        <FileText size={22} style={{ color: 'var(--theme-muted)', opacity: 0.6 }} />
        <p className="text-[12.5px]" style={{ color: 'var(--theme-muted)' }}>
          Select a file from the tree to preview.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--theme-muted)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-2">
        <FileWarning size={22} style={{ color: 'var(--theme-error)' }} />
        <p className="text-[12.5px]" style={{ color: 'var(--theme-error)' }}>
          {error}
        </p>
      </div>
    )
  }

  const rel = relTo(cwd, selectedPath)
  const canEdit = !binary && !truncated

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 text-[11.5px] font-mono shrink-0"
        style={{ borderBottom: '1px solid var(--theme-hairline)', color: 'var(--theme-muted)' }}
      >
        {dirty && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: 'var(--theme-warning)' }}
            title="Unsaved changes"
          />
        )}
        <span className="truncate" style={{ color: 'var(--theme-text)' }}>{rel}</span>
        <span className="opacity-60">·</span>
        <span>{formatSize(size)}</span>
        {ext && <><span className="opacity-60">·</span><span>{ext}</span></>}
        {truncated && (
          <span
            className="ml-1 px-1.5 py-[1px] text-[10px] rounded"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-warning) 18%, transparent)',
              color: 'var(--theme-warning)',
            }}
          >
            truncated
          </span>
        )}
        {editing && (
          <span
            className="ml-1 px-1.5 py-[1px] text-[10px] rounded"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 18%, transparent)',
              color: 'var(--theme-primary)',
            }}
          >
            editing
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {!editing && (
            <>
              <button
                onClick={copyPath}
                className="p-1 rounded hover:bg-white/5 transition-colors"
                title="Copy relative path"
              >
                <Copy size={11} />
              </button>
              <button
                onClick={askAboutFile}
                className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/5 transition-colors"
                title={`Ask agent about @${rel}`}
                style={{ color: 'var(--theme-primary)' }}
              >
                <AtSign size={10} />
                <span className="text-[10.5px]">ask</span>
              </button>
              <button
                onClick={enterEdit}
                disabled={!canEdit}
                className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={
                  !canEdit
                    ? (binary ? 'Binary files cannot be edited' : 'Truncated files cannot be edited')
                    : 'Edit (⌘E) — ⌘S to save, Esc to discard'
                }
                style={{ color: 'var(--theme-text)' }}
              >
                <Pencil size={10} />
                <span className="text-[10.5px]">edit</span>
              </button>
            </>
          )}
          {editing && (
            <>
              <button
                onClick={discardEdit}
                disabled={saving}
                className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/5 transition-colors"
                title="Discard (Esc)"
                style={{ color: 'var(--theme-muted)' }}
              >
                <XIcon size={10} />
                <span className="text-[10.5px]">discard</span>
              </button>
              <button
                onClick={() => void save()}
                disabled={saving || !dirty}
                className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/5 transition-colors disabled:opacity-40"
                title="Save (⌘S)"
                style={{ color: dirty ? 'var(--theme-primary)' : 'var(--theme-muted)' }}
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                <span className="text-[10.5px]">{saving ? 'saving…' : 'save'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Conflict banner */}
      {conflict && (
        <div
          className="flex items-start gap-2 px-3 py-2 text-[11.5px]"
          style={{
            borderBottom: '1px solid var(--theme-hairline)',
            backgroundColor: 'color-mix(in srgb, var(--theme-warning) 14%, transparent)',
            color: 'var(--theme-text)',
          }}
        >
          <AlertTriangle size={13} style={{ color: 'var(--theme-warning)' }} className="shrink-0 mt-[1px]" />
          <div className="flex-1">
            <div className="font-medium" style={{ color: 'var(--theme-warning)' }}>
              File changed on disk
            </div>
            <div className="opacity-80 text-[11px] mt-[1px]">
              Likely the agent wrote this while you were editing. Pick one:
            </div>
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={() => void save({ force: true })}
                disabled={saving}
                className="px-2 py-0.5 rounded text-[11px] font-medium"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--theme-warning) 30%, transparent)',
                  color: 'var(--theme-warning)',
                }}
                title="Overwrite disk with your buffer"
              >
                Keep mine
              </button>
              <button
                onClick={reloadFromDisk}
                className="px-2 py-0.5 rounded text-[11px] font-medium"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 18%, transparent)',
                  color: 'var(--theme-primary)',
                }}
                title="Discard your buffer and reload from disk"
              >
                Reload from disk
              </button>
              <button
                onClick={() => {
                  // Swap the disk version in as the "base" without losing the buffer;
                  // the highlighted pre + textarea will show the user's buffer and
                  // they can diff visually against what's now on disk.
                  setContent(conflict.currentContent)
                  setMtime(conflict.currentMtime)
                  setConflict(null)
                }}
                className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-white/5"
                style={{ color: 'var(--theme-muted)' }}
                title="Keep editing; dismiss this banner"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save error banner */}
      {saveError && !conflict && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]"
          style={{
            borderBottom: '1px solid var(--theme-hairline)',
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 14%, transparent)',
            color: 'var(--theme-error)',
          }}
        >
          <FileWarning size={12} className="shrink-0" />
          <span className="flex-1">{saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            className="p-0.5 rounded hover:bg-white/5"
            title="Dismiss"
          >
            <XIcon size={10} />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-hidden relative">
        {binary ? (
          <div className="p-6 text-center text-[12.5px]" style={{ color: 'var(--theme-muted)' }}>
            Binary file — preview unavailable.
          </div>
        ) : editing ? (
          // Edit mode: highlighted <pre> underneath, transparent textarea overlay on top
          <div className="relative w-full h-full">
            <pre
              ref={preRef}
              aria-hidden="true"
              className="absolute inset-0 overflow-auto text-[11.5px] leading-[1.55] p-3 font-mono m-0 pointer-events-none"
              style={{ color: 'var(--theme-text)', whiteSpace: 'pre', tabSize: 2 }}
            >
              <code
                className={`hljs language-${EXT_LANG[ext] ?? ''}`}
                dangerouslySetInnerHTML={highlighted ? { __html: highlighted + '\n' } : undefined}
              >
                {highlighted ? undefined : buffer + '\n'}
              </code>
            </pre>
            <textarea
              ref={textareaRef}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              onScroll={syncScroll}
              spellCheck={false}
              className="absolute inset-0 w-full h-full text-[11.5px] leading-[1.55] p-3 font-mono resize-none outline-none bg-transparent"
              style={{
                color: 'transparent',
                caretColor: 'var(--theme-text)',
                whiteSpace: 'pre',
                tabSize: 2,
                WebkitTextFillColor: 'transparent',
              }}
            />
          </div>
        ) : (
          <div className="w-full h-full overflow-auto" onMouseUp={captureSelection} onKeyUp={captureSelection}>
            <pre
              ref={preRef}
              className="text-[11.5px] leading-[1.55] p-3 font-mono m-0"
              style={{ color: 'var(--theme-text)' }}
            >
              <code
                className={`hljs language-${EXT_LANG[ext] ?? ''}`}
                dangerouslySetInnerHTML={highlighted ? { __html: highlighted } : undefined}
              >
                {highlighted ? undefined : content}
              </code>
            </pre>
          </div>
        )}

        {/* Floating "ask about selection" button */}
        {!editing && selection.trim() && (
          <button
            onClick={askAboutSelection}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md shadow-lg text-[11px] font-medium transition-transform hover:scale-[1.03]"
            style={{
              backgroundColor: 'var(--theme-primary)',
              color: 'var(--theme-bg)',
            }}
            title="Send this selection to the agent"
          >
            <MessageSquare size={11} />
            <span>Ask about selection ({selection.length} chars)</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────
export function FilesPanel() {
  const setFilesPanelOpen = useAppStore((s) => s.setFilesPanelOpen)
  const activeSession = useAppStore((s) => s.activeSession)
  const cwd = activeSession?.cwd ?? ''

  const [root, setRoot] = useState<Entry[] | null>(null)
  const [loadingRoot, setLoadingRoot] = useState(false)
  const [rootError, setRootError] = useState<string | null>(null)
  const [state, setState] = useState<Map<string, NodeState>>(new Map())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [treeHeight, setTreeHeight] = useState(280)
  const resizingRef = useRef(false)

  // Paths with unsaved buffers — just a set so TreeNode can render red dots.
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set())
  const onDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths((prev) => {
      const has = prev.has(path)
      if (dirty && !has) {
        const next = new Set(prev); next.add(path); return next
      }
      if (!dirty && has) {
        const next = new Set(prev); next.delete(path); return next
      }
      return prev
    })
  }, [])

  const loadRoot = useCallback(async () => {
    if (!cwd) { setRoot([]); return }
    setLoadingRoot(true); setRootError(null)
    try {
      const res = await (window as any).electron?.files?.tree?.({ path: cwd })
      if (res?.ok) setRoot(res.entries ?? [])
      else { setRootError(res?.error ?? 'Failed to read directory'); setRoot([]) }
    } finally {
      setLoadingRoot(false)
    }
  }, [cwd])

  useEffect(() => { void loadRoot() }, [loadRoot])

  // Drag to resize the tree vs viewer split
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const parent = document.getElementById('files-panel-body')
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const y = e.clientY - rect.top
      const clamped = Math.max(120, Math.min(rect.height - 160, y))
      setTreeHeight(clamped)
    }
    const onUp = () => { resizingRef.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  return (
    <aside
      className="flex flex-col shrink-0 h-full"
      style={{
        width: 420,
        backgroundColor: 'var(--theme-bg-subtle)',
        borderLeft: '1px solid var(--theme-border)',
      }}
    >
      {/* Header */}
      <div
        className="h-12 flex items-center justify-between px-3 shrink-0"
        style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--theme-hairline)' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Folder size={13} style={{ color: 'var(--theme-primary)' }} />
          <span className="text-[12.5px] font-medium">Files</span>
          {cwd && (
            <span
              className="font-mono text-[11px] opacity-60 truncate max-w-[180px]"
              style={{ color: 'var(--theme-muted)' }}
              title={cwd}
            >
              {cwd.split('/').slice(-2).join('/')}
            </span>
          )}
          {dirtyPaths.size > 0 && (
            <span
              className="px-1.5 py-[1px] text-[10px] rounded font-medium"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--theme-warning) 18%, transparent)',
                color: 'var(--theme-warning)',
              }}
              title={`${dirtyPaths.size} file(s) with unsaved changes`}
            >
              {dirtyPaths.size} unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => void loadRoot()}
            disabled={loadingRoot}
            className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all disabled:opacity-30"
            title="Refresh"
          >
            <RefreshCw size={12} className={loadingRoot ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setFilesPanelOpen(false)}
            className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all"
            title="Close files"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      {!cwd ? (
        <div className="flex-1 flex items-center justify-center text-center px-6 text-[12.5px]" style={{ color: 'var(--theme-muted)' }}>
          No working directory set for this session.
        </div>
      ) : (
        <div id="files-panel-body" className="flex-1 flex flex-col overflow-hidden">
          {/* Tree */}
          <div
            className="overflow-y-auto py-1"
            style={{ height: treeHeight, borderBottom: '1px solid var(--theme-hairline)' }}
          >
            {loadingRoot && !root && (
              <div className="px-3 py-4 flex items-center gap-2 text-[12px] opacity-70" style={{ color: 'var(--theme-muted)' }}>
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            )}
            {rootError && (
              <div className="px-3 py-3 text-[12px]" style={{ color: 'var(--theme-error)' }}>
                {rootError}
              </div>
            )}
            {root && root.length === 0 && !rootError && (
              <div className="px-3 py-4 text-[12px] opacity-60" style={{ color: 'var(--theme-muted)' }}>
                (empty directory)
              </div>
            )}
            {root?.map((e) => (
              <TreeNode
                key={e.path}
                entry={e}
                depth={0}
                state={state}
                setState={setState}
                selectedPath={selectedPath}
                onSelect={(entry) => setSelectedPath(entry.path)}
                dirtyPaths={dirtyPaths}
              />
            ))}
          </div>

          {/* Drag handle */}
          <div
            onMouseDown={(e) => { e.preventDefault(); resizingRef.current = true; document.body.style.cursor = 'ns-resize' }}
            className="h-[3px] cursor-ns-resize hover:bg-white/10 transition-colors"
            style={{ backgroundColor: 'transparent' }}
            title="Drag to resize"
          />

          {/* Viewer */}
          <CodeViewer selectedPath={selectedPath} cwd={cwd} onDirtyChange={onDirtyChange} />
        </div>
      )}
    </aside>
  )
}
