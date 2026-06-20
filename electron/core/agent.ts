import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import { FILE_TOOLS, executeTool, getExistingContent, generateDiff, TaskTracker, type Task } from './tools.js'
import { getAllMCPTools, callMCPTool, parseMCPToolName } from './mcp.js'
import { runHooksForEvent } from './hooks.js'
import {
  detectModelContextWindow,
  isLocalProvider as isLocalProviderUrl,
  getStaticContextWindow,
} from './modelContext.js'
import { getCredential, saveCredential } from './auth.js'
import { refreshAnthropicOAuthToken } from './anthropicOAuth.js'
import { refreshOpenAICodexToken } from './openaiOAuth.js'
import {
  chatWithResponsesAPI,
  shouldUseResponsesAPI,
  toChatCompletionToolCalls,
} from './responsesApi.js'

/** Refresh OAuth tokens N ms before expiry (matches CLI behavior). */
const OAUTH_REFRESH_SKEW_MS = 60_000

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'notebook_edit'])
const SHELL_TOOLS = new Set(['run_command', 'run_background_command', 'kill_bash'])
const GIT_WRITE_TOOLS = new Set(['git_commit'])
/** Read-only tools that can be parallelized. */
const PARALLELIZABLE_TOOLS = new Set([
  'read_file', 'list_files', 'search_files', 'glob', 'web_fetch', 'web_search', 'view_image', 'think',
  'recall', 'git_status', 'git_diff', 'git_log', 'bash_output',
])
// Hard cap on tool-call rounds per user message. Prevents runaway loops on
// pathological prompts. Bumped from 25 → 75 since real agentic work (large
// refactors, multi-file changes, parallel exploration) regularly exceeded 25
// and made the agent appear to "randomly stop" mid-task. When this cap is hit
// we now surface an explicit message instead of returning empty text.
const MAX_ITERATIONS = 75

export type ApprovalResult = 'yes' | 'no' | 'always'
export type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto'
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'

const REASONING_BUDGET: Record<ReasoningEffort, number> = {
  off: 0,
  low: 2048,
  medium: 6000,
  high: 12000,
  max: 24000,
}

export interface AgentStats {
  tokensPerSecond: number | null
  contextWindow: number
  isLocal: boolean
}

export interface AgentEvents {
  onText?: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown>; status: 'pending' | 'running' | 'done' | 'error' | 'denied'; result?: string; diff?: string | null }) => void
  onToolApproval?: (call: { id: string; name: string; args: Record<string, unknown>; diff?: string | null }) => Promise<ApprovalResult>
  onAskUser?: (question: string, options?: string[]) => Promise<string>
  onPlanExit?: (plan: string) => void
  onTaskChange?: (tasks: Task[]) => void
  onIteration?: (n: number) => void
  onUsage?: (u: { promptTokens: number; completionTokens: number }) => void
  onStats?: (s: AgentStats) => void
  // Preview bridges (wired in main; let the agent show + see its running work)
  onOpenPreview?: (url: string) => void
  onCapturePreview?: (url?: string) => Promise<{ ok: boolean; mime?: string; base64?: string; error?: string }>
  // Built-in browser bridge — agent drives the same webview the user sees.
  onBrowserCommand?: (cmd: { action: 'navigate' | 'read' | 'screenshot' | 'click'; url?: string; selector?: string; text?: string }) => Promise<{ ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }>
  // Visual pixel-match — diff the running UI against a target design image.
  onPixelMatch?: (opts: { url?: string; targetPath: string }) => Promise<{ ok: boolean; matchPercent?: number; diffPercent?: number; regions?: Array<{ name: string; diffPercent: number }>; error?: string }>
  // Documents workspace — read/write the open document.
  onDocumentOp?: (op: { action: 'list' | 'read' | 'write' | 'append' | 'create'; id?: string; title?: string; content?: string; text?: string }) => Promise<{ ok: boolean; documents?: { id: string; title: string }[]; doc?: { id: string; title: string; content: string }; error?: string }>
}

export type SessionMode = 'code' | 'chat'

/**
 * Tools allowed in chat mode — read-only research/utility tools only.
 * No filesystem writes, no shell, no git mutations. Mirrors the "web version
 * of the model" experience the user wants for non-coding sessions.
 */
const CHAT_MODE_TOOL_NAMES = new Set([
  'web_search',
  'web_fetch',
  'view_image',
  'think',
])

export interface AgentConfig {
  provider: 'anthropic' | 'openai'
  model: string
  baseUrl?: string
  apiKey: string
  cwd: string
  systemPrompt: string
  messages: ChatCompletionMessageParam[] // prior history
  /** Legacy — prefer approvalMode. */
  autoApprove?: boolean
  approvalMode?: ApprovalMode
  reasoningEffort?: ReasoningEffort
  scope?: string | null
  abortSignal?: AbortSignal
  /**
   * Session mode. `code` (default) gets the full coding tool surface; `chat`
   * gets only read-only research tools (web_search, web_fetch, view_image,
   * think) so users can have a plain conversation without the agent ever
   * touching the filesystem.
   */
  mode?: SessionMode
}

export interface RunResult {
  text: string
  messages: ChatCompletionMessageParam[] // full updated message array
  iterations: number
  aborted: boolean
  totalPromptTokens: number
  totalCompletionTokens: number
  tokensPerSecond: number | null
  contextWindow: number
  isLocal: boolean
}

function toolMessage(callId: string, content: string): ChatCompletionMessageParam {
  return { role: 'tool', tool_call_id: callId, content } as any
}

