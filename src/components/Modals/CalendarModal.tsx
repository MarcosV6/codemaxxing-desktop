import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { X, CalendarDays, Loader2, RefreshCw, Settings as Cog, MapPin } from 'lucide-react'

interface Ev { summary: string; start: number; end: number; location: string; calendar: string }
interface Account { url: string; username: string; passwordSet: boolean }

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const timeLabel = (ms: number) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '')

/** Calendar — configure a CalDAV account and view upcoming events. */
export function CalendarModal() {
  const open = useAppStore((s) => s.calendarOpen)
  const close = useAppStore((s) => s.closeCalendar)

  const [account, setAccount] = useState<Account | null>(null)
  const [view, setView] = useState<'list' | 'setup'>('list')
  const [events, setEvents] = useState<Ev[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ url: '', username: '', password: '' })
  const [saving, setSaving] = useState(false)

  const loadEvents = useCallback(async () => {
    setLoading(true); setErr(null)
    try { const r = await window.electron.calendar.events({}); if (r.ok) setEvents(r.events || []); else setErr(r.error || 'Failed to load events') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setErr(null)
    void (async () => {
      const r = await window.electron.calendar.getAccount()
      const acct = r.ok ? r.account : null
      setAccount(acct)
      if (acct) { setF((p) => ({ ...p, url: acct.url, username: acct.username, password: '' })); setView('list'); void loadEvents() }
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

  const save = async () => {
    setSaving(true)
    try { await window.electron.calendar.saveAccount(f); const r = await window.electron.calendar.getAccount(); setAccount(r.ok ? r.account : null); setView('list'); void loadEvents() }
    finally { setSaving(false) }
  }

  const field = (label: string, value: string, onChange: (v: string) => void, type = 'text', placeholder = '') => (
    <label className="flex flex-col gap-1 text-[11.5px]" style={{ color: 'var(--theme-muted)' }}>
      {label}
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none text-[12.5px] rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-text)', backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
    </label>
  )

  let lastDay = ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="w-full max-w-[760px] h-full max-h-[88vh] flex flex-col rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}>
        <div className="h-12 flex items-center justify-between px-4 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div className="flex items-center gap-2"><CalendarDays size={14} style={{ color: 'var(--theme-primary)' }} /><span className="text-[13px] font-medium tracking-tight">Calendar</span></div>
          <div className="flex items-center gap-1">
            {account && view === 'list' && <button onClick={() => void loadEvents()} className="w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/5" title="Refresh"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>}
            {account && <button onClick={() => setView('setup')} className="w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/5" title="Account settings"><Cog size={13} /></button>}
            <button onClick={close} className="w-7 h-7 rounded-md flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-white/5"><X size={14} /></button>
          </div>
        </div>

        {err && <div className="px-4 py-2 text-[12px] shrink-0" style={{ color: 'var(--theme-error)', borderBottom: '1px solid var(--theme-border)' }}>{err}</div>}

        {view === 'setup' ? (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-[460px] mx-auto space-y-3">
              <div className="text-[12.5px] mb-1" style={{ color: 'var(--theme-muted)' }}>Connect a CalDAV server (Radicale, Nextcloud, Apple iCloud, Fastmail…).</div>
              {field('CalDAV URL', f.url, (v) => setF({ ...f, url: v }), 'text', 'https://caldav.example.com/')}
              {field('Username', f.username, (v) => setF({ ...f, username: v }), 'text', 'you@example.com')}
              {field(account?.passwordSet ? 'Password (leave blank to keep current)' : 'Password / app password', f.password, (v) => setF({ ...f, password: v }), 'password', '••••••••')}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={save} disabled={saving || !f.url || !f.username} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>{saving ? <Loader2 size={13} className="animate-spin" /> : null} Save & sync</button>
                {account && <button onClick={() => setView('list')} className="px-3 py-2 rounded-lg text-[12px]" style={{ color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}>Cancel</button>}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="text-[11px] uppercase tracking-wider opacity-50 mb-3" style={{ color: 'var(--theme-muted)' }}>Next 30 days</div>
            {loading && events.length === 0 && <div className="flex items-center gap-2 text-[12px] opacity-60"><Loader2 size={13} className="animate-spin" /> Syncing…</div>}
            {!loading && events.length === 0 && <div className="text-[12.5px] opacity-50" style={{ color: 'var(--theme-muted)' }}>No upcoming events.</div>}
            <div className="space-y-1">
              {events.map((ev, i) => {
                const day = dayLabel(ev.start)
                const showHeader = day !== lastDay
                lastDay = day
                return (
                  <React.Fragment key={i}>
                    {showHeader && <div className="text-[11.5px] font-medium mt-4 mb-1.5" style={{ color: 'var(--theme-primary)' }}>{day}</div>}
                    <div className="flex items-start gap-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                      <div className="text-[11px] font-mono shrink-0 w-[42px] pt-0.5" style={{ color: 'var(--theme-muted)' }}>{timeLabel(ev.start) || 'all day'}</div>
                      <div className="min-w-0">
                        <div className="text-[12.5px]" style={{ color: 'var(--theme-text)' }}>{ev.summary}</div>
                        {ev.location && <div className="text-[11px] mt-0.5 flex items-center gap-1 opacity-70" style={{ color: 'var(--theme-muted)' }}><MapPin size={10} /> {ev.location}</div>}
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
