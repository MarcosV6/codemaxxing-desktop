import { useCallback, useEffect, useState } from 'react'

/** A saved site — a pinned favorite or an entry inside a folder. */
export interface BrowserSite { id: string; title: string; url: string }
/** A named, collapsible group of saved sites (Arc-style). */
export interface BrowserFolder { id: string; name: string; sites: BrowserSite[]; collapsed?: boolean }
export interface BrowserSpaces { pins: BrowserSite[]; folders: BrowserFolder[] }

const KEY = 'browser-spaces-v1'
const uid = () => Math.random().toString(36).slice(2, 9)

/** New users start with a CLEAN browser — no canned pins or folders. The
 *  start page invites them to add their own shortcuts. */
function defaults(): BrowserSpaces {
  return { pins: [], folders: [] }
}

function load(): BrowserSpaces {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const p = JSON.parse(raw)
    return {
      pins: Array.isArray(p?.pins) ? p.pins : [],
      folders: Array.isArray(p?.folders) ? p.folders : [],
    }
  } catch {
    return defaults()
  }
}

/**
 * Pinned sites + folders for the browser rail / new-tab page. Persisted to
 * localStorage. Call once (in BrowserMode) and pass the state + actions down —
 * a second hook instance would not stay live-synced with the first.
 */
export function useBrowserSpaces() {
  const [spaces, setSpaces] = useState<BrowserSpaces>(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(spaces)) } catch { /* noop */ }
  }, [spaces])

  const pinSite = useCallback((site: { title: string; url: string }) => setSpaces((s) => {
    if (!site.url || s.pins.some((p) => p.url === site.url)) return s
    return { ...s, pins: [...s.pins, { id: uid(), title: site.title || site.url, url: site.url }] }
  }), [])

  const unpin = useCallback((id: string) => setSpaces((s) => ({ ...s, pins: s.pins.filter((p) => p.id !== id) })), [])

  const addFolder = useCallback((name: string) => setSpaces((s) => (
    name.trim() ? { ...s, folders: [...s.folders, { id: uid(), name: name.trim(), sites: [] }] } : s
  )), [])

  const removeFolder = useCallback((id: string) => setSpaces((s) => ({ ...s, folders: s.folders.filter((f) => f.id !== id) })), [])

  const toggleFolder = useCallback((id: string) => setSpaces((s) => ({
    ...s,
    folders: s.folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)),
  })), [])

  const addSiteToFolder = useCallback((folderId: string, site: { title: string; url: string }) => setSpaces((s) => ({
    ...s,
    folders: s.folders.map((f) => {
      if (f.id !== folderId) return f
      if (!site.url || f.sites.some((x) => x.url === site.url)) return f
      return { ...f, sites: [...f.sites, { id: uid(), title: site.title || site.url, url: site.url }], collapsed: false }
    }),
  })), [])

  const removeSiteFromFolder = useCallback((folderId: string, siteId: string) => setSpaces((s) => ({
    ...s,
    folders: s.folders.map((f) => (f.id === folderId ? { ...f, sites: f.sites.filter((x) => x.id !== siteId) } : f)),
  })), [])

  return { spaces, pinSite, unpin, addFolder, removeFolder, toggleFolder, addSiteToFolder, removeSiteFromFolder }
}
