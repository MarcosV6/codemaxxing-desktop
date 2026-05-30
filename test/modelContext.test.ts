import { describe, it, expect } from 'vitest'
import {
  getStaticContextWindow,
  isLocalProvider,
  formatContextSize,
} from '../electron/core/modelContext'

describe('isLocalProvider', () => {
  it('treats Anthropic as never-local', () => {
    expect(isLocalProvider('anthropic', 'http://127.0.0.1:1234')).toBe(false)
  })

  it('returns false when no base URL is given', () => {
    expect(isLocalProvider('openai', undefined)).toBe(false)
    expect(isLocalProvider('openai', '')).toBe(false)
  })

  it('flags known cloud endpoints as not-local', () => {
    expect(isLocalProvider('openai', 'https://api.openai.com/v1')).toBe(false)
    expect(isLocalProvider('openai', 'https://openrouter.ai/api/v1')).toBe(false)
    expect(isLocalProvider('openai', 'https://api.githubcopilot.com')).toBe(false)
    expect(isLocalProvider('openai', 'https://generativelanguage.googleapis.com')).toBe(false)
  })

  it('treats loopback and LAN servers as local', () => {
    expect(isLocalProvider('openai', 'http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalProvider('openai', 'http://localhost:11434')).toBe(true)
    expect(isLocalProvider('openai', 'http://192.168.1.50:8080/v1')).toBe(true)
  })

  // Regression: Tailscale (*.ts.net) self-hosted boxes must count as local so
  // the TPS counter / local-warning UI behave. They used to be excluded by a
  // loopback/RFC1918-only allow-list.
  it('treats Tailscale and other self-hosted URLs as local', () => {
    expect(isLocalProvider('openai', 'https://mybox.tailnet-name.ts.net/v1')).toBe(true)
    expect(isLocalProvider('openai', 'http://100.64.0.3:8080')).toBe(true)
    expect(isLocalProvider('openai', 'http://my-server.local:1234')).toBe(true)
  })
})

describe('getStaticContextWindow', () => {
  it('returns null for empty or unknown models', () => {
    expect(getStaticContextWindow('')).toBeNull()
    expect(getStaticContextWindow('totally-made-up-model-9000')).toBeNull()
  })

  it('matches exact model ids', () => {
    expect(getStaticContextWindow('qwen2.5')).toBe(128_000)
    expect(getStaticContextWindow('deepseek-r1')).toBe(64_000)
    expect(getStaticContextWindow('mixtral-8x7b')).toBe(32_000)
    expect(getStaticContextWindow('grok-2')).toBe(131_072)
  })

  it('matches via substring for versioned/suffixed ids', () => {
    // a real LM Studio / Ollama id like "llama-3.1-70b-instruct" should resolve
    expect(getStaticContextWindow('llama-3.1-70b-instruct')).toBe(128_000)
  })

  it('prefers the more specific llama version over the base entry', () => {
    // "llama-3.1" (128k) is listed before "llama-3" (8k); the specific one wins
    expect(getStaticContextWindow('llama-3.1-8b')).toBe(128_000)
    expect(getStaticContextWindow('llama-3')).toBe(8_192)
  })
})

describe('formatContextSize', () => {
  it('formats thousands with a k suffix', () => {
    expect(formatContextSize(999)).toBe('999')
    expect(formatContextSize(128_000)).toBe('128k')
    expect(formatContextSize(200_000)).toBe('200k')
  })

  it('formats millions with one decimal, dropping it past 10M', () => {
    expect(formatContextSize(1_000_000)).toBe('1.0M')
    expect(formatContextSize(2_000_000)).toBe('2.0M')
    expect(formatContextSize(16_000_000)).toBe('16M')
  })
})
