// Pure pixel-diff for the agent's visual "eyes" loop. Compares two BGRA bitmaps
// (as produced by Electron's nativeImage.toBitmap()) of identical dimensions and
// reports how close they are overall + a 3×3 region breakdown so the agent knows
// WHERE the running UI diverges from the target design and can iterate there.

export interface RegionDiff {
  name: string
  diffPercent: number
}

export interface PixelDiffResult {
  matchPercent: number // 100 = identical
  diffPercent: number // % of pixels exceeding the per-pixel threshold
  meanDiff: number // 0..1 average normalized channel difference
  regions: RegionDiff[] // 9 cells, reading order top-left → bottom-right
}

export const REGION_NAMES = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
]

/**
 * @param a,b BGRA buffers, each width*height*4 bytes
 * @param threshold summed |Δ| across B,G,R for a pixel to count as "different"
 */
export function diffBitmaps(a: Buffer | Uint8Array, b: Buffer | Uint8Array, width: number, height: number, threshold = 48): PixelDiffResult {
  const total = width * height
  if (total <= 0 || a.length < total * 4 || b.length < total * 4) {
    return { matchPercent: 0, diffPercent: 100, meanDiff: 1, regions: REGION_NAMES.map((name) => ({ name, diffPercent: 100 })) }
  }
  const regDiff = new Array(9).fill(0)
  const regTotal = new Array(9).fill(0)
  const colW = width / 3
  const rowH = height / 3
  let differing = 0
  let sum = 0
  for (let y = 0; y < height; y++) {
    const row = Math.min(2, Math.floor(y / rowH))
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2])
      sum += d
      const reg = row * 3 + Math.min(2, Math.floor(x / colW))
      regTotal[reg]++
      if (d > threshold) { differing++; regDiff[reg]++ }
    }
  }
  const diffPercent = (differing / total) * 100
  const meanDiff = sum / total / (3 * 255)
  const regions = REGION_NAMES.map((name, i) => ({ name, diffPercent: regTotal[i] ? (regDiff[i] / regTotal[i]) * 100 : 0 }))
  return { matchPercent: 100 - diffPercent, diffPercent, meanDiff, regions }
}
