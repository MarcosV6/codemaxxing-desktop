import React, { useEffect, useState } from 'react'
import { Loader2, LogOut, ExternalLink } from 'lucide-react'

/**
 * One-click Google connect, shared by the Email and Calendar setup screens.
 * A single sign-in configures BOTH (Gmail over XOAUTH2 + Google Calendar).
 * First use asks for the user's own OAuth client id/secret (Desktop app —
 * created free in Google Cloud Console); after that it's one click.
 */
export function GoogleConnectCard({ onConnected }: { onConnected: () => void }) {
  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [hasClient, setHasClient] = useState(false)
  const [showClientForm, setShowClientForm] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = async () => {
    const r = await window.electron.google.status()
    if (r.ok) { setConnected(r.connected); setEmail(r.email); setHasClient(r.hasClient) }
  }
  useEffect(() => { void refresh() }, [])

  const connect = async () => {
    setErr(null)
    // No stored client yet and none pasted → reveal the one-time client form.
    if (!hasClient && (!clientId.trim() || !clientSecret.trim())) { setShowClientForm(true); return }
    setBusy(true)
    try {
      const r = await window.electron.google.connect(
        clientId.trim() ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() } : undefined,
      )
      if (r.ok) { setClientId(''); setClientSecret(''); setShowClientForm(false); await refresh(); onConnected() }
      else setErr(r.error || 'Sign-in failed')
    } finally { setBusy(false) }
  }

  const disconnect = async () => {
    setBusy(true)
    try { await window.electron.google.disconnect(); await refresh(); onConnected() }
    finally { setBusy(false) }
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-3" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
        <GoogleG />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--theme-text)' }}>{email}</div>
          <div className="text-[10.5px]" style={{ color: 'var(--theme-muted)' }}>Connected via Google — email + calendar</div>
        </div>
        <button onClick={disconnect} disabled={busy} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] hover:bg-white/5 disabled:opacity-40" style={{ color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />} Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <button
        onClick={connect}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2.5 rounded-xl px-4 py-3 text-[13px] font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
        style={{ backgroundColor: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <GoogleG />}
        {busy ? 'Waiting for Google sign-in…' : 'Sign in with Google'}
      </button>

      {showClientForm && (
        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
            One-time setup: create a free OAuth client in{' '}
            <button onClick={() => window.open('https://console.cloud.google.com/apis/credentials', '_blank')} className="inline-flex items-center gap-0.5 underline" style={{ color: 'var(--theme-primary)' }}>
              Google Cloud Console <ExternalLink size={9} />
            </button>{' '}
            (type: <b>Desktop app</b>; enable the Gmail + Calendar APIs; add yourself as a test user), then paste it here. Stored locally only.
          </div>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID (…apps.googleusercontent.com)" className="bg-transparent outline-none text-[12px] font-mono rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }} />
          <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client Secret" type="password" className="bg-transparent outline-none text-[12px] font-mono rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }} />
          <button onClick={connect} disabled={busy || !clientId.trim() || !clientSecret.trim()} className="rounded-lg px-3 py-2 text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>
            Continue to Google
          </button>
        </div>
      )}

      {err && <div className="text-[11px] rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-error)', border: '1px solid color-mix(in srgb, var(--theme-error) 40%, transparent)' }}>{err}</div>}
    </div>
  )
}

/** The four-color Google "G". */
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
