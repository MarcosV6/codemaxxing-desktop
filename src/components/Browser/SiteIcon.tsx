import React, { useState, useEffect } from 'react'
import { Globe } from 'lucide-react'

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

/**
 * Favicon for a site, fetched from Google's favicon service with a globe
 * fallback if it 404s or the URL has no host. Used in the rail + new-tab page.
 */
export function SiteIcon({ url, size = 16 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const host = hostOf(url)
  // Reset the error state if the URL changes (recycled tiles).
  useEffect(() => { setFailed(false) }, [url])

  if (failed || !host) return <Globe size={size} style={{ color: 'var(--theme-muted)' }} />
  return (
    <img
      src={`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`}
      width={size}
      height={size}
      alt=""
      onError={() => setFailed(true)}
      style={{ borderRadius: 4, display: 'block', objectFit: 'contain' }}
    />
  )
}
