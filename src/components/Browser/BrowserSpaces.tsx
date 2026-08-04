import React, { useState } from 'react'
import { X, Plus, ChevronRight, ChevronDown, Folder, FolderPlus, Pin } from 'lucide-react'
import { SiteIcon } from './SiteIcon'
import type { BrowserSpaces as Spaces } from './useBrowserSpaces'

interface Props {
  spaces: Spaces
  /** The active tab, used for "pin current page" / "add current to folder". */
  current: { title: string; url: string } | null
  onOpen: (url: string) => void
  pinSite: (s: { title: string; url: string }) => void
  unpin: (id: string) => void
  addFolder: (name: string) => void
  removeFolder: (id: string) => void
  toggleFolder: (id: string) => void
  addSiteToFolder: (folderId: string, s: { title: string; url: string }) => void
  removeSiteFromFolder: (folderId: string, siteId: string) => void
}

/**
 * The Arc-style spaces panel in the browser rail: a pinned-favorites grid and
 * collapsible site folders, with inline management. Lives above the open-tabs
 * list. All persistent state is owned by the parent's useBrowserSpaces hook.
 */
export function BrowserSpaces({
  spaces, current, onOpen, pinSite, unpin,
  addFolder, removeFolder, toggleFolder, addSiteToFolder, removeSiteFromFolder,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const canUseCurrent = !!current?.url

  const commitFolder = () => {
    if (draft.trim()) addFolder(draft)
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Pinned favorites grid ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center px-1">
          <span className="browser-section-label">Pinned</span>
          <span className="flex-1" />
          {canUseCurrent && (
            <button
              onClick={() => pinSite(current!)}
              className="browser-control text-[9.5px] flex items-center gap-1 px-1.5 py-1 rounded-md"
              style={{ color: 'var(--theme-muted)' }}
              title="Pin current page"
            >
              <Pin size={10} /> pin
            </button>
          )}
        </div>
        {spaces.pins.length === 0 ? (
          <div
            className="mx-0.5 rounded-lg px-2.5 py-2 flex items-center gap-2"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-bg-raised) 46%, transparent)',
              border: '1px dashed var(--theme-hairline-strong)',
              color: 'var(--theme-muted)',
            }}
          >
            <Pin size={11} className="shrink-0 opacity-60" />
            <span className="text-[10.5px] opacity-60">Pin pages you use every day</span>
          </div>
        ) : (
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))' }}>
            {spaces.pins.map((p) => (
              <div key={p.id} className="group relative">
                <button
                  onClick={() => onOpen(p.url)}
                  title={p.title}
                  className="browser-pin w-full aspect-square rounded-lg flex items-center justify-center"
                >
                  <SiteIcon url={p.url} size={18} />
                </button>
                <button
                  onClick={() => unpin(p.id)}
                  title="Unpin"
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full hidden group-hover:flex items-center justify-center"
                  style={{ backgroundColor: 'var(--theme-bg-raised)', color: 'var(--theme-muted)', border: '1px solid var(--theme-hairline)' }}
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Folders ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center px-1">
          <span className="browser-section-label">Collections</span>
          <span className="flex-1" />
          <button
            onClick={() => { setAdding(true); setDraft('') }}
            className="browser-control text-[9.5px] flex items-center gap-1 px-1.5 py-1 rounded-md"
            style={{ color: 'var(--theme-muted)' }}
            title="New folder"
          >
            <FolderPlus size={11} />
          </button>
        </div>

        {adding && (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitFolder(); else if (e.key === 'Escape') { setAdding(false); setDraft('') } }}
            onBlur={commitFolder}
            placeholder="Folder name"
            className="field-shell mx-1 outline-none text-[11.5px] rounded-lg px-2.5 py-2"
            style={{ color: 'var(--theme-text)' }}
          />
        )}

        {spaces.folders.length === 0 && !adding && (
          <button
            onClick={() => { setAdding(true); setDraft('') }}
            className="mx-0.5 rounded-lg px-2.5 py-2 flex items-center gap-2 text-left"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--theme-bg-raised) 38%, transparent)',
              border: '1px solid var(--theme-hairline)',
              color: 'var(--theme-muted)',
            }}
          >
            <FolderPlus size={11} className="opacity-60" />
            <span className="text-[10.5px] opacity-60">Create a collection</span>
          </button>
        )}

        {spaces.folders.map((f) => (
          <div key={f.id} className="flex flex-col">
            <div
              className="browser-tab-row group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer"
              onClick={() => toggleFolder(f.id)}
            >
              {f.collapsed ? <ChevronRight size={13} style={{ color: 'var(--theme-muted)' }} /> : <ChevronDown size={13} style={{ color: 'var(--theme-muted)' }} />}
              <Folder size={12} style={{ color: 'var(--theme-muted)' }} />
              <span className="flex-1 truncate text-[12px]" style={{ color: 'var(--theme-text)' }}>{f.name}</span>
              <span className="text-[10px] opacity-50" style={{ color: 'var(--theme-muted)' }}>{f.sites.length}</span>
              {canUseCurrent && (
                <button
                  onClick={(e) => { e.stopPropagation(); addSiteToFolder(f.id, current!) }}
                  className="w-4 h-4 rounded hidden group-hover:flex items-center justify-center hover:bg-white/10"
                  style={{ color: 'var(--theme-muted)' }}
                  title="Add current page"
                >
                  <Plus size={11} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); removeFolder(f.id) }}
                className="w-4 h-4 rounded hidden group-hover:flex items-center justify-center hover:bg-white/10"
                style={{ color: 'var(--theme-muted)' }}
                title="Delete folder"
              >
                <X size={11} />
              </button>
            </div>

            {!f.collapsed && f.sites.map((s) => (
              <div
                key={s.id}
                onClick={() => onOpen(s.url)}
                className="browser-tab-row group flex items-center gap-2 pl-7 pr-1.5 py-1.5 rounded-lg cursor-pointer"
              >
                <SiteIcon url={s.url} size={13} />
                <span className="flex-1 truncate text-[12px]" style={{ color: 'var(--theme-muted)' }}>{s.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeSiteFromFolder(f.id, s.id) }}
                  className="w-4 h-4 rounded hidden group-hover:flex items-center justify-center hover:bg-white/10 shrink-0"
                  style={{ color: 'var(--theme-muted)' }}
                  title="Remove"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
