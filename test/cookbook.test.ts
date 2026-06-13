import { describe, it, expect } from 'vitest'
import {
  MODEL_CATALOG,
  estimateVramBudgetGb,
  makeHardwareProfile,
  fitClass,
  modelFitsBudget,
  recommendModels,
  formatSizeGb,
  findCatalogModel,
  type HardwareProfile,
} from '../electron/core/cookbook'

// A 36GB Apple-Silicon box → 0.75 * 36 = 27GB budget.
const appleSilicon36: HardwareProfile = makeHardwareProfile({
  platform: 'darwin', arch: 'arm64', totalRamGb: 36, unifiedMemory: true, chip: 'Apple M2 Max',
})
// A 16GB discrete/unknown-GPU box → 0.5 * 16 = 8GB budget.
const discrete16: HardwareProfile = makeHardwareProfile({
  platform: 'linux', arch: 'x64', totalRamGb: 16, unifiedMemory: false,
})
// A tiny 4GB box → 0.75 * 4 = 3GB budget; nothing in the catalog fits.
const tiny4: HardwareProfile = makeHardwareProfile({
  platform: 'win32', arch: 'x64', totalRamGb: 4, unifiedMemory: true,
})

describe('estimateVramBudgetGb', () => {
  it('gives unified memory ~75% of RAM', () => {
    expect(estimateVramBudgetGb(36, true)).toBe(27)
    expect(estimateVramBudgetGb(8, true)).toBe(6)
  })
  it('is conservative (~50%) on discrete/unknown GPUs', () => {
    expect(estimateVramBudgetGb(16, false)).toBe(8)
    expect(estimateVramBudgetGb(64, false)).toBe(32)
  })
  it('handles non-positive RAM safely', () => {
    expect(estimateVramBudgetGb(0, true)).toBe(0)
    expect(estimateVramBudgetGb(-4, false)).toBe(0)
  })
})

describe('makeHardwareProfile', () => {
  it('fills in the computed budget', () => {
    expect(appleSilicon36.vramBudgetGb).toBe(27)
    expect(discrete16.vramBudgetGb).toBe(8)
    expect(appleSilicon36.chip).toBe('Apple M2 Max')
  })
})

describe('fitClass', () => {
  const m32 = findCatalogModel('qwen2.5-coder:32b')!
  it('classifies comfortable / tight / too-big around minRam', () => {
    // 32b needs 24GB. comfortable threshold = 24 * 1.25 = 30.
    expect(fitClass(m32, 30)).toBe('comfortable')
    expect(fitClass(m32, 27)).toBe('tight') // >= 24 but < 30
    expect(fitClass(m32, 24)).toBe('tight')
    expect(fitClass(m32, 23)).toBe('too-big')
  })
})

describe('modelFitsBudget', () => {
  it('fits the 8B model but not the 70B at a 27GB budget', () => {
    expect(modelFitsBudget(findCatalogModel('llama3.1:8b')!, 27)).toBe(true)
    expect(modelFitsBudget(findCatalogModel('llama3.1:70b')!, 27)).toBe(false)
  })
})

describe('recommendModels', () => {
  it('leads with the most capable model that fits comfortably (36GB unified)', () => {
    const recs = recommendModels(appleSilicon36)
    expect(recs.length).toBeGreaterThan(0)
    // gemma2:27b (minRam 20) is comfortable at 27GB; the 32b models are only
    // 'tight', so the largest *comfortable* model leads.
    expect(recs[0].model.params).toBe(27)
    expect(recs.every((r) => r.fit !== 'too-big')).toBe(true)
    // Oversized models must never be recommended when smaller ones fit.
    expect(recs.some((r) => r.model.id === 'llama3.1:70b')).toBe(false)
    expect(recs.some((r) => r.model.id === 'mixtral:8x7b')).toBe(false)
  })

  it('respects the coderOnly filter', () => {
    const recs = recommendModels(appleSilicon36, { coderOnly: true })
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.every((r) => r.model.coder)).toBe(true)
    expect(recs[0].fit).not.toBe('too-big')
  })

  it('honors the limit', () => {
    expect(recommendModels(appleSilicon36, { limit: 3 })).toHaveLength(3)
  })

  it('only returns models that actually fit a small (16GB) budget', () => {
    const recs = recommendModels(discrete16)
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.every((r) => r.model.minRamGb <= discrete16.vramBudgetGb)).toBe(true)
    // The 14B+ models do not fit an 8GB budget.
    expect(recs.every((r) => r.model.params <= 8)).toBe(true)
  })

  it('falls back to the lightest models when nothing fits', () => {
    const recs = recommendModels(tiny4)
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.every((r) => r.fit === 'too-big')).toBe(true)
    // Smallest-by-minRam first — Phi-3 Mini (6GB) is the global minimum.
    expect(recs[0].model.minRamGb).toBe(6)
    expect(recs[0].model.id).toBe('phi3:3.8b')
  })
})

describe('formatSizeGb', () => {
  it('keeps integers whole and others to one decimal', () => {
    expect(formatSizeGb(20)).toBe('20 GB')
    expect(formatSizeGb(4.4)).toBe('4.4 GB')
    expect(formatSizeGb(0.6)).toBe('0.6 GB')
  })
  it('guards against junk', () => {
    expect(formatSizeGb(0)).toBe('—')
    expect(formatSizeGb(NaN)).toBe('—')
  })
})

describe('catalog integrity', () => {
  it('has unique ids and sane numbers', () => {
    const ids = MODEL_CATALOG.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of MODEL_CATALOG) {
      expect(m.sizeGb).toBeGreaterThan(0)
      expect(m.minRamGb).toBeGreaterThanOrEqual(m.sizeGb) // need headroom over the weights
      expect(m.contextWindow).toBeGreaterThan(0)
    }
  })
})
