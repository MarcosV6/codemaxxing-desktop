import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/Shared/ErrorBoundary'
import './styles/globals.css'
import { useAppStore } from './store/appStore'

const bridgeMissing = !(window as unknown as { electron?: unknown }).electron
// Packaged builds load over file:; vite dev over http:. A missing bridge in a
// packaged build means the preload crashed — falling back to the dev-mock
// there would silently show FAKE data (fake models, no-op OAuth) and produce
// garbage bug reports. Fail loudly instead.
const packagedWithBrokenBridge = bridgeMissing && window.location.protocol === 'file:'

if (packagedWithBrokenBridge) {
  document.getElementById('root')!.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#c0caf5;font-family:ui-monospace,monospace;text-align:center;padding:24px">
      <div style="max-width:520px">
        <div style="font-size:28px;margin-bottom:12px">⚠️</div>
        <h1 style="font-size:16px;margin:0 0 10px">codemaxxing couldn't start its system bridge</h1>
        <p style="font-size:13px;line-height:1.6;opacity:.75;margin:0 0 16px">
          The app's internal IPC bridge failed to load, so nothing would work correctly.
          Try quitting and reopening the app. If it keeps happening, please re-download
          the latest release — and report this so we can fix it.
        </p>
        <p style="font-size:11px;opacity:.45;margin:0">error: preload bridge unavailable (window.electron missing in packaged build)</p>
      </div>
    </div>`
} else {
  // Plain-browser dev (vite without the Electron shell): install a mock
  // window.electron so the renderer can still boot for UI iteration.
  if (bridgeMissing) {
    const { installBrowserMock } = await import('./dev-mocks/electron-browser')
    installBrowserMock()
  }

  // Initialize codemaxxing bridge on mount — don't block mount on it
  void useAppStore.getState().init()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
