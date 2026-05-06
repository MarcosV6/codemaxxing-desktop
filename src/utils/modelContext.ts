/**
 * Renderer-side mirror of `electron/core/modelContext.ts`'s static lookup.
 *
 * The main process does runtime probing for local providers (LM Studio,
 * Ollama) too — that part stays main-only because it requires arbitrary
 * outbound HTTP. But the static cloud-model table is just data, and the
 * renderer needs it to answer "what's the context window of gpt-5.5"
 * BEFORE the first agent run (e.g. for the status-bar gauge on a freshly
 * switched session). Without this, the gauge fell back to a hardcoded
 * 128k and lied about gpt-5.5's actual 400k window.
 *
 * Keep in lock-step with the main-process copy. The CLI repo has the
 * canonical version; both the main-process and renderer copies in this
 * repo are ports.
 */

const FALLBACK_WINDOW = 32_000

/** Substring-matched case-insensitively. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic Claude
  'claude-opus-4-7':     200_000,
  'claude-opus-4-6':     200_000,
  'claude-sonnet-4-6':   200_000,
  'claude-haiku-4-5':    200_000,
  'claude-opus-4':       200_000,
  'claude-sonnet-4':     200_000,
  'claude-3-7-sonnet':   200_000,
  'claude-3-5-sonnet':   200_000,
  'claude-3-5-haiku':    200_000,
  'claude-3-opus':       200_000,
  'claude-3-sonnet':     200_000,
  'claude-3-haiku':      200_000,
  // OpenAI
  'gpt-5.5-pro':         400_000,
  'gpt-5.5':             400_000,
  'gpt-5.4-pro':         400_000,
  'gpt-5.4':             400_000,
  'gpt-5.3-codex':       400_000,
  'gpt-5-mini':          400_000,
  'gpt-5':               400_000,
  'gpt-4.1-nano':      1_000_000,
  'gpt-4.1-mini':      1_000_000,
  'gpt-4.1':           1_000_000,
  'gpt-4o-mini':         128_000,
  'gpt-4o':              128_000,
  'gpt-4-turbo':         128_000,
  'gpt-4':                 8_192,
  'gpt-3.5-turbo':        16_385,
  'o1-pro':              200_000,
  'o1-mini':             128_000,
  'o1':                  200_000,
  'o3-mini':             200_000,
  'o3':                  200_000,
  'o4-mini':             200_000,
  // Google
  'gemini-2.5-pro':    2_000_000,
  'gemini-2.5-flash':  1_000_000,
  'gemini-2.0-flash':  1_000_000,
  'gemini-1.5-pro':    2_000_000,
  'gemini-1.5-flash':  1_000_000,
  'gemini-pro':           32_000,
  // DeepSeek
  'deepseek-v3':          64_000,
  'deepseek-r1':          64_000,
  'deepseek-chat':        64_000,
  'deepseek-coder':       64_000,
  // Qwen
  'qwen3.5':             128_000,
  'qwen-2.5':            128_000,
  'qwen2.5':             128_000,
  'qwen-coder':          128_000,
  // Llama
  'llama-3.3':           128_000,
  'llama-3.2':           128_000,
  'llama-3.1':           128_000,
  'llama-3':               8_192,
  // Mistral
  'mistral-large':       128_000,
  'mistral-small':        32_000,
  'mistral-nemo':        128_000,
  'mixtral-8x22b':        64_000,
  'mixtral-8x7b':         32_000,
  // Grok
  'grok-2':              131_072,
  'grok-beta':           131_072,
}

/**
 * Best-effort context-window lookup for a model name. Returns null when
 * unknown — callers decide how to fall back (the status bar uses
 * `getModelContextWindow` below which adds a sane provider default).
 */
export function getStaticContextWindow(model: string): number | null {
  if (!model) return null
  if (MODEL_CONTEXT_WINDOWS[model] !== undefined) return MODEL_CONTEXT_WINDOWS[model]
  const lower = model.toLowerCase()
  for (const [key, ctx] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(key)) return ctx
  }
  // Reverse direction — handle weird canonical-name cases ('gpt-5' as a
  // user input matching 'gpt-5-mini' etc.). Static lookup, doesn't fire
  // unless the first pass missed.
  for (const [key, ctx] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (key.includes(lower)) return ctx
  }
  return null
}

/**
 * Provider-aware context window with a fallback. Used when the agent
 * hasn't yet pushed `currentStats.contextWindow` for this session — i.e.
 * fresh session, just switched, or before the first turn finishes.
 *
 * Provider-default rationale: cloud Anthropic = 200k, cloud OpenAI = 128k
 * (lowest common denominator across non-Responses-API models), local
 * providers (LM Studio / Ollama) = 32k since we genuinely don't know.
 */
export function getModelContextWindow(model: string | undefined, provider?: string): number {
  if (model) {
    const known = getStaticContextWindow(model)
    if (known) return known
  }
  if (provider === 'anthropic') return 200_000
  if (provider === 'openai' || provider === 'openrouter' || provider === 'qwen' || provider === 'copilot') return 128_000
  return FALLBACK_WINDOW
}
