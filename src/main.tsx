import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/Shared/ErrorBoundary'
import './styles/globals.css'
import { useAppStore } from './store/appStore'

// When running in a plain browser (vite dev, no Electron), install a mock
// window.electron so the renderer can still boot for UI iteration.
if (!(window as any).electron) {
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
