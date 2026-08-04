import React, { useEffect, useState } from 'react'
import { Search, Folder, Plus, X, Compass, ShieldCheck, ArrowRight } from 'lucide-react'
import { SiteIcon } from './SiteIcon'
import type { BrowserSpaces, BrowserSite } from './useBrowserSpaces'

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 5) return 'Up late?'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The start page for a blank tab — big-browser style landing: live clock +
 * greeting, a prominent search box, and the user's OWN shortcut tiles with an
 * inline "add" tile (new users start empty; no canned content). Navigation is
 * delegated to BrowserMode so it drives the active webview.
 */
export function NewTabPage({ spaces, onOpen, onAddShortcut }: {
  spaces: BrowserSpaces
  onOpen: (urlOrQuery: string) => void
  onAddShortcut: (site: { title: string; url: string }) => void
}) {
  const [q, setQ] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftUrl, setDraftUrl] = useState('')

  // Minute-resolution clock — no seconds shown, so a 30s tick keeps it honest.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const submitShortcut = () => {
    const url = draftUrl.trim()
    if (!url) return
    const normalized = /^https?:\/\//i.test(url) ? url : 'https://' + url
    onAddShortcut({ title: draftName.trim() || urlLabel(normalized), url: normalized })
    setDraftName(''); setDraftUrl(''); setAdding(false)
  }

  return (
    <div className="browser-newtab absolute inset-0 overflow-y-auto">
      <div className="relative max-w-[760px] mx-auto px-8 pt-[8vh] pb-16 flex flex-col items-center gap-7">
        {/* branded browser hero */}
        <div className="hero-orbit w-14 h-14 select-none">
          <div
            className="assistant-mark w-full h-full rounded-2xl flex items-center justify-center"
            style={{ color: 'var(--theme-primary)' }}
          >
            <Compass size={23} />
          </div>
        </div>
        <div className="text-center select-none">
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 mb-3 text-[9px] font-mono uppercase tracking-[0.13em]"
            style={{
              color: 'var(--theme-primary)',
              backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--theme-primary) 22%, transparent)',
            }}
          >
            <ShieldCheck size={10} />
            Agent-ready browsing
          </div>
          <h1 className="text-[34px] font-semibold tracking-[-0.04em] leading-none" style={{ color: 'var(--theme-text)' }}>
            Where to next?
          </h1>
          <div className="flex items-center justify-center gap-2 text-[12px] mt-3 font-mono" style={{ color: 'var(--theme-muted)' }}>
            <span>{greeting(now)}</span>
            <span className="opacity-30">·</span>
            <span className="tabular-nums opacity-70">
              {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* search */}
        <div
          className="newtab-search w-full max-w-[590px] flex items-center gap-3 rounded-2xl px-5 py-4"
        >
          <Search size={17} style={{ color: 'var(--theme-primary)' }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onOpen(q) }}
            placeholder="Search the web or jump to a URL"
            className="flex-1 bg-transparent outline-none text-[14px]"
            style={{ color: 'var(--theme-text)' }}
          />
          <button
            onClick={() => { if (q.trim()) onOpen(q) }}
            disabled={!q.trim()}
            className="send-button w-8 h-8 rounded-[10px] flex items-center justify-center disabled:opacity-35"
            title="Go"
          >
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="-mt-4 flex items-center gap-3 text-[9.5px] font-mono opacity-45" style={{ color: 'var(--theme-muted)' }}>
          <span>Search privately</span>
          <span>·</span>
          <span>Ask the assistant to read or click</span>
        </div>

        {/* shortcuts — the user's own; empty starts empty with just the + tile */}
        <div className="w-full max-w-[620px] flex flex-col gap-3 mt-1">
          <div className="flex items-center">
            <span className="browser-section-label">Quick launch</span>
            <span className="flex-1" />
            <span className="text-[9.5px] font-mono opacity-40" style={{ color: 'var(--theme-muted)' }}>
              {spaces.pins.length} saved
            </span>
          </div>
          <div className="grid gap-2 justify-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 88px))' }}>
            {spaces.pins.map((s) => (
              <Tile key={s.id} site={s} onOpen={onOpen} />
            ))}
            <button
              onClick={() => setAdding((v) => !v)}
              className="shortcut-tile flex flex-col items-center gap-2 p-3 rounded-xl"
              title="Add shortcut"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--theme-bg-raised) 64%, transparent)',
                  border: '1px dashed var(--theme-hairline-strong)',
                  color: 'var(--theme-muted)',
                }}
              >
                {adding ? <X size={20} /> : <Plus size={20} />}
              </div>
              <span className="text-[11px]" style={{ color: 'var(--theme-muted)' }}>{adding ? 'Cancel' : 'Add'}</span>
            </button>
          </div>

          {adding && (
            <div
              className="feature-card mx-auto w-full max-w-[440px] flex flex-col gap-2 rounded-xl p-3"
            >
              <input
                autoFocus
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitShortcut() }}
                placeholder="URL (e.g. github.com)"
                className="field-shell outline-none text-[13px] rounded-lg px-3 py-2.5"
                style={{ color: 'var(--theme-text)' }}
              />
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitShortcut() }}
                placeholder="Name (optional)"
                className="field-shell outline-none text-[13px] rounded-lg px-3 py-2.5"
                style={{ color: 'var(--theme-text)' }}
              />
              <button
                onClick={submitShortcut}
                disabled={!draftUrl.trim()}
                className="primary-action rounded-lg px-3 py-2.5 text-[12.5px] font-medium disabled:opacity-40"
              >
                Add shortcut
              </button>
            </div>
          )}
        </div>

        {/* folders (only if the user made some) */}
        {spaces.folders.filter((f) => f.sites.length > 0).map((f) => (
          <div key={f.id} className="w-full max-w-[620px] flex flex-col gap-2">
            <div className="browser-section-label flex items-center gap-1.5">
              <Folder size={12} /> {f.name}
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 88px))' }}>
              {f.sites.map((s) => <Tile key={s.id} site={s} onOpen={onOpen} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function urlLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function Tile({ site, onOpen }: { site: BrowserSite; onOpen: (url: string) => void }) {
  return (
    <button
      onClick={() => onOpen(site.url)}
      className="shortcut-tile flex flex-col items-center gap-2 p-3 rounded-xl"
      title={site.url}
    >
      <div
        className="browser-pin w-12 h-12 rounded-xl flex items-center justify-center"
      >
        <SiteIcon url={site.url} size={24} />
      </div>
      <span className="text-[11px] truncate max-w-[82px]" style={{ color: 'var(--theme-muted)' }}>{site.title}</span>
    </button>
  )
}
