import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

export interface MCPServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

export interface ConnectedServer {
  name: string
  /** Config-identity hash — a changed command/args/env means reconnect. */
  hash: string
  client: Client
  transport: StdioClientTransport
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>
}

const GLOBAL_DIR = join(homedir(), '.codemaxxing-mac')
const GLOBAL_CONFIG_PATH = join(GLOBAL_DIR, 'mcp.json')
const APPROVALS_PATH = join(GLOBAL_DIR, 'mcp-approvals.json')

function projectConfigPaths(cwd: string): string[] {
  return [join(cwd, '.codemaxxing', 'mcp.json'), join(cwd, '.cursor', 'mcp.json')]
}

function loadConfigFile(path: string): MCPConfig | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    if (parsed?.mcpServers && typeof parsed.mcpServers === 'object') return parsed as MCPConfig
  } catch { /* ignore */ }
  return null
}

export function loadMCPConfigWithSources(cwd: string): {
  servers: Record<string, { config: MCPServerConfig; trusted: boolean }>
} {
  const result: Record<string, { config: MCPServerConfig; trusted: boolean }> = {}
  const global = loadConfigFile(GLOBAL_CONFIG_PATH)
  if (global) for (const [n, c] of Object.entries(global.mcpServers)) result[n] = { config: c, trusted: true }
  for (const p of projectConfigPaths(cwd)) {
    const cfg = loadConfigFile(p)
    if (cfg) for (const [n, c] of Object.entries(cfg.mcpServers)) result[n] = { config: c, trusted: false }
  }
  return { servers: result }
}

function hashServer(cwd: string, name: string, cfg: MCPServerConfig): string {
  return createHash('sha256')
    .update(JSON.stringify({ cwd, name, command: cfg.command, args: cfg.args ?? [], env: cfg.env ?? {} }))
    .digest('hex')
    .slice(0, 32)
}

interface Approvals { version: 1; approvals: Record<string, { cwd: string; serverName: string; approvedAt: string }> }

function loadApprovals(): Approvals {
  if (!existsSync(APPROVALS_PATH)) return { version: 1, approvals: {} }
  try {
    const p = JSON.parse(readFileSync(APPROVALS_PATH, 'utf-8'))
    if (p?.version === 1 && p.approvals) return p as Approvals
  } catch { /* ignore */ }
  return { version: 1, approvals: {} }
}

function saveApprovals(a: Approvals): void {
  if (!existsSync(GLOBAL_DIR)) mkdirSync(GLOBAL_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(APPROVALS_PATH, JSON.stringify(a, null, 2), 'utf-8')
}

export function isServerApproved(cwd: string, name: string, cfg: MCPServerConfig): boolean {
  return !!loadApprovals().approvals[hashServer(cwd, name, cfg)]
}

export function approveServer(cwd: string, name: string, cfg: MCPServerConfig): void {
  const a = loadApprovals()
  a.approvals[hashServer(cwd, name, cfg)] = { cwd, serverName: name, approvedAt: new Date().toISOString() }
  saveApprovals(a)
}

const connected: ConnectedServer[] = []

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ])
}

/**
 * Connect every configured server. Idempotent — called before each agent run,
 * so already-connected servers with an unchanged config are REUSED, not
 * respawned (respawning would leak a child process per message and duplicate
 * every tool in the payload). A changed config disconnects the old instance
 * and reconnects fresh.
 */
