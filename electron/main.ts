import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { spawn, type ChildProcess } from 'child_process'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { CodingAgent, type ApprovalResult, type ApprovalMode, type ReasoningEffort } from './core/agent.js'
import { buildSystemPrompt } from './core/prompt.js'
import * as sessions from './core/sessions.js'
import * as auth from './core/auth.js'
import * as mcp from './core/mcp.js'
import * as memory from './core/memory.js'
import * as hooksMod from './core/hooks.js'
import * as gitMod from './core/git.js'
import * as skillsMod from './core/skills.js'
import * as checkpoints from './core/checkpoints.js'
import * as bgAgents from './core/backgroundAgents.js'
import * as cron from './core/cron.js'
import { runSubagent } from './core/subagent.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// ── In-flight agent runs ──
interface ActiveRun {
  sessionId: string
  abortController: AbortController
  pendingApprovals: Map<string, (decision: ApprovalResult) => void>
  pendingAsks: Map<string, (reply: string) => void>
}
const activeRuns = new Map<string, ActiveRun>()

// ── App config ──
interface AppConfig {
  theme: string
  autoApprove: boolean
  approvalMode?: ApprovalMode
  reasoningEffort?: ReasoningEffort
  activeSkillIds?: string[]
  lastCwd: string | null
  lastProvider: string | null
  lastModel: string | null
}

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const APP_CONFIG_PATH = join(CONFIG_DIR, 'config.json')

function loadAppConfig(): AppConfig {
  try {
    if (existsSync(APP_CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(APP_CONFIG_PATH, 'utf-8'))
      return {
        theme: data.theme ?? 'codemaxxing',
        autoApprove: data.autoApprove ?? false,
        approvalMode: data.approvalMode ?? (data.autoApprove ? 'full-auto' : 'suggest'),
        reasoningEffort: data.reasoningEffort ?? 'off',
        activeSkillIds: Array.isArray(data.activeSkillIds) ? data.activeSkillIds : [],
        lastCwd: data.lastCwd ?? null,
        lastProvider: data.lastProvider ?? null,
        lastModel: data.lastModel ?? null,
      }
    }
  } catch { /* fall through */ }
  return {
    theme: 'codemaxxing', autoApprove: false, approvalMode: 'suggest', reasoningEffort: 'off',
    activeSkillIds: [], lastCwd: null, lastProvider: null, lastModel: null,
  }
}

function saveAppConfig(config: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(APP_CONFIG_PATH, JSON.stringify(config, null, 2))
}

// ── Provider routing ──
interface ProviderRoute { providerType: 'anthropic' | 'openai'; baseUrl: string; needsKey: boolean }
function providerRoute(providerId: string): ProviderRoute {
  switch (providerId) {
    case 'anthropic': return { providerType: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true }
    case 'openai': return { providerType: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true }
    case 'openrouter': return { providerType: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true }
    case 'qwen': return { providerType: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsKey: true }
    case 'copilot': return { providerType: 'openai', baseUrl: 'https://api.githubcopilot.com', needsKey: true }
    case 'ollama': return { providerType: 'openai', baseUrl: 'http://localhost:11434/v1', needsKey: false }
    case 'lmstudio': return { providerType: 'openai', baseUrl: 'http://localhost:1234/v1', needsKey: false }
    default: return { providerType: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true }
  }
}

// ── Cost estimation (roughly matches CLI) ──
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15 / 1e6, output: 75 / 1e6 },
  'claude-sonnet-4-6': { input: 3 / 1e6, output: 15 / 1e6 },
  'claude-haiku-4-5-20251001': { input: 1 / 1e6, output: 5 / 1e6 },
  'gpt-5': { input: 10 / 1e6, output: 30 / 1e6 },
  'gpt-4.1': { input: 3 / 1e6, output: 12 / 1e6 },
  'o3': { input: 15 / 1e6, output: 60 / 1e6 },
}
function estimateCost(model: string, promptT: number, completionT: number): number {
  const k = Object.keys(MODEL_COSTS).find(k => model.includes(k))
  if (!k) return 0
  const c = MODEL_COSTS[k]
  return promptT * c.input + completionT * c.output
}

// ── Window ──
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#1a1814',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (is.dev) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer crash]', details)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  const devUrl = process.env['ELECTRON_RENDERER_URL'] || (is.dev ? 'http://localhost:5173' : null)
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.codemaxxing.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  setupIPC()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  cron.startTicker((task) => {
    void runScheduledTask(task).catch(err => {
      cron.markRun(task.id, `error: ${err?.message ?? String(err)}`)
    })
  })
})

app.on('before-quit', () => { isQuitting = true })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function emit(channel: string, ...args: any[]) {
  mainWindow?.webContents.send(channel, ...args)
}

