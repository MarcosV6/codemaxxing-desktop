/**
 * Cookbook — local-model recommendation core.
 *
 * Scans the host's memory budget, then recommends local models that will
 * actually run. This module is intentionally PURE — zero imports, no Electron, no I/O —
 * so it can be unit-tested in isolation (see test/cookbook.test.ts) exactly
 * like modelContext.ts. The real hardware probe + `ollama pull/serve` wiring
 * lives in the main process and feeds plain numbers into these functions.
 */

export interface HardwareProfile {
  platform: string // 'darwin' | 'win32' | 'linux' | …
  arch: string // 'arm64' | 'x64' | …
  /** Total system RAM in GB. */
  totalRamGb: number
  /**
   * Best-estimate memory budget a model may use, in GB. On Apple Silicon this
   * tracks unified memory (≈ a generous fraction of RAM); on a discrete-GPU
   * box where we can't read VRAM we fall back to a conservative slice of RAM.
   */
  vramBudgetGb: number
  /** True for Apple-Silicon / unified-memory machines. */
  unifiedMemory: boolean
  /** Human-readable chip string when known, e.g. 'Apple M2 Max'. */
  chip?: string
}

export type Quant = 'Q4_K_M' | 'Q5_K_M' | 'Q8_0' | 'FP16' | string

export interface CatalogModel {
  /** Ollama-style pull id, e.g. 'qwen2.5-coder:32b'. */
  id: string
  /** Model family, e.g. 'qwen2.5-coder'. */
  family: string
  /** Display label, e.g. 'Qwen2.5 Coder 32B'. */
  label: string
  /** Parameter count in billions (effective, for MoE). */
  params: number
  quant: Quant
  /** Approximate on-disk download size in GB at the listed quant. */
  sizeGb: number
  /** Minimum memory budget (GB) to run comfortably with some context. */
  minRamGb: number
  /** Context window in tokens. */
  contextWindow: number
  /** Tuned for coding tasks. */
  coder: boolean
  blurb: string
}

export type FitClass = 'comfortable' | 'tight' | 'too-big'

export interface Recommendation {
  model: CatalogModel
  fit: FitClass
}

/**
 * Curated catalog of popular, openly-available local models with realistic
 * Q4_K_M footprints. Sizes/min-RAM are deliberately conservative — better to
 * recommend a model that runs smoothly than one that swaps. Ordering here is
 * not significant; recommendModels() sorts by capability-that-fits.
 */
export const MODEL_CATALOG: CatalogModel[] = [
  { id: 'qwen2.5-coder:7b', family: 'qwen2.5-coder', label: 'Qwen2.5 Coder 7B', params: 7, quant: 'Q4_K_M', sizeGb: 4.7, minRamGb: 8, contextWindow: 128_000, coder: true, blurb: 'Fast, capable coder — great default on 16GB machines.' },
  { id: 'qwen2.5-coder:14b', family: 'qwen2.5-coder', label: 'Qwen2.5 Coder 14B', params: 14, quant: 'Q4_K_M', sizeGb: 9.0, minRamGb: 12, contextWindow: 128_000, coder: true, blurb: 'Noticeably stronger reasoning about code; needs ~16GB+.' },
  { id: 'qwen2.5-coder:32b', family: 'qwen2.5-coder', label: 'Qwen2.5 Coder 32B', params: 32, quant: 'Q4_K_M', sizeGb: 20, minRamGb: 24, contextWindow: 128_000, coder: true, blurb: 'Frontier-ish local coding; shines on 36GB+ unified memory.' },
  { id: 'llama3.1:8b', family: 'llama3.1', label: 'Llama 3.1 8B', params: 8, quant: 'Q4_K_M', sizeGb: 4.9, minRamGb: 8, contextWindow: 128_000, coder: false, blurb: 'Well-rounded general assistant with a long context.' },
  { id: 'llama3.1:70b', family: 'llama3.1', label: 'Llama 3.1 70B', params: 70, quant: 'Q4_K_M', sizeGb: 40, minRamGb: 48, contextWindow: 128_000, coder: false, blurb: 'Heavyweight general model — wants 64GB+ to be pleasant.' },
  { id: 'deepseek-r1:7b', family: 'deepseek-r1', label: 'DeepSeek-R1 7B', params: 7, quant: 'Q4_K_M', sizeGb: 4.7, minRamGb: 8, contextWindow: 64_000, coder: false, blurb: 'Distilled reasoning model — thinks before it answers.' },
  { id: 'deepseek-r1:14b', family: 'deepseek-r1', label: 'DeepSeek-R1 14B', params: 14, quant: 'Q4_K_M', sizeGb: 9.0, minRamGb: 12, contextWindow: 64_000, coder: false, blurb: 'Stronger chain-of-thought; good math/logic on 16GB+.' },
  { id: 'deepseek-r1:32b', family: 'deepseek-r1', label: 'DeepSeek-R1 32B', params: 32, quant: 'Q4_K_M', sizeGb: 20, minRamGb: 24, contextWindow: 64_000, coder: false, blurb: 'Deep reasoning at the edge of a 36GB machine.' },
  { id: 'gemma2:9b', family: 'gemma2', label: 'Gemma 2 9B', params: 9, quant: 'Q4_K_M', sizeGb: 5.4, minRamGb: 10, contextWindow: 8_192, coder: false, blurb: 'Crisp, instruction-following general model from Google.' },
  { id: 'gemma2:27b', family: 'gemma2', label: 'Gemma 2 27B', params: 27, quant: 'Q4_K_M', sizeGb: 16, minRamGb: 20, contextWindow: 8_192, coder: false, blurb: 'Punches above its size for general chat; 32GB+ ideal.' },
  { id: 'mistral:7b', family: 'mistral', label: 'Mistral 7B', params: 7, quant: 'Q4_K_M', sizeGb: 4.4, minRamGb: 8, contextWindow: 32_000, coder: false, blurb: 'Lean, quick, dependable — a classic 8GB-friendly pick.' },
  { id: 'mixtral:8x7b', family: 'mixtral', label: 'Mixtral 8x7B', params: 47, quant: 'Q4_K_M', sizeGb: 26, minRamGb: 32, contextWindow: 32_000, coder: false, blurb: 'Sparse MoE — strong quality, but wants 32GB+ resident.' },
  { id: 'codellama:13b', family: 'codellama', label: 'Code Llama 13B', params: 13, quant: 'Q4_K_M', sizeGb: 7.4, minRamGb: 11, contextWindow: 16_000, coder: true, blurb: 'Battle-tested code model; reliable infill & completion.' },
  { id: 'phi3:3.8b', family: 'phi3', label: 'Phi-3 Mini 3.8B', params: 3.8, quant: 'Q4_K_M', sizeGb: 2.3, minRamGb: 6, contextWindow: 128_000, coder: false, blurb: 'Tiny but mighty — runs almost anywhere, even 8GB.' },
]

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Estimate the usable model-memory budget from total RAM. Unified-memory
 * machines (Apple Silicon) can dedicate a generous ~75% to a model; on a
 * box with a discrete GPU whose VRAM we couldn't read, we stay conservative
 * at ~50% of system RAM.
 */