export async function connectToServers(
  cwd: string,
  opts: {
    onStatus?: (name: string, status: string) => void
    approve?: (name: string, cfg: MCPServerConfig) => Promise<boolean>
  } = {},
): Promise<ConnectedServer[]> {
  const { servers } = loadMCPConfigWithSources(cwd)
  for (const [name, { config, trusted }] of Object.entries(servers)) {
    const hash = hashServer(cwd, name, config)
    const existing = connected.find((s) => s.name === name)
    if (existing) {
      if (existing.hash === hash) {
        opts.onStatus?.(name, `connected (${existing.tools.length} tools)`)
        continue
      }
      // Config changed — tear down the old instance before reconnecting.
      try { await existing.client.close() } catch { /* ignore */ }
      connected.splice(connected.indexOf(existing), 1)
    }

    if (!trusted && !isServerApproved(cwd, name, config)) {
      opts.onStatus?.(name, 'awaiting-approval')
      if (!opts.approve) continue
      const ok = await opts.approve(name, config)
      if (!ok) { opts.onStatus?.(name, 'denied'); continue }
      approveServer(cwd, name, config)
    }

    // Windows: `npx` / `uvx` / `uv` etc. are .cmd shims that child_process
    // can't spawn directly ("spawn npx ENOENT") — route through cmd.exe.
    // Absolute .exe paths spawn fine as-is.
    let command = config.command
    let args = config.args ?? []
    if (process.platform === 'win32' && !/\.exe$/i.test(command)) {
      args = ['/c', command, ...args]
      command = 'cmd.exe'
    }

    let transport: StdioClientTransport | null = null
    try {
      opts.onStatus?.(name, 'connecting')
      transport = new StdioClientTransport({
        command,
        args,
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      })
      const client = new Client({ name: 'codemaxxing-mac', version: '1.0.0' }, { capabilities: {} })
      // Timeouts: a bad command or a server stuck resolving dependencies
      // (uvx/npx cold start) must not hang the agent run forever. Generous
      // because first runs may download packages.
      await withTimeout(client.connect(transport), 60_000, `connecting to "${name}"`)
      const toolList = await withTimeout(client.listTools(), 20_000, `listing tools from "${name}"`)
      const tools = (toolList.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      }))
      connected.push({ name, hash, client, transport, tools })
      opts.onStatus?.(name, `connected (${tools.length} tools)`)
    } catch (e: any) {
      // Kill the spawned child so a timed-out/hung server doesn't linger.
      try { await transport?.close() } catch { /* ignore */ }
      opts.onStatus?.(name, `error: ${e?.message ?? String(e)}`)
    }
  }
  return connected
}

export async function disconnectAll(): Promise<void> {
  for (const s of connected) {
    try { await s.client.close() } catch { /* ignore */ }
  }
  connected.length = 0
}

export function getConnectedServers(): ConnectedServer[] { return [...connected] }

function encode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url')
}
function decode(s: string): string {
  try { return Buffer.from(s, 'base64url').toString('utf-8') } catch { return s }
}

export function parseMCPToolName(full: string): { serverName: string; toolName: string } | null {
  if (!full.startsWith('mcp_')) return null
  const rest = full.slice(4)
  const sep = rest.indexOf('__')
  if (sep < 0) return null
  return { serverName: decode(rest.slice(0, sep)), toolName: decode(rest.slice(sep + 2)) }
}

export function getAllMCPTools(servers: ConnectedServer[] = connected): ChatCompletionTool[] {
  const tools: ChatCompletionTool[] = []
  for (const s of servers) {
    for (const t of s.tools) {
      tools.push({
        type: 'function',
        function: {
          name: `mcp_${encode(s.name)}__${encode(t.name)}`,
          description: `[${s.name}] ${t.description ?? t.name}`,
          parameters: (t.inputSchema as any) ?? { type: 'object', properties: {} },
        },
      })
    }
  }
  return tools
}

export async function callMCPTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const server = connected.find(s => s.name === serverName)
  if (!server) return `Error: MCP server not connected: ${serverName}`
  try {
    const result = await server.client.callTool({ name: toolName, arguments: args })
    const parts = (result.content ?? []) as Array<{ type: string; text?: string }>
    return parts.map(p => (p.type === 'text' ? p.text ?? '' : JSON.stringify(p))).join('\n') || '(no output)'
  } catch (e: any) {
    return `MCP tool error (${serverName}/${toolName}): ${e?.message ?? String(e)}`
  }
}
