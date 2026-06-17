import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { Layout } from './components/Layout/Layout'

export function App() {
  const init = useAppStore((s) => s.init)
  const initialized = useAppStore((s) => s.initialized)
  const openPreview = useAppStore((s) => s.openPreview)
  const openBrowserPanel = useAppStore((s) => s.openBrowserPanel)

  useEffect(() => {
    void init()
  }, [init])

  // Agent → renderer: open_preview / screenshot_preview surface a URL in the
  // Preview panel so the user sees what the agent is looking at.
  useEffect(() => {
    const api = (window as { electron?: { preview?: { onOpen?: (cb: (url: string) => void) => () => void } } }).electron?.preview
    return api?.onOpen?.((url) => openPreview(url))
  }, [openPreview])

  // Agent → renderer: a browser_* tool fired — open/focus the Browser tab so
  // the user watches the agent drive it. The webview itself is driven inside
  // BrowserTab (which subscribes to browser.onCommand once mounted).
  useEffect(() => {
    const api = (window as { electron?: { browser?: { onOpen?: (cb: () => void) => () => void } } }).electron?.browser
    return api?.onOpen?.(() => openBrowserPanel())
  }, [openBrowserPanel])

  if (!initialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-sm font-mono"
           style={{ backgroundColor: 'var(--theme-bg, #0a0a0f)', color: 'var(--theme-muted, #9AA5CE)' }}>
        Starting codemaxxing…
      </div>
    )
  }

  return <Layout />
}
