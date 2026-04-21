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

const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'notebook_edit'])
const SHELL_TOOLS = new Set(['run_command', 'run_background_command', 'kill_bash'])
const GIT_WRITE_TOOLS = new Set(['git_commit'])
/** Read-only tools that can be parallelized. */
const PARALLELIZABLE_TOOLS = new Set([
  'read_file', 'list_files', 'search_files', 'glob', 'web_fetch', 'web_search', 'view_image', 'think',
  'recall', 'git_status', 'git_diff', 'git_log', 'bash_output',
])
const MAX_ITERATIONS = 25

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
}

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
}

export interface RunResult {
  text: string
  messages: ChatCompletionMessageParam[] // full updated message array
  iterations: number
  aborted: boolean
  totalPromptTokens: number
  totalCompletionTokens: number
}

function toolMessage(callId: string, content: string): ChatCompletionMessageParam {
  return { role: 'tool', tool_call_id: callId, content } as any
}

function safeParseJSON(s: string): Record<string, unknown> {
  if (!s || s.trim() === '') return {}
  try { return JSON.parse(s) } catch {
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')) } catch { return { __parseError: true, __raw: s } }
  }
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

  constructor(config: AgentConfig, events: AgentEvents) {
    this.config = config
    this.events = events
    this.approvalMode = deriveApprovalMode(config)
  }

  async run(userMessage: string): Promise<RunResult> {
    const messages: ChatCompletionMessageParam[] = [...this.config.messages]
    messages.push({ role: 'user', content: userMessage })

    const allTools = [...FILE_TOOLS, ...getAllMCPTools()]

    let iterations = 0
    let finalText = ''
    let aborted = false

    while (iterations < MAX_ITERATIONS) {
      iterations++
      this.events.onIteration?.(iterations)

      if (this.config.abortSignal?.aborted) { aborted = true; break }

      let assistantText = ''
      let toolCalls: ChatCompletionMessageToolCall[] = []

      if (this.config.provider === 'anthropic') {
        const { text, calls } = await this.streamAnthropic(messages, allTools)
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

    return {
      text: finalText,
      messages,
      iterations,
      aborted,
      totalPromptTokens: this.promptTokens,
      totalCompletionTokens: this.completionTokens,
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

  private async streamOpenAI(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
  ): Promise<{ text: string; calls: ChatCompletionMessageToolCall[] }> {
    const client = new OpenAI({ apiKey: this.config.apiKey || 'not-needed', baseURL: this.config.baseUrl })
    const reasoningEffort = this.config.reasoningEffort && this.config.reasoningEffort !== 'off'
      ? this.config.reasoningEffort === 'max' ? 'high' : this.config.reasoningEffort
      : undefined

    const params: any = {
      model: this.config.model,
      messages: [{ role: 'system', content: this.config.systemPrompt }, ...messages],
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
    }
    if (reasoningEffort) params.reasoning_effort = reasoningEffort

    const stream: any = await client.chat.completions.create(params)

    let text = ''
    const callBuffers = new Map<number, { id?: string; name?: string; args: string }>()

    for await (const chunk of stream) {
      if (this.config.abortSignal?.aborted) break
      const delta = chunk.choices?.[0]?.delta as any
      if (delta?.content) {
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
          const idx = tc.index ?? 0
          const buf = callBuffers.get(idx) ?? { args: '' }
          if (tc.id) buf.id = tc.id
          if (tc.function?.name) buf.name = tc.function.name
          if (tc.function?.arguments) buf.args += tc.function.arguments
          callBuffers.set(idx, buf)
        }
      }
      if ((chunk as any).usage) {
        const u = (chunk as any).usage
        this.promptTokens += u.prompt_tokens ?? 0
        this.completionTokens += u.completion_tokens ?? 0
        this.events.onUsage?.({ promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0 })
      }
    }

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
    const client = new Anthropic({ apiKey: this.config.apiKey, baseURL: this.config.baseUrl })

    const anthropicMessages: Anthropic.Messages.MessageParam[] = []
    for (const m of messages) {
      if (m.role === 'user') {
        anthropicMessages.push({
          role: 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })
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
    const params: any = {
      model: this.config.model,
      max_tokens: budget > 0 ? Math.max(8192, budget + 4096) : 8192,
      system: this.config.systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    }
    if (budget > 0) {
      params.thinking = { type: 'enabled', budget_tokens: budget }
    }

    const stream = client.messages.stream(params)

    let text = ''
    const toolBuffers = new Map<number, { id: string; name: string; args: string }>()

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
}
