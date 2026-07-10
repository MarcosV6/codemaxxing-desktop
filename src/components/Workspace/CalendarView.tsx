import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { WorkspaceAssistant } from './WorkspaceAssistant'
import { ArrowLeft, Loader2, RefreshCw, Settings as Cog, MapPin } from 'lucide-react'

interface Ev { summary: string; start: number; end: number; location: string; calendar: string }
interface Account { url: string; username: string; passwordSet: boolean }

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const timeLabel = (ms: number) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '')

/**
 * Calendar as a full-page workspace: an agenda of upcoming events (or CalDAV
 * setup), the agent assistant docked on the right. The loaded events are
 * reported to main so calendar_list sees them; calendar_add creates events and
 * the agenda re-syncs on calendar:changed.
 */
export function CalendarView({ onNewSession }: { onNewSession: () => void }) {
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
    try {
      const r = await window.electron.calendar.events({})
      if (r.ok) { setEvents(r.events || []); window.electron.calendar.setEvents((r.events || []).map((e) => ({ summary: e.summary, start: e.start, end: e.end, location: e.location }))) }
      else setErr(r.error || 'Failed to load events')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    setErr(null)
    void (async () => {
      const r = await window.electron.calendar.getAccount()
      const acct = r.ok ? r.account : null
      setAccount(acct)
      if (acct) { setF((p) => ({ ...p, url: acct.url, username: acct.username, password: '' })); setView('list'); void loadEvents() }
      else setView('setup')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => window.electron.calendar.onChanged(() => void loadEvents()), [loadEvents])

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

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/5 transition-colors'
  let lastDay = ''

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0" style={{ minWidth: 340 }}>
        <div className="h-12 flex items-center gap-1 pl-[80px] pr-2 shrink-0" style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--theme-hairline)' } as React.CSSProperties}>
          <button onClick={() => close()} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5 transition-colors" style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="Exit Calendar"><ArrowLeft size={13} /> exit</button>
          <span className="text-[13px] font-medium" style={{ color: 'var(--theme-text)' }}>Calendar</span>
          <span className="flex-1" />
          {account && view === 'list' && <button onClick={() => void loadEvents()} className={iconBtn} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="Refresh"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>}
          {account && <button onClick={() => setView('setup')} className={iconBtn} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="Account"><Cog size={13} /></button>}
        </div>

        {err && <div className="px-4 py-2 text-[12px] shrink-0" style={{ color: 'var(--theme-error)', borderBottom: '1px solid var(--theme-hairline)' }}>{err}</div>}

        {view === 'setup' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[460px] mx-auto space-y-3">
              <div className="text-[12.5px] mb-1" style={{ color: 'var(--theme-muted)' }}>Connect a CalDAV calendar — pick a provider or enter any CalDAV URL (Radicale, Nextcloud…). Apple/Fastmail need an app password, links below.</div>
              {/* provider presets. Google Calendar is OAuth-only over CalDAV,
                  so it can't be offered here — iCloud/Fastmail work great with
                  app passwords. */}
              <div className="grid grid-cols-2 gap-2">
                {([
                  { name: 'iCloud', url: 'https://caldav.icloud.com/', help: 'https://appleid.apple.com/account/manage', label: 'Create an Apple app-specific password' },
                  { name: 'Fastmail', url: 'https://caldav.fastmail.com/dav/', help: 'https://app.fastmail.com/settings/security/devicekeys', label: 'Create a Fastmail app password' },
                ] as const).map((p) => {
                  const active = f.url === p.url
                  return (
                    <button
                      key={p.name}
                      onClick={() => setF({ ...f, url: p.url })}
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
                  { url: 'https://caldav.icloud.com/', help: 'https://appleid.apple.com/account/manage', label: 'iCloud needs an app-specific password — create one here' },
                  { url: 'https://caldav.fastmail.com/dav/', help: 'https://app.fastmail.com/settings/security/devicekeys', label: 'Fastmail needs an app password — create one here' },
                ].find((p) => p.url === f.url)
                return preset ? (
                  <a href={preset.help} target="_blank" rel="noreferrer" className="block text-[11.5px] underline underline-offset-2" style={{ color: 'var(--theme-primary)' }}>
                    {preset.label} ↗
                  </a>
                ) : null
              })()}
              {field('CalDAV URL', f.url, (v) => setF({ ...f, url: v }), 'text', 'https://caldav.example.com/')}
              {field('Username', f.username, (v) => setF({ ...f, username: v }), 'text', 'you@example.com')}
              {field(account?.passwordSet ? 'Password (leave blank to keep current)' : 'Password / app password', f.password, (v) => setF({ ...f, password: v }), 'password', '••••••••')}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={save} disabled={saving || !f.url || !f.username} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium disabled:opacity-40" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>{saving ? <Loader2 size={13} className="animate-spin" /> : null} Save &amp; sync</button>
                {account && <button onClick={() => setView('list')} className="px-3 py-2 rounded-lg text-[12px]" style={{ color: 'var(--theme-muted)', border: '1px solid var(--theme-border)' }}>Cancel</button>}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[680px] mx-auto">
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
          </div>
        )}
      </div>

      <WorkspaceAssistant onNewSession={onNewSession} hint="lists & adds events" />
    </div>
  )
}
