import { create } from 'zustand'
import type {
  ChatMessage,
  Session,
  Theme,
  ToolCallRecord,
  PendingApproval,
  PendingMCPApproval,
  AuthCredentialDisplay,
  Task,
} from '../types'
import type {
  ApprovalMode,
  ReasoningEffort,
  SkillRecord,
  HookRecord,
  CheckpointRecord,
  BackgroundAgentRecord,
  ScheduledTaskRecord,
} from '../types/electron'

export type AuthMethod = 'oauth' | 'api-key' | 'setup-token' | 'cached-token' | 'device-flow' | 'none'

interface ProviderInfo {
  id: string
  name: string
  description: string
  methods: AuthMethod[]
  baseUrl: string
  consoleUrl?: string
  authed: boolean
  local?: boolean
}

interface DetectedAuth {
  provider: string
  method: string
  description: string
}

interface ModelInfo {
  name: string
  id: string
}

interface AppConfig {
  theme: string
  autoApprove: boolean
  approvalMode: ApprovalMode
  reasoningEffort: ReasoningEffort
  activeSkillIds: string[]
  lastCwd: string | null
  lastProvider: string | null
  lastModel: string | null
}

interface SessionMeta {
  id: string
  title: string | null
  cwd: string
  provider: string
  model: string
  created_at: string
  updated_at: string
  message_count: number
  prompt_tokens: number
  completion_tokens: number
  estimated_cost: number
}

export interface PendingAsk {
  sessionId: string
  askId: string
  question: string
  options?: string[]
}

export interface PendingPlan {
  sessionId: string
  plan: string
}

export type DrawerKind = 'checkpoints' | 'bg-agents' | 'cron' | null

interface AppState {
  // ── Lifecycle ──
  initialized: boolean
  loading: boolean

  // ── Config ──
  appConfig: AppConfig

  // ── Providers / models / credentials ──
  providers: ProviderInfo[]
  credentials: AuthCredentialDisplay[]
  availableModels: ModelInfo[]
  detectedAuth: DetectedAuth[]

  // ── Sessions ──
  sessionList: SessionMeta[]
  activeSessionId: string | null
  activeSession: Session | null

  // ── Live run state ──
  isRunning: boolean
  currentAssistantText: string
  currentThinkingText: string
  currentToolCalls: ToolCallRecord[]
  currentIteration: number
  currentUsage: { promptTokens: number; completionTokens: number } | null
  currentTasks: Task[]

  // ── Approvals / asks / plans ──
  pendingApproval: PendingApproval | null
  pendingMCPApproval: PendingMCPApproval | null
  pendingAsk: PendingAsk | null
  pendingPlan: PendingPlan | null

  // ── Cross-session data ──
  skills: SkillRecord[]
  hooks: HookRecord[]
  checkpoints: CheckpointRecord[]
  bgAgentList: BackgroundAgentRecord[]
  cronTasks: ScheduledTaskRecord[]

  // ── Themes ──
  themes: Theme[]
  activeTheme: Theme | null

  // ── UI state ──
  settingsOpen: boolean
  previewOpen: boolean
  activeDrawer: DrawerKind

  // ── Actions ──
  init: () => Promise<void>
  refreshProvidersAndCredentials: () => Promise<void>
  loadThemes: () => Promise<void>
  applyTheme: (theme: Theme) => void
  setTheme: (themeKey: string) => Promise<void>
  setAutoApprove: (value: boolean) => Promise<void>
  setApprovalMode: (mode: ApprovalMode) => Promise<void>
  setReasoningEffort: (effort: ReasoningEffort) => Promise<void>
  setActiveSkillIds: (ids: string[]) => Promise<void>
  setLastCwd: (cwd: string) => Promise<void>

  loadModels: (providerId: string) => Promise<void>
  saveCredential: (cred: { provider: string; apiKey: string; baseUrl: string; label?: string }) => Promise<void>
  deleteCredential: (providerId: string) => Promise<void>

  runAuthFlow: (provider: string, method: AuthMethod) => Promise<{ ok: boolean; error?: string }>
  authFlowStatus: { provider: string; method: string; messages: string[] } | null
  clearAuthFlowStatus: () => void

  loadSessions: () => Promise<void>
  createSession: (opts: { cwd: string; provider: string; model: string; title?: string }) => Promise<string | null>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  updateSessionCwd: (sessionId: string, cwd: string) => Promise<void>
  updateSessionModel: (sessionId: string, provider: string, model: string) => Promise<void>

  sendMessage: (message: string) => Promise<void>
  abortCurrent: () => Promise<void>
  respondToApproval: (decision: 'yes' | 'no' | 'always') => Promise<void>
  respondToMCPApproval: (decision: boolean) => void
  respondToAsk: (reply: string) => Promise<void>
  dismissPlan: () => void