/**
 * Coerce a chat-completions message array into a shape strict OpenAI-compat
 * servers (llama.cpp, vLLM, some forks of text-generation-webui) accept.
 *
 * Specifically: an assistant message that ONLY made tool calls has
 * `content: null` per the OpenAI spec. OpenAI's own API accepts that;
 * llama.cpp's request validator returns 500 with "Expected 'content' to be
 * a string or an array". Same shape comes from Anthropic adapters too.
 *
 * Fix: replace `null`/`undefined` content with an empty string. Doesn't
 * change semantics — the assistant didn't say anything textual on that
 * turn. Done in one place at the request boundary so we don't have to
 * remember at every messages.push() site.
 *
 * Also strips top-level `null` content on tool messages, just in case.
 */
function sanitizeMessagesForChatCompletions(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    const msg = m as any
    if (msg.content == null) {
      return { ...msg, content: '' } as ChatCompletionMessageParam
    }
    return m
  })
}

/**
 * Parse tool-call arguments produced by the model, forgiving common quirks
 * from local inference servers (Ollama, LM Studio, llama.cpp). Tries, in order:
 *   1. Plain JSON.parse
 *   2. Trailing-comma repair
 *   3. Extract the first balanced {…} or […] span (for models that wrap JSON
 *      in "Here are the args: {…}" narration)
 *   4. Trailing-comma repair on the extracted span
 * Falls back to a sentinel object so the tool invocation still gets a response.
 */
function safeParseJSON(s: string): Record<string, unknown> {
  if (!s || s.trim() === '') return {}
  const trimmed = s.trim()
  try { return JSON.parse(trimmed) } catch {}
  try { return JSON.parse(trimmed.replace(/,\s*([}\]])/g, '$1')) } catch {}
  // Extract the largest object/array span in case the model added narration.
  const firstObj = trimmed.indexOf('{')
  const lastObj = trimmed.lastIndexOf('}')
  const firstArr = trimmed.indexOf('[')
  const lastArr = trimmed.lastIndexOf(']')
  const candidates: string[] = []
  if (firstObj >= 0 && lastObj > firstObj) candidates.push(trimmed.slice(firstObj, lastObj + 1))
  if (firstArr >= 0 && lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1))
  for (const c of candidates) {
    try { return JSON.parse(c) } catch {}
    try { return JSON.parse(c.replace(/,\s*([}\]])/g, '$1')) } catch {}
  }
  return { __parseError: true, __raw: s }
}

/**
 * Tag the last content block of an Anthropic message with `cache_control:
 * { type: 'ephemeral' }`. Used to add a cache breakpoint at the end of the
 * conversation prefix so subsequent iterations within the same agentic loop
 * (and same-prefix runs within ~5min) reuse the cached KV state.
 *
 * Returns a *copy*; the persisted message history is never mutated.
 */
function markLastBlockCacheable(msg: Anthropic.Messages.MessageParam): Anthropic.Messages.MessageParam {
  if (typeof msg.content === 'string') {
    if (!msg.content) return msg
    return {
      ...msg,
      content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } } as any],
    }
  }
  if (!Array.isArray(msg.content) || msg.content.length === 0) return msg
  const blocks = [...(msg.content as any[])]
  const last = blocks[blocks.length - 1]
  blocks[blocks.length - 1] = { ...last, cache_control: { type: 'ephemeral' } }
  return { ...msg, content: blocks as any }
}

function stripDiffMarkers(result: string): { summary: string; diff: string | null } {
  const m = result.match(/<<<DIFF>>>([\s\S]*?)<<<END_DIFF>>>/)
  if (!m) return { summary: result, diff: null }
  return {
    summary: result.replace(/<<<DIFF>>>[\s\S]*?<<<END_DIFF>>>/, '').trim(),
    diff: m[1].trim(),
  }
}

function renderDiffForApproval(name: string, args: Record<string, unknown>, cwd: string): string | null {
  if (name === 'write_file') {
    const path = String((args.path ?? args.file_path ?? '') as string)
    const content = String((args.content ?? args.text ?? '') as string)
    const existing = getExistingContent(path, cwd) ?? ''
    return generateDiff(existing, content, path)
  }
  if (name === 'edit_file') {
    const path = String((args.path ?? args.file_path ?? '') as string)
    const oldText = String(args.oldText ?? '')
    const newText = String(args.newText ?? '')
    const existing = getExistingContent(path, cwd)
    if (existing === null) return null
    if (!existing.includes(oldText)) return null
    const replaceAll = Boolean(args.replaceAll)
    const next = replaceAll ? existing.split(oldText).join(newText) : existing.replace(oldText, newText)
    return generateDiff(existing, next, path)
  }
  return null
}

function needsApproval(mode: ApprovalMode, name: string): boolean {
  if (mode === 'full-auto') return false
  if (EDIT_TOOLS.has(name)) return mode === 'suggest'
  if (SHELL_TOOLS.has(name)) return true // shell always asks unless full-auto
  if (GIT_WRITE_TOOLS.has(name)) return true
  return false
}

function deriveApprovalMode(config: AgentConfig): ApprovalMode {
  if (config.approvalMode) return config.approvalMode
  return config.autoApprove ? 'full-auto' : 'suggest'
}

export class CodingAgent {
  private config: AgentConfig
  private events: AgentEvents
  private alwaysApproved: Set<string> = new Set()
  private taskTracker = new TaskTracker()
  private promptTokens = 0
  private completionTokens = 0
  private approvalMode: ApprovalMode
  private editedPaths: string[] = []
  private lastTokensPerSecond: number | null = null
  private contextWindow: number
  private contextWindowReady: Promise<void>

  constructor(config: AgentConfig, events: AgentEvents) {
    this.config = config
    this.events = events
    this.approvalMode = deriveApprovalMode(config)
    // Seed with static guess so callers get a sane number even before detection finishes.
    this.contextWindow = getStaticContextWindow(config.model) ?? (config.provider === 'anthropic' ? 200_000 : 128_000)
    this.contextWindowReady = this.initContextWindow()
  }

