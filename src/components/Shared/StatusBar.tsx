import React from 'react'
import { useAppStore } from '../../store/appStore'

export function StatusBar() {
  const activeSession = useAppStore((s) => s.activeSession)
  const isRunning = useAppStore((s) => s.isRunning)
  const currentUsage = useAppStore((s) => s.currentUsage)

  if (!activeSession) return null

  return (
    <div
      className="h-6 flex items-center justify-between px-4 text-[11px] select-none"
      style={{
        backgroundColor: 'var(--theme-bg-subtle)',
        color: 'var(--theme-muted)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: isRunning ? 'var(--theme-warning)' : 'var(--theme-success)',
            }}
          />
          <span className="opacity-80">{isRunning ? 'working' : 'ready'}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 opacity-70">
        {currentUsage && (
          <span>
            {currentUsage.promptTokens.toLocaleString()} in · {currentUsage.completionTokens.toLocaleString()} out
          </span>
        )}
      </div>
    </div>
  )
}
