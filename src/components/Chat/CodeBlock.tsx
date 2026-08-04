import React, { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  children?: React.ReactNode
  /** Language class — rehype-highlight writes `language-ts hljs` etc. */
  languageClass?: string
  /** Raw code for the copy button. We extract this from children on mount
   *  because the rehype-highlighted tree is a nest of spans. */
  rawText: string
}

function prettyLang(cls: string): string {
  // Input like "language-ts hljs" → "ts"
  const m = cls.match(/language-([a-z0-9+#-]+)/i)
  return m ? m[1] : ''
}

/** Fenced code block with a hover-revealed copy button and a tiny language
 *  badge. Renders inside a <pre> from react-markdown so we keep the native
 *  scroll / selection behavior.
 *
 *  Memoized: rawText is stable for any given fenced block in a finished
 *  message, so historical CodeBlocks don't re-run on every streaming token. */
export const CodeBlock = React.memo(CodeBlockInner)

function CodeBlockInner({ children, languageClass = '', rawText }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(async () => {
    try {
      if (window.electron?.clipboard) {
        await window.electron.clipboard.writeText(rawText)
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(rawText)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* ignore — cheaper than a toast for a non-critical action */
    }
  }, [rawText])

  const lang = prettyLang(languageClass)

  return (
    <div className="relative group my-4">
      <div className="code-surface relative rounded-xl overflow-hidden">
        <div
          className="flex items-center justify-between px-3.5 py-2 text-[10.5px] font-mono uppercase tracking-wider"
          style={{
            color: 'var(--theme-muted)',
            borderBottom: '1px solid var(--theme-hairline)',
            backgroundColor: 'color-mix(in srgb, var(--theme-bg-raised) 60%, transparent)',
          }}
        >
          <span className="flex items-center gap-2.5">
            <span className="flex items-center gap-1" aria-hidden>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-error)', opacity: 0.7 }} />
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-warning)', opacity: 0.7 }} />
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-success)', opacity: 0.7 }} />
            </span>
            <span className="opacity-75">{lang || 'plain text'}</span>
          </span>
          <button
            onClick={onCopy}
            className="toolbar-chip flex items-center gap-1.5 px-2 py-1 rounded-md opacity-75 hover:opacity-100 focus-ring"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            <span className="normal-case tracking-normal">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <pre className="px-4 py-3.5 overflow-x-auto text-[12.5px] leading-[1.65] m-0">
          {children}
        </pre>
      </div>
    </div>
  )
}
