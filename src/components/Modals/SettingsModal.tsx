import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { AuthMethod } from '../../store/appStore'
import type { ApprovalMode, ReasoningEffort, HookRecord } from '../../types/electron'
import {
  X, Folder, Key, Palette, Zap, Trash2, Check, Globe, Terminal, Package, Smartphone,
  ExternalLink, Loader2, Sparkles, Brain, Plus, Lightbulb, Layers,
  Copy, Power, AlertTriangle,
} from 'lucide-react'

type Tab = 'general' | 'agent' | 'skills' | 'hooks' | 'providers' | 'appearance' | 'remote'

export function SettingsModal() {
  const isOpen = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const appConfig = useAppStore((s) => s.appConfig)
  const setAutoApprove = useAppStore((s) => s.setAutoApprove)
  const setCostBudget = useAppStore((s) => s.setCostBudget)
  const setLastCwd = useAppStore((s) => s.setLastCwd)
  const setTheme = useAppStore((s) => s.setTheme)
  const themes = useAppStore((s) => s.themes)
  const activeTheme = useAppStore((s) => s.activeTheme)
  const pickDirectory = useAppStore((s) => s.pickDirectory)

  const [tab, setTab] = useState<Tab>('general')

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="w-full max-w-4xl h-[640px] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
      >
        <div
          className="h-12 flex items-center justify-between px-4 shrink-0"
          style={{ borderBottom: '1px solid var(--theme-border)' }}
        >
          <span className="text-[13px] font-medium tracking-tight">Settings</span>
          <button onClick={close} className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5 transition-all">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-44 shrink-0 p-2 flex flex-col gap-0.5" style={{ borderRight: '1px solid var(--theme-border)' }}>
            <TabButton icon={<Zap size={13} />} label="General" active={tab === 'general'} onClick={() => setTab('general')} />
            <TabButton icon={<Brain size={13} />} label="Agent" active={tab === 'agent'} onClick={() => setTab('agent')} />
            <TabButton icon={<Lightbulb size={13} />} label="Skills" active={tab === 'skills'} onClick={() => setTab('skills')} />
            <TabButton icon={<Layers size={13} />} label="Hooks" active={tab === 'hooks'} onClick={() => setTab('hooks')} />
            <TabButton icon={<Key size={13} />} label="Providers" active={tab === 'providers'} onClick={() => setTab('providers')} />
            <TabButton icon={<Palette size={13} />} label="Appearance" active={tab === 'appearance'} onClick={() => setTab('appearance')} />
            <TabButton icon={<Smartphone size={13} />} label="Remote" active={tab === 'remote'} onClick={() => setTab('remote')} />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5" style={{ color: 'var(--theme-text)' }}>
            {tab === 'general' && (
              <div className="space-y-5 max-w-2xl">
                <section className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Default project directory</div>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex-1 text-[12px] font-mono rounded-md px-3 py-2 truncate"
                      style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
                    >
                      {appConfig.lastCwd || '(not set)'}
                    </div>
                    <button
                      onClick={async () => { const p = await pickDirectory(); if (p) await setLastCwd(p) }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] hover:bg-white/5 transition-colors"
                      style={{ border: '1px solid var(--theme-border)' }}
                    >
                      <Folder size={12} /> Pick
                    </button>
                  </div>
                </section>

                <section>
                  <label className="flex items-center justify-between cursor-pointer py-2">
                    <div>
                      <div className="text-[13px]">Auto-approve tools</div>
                      <div className="text-[11.5px] opacity-60 mt-0.5">Skip approval prompts for file writes, edits, and shell commands.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={appConfig.autoApprove}
                      onChange={(e) => setAutoApprove(e.target.checked)}
                      className="w-4 h-4 accent-current"
                    />
                  </label>
                </section>

                <section className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Spend budget</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] opacity-70">$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      defaultValue={appConfig.costBudget || 0}
                      onBlur={(e) => setCostBudget(parseFloat(e.target.value) || 0)}
                      placeholder="0 = off"
                      className="w-28 text-[13px] rounded-md px-3 py-2 outline-none"
                      style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                    />
                    <span className="text-[11.5px] opacity-60">per session — the status-bar dial turns amber near it, red over.</span>
                  </div>
                  <div className="text-[11.5px] opacity-60">
                    Want $0? Use <span className="font-mono">/local</span> or ⌘K → “Go Fully Local” to run an on-device model.
                  </div>
                </section>
              </div>
            )}

            {tab === 'agent' && <AgentTab />}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'hooks' && <HooksTab />}

            {tab === 'providers' && <ProvidersTab />}

            {tab === 'appearance' && (
              <div className="max-w-2xl">
                <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium mb-3">Theme</div>
                <div className="grid grid-cols-2 gap-2">
                  {themes.map((t) => {
                    const key = (t as any).key as string
                    const isActive = activeTheme && (activeTheme as any).key === key
                    return (
                      <button
                        key={key}
                        onClick={() => setTheme(key)}
                        className={`rounded-lg p-3 text-left transition-all ${isActive ? 'ring-2' : ''}`}
                        style={{
                          border: '1px solid ' + (isActive ? t.colors.primary : 'var(--theme-border)'),
                          backgroundColor: t.colors.bg ?? 'var(--theme-bg-subtle)',
                          color: t.colors.text,
                        }}
                      >
                        <div className="text-[13px] font-medium mb-1">{t.name}</div>
                        <div className="text-[11px] opacity-70 mb-2">{t.description}</div>
                        <div className="flex gap-1">
                          {[t.colors.primary, t.colors.secondary, t.colors.success, t.colors.warning, t.colors.error].map((c, i) => (
                            <div key={i} className="w-4 h-4 rounded" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {tab === 'remote' && <RemoteTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] text-left transition-colors ${
        active ? 'bg-white/5' : 'opacity-70 hover:opacity-100 hover:bg-white/[0.03]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Providers Tab ─────────────────────────────────────────────────────────
function ProvidersTab() {
  const providers = useAppStore((s) => s.providers)
  const credentials = useAppStore((s) => s.credentials)
  const detectedAuth = useAppStore((s) => s.detectedAuth)
  const runAuthFlow = useAppStore((s) => s.runAuthFlow)
  const deleteCredential = useAppStore((s) => s.deleteCredential)
  const saveCredential = useAppStore((s) => s.saveCredential)
  const authFlowStatus = useAppStore((s) => s.authFlowStatus)
  const clearAuthFlowStatus = useAppStore((s) => s.clearAuthFlowStatus)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [running, setRunning] = useState<{ provider: string; method: AuthMethod } | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [labelInput, setLabelInput] = useState('')

  const handleRunFlow = async (provider: string, method: AuthMethod) => {
    setFlowError(null)
    setRunning({ provider, method })
    clearAuthFlowStatus()
    const res = await runAuthFlow(provider, method)
    if (!res.ok) setFlowError(res.error ?? 'Authentication failed')
    setRunning(null)
    if (res.ok) {
      setExpanded(null)
    }
  }

  const handleSaveApiKey = async (providerId: string) => {
    if (!apiKeyInput.trim()) return
    await saveCredential({
      provider: providerId,
      apiKey: apiKeyInput.trim(),
      baseUrl: baseUrlInput.trim(),
      label: labelInput.trim() || undefined,
    })
    setApiKeyInput(''); setBaseUrlInput(''); setLabelInput('')
    setExpanded(null)
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Detection banner */}
      {detectedAuth.length > 0 && (
        <div
          className="rounded-lg p-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--theme-primary) 25%, transparent)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={12} style={{ color: 'var(--theme-primary)' }} />
            <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--theme-primary)' }}>
              Detected on this machine
            </span>
          </div>
          <div className="space-y-1">
            {detectedAuth.map((d, i) => (
              <div key={i} className="text-[12px] opacity-90">
                ⚡ {d.description}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active flow banner */}
      {(running || authFlowStatus) && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" style={{ color: 'var(--theme-primary)' }} />
              <span className="text-[12px] font-medium">
                {running ? `Authenticating — ${methodLabel(running.method)}` : 'Finishing…'}
              </span>
            </div>
          </div>
          {authFlowStatus && authFlowStatus.messages.length > 0 && (
            <div className="font-mono text-[11px] space-y-0.5 opacity-80 max-h-28 overflow-y-auto">
              {authFlowStatus.messages.map((m, i) => (
                <div key={i}>{m}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {flowError && (
        <div
          className="rounded-lg p-3 text-[12px]"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--theme-error) 10%, transparent)',
            color: 'var(--theme-error)',
            border: '1px solid color-mix(in srgb, var(--theme-error) 30%, transparent)',
          }}
        >
          {flowError}
          <button onClick={() => setFlowError(null)} className="ml-2 opacity-60 hover:opacity-100">dismiss</button>
        </div>
      )}

      {/* Provider list */}
      <div className="space-y-2">
        {providers.map((p) => {
          const cred = credentials.find((c) => c.provider === p.id)
          const isExpanded = expanded === p.id
          const isLocal = p.methods.length === 1 && p.methods[0] === 'none'
          return (
            <div
              key={p.id}
              className="rounded-lg overflow-hidden"
              style={{
                backgroundColor: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
              }}
            >
              <button
                onClick={() => {
                  setExpanded(isExpanded ? null : p.id)
                  setApiKeyInput(''); setBaseUrlInput(''); setLabelInput('')
                  setFlowError(null)
                }}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium truncate">{p.name}</span>
                    {cred && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 20%, transparent)', color: 'var(--theme-success)' }}>
                        <Check size={9} strokeWidth={3} /> {methodLabel(cred.method as AuthMethod)}
                      </span>
                    )}
                    {isLocal && p.authed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 20%, transparent)', color: 'var(--theme-success)' }}>
                        ● running
                      </span>
                    )}
                    {isLocal && !p.authed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded opacity-60">○ offline</span>
                    )}
                  </div>
                  <div className="text-[11.5px] opacity-60 mt-0.5 truncate">{p.description}</div>
                </div>
                <div className="text-[11px] opacity-50 ml-3">{isExpanded ? '−' : '+'}</div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-1 space-y-2" style={{ borderTop: '1px solid var(--theme-border)' }}>
                  {cred && (
                    <div className="flex items-center justify-between gap-2 py-2">
                      <div className="text-[11px] font-mono opacity-70 truncate">
                        {cred.apiKey} · {cred.baseUrl}
                      </div>
                      <button
                        onClick={() => deleteCredential(p.id)}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded opacity-70 hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--theme-error)' }}
                      >
                        <Trash2 size={10} /> Remove
                      </button>
                    </div>
                  )}

                  {!cred && !isLocal && (
                    <div className="pt-1 space-y-2">
                      <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Authenticate with</div>
                      <div className="flex flex-wrap gap-2">
                        {p.methods.filter(m => m !== 'none').map((method) => (
                          <MethodButton
                            key={method}
                            method={method}
                            provider={p.id}
                            disabled={running !== null}
                            onClick={() => {
                              if (method === 'api-key') {
                                // toggle inline form
                                setExpanded(p.id)
                                setApiKeyInput('')
                              } else {
                                void handleRunFlow(p.id, method)
                              }
                            }}
                          />
                        ))}
                      </div>

                      {p.methods.includes('api-key') && (
                        <ApiKeyForm
                          providerId={p.id}
                          consoleUrl={p.consoleUrl}
                          showCustomBaseUrl={p.id === 'custom' || !p.baseUrl}
                          apiKeyInput={apiKeyInput}
                          setApiKeyInput={setApiKeyInput}
                          baseUrlInput={baseUrlInput}
                          setBaseUrlInput={setBaseUrlInput}
                          labelInput={labelInput}
                          setLabelInput={setLabelInput}
                          onSave={() => handleSaveApiKey(p.id)}
                        />
                      )}
                    </div>
                  )}

                  {isLocal && (
                    <div className="text-[11.5px] opacity-70 py-1">
                      {p.authed
                        ? 'Ready to use — no authentication needed.'
                        : p.id === 'ollama'
                        ? 'Start Ollama with `ollama serve` to use local models.'
                        : 'Start LM Studio and enable the local server.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MethodButton({
  method, provider, onClick, disabled,
}: { method: AuthMethod; provider: string; onClick: () => void; disabled?: boolean }) {
  const { icon, label } = methodMeta(method, provider)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ border: '1px solid var(--theme-border)' }}
    >
      {icon}
      {label}
    </button>
  )
}

function ApiKeyForm({
  providerId, consoleUrl, showCustomBaseUrl,
  apiKeyInput, setApiKeyInput, baseUrlInput, setBaseUrlInput, labelInput, setLabelInput,
  onSave,
}: {
  providerId: string
  consoleUrl?: string
  showCustomBaseUrl: boolean
  apiKeyInput: string; setApiKeyInput: (v: string) => void
  baseUrlInput: string; setBaseUrlInput: (v: string) => void
  labelInput: string; setLabelInput: (v: string) => void
  onSave: () => void
}) {
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Or enter an API key</div>
        {consoleUrl && (
          <button
            onClick={() => void window.electron.openExternal(consoleUrl)}
            className="inline-flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100 transition-opacity"
          >
            Get a key <ExternalLink size={10} />
          </button>
        )}
      </div>
      <input
        placeholder="API key"
        type="password"
        value={apiKeyInput}
        onChange={(e) => setApiKeyInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && apiKeyInput.trim()) onSave() }}
        className="w-full text-[12px] font-mono px-3 py-2 rounded-md outline-none"
        style={{
          backgroundColor: 'var(--theme-bg)',
          color: 'var(--theme-text)',
          border: '1px solid var(--theme-border)',
        }}
      />
      {showCustomBaseUrl && (
        <input
          placeholder="Base URL"
          value={baseUrlInput}
          onChange={(e) => setBaseUrlInput(e.target.value)}
          className="w-full text-[12px] font-mono px-3 py-2 rounded-md outline-none"
          style={{
            backgroundColor: 'var(--theme-bg)',
            color: 'var(--theme-text)',
            border: '1px solid var(--theme-border)',
          }}
        />
      )}
      <input
        placeholder="Label (optional)"
        value={labelInput}
        onChange={(e) => setLabelInput(e.target.value)}
        className="w-full text-[12px] px-3 py-2 rounded-md outline-none"
        style={{
          backgroundColor: 'var(--theme-bg)',
          color: 'var(--theme-text)',
          border: '1px solid var(--theme-border)',
        }}
      />
      <button
        onClick={onSave}
        disabled={!apiKeyInput.trim()}
        className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40"
        style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
      >
        Save key
      </button>
    </div>
  )
}

// ── Method metadata ───────────────────────────────────────────────────────
function methodLabel(method: AuthMethod): string {
  switch (method) {
    case 'oauth': return 'OAuth'
    case 'setup-token': return 'Subscription'
    case 'cached-token': return 'Imported'
    case 'device-flow': return 'Device'
    case 'api-key': return 'API key'
    case 'none': return 'Local'
  }
}

function methodMeta(method: AuthMethod, provider: string): { icon: React.ReactNode; label: string } {
  const size = 12
  switch (method) {
    case 'oauth':
      return { icon: <Globe size={size} />, label: provider === 'openai' ? 'Log in with ChatGPT' : 'Browser login' }
    case 'setup-token':
      return { icon: <Terminal size={size} />, label: 'Link Claude subscription' }
    case 'cached-token':
      return {
        icon: <Package size={size} />,
        label: provider === 'openai' ? 'Import from Codex CLI' : provider === 'qwen' ? 'Import from Qwen CLI' : 'Import CLI token',
      }
    case 'device-flow':
      return { icon: <Smartphone size={size} />, label: 'Device flow' }
    case 'api-key':
      return { icon: <Key size={size} />, label: 'API key' }
    case 'none':
      return { icon: <Zap size={size} />, label: 'No auth needed' }
  }
}

// ── Agent Tab ─────────────────────────────────────────────────────────────
function AgentTab() {
  const appConfig = useAppStore((s) => s.appConfig)
  const setApprovalMode = useAppStore((s) => s.setApprovalMode)
  const setReasoningEffort = useAppStore((s) => s.setReasoningEffort)
  const setAppConfig = useAppStore((s) => s.setAppConfig)
  // Threshold UI is a slider in the 50-95% band (matches the clamp band
  // applied at config-load time). Display in whole percent — 85 reads
  // better than 0.85 in a settings panel.
  const autoCompactPct = Math.round(((appConfig.autoCompactThreshold ?? 0.85)) * 100)

  const modes: Array<{ value: ApprovalMode; label: string; description: string }> = [
    { value: 'suggest', label: 'Suggest', description: 'Ask before every edit and shell command.' },
    { value: 'auto-edit', label: 'Auto-edit', description: 'Auto-approve file edits; still ask for shell and git writes.' },
    { value: 'full-auto', label: 'Full auto', description: 'Auto-approve everything. Use only in a sandboxed/scratch dir.' },
  ]
  const efforts: Array<{ value: ReasoningEffort; label: string; description: string }> = [
    { value: 'off', label: 'Off', description: 'No extended reasoning.' },
    { value: 'low', label: 'Low', description: '~2k thinking tokens.' },
    { value: 'medium', label: 'Medium', description: '~6k thinking tokens.' },
    { value: 'high', label: 'High', description: '~12k thinking tokens.' },
    { value: 'max', label: 'Max', description: '~24k thinking tokens. Slow & expensive.' },
  ]

  return (
    <div className="max-w-2xl space-y-6">
      <section>
        <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium mb-2">Approval mode</div>
        <div className="space-y-1.5">
          {modes.map((m) => {
            const active = appConfig.approvalMode === m.value
            return (
              <button
                key={m.value}
                onClick={() => setApprovalMode(m.value)}
                className={`w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? 'ring-1' : 'hover:bg-white/[0.03]'}`}
                style={{
                  backgroundColor: active ? 'color-mix(in srgb, var(--theme-primary) 12%, transparent)' : 'var(--theme-bg-subtle)',
                  border: '1px solid ' + (active ? 'var(--theme-primary)' : 'var(--theme-border)'),
                }}
              >
                <div
                  className="w-3.5 h-3.5 rounded-full mt-0.5 shrink-0"
                  style={{
                    border: '1.5px solid ' + (active ? 'var(--theme-primary)' : 'var(--theme-muted)'),
                    backgroundColor: active ? 'var(--theme-primary)' : 'transparent',
                  }}
                />
                <div>
                  <div className="text-[13px] font-medium">{m.label}</div>
                  <div className="text-[11.5px] opacity-60 mt-0.5">{m.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium mb-2">Reasoning effort</div>
        <div className="grid grid-cols-5 gap-1.5">
          {efforts.map((e) => {
            const active = appConfig.reasoningEffort === e.value
            return (
              <button
                key={e.value}
                onClick={() => setReasoningEffort(e.value)}
                className="rounded-md px-2 py-2 text-[12px] transition-colors"
                style={{
                  backgroundColor: active ? 'var(--theme-primary)' : 'var(--theme-bg-subtle)',
                  color: active ? '#1a1814' : 'var(--theme-text)',
                  border: '1px solid ' + (active ? 'var(--theme-primary)' : 'var(--theme-border)'),
                  fontWeight: active ? 600 : 400,
                }}
              >
                {e.label}
              </button>
            )
          })}
        </div>
        <div className="text-[11.5px] opacity-60 mt-2">
          {efforts.find(e => e.value === appConfig.reasoningEffort)?.description}
        </div>
      </section>

      <section>
        <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium mb-2">Auto-compact</div>
        <div
          className="rounded-lg p-3 space-y-3"
          style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
        >
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[13px] font-medium">Auto-compact long conversations</div>
              <div className="text-[11.5px] opacity-65 mt-0.5 leading-relaxed">
                When the conversation reaches the threshold below of the model's context window,
                Codemaxxing automatically summarizes older turns and continues in a fresh session.
                Prevents the "input exceeds context window" error before it happens.
              </div>
            </div>
            <input
              type="checkbox"
              checked={appConfig.autoCompactEnabled !== false}
              onChange={(e) => void setAppConfig({ ...appConfig, autoCompactEnabled: e.target.checked })}
              className="mt-1 w-4 h-4 shrink-0"
              style={{ accentColor: 'var(--theme-primary)' }}
            />
          </label>

          {appConfig.autoCompactEnabled !== false && (
            <div>
              <div className="flex items-center justify-between text-[12px] mb-1">
                <span className="opacity-70">Compact at</span>
                <span className="font-mono" style={{ color: 'var(--theme-primary)' }}>{autoCompactPct}%</span>
              </div>
              <input
                type="range"
                min={50} max={95} step={5}
                value={autoCompactPct}
                onChange={(e) => {
                  const next = Math.max(50, Math.min(95, Number(e.target.value)))
                  void setAppConfig({ ...appConfig, autoCompactThreshold: next / 100 })
                }}
                className="w-full"
                style={{ accentColor: 'var(--theme-primary)' }}
              />
              <div className="flex justify-between text-[10px] opacity-50 font-mono mt-0.5">
                <span>50%</span>
                <span>aggressive</span>
                <span>95%</span>
              </div>
              <div className="text-[11px] opacity-60 mt-2 leading-relaxed">
                Lower = compact earlier (more headroom, more summary cost). Higher = compact later
                (closer to the limit). Default 85% leaves ~15% headroom for the next response.
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ── Skills Tab ────────────────────────────────────────────────────────────
function SkillsTab() {
  const skills = useAppStore((s) => s.skills)
  const activeIds = useAppStore((s) => s.appConfig.activeSkillIds)
  const setActiveSkillIds = useAppStore((s) => s.setActiveSkillIds)
  const loadSkills = useAppStore((s) => s.loadSkills)
  const [filter, setFilter] = useState('')

  useEffect(() => { if (skills.length === 0) void loadSkills() }, [skills.length, loadSkills])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q)),
    )
  }, [skills, filter])

  const toggle = (id: string) => {
    const next = activeIds.includes(id) ? activeIds.filter(x => x !== id) : [...activeIds, id]
    void setActiveSkillIds(next)
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center gap-2">
        <input
          placeholder="Filter skills…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 text-[12px] px-3 py-1.5 rounded-md outline-none"
          style={{
            backgroundColor: 'var(--theme-bg-subtle)',
            color: 'var(--theme-text)',
            border: '1px solid var(--theme-border)',
          }}
        />
        <div className="text-[11.5px] opacity-60">
          {activeIds.length} / {skills.length} active
        </div>
      </div>

      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-[12px] opacity-60 py-8 text-center">
            {skills.length === 0 ? 'Loading skills…' : 'No skills match that filter.'}
          </div>
        )}
        {filtered.map((s) => {
          const active = activeIds.includes(s.id)
          return (
            <label
              key={s.id}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
              style={{
                backgroundColor: active ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : 'var(--theme-bg-subtle)',
                border: '1px solid ' + (active ? 'color-mix(in srgb, var(--theme-primary) 40%, transparent)' : 'var(--theme-border)'),
              }}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={() => toggle(s.id)}
                className="mt-1 accent-current"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium">{s.name}</span>
                  {s.tags.map((t, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-1.5 py-0.5 rounded opacity-60"
                      style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-muted)' }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="text-[11.5px] opacity-70 mt-0.5">{s.description}</div>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── Hooks Tab ─────────────────────────────────────────────────────────────
function HooksTab() {
  const hooks = useAppStore((s) => s.hooks)
  const loadHooks = useAppStore((s) => s.loadHooks)
  const saveHooks = useAppStore((s) => s.saveHooks)
  const [draft, setDraft] = useState<HookRecord[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => { void loadHooks() }, [loadHooks])
  useEffect(() => { setDraft(hooks); setDirty(false) }, [hooks])

  const updateAt = (idx: number, patch: Partial<HookRecord>) => {
    setDraft((d) => d.map((h, i) => i === idx ? { ...h, ...patch } : h))
    setDirty(true)
  }

  const addHook = () => {
    const id = 'hook_' + Math.random().toString(36).slice(2, 8)
    setDraft((d) => [...d, { id, event: 'on-edit', command: '', enabled: true, blocking: false }])
    setDirty(true)
  }

  const removeAt = (idx: number) => {
    setDraft((d) => d.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const save = async () => {
    await saveHooks(draft.filter(h => h.command.trim().length > 0))
    setDirty(false)
  }

  const events = ['on-start', 'pre-tool', 'post-tool', 'on-edit', 'on-commit', 'on-error']

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11.5px] opacity-70">
          Hooks run shell commands on agent events. <span className="font-mono">pre-tool</span> can block a tool when exit code ≠ 0.
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={save}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium"
              style={{ backgroundColor: 'var(--theme-primary)', color: '#1a1814' }}
            >
              Save
            </button>
          )}
          <button
            onClick={addHook}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/5"
            style={{ border: '1px solid var(--theme-border)' }}
          >
            <Plus size={12} /> Add hook
          </button>
        </div>
      </div>

      {draft.length === 0 && (
        <div className="text-[12px] opacity-60 py-8 text-center rounded-lg" style={{ border: '1px dashed var(--theme-border)' }}>
          No hooks defined. Click <span className="font-medium">Add hook</span> to create one.
        </div>
      )}

      <div className="space-y-3">
        {draft.map((h, idx) => (
          <div
            key={h.id}
            className="rounded-lg p-3 space-y-2"
            style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
          >
            <div className="flex items-center gap-2">
              <select
                value={h.event}
                onChange={(e) => updateAt(idx, { event: e.target.value })}
                className="text-[12px] px-2 py-1 rounded-md outline-none"
                style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              >
                {events.map(ev => <option key={ev} value={ev}>{ev}</option>)}
              </select>
              <input
                placeholder="Label (optional)"
                value={h.label ?? ''}
                onChange={(e) => updateAt(idx, { label: e.target.value })}
                className="flex-1 text-[12px] px-2 py-1 rounded-md outline-none"
                style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              />
              <label className="flex items-center gap-1 text-[11.5px] opacity-70 whitespace-nowrap">
                <input type="checkbox" checked={h.enabled !== false} onChange={(e) => updateAt(idx, { enabled: e.target.checked })} /> enabled
              </label>
              <label className="flex items-center gap-1 text-[11.5px] opacity-70 whitespace-nowrap">
                <input type="checkbox" checked={!!h.blocking} onChange={(e) => updateAt(idx, { blocking: e.target.checked })} /> blocking
              </label>
              <button
                onClick={() => removeAt(idx)}
                className="w-6 h-6 rounded flex items-center justify-center opacity-60 hover:opacity-100"
                style={{ color: 'var(--theme-error)' }}
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <input
              placeholder="shell command (e.g. npm run lint)"
              value={h.command}
              onChange={(e) => updateAt(idx, { command: e.target.value })}
              className="w-full text-[12px] font-mono px-2 py-1.5 rounded-md outline-none"
              style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="toolMatch (glob, optional)"
                value={h.toolMatch ?? ''}
                onChange={(e) => updateAt(idx, { toolMatch: e.target.value })}
                className="text-[12px] font-mono px-2 py-1.5 rounded-md outline-none"
                style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              />
              <input
                placeholder="pathMatch (glob, optional)"
                value={h.pathMatch ?? ''}
                onChange={(e) => updateAt(idx, { pathMatch: e.target.value })}
                className="text-[12px] font-mono px-2 py-1.5 rounded-md outline-none"
                style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Remote access settings. Exposes the foundation for "talk to your Mac from
 * your phone" via a Claude-Code-style pairing model:
 *
 *   1. The user enables the remote API server (HTTP + SSE on a local port).
 *   2. They click "Pair a device" → the desktop generates a 6-character
 *      code that's good for 5 minutes, displayed on screen as text + QR.
 *   3. The phone (or any other client) redeems the code via POST /api/pair
 *      and receives its own permanent device token.
 *   4. The device shows up in the list below; revokable per-device.
 *
 * Each paired device has its own token. Revoking one doesn't kick the
 * others — exactly what users expect from multi-device pairing in apps like
 * Authy, Signal, or Claude Desktop.
 *
 * For off-LAN connectivity (cellular, etc.) the user layers a tunnel
 * (Tailscale recommended) on top — the desktop intentionally surfaces the
 * URL as plain `http://` so it's clear when you're on raw LAN vs tunneled.
 */
type RemoteStatus = Awaited<ReturnType<typeof window.electron.remote.status>>
type PairingInfo = NonNullable<Awaited<ReturnType<typeof window.electron.remote.beginPairing>>>

function RemoteTab() {
  const appConfig = useAppStore((s) => s.appConfig)
  const setAppConfig = useAppStore((s) => s.setAppConfig)

  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [portDraft, setPortDraft] = useState<string>('')
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [pairingTtl, setPairingTtl] = useState<number>(0)

  const refresh = async () => {
    const r = await window.electron.remote.status()
    if (r.ok) {
      setStatus(r)
      setPortDraft(String(r.port))
    }
  }
  useEffect(() => { void refresh() }, [])

  // Live update when a phone redeems a code on the other side. main.ts
  // emits 'remote:devicesChanged' whenever the device list mutates.
  useEffect(() => {
    const off = window.electron.remote.onDevicesChanged(() => { void refresh() })
    return off
  }, [])

  // Tick down the pairing-code TTL so the UI shows "expires in 4:23" not
  // a stale wall-clock time. Cleared when no pairing is active.
  useEffect(() => {
    if (!pairing) { setPairingTtl(0); return }
    const tick = () => setPairingTtl(Math.max(0, Math.floor(((pairing.expiresAt ?? 0) - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [pairing])

  // When the code expires, drop it from the UI. The server already invalidates
  // server-side; this just keeps the visible state in sync.
  useEffect(() => {
    if (pairing && pairingTtl <= 0) setPairing(null)
  }, [pairing, pairingTtl])

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1400)
    } catch { /* ignore */ }
  }

  const updateFlag = async (key: 'keepAliveInBackground' | 'autoLaunch', value: boolean) => {
    await setAppConfig({ ...appConfig, [key]: value })
  }

  const onToggleEnabled = async (next: boolean) => {
    setBusy(true); setErr(null)
    const r = await window.electron.remote.setEnabled(next)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? 'Failed to toggle remote access')
    if (!next) setPairing(null)  // clear any stale pairing UI on shutdown
    await refresh()
  }
  const onSavePort = async () => {
    const port = Number(portDraft)
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      setErr('Port must be between 1024 and 65535')
      return
    }
    setBusy(true); setErr(null)
    const r = await window.electron.remote.setPort(port)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? 'Failed to set port')
    await refresh()
  }
  const onBeginPairing = async () => {
    setBusy(true); setErr(null)
    const r = await window.electron.remote.beginPairing()
    setBusy(false)
    if (!r.ok || !r.code) { setErr(r.error ?? 'Failed to start pairing'); return }
    setPairing(r as PairingInfo)
  }
  const onCancelPairing = async () => {
    await window.electron.remote.cancelPairing()
    setPairing(null)
  }
  const onRevoke = async (id: string, label: string) => {
    if (!confirm(`Revoke "${label}"? It will be disconnected immediately and won't be able to reconnect without re-pairing.`)) return
    setBusy(true); setErr(null)
    const r = await window.electron.remote.revokeDevice(id)
    setBusy(false)
    if (!r.ok) setErr(r.error ?? 'Failed to revoke device')
    await refresh()
  }

  const enabled = status?.enabled ?? false
  const running = status?.running ?? false
  const lanUrls = (status?.addresses ?? []).filter((u) => !u.includes('127.0.0.1'))
  const loopback = (status?.addresses ?? []).find((u) => u.includes('127.0.0.1')) ?? `http://127.0.0.1:${status?.port ?? 7843}`
  const devices = status?.devices ?? []

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Remote access (preview)</div>
        <p className="text-[12.5px] leading-relaxed opacity-75">
          Pair a phone, tablet, or another computer to drive this agent over the network. Each paired device gets its own credential and shows up below — revoke one without affecting the others. On the same Wi-Fi this works out of the box. For cellular, layer a tunnel like
          {' '}<a href="https://tailscale.com" target="_blank" rel="noreferrer" className="underline opacity-90">Tailscale</a>{' '}
          on both devices.
        </p>
      </section>

      {/* Server on/off + status */}
      <section className="rounded-lg p-4" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Power size={13} style={{ color: enabled ? 'var(--theme-success)' : 'var(--theme-muted)' }} />
              <span>Remote API server</span>
              {enabled && (
                <span className="text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded"
                      style={{ color: running ? 'var(--theme-success)' : 'var(--theme-warning)',
                               backgroundColor: `color-mix(in srgb, ${running ? 'var(--theme-success)' : 'var(--theme-warning)'} 12%, transparent)` }}>
                  {running ? 'running' : 'stopped'}
                </span>
              )}
            </div>
            <div className="text-[11.5px] opacity-60 mt-0.5">
              {enabled ? `Bound to port ${status?.port ?? 7843} · ${devices.length} paired device${devices.length === 1 ? '' : 's'}` : 'Off — nothing listening'}
            </div>
          </div>
          <button
            onClick={() => void onToggleEnabled(!enabled)}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: enabled ? 'color-mix(in srgb, var(--theme-error) 14%, transparent)' : 'color-mix(in srgb, var(--theme-primary) 16%, transparent)',
              color: enabled ? 'var(--theme-error)' : 'var(--theme-primary)',
              border: '1px solid ' + (enabled ? 'color-mix(in srgb, var(--theme-error) 30%, transparent)' : 'color-mix(in srgb, var(--theme-primary) 30%, transparent)'),
            }}
          >
            {busy ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}
            {enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>

        {err && (
          <div className="mt-3 flex items-start gap-2 text-[11.5px] px-3 py-2 rounded"
               style={{ color: 'var(--theme-error)', backgroundColor: 'color-mix(in srgb, var(--theme-error) 8%, transparent)' }}>
            <AlertTriangle size={12} className="shrink-0 mt-[2px]" />
            <span>{err}</span>
          </div>
        )}
      </section>

      {enabled && status && (
        <>
          {/* URLs */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">URLs</div>
            {lanUrls.length === 0 && (
              <div className="text-[12px] opacity-60 italic px-1">
                No external network interfaces detected — only loopback URL is reachable from this Mac.
              </div>
            )}
            {[...lanUrls, loopback].map((url) => (
              <UrlRow key={url} url={url} loopback={url === loopback} onCopy={() => copy(url, url)} copied={copied === url} />
            ))}
          </section>

          {/* Pair a device */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Pair a device</div>
              {!pairing && (
                <button
                  onClick={() => void onBeginPairing()}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)', color: 'var(--theme-primary)', border: '1px solid color-mix(in srgb, var(--theme-primary) 30%, transparent)' }}
                >
                  <Plus size={12} />
                  Generate pairing code
                </button>
              )}
            </div>
            {pairing && (
              <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid color-mix(in srgb, var(--theme-primary) 30%, transparent)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider opacity-60">One-time code</div>
                    <div className="font-mono text-[28px] tracking-[0.2em] font-medium mt-1" style={{ color: 'var(--theme-primary)' }}>
                      {pairing.code}
                    </div>
                    <div className="text-[11px] opacity-60 mt-1">
                      expires in {Math.floor(pairingTtl / 60)}:{String(pairingTtl % 60).padStart(2, '0')} · single use
                    </div>
                  </div>
                  <button onClick={() => void onCancelPairing()} className="text-[11px] opacity-60 hover:opacity-100 px-2 py-1 rounded">
                    Cancel
                  </button>
                </div>
                <div className="text-[11.5px] leading-relaxed opacity-80">
                  On your other device, choose <span className="font-mono opacity-100">"Pair with Codemaxxing"</span> and enter this code, OR scan a QR encoding the URI below. The code is good for one device only.
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">Pairing URI (deep link / QR payload)</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 font-mono text-[11px] rounded-md px-3 py-2 truncate"
                         style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                      {pairing.pairingUri}
                    </div>
                    <button
                      onClick={() => pairing.pairingUri && void copy('uri', pairing.pairingUri)}
                      className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/5"
                      style={{ border: '1px solid var(--theme-border)' }}
                    >
                      {copied === 'uri' ? <Check size={12} style={{ color: 'var(--theme-success)' }} /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">Or POST this manually</div>
                  <pre className="text-[10.5px] font-mono rounded-md px-3 py-2 overflow-x-auto"
                       style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }}>
{`curl -X POST ${pairing.pairUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"code":"${pairing.code}","label":"My iPhone","platform":"ios"}'`}
                  </pre>
                </div>
              </div>
            )}
          </section>

          {/* Paired devices list */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Paired devices</div>
            {devices.length === 0 ? (
              <div className="text-[12px] opacity-60 italic px-1 py-3">
                No devices paired yet. Click <span className="opacity-90">Generate pairing code</span> to add one.
              </div>
            ) : (
              <div className="space-y-1.5">
                {devices.map((d) => (
                  <DeviceRow key={d.id} device={d} onRevoke={() => void onRevoke(d.id, d.label)} />
                ))}
              </div>
            )}
          </section>

          {/* Port */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">Port</div>
            <div className="flex items-center gap-2">
              <input
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
                className="w-28 text-[12px] font-mono px-2 py-1.5 rounded-md outline-none"
                style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              />
              <button
                onClick={() => void onSavePort()}
                disabled={busy || portDraft === String(status.port)}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-40"
                style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)', color: 'var(--theme-primary)', border: '1px solid color-mix(in srgb, var(--theme-primary) 30%, transparent)' }}
              >
                Apply
              </button>
              <span className="text-[11px] opacity-50">restarts the server</span>
            </div>
          </section>
        </>
      )}

      <hr style={{ borderColor: 'var(--theme-border)' }} />

      <section className="space-y-3">
        <div className="text-[11px] uppercase tracking-wider opacity-60 font-medium">24/7 operation</div>

        <ToggleRow
          title="Keep running in background"
          description="Closing the window hides it instead of quitting. The agent loop and remote server stay alive. Available from the menubar / tray icon."
          checked={!!appConfig.keepAliveInBackground}
          onChange={(v) => void updateFlag('keepAliveInBackground', v)}
        />
        <ToggleRow
          title="Launch at login"
          description="Start Codemaxxing automatically when you sign in, hidden in the menubar. Required if you want the agent reachable after a restart without manually launching."
          checked={!!appConfig.autoLaunch}
          onChange={(v) => void updateFlag('autoLaunch', v)}
        />

        <div className="text-[11px] opacity-60 px-1 leading-relaxed">
          macOS may still suspend the app on battery when the lid is closed.
          For uninterrupted 24/7 operation, keep the Mac plugged in and the lid open
          (or use a clamshell-mode dock).
        </div>
      </section>
    </div>
  )
}

function DeviceRow({ device, onRevoke }: { device: { id: string; label: string; platform: string; createdAt: number; lastSeenAt: number | null }; onRevoke: () => void }) {
  const platformLabel: Record<string, string> = {
    ios: 'iOS', android: 'Android', macos: 'macOS', windows: 'Windows', linux: 'Linux',
    browser: 'Browser', cli: 'CLI', unknown: 'Unknown',
  }
  const lastSeen = device.lastSeenAt ? formatRelative(device.lastSeenAt) : 'never'
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2"
         style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium truncate">{device.label}</div>
        <div className="text-[10.5px] opacity-60 mt-0.5">
          {platformLabel[device.platform] ?? device.platform} · paired {formatRelative(device.createdAt)} · last seen {lastSeen}
        </div>
      </div>
      <button
        onClick={onRevoke}
        className="px-2.5 py-1 rounded-md text-[11px]"
        style={{ color: 'var(--theme-error)', backgroundColor: 'color-mix(in srgb, var(--theme-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-error) 25%, transparent)' }}
      >
        Revoke
      </button>
    </div>
  )
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm ago'
  if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + 'h ago'
  return Math.floor(delta / 86_400_000) + 'd ago'
}

function UrlRow({ url, loopback, onCopy, copied }: { url: string; loopback: boolean; onCopy: () => void; copied: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 font-mono text-[12px] rounded-md px-3 py-2 truncate flex items-center gap-2"
           style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
        <Globe size={11} style={{ color: 'var(--theme-muted)' }} />
        <span className="truncate">{url}</span>
        {loopback && (
          <span className="text-[9.5px] uppercase tracking-wider opacity-50 font-mono shrink-0">this Mac only</span>
        )}
      </div>
      <button
        onClick={onCopy}
        title="Copy URL"
        className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-white/5"
        style={{ border: '1px solid var(--theme-border)' }}
      >
        {copied ? <Check size={13} style={{ color: 'var(--theme-success)' }} /> : <Copy size={13} />}
      </button>
    </div>
  )
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 p-3 rounded-lg cursor-pointer hover:bg-white/[0.02]"
           style={{ border: '1px solid var(--theme-border)' }}>
      <div>
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11.5px] opacity-65 mt-0.5 leading-relaxed">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4"
        style={{ accentColor: 'var(--theme-primary)' }}
      />
    </label>
  )
}
