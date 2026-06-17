import React from 'react'

/**
 * Renderer crash guard. Without this, any uncaught render error blanks the
 * whole window (white screen, app unusable). Here we catch it and show a
 * recoverable screen — sessions/data live in SQLite on disk, so a reload
 * almost always recovers. Theme vars have literal fallbacks in case the crash
 * happens before a theme is applied.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[codemaxxing] renderer crashed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--theme-bg, #0a0a0f)',
          color: 'var(--theme-text, #e6e2da)',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--theme-primary, #E8826B)' }}>{'>_'} something broke</div>
          <p style={{ opacity: 0.7, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            The UI hit an unexpected error. Your sessions and data are safe on disk — a reload usually fixes it.
          </p>
          <pre
            style={{
              textAlign: 'left',
              fontSize: 11,
              opacity: 0.55,
              maxHeight: 140,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              marginBottom: 16,
            }}
          >
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              backgroundColor: 'var(--theme-primary, #E8826B)',
              color: 'var(--theme-bg, #0a0a0f)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
