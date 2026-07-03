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
  { key: 'ember', name: 'Ember', description: 'Warm coral on deep slate — cozy and focused', colors: { primary: '#E8826B', secondary: '#E6B07A', muted: '#8A93A6', text: '#E4E2DD', userInput: '#7FB5B5', response: '#E4E2DD', tool: '#7FB5B5', toolResult: '#9AA0AE', error: '#E5677A', success: '#8FB573', warning: '#E6B07A', border: '#2A303D', suggestion: '#E8826B', bg: '#171B26', bgSubtle: '#12161F' } },
  { key: 'cyberpunk-neon', name: 'Cyberpunk Neon', description: 'Electric cyan & magenta — Night City terminal', colors: { primary: '#00FFFF', secondary: '#FF00FF', muted: '#5FB5B5', text: '#C0FFFF', userInput: '#00FFFF', response: '#00FFFF', tool: '#FF00FF', toolResult: '#5FB5B5', error: '#FF3355', success: '#00FF88', warning: '#FF8C00', border: '#00FFFF', suggestion: '#FF00FF', bg: '#0a0010', bgSubtle: '#12001e' } },
  { key: 'dracula', name: 'Dracula', description: 'Dark purple tones', colors: { primary: '#BD93F9', secondary: '#FF79C6', muted: '#8E9AC2', text: '#F8F8F2', userInput: '#8BE9FD', response: '#BD93F9', tool: '#FF79C6', toolResult: '#8E9AC2', error: '#FF5555', success: '#50FA7B', warning: '#FFB86C', border: '#44475A', suggestion: '#FF79C6', bg: '#282A36', bgSubtle: '#21222C' } },
  { key: 'gruvbox', name: 'Gruvbox', description: 'Warm retro tones', colors: { primary: '#FE8019', secondary: '#FABD2F', muted: '#A89984', text: '#EBDBB2', userInput: '#83A598', response: '#FE8019', tool: '#FABD2F', toolResult: '#A89984', error: '#FB4934', success: '#B8BB26', warning: '#FABD2F', border: '#3C3836', suggestion: '#FABD2F', bg: '#1D2021', bgSubtle: '#282828' } },
  { key: 'nord', name: 'Nord', description: 'Cool arctic blues', colors: { primary: '#88C0D0', secondary: '#81A1C1', muted: '#7B89A0', text: '#ECEFF4', userInput: '#88C0D0', response: '#81A1C1', tool: '#5E81AC', toolResult: '#7B89A0', error: '#BF616A', success: '#A3BE8C', warning: '#EBCB8B', border: '#3B4252', suggestion: '#88C0D0', bg: '#2E3440', bgSubtle: '#292E39' } },
  { key: 'mono', name: 'Mono', description: 'Clean monochrome — easy on the eyes', colors: { primary: '#AAAAAA', secondary: '#FFFFFF', muted: '#888888', text: '#E5E5E5', userInput: '#AAAAAA', response: '#FFFFFF', tool: '#CCCCCC', toolResult: '#888888', error: '#FF6666', success: '#66FF66', warning: '#FFAA66', border: '#333333', suggestion: '#FFFFFF', bg: '#0a0a0a', bgSubtle: '#111111' } },
  { key: 'solarized', name: 'Solarized Dark', description: 'Solarized dark — the original', colors: { primary: '#268BD2', secondary: '#2AA198', muted: '#839496', text: '#93A1A1', userInput: '#2AA198', response: '#268BD2', tool: '#B58900', toolResult: '#839496', error: '#DC322F', success: '#859900', warning: '#CB4B16', border: '#073642', suggestion: '#2AA198', bg: '#002B36', bgSubtle: '#073642' } },
  { key: 'hacker', name: 'Hacker', description: 'Green on black — classic terminal', colors: { primary: '#00FF00', secondary: '#00CC00', muted: '#00AA00', text: '#33FF33', userInput: '#00FF00', response: '#00FF00', tool: '#00CC00', toolResult: '#00AA00', error: '#FF0000', success: '#00FF00', warning: '#FFFF00', border: '#003300', suggestion: '#00CC00', bg: '#000000', bgSubtle: '#050505' } },
  // Mirrors electron/main.ts — CLI default palette + the tui flag that flips
  // the app to monospace / square / flat.
  { key: 'tui', name: 'TUI', description: 'Looks like the terminal version — mono, square, scanlines', tui: true, colors: { primary: '#7AA2F7', secondary: '#BB9AF7', muted: '#9AA5CE', text: '#C0CAF5', userInput: '#9ECE6A', response: '#C0CAF5', tool: '#7DCFFF', toolResult: '#9AA5CE', error: '#F7768E', success: '#9ECE6A', warning: '#E0AF68', border: '#565F89', suggestion: '#BB9AF7', bg: '#0A0A0C', bgSubtle: '#070709' } },
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
    methods: ['oauth', 'setup-token', 'api-key'],
    baseUrl: 'https://api.anthropic.com/v1',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o mini, o-series',
    methods: ['oauth', 'cached-token', 'api-key'],
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

