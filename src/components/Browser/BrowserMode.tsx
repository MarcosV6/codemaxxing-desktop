import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../../store/appStore'
import { ChatArea } from '../Chat/ChatArea'
import { BrowserTabView } from './BrowserTabView'
import { useResizablePanel, ResizeHandle } from '../Shared/Resizable'
import {
  ArrowLeft, Plus, ChevronLeft, ChevronRight, RotateCw, X, Search, Globe, Loader2,
  MessageSquare, ChevronDown, ChevronUp, Compass,
} from 'lucide-react'

type BrowserResult = { ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }
type BrowserCommand = { id: string; action: 'navigate' | 'read' | 'screenshot' | 'click'; url?: string; selector?: string; text?: string }
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
  const setBrowserView = useAppStore((s) => s.setBrowserView)
  const activeSession = useAppStore((s) => s.activeSession)

  const left = useResizablePanel({ storageKey: 'browser-left', defaultWidth: 288, min: 240, max: 480, dock: 'left' })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const els = useRef(new Map<string, any>())
  const domReady = useRef(new Set<string>())
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const [urlDraft, setUrlDraft] = useState('')
  const [assistantOpen, setAssistantOpen] = useState(true)
  const activeTab = tabs.find((t) => t.id === activeId) || null
  useEffect(() => { setUrlDraft(activeTab?.url || '') }, [activeTab?.url, activeId])

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

        {/* top row — drag region; left space reserved for traffic lights */}
        <div className="h-12 flex items-center gap-2 pl-[80px] pr-2 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <button
            onClick={() => setBrowserView(false)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] hover:bg-white/5 transition-colors"
            style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties}
            title="Exit browser mode"
          >
            <ArrowLeft size={13} /> exit
          </button>
          <span className="flex-1" />
          <button onClick={() => addBrowserTab()} className={iconBtn} style={{ WebkitAppRegion: 'no-drag', color: 'var(--theme-muted)' } as React.CSSProperties} title="New tab">
            <Plus size={15} />
          </button>
        </div>

        {/* url + nav */}
        <div className="flex items-center gap-1 px-2 pb-2 shrink-0">
          <button onClick={() => getActiveEl()?.goBack?.()} className={iconBtn} style={{ color: 'var(--theme-muted)' }} title="Back"><ChevronLeft size={15} /></button>
          <button onClick={() => getActiveEl()?.goForward?.()} className={iconBtn} style={{ color: 'var(--theme-muted)' }} title="Forward"><ChevronRight size={15} /></button>
          <button onClick={() => { const el = getActiveEl(); activeTab?.loading ? el?.stop?.() : el?.reload?.() }} className={iconBtn} style={{ color: 'var(--theme-muted)' }} title={activeTab?.loading ? 'Stop' : 'Reload'}>
            {activeTab?.loading ? <X size={14} /> : <RotateCw size={13} />}
          </button>
          <div className="flex-1 flex items-center gap-1.5 rounded-md px-2" style={{ backgroundColor: 'var(--theme-bg)', border: '1px solid var(--theme-border)' }}>
            <Search size={12} style={{ color: 'var(--theme-muted)', flexShrink: 0 }} />
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigateActive(urlDraft) }}
              placeholder="Search or enter address"
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] py-1.5"
              style={{ color: 'var(--theme-text)' }}
            />
          </div>
        </div>

        {/* vertical tabs */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 flex flex-col gap-0.5">
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

        {/* assistant */}
        <div className="shrink-0" style={{ borderTop: '1px solid var(--theme-hairline)' }}>
          <button
            onClick={() => setAssistantOpen((v) => !v)}
            className="w-full h-9 flex items-center gap-2 px-3 hover:bg-white/[0.03] transition-colors"
            style={{ color: 'var(--theme-text)' }}
          >
            <MessageSquare size={13} style={{ color: 'var(--theme-primary)' }} />
            <span className="text-[12px] font-medium">Assistant</span>
            <span className="flex-1 text-left text-[10px] opacity-50">drives this tab</span>
            {assistantOpen ? <ChevronDown size={13} style={{ color: 'var(--theme-muted)' }} /> : <ChevronUp size={13} style={{ color: 'var(--theme-muted)' }} />}
          </button>
          {assistantOpen && (
            <div className="flex flex-col" style={{ height: 'clamp(240px, 42vh, 460px)', borderTop: '1px solid var(--theme-hairline)' }}>
              {activeSession ? (
                <ChatArea />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3 px-5 text-center">
                  <p className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-muted)' }}>
                    Start a chat to have the agent browse, read, and click for you.
                  </p>
                  <button onClick={onNewSession} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-bg)' }}>
                    <Plus size={13} /> New session
                  </button>
                </div>
              )}
            </div>
          )}
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
      </div>
    </div>
  )
}
