import { create } from 'zustand'
import type {
  ChatMessage,
  MessageSegment,
  Session,
  Theme,
  ToolCallRecord,
  PendingApproval,
  PendingMCPApproval,
  AuthCredentialDisplay,
  ImageAttachment,
  Task,
  SessionMode,
} from '../types'
import type {
  ApprovalMode,
  ReasoningEffort,
  SkillRecord,
  HookRecord,
  CheckpointRecord,
  BackgroundAgentRecord,
  ScheduledTaskRecord,
  PairedDeviceSummary,
} from '../types/electron'

export type AuthMethod = 'oauth' | 'api-key' | 'setup-token' | 'cached-token' | 'device-flow' | 'none'

// A single tab in Browser mode. Each maps to its own <webview>.
export interface BrowserTabState {
  id: string
  url: string
  title: string
  loading?: boolean
}
function freshTab(): BrowserTabState {
  return { id: 'tab_' + Math.random().toString(36).slice(2, 9), url: '', title: 'New tab' }
}

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

export interface ModelInfo {
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
  // 24/7 / remote-access flags. Optional in the store's view because they
  // were added later and old configs persist without them — defaults
  // applied in mergeConfig().
  keepAliveInBackground?: boolean
  autoLaunch?: boolean
  // We don't store the device tokens in the renderer — only metadata.
  // PairedDeviceSummary mirrors what main.ts strips before sending in `remote:status`.
  remote?: { enabled: boolean; port: number; devices?: PairedDeviceSummary[] }
  // Auto-compact: when the last turn's prompt-token count crosses this
  // fraction of the model's context window, fork the session through
  // the existing /compact path BEFORE sending the next user message.
  // Defaults: enabled=true, threshold=0.85 (15% headroom for the next
  // turn's response). Tunable from Settings → Agent.
  autoCompactEnabled?: boolean
  autoCompactThreshold?: number
  // Spend dial — soft per-session USD budget (0/undefined = off). Drives the
  // status-bar spend meter; warns as the session cost approaches the cap.
  costBudget?: number
  // First-run onboarding completed? Gates the welcome overlay.
  onboarded?: boolean
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
  mode?: 'code' | 'chat' | 'browser'
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

export type DrawerKind = 'checkpoints' | 'bg-agents' | 'cron' | 'cookbook' | 'notes' | 'cockpit' | null

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
  /** Timeline of live segments in stream order. Prefer this for rendering. */
  currentSegments: MessageSegment[]
  currentIteration: number
  currentUsage: { promptTokens: number; completionTokens: number } | null
  /**
   * Most recent non-zero prompt_tokens from a single API call. Represents the
   * current fill of the context window (prior messages + system + tools) so
   * the status bar gauge can reflect it accurately. Persists across runs.
   */
  lastPromptTokens: number | null
  /** Streaming stats (tok/s, context window, locality). Persists across runs for display. */
  currentStats: { tokensPerSecond: number | null; contextWindow: number; isLocal: boolean } | null
  currentTasks: Task[]
  /** Most recent user prompt text. Captured at sendMessage time so that
   *  if the run errors out (e.g. context window overflow) we can offer a
   *  one-click retry without making the user re-type — the error message
   *  attaches it as `retryPrompt`. */
  lastUserPrompt: string | null

  // ── Approvals / asks / plans ──
  pendingApproval: PendingApproval | null
  pendingMCPApproval: PendingMCPApproval | null
  /** Latest status per MCP server name ("connecting", "connected (N tools)", "error: …"). */
  mcpStatuses: Record<string, string>
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
  compareOpen: boolean
  researchOpen: boolean
  documentsOpen: boolean
  emailOpen: boolean
  calendarOpen: boolean
  previewOpen: boolean
  previewUrl: string | null
  previewTab: 'web' | 'run' | null
  // Browser mode: full-takeover, browser-first layout (Arc-style vertical tabs
  // + assistant on the left, the active tab's page fills the window).
  browserView: boolean
  browserTabs: BrowserTabState[]
  activeBrowserTabId: string | null
  filesPanelOpen: boolean
  activeDrawer: DrawerKind
  commandPaletteOpen: boolean

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
  /** Generic config writer used by Settings panels that touch fields without
   *  a dedicated setter (24/7 toggles, remote-access wrapper, etc.). Round-trips
   *  through `window.electron.config.save` AND updates the local store so the
   *  UI reflects the change without waiting for a refetch. */
  setAppConfig: (next: AppConfig) => Promise<void>

  loadModels: (providerId: string) => Promise<void>
  saveCredential: (cred: { provider: string; apiKey: string; baseUrl: string; label?: string }) => Promise<void>
  deleteCredential: (providerId: string) => Promise<void>

  runAuthFlow: (provider: string, method: AuthMethod) => Promise<{ ok: boolean; error?: string }>
  authFlowStatus: { provider: string; method: string; messages: string[] } | null
  clearAuthFlowStatus: () => void

  loadSessions: () => Promise<void>
  createSession: (opts: { cwd: string; provider: string; model: string; title?: string; mode?: SessionMode }) => Promise<string | null>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  updateSessionCwd: (sessionId: string, cwd: string) => Promise<void>
  updateSessionModel: (sessionId: string, provider: string, model: string) => Promise<void>
  setActiveSessionMode: (mode: 'code' | 'chat') => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  setCostBudget: (usd: number) => Promise<void>
  goLocal: () => Promise<void>
  onboardingOpen: boolean
  completeOnboarding: () => Promise<void>
  openOnboarding: () => void