// ── Mock agent event bus + streaming demo session ───────────────────────────
// Lets the browser preview exercise the REAL ChatArea/Virtuoso streaming path
// (scroll-follow, footer growth, tool-block expansion) without Electron.
type AgentListener = (payload: any) => void
const agentBus: Record<string, Set<AgentListener>> = {}
const onAgentEvent = (channel: string) => (cb: AgentListener) => {
  ;(agentBus[channel] ??= new Set()).add(cb)
  return () => { agentBus[channel]?.delete(cb) }
}
const emitAgent = (channel: string, payload: any) => {
  agentBus[channel]?.forEach((cb) => { try { cb(payload) } catch { /* listener error */ } })
}

const demoNow = Date.now()
const DEMO_META = {
  id: 'demo',
  title: 'Streaming demo',
  cwd: '/Users/you/project',
  provider: 'lmstudio',
  model: 'demo-model-7b',
  created_at: new Date(demoNow - 86_400_000).toISOString(),
  updated_at: new Date(demoNow).toISOString(),
  message_count: 8,
  prompt_tokens: 1200,
  completion_tokens: 800,
  estimated_cost: 0,
  mode: 'code' as const,
}
const mockSessions = new Map<string, any>([[DEMO_META.id, DEMO_META]])

const CODE_BLOCK = '```ts\nexport function greet(name: string) {\n  return `hello ${name}`\n}\n```'
const PARA = 'This is seeded history so the conversation is taller than the viewport — the scroller needs real overflow before follow/snap behavior can be exercised meaningfully. '
const DEMO_HISTORY: any[] = [
  { role: 'user', content: 'walk me through this repo' },
  { role: 'assistant', content: PARA.repeat(4) },
  { role: 'user', content: 'now show me a code sample' },
  { role: 'assistant', content: `Sure — here is one:\n\n${CODE_BLOCK}\n\n${PARA.repeat(2)}` },
  { role: 'user', content: 'longer please' },
  { role: 'assistant', content: `${PARA.repeat(3)}\n\n${CODE_BLOCK}\n\n${PARA.repeat(3)}` },
  { role: 'user', content: 'one more' },
  { role: 'assistant', content: PARA.repeat(5) },
]

