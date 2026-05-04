/**
 * Image attachment helpers — paste / drop / file-picker → ImageAttachment.
 *
 * Why this exists:
 *   - Frontier model APIs accept base64 data URLs, but a fresh macOS
 *     screenshot (~5MB) bloats the message body and makes every subsequent
 *     iteration of the agent loop re-upload the same large blob. We
 *     downscale to a max edge of 2048px and re-encode as JPEG @ 0.85 (or
 *     keep PNG when alpha matters) so attachments stay around 200–500kB.
 *   - All work happens in the renderer via `<canvas>` — no main-process
 *     dependency, so this works in plain `vite dev` (browser-only) too.
 *
 * Returned `ImageAttachment.dataUrl` is always a `data:<media>;base64,...`
 * URL so it round-trips cleanly through SQLite and renders directly via
 * `<img src>`.
 */

import type { ImageAttachment } from '../types'

const MAX_EDGE = 2048
const JPEG_QUALITY = 0.85
const SUPPORTED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/heic',
  'image/heif',
])

let attachIdSeq = 0
function nextAttachId(): string {
  attachIdSeq += 1
  return `img_${Date.now().toString(36)}_${attachIdSeq.toString(36)}`
}

export function isSupportedImageType(type: string | undefined | null): boolean {
  if (!type) return false
  return SUPPORTED_TYPES.has(type.toLowerCase())
}

/** Read a Blob into an HTMLImageElement so we can measure / re-encode it. */
function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { resolve(img); URL.revokeObjectURL(url) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

/** Animated GIFs lose their animation if we re-encode through canvas, and
 *  the LLM can't see animation anyway — but if the file is already small
 *  we just keep the original bytes. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

/** Downscale (if needed) and re-encode an image blob into a base64 data
 *  URL. Returns the data URL plus the chosen MIME type and final pixel
 *  dimensions so the UI can render thumbnails without re-decoding. */
export async function processImageBlob(blob: Blob, name?: string): Promise<ImageAttachment> {
  const inputType = (blob.type || 'image/png').toLowerCase()
  const usePng = inputType === 'image/png' || inputType === 'image/webp'
  const isGif = inputType === 'image/gif'

  // Small enough + format we can send as-is → skip the canvas round-trip.
  // ~1.5MB threshold keeps PNGs with alpha intact for screenshots that are
  // already on the small side.
  if (isGif || blob.size < 1_500_000) {
    const dataUrl = await blobToDataUrl(blob)
    let width: number | undefined
    let height: number | undefined
    try {
      const img = await blobToImage(blob)
      width = img.naturalWidth
      height = img.naturalHeight
    } catch { /* best-effort — measurements are non-critical */ }
    return {
      id: nextAttachId(),
      dataUrl,
      mediaType: inputType,
      name,
      width,
      height,
      sizeBytes: blob.size,
    }
  }

  const img = await blobToImage(blob)
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1
  const width = Math.round(img.naturalWidth * scale)
  const height = Math.round(img.naturalHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    // Canvas unavailable — fall back to raw data URL.
    const dataUrl = await blobToDataUrl(blob)
    return {
      id: nextAttachId(),
      dataUrl,
      mediaType: inputType,
      name,
      width: img.naturalWidth,
      height: img.naturalHeight,
      sizeBytes: blob.size,
    }
  }
  ctx.drawImage(img, 0, 0, width, height)

  const outType = usePng ? 'image/png' : 'image/jpeg'
  const dataUrl = canvas.toDataURL(outType, outType === 'image/jpeg' ? JPEG_QUALITY : undefined)

  // Estimate post-encode size from the data URL length (base64 ≈ 4/3 raw).
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const sizeBytes = Math.floor(base64.length * 3 / 4)

  return {
    id: nextAttachId(),
    dataUrl,
    mediaType: outType,
    name,
    width,
    height,
    sizeBytes,
  }
}

/** Extract image blobs from a clipboard paste event. Returns an empty
 *  array if no images were on the clipboard (so callers can fall through
 *  to the default text paste). */
export function imagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const out: File[] = []
  const items = (e as any).clipboardData?.items as DataTransferItemList | undefined
  if (!items) return out
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== 'file') continue
    if (!isSupportedImageType(it.type)) continue
    const f = it.getAsFile()
    if (f) out.push(f)
  }
  return out
}

/** Filter a `FileList` to only image entries. Used by drop / file picker. */
export function imageFilesFrom(files: FileList | File[] | null | undefined): File[] {
  if (!files) return []
  const arr = Array.isArray(files) ? files : Array.from(files)
  return arr.filter(f => isSupportedImageType(f.type))
}

export async function processImageFiles(files: File[]): Promise<ImageAttachment[]> {
  const out: ImageAttachment[] = []
  for (const f of files) {
    try {
      out.push(await processImageBlob(f, f.name || undefined))
    } catch {
      // Skip unreadable file rather than blowing up the whole batch.
    }
  }
  return out
}
