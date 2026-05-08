/**
 * Model context-window detection — ported from the CLI TUI
 * (~/Projects/codemaxxing/src/utils/model-context.ts).
 *
 * Two layers:
 *   1. Static lookup table for known cloud models (Claude, GPT, Gemini, etc.)
 *   2. Runtime detection for local servers (Ollama via /api/show, LM Studio
 *      via /api/v0/models, OpenRouter via /api/v1/models) so the *actually
 *      loaded* context window — including user overrides — wins over the
 *      static guess.
 *
 * Returned values are in tokens. Returns a sane default when nothing can be
 * determined; callers should not crash.
 *
 * Keep in sync with the CLI copy — this repo does not import from the CLI.
 */

const FALLBACK_WINDOW = 32_000

/** Static lookup. Substring-matched case-insensitively. */
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

export function getStaticContextWindow(model: string): number | null {
  if (!model) return null
  if (MODEL_CONTEXT_WINDOWS[model] !== undefined) return MODEL_CONTEXT_WINDOWS[model]
  const lower = model.toLowerCase()
  for (const [key, ctx] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(key)) return ctx
  }
  for (const [key, ctx] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (key.includes(lower)) return ctx
  }
  return null
}

function stripV1Suffix(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '')
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 2000): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return res.ok ? res : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Ollama: POST /api/show — response has `model_info` with `<arch>.context_length`. */
export async function detectOllamaContextWindow(baseUrl: string, model: string): Promise<number | null> {
  const root = stripV1Suffix(baseUrl)
  const res = await fetchWithTimeout(`${root}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
  })
  if (!res) return null
  try {
    const data = (await res.json()) as { model_info?: Record<string, unknown> }
    const info = data.model_info ?? {}
    for (const [key, value] of Object.entries(info)) {
      if (key.endsWith('.context_length') && typeof value === 'number') return value
    }
    if (typeof (info as Record<string, unknown>).context_length === 'number') {
      return (info as Record<string, number>).context_length
    }
    return null
  } catch {
    return null
  }
}

/** LM Studio: GET /api/v0/models exposes `loaded_context_length` / `max_context_length`. */
export async function detectLMStudioContextWindow(baseUrl: string, model: string): Promise<number | null> {
  const root = stripV1Suffix(baseUrl)
  const res = await fetchWithTimeout(`${root}/api/v0/models`)
  if (!res) return null
  try {
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const entries = data.data ?? []
    const match = entries.find(m => m.id === model || m.id === model.toLowerCase())
    if (!match) return null
    for (const k of ['loaded_context_length', 'max_context_length', 'context_length']) {
      const v = match[k]
      if (typeof v === 'number' && v > 0) return v
    }
    return null
  } catch {
    return null
  }
}

/** OpenRouter: GET /v1/models returns each model with `context_length`. */
export async function detectOpenRouterContextWindow(baseUrl: string, model: string): Promise<number | null> {
  const res = await fetchWithTimeout(`${baseUrl}/models`)
  if (!res) return null
  try {
    const data = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const entries = data.data ?? []
    const match = entries.find(m => m.id === model)
    if (!match) return null
    const v = match.context_length
    if (typeof v === 'number' && v > 0) return v
    return null
  } catch {
    return null
  }
}

/**
 * llama.cpp / llama-server: two paths.
 *
 *   1. /props — the canonical introspection endpoint. Returns
 *      `default_generation_settings.n_ctx` which is the loaded context
 *      length (i.e. respects --ctx-size at server start time).
 *   2. /v1/models — newer llama.cpp builds include `meta.n_ctx_train`
 *      (training-time context, not the loaded one). We use it as a
 *      secondary signal because /props is occasionally disabled and the
 *      training-time number is at least an upper bound the user picked.
 *
 * Strips trailing /v1 from baseUrl since /props lives at the server root.
 */
export async function detectLlamaCppContextWindow(baseUrl: string, _model: string): Promise<number | null> {
  const root = stripV1Suffix(baseUrl)
  // First-choice: /props. Fastest, single fetch, gives the loaded n_ctx.
  const props = await fetchWithTimeout(`${root}/props`)
  if (props) {
    try {
      const data: any = await props.json()
      const n = data?.default_generation_settings?.n_ctx ?? data?.n_ctx
      if (typeof n === 'number' && n > 0) return n
    } catch { /* fall through to /v1/models */ }
  }
  // Fallback: /v1/models with `meta.n_ctx_train`.
  const models = await fetchWithTimeout(`${root}/v1/models`)
  if (models) {
    try {
      const data: any = await models.json()
      const entries: any[] = Array.isArray(data?.data) ? data.data : []
      for (const e of entries) {
        const n = e?.meta?.n_ctx_train ?? e?.meta?.n_ctx ?? e?.context_length
        if (typeof n === 'number' && n > 0) return n
      }
    } catch { /* nothing usable */ }
  }
  return null
}

/**
 * Race every server-introspection probe in parallel and return the first
 * non-null answer. Cheap because each probe fails fast against the wrong
 * server (the wrong endpoints 404 in <100ms typically), and bounded to
 * 2s by the underlying fetchWithTimeout. We don't need to know which
 * specific server we're talking to — whichever shape responds wins.
 */
async function probeSelfHostedContextWindow(baseUrl: string, model: string): Promise<number | null> {
  const probes = await Promise.allSettled([
    detectLlamaCppContextWindow(baseUrl, model),
    detectOllamaContextWindow(baseUrl, model),
    detectLMStudioContextWindow(baseUrl, model),
    detectOpenRouterContextWindow(baseUrl, model),
  ])
  for (const r of probes) {
    if (r.status === 'fulfilled' && r.value && r.value > 0) return r.value
  }
  return null
}

/**
 * Hostnames we recognize as cloud APIs and won't waste a probe round-trip
 * on. Anything not on this list is treated as potentially self-hosted —
 * including Tailscale (.ts.net), Bonjour (.local), private RFC1918 ranges,
 * and arbitrary public-IP hostnames the user might point a Custom Provider
 * at. Better to spend ~2s probing on first session start than to silently
 * report 32k for a self-hosted gpu rig with a 128k window.
 */
const CLOUD_URL_PATTERNS = [
  'api.anthropic.com',
  'api.openai.com',
  'openrouter.ai',
  'api.githubcopilot.com',
  'dashscope.aliyuncs.com',
  'chatgpt.com',
  'generativelanguage.googleapis.com',
  'azure.com',
  'aws.amazon.com',
  'amazonaws.com',
]

function isCloudUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return CLOUD_URL_PATTERNS.some(p => lower.includes(p))
}

/** Primary entry. Tries provider-specific detection, then static table, then fallback. */
export async function detectModelContextWindow(opts: {
  model: string
  baseUrl: string
  providerType: 'openai' | 'anthropic'
}): Promise<number> {
  const { model, baseUrl, providerType } = opts

  if (providerType === 'anthropic') {
    return getStaticContextWindow(model) ?? 200_000
  }

  const url = baseUrl.toLowerCase()

  // Cloud providers we know — go straight to static lookup since these
  // don't expose a useful context-window field on /models.
  if (isCloudUrl(url)) {
    if (url.includes('openrouter.ai')) {
      const detected = await detectOpenRouterContextWindow(baseUrl, model)
      if (detected) return detected
    }
    return getStaticContextWindow(model) ?? FALLBACK_WINDOW
  }

  // Self-hosted (LAN, Tailscale, .local, public IP custom server, etc.):
  // race all known introspection endpoints in parallel — whichever shape
  // the server speaks wins. Custom Provider over Tailscale to llama.cpp
  // hits this path and gets the real loaded n_ctx instead of the 32k
  // FALLBACK_WINDOW.
  const detected = await probeSelfHostedContextWindow(baseUrl, model)
  if (detected) return detected

  return getStaticContextWindow(model) ?? FALLBACK_WINDOW
}

/**
 * True if the provider is a local inference server (Ollama, LM Studio,
 * llama.cpp, etc). Detected by loopback / private-range base URL.
 */
export function isLocalProvider(providerType: 'openai' | 'anthropic', baseUrl: string | undefined): boolean {
  if (providerType === 'anthropic') return false
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    if (host.endsWith('.local')) return true
    if (/^10\./.test(host)) return true
    if (/^192\.168\./.test(host)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
    return false
  } catch {
    return false
  }
}

/** 1234 → "1.2k", 128000 → "128k". */
export function formatContextSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}
