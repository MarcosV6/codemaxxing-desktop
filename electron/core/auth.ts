import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes, createHash } from 'crypto'
import { execSync, exec } from 'child_process'
import { shell, safeStorage } from 'electron'

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const AUTH_PATH = join(CONFIG_DIR, 'auth.json')

// ── Types ──
export interface AuthCredential {
  provider: string
  method: 'api-key' | 'oauth' | 'setup-token' | 'cached-token'
  apiKey: string
  baseUrl: string
  label?: string
  expiresAt?: string
  refreshToken?: string
  oauthExpires?: number
  createdAt: string
}

interface AuthFile {
  version: 1
  credentials: AuthCredential[]
}

export interface ProviderDef {
  id: string
  name: string
  methods: Array<'oauth' | 'api-key' | 'setup-token' | 'cached-token' | 'device-flow' | 'none'>
  baseUrl: string
  consoleUrl?: string
  description: string
  local?: boolean
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    methods: ['oauth', 'api-key'],
    baseUrl: 'https://openrouter.ai/api/v1',
    consoleUrl: 'https://openrouter.ai/keys',
    description: '200+ models (Claude, GPT, Gemini, Llama, etc.) — one login',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    methods: ['oauth', 'setup-token', 'api-key'],
    baseUrl: 'https://api.anthropic.com',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude Opus, Sonnet, Haiku — log in with Claude Pro/Max or API key',
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT)',
    methods: ['oauth', 'cached-token', 'api-key'],
    baseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
    description: 'GPT-4o, GPT-5, o1 — log in with ChatGPT Plus/Pro or API key',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    methods: ['cached-token', 'api-key'],
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    consoleUrl: 'https://dashscope.console.aliyun.com/apiKey',
    description: 'Qwen 3.5, Qwen Coder — import from Qwen CLI or API key',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    methods: ['api-key'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    consoleUrl: 'https://aistudio.google.com/apikey',
    description: 'Gemini 2.5, Gemini Flash',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    methods: ['device-flow'],
    baseUrl: 'https://api.githubcopilot.com',
    description: 'Use your GitHub Copilot subscription',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    methods: ['none'],
    // 127.0.0.1, not localhost — Node prefers ::1 but Ollama binds IPv4-only.
    baseUrl: 'http://127.0.0.1:11434/v1',
    description: 'Local models via Ollama — auto-detected',
    local: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    methods: ['none'],
    // 127.0.0.1, not localhost — Node prefers ::1 but LM Studio binds IPv4-only.
    baseUrl: 'http://127.0.0.1:1234/v1',
    description: 'Local models via LM Studio — auto-detected',
    local: true,
  },
  {
    id: 'custom',
    name: 'Custom Provider',
    methods: ['api-key'],
    baseUrl: '',
    description: 'Any OpenAI-compatible API endpoint',
  },
]

// ── File store ──
function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
}

/** True when the OS provides an encryption backend (Keychain on macOS, DPAPI on
 *  Windows, libsecret on Linux). When false (e.g. headless Linux), we fall back
 *  to 0600 plaintext rather than refusing to store credentials at all. */
function canEncrypt(): boolean {
  try { return safeStorage.isEncryptionAvailable() } catch { return false }
}

/** Encrypt a single secret string to a tagged token for at-rest storage. Used
 *  for secondary secrets (e.g. email/CalDAV passwords) outside the main store. */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (!canEncrypt()) return 'plain:' + plain
  try { return 'enc:' + safeStorage.encryptString(plain).toString('base64') } catch { return 'plain:' + plain }
}

/** Inverse of encryptSecret; transparently handles legacy unprefixed plaintext. */
export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) } catch { return '' }
  }
  if (stored.startsWith('plain:')) return stored.slice(6)
  return stored
}

function read(): AuthFile {
  ensureDir()
  if (!existsSync(AUTH_PATH)) return { version: 1, credentials: [] }
  try {
    const parsed = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'))
    // v2: the whole credential blob is encrypted with safeStorage.
    if (parsed && typeof parsed.enc === 'string') {
      const json = safeStorage.decryptString(Buffer.from(parsed.enc, 'base64'))
      const data = JSON.parse(json)
      if (data && Array.isArray(data.credentials)) return { version: 1, credentials: data.credentials }
      return { version: 1, credentials: [] }
    }
    // v1: legacy plaintext — return it, and migrate to encrypted in place.
    if (parsed && Array.isArray(parsed.credentials)) {
      const creds = parsed.credentials as AuthCredential[]
      if (canEncrypt()) {
        try {
          // One-time safety net: with ad-hoc signing, a re-signed build can be
          // denied Keychain access (user clicks "Deny" on the prompt), which
          // would make the encrypted store unreadable. Keep the pre-migration
          // plaintext as .legacy (0600) so keys are recoverable; users can
          // delete it once the encrypted store is confirmed working.
          const backup = AUTH_PATH + '.legacy'
          if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(parsed, null, 2), { mode: 0o600 })
          write({ version: 1, credentials: creds })
        } catch { /* migration is best-effort */ }
      }
      return { version: 1, credentials: creds }
    }
  } catch { /* unreadable / decrypt failed → treat as empty */ }
  return { version: 1, credentials: [] }
}

