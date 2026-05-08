import React, { useState, useCallback, useEffect } from 'react'
import { ChatMessage, ImageAttachment, MessageSegment } from '../../types'
import { useAppStore } from '../../store/appStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { CodeBlock } from './CodeBlock'
import { AlertCircle, Copy, Check, X, Layers, RotateCw, MessageSquarePlus, Settings as SettingsIcon } from 'lucide-react'

interface MessageBubbleProps {
  message: ChatMessage
}

/** Recursively flatten a react-markdown node tree into plain text so the
 *  copy button can hand back exactly what the model wrote (no <span> soup). */
function extractText(node: React.ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-[18px] font-medium mt-4 mb-2 tracking-tight">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-[16px] font-medium mt-4 mb-2 tracking-tight">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-[14px] font-medium mt-3 mb-1.5">{children}</h3>,
  pre: ({ children }: { children?: React.ReactNode }) => {
    // react-markdown passes a single <code> child for fenced blocks.
    let languageClass = ''
    let innerChildren: React.ReactNode = children
    if (React.isValidElement(children)) {
      const codeProps = children.props as { className?: string; children?: React.ReactNode }
      languageClass = codeProps.className ?? ''
      innerChildren = (
        <code className={codeProps.className}>{codeProps.children}</code>
      )
    }
    const rawText = extractText(children).replace(/\n$/, '')
    return <CodeBlock languageClass={languageClass} rawText={rawText}>{innerChildren}</CodeBlock>
  },
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    // Inline code only — fenced code is routed through `pre` above so it
    // gets the CodeBlock chrome + copy button.
    const isInline = !className || !/language-/.test(className)
    if (isInline) {
      return (
        <code
          className="px-1.5 py-0.5 rounded text-[12.5px] font-mono"
          style={{
            backgroundColor: 'var(--theme-bg-raised)',
            color: 'var(--theme-text)',
          }}
        >
          {children}
        </code>
      )
    }
    return <code className={className}>{children}</code>
  },
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      style={{ color: 'var(--theme-primary)' }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote
      className="border-l-2 pl-3 my-3 italic"
      style={{ borderColor: 'var(--theme-hairline-strong)', color: 'var(--theme-muted)' }}
    >
      {children}
    </blockquote>
  ),
}

