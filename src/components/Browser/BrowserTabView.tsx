import React, { useRef, useEffect } from 'react'
import type { BrowserTabState } from '../../store/appStore'

/**
 * One browser tab = one <webview> (isolated `persist:cmx-browser` partition,
 * shared cookies across tabs). Stays mounted while the tab exists so its page
 * keeps its state when you switch away. BrowserMode controls visibility +
 * drives whichever is active; this component just renders the webview, loads
 * the tab's initial URL, and reports nav state back up.
 */
export function BrowserTabView({ tab, onUpdate, registerEl, onDomReady }: {
  tab: BrowserTabState
  onUpdate: (patch: Partial<BrowserTabState>) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerEl: (id: string, el: any | null) => void
  onDomReady: (id: string) => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null)
  const loadedRef = useRef(false)
  const initialUrl = useRef(tab.url)

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    registerEl(tab.id, wv)
    // The webview boots on about:blank and fires real navigation/title events
    // for it. Letting those through writes "about:blank" into the tab, which
    // dismisses the start page (it shows only while tab.url is empty) and
    // reads as a junk tab. Blank-page events are never user-meaningful — drop.
    const isBlank = (v?: string) => !v || v === 'about:blank'
    const onStart = () => onUpdate({ loading: true })
    const onStop = () => {
      const t = wv.getTitle?.() || ''
      onUpdate({ loading: false, ...(isBlank(t) ? {} : { title: t }) })
    }
    const onNav = (e: { url?: string }) => { if (!isBlank(e?.url)) onUpdate({ url: e!.url! }) }
    const onTitle = (e: { title?: string }) => { if (!isBlank(e?.title)) onUpdate({ title: e!.title! }) }
    const onReady = () => {
      // about:blank fires dom-ready first; then load the tab's real URL once.
      if (!loadedRef.current && initialUrl.current) {
        loadedRef.current = true
        try { wv.loadURL(initialUrl.current) } catch { wv.src = initialUrl.current }
      }
      onDomReady(tab.id)
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('dom-ready', onReady)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('dom-ready', onReady)
      registerEl(tab.id, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  return React.createElement('webview', {
    ref: webviewRef,
    src: 'about:blank',
    partition: 'persist:cmx-browser',
    allowpopups: 'true',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style: { width: '100%', height: '100%', border: 'none', display: 'flex' } as any,
  })
}