  sendMessage: (message: string, images?: ImageAttachment[]) => Promise<void>
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
  /** Compact the active session AND immediately re-send `prompt` against the
   *  newly-forked session. The combo error-recovery path used by the
   *  context_overflow error banner's "Compact & retry" button. */
  compactAndRetry: (prompt: string, keepRecent?: number) => Promise<void>

  pickDirectory: () => Promise<string | null>
  openSettings: () => void
  closeSettings: () => void
  openCompare: () => void
  closeCompare: () => void
  openResearch: () => void
  closeResearch: () => void
  openDocuments: () => void
  closeDocuments: () => void
  openEmail: () => void
  closeEmail: () => void
  openCalendar: () => void
  closeCalendar: () => void
  togglePreview: () => void
  setPreviewOpen: (open: boolean) => void
  openPreview: (url: string) => void
  setPreviewTab: (tab: 'web' | 'run' | null) => void
  openBrowserPanel: () => void
  toggleBrowserView: () => void
  setBrowserView: (open: boolean) => void
  /** Leave the browser surface — clears the transient toggle and, if the
   *  active session is a browser-type session, moves to a non-browser one. */
  exitBrowser: () => Promise<void>
  addBrowserTab: (url?: string) => void
  closeBrowserTab: (id: string) => void
  setActiveBrowserTab: (id: string) => void
  updateBrowserTab: (id: string, patch: Partial<BrowserTabState>) => void
  toggleFilesPanel: () => void
  setFilesPanelOpen: (open: boolean) => void
  setDrawer: (drawer: DrawerKind) => void
  setCommandPaletteOpen: (open: boolean) => void
}

let cachedProviderDefs: Array<Omit<ProviderInfo, 'authed'>> | null = null

/**
 * Subscriptions installed by `init()`. Captured at module scope so a re-entry
 * (Vite HMR, a defensive double-init, the dev-mocks fallback path) tears down
 * the previous listeners before installing a fresh set. Without this, every
 * agent event ran its callback N times — the visible symptom is duplicate
 * tokens streaming into a bubble after a hot reload, plus a slow accumulation
 * of work on every IPC chunk.
 */
const ipcUnsubs: Array<() => void> = []
function clearIpcSubscriptions(): void {
  while (ipcUnsubs.length > 0) {
    const off = ipcUnsubs.pop()
    try { off?.() } catch { /* swallow — best-effort teardown */ }
  }
}

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

/** Ambient backdrop style per theme key. Anything not listed falls back to
 *  the polarity default — 'aurora' glows on dark themes, 'soft' on light.
 *  Pure presentation, renderer-only: the CSS lives in globals.css under
 *  `:root[data-backdrop=…] .app-shell` and is built from theme variables,
 *  so backdrops automatically match each theme's palette. */
const BACKDROP_BY_THEME: Record<string, string> = {
  'cyberpunk-neon': 'grid',
  synthwave: 'grid',
  hacker: 'scanlines',
  mono: 'none', // monochrome stays flat on purpose
  'high-contrast-light': 'none', // accessibility-first — no decoration
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
  const bg = c.bg ?? '#0a0a0f'
  set('--theme-bg', bg)
  set('--theme-bg-subtle', c.bgSubtle ?? '#0d0d14')

  // Surface tints — derive direction from isLight so light themes don't
  // end up with dark cards floating on a white page. CSS-side defaults
  // in globals.css are dark-theme tuned and would persist otherwise.
  //
  //   Dark themes:  raised/bubble are SLIGHTLY LIGHTER than bg
  //   Light themes: raised/bubble are SLIGHTLY DARKER than bg
  //
  // We use `color-mix` so the tint comes from the actual bg, not a
  // hardcoded color — themes with a tinted bg (e.g. solarized, sepia)
  // keep their tone.
  const isLight = !!theme.isLight
  const tintToward = isLight ? 'black' : 'white'
  set('--theme-bg-raised', c.bgRaised ?? `color-mix(in srgb, ${bg} 92%, ${tintToward})`)
  set('--theme-bubble', c.bubble ?? `color-mix(in srgb, ${bg} 88%, ${tintToward})`)
  // Mark the root with the theme polarity so any CSS rules that need to
  // branch on light vs dark (scrollbars, syntax highlight overrides, etc.)
  // can use a simple `:root[data-theme-mode="light"] ...` selector.
  root.setAttribute('data-theme-mode', isLight ? 'light' : 'dark')
  const themeKey = (theme as { key?: string }).key ?? ''
  root.setAttribute('data-backdrop', BACKDROP_BY_THEME[themeKey] ?? (isLight ? 'soft' : 'aurora'))
}

