import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, Mail, Loader2, RefreshCw, Send, Settings as Cog, PenSquare, ArrowLeft } from 'lucide-react'

interface Msg { uid: number; from: string; fromName: string; subject: string; date: number; seen: boolean }
interface FullMsg { uid: number; from: string; to: string; subject: string; date: number; text: string }
interface Account { email: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; passwordSet: boolean }

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** Email — configure an IMAP/SMTP account, browse the inbox, read & compose. */
export function EmailModal() {
  const open = useAppStore((s) => s.emailOpen)
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

  const loadList = useCallback(async () => {
    setLoadingList(true); setErr(null)
    try { const r = await window.electron.email.list({ limit: 25 }); if (r.ok) setMessages(r.messages || []); else setErr(r.error || 'Failed to load inbox') }
    finally { setLoadingList(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setOpenMsg(null); setErr(null)
    void (async () => {
      const r = await window.electron.email.getAccount()
      const acct = r.ok ? r.account : null
      setAccount(acct)
      if (acct) { setF((p) => ({ ...p, email: acct.email, password: '', imapHost: acct.imapHost, imapPort: acct.imapPort, smtpHost: acct.smtpHost, smtpPort: acct.smtpPort })); setView('inbox'); void loadList() }
      else setView('setup')
    })()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes — matches the drawer behavior.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="w-full max-w-[1000px] h-full max-h-[88vh] flex flex-col rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}>
        <div className="h-12 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div className="flex items-center gap-2"><Mail size={14} style={{ color: 'var(--theme-primary)' }} /><span className="text-[13px] font-medium tracking-tight">Email{account ? ` · ${account.email}` : ''}</span></div>
          <div className="flex items-center gap-1">
            {account && view !== 'compose' && <button onClick={() => { setView('compose'); setErr(null) }} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5" style={{ color: 'var(--theme-muted)' }}><PenSquare size={12} /> Compose</button>}
            {account && view === 'inbox' && <button onClick={() => void loadList()} className="w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/5" title="Refresh"><RefreshCw size={13} className={loadingList ? 'animate-spin' : ''} /></button>}
            {account && <button onClick={() => setView('setup')} className="w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/5" title="Account settings"><Cog size={13} /></button>}
            <button onClick={close} className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5"><X size={14} /></button>
          </div>
        </div>

        {err && <div className="px-4 py-2 text-[12px] shrink-0" style={{ color: 'var(--theme-error)', borderBottom: '1px solid var(--theme-border)' }}>{err}</div>}

        {view === 'setup' ? (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-[460px] mx-auto space-y-3">
              <div className="text-[12.5px] mb-1" style={{ color: 'var(--theme-muted)' }}>Connect an IMAP/SMTP mailbox. For Gmail/Outlook use an app password.</div>
              {field('Email address', f.email, (v) => setF({ ...f, email: v }), 'email', 'you@example.com')}
              {field(account?.passwordSet ? 'Password (leave blank to keep current)' : 'Password / app password', f.password, (v) => setF({ ...f, password: v }), 'password', '••••••••')}
              <div className="grid grid-cols-2 gap-3">
                {field('IMAP host', f.imapHost, (v) => setF({ ...f, imapHost: v }), 'text', 'imap.gmail.com')}
                {field('IMAP port', f.imapPort, (v) => setF({ ...f, imapPort: Number(v) || 993 }), 'number')}
                {field('SMTP host', f.smtpHost, (v) => setF({ ...f, smtpHost: v }), 'text', 'smtp.gmail.com')}
                {field('SMTP port', f.smtpPort, (v) => setF({ ...f, smtpPort: Number(v) || 465 }), 'number')}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={saveAccount} disabled={savingAcct || !f.email || !f.imapHost || !f.smtpHost} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>{savingAcct ? <Loader2 size={13} className="animate-spin" /> : null} Save & connect</button>
                {account && <button onClick={() => setView('inbox')} className="px-3 py-2 rounded-lg text-[12px]" style={{ color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}>Cancel</button>}
              </div>
            </div>
          </div>
        ) : view === 'compose' ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-[640px] mx-auto space-y-2">
              <button onClick={() => setView('inbox')} className="flex items-center gap-1 text-[11.5px] mb-1" style={{ color: 'var(--theme-muted)' }}><ArrowLeft size={12} /> Inbox</button>
              {field('To', c.to, (v) => setC({ ...c, to: v }), 'email', 'recipient@example.com')}
              {field('Subject', c.subject, (v) => setC({ ...c, subject: v }))}
              <label className="flex flex-col gap-1 text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>Message
                <textarea value={c.text} onChange={(e) => setC({ ...c, text: e.target.value })} className="bg-transparent outline-none resize-none text-[12.5px] rounded-lg px-2.5 py-2 min-h-[220px]" style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
              </label>
              <button onClick={send} disabled={sending || !c.to.trim()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>{sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            <div className="w-[300px] shrink-0 overflow-y-auto" style={{ borderRight: '1px solid var(--theme-border)' }}>
              {loadingList && messages.length === 0 && <div className="flex items-center gap-2 text-[12px] opacity-60 p-4"><Loader2 size={13} className="animate-spin" /> Loading inbox…</div>}
              {!loadingList && messages.length === 0 && <div className="text-[12px] opacity-50 p-4" style={{ color: 'var(--theme-muted)' }}>Inbox empty (or no messages fetched).</div>}
              {messages.map((m) => (
                <button key={m.uid} onClick={() => void openMessage(m.uid)} className="w-full text-left px-3 py-2.5 transition-colors" style={{ backgroundColor: openMsg?.uid === m.uid ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : 'transparent', borderBottom: '1px solid var(--theme-hairline, var(--theme-border))' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] truncate" style={{ color: 'var(--theme-text)', fontWeight: m.seen ? 400 : 600 }}>{m.fromName || m.from}</span>
                    <span className="text-[10px] opacity-50 shrink-0" style={{ color: 'var(--theme-muted)' }}>{fmtDate(m.date)}</span>
                  </div>
                  <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--theme-muted)' }}>{m.subject}</div>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5 min-w-0">
              {loadingMsg ? (
                <div className="flex items-center gap-2 text-[12px] opacity-60"><Loader2 size={13} className="animate-spin" /> Loading…</div>
              ) : openMsg ? (
                <div>
                  <div className="text-[16px] font-semibold mb-1" style={{ color: 'var(--theme-text)' }}>{openMsg.subject}</div>
                  <div className="text-[11.5px] mb-4" style={{ color: 'var(--theme-muted)' }}>{openMsg.from} → {openMsg.to} · {fmtDate(openMsg.date)}</div>
                  <div className="text-[13px] leading-[1.6] whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>{openMsg.text}</div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>Select a message to read.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
