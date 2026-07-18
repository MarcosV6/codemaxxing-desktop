import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { ChevronDown, Search } from 'lucide-react'

/**
 * Compact model chip + dropdown for assistant panel headers (browser +
 * workspaces). Shows the active session's model; clicking lists the session
 * provider's models with a filter and switches via updateSessionModel.
 */
export function AssistantModelPicker() {
  const activeSession = useAppStore((s) => s.activeSession)
  const availableModels = useAppStore((s) => s.availableModels)
  const loadModels = useAppStore((s) => s.loadModels)
  const updateSessionModel = useAppStore((s) => s.updateSessionModel)

  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Fetch the provider's models when the picker opens.
  useEffect(() => {
    if (open && activeSession) void loadModels(activeSession.provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSession?.provider])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!activeSession) return null
  const models = availableModels.filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-mono opacity-70 hover:opacity-100 hover:bg-white/5 transition-all max-w-full"
        title={`${activeSession.provider} · ${activeSession.model} — click to change model`}
      >
        <span className="truncate max-w-[130px]">{activeSession.model}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg shadow-xl z-50 overflow-hidden min-w-[230px]"
          style={{ backgroundColor: 'var(--theme-bg-raised, var(--theme-bg-subtle))', border: '1px solid var(--theme-hairline-strong)' }}
        >
          <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderBottom: '1px solid var(--theme-hairline)' }}>
            <Search size={11} style={{ color: 'var(--theme-muted)' }} />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models…"
              className="flex-1 bg-transparent outline-none text-[11.5px] font-mono"
              style={{ color: 'var(--theme-text)' }}
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {/* Escape hatch for brand-new models the lists don't know yet:
                whatever you typed is always usable as a model id. */}
            {filter.trim() && !models.some((m) => m.name === filter.trim()) && (
              <button
                onClick={() => { void updateSessionModel(activeSession.id, activeSession.provider, filter.trim()); setOpen(false); setFilter('') }}
                className="w-full text-left px-3 py-1.5 text-[11.5px] font-mono hover:bg-white/5 truncate"
                style={{ color: 'var(--theme-primary)' }}
                title="Use this exact model id even though it isn't in the list"
              >
                Use “{filter.trim()}”
              </button>
            )}
            {models.length === 0 && !filter.trim() ? (
              <div className="px-3 py-3 text-[11.5px] opacity-60 text-center" style={{ color: 'var(--theme-muted)' }}>
                No models for {activeSession.provider} — type an id above
              </div>
            ) : models.map((m) => {
              const active = m.name === activeSession.model
              return (
                <button
                  key={m.name}
                  onClick={() => { void updateSessionModel(activeSession.id, activeSession.provider, m.name); setOpen(false); setFilter('') }}
                  className="w-full text-left px-3 py-1.5 text-[11.5px] font-mono hover:bg-white/5 truncate"
                  style={{
                    color: active ? 'var(--theme-primary)' : 'var(--theme-text)',
                    backgroundColor: active ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : 'transparent',
                  }}
                >
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
