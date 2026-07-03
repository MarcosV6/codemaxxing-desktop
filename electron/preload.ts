import { contextBridge, ipcRenderer, webUtils } from 'electron'

type Unsubscribe = () => void
function on<T extends any[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const handler = (_: any, ...args: T) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('electron', {
  // ── System bridge ──
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
    readText: () => ipcRenderer.invoke('clipboard:readText'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
    getHomeDir: () => ipcRenderer.invoke('app:getHomeDir'),
  },

  // ── Sessions ──
  session: {
    create: (opts: { cwd: string; provider: string; model: string; title?: string; mode?: 'code' | 'chat' | 'browser' }) =>
      ipcRenderer.invoke('session:create', opts),
    list: () => ipcRenderer.invoke('session:list'),
    get: (id: string) => ipcRenderer.invoke('session:get', id),
    delete: (id: string) => ipcRenderer.invoke('session:delete', id),
    updateTitle: (id: string, title: string) => ipcRenderer.invoke('session:updateTitle', id, title),
    updateModel: (id: string, provider: string, model: string) =>
      ipcRenderer.invoke('session:updateModel', id, provider, model),
    updateMode: (id: string, mode: 'code' | 'chat') =>
      ipcRenderer.invoke('session:updateMode', id, mode),
    setCwd: (id: string, cwd: string) => ipcRenderer.invoke('session:setCwd', id, cwd),
  },

  // ── Agent ──
  agent: {
    send: (opts: { sessionId: string; message: string; images?: Array<{ id?: string; dataUrl: string; mediaType: string; name?: string }>; activeSurfaces?: string[] }) => ipcRenderer.invoke('agent:send', opts),
    abort: (sessionId: string) => ipcRenderer.invoke('agent:abort', sessionId),
    approvalResponse: (sessionId: string, callId: string, decision: 'yes' | 'no' | 'always') =>
      ipcRenderer.invoke('agent:approvalResponse', sessionId, callId, decision),
    askUserResponse: (sessionId: string, askId: string, reply: string) =>
      ipcRenderer.invoke('agent:askUserResponse', sessionId, askId, reply),

    onStarted: (cb: (data: { sessionId: string; message: string }) => void) => on('agent:started', cb),
    onText: (cb: (data: { sessionId: string; delta: string }) => void) => on('agent:text', cb),
    onThinking: (cb: (data: { sessionId: string; delta: string }) => void) => on('agent:thinking', cb),
    onIteration: (cb: (data: { sessionId: string; iteration: number }) => void) => on('agent:iteration', cb),
    onToolCall: (
      cb: (data: {
        sessionId: string
        call: {
          id: string
          name: string
          args: Record<string, unknown>
          status: 'pending' | 'running' | 'done' | 'error' | 'denied'
          result?: string
          diff?: string | null
        }
      }) => void,
    ) => on('agent:toolCall', cb),
    onTasks: (cb: (data: { sessionId: string; tasks: any[] }) => void) => on('agent:tasks', cb),
    onApprovalRequest: (
      cb: (data: {
        sessionId: string
        call: { id: string; name: string; args: Record<string, unknown>; diff?: string | null }
      }) => void,
    ) => on('agent:approvalRequest', cb),
    onAskUser: (
      cb: (data: { sessionId: string; askId: string; question: string; options?: string[] }) => void,
    ) => on('agent:askUser', cb),
    onPlanExit: (cb: (data: { sessionId: string; plan: string }) => void) => on('agent:planExit', cb),
    onUsage: (cb: (data: { sessionId: string; usage: { promptTokens: number; completionTokens: number } }) => void) =>
      on('agent:usage', cb),
    onStats: (
      cb: (data: {
        sessionId: string
        stats: { tokensPerSecond: number | null; contextWindow: number; isLocal: boolean }
      }) => void,
    ) => on('agent:stats', cb),
    onDone: (
      cb: (data: {
        sessionId: string
        text: string
        iterations: number
        aborted: boolean
        usage: { promptTokens: number; completionTokens: number; cost: number }
        stats?: { tokensPerSecond: number | null; contextWindow: number; isLocal: boolean }
      }) => void,
    ) => on('agent:done', cb),
    onError: (cb: (data: { sessionId: string; error: string }) => void) => on('agent:error', cb),
  },

  // ── Memory ──
  memory: {
    list: (type?: string, scope?: string | null) => ipcRenderer.invoke('memory:list', type, scope),
    recall: (query: string, type?: string, scope?: string | null, limit?: number) =>
      ipcRenderer.invoke('memory:recall', query, type, scope, limit),
    remember: (type: string, key: string, content: string, opts?: { scope?: string | null; importance?: number; expiresAt?: string | null }) =>
      ipcRenderer.invoke('memory:remember', type, key, content, opts),
    forget: (id: number) => ipcRenderer.invoke('memory:forget', id),
    stats: () => ipcRenderer.invoke('memory:stats'),
  },

  // ── Hooks ──
  hooks: {
    list: (cwd?: string) => ipcRenderer.invoke('hooks:list', cwd),
    saveGlobal: (hooks: any[]) => ipcRenderer.invoke('hooks:saveGlobal', hooks),
  },

  // ── Git ──
  git: {
    summary: (cwd: string) => ipcRenderer.invoke('git:summary', cwd),
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, staged?: boolean) => ipcRenderer.invoke('git:diff', cwd, staged),
    log: (cwd: string, limit?: number) => ipcRenderer.invoke('git:log', cwd, limit),
    commit: (cwd: string, message: string, stageAll?: boolean) => ipcRenderer.invoke('git:commit', cwd, message, stageAll),
    push: (cwd: string, remote?: string, branch?: string) => ipcRenderer.invoke('git:push', cwd, remote, branch),
    undo: (cwd: string) => ipcRenderer.invoke('git:undo', cwd),
  },

  // ── Skills ──
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    search: (query: string) => ipcRenderer.invoke('skills:search', query),
  },

  // ── Checkpoints ──
  checkpoints: {
    save: (sessionId: string, label?: string) => ipcRenderer.invoke('checkpoints:save', sessionId, label),
    list: (sessionId: string) => ipcRenderer.invoke('checkpoints:list', sessionId),
    restore: (checkpointId: number) => ipcRenderer.invoke('checkpoints:restore', checkpointId),
    delete: (id: number) => ipcRenderer.invoke('checkpoints:delete', id),
  },

  // ── Background agents ──
  bgAgents: {
    list: () => ipcRenderer.invoke('bgAgents:list'),
    get: (id: string) => ipcRenderer.invoke('bgAgents:get', id),
    create: (opts: { name: string; cwd: string; provider: string; model: string; prompt: string }) =>
      ipcRenderer.invoke('bgAgents:create', opts),
    delete: (id: string) => ipcRenderer.invoke('bgAgents:delete', id),
    onText: (cb: (data: { id: string; delta: string }) => void) => on('bgAgents:text', cb),
    onToolCall: (cb: (data: { id: string; call: any }) => void) => on('bgAgents:toolCall', cb),
    onUpdate: (cb: (data: { id: string; status: string; text?: string; error?: string }) => void) => on('bgAgents:update', cb),
  },

  // ── Scheduled tasks ──
  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    create: (opts: { name: string; schedule: string; cwd: string; provider: string; model: string; prompt: string }) =>
      ipcRenderer.invoke('cron:create', opts),
    update: (id: string, patch: any) => ipcRenderer.invoke('cron:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('cron:delete', id),
    onFired: (cb: (data: { taskId: string; backgroundAgentId: string }) => void) => on('cron:fired', cb),
  },

  // ── Subagent ──
  subagent: {
    run: (opts: { sessionId: string; role: string; task: string; customPrompt?: string; context?: string }) =>
      ipcRenderer.invoke('subagent:run', opts),
    onText: (cb: (data: { sessionId: string; delta: string }) => void) => on('subagent:text', cb),
    onToolCall: (cb: (data: { sessionId: string; call: any }) => void) => on('subagent:toolCall', cb),
  },

  // ── Session compaction ──
  sessionOps: {
    compact: (sessionId: string, keepRecent?: number) => ipcRenderer.invoke('session:compact', sessionId, keepRecent),
  },

  // ── MCP ──
  mcp: {
    approvalResponse: (token: string, decision: boolean) =>
      ipcRenderer.send('mcp:approvalResponse', token, decision),
    onStatus: (cb: (data: { name: string; status: string }) => void) => on('mcp:status', cb),
    onApprovalRequest: (
      cb: (data: { token: string; name: string; command: string; args?: string[]; env?: Record<string, string> }) => void,
    ) => on('mcp:approvalRequest', cb),
  },

  // ── Auth / credentials ──
  auth: {
    list: () => ipcRenderer.invoke('auth:list'),
    save: (cred: {
      provider: string
      method: 'api-key' | 'oauth' | 'setup-token' | 'cached-token'
      apiKey: string
      baseUrl: string
      label?: string
      createdAt?: string
    }) => ipcRenderer.invoke('auth:save', cred),
    delete: (providerId: string) => ipcRenderer.invoke('auth:delete', providerId),

    providers: () => ipcRenderer.invoke('auth:providers'),
    detect: () => ipcRenderer.invoke('auth:detect'),

    apiKey: (opts: { provider: string; apiKey: string; baseUrl?: string; label?: string }) =>
      ipcRenderer.invoke('auth:apiKey', opts),
    openrouterOAuth: () => ipcRenderer.invoke('auth:openrouterOAuth'),
    anthropicOAuth: () => ipcRenderer.invoke('auth:anthropicOAuth'),
    openaiOAuth: () => ipcRenderer.invoke('auth:openaiOAuth'),
    anthropicSetupToken: () => ipcRenderer.invoke('auth:anthropicSetupToken'),
    copilotDeviceFlow: () => ipcRenderer.invoke('auth:copilotDeviceFlow'),
    importCodex: () => ipcRenderer.invoke('auth:importCodex'),
    importQwen: () => ipcRenderer.invoke('auth:importQwen'),

    onStatus: (cb: (data: { provider: string; method: string; message: string }) => void) =>
      on('auth:status', cb),
  },

  // ── LLM / provider ──
  llm: {
    listModels: (providerId: string) => ipcRenderer.invoke('llm:listModels', providerId),
    testConnection: (providerId: string) => ipcRenderer.invoke('llm:testConnection', providerId),
  },

  // ── Ollama ──
  ollama: {
    isRunning: () => ipcRenderer.invoke('ollama:isRunning'),
    listModels: () => ipcRenderer.invoke('ollama:listModels'),
  },

  // ── Cookbook (local model manager) ──
  cookbook: {
    profile: () => ipcRenderer.invoke('cookbook:profile'),
    ollama: () => ipcRenderer.invoke('cookbook:ollama'),
    pull: (id: string) => ipcRenderer.invoke('cookbook:pull', id),
    cancelPull: (id: string) => ipcRenderer.invoke('cookbook:cancelPull', id),
    onPullProgress: (cb: (p: { id: string; status: string; percent?: number; done?: boolean; ok?: boolean }) => void) =>
      on('cookbook:pullProgress', cb),
  },

  // ── Compare (side-by-side model eval) ──
  compare: {
    run: (opts: { prompt: string; cwd?: string; entries: Array<{ provider: string; model: string }> }) =>
      ipcRenderer.invoke('compare:run', opts),
  },

  // ── Council (best-of-N: run on N models, then a chair synthesizes one answer) ──
  council: {
    run: (opts: { prompt: string; cwd?: string; entries: Array<{ provider: string; model: string }>; judge?: { provider: string; model: string } }) =>
      ipcRenderer.invoke('council:run', opts),
    onProgress: (cb: (p: { stage: string }) => void) => on('council:progress', cb),
  },

  // ── Deep Research ──
  research: {
    run: (opts: { sessionId?: string; provider?: string; model?: string; cwd?: string; query: string }) =>
      ipcRenderer.invoke('research:run', opts),
    onProgress: (cb: (e: { kind: 'text' | 'tool'; delta?: string; call?: any }) => void) =>
      on('research:progress', cb),
  },

  // ── Preview (agent opens a URL; screenshot capture is main-side) ──
  preview: {
    onOpen: (cb: (url: string) => void) => on('preview:open', cb),
  },

  // ── Built-in browser (agent drives the same <webview> the user sees) ──
  browser: {
    // main → renderer: the agent issued a command; drive the webview + reply.
    onCommand: (
      cb: (cmd: { id: string; action: 'navigate' | 'read' | 'screenshot' | 'click' | 'type' | 'scroll'; url?: string; selector?: string; text?: string; submit?: boolean; direction?: string }) => void,
    ) => on('browser:command', cb),
    // main → renderer: open/focus the Browser tab (idempotent).
    onOpen: (cb: () => void) => on('browser:open', cb),
    // renderer → main: result for a command, plus readiness lifecycle.
    sendResult: (id: string, result: { ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }) =>
      ipcRenderer.send('browser:result', id, result),
    ready: () => ipcRenderer.send('browser:ready'),
    closed: () => ipcRenderer.send('browser:closed'),
  },

  // ── Notes & Tasks ──
  notes: {
    get: () => ipcRenderer.invoke('notes:get'),
    addNote: (text: string) => ipcRenderer.invoke('notes:addNote', text),
    deleteNote: (id: string) => ipcRenderer.invoke('notes:deleteNote', id),
    addTask: (text: string) => ipcRenderer.invoke('notes:addTask', text),
    toggleTask: (id: string) => ipcRenderer.invoke('notes:toggleTask', id),
    deleteTask: (id: string) => ipcRenderer.invoke('notes:deleteTask', id),
    onChanged: (cb: () => void) => on('notes:changed', cb),
  },

  // ── Documents ──
  documents: {
    list: () => ipcRenderer.invoke('documents:list'),
    save: (doc: { id?: string; title: string; content: string }) => ipcRenderer.invoke('documents:save', doc),
    delete: (id: string) => ipcRenderer.invoke('documents:delete', id),
    assist: (opts: { sessionId?: string; content: string; instruction: string }) => ipcRenderer.invoke('documents:assist', opts),
    setActive: (ctx: { id: string | null; title: string; content: string }) => ipcRenderer.send('documents:setActive', ctx),
    onChanged: (cb: () => void) => on('documents:changed', cb),
  },

  // ── Email ──
  email: {
    getAccount: () => ipcRenderer.invoke('email:getAccount'),
    saveAccount: (a: { email: string; password?: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }) => ipcRenderer.invoke('email:saveAccount', a),
    list: (opts?: { limit?: number }) => ipcRenderer.invoke('email:list', opts),
    get: (uid: number) => ipcRenderer.invoke('email:get', uid),
    send: (opts: { to: string; subject: string; text: string }) => ipcRenderer.invoke('email:send', opts),
    setActive: (ctx: { uid?: number; from?: string; to?: string; subject?: string; text?: string } | null) => ipcRenderer.send('email:setActive', ctx),
  },

  // ── Calendar ──
  calendar: {
    getAccount: () => ipcRenderer.invoke('calendar:getAccount'),
    saveAccount: (a: { url: string; username: string; password?: string }) => ipcRenderer.invoke('calendar:saveAccount', a),
    events: (opts?: { start?: number; end?: number }) => ipcRenderer.invoke('calendar:events', opts),
    setEvents: (events: Array<{ summary: string; start: number; end: number; location: string }>) => ipcRenderer.send('calendar:setEvents', events),
    onChanged: (cb: () => void) => on('calendar:changed', cb),
  },

  // ── Config ──
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (config: {
      theme: string
      autoApprove: boolean
      approvalMode?: 'suggest' | 'auto-edit' | 'full-auto'
      reasoningEffort?: 'off' | 'low' | 'medium' | 'high' | 'max'
      activeSkillIds?: string[]
      lastCwd: string | null
      lastProvider: string | null
      lastModel: string | null
      keepAliveInBackground?: boolean
      autoLaunch?: boolean
      remote?: { enabled: boolean; port: number; token: string }
      autoCompactEnabled?: boolean
      autoCompactThreshold?: number
    }) => ipcRenderer.invoke('config:save', config),
  },

  // ── Remote access (HTTP+SSE server for phone clients / external tools) ──
  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('remote:setEnabled', enabled),
    setPort: (port: number) => ipcRenderer.invoke('remote:setPort', port),
    beginPairing: () => ipcRenderer.invoke('remote:beginPairing'),
    cancelPairing: () => ipcRenderer.invoke('remote:cancelPairing'),
    revokeDevice: (deviceId: string) => ipcRenderer.invoke('remote:revokeDevice', deviceId),
    onDevicesChanged: (cb: () => void) => {
      const fn = () => cb()
      ipcRenderer.on('remote:devicesChanged', fn)
      return () => ipcRenderer.removeListener('remote:devicesChanged', fn)
    },
  },

  // ── Themes ──
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
  },

  // ── Project / cwd ──
  project: {
    pickDirectory: () => ipcRenderer.invoke('project:pickDirectory'),
    defaultCwd: () => ipcRenderer.invoke('project:defaultCwd'),
  },

  // ── File search / tree / read (for @-mentions, command palette, Files panel) ──
  files: {
    search: (opts: { cwd: string; query: string; limit?: number }) =>
      ipcRenderer.invoke('files:search', opts),
    tree: (opts: { path: string }) => ipcRenderer.invoke('files:tree', opts),
    read: (opts: { path: string; maxBytes?: number }) => ipcRenderer.invoke('files:read', opts),
    write: (opts: { path: string; cwd: string; content: string; expectedMtime?: number; force?: boolean }) =>
      ipcRenderer.invoke('files:write', opts),
    // Resolve an absolute path from a dragged File — Electron 32+ no longer
    // exposes File.path directly in the renderer, so we use webUtils.
    getPathForFile: (file: File) => {
      try { return webUtils.getPathForFile(file) } catch { return '' }
    },
  },

  // ── Preview: run arbitrary commands and stream output ──
  run: {
    start: (opts: { runId: string; command: string; cwd: string }) =>
      ipcRenderer.invoke('run:start', opts) as Promise<{ ok: boolean; pid?: number; error?: string }>,
    stop: (runId: string) =>
      ipcRenderer.invoke('run:stop', runId) as Promise<{ ok: boolean; error?: string }>,
    onStarted: (cb: (data: { runId: string; pid?: number }) => void) => on('run:started', cb),
    onOutput: (cb: (data: { runId: string; kind: 'stdout' | 'stderr'; data: string }) => void) =>
      on('run:output', cb),
    onExit: (cb: (data: { runId: string; code: number | null; signal: string | null }) => void) =>
      on('run:exit', cb),
  },

  // ── Low-level escape hatch (legacy) ──
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
})

export type ElectronAPI = typeof window.electron
