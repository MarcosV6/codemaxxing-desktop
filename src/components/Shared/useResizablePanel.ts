import { useCallback, useRef, useState } from 'react'

/**
 * Drag-to-resize state shared by docked panels.
 *
 * Width is persisted per device in localStorage and clamped on both restore
 * and drag so stale values cannot push a panel outside the current layout.
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
    (width: number) => Math.round(Math.min(max, Math.max(min, width))),
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

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    drag.current = { startX: event.clientX, startW: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const delta = dock === 'left'
      ? event.clientX - drag.current.startX
      : drag.current.startX - event.clientX
    setWidth(clamp(drag.current.startW + delta))
  }, [dock, clamp])

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setWidth((current) => {
      try { localStorage.setItem(key, String(current)) } catch { /* storage unavailable */ }
      return current
    })
  }, [key])

  const reset = useCallback(() => {
    setWidth(defaultWidth)
    try { localStorage.removeItem(key) } catch { /* storage unavailable */ }
  }, [defaultWidth, key])

  return {
    width,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: reset,
      dock,
    },
  }
}