const MarkdownText = React.memo(function MarkdownText({ text }: { text: string }) {
  return (
    <div
      className="text-[14px] leading-[1.65] prose-invert"
      style={{ color: 'var(--theme-text)' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

/** Small toolbar revealed on hover over an assistant message. */
function MessageActions({ rawText }: { rawText: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    try {
      if (window.electron?.clipboard) await window.electron.clipboard.writeText(rawText)
      else if (navigator.clipboard) await navigator.clipboard.writeText(rawText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {/* noop */}
  }, [rawText])
  return (
    <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity flex items-center gap-1 mt-1">
      <button
        onClick={onCopy}
        className="flex items-center gap-1 px-1.5 py-1 rounded text-[10.5px] hover:bg-white/[0.04] focus-ring"
        style={{ color: 'var(--theme-muted)' }}
        title={copied ? 'Copied!' : 'Copy message'}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

/** Plain-text representation of an assistant message, used by the copy
 *  button. Keeps tool calls out (user just wants the prose). */
function segmentsToPlain(segments: MessageSegment[] | undefined, fallback: string): string {
  if (!segments || segments.length === 0) return fallback
  return segments
    .filter(s => s.kind === 'text')
    .map(s => (s as { content: string }).content)
    .join('\n\n')
    .trim() || fallback
}

/** Click-to-zoom lightbox for an attached image. Esc / backdrop closes. */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8 animate-fade-in cursor-zoom-out"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'white' }}
        title="Close (Esc)"
      >
        <X size={16} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  )
}

function UserImageGrid({ images }: { images: ImageAttachment[] }) {
  const [zoom, setZoom] = useState<ImageAttachment | null>(null)
  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setZoom(img)}
            className="relative block rounded-lg overflow-hidden focus-ring transition-transform active:scale-[0.98]"
            style={{ border: '1px solid var(--theme-hairline)' }}
            title={img.name || `${img.width}×${img.height}`}
          >
            <img
              src={img.dataUrl}
              alt={img.name ?? 'attachment'}
              className="block max-w-[260px] max-h-[260px] object-cover"
              draggable={false}
            />
          </button>
        ))}
      </div>
      {zoom && (
        <ImageLightbox
          src={zoom.dataUrl}
          alt={zoom.name ?? 'attachment'}
          onClose={() => setZoom(null)}
        />
      )}
    </>
  )
}

/**
 * Wrapped in React.memo so persisted (historical) message bubbles don't
 * re-render every time a new token streams into the live tail. Each ChatMessage
 * has a stable id; React.memo's default shallow-equal sees the same `message`
 * reference and skips the (very expensive) ReactMarkdown + rehype-highlight
 * render. Live segments are rendered separately by ChatArea (not via this
 * component), so memoizing here is safe and never staling out the live view.
 */
export const MessageBubble = React.memo(MessageBubbleInner, (prev, next) => prev.message === next.message)

function MessageBubbleInner({ message }: MessageBubbleProps) {
  if (message.type === 'user') {
    const hasImages = !!message.images && message.images.length > 0
    const hasText = !!message.content
    return (
      <div className="mb-5 animate-fade-in flex flex-col items-end">
        {hasImages && <UserImageGrid images={message.images!} />}
        {hasText && (
          <div
            className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap"
            style={{
              backgroundColor: 'var(--theme-bubble)',
              color: 'var(--theme-text)',
            }}
          >
            {message.content}
          </div>
        )}
      </div>
    )
  }

  if (message.type === 'assistant') {
    const plain = segmentsToPlain(message.segments, message.content)
    // Prefer ordered segments when the message has them — preserves the
    // temporal interleaving of text and tool calls that actually happened.
    if (message.segments && message.segments.length > 0) {
      return (
        <div className="mb-5 animate-fade-in group/msg">
          <div className="space-y-2">
            {message.segments.map((seg) => {
              if (seg.kind === 'thinking') return <ThinkingBlock key={seg.id} text={seg.content} />
              if (seg.kind === 'tool') return <ToolCallBlock key={seg.id} call={seg.call} />
              return <MarkdownText key={seg.id} text={seg.content} />
            })}
          </div>
          {plain && <MessageActions rawText={plain} />}
        </div>
      )
    }

    // Legacy fallback: messages persisted before the segment refactor.
    const hasText = !!message.content
    const hasTools = !!message.toolCalls?.length
    return (
      <div className="mb-5 animate-fade-in group/msg">
        <div className="space-y-2">
          {hasTools && message.toolCalls!.map((tc) => <ToolCallBlock key={tc.id} call={tc} />)}
          {hasText && <MarkdownText text={message.content} />}
        </div>
        {hasText && <MessageActions rawText={message.content} />}
      </div>
    )
  }

  if (message.type === 'error') {
    return <ErrorBanner message={message} />
  }

  return null
}

/**
 * Actionable error banner. Generic errors render as a plain red banner;
 * classified errors (context_overflow, rate_limit, etc.) get a tailored
 * recovery affordance — a button that resolves the problem and re-runs
 * the user's last prompt against the recovered state.
 *
 * The classification happens at error-receipt time in the store
 * (`classifyAgentError`), so this component is purely presentational.
 */
function ErrorBanner({ message }: { message: ChatMessage }) {
  const compactAndRetry = useAppStore((s) => s.compactAndRetry)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const createSession = useAppStore((s) => s.createSession)
  const activeSession = useAppStore((s) => s.activeSession)
  const openSettings = useAppStore((s) => s.openSettings)
  const isRunning = useAppStore((s) => s.isRunning)
  const [busy, setBusy] = useState(false)

  const kind = message.errorKind ?? 'generic'
  const retryPrompt = message.retryPrompt

  // Strip the wire-protocol noise that providers prepend to error messages
  // ("Responses API stream error: ...", "Anthropic streaming error: ...")
  // — keep the human-readable detail only.
  const cleanMessage = message.content
    .replace(/^Responses API stream error:\s*/i, '')
    .replace(/^Anthropic streaming error:\s*/i, '')
    .replace(/^OpenAI streaming error:\s*/i, '')

  const handleCompactRetry = useCallback(async () => {
    if (!retryPrompt || busy || isRunning) return
    setBusy(true)
    try {
      await compactAndRetry(retryPrompt)
    } finally {
      setBusy(false)
    }
  }, [retryPrompt, busy, isRunning, compactAndRetry])

  const handleNewSessionRetry = useCallback(async () => {
    if (!activeSession || busy || isRunning) return
    setBusy(true)
    try {
      const id = await createSession({
        cwd: activeSession.cwd,
        provider: activeSession.provider,
        model: activeSession.model,
        mode: activeSession.mode,
      })
      // createSession switches to the new session for us. Send the prompt
      // there if we have one.
      if (id && retryPrompt) await sendMessage(retryPrompt)
    } finally {
      setBusy(false)
    }
  }, [activeSession, busy, isRunning, createSession, sendMessage, retryPrompt])

  const handlePlainRetry = useCallback(async () => {
    if (!retryPrompt || busy || isRunning) return
    setBusy(true)
    try {
      await sendMessage(retryPrompt)
    } finally {
      setBusy(false)
    }
  }, [retryPrompt, busy, isRunning, sendMessage])

  // Headline + helper text per kind. The text below the headline reframes
  // the failure in plain language so the user knows what they're being
  // asked to do.
  let headline: string
  let detail: string | null = null
  switch (kind) {
    case 'context_overflow':
      headline = 'This conversation is too long for the model'
      detail =
        'The history has grown past the model\'s context window. ' +
        'Compact summarizes older turns into a brief note and forks the session, then retries your message — the recent turns and the summary stay; the bulk gets folded down.'
      break
    case 'unsupported_history':
      headline = 'This server doesn\'t accept the conversation\'s tool history'
      detail =
        'Some self-hosted OpenAI-compat servers (older llama.cpp builds, llamafile, vLLM forks) reject input messages that include structured tool calls. ' +
        'Compact rewrites the history as a clean prose summary — drops the structured tool fields the server can\'t parse — and retries your message. The model keeps the gist of what was done previously without choking on the wire format.'
      break
    case 'rate_limit':
      headline = 'Provider rate limit hit'
      detail = 'The provider is asking us to slow down. Retry shortly.'
      break
    case 'auth':
      headline = 'Authentication issue'
      detail = 'Your credentials are missing, expired, or rejected. Check Settings → Providers.'
      break
    case 'network':
      headline = 'Network error'
      detail = 'Couldn\'t reach the provider. If you\'re using a local model (LM Studio / Ollama), make sure the server is running.'
      break
    default:
      headline = cleanMessage
  }

  return (
    <div className="mb-4 animate-fade-in">
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--theme-error) 9%, transparent)',
          border: '1px solid color-mix(in srgb, var(--theme-error) 22%, transparent)',
        }}
      >
        <div className="flex items-start gap-2 px-3 py-2.5 text-[13px]" style={{ color: 'var(--theme-error)' }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="font-medium leading-snug">{headline}</div>
            {detail && (
              <div className="text-[12px] opacity-85 leading-relaxed" style={{ color: 'var(--theme-text)' }}>
                {detail}
              </div>
            )}
            {kind !== 'generic' && headline !== cleanMessage && (
              <details className="text-[11px] opacity-60 leading-relaxed mt-1" style={{ color: 'var(--theme-muted)' }}>
                <summary className="cursor-pointer select-none hover:opacity-100">show provider message</summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[10.5px]">{cleanMessage}</pre>
              </details>
            )}
          </div>
        </div>

        {/* Recovery actions per error kind */}
        {((kind === 'context_overflow' || kind === 'unsupported_history') && retryPrompt) && (
          <div
            className="flex flex-wrap items-center gap-2 px-3 py-2"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--theme-error) 16%, transparent)' }}
          >
            <ActionButton primary onClick={handleCompactRetry} disabled={busy || isRunning} icon={<Layers size={11} />}>
              {busy ? 'Compacting…' : 'Compact & retry'}
            </ActionButton>
            <ActionButton onClick={handleNewSessionRetry} disabled={busy || isRunning} icon={<MessageSquarePlus size={11} />}>
              Start fresh session
            </ActionButton>
          </div>
        )}
        {(kind === 'rate_limit' || kind === 'network') && retryPrompt && (
          <div
            className="flex flex-wrap items-center gap-2 px-3 py-2"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--theme-error) 16%, transparent)' }}
          >
            <ActionButton primary onClick={handlePlainRetry} disabled={busy || isRunning} icon={<RotateCw size={11} />}>
              {busy ? 'Retrying…' : 'Retry'}
            </ActionButton>
          </div>
        )}
        {kind === 'auth' && (
          <div
            className="flex flex-wrap items-center gap-2 px-3 py-2"
            style={{ borderTop: '1px solid color-mix(in srgb, var(--theme-error) 16%, transparent)' }}
          >
            <ActionButton primary onClick={openSettings} icon={<SettingsIcon size={11} />}>
              Open Settings
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  children, onClick, disabled, primary, icon,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      style={primary
        ? {
            color: 'var(--theme-error)',
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 16%, transparent)',
            border: '1px solid color-mix(in srgb, var(--theme-error) 32%, transparent)',
          }
        : {
            color: 'var(--theme-text)',
            backgroundColor: 'transparent',
            border: '1px solid var(--theme-hairline-strong)',
          }
      }
    >
      {icon}
      {children}
    </button>
  )
}
