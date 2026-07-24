import React from 'react'
import type { useResizablePanel } from './useResizablePanel'

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
