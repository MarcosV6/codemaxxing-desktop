import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { Layout } from './components/Layout/Layout'

export function App() {
  const init = useAppStore((s) => s.init)
  const initialized = useAppStore((s) => s.initialized)

  useEffect(() => {
    void init()
  }, [init])

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
