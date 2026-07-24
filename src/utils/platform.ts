/**
 * Renderer-safe platform detection — no IPC needed. The UI was designed on
 * macOS (frameless window, traffic lights top-left); Windows/Linux get a
 * NATIVE title bar instead, so every Mac-ism (reserved traffic-light padding,
 * ⌘ in shortcut hints, ~ in paths) must branch on this.
 */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** Modifier label for visible shortcut hints: "⌘N" on Mac, "Ctrl+N" elsewhere. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'
export const MOD_SHIFT = IS_MAC ? '⌘⇧' : 'Ctrl+Shift+'

/** Header left-padding: reserves traffic-light space on Mac only. The class
 *  strings are written out in full so Tailwind's scanner keeps them. */
export const PAD_TRAFFIC_80 = IS_MAC ? 'pl-[80px]' : 'pl-2'
export const PAD_TRAFFIC_84 = IS_MAC ? 'pl-[84px]' : 'pl-3'
export const PAD_TRAFFIC_92 = IS_MAC ? 'pl-[92px]' : 'pl-3'

/** Normalize a native path for renderer display and @mention comparisons. */
export function normalizeDisplayPath(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Show only the final path segments without assuming the host separator. */
export function displayPathTail(value: string, segmentCount = 2): string {
  const normalized = normalizeDisplayPath(value).replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).slice(-segmentCount).join('/')
}

/** Return a slash-normalized relative path when candidate is inside root. */
export function relativePathWithin(root: string, candidate: string): string | null {
  const normalizedRoot = normalizeDisplayPath(root).replace(/\/+$/, '')
  const normalizedCandidate = normalizeDisplayPath(candidate)
  const windowsStyle = /^[A-Za-z]:\//.test(normalizedRoot)
  const comparableRoot = windowsStyle ? normalizedRoot.toLowerCase() : normalizedRoot
  const comparableCandidate = windowsStyle ? normalizedCandidate.toLowerCase() : normalizedCandidate
  if (comparableCandidate === comparableRoot) return ''
  const prefix = `${comparableRoot}/`
  return comparableCandidate.startsWith(prefix)
    ? normalizedCandidate.slice(normalizedRoot.length + 1)
    : null
}