function convertPersistedMessages(rawMessages: any[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of rawMessages) {
    if (m.role === 'user') {
      // User messages are stored either as a plain string (text-only) or as
      // a multi-part array `[{type:'text'},{type:'image_url'}]` when the
      // user attached images. Split those parts back out so the renderer
      // shows real thumbnails instead of a JSON blob.
      let content: string
      let images: ImageAttachment[] | undefined
      if (typeof m.content === 'string') {
        content = m.content
      } else if (Array.isArray(m.content)) {
        const texts: string[] = []
        const imgs: ImageAttachment[] = []
        for (const part of m.content as any[]) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            texts.push(part.text)
          } else if (part?.type === 'image_url' && part.image_url?.url) {
            const url: string = part.image_url.url
            const m1 = url.match(/^data:([^;]+);base64,/)
            imgs.push({
              id: 'img_' + hex(),
              dataUrl: url,
              mediaType: m1?.[1] ?? 'image/png',
            })
          }
        }
        content = texts.join('\n')
        images = imgs.length > 0 ? imgs : undefined
      } else {
        content = ''
      }
      out.push({
        id: 'msg_' + hex(),
        type: 'user',
        content,
        timestamp: Date.now(),
        ...(images ? { images } : {}),
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
    mode: meta.mode === 'chat' ? 'chat' : meta.mode === 'browser' ? 'browser' : 'code',
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
    keepAliveInBackground: !!raw?.keepAliveInBackground,
    autoLaunch: !!raw?.autoLaunch,
    ...(raw?.remote && typeof raw.remote === 'object'
      ? { remote: {
          enabled: !!raw.remote.enabled,
          port: typeof raw.remote.port === 'number' ? raw.remote.port : 7843,
          devices: Array.isArray(raw.remote.devices) ? raw.remote.devices : [],
        } }
      : {}),
    // Auto-compact: enabled by default. Old configs without these fields
    // get the default-on behavior so the user benefits without having to
    // toggle anything. Threshold clamped to a sane band [0.5, 0.95].
    autoCompactEnabled: raw?.autoCompactEnabled === false ? false : true,
    autoCompactThreshold: clampThreshold(
      typeof raw?.autoCompactThreshold === 'number' ? raw.autoCompactThreshold : 0.85,
    ),
    costBudget: typeof raw?.costBudget === 'number' && raw.costBudget >= 0 ? raw.costBudget : 0,
    onboarded: !!raw?.onboarded,
  }
}

/** Keep auto-compact threshold within a sensible band. Below 0.5 means
 *  we'd compact constantly (every 50% fill); above 0.95 means we'd cut
 *  it too close to the limit and the next turn could still 400. */
function clampThreshold(v: number): number {
  if (!Number.isFinite(v)) return 0.85
  return Math.max(0.5, Math.min(0.95, v))
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: false,
  appConfig: DEFAULT_CONFIG,
  onboardingOpen: false,
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
  currentSegments: [],
  currentIteration: 0,
  currentUsage: null,
  lastPromptTokens: null,
  currentStats: null,
  lastUserPrompt: null,
  currentTasks: [],
  pendingApproval: null,
  pendingMCPApproval: null,
  mcpStatuses: {},
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
  compareOpen: false,
  researchOpen: false,
  documentsOpen: false,
  emailOpen: false,
  calendarOpen: false,
  previewOpen: false,
  previewUrl: null,
  previewTab: null,
  browserView: false,
  browserTabs: [],
  activeBrowserTabId: null,
  filesPanelOpen: false,
  activeDrawer: null,
  commandPaletteOpen: false,

  init: async () => {
    if (get().initialized || get().loading) return
    set({ loading: true })
    try {
      if (!(window as any).electron) {
        const { installBrowserMock } = await import('../dev-mocks/electron-browser')
        installBrowserMock()
      }
      // Defensive: tear down any subscriptions left over from a prior init
      // (Vite HMR boundary, an aborted init that didn't reach the `initialized`
      // flag, etc). Without this, a second init would double-fire every event.
      clearIpcSubscriptions()
      // Tiny helper that captures the unsubscribe so we can call it on
      // re-init / shutdown. Each on*() returns its own teardown closure.
      const sub = (off: () => void): void => { ipcUnsubs.push(off) }

      const themesResult = await window.electron.themes.list()
      const themes: Theme[] = themesResult.ok ? (themesResult.themes || []) : []

      const configResult = await window.electron.config.get()
      const appConfig = mergeConfig(configResult.ok ? configResult.config : null)

      if (!appConfig.lastCwd) {
        appConfig.lastCwd = await window.electron.project.defaultCwd()
      }

      const activeTheme = themes.find(t => (t as any).key === appConfig.theme) || themes[0] || null
      if (activeTheme) applyThemeToDom(activeTheme)

      set({ themes, activeTheme, appConfig, onboardingOpen: !appConfig.onboarded })

      sub(window.electron.agent.onText(({ sessionId, delta }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          const segs = s.currentSegments
          const last = segs[segs.length - 1]
          let nextSegs: MessageSegment[]
          if (last && last.kind === 'text') {
            nextSegs = [...segs.slice(0, -1), { ...last, content: last.content + delta }]
          } else {
            nextSegs = [...segs, { kind: 'text', id: 'seg_' + hex(8), content: delta }]
          }
          return {
            currentAssistantText: s.currentAssistantText + delta,
            currentSegments: nextSegs,
          }
        })
      }))

      sub(window.electron.agent.onThinking(({ sessionId, delta }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          const segs = s.currentSegments
          const last = segs[segs.length - 1]
          let nextSegs: MessageSegment[]
          if (last && last.kind === 'thinking') {
            nextSegs = [...segs.slice(0, -1), { ...last, content: last.content + delta }]
          } else {
            nextSegs = [...segs, { kind: 'thinking', id: 'seg_' + hex(8), content: delta }]
          }
          return {
            currentThinkingText: s.currentThinkingText + delta,
            currentSegments: nextSegs,
          }
        })
      }))

      sub(window.electron.agent.onToolCall(({ sessionId, call }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          // Flat tool list — keep for backcompat/onDone flattening.
          const existing = s.currentToolCalls.findIndex(tc => tc.id === call.id)
          const nextCalls = existing >= 0
            ? s.currentToolCalls.map((tc, i) => i === existing ? { ...tc, ...call } : tc)
            : [...s.currentToolCalls, call as ToolCallRecord]

          // Segment timeline — update in place if we've seen this call id
          // before, otherwise append a new tool segment at the current tail.
          const segIdx = s.currentSegments.findIndex(seg => seg.kind === 'tool' && seg.call.id === call.id)
          const nextSegs: MessageSegment[] = segIdx >= 0
            ? s.currentSegments.map((seg, i) =>
                i === segIdx && seg.kind === 'tool'
                  ? { ...seg, call: { ...seg.call, ...call } as ToolCallRecord }
                  : seg,
              )
            : [...s.currentSegments, { kind: 'tool', id: call.id, call: call as ToolCallRecord }]

          return { currentToolCalls: nextCalls, currentSegments: nextSegs }
        })
      }))

      sub(window.electron.agent.onIteration(({ sessionId, iteration }) => {
        if (sessionId !== get().activeSessionId) return
        set({ currentIteration: iteration })
      }))

      sub(window.electron.agent.onUsage(({ sessionId, usage }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => ({
          currentUsage: {
            promptTokens: (s.currentUsage?.promptTokens ?? 0) + usage.promptTokens,
            completionTokens: (s.currentUsage?.completionTokens ?? 0) + usage.completionTokens,
          },
          // Track last non-zero prompt count as the current context fill.
          lastPromptTokens: usage.promptTokens > 0 ? usage.promptTokens : s.lastPromptTokens,
        }))
      }))

      sub(window.electron.agent.onStats(({ sessionId, stats }) => {
        if (sessionId !== get().activeSessionId) return
        set({ currentStats: stats })
      }))

      sub(window.electron.agent.onTasks(({ sessionId, tasks }) => {
        if (sessionId !== get().activeSessionId) return
        set({ currentTasks: tasks as Task[] })
      }))

      sub(window.electron.agent.onApprovalRequest(({ sessionId, call }) => {
        // Only show approval modal for the visible session — a run on a
        // background session must not pop a modal over the user's current
        // chat. Main process keeps the request pending; switching back to
        // that session won't auto-show it (the modal was missed), but a
        // future event will, and the user can /stop the background run.
        if (sessionId !== get().activeSessionId) return
        set({ pendingApproval: { sessionId, call } })
      }))

      sub(window.electron.agent.onAskUser(({ sessionId, askId, question, options }) => {
        if (sessionId !== get().activeSessionId) return
        set({ pendingAsk: { sessionId, askId, question, options } })
      }))

      sub(window.electron.agent.onPlanExit(({ sessionId, plan }) => {
        if (sessionId !== get().activeSessionId) return
        set({ pendingPlan: { sessionId, plan } })
      }))

      sub(window.electron.agent.onDone(({ sessionId, text, usage, stats }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          if (!s.activeSession) {
            return {
              isRunning: false,
              currentAssistantText: '',
              currentThinkingText: '',
              currentToolCalls: [],
              currentSegments: [],
              currentUsage: null,
              currentStats: stats ?? s.currentStats,
              currentIteration: 0,
            }
          }
          const bubble: ChatMessage = {
            id: 'msg_' + hex(),
            type: 'assistant',
            content: text || s.currentAssistantText,
            timestamp: Date.now(),
            toolCalls: s.currentToolCalls.length > 0 ? s.currentToolCalls : undefined,
            segments: s.currentSegments.length > 0 ? s.currentSegments : undefined,
            meta: {
              model: s.activeSession.model,
              tokensPerSecond: stats?.tokensPerSecond ?? s.currentStats?.tokensPerSecond ?? null,
              completionTokens: usage.completionTokens,
            },
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
            currentSegments: [],
            currentUsage: null,
            // Preserve stats so StatusBar keeps showing context / last tps.
            currentStats: stats ?? s.currentStats,
            currentIteration: 0,
          }
        })
        void get().loadSessions()
      }))

      sub(window.electron.agent.onError(({ sessionId, error }) => {
        if (sessionId !== get().activeSessionId) return
        set((s) => {
          if (!s.activeSession) return { isRunning: false }
          const kind = classifyAgentError(error)
          const errMsg: ChatMessage = {
            id: 'msg_' + hex(),
            type: 'error',
            content: error,
            timestamp: Date.now(),
            errorKind: kind,
            // Only attach the retry prompt for failure modes where retry
            // makes sense — for auth errors, e.g., the user has to fix
            // credentials before any retry can possibly succeed.
            ...(kind === 'context_overflow' || kind === 'rate_limit' || kind === 'network' || kind === 'unsupported_history'
              ? { retryPrompt: s.lastUserPrompt ?? undefined }
              : {}),
          }
          return {
            activeSession: { ...s.activeSession, messages: [...s.activeSession.messages, errMsg] },
            isRunning: false,
            currentAssistantText: '',
            currentThinkingText: '',
            currentToolCalls: [],
            currentSegments: [],
          }
        })
      }))

      sub(window.electron.mcp.onApprovalRequest((data) => {
        set({ pendingMCPApproval: data })
      }))

      sub(window.electron.mcp.onStatus(({ name, status }) => {
        // Keep the latest status per server for the StatusBar indicator —
        // otherwise "did my MCP server connect?" is answerable only via
        // devtools console.
        set((s) => ({ mcpStatuses: { ...s.mcpStatuses, [name]: status } }))
      }))

      sub(window.electron.auth.onStatus(({ provider, method, message }) => {
        const curr = get().authFlowStatus
        if (!curr || curr.provider !== provider || curr.method !== method) {
          set({ authFlowStatus: { provider, method, messages: [message] } })
        } else {
          set({ authFlowStatus: { ...curr, messages: [...curr.messages, message] } })
        }
      }))

      // Live updates for background agents and cron
      sub(window.electron.bgAgents.onUpdate(() => { void get().loadBgAgents() }))
      sub(window.electron.cron.onFired(() => { void get().loadCronTasks() }))

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

  setCostBudget: async (usd: number) => {
    const { appConfig } = get()
    const v = Number.isFinite(usd) && usd >= 0 ? usd : 0
    const newConfig: AppConfig = { ...appConfig, costBudget: v }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig })
  },

  completeOnboarding: async () => {
    const { appConfig } = get()
    const newConfig: AppConfig = { ...appConfig, onboarded: true }
    await window.electron.config.save(newConfig)
    set({ appConfig: newConfig, onboardingOpen: false })
  },
  openOnboarding: () => set({ onboardingOpen: true }),

  // One-click fully-local: switch the active session to a detected local model
  // (Ollama, then LM Studio). $0, offline. No-op with a hint if none is up.
  goLocal: async () => {
    const { providers, activeSession } = get()
    if (!activeSession) return
    for (const id of ['ollama', 'lmstudio']) {
      const p = providers.find((pp) => pp.id === id && pp.authed)
      if (!p) continue
      try {
        const res = await window.electron.llm.listModels(id)
        const model = res.ok && res.models && res.models[0]?.id
        if (model) { await get().updateSessionModel(activeSession.id, id, model); return }
      } catch { /* try the next local provider */ }
    }
    set((s) => (s.activeSession ? {
      activeSession: {
        ...s.activeSession,
        messages: [...s.activeSession.messages, {
          id: `sys-${Date.now().toString(36)}`,
          type: 'assistant' as const,
          content: '*No local model detected. Start **Ollama** or **LM Studio** (with a model loaded), then try “Go fully local” again.*',
          timestamp: Date.now(),
        }],
      },
    } : {}))
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

  setAppConfig: async (next: AppConfig) => {
    // Persist + locally apply in lock-step. Main re-applies side-effects
    // (powerSaveBlocker, login items, tray menu) inside its config:save handler.
    await window.electron.config.save(next as any)
    set({ appConfig: next })
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
        case provider === 'anthropic' && method === 'oauth':
          result = await window.electron.auth.anthropicOAuth(); break
        case provider === 'openai' && method === 'oauth':
          result = await window.electron.auth.openaiOAuth(); break
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
    // Clear the live status banner once the flow has actually finished —
    // otherwise the SettingsModal banner would stay stuck on "Finishing…"
    // because the status state remains populated even after the IPC resolves.
    set({ authFlowStatus: null })
    return result
  },

  loadSessions: async () => {
    const result = await window.electron.session.list()
    if (result.ok && result.sessions) {
      set({ sessionList: result.sessions as SessionMeta[] })
    }
  },

  createSession: async (opts) => {
    // Browser sessions rarely get a chat message right away, which would
    // leave them "Untitled" in the sidebar — default them to "Browser".
    if (!opts.title && opts.mode === 'browser') opts = { ...opts, title: 'Browser' }
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
      currentSegments: [],
      currentUsage: null,
      lastPromptTokens: null,
      currentStats: null,
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
      // Clear *all* live + pending state when crossing the session boundary.
      // Previously we left pendingApproval / pendingMCPApproval / lastPromptTokens
      // dangling, which caused stale prompts from the OLD session's run to
      // pop up on the NEW session and the StatusBar to show the wrong
      // context-fill number for the first frame after switching.
      set({
        activeSession: toSessionFromMeta(meta, messages),
        activeSessionId: sessionId,
        // The browser surface is driven by the session's mode. Bind browserView
        // to it on switch so a stuck transient/agent-opened browser can't keep
        // showing over a chat/code session (and a browser session shows it).
        browserView: meta.mode === 'browser',
        currentAssistantText: '',
        currentThinkingText: '',
        currentToolCalls: [],
        currentSegments: [],
        currentUsage: null,
        currentStats: null,
        currentIteration: 0,
        pendingApproval: null,
        pendingMCPApproval: null,
        pendingAsk: null,
        pendingPlan: null,
        lastPromptTokens: 0,
        // isRunning is intentionally NOT cleared here — if the user switches
        // away during a run and back before it finishes, the StatusBar should
        // still show "running". onDone for the now-active session will flip
        // it false. (We rely on the main process serializing per-session.)
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

  setActiveSessionMode: async (mode: 'code' | 'chat') => {
    const id = get().activeSession?.id
    if (!id) return
    await window.electron.session.updateMode(id, mode)
    set((s) => ({
      activeSession: s.activeSession && s.activeSession.id === id ? { ...s.activeSession, mode } : s.activeSession,
    }))
    await get().loadSessions()
  },

  renameSession: async (sessionId: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    await window.electron.session.updateTitle(sessionId, trimmed)
    set((s) => ({
      activeSession: s.activeSession && s.activeSession.id === sessionId ? { ...s.activeSession, title: trimmed } : s.activeSession,
    }))
    await get().loadSessions()
  },

  sendMessage: async (message: string, images?: ImageAttachment[]) => {
    const initial = get()
    if (!initial.activeSessionId || !initial.activeSession || initial.isRunning) return

    // Slash commands always run locally and don't carry images.
    if (message.startsWith('/')) {
      const handled = await get().dispatchSlashCommand(message)
      if (handled) return
    }

    // ── Auto-compact pre-flight ──
    // The ratio we check is `lastPromptTokens / contextWindow` — i.e., how
    // full the LAST request was. We use that as a proxy for the upcoming
    // request because we can't know the exact size of a turn before
    // building it, but the fill is monotonically growing turn-over-turn
    // until we compact. If we were already 85%+ full last time, the next
    // turn will only be more, so compact NOW rather than letting the
    // provider 400. Skipped on first message (no last-turn data) and
    // when the user explicitly disabled it in Settings → Agent.
    const cfg = initial.appConfig
    const ctx = initial.currentStats?.contextWindow ?? 0
    const used = initial.lastPromptTokens ?? 0
    const threshold = cfg.autoCompactThreshold ?? 0.85
    if (
      cfg.autoCompactEnabled !== false &&
      ctx > 0 && used > 0 &&
      used / ctx >= threshold
    ) {
      // Yield to the UI so the typing-indicator / loading state is visible
      // during the brief compaction roundtrip — otherwise the user clicks
      // Send and sees nothing for ~1s.
      set({ isRunning: true })
      const r = await window.electron.sessionOps.compact(initial.activeSessionId, 6)
      if (r.ok && r.newSessionId) {
        await get().loadSessions()
        await get().switchSession(r.newSessionId)
        // Insert an inline note in the new session so the user sees what
        // just happened. Renderer-only (not persisted to DB) — survives
        // until reload, which is fine.
        const pct = Math.round((used / ctx) * 100)
        set((s) => {
          if (!s.activeSession) return {}
          const note: ChatMessage = {
            id: 'msg_' + hex(),
            type: 'assistant',
            content: `*Auto-compacted at ${pct}% context fill — older turns summarized into a brief note, recent turns kept verbatim. Continuing your message in this fresh session.*`,
            timestamp: Date.now(),
          }
          return { activeSession: { ...s.activeSession, messages: [...s.activeSession.messages, note] } }
        })
      }
      // Drop the temporary isRunning so the recursive call's own
      // isRunning check passes; the recursive sendMessage flips it back.
      set({ isRunning: false })
      // Recursive re-entry. Fresh state has lastPromptTokens=null after
      // switchSession, so this hits the normal path on the new session.
      return get().sendMessage(message, images)
    }

    const { activeSessionId, activeSession } = get()
    if (!activeSessionId || !activeSession) return

    const hasImages = !!images && images.length > 0
    const userMsg: ChatMessage = {
      id: 'msg_' + hex(),
      type: 'user',
      content: message,
      timestamp: Date.now(),
      ...(hasImages ? { images } : {}),
    }
    set((s) => ({
      activeSession: s.activeSession ? { ...s.activeSession, messages: [...s.activeSession.messages, userMsg] } : null,
      isRunning: true,
      currentAssistantText: '',
      currentThinkingText: '',
      currentToolCalls: [],
      currentSegments: [],
      currentUsage: null,
      currentIteration: 0,
      // Stash for one-click retry after recoverable failures (context overflow, etc.).
      lastUserPrompt: message,
    }))

    if ((activeSession.title === 'Untitled' || !activeSession.title) && activeSession.messages.length === 0) {
      // Image-only sends still need a title — fall back to a friendly stub
      // rather than leaving "Untitled" forever.
      const newTitle = message.trim()
        ? message.split('\n')[0].slice(0, 60)
        : hasImages ? `Image (${images!.length})` : 'Untitled'
      await window.electron.session.updateTitle(activeSessionId, newTitle)
      set((s) => ({
        activeSession: s.activeSession ? { ...s.activeSession, title: newTitle } : null,
        // Patch the sidebar list in place too — onDone reloads it, but that
        // can be a minute away and "Untitled" shouldn't linger that long.
        sessionList: s.sessionList.map((m) => (m.id === activeSessionId ? { ...m, title: newTitle } : m)),
      }))
    }

    // Which full-page surfaces are open — the agent only loads a surface's
    // tools when it's active, keeping the request lean (the ChatGPT Codex OAuth
    // backend rejects large tool payloads).
    const surf = get()
    const activeSurfaces: string[] = []
    if (surf.browserView || surf.activeSession?.mode === 'browser') activeSurfaces.push('browser')
    if (surf.documentsOpen) activeSurfaces.push('documents')
    if (surf.emailOpen) activeSurfaces.push('email')
    if (surf.calendarOpen) activeSurfaces.push('calendar')
    if (surf.activeDrawer === 'notes') activeSurfaces.push('notes')

    await window.electron.agent.send({
      sessionId: activeSessionId,
      message,
      activeSurfaces,
      ...(hasImages
        ? { images: images!.map(img => ({ id: img.id, dataUrl: img.dataUrl, mediaType: img.mediaType, name: img.name })) }
        : {}),
    })
  },

  abortCurrent: async () => {
    const { activeSessionId } = get()
    if (!activeSessionId) return
    // Don't optimistically flip isRunning here. The agent loop has to finish
    // its current iteration before it sees the abort signal, after which it
    // emits agent:done with `aborted: true`. If we cleared the flag now, the
    // user could fire off a new sendMessage during the gap and main.ts would
    // reject it with "A run is already in progress" — confusing UX. Letting
    // onDone be the single source of truth keeps the UI honest.
    await window.electron.agent.abort(activeSessionId)
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
      case 'cookbook': case 'models': {
        get().setDrawer('cookbook')
        return true
      }
      case 'notes': case 'tasks': case 'todo': {
        get().setDrawer('notes')
        return true
      }
      case 'context': case 'cockpit': {
        get().setDrawer('cockpit')
        return true
      }
      case 'local': case 'offline': {
        get().goLocal()
        return true
      }
      case 'browser': {
        get().setBrowserView(true)
        return true
      }
      case 'compare': case 'vs': case 'council': {
        get().openCompare()
        return true
      }
      case 'research': case 'deep': {
        get().openResearch()
        return true
      }
      case 'docs': case 'documents': {
        get().openDocuments()
        return true
      }
      case 'email': case 'mail': {
        get().openEmail()
        return true
      }
      case 'calendar': case 'cal': {
        get().openCalendar()
        return true
      }
      case 'settings': case 'config': {
        get().openSettings()
        return true
      }
      case 'init': {
        // Scaffold a CODEMAXXING.md by handing the agent a precise, self-
        // contained instruction. We don't echo `/init` itself — we send the
        // expanded prompt as if the user typed it, so the agent's reply
        // reads naturally in the transcript.
        const initPrompt =
          'Please create a CODEMAXXING.md file at the repo root for this project. ' +
          'First read package.json, README (if any), and the top-level directory layout to derive accurate content — do not invent. ' +
          'The file should be a concise project brief (under ~200 lines) covering: one-paragraph overview, stack (languages/frameworks/key libs/package manager), directory layout (only the parts that matter), commands (exact invocations for install/dev/build/test/lint/typecheck), architectural notes & conventions, gotchas, and any project-specific rules. ' +
          'Use markdown with ## section headings. ' +
          'If CODEMAXXING.md already exists, propose targeted edits via edit_file rather than overwriting. ' +
          'Do NOT create a CLAUDE.md or AGENTS.md — this app is CODEMAXXING.'
        await get().sendMessage(initPrompt)
        return true
      }
      case 'help': {
        pushUserEcho(trimmed)
        pushSystemMessage(
          [
            '**Slash commands**',
            '- `/init` — scaffold a CODEMAXXING.md project-rules file',
            '- `/diff [staged]` · `/status` · `/log [n]` — inspect git',
            '- `/commit <msg>` · `/push` · `/undo` — git actions (auto-stages for commit)',
            '- `/cost` — current session cost',
            '- `/compact [keep]` — summarize old history into a fresh session',
            '- `/checkpoint [label]` — save snapshot · `/checkpoints` — open drawer',
            '- `/skills` — show active · `/think <level>` — reasoning effort',
            '- `/memory [query]` — stats or search',
            '- `/bg` · `/cron` · `/cookbook` — open drawers · `/settings` — open settings',
            '- `/compare` — run one prompt across multiple models side-by-side',
            '- `/council` — best-of-N: several models answer, one synthesizes the best',
            '- `/research` — deep web research → a cited report',
            '- `/notes` — quick notes & tasks drawer',
            '- `/context` — context cockpit: see the model\'s window + compact/checkpoint',
            '- `/local` — switch this session to a local model ($0, offline)',
            '- `/browser` — open the built-in browser (the agent can drive it)',
            '- `/docs` — AI-assisted documents editor',
            '- `/email` · `/calendar` — inbox & schedule (configure in-panel)',
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

  compactAndRetry: async (prompt: string, keepRecent = 6) => {
    // Same compact flow → switch to the new session → re-send the prompt.
    // We do these sequentially because sendMessage requires the activeSession
    // to be the one we want to send to, and switchSession is what flips it.
    const { activeSessionId } = get()
    if (!activeSessionId) return
    const r = await window.electron.sessionOps.compact(activeSessionId, keepRecent)
    if (!r.ok || !r.newSessionId) return
    await get().loadSessions()
    await get().switchSession(r.newSessionId)
    // Retry. The new session won't have the user's pending prompt in its
    // history, so this re-runs cleanly against the summarized context.
    await get().sendMessage(prompt)
  },

  pickDirectory: async () => {
    const result = await window.electron.project.pickDirectory()
    if (!result.ok || !result.path) return null
    await get().setLastCwd(result.path)
    return result.path
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openCompare: () => set({ compareOpen: true }),
  closeCompare: () => set({ compareOpen: false }),
  openResearch: () => set({ researchOpen: true }),
  closeResearch: () => set({ researchOpen: false }),
  // Full-page surfaces (browser / documents / email / calendar / notes) are
  // mutually exclusive — opening one closes the others so ⌘K can switch
  // between them without leaving a stale surface "underneath".
  openDocuments: () => set({ documentsOpen: true, emailOpen: false, calendarOpen: false, browserView: false, activeDrawer: null }),
  closeDocuments: () => set({ documentsOpen: false }),
  openEmail: () => set({ emailOpen: true, documentsOpen: false, calendarOpen: false, browserView: false, activeDrawer: null }),
  closeEmail: () => set({ emailOpen: false }),
  openCalendar: () => set({ calendarOpen: true, documentsOpen: false, emailOpen: false, browserView: false, activeDrawer: null }),
  closeCalendar: () => set({ calendarOpen: false }),
  togglePreview: () => set((s) => ({ previewOpen: !s.previewOpen })),
  setPreviewOpen: (open: boolean) => set({ previewOpen: open }),
  openPreview: (url: string) => set({ previewOpen: true, previewUrl: url }),
  setPreviewTab: (tab) => set({ previewTab: tab }),
  openBrowserPanel: () => set((s) => {
    const off = { documentsOpen: false, emailOpen: false, calendarOpen: false, activeDrawer: null }
    if (s.browserTabs.length) return { browserView: true, ...off }
    const t = freshTab()
    return { browserView: true, browserTabs: [t], activeBrowserTabId: t.id, ...off }
  }),
  toggleBrowserView: () => set((s) => {
    if (s.browserView) return { browserView: false }
    const off = { documentsOpen: false, emailOpen: false, calendarOpen: false, activeDrawer: null }
    if (s.browserTabs.length) return { browserView: true, ...off }
    const t = freshTab()
    return { browserView: true, browserTabs: [t], activeBrowserTabId: t.id, ...off }
  }),
  setBrowserView: (open: boolean) => set((s) => {
    if (!open) return { browserView: false }
    const off = { documentsOpen: false, emailOpen: false, calendarOpen: false, activeDrawer: null }
    if (s.browserTabs.length) return { browserView: true, ...off }
    const t = freshTab()
    return { browserView: true, browserTabs: [t], activeBrowserTabId: t.id, ...off }
  }),
  exitBrowser: async () => {
    set({ browserView: false })
    const s = get()
    // A browser-type session keeps the takeover up (its mode drives the view),
    // so leaving means switching to another session. Prefer the most recent
    // non-browser one; otherwise drop to the empty state.
    if (s.activeSession?.mode === 'browser') {
      const next = s.sessionList.find((m) => m.id !== s.activeSessionId && m.mode !== 'browser')
      if (next) await get().switchSession(next.id)
      else set({ activeSessionId: null, activeSession: null })
    }
  },
  addBrowserTab: (url) => set((s) => {
    const t: BrowserTabState = { id: 'tab_' + Math.random().toString(36).slice(2, 9), url: url ?? '', title: url ? '' : 'New tab', loading: !!url }
    return { browserTabs: [...s.browserTabs, t], activeBrowserTabId: t.id }
  }),
  closeBrowserTab: (id) => set((s) => {
    const idx = s.browserTabs.findIndex((t) => t.id === id)
    const tabs = s.browserTabs.filter((t) => t.id !== id)
    let active = s.activeBrowserTabId
    if (active === id) active = tabs.length ? tabs[Math.max(0, idx - 1)].id : null
    return { browserTabs: tabs, activeBrowserTabId: active }
  }),
  setActiveBrowserTab: (id) => set({ activeBrowserTabId: id }),
  updateBrowserTab: (id, patch) => set((s) => ({ browserTabs: s.browserTabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  toggleFilesPanel: () => set((s) => ({ filesPanelOpen: !s.filesPanelOpen })),
  setFilesPanelOpen: (open: boolean) => set({ filesPanelOpen: open }),
  setDrawer: (drawer) => set(drawer === 'notes'
    ? { activeDrawer: 'notes', documentsOpen: false, emailOpen: false, calendarOpen: false, browserView: false }
    : { activeDrawer: drawer }),
  setCommandPaletteOpen: (open: boolean) => set({ commandPaletteOpen: open }),
}))

/**
 * Heuristic-classify an agent error string into recovery categories. The
 * provider error messages aren't standardized — Anthropic, OpenAI Responses
 * API, OpenRouter, LM Studio, Ollama all phrase the same conditions
 * differently — so we match against substrings for each known shape.
 *
 * Categories drive the in-chat error renderer's recovery actions:
 *   context_overflow → offer "Compact & retry" (forks session with summary)
 *   rate_limit       → offer "Retry in 30s" (auto-retry after backoff)
 *   network          → offer "Retry"
 *   auth             → no retry; point user at Settings → Providers
 *   generic          → no retry; just show the message
 */
function classifyAgentError(error: string): NonNullable<ChatMessage['errorKind']> {
  const lower = error.toLowerCase()
  if (
    lower.includes('context window') ||
    lower.includes('context length') ||
    lower.includes('exceeds the context') ||
    lower.includes('exceed the context') ||
    lower.includes('input is too long') ||
    lower.includes('maximum context length') ||
    lower.includes('too many tokens') ||
    lower.includes('prompt is too long') ||
    /tokens?.*\b(exceed|over|too)/i.test(error)
  ) return 'context_overflow'
  if (
    lower.includes('rate limit') ||
    lower.includes('rate-limit') ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('quota')
  ) return 'rate_limit'
  if (
    lower.includes('unauthor') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('expired token') ||
    lower.includes('access token') ||
    lower.includes('401')
  ) return 'auth'
  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('failed to fetch') ||
    lower.includes('network')
  ) return 'network'
  // Strict-server schema errors. Some self-hosted OpenAI-compat servers
  // (older llama.cpp, llamafile, vLLM forks) reject input messages that
  // include `tool_calls`, `role: 'tool'`, or multi-part content with
  // 5xx + a generic-sounding "Expected 'content' to be a string or an
  // array" message — even when content was fine and tool_calls is the
  // real problem. The recovery is the same as context_overflow:
  // compact-and-retry, which forks the session with a clean prose
  // summary and drops the structured tool-call history.
  if (
    /content.*string.*array|expected.*content/i.test(error) ||
    /(invalid|unexpected).*(tool_calls|role)/i.test(error) ||
    /tool_calls.*not.*supported/i.test(error)
  ) return 'unsupported_history'
  return 'generic'
}

function defaultModelsFor(providerId: string): ModelInfo[] {
  if (providerId === 'anthropic') {
    return [
      { name: 'claude-opus-4-7', id: 'claude-opus-4-7' },
      { name: 'claude-opus-4-6', id: 'claude-opus-4-6' },
      { name: 'claude-sonnet-4-6', id: 'claude-sonnet-4-6' },
      { name: 'claude-haiku-4-5-20251001', id: 'claude-haiku-4-5-20251001' },
    ]
  }
  if (providerId === 'openai') {
    return [
      { name: 'gpt-5.5-pro', id: 'gpt-5.5-pro' },
      { name: 'gpt-5.5', id: 'gpt-5.5' },
      { name: 'gpt-5.4-pro', id: 'gpt-5.4-pro' },
      { name: 'gpt-5.4', id: 'gpt-5.4' },
      { name: 'gpt-5', id: 'gpt-5' },
      { name: 'gpt-5-mini', id: 'gpt-5-mini' },
      { name: 'gpt-4.1', id: 'gpt-4.1' },
      { name: 'gpt-4.1-mini', id: 'gpt-4.1-mini' },
      { name: 'o3', id: 'o3' },
      { name: 'o4-mini', id: 'o4-mini' },
      { name: 'gpt-4o', id: 'gpt-4o' },
    ]
  }
  if (providerId === 'qwen') {
    return [
      { name: 'qwen-max', id: 'qwen-max' },
      { name: 'qwen-plus', id: 'qwen-plus' },
      { name: 'qwen-turbo', id: 'qwen-turbo' },
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
