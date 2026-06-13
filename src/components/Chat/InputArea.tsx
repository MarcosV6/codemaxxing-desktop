import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import {
  ArrowUp, Cpu,
  GitCompare, GitBranch, History, GitCommit, Upload, Undo2,
  DollarSign, Archive, Bookmark, BookOpen, Sparkles, Brain,
  Database, Bot, Clock, Settings, HelpCircle, FileCog,
  FileText, Folder, AtSign, Paperclip, X, StickyNote, Mail, CalendarDays, ImageIcon as LucideImageIcon,
} from 'lucide-react'
import type { ImageAttachment } from '../../types'
import {
  imagesFromClipboard,
  imageFilesFrom,
  processImageFiles,
} from '../../utils/imageAttach'

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>

interface InputAreaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  disabled: boolean
  isLoading: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  cwd?: string | null
  /** Image attachments staged for the next send. Owned by the parent so
   *  the value survives across re-renders and so drag-drop handlers
   *  outside this component can also append to it. */
  attachments?: ImageAttachment[]
  onAttachmentsChange?: (next: ImageAttachment[]) => void
  /** Active session mode — drives the Agent|Chat segmented toggle. */
  mode?: 'code' | 'chat'
  /** Flip the active session between Agent (code) and Chat mode. */
  onToggleMode?: () => void
  /** Current model id, shown as a read-only chip in the composer footer. */
  modelLabel?: string | null
}

interface SlashCommand {
  name: string
  description: string
  args?: string
  icon: LucideIcon
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'init',        description: 'Scaffold a CODEMAXXING.md project-rules file',                                              icon: FileCog },
  { name: 'diff',        description: 'Show git diff',                                   args: '[staged]',                         icon: GitCompare },
  { name: 'status',      description: 'Show git status',                                                                           icon: GitBranch },
  { name: 'log',         description: 'Show recent commits',                             args: '[n]',                              icon: History },
  { name: 'commit',      description: 'Stage all and commit',                            args: '<message>',                        icon: GitCommit },
  { name: 'push',        description: 'Push to remote',                                                                            icon: Upload },
  { name: 'undo',        description: 'Undo the last commit (keep changes)',                                                       icon: Undo2 },
  { name: 'cost',        description: 'Show session token usage and cost',                                                         icon: DollarSign },
  { name: 'compact',     description: 'Summarize old history into a fresh session',      args: '[keep]',                           icon: Archive },
  { name: 'checkpoint',  description: 'Save a session checkpoint',                       args: '[label]',                          icon: Bookmark },
  { name: 'checkpoints', description: 'Browse saved checkpoints',                                                                  icon: BookOpen },
  { name: 'skills',      description: 'Show active skill packs',                                                                   icon: Sparkles },
  { name: 'think',       description: 'Set reasoning effort',                            args: '<off|low|medium|high|max>',        icon: Brain },
  { name: 'memory',      description: 'Show memory stats or recall',                     args: '[query]',                          icon: Database },
  { name: 'bg',          description: 'Open background agents drawer',                                                             icon: Bot },
  { name: 'cron',        description: 'Open scheduled tasks drawer',                                                               icon: Clock },
  { name: 'cookbook',    description: 'Browse & download local models for your hardware',                                          icon: BookOpen },
  { name: 'compare',     description: 'Run one prompt across multiple models, side-by-side',                                       icon: GitCompare },
  { name: 'research',    description: 'Deep web research → a cited report',                                                        icon: Sparkles },
  { name: 'notes',       description: 'Quick notes & tasks',                                                                       icon: StickyNote },
  { name: 'docs',        description: 'AI-assisted documents editor',                                                              icon: FileText },
  { name: 'email',       description: 'IMAP inbox — read & send mail',                                                             icon: Mail },
  { name: 'calendar',    description: 'CalDAV calendar — upcoming events',                                                         icon: CalendarDays },
  { name: 'settings',    description: 'Open settings',                                                                             icon: Settings },
  { name: 'help',        description: 'List all slash commands',                                                                   icon: HelpCircle },
]

