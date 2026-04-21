import React, { useRef, useEffect, useMemo, useState } from 'react'
import { ArrowUp } from 'lucide-react'

interface InputAreaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  disabled: boolean
  isLoading: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}

interface SlashCommand {
  name: string
  description: string
  args?: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'diff', description: 'Show git diff', args: '[staged]' },
  { name: 'status', description: 'Show git status' },
  { name: 'log', description: 'Show recent commits', args: '[n]' },
  { name: 'commit', description: 'Stage all and commit', args: '<message>' },
  { name: 'push', description: 'Push to remote' },
  { name: 'undo', description: 'Undo the last commit (keep changes)' },
  { name: 'cost', description: 'Show session token usage and cost' },
  { name: 'compact', description: 'Summarize old history into a fresh session', args: '[keep]' },
  { name: 'checkpoint', description: 'Save a session checkpoint', args: '[label]' },
  { name: 'checkpoints', description: 'Browse saved checkpoints' },
  { name: 'skills', description: 'Show active skill packs' },
  { name: 'think', description: 'Set reasoning effort', args: '<off|low|medium|high|max>' },
  { name: 'memory', description: 'Show memory stats or recall', args: '[query]' },
  { name: 'bg', description: 'Open background agents drawer' },
  { name: 'cron', description: 'Open scheduled tasks drawer' },
  { name: 'settings', description: 'Open settings' },
  { name: 'help', description: 'List all slash commands' },
]

function parseSlashPrefix(value: string): { prefix: string } | null {
  if (!value.startsWith('/')) return null
  // Only show popup while typing the command name itself (no space yet)
  const firstSpace = value.indexOf(' ')
  const firstNewline = value.indexOf('\n')
  if (firstSpace !== -1 || firstNewline !== -1) return null
  return { prefix: value.slice(1).toLowerCase() }
}

export function InputArea({
  value,
  onChange,
  onKeyDown,
  onSend,
  disabled,
  isLoading,
  inputRef,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)

  useEffect(() => {
    if (inputRef) {
      inputRef.current = textareaRef.current
    }
  }, [inputRef])

  const slashState = parseSlashPrefix(value)
  const matches = useMemo(() => {
    if (!slashState) return []
    const p = slashState.prefix
    return SLASH_COMMANDS.filter(c => c.name.startsWith(p)).slice(0, 8)
  }, [slashState])

  useEffect(() => { setSelectedIdx(0) }, [slashState?.prefix])

  const popupOpen = matches.length > 0

  const acceptSuggestion = (cmd: SlashCommand) => {
    onChange('/' + cmd.name + (cmd.args ? ' ' : ''))
    // Keep focus + trigger height reflow after state settles
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 220) + 'px'
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popupOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => (i + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => (i - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        acceptSuggestion(matches[selectedIdx])
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // If the command takes no args, accept + send; otherwise just accept
        const cmd = matches[selectedIdx]
        if (cmd && value.toLowerCase() === '/' + cmd.name) {
          // Exact match — fall through to normal send
        } else if (cmd) {
          e.preventDefault()
          acceptSuggestion(cmd)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onChange('')
        return
      }
    }
    onKeyDown(e)
  }

  const handleSend = () => {
    if (!disabled && !isLoading && value.trim()) {
      onSend()
    }
  }

  const canSend = !disabled && !isLoading && !!value.trim()

  return (
    <div className="relative">
      {popupOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden shadow-lg z-10"
          style={{
            backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))',
            border: '1px solid var(--theme-border)',
          }}
        >
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider opacity-50" style={{ color: 'var(--theme-muted)' }}>
            Slash commands
          </div>
          <div className="max-h-[280px] overflow-y-auto pb-1">
            {matches.map((cmd, i) => {
              const isActive = i === selectedIdx
              return (
                <button
                  key={cmd.name}
                  onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(cmd) }}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full flex items-baseline gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors ${isActive ? 'bg-white/10' : 'hover:bg-white/[0.04]'}`}
                >
                  <span className="font-mono" style={{ color: 'var(--theme-primary)' }}>/{cmd.name}</span>
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
            style={{ borderTop: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }}
          >
            <span>↑↓ navigate</span>
            <span>⇥ complete</span>
            <span>⏎ run</span>
            <span>⎋ clear</span>
          </div>
        </div>
      )}

      <div
        className="relative rounded-2xl transition-shadow focus-within:shadow-lg"
        style={{
          backgroundColor: 'var(--theme-bg-raised)',
          border: '1px solid var(--theme-border)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message codemaxxing… (try /help)"
          disabled={disabled || isLoading}
          className="w-full bg-transparent resize-none outline-none text-[14px] leading-[1.55] px-4 pt-3 pb-12 min-h-[56px] max-h-[220px]"
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
        <div className="absolute bottom-2 left-3 right-2 flex items-center justify-between pointer-events-none">
          <span className="text-[11px]" style={{ color: 'var(--theme-muted)', opacity: 0.6 }}>
            ⏎ send · ⇧⏎ newline · / commands
          </span>
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="pointer-events-auto w-7 h-7 rounded-full flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: canSend ? 'var(--theme-primary)' : 'var(--theme-bg-subtle)',
              color: canSend ? '#1a1814' : 'var(--theme-muted)',
            }}
            title="Send"
          >
            <ArrowUp size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
