import React, { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { MessageCircle } from 'lucide-react'
import type { PendingAsk } from '../../store/appStore'

interface Props {
  ask: PendingAsk
}

export function AskUserPrompt({ ask }: Props) {
  const [reply, setReply] = useState('')
  const respondToAsk = useAppStore((s) => s.respondToAsk)

  const submit = (value: string) => {
    if (!value.trim()) return
    void respondToAsk(value.trim())
    setReply('')
  }

  return (
    <div
      className="mb-5 rounded-xl p-4 animate-fade-in"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--theme-primary) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--theme-primary) 35%, transparent)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <MessageCircle size={13} style={{ color: 'var(--theme-primary)' }} />
        <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--theme-primary)' }}>
          Agent is asking
        </span>
      </div>
      <div className="text-[13.5px] mb-3 leading-[1.55]" style={{ color: 'var(--theme-text)' }}>
        {ask.question}
      </div>

      {ask.options && ask.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {ask.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => submit(opt)}
              className="px-3 py-1.5 rounded-md text-[12.5px] transition-colors hover:opacity-90"
              style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); submit(reply) }}
          className="flex gap-2"
        >
          <input
            autoFocus
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your answer…"
            className="flex-1 text-[13px] px-3 py-2 rounded-md outline-none"
            style={{
              backgroundColor: 'var(--theme-bg)',
              color: 'var(--theme-text)',
              border: '1px solid var(--theme-border)',
            }}
          />
          <button
            type="submit"
            disabled={!reply.trim()}
            className="px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
          >
            Reply
          </button>
        </form>
      )}
    </div>
  )
}