interface FileHit {
  path: string
  name: string
  dir: boolean
  ext: string
}

function parseSlashPrefix(value: string): { prefix: string } | null {
  if (!value.startsWith('/')) return null
  // Only show popup while typing the command name itself (no space yet)
  const firstSpace = value.indexOf(' ')
  const firstNewline = value.indexOf('\n')
  if (firstSpace !== -1 || firstNewline !== -1) return null
  return { prefix: value.slice(1).toLowerCase() }
}

/** Parse an @mention trigger at the caret — returns null if no active @ token.
 *  Rules: `@` must be at start-of-line or preceded by whitespace; token
 *  continues until whitespace. Caret must sit within the token. */
function parseMentionAtCaret(value: string, caret: number): { start: number; end: number; query: string } | null {
  if (caret <= 0) return null
  // Scan back from caret-1 for `@`, stopping at whitespace
  let i = caret - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === '@') {
      const before = i === 0 ? ' ' : value[i - 1]
      if (!/[\s]/.test(before)) return null
      // Find end of token: next whitespace after caret
      let end = caret
      while (end < value.length && !/\s/.test(value[end])) end++
      const query = value.slice(i + 1, end)
      return { start: i, end, query }
    }
    if (/[\s]/.test(ch)) return null
    i--
  }
  return null
}

function iconForFile(f: FileHit): LucideIcon {
  if (f.dir) return Folder
  return FileText
}

