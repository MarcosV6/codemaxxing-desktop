import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { CodingAgent, type AgentConfig, type AgentEvents } from './agent.js'

export type SubagentRole = 'frontend' | 'backend' | 'tests' | 'docs' | 'reviewer' | 'researcher' | 'custom'

const ROLE_PROMPTS: Record<Exclude<SubagentRole, 'custom'>, string> = {
  frontend:
    'You are a frontend specialist subagent. Focus on UI/UX, React/TypeScript, accessibility, and component structure. Run tight: read only what you need, edit precisely, report back a short summary with file paths and line numbers. No tangential refactors.',
  backend:
    'You are a backend specialist subagent. Focus on APIs, data models, error handling, and service wiring. Run tight: explore the specific module, make the minimal change, verify with tests if present, and report back what changed.',
  tests:
    'You are a test engineering subagent. Write or repair tests that catch real bugs — unit, integration, e2e as appropriate. Keep fixtures tight. Report new test files and the failure modes they cover.',
  docs:
    'You are a documentation subagent. Write clear, concise docs tailored to the audience. No filler. Start with why, then how, then reference. Return paths to changed doc files.',
  reviewer:
    'You are a code reviewer subagent. Read the diff or the target file carefully. Flag correctness, security, and readability issues. Do NOT edit code — only report findings with file:line references and a short severity label.',
  researcher:
    'You are a research subagent. Explore the codebase or the web to answer the user question. Summarize findings with concrete paths, symbols, or URLs. Do not make code changes.',
}

export interface SubagentSpec {
  role: SubagentRole
  task: string
  customPrompt?: string
  /** Optional extra context seeded before the task (e.g. a file excerpt). */
  context?: string
}

export interface SubagentResult {
  role: SubagentRole
  text: string
  iterations: number
  promptTokens: number
  completionTokens: number
  aborted: boolean
}

/** Spawn a child CodingAgent with a role-scoped system prompt. Returns its final text. */
export async function runSubagent(
  spec: SubagentSpec,
  parentConfig: Omit<AgentConfig, 'systemPrompt' | 'messages'>,
  parentSystemPrompt: string,
  events: AgentEvents = {},
): Promise<SubagentResult> {
  const rolePrompt = spec.role === 'custom'
    ? (spec.customPrompt || 'You are a specialist subagent.')
    : ROLE_PROMPTS[spec.role]

  const systemPrompt = [
    parentSystemPrompt,
    '',
    '--- Subagent role ---',
    rolePrompt,
    '',
    'IMPORTANT: You are a subagent. Do one focused job, then stop. Do not spawn more subagents.',
  ].join('\n')

  const messages: ChatCompletionMessageParam[] = []
  if (spec.context) {
    messages.push({ role: 'user', content: `Context:\n${spec.context}` })
    messages.push({ role: 'assistant', content: 'Acknowledged. Ready for task.' })
  }

  const agent = new CodingAgent(
    { ...parentConfig, systemPrompt, messages, approvalMode: 'auto-edit' },
    events,
  )
  const result = await agent.run(spec.task)
  return {
    role: spec.role,
    text: result.text,
    iterations: result.iterations,
    promptTokens: result.totalPromptTokens,
    completionTokens: result.totalCompletionTokens,
    aborted: result.aborted,
  }
}