function write(data: AuthFile) {
  ensureDir()
  const plaintext = JSON.stringify({ version: 1, credentials: data.credentials })
  const fileContent = canEncrypt()
    ? JSON.stringify({ version: 2, enc: safeStorage.encryptString(plaintext).toString('base64') }, null, 2)
    : JSON.stringify({ version: 1, credentials: data.credentials }, null, 2)
  const tmp = AUTH_PATH + '.tmp-' + process.pid + '-' + Date.now()
  writeFileSync(tmp, fileContent, { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* best-effort */ }
  renameSync(tmp, AUTH_PATH)
  try { chmodSync(AUTH_PATH, 0o600) } catch { /* best-effort */ }
}

export function getCredentials(): AuthCredential[] {
  return read().credentials
}

export function getCredential(providerId: string): AuthCredential | undefined {
  return read().credentials.find(c => c.provider === providerId)
}

export function saveCredential(cred: AuthCredential): void {
  const data = read()
  const idx = data.credentials.findIndex(c => c.provider === cred.provider)
  if (idx >= 0) data.credentials[idx] = cred
  else data.credentials.push(cred)
  write(data)
}

export function deleteCredential(providerId: string): boolean {
  const data = read()
  const idx = data.credentials.findIndex(c => c.provider === providerId)
  if (idx < 0) return false
  data.credentials.splice(idx, 1)
  write(data)
  return true
}

export function scrubSecrets(msg: string): string {
  if (!msg) return msg
  const creds = read().credentials
  let out = msg
  for (const c of creds) {
    if (c.apiKey && c.apiKey.length > 8) out = out.split(c.apiKey).join('[REDACTED]')
    if (c.refreshToken && c.refreshToken.length > 8) out = out.split(c.refreshToken).join('[REDACTED]')
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'Bearer [REDACTED]')
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]')
  out = out.replace(/ghp_[A-Za-z0-9]{20,}/g, 'ghp_[REDACTED]')
  out = out.replace(/gho_[A-Za-z0-9]{20,}/g, 'gho_[REDACTED]')
  return out
}

// ── Manual API key ──
export function saveApiKey(providerId: string, apiKey: string, baseUrl?: string, label?: string): AuthCredential {
  const def = PROVIDERS.find(p => p.id === providerId)
  const cred: AuthCredential = {
    provider: providerId,
    method: 'api-key',
    apiKey,
    baseUrl: baseUrl ?? def?.baseUrl ?? '',
    label: label ?? def?.name ?? providerId,
    createdAt: new Date().toISOString(),
  }
  saveCredential(cred)
  return cred
}