  // Cross-session data loaders / actions
  loadSkills: () => Promise<void>
  loadHooks: () => Promise<void>
  saveHooks: (hooks: HookRecord[]) => Promise<void>
  loadCheckpoints: (sessionId: string) => Promise<void>
  saveCheckpoint: (sessionId: string, label?: string) => Promise<number | null>
  restoreCheckpoint: (checkpointId: number) => Promise<void>
  deleteCheckpoint: (checkpointId: number) => Promise<void>
  loadBgAgents: () => Promise<void>
  createBgAgent: (opts: { name: string; cwd: string; provider: string; model: string; prompt: string }) => Promise<string | null>
  deleteBgAgent: (id: string) => Promise<void>
  loadCronTasks: () => Promise<void>
  createCronTask: (opts: { name: string; schedule: string; cwd: string; provider: string; model: string; prompt: string }) => Promise<string | null>
  updateCronTask: (id: string, patch: Partial<ScheduledTaskRecord>) => Promise<void>
  deleteCronTask: (id: string) => Promise<void>

  // Slash commands + session ops
  dispatchSlashCommand: (raw: string) => Promise<boolean>
  compactSession: (keepRecent?: number) => Promise<void>

  pickDirectory: () => Promise<string | null>
  openSettings: () => void
  closeSettings: () => void
  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  setDrawer: (drawer: DrawerKind) => void
}

let cachedProviderDefs: Array<Omit<ProviderInfo, 'authed'>> | null = null

async function loadProviderDefs(): Promise<Array<Omit<ProviderInfo, 'authed'>>> {
  if (cachedProviderDefs) return cachedProviderDefs
  const res = await window.electron.auth.providers()
  if (res.ok && res.providers) {
    cachedProviderDefs = res.providers as Array<Omit<ProviderInfo, 'authed'>>
    return cachedProviderDefs
  }
  return []
}

function hex(px = 16): string {
  return Array.from({ length: px }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function applyThemeToDom(theme: Theme) {
  const root = document.documentElement
  const c = theme.colors
  const set = (k: string, v: string | undefined) => {
    if (v) root.style.setProperty(k, v)
  }
  set('--theme-primary', c.primary)
  set('--theme-secondary', c.secondary)
  set('--theme-muted', c.muted)
  set('--theme-text', c.text)
  set('--theme-user-input', c.userInput)
  set('--theme-response', c.response)
  set('--theme-tool', c.tool)
  set('--theme-tool-result', c.toolResult)
  set('--theme-error', c.error)
  set('--theme-success', c.success)
  set('--theme-warning', c.warning)
  set('--theme-border', c.border)
  set('--theme-suggestion', c.suggestion)
  set('--theme-bg', c.bg ?? '#0a0a0f')
  set('--theme-bg-subtle', c.bgSubtle ?? '#0d0d14')
}

function convertPersistedMessages(rawMessages: any[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of rawMessages) {
    if (m.role === 'user') {
      out.push({
        id: 'msg_' + hex(),
        type: 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        timestamp: Date.now(),
      })
    } else if (m.role === 'assistant') {
      const content = typeof m.content === 'string' ? m.content : ''
      const toolCalls: ToolCallRecord[] = Array.isArray(m.tool_calls)
        ? m.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name ?? 'unknown',
            args: safeParseJSON(tc.function?.arguments ?? '{}'),
            status: 'done' as const,
          }))
        : []
      if (content || toolCalls.length > 0) {
        out.push({
          id: 'msg_' + hex(),
          type: 'assistant',
          content,
          timestamp: Date.now(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        })
      }
    } else if (m.role === 'tool') {
      const toolCallId = m.tool_call_id
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      for (let i = out.length - 1; i >= 0; i--) {
        const prev = out[i]
        if (prev.type === 'assistant' && prev.toolCalls) {
          const match = prev.toolCalls.find(tc => tc.id === toolCallId)
          if (match) {
            const diffMatch = content.match(/\n\nDiff:\n([\s\S]*)$/)
            match.result = diffMatch ? content.slice(0, diffMatch.index).trim() : content
            match.diff = diffMatch ? diffMatch[1].trim() : null
            break
          }
        }
      }
    }
  }
  return out
}

function safeParseJSON(s: string): Record<string, unknown> {
  try { return JSON.parse(s) } catch { return {} }
}

function toSessionFromMeta(meta: SessionMeta, messages: ChatMessage[] = []): Session {
  return {
    id: meta.id,
    title: meta.title || 'Untitled',
    messages,
    createdAt: Date.parse(meta.created_at),
    updatedAt: Date.parse(meta.updated_at),
    model: meta.model,
    provider: meta.provider,
    cwd: meta.cwd,
    tokenCount: meta.prompt_tokens + meta.completion_tokens,
    estimatedCost: meta.estimated_cost,
  }
}