export function estimateVramBudgetGb(totalRamGb: number, unifiedMemory: boolean): number {
  if (!(totalRamGb > 0)) return 0
  return round1(totalRamGb * (unifiedMemory ? 0.75 : 0.5))
}

/** Assemble a full HardwareProfile, computing the memory budget for you. */
export function makeHardwareProfile(input: {
  platform: string
  arch: string
  totalRamGb: number
  unifiedMemory: boolean
  chip?: string
}): HardwareProfile {
  return {
    platform: input.platform,
    arch: input.arch,
    totalRamGb: input.totalRamGb,
    unifiedMemory: input.unifiedMemory,
    chip: input.chip,
    vramBudgetGb: estimateVramBudgetGb(input.totalRamGb, input.unifiedMemory),
  }
}

/** Classify how comfortably a model fits a given memory budget (GB). */
export function fitClass(model: CatalogModel, budgetGb: number): FitClass {
  if (budgetGb >= model.minRamGb * 1.25) return 'comfortable'
  if (budgetGb >= model.minRamGb) return 'tight'
  return 'too-big'
}

/** True when the model will run at all within the budget (comfortable or tight). */
export function modelFitsBudget(model: CatalogModel, budgetGb: number): boolean {
  return budgetGb >= model.minRamGb
}

const FIT_RANK: Record<FitClass, number> = { comfortable: 0, tight: 1, 'too-big': 2 }

/**
 * Recommend local models for a hardware profile, best-first.
 *
 * Ranking: models that fit come first (comfortable before tight); within a
 * class we prefer more parameters (more capable) and then the smaller
 * download as a tiebreak. When nothing fits, we surface the smallest options
 * (all flagged 'too-big') so the UI can say "nothing fits cleanly, but here's
 * the closest you could try."
 */
export function recommendModels(
  profile: HardwareProfile,
  opts: { coderOnly?: boolean; limit?: number } = {},
): Recommendation[] {
  const limit = opts.limit ?? 6
  const budget = profile.vramBudgetGb
  const pool = opts.coderOnly ? MODEL_CATALOG.filter((m) => m.coder) : MODEL_CATALOG

  const ranked = pool
    .map((model) => ({ model, fit: fitClass(model, budget) }))

  const fitting = ranked.filter((r) => r.fit !== 'too-big')

  if (fitting.length === 0) {
    // Nothing runs — show the lightest models so there's still a path forward.
    return [...pool]
      .sort((a, b) => a.minRamGb - b.minRamGb || a.params - b.params)
      .slice(0, limit)
      .map((model) => ({ model, fit: 'too-big' as FitClass }))
  }

  return fitting
    .sort(
      (a, b) =>
        FIT_RANK[a.fit] - FIT_RANK[b.fit] ||
        b.model.params - a.model.params ||
        a.model.sizeGb - b.model.sizeGb,
    )
    .slice(0, limit)
}

/** Format a GB size for display: integers stay whole, else one decimal. */
export function formatSizeGb(gb: number): string {
  if (!isFinite(gb) || gb <= 0) return '—'
  return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`
}

/** Look up a catalog model by its ollama-style id. */
export function findCatalogModel(id: string): CatalogModel | null {
  return MODEL_CATALOG.find((m) => m.id === id) ?? null
}
