/**
 * OpenAI Codex Responses API handler
 *
 * Uses the ChatGPT backend endpoint (https://chatgpt.com/backend-api/codex/responses)
 * which is what Codex CLI, OpenClaw, and other tools use with ChatGPT Plus OAuth tokens.
 *
 * This endpoint supports the Responses API format but is separate from api.openai.com.
 * Standard API keys use api.openai.com/v1/responses; Codex OAuth tokens use this.
 *
 * Ported from ~/Projects/codemaxxing/src/utils/responses-api.ts. The repair-tool-args
 * helper is inlined here to keep this module self-contained inside the Electron
 * main process bundle.
 */

import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions'

// ── Inlined from utils/repair-tool-args.ts ──
function repairToolArgs(raw: string): string {
  const stripped = raw.replace(/,(\s*[}\]])/g, '$1')
  let trimmed = stripped.trimEnd()
  if (!trimmed) return trimmed
  const opensObj = trimmed.startsWith('{')
  const opensArr = trimmed.startsWith('[')
  if (!opensObj && !opensArr) return trimmed

  let quoteCount = 0
  let escaped = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') quoteCount++
  }
  if (quoteCount % 2 === 1) trimmed += '"'

  const lastChar = trimmed[trimmed.length - 1]
  const needsClose = opensObj ? lastChar !== '}' : lastChar !== ']'
  if (!needsClose) return trimmed
  return trimmed + (opensObj ? '}' : ']')
}

export interface ResponsesAPIOptions {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  systemPrompt: string
  messages: any[]
  tools: any[]
  reasoningEffort?: 'low' | 'medium' | 'high'
  onToken?: (token: string) => void
  signal?: AbortSignal
}

interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

interface PartialToolCall {
  key: string
  id: string
  name: string
  argumentsBuffer: string
}

/**
 * Serialize a chat-completion message `content` field to a string for the
 * Responses API. The footgun this fixes: `JSON.stringify(null)` returns the
 * literal string `"null"`, which when sent back as prior assistant text
 * shows up between tool calls in the UI. Coerce null/undefined to '' first.
 *
 * Note: this only handles plain text. Multi-part content (text + image)
 * goes through `toResponsesContent()` below which preserves the parts.
 */
function serializeContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    // Concat text parts only — images are handled via toResponsesContent.
    return (content as any[])
      .map(p => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
      .join('')
  }
  try {
    return JSON.stringify(content) ?? ''
  } catch {
    return ''
  }
}

/**
 * Convert OpenAI Chat-Completions-style content (string or array of
 * `{type:'text'}` / `{type:'image_url'}`) into the Responses API input
 * content shape — `{type:'input_text'}` / `{type:'input_image'}`. Returns
 * `null` if there's nothing to send (so caller can skip emitting an empty
 * message turn).
 */
function toResponsesUserContent(content: unknown): Array<Record<string, unknown>> | string | null {
  if (content == null) return null
  if (typeof content === 'string') return content || null
  if (Array.isArray(content)) {
    const parts: Array<Record<string, unknown>> = []
    for (const p of content as any[]) {
      if (p?.type === 'text' && typeof p.text === 'string' && p.text) {
        parts.push({ type: 'input_text', text: p.text })
      } else if (p?.type === 'image_url' && p.image_url?.url) {
        parts.push({ type: 'input_image', image_url: p.image_url.url })
      }
    }
    return parts.length > 0 ? parts : null
  }
  const s = serializeContent(content)
  return s || null
}

function getToolCallKey(event: any, item?: any, fallback?: string | null): string | null {
  if (typeof item?.id === 'string' && item.id) return item.id
  if (typeof event?.item_id === 'string' && event.item_id) return event.item_id
  if (typeof item?.call_id === 'string' && item.call_id) return item.call_id
  if (typeof event?.call_id === 'string' && event.call_id) return event.call_id
  if (typeof event?.output_index === 'number') return `output_${event.output_index}`
  return fallback ?? null
}

function ensurePartialToolCall(
  partials: Map<string, PartialToolCall>,
  key: string,
  item?: any,
): PartialToolCall {
  const existing = partials.get(key)
  if (existing) {
    if (item?.id) existing.id = item.id
    if (item?.call_id && !existing.id) existing.id = item.call_id
    if (item?.name) existing.name = item.name
    return existing
  }
  const created: PartialToolCall = {
    key,
    id: item?.id || item?.call_id || key,
    name: item?.name || '',
    argumentsBuffer: '',
  }
  partials.set(key, created)
  return created
}

