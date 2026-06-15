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
    <div className="relative group my-3">
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--theme-bg-subtle)',
          border: '1px solid var(--theme-hairline)',
          boxShadow: 'var(--shadow-1), inset 0 1px 0 0 var(--sheen)',
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-wider"
          style={{
            color: 'var(--theme-muted)',
            borderBottom: '1px solid var(--theme-hairline)',
            backgroundColor: 'color-mix(in srgb, var(--theme-bg-raised) 60%, transparent)',
          }}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-primary)' }} />
            <span className="opacity-70">{lang || 'plain'}</span>
          </span>
          <button
            onClick={onCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded opacity-60 hover:opacity-100 hover:bg-white/5 transition-all focus-ring"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            <span className="normal-case tracking-normal">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <pre className="px-3.5 py-3 overflow-x-auto text-[12.5px] leading-[1.6] m-0">
          {children}
        </pre>
      </div>
    </div>
  )
}
