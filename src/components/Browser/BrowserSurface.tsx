import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, RotateCw, X } from 'lucide-react'

type BrowserResult = { ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }
type BrowserCommand = { id: string; action: 'navigate' | 'read' | 'screenshot' | 'click'; url?: string; selector?: string; text?: string }
type BrowserBridge = {
  onCommand: (cb: (cmd: BrowserCommand) => void) => () => void
  sendResult: (id: string, r: BrowserResult) => void
  ready: () => void
  closed: () => void
}

// A real embedded Chromium browser (<webview>) in an isolated
// `persist:cmx-browser` partition (own cookies, no node integration). This is
// the same surface the agent drives via the browser_* tools — used as the
// primary view in Browser mode (Layout) so it reads like a session of its own.
export function BrowserSurface() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null)

  const navigate = useCallback((raw: string) => {
    let u = raw.trim()
    if (!u) return
    // bare domain → https; anything else → DuckDuckGo search
    if (!/^https?:\/\//i.test(u)) {
      u = /^[\w-]+(\.[\w-]+)+(\/|$|:)/.test(u) ? 'https://' + u : 'https://duckduckgo.com/?q=' + encodeURIComponent(u)
    }
    const wv = webviewRef.current
    if (wv) { try { wv.loadURL(u) } catch { wv.src = u } }
    setUrl(u)
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    const onStart = () => setLoading(true)
    const onStop = () => {
      setLoading(false)
      try { setCanBack(wv.canGoBack()); setCanFwd(wv.canGoForward()) } catch { /* not ready */ }
    }
    const onNav = (e: { url?: string }) => { if (e?.url) setUrl(e.url) }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [])

  // ── Agent control ── drive THIS webview when a browser_* tool fires. Main
  // round-trips a command in; we run it on the webview and post the result back.
  useEffect(() => {
    const api = (window as unknown as { electron?: { browser?: BrowserBridge } }).electron?.browser
    const wv = webviewRef.current
    if (!api || !wv) return

    // Tell main the webview can execute JS / capture (it waits for this).
    const signalReady = () => { try { api.ready() } catch { /* noop */ } }
    wv.addEventListener('dom-ready', signalReady)
    const readyFallback = setTimeout(signalReady, 600) // in case dom-ready already fired

    const loadAndWait = (target: string) =>
      new Promise<void>((resolve) => {
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
        setUrl(target)
      })

    // Click by CSS selector, else by visible text of a link/button/etc.
    const clickJs = (selector?: string, text?: string) => {
      if (selector) return `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el){el.scrollIntoView({block:'center'});el.click();return true}return false})()`
      const needle = (text || '').toLowerCase()
      return `(()=>{const els=[...document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="button"],summary')];const el=els.find(e=>(((e.innerText||e.value||'')+'')).trim().toLowerCase().includes(${JSON.stringify(needle)}));if(el){el.scrollIntoView({block:'center'});el.click();return true}return false})()`
    }

    const unsub = api.onCommand(async (cmd) => {
      const reply = (r: BrowserResult) => { try { api.sendResult(cmd.id, r) } catch { /* noop */ } }
      try {
        if (cmd.action === 'navigate') {
          if (!cmd.url) { reply({ ok: false, error: 'no url' }); return }
          await loadAndWait(cmd.url)
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

    return () => {
      clearTimeout(readyFallback)
      wv.removeEventListener('dom-ready', signalReady)
      unsub?.()
      try { api.closed() } catch { /* noop */ }
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2.5 py-2 shrink-0" style={{ borderBottom: '1px solid var(--theme-border)' }}>
        <button onClick={() => webviewRef.current?.goBack()} disabled={!canBack} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 disabled:opacity-30 transition-colors" style={{ color: 'var(--theme-muted)' }} title="Back"><ChevronLeft size={15} /></button>
        <button onClick={() => webviewRef.current?.goForward()} disabled={!canFwd} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 disabled:opacity-30 transition-colors" style={{ color: 'var(--theme-muted)' }} title="Forward"><ChevronRight size={15} /></button>
        <button onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors" style={{ color: 'var(--theme-muted)' }} title={loading ? 'Stop' : 'Reload'}>{loading ? <X size={14} /> : <RotateCw size={13} />}</button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(url) }}
          placeholder="Search or enter address"
          className="flex-1 rounded-md px-2.5 py-1.5 text-[12px] outline-none"
          style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
        />
      </div>
      <div className="flex-1 relative" style={{ backgroundColor: '#ffffff' }}>
        {loading && <div className="absolute top-0 left-0 right-0 h-0.5 z-10 animate-pulse" style={{ backgroundColor: 'var(--theme-primary)' }} />}
        {React.createElement('webview', {
          ref: webviewRef,
          src: 'about:blank',
          partition: 'persist:cmx-browser',
          allowpopups: 'true',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style: { width: '100%', height: '100%', border: 'none', display: 'flex' } as any,
        })}
      </div>
    </div>
  )
}
