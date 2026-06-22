import type { HardwareProfile, Recommendation, PullProgress, CompareResult } from './index'

export type ApprovalDecision = 'yes' | 'no' | 'always'
export type ApprovalMode = 'suggest' | 'auto-edit' | 'full-auto'
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'
export type MemoryType = 'user' | 'project' | 'feedback' | 'reference' | 'preference' | 'fact'
export type ToolCallStatus = 'pending' | 'running' | 'done' | 'error' | 'denied'

/** A device paired with this Codemaxxing instance, as exposed to the
 *  renderer. The bearer token is intentionally NOT included here — it lives
 *  in main and only travels to the device that originally redeemed the
 *  pairing code. The renderer only needs metadata for the Settings list. */
export interface PairedDeviceSummary {
  id: string
  label: string
  platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'browser' | 'cli' | 'unknown'
  createdAt: number
  lastSeenAt: number | null
}

export interface MemoryRecord {
  id: number
  type: MemoryType
  key: string
  content: string
  scope: string | null
  importance: number
  created_at: string
  updated_at: string
  expires_at: string | null
}

export interface HookRecord {
  id: string
  event: string
  command: string
  toolMatch?: string
  pathMatch?: string
  timeout?: number
  blocking?: boolean
  feedToAgent?: boolean
  enabled?: boolean
  label?: string
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  tags: string[]
  prompt: string
}

export interface CheckpointRecord {
  id: number
  session_id: string
  label: string | null
  message_count: number
  created_at: string
}

export interface BackgroundAgentRecord {
  id: string
  name: string
  cwd: string
  provider: string
  model: string
  prompt: string
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  result: string | null
  error: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
  iterations: number
  prompt_tokens: number
  completion_tokens: number
}

export interface ScheduledTaskRecord {
  id: string
  name: string
  schedule: string
  cwd: string
  provider: string
  model: string
  prompt: string
  enabled: number
  last_run: string | null
  last_status: string | null
  created_at: string
  updated_at: string
}

export interface ToolCallEvent {
  id: string
  name: string
  args: Record<string, unknown>
  status: ToolCallStatus
  result?: string
  diff?: string | null
}

