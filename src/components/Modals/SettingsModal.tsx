import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import type { AuthMethod } from '../../store/appStore'
import type { ApprovalMode, ReasoningEffort, HookRecord } from '../../types/electron'
import {
  X, Folder, Key, Palette, Zap, Trash2, Check, Globe, Terminal, Package, Smartphone,
  ExternalLink, Loader2, Sparkles, Brain, Plus, Lightbulb, Layers,
} from 'lucide-react'

type Tab = 'general' | 'agent' | 'skills' | 'hooks' | 'providers' | 'appearance'

export function SettingsModal() {
  const isOpen = useAppStore((s) => s.settingsOpen)
  const close = useAppStore((s) => s.closeSettings)
  const appConfig = useAppStore((s) => s.appConfig)
  const setAutoApprove = useAppStore((s) => s.setAutoApprove)
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
