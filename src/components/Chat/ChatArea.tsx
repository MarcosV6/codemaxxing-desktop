import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useAppStore } from '../../store/appStore'
import { relativePathWithin } from '../../utils/platform'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { AskUserPrompt } from './AskUserPrompt'
import { PlanBanner } from './PlanBanner'
import { Square, Zap, FlaskConical, Wand2, Bug, ArrowRight, Upload, Globe, Lightbulb, BookOpen, MessageCircle } from 'lucide-react'
import type { ImageAttachment, MessageSegment, ChatMessage } from '../../types'
import { imageFilesFrom, processImageFiles } from '../../utils/imageAttach'

// Mirrors SPINNER_MESSAGES in the CLI TUI (src/index.tsx in ~/Projects/codemaxxing)
// — keep in sync manually since this repo doesn't import from the CLI.
const IDLE_MESSAGES = [
  // OG
  'Locking in…', 'Cooking…', 'Maxxing…', 'In the zone…',
  'Yapping…', 'Frame mogging…', 'Jester gooning…', 'Gooning…',
  'Doing back flips…', 'Jester maxxing…', 'Getting baked…',
  'Blasting tren…', 'Pumping…', 'Wondering if I should actually do this…',
  'Hacking the main frame…', 'Codemaxxing…', 'Vibe coding…', 'Running a marathon…',
  // Gym/Looksmaxxing
  'Mewing aggressively…', 'Looksmaxxing your codebase…', 'Hitting a PR on this function…',
  'Eating 4000 calories of code…', 'Creatine loading…', 'On my bulk arc…',
  'Warming up the deadlift…',
  // Brainrot/Skibidi
  'Going full skibidi…', 'Sigma grinding…', 'Rizzing up the compiler…',
  'No cap processing…', 'Main character coding…', "It's giving implementation…",
  "This code is bussin fr fr…", 'Aura check in progress…', 'Erm what the sigma…',
  // Deranged/Unhinged
  'Ascending to a higher plane…', 'Achieving final form…', 'Third eye compiling…',
  'Astral projecting through your repo…', 'Becoming one with the codebase…',
  'Having a spiritual awakening…', 'Entering the shadow realm…', 'Going goblin mode…',
  'Deleting System32… jk…', 'Sacrificing tokens to the GPU gods…',
  'Summoning the machine spirit…',
  // Self-aware/Meta
  'Pretending to think really hard…', 'Staring at your code judgmentally…',
  'Rethinking my career choices…', 'Having an existential crisis…',
  'Hoping this actually works…', 'Praying to the stack overflow gods…',
  'Copying from the internet with dignity…',
  // Pure Chaos
  'Doing hot yoga in the terminal…', 'Microdosing your dependencies…',
  'Running on 3 hours of sleep…', 'Speedrunning your deadline…',
  'Built different rn…', "That's crazy let me cook…",
  'Absolutely feral right now…', 'Ong no cap fr fr…',
  'Living rent free in your RAM…', 'Ate and left no crumbs…',
]

function labelFor(segments: MessageSegment[], idleIdx: number): string {
  const idle = IDLE_MESSAGES[idleIdx % IDLE_MESSAGES.length]
  const last = segments[segments.length - 1]
  if (!last) return idle
  if (last.kind === 'tool') {
    // Tool-specific status is more informative than a random idle message
    // while the tool is actively in-flight or awaiting user action.
    if (last.call.status === 'running') return `Running ${last.call.name}…`
    if (last.call.status === 'pending') return `Awaiting approval for ${last.call.name}…`
    if (last.call.status === 'error' || last.call.status === 'denied') return 'Recovering…'
    return idle // tool done, back to idle chatter while next step spins up
  }
  // For text/thinking we just keep the rotating fun messages like the TUI.
  return idle
}

/** Persistent tail indicator shown whenever an agent run is in-flight.
 *  Matches the CLI's behavior where the spinner is always present during a
 *  run, with a message that reflects the current stage. */