// ── OpenRouter OAuth PKCE ──
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export async function openRouterOAuth(onStatus?: (msg: string) => void): Promise<AuthCredential> {
  const { verifier, challenge } = generatePKCE()
  return new Promise((resolve, reject) => {
    let handled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/callback' || handled) return
      handled = true
      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end('<h1>Error: No code received</h1>')
        if (timeoutId) clearTimeout(timeoutId)
        server.close()
        reject(new Error('No authorization code received'))
        return
      }
      onStatus?.('Exchanging code for API key...')
      try {
        const exRes = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        })
        if (!exRes.ok) {
          const errText = await exRes.text()
          throw new Error(`Exchange failed (${exRes.status}): ${errText}`)
        }
        const data = (await exRes.json()) as { key: string }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body style="font-family:-apple-system,system-ui,sans-serif;background:#1a1814;color:#d4bd8a;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>💪 Authenticated!</h1><p>You can close this tab and return to codemaxxing.</p></div></body></html>`)
        if (timeoutId) clearTimeout(timeoutId)
        server.close()
        const cred: AuthCredential = {
          provider: 'openrouter',
          method: 'oauth',
          apiKey: data.key,
          baseUrl: 'https://openrouter.ai/api/v1',
          label: 'OpenRouter (OAuth)',
          createdAt: new Date().toISOString(),
        }
        saveCredential(cred)
        resolve(cred)
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end(`<h1>Error</h1><p>${err.message}</p>`)
        if (timeoutId) clearTimeout(timeoutId)
        server.close()
        reject(err)
      }
    })

    server.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(new Error(`OAuth callback server failed: ${err.message}`))
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start callback server'))
        return
      }
      const port = addr.port
      const callbackUrl = `http://localhost:${port}/callback`
      const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`
      onStatus?.('Opening browser for OpenRouter login...')
      void shell.openExternal(authUrl)
      onStatus?.('Waiting for authorization...')
      timeoutId = setTimeout(() => {
        if (!handled) {
          server.close()
          reject(new Error('OAuth timed out after 5 minutes'))
        }
      }, 5 * 60 * 1000)
    })
  })
}

// ── Anthropic Setup Token (via Claude Code CLI) ──
export function detectClaudeCLI(): boolean {
  try {
    execSync(process.platform === 'win32' ? 'where claude' : 'which claude', { stdio: 'pipe', timeout: 2000 })
    return true
  } catch { return false }
}

export async function anthropicSetupToken(onStatus?: (msg: string) => void): Promise<AuthCredential> {
  if (!detectClaudeCLI()) {
    throw new Error(
      "Claude Code CLI not found. Install it first: curl -fsSL https://claude.ai/install.sh | bash — then run 'claude setup-token'.",
    )
  }
  onStatus?.("Running 'claude setup-token'...")
  onStatus?.('A browser window will open — log in with your Anthropic account.')
  return new Promise((resolve, reject) => {
    const child = exec('claude setup-token', { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`setup-token failed: ${stderr || err.message}`))
        return
      }
      const token = (stdout || '').trim()
      if (!token) {
        reject(new Error('No token received from claude setup-token'))
        return
      }
      const cred: AuthCredential = {
        provider: 'anthropic',
        method: 'setup-token',
        apiKey: token,
        baseUrl: 'https://api.anthropic.com',
        label: 'Anthropic (Claude subscription)',
        createdAt: new Date().toISOString(),
      }
      saveCredential(cred)
      resolve(cred)
    })
    child.stdout?.on('data', (data) => {
      const text = data.toString().trim()
      if (text) onStatus?.(text)
    })
  })
}

// ── OpenAI / Codex CLI Cached Token ──
export function detectCodexToken(): string | null {
  const locations = [
    join(homedir(), '.codex', 'auth.json'),
    join(homedir(), '.config', 'codex', 'auth.json'),
    join(homedir(), '.codex-cli', 'auth.json'),
  ]
  for (const loc of locations) {
    if (!existsSync(loc)) continue
    try {
      const data = JSON.parse(readFileSync(loc, 'utf-8'))
      if (data.api_key) return data.api_key
      if (data.access_token) return data.access_token
      if (data.token) return data.token
    } catch { /* continue */ }
  }
  if (process.platform === 'darwin') {
    const queries = [
      ['security', 'find-generic-password', '-s', 'codex', '-w'],
      ['security', 'find-generic-password', '-a', 'openai', '-s', 'codex', '-w'],
      ['security', 'find-generic-password', '-s', 'openai-codex', '-w'],
      ['security', 'find-generic-password', '-l', 'codex', '-w'],
    ]
    for (const args of queries) {
      try {
        const token = execSync(args.join(' '), { stdio: 'pipe', timeout: 1000 }).toString().trim()
        if (token) return token
      } catch { /* continue */ }
    }
  }
  const envKey = process.env.OPENAI_API_KEY
  if (envKey && envKey.startsWith('eyJ')) return envKey
  return null
}

export function importCodexToken(onStatus?: (msg: string) => void): AuthCredential | null {
  const token = detectCodexToken()
  if (!token) return null
  onStatus?.('Found existing Codex CLI credentials — importing...')
  const cred: AuthCredential = {
    provider: 'openai',
    method: 'cached-token',
    apiKey: token,
    baseUrl: 'https://api.openai.com/v1',
    label: 'OpenAI (from Codex CLI)',
    createdAt: new Date().toISOString(),
  }
  saveCredential(cred)
  return cred
}

// ── Qwen CLI Cached Credentials ──
export function detectQwenToken(): string | null {
  if (process.env.DASHSCOPE_API_KEY) return process.env.DASHSCOPE_API_KEY
  const dashscopeKey = join(homedir(), '.dashscope', 'api_key')
  if (existsSync(dashscopeKey)) {
    try {
      const key = readFileSync(dashscopeKey, 'utf-8').trim()
      if (key) return key
    } catch { /* ignore */ }
  }
  const dashscopeCreds = join(homedir(), '.dashscope', 'credentials')
  if (existsSync(dashscopeCreds)) {
    try {
      const content = readFileSync(dashscopeCreds, 'utf-8')
      const match = content.match(/api_key\s*=\s*(.+)/)
      if (match?.[1]?.trim()) return match[1].trim()
    } catch { /* ignore */ }
  }
  const qwenConfig = join(homedir(), '.qwen', 'config.json')
  if (existsSync(qwenConfig)) {
    try {
      const data = JSON.parse(readFileSync(qwenConfig, 'utf-8'))
      if (data.api_key) return data.api_key
      if (data.access_token) return data.access_token
    } catch { /* ignore */ }
  }
  const qwenAuth = join(homedir(), '.qwen', 'oauth_creds.json')
  if (existsSync(qwenAuth)) {
    try {
      const data = JSON.parse(readFileSync(qwenAuth, 'utf-8'))
      if (data.access_token) return data.access_token
      if (data.token) return data.token
      if (data.api_key) return data.api_key
    } catch { /* ignore */ }
  }
  return null
}

export function importQwenToken(onStatus?: (msg: string) => void): AuthCredential | null {
  const token = detectQwenToken()
  if (!token) return null
  onStatus?.('Found existing Qwen CLI credentials — importing...')
  const cred: AuthCredential = {
    provider: 'qwen',
    method: 'cached-token',
    apiKey: token,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    label: 'Qwen (from Qwen CLI)',
    createdAt: new Date().toISOString(),
  }
  saveCredential(cred)
  return cred
}

// ── GitHub Copilot Device Flow ──
async function exchangeCopilotToken(githubToken: string): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/json',
      'User-Agent': 'codemaxxing-mac/1.0',
    },
  })
  if (!res.ok) {
    const errText = await res.text()
    if (res.status === 401) throw new Error('GitHub token is invalid or expired.')
    if (res.status === 403) throw new Error('Your GitHub account does not have an active Copilot subscription.')
    throw new Error(`Copilot token exchange failed (${res.status}): ${errText}`)
  }
  const data = (await res.json()) as { token: string; expires_at: number }
  return { token: data.token, expiresAt: data.expires_at * 1000 }
}

export async function copilotDeviceFlow(onStatus?: (msg: string) => void): Promise<AuthCredential> {
  onStatus?.('Starting GitHub Copilot device flow...')
  const deviceRes = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: 'Iv1.b507a08c87ecfe98' }),
  })
  if (!deviceRes.ok) throw new Error(`Device code request failed: ${deviceRes.status}`)
  const deviceData = (await deviceRes.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }
  onStatus?.(`Go to: ${deviceData.verification_uri}`)
  onStatus?.(`Enter code: ${deviceData.user_code}`)
  void shell.openExternal(deviceData.verification_uri)

  let pollInterval = (deviceData.interval || 5) * 1000
  const expiresAt = Date.now() + deviceData.expires_in * 1000
  onStatus?.('Waiting for authorization...')

  while (Date.now() < expiresAt) {
    await new Promise(r => setTimeout(r, pollInterval))
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: 'Iv1.b507a08c87ecfe98',
        device_code: deviceData.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string }
    if (tokenData.access_token) {
      onStatus?.('Exchanging GitHub token for Copilot API access...')
      const copilotToken = await exchangeCopilotToken(tokenData.access_token)
      const cred: AuthCredential = {
        provider: 'copilot',
        method: 'oauth',
        apiKey: copilotToken.token,
        baseUrl: 'https://api.githubcopilot.com',
        label: 'GitHub Copilot',
        refreshToken: tokenData.access_token,
        oauthExpires: copilotToken.expiresAt,
        createdAt: new Date().toISOString(),
      }
      saveCredential(cred)
      return cred
    }
    if (tokenData.error === 'authorization_pending') continue
    if (tokenData.error === 'slow_down') { pollInterval += 5000; continue }
    throw new Error(`Authorization failed: ${tokenData.error}`)
  }
  throw new Error('Device flow timed out')
}

// ── Auto-detect available flows ──
export interface DetectedAuth {
  provider: string
  method: string
  description: string
}

export function detectAvailableAuth(): DetectedAuth[] {
  const available: DetectedAuth[] = []
  if (detectClaudeCLI()) {
    available.push({
      provider: 'anthropic',
      method: 'setup-token',
      description: 'Claude Code CLI detected — link your Anthropic subscription',
    })
  }
  if (detectCodexToken()) {
    available.push({
      provider: 'openai',
      method: 'cached-token',
      description: 'Codex CLI credentials found — import your ChatGPT subscription',
    })
  }
  if (detectQwenToken()) {
    available.push({
      provider: 'qwen',
      method: 'cached-token',
      description: 'Qwen CLI credentials found — import your Qwen access',
    })
  }
  return available
}
