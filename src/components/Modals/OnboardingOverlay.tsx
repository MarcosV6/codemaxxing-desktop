import React, { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import {
  Terminal, ArrowRight, ArrowLeft, Check, KeyRound, Cpu, Globe, Users, CircleDollarSign,
  FolderOpen, Loader2, ExternalLink, Command,
} from 'lucide-react'

/**
 * First-run welcome. Three steps: what the app is → connect a model (the only
 * hard requirement to actually use the agent) → a few orientation tips. Gated
 * by `onboardingOpen` (set from the persisted `onboarded` config flag), so it
 * shows exactly once. Fully themed via CSS vars.
 */
export function OnboardingOverlay() {
  const open = useAppStore((s) => s.onboardingOpen)
  const complete = useAppStore((s) => s.completeOnboarding)
  const providers = useAppStore((s) => s.providers)
  const detectedAuth = useAppStore((s) => s.detectedAuth)
  const saveCredential = useAppStore((s) => s.saveCredential)
  const runAuthFlow = useAppStore((s) => s.runAuthFlow)
  const authFlowStatus = useAppStore((s) => s.authFlowStatus)
  const refresh = useAppStore((s) => s.refreshProvidersAndCredentials)
  const pickDirectory = useAppStore((s) => s.pickDirectory)
  const lastCwd = useAppStore((s) => s.appConfig.lastCwd)

  const [step, setStep] = useState(0)
  const [keyProvider, setKeyProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [localResult, setLocalResult] = useState<string | null>(null)

  if (!open) return null

  const authedCloud = providers.filter((p) => p.authed && !p.local)
  const connected = authedCloud.length > 0 || detectedAuth.length > 0
  const keyProviders = providers.filter((p) => p.methods.includes('api-key') && !p.local)
  const hasOAuth = (id: string) => !!providers.find((p) => p.id === id && p.methods.includes('oauth'))
  const keyDef = providers.find((p) => p.id === keyProvider)

  const connectKey = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try { await saveCredential({ provider: keyProvider, apiKey: apiKey.trim(), baseUrl: '' }); setApiKey('') } finally { setSaving(false) }
  }
  const oauth = async (provider: string) => {
    setBusy(provider)
    try { await runAuthFlow(provider, 'oauth') } finally { setBusy(null) }
  }
  const detectLocal = async () => {
    setRechecking(true); setLocalResult(null)
    try {
      const [lm, ol] = await Promise.all([
        window.electron.llm.listModels('lmstudio'),
        window.electron.llm.listModels('ollama'),
      ])
      const parts: string[] = []
      if (lm.ok && lm.models && lm.models.length) parts.push(`LM Studio: ${lm.models.length} model${lm.models.length === 1 ? '' : 's'}`)
      if (ol.ok && ol.models && ol.models.length) parts.push(`Ollama: ${ol.models.length} model${ol.models.length === 1 ? '' : 's'}`)
      await refresh()
      setLocalResult(parts.length
        ? `Found ${parts.join(' · ')}. You're set — pick one when you start a session.`
        : "No local models found. Start LM Studio's server (Developer tab) or Ollama with a model, then Detect again.")
    } finally { setRechecking(false) }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg) 82%, transparent)', backdropFilter: 'blur(10px)' }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--theme-bg-subtle)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-2, 0 24px 60px rgba(0,0,0,0.5))',
          maxHeight: '88vh',
        }}
      >
        {/* progress rail */}
        <div className="flex gap-1.5 px-6 pt-5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1 flex-1 rounded-full transition-all"
              style={{ backgroundColor: i <= step ? 'var(--theme-primary)' : 'var(--theme-border)' }}
            />
          ))}
        </div>

        <div className="px-6 py-6 overflow-y-auto">
          {step === 0 && (
            <div className="text-center">
              <div
                className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--theme-primary) 30%, transparent)',
                }}
              >
                <Terminal size={28} style={{ color: 'var(--theme-primary)' }} />
              </div>
              <h2 className="text-[22px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Welcome to codemaxxing</h2>
              <p className="text-[13.5px] leading-relaxed mb-6" style={{ color: 'var(--theme-muted)' }}>
                An open coding agent that runs every model — cloud <em>or</em> local — with a built-in browser, council mode, and full cost control. Let's get you set up in under a minute.
              </p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {[
                  { icon: Globe, label: 'Built-in browser' },
                  { icon: Users, label: 'Council mode' },
                  { icon: CircleDollarSign, label: 'Local · $0' },
                ].map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="rounded-lg p-3 flex flex-col items-center gap-1.5 text-center"
                    style={{ backgroundColor: 'var(--theme-bg-raised)', border: '1px solid var(--theme-hairline)' }}
                  >
                    <Icon size={16} style={{ color: 'var(--theme-secondary)' }} />
                    <span className="text-[10.5px]" style={{ color: 'var(--theme-muted)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>Connect a model</h2>
              <p className="text-[12.5px] mb-4" style={{ color: 'var(--theme-muted)' }}>
                The agent needs at least one model. Pick whatever's easiest — you can add more later in Settings.
              </p>

              {connected && (
                <div
                  className="rounded-lg p-3 mb-4 flex items-start gap-2"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-success) 28%, transparent)' }}
                >
                  <Check size={15} style={{ color: 'var(--theme-success)', marginTop: 1 }} />
                  <div className="text-[12.5px]" style={{ color: 'var(--theme-text)' }}>
                    <span className="font-medium">You're connected.</span>{' '}
                    <span style={{ color: 'var(--theme-muted)' }}>
                      {[...authedCloud.map((p) => p.name), ...detectedAuth.map((d) => d.provider)].slice(0, 3).join(', ')} ready. You can continue.
                    </span>
                  </div>
                </div>
              )}

              {/* API key */}
              <div className="rounded-lg p-3 mb-2.5" style={{ backgroundColor: 'var(--theme-bg-raised)', border: '1px solid var(--theme-hairline)' }}>
                <div className="flex items-center gap-2 mb-2.5">
                  <KeyRound size={14} style={{ color: 'var(--theme-primary)' }} />
                  <span className="text-[12.5px] font-medium" style={{ color: 'var(--theme-text)' }}>Paste an API key</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={keyProvider}
                    onChange={(e) => setKeyProvider(e.target.value)}
                    className="text-[12px] rounded-md px-2 py-2 outline-none shrink-0"
                    style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
                  >
                    {keyProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') connectKey() }}
                    placeholder="sk-…"
                    className="flex-1 min-w-0 text-[12px] rounded-md px-2.5 py-2 outline-none font-mono"
                    style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
                  />
                  <button
                    onClick={connectKey}
                    disabled={saving || !apiKey.trim()}
                    className="text-[12px] px-3 py-2 rounded-md font-medium shrink-0 disabled:opacity-40 transition-opacity"
                    style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : 'Connect'}
                  </button>
                </div>
                {keyDef?.consoleUrl && (
                  <a
                    href={keyDef.consoleUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] mt-2 opacity-70 hover:opacity-100"
                    style={{ color: 'var(--theme-secondary)' }}
                  >
                    Get a {keyDef.name} key <ExternalLink size={10} />
                  </a>
                )}
              </div>

              {/* OAuth — the easiest path for most people */}
              {(hasOAuth('anthropic') || hasOAuth('openai')) && (
                <div className="mb-2.5">
                  <div className="text-[10.5px] uppercase tracking-wider opacity-40 mb-1.5" style={{ color: 'var(--theme-muted)' }}>Or sign in (no key needed)</div>
                  <div className="flex gap-2">
                    {hasOAuth('anthropic') && (
                      <button onClick={() => oauth('anthropic')} disabled={busy === 'anthropic'} className="flex-1 text-[12px] px-3 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50" style={{ backgroundColor: 'var(--theme-bg-raised)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
                        {busy === 'anthropic' ? <Loader2 size={13} className="animate-spin" /> : <Cpu size={13} style={{ color: 'var(--theme-secondary)' }} />}
                        Login with Claude
                      </button>
                    )}
                    {hasOAuth('openai') && (
                      <button onClick={() => oauth('openai')} disabled={busy === 'openai'} className="flex-1 text-[12px] px-3 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50" style={{ backgroundColor: 'var(--theme-bg-raised)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
                        {busy === 'openai' ? <Loader2 size={13} className="animate-spin" /> : <Cpu size={13} style={{ color: 'var(--theme-secondary)' }} />}
                        Login with ChatGPT
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Local models — LM Studio / Ollama */}
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-bg-raised)', border: '1px solid var(--theme-hairline)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cpu size={14} style={{ color: 'var(--theme-success)' }} />
                    <span className="text-[12px] truncate" style={{ color: 'var(--theme-muted)' }}>
                      Run free local models — <a href="https://lmstudio.ai" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--theme-secondary)' }}>LM Studio</a> or <a href="https://ollama.com" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--theme-secondary)' }}>Ollama</a>
                    </span>
                  </div>
                  <button
                    onClick={detectLocal}
                    className="text-[11px] px-2.5 py-1.5 rounded-md shrink-0 flex items-center gap-1.5 hover:bg-white/5"
                    style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-muted)' }}
                  >
                    {rechecking ? <Loader2 size={11} className="animate-spin" /> : null} Detect
                  </button>
                </div>
                {localResult && <div className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--theme-muted)' }}>{localResult}</div>}
              </div>

              {authFlowStatus && authFlowStatus.messages.length > 0 && (
                <div className="mt-3 rounded-md px-2.5 py-2 text-[11px] font-mono max-h-20 overflow-auto" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-muted)', border: '1px solid var(--theme-hairline)' }}>
                  {authFlowStatus.messages.map((m, i) => <div key={i}>{m}</div>)}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>You're all set</h2>
              <p className="text-[12.5px] mb-4" style={{ color: 'var(--theme-muted)' }}>A couple of things worth knowing:</p>

              <button
                onClick={() => pickDirectory()}
                className="w-full rounded-lg p-3 mb-3 flex items-center gap-2.5 text-left hover:bg-white/[0.03] transition-colors"
                style={{ backgroundColor: 'var(--theme-bg-raised)', border: '1px solid var(--theme-hairline)' }}
              >
                <FolderOpen size={15} style={{ color: 'var(--theme-primary)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px]" style={{ color: 'var(--theme-text)' }}>Default project folder</div>
                  <div className="text-[11px] truncate font-mono" style={{ color: 'var(--theme-muted)' }}>{lastCwd || 'Click to choose where the agent works'}</div>
                </div>
              </button>

              <div className="space-y-2">
                {[
                  { icon: Command, text: 'Press ⌘K anytime for the command palette — every action + workspace.' },
                  { icon: Terminal, text: 'Type / in the message box for slash commands (/help, /local, /context…).' },
                  { icon: Globe, text: 'Open the Preview panel for a live browser the agent can drive.' },
                ].map(({ icon: Icon, text }, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Icon size={14} style={{ color: 'var(--theme-secondary)', marginTop: 2 }} />
                    <span className="text-[12px]" style={{ color: 'var(--theme-muted)' }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* footer nav */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid var(--theme-hairline)' }}>
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="text-[12.5px] flex items-center gap-1.5 opacity-70 hover:opacity-100" style={{ color: 'var(--theme-muted)' }}>
              <ArrowLeft size={13} /> Back
            </button>
          ) : (
            <button onClick={() => complete()} className="text-[12px] opacity-50 hover:opacity-90" style={{ color: 'var(--theme-muted)' }}>Skip</button>
          )}

          {step < 2 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="text-[13px] px-4 py-2 rounded-lg font-medium flex items-center gap-1.5 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
            >
              {step === 1 && !connected ? 'Skip for now' : step === 0 ? 'Get started' : 'Continue'} <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={() => complete()}
              className="text-[13px] px-4 py-2 rounded-lg font-medium flex items-center gap-1.5 transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
            >
              Start building <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
