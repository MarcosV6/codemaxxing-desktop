import React, { useState } from 'react'
import { Search, Folder } from 'lucide-react'
import { SiteIcon } from './SiteIcon'
import type { BrowserSpaces, BrowserSite } from './useBrowserSpaces'

/**
 * The page shown for a blank tab — a centered search box plus the pinned sites
 * and folders as big quick-link tiles (Arc-style). Navigation is delegated to
 * BrowserMode so it drives the same active webview.
 */
export function NewTabPage({ spaces, onOpen }: {
  spaces: BrowserSpaces
  onOpen: (urlOrQuery: string) => void
}) {
  const [q, setQ] = useState('')

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ backgroundColor: 'var(--theme-bg)' }}>
      <div className="max-w-[780px] mx-auto px-8 py-14 flex flex-col gap-10">
        {/* search */}
        <div className="flex flex-col items-center gap-5 pt-4">
          <div className="text-[22px] font-semibold tracking-tight" style={{ color: 'var(--theme-text)' }}>
            Where to?
          </div>
          <div
            className="w-full max-w-[540px] flex items-center gap-2.5 rounded-xl px-4 py-3"
            style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
          >
            <Search size={16} style={{ color: 'var(--theme-muted)' }} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) onOpen(q) }}
              placeholder="Search or Enter URL…"
              className="flex-1 bg-transparent outline-none text-[14px]"
              style={{ color: 'var(--theme-text)' }}
            />
          </div>
        </div>

        {spaces.pins.length > 0 && (
          <Section title="Pinned">
            <TileGrid sites={spaces.pins} onOpen={onOpen} />
          </Section>
        )}

        {spaces.folders.filter((f) => f.sites.length > 0).map((f) => (
          <Section key={f.id} title={f.name} icon={<Folder size={12} />}>
            <TileGrid sites={f.sites} onOpen={onOpen} />
          </Section>
        ))}
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-mono" style={{ color: 'var(--theme-muted)' }}>
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function TileGrid({ sites, onOpen }: { sites: BrowserSite[]; onOpen: (url: string) => void }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))' }}>
      {sites.map((s) => (
        <button
          key={s.id}
          onClick={() => onOpen(s.url)}
          className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-white/5 transition-colors"
          title={s.url}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-hairline)' }}
          >
            <SiteIcon url={s.url} size={24} />
          </div>
          <span className="text-[11px] truncate max-w-[82px]" style={{ color: 'var(--theme-muted)' }}>{s.title}</span>
        </button>
      ))}
    </div>
  )
}
