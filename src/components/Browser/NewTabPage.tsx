import React, { useEffect, useState } from 'react'
import { Search, Folder, Plus, X } from 'lucide-react'
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
    <div className="absolute inset-0 overflow-y-auto" style={{ backgroundColor: 'var(--theme-bg)' }}>
      <div className="max-w-[720px] mx-auto px-8 pt-[10vh] pb-16 flex flex-col items-center gap-8">
        {/* clock + greeting */}
        <div className="text-center select-none">
          <div className="text-[56px] font-semibold tracking-tight tabular-nums leading-none" style={{ color: 'var(--theme-text)' }}>
            {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="text-[15px] mt-2" style={{ color: 'var(--theme-muted)' }}>
            {greeting(now)}
          </div>
        </div>

        {/* search */}
        <div
          className="w-full max-w-[560px] flex items-center gap-2.5 rounded-2xl px-5 py-3.5 transition-colors focus-within:border-[color:var(--theme-primary)]"
          style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
        >
          <Search size={17} style={{ color: 'var(--theme-muted)' }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onOpen(q) }}
            placeholder="Search or Enter URL…"
            className="flex-1 bg-transparent outline-none text-[15px]"
            style={{ color: 'var(--theme-text)' }}
          />
        </div>

        {/* shortcuts — the user's own; empty starts empty with just the + tile */}
        <div className="w-full flex flex-col gap-3">
          <div className="grid gap-2 justify-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 88px))' }}>
            {spaces.pins.map((s) => (
              <Tile key={s.id} site={s} onOpen={onOpen} />
            ))}
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/5 transition-colors"
              title="Add shortcut"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ border: '1.5px dashed var(--theme-border)', color: 'var(--theme-muted)' }}
              >
                {adding ? <X size={20} /> : <Plus size={20} />}
              </div>
              <span className="text-[11px]" style={{ color: 'var(--theme-muted)' }}>{adding ? 'Cancel' : 'Add'}</span>
            </button>
          </div>

          {adding && (
            <div
              className="mx-auto w-full max-w-[420px] flex flex-col gap-2 rounded-xl p-3"
              style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
            >
              <input
                autoFocus
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitShortcut() }}
                placeholder="URL (e.g. github.com)"
                className="bg-transparent outline-none text-[13px] rounded-lg px-3 py-2"
                style={{ color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              />
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitShortcut() }}
                placeholder="Name (optional)"
                className="bg-transparent outline-none text-[13px] rounded-lg px-3 py-2"
                style={{ color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              />
              <button
                onClick={submitShortcut}
                disabled={!draftUrl.trim()}
                className="rounded-lg px-3 py-2 text-[12.5px] font-medium disabled:opacity-40"
                style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}
              >
                Add shortcut
              </button>
            </div>
          )}
        </div>

        {/* folders (only if the user made some) */}
        {spaces.folders.filter((f) => f.sites.length > 0).map((f) => (
          <div key={f.id} className="w-full flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--theme-muted)' }}>
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
      className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/5 transition-colors"
      title={site.url}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-hairline)' }}
      >
        <SiteIcon url={site.url} size={24} />
      </div>
      <span className="text-[11px] truncate max-w-[82px]" style={{ color: 'var(--theme-muted)' }}>{site.title}</span>
    </button>
  )
}