function setupIPC(): void {
  // ── Generic system bridge ──
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    return result.filePaths
  })
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] || null
  })
  ipcMain.handle('shell:openExternal', async (_e, url: string) => { await shell.openExternal(url) })
  ipcMain.handle('shell:showItemInFolder', async (_e, p: string) => { await shell.showItemInFolder(p) })
  ipcMain.handle('clipboard:writeText', async (_e, text: string) => { clipboard.writeText(text); return true })
  ipcMain.handle('clipboard:readText', async () => clipboard.readText())
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => mainWindow?.isMaximized() ? mainWindow?.unmaximize() : mainWindow?.maximize())
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getPlatform', () => process.platform)
  ipcMain.handle('app:getPath', async (_e, name: string) => app.getPath(name as any))
  ipcMain.handle('app:getHomeDir', () => homedir())

  // ── Model listing ──
  ipcMain.handle('llm:listModels', async (_e, providerId: string) => {
    try {
      if (providerId === 'anthropic') {
        return {
          ok: true,
          models: [
            { name: 'claude-opus-4-6', id: 'claude-opus-4-6' },
            { name: 'claude-sonnet-4-6', id: 'claude-sonnet-4-6' },
            { name: 'claude-haiku-4-5-20251001', id: 'claude-haiku-4-5-20251001' },
          ],
        }
      }
      const cred = auth.getCredential(providerId)
      const route = providerRoute(providerId)
      const apiKey = cred?.apiKey || 'not-needed'
      const baseUrl = cred?.baseUrl || route.baseUrl
      const client = new OpenAI({ apiKey, baseURL: baseUrl })
      const response = await client.models.list()
      return { ok: true, models: response.data.map(m => ({ name: m.id, id: m.id })) }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Anthropic connection test ──
  ipcMain.handle('llm:testConnection', async (_e, providerId: string) => {
    try {
      const cred = auth.getCredential(providerId)
      if (!cred && providerRoute(providerId).needsKey) return { ok: false, error: 'No API key configured' }
      const route = providerRoute(providerId)
      if (route.providerType === 'anthropic') {
        const client = new Anthropic({ apiKey: cred!.apiKey, baseURL: cred?.baseUrl || route.baseUrl })
        await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] })
      } else {
        const client = new OpenAI({ apiKey: cred?.apiKey || 'not-needed', baseURL: cred?.baseUrl || route.baseUrl })
        await client.models.list()
      }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Session management ──
  ipcMain.handle('session:create', async (_e, opts: { cwd: string; provider: string; model: string; title?: string }) => {
    const id = sessions.createSession(opts.cwd, opts.provider, opts.model, opts.title)
    const s = sessions.getSession(id)!
    return { ok: true, session: s }
  })
  ipcMain.handle('session:list', async () => ({ ok: true, sessions: sessions.listSessions(200) }))
  ipcMain.handle('session:get', async (_e, id: string) => {
    const s = sessions.getSession(id)
    if (!s) return { ok: false, error: 'Not found' }
    const messages = sessions.loadMessages(id)
    return { ok: true, session: s, messages }
  })
  ipcMain.handle('session:delete', async (_e, id: string) => ({ ok: sessions.deleteSession(id) }))
  ipcMain.handle('session:updateTitle', async (_e, id: string, title: string) => {
    sessions.updateSessionTitle(id, title); return { ok: true }
  })
  ipcMain.handle('session:updateModel', async (_e, id: string, provider: string, model: string) => {
    sessions.updateSessionModel(id, provider, model); return { ok: true }
  })
  ipcMain.handle('session:setCwd', async (_e, id: string, cwd: string) => {
    const s = sessions.getSession(id)
    if (!s) return { ok: false, error: 'Not found' }
    sessions.updateSessionCwd(id, cwd)
    return { ok: true }
  })

  // ── Agent run ──
  ipcMain.handle('agent:send', async (_e, opts: { sessionId: string; message: string }) => {
    const sess = sessions.getSession(opts.sessionId)
    if (!sess) return { ok: false, error: 'Session not found' }
    const cred = auth.getCredential(sess.provider)
    const route = providerRoute(sess.provider)
    if (route.needsKey && !cred) return { ok: false, error: 'No credentials configured for ' + sess.provider }

    const appConfig = loadAppConfig()

    // Load existing history
    const history = sessions.loadMessages(opts.sessionId)

    // Save user message
    const userMsg: ChatCompletionMessageParam = { role: 'user', content: opts.message }
    sessions.saveMessage(opts.sessionId, userMsg)

    // Build system prompt (includes skills, memory, project rules, repo map)
    const systemPrompt = buildSystemPrompt({
      cwd: sess.cwd,
      activeSkillIds: appConfig.activeSkillIds ?? [],
      memoryScope: sess.cwd,
    })

    // Connect to MCP servers (best-effort)
    try {
      await mcp.connectToServers(sess.cwd, {
        onStatus: (name, status) => emit('mcp:status', { name, status }),
        approve: async (name, cfg) => {
          // synchronous (blocking) approval — emit event and wait
          return new Promise<boolean>((resolve) => {
            const token = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            const handler = (_: any, approvedToken: string, decision: boolean) => {
              if (approvedToken !== token) return
              ipcMain.removeListener('mcp:approvalResponse', handler)
              resolve(decision)
            }
            ipcMain.on('mcp:approvalResponse', handler)
            emit('mcp:approvalRequest', { token, name, command: cfg.command, args: cfg.args, env: cfg.env })
          })
        },
      })
    } catch { /* MCP is optional — swallow errors */ }

    // Start run
    const abort = new AbortController()
    const run: ActiveRun = {
      sessionId: opts.sessionId,
      abortController: abort,
      pendingApprovals: new Map(),
      pendingAsks: new Map(),
    }
    activeRuns.set(opts.sessionId, run)

    emit('agent:started', { sessionId: opts.sessionId, message: opts.message })
    try { await hooksMod.runHooksForEvent('on-start', { cwd: sess.cwd }) } catch { /* best-effort */ }

    const agent = new CodingAgent(
      {
        provider: route.providerType,
        model: sess.model,
        baseUrl: cred?.baseUrl || route.baseUrl,
        apiKey: cred?.apiKey || 'not-needed',
        cwd: sess.cwd,
        systemPrompt,
        messages: history,
        autoApprove: appConfig.autoApprove,
        approvalMode: appConfig.approvalMode ?? (appConfig.autoApprove ? 'full-auto' : 'suggest'),
        reasoningEffort: appConfig.reasoningEffort ?? 'off',
        scope: sess.cwd,
        abortSignal: abort.signal,
      },
      {
        onText: (delta) => emit('agent:text', { sessionId: opts.sessionId, delta }),
        onThinking: (delta) => emit('agent:thinking', { sessionId: opts.sessionId, delta }),
        onIteration: (n) => emit('agent:iteration', { sessionId: opts.sessionId, iteration: n }),
        onToolCall: (call) => emit('agent:toolCall', { sessionId: opts.sessionId, call }),
        onTaskChange: (tasks) => emit('agent:tasks', { sessionId: opts.sessionId, tasks }),
        onToolApproval: async (call) => {
          return await new Promise<ApprovalResult>((resolve) => {
            run.pendingApprovals.set(call.id, resolve)
            emit('agent:approvalRequest', { sessionId: opts.sessionId, call })
          })
        },
        onAskUser: async (question, options) => {
          const askId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          return await new Promise<string>((resolve) => {
            run.pendingAsks.set(askId, resolve)
            emit('agent:askUser', { sessionId: opts.sessionId, askId, question, options })
          })
        },
        onPlanExit: (plan) => emit('agent:planExit', { sessionId: opts.sessionId, plan }),
        onUsage: (u) => emit('agent:usage', { sessionId: opts.sessionId, usage: u }),
      },
    )

    try {
      const result = await agent.run(opts.message)
      // Persist any new messages beyond what we had (history + userMsg already saved)
      const newMessages = result.messages.slice(history.length + 1)
      for (const m of newMessages) sessions.saveMessage(opts.sessionId, m)

      const cost = estimateCost(sess.model, result.totalPromptTokens, result.totalCompletionTokens)
      sessions.updateSessionCost(opts.sessionId, result.totalPromptTokens, result.totalCompletionTokens, cost)

      // Auto-set title from first user message if untitled
      if (!sess.title) {
        const title = opts.message.split('\n')[0].slice(0, 60)
        sessions.updateSessionTitle(opts.sessionId, title)
      }

      emit('agent:done', {
        sessionId: opts.sessionId,
        text: result.text,
        iterations: result.iterations,
        aborted: result.aborted,
        usage: { promptTokens: result.totalPromptTokens, completionTokens: result.totalCompletionTokens, cost },
      })
      return { ok: true, text: result.text, aborted: result.aborted }
    } catch (err: any) {
      const msg = auth.scrubSecrets(err?.message ?? String(err))
      emit('agent:error', { sessionId: opts.sessionId, error: msg })
      return { ok: false, error: msg }
    } finally {
      activeRuns.delete(opts.sessionId)
    }
  })

  ipcMain.handle('agent:abort', async (_e, sessionId: string) => {
    const run = activeRuns.get(sessionId)
    if (!run) return { ok: false, error: 'No active run' }
    run.abortController.abort()
    return { ok: true }
  })

  ipcMain.handle('agent:approvalResponse', async (_e, sessionId: string, callId: string, decision: ApprovalResult) => {
    const run = activeRuns.get(sessionId)
    if (!run) return { ok: false, error: 'No active run' }
    const resolve = run.pendingApprovals.get(callId)
    if (!resolve) return { ok: false, error: 'Unknown approval' }
    run.pendingApprovals.delete(callId)
    resolve(decision)
    return { ok: true }
  })

  ipcMain.handle('agent:askUserResponse', async (_e, sessionId: string, askId: string, reply: string) => {
    const run = activeRuns.get(sessionId)
    if (!run) return { ok: false, error: 'No active run' }
    const resolve = run.pendingAsks.get(askId)
    if (!resolve) return { ok: false, error: 'Unknown ask' }
    run.pendingAsks.delete(askId)
    resolve(reply)
    return { ok: true }
  })

  ipcMain.on('mcp:approvalResponse', () => { /* handled per-request above */ })

  // ── Memory ──
  ipcMain.handle('memory:list', async (_e, type?: memory.MemoryType, scope?: string | null) =>
    ({ ok: true, memories: memory.listAll(type, scope) }))
  ipcMain.handle('memory:recall', async (_e, query: string, type?: memory.MemoryType, scope?: string | null, limit?: number) =>
    ({ ok: true, memories: memory.recall(query, type, scope, limit ?? 20) }))
  ipcMain.handle('memory:remember', async (_e, type: memory.MemoryType, key: string, content: string, opts?: memory.RememberOptions) =>
    ({ ok: true, id: memory.remember(type, key, content, opts ?? {}) }))
  ipcMain.handle('memory:forget', async (_e, id: number) => ({ ok: memory.forget(id) }))
  ipcMain.handle('memory:stats', async () => ({ ok: true, stats: memory.stats() }))

  // ── Hooks ──
  ipcMain.handle('hooks:list', async (_e, cwd?: string) =>
    ({ ok: true, hooks: cwd ? hooksMod.loadHooks(cwd) : hooksMod.getGlobalHooks() }))
  ipcMain.handle('hooks:saveGlobal', async (_e, hooks: hooksMod.Hook[]) => {
    hooksMod.saveGlobalHooks(hooks); return { ok: true }
  })

  // ── Git ──
  ipcMain.handle('git:summary', async (_e, cwd: string) => ({ ok: true, summary: await gitMod.gitSummary(cwd) }))
  ipcMain.handle('git:status', async (_e, cwd: string) => ({ ok: true, status: await gitMod.gitStatus(cwd) }))
  ipcMain.handle('git:diff', async (_e, cwd: string, staged?: boolean) =>
    ({ ok: true, diff: await gitMod.gitDiff(cwd, !!staged) }))
  ipcMain.handle('git:log', async (_e, cwd: string, limit?: number) =>
    ({ ok: true, log: await gitMod.gitLog(cwd, limit ?? 20) }))
  ipcMain.handle('git:commit', async (_e, cwd: string, message: string, stageAll?: boolean) => {
    if (stageAll) await gitMod.gitStageAll(cwd)
    return { ok: true, result: await gitMod.gitCommit(cwd, message) }
  })
  ipcMain.handle('git:push', async (_e, cwd: string, remote?: string, branch?: string) =>
    ({ ok: true, result: await gitMod.gitPush(cwd, remote, branch) }))
  ipcMain.handle('git:undo', async (_e, cwd: string) => ({ ok: true, result: await gitMod.gitUndo(cwd) }))

  // ── Skills ──
  ipcMain.handle('skills:list', async () => ({ ok: true, skills: skillsMod.SKILLS }))
  ipcMain.handle('skills:search', async (_e, query: string) =>
    ({ ok: true, skills: skillsMod.searchSkills(query) }))

  // ── Checkpoints ──
  ipcMain.handle('checkpoints:save', async (_e, sessionId: string, label?: string) => {
    const msgs = sessions.loadMessages(sessionId)
    const id = checkpoints.saveCheckpoint(sessionId, msgs, label)
    return { ok: true, id }
  })
  ipcMain.handle('checkpoints:list', async (_e, sessionId: string) =>
    ({ ok: true, checkpoints: checkpoints.listCheckpoints(sessionId) }))
  ipcMain.handle('checkpoints:restore', async (_e, checkpointId: number) => {
    const cp = checkpoints.loadCheckpoint(checkpointId)
    if (!cp) return { ok: false, error: 'Checkpoint not found' }
    return { ok: true, session_id: cp.checkpoint.session_id, messages: cp.messages }
  })
  ipcMain.handle('checkpoints:delete', async (_e, id: number) =>
    ({ ok: checkpoints.deleteCheckpoint(id) }))

  // ── Background agents ──
  ipcMain.handle('bgAgents:list', async () => ({ ok: true, agents: bgAgents.listBackgroundAgents() }))
  ipcMain.handle('bgAgents:get', async (_e, id: string) => {
    const a = bgAgents.getBackgroundAgent(id)
    return a ? { ok: true, agent: a } : { ok: false, error: 'Not found' }
  })
  ipcMain.handle('bgAgents:create', async (_e, opts: { name: string; cwd: string; provider: string; model: string; prompt: string }) => {
    try {
      const id = bgAgents.createBackgroundAgent(opts)
      void runBackgroundAgent(id).catch(e => console.error('[bg-agent]', e))
      return { ok: true, id }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
  ipcMain.handle('bgAgents:delete', async (_e, id: string) => ({ ok: bgAgents.deleteBackgroundAgent(id) }))

  // ── Scheduled tasks (cron) ──
  ipcMain.handle('cron:list', async () => ({ ok: true, tasks: cron.listScheduledTasks() }))
  ipcMain.handle('cron:create', async (_e, opts: { name: string; schedule: string; cwd: string; provider: string; model: string; prompt: string }) => {
    try { return { ok: true, id: cron.createScheduledTask(opts) } }
    catch (err: any) { return { ok: false, error: err?.message ?? String(err) } }
  })
  ipcMain.handle('cron:update', async (_e, id: string, patch: any) => ({ ok: cron.updateScheduledTask(id, patch) }))
  ipcMain.handle('cron:delete', async (_e, id: string) => ({ ok: cron.deleteScheduledTask(id) }))

  // ── Subagent ──
  ipcMain.handle('subagent:run', async (_e, opts: { sessionId: string; role: string; task: string; customPrompt?: string; context?: string }) => {
    const sess = sessions.getSession(opts.sessionId)
    if (!sess) return { ok: false, error: 'Session not found' }
    const cred = auth.getCredential(sess.provider)
    const route = providerRoute(sess.provider)
    if (route.needsKey && !cred) return { ok: false, error: 'No credentials' }
    const appConfig = loadAppConfig()
    const systemPrompt = buildSystemPrompt({ cwd: sess.cwd, activeSkillIds: appConfig.activeSkillIds ?? [], memoryScope: sess.cwd })
    try {
      const result = await runSubagent(
        { role: opts.role as any, task: opts.task, customPrompt: opts.customPrompt, context: opts.context },
        {
          provider: route.providerType,
          model: sess.model,
          baseUrl: cred?.baseUrl || route.baseUrl,
          apiKey: cred?.apiKey || 'not-needed',
          cwd: sess.cwd,
          approvalMode: 'auto-edit',
          reasoningEffort: appConfig.reasoningEffort ?? 'off',
          scope: sess.cwd,
        },
        systemPrompt,
        {
          onText: (delta) => emit('subagent:text', { sessionId: opts.sessionId, delta }),
          onToolCall: (call) => emit('subagent:toolCall', { sessionId: opts.sessionId, call }),
        },
      )
      return { ok: true, result }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Context compaction ──
  ipcMain.handle('session:compact', async (_e, sessionId: string, keepRecent?: number) => {
    const sess = sessions.getSession(sessionId)
    if (!sess) return { ok: false, error: 'Session not found' }
    const cred = auth.getCredential(sess.provider)
    const route = providerRoute(sess.provider)
    const appConfig = loadAppConfig()
    const systemPrompt = buildSystemPrompt({ cwd: sess.cwd, activeSkillIds: appConfig.activeSkillIds ?? [] })
    const history = sessions.loadMessages(sessionId)
    const agent = new CodingAgent(
      {
        provider: route.providerType, model: sess.model,
        baseUrl: cred?.baseUrl || route.baseUrl,
        apiKey: cred?.apiKey || 'not-needed',
        cwd: sess.cwd, systemPrompt, messages: history,
      },
      {},
    )
    const compacted = await agent.compact(keepRecent ?? 6)
    sessions.deleteSession(sessionId) // fresh slate — then re-create with same id not trivial; alternative: replace messages
    // Recreate session
    const newId = sessions.createSession(sess.cwd, sess.provider, sess.model, sess.title || undefined)
    for (const m of compacted) sessions.saveMessage(newId, m)
    return { ok: true, newSessionId: newId, messageCount: compacted.length }
  })

  // ── Ollama ──
  ipcMain.handle('ollama:isRunning', async () => {
    try {
      const http = await import('http')
      return await new Promise<boolean>((resolve) => {
        const req = http.get('http://localhost:11434/api/tags', (res) => resolve(res.statusCode === 200))
        req.on('error', () => resolve(false))
        req.setTimeout(3000, () => { req.destroy(); resolve(false) })
      })
    } catch { return false }
  })
  ipcMain.handle('ollama:listModels', async () => {
    try {
      const http = await import('http')
      return await new Promise<any>((resolve, reject) => {
        const req = http.get('http://localhost:11434/api/tags', (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              resolve({ ok: true, models: json.models.map((m: any) => ({ name: m.name, size: m.size })) })
            } catch (e: any) { reject(e) }
          })
        })
        req.on('error', reject)
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')) })
      })
    } catch (err: any) { return { ok: false, error: err.message } }
  })

  // ── Auth / credentials ──
  ipcMain.handle('auth:list', async () => ({ ok: true, credentials: auth.getCredentials().map(c => ({ ...c, apiKey: c.apiKey ? `${c.apiKey.slice(0, 4)}…${c.apiKey.slice(-4)}` : '' })) }))
  ipcMain.handle('auth:save', async (_e, cred: auth.AuthCredential) => {
    auth.saveCredential({ ...cred, createdAt: cred.createdAt || new Date().toISOString() })
    return { ok: true }
  })
  ipcMain.handle('auth:delete', async (_e, providerId: string) => ({ ok: auth.deleteCredential(providerId) }))

  // ── Provider definitions (id, methods, baseUrl, consoleUrl, description) ──
  ipcMain.handle('auth:providers', async () => ({ ok: true, providers: auth.PROVIDERS }))

  // ── Detected CLIs / cached tokens on this machine ──
  ipcMain.handle('auth:detect', async () => {
    try { return { ok: true, detected: auth.detectAvailableAuth() } }
    catch (err: any) { return { ok: false, error: err?.message ?? String(err) } }
  })

  // Helper: emit streaming status for any flow
  const emitAuthStatus = (provider: string, method: string, message: string) =>
    mainWindow?.webContents.send('auth:status', { provider, method, message })

  // ── api-key (manual) ──
  ipcMain.handle('auth:apiKey', async (_e, opts: { provider: string; apiKey: string; baseUrl?: string; label?: string }) => {
    try {
      const cred = auth.saveApiKey(opts.provider, opts.apiKey, opts.baseUrl, opts.label)
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── OpenRouter OAuth PKCE ──
  ipcMain.handle('auth:openrouterOAuth', async () => {
    try {
      const cred = await auth.openRouterOAuth((msg) => emitAuthStatus('openrouter', 'oauth', msg))
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Anthropic setup-token (via Claude Code CLI) ──
  ipcMain.handle('auth:anthropicSetupToken', async () => {
    try {
      const cred = await auth.anthropicSetupToken((msg) => emitAuthStatus('anthropic', 'setup-token', msg))
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── GitHub Copilot device flow ──
  ipcMain.handle('auth:copilotDeviceFlow', async () => {
    try {
      const cred = await auth.copilotDeviceFlow((msg) => emitAuthStatus('copilot', 'device-flow', msg))
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Import from Codex / Qwen CLIs ──
  ipcMain.handle('auth:importCodex', async () => {
    try {
      const cred = auth.importCodexToken((msg) => emitAuthStatus('openai', 'cached-token', msg))
      if (!cred) return { ok: false, error: 'No Codex CLI credentials found' }
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })
  ipcMain.handle('auth:importQwen', async () => {
    try {
      const cred = auth.importQwenToken((msg) => emitAuthStatus('qwen', 'cached-token', msg))
      if (!cred) return { ok: false, error: 'No Qwen CLI credentials found' }
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── App config ──
  ipcMain.handle('config:get', async () => ({ ok: true, config: loadAppConfig() }))
  ipcMain.handle('config:save', async (_e, config: AppConfig) => { saveAppConfig(config); return { ok: true } })

  // ── Themes ──
  ipcMain.handle('themes:list', async () => ({
    ok: true,
    themes: [
      { key: 'codemaxxing', name: 'Codemaxxing', description: 'Default — calm, balanced, easy on the eyes', colors: { primary: '#7AA2F7', secondary: '#BB9AF7', muted: '#9AA5CE', text: '#C0CAF5', userInput: '#9ECE6A', response: '#C0CAF5', tool: '#7DCFFF', toolResult: '#9AA5CE', error: '#F7768E', success: '#9ECE6A', warning: '#E0AF68', border: '#565F89', suggestion: '#BB9AF7', bg: '#0a0a0f', bgSubtle: '#0d0d14' } },
      { key: 'cyberpunk-neon', name: 'Cyberpunk Neon', description: 'Electric cyan & magenta — Night City terminal', colors: { primary: '#00FFFF', secondary: '#FF00FF', muted: '#008B8B', text: '#C0FFFF', userInput: '#00FFFF', response: '#00FFFF', tool: '#FF00FF', toolResult: '#008B8B', error: '#FF3355', success: '#00FF88', warning: '#FF8C00', border: '#00FFFF', suggestion: '#FF00FF', bg: '#0a0010', bgSubtle: '#12001e' } },
      { key: 'dracula', name: 'Dracula', description: 'Dark purple tones', colors: { primary: '#BD93F9', secondary: '#FF79C6', muted: '#6272A4', text: '#F8F8F2', userInput: '#8BE9FD', response: '#BD93F9', tool: '#FF79C6', toolResult: '#6272A4', error: '#FF5555', success: '#50FA7B', warning: '#FFB86C', border: '#44475A', suggestion: '#FF79C6', bg: '#282A36', bgSubtle: '#21222C' } },
      { key: 'gruvbox', name: 'Gruvbox', description: 'Warm retro tones', colors: { primary: '#FE8019', secondary: '#FABD2F', muted: '#928374', text: '#EBDBB2', userInput: '#83A598', response: '#FE8019', tool: '#FABD2F', toolResult: '#928374', error: '#FB4934', success: '#B8BB26', warning: '#FABD2F', border: '#3C3836', suggestion: '#FABD2F', bg: '#1D2021', bgSubtle: '#282828' } },
      { key: 'nord', name: 'Nord', description: 'Cool arctic blues', colors: { primary: '#88C0D0', secondary: '#81A1C1', muted: '#4C566A', text: '#ECEFF4', userInput: '#88C0D0', response: '#81A1C1', tool: '#5E81AC', toolResult: '#4C566A', error: '#BF616A', success: '#A3BE8C', warning: '#EBCB8B', border: '#3B4252', suggestion: '#88C0D0', bg: '#2E3440', bgSubtle: '#292E39' } },
      { key: 'mono', name: 'Mono', description: 'Clean monochrome — easy on the eyes', colors: { primary: '#AAAAAA', secondary: '#FFFFFF', muted: '#666666', text: '#CCCCCC', userInput: '#AAAAAA', response: '#FFFFFF', tool: '#CCCCCC', toolResult: '#666666', error: '#FF6666', success: '#66FF66', warning: '#FFAA66', border: '#333333', suggestion: '#FFFFFF', bg: '#0a0a0a', bgSubtle: '#111111' } },
      { key: 'solarized', name: 'Solarized', description: 'Solarized dark', colors: { primary: '#268BD2', secondary: '#2AA198', muted: '#586E75', text: '#839496', userInput: '#2AA198', response: '#268BD2', tool: '#B58900', toolResult: '#586E75', error: '#DC322F', success: '#859900', warning: '#CB4B16', border: '#073642', suggestion: '#2AA198', bg: '#002B36', bgSubtle: '#073642' } },
      { key: 'hacker', name: 'Hacker', description: 'Green on black — classic terminal', colors: { primary: '#00FF00', secondary: '#00CC00', muted: '#006600', text: '#00DD00', userInput: '#00FF00', response: '#00FF00', tool: '#00CC00', toolResult: '#006600', error: '#FF0000', success: '#00FF00', warning: '#FFFF00', border: '#003300', suggestion: '#00CC00', bg: '#000000', bgSubtle: '#050505' } },
      { key: 'catppuccin', name: 'Catppuccin', description: 'Soothing pastel — Mocha flavor', colors: { primary: '#CBA6F7', secondary: '#F5C2E7', muted: '#6C7086', text: '#CDD6F4', userInput: '#89DCEB', response: '#CBA6F7', tool: '#F5C2E7', toolResult: '#6C7086', error: '#F38BA8', success: '#A6E3A1', warning: '#FAB387', border: '#45475A', suggestion: '#F5C2E7', bg: '#1E1E2E', bgSubtle: '#181825' } },
      { key: 'tokyo-night', name: 'Tokyo Night', description: 'Rain-soaked Shibuya — neon signs in the dark', colors: { primary: '#FF7AC6', secondary: '#7DCFFF', muted: '#3B4261', text: '#A9B1D6', userInput: '#FF9E64', response: '#FF7AC6', tool: '#7DCFFF', toolResult: '#3B4261', error: '#F7768E', success: '#73DACA', warning: '#FF9E64', border: '#2A2E40', suggestion: '#7DCFFF', bg: '#1A1B26', bgSubtle: '#16161E' } },
      { key: 'one-dark', name: 'One Dark', description: 'Atom editor classic', colors: { primary: '#61AFEF', secondary: '#C678DD', muted: '#5C6370', text: '#ABB2BF', userInput: '#56B6C2', response: '#61AFEF', tool: '#C678DD', toolResult: '#5C6370', error: '#E06C75', success: '#98C379', warning: '#E5C07B', border: '#3E4451', suggestion: '#C678DD', bg: '#282C34', bgSubtle: '#21252B' } },
      { key: 'rose-pine', name: 'Rosé Pine', description: 'Elegant dark florals', colors: { primary: '#EBBCBA', secondary: '#C4A7E7', muted: '#6E6A86', text: '#E0DEF4', userInput: '#9CCFD8', response: '#EBBCBA', tool: '#C4A7E7', toolResult: '#6E6A86', error: '#EB6F92', success: '#31748F', warning: '#F6C177', border: '#403D52', suggestion: '#C4A7E7', bg: '#191724', bgSubtle: '#1F1D2E' } },
      { key: 'synthwave', name: 'Synthwave', description: 'Retro 80s sunset — outrun aesthetics', colors: { primary: '#F92AAD', secondary: '#E9F501', muted: '#614D85', text: '#F4EEFF', userInput: '#36F9F6', response: '#F92AAD', tool: '#E9F501', toolResult: '#614D85', error: '#FE4450', success: '#72F1B8', warning: '#FF7F11', border: '#2A1B4E', suggestion: '#36F9F6', bg: '#1A0A2E', bgSubtle: '#0F0020' } },
      { key: 'blood-moon', name: 'Blood Moon', description: 'Dark crimson — for the night coders', colors: { primary: '#FF4444', secondary: '#CC2936', muted: '#5C2626', text: '#E0C4C4', userInput: '#FF6B6B', response: '#FF4444', tool: '#CC2936', toolResult: '#5C2626', error: '#FF0000', success: '#4CAF50', warning: '#FF8C00', border: '#3C1515', suggestion: '#CC2936', bg: '#1A0606', bgSubtle: '#0F0303' } },
      { key: 'hot-dog', name: 'Hot Dog', description: 'Cursed ketchup & mustard — you asked for it', colors: { primary: '#FF0000', secondary: '#FFFF00', muted: '#AA6600', text: '#FFFF00', userInput: '#FF0000', response: '#FFFF00', tool: '#FF6600', toolResult: '#AA6600', error: '#FF0000', success: '#00FF00', warning: '#FFFF00', border: '#552200', suggestion: '#FFFF00', bg: '#1A0000', bgSubtle: '#0F0000' } },
      { key: 'acid', name: 'Acid', description: 'Every color at once — sensory overload', colors: { primary: '#FF00FF', secondary: '#00FF88', muted: '#FF6B00', text: '#FFFF00', userInput: '#00FFFF', response: '#FF3399', tool: '#33FF00', toolResult: '#FF6B00', error: '#FF0044', success: '#00FF66', warning: '#FFD700', border: '#FF00AA', suggestion: '#00FFCC', bg: '#1A001A', bgSubtle: '#0F000F' } },
    ],
  }))

  // ── Project / cwd helpers ──
  ipcMain.handle('project:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    const path = result.filePaths[0]
    if (!path) return { ok: false }
    return { ok: true, path, name: basename(path) }
  })
  ipcMain.handle('project:defaultCwd', async () => {
    const config = loadAppConfig()
    if (config.lastCwd && existsSync(config.lastCwd)) return config.lastCwd
    return homedir()
  })

  // ── Preview: run commands in session cwd, stream stdout/stderr ──
  const activeChildren = new Map<string, ChildProcess>()
  ipcMain.handle('run:start', async (_e, opts: { runId: string; command: string; cwd: string }) => {
    const { runId, command, cwd } = opts
    if (!command?.trim()) return { ok: false, error: 'Empty command' }
    if (activeChildren.has(runId)) return { ok: false, error: 'Run already active' }
    if (!existsSync(cwd)) return { ok: false, error: 'cwd does not exist' }
    try {
      const child = spawn(command, {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      })
      activeChildren.set(runId, child)
      mainWindow?.webContents.send('run:started', { runId, pid: child.pid })
      child.stdout?.on('data', (buf) => {
        mainWindow?.webContents.send('run:output', { runId, kind: 'stdout', data: buf.toString() })
      })
      child.stderr?.on('data', (buf) => {
        mainWindow?.webContents.send('run:output', { runId, kind: 'stderr', data: buf.toString() })
      })
      child.on('error', (err) => {
        mainWindow?.webContents.send('run:output', { runId, kind: 'stderr', data: `\n${err.message}\n` })
      })
      child.on('close', (code, signal) => {
        activeChildren.delete(runId)
        mainWindow?.webContents.send('run:exit', { runId, code, signal })
      })
      return { ok: true, pid: child.pid }
    } catch (err: any) {
      activeChildren.delete(runId)
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
  ipcMain.handle('run:stop', async (_e, runId: string) => {
    const child = activeChildren.get(runId)
    if (!child) return { ok: false, error: 'No active run' }
    try {
      if (process.platform === 'win32') child.kill()
      else child.kill('SIGTERM')
      setTimeout(() => {
        if (activeChildren.has(runId)) child.kill('SIGKILL')
      }, 2000)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
}

async function runBackgroundAgent(id: string): Promise<void> {
  const job = bgAgents.getBackgroundAgent(id)
  if (!job) return
  bgAgents.markRunning(id)
  emit('bgAgents:update', { id, status: 'running' })
  try {
    const cred = auth.getCredential(job.provider)
    const route = providerRoute(job.provider)
    if (route.needsKey && !cred) throw new Error('No credentials configured for ' + job.provider)
    const appConfig = loadAppConfig()
    const systemPrompt = buildSystemPrompt({ cwd: job.cwd, activeSkillIds: appConfig.activeSkillIds ?? [], memoryScope: job.cwd })
    const agent = new CodingAgent(
      {
        provider: route.providerType, model: job.model,
        baseUrl: cred?.baseUrl || route.baseUrl,
        apiKey: cred?.apiKey || 'not-needed',
        cwd: job.cwd, systemPrompt, messages: [],
        approvalMode: 'full-auto',
        reasoningEffort: appConfig.reasoningEffort ?? 'off',
        scope: job.cwd,
      },
      {
        onText: (delta) => emit('bgAgents:text', { id, delta }),
        onToolCall: (call) => emit('bgAgents:toolCall', { id, call }),
      },
    )
    const result = await agent.run(job.prompt)
    bgAgents.markDone(id, result.text, {
      iterations: result.iterations,
      promptTokens: result.totalPromptTokens,
      completionTokens: result.totalCompletionTokens,
    })
    emit('bgAgents:update', { id, status: 'done', text: result.text })
  } catch (err: any) {
    const msg = auth.scrubSecrets(err?.message ?? String(err))
    bgAgents.markError(id, msg)
    emit('bgAgents:update', { id, status: 'error', error: msg })
  }
}

async function runScheduledTask(task: cron.ScheduledTask): Promise<void> {
  cron.markRun(task.id, 'triggered')
  const bgId = bgAgents.createBackgroundAgent({
    name: `cron: ${task.name}`,
    cwd: task.cwd,
    provider: task.provider,
    model: task.model,
    prompt: task.prompt,
  })
  emit('cron:fired', { taskId: task.id, backgroundAgentId: bgId })
  try {
    await runBackgroundAgent(bgId)
    cron.markRun(task.id, 'ok')
  } catch (err: any) {
    cron.markRun(task.id, `error: ${err?.message ?? String(err)}`)
  }
}

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', auth.scrubSecrets(err?.message ?? String(err))))
process.on('unhandledRejection', (err: any) => console.error('Unhandled Rejection:', auth.scrubSecrets(err?.message ?? String(err))))