  private async initContextWindow(): Promise<void> {
    try {
      const detected = await detectModelContextWindow({
        model: this.config.model,
        baseUrl: this.config.baseUrl ?? '',
        providerType: this.config.provider,
      })
      if (detected && detected > 0) this.contextWindow = detected
      this.emitStats()
    } catch { /* keep static fallback */ }
  }

  private emitStats(): void {
    this.events.onStats?.({
      tokensPerSecond: this.lastTokensPerSecond,
      contextWindow: this.contextWindow,
      isLocal: this.isLocal(),
    })
  }

  getLastTokensPerSecond(): number | null { return this.lastTokensPerSecond }
  getContextWindow(): number { return this.contextWindow }
  isLocal(): boolean { return isLocalProviderUrl(this.config.provider, this.config.baseUrl) }

  /**
   * Proactively refresh OAuth tokens that are about to expire.
   *
   * Mirrors the CLI behavior at ~/Projects/codemaxxing/src/core/agent.ts so a
   * long-running session never hits the 401 cliff mid-tool-call. Only fires
   * when the credential on disk has refresh metadata (`refreshToken` and
   * `oauthExpires`) — pure API-key creds skip silently.
   */
  private async maybeRefreshOAuth(): Promise<void> {
    const providerId = this.config.provider // 'anthropic' | 'openai'
    const cred = getCredential(providerId)
    if (!cred?.refreshToken || !cred.oauthExpires) return
    if (cred.oauthExpires - Date.now() > OAUTH_REFRESH_SKEW_MS) return
    await this.refreshOAuthNow()
  }

  /**
   * Unconditionally refresh the OAuth token (if the credential supports it).
   * Used as the recovery step when a stream call comes back with 401 even
   * though our proactive `maybeRefreshOAuth()` thought the token was still
   * valid — the provider may have rotated it server-side, or the local clock
   * was skewed past the skew window. Returns true if the access token on
   * `this.config.apiKey` is now newer than before; false if the credential
   * has no refresh metadata or the refresh endpoint itself failed.
   */
  private async refreshOAuthNow(): Promise<boolean> {
    const providerId = this.config.provider
    const cred = getCredential(providerId)
    if (!cred?.refreshToken) return false
    try {
      const refreshed = providerId === 'anthropic'
        ? await refreshAnthropicOAuthToken(cred.refreshToken)
        : await refreshOpenAICodexToken(cred.refreshToken)

      saveCredential({
        ...cred,
        apiKey: refreshed.access,
        refreshToken: refreshed.refresh,
        oauthExpires: refreshed.expires,
      })
      const changed = this.config.apiKey !== refreshed.access
      this.config = { ...this.config, apiKey: refreshed.access }
      return changed
    } catch (err) {
      console.warn(`[agent] OAuth refresh failed for ${providerId}:`, err)
      return false
    }
  }

  /**
   * Sniff whether an SDK error reads as "your credentials are bad" — covers
   * HTTP 401, OpenAI's `invalid_api_key`, and the various flavors Anthropic
   * uses when an OAuth access token expires mid-stream. We're deliberately
   * loose here: a false positive just means we waste one refresh round-trip.
   */
  private isAuthError(err: any): boolean {
    const status = err?.status ?? err?.response?.status ?? err?.cause?.status
    if (status === 401) return true
    const code = String(err?.code ?? err?.error?.code ?? '')
    if (/invalid_api_key|unauthorized|expired_token/i.test(code)) return true
    const msg = String(err?.message ?? err?.error?.message ?? '')
    return /unauthor|invalid.*api.*key|invalid.*token|expired.*token|access.*token/i.test(msg)
  }

  async run(
    userMessage: string,
    images?: Array<{ id?: string; dataUrl: string; mediaType: string; name?: string }>,
  ): Promise<RunResult> {
    // Best-effort: let context-window detection finish so the first stats
    // emitted during this run are already accurate. Capped internally by
    // fetchWithTimeout (2s), so this never stalls long runs.
    await this.contextWindowReady.catch(() => {})

    const messages: ChatCompletionMessageParam[] = [...this.config.messages]
    // When images are attached we build the OpenAI-style multi-part content
    // array so downstream provider adapters (Anthropic, Responses API) can
    // recognize image parts. The shape mirrors what main.ts persists, so the
    // run-time message and the saved message stay byte-identical.
    if (images && images.length > 0) {
      messages.push({
        role: 'user',
        content: [
          ...(userMessage ? [{ type: 'text' as const, text: userMessage }] : []),
          ...images.map(img => ({
            type: 'image_url' as const,
            image_url: { url: img.dataUrl },
          })),
        ],
      })
    } else {
      messages.push({ role: 'user', content: userMessage })
    }

    // Chat mode strips out filesystem/shell/git tools, leaving only read-only
    // research helpers — gives users a "claude.ai / chatgpt.com" experience
    // inside the app without ever risking the agent touching their filesystem.
    const isChatMode = this.config.mode === 'chat'
    const baseTools = isChatMode
      ? FILE_TOOLS.filter(t => CHAT_MODE_TOOL_NAMES.has(t.function.name))
      : FILE_TOOLS
    const allTools = isChatMode ? baseTools : [...baseTools, ...getAllMCPTools()]

    let iterations = 0
    let finalText = ''
    let aborted = false

    while (iterations < MAX_ITERATIONS) {
      iterations++
      this.events.onIteration?.(iterations)

      if (this.config.abortSignal?.aborted) { aborted = true; break }

      // Proactively refresh OAuth tokens if they're about to expire — must run
      // before each iteration since long sessions can outlive token TTLs.
      await this.maybeRefreshOAuth()

      let assistantText = ''
      let toolCalls: ChatCompletionMessageToolCall[] = []

      if (this.config.provider === 'anthropic') {
        const { text, calls } = await this.streamAnthropic(messages, allTools)
        assistantText = text
        toolCalls = calls
      } else if (this.shouldUseResponsesAPIForCurrent()) {
        const { text, calls } = await this.streamOpenAIResponses(messages, allTools)
        assistantText = text
        toolCalls = calls
      } else {
        const { text, calls } = await this.streamOpenAI(messages, allTools)
        assistantText = text
        toolCalls = calls
      }

      if (toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: toolCalls,
        } as any)
      } else if (assistantText) {
        messages.push({ role: 'assistant', content: assistantText })
        finalText = assistantText
        break
      } else {
        break
      }