function WorkingIndicator({ segments }: { segments: MessageSegment[] }) {
  const [idleIdx, setIdleIdx] = useState(() => Math.floor(Math.random() * IDLE_MESSAGES.length))
  useEffect(() => {
    // TUI cycles every ~3s with a fresh random pick each tick.
    const t = setInterval(
      () => setIdleIdx(() => Math.floor(Math.random() * IDLE_MESSAGES.length)),
      3000,
    )
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex items-center gap-2.5 py-2 animate-fade-in">
      <span
        className="block h-[3px] w-6 rounded-full animate-pulse-bar"
        style={{ backgroundColor: 'var(--theme-primary)' }}
      />
      <span className="text-[12.5px]" style={{ color: 'var(--theme-muted)' }}>
        {labelFor(segments, idleIdx)}
      </span>
    </div>
  )
}

type EmptySuggestion = { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; hint: string }

const EMPTY_SUGGESTIONS_CODE: EmptySuggestion[] = [
  { icon: Bug,          label: 'Debug the thing that broke',   hint: 'paste a stack trace and we cook' },
  { icon: Wand2,        label: 'Refactor this mess',           hint: 'point me at a file or folder' },
  { icon: Zap,          label: 'Make it fast',                 hint: 'which endpoint / page / loop?' },
  { icon: FlaskConical, label: 'Write tests for real',         hint: 'tell me the cases you care about' },
]

/** Chat-mode quickstarts — no filesystem/coding implications, just things
 *  you'd reasonably ask a frontier model with web search. */
const EMPTY_SUGGESTIONS_CHAT: EmptySuggestion[] = [
  { icon: Globe,         label: 'Search the web and summarize',     hint: 'ask about anything happening right now' },
  { icon: BookOpen,      label: 'Explain something to me',           hint: 'a concept, a paper, a tweet — go deep' },
  { icon: Lightbulb,     label: 'Brainstorm with me',                hint: 'ideas, names, angles — bounce things around' },
  { icon: MessageCircle, label: 'Just yap',                          hint: 'no agenda, no tools — vibes only' },
]

/** Browser-mode quickstarts — the agent drives the live page. */
const EMPTY_SUGGESTIONS_BROWSER: EmptySuggestion[] = [
  { icon: Globe,     label: 'Open a site for me',          hint: 'name it or paste a URL' },
  { icon: BookOpen,  label: 'Read this page & summarize',   hint: 'open a page, then ask' },
  { icon: Lightbulb, label: 'Research across a few tabs',   hint: "I'll browse and compare" },
  { icon: Zap,       label: 'Search and click through',     hint: 'e.g. find the docs for X' },
]

/** Taglines rotated in the empty state — same energy as the TUI spinner
 *  messages, just quieter since this is the first thing people see. */
const EMPTY_TAGLINES_CODE = [
  "let's cook",
  'time to lock in',
  'what are we building',
  'drop a file, paste a trace, or just yap',
  'ready to codemax',
]

const EMPTY_TAGLINES_CHAT = [
  'what\'s on your mind',
  'ask me anything',
  'let\'s talk',
  'no files, no shell — just us',
  'web search on, vibes high',
]

const EMPTY_TAGLINES_BROWSER = [
  'where to?',
  'name a site, I\'ll drive',
  'I can read, click + type',
  'point me at the web',
  'let\'s browse',
]

/** Landing screen for a brand-new session. Swaps out once there's any
 *  message history. Mirrors the TUI's playfulness — ASCII-ish wordmark,
 *  rotating tagline, and fun suggestion cards that feel like quick-picks
 *  rather than corporate templates. */
function EmptyState({ onPick, mode }: { onPick: (label: string) => void; mode: 'code' | 'chat' | 'browser' }) {
  const taglines = mode === 'chat' ? EMPTY_TAGLINES_CHAT : mode === 'browser' ? EMPTY_TAGLINES_BROWSER : EMPTY_TAGLINES_CODE
  const suggestions = mode === 'chat' ? EMPTY_SUGGESTIONS_CHAT : mode === 'browser' ? EMPTY_SUGGESTIONS_BROWSER : EMPTY_SUGGESTIONS_CODE
  const [tagIdx] = useState(() => Math.floor(Math.random() * taglines.length))
  const badgeLabel = mode === 'chat' ? 'chat mode' : mode === 'browser' ? 'browser agent' : 'codemaxxing'
  const subtitle = mode === 'chat'
    ? 'pick a quickstart, or just start typing — web search is enabled'
    : mode === 'browser'
      ? 'pick a quickstart, or just start typing — I can navigate, read, click + type'
      : <>pick a quickstart, or just start typing — <span className="font-mono opacity-80">/help</span> if you're lost</>
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-[600px] px-6 pb-16">
        <div className="text-center mb-8 animate-fade-in">
          <div
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-mono uppercase tracking-wider mb-4"
            style={{
              color: 'var(--theme-primary)',
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--theme-primary) 25%, transparent)',
            }}
          >
            <span
              className="block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--theme-primary)' }}
            />
            {badgeLabel}
          </div>
          <h3
            className="text-[30px] font-semibold mb-2 tracking-tight text-balance"
            style={{ color: 'var(--theme-text)' }}
          >
            {taglines[tagIdx]}
          </h3>
          <p className="text-[13px]" style={{ color: 'var(--theme-muted)' }}>
            {subtitle}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          {suggestions.map(({ icon: Icon, label, hint }, i) => (
            <button
              key={i}
              onClick={() => onPick(label)}
              className="group relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all hover:bg-white/[0.035] focus-ring animate-segment-in"
              style={{
                // Staggered entrance so the cards cascade in.
                ['--stagger-delay' as string]: `${i * 60}ms`,
                border: '1px solid transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--theme-primary) 20%, transparent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'transparent'
              }}
            >
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
                  color: 'var(--theme-primary)',
                }}
              >
                <Icon size={13} strokeWidth={2} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] leading-tight" style={{ color: 'var(--theme-text)' }}>
                  {label}
                </div>
                <div
                  className="text-[11.5px] leading-tight truncate opacity-60 mt-0.5"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  {hint}
                </div>
              </div>
              <ArrowRight
                size={13}
                className="opacity-0 group-hover:opacity-70 transition-all group-hover:translate-x-0.5"
                style={{ color: 'var(--theme-muted)' }}
              />
            </button>
          ))}
        </div>
        <div
          className="flex items-center justify-center gap-4 mt-6 text-[10.5px] font-mono opacity-40"
          style={{ color: 'var(--theme-muted)' }}
        >
          <span><kbd>⏎</kbd> send</span>
          <span>·</span>
          <span><kbd>⇧⏎</kbd> newline</span>
          <span>·</span>
          <span><kbd>/</kbd> commands</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Normalize whitespace for live-stream rendering. Local models (Qwen3,
 * Llama, etc.) frequently emit runs of `\n` between tool calls and text
 * segments. With `whitespace-pre-wrap`, every `\n` becomes a visible blank
 * line — produces a huge dead space between the last word and the spinner.
 *
 * - Collapse 3+ consecutive newlines down to 2 (preserves paragraph breaks,
 *   kills excessive vertical gaps).
 * - Trim trailing whitespace so a model that emits `text\n\n\n` doesn't
 *   render with empty space below it. The next streaming delta will rebuild
 *   the string, so this is safe during streaming.
 *
 * NOT applied to MessageBubble — that uses MarkdownText, which already
 * collapses adjacent newlines via standard markdown semantics.
 */
