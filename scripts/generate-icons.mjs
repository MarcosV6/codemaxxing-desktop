#!/usr/bin/env node
/**
 * Reproducible app-icon generator for codemaxxing-desktop.
 *
 * Renders a 1024×1024 master analytically with signed-distance fields (crisp,
 * dependency-free anti-aliasing) and emits the three assets electron-builder
 * references:
 *   public/icon.icns  (macOS — built via sips + iconutil)
 *   public/icon.ico   (Windows — multi-size PNG-in-ICO, written by hand)
 *   public/icon.png   (Linux — 512×512)
 *
 * The mark is a terminal prompt "> _" in a soft mint→cyan gradient on a dark
 * squircle: reads as a developer tool and stays legible down to 16px. No SVG
 * rasterizer or ImageMagick required — only macOS built-ins (sips, iconutil).
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const SIZE = 1024

// ---- colors -------------------------------------------------------------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const BG_TOP = hex('#1b2233')
const BG_BOT = hex('#0c0f17')
const GLYPH_A = hex('#6ee7b7') // mint
const GLYPH_B = hex('#22d3ee') // cyan
const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

// ---- signed-distance helpers (coords in 1024 space) ---------------------
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
  const dx = pax - bax * h, dy = pay - bay * h
  return Math.hypot(dx, dy)
}
function sdRoundBox(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r)
  const qy = Math.abs(py - cy) - (hy - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r
}

// squircle: centered 824-box (Apple icon grid) within the 1024 canvas
const MARGIN = 100
const RECT_C = SIZE / 2
const RECT_H = (SIZE - 2 * MARGIN) / 2 // 412
const RECT_R = 0.2237 * (SIZE - 2 * MARGIN) // ≈184

// prompt geometry — chevron ">" + underscore cursor "_"
const CH_TOP = [366, 396], CH_APEX = [528, 512], CH_BOT = [366, 628]
const CH_HT = 34
const US_A = [566, 624], US_B = [726, 624]
const US_HT = 22

function renderMaster() {
  const px = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = x + 0.5, sy = y + 0.5
      let r = 0, g = 0, b = 0, a = 0

      // background squircle (1px AA via distance)
      const db = sdRoundBox(sx, sy, RECT_C, RECT_C, RECT_H, RECT_H, RECT_R)
      const bgCov = clamp(0.5 - db, 0, 1)
      if (bgCov > 0) {
        const t = clamp((sy - MARGIN) / (SIZE - 2 * MARGIN), 0, 1)
        const c = lerp3(BG_TOP, BG_BOT, t)
        ;[r, g, b] = c
        a = bgCov
      }

      // glyph: union of two chevron arms + the underscore bar
      const dCh = Math.min(
        sdSegment(sx, sy, CH_TOP[0], CH_TOP[1], CH_APEX[0], CH_APEX[1]) - CH_HT,
        sdSegment(sx, sy, CH_APEX[0], CH_APEX[1], CH_BOT[0], CH_BOT[1]) - CH_HT,
      )
      const dUs = sdSegment(sx, sy, US_A[0], US_A[1], US_B[0], US_B[1]) - US_HT
      const dG = Math.min(dCh, dUs)
      const gCov = clamp(0.5 - dG, 0, 1)
      if (gCov > 0) {
        const t = clamp(((sx - 340) + (sy - 380)) / 520, 0, 1)
        const gc = lerp3(GLYPH_A, GLYPH_B, t)
        // straight-alpha "over": glyph atop bg
        const outA = gCov + a * (1 - gCov)
        if (outA > 0) {
          r = (gc[0] * gCov + r * a * (1 - gCov)) / outA
          g = (gc[1] * gCov + g * a * (1 - gCov)) / outA
          b = (gc[2] * gCov + b * a * (1 - gCov)) / outA
          a = outA
        }
      }

      const i = (y * SIZE + x) * 4
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a * 255
    }
  }
  return px
}

// ---- PNG encoder --------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePNG(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc(h * (w * 4 + 1))
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1)
    raw[rowStart] = 0 // filter: none
    src.copy(raw, rowStart + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- ICO encoder (PNG-compressed entries, Vista+) -----------------------
function encodeICO(pngBySize) {
  const sizes = Object.keys(pngBySize).map(Number).sort((a, b) => a - b)
  const count = sizes.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const blobs = []
  sizes.forEach((sz, i) => {
    const png = pngBySize[sz]
    const e = i * 16
    dir[e] = sz >= 256 ? 0 : sz
    dir[e + 1] = sz >= 256 ? 0 : sz
    dir[e + 2] = 0; dir[e + 3] = 0
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(png.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += png.length
    blobs.push(png)
  })
  return Buffer.concat([header, dir, ...blobs])
}

// ---- pipeline -----------------------------------------------------------
console.log('rendering 1024 master…')
const master = renderMaster()
const masterPNG = encodePNG(master, SIZE, SIZE)

const tmp = mkdtempSync(join(tmpdir(), 'cmx-icon-'))
const masterPath = join(tmp, 'master-1024.png')
writeFileSync(masterPath, masterPNG)

const sipsResize = (size, out) =>
  execFileSync('sips', ['-z', String(size), String(size), masterPath, '--out', out], { stdio: 'ignore' })

// macOS .icns
console.log('building icon.icns…')
const iconset = join(tmp, 'icon.iconset')
mkdirSync(iconset)
const ICNS = [
  [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
]
for (const [sz, name] of ICNS) sipsResize(sz, join(iconset, name))
mkdirSync(PUBLIC, { recursive: true })
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(PUBLIC, 'icon.icns')], { stdio: 'ignore' })

// Windows .ico
console.log('building icon.ico…')
const icoSizes = [16, 32, 48, 64, 128, 256]
const pngBySize = {}
for (const sz of icoSizes) {
  const out = join(tmp, `ico-${sz}.png`)
  sipsResize(sz, out)
  pngBySize[sz] = readFileSync(out)
}
writeFileSync(join(PUBLIC, 'icon.ico'), encodeICO(pngBySize))

// Linux .png (512)
console.log('building icon.png (512)…')
sipsResize(512, join(PUBLIC, 'icon.png'))

// keep a viewable 1024 master next to the assets for design review
writeFileSync(join(PUBLIC, 'icon-1024.png'), masterPNG)

console.log('done →', PUBLIC)