      const allParallelizable = toolCalls.every(tc => {
        const parsed = parseMCPToolName(tc.function.name)
        if (parsed) return false
        return PARALLELIZABLE_TOOLS.has(tc.function.name)
      })

      if (allParallelizable) {
        const results = await Promise.all(
          toolCalls.map(async (tc) => {
            const args = safeParseJSON(tc.function.arguments || '{}')
            this.events.onToolCall?.({ id: tc.id, name: tc.function.name, args, status: 'running' })
            let res: string
            try {
              await this.runPreToolHooks(tc.function.name, args)
              res = await executeTool(tc.function.name, args, this.execContext())
            } catch (e: any) {
              res = `Error: ${e?.message ?? String(e)}`
            }
            const stripped = stripDiffMarkers(res)
            this.events.onToolCall?.({ id: tc.id, name: tc.function.name, args, status: 'done', result: stripped.summary, diff: stripped.diff })
            await this.runPostToolHooks(tc.function.name, args, stripped.summary)
            return { callId: tc.id, content: stripped.summary + (stripped.diff ? `\n\nDiff:\n${stripped.diff}` : '') }
          }),
        )
        for (const r of results) messages.push(toolMessage(r.callId, r.content))
        continue
      }

      for (const tc of toolCalls) {
        if (this.config.abortSignal?.aborted) { aborted = true; break }
        const args = safeParseJSON(tc.function.arguments || '{}')
        const name = tc.function.name

        if (needsApproval(this.approvalMode, name) && !this.alwaysApproved.has(name)) {
          const diff = renderDiffForApproval(name, args, this.config.cwd)
          this.events.onToolCall?.({ id: tc.id, name, args, status: 'pending', diff })
          const decision = this.events.onToolApproval
            ? await this.events.onToolApproval({ id: tc.id, name, args, diff })
            : 'yes'
          if (decision === 'no') {
            const msg = `Tool call '${name}' was denied by the user.`
            this.events.onToolCall?.({ id: tc.id, name, args, status: 'denied', result: msg, diff })
            messages.push(toolMessage(tc.id, msg))
            continue
          }
          if (decision === 'always') this.alwaysApproved.add(name)
        }

        // Pre-tool hook (can block)
        const preBlocked = await this.runPreToolHooks(name, args)
        if (preBlocked) {
          const msg = `Tool call '${name}' blocked by pre-tool hook: ${preBlocked}`
          this.events.onToolCall?.({ id: tc.id, name, args, status: 'denied', result: msg })
          messages.push(toolMessage(tc.id, msg))
          continue
        }

        this.events.onToolCall?.({ id: tc.id, name, args, status: 'running' })
        let result: string
        try {
          const mcp = parseMCPToolName(name)
          if (mcp) {
            result = await callMCPTool(mcp.serverName, mcp.toolName, args)
          } else {
            result = await executeTool(name, args, this.execContext())
          }
        } catch (e: any) {
          result = `Error: ${e?.message ?? String(e)}`
        }
        const stripped = stripDiffMarkers(result)
        this.events.onToolCall?.({ id: tc.id, name, args, status: 'done', result: stripped.summary, diff: stripped.diff })
        await this.runPostToolHooks(name, args, stripped.summary)
        if (EDIT_TOOLS.has(name) && typeof args.path === 'string') {
          this.editedPaths.push(String(args.path))
        }
        messages.push(toolMessage(tc.id, stripped.summary + (stripped.diff ? `\n\nDiff:\n${stripped.diff}` : '')))
      }
      if (aborted) break
    }

    // Loop exited without ever producing a final assistant text. Two cases:
    //   1. Hit MAX_ITERATIONS cap — model still wanted to call tools.
    //   2. Got an empty response (no text, no tool calls) — usually a model
    //      glitch or rate-limit. Either way, surface something the UI can
    //      render so the session doesn't appear to silently freeze.
    if (!aborted && !finalText) {
      finalText = iterations >= MAX_ITERATIONS
        ? `\n\n_(Stopped after ${MAX_ITERATIONS} tool-call rounds. Send another message to continue from here — the work so far is preserved in this session.)_`
        : `\n\n_(The model returned an empty response. This usually means a transient provider error — try sending your message again.)_`
      messages.push({ role: 'assistant', content: finalText })
      // Surface the message via the same text-stream channel so it shows up
      // in the chat panel exactly like a normal assistant reply would.
      this.events.onText?.(finalText)
    }

    this.emitStats()

    return {
      text: finalText,
      messages,
      iterations,
      aborted,
      totalPromptTokens: this.promptTokens,
      totalCompletionTokens: this.completionTokens,
      tokensPerSecond: this.lastTokensPerSecond,
      contextWindow: this.contextWindow,
      isLocal: this.isLocal(),
    }
  }

  private execContext() {
    return {
      cwd: this.config.cwd,
      taskTracker: this.taskTracker,
      scope: this.config.scope ?? null,
      onTaskChange: (t: Task[]) => this.events.onTaskChange?.(t),
      onAskUser: this.events.onAskUser,
      onPlanExit: this.events.onPlanExit,
      openPreview: this.events.onOpenPreview,
      capturePreview: this.events.onCapturePreview,
      browserCommand: this.events.onBrowserCommand,
      pixelMatch: this.events.onPixelMatch,
      documentOp: this.events.onDocumentOp,
    }
  }

  private async runPreToolHooks(toolName: string, args: Record<string, unknown>): Promise<string | null> {
    try {
      const results = await runHooksForEvent('pre-tool', {
        cwd: this.config.cwd,
        toolName,
        args,
        path: typeof args.path === 'string' ? String(args.path) : undefined,
      })
      const blocked = results.find(r => r.blocked)
      return blocked ? (blocked.stderr || blocked.stdout || 'blocked').trim().slice(0, 500) : null
    } catch { return null }
  }

  private async runPostToolHooks(toolName: string, args: Record<string, unknown>, summary: string): Promise<void> {
    const path = typeof args.path === 'string' ? String(args.path) : undefined
    try {
      await runHooksForEvent('post-tool', {
        cwd: this.config.cwd, toolName, args, path, payload: { summary },
      })
      if (EDIT_TOOLS.has(toolName) && path) {
        await runHooksForEvent('on-edit', { cwd: this.config.cwd, toolName, args, path, payload: { summary } })
      }
    } catch { /* swallow */ }
  }

  /** Summarize old messages into a compact recap to keep context manageable. */
  async compact(keepRecent = 6): Promise<ChatCompletionMessageParam[]> {
    const msgs = this.config.messages
    if (msgs.length <= keepRecent + 2) return msgs
    const toSummarize = msgs.slice(0, msgs.length - keepRecent)
    const recent = msgs.slice(msgs.length - keepRecent)
    const summaryPrompt: ChatCompletionMessageParam = {
      role: 'user',
      content: `You are summarizing a prior conversation. Produce a compact bullet list of: (1) what the user asked, (2) what you did, (3) open questions and next steps. Be specific with file paths and decisions. Do NOT narrate. Under 400 words.\n\n--- Conversation to summarize ---\n${toSummarize.map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content.slice(0, 800) : '[structured content]'}`).join('\n\n')}`,
    }
    const client = this.config.provider === 'openai'
      ? new OpenAI({ apiKey: this.config.apiKey || 'not-needed', baseURL: this.config.baseUrl })
      : null
    let summary = '(summary unavailable)'
    try {
      if (client) {
        const res = await client.chat.completions.create({
          model: this.config.model,
          messages: [{ role: 'system', content: 'You compress conversation history.' }, summaryPrompt],
        })
        summary = res.choices[0]?.message?.content ?? summary
      } else {
        const ant = new Anthropic({ apiKey: this.config.apiKey, baseURL: this.config.baseUrl })
        const res = await ant.messages.create({
          model: this.config.model,
          max_tokens: 1024,
          system: 'You compress conversation history.',
          messages: [{ role: 'user', content: String(summaryPrompt.content) }],
        })
        const block = res.content?.[0]
        if (block && block.type === 'text') summary = block.text
      }
    } catch { /* fallthrough */ }
    const compactMessage: ChatCompletionMessageParam = {
      role: 'user', content: `[Context-compaction summary]\n${summary}`,
    }
    const compacted = [compactMessage, ...recent]
    this.config.messages = compacted
    return compacted
  }

  /**
   * Should the current OpenAI request use the Responses API instead of
   * chat-completions?
   *
   * Two triggers:
   *   1. The credential's baseUrl is `chatgpt.com/...` — only the Responses
   *      endpoint exists there (ChatGPT subscription OAuth).
   *   2. The model is one of the GPT-5 / o-series / codex / gpt-4.1 family
   *      that ships exclusively on Responses.
   */
  private shouldUseResponsesAPIForCurrent(): boolean {
    if (this.config.provider !== 'openai') return false
    if ((this.config.baseUrl ?? '').includes('chatgpt.com')) return true
    return shouldUseResponsesAPI(this.config.model)
  }

  /**
   * Stream from OpenAI's Responses API and adapt the result into the same
   * `{ text, calls }` shape the chat-completions path returns, so the
   * surrounding `run()` loop is provider-shape agnostic.
   */
  private async streamOpenAIResponses(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ): Promise<{ text: string; calls: ChatCompletionMessageToolCall[] }> {
    const effort = this.config.reasoningEffort && this.config.reasoningEffort !== 'off'
      ? (this.config.reasoningEffort === 'max' ? 'high' : this.config.reasoningEffort)
      : undefined

    let firstTokenAt = 0
    let lastTokenAt = 0
    let streamCompletionTokens = 0

    const result = await chatWithResponsesAPI({
      baseUrl: this.config.baseUrl ?? 'https://chatgpt.com/backend-api',
      apiKey: this.config.apiKey,
      model: this.config.model,
      maxTokens: 8192,
      systemPrompt: this.config.systemPrompt,
      messages,
      tools,
      reasoningEffort: effort as 'low' | 'medium' | 'high' | undefined,
      onToken: (token) => {
        const now = Date.now()
        if (!firstTokenAt) firstTokenAt = now
        lastTokenAt = now
        this.events.onText?.(token)
      },
      signal: this.config.abortSignal,
    })

    streamCompletionTokens = result.completionTokens
    this.promptTokens += result.promptTokens
    this.completionTokens += result.completionTokens
    if (result.promptTokens || result.completionTokens) {
      this.events.onUsage?.({
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      })
    }

    this.recordTokensPerSecond(firstTokenAt, lastTokenAt, streamCompletionTokens, result.contentText.length)

    return {
      text: result.contentText,
      calls: toChatCompletionToolCalls(result.toolCalls),
    }
  }

  private async streamOpenAI(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ): Promise<{ text: string; calls: ChatCompletionMessageToolCall[] }> {
    const reasoningEffort = this.config.reasoningEffort && this.config.reasoningEffort !== 'off'
      ? this.config.reasoningEffort === 'max' ? 'high' : this.config.reasoningEffort
      : undefined

    // Pass the AbortSignal through to the OpenAI client so the underlying
    // fetch is cancelled on /stop — without this we only check `aborted` at
    // chunk boundaries, leaving a slow request open even after the user
    // hit stop.
    const reqOpts: any = this.config.abortSignal ? { signal: this.config.abortSignal } : undefined

    // Build the client + params lazily so a 401 retry can rebuild both with
    // the freshly-refreshed access token. (`this.config.apiKey` is hot-swapped
    // by `refreshOAuthNow()` during the recovery path.)
    const buildParams = (): { client: OpenAI; params: any } => {
      const client = new OpenAI({ apiKey: this.config.apiKey || 'not-needed', baseURL: this.config.baseUrl })
      const params: any = {
        model: this.config.model,
        messages: sanitizeMessagesForChatCompletions([
          { role: 'system', content: this.config.systemPrompt },
          ...messages,
        ]),
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
        stream_options: { include_usage: true },
      }
      if (reasoningEffort) params.reasoning_effort = reasoningEffort
      return { client, params }
    }

    let { client, params } = buildParams()
    let stream: any
    let didRefresh = false
    // Some local inference servers (older Ollama builds, strict llama.cpp
    // shims) reject unknown request fields with HTTP 400. Retry once without
    // the optional extensions so a local model still has a chance.
    //
    // Strict-server tool-call schema failures are NOT auto-retried with
    // a flattened-message replay anymore. We tried that briefly and the
    // resulting "[Called X with Y]" prose got mimicked by the model on
    // the next turn — it started emitting the same syntactic pattern in
    // its output instead of real tool calls, breaking the agent loop in
    // a more confusing way. Surface the error to the user instead; the
    // ErrorBanner offers a Compact-and-retry recovery that drops the
    // tool history cleanly without poisoning future turns.
    //
    // Separately, an OAuth access token may have rotated server-side between
    // our proactive `maybeRefreshOAuth()` and now — covered by a one-shot 401
    // recovery that force-refreshes the token and rebuilds the client.
    while (true) {
      try {
        stream = await client.chat.completions.create(params, reqOpts)
        break
      } catch (err: any) {
        if (!didRefresh && this.isAuthError(err)) {
          const refreshed = await this.refreshOAuthNow()
          if (refreshed) {
            didRefresh = true
            const rebuilt = buildParams()
            client = rebuilt.client
            params = rebuilt.params
            continue
          }
          throw err
        }
        const status = err?.status ?? err?.response?.status
        const msg = String(err?.message ?? '')
        const looksLikeBadRequest =
          status === 400 ||
          /unknown|unsupported|unexpected|invalid|not supported/i.test(msg)
        if (!looksLikeBadRequest) throw err
        const fallback: any = { ...params }
        delete fallback.stream_options
        delete fallback.reasoning_effort
        stream = await client.chat.completions.create(fallback, reqOpts)
        break
      }
    }

    let text = ''
    const callBuffers = new Map<number, { id?: string; name?: string; args: string }>()
    /** Map tool-call id → synthetic index. Used when providers omit tc.index. */
    const idToIndex = new Map<string, number>()
    let nextAutoIndex = 0
    let firstTokenAt = 0
    let lastTokenAt = 0
    let streamCompletionTokens = 0

    // Pick a stable storage index for a tool-call chunk even when providers
    // (notably Ollama and some llama.cpp shims) omit tc.index. Without this,
    // all deltas collapse onto index 0 and multiple tool calls in one turn
    // get their args concatenated together.
    const indexForChunk = (tc: any): number => {
      if (typeof tc.index === 'number') return tc.index
      if (tc.id) {
        const existing = idToIndex.get(tc.id)
        if (existing != null) return existing
        const assigned = nextAutoIndex++
        idToIndex.set(tc.id, assigned)
        return assigned
      }
      return nextAutoIndex++
    }

    // Accumulate arguments, coercing object-form args to a JSON string. Some
    // local servers return the full argument object in one chunk rather than
    // streaming a JSON-delta string; in that case `buf.args += object` would
    // produce "[object Object]" and break parsing.
    const mergeArgs = (buf: { args: string }, raw: unknown) => {
      if (raw == null) return
      if (typeof raw === 'string') { buf.args += raw; return }
      try { buf.args = JSON.stringify(raw) } catch { buf.args = String(raw) }
    }

    for await (const chunk of stream) {
      if (this.config.abortSignal?.aborted) break
      const delta = chunk.choices?.[0]?.delta as any
      if (delta?.content) {
        const now = Date.now()
        if (!firstTokenAt) firstTokenAt = now
        lastTokenAt = now
        text += delta.content
        this.events.onText?.(delta.content)
      }
      // OpenAI-style reasoning chunks (o1/o3/o4) and provider-specific variants
      const reasoning = delta?.reasoning ?? delta?.reasoning_content ?? delta?.thinking
      if (reasoning && typeof reasoning === 'string') {
        this.events.onThinking?.(reasoning)
      } else if (reasoning && typeof reasoning === 'object' && typeof reasoning.content === 'string') {
        this.events.onThinking?.(reasoning.content)
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = indexForChunk(tc)
          const buf = callBuffers.get(idx) ?? { args: '' }
          if (tc.id) buf.id = tc.id
          if (tc.function?.name) buf.name = tc.function.name
          mergeArgs(buf, tc.function?.arguments)
          callBuffers.set(idx, buf)
        }
      }
      // Non-streaming fallback: some local servers (older Ollama builds,
      // certain llama.cpp grammar shims) emit the full assistant turn under
      // `choices[0].message` instead of streaming deltas. Pick those up too.
      const fullMsg = chunk.choices?.[0]?.message as any
      if (fullMsg?.tool_calls && Array.isArray(fullMsg.tool_calls)) {
        for (const tc of fullMsg.tool_calls) {
          if (!tc?.function?.name) continue
          // Skip if we already have this id via the delta path.
          if (tc.id && [...callBuffers.values()].some(b => b.id === tc.id)) continue
          const idx = nextAutoIndex++
          const buf: { id?: string; name?: string; args: string } = { args: '' }
          if (tc.id) buf.id = tc.id
          buf.name = tc.function.name
          mergeArgs(buf, tc.function.arguments)
          callBuffers.set(idx, buf)
        }
      }
      if ((chunk as any).usage) {
        const u = (chunk as any).usage
        this.promptTokens += u.prompt_tokens ?? 0
        this.completionTokens += u.completion_tokens ?? 0
        streamCompletionTokens = u.completion_tokens ?? streamCompletionTokens
        this.events.onUsage?.({ promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 })
      }
    }

    this.recordTokensPerSecond(firstTokenAt, lastTokenAt, streamCompletionTokens, text.length)

    const calls: ChatCompletionMessageToolCall[] = []
    for (const [idx, buf] of [...callBuffers.entries()].sort((a, b) => a[0] - b[0])) {
      if (!buf.name) continue
      calls.push({
        id: buf.id ?? `call_${idx}_${Date.now()}`,
        type: 'function',
        function: { name: buf.name, arguments: buf.args || '{}' },
      })
    }
    return { text, calls }
  }

  private async streamAnthropic(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ): Promise<{ text: string; calls: ChatCompletionMessageToolCall[] }> {
    // OAuth tokens (Claude Pro/Max) need:
    //   - authToken instead of apiKey (Bearer auth, not x-api-key)
    //   - claude-code beta header so the org-create-api-key scope works
    //   - Claude Code identity system prompt so the OAuth scope validates
    // Detection key: the access token always starts with "sk-ant-oat".
    const isAnthropicOAuth = typeof this.config.apiKey === 'string'
      && this.config.apiKey.startsWith('sk-ant-oat')

    // Built lazily so a 401 retry can rebuild against the freshly-refreshed
    // access token (`this.config.apiKey` is hot-swapped by `refreshOAuthNow()`).
    const buildClient = (): Anthropic =>
      isAnthropicOAuth
        ? new Anthropic({
            apiKey: null,
            authToken: this.config.apiKey,
            baseURL: this.config.baseUrl,
            defaultHeaders: {
              'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
              'user-agent': 'claude-cli/2.1.75',
              'x-app': 'cli',
            },
          } as any)
        : new Anthropic({ apiKey: this.config.apiKey, baseURL: this.config.baseUrl })

    const anthropicMessages: Anthropic.Messages.MessageParam[] = []
    for (const m of messages) {
      if (m.role === 'user') {
        // Detect the multi-part content array (text + image_url parts) we
        // emit when the user attached images. Convert image_url parts to
        // Anthropic's `{type:'image', source:{type:'base64',media_type,data}}`
        // — the SDK can take a base64-data-URL as `url`-source too, but
        // splitting it out is cleaner and avoids edge cases on older SDKs.
        if (Array.isArray(m.content)) {
          const blocks: Anthropic.Messages.ContentBlockParam[] = []
          for (const part of m.content as any[]) {
            if (part?.type === 'text' && typeof part.text === 'string') {
              if (part.text) blocks.push({ type: 'text', text: part.text })
            } else if (part?.type === 'image_url' && part.image_url?.url) {
              const url: string = part.image_url.url
              const m1 = url.match(/^data:([^;]+);base64,(.*)$/)
              if (m1) {
                blocks.push({
                  type: 'image',
                  source: { type: 'base64', media_type: m1[1] as any, data: m1[2] },
                })
              } else {
                // Non-data URL — Anthropic supports `url` source on newer SDKs.
                blocks.push({ type: 'image', source: { type: 'url' as any, url } as any })
              }
            }
          }
          if (blocks.length > 0) anthropicMessages.push({ role: 'user', content: blocks })
        } else {
          anthropicMessages.push({
            role: 'user',
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          })
        }
      } else if (m.role === 'assistant') {
        const blocks: Anthropic.Messages.ContentBlockParam[] = []
        if (m.content && typeof m.content === 'string' && m.content.length > 0) {
          blocks.push({ type: 'text', text: m.content })
        }
        const tcs = (m as any).tool_calls as ChatCompletionMessageToolCall[] | undefined
        if (tcs) {
          for (const tc of tcs) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: safeParseJSON(tc.function.arguments || '{}'),
            })
          }
        }
        if (blocks.length > 0) anthropicMessages.push({ role: 'assistant', content: blocks })
      } else if (m.role === 'tool') {
        const toolCallId = (m as any).tool_call_id
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        const last = anthropicMessages[anthropicMessages.length - 1]
        const block: Anthropic.Messages.ContentBlockParam = {
          type: 'tool_result',
          tool_use_id: toolCallId,
          content,
        }
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          (last.content as any[]).push(block)
        } else {
          anthropicMessages.push({ role: 'user', content: [block] })
        }
      }
    }

    const anthropicTools: Anthropic.Messages.Tool[] = tools.map(t => ({
      name: t.function.name,
      description: t.function.description ?? '',
      input_schema: (t.function.parameters as any) ?? { type: 'object', properties: {} },
    }))

    const effort = this.config.reasoningEffort ?? 'off'
    const budget = REASONING_BUDGET[effort] ?? 0

    // Always emit system as a structured array so we can attach `cache_control`.
    // Anthropic's prompt cache (TTL ~5min) drops cost on the system prompt by
    // ~90% across iterations of the same run and across runs that hit the
    // cache — meaningful in heavy multi-turn coding sessions where the system
    // prompt + project rules + skills + repo map can run 2-8K tokens.
    //
    // For OAuth tokens we additionally prefix the Claude Code identity block
    // since Anthropic validates that as part of the OAuth scope.
    const systemBlocks: any[] = isAnthropicOAuth
      ? [
          { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
          { type: 'text', text: this.config.systemPrompt },
        ]
      : [{ type: 'text', text: this.config.systemPrompt }]
    // Mark the last block ephemeral. Cache only kicks in for ≥1024-token
    // blocks; shorter prompts no-op but the request stays valid.
    systemBlocks[systemBlocks.length - 1] = {
      ...systemBlocks[systemBlocks.length - 1],
      cache_control: { type: 'ephemeral' },
    }

    // Cache the last user/tool-result turn too so the kv-cache hit on the
    // assistant decode side stretches across our internal tool-loop iterations.
    // We mutate a shallow copy so we don't pollute the persisted message history.
    const cachedMessages: Anthropic.Messages.MessageParam[] = anthropicMessages.length > 0
      ? [...anthropicMessages.slice(0, -1), markLastBlockCacheable(anthropicMessages[anthropicMessages.length - 1])]
      : anthropicMessages

    const params: any = {
      model: this.config.model,
      max_tokens: budget > 0 ? Math.max(8192, budget + 4096) : 8192,
      system: systemBlocks,
      messages: cachedMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    }
    if (budget > 0) {
      params.thinking = { type: 'enabled', budget_tokens: budget }
    }

    // Hand the abort signal to the SDK so cancelling actually closes the
    // socket. The previous code only checked `aborted` between events, so a
    // network read waiting on `next-token` would block until the next chunk.
    const openStream = () => buildClient().messages.stream(
      params,
      this.config.abortSignal ? { signal: this.config.abortSignal } : undefined,
    )
    let stream = openStream()

    let text = ''
    let toolBuffers = new Map<number, { id: string; name: string; args: string }>()
    let firstTokenAt = 0
    let lastTokenAt = 0
    let streamCompletionTokens = 0
    let didRefresh = false

    while (true) {
      try {
        for await (const event of stream) {
          if (this.config.abortSignal?.aborted) break
          if (event.type === 'content_block_start') {
            const block: any = (event as any).content_block
            if (block?.type === 'tool_use') {
              toolBuffers.set((event as any).index, { id: block.id, name: block.name, args: '' })
            }
          } else if (event.type === 'content_block_delta') {
            const delta: any = (event as any).delta
            if (delta?.type === 'text_delta' && delta.text) {
              const now = Date.now()
              if (!firstTokenAt) firstTokenAt = now
              lastTokenAt = now
              text += delta.text
              this.events.onText?.(delta.text)
            } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              this.events.onThinking?.(delta.thinking)
            } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const buf = toolBuffers.get((event as any).index)
              if (buf) buf.args += delta.partial_json
            }
          } else if (event.type === 'message_delta') {
            const usage: any = (event as any).usage
            if (usage) {
              this.completionTokens += usage.output_tokens ?? 0
              streamCompletionTokens = usage.output_tokens ?? streamCompletionTokens
              this.events.onUsage?.({ promptTokens: 0, completionTokens: usage.output_tokens ?? 0 })
            }
          } else if (event.type === 'message_start') {
            const usage: any = (event as any).message?.usage
            if (usage) {
              this.promptTokens += usage.input_tokens ?? 0
              this.events.onUsage?.({ promptTokens: usage.input_tokens ?? 0, completionTokens: 0 })
            }
          }
        }
        break
      } catch (err: any) {
        // One-shot 401 recovery: only safe before any output was emitted to
        // the renderer. After tokens streamed, a retry would duplicate them.
        const noOutputYet = text === '' && toolBuffers.size === 0
        if (!didRefresh && noOutputYet && this.isAuthError(err)) {
          const refreshed = await this.refreshOAuthNow()
          if (refreshed) {
            didRefresh = true
            stream = openStream()
            // Defensive reset (these should already be empty per the guard).
            text = ''
            toolBuffers = new Map()
            firstTokenAt = 0
            lastTokenAt = 0
            streamCompletionTokens = 0
            continue
          }
        }
        throw err
      }
    }

    this.recordTokensPerSecond(firstTokenAt, lastTokenAt, streamCompletionTokens, text.length)

    const calls: ChatCompletionMessageToolCall[] = []
    for (const [, buf] of toolBuffers) {
      calls.push({
        id: buf.id,
        type: 'function',
        function: { name: buf.name, arguments: buf.args || '{}' },
      })
    }
    return { text, calls }
  }

  /**
   * Record tokens-per-second for the just-finished streaming window.
   * Prefers provider-reported completion tokens; falls back to a ~4-chars/token
   * estimate when the server never sent a usage payload (common on local
   * inference shims).
   */
  private recordTokensPerSecond(
    firstAt: number,
    lastAt: number,
    completionTokens: number,
    textLen: number,
  ): void {
    if (firstAt <= 0 || lastAt <= firstAt) return
    const elapsedSec = (lastAt - firstAt) / 1000
    if (elapsedSec < 0.05) return // too short to be meaningful
    const tokens = completionTokens > 0 ? completionTokens : Math.max(1, Math.round(textLen / 4))
    const tps = tokens / elapsedSec
    if (Number.isFinite(tps) && tps > 0) {
      this.lastTokensPerSecond = tps
      this.emitStats()
    }
  }
}
