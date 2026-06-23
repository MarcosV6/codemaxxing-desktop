import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, Folder, Code2, MessageCircle, AlertCircle, Pencil, Loader2, ExternalLink } from 'lucide-react'
import type { SessionMode } from '../../types'

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
  const saveCredential = useAppStore((s) => s.saveCredential)

  const [mode, setMode] = useState<SessionMode>('code')
  const [cwd, setCwd] = useState(appConfig.lastCwd || '')
  const [provider, setProvider] = useState<string>(appConfig.lastProvider || '')
  const [model, setModel] = useState<string>(appConfig.lastModel || '')
  const [loading, setLoading] = useState(false)
  // Per-load status so we can show a useful empty-state instead of just
  // disabling the dropdown silently when LM Studio / Ollama / a custom
  // OpenAI-compat endpoint isn't reachable or has no models loaded.
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [modelError, setModelError] = useState<string | null>(null)
  // Whether the user has opted into typing a model id by hand. Auto-flips on
  // when the listing returns empty / errors so they're never stuck.
  const [manualModel, setManualModel] = useState(false)
  // Inline provider setup (paste an API key for a cloud provider that has none)
  // + a tick to re-fetch models after connecting.
  const [setupKey, setSetupKey] = useState('')
  const [setupSaving, setSetupSaving] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (open) {
      setMode('code')
      setCwd(appConfig.lastCwd || '')
      setProvider(appConfig.lastProvider || '')
      setModel(appConfig.lastModel || '')
      setManualModel(false)
      setModelStatus('idle')
      setModelError(null)
    }
  }, [open, appConfig])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch models for the active provider. We call IPC directly (rather than
  // the store's loadModels) so we can observe ok/empty/error and surface the
  // distinction to the user — the store path collapses errors into a silent
  // empty list, which is what made the dropdown look broken.
  useEffect(() => {
    if (!provider || !open) return
    let cancelled = false
    setModelStatus('loading')
    setModelError(null)
    setManualModel(false)
    // Keep the store in sync too — other surfaces (settings, status bar) read
    // from `availableModels` for the active provider.
    void loadModels(provider)
    void window.electron.llm.listModels(provider).then((res) => {
      if (cancelled) return
      if (res.ok && res.models && res.models.length > 0) {
        setModelStatus('ready')
        return
      }
      if (res.ok) {
        setModelStatus('empty')
        setManualModel(true)
        return
      }
      setModelStatus('error')
      setModelError(res.error || 'Could not load models')
      setManualModel(true)
    }).catch((err) => {
      if (cancelled) return
      setModelStatus('error')
      setModelError(String(err?.message ?? err ?? 'Could not load models'))
      setManualModel(true)
    })
    return () => { cancelled = true }
  }, [provider, open, loadModels, reloadTick])

  if (!open) return null

  // Local OpenAI-compatible servers don't need a key (just need to be running).
  const LOCAL_PROVIDERS = ['ollama', 'lmstudio', 'custom']
  const selProvider = providers.find((p) => p.id === provider)
  const isLocal = LOCAL_PROVIDERS.includes(provider)
  // A cloud provider that's selected but has no credentials yet → offer inline setup.
  const needsSetup = !!selProvider && !selProvider.authed && !isLocal && selProvider.methods.includes('api-key')

  const connectProvider = async () => {
    if (!setupKey.trim() || !provider) return
    setSetupSaving(true)
    try {
      await saveCredential({ provider, apiKey: setupKey.trim(), baseUrl: '' })
      setSetupKey('')
      setReloadTick((t) => t + 1) // re-fetch models now that we're authed
    } finally { setSetupSaving(false) }
  }
  // Chat mode doesn't need a project directory — agent can't touch the
  // filesystem regardless. Default it to home so the cwd field stays valid
  // for downstream consumers (memory scope, etc.) without forcing the user
  // to pick anything.
  const isChatMode = mode === 'chat'
  const effectiveCwd = isChatMode ? (cwd || '~') : cwd
  const canCreate = effectiveCwd && provider && model && !loading

  const handleCreate = async () => {
    if (!canCreate) return
    setLoading(true)
    try {
      const id = await createSession({ cwd: effectiveCwd, provider, model, mode })
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
          {/* ── Mode toggle ── */}
          <div className="space-y-1">
            <div className="text-[10px] uppercase font-mono opacity-60">Session type</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode('code')}
                className="flex items-center gap-2 px-3 py-2 rounded border text-left"
                style={{
                  borderColor: mode === 'code' ? 'var(--theme-primary, #7AA2F7)' : 'var(--theme-border, #334155)',
                  backgroundColor: mode === 'code' ? 'color-mix(in srgb, var(--theme-primary) 12%, transparent)' : 'transparent',
                }}
              >
                <Code2 size={14} style={{ color: mode === 'code' ? 'var(--theme-primary)' : undefined }} />
                <div>
                  <div className="text-xs font-mono">Code</div>
                  <div className="text-[10px] opacity-60">Full agent — files, shell, git</div>
                </div>
              </button>
              <button
                onClick={() => setMode('chat')}
                className="flex items-center gap-2 px-3 py-2 rounded border text-left"
                style={{
                  borderColor: mode === 'chat' ? 'var(--theme-primary, #7AA2F7)' : 'var(--theme-border, #334155)',
                  backgroundColor: mode === 'chat' ? 'color-mix(in srgb, var(--theme-primary) 12%, transparent)' : 'transparent',
                }}
              >
                <MessageCircle size={14} style={{ color: mode === 'chat' ? 'var(--theme-primary)' : undefined }} />
                <div>
                  <div className="text-xs font-mono">Chat</div>
                  <div className="text-[10px] opacity-60">Plain conversation + web search</div>
                </div>
              </button>
            </div>
          </div>

          {/* ── Project directory (code mode only) ── */}
          {!isChatMode && (
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
          )}

          <div className="space-y-1">
            <div className="text-[10px] uppercase font-mono opacity-60">Provider</div>
            <select
              value={provider}
              onChange={(e) => { setProvider(e.target.value); setModel(''); setSetupKey('') }}
              className="w-full text-xs font-mono px-2 py-1.5 rounded border bg-transparent outline-none"
              style={{ borderColor: 'var(--theme-border, #334155)' }}
            >
              <option value="">Choose a provider…</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{!p.authed && !LOCAL_PROVIDERS.includes(p.id) ? ' · needs a key' : ''}
                </option>
              ))}
            </select>

            {needsSetup && (
              <div className="mt-1.5 rounded-lg p-2.5 space-y-2" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <div className="text-[11px]" style={{ color: 'var(--theme-muted)' }}>
                  {selProvider?.name} isn't set up. Paste an API key to connect it now:
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="password"
                    value={setupKey}
                    onChange={(e) => setSetupKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void connectProvider() }}
                    placeholder="sk-…"
                    className="flex-1 min-w-0 text-xs font-mono px-2 py-1.5 rounded border bg-transparent outline-none"
                    style={{ borderColor: 'var(--theme-border)' }}
                  />
                  <button onClick={connectProvider} disabled={setupSaving || !setupKey.trim()} className="text-[11px] px-2.5 py-1.5 rounded font-medium shrink-0 disabled:opacity-40 flex items-center" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>
                    {setupSaving ? <Loader2 size={12} className="animate-spin" /> : 'Connect'}
                  </button>
                </div>
                {selProvider?.consoleUrl && (
                  <a href={selProvider.consoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10.5px] opacity-70 hover:opacity-100" style={{ color: 'var(--theme-secondary)' }}>
                    Get a {selProvider.name} key <ExternalLink size={9} />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase font-mono opacity-60">Model</div>
              {/* Toggle between dropdown and manual-id entry whenever a list
                  is available — local providers like LM Studio or a custom
                  endpoint may have models the discovery call doesn't surface. */}
              {provider && modelStatus === 'ready' && (
                <button
                  onClick={() => setManualModel((v) => !v)}
                  className="flex items-center gap-1 text-[10px] font-mono opacity-60 hover:opacity-100"
                >
                  <Pencil size={10} />
                  {manualModel ? 'pick from list' : 'enter manually'}
                </button>
              )}
            </div>

            {modelStatus === 'loading' ? (
              <div
                className="flex items-center gap-2 text-xs font-mono px-2 py-1.5 rounded border opacity-60"
                style={{ borderColor: 'var(--theme-border, #334155)' }}
              >
                <Loader2 size={12} className="animate-spin" />
                Loading models…
              </div>
            ) : manualModel || availableModels.length === 0 ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  provider === 'lmstudio'
                    ? 'e.g. qwen2.5-coder-32b-instruct'
                    : provider === 'ollama'
                    ? 'e.g. llama3.2:latest'
                    : 'model id'
                }
                disabled={!provider}
                className="w-full text-xs font-mono px-2 py-1.5 rounded border bg-transparent outline-none disabled:opacity-50"
                style={{ borderColor: 'var(--theme-border, #334155)' }}
              />
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!provider}
                className="w-full text-xs font-mono px-2 py-1.5 rounded border bg-transparent outline-none disabled:opacity-50"
                style={{ borderColor: 'var(--theme-border, #334155)' }}
              >
                <option value="">Choose a model…</option>
                {availableModels.map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            )}

            {/* Inline status hint for the empty / error cases — explains why
                the dropdown is gone instead of leaving the user staring at a
                disabled control with no feedback. */}
            {provider && !needsSetup && (modelStatus === 'empty' || modelStatus === 'error') && (
              <div
                className="flex items-start gap-1.5 text-[10.5px] mt-1 px-1"
                style={{ color: 'var(--theme-warning, #e0af68)' }}
              >
                <AlertCircle size={11} className="shrink-0 mt-[1px]" />
                <span>
                  {modelStatus === 'empty' ? (
                    provider === 'lmstudio' ? (
                      <>No models reported by LM Studio. Make sure it's running with a model loaded — or type the model id above.</>
                    ) : provider === 'ollama' ? (
                      <>No models pulled in Ollama. Run <span className="font-mono">ollama pull &lt;name&gt;</span> first, or type one above.</>
                    ) : (
                      <>Provider returned no models. Type the id above.</>
                    )
                  ) : (
                    <>Couldn't reach provider: {modelError}. Type the model id above to continue anyway.</>
                  )}
                </span>
              </div>
            )}
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