function normalizeStreamingText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t\n\r]+$/, '')
}

/**
 * Live tail rendered as the Virtuoso `Footer`. Reads live state directly from
 * the store so each token only re-renders this subtree, not the surrounding
 * (virtualized) message list. Pinned at the bottom of the scroll content so
 * sessionPlan / sessionAsk / WorkingIndicator visually flow after the last
 * historical message bubble.
 */
const ChatFooter = React.memo(function ChatFooter() {
  const isRunning = useAppStore((s) => s.isRunning)
  const currentSegments = useAppStore((s) => s.currentSegments)
  const pendingAsk = useAppStore((s) => s.pendingAsk)
  const pendingPlan = useAppStore((s) => s.pendingPlan)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessionAsk = pendingAsk && pendingAsk.sessionId === activeSessionId ? pendingAsk : null
  const sessionPlan = pendingPlan && pendingPlan.sessionId === activeSessionId ? pendingPlan : null
  const hasLiveContent = isRunning && currentSegments.length > 0
  if (!hasLiveContent && !isRunning && !sessionPlan && !sessionAsk) {
    // Render a small spacer so virtuoso has something to anchor against and
    // the last message has breathing room above the input box.
    return <div className="h-8" aria-hidden />
  }
  return (
    <div className="max-w-[820px] mx-auto px-6 pb-8">
      {(hasLiveContent || isRunning) && (
        <div className="mb-6 animate-fade-in flex gap-3">
          <div className="shrink-0 mt-0.5">
            <div
              className="w-[22px] h-[22px] rounded-md flex items-center justify-center font-mono text-[10px] font-bold select-none"
              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 16%, transparent)', color: 'var(--theme-primary)', boxShadow: 'inset 0 1px 0 0 var(--sheen)' }}
              aria-hidden
            >{'>_'}</div>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {currentSegments.map((seg, i) => {
              const isTail = i === currentSegments.length - 1
              const stagger = Math.min(i, 5) * 50
              const segClass = `animate-segment-in ${isTail ? 'segment-live' : ''}`
              const segStyle = { ['--stagger-delay' as string]: `${stagger}ms` } as React.CSSProperties
              if (seg.kind === 'thinking') {
                return (
                  <div key={seg.id} className={segClass} style={segStyle}>
                    <ThinkingBlock text={seg.content} live={isTail} />
                  </div>
                )
              }
              if (seg.kind === 'tool') {
                return (
                  <div key={seg.id} className={segClass} style={segStyle}>
                    <ToolCallBlock call={seg.call} />
                  </div>
                )
              }
              const display = normalizeStreamingText(seg.content)
              // After normalization the segment may be empty (whitespace-only
              // chunk between two tool calls, etc.). Skip rendering rather
              // than emitting an empty div that contributes nothing but a
              // small slice of vertical space + space-y-2 gap.
              if (!display) return null
              return (
                <div
                  key={seg.id}
                  className={`text-[14px] leading-[1.65] whitespace-pre-wrap ${segClass}`}
                  style={{ color: 'var(--theme-text)', ...segStyle }}
                >
                  {display}
                </div>
              )
            })}
            {isRunning && <WorkingIndicator segments={currentSegments} />}
          </div>
        </div>
      )}
      {sessionPlan && <PlanBanner plan={sessionPlan.plan} />}
      {sessionAsk && <AskUserPrompt ask={sessionAsk} />}
    </div>
  )
})

