import React from 'react'
import { ChatMessage } from '../../types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ToolCallBlock } from './ToolCallBlock'
import { AlertCircle } from 'lucide-react'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.type === 'user') {
    return (
      <div className="mb-5 animate-fade-in flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap"
          style={{
            backgroundColor: 'var(--theme-bubble)',
            color: 'var(--theme-text)',
          }}
        >
          {message.content}
        </div>
      </div>
    )
  }

  if (message.type === 'assistant') {
    const hasText = !!message.content
    const hasTools = !!message.toolCalls?.length
    return (
      <div className="mb-5 animate-fade-in">
        <div className="space-y-2">
          {hasTools && message.toolCalls!.map((tc) => <ToolCallBlock key={tc.id} call={tc} />)}
          {hasText && (
            <div
              className="text-[14px] leading-[1.65] prose-invert"
              style={{ color: 'var(--theme-text)' }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
                  h1: ({ children }) => <h1 className="text-[18px] font-medium mt-4 mb-2 tracking-tight">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-[16px] font-medium mt-4 mb-2 tracking-tight">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-[14px] font-medium mt-3 mb-1.5">{children}</h3>,
                  pre: ({ children }) => (
                    <pre
                      className="p-3.5 rounded-lg overflow-x-auto my-3 text-[12.5px] leading-[1.55]"
                      style={{
                        backgroundColor: 'var(--theme-bg-subtle)',
                        border: '1px solid var(--theme-border)',
                      }}
                    >
                      {children}
                    </pre>
                  ),
                  code: ({ className, children }) => {
                    const isInline = !className && !children?.toString().includes('\n')
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
                    return <code className={`${className ?? ''} font-mono`}>{children}</code>
                  },
                  a: ({ href, children }) => (
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
                  blockquote: ({ children }) => (
                    <blockquote
                      className="border-l-2 pl-3 my-3 italic"
                      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-muted)' }}
                    >
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (message.type === 'error') {
    return (
      <div className="mb-4 animate-fade-in">
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-[13px]"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 10%, transparent)',
            color: 'var(--theme-error)',
          }}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{message.content}</span>
        </div>
      </div>
    )
  }

  return null
}
