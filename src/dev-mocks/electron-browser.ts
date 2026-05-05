// Browser-only mock of window.electron for running the renderer in a plain
// browser (vite dev server without Electron). Installed from main.tsx only when
// window.electron is missing — has no effect in the real Electron app.

const noop = () => () => {}
const ok = (extra: Record<string, unknown> = {}) => Promise.resolve({ ok: true, ...extra })

// Themes mirror what `themes:list` returns from main.ts. Keep these two
// lists in lock-step or browser-only dev mode shows a different list than
// the packaged app does.
const MOCK_THEMES = [
  // Light themes first — same ordering as main.ts
  { key: 'light', name: 'Light', description: 'Clean white background — the new default for daytime work', isLight: true, colors: { primary: '#2563EB', secondary: '#7C3AED', muted: '#52525B', text: '#18181B', userInput: '#18181B', response: '#18181B', tool: '#2563EB', toolResult: '#52525B', error: '#DC2626', success: '#16A34A', warning: '#D97706', border: '#D4D4D8', suggestion: '#7C3AED', bg: '#FFFFFF', bgSubtle: '#F4F4F5' } },
  { key: 'github-light', name: 'GitHub Light', description: 'Familiar GitHub palette — clean & professional', isLight: true, colors: { primary: '#0969DA', secondary: '#8250DF', muted: '#656D76', text: '#1F2328', userInput: '#1F2328', response: '#1F2328', tool: '#0969DA', toolResult: '#656D76', error: '#CF222E', success: '#1A7F37', warning: '#9A6700', border: '#D1D9E0', suggestion: '#8250DF', bg: '#FFFFFF', bgSubtle: '#F6F8FA' } },
  { key: 'solarized-light', name: 'Solarized Light', description: 'Classic warm cream — gentle on the eyes for long sessions', isLight: true, colors: { primary: '#268BD2', secondary: '#6C71C4', muted: '#657B83', text: '#073642', userInput: '#073642', response: '#073642', tool: '#268BD2', toolResult: '#657B83', error: '#DC322F', success: '#859900', warning: '#B58900', border: '#93A1A1', suggestion: '#6C71C4', bg: '#FDF6E3', bgSubtle: '#EEE8D5' } },
  { key: 'paper', name: 'Paper', description: 'Warm cream notebook — like writing on real paper', isLight: true, colors: { primary: '#8B6332', secondary: '#6E5B4F', muted: '#6B6B5E', text: '#2C2A26', userInput: '#2C2A26', response: '#2C2A26', tool: '#5A6E8F', toolResult: '#6B6B5E', error: '#A4424C', success: '#5C7A3E', warning: '#B5882B', border: '#D9D2C5', suggestion: '#8B6332', bg: '#FAF7F2', bgSubtle: '#F0EBE0' } },
  { key: 'high-contrast-light', name: 'High Contrast Light', description: 'Maximum legibility — accessibility-first', isLight: true, colors: { primary: '#0033CC', secondary: '#6B0099', muted: '#3F3F3F', text: '#000000', userInput: '#000000', response: '#000000', tool: '#0033CC', toolResult: '#3F3F3F', error: '#B00020', success: '#006600', warning: '#8C5400', border: '#9CA3AF', suggestion: '#6B0099', bg: '#FFFFFF', bgSubtle: '#F2F2F2' } },

  // Dark themes — muted/text contrast bumped on the worst offenders
  // (tokyo-night, hacker, blood-moon, synthwave) for legibility
  { key: 'codemaxxing', name: 'Codemaxxing', description: 'Default dark — calm, balanced, easy on the eyes', colors: { primary: '#7AA2F7', secondary: '#BB9AF7', muted: '#9AA5CE', text: '#C0CAF5', userInput: '#9ECE6A', response: '#C0CAF5', tool: '#7DCFFF', toolResult: '#9AA5CE', error: '#F7768E', success: '#9ECE6A', warning: '#E0AF68', border: '#565F89', suggestion: '#BB9AF7', bg: '#0a0a0f', bgSubtle: '#0d0d14' } },
  { key: 'cyberpunk-neon', name: 'Cyberpunk Neon', description: 'Electric cyan & magenta — Night City terminal', colors: { primary: '#00FFFF', secondary: '#FF00FF', muted: '#5FB5B5', text: '#C0FFFF', userInput: '#00FFFF', response: '#00FFFF', tool: '#FF00FF', toolResult: '#5FB5B5', error: '#FF3355', success: '#00FF88', warning: '#FF8C00', border: '#00FFFF', suggestion: '#FF00FF', bg: '#0a0010', bgSubtle: '#12001e' } },
  { key: 'dracula', name: 'Dracula', description: 'Dark purple tones', colors: { primary: '#BD93F9', secondary: '#FF79C6', muted: '#8E9AC2', text: '#F8F8F2', userInput: '#8BE9FD', response: '#BD93F9', tool: '#FF79C6', toolResult: '#8E9AC2', error: '#FF5555', success: '#50FA7B', warning: '#FFB86C', border: '#44475A', suggestion: '#FF79C6', bg: '#282A36', bgSubtle: '#21222C' } },
  { key: 'gruvbox', name: 'Gruvbox', description: 'Warm retro tones', colors: { primary: '#FE8019', secondary: '#FABD2F', muted: '#A89984', text: '#EBDBB2', userInput: '#83A598', response: '#FE8019', tool: '#FABD2F', toolResult: '#A89984', error: '#FB4934', success: '#B8BB26', warning: '#FABD2F', border: '#3C3836', suggestion: '#FABD2F', bg: '#1D2021', bgSubtle: '#282828' } },
  { key: 'nord', name: 'Nord', description: 'Cool arctic blues', colors: { primary: '#88C0D0', secondary: '#81A1C1', muted: '#7B89A0', text: '#ECEFF4', userInput: '#88C0D0', response: '#81A1C1', tool: '#5E81AC', toolResult: '#7B89A0', error: '#BF616A', success: '#A3BE8C', warning: '#EBCB8B', border: '#3B4252', suggestion: '#88C0D0', bg: '#2E3440', bgSubtle: '#292E39' } },
  { key: 'mono', name: 'Mono', description: 'Clean monochrome — easy on the eyes', colors: { primary: '#AAAAAA', secondary: '#FFFFFF', muted: '#888888', text: '#E5E5E5', userInput: '#AAAAAA', response: '#FFFFFF', tool: '#CCCCCC', toolResult: '#888888', error: '#FF6666', success: '#66FF66', warning: '#FFAA66', border: '#333333', suggestion: '#FFFFFF', bg: '#0a0a0a', bgSubtle: '#111111' } },
  { key: 'solarized', name: 'Solarized Dark', description: 'Solarized dark — the original', colors: { primary: '#268BD2', secondary: '#2AA198', muted: '#839496', text: '#93A1A1', userInput: '#2AA198', response: '#268BD2', tool: '#B58900', toolResult: '#839496', error: '#DC322F', success: '#859900', warning: '#CB4B16', border: '#073642', suggestion: '#2AA198', bg: '#002B36', bgSubtle: '#073642' } },
  { key: 'hacker', name: 'Hacker', description: 'Green on black — classic terminal', colors: { primary: '#00FF00', secondary: '#00CC00', muted: '#00AA00', text: '#33FF33', userInput: '#00FF00', response: '#00FF00', tool: '#00CC00', toolResult: '#00AA00', error: '#FF0000', success: '#00FF00', warning: '#FFFF00', border: '#003300', suggestion: '#00CC00', bg: '#000000', bgSubtle: '#050505' } },
  { key: 'catppuccin', name: 'Catppuccin', description: 'Soothing pastel — Mocha flavor', colors: { primary: '#CBA6F7', secondary: '#F5C2E7', muted: '#9399B2', text: '#CDD6F4', userInput: '#89DCEB', response: '#CBA6F7', tool: '#F5C2E7', toolResult: '#9399B2', error: '#F38BA8', success: '#A6E3A1', warning: '#FAB387', border: '#45475A', suggestion: '#F5C2E7', bg: '#1E1E2E', bgSubtle: '#181825' } },
  { key: 'tokyo-night', name: 'Tokyo Night', description: 'Rain-soaked Shibuya — neon signs in the dark', colors: { primary: '#FF7AC6', secondary: '#7DCFFF', muted: '#7B85B0', text: '#C0CAF5', userInput: '#FF9E64', response: '#FF7AC6', tool: '#7DCFFF', toolResult: '#7B85B0', error: '#F7768E', success: '#73DACA', warning: '#FF9E64', border: '#2A2E40', suggestion: '#7DCFFF', bg: '#1A1B26', bgSubtle: '#16161E' } },
  { key: 'one-dark', name: 'One Dark', description: 'Atom editor classic', colors: { primary: '#61AFEF', secondary: '#C678DD', muted: '#828997', text: '#ABB2BF', userInput: '#56B6C2', response: '#61AFEF', tool: '#C678DD', toolResult: '#828997', error: '#E06C75', success: '#98C379', warning: '#E5C07B', border: '#3E4451', suggestion: '#C678DD', bg: '#282C34', bgSubtle: '#21252B' } },
  { key: 'rose-pine', name: 'Rosé Pine', description: 'Elegant dark florals', colors: { primary: '#EBBCBA', secondary: '#C4A7E7', muted: '#908CAA', text: '#E0DEF4', userInput: '#9CCFD8', response: '#EBBCBA', tool: '#C4A7E7', toolResult: '#908CAA', error: '#EB6F92', success: '#31748F', warning: '#F6C177', border: '#403D52', suggestion: '#C4A7E7', bg: '#191724', bgSubtle: '#1F1D2E' } },
  { key: 'synthwave', name: 'Synthwave', description: 'Retro 80s sunset — outrun aesthetics', colors: { primary: '#F92AAD', secondary: '#E9F501', muted: '#9C84C7', text: '#F4EEFF', userInput: '#36F9F6', response: '#F92AAD', tool: '#E9F501', toolResult: '#9C84C7', error: '#FE4450', success: '#72F1B8', warning: '#FF7F11', border: '#2A1B4E', suggestion: '#36F9F6', bg: '#1A0A2E', bgSubtle: '#0F0020' } },
  { key: 'blood-moon', name: 'Blood Moon', description: 'Dark crimson — for the night coders', colors: { primary: '#FF4444', secondary: '#CC2936', muted: '#A87575', text: '#F0D8D8', userInput: '#FF6B6B', response: '#FF4444', tool: '#CC2936', toolResult: '#A87575', error: '#FF0000', success: '#4CAF50', warning: '#FF8C00', border: '#3C1515', suggestion: '#CC2936', bg: '#1A0606', bgSubtle: '#0F0303' } },
  { key: 'hot-dog', name: 'Hot Dog', description: 'Cursed ketchup & mustard — you asked for it', colors: { primary: '#FF0000', secondary: '#FFFF00', muted: '#D8A040', text: '#FFFF00', userInput: '#FF0000', response: '#FFFF00', tool: '#FF6600', toolResult: '#D8A040', error: '#FF0000', success: '#00FF00', warning: '#FFFF00', border: '#552200', suggestion: '#FFFF00', bg: '#1A0000', bgSubtle: '#0F0000' } },
  { key: 'acid', name: 'Acid', description: 'Every color at once — sensory overload', colors: { primary: '#FF00FF', secondary: '#00FF88', muted: '#FF9933', text: '#FFFF00', userInput: '#00FFFF', response: '#FF3399', tool: '#33FF00', toolResult: '#FF9933', error: '#FF0044', success: '#00FF66', warning: '#FFD700', border: '#FF00AA', suggestion: '#00FFCC', bg: '#1A001A', bgSubtle: '#0F000F' } },
]

