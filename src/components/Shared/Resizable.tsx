import React, { useCallback, useRef, useState } from 'react'

/**
 * Drag-to-resize for docked panels (sidebar, Files, Preview).
 *
 * One hook + one handle element so every panel behaves identically:
 *   - pointer-capture drag (no window listener bookkeeping, touch works)
 *   - min/max clamps
 *   - width persisted per-panel in localStorage (UI state is per-device,
 *     so it deliberately does NOT go through the config IPC)
 *   - double-click the handle to reset to the default width
 *
 * `dock` is which screen edge the panel hugs: a left-docked panel grows as
 * the pointer moves right; a right-docked panel grows as it moves left.
 */
export function useResizablePanel(opts: {
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  dock: 'left' | 'right'
}) {
  const { storageKey, defaultWidth, min, max, dock } = opts
  const key = 'cmx:panel:' + storageKey
  const clamp = useCallback(
    (w: number) => Math.round(Math.min(max, Math.max(min, w))),
    [min, max],
  )
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      if (Number.isFinite(saved) && saved > 0) return clamp(saved)
    } catch { /* storage unavailable */ }
    return defaultWidth
  })
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    drag.current = { startX: e.clientX, startW: width }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const delta = dock === 'left' ? e.clientX - drag.current.startX : drag.current.startX - e.clientX
    setWidth(clamp(drag.current.startW + delta))
  }, [dock, clamp])

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setWidth((w) => {
      try { localStorage.setItem(key, String(w)) } catch { /* storage unavailable */ }
      return w
    })
  }, [key])

  const reset = useCallback(() => {
    setWidth(defaultWidth)
    try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
  }, [defaultWidth, key])

  return { width, handleProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onDoubleClick: reset, dock } }
}

/** The grab strip. Render inside a `relative` panel; it pins itself to the
 *  correct edge, shows a col-resize cursor, and tints on hover/drag. */
export function ResizeHandle({
  handleProps,
  label,
}: {
  handleProps: ReturnType<typeof useResizablePanel>['handleProps']
  label: string
}) {
  const { dock, ...events } = handleProps
  return (
    <div
      {...events}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} (double-click to reset)`}
      title={`Drag to resize · double-click to reset`}
      className="absolute top-0 bottom-0 w-[5px] z-20 cursor-col-resize group/handle"
      style={{
        [dock === 'left' ? 'right' : 'left']: '-2px',
        // Resize must win over the window-drag region in panel headers.
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] opacity-0 group-hover/handle:opacity-100 group-active/handle:opacity-100 transition-opacity"
        style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 55%, transparent)' }}
      />
    </div>
  )
}
