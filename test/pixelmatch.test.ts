import { describe, it, expect } from 'vitest'
import { diffBitmaps } from '../electron/core/pixelmatch'

/** Build a solid BGRA bitmap of one color. */
function solid(w: number, h: number, b: number, g: number, r: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    buf[o] = b; buf[o + 1] = g; buf[o + 2] = r; buf[o + 3] = 255
  }
  return buf
}

describe('diffBitmaps', () => {
  it('identical images → 100% match, 0% diff', () => {
    const a = solid(6, 6, 10, 20, 30)
    const r = diffBitmaps(a, Buffer.from(a), 6, 6)
    expect(r.matchPercent).toBe(100)
    expect(r.diffPercent).toBe(0)
    expect(r.meanDiff).toBeCloseTo(0)
    expect(r.regions).toHaveLength(9)
    expect(r.regions.every((x) => x.diffPercent === 0)).toBe(true)
  })

  it('black vs white → 100% diff, every region maxed', () => {
    const black = solid(6, 6, 0, 0, 0)
    const white = solid(6, 6, 255, 255, 255)
    const r = diffBitmaps(black, white, 6, 6)
    expect(r.diffPercent).toBe(100)
    expect(r.matchPercent).toBe(0)
    expect(r.meanDiff).toBeCloseTo(1)
    expect(r.regions.every((x) => x.diffPercent === 100)).toBe(true)
  })

  it('top half changed → ~50% overall, top regions hot, bottom cold', () => {
    const w = 6, h = 6
    const a = solid(w, h, 0, 0, 0)
    const b = Buffer.from(a)
    for (let y = 0; y < h / 2; y++) {
      for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; b[o] = 255; b[o + 1] = 255; b[o + 2] = 255 }
    }
    const r = diffBitmaps(a, b, w, h)
    expect(r.diffPercent).toBeCloseTo(50, 0)
    expect(r.regions[1].diffPercent).toBe(100) // 'top'
    expect(r.regions[7].diffPercent).toBe(0)   // 'bottom'
  })

  it('sub-threshold noise counts as a match', () => {
    const a = solid(4, 4, 100, 100, 100)
    const b = solid(4, 4, 110, 100, 100) // channel Δ = 10 < 48
    expect(diffBitmaps(a, b, 4, 4).diffPercent).toBe(0)
  })

  it('guards mismatched / undersized buffers', () => {
    const r = diffBitmaps(Buffer.alloc(4), Buffer.alloc(4), 8, 8)
    expect(r.diffPercent).toBe(100)
    expect(r.regions).toHaveLength(9)
  })
})