/** Top spacer so the first message bubble doesn't crash into the title bar. */
const ChatHeader = React.memo(function ChatHeader() {
  return <div className="h-8" aria-hidden />
})

export function ChatArea() {
  const activeSession = useAppStore((s) => s.activeSession)
  const isRunning = useAppStore((s) => s.isRunning)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const abortCurrent = useAppStore((s) => s.abortCurrent)
  const setActiveSessionMode = useAppStore((s) => s.setActiveSessionMode)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  // Underlying scroller. Virtuoso's scrollToIndex aligns to a row, but the
  // live stream renders inside Footer (below the last row), so during a stream
  // we need to push scrollTop to scrollHeight directly to keep the tail
  // visible. scrollToIndex can't reach the Footer.
  const scrollerRef = useRef<HTMLElement | null>(null)
  const followRafRef = useRef<number | null>(null)

  // User intent. False = pin to bottom on every layout change. True = user
  // has scrolled up and we should leave them alone until they come back down.
  //
  // CRITICAL ASYMMETRY (this is where the old "sometimes stops following"
  // bug lived): the flag is SET only from real user input — wheel-up, a
  // scrollbar/touch drag — never from `scroll` events. Virtuoso fires
  // programmatic scrolls when it re-measures and anchors rows; classifying
  // those as user intent disengaged auto-follow mid-stream with no way back
  // (the follow scheduler bails when the flag is true, so nothing ever
  // scrolled us down again). `scroll` events may only CLEAR the flag when
  // the viewport reaches the bottom; worst case of that rule is we keep
  // following, which is the desired default.
  const userScrolledAwayRef = useRef(false)
  // True while a pointer is held down on the scroller (scrollbar drag or
  // touch pan) — the one case where a `scroll` event IS user input.
  const pointerDownRef = useRef(false)
  // Distance-to-bottom under which scrolling re-engages auto-follow. Generous
  // so trackpad inertia that lands "almost at bottom" still re-sticks.
  const NEAR_BOTTOM_PX = 48

  // rAF-coalesced two-frame scroll-to-bottom. Two frames because Virtuoso
  // measures variable-height rows over multiple frames (first frame renders
  // a row invisibly to measure it, second frame applies the height). Writing
  // scrollTop = scrollHeight on TWO consecutive frames catches both fast
  // cases (tokens streaming into stable layout) and slow cases (new row
  // insertion, tool-call block expansion, image loads).
  //
  // Gates inside the rAF on userScrolledAwayRef so a stale schedule that
  // queued before the user scrolled up doesn't yank them back when it fires.
  const scheduleFollow = useCallback(() => {
    if (followRafRef.current != null) return
    if (userScrolledAwayRef.current) return
    followRafRef.current = requestAnimationFrame(() => {
      const el1 = scrollerRef.current
      if (el1 && !userScrolledAwayRef.current) el1.scrollTop = el1.scrollHeight
      followRafRef.current = requestAnimationFrame(() => {
        followRafRef.current = null
        const el2 = scrollerRef.current
        if (el2 && !userScrolledAwayRef.current) el2.scrollTop = el2.scrollHeight
      })
    })
  }, [])

  // Subscribe to live state imperatively so token deltas don't re-render
  // ChatArea (which would in turn cause Virtuoso to reconcile every token —
  // visibly choppy on long streams). The Footer subscribes via its own
  // selector. Up here we only need to drive scroll. ResizeObserver
  // (attached in handleScrollerRef below) handles content-size changes
  // that don't have a corresponding store event — but we keep this
  // subscription as a redundant trigger to belt-and-suspenders against
  // the case where ResizeObserver doesn't fire promptly.
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      const liveChanged =
        state.currentSegments !== prev.currentSegments ||
        state.pendingAsk !== prev.pendingAsk ||
        state.pendingPlan !== prev.pendingPlan ||
        state.isRunning !== prev.isRunning
      if (liveChanged) scheduleFollow()
    })
    return () => {
      unsub()
      if (followRafRef.current != null) {
        cancelAnimationFrame(followRafRef.current)
        followRafRef.current = null
      }
    }
  }, [scheduleFollow])

  const handleSend = useCallback(() => {
    if (!activeSession || isRunning) return
    const trimmed = input.trim()
    const hasAttachments = attachments.length > 0
    if (!trimmed && !hasAttachments) return
    // User is actively engaging — re-enable follow-the-stream behavior.
    userScrolledAwayRef.current = false
    scheduleFollow()
    void sendMessage(trimmed, hasAttachments ? attachments : undefined)
    setInput('')
    setAttachments([])
  }, [input, attachments, activeSession, isRunning, sendMessage, scheduleFollow])

  useEffect(() => {
    inputRef.current?.focus()
    // Re-stick to bottom when switching sessions — previous session's scroll
    // state shouldn't bleed over and silently suppress auto-scroll here.
    userScrolledAwayRef.current = false
    // Snap to the end of the new session's history on the next paint. Wait
    // two frames so Virtuoso has measured rows for the new data set; one
    // frame is sometimes not enough on the very first session paint.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (el) el.scrollTop = el.scrollHeight
    }))
  }, [activeSession?.id])

  // Reset staged attachments when switching sessions — they belong to the
  // pending message, not the chat history.
  useEffect(() => {
    setAttachments([])
  }, [activeSession?.id])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Drag-and-drop file attachment ──
  // Uses counter ref to avoid flicker when dragging over child elements
  // (dragenter/leave fire on each child boundary). File paths are resolved
  // via webUtils.getPathForFile which works in Electron 32+.
  const resolveDroppedPaths = useCallback((files: FileList | File[] | null): string[] => {
    if (!files) return []
    const list = Array.isArray(files) ? files : Array.from(files)
    if (list.length === 0) return []
    const paths: string[] = []
    const api = (window as any).electron?.files?.getPathForFile
    for (const f of list) {
      let p = ''
      if (typeof api === 'function') {
        try { p = api(f) } catch { /* noop */ }
      }
      // Fallback for older Electron or browser mock
      if (!p) p = (f as any).path ?? ''
      if (p) paths.push(p)
    }
    return paths
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDragOver(true)
  }, [])
  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }, [])
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragDepthRef.current = 0
    setDragOver(false)

    const allFiles = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
    const imageFiles = imageFilesFrom(allFiles)

    // Two flavors of drop:
    //   1. Image files → attach inline, just like a paste from the clipboard.
    //   2. Anything else → keep the legacy "@path" mention behavior.
    // We split rather than choose-one so dragging a mix of an image plus a
    // .ts file does the right thing for both.
    if (imageFiles.length > 0) {
      void (async () => {
        const next = await processImageFiles(imageFiles)
        if (next.length > 0) setAttachments(prev => [...prev, ...next])
      })()
    }

    const nonImageFiles = allFiles.filter(f => !imageFiles.includes(f))
    if (nonImageFiles.length === 0) return

    const paths = resolveDroppedPaths(nonImageFiles)
    if (paths.length === 0) return

    // Convert absolute paths into @mentions. If the file is inside the session
    // cwd, use a relative path; otherwise, use the absolute path.
    const cwd = activeSession?.cwd ?? ''
    const mentions = paths.map((p) => {
      const relative = cwd ? relativePathWithin(cwd, p) : null
      if (relative !== null) return '@' + (relative || '.')
      return '@' + p
    })
    const insertion = mentions.join(' ') + ' '
    setInput((prev) => {
      if (!prev) return insertion
      const needsSpace = !prev.endsWith(' ') && !prev.endsWith('\n')
      return prev + (needsSpace ? ' ' : '') + insertion
    })
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.selectionStart = el.selectionEnd = el.value.length
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 220) + 'px'
      }
    })
  }, [resolveDroppedPaths, activeSession?.cwd])

  const isEmpty = activeSession && activeSession.messages.length === 0 && !isRunning
  // Stable empty array so Virtuoso doesn't churn its keys when there's no
  // active session yet (initial render between init() resolving and the user
  // picking a session).
  const messages = useMemo<ChatMessage[]>(
    () => activeSession?.messages ?? [],
    [activeSession?.messages],
  )

  // Wire the intent listeners + content observer on the actual scroller:
  //
  //   1. `wheel` (deltaY < 0) → user is scrolling up → disengage follow
  //      immediately. Wheel-down doesn't need handling: if it reaches the
  //      bottom, the scroll handler below re-engages.
  //   2. `pointerdown`/`pointerup` → tracks scrollbar drags and touch pans;
  //      while the pointer is down, `scroll` events count as user input and
  //      classify by distance (drag up → away, drag to bottom → re-engage).
  //   3. `scroll` → with no pointer down, only ever CLEARS the away flag
  //      (distance ≤ NEAR_BOTTOM_PX). Programmatic writes and Virtuoso's
  //      internal anchoring adjustments land here; they must never be able
  //      to disengage follow (that was the stuck-scroll bug).
  //   4. ResizeObserver on the content element → schedules a follow on every
  //      layout change: token growth, tool-call expansion, image loads,
  //      message promotion from the live Footer into the list. This is the
  //      primary follow driver; the store subscription above is a redundant
  //      belt-and-suspenders trigger.
  const detachIntentListenerRef = useRef<(() => void) | null>(null)
  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    if (detachIntentListenerRef.current) {
      detachIntentListenerRef.current()
      detachIntentListenerRef.current = null
    }
    const next = (el && el !== window) ? (el as HTMLElement) : null
    scrollerRef.current = next
    if (!next) return

    const distanceToBottom = () => next.scrollHeight - next.scrollTop - next.clientHeight

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) userScrolledAwayRef.current = true
    }
    const onPointerDown = () => { pointerDownRef.current = true }
    const onPointerUp = () => { pointerDownRef.current = false }
    const onScroll = () => {
      const distance = distanceToBottom()
      if (distance <= NEAR_BOTTOM_PX) {
        // Reached the bottom by any means — re-engage following.
        userScrolledAwayRef.current = false
      } else if (pointerDownRef.current) {
        // Scrollbar drag / touch pan away from the bottom — user intent.
        userScrolledAwayRef.current = true
      }
      // Otherwise: programmatic or anchor-correction scroll. Leave intent alone.
    }
    next.addEventListener('wheel', onWheel, { passive: true })
    next.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    next.addEventListener('scroll', onScroll, { passive: true })

    // Observe the inner content element's size. Virtuoso renders a single
    // child as the scroll content; that's what we observe.
    let ro: ResizeObserver | null = null
    const inner = next.firstElementChild as HTMLElement | null
    if (inner && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        // Hand off to the rAF-coalesced scheduler. scheduleFollow re-checks
        // userScrolledAwayRef inside the rAF, so a resize fired after the
        // user scrolled up doesn't yank them back.
        scheduleFollow()
      })
      ro.observe(inner)
    }

    detachIntentListenerRef.current = () => {
      next.removeEventListener('wheel', onWheel)
      next.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      next.removeEventListener('scroll', onScroll)
      if (ro) ro.disconnect()
    }
  }, [scheduleFollow])

  // Tear down on unmount.
  useEffect(() => () => {
    if (detachIntentListenerRef.current) {
      detachIntentListenerRef.current()
      detachIntentListenerRef.current = null
    }
  }, [])
  const renderItem = useCallback(
    (_idx: number, msg: ChatMessage) => (
      <div className="max-w-[820px] mx-auto px-6">
        <MessageBubble message={msg} />
      </div>
    ),
    [],
  )
  const computeKey = useCallback((_idx: number, msg: ChatMessage) => msg.id, [])
  const virtuosoComponents = useMemo(
    () => ({ Header: ChatHeader, Footer: ChatFooter }),
    [],
  )
  const viewportPad = useMemo(() => ({ top: 200, bottom: 800 }), [])

  return (
    <div
      className="flex-1 flex flex-col h-full relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div
          className="absolute inset-3 rounded-2xl z-30 pointer-events-none flex items-center justify-center animate-fade-in"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)',
            border: '2px dashed color-mix(in srgb, var(--theme-primary) 60%, transparent)',
          }}
        >
          <div
            className="flex items-center gap-3 px-5 py-3 rounded-xl text-[14px] font-medium"
            style={{
              backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
              border: '1px solid var(--theme-hairline-strong)',
              color: 'var(--theme-primary)',
            }}
          >
            <Upload size={16} />
            <span>Drop image to attach · drop file for @reference</span>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 mask-fade-top">
        {isEmpty ? (
          <EmptyState
            mode={activeSession?.mode === 'chat' ? 'chat' : activeSession?.mode === 'browser' ? 'browser' : 'code'}
            onPick={(label) => { setInput(label); inputRef.current?.focus() }}
          />
        ) : (
          <Virtuoso
            // Re-mount per session so initialTopMostItemIndex re-fires and the
            // viewport snaps to the end of the new session's history without
            // any imperative juggling.
            key={activeSession?.id ?? 'no-session'}
            ref={virtuosoRef}
            scrollerRef={handleScrollerRef}
            data={messages}
            // Land at the most recent message on first paint. Virtuoso clamps
            // -1 to "nothing scrolled", so empty-but-mounted is fine too.
            initialTopMostItemIndex={Math.max(0, messages.length - 1)}
            // Deliberately OFF. Virtuoso's follower aligns to the last list
            // row, but our live stream renders in the Footer BELOW that row —
            // the two targets differ by the footer height, so with both
            // active each scroll corrected the other (visible up/down jitter
            // while streaming). The imperative scheduleFollow loop is the
            // single scroll authority; it targets true scrollHeight and the
            // ResizeObserver fires on every relevant layout change, including
            // a message graduating from the Footer into messages[].
            followOutput={false}
            // Overscan by ~1 viewport so animate-segment-in animations on
            // newly-promoted messages aren't visibly clipped by the recycler.
            increaseViewportBy={viewportPad}
            style={{ height: '100%' }}
            components={virtuosoComponents}
            itemContent={renderItem}
            computeItemKey={computeKey}
          />
        )}
      </div>

      <div className="shrink-0 relative">
        <div
          className="absolute inset-x-0 -top-6 h-6 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--theme-bg) 85%, transparent))',
          }}
        />
        <div className="max-w-[820px] mx-auto px-6 pb-4">
          <InputArea
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            disabled={isRunning}
            isLoading={isRunning}
            inputRef={inputRef}
            cwd={activeSession?.cwd ?? null}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            mode={activeSession?.mode === 'chat' ? 'chat' : 'code'}
            // Browser sessions aren't agent/chat — hide the toggle so it can't
            // flip the session out of browser mode.
            onToggleMode={activeSession?.mode === 'browser'
              ? undefined
              : () => { void setActiveSessionMode(activeSession?.mode === 'chat' ? 'code' : 'chat') }}
            modelLabel={activeSession?.model ?? null}
          />
          {isRunning && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => void abortCurrent()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors hover:bg-white/5 focus-ring"
                style={{ color: 'var(--theme-muted)' }}
              >
                <Square size={9} /> Stop
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
