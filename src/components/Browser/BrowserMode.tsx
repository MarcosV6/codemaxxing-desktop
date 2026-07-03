import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { BrowserTabView } from './BrowserTabView'
import { BrowserSpaces } from './BrowserSpaces'
import { BrowserAssistant } from './BrowserAssistant'
import { NewTabPage } from './NewTabPage'
import { SiteIcon } from './SiteIcon'
import { useBrowserSpaces } from './useBrowserSpaces'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'
import {
  ArrowLeft, Plus, ChevronLeft, ChevronRight, RotateCw, X, Search, Globe, Loader2,
  MessageSquare, Compass,
} from 'lucide-react'

type BrowserResult = { ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }
type BrowserCommand = { id: string; action: 'navigate' | 'read' | 'screenshot' | 'click' | 'type' | 'scroll'; url?: string; selector?: string; text?: string; submit?: boolean; direction?: string }
type BrowserBridge = {
  onCommand: (cb: (cmd: BrowserCommand) => void) => () => void
  sendResult: (id: string, r: BrowserResult) => void
  ready: () => void
  closed: () => void
}

function normalizeUrl(raw: string): string {
  const u = raw.trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) {
    return /^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(u) ? 'https://' + u : 'https://duckduckgo.com/?q=' + encodeURIComponent(u)
  }
  return u
}

/**
 * Browser mode — a full-takeover, Arc-style layout. Left: vertical tab strip +
 * URL bar + the agent assistant (collapsible). Right: the active tab's page.
 * The agent drives whichever tab is active via the browser_* tools.
 */
