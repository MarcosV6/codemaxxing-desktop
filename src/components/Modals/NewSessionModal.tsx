import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, Folder } from 'lucide-react'

interface NewSessionModalProps {
  open: boolean
  onClose: () => void
}

export function NewSessionModal({ open, onClose }: NewSessionModalProps) {
  const appConfig = useAppStore((s) => s.appConfig)
  const providers = useAppStore((s) => s.providers)
  const availableModels = useAppStore((s) => s.availableModels)
  const loadModels = useAppStore((s) => s.loadModels)
  const pickDirectory = useAppStore((s) => s.pickDirectory)
  const createSession = useAppStore((s) => s.createSession)

  const [cwd, setCwd] = useState(appConfig.lastCwd || '')
  const [provider, setProvider] = useState<string>(appConfig.lastProvider || '')
  const [model, setModel] = useState<string>(appConfig.lastModel || '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setCwd(appConfig.lastCwd || '')
      setProvider(appConfig.lastProvider || '')
      setModel(appConfig.lastModel || '')
    }
  }, [open, appConfig])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (provider) { void loadModels(provider) }
  }, [provider, loadModels])

  if (!open) return null

  const authedProviders = providers.filter(p => p.authed)
  const canCreate = cwd && provider && model && !loading

  const handleCreate = async () => {
    if (!canCreate) return
    setLoading(true)
    try {
      const id = await createSession({ cwd, provider, model })
      if (id) onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-lg rounded-lg border shadow-2xl"
           style={{ backgroundColor: 'var(--theme-bg, #0a0a0f)', borderColor: 'var(--theme-border, #334155)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b"
             style={{ borderColor: 'var(--theme-border, #334155)' }}>
          <span className="text-sm font-mono">New session</span>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3" style={{ color: 'var(--theme-text, #C0CAF5)' }}>
          <div className="space-y-1">
            <div className="text-[10px] uppercase font-mono opacity-60">Project directory</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 text-xs font-mono rounded border px-2 py-1.5 truncate"
                   style={{ borderColor: 'var(--theme-border, #334155)', backgroundColor: 'var(--theme-bg-subtle, #0d0d14)' }}>
                {cwd || '(none)'}
              </div>
              <button
                onClick={async () => { const p = await pickDirectory(); if (p) setCwd(p) }}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono border"
                style={{ borderColor: 'var(--theme-border, #334155)' }}
              >
                <Folder size={12} /> Pick
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase font-mono opacity-60">Provider</div>
            {authedProviders.length === 0 ? (
              <div className="text-xs opacity-60 py-2">
                No providers configured. Open Settings to add an API key.
              </div>
            ) : (
              <select
                value={provider}
                onChange={(e) => { setProvider(e.target.value); setModel('') }}
                className="w-full text-xs font-mono px-2 py-1.5 rounded border bg-transparent outline-none"
                style={{ borderColor: 'var(--theme-border, #334155)' }}
              >
                <option value="">Choose a provider…</option>
                {authedProviders.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-[10px] uppercase font-mono opacity-60">Model</div>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!provider || availableModels.length === 0}
              className="w-full text-xs font-mono px-2 py-1.5 rounded border bg-transparent outline-none disabled:opacity-50"
              style={{ borderColor: 'var(--theme-border, #334155)' }}
            >
              <option value="">Choose a model…</option>
              {availableModels.map(m => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t"
             style={{ borderColor: 'var(--theme-border, #334155)' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-mono border"
            style={{ borderColor: 'var(--theme-border, #334155)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="px-3 py-1.5 rounded text-xs font-mono bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white"
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