const MOCK_PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 200+ models with one API key — most popular aggregator',
    methods: ['oauth', 'api-key'],
    baseUrl: 'https://openrouter.ai/api/v1',
    consoleUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Claude Opus, Sonnet, Haiku — official API',
    methods: ['setup-token', 'api-key'],
    baseUrl: 'https://api.anthropic.com/v1',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o mini, o-series',
    methods: ['api-key'],
    baseUrl: 'https://api.openai.com/v1',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'qwen',
    name: 'Qwen (DashScope)',
    description: 'Alibaba Qwen models — Qwen CLI compatible',
    methods: ['cached-token', 'api-key'],
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    consoleUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 2.0 Flash, Pro',
    methods: ['api-key'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description: 'Pair with your Copilot subscription — device flow login',
    methods: ['device-flow'],
    baseUrl: 'https://api.githubcopilot.com',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    description: 'Run models locally — no API key needed',
    methods: ['none'],
    baseUrl: 'http://127.0.0.1:11434/v1',
    local: true,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    description: 'Local OpenAI-compatible server',
    methods: ['none'],
    baseUrl: 'http://127.0.0.1:1234/v1',
    local: true,
  },
  {
    id: 'custom',
    name: 'Custom / OpenAI-compatible',
    description: 'Any OpenAI-compatible endpoint',
    methods: ['api-key'],
    baseUrl: '',
  },
]