export function BrowserMode({ onNewSession }: { onNewSession: () => void }) {
  const tabs = useAppStore((s) => s.browserTabs)
  const activeId = useAppStore((s) => s.activeBrowserTabId)
  const addBrowserTab = useAppStore((s) => s.addBrowserTab)
  const closeBrowserTab = useAppStore((s) => s.closeBrowserTab)
  const setActiveBrowserTab = useAppStore((s) => s.setActiveBrowserTab)
  const updateBrowserTab = useAppStore((s) => s.updateBrowserTab)
  const exitBrowser = useAppStore((s) => s.exitBrowser)

  const left = useResizablePanel({ storageKey: 'browser-left', defaultWidth: 288, min: 240, max: 480, dock: 'left' })
  const right = useResizablePanel({ storageKey: 'browser-assistant-right', defaultWidth: 400, min: 320, max: 680, dock: 'right' })
  const browserSpaces = useBrowserSpaces()
  // Assistant placement: floating over the page (default) or docked to the
  // right as a resizable column. Persisted so it sticks across sessions.
  const [assistantDock, setAssistantDock] = useState<'float' | 'right'>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('browser-assistant-dock') === 'right' ? 'right' : 'float'),
  )
  const toggleAssistantDock = useCallback(() => {
    setAssistantDock((d) => {
      const next = d === 'right' ? 'float' : 'right'
      try { localStorage.setItem('browser-assistant-dock', next) } catch { /* noop */ }
      return next
    })
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const els = useRef(new Map<string, any>())
  const domReady = useRef(new Set<string>())
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const [urlDraft, setUrlDraft] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(false)
  // Entering the browser via a browser-type session bypasses the openBrowserPanel
  // path that seeds a tab, so make sure there's always at least one tab open.
  useEffect(() => { if (tabs.length === 0) addBrowserTab() }, [tabs.length, addBrowserTab])
  const activeTab = tabs.find((t) => t.id === activeId) || null
  useEffect(() => { setUrlDraft(activeTab?.url || '') }, [activeTab?.url, activeId])
  // The active tab as a saveable site (null on a blank tab) — used by the
  // spaces panel's "pin current" / "add current to folder" actions.
  const current = activeTab?.url ? { title: activeTab.title || activeTab.url, url: activeTab.url } : null

  const getActiveEl = () => (activeIdRef.current ? els.current.get(activeIdRef.current) : undefined)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registerEl = useCallback((id: string, el: any | null) => {
    if (el) els.current.set(id, el)
    else { els.current.delete(id); domReady.current.delete(id) }
  }, [])

  const signalReady = () => { try { (window as unknown as { electron?: { browser?: BrowserBridge } }).electron?.browser?.ready() } catch { /* noop */ } }
  const onDomReady = useCallback((id: string) => {
    domReady.current.add(id)
    if (id === activeIdRef.current) signalReady()
  }, [])
  // when the active tab changes, let main know it can drive the (ready) webview
  useEffect(() => { if (activeId && domReady.current.has(activeId)) signalReady() }, [activeId])

  const navigateActive = (raw: string) => {
    const u = normalizeUrl(raw)
    if (!u) return
    const el = getActiveEl()
    if (el) { try { el.loadURL(u) } catch { el.src = u } }
    if (activeIdRef.current) updateBrowserTab(activeIdRef.current, { url: u })
    setUrlDraft(u)
  }

  // ── Agent control ── one handler drives whichever tab is active.
  useEffect(() => {
    const api = (window as unknown as { electron?: { browser?: BrowserBridge } }).electron?.browser
    if (!api) return
    const clickJs = (selector?: string, text?: string) => {
      if (selector) return `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.scrollIntoView({block:'center'});el.click();return true}return false})()`
      const needle = (text || '').toLowerCase()
      return `(()=>{const els=[...document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],summary')];const el=els.find(e=>(((e.innerText||e.value||'')+'')).trim().toLowerCase().includes(${JSON.stringify(needle)}));if(el){el.scrollIntoView({block:'center'});el.click();return true}return false})()`
    }
    // Set a field's value the React-friendly way (native setter + input/change),
    // then optionally submit by dispatching Enter and form.requestSubmit().
    const typeJs = (selector: string, text: string, submit: boolean) => `(()=>{
      const el=document.querySelector(${JSON.stringify(selector)});
      if(!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto,'value');
      if(desc&&desc.set){desc.set.call(el, ${JSON.stringify(text)});}else{el.value=${JSON.stringify(text)};}
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      ${submit ? `var k={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true};
      el.dispatchEvent(new KeyboardEvent('keydown',k));
      el.dispatchEvent(new KeyboardEvent('keypress',k));
      el.dispatchEvent(new KeyboardEvent('keyup',k));
      if(el.form){try{el.form.requestSubmit?el.form.requestSubmit():el.form.submit();}catch(e){}}` : ''}
      return true;
    })()`
    const scrollJs = (direction: string, selector?: string) => {
      if (selector) return `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.scrollIntoView({block:'center'});return true}return false})()`
      const m: Record<string, string> = {
        down: 'window.scrollBy(0,Math.round(innerHeight*0.9))',
        up: 'window.scrollBy(0,-Math.round(innerHeight*0.9))',
        top: 'window.scrollTo(0,0)',
        bottom: 'window.scrollTo(0,document.body.scrollHeight)',
      }
      return `(()=>{${m[direction] || m.down};return true})()`
    }
    // Wait for a navigation that an action (e.g. type+submit) may trigger —
    // resolves on the next did-stop-loading or after a short timeout.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const waitForSettle = (wv: any, ms: number) => new Promise<void>((resolve) => {
      const done = () => { wv.removeEventListener('did-stop-loading', done); clearTimeout(t); resolve() }
      const t = setTimeout(() => { wv.removeEventListener('did-stop-loading', done); resolve() }, ms)
      wv.addEventListener('did-stop-loading', done)
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadAndWait = (wv: any, target: string) => new Promise<void>((resolve) => {
      const done = () => {
        wv.removeEventListener('did-stop-loading', done)
        wv.removeEventListener('did-fail-load', done)
        clearTimeout(t)
        resolve()
      }
      const t = setTimeout(done, 20_000)
      wv.addEventListener('did-stop-loading', done)
      wv.addEventListener('did-fail-load', done)
      try { wv.loadURL(target) } catch { wv.src = target }
    })
    const unsub = api.onCommand(async (cmd) => {
      const wv = getActiveEl()
      const reply = (r: BrowserResult) => { try { api.sendResult(cmd.id, r) } catch { /* noop */ } }
      if (!wv) { reply({ ok: false, error: 'no active browser tab' }); return }
      try {
        if (cmd.action === 'navigate') {
          if (!cmd.url) { reply({ ok: false, error: 'no url' }); return }
          await loadAndWait(wv, cmd.url)
          if (activeIdRef.current) updateBrowserTab(activeIdRef.current, { url: wv.getURL?.() || cmd.url })
          reply({ ok: true, url: wv.getURL?.() || cmd.url, title: wv.getTitle?.() || '' })
        } else if (cmd.action === 'read') {
          const text = await wv.executeJavaScript('document.body ? document.body.innerText : ""', true)
          reply({ ok: true, url: wv.getURL?.() || '', title: wv.getTitle?.() || '', text: String(text || '').slice(0, 12_000) })
        } else if (cmd.action === 'screenshot') {
          const img = await wv.capturePage()
          reply({ ok: true, base64: img.toDataURL().replace(/^data:image\/\w+;base64,/, '') })
        } else if (cmd.action === 'click') {
          const clicked = await wv.executeJavaScript(clickJs(cmd.selector, cmd.text), true)
          reply({ ok: !!clicked, error: clicked ? undefined : 'no matching element' })
        } else if (cmd.action === 'type') {
          if (!cmd.selector) { reply({ ok: false, error: 'no selector' }); return }
          const typed = await wv.executeJavaScript(typeJs(cmd.selector, cmd.text || '', !!cmd.submit), true)
          if (!typed) { reply({ ok: false, error: 'no matching element' }); return }
          if (cmd.submit) {
            await waitForSettle(wv, 8_000)
            if (activeIdRef.current) updateBrowserTab(activeIdRef.current, { url: wv.getURL?.() || '' })
          }
          reply({ ok: true, url: wv.getURL?.() || '', title: wv.getTitle?.() || '' })
        } else if (cmd.action === 'scroll') {
          const scrolled = await wv.executeJavaScript(scrollJs(cmd.direction || 'down', cmd.selector), true)
          reply({ ok: !!scrolled, error: scrolled ? undefined : 'no matching element' })
        } else {
          reply({ ok: false, error: 'unknown action' })
        }
      } catch (e) {
        reply({ ok: false, error: (e as Error)?.message || String(e) })
      }
    })
    return () => { unsub?.(); try { api.closed() } catch { /* noop */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors'

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Left bar: tabs + url + assistant ── */}
      <aside
        className="relative flex flex-col shrink-0 h-full"
        style={{ width: left.width, backgroundColor: 'var(--theme-bg-subtle)', borderRight: '1px solid var(--theme-hairline)' }}
      >
        <ResizeHandle handleProps={left.handleProps} label="browser sidebar" />

        {/* top row — traffic lights | nav arrows + assistant | back-to-sessions (Arc-style) */}
        <div className="h-12 flex items-center gap-0.5 pl-[80px] pr-1.5 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span className="flex-1" />
          <button onClick={() => getActiveEl()?.goBack?.()} className={iconBtn} style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="Back"><ChevronLeft size={17} /></button>
          <button onClick={() => getActiveEl()?.goForward?.()} className={iconBtn} style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="Forward"><ChevronRight size={17} /></button>
          <button onClick={() => { const el = getActiveEl(); if (activeTab?.loading) el?.stop?.(); else el?.reload?.() }} className={iconBtn} style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title={activeTab?.loading ? 'Stop' : 'Reload'}>
            {activeTab?.loading ? <X size={15} /> : <RotateCw size={14} />}
          </button>
          <button onClick={() => setAssistantOpen((v) => !v)} className={iconBtn} style={{ WebkitAppRegion: 'no-drag', color: assistantOpen ? 'var(--theme-primary)' : 'var(--theme-muted)' } as React.CSSProperties} title="Assistant">
            <MessageSquare size={15} />
          </button>
          <button
            onClick={() => { void exitBrowser() }}
            className={iconBtn}
            style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties}
            title="Back to sessions"
          >
            <ArrowLeft size={15} />
          </button>
        </div>

        {/* big Arc-style search pill on its own row */}
        <div className="px-2.5 pb-2.5 shrink-0">
          <div
            className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 transition-colors focus-within:border-[color:var(--theme-primary)]"
            style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}
          >
            <Search size={15} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigateActive(urlDraft) }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Search or Enter URL…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px]"
              style={{ color: 'var(--theme-text)' }}
            />
          </div>
        </div>

        {/* scrollable: pinned + folders, then open tabs */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-3">
          <BrowserSpaces
            spaces={browserSpaces.spaces}
            current={current}
            onOpen={(url) => navigateActive(url)}
            pinSite={browserSpaces.pinSite}
            unpin={browserSpaces.unpin}
            addFolder={browserSpaces.addFolder}
            removeFolder={browserSpaces.removeFolder}
            toggleFolder={browserSpaces.toggleFolder}
            addSiteToFolder={browserSpaces.addSiteToFolder}
            removeSiteFromFolder={browserSpaces.removeSiteFromFolder}
          />

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center px-1">
              <span className="text-[10px] uppercase tracking-wider font-mono" style={{ color: 'var(--theme-muted)' }}>Tabs</span>
              <span className="flex-1" />
              <button onClick={() => addBrowserTab()} className="w-4 h-4 rounded flex items-center justify-center hover:bg-white/5" style={{ color: 'var(--theme-muted)' }} title="New tab">
                <Plus size={12} />
              </button>
            </div>
            {tabs.map((t) => {
              const active = t.id === activeId
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveBrowserTab(t.id)}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--theme-bg-raised)' : 'transparent',
                    borderLeft: active ? '2px solid var(--theme-primary)' : '2px solid transparent',
                  }}
                >
                  {t.loading
                    ? <Loader2 size={13} className="animate-spin shrink-0" style={{ color: 'var(--theme-primary)' }} />
                    : t.url
                      ? <SiteIcon url={t.url} size={13} />
                      : <Globe size={13} className="shrink-0" style={{ color: active ? 'var(--theme-primary)' : 'var(--theme-muted)' }} />}
                  <span className="flex-1 truncate text-[12px]" style={{ color: active ? 'var(--theme-text)' : 'var(--theme-muted)' }}>
                    {t.title || t.url || 'New tab'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeBrowserTab(t.id) }}
                    className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-opacity shrink-0"
                    style={{ color: 'var(--theme-muted)' }}
                    title="Close tab"
                  >
                    <X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

      </aside>

      {/* ── Main: the active tab's page ── */}
      <div className="flex-1 relative" style={{ backgroundColor: '#ffffff' }}>
        {tabs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ backgroundColor: 'var(--theme-bg)' }}>
            <Compass size={34} style={{ color: 'var(--theme-muted)', opacity: 0.5 }} />
            <button onClick={() => addBrowserTab()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>
              <Plus size={13} /> New tab
            </button>
          </div>
        ) : (
          tabs.map((t) => (
            <div key={t.id} style={{ position: 'absolute', inset: 0, display: t.id === activeId ? 'block' : 'none' }}>
              <BrowserTabView tab={t} onUpdate={(p) => updateBrowserTab(t.id, p)} registerEl={registerEl} onDomReady={onDomReady} />
            </div>
          ))
        )}

        {/* Arc-style new-tab page over the (blank) active tab's webview. */}
        {activeTab && !activeTab.url && (
          <NewTabPage spaces={browserSpaces.spaces} onOpen={(u) => navigateActive(u)} />
        )}

        {/* Floating assistant — overlays the page bottom-right. */}
        {assistantOpen && assistantDock === 'float' && (
          <div
            style={{
              position: 'absolute', bottom: 18, right: 18,
              width: 384, height: 'min(560px, calc(100% - 36px))',
              zIndex: 40, display: 'flex', flexDirection: 'column', overflow: 'hidden',
              border: '1px solid var(--theme-border)',
              borderRadius: 14, boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
            }}
          >
            <BrowserAssistant dock="float" onToggleDock={toggleAssistantDock} onClose={() => setAssistantOpen(false)} onNewSession={onNewSession} />
          </div>
        )}
      </div>

      {/* Docked assistant — resizable right column beside the page. */}
      {assistantOpen && assistantDock === 'right' && (
        <aside
          className="relative flex flex-col shrink-0 h-full"
          style={{ width: right.width, borderLeft: '1px solid var(--theme-hairline)' }}
        >
          <ResizeHandle handleProps={right.handleProps} label="assistant panel" />
          <BrowserAssistant dock="right" onToggleDock={toggleAssistantDock} onClose={() => setAssistantOpen(false)} onNewSession={onNewSession} />
        </aside>
      )}
    </div>
  )
}
