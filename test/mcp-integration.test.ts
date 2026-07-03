import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Real end-to-end MCP check: spawns @modelcontextprotocol/server-everything
// over stdio through OUR client module and exercises connect → list → call →
// reconnect-dedupe → disconnect. Needs network for the first npx fetch, so
// it's opt-in:  MCP_IT=1 npx vitest run test/mcp-integration.test.ts
import {
  connectToServers,
  getAllMCPTools,
  callMCPTool,
  parseMCPToolName,
  disconnectAll,
} from '../electron/core/mcp'

const enabled = !!process.env.MCP_IT

describe.skipIf(!enabled)('MCP end-to-end (real stdio server)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmx-mcp-'))
  mkdirSync(join(dir, '.codemaxxing'), { recursive: true })
  writeFileSync(
    join(dir, '.codemaxxing', 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        everything: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] },
      },
    }),
  )

  afterAll(async () => {
    await disconnectAll()
    rmSync(dir, { recursive: true, force: true })
  })

  it('connects, lists tools, survives reconnect without duplicating, and round-trips a call', async () => {
    const statuses: string[] = []
    const servers = await connectToServers(dir, {
      approve: async () => true, // project config is untrusted → approval path
      onStatus: (name, status) => statuses.push(`${name}: ${status}`),
    })
    expect(servers.length).toBe(1)
    expect(servers[0].tools.length).toBeGreaterThan(0)
    expect(statuses.some((s) => s.startsWith('everything: connected'))).toBe(true)

    // The regression that mattered: a second connect (i.e. the next agent
    // message) must REUSE the server, not spawn a duplicate.
    const again = await connectToServers(dir, { approve: async () => true })
    expect(again.length).toBe(1)

    // Tool names round-trip through the namespacing.
    const tools = getAllMCPTools()
    expect(tools.length).toBe(servers[0].tools.length) // no duplicates
    const echoTool = tools.find((t) => {
      const p = parseMCPToolName(t.function.name)
      return p?.serverName === 'everything' && p?.toolName === 'echo'
    })
    expect(echoTool).toBeTruthy()

    // Actual tool call through the same path the agent uses.
    const result = await callMCPTool('everything', 'echo', { message: 'unity-ready' })
    expect(result).toContain('unity-ready')
  }, 120_000)
})