const DEFAULT_CONFIG: AppConfig = {
  theme: 'codemaxxing',
  autoApprove: false,
  approvalMode: 'suggest',
  reasoningEffort: 'off',
  activeSkillIds: [],
  lastCwd: null,
  lastProvider: null,
  lastModel: null,
}

function mergeConfig(raw: any): AppConfig {
  return {
    theme: raw?.theme ?? 'codemaxxing',
    autoApprove: raw?.autoApprove ?? false,
    approvalMode: (raw?.approvalMode as ApprovalMode) ?? (raw?.autoApprove ? 'full-auto' : 'suggest'),
    reasoningEffort: (raw?.reasoningEffort as ReasoningEffort) ?? 'off',
    activeSkillIds: Array.isArray(raw?.activeSkillIds) ? raw.activeSkillIds : [],
    lastCwd: raw?.lastCwd ?? null,
    lastProvider: raw?.lastProvider ?? null,
    lastModel: raw?.lastModel ?? null,
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: false,
  appConfig: DEFAULT_CONFIG,
  providers: [],
  detectedAuth: [],
  authFlowStatus: null,
  credentials: [],
  availableModels: [],
  sessionList: [],
  activeSessionId: null,
  activeSession: null,
  isRunning: false,
  currentAssistantText: '',
  currentThinkingText: '',
  currentToolCalls: [],
  currentIteration: 0,
  currentUsage: null,
  currentTasks: [],
  pendingApproval: null,
  pendingMCPApproval: null,
  pendingAsk: null,
  pendingPlan: null,
  skills: [],
  hooks: [],
  checkpoints: [],
  bgAgentList: [],
  cronTasks: [],
  themes: [],
  activeTheme: null,
  settingsOpen: false,
  previewOpen: false,
  activeDrawer: null,

  init: async () => {
    if (get().initialized || get().loading) return
    set({ loading: true })
    try {
      if (!(window as any).electron) {
        const { installBrowserMock } = await import('../dev-mocks/electron-browser')
        installBrowserMock()
      }
      const themesResult = await window.electron.themes.list()
      const themes: Theme[] = themesResult.ok ? (themesResult.themes || []) : []

      const configResult = await window.electron.config.get()
      const appConfig = mergeConfig(configResult.ok ? configResult.config : null)

      if (!appConfig.lastCwd) {
        appConfig.lastCwd = await window.electron.project.defaultCwd()
      }

      const activeTheme = themes.find(t => (t as any).key === appConfig.theme) || themes[0] || null
      if (activeTheme) applyThemeToDom(activeTheme)

      set({ themes, activeTheme, appConfig })

      window.electron.agent.onText(({ sessionId, delta }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => ({ currentAssistantText: s.currentAssistantText + delta }))
      })

      window.electron.agent.onThinking(({ sessionId, delta }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => ({ currentThinkingText: s.currentThinkingText + delta }))
      })

      window.electron.agent.onToolCall(({ sessionId, call }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          const existing = s.currentToolCalls.findIndex(tc => tc.id === call.id)
          if (existing >= 0) {
            const next = [...s.currentToolCalls]
            next[existing] = { ...next[existing], ...call }
            return { currentToolCalls: next }
          }
          return { currentToolCalls: [...s.currentToolCalls, call as ToolCallRecord] }
        })
      })

      window.electron.agent.onIteration(({ sessionId, iteration }) => {
        if (sessionId !== get().activeSessionId) return
        set({ currentIteration: iteration })
      })

      window.electron.agent.onUsage(({ sessionId, usage }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => ({
          currentUsage: {
            promptTokens: (s.currentUsage?.promptTokens ?? 0) + usage.promptTokens,
            completionTokens: (s.currentUsage?.completionTokens ?? 0) + usage.completionTokens,
          },
        }))
      })

      window.electron.agent.onTasks(({ sessionId, tasks }) => {
        if (sessionId !== get().activeSessionId) return
        set({ currentTasks: tasks as Task[] })
      })

      window.electron.agent.onApprovalRequest(({ sessionId, call }) => {
        set({ pendingApproval: { sessionId, call } })
      })

      window.electron.agent.onAskUser(({ sessionId, askId, question, options }) => {
        set({ pendingAsk: { sessionId, askId, question, options } })
      })

      window.electron.agent.onPlanExit(({ sessionId, plan }) => {
        set({ pendingPlan: { sessionId, plan } })
      })

      window.electron.agent.onDone(({ sessionId, text, usage }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          if (!s.activeSession) {
            return {
              isRunning: false,
              currentAssistantText: '',
              currentThinkingText: '',
              currentToolCalls: [],
              currentUsage: null,
              currentIteration: 0,
            }
          }
          const bubble: ChatMessage = {
            id: 'msg_' + hex(),
            type: 'assistant',
            content: text || s.currentAssistantText,
            timestamp: Date.now(),
            toolCalls: s.currentToolCalls.length > 0 ? s.currentToolCalls : undefined,
          }
          const updatedSession: Session = {
            ...s.activeSession,
            messages: [...s.activeSession.messages, bubble],
            tokenCount: s.activeSession.tokenCount + usage.promptTokens + usage.completionTokens,
            estimatedCost: s.activeSession.estimatedCost + usage.cost,
            updatedAt: Date.now(),
          }
          return {
            activeSession: updatedSession,
            isRunning: false,
            currentAssistantText: '',
            currentThinkingText: '',
            currentToolCalls: [],
            currentUsage: null,
            currentIteration: 0,
          }
        })
        void get().loadSessions()
      })

      window.electron.agent.onError(({ sessionId, error }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          if (!s.activeSession) return { isRunning: false }
          const errMsg: ChatMessage = {
            id: 'msg_' + hex(),
            type: 'error',
            content: error,
            timestamp: Date.now(),
          }
          return {
            activeSession: { ...s.activeSession, messages: [...s.activeSession.messages, errMsg] },
            isRunning: false,
            currentAssistantText: '',
            currentThinkingText: '',
            currentToolCalls: [],
          }
        })
      })

      window.electron.mcp.onApprovalRequest((data) => {
        set({ pendingMCPApproval: data })
      })

      window.electron.mcp.onStatus(({ name, status }) => {
        console.log('[mcp]', name, status)
      })

      window.electron.auth.onStatus(({ provider, method, message }) => {
        const curr = get().authFlowStatus
        if (!curr || curr.provider !== provider || curr.method !== method) {
          set({ authFlowStatus: { provider, method, messages: [message] } })
        } else {
          set({ authFlowStatus: { ...curr, messages: [...curr.messages, message] } })
        }
      })

      // Live updates for background agents and cron
      window.electron.bgAgents.onUpdate(() => { void get().loadBgAgents() })
      window.electron.cron.onFired(() => { void get().loadCronTasks() })

      await get().refreshProvidersAndCredentials()
      await get().loadSessions()
      await get().loadSkills()

      set({ initialized: true, loading: false })
    } catch (err) {
      console.error('Init failed:', err)
      set({ initialized: true, loading: false })
    }
  },

  refreshProvidersAndCredentials: async () => {
    const [defs, authResult, detectResult, ollamaRunning] = await Promise.all([
      loadProviderDefs(),
      window.electron.auth.list(),
      window.electron.auth.detect(),
      window.electron.ollama.isRunning(),
    ])
    const credentials: AuthCredentialDisplay[] = authResult.ok && authResult.credentials ? authResult.credentials : []
    const detectedAuth: DetectedAuth[] = detectResult.ok && detectResult.detected ? detectResult.detected : []

    const providers: ProviderInfo[] = defs.map(p => ({
      ...p,
      authed: p.id === 'ollama' ? ollamaRunning
        : p.id === 'lmstudio' ? true
        : credentials.some(c => c.provider === p.id),
    }))
    set({ providers, credentials, detectedAuth })
  },

  loadThemes: async () => {
    const result = await window.electron.themes.list()
    if (result.ok && result.themes) set({ themes: result.themes })
  },

  applyTheme: (theme: Theme) => {
    applyThemeToDom(theme)
    set({ activeTheme: theme })
  },

  setTheme: async (themeKey: string) => {
    const { themes, appConfig } = get()
    const theme = themes.find(t => (t as any).key === themeKey)
    if (!theme) return
    applyThemeToDom(theme)
    const newConfig = { ...appConfig, theme: themeKey }
    await window.electron.config.save(newConfig)
    set({ activeTheme: theme, appConfig: newConfig })
  },

  setAutoApprove: async (value: boolean) => {
    const { appConfig } = get()
    const newConfig: AppConfig = {
      ...appConfig,
      autoApprove: value,
      approvalMode: value ? 'full-auto' : appConfig.approvalMode,
    }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig })
  },

  setApprovalMode: async (mode: ApprovalMode) => {
    const { appConfig } = get()
    const newConfig: AppConfig = {
      ...appConfig,
      approvalMode: mode,
      autoApprove: mode === 'full-auto',
    }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig })
  },

  setReasoningEffort: async (effort: ReasoningEffort) => {
    const { appConfig } = get()
    const newConfig: AppConfig = { ...appConfig, reasoningEffort: effort }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig })
  },

  setActiveSkillIds: async (ids: string[]) => {
    const { appConfig } = get()
    const newConfig: AppConfig = { ...appConfig, activeSkillIds: ids }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig })
  },

  setLastCwd: async (cwd: string) => {
    const { appConfig } = get()
    const newConfig = { ...appConfig, lastCwd: cwd }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig })
  },

  loadModels: async (providerId: string) => {
    set({ loading: true })
    try {
      const result = await window.electron.llm.listModels(providerId)
      if (result.ok && result.models) {
        set({ availableModels: result.models })
      } else {
        set({ availableModels: defaultModelsFor(providerId) })
      }
    } catch {
      set({ availableModels: defaultModelsFor(providerId) })
    } finally {
      set({ loading: false })
    }
  },

  saveCredential: async (cred) => {
    const defs = await loadProviderDefs()
    const def = defs.find(p => p.id === cred.provider)
    await window.electron.auth.save({
      provider: cred.provider,
      method: 'api-key',
      apiKey: cred.apiKey,
      baseUrl: cred.baseUrl || def?.baseUrl || '',
      label: cred.label,
      createdAt: new Date().toISOString(),
    })
    await get().refreshProvidersAndCredentials()
  },

  deleteCredential: async (providerId: string) => {
    await window.electron.auth.delete(providerId)
    await get().refreshProvidersAndCredentials()
  },

  clearAuthFlowStatus: () => set({ authFlowStatus: null }),

  runAuthFlow: async (provider, method) => {
    set({ authFlowStatus: { provider, method, messages: [] } })
    let result: { ok: boolean; error?: string }
    try {
      switch (true) {
        case provider === 'openrouter' && method === 'oauth':
          result = await window.electron.auth.openrouterOAuth(); break
        case provider === 'anthropic' && method === 'setup-token':
          result = await window.electron.auth.anthropicSetupToken(); break
        case provider === 'copilot' && method === 'device-flow':
          result = await window.electron.auth.copilotDeviceFlow(); break
        case provider === 'openai' && method === 'cached-token':
          result = await window.electron.auth.importCodex(); break
        case provider === 'qwen' && method === 'cached-token':
          result = await window.electron.auth.importQwen(); break
        default:
          result = { ok: false, error: `Unsupported flow: ${provider}/${method}` }
      }
    } catch (err: any) {
      result = { ok: false, error: err?.message ?? String(err) }
    }
    await get().refreshProvidersAndCredentials()
    return result
  },

  loadSessions: async () => {
    const result = await window.electron.session.list()
    if (result.ok && result.sessions) {
      set({ sessionList: result.sessions as SessionMeta[] })
    }
  },

  createSession: async (opts) => {
    const result = await window.electron.session.create(opts)
    if (!result.ok || !result.session) return null
    const newSession = toSessionFromMeta(result.session as SessionMeta, [])

    const { appConfig } = get()
    const newConfig = { ...appConfig, lastProvider: opts.provider, lastModel: opts.model, lastCwd: opts.cwd }
    await window.electron.config.save(newConfig)

    set({
      activeSession: newSession,
      activeSessionId: newSession.id,
      appConfig: newConfig,
      currentAssistantText: '',
      currentThinkingText: '',
      currentToolCalls: [],
      currentUsage: null,
      currentIteration: 0,
    })
    await get().loadSessions()
    return newSession.id
  },

  switchSession: async (sessionId: string) => {
    set({ loading: true })
    try {
      const result = await window.electron.session.get(sessionId)
      if (!result.ok || !result.session) return
      const meta = result.session as SessionMeta
      const messages = convertPersistedMessages(result.messages || [])
      set({
        activeSession: toSessionFromMeta(meta, messages),
        activeSessionId: sessionId,
        currentAssistantText: '',
        currentThinkingText: '',
        currentToolCalls: [],
        currentUsage: null,
        currentIteration: 0,
        pendingAsk: null,
        pendingPlan: null,
      })
    } finally {
      set({ loading: false })
    }
  },

  deleteSession: async (sessionId: string) => {
    await window.electron.session.delete(sessionId)
    set((s) => ({
      sessionList: s.sessionList.filter(x => x.id !== sessionId),
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      activeSession: s.activeSessionId === sessionId ? null : s.activeSession,
    }))
  },

  updateSessionCwd: async (sessionId: string, cwd: string) => {
    await window.electron.session.setCwd(sessionId, cwd)
    set((s) => ({
      activeSession: s.activeSession && s.activeSession.id === sessionId ? { ...s.activeSession, cwd } : s.activeSession,
    }))
    await get().loadSessions()
  },

  updateSessionModel: async (sessionId: string, provider: string, model: string) => {
    await window.electron.session.updateModel(sessionId, provider, model)
    set((s) => ({
      activeSession: s.activeSession && s.activeSession.id === sessionId ? { ...s.activeSession, provider, model } : s.activeSession,
    }))
    await get().loadSessions()
  },

  sendMessage: async (message: string) => {
    const { activeSessionId, activeSession, isRunning } = get()
    if (!activeSessionId || !activeSession || isRunning) return

    // Intercept slash commands locally — don't send to agent
    if (message.startsWith('/')) {
      const handled = await get().dispatchSlashCommand(message)
      if (handled) return
    }

    const userMsg: ChatMessage = {
      id: 'msg_' + hex(),
      type: 'user',
      content: message,
      timestamp: Date.now(),
    }
    set((s) => ({
      activeSession: s.activeSession ? { ...s.activeSession, messages: [...s.activeSession.messages, userMsg] } : null,
      isRunning: true,
      currentAssistantText: '',
      currentThinkingText: '',
      currentToolCalls: [],
      currentUsage: null,
      currentIteration: 0,
    }))

    if ((activeSession.title === 'Untitled' || !activeSession.title) && activeSession.messages.length === 0) {
      const newTitle = message.split('\n')[0].slice(0, 60)
      await window.electron.session.updateTitle(activeSessionId, newTitle)
      set((s) => ({
        activeSession: s.activeSession ? { ...s.activeSession, title: newTitle } : null,
      }))
    }

    await window.electron.agent.send({ sessionId: activeSessionId, message })
  },

  abortCurrent: async () => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    await window.electron.agent.abort(activeSessionId)
    set({ isRunning: false })
  },

  respondToApproval: async (decision) => {
    const { pendingApproval } = get()
    if (!pendingApproval) return
    await window.electron.agent.approvalResponse(pendingApproval.sessionId, pendingApproval.call.id, decision)
    set({ pendingApproval: null })
  },

  respondToMCPApproval: (decision: boolean) => {
    const { pendingMCPApproval } = get()
    if (!pendingMCPApproval) return
    window.electron.mcp.approvalResponse(pendingMCPApproval.token, decision)
    set({ pendingMCPApproval: null })
  },

  respondToAsk: async (reply: string) => {
    const { pendingAsk } = get()
    if (!pendingAsk) return
    await window.electron.agent.askUserResponse(pendingAsk.sessionId, pendingAsk.askId, reply)
    set({ pendingAsk: null })
  },

  dismissPlan: () => set({ pendingPlan: null }),

  // Cross-session data actions
  loadSkills: async () => {
    const res = await window.electron.skills.list()
    if (res.ok && res.skills) set({ skills: res.skills })
  },

  loadHooks: async () => {
    const res = await window.electron.hooks.list()
    if (res.ok && res.hooks) set({ hooks: res.hooks })
  },

  saveHooks: async (hooks: HookRecord[]) => {
    await window.electron.hooks.saveGlobal(hooks)
    set({ hooks })
  },

  loadCheckpoints: async (sessionId: string) => {
    const res = await window.electron.checkpoints.list(sessionId)
    if (res.ok && res.checkpoints) set({ checkpoints: res.checkpoints })
  },

  saveCheckpoint: async (sessionId: string, label?: string) => {
    const res = await window.electron.checkpoints.save(sessionId, label)
    if (res.ok) {
      await get().loadCheckpoints(sessionId)
      return res.id ?? null
    }
    return null
  },

  restoreCheckpoint: async (checkpointId: number) => {
    const res = await window.electron.checkpoints.restore(checkpointId)
    if (!res.ok || !res.session_id) return
    await get().switchSession(res.session_id)
    // The renderer re-renders from persisted messages via switchSession — main-process
    // restore does not actually mutate the session store; we show the frozen view.
  },

  deleteCheckpoint: async (checkpointId: number) => {
    await window.electron.checkpoints.delete(checkpointId)
    set((s) => ({ checkpoints: s.checkpoints.filter(c => c.id !== checkpointId) }))
  },

  loadBgAgents: async () => {
    const res = await window.electron.bgAgents.list()
    if (res.ok && res.agents) set({ bgAgentList: res.agents })
  },

  createBgAgent: async (opts) => {
    const res = await window.electron.bgAgents.create(opts)
    if (!res.ok) return null
    await get().loadBgAgents()
    return res.id ?? null
  },

  deleteBgAgent: async (id: string) => {
    await window.electron.bgAgents.delete(id)
    set((s) => ({ bgAgentList: s.bgAgentList.filter(a => a.id !== id) }))
  },

  loadCronTasks: async () => {
    const res = await window.electron.cron.list()
    if (res.ok && res.tasks) set({ cronTasks: res.tasks })
  },

  createCronTask: async (opts) => {
    const res = await window.electron.cron.create(opts)
    if (!res.ok) return null
    await get().loadCronTasks()
    return res.id ?? null
  },

  updateCronTask: async (id: string, patch: Partial<ScheduledTaskRecord>) => {
    await window.electron.cron.update(id, patch)
    await get().loadCronTasks()
  },

  deleteCronTask: async (id: string) => {
    await window.electron.cron.delete(id)
    set((s) => ({ cronTasks: s.cronTasks.filter(t => t.id !== id) }))
  },

  dispatchSlashCommand: async (raw: string): Promise<boolean> => {
    const { activeSession, activeSessionId } = get()
    if (!activeSession || !activeSessionId) return false
    const trimmed = raw.trim()
    if (!trimmed.startsWith('/')) return false
    const spaceIdx = trimmed.indexOf(' ')
    const cmd = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase()
    const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()

    const pushSystemMessage = (content: string, type: 'assistant' | 'error' = 'assistant') => {
      const msg: ChatMessage = { id: 'msg_' + hex(), type, content, timestamp: Date.now() }
      set((s) => ({
        activeSession: s.activeSession
          ? { ...s.activeSession, messages: [...s.activeSession.messages, msg] }
          : null,
      }))
    }

    const pushUserEcho = (content: string) => {
      const msg: ChatMessage = { id: 'msg_' + hex(), type: 'user', content, timestamp: Date.now() }
      set((s) => ({
        activeSession: s.activeSession
          ? { ...s.activeSession, messages: [...s.activeSession.messages, msg] }
          : null,
      }))
    }

    switch (cmd) {
      case 'diff': {
        pushUserEcho(trimmed)
        const r = await window.electron.git.diff(activeSession.cwd, rest === 'staged')
        pushSystemMessage(r.ok ? `\`\`\`diff\n${r.diff || '(no diff)'}\n\`\`\`` : `Error: ${r.error}`, r.ok ? 'assistant' : 'error')
        return true
      }
      case 'status': {
        pushUserEcho(trimmed)
        const r = await window.electron.git.status(activeSession.cwd)
        pushSystemMessage(r.ok ? `\`\`\`\n${r.status || '(clean)'}\n\`\`\`` : `Error: ${r.error}`, r.ok ? 'assistant' : 'error')
        return true
      }
      case 'log': {
        pushUserEcho(trimmed)
        const limit = parseInt(rest, 10)
        const r = await window.electron.git.log(activeSession.cwd, Number.isFinite(limit) ? limit : 20)
        pushSystemMessage(r.ok ? `\`\`\`\n${r.log || '(no commits)'}\n\`\`\`` : `Error: ${r.error}`, r.ok ? 'assistant' : 'error')
        return true
      }
      case 'commit': {
        pushUserEcho(trimmed)
        if (!rest) { pushSystemMessage('Usage: `/commit <message>`', 'error'); return true }
        const r = await window.electron.git.commit(activeSession.cwd, rest, true)
        pushSystemMessage(r.ok ? `\`\`\`\n${r.result}\n\`\`\`` : `Error: ${r.error}`, r.ok ? 'assistant' : 'error')
        return true
      }
      case 'push': {
        pushUserEcho(trimmed)
        const r = await window.electron.git.push(activeSession.cwd)
        pushSystemMessage(r.ok ? `\`\`\`\n${r.result}\n\`\`\`` : `Error: ${r.error}`, r.ok ? 'assistant' : 'error')
        return true
      }
      case 'undo': {
        pushUserEcho(trimmed)
        const r = await window.electron.git.undo(activeSession.cwd)
        pushSystemMessage(r.ok ? `\`\`\`\n${r.result}\n\`\`\`` : `Error: ${r.error}`, r.ok ? 'assistant' : 'error')
        return true
      }
      case 'cost': {
        pushUserEcho(trimmed)
        const s = activeSession
        const costStr = s.estimatedCost > 0 ? `$${s.estimatedCost.toFixed(4)}` : '$0.0000'
        pushSystemMessage(`**Session cost** — ${s.tokenCount.toLocaleString()} tokens · ${costStr}`)
        return true
      }
      case 'compact': {
        pushUserEcho(trimmed)
        const keep = parseInt(rest, 10)
        await get().compactSession(Number.isFinite(keep) ? keep : undefined)
        return true
      }
      case 'checkpoint': {
        pushUserEcho(trimmed)
        const id = await get().saveCheckpoint(activeSessionId, rest || undefined)
        pushSystemMessage(id !== null ? `✅ Checkpoint saved (#${id})${rest ? ` — ${rest}` : ''}` : 'Failed to save checkpoint', id !== null ? 'assistant' : 'error')
        return true
      }
      case 'checkpoints': {
        get().setDrawer('checkpoints')
        void get().loadCheckpoints(activeSessionId)
        return true
      }
      case 'skills': {
        pushUserEcho(trimmed)
        const active = get().appConfig.activeSkillIds
        const list = get().skills
        if (active.length === 0) {
          pushSystemMessage(`${list.length} skills available. Enable them in Settings → Skills.`)
        } else {
          const names = active.map(id => list.find(s => s.id === id)?.name ?? id).join(', ')
          pushSystemMessage(`**Active skills:** ${names}`)
        }
        return true
      }
      case 'think': {
        pushUserEcho(trimmed)
        const eff = (rest || 'medium') as ReasoningEffort
        const allowed: ReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max']
        if (!allowed.includes(eff)) { pushSystemMessage(`Usage: /think <off|low|medium|high|max>`, 'error'); return true }
        await get().setReasoningEffort(eff)
        pushSystemMessage(`Reasoning effort set to **${eff}**.`)
        return true
      }
      case 'memory': {
        pushUserEcho(trimmed)
        if (!rest) {
          const r = await window.electron.memory.stats()
          const stats = r.ok && r.stats ? r.stats : { total: 0, byType: {} }
          const byType = Object.entries(stats.byType).map(([k, v]) => `${k}: ${v}`).join(', ') || '(none)'
          pushSystemMessage(`**Memory** — ${stats.total} items · ${byType}`)
        } else {
          const r = await window.electron.memory.recall(rest, undefined, activeSession.cwd, 10)
          const mems = r.ok ? (r.memories || []) : []
          if (mems.length === 0) pushSystemMessage(`No memories match "${rest}".`)
          else pushSystemMessage(mems.map(m => `- **[${m.type}]** ${m.key}: ${m.content}`).join('\n'))
        }
        return true
      }
      case 'bg': case 'background': {
        get().setDrawer('bg-agents')
        void get().loadBgAgents()
        return true
      }
      case 'cron': case 'schedule': {
        get().setDrawer('cron')
        void get().loadCronTasks()
        return true
      }
      case 'settings': case 'config': {
        get().openSettings()
        return true
      }
      case 'help': {
        pushUserEcho(trimmed)
        pushSystemMessage(
          [
            '**Slash commands**',
            '- `/diff [staged]` · `/status` · `/log [n]` — inspect git',
            '- `/commit <msg>` · `/push` · `/undo` — git actions (auto-stages for commit)',
            '- `/cost` — current session cost',
            '- `/compact [keep]` — summarize old history into a fresh session',
            '- `/checkpoint [label]` — save snapshot · `/checkpoints` — open drawer',
            '- `/skills` — show active · `/think <level>` — reasoning effort',
            '- `/memory [query]` — stats or search',
            '- `/bg` · `/cron` — open drawers · `/settings` — open settings',
          ].join('\n'),
        )
        return true
      }
      default:
        return false
    }
  },

  compactSession: async (keepRecent = 6) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    const r = await window.electron.sessionOps.compact(activeSessionId, keepRecent)
    if (r.ok && r.newSessionId) {
      await get().loadSessions()
      await get().switchSession(r.newSessionId)
    }
  },

  pickDirectory: async () => {
    const result = await window.electron.project.pickDirectory()
    if (!result.ok || !result.path) return null
    await get().setLastCwd(result.path)
    return result.path
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  togglePreview: () => set((s) => ({ previewOpen: !s.previewOpen })),
  setPreviewOpen: (open: boolean) => set({ previewOpen: open }),
  setDrawer: (drawer) => set({ activeDrawer: drawer }),
}))

function defaultModelsFor(providerId: string): ModelInfo[] {
  if (providerId === 'anthropic') {
    return [
      { name: 'claude-sonnet-4-6', id: 'claude-sonnet-4-6' },
      { name: 'claude-opus-4-6', id: 'claude-opus-4-6' },
      { name: 'claude-haiku-4-5-20251001', id: 'claude-haiku-4-5-20251001' },
    ]
  }
  if (providerId === 'openai') {
    return [
      { name: 'gpt-5', id: 'gpt-5' },
      { name: 'gpt-4.1', id: 'gpt-4.1' },
      { name: 'o3', id: 'o3' },
    ]
  }
  if (providerId === 'openrouter') {
    return [
      { name: 'anthropic/claude-sonnet-4-6', id: 'anthropic/claude-sonnet-4-6' },
      { name: 'openai/gpt-5', id: 'openai/gpt-5' },
    ]
  }
  return []
}