// Scripted stream: thinking → text bursts (variable size) → tool call that
// expands from running→done with a tall result → more text → second tool →
// closing text → done. Mirrors the height-churn profile of a real agent run.
let demoTimer: ReturnType<typeof setInterval> | null = null
function startDemoStream(sessionId: string) {
  if (demoTimer) return
  let tick = 0
  let fullText = ''
  const text = (delta: string) => { fullText += delta; emitAgent('text', { sessionId, delta }) }
  const WORDS = 'streaming tokens into the live footer to exercise scroll-follow under realistic conditions — '
  demoTimer = setInterval(() => {
    tick++
    if (tick === 1) emitAgent('iteration', { sessionId, iteration: 1 })
    else if (tick <= 8) emitAgent('thinking', { sessionId, delta: 'considering the layout problem… '.repeat(tick % 3 ? 1 : 2) })
    else if (tick === 9) text('Alright — let me look at the files.\n\n')
    else if (tick === 14) emitAgent('toolCall', { sessionId, call: { id: 't1', name: 'read_file', args: { path: 'src/App.tsx' }, status: 'running' } })
    else if (tick === 20) emitAgent('toolCall', { sessionId, call: { id: 't1', name: 'read_file', args: { path: 'src/App.tsx' }, status: 'done', result: Array.from({ length: 12 }, (_, i) => `line ${i + 1} of the file content`).join('\n') } })
    else if (tick <= 34) text(tick % 5 === 0 ? `\n\nParagraph break at tick ${tick}.\n\n` : WORDS.slice(0, 20 + (tick * 7) % 40))
    else if (tick === 35) emitAgent('toolCall', { sessionId, call: { id: 't2', name: 'edit_file', args: { path: 'src/components/Hero.tsx' }, status: 'running' } })
    else if (tick === 42) emitAgent('toolCall', { sessionId, call: { id: 't2', name: 'edit_file', args: { path: 'src/components/Hero.tsx' }, status: 'done', result: 'Applied 3 edits', diff: Array.from({ length: 10 }, (_, i) => (i % 2 ? `+ new line ${i}` : `- old line ${i}`)).join('\n') } })
    else if (tick <= 66) text(tick % 6 === 0 ? `\n\nMore content (tick ${tick}).\n\n` : WORDS.slice(0, 16 + (tick * 11) % 48))
    else {
      stopDemoStream(sessionId, fullText)
    }
  }, 110)
}
function stopDemoStream(sessionId: string, fullText: string) {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null }
  emitAgent('done', { sessionId, text: fullText, usage: { promptTokens: 900, completionTokens: 320, cost: 0 }, stats: { tokensPerSecond: 48.6, contextWindow: 32000, isLocal: true } })
}

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
      create: (opts: { cwd: string; provider: string; model: string; title?: string; mode?: 'code' | 'chat' | 'browser' }) => {
        const id = 'mock_' + Math.random().toString(36).slice(2, 8)
        const meta = { ...DEMO_META, id, title: opts.title ?? null, cwd: opts.cwd, provider: opts.provider, model: opts.model, mode: opts.mode ?? 'code', message_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        mockSessions.set(id, meta)
        return ok({ session: meta })
      },
      list: () => ok({ sessions: [...mockSessions.values()] }),
      get: (id: string) => ok({ session: mockSessions.get(id) ?? null, messages: id === DEMO_META.id ? DEMO_HISTORY : [] }),
      delete: (id: string) => { mockSessions.delete(id); return ok() },
      updateTitle: (id: string, title: string) => { const m = mockSessions.get(id); if (m) m.title = title; return ok() },
      updateModel: (id: string, provider: string, model: string) => { const m = mockSessions.get(id); if (m) { m.provider = provider; m.model = model } return ok() },
      updateMode: (id: string, mode: 'code' | 'chat') => { const m = mockSessions.get(id); if (m) m.mode = mode; return ok() },
      setCwd: () => ok(),
    },
    cookbook: {
      profile: () => ok({ profile: { platform: 'browser', arch: 'x64', totalRamGb: 16, vramBudgetGb: 8, unifiedMemory: false }, recommendations: [] }),
      ollama: () => ok({ installed: false, running: false, models: [] }),
      pull: () => ok({ code: 0 }),
      cancelPull: () => ok(),
      onPullProgress: () => () => {},
    },
    compare: {
      run: (opts: { entries?: Array<{ provider: string; model: string }> }) =>
        ok({ results: (opts?.entries ?? []).map((e) => ({ provider: e.provider, model: e.model, ok: true, text: `(mock) ${e.model} would answer here.`, latencyMs: 820, promptTokens: 24, completionTokens: 48 })) }),
    },
    council: {
      run: async (opts: { entries?: Array<{ provider: string; model: string }> }) => {
        await new Promise((r) => setTimeout(r, 700))
        const candidates = (opts?.entries ?? []).map((e, i) => ({ provider: e.provider, model: e.model, ok: true, text: `(${e.model}) Candidate ${i + 1}: a concise take on the question, with one detail the others miss.`, latencyMs: 800 + i * 220, promptTokens: 24, completionTokens: 110 + i * 30 }))
        const chair = opts?.entries?.[0] ?? { provider: 'mock', model: 'mock' }
        return ok({
          candidates,
          verdict: {
            provider: chair.provider,
            model: chair.model,
            text: '## Verdict\nThe synthesized best answer, combining every candidate\'s strengths into one clear, complete response.\n\n## Notes\n' + candidates.map((c) => `- **${c.model}**: solid reasoning, minor gaps.`).join('\n'),
          },
        })
      },
      onProgress: (cb: (p: { stage: string }) => void) => {
        setTimeout(() => cb({ stage: 'Consulting models…' }), 60)
        setTimeout(() => cb({ stage: 'Chair is weighing the answers…' }), 420)
        return () => {}
      },
    },
    research: {
      run: (opts: { query?: string }) =>
        ok({ report: `# Research: ${opts?.query ?? ''}\n\nA synthesized, cited report would appear here in the desktop app.\n\n## Sources\n1. https://example.com` }),
      onProgress: () => () => {},
    },
    notes: {
      get: () => ok({
        notes: [{ id: 'n1', text: 'A sample note so the workspace shows content.', createdAt: Date.now() }],
        tasks: [{ id: 't1', text: 'try the assistant', done: false, createdAt: Date.now() }, { id: 't2', text: 'ship it', done: true, createdAt: Date.now() }],
      }),
      addNote: () => ok({ note: null }),
      deleteNote: () => ok(),
      addTask: () => ok({ task: null }),
      toggleTask: () => ok(),
      deleteTask: () => ok(),
      onChanged: () => () => { /* noop in browser */ },
    },
    documents: {
      list: () => ok({ documents: [
        { id: 'doc1', title: 'Welcome', content: '# Welcome\n\nThis is a demo document so the editor shows content in the browser preview.', updatedAt: Date.now() },
        { id: 'doc2', title: 'Ideas', content: '- first idea\n- second idea', updatedAt: Date.now() - 8.64e7 },
      ] }),
      save: (doc: { id?: string; title: string; content: string }) => ok({ doc: { id: doc.id || 'mock', title: doc.title, content: doc.content, updatedAt: Date.now() } }),
      delete: () => ok(),
      assist: (opts: { content?: string }) => ok({ content: opts?.content ?? '' }),
      setActive: () => { /* noop in browser */ },
      onChanged: () => () => { /* noop in browser */ },
    },
    email: {
      getAccount: () => ok({ account: { email: 'you@example.com', imapHost: 'imap.example.com', imapPort: 993, smtpHost: 'smtp.example.com', smtpPort: 465, passwordSet: true } }),
      saveAccount: () => ok(),
      list: () => ok({ messages: [
        { uid: 2, from: 'alex@team.com', fromName: 'Alex', subject: 'Re: the build', date: Date.now() - 3.6e6, seen: false },
        { uid: 1, from: 'newsletter@dev.to', fromName: 'DEV', subject: 'Weekly digest', date: Date.now() - 8.6e7, seen: true },
      ] }),
      get: (uid: number) => ok({ message: { uid, from: 'alex@team.com', to: 'you@example.com', subject: 'Re: the build', date: Date.now() - 3.6e6, text: 'Looks great — can you ship the arm64 build today?' } }),
      send: () => ok(),
      setActive: () => { /* noop in browser */ },
    },
    calendar: {
      getAccount: () => ok({ account: { url: 'https://caldav.example.com', username: 'you@example.com', passwordSet: true } }),
      saveAccount: () => ok(),
      events: () => ok({ events: [
        { summary: 'Standup', start: Date.now() + 3.6e6, end: Date.now() + 5.4e6, location: '', calendar: 'Work' },
        { summary: 'Design review', start: Date.now() + 9e7, end: Date.now() + 9.4e7, location: 'Zoom', calendar: 'Work' },
      ] }),
      setEvents: () => { /* noop in browser */ },
      onChanged: () => () => { /* noop in browser */ },
    },
    preview: {
      // Browser-only: register the callback and expose window.__firePreviewOpen(url)
      // so the agent→renderer open path can be exercised in the dev preview.
      onOpen: (cb: (url: string) => void) => {
        const w = window as unknown as { __previewOpenCbs?: Array<(u: string) => void>; __firePreviewOpen?: (u: string) => void }
        const arr = (w.__previewOpenCbs ??= [])
        arr.push(cb)
        w.__firePreviewOpen = (u: string) => arr.forEach((f) => f(u))
        return () => { const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1) }
      },
    },

    // No <webview> in a plain browser — these are inert mocks so the UI boots.
    browser: {
      onCommand: () => () => {},
      onOpen: (cb: () => void) => {
        const w = window as unknown as { __fireBrowserOpen?: () => void }
        w.__fireBrowserOpen = () => cb()
        return () => {}
      },
      sendResult: () => {},
      ready: () => {},
      closed: () => {},
    },

    agent: {
      send: (opts: { sessionId?: string }) => {
        if (opts?.sessionId) startDemoStream(opts.sessionId)
        return ok()
      },
      abort: (sessionId?: string) => { stopDemoStream(sessionId ?? DEMO_META.id, '(aborted)'); return ok() },
      isRunning: () => ok({ running: false }),
      approvalResponse: () => ok(),
      askUserResponse: () => ok(),
      onStarted: noop,
      onText: onAgentEvent('text'),
      onThinking: onAgentEvent('thinking'),
      onIteration: onAgentEvent('iteration'),
      onToolCall: onAgentEvent('toolCall'),
      onTasks: noop,
      onApprovalRequest: noop,
      onAskUser: noop,
      onPlanExit: noop,
      onUsage: onAgentEvent('usage'),
      onStats: onAgentEvent('stats'),
      onDone: onAgentEvent('done'),
      onError: onAgentEvent('error'),
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
            try {
              const r = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(3000) })
              if (r.ok) { const j = await r.json(); return { ok: true, models: (j.data || []).map((m: any) => ({ id: m.id, name: m.id })) } }
            } catch { /* browser CORS blocks localhost in the preview — fall back to samples */ }
            return { ok: true, models: [{ id: 'qwen2.5-coder-32b-instruct', name: 'qwen2.5-coder-32b-instruct' }, { id: 'llama-3.2-3b-instruct', name: 'llama-3.2-3b-instruct' }] }
          }
          if (providerId === 'ollama') {
            try {
              const r = await fetch('http://127.0.0.1:11434/v1/models', { signal: AbortSignal.timeout(3000) })
              if (r.ok) { const j = await r.json(); return { ok: true, models: (j.data || []).map((m: any) => ({ id: m.id, name: m.id })) } }
            } catch { /* preview CORS — fall back to samples */ }
            return { ok: true, models: [{ id: 'llama3.2:latest', name: 'llama3.2:latest' }] }
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
            // Seed a small budget so the status-bar spend dial is exercised in
            // the browser preview (real config persists via config.save).
            costBudget: 1,
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