/**
 * Determine if a model should use the Responses API.
 *
 * Models that need this path:
 *   - GPT-5.x family (only available through Responses API)
 *   - Codex variants
 *   - o3 / o3-mini / o4-mini reasoning models
 *   - gpt-4.1 (works on both, Responses gives better OAuth coverage)
 */
export function shouldUseResponsesAPI(model: string): boolean {
  const lower = model.toLowerCase()
  if (lower.startsWith('gpt-5')) return true
  if (lower.includes('codex')) return true
  if (lower === 'o3' || lower === 'o3-mini' || lower === 'o4-mini') return true
  if (lower.startsWith('gpt-4.1')) return true
  return false
}

/**
 * Execute a chat request using the Codex Responses API endpoint.
 * Streams text + handles tool calls.
 */
export async function chatWithResponsesAPI(options: ResponsesAPIOptions): Promise<{
  contentText: string
  toolCalls: ToolCall[]
  promptTokens: number
  completionTokens: number
}> {
  const {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    messages,
    tools,
    reasoningEffort,
    onToken,
    signal,
  } = options

  // ── Build input items from message history ──
  const inputItems: any[] = []
  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      const c = toResponsesUserContent(msg.content)
      if (c == null) continue // nothing to send
      inputItems.push({
        type: 'message',
        role: 'user',
        content: c,
      })
    } else if (msg.role === 'assistant') {
      if ((msg as any).tool_calls?.length > 0) {
        // Only emit the assistant text turn if there's actual content. An
        // assistant message that is purely tool_calls has content === null,
        // and we MUST NOT serialize that as the string "null" — that would
        // be echoed back to the model as prior assistant text.
        const text = serializeContent(msg.content)
        if (text) {
          inputItems.push({
            type: 'message',
            role: 'assistant',
            content: text,
          })
        }
        for (const tc of (msg as any).tool_calls) {
          inputItems.push({
            type: 'function_call',
            id: tc.id,
            call_id: tc.id,
            name: tc.function?.name || tc.name || '',
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || tc.input || {}),
          })
        }
      } else {
        inputItems.push({
          type: 'message',
          role: 'assistant',
          content: serializeContent(msg.content),
        })
      }
    } else if (msg.role === 'tool') {
      inputItems.push({
        type: 'function_call_output',
        call_id: (msg as any).tool_call_id || '',
        output: serializeContent(msg.content),
      })
    }
  }

  // ── Build tools in Responses API format ──
  const responseTools: any[] = tools
    .filter((t: any) => t.type === 'function')
    .map((t: any) => ({
      type: 'function' as const,
      name: t.function?.name || '',
      description: t.function?.description || '',
      parameters: t.function?.parameters || { type: 'object', properties: {} },
    }))

  // ── Determine the endpoint URL ──
  // OAuth tokens (JWTs, not sk- keys) must use ChatGPT backend
  const isOAuthToken = !apiKey.startsWith('sk-') && !apiKey.startsWith('sess-')
  let effectiveBaseUrl = baseUrl
  if (isOAuthToken && !baseUrl.includes('chatgpt.com')) {
    effectiveBaseUrl = 'https://chatgpt.com/backend-api'
  }

  let endpoint: string
  if (effectiveBaseUrl.includes('chatgpt.com/backend-api')) {
    endpoint = effectiveBaseUrl.replace(/\/$/, '') + '/codex/responses'
  } else {
    endpoint = effectiveBaseUrl.replace(/\/$/, '') + '/responses'
  }

  // ── Build request body ──
  const body: any = {
    model,
    instructions: systemPrompt,
    input: inputItems.length > 0 ? inputItems : '',
    stream: true,
    store: false,
  }
  if (responseTools.length > 0) body.tools = responseTools
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort }

  // ── Make the streaming request ──
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'codemaxxing/1.0',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Responses API error (${response.status}): ${errText}`)
  }

  // ── Parse SSE stream ──
  let contentText = ''
  let promptTokens = 0
  let completionTokens = 0
  const toolCalls: ToolCall[] = []
  const partialToolCalls = new Map<string, PartialToolCall>()
  const finalizedToolCallIds = new Set<string>()
  let lastToolCallKey: string | null = null

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      let event: any
      try { event = JSON.parse(data) } catch { continue }

      const eventType = event.type

      // Hard errors → throw. `response.incomplete` is a soft signal — keep what
      // we collected so far and let the caller's loop continue.
      if (
        eventType === 'error' ||
        eventType === 'response.failed' ||
        eventType === 'response.error'
      ) {
        const detail = event.error?.message ?? event.message ?? event.response?.error?.message ?? JSON.stringify(event)
        throw new Error(`Responses API stream error: ${detail}`)
      }
      if (eventType === 'response.incomplete') {
        const reason = event.response?.incomplete_details?.reason ?? event.reason ?? 'unknown'
        contentText += contentText
          ? `\n\n[response incomplete: ${reason}]`
          : `[response incomplete: ${reason}]`
        continue
      }

      // Text content delta
      if (eventType === 'response.output_text.delta' || eventType === 'response.text_delta') {
        const delta = event.delta
        if (delta) {
          contentText += delta
          onToken?.(delta)
        }
      }

      // Function call item added
      if (eventType === 'response.output_item.added') {
        const item = event.item
        if (item?.type === 'function_call') {
          const key = getToolCallKey(event, item, `tool_${toolCalls.length + partialToolCalls.size}`)
          if (key) {
            ensurePartialToolCall(partialToolCalls, key, item)
            lastToolCallKey = key
          }
        }
      }

      // Function call arguments streaming
      if (eventType === 'response.function_call_arguments.delta') {
        const delta = event.delta
        if (delta) {
          const key = getToolCallKey(event, undefined, lastToolCallKey)
          if (key) {
            const partial = ensurePartialToolCall(partialToolCalls, key)
            partial.argumentsBuffer += delta
            lastToolCallKey = key
          }
        }
      }

      // Function call arguments done
      if (eventType === 'response.function_call_arguments.done') {
        const key = getToolCallKey(event, undefined, lastToolCallKey)
        if (key) {
          const partial = ensurePartialToolCall(partialToolCalls, key)
          const rawArgs = typeof event.arguments === 'string' && event.arguments
            ? event.arguments
            : partial.argumentsBuffer
          try {
            const args = JSON.parse(repairToolArgs(rawArgs || '{}') || '{}')
            if (!finalizedToolCallIds.has(partial.id)) {
              toolCalls.push({ id: partial.id, name: partial.name, input: args })
              finalizedToolCallIds.add(partial.id)
            }
          } catch {
            // Skip malformed tool call
          } finally {
            partial.argumentsBuffer = ''
            lastToolCallKey = key
          }
        }
      }

      // Output item done (alternative completion path)
      if (eventType === 'response.output_item.done') {
        const item = event.item
        if (item?.type === 'function_call' && item.arguments) {
          const key = getToolCallKey(event, item, lastToolCallKey)
          if (key) {
            const partial = ensurePartialToolCall(partialToolCalls, key, item)
            try {
              const args = JSON.parse(repairToolArgs(item.arguments) || '{}')
              if (!finalizedToolCallIds.has(partial.id)) {
                toolCalls.push({ id: partial.id, name: partial.name, input: args })
                finalizedToolCallIds.add(partial.id)
              }
            } catch { /* skip */ }
            lastToolCallKey = key
          }
        }
      }

      // Response completed — extract usage
      if (eventType === 'response.completed') {
        const resp = event.response
        const usage = resp?.usage || event.usage
        if (usage) {
          promptTokens = usage.input_tokens || usage.prompt_tokens || 0
          completionTokens = usage.output_tokens || usage.completion_tokens || 0
        }
      }
    }
  }

  return { contentText, toolCalls, promptTokens, completionTokens }
}

/**
 * Convert ResponsesAPI tool calls into the chat-completions shape the rest of
 * the agent loop already speaks. Keeps the run() loop ignorant of the wire
 * format the upstream provider used.
 */
export function toChatCompletionToolCalls(
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
): ChatCompletionMessageToolCall[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: { name: tc.name, arguments: JSON.stringify(tc.input) },
  }))
}
