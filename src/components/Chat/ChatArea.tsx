import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { MessageBubble } from './MessageBubble'
import { InputArea } from './InputArea'
import { ToolCallBlock } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { AskUserPrompt } from './AskUserPrompt'
import { PlanBanner } from './PlanBanner'
import { Square } from 'lucide-react'

const SPINNER_MESSAGES = [
  'Thinking…',
  'Working on it…',
  'Cooking…',
  'Locking in…',
  'Reading the code…',
  'Putting it together…',
  'Reasoning…',
  'Codemaxxing…',
]

function ThinkingIndicator() {
  const [message, setMessage] = useState(SPINNER_MESSAGES[0])

  useEffect(() => {
    const interval = setInterval(() => {
      setMessage(SPINNER_MESSAGES[Math.floor(Math.random() * SPINNER_MESSAGES.length)])
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-primary)', animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-primary)', animationDelay: '200ms' }} />
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--theme-primary)', animationDelay: '400ms' }} />
      </div>
      <span className="text-[12px]" style={{ color: 'var(--theme-muted)' }}>{message}</span>
    </div>
  )
}

export function ChatArea() {
  const activeSession = useAppStore((s) => s.activeSession)
  const isRunning = useAppStore((s) => s.isRunning)
  const currentAssistantText = useAppStore((s) => s.currentAssistantText)
  const currentThinkingText = useAppStore((s) => s.currentThinkingText)
  const currentToolCalls = useAppStore((s) => s.currentToolCalls)
  const pendingAsk = useAppStore((s) => s.pendingAsk)
  const pendingPlan = useAppStore((s) => s.pendingPlan)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const abortCurrent = useAppStore((s) => s.abortCurrent)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [activeSession?.messages, currentAssistantText, currentToolCalls, scrollToBottom])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeSession?.id])

  const handleSend = useCallback(() => {
    if (!input.trim() || !activeSession || isRunning) return
    void sendMessage(input.trim())
    setInput('')
  }, [input, activeSession, isRunning, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasLiveContent = isRunning && (currentAssistantText.length > 0 || currentToolCalls.length > 0 || currentThinkingText.length > 0)
  const isEmpty = activeSession && activeSession.messages.length === 0 && !isRunning
  const sessionAsk = pendingAsk && activeSession && pendingAsk.sessionId === activeSession.id ? pendingAsk : null
  const sessionPlan = pendingPlan && activeSession && pendingPlan.sessionId === activeSession.id ? pendingPlan : null

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md px-6 pb-16">
              <h3 className="text-[18px] font-medium mb-2 tracking-tight" style={{ color: 'var(--theme-text)' }}>
                Ready when you are
              </h3>
              <p className="text-[13px] mb-6" style={{ color: 'var(--theme-muted)' }}>
                Ask a question, describe a task, or paste code to get started.
              </p>
              <div className="grid grid-cols-2 gap-2 text-left">
                {[
                  'Help me debug this code',
                  'Review my architecture',
                  'Optimize performance',
                  'Write tests for this',
                ].map((text, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(text); inputRef.current?.focus() }}
                    className="px-3 py-2.5 rounded-lg text-left text-[12.5px] transition-colors hover:bg-white/5"
                    style={{
                      backgroundColor: 'var(--theme-bg-raised)',
                      color: 'var(--theme-muted)',
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-[760px] mx-auto py-6 px-6">
            {activeSession?.messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {hasLiveContent && (
              <div className="mb-5 animate-fade-in">
                <div className="space-y-2">
                  {currentThinkingText && <ThinkingBlock text={currentThinkingText} live />}
                  {currentToolCalls.map((tc) => <ToolCallBlock key={tc.id} call={tc} />)}
                  {currentAssistantText && (
                    <div
                      className="text-[14px] leading-[1.65] whitespace-pre-wrap"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      {currentAssistantText}
                    </div>
                  )}
                </div>
              </div>
            )}
            {isRunning && !hasLiveContent && <ThinkingIndicator />}
            {sessionPlan && <PlanBanner plan={sessionPlan.plan} />}
            {sessionAsk && <AskUserPrompt ask={sessionAsk} />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="shrink-0">
        <div className="max-w-[760px] mx-auto px-6 pb-4">
          <InputArea
            value={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            disabled={isRunning}
            isLoading={isRunning}
            inputRef={inputRef}
          />
          {isRunning && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => void abortCurrent()}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors hover:bg-white/5"
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
