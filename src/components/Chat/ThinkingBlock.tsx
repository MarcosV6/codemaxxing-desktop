import React, { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface ThinkingBlockProps {
  text: string
  live?: boolean
}

export function ThinkingBlock({ text, live = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(live)
  if (!text) return null
  return (
    <div
      className="rounded-lg text-[12.5px] overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--theme-secondary) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--theme-secondary) 20%, transparent)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.03] transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} style={{ color: 'var(--theme-secondary)' }} />
        <span className="text-[11.5px] uppercase tracking-wider font-medium" style={{ color: 'var(--theme-secondary)' }}>
          Thinking
        </span>
        {live && (
          <span className="flex gap-1 ml-1">
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-secondary)' }} />
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-secondary)', animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-secondary)', animationDelay: '300ms' }} />
          </span>
        )}
      </button>
      {open && (
        <div
          className="px-3 pb-2 pt-1 whitespace-pre-wrap leading-[1.55] opacity-80 max-h-[280px] overflow-y-auto"
          style={{ color: 'var(--theme-muted)' }}
        >
          {text}
        </div>
      )}
    </div>
  )
}
