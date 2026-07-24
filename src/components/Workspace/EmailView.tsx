import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { WorkspaceAssistant } from './WorkspaceAssistant'
import { GoogleConnectCard } from './GoogleConnectCard'
import { ResizeHandle } from '../Shared/Resizable'
import { useResizablePanel } from '../Shared/useResizablePanel'
import { PAD_TRAFFIC_80 } from '../../utils/platform'
import { ArrowLeft, Loader2, RefreshCw, Send, Settings as Cog, PenSquare } from 'lucide-react'

interface Msg { uid: number; from: string; fromName: string; subject: string; date: number; seen: boolean }
interface FullMsg { uid: number; from: string; to: string; subject: string; date: number; text: string }
interface Account { email: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; passwordSet: boolean }

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Email as a full-page workspace: inbox list (left) → the open message / compose
 * / account setup (center), the agent assistant docked on the right. The open
 * message is reported to main so the agent's email_read targets it; email_send
 * goes through the configured SMTP account.
 */
export function EmailView({ onNewSession }: { onNewSession: () => void }) {
  const close = useAppStore((s) => s.closeEmail)

  const [account, setAccount] = useState<Account | null>(null)
  const [view, setView] = useState<'inbox' | 'setup' | 'compose'>('inbox')
  const [messages, setMessages] = useState<Msg[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [openMsg, setOpenMsg] = useState<FullMsg | null>(null)
  const [loadingMsg, setLoadingMsg] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ email: '', password: '', imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465 })
  const [savingAcct, setSavingAcct] = useState(false)
  const [c, setC] = useState({ to: '', subject: '', text: '' })
  const [sending, setSending] = useState(false)
  const left = useResizablePanel({ storageKey: 'email-list', defaultWidth: 300, min: 220, max: 460, dock: 'left' })

  const loadList = useCallback(async () => {
    setLoadingList(true); setErr(null)
    try { const r = await window.electron.email.list({ limit: 25 }); if (r.ok) setMessages(r.messages || []); else setErr(r.error || 'Failed to load inbox') }
    finally { setLoadingList(false) }
  }, [])

  useEffect(() => {
    setOpenMsg(null); setErr(null)
    void (async () => {
      const r = await window.electron.email.getAccount()
      const acct = r.ok ? r.account : null
      setAccount(acct)
      if (acct) { setF((p) => ({ ...p, email: acct.email, password: '', imapHost: acct.imapHost, imapPort: acct.imapPort, smtpHost: acct.smtpHost, smtpPort: acct.smtpPort })); setView('inbox'); void loadList() }
      else setView('setup')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // report the open message so the agent's email_read targets it
  useEffect(() => {
    window.electron.email.setActive(openMsg ? { uid: openMsg.uid, from: openMsg.from, to: openMsg.to, subject: openMsg.subject, text: openMsg.text } : null)
    return () => window.electron.email.setActive(null)
  }, [openMsg])

  const saveAccount = async () => {
    setSavingAcct(true)
    try { await window.electron.email.saveAccount(f); const r = await window.electron.email.getAccount(); setAccount(r.ok ? r.account : null); setView('inbox'); void loadList() }
    finally { setSavingAcct(false) }
  }
  const openMessage = async (uid: number) => {
    setLoadingMsg(true); setOpenMsg(null)
    try { const r = await window.electron.email.get(uid); if (r.ok && r.message) setOpenMsg(r.message); setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m))) }
    finally { setLoadingMsg(false) }
  }
  const send = async () => {
    if (!c.to.trim()) return
    setSending(true); setErr(null)
    try { const r = await window.electron.email.send(c); if (r.ok) { setC({ to: '', subject: '', text: '' }); setView('inbox') } else setErr(r.error || 'Send failed') }
    finally { setSending(false) }
  }

  const field = (label: string, value: string | number, onChange: (v: string) => void, type = 'text', placeholder = '') => (
    <label className="flex flex-col gap-1 text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none text-[12.5px] rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
    </label>
  )

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/5 transition-colors'

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* left: inbox list */}
      <aside className="relative flex flex-col shrink-0 h-full" style={{ width: left.width, backgroundColor: 'var(--theme-bg-subtle)', borderRight: '1px solid var(--theme-hairline)' }}>
        <ResizeHandle handleProps={left.handleProps} label="inbox" />
        <div className={`h-12 flex items-center gap-1 ${PAD_TRAFFIC_80} pr-2 shrink-0`} style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--theme-hairline)' } as React.CSSProperties}>
          <button onClick={() => close()} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5 transition-colors" style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="Exit Email"><ArrowLeft size={13} /> exit</button>
          <span className="flex-1" />
          {account && <button onClick={() => { setView('compose'); setErr(null) }} className={iconBtn} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="Compose"><PenSquare size={13} /></button>}
          {account && <button onClick={() => void loadList()} className={iconBtn} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="Refresh"><RefreshCw size={13} className={loadingList ? 'animate-spin' : ''} /></button>}
          {account && <button onClick={() => setView('setup')} className={iconBtn} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="Account"><Cog size={13} /></button>}
        </div>
        {account && <div className="text-[10.5px] uppercase tracking-wider opacity-40 px-4 pb-1.5 shrink-0 truncate" style={{ color: 'var(--theme-muted)' }}>{account.email}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loadingList && messages.length === 0 && <div className="flex items-center gap-2 text-[12px] opacity-60 p-4"><Loader2 size={13} className="animate-spin" /> Loading inbox…</div>}
          {!loadingList && account && messages.length === 0 && <div className="text-[12px] opacity-50 p-4" style={{ color: 'var(--theme-muted)' }}>Inbox empty (or none fetched).</div>}
          {messages.map((m) => (
            <button key={m.uid} onClick={() => void openMessage(m.uid)} className="w-full text-left px-3 py-2.5 transition-colors" style={{ backgroundColor: openMsg?.uid === m.uid ? 'var(--theme-bg-raised)' : 'transparent', borderLeft: openMsg?.uid === m.uid ? '2px solid var(--theme-primary)' : '2px solid transparent', borderBottom: '1px solid var(--theme-hairline)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] truncate" style={{ color: 'var(--theme-text)', fontWeight: m.seen ? 400 : 600 }}>{m.fromName || m.from}</span>
                <span className="text-[10px] opacity-50 shrink-0" style={{ color: 'var(--theme-muted)' }}>{fmtDate(m.date)}</span>
              </div>
              <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--theme-muted)' }}>{m.subject}</div>
            </button>
          ))}
        </div>
      </aside>

      {/* main: reader / compose / setup */}
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 340 }}>
        {err && <div className="px-4 py-2 text-[12px] shrink-0" style={{ color: 'var(--theme-error)', borderBottom: '1px solid var(--theme-hairline)' }}>{err}</div>}
        {view === 'setup' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[460px] mx-auto space-y-3">
              {/* The easy path: one Google sign-in connects email AND calendar. */}
              <GoogleConnectCard onConnected={() => { void (async () => {
                const r = await window.electron.email.getAccount()
                const acct = r.ok ? r.account : null
                setAccount(acct)
                if (acct) { setView('inbox'); void loadList() }
              })() }} />
              <div className="flex items-center gap-3 py-1">
                <span className="flex-1 h-px" style={{ backgroundColor: 'var(--theme-hairline)' }} />
                <span className="text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--theme-muted)' }}>or connect manually</span>
                <span className="flex-1 h-px" style={{ backgroundColor: 'var(--theme-hairline)' }} />
              </div>
              <div className="text-[12.5px] mb-1" style={{ color: 'var(--theme-muted)' }}>Pick your provider and the servers fill in. You'll need an app password (links below), not your normal login password.</div>
              {/* provider presets — one click fills the server plumbing */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { name: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465, help: 'https://myaccount.google.com/apppasswords', helpLabel: 'Create a Google app password (needs 2-step verification)' },
                  { name: 'Outlook', imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp-mail.outlook.com', smtpPort: 587, help: 'https://account.microsoft.com/security', helpLabel: 'Create a Microsoft app password (Security → advanced options)' },
                  { name: 'iCloud', imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587, help: 'https://appleid.apple.com/account/manage', helpLabel: 'Create an Apple app-specific password' },
                ] as const).map((p) => {
                  const active = f.imapHost === p.imapHost
                  return (
                    <button
                      key={p.name}
                      onClick={() => setF({ ...f, imapHost: p.imapHost, imapPort: p.imapPort, smtpHost: p.smtpHost, smtpPort: p.smtpPort })}
                      className="px-2 py-2 rounded-lg text-[12px] font-medium transition-colors"
                      style={{
                        border: active ? '1px solid var(--theme-primary)' : '1px solid var(--theme-border)',
                        backgroundColor: active ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : 'transparent',
                        color: active ? 'var(--theme-primary)' : 'var(--theme-text)',
                      }}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
              {(() => {
                const preset = [
                  { imapHost: 'imap.gmail.com', help: 'https://myaccount.google.com/apppasswords', label: 'Gmail needs an app password — create one here (requires 2-step verification)' },
                  { imapHost: 'outlook.office365.com', help: 'https://account.microsoft.com/security', label: 'Outlook needs an app password — Security → advanced security options' },
                  { imapHost: 'imap.mail.me.com', help: 'https://appleid.apple.com/account/manage', label: 'iCloud needs an app-specific password — create one here' },
                ].find((p) => p.imapHost === f.imapHost)
                return preset ? (
                  <a href={preset.help} target="_blank" rel="noreferrer" className="block text-[11.5px] underline underline-offset-2" style={{ color: 'var(--theme-primary)' }}>
                    {preset.label} ↗
                  </a>
                ) : null
              })()}
              {field('Email address', f.email, (v) => setF({ ...f, email: v }), 'email', 'you@example.com')}
              {field(account?.passwordSet ? 'Password (leave blank to keep current)' : 'Password / app password', f.password, (v) => setF({ ...f, password: v }), 'password', '••••••••')}
              <div className="grid grid-cols-2 gap-3">
                {field('IMAP host', f.imapHost, (v) => setF({ ...f, imapHost: v }), 'text', 'imap.gmail.com')}
                {field('IMAP port', f.imapPort, (v) => setF({ ...f, imapPort: Number(v) || 993 }), 'number')}
                {field('SMTP host', f.smtpHost, (v) => setF({ ...f, smtpHost: v }), 'text', 'smtp.gmail.com')}
                {field('SMTP port', f.smtpPort, (v) => setF({ ...f, smtpPort: Number(v) || 465 }), 'number')}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={saveAccount} disabled={savingAcct || !f.email || !f.imapHost || !f.smtpHost} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>{savingAcct ? <Loader2 size={13} className="animate-spin" /> : null} Save &amp; connect</button>
                {account && <button onClick={() => setView('inbox')} className="px-3 py-2 rounded-lg text-[12px]" style={{ color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}>Cancel</button>}
              </div>
            </div>
          </div>
        ) : view === 'compose' ? (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-[640px] mx-auto space-y-2">
              <button onClick={() => setView('inbox')} className="flex items-center gap-1 text-[11.5px] mb-1" style={{ color: 'var(--theme-muted)' }}><ArrowLeft size={12} /> Inbox</button>
              {field('To', c.to, (v) => setC({ ...c, to: v }), 'email', 'recipient@example.com')}
              {field('Subject', c.subject, (v) => setC({ ...c, subject: v }))}
              <label className="flex flex-col gap-1 text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>Message
                <textarea value={c.text} onChange={(e) => setC({ ...c, text: e.target.value })} className="bg-transparent outline-none resize-none text-[12.5px] rounded-lg px-2.5 py-2 min-h-[260px]" style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
              </label>
              <button onClick={send} disabled={sending || !c.to.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>{sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 min-w-0">
            {loadingMsg ? (
              <div className="flex items-center gap-2 text-[12px] opacity-60"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : openMsg ? (
              <div>
                <div className="text-[18px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>{openMsg.subject}</div>
                <div className="text-[11.5px] mb-5" style={{ color: 'var(--theme-muted)' }}>{openMsg.from} → {openMsg.to} · {fmtDate(openMsg.date)}</div>
                <div className="text-[13.5px] leading-[1.7] whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>{openMsg.text}</div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>Select a message to read.</div>
            )}
          </div>
        )}
      </div>

      {/* right: docked assistant */}
      <WorkspaceAssistant onNewSession={onNewSession} hint="reads & sends mail" />
    </div>
  )
}
