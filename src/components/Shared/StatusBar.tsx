import React from 'react'
import { useAppStore } from '../../store/appStore'

function formatTokens(n: number): string {
  if (n < 1_000) return n.toString()
  if (n < 1_000_000) return (n / 1_000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

/** 1234 → "1.2k", 128000 → "128k", 2000000 → "2M". Mirrors formatContextSize in electron/core/modelContext.ts */
function formatContextSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

function formatCost(n: number): string {
  if (n < 0.01) return '<$0.01'
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function formatTps(tps: number): string {
  if (tps >= 100) return `${Math.round(tps)} tok/s`
  return `${tps.toFixed(1)} tok/s`
}

/** basename without trailing slash. "/Users/foo/bar/" → "bar". "~/" → "~". */
function basename(p: string): string {
  if (!p) return ''
  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx < 0) return trimmed
  return trimmed.slice(idx + 1) || trimmed
}

/**
 * 8-segment unicode gauge, mirrors the CLI TUI status bar.
 * Green under 50%, amber 50–80%, red above 80%.
 */
function Gauge({ fill, danger }: { fill: number; danger: { color: string } }): React.ReactElement {
  const pct = Math.max(0, Math.min(1, fill))
  const filled = Math.round(pct * 8)
  const cells = Array.from({ length: 8 }, (_, i) => i < filled)
  return (
    <span
      className="inline-flex items-center gap-[1px] font-mono leading-none select-none"
      title={`Context ${Math.round(pct * 100)}% used`}
    >
      {cells.map((on, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 4,
            height: 8,
            backgroundColor: on
              ? danger.color
              : 'color-mix(in srgb, var(--theme-muted) 25%, transparent)',
            borderRadius: 1,
          }}
        />
      ))}
    </span>
  )
}

export function StatusBar() {
  const activeSession = useAppStore((s) => s.activeSession)
  const isRunning = useAppStore((s) => s.isRunning)
  const currentUsage = useAppStore((s) => s.currentUsage)
  const lastPromptTokens = useAppStore((s) => s.lastPromptTokens)
  const currentStats = useAppStore((s) => s.currentStats)

  if (!activeSession) return null

  const sessionCost = activeSession.estimatedCost ?? 0
  const messageCount = activeSession.messages?.length ?? 0
  const contextWindow = currentStats?.contextWindow ?? 128_000
  // Best proxy for current context fill: last observed prompt_tokens for a
  // single API call (matches what the model actually saw on its last turn).
  const contextUsed = lastPromptTokens ?? 0
  const fill = contextWindow > 0 ? contextUsed / contextWindow : 0

  // Gauge colour
  const gaugeColor =
    fill > 0.8 ? 'var(--theme-error)' :
    fill > 0.5 ? 'var(--theme-warning)' :
                 'var(--theme-success)'

  return (
    <div
      className="h-7 flex items-center justify-between px-3 text-[11px] select-none"
      style={{
        backgroundColor: 'var(--theme-bg-subtle)',
        color: 'var(--theme-muted)',
        borderTop: '1px solid var(--theme-hairline)',
      }}
    >
      {/* ── Left cluster: state + cwd + msgs ── */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: isRunning ? 'var(--theme-warning)' : 'var(--theme-success)',
              boxShadow: isRunning
                ? '0 0 6px color-mix(in srgb, var(--theme-warning) 60%, transparent)'
                : '0 0 6px color-mix(in srgb, var(--theme-success) 50%, transparent)',
            }}
          />
          <span className="opacity-80 font-mono tracking-tight">{isRunning ? 'working' : 'ready'}</span>
        </span>

        {activeSession.cwd && (
          <span className="font-mono truncate opacity-70" title={activeSession.cwd}>
            <span className="opacity-50">~/</span>{basename(activeSession.cwd)}
          </span>
        )}

        {messageCount > 0 && (
          <span className="font-mono opacity-60 whitespace-nowrap" title="Messages in this session">
            {messageCount} msg{messageCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* ── Right cluster: gauge, tokens, cost, model, tok/s ── */}
      <div className="flex items-center gap-2.5 font-mono">
        {contextWindow > 0 && (
          <span className="flex items-center gap-1.5" title={`${formatContextSize(contextUsed)} of ${formatContextSize(contextWindow)} context used`}>
            <Gauge fill={fill} danger={{ color: gaugeColor }} />
            <span className="text-[10.5px] opacity-70">
              ~{formatContextSize(contextUsed)}/{formatContextSize(contextWindow)}
            </span>
          </span>
        )}

        {currentUsage && isRunning && (
          <span
            className="px-1.5 py-0.5 rounded text-[10.5px]"
            style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)', color: 'var(--theme-muted)' }}
            title="Tokens in the current turn"
          >
            <span className="opacity-60">Δ</span>{' '}
            {formatTokens(currentUsage.promptTokens)}/{formatTokens(currentUsage.completionTokens)}
          </span>
        )}

        {sessionCost > 0 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10.5px]"
            style={{ backgroundColor: 'var(--theme-bg-raised)', color: 'var(--theme-text)', opacity: 0.85 }}
            title="Estimated session cost"
          >
            {formatCost(sessionCost)}
          </span>
        )}

        {activeSession.model && (
          <span className="text-[10.5px] opacity-65 whitespace-nowrap" title={`${activeSession.provider ?? ''} / ${activeSession.model}`}>
            {activeSession.model}
          </span>
        )}

        {currentStats?.isLocal && currentStats.tokensPerSecond != null && currentStats.tokensPerSecond > 0 && (
          <span
            className="px-1.5 py-0.5 rounded text-[10.5px] font-medium whitespace-nowrap"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-success) 12%, transparent)',
              color: 'var(--theme-success)',
              border: '1px solid color-mix(in srgb, var(--theme-success) 25%, transparent)',
            }}
            title="Local inference throughput"
          >
            {formatTps(currentStats.tokensPerSecond)}
          </span>
        )}
      </div>
    </div>
  )
}