export function InputArea({
  value,
  onChange,
  onKeyDown,
  onSend,
  disabled,
  isLoading,
  inputRef,
  cwd,
  attachments,
  onAttachmentsChange,
  mode,
  onToggleMode,
  modelLabel,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [caret, setCaret] = useState(0)
  const [fileHits, setFileHits] = useState<FileHit[]>([])
  const [fileSearching, setFileSearching] = useState(false)
  const [attachBusy, setAttachBusy] = useState(false)
  const liveAttachments = attachments ?? []
  const hasAttachments = liveAttachments.length > 0

  const addAttachments = useCallback(async (files: File[]) => {
    if (files.length === 0 || !onAttachmentsChange) return
    setAttachBusy(true)
    try {
      const next = await processImageFiles(files)
      if (next.length > 0) {
        onAttachmentsChange([...(attachments ?? []), ...next])
      }
    } finally {
      setAttachBusy(false)
    }
  }, [attachments, onAttachmentsChange])

  const removeAttachment = useCallback((id: string) => {
    if (!onAttachmentsChange) return
    onAttachmentsChange((attachments ?? []).filter(a => a.id !== id))
  }, [attachments, onAttachmentsChange])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imgs = imagesFromClipboard(e)
    if (imgs.length === 0) return // let the default text-paste happen
    e.preventDefault()
    void addAttachments(imgs)
  }, [addAttachments])

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = imageFilesFrom(e.target.files)
    void addAttachments(files)
    // Reset so picking the same file twice in a row still fires onChange.
    if (e.target) e.target.value = ''
  }, [addAttachments])

  useEffect(() => {
    if (inputRef) {
      inputRef.current = textareaRef.current
    }
  }, [inputRef])

  // ── Popups state ──
  const slashState = parseSlashPrefix(value)
  const mentionState = useMemo(
    () => (!slashState ? parseMentionAtCaret(value, caret) : null),
    [value, caret, slashState],
  )

  const slashMatches = useMemo(() => {
    if (!slashState) return []
    const p = slashState.prefix
    return SLASH_COMMANDS.filter(c => c.name.startsWith(p)).slice(0, 8)
  }, [slashState])

  useEffect(() => { setSelectedIdx(0) }, [slashState?.prefix, mentionState?.query])

  // ── File search (debounced) ──
  useEffect(() => {
    if (!mentionState || !cwd) { setFileHits([]); return }
    let cancelled = false
    setFileSearching(true)
    const q = mentionState.query
    const id = setTimeout(async () => {
      try {
        const api = (window as any).electron?.files
        if (!api?.search) { setFileHits([]); setFileSearching(false); return }
        const res = await api.search({ cwd, query: q, limit: 12 })
        if (cancelled) return
        setFileHits(res?.ok && res.files ? res.files : [])
      } catch {
        if (!cancelled) setFileHits([])
      } finally {
        if (!cancelled) setFileSearching(false)
      }
    }, 70)
    return () => { cancelled = true; clearTimeout(id) }
  }, [mentionState?.query, cwd, mentionState])

  const slashPopupOpen = slashMatches.length > 0
  const mentionPopupOpen = !!mentionState && !slashPopupOpen && (fileHits.length > 0 || fileSearching)

  const acceptSlashSuggestion = useCallback((cmd: SlashCommand) => {
    onChange('/' + cmd.name + (cmd.args ? ' ' : ''))
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 220) + 'px'
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    })
  }, [onChange])

  const acceptFileSuggestion = useCallback((file: FileHit) => {
    if (!mentionState) return
    const inserted = file.dir ? `@${file.path}/` : `@${file.path} `
    const next = value.slice(0, mentionState.start) + inserted + value.slice(mentionState.end)
    const nextCaret = mentionState.start + inserted.length
    onChange(next)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 220) + 'px'
      el.focus()
      el.selectionStart = el.selectionEnd = nextCaret
      setCaret(nextCaret)
    })
  }, [mentionState, onChange, value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashPopupOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => (i + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        acceptSlashSuggestion(slashMatches[selectedIdx])
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const cmd = slashMatches[selectedIdx]
        if (cmd && value.toLowerCase() === '/' + cmd.name) {
          // Exact match — fall through to normal send
        } else if (cmd) {
          e.preventDefault()
          acceptSlashSuggestion(cmd)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onChange('')
        return
      }
    } else if (mentionPopupOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => (i + 1) % Math.max(1, fileHits.length))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => (i - 1 + Math.max(1, fileHits.length)) % Math.max(1, fileHits.length))
        return
      }
      if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && fileHits[selectedIdx]) {
        e.preventDefault()
        acceptFileSuggestion(fileHits[selectedIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Collapse popup by deleting the @ so parseMentionAtCaret returns null.
        // Simpler: move caret outside the mention token by inserting a space.
        if (mentionState) {
          const next = value.slice(0, mentionState.end) + ' ' + value.slice(mentionState.end)
          onChange(next)
          requestAnimationFrame(() => {
            const el = textareaRef.current
            if (!el) return
            el.selectionStart = el.selectionEnd = mentionState.end + 1
            setCaret(mentionState.end + 1)
          })
        }
        return
      }
    }
    onKeyDown(e)
  }

  const handleSend = () => {
    if (!disabled && !isLoading && (value.trim() || hasAttachments)) {
      onSend()
    }
  }

  // Allow sending image-only messages — same as Claude Desktop / ChatGPT.
  const canSend = !disabled && !isLoading && (!!value.trim() || hasAttachments)

  const syncCaret = () => {
    const el = textareaRef.current
    if (el) setCaret(el.selectionStart ?? el.value.length)
  }

  return (
    <div className="relative">
      {slashPopupOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden shadow-lg z-10"
          style={{
            backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
            border: '1px solid var(--theme-hairline-strong)',
          }}
        >
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider opacity-50" style={{ color: 'var(--theme-muted)' }}>
            Slash commands
          </div>
          <div className="max-h-[280px] overflow-y-auto pb-1">
            {slashMatches.map((cmd, i) => {
              const isActive = i === selectedIdx
              const Icon = cmd.icon
              return (
                <button
                  key={cmd.name}
                  onMouseDown={(e) => { e.preventDefault(); acceptSlashSuggestion(cmd) }}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors ${isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                >
                  <Icon
                    size={12}
                    strokeWidth={1.8}
                    style={{ color: isActive ? 'var(--theme-primary)' : 'var(--theme-muted)' }}
                  />
                  <span className="font-mono" style={{ color: isActive ? 'var(--theme-primary)' : 'var(--theme-text)' }}>
                    /{cmd.name}
                  </span>
                  {cmd.args && (
                    <span className="font-mono text-[11px] opacity-50" style={{ color: 'var(--theme-muted)' }}>
                      {cmd.args}
                    </span>
                  )}
                  <span className="ml-auto text-[11.5px] opacity-70 truncate" style={{ color: 'var(--theme-muted)' }}>
                    {cmd.description}
                  </span>
                </button>
              )
            })}
          </div>
          <div
            className="px-3 py-1.5 text-[10.5px] opacity-50 flex items-center gap-3"
            style={{ borderTop: '1px solid var(--theme-hairline)', color: 'var(--theme-muted)' }}
          >
            <span>↑↓ navigate</span>
            <span>⇥ complete</span>
            <span>⏎ run</span>
            <span>⎋ clear</span>
          </div>
        </div>
      )}

      {mentionPopupOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden shadow-lg z-10"
          style={{
            backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
            border: '1px solid var(--theme-hairline-strong)',
          }}
        >
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider opacity-50 flex items-center gap-1.5" style={{ color: 'var(--theme-muted)' }}>
            <AtSign size={10} strokeWidth={2} />
            <span>Files</span>
            {mentionState?.query && (
              <span className="opacity-70 normal-case tracking-normal">· matching "{mentionState.query}"</span>
            )}
            {fileSearching && <span className="opacity-60 normal-case tracking-normal">· searching…</span>}
          </div>
          <div className="max-h-[280px] overflow-y-auto pb-1">
            {fileHits.length === 0 && !fileSearching && (
              <div className="px-3 py-2 text-[12px] opacity-60" style={{ color: 'var(--theme-muted)' }}>
                No matches. Try a different query or check the working directory.
              </div>
            )}
            {fileHits.map((f, i) => {
              const isActive = i === selectedIdx
              const Icon = iconForFile(f)
              const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
              return (
                <button
                  key={f.path}
                  onMouseDown={(e) => { e.preventDefault(); acceptFileSuggestion(f) }}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] transition-colors ${isActive ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
                >
                  <Icon
                    size={12}
                    strokeWidth={1.8}
                    style={{ color: isActive ? 'var(--theme-primary)' : 'var(--theme-muted)' }}
                  />
                  <span className="font-mono truncate" style={{ color: isActive ? 'var(--theme-primary)' : 'var(--theme-text)' }}>
                    {f.name}{f.dir ? '/' : ''}
                  </span>
                  {parent && (
                    <span className="font-mono text-[11px] opacity-50 truncate" style={{ color: 'var(--theme-muted)' }}>
                      {parent}
                    </span>
                  )}
                  {f.ext && (
                    <span className="ml-auto font-mono text-[10.5px] opacity-60" style={{ color: 'var(--theme-muted)' }}>
                      .{f.ext}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div
            className="px-3 py-1.5 text-[10.5px] opacity-50 flex items-center gap-3"
            style={{ borderTop: '1px solid var(--theme-hairline)', color: 'var(--theme-muted)' }}
          >
            <span>↑↓ navigate</span>
            <span>⇥ insert</span>
            <span>⏎ insert</span>
            <span>⎋ dismiss</span>
          </div>
        </div>
      )}

      <div
        className="input-shell relative rounded-2xl transition-all duration-150"
        style={{
          backgroundColor: 'var(--theme-bg-raised)',
          border: '1px solid transparent',
          boxShadow: '0 1px 0 0 var(--theme-hairline) inset',
        }}
      >
        {(hasAttachments || attachBusy) && (
          <div
            className="flex flex-wrap gap-2 px-3 pt-3"
            style={{ borderBottom: '1px solid var(--theme-hairline)' }}
          >
            {liveAttachments.map((att) => (
              <div
                key={att.id}
                className="relative group/att flex items-center gap-2 pr-2 rounded-lg overflow-hidden animate-segment-in"
                style={{
                  backgroundColor: 'var(--theme-bg-subtle)',
                  border: '1px solid var(--theme-hairline)',
                }}
                title={att.name || `${att.width}×${att.height}`}
              >
                <img
                  src={att.dataUrl}
                  alt={att.name ?? 'attachment'}
                  className="block h-10 w-10 object-cover shrink-0"
                  draggable={false}
                />
                <div className="flex flex-col min-w-0 max-w-[140px] py-1">
                  <span className="text-[11.5px] truncate" style={{ color: 'var(--theme-text)' }}>
                    {att.name || 'image'}
                  </span>
                  <span className="text-[10.5px] opacity-60 font-mono" style={{ color: 'var(--theme-muted)' }}>
                    {att.width && att.height ? `${att.width}×${att.height}` : 'image'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity"
                  style={{
                    backgroundColor: 'var(--theme-bg)',
                    border: '1px solid var(--theme-hairline-strong)',
                    color: 'var(--theme-muted)',
                  }}
                  title="Remove"
                >
                  <X size={9} strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {attachBusy && (
              <div
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] font-mono"
                style={{
                  backgroundColor: 'var(--theme-bg-subtle)',
                  border: '1px dashed var(--theme-hairline-strong)',
                  color: 'var(--theme-muted)',
                }}
              >
                <LucideImageIcon size={11} className="animate-pulse" />
                processing…
              </div>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          onPaste={handlePaste}
          placeholder="Message codemaxxing… (try / for commands, @ for files, paste images)"
          disabled={disabled || isLoading}
          className="w-full bg-transparent resize-none outline-none text-[14px] leading-[1.55] px-4 pt-3.5 pb-12 min-h-[60px] max-h-[220px] placeholder:opacity-50"
          style={{
            color: 'var(--theme-text)',
          }}
          rows={1}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement
            target.style.height = 'auto'
            target.style.height = Math.min(target.scrollHeight, 220) + 'px'
          }}
        />
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={handlePickFiles}
              disabled={disabled || isLoading}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              style={{ color: 'var(--theme-muted)' }}
              title="Attach image"
            >
              <Paperclip size={13} strokeWidth={2} />
            </button>
            {modelLabel && (
              <span
                className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-mono max-w-[220px]"
                style={{
                  backgroundColor: 'var(--theme-bg-subtle)',
                  border: '1px solid var(--theme-hairline)',
                  color: 'var(--theme-muted)',
                }}
                title={`Current model · ${modelLabel}`}
              >
                <Cpu size={11} strokeWidth={2} className="shrink-0" style={{ color: 'var(--theme-primary)' }} />
                <span className="truncate">{modelLabel}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onToggleMode && mode && (
              <div
                className="flex items-center rounded-full p-0.5 text-[11px] font-medium select-none"
                style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-hairline)' }}
                title="Agent runs tools & edits files · Chat is conversation-only"
              >
                {(['code', 'chat'] as const).map((m) => {
                  const active = mode === m
                  const label = m === 'code' ? 'Agent' : 'Chat'
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled || isLoading}
                      onClick={() => { if (mode !== m) onToggleMode() }}
                      className="px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: active ? 'color-mix(in srgb, var(--theme-primary) 18%, transparent)' : 'transparent',
                        color: active ? 'var(--theme-primary)' : 'var(--theme-muted)',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              style={{
                backgroundColor: canSend ? 'var(--theme-primary)' : 'var(--theme-bg-subtle)',
                color: canSend ? 'var(--theme-bg)' : 'var(--theme-muted)',
                boxShadow: canSend ? '0 2px 8px color-mix(in srgb, var(--theme-primary) 35%, transparent)' : 'none',
              }}
              title="Send (⏎)"
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