const MOCK_DETECTED = [
  {
    provider: 'anthropic',
    method: 'setup-token',
    description: 'Claude Code CLI detected — link your Anthropic subscription',
  },
]

export function installBrowserMock(): void {
  if (typeof window === 'undefined') return
  if ((window as any).electron) return

  ;(window as any).electron = {
    openFile: () => ok(),
    openDirectory: () => Promise.resolve(null),
    openExternal: async (url: string) => {
      window.open(url, '_blank')
    },
    showItemInFolder: () => ok(),
    clipboard: {
      writeText: (text: string) => navigator.clipboard.writeText(text).then(() => true).catch(() => false),
      readText: () => navigator.clipboard.readText().catch(() => ''),
    },
    window: { minimize: () => ok(), maximize: () => ok(), close: () => ok() },
    app: {
      getVersion: () => Promise.resolve('0.0.0-browser'),
      getPlatform: () => Promise.resolve('browser'),
      getPath: () => Promise.resolve('/'),
      getHomeDir: () => Promise.resolve('/Users/you'),
    },

    session: {
      create: () => ok({ session: null }),
      list: () => ok({ sessions: [] }),
      get: () => ok({ session: null, messages: [] }),
      delete: () => ok(),
      updateTitle: () => ok(),
      updateModel: () => ok(),
      setCwd: () => ok(),
    },

    agent: {
      send: () => ok(),
      abort: () => ok(),
      approvalResponse: () => ok(),
      askUserResponse: () => ok(),
      onStarted: noop,
      onText: noop,
      onThinking: noop,
      onIteration: noop,
      onToolCall: noop,
      onTasks: noop,
      onApprovalRequest: noop,
      onAskUser: noop,
      onPlanExit: noop,
      onUsage: noop,
      onStats: noop,
      onDone: noop,
      onError: noop,
    },

    mcp: { approvalResponse: () => {}, onStatus: noop, onApprovalRequest: noop },

    auth: {
      list: () => ok({ credentials: [] }),
      save: () => ok(),
      delete: () => ok(),
      providers: () => ok({ providers: MOCK_PROVIDERS }),
      detect: () => ok({ detected: MOCK_DETECTED }),
      apiKey: () => ok({ credential: null }),
      openrouterOAuth: () => ok({ credential: null }),
      anthropicOAuth: () => ok({ credential: null }),
      openaiOAuth: () => ok({ credential: null }),
      anthropicSetupToken: () => ok({ credential: null }),
      copilotDeviceFlow: () => ok({ credential: null }),
      importCodex: () => ok({ credential: null }),
      importQwen: () => ok({ credential: null }),
      onStatus: noop,
    },

    // Real local-provider probes — even in browser dev mode, hit LM Studio /
    // Ollama directly so the New Session model dropdown actually populates.
    // Both servers ship with permissive CORS so cross-origin fetch works from
    // localhost:5173. Anything else (including all hosted providers) returns
    // empty since we have no API key path in the browser shim.
    llm: {
      listModels: async (providerId: string) => {
        try {
          if (providerId === 'lmstudio') {
            const r = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(3000) })
            if (!r.ok) return { ok: false, error: `LM Studio returned ${r.status}` }
            const j = await r.json()
            return { ok: true, models: (j.data || []).map((m: any) => ({ id: m.id, name: m.id })) }
          }
          if (providerId === 'ollama') {
            const r = await fetch('http://127.0.0.1:11434/v1/models', { signal: AbortSignal.timeout(3000) })
            if (!r.ok) return { ok: false, error: `Ollama returned ${r.status}` }
            const j = await r.json()
            return { ok: true, models: (j.data || []).map((m: any) => ({ id: m.id, name: m.id })) }
          }
        } catch (e: any) {
          return { ok: false, error: String(e?.message ?? e) }
        }
        return { ok: true, models: [] }
      },
      testConnection: () => ok(),
    },
    ollama: {
      isRunning: async () => {
        try {
          const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) })
          return r.ok
        } catch { return false }
      },
      listModels: async () => {
        try {
          const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })
          if (!r.ok) return { ok: false, error: `Ollama returned ${r.status}` }
          const j = await r.json()
          return { ok: true, models: (j.models || []).map((m: any) => ({ name: m.name, size: m.size })) }
        } catch (e: any) {
          return { ok: false, error: String(e?.message ?? e) }
        }
      },
    },

    config: {
      get: () =>
        ok({
          config: {
            theme: 'codemaxxing',
            autoApprove: false,
            approvalMode: 'suggest' as const,
            reasoningEffort: 'off' as const,
            activeSkillIds: [],
            lastCwd: null,
            lastProvider: null,
            lastModel: null,
          },
        }),
      save: () => ok(),
    },

    themes: { list: () => ok({ themes: MOCK_THEMES }) },

    // Browser-mode stub. Real remote-access lives entirely in main.ts so
    // there's no point implementing it here — we just satisfy the shape so
    // SettingsModal renders without crashing and shows "Remote: off".
    remote: {
      status: () => Promise.resolve({ ok: true, enabled: false, running: false, port: 7843, devices: [], addresses: ['http://127.0.0.1:7843'] }),
      setEnabled: () => Promise.resolve({ ok: false, error: 'Remote access requires the desktop app' }),
      setPort: () => Promise.resolve({ ok: false, error: 'Remote access requires the desktop app' }),
      beginPairing: () => Promise.resolve({ ok: false, error: 'Remote access requires the desktop app' }),
      cancelPairing: () => Promise.resolve({ ok: true }),
      revokeDevice: () => Promise.resolve({ ok: false, error: 'Remote access requires the desktop app' }),
      onDevicesChanged: () => () => { /* no-op in browser */ },
    },

    project: {
      pickDirectory: () => ok({ path: undefined, name: undefined }),
      defaultCwd: () => Promise.resolve('/Users/you'),
    },

    files: {
      search: () => ok({ files: [] }),
      tree: () => ok({ entries: [] }),
      read: () => ok({ binary: false, content: '', ext: '', size: 0, truncated: false, mtime: 0 }),
      write: () => ok({ mtime: Date.now(), size: 0 }),
      getPathForFile: () => '',
    },

    run: { start: () => ok(), stop: () => ok(), onStarted: noop, onOutput: noop, onExit: noop },

    memory: {
      list: () => ok({ memories: [] }),
      recall: () => ok({ memories: [] }),
      remember: () => ok({ id: 0 }),
      forget: () => ok(),
      stats: () => ok({ stats: { total: 0, byType: {} } }),
    },

    hooks: {
      list: () => ok({ hooks: [] }),
      saveGlobal: () => ok(),
    },

    git: {
      summary: () => ok({ summary: { isRepo: false } }),
      status: () => ok({ status: '(clean)' }),
      diff: () => ok({ diff: '(no diff)' }),
      log: () => ok({ log: '(no history)' }),
      commit: () => ok({ result: 'Mock: no changes' }),
      push: () => ok({ result: 'Mock: no push in browser' }),
      undo: () => ok({ result: 'Mock: no undo in browser' }),
    },

    skills: {
      list: () => ok({ skills: [] }),
      search: () => ok({ skills: [] }),
    },

    checkpoints: {
      save: () => ok({ id: 0 }),
      list: () => ok({ checkpoints: [] }),
      restore: () => ok({ session_id: 'mock', messages: [] }),
      delete: () => ok(),
    },

    bgAgents: {
      list: () => ok({ agents: [] }),
      get: () => ok({ agent: null }),
      create: () => ok({ id: 'mock' }),
      delete: () => ok(),
      onText: noop, onToolCall: noop, onUpdate: noop,
    },

    cron: {
      list: () => ok({ tasks: [] }),
      create: () => ok({ id: 'mock' }),
      update: () => ok(),
      delete: () => ok(),
      onFired: noop,
    },

    subagent: {
      run: () => ok({ result: { role: 'custom', text: '(mock)', iterations: 0, promptTokens: 0, completionTokens: 0, aborted: false } }),
      onText: noop, onToolCall: noop,
    },

    sessionOps: {
      compact: () => ok({ newSessionId: 'mock', messageCount: 0 }),
    },

    on: () => () => {},
  }

  console.info('[dev] Installed browser mock for window.electron')
}