export interface ElectronAPI {
  // System bridge
  openFile: () => Promise<string[]>
  openDirectory: () => Promise<string | null>
  openExternal: (url: string) => Promise<void>
  showItemInFolder: (filePath: string) => Promise<void>
  clipboard: {
    writeText: (text: string) => Promise<boolean>
    readText: () => Promise<string>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
  app: {
    getVersion: () => Promise<string>
    getPlatform: () => Promise<string>
    getPath: (name: string) => Promise<string>
    getHomeDir: () => Promise<string>
  }

  // Sessions
  session: {
    create: (opts: { cwd: string; provider: string; model: string; title?: string; mode?: 'code' | 'chat' }) => Promise<{ ok: boolean; session?: any; error?: string }>
    list: () => Promise<{ ok: boolean; sessions?: any[]; error?: string }>
    get: (id: string) => Promise<{ ok: boolean; session?: any; messages?: any[]; error?: string }>
    delete: (id: string) => Promise<{ ok: boolean }>
    updateTitle: (id: string, title: string) => Promise<{ ok: boolean }>
    updateModel: (id: string, provider: string, model: string) => Promise<{ ok: boolean }>
    updateMode: (id: string, mode: 'code' | 'chat') => Promise<{ ok: boolean }>
    setCwd: (id: string, cwd: string) => Promise<{ ok: boolean; error?: string }>
  }

  // Agent
  agent: {
    send: (opts: { sessionId: string; message: string; images?: Array<{ id?: string; dataUrl: string; mediaType: string; name?: string }> }) => Promise<{ ok: boolean; text?: string; aborted?: boolean; error?: string }>
    abort: (sessionId: string) => Promise<{ ok: boolean; error?: string }>
    approvalResponse: (sessionId: string, callId: string, decision: ApprovalDecision) => Promise<{ ok: boolean; error?: string }>
    askUserResponse: (sessionId: string, askId: string, reply: string) => Promise<{ ok: boolean; error?: string }>

    onStarted: (cb: (data: { sessionId: string; message: string }) => void) => () => void
    onText: (cb: (data: { sessionId: string; delta: string }) => void) => () => void
    onThinking: (cb: (data: { sessionId: string; delta: string }) => void) => () => void
    onIteration: (cb: (data: { sessionId: string; iteration: number }) => void) => () => void
    onToolCall: (cb: (data: { sessionId: string; call: ToolCallEvent }) => void) => () => void
    onTasks: (cb: (data: { sessionId: string; tasks: any[] }) => void) => () => void
    onApprovalRequest: (cb: (data: { sessionId: string; call: { id: string; name: string; args: Record<string, unknown>; diff?: string | null } }) => void) => () => void
    onAskUser: (cb: (data: { sessionId: string; askId: string; question: string; options?: string[] }) => void) => () => void
    onPlanExit: (cb: (data: { sessionId: string; plan: string }) => void) => () => void
    onUsage: (cb: (data: { sessionId: string; usage: { promptTokens: number; completionTokens: number } }) => void) => () => void
    onStats: (cb: (data: { sessionId: string; stats: { tokensPerSecond: number | null; contextWindow: number; isLocal: boolean } }) => void) => () => void
    onDone: (cb: (data: { sessionId: string; text: string; iterations: number; aborted: boolean; usage: { promptTokens: number; completionTokens: number; cost: number }; stats?: { tokensPerSecond: number | null; contextWindow: number; isLocal: boolean } }) => void) => () => void
    onError: (cb: (data: { sessionId: string; error: string }) => void) => () => void
  }

  // Memory (auto-memory store, cross-session)
  memory: {
    list: (type?: MemoryType, scope?: string | null) => Promise<{ ok: boolean; memories?: MemoryRecord[]; error?: string }>
    recall: (query: string, type?: MemoryType, scope?: string | null, limit?: number) => Promise<{ ok: boolean; memories?: MemoryRecord[]; error?: string }>
    remember: (type: MemoryType, key: string, content: string, opts?: { scope?: string | null; importance?: number; expiresAt?: string | null }) => Promise<{ ok: boolean; id?: number; error?: string }>
    forget: (id: number) => Promise<{ ok: boolean }>
    stats: () => Promise<{ ok: boolean; stats?: { total: number; byType: Record<string, number> } }>
  }

  // Hooks
  hooks: {
    list: (cwd?: string) => Promise<{ ok: boolean; hooks?: HookRecord[]; error?: string }>
    saveGlobal: (hooks: HookRecord[]) => Promise<{ ok: boolean }>
  }

  // Git
  git: {
    summary: (cwd: string) => Promise<{ ok: boolean; summary?: { isRepo: boolean; branch?: string; status?: string; staged?: number; modified?: number; untracked?: number }; error?: string }>
    status: (cwd: string) => Promise<{ ok: boolean; status?: string; error?: string }>
    diff: (cwd: string, staged?: boolean) => Promise<{ ok: boolean; diff?: string; error?: string }>
    log: (cwd: string, limit?: number) => Promise<{ ok: boolean; log?: string; error?: string }>
    commit: (cwd: string, message: string, stageAll?: boolean) => Promise<{ ok: boolean; result?: string; error?: string }>
    push: (cwd: string, remote?: string, branch?: string) => Promise<{ ok: boolean; result?: string; error?: string }>
    undo: (cwd: string) => Promise<{ ok: boolean; result?: string; error?: string }>
  }

  // Skills (domain expertise packs)
  skills: {
    list: () => Promise<{ ok: boolean; skills?: SkillRecord[]; error?: string }>
    search: (query: string) => Promise<{ ok: boolean; skills?: SkillRecord[]; error?: string }>
  }

  // Checkpoints (session state snapshots)
  checkpoints: {
    save: (sessionId: string, label?: string) => Promise<{ ok: boolean; id?: number; error?: string }>
    list: (sessionId: string) => Promise<{ ok: boolean; checkpoints?: CheckpointRecord[]; error?: string }>
    restore: (checkpointId: number) => Promise<{ ok: boolean; session_id?: string; messages?: any[]; error?: string }>
    delete: (id: number) => Promise<{ ok: boolean }>
  }

  // Background agents (headless runs)
  bgAgents: {
    list: () => Promise<{ ok: boolean; agents?: BackgroundAgentRecord[]; error?: string }>
    get: (id: string) => Promise<{ ok: boolean; agent?: BackgroundAgentRecord; error?: string }>
    create: (opts: { name: string; cwd: string; provider: string; model: string; prompt: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
    delete: (id: string) => Promise<{ ok: boolean }>
    onText: (cb: (data: { id: string; delta: string }) => void) => () => void
    onToolCall: (cb: (data: { id: string; call: ToolCallEvent }) => void) => () => void
    onUpdate: (cb: (data: { id: string; status: string; text?: string; error?: string }) => void) => () => void
  }

  // Scheduled tasks (cron)
  cron: {
    list: () => Promise<{ ok: boolean; tasks?: ScheduledTaskRecord[]; error?: string }>
    create: (opts: { name: string; schedule: string; cwd: string; provider: string; model: string; prompt: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
    update: (id: string, patch: Partial<Omit<ScheduledTaskRecord, 'id' | 'created_at' | 'updated_at'>>) => Promise<{ ok: boolean }>
    delete: (id: string) => Promise<{ ok: boolean }>
    onFired: (cb: (data: { taskId: string; backgroundAgentId: string }) => void) => () => void
  }

  // Subagent (specialist one-shot runs)
  subagent: {
    run: (opts: { sessionId: string; role: string; task: string; customPrompt?: string; context?: string }) => Promise<{ ok: boolean; result?: { role: string; text: string; iterations: number; promptTokens: number; completionTokens: number; aborted: boolean }; error?: string }>
    onText: (cb: (data: { sessionId: string; delta: string }) => void) => () => void
    onToolCall: (cb: (data: { sessionId: string; call: ToolCallEvent }) => void) => () => void
  }

  // Session ops (compaction)
  sessionOps: {
    compact: (sessionId: string, keepRecent?: number) => Promise<{ ok: boolean; newSessionId?: string; messageCount?: number; error?: string }>
  }

  // MCP
  mcp: {
    approvalResponse: (token: string, decision: boolean) => void
    onStatus: (cb: (data: { name: string; status: string }) => void) => () => void
    onApprovalRequest: (cb: (data: { token: string; name: string; command: string; args?: string[]; env?: Record<string, string> }) => void) => () => void
  }

  // Auth
  auth: {
    list: () => Promise<{ ok: boolean; credentials?: any[]; error?: string }>
    save: (cred: {
      provider: string
      method: 'api-key' | 'oauth' | 'setup-token' | 'cached-token'
      apiKey: string
      baseUrl: string
      label?: string
      createdAt?: string
    }) => Promise<{ ok: boolean }>
    delete: (providerId: string) => Promise<{ ok: boolean }>

    providers: () => Promise<{
      ok: boolean
      providers?: Array<{
        id: string
        name: string
        methods: Array<'oauth' | 'api-key' | 'setup-token' | 'cached-token' | 'device-flow' | 'none'>
        baseUrl: string
        consoleUrl?: string
        description: string
        local?: boolean
      }>
      error?: string
    }>
    detect: () => Promise<{
      ok: boolean
      detected?: Array<{ provider: string; method: string; description: string }>
      error?: string
    }>

    apiKey: (opts: { provider: string; apiKey: string; baseUrl?: string; label?: string }) =>
      Promise<{ ok: boolean; credential?: any; error?: string }>
    openrouterOAuth: () => Promise<{ ok: boolean; credential?: any; error?: string }>
    anthropicOAuth: () => Promise<{ ok: boolean; credential?: any; error?: string }>
    openaiOAuth: () => Promise<{ ok: boolean; credential?: any; error?: string }>
    anthropicSetupToken: () => Promise<{ ok: boolean; credential?: any; error?: string }>
    copilotDeviceFlow: () => Promise<{ ok: boolean; credential?: any; error?: string }>
    importCodex: () => Promise<{ ok: boolean; credential?: any; error?: string }>
    importQwen: () => Promise<{ ok: boolean; credential?: any; error?: string }>

    onStatus: (cb: (data: { provider: string; method: string; message: string }) => void) => () => void
  }

  // LLM
  llm: {
    listModels: (providerId: string) => Promise<{ ok: boolean; models?: Array<{ name: string; id: string }>; error?: string }>
    testConnection: (providerId: string) => Promise<{ ok: boolean; error?: string }>
  }

  // Ollama
  ollama: {
    isRunning: () => Promise<boolean>
    listModels: () => Promise<{ ok: boolean; models?: Array<{ name: string; size: number }>; error?: string }>
  }

  // Cookbook — local model manager (hardware probe + ollama lifecycle)
  cookbook: {
    profile: () => Promise<{ ok: boolean; profile?: HardwareProfile; recommendations?: Recommendation[]; error?: string }>
    ollama: () => Promise<{ ok: boolean; installed?: boolean; running?: boolean; models?: Array<{ name: string; size: number }>; error?: string }>
    pull: (id: string) => Promise<{ ok: boolean; code?: number; error?: string }>
    cancelPull: (id: string) => Promise<{ ok: boolean }>
    onPullProgress: (cb: (p: PullProgress) => void) => () => void
  }

  // Compare — run one prompt across multiple models
  compare: {
    run: (opts: { prompt: string; cwd?: string; entries: Array<{ provider: string; model: string }> }) => Promise<{ ok: boolean; results?: CompareResult[]; error?: string }>
  }

  // Council — best-of-N: run on N models, then a chair critiques + synthesizes
  council: {
    run: (opts: { prompt: string; cwd?: string; entries: Array<{ provider: string; model: string }>; judge?: { provider: string; model: string } }) => Promise<{ ok: boolean; candidates?: CompareResult[]; verdict?: { provider: string; model: string; text: string }; error?: string }>
    onProgress: (cb: (p: { stage: string }) => void) => () => void
  }

  // Deep Research — plan → web search → read → synthesize a cited report
  research: {
    run: (opts: { sessionId?: string; provider?: string; model?: string; cwd?: string; query: string }) => Promise<{ ok: boolean; report?: string; promptTokens?: number; completionTokens?: number; error?: string }>
    onProgress: (cb: (e: { kind: 'text' | 'tool'; delta?: string; call?: ToolCallEvent }) => void) => () => void
  }

  // Preview — agent surfaces a URL in the Preview panel (capture is main-side)
  preview: {
    onOpen: (cb: (url: string) => void) => () => void
  }

  // Built-in browser — agent drives the same <webview> the user sees
  browser: {
    onCommand: (
      cb: (cmd: { id: string; action: 'navigate' | 'read' | 'screenshot' | 'click'; url?: string; selector?: string; text?: string }) => void,
    ) => () => void
    onOpen: (cb: () => void) => () => void
    sendResult: (id: string, result: { ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }) => void
    ready: () => void
    closed: () => void
  }

  // Notes & Tasks — JSON-backed quick capture
  notes: {
    get: () => Promise<{ ok: boolean; notes: Array<{ id: string; text: string; createdAt: number }>; tasks: Array<{ id: string; text: string; done: boolean; createdAt: number }> }>
    addNote: (text: string) => Promise<{ ok: boolean; note?: { id: string; text: string; createdAt: number }; error?: string }>
    deleteNote: (id: string) => Promise<{ ok: boolean }>
    addTask: (text: string) => Promise<{ ok: boolean; task?: { id: string; text: string; done: boolean; createdAt: number }; error?: string }>
    toggleTask: (id: string) => Promise<{ ok: boolean }>
    deleteTask: (id: string) => Promise<{ ok: boolean }>
    onChanged: (cb: () => void) => () => void
  }

  // Documents — JSON-backed, AI-assisted editor
  documents: {
    list: () => Promise<{ ok: boolean; documents: Array<{ id: string; title: string; content: string; updatedAt: number }> }>
    save: (doc: { id?: string; title: string; content: string }) => Promise<{ ok: boolean; doc?: { id: string; title: string; content: string; updatedAt: number }; error?: string }>
    delete: (id: string) => Promise<{ ok: boolean }>
    assist: (opts: { sessionId?: string; content: string; instruction: string }) => Promise<{ ok: boolean; content?: string; error?: string }>
    // Tell main which doc (+ live editor content) is open, so the agent's
    // document_* tools default to it. And reload when the agent edits.
    setActive: (ctx: { id: string | null; title: string; content: string }) => void
    onChanged: (cb: () => void) => () => void
  }

  // Email — IMAP fetch + SMTP send
  email: {
    getAccount: () => Promise<{ ok: boolean; account: { email: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number; passwordSet: boolean } | null }>
    saveAccount: (a: { email: string; password?: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }) => Promise<{ ok: boolean }>
    list: (opts?: { limit?: number }) => Promise<{ ok: boolean; messages?: Array<{ uid: number; from: string; fromName: string; subject: string; date: number; seen: boolean }>; error?: string }>
    get: (uid: number) => Promise<{ ok: boolean; message?: { uid: number; from: string; to: string; subject: string; date: number; text: string }; error?: string }>
    send: (opts: { to: string; subject: string; text: string }) => Promise<{ ok: boolean; error?: string }>
    setActive: (ctx: { uid?: number; from?: string; to?: string; subject?: string; text?: string } | null) => void
  }

  // Calendar — CalDAV
  calendar: {
    getAccount: () => Promise<{ ok: boolean; account: { url: string; username: string; passwordSet: boolean } | null }>
    saveAccount: (a: { url: string; username: string; password?: string }) => Promise<{ ok: boolean }>
    events: (opts?: { start?: number; end?: number }) => Promise<{ ok: boolean; events?: Array<{ summary: string; start: number; end: number; location: string; calendar: string }>; error?: string }>
    setEvents: (events: Array<{ summary: string; start: number; end: number; location: string }>) => void
    onChanged: (cb: () => void) => () => void
  }

  // Config
  config: {
    get: () => Promise<{ ok: boolean; config?: { theme: string; autoApprove: boolean; approvalMode?: ApprovalMode; reasoningEffort?: ReasoningEffort; activeSkillIds?: string[]; lastCwd: string | null; lastProvider: string | null; lastModel: string | null; keepAliveInBackground?: boolean; autoLaunch?: boolean; remote?: { enabled: boolean; port: number; devices?: PairedDeviceSummary[] }; autoCompactEnabled?: boolean; autoCompactThreshold?: number }; error?: string }>
    save: (config: { theme: string; autoApprove: boolean; approvalMode?: ApprovalMode; reasoningEffort?: ReasoningEffort; activeSkillIds?: string[]; lastCwd: string | null; lastProvider: string | null; lastModel: string | null; keepAliveInBackground?: boolean; autoLaunch?: boolean; remote?: { enabled: boolean; port: number; devices?: PairedDeviceSummary[] }; autoCompactEnabled?: boolean; autoCompactThreshold?: number }) => Promise<{ ok: boolean }>
  }

  // Remote access — HTTP+SSE server for phone clients / external tools
  remote: {
    status: () => Promise<{ ok: boolean; enabled: boolean; running: boolean; port: number; devices: PairedDeviceSummary[]; addresses: string[] }>
    setEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
    setPort: (port: number) => Promise<{ ok: boolean; error?: string }>
    beginPairing: () => Promise<{ ok: boolean; code?: string; expiresAt?: number; pairUrl?: string; pairingUri?: string; ttlSeconds?: number; error?: string }>
    cancelPairing: () => Promise<{ ok: boolean }>
    revokeDevice: (deviceId: string) => Promise<{ ok: boolean; error?: string }>
    onDevicesChanged: (cb: () => void) => (() => void)
  }

  // Themes
  themes: {
    list: () => Promise<{ ok: boolean; themes?: any[]; error?: string }>
  }

  // Project / cwd
  project: {
    pickDirectory: () => Promise<{ ok: boolean; path?: string; name?: string }>
    defaultCwd: () => Promise<string>
  }

  // File search / tree / read (for @-mentions, command palette, Files panel)
  files: {
    search: (opts: { cwd: string; query: string; limit?: number }) => Promise<{
      ok: boolean
      files?: Array<{ path: string; name: string; dir: boolean; ext: string }>
      truncated?: boolean
      error?: string
    }>
    tree: (opts: { path: string }) => Promise<{
      ok: boolean
      entries?: Array<{ name: string; path: string; dir: boolean; size: number; hidden: boolean }>
      error?: string
    }>
    read: (opts: { path: string; maxBytes?: number }) => Promise<{
      ok: boolean
      binary?: boolean
      size?: number
      ext?: string
      truncated?: boolean
      mtime?: number
      content?: string
      error?: string
    }>
    write: (opts: { path: string; cwd: string; content: string; expectedMtime?: number; force?: boolean }) => Promise<{
      ok: boolean
      mtime?: number
      size?: number
      conflict?: boolean
      currentMtime?: number
      currentContent?: string
      truncated?: boolean
      error?: string
    }>
    getPathForFile: (file: File) => string
  }

  // Preview — run arbitrary commands, stream output
  run: {
    start: (opts: { runId: string; command: string; cwd: string }) => Promise<{ ok: boolean; pid?: number; error?: string }>
    stop: (runId: string) => Promise<{ ok: boolean; error?: string }>
    onStarted: (cb: (data: { runId: string; pid?: number }) => void) => () => void
    onOutput: (cb: (data: { runId: string; kind: 'stdout' | 'stderr'; data: string }) => void) => () => void
    onExit: (cb: (data: { runId: string; code: number | null; signal: string | null }) => void) => () => void
  }

  // Legacy escape hatch
  on: (channel: string, callback: (...args: any[]) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
