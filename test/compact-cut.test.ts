import { describe, it, expect, vi } from 'vitest'

// agent.ts transitively pulls better-sqlite3 (electron-ABI) via tools/memory.
vi.mock('better-sqlite3', () => ({ default: class MockDatabase {} }))

import { cleanCompactCut } from '../electron/core/agent'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const user = (c = 'u'): ChatCompletionMessageParam => ({ role: 'user', content: c })
const asst = (c = 'a'): ChatCompletionMessageParam => ({ role: 'assistant', content: c })
const asstTools = (): ChatCompletionMessageParam => ({
  role: 'assistant', content: null,
  tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
})
const tool = (): ChatCompletionMessageParam => ({ role: 'tool', tool_call_id: 'call_1', content: 'result' })

describe('cleanCompactCut', () => {
  it('keeps a plain boundary unchanged', () => {
    const msgs = [user(), asst(), user(), asst(), user(), asst()]
    expect(cleanCompactCut(msgs, 2)).toBe(4) // tail = [user, asst]
  })

  it('slides FORWARD past orphaned tool replies at the boundary', () => {
    // cut at length-3 would start the tail on a tool reply whose tool_calls
    // partner is on the summarized side — providers reject that.
    const msgs = [user(), asst(), asstTools(), tool(), tool(), asst('final')]
    const cut = cleanCompactCut(msgs, 3) // naive cut = 3 → lands on tool()
    expect(cut).toBe(5) // tail starts at the final assistant text
    expect(msgs[cut].role).not.toBe('tool')
  })

  it('slides BACKWARD to the owning assistant when the whole tail is tool replies', () => {
    const msgs = [user(), asstTools(), tool(), tool()]
    const cut = cleanCompactCut(msgs, 2) // naive cut = 2 → tail all tools; forward empties
    expect(cut).toBe(1) // includes the assistant that owns the tool calls
    expect(msgs[cut].role).toBe('assistant')
  })

  it('clamps when keepRecent exceeds history', () => {
    const msgs = [user(), asst()]
    expect(cleanCompactCut(msgs, 10)).toBe(0)
  })
})
