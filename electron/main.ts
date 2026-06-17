import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, powerSaveBlocker, Tray, Menu, nativeImage } from 'electron'
import dns from 'node:dns'

// Prefer IPv4 when resolving hostnames. Node 22 / undici default to IPv6
// first, which silently breaks any LAN/VPN scenario where the remote host
// has both A and AAAA records but the actual server is only bound to the
// IPv4 interface. Real-world examples we've hit:
//   - LM Studio / Ollama / llama.cpp bound to 0.0.0.0 (IPv4 only) over
//     Tailscale: AAAA resolves to a routable Tailscale IPv6, the connect
//     succeeds at TCP level but llama-server isn't listening, RST.
//   - macOS Bonjour mDNS .local hostnames similarly returning both
//     families when the service is IPv4-only.
//
// Setting this global preference forces A records to be tried first;
// IPv6 still falls back if IPv4 fails. Has no effect on cloud providers
// (they all serve IPv4). Must run BEFORE any HTTP client is constructed.
dns.setDefaultResultOrder('ipv4first')

import {
  startRemoteServer, generateDeviceToken, generatePairingCode, timingSafeStrEq,
  localAddresses, type RemoteServerHandle,
} from './core/remoteServer'
import { join, dirname, basename, relative, extname } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'fs'
import { homedir, totalmem, cpus } from 'os'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { CodingAgent, type ApprovalResult, type ApprovalMode, type ReasoningEffort } from './core/agent.js'
import { buildSystemPrompt, buildChatModePrompt } from './core/prompt.js'
import * as sessions from './core/sessions.js'
import * as auth from './core/auth.js'
import { loginAnthropicOAuth } from './core/anthropicOAuth.js'
import { loginOpenAICodexOAuth } from './core/openaiOAuth.js'
import * as mcp from './core/mcp.js'
import * as memory from './core/memory.js'
import * as hooksMod from './core/hooks.js'
import * as gitMod from './core/git.js'
import * as skillsMod from './core/skills.js'
import * as checkpoints from './core/checkpoints.js'
import * as bgAgents from './core/backgroundAgents.js'
import { makeHardwareProfile, recommendModels } from './core/cookbook.js'
import * as cron from './core/cron.js'
import { runSubagent } from './core/subagent.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
// Tracks "user is quitting on purpose" vs "user closed window but we should
// keep running". Without this flag, the close-handler can't distinguish
// red-light-click from Quit-menu and would always hide instead of exit.
let appQuitting = false
let tray: Tray | null = null
let powerSaveBlockerId: number | null = null
let remoteServer: RemoteServerHandle | null = null
let isQuitting = false

// ── In-flight agent runs ──
interface ActiveRun {
  sessionId: string
  abortController: AbortController
  pendingApprovals: Map<string, (decision: ApprovalResult) => void>
  pendingAsks: Map<string, (reply: string) => void>
}
const activeRuns = new Map<string, ActiveRun>()

// ── Preview-panel child processes ──
// Hoisted to module scope so the lifecycle hooks below (quit, render crash,
// window close) can SIGTERM them on app shutdown — otherwise a vite/webpack
// dev server orphans, the user closes the app, and the port stays bound.
const activeChildren = new Map<string, ChildProcess>()

/** Best-effort: SIGTERM every child + abort every agent run. Idempotent. */
function shutdownAllRuntime(reason: string): void {
  for (const run of activeRuns.values()) {
    try { run.abortController.abort() } catch { /* swallow */ }
  }
  activeRuns.clear()
  for (const [id, child] of activeChildren) {
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
      // Give it 500ms to exit cleanly; SIGKILL anything still alive.
      setTimeout(() => { try { child.kill('SIGKILL') } catch { /* swallow */ } }, 500).unref()
    } catch { /* swallow */ }
    activeChildren.delete(id)
  }
  if (reason && reason !== 'before-quit') {
    console.warn(`[main] runtime cleanup triggered by: ${reason}`)
  }
}

// ── App config ──
/** A device that's been paired with this Codemaxxing instance. Each device
 *  carries its own bearer token so we can revoke individually rather than
 *  rotating one shared secret and kicking everybody out. The label and
 *  platform are user-facing — used in the desktop's "from <Marcos's iPhone>"
 *  approval-prompt provenance, the tray menu, and the Remote settings list. */
interface PairedDevice {
  id: string         // Stable id used in audit trails / per-device revoke
  label: string      // "Marcos's iPhone", "Work laptop", etc.
  platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'browser' | 'cli' | 'unknown'
  token: string      // Long-lived bearer; presented as `Authorization: Bearer <token>`
  createdAt: number  // Pairing time, unix ms
  lastSeenAt: number | null  // Updated by the auth middleware on every authed call
}

/** A short-lived code presented by the desktop, redeemed by the client to
 *  obtain a permanent per-device token. Codes self-expire so a code shoulder-
 *  surfed off the screen 10 minutes ago can't be redeemed. One pairing code
 *  is good for one device; the desktop generates a new one for each pair. */
interface PendingPairing {
  code: string       // 6-char URL-safe (avoids ambiguous 0/O 1/l etc.)
  createdAt: number
  expiresAt: number  // Hard cutoff: 5 minutes from creation by default
}

interface RemoteAccessConfig {
  enabled: boolean
  port: number
  /** Paired devices. Each has its own token. New devices added via the
   *  pairing flow (POST /api/pair). Removed via Settings → Remote → revoke. */
  devices: PairedDevice[]
}

interface AppConfig {
  theme: string
  autoApprove: boolean
  approvalMode?: ApprovalMode
  reasoningEffort?: ReasoningEffort
  activeSkillIds?: string[]
  lastCwd: string | null
  lastProvider: string | null
  lastModel: string | null
  // Run-anywhere foundation. `keepAliveInBackground` keeps the agent loop
  // and HTTP server alive when the user closes the window (clicks the red
  // light). `autoLaunch` puts the app in the macOS login items so it boots
  // on sign-in. Both default OFF — the user opts in from Settings → Remote.
  keepAliveInBackground?: boolean
  autoLaunch?: boolean
  remote?: RemoteAccessConfig
  // Auto-compact: pre-flight context-window check before each user
  // message. See store-side mergeConfig for defaults + clamp range.
  autoCompactEnabled?: boolean
  autoCompactThreshold?: number
}

const CONFIG_DIR = join(homedir(), '.codemaxxing-mac')
const APP_CONFIG_PATH = join(CONFIG_DIR, 'config.json')

function loadAppConfig(): AppConfig {
  try {
    if (existsSync(APP_CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(APP_CONFIG_PATH, 'utf-8'))
      const remoteRaw = data.remote && typeof data.remote === 'object' ? data.remote : null
      // Migrate previous single-token format → device list. Anyone who paired
      // before per-device tokens existed gets one synthetic "legacy" device
      // so they don't have to re-pair on upgrade. After this loads + saves
      // once, the legacy `token` field is dropped.
      let devices: PairedDevice[] = []
      if (remoteRaw) {
        if (Array.isArray(remoteRaw.devices)) {
          devices = remoteRaw.devices
            .filter((d: any) => d && typeof d.id === 'string' && typeof d.token === 'string')
            .map((d: any) => ({
              id: String(d.id),
              label: typeof d.label === 'string' && d.label ? d.label : 'Unnamed device',
              platform: ['ios','android','macos','windows','linux','browser','cli','unknown'].includes(d.platform) ? d.platform : 'unknown',
              token: String(d.token),
              createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
              lastSeenAt: typeof d.lastSeenAt === 'number' ? d.lastSeenAt : null,
            }))
        } else if (typeof remoteRaw.token === 'string' && remoteRaw.token) {
          devices = [{
            id: 'legacy_' + Date.now().toString(36),
            label: 'Legacy device (pre-pairing)',
            platform: 'unknown',
            token: remoteRaw.token,
            createdAt: Date.now(),
            lastSeenAt: null,
          }]
        }
      }
      const remote: RemoteAccessConfig | undefined = remoteRaw
        ? {
            enabled: !!remoteRaw.enabled,
            port: typeof remoteRaw.port === 'number' && remoteRaw.port > 0 ? remoteRaw.port : 7843,
            devices,
          }
        : undefined
      return {
        theme: data.theme ?? 'codemaxxing',
        autoApprove: data.autoApprove ?? false,
        approvalMode: data.approvalMode ?? (data.autoApprove ? 'full-auto' : 'suggest'),
        reasoningEffort: data.reasoningEffort ?? 'off',
        activeSkillIds: Array.isArray(data.activeSkillIds) ? data.activeSkillIds : [],
        lastCwd: data.lastCwd ?? null,
        lastProvider: data.lastProvider ?? null,
        lastModel: data.lastModel ?? null,
        keepAliveInBackground: !!data.keepAliveInBackground,
        autoLaunch: !!data.autoLaunch,
        ...(remote ? { remote } : {}),
        autoCompactEnabled: data.autoCompactEnabled === false ? false : true,
        autoCompactThreshold: typeof data.autoCompactThreshold === 'number'
          ? Math.max(0.5, Math.min(0.95, data.autoCompactThreshold))
          : 0.85,
      }
    }
  } catch { /* fall through */ }
  return {
    theme: 'codemaxxing', autoApprove: false, approvalMode: 'suggest', reasoningEffort: 'off',
    activeSkillIds: [], lastCwd: null, lastProvider: null, lastModel: null,
    keepAliveInBackground: false, autoLaunch: false,
    autoCompactEnabled: true, autoCompactThreshold: 0.85,
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
    // Use 127.0.0.1 explicitly: Node 18+ resolves `localhost` to ::1 first, but
    // LM Studio and Ollama bind IPv4-only by default. The IPv6 connect fails,
    // and the OpenAI SDK doesn't fall back to A records — so listings come back
    // empty and the dropdown looks broken even though the server is healthy.
    case 'ollama': return { providerType: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false }
    case 'lmstudio': return { providerType: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false }
    default: return { providerType: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true }
  }
}

// ── Cost estimation (roughly matches CLI) ──
// Note: estimateCost uses substring matching on the keys, so newer dotted
// variants (e.g. gpt-5.5) automatically inherit the closest base price unless
// listed explicitly. Listed explicitly here so cost shown in /cost is right.
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15 / 1e6, output: 75 / 1e6 },
  'claude-opus-4-6': { input: 15 / 1e6, output: 75 / 1e6 },
  'claude-sonnet-4-6': { input: 3 / 1e6, output: 15 / 1e6 },
  'claude-haiku-4-5-20251001': { input: 1 / 1e6, output: 5 / 1e6 },
  'gpt-5.5-pro': { input: 30 / 1e6, output: 90 / 1e6 },
  'gpt-5.5': { input: 10 / 1e6, output: 30 / 1e6 },
  'gpt-5.4-pro': { input: 30 / 1e6, output: 90 / 1e6 },
  'gpt-5.4': { input: 10 / 1e6, output: 30 / 1e6 },
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
      // .cjs (not .js) — package.json `"type": "module"` would force ESM
      // parsing on a `.js` preload, which Electron silently rejects in
      // sandboxed mode and leaves `window.electron` undefined.
      preload: join(__dirname, 'preload.cjs'),
      // Sandbox the renderer process. Our preload only uses electron's
      // contextBridge/ipcRenderer/webUtils — all permitted in sandboxed mode —
      // so we can lock the renderer down to OS-level sandbox restrictions.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The app shell itself loads only our own dist. webview is enabled for
      // the built-in browser, which runs in an isolated `persist:cmx-browser`
      // partition with no node integration; agent-driven navigation is gated
      // to http(s) (see the browser_* tools).
      webviewTag: true,
    },
  })
  mainWindow.on('ready-to-show', () => {
    // If we were auto-launched as a login item ("server mode"), boot
    // directly into the tray instead of slamming the window onto the user's
    // desktop the moment they sign in. They can still summon it via the
    // tray icon's left-click handler.
    if (!launchedHidden()) mainWindow?.show()
    if (is.dev) mainWindow?.webContents.openDevTools({ mode: 'detach' })
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer crash]', details)
    // Don't leave subprocesses hanging if the renderer died — the user can't
    // see their output anymore and they hold ports/files we may want back.
    shutdownAllRuntime(`render-process-gone:${details.reason}`)
  })
  // 'close' (not 'closed') so we can intercept and hide instead of destroy
  // when the user has opted into 24/7 background operation. This is the
  // foundation for "phone reaches my Mac while the window is shut" — without
  // it the agent loop dies the moment the user clicks the red light.
  mainWindow.on('close', (e) => {
    const cfg = loadAppConfig()
    if (cfg.keepAliveInBackground && !appQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      // On macOS hiding the window also moves focus away cleanly. We
      // intentionally do NOT shut down the runtime here — the whole point
      // is to keep the agent + remote server alive.
      return
    }
    // Shutting down for real (either keepAlive is off, or the user picked
    // Quit from the tray / Cmd+Q). Free runtime resources like normal.
    shutdownAllRuntime('window-closed')
  })
  mainWindow.on('closed', () => { mainWindow = null })
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
  // Apply the persisted preferences at boot. None of these are blocking —
  // we want the window to come up fast even if (e.g.) the remote port is
  // taken and the server fails to bind.
  applyKeepAlivePreference()
  applyAutoLaunchPreference()
  setupTray()
  void startRemoteServerIfEnabled()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else mainWindow?.show()
  })
  cron.startTicker((task) => {
    void runScheduledTask(task).catch(err => {
      cron.markRun(task.id, `error: ${err?.message ?? String(err)}`)
    })
  })
})

app.on('before-quit', () => {
  isQuitting = true
  appQuitting = true
  shutdownAllRuntime('before-quit')
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId)
    powerSaveBlockerId = null
  }
  if (tray) { tray.destroy(); tray = null }
  if (remoteServer) { void remoteServer.stop().catch(() => {}); remoteServer = null }
})
// Default Electron behavior is "quit when last window closes" on Linux/Win.
// We override that ONLY when keepAliveInBackground is on — otherwise the
// app sticks around invisibly with no way to bring it back, which would be a
// bizarre default. On macOS the OS already keeps the app process alive even
// without windows, so this branch is a no-op.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  const cfg = loadAppConfig()
  if (!cfg.keepAliveInBackground) app.quit()
})

// ── 24/7 reliability helpers ──

/** Start/stop the powerSaveBlocker based on the current setting. We use
 *  `prevent-app-suspension` (not `prevent-display-sleep`) — we want the
 *  process to stay scheduled, not to keep the screen lit. The display can
 *  sleep; the agent loop should not. */
function applyKeepAlivePreference(): void {
  const cfg = loadAppConfig()
  const want = !!cfg.keepAliveInBackground
  const isOn = powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)
  if (want && !isOn) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!want && isOn && powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId)
    powerSaveBlockerId = null
  }
}

/** Sync OS-level "launch at login" with the persisted preference. macOS and
 *  Windows expose this through the same Electron API but with different
 *  argument shapes:
 *   - macOS uses `openAsHidden: true` so the app boots into the tray
 *     without throwing a window in the user's face on every login.
 *   - Windows ignores `openAsHidden` (deprecated; Microsoft killed the flag
 *     years ago). The standard pattern is to pass `args: ['--hidden']` and
 *     have the app inspect process.argv to decide whether to show the
 *     window on first paint.
 *   - Linux: Electron doesn't ship a generic implementation for various
 *     desktops (GNOME/KDE/etc); we accept the limitation and just toggle
 *     the in-app flag. A user-shipped `.desktop` autostart entry is the
 *     real answer there.
 */
/** Last value we wrote to the OS so we can skip redundant writes. Without
 *  this, every config save (theme change, approval-mode toggle, etc.)
 *  re-registers the login item, which on Windows triggers a registry write
 *  per save — harmless but spammy in Resource Monitor. */
let lastAutoLaunchApplied: boolean | null = null
function applyAutoLaunchPreference(): void {
  const cfg = loadAppConfig()
  if (process.platform === 'linux') return  // No reliable cross-DE primitive
  const want = !!cfg.autoLaunch
  if (lastAutoLaunchApplied === want) return
  lastAutoLaunchApplied = want
  const settings: Electron.Settings = { openAtLogin: want }
  if (process.platform === 'darwin') {
    settings.openAsHidden = true
  } else if (process.platform === 'win32') {
    settings.args = ['--hidden']
  }
  app.setLoginItemSettings(settings)
}

/** True if this Electron process was launched with the hidden flag — either
 *  by macOS's "Open as Hidden" login item, or by our Windows `--hidden`
 *  argv. Used to suppress the splash window on auto-launch boot. */
function launchedHidden(): boolean {
  if (process.platform === 'darwin') {
    return app.getLoginItemSettings().wasOpenedAsHidden
  }
  if (process.platform === 'win32') {
    return process.argv.includes('--hidden')
  }
  return false
}

/** Build a minimal monochrome tray icon entirely in code so we don't have
 *  to ship an extra asset file. 16x16 is the canonical macOS template size;
 *  Windows scales 16x16 .ico-style images to the system tray's DPI.
 *
 *  - macOS uses `setTemplateImage(true)` so the OS auto-inverts for dark/
 *    light menubar.
 *  - Windows expects a colored icon (template images render as black-on-
 *    black on the dark Win11 taskbar). We use the same pixel buffer but
 *    don't mark it as template; Windows picks it up as a regular bitmap.
 *  - Linux (GNOME/KDE/Cinnamon/Sway/etc.): legend has it that 22x22 is the
 *    right size; in practice 16x16 looks fine on every DE I've tried. We
 *    use the same buffer.
 */
function buildTrayIcon(): Electron.NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4) // all zero = transparent
  const setPixel = (x: number, y: number) => {
    const o = (y * size + x) * 4
    // macOS template wants black; Windows looks fine with black on light
    // taskbar and is auto-inverted on the dark taskbar in Win11. Black is
    // the safe cross-platform choice.
    buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 255
  }
  // Crude block-letter "C" centered in the 16x16 grid.
  for (let y = 3; y <= 12; y++) { setPixel(4, y); setPixel(5, y) }
  for (let x = 5; x <= 11; x++) { setPixel(x, 3); setPixel(x, 4); setPixel(x, 11); setPixel(x, 12) }
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  return img
}

function setupTray(): void {
  if (tray) return
  try {
    tray = new Tray(buildTrayIcon())
    tray.setToolTip('Codemaxxing')
    refreshTrayMenu()
    // Click the tray icon → bring the window forward (or recreate it). On
    // macOS we want left-click to open the app, not just the menu.
    tray.on('click', () => {
      if (!mainWindow) return createWindow()
      if (mainWindow.isVisible()) mainWindow.focus()
      else mainWindow.show()
    })
  } catch (e) {
    console.error('[tray] failed to create:', e)
  }
}

function refreshTrayMenu(): void {
  if (!tray) return
  const cfg = loadAppConfig()
  const remoteOn = !!cfg.remote?.enabled
  const port = cfg.remote?.port ?? 7843
  const deviceCount = (cfg.remote?.devices ?? []).length
  const remoteLabel = remoteOn
    ? `Remote: on · ${deviceCount} device${deviceCount === 1 ? '' : 's'} · port ${port}`
    : 'Remote: off'
  const menu = Menu.buildFromTemplate([
    { label: remoteLabel, enabled: false },
    { type: 'separator' },
    { label: 'Show Codemaxxing', click: () => { if (!mainWindow) createWindow(); else mainWindow.show() } },
    { type: 'separator' },
    {
      label: 'Keep running in background',
      type: 'checkbox',
      checked: !!cfg.keepAliveInBackground,
      click: (item) => {
        const next = { ...loadAppConfig(), keepAliveInBackground: item.checked }
        saveAppConfig(next)
        applyKeepAlivePreference()
        refreshTrayMenu()
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { appQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
}

// ── Remote server lifecycle ──

/**
 * Pending pairing codes, in-memory only. By design these never persist —
 * a code is good for one device for five minutes, after which it's gone.
 * Keyed by code (uppercased), value is creation time. Cleared on consumption
 * or expiry. A cron-like sweep keeps the table small.
 */
const PAIRING_TTL_MS = 5 * 60 * 1000
const pendingPairings = new Map<string, { createdAt: number; expiresAt: number }>()

function expirePairings(): void {
  const now = Date.now()
  for (const [code, p] of pendingPairings) {
    if (p.expiresAt < now) pendingPairings.delete(code)
  }
}

/** Issue a new pairing code. Up to one fresh code at a time per session —
 *  if the user clicks "Pair a device" twice the older code is invalidated.
 *  Returns the code in plaintext; the renderer turns it into a QR. */
function issuePairingCode(): { code: string; expiresAt: number } {
  expirePairings()
  // Invalidate any prior un-redeemed code so users aren't confused by which
  // one is current. Single-active-code policy is simple and safe.
  pendingPairings.clear()
  const code = generatePairingCode()
  const createdAt = Date.now()
  const expiresAt = createdAt + PAIRING_TTL_MS
  pendingPairings.set(code, { createdAt, expiresAt })
  return { code, expiresAt }
}

async function startRemoteServerIfEnabled(): Promise<void> {
  const cfg = loadAppConfig()
  if (!cfg.remote?.enabled) return
  await startRemoteServerNow()
}

async function startRemoteServerNow(): Promise<{ ok: boolean; error?: string }> {
  if (remoteServer) return { ok: true }
  const cfg = loadAppConfig()
  if (!cfg.remote?.enabled) return { ok: false, error: 'Remote access not configured' }
  try {
    remoteServer = await startRemoteServer({
      port: cfg.remote.port,
      bus: agentBus,
      handlers: remoteHandlers(),
    })
    refreshTrayMenu()
    return { ok: true }
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    console.error('[remote] failed to start:', msg)
    return { ok: false, error: msg }
  }
}

async function stopRemoteServerNow(): Promise<void> {
  if (!remoteServer) return
  try { await remoteServer.stop() } catch { /* swallow */ }
  remoteServer = null
  refreshTrayMenu()
}

/** Glue between the HTTP server and the existing IPC handler logic.
 *  Trampolines through ipcMain.handle internals for the heavy turn-orchestration
 *  paths so there's a single source of truth for what an "agent send" or an
 *  "approval response" does — the desktop and a future phone client take
 *  exactly the same code path through the agent runtime. */
function remoteHandlers() {
  return {
    listSessions: async () => ({ ok: true, sessions: sessions.listSessions() }),
    getSession: async (id: string) => {
      const sess = sessions.getSession(id)
      if (!sess) return { ok: false, error: 'Session not found' }
      const messages = sessions.loadMessages(id)
      return { ok: true, session: { ...sess, messages } }
    },
    createSession: async (opts: { cwd: string; provider: string; model: string; title?: string; mode?: string }) => {
      const id = sessions.createSession(
        opts.cwd,
        opts.provider,
        opts.model,
        opts.title,
        opts.mode === 'chat' ? 'chat' : 'code',
      )
      return { ok: true, id }
    },
    deleteSession: async (id: string) => {
      sessions.deleteSession(id)
      return { ok: true }
    },
    agentSend: (opts: { sessionId: string; message: string }) => callShared('agent:send', opts),
    agentAbort: (sessionId: string) => callShared('agent:abort', sessionId),
    agentApproval: (sessionId: string, callId: string, decision: unknown) =>
      callShared('agent:approvalResponse', sessionId, callId, decision),
    listProviders: () => callShared('auth:providers'),
    appInfo: () => ({
      name: 'Codemaxxing',
      version: app.getVersion(),
      platform: process.platform,
    }),
    /** Constant-time bearer-token lookup. Sweeping over the device list is
     *  fine — even at 100 paired devices this is microseconds. */
    resolveToken: (presented: string): PairedDevice | null => {
      const cfg = loadAppConfig()
      const list = cfg.remote?.devices ?? []
      // Length-check first to fast-reject obvious garbage without scanning.
      // Real tokens are always the same length (43 chars base64url of 32 bytes).
      for (const d of list) {
        if (timingSafeStrEq(d.token, presented)) return d
      }
      return null
    },
    /** Update lastSeenAt. Debounced: writes config.json at most once per
     *  10s per device to avoid hammering the disk during streaming. */
    touchDevice: (deviceId: string) => {
      const now = Date.now()
      const last = lastTouchAt.get(deviceId) ?? 0
      if (now - last < 10_000) return
      lastTouchAt.set(deviceId, now)
      const cfg = loadAppConfig()
      const next = (cfg.remote?.devices ?? []).map((d) => d.id === deviceId ? { ...d, lastSeenAt: now } : d)
      saveAppConfig({ ...cfg, remote: { enabled: cfg.remote?.enabled ?? false, port: cfg.remote?.port ?? 7843, devices: next } })
    },
    /** Validate a pairing code, mint a fresh device token, persist. Single-
     *  use: the code is consumed atomically here. Concurrent redemption
     *  attempts (rare but possible) are serialized by the JS event loop, so
     *  only the first one wins. */
    redeemPairing: (code: string, label: string, platform: PairedDevice['platform']) => {
      expirePairings()
      const entry = pendingPairings.get(code)
      if (!entry) return { ok: false as const, error: 'Invalid or expired pairing code' }
      if (entry.expiresAt < Date.now()) {
        pendingPairings.delete(code)
        return { ok: false as const, error: 'Pairing code expired' }
      }
      pendingPairings.delete(code)

      const device: PairedDevice = {
        id: 'dev_' + randomBytes(6).toString('base64url'),
        label: label.slice(0, 64) || 'Unnamed device',
        platform,
        token: generateDeviceToken(),
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      }
      const cfg = loadAppConfig()
      const existing = cfg.remote?.devices ?? []
      const next = [...existing, device]
      saveAppConfig({ ...cfg, remote: { enabled: cfg.remote?.enabled ?? true, port: cfg.remote?.port ?? 7843, devices: next } })
      refreshTrayMenu()
      // Notify the renderer so the Settings → Remote panel updates live
      // when a phone redeems the code.
      mainWindow?.webContents.send('remote:devicesChanged')
      return { ok: true as const, device }
    },
  }
}

// Per-device debounce map for `touchDevice`. Resets on app restart, which is
// fine — over-eagerly persisting `lastSeenAt` once per restart is harmless.
const lastTouchAt = new Map<string, number>()

// Single fan-out point for every event the renderer (and now the remote API)
// cares about. Keeps webContents.send and the remote-server EventEmitter in
// lockstep so any future client (phone app, external tool, MCP gateway) sees
// exactly the same event stream the desktop UI does.
//
// Approval prompts get a light extra hand: if the desktop window is hidden
// when an approval request fires (e.g. cron task runs, remote client triggers
// an action) we surface the window so the user can actually see + respond.
// Without this, the approval times out invisibly and the agent stalls.
import { EventEmitter } from 'events'
export const agentBus = new EventEmitter()
// Each SSE connection adds ~13 listeners; default 10 trips the warning the
// moment more than zero clients are connected. 200 covers reasonable real-
// world usage (renderer + a few paired devices + curl/debug consumers).
agentBus.setMaxListeners(200)

// Offscreen capture for the agent's screenshot_preview tool — renders a URL in
// a hidden 1280×800 window and grabs the painted pixels (works cross-origin
// because it's a pixel capture, not DOM access), so the coding agent can SEE
// the UI it builds. Module-scope: no run/session coupling.
let lastPreviewUrl: string | null = null
async function captureUrlOffscreen(url: string): Promise<{ ok: boolean; mime?: string; base64?: string; error?: string }> {
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
    })
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out loading ${url} — is the dev server running?`)), 15_000)),
    ])
    await new Promise((r) => setTimeout(r, 800)) // let the page / SPA settle
    let img = await win.webContents.capturePage()
    if (img.getSize().width > 1280) img = img.resize({ width: 1280 })
    return { ok: true, mime: 'image/png', base64: img.toPNG().toString('base64') }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  } finally {
    try { win?.destroy() } catch { /* already gone */ }
  }
}

function emit(channel: string, ...args: any[]) {
  mainWindow?.webContents.send(channel, ...args)
  agentBus.emit(channel, ...args)
  if (channel === 'agent:approvalRequest' || channel === 'agent:askUser') {
    // The user MUST see this. Window-summon logic centralized so nobody
    // has to remember it at every approval-emission site in the agent.
    raiseWindowForUserAttention()
  }
}

// ─── Built-in browser bridge ─────────────────────────────────────────────────
// The agent drives the SAME <webview> the user sees (Preview → Browser tab).
// Each browser_* tool round-trips here: make sure the Browser tab is open, wait
// for the renderer to report ready, send the command, resolve with what the
// renderer posts back. Mirrors the onAskUser pending-map round-trip.
type BrowserResult = { ok: boolean; error?: string; title?: string; url?: string; text?: string; base64?: string }
const pendingBrowserCmds = new Map<string, (r: BrowserResult) => void>()
let browserReady = false
let browserReadyWaiters: Array<() => void> = []

ipcMain.on('browser:ready', () => {
  browserReady = true
  const waiters = browserReadyWaiters
  browserReadyWaiters = []
  waiters.forEach((fn) => fn())
})
ipcMain.on('browser:closed', () => { browserReady = false })
ipcMain.on('browser:result', (_e, id: string, result: BrowserResult) => {
  const resolve = pendingBrowserCmds.get(id)
  if (resolve) { pendingBrowserCmds.delete(id); resolve(result) }
})

function waitForBrowserReady(timeoutMs = 4000): Promise<void> {
  if (browserReady) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(() => {
      browserReadyWaiters = browserReadyWaiters.filter((fn) => fn !== done)
      resolve() // proceed anyway; the command will time out if truly unavailable
    }, timeoutMs)
    browserReadyWaiters.push(done)
  })
}

async function browserCommand(
  cmd: { action: 'navigate' | 'read' | 'screenshot' | 'click'; url?: string; selector?: string; text?: string },
): Promise<BrowserResult> {
  emit('browser:open') // open the Preview panel + select Browser tab (idempotent)
  await waitForBrowserReady()
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return await new Promise<BrowserResult>((resolve) => {
    const timeout = setTimeout(() => {
      if (pendingBrowserCmds.delete(id)) resolve({ ok: false, error: 'Browser command timed out (is the Browser tab reachable?).' })
    }, cmd.action === 'navigate' ? 30_000 : 20_000)
    pendingBrowserCmds.set(id, (r) => { clearTimeout(timeout); resolve(r) })
    emit('browser:command', { id, ...cmd })
  })
}

/** Make sure the desktop window is visible and focused. Called when an
 *  agent event needs immediate user attention (approval, ask-user). Cheap
 *  to call when the window is already up — `show()` + `focus()` are no-ops
 *  on a window that's already visible/focused. */
function raiseWindowForUserAttention(): void {
  if (!mainWindow) {
    // Window was destroyed (keepAlive off, user closed). Bring it back.
    createWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  // On macOS, `app.dock.bounce()` makes the icon hop to draw the user's
  // eye — useful when they're in another app and the menubar icon alone
  // isn't loud enough. No-op on Windows/Linux.
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.bounce('informational') } catch { /* not critical */ }
  }
}

/** Registry of IPC invoke handlers that ALSO need to be callable by the
 *  remote API. Replaces a previous trampoline through Electron's private
 *  `_invokeHandlers` Map — that worked but was undocumented private API
 *  and would have broken silently on a future Electron upgrade.
 *
 *  Use `registerInvoke()` instead of `ipcMain.handle()` for any handler
 *  that should be reachable from the HTTP API. The function gets registered
 *  in BOTH places: the renderer's IPC channel (with the IpcMainInvokeEvent
 *  shape) AND a plain Map the remote server reads.
 */
const sharedInvokeHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
function registerInvoke<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R>): void {
  sharedInvokeHandlers.set(channel, fn as (...args: unknown[]) => Promise<unknown>)
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
}
function callShared<R = unknown>(channel: string, ...args: unknown[]): Promise<R> {
  const fn = sharedInvokeHandlers.get(channel)
  if (!fn) return Promise.resolve({ ok: false, error: `Handler not registered: ${channel}` } as R)
  return fn(...args) as Promise<R>
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
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    // Only allow well-known web/mail schemes. Without this, a renderer that
    // got XSS'd by an OAuth response could call this IPC with `file://` or
    // a custom protocol and trigger arbitrary handlers via the OS.
    try {
      const parsed = new URL(url)
      const allowed = new Set(['http:', 'https:', 'mailto:'])
      if (!allowed.has(parsed.protocol)) {
        return { ok: false, error: `Refusing to open URL with scheme ${parsed.protocol}` }
      }
    } catch {
      return { ok: false, error: 'Invalid URL' }
    }
    await shell.openExternal(url)
    return { ok: true }
  })
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
  // Curated lists for providers that don't expose a useful /v1/models endpoint
  // for OAuth tokens (Anthropic has no list API; ChatGPT OAuth's backend-api
  // doesn't return the current frontier model set; Qwen's listing is noisy).
  // These are kept in sync with ~/Projects/codemaxxing/src/index.tsx.
  const CLAUDE_MODELS = [
    'claude-opus-4-7',         // released 2026-04-16
    'claude-opus-4-6',
    'claude-sonnet-4-6',       // released 2026-02-17
    'claude-haiku-4-5-20251001',
  ]
  const OPENAI_MODELS = [
    'gpt-5.5-pro',             // released 2026-04-23
    'gpt-5.5',
    'gpt-5.4-pro',
    'gpt-5.4',
    'gpt-5',
    'gpt-5-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'o3',
    'o4-mini',
    'gpt-4o',
  ]
  const QWEN_MODELS = ['qwen-max', 'qwen-plus', 'qwen-turbo']

  ipcMain.handle('llm:listModels', async (_e, providerId: string) => {
    try {
      if (providerId === 'anthropic') {
        return { ok: true, models: CLAUDE_MODELS.map(m => ({ name: m, id: m })) }
      }

      const cred = auth.getCredential(providerId)
      const route = providerRoute(providerId)
      const apiKey = cred?.apiKey || 'not-needed'
      // Local providers: ignore any persisted `localhost` baseUrl from old
      // sessions — Node prefers ::1, LM Studio / Ollama bind IPv4-only, and a
      // stale cred would silently override the route fix. Force 127.0.0.1.
      let baseUrl = cred?.baseUrl || route.baseUrl
      if (providerId === 'lmstudio' || providerId === 'ollama') {
        baseUrl = baseUrl.replace('://localhost', '://127.0.0.1').replace('://[::1]', '://127.0.0.1')
      }

      // OpenAI: ChatGPT OAuth tokens hit chatgpt.com/backend-api which doesn't
      // expose a usable models list. For OAuth/cached-token creds (or any
      // non-`sk-` token), surface the curated frontier list. Real API keys
      // still query /v1/models so users see whatever their org has access to.
      if (providerId === 'openai') {
        const isOAuthToken = cred && (
          cred.method === 'oauth' ||
          cred.method === 'cached-token' ||
          (typeof cred.apiKey === 'string' && !cred.apiKey.startsWith('sk-') && !cred.apiKey.startsWith('sess-'))
        )
        if (isOAuthToken) {
          return { ok: true, models: OPENAI_MODELS.map(m => ({ name: m, id: m })) }
        }
      }

      // Qwen: short curated list — their /models endpoint returns dozens of
      // unrelated entries (embedding models, vision, etc.).
      if (providerId === 'qwen') {
        return { ok: true, models: QWEN_MODELS.map(m => ({ name: m, id: m })) }
      }

      // Local & self-hosted providers: skip the OpenAI SDK entirely and
      // use a plain HTTP GET. The SDK has historically had quirks with
      // edge cases (gzip from some local servers, weird Connection
      // headers, server-sent text/event-stream where models.list expects
      // application/json, etc.) that result in an empty array or opaque
      // errors even when the server is healthy. Direct fetch is also
      // ~10x faster to fail when the server isn't running.
      //
      // 'custom' falls into this bucket because the typical custom
      // provider IS a self-hosted server (llama.cpp, vLLM, text-gen-webui,
      // a Tailscale-exposed home rig, etc.). For these, the SDK is
      // overkill and its layered error messages obscure what's actually
      // wrong (DNS, TCP, TLS, HTTP shape — all collapsed to "Connection
      // error.").
      if (providerId === 'lmstudio' || providerId === 'ollama' || providerId === 'custom') {
        if (!baseUrl) {
          return { ok: false, error: 'No base URL configured for this provider. Open Settings → Providers and set the URL of your server (e.g. http://your-tailnet-host:8080/v1).' }
        }
        console.log('[llm:listModels] local probe', providerId, baseUrl)
        let url: string
        try {
          url = new URL('models', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString()
        } catch {
          return { ok: false, error: `Invalid base URL "${baseUrl}". Expected something like http://host:port/v1` }
        }
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
          if (!res.ok) {
            return { ok: false, error: `Server at ${url} returned HTTP ${res.status}. Make sure it speaks the OpenAI-compatible /models endpoint.` }
          }
          const json: any = await res.json()
          const models = Array.isArray(json?.data) ? json.data : []
          console.log('[llm:listModels]', providerId, 'returned', models.length, 'models')
          return { ok: true, models: models.map((m: any) => ({ name: m.id, id: m.id })) }
        } catch (err: any) {
          // Pull out the underlying cause (DNS, TCP, TLS) when undici
          // wraps it. Surface what we actually tried so the user can
          // tell whether the URL or the server is the problem.
          const cause = (err?.cause?.code ?? err?.code ?? '') as string
          const rootMsg = err?.cause?.message ?? err?.message ?? String(err)
          let hint = ''
          if (cause === 'ENOTFOUND' || /ENOTFOUND/.test(rootMsg)) {
            hint = ' — hostname could not be resolved. Check spelling, and that your VPN/Tailscale is connected.'
          } else if (cause === 'ECONNREFUSED' || /ECONNREFUSED/.test(rootMsg)) {
            hint = ' — server is not accepting connections. Verify it\'s running and listening on this port.'
          } else if (cause === 'ETIMEDOUT' || /ETIMEDOUT|timeout|timed out/i.test(rootMsg)) {
            hint = ' — connection timed out. Check firewall/network reachability.'
          } else if (cause === 'ECONNRESET' || /ECONNRESET/.test(rootMsg)) {
            hint = ' — connection reset. Possibly an IPv4/IPv6 mismatch (server bound to one, client connecting to the other).'
          } else if (/CERT_|certificate/i.test(rootMsg)) {
            hint = ' — TLS certificate error. If using a self-signed cert, you\'ll need to use plain http or trust the cert.'
          }
          return { ok: false, error: `Couldn't reach ${url}: ${rootMsg}${hint}` }
        }
      }

      const client = new OpenAI({ apiKey, baseURL: baseUrl })
      const response = await client.models.list()
      return { ok: true, models: response.data.map(m => ({ name: m.id, id: m.id })) }
    } catch (err: any) {
      console.error('[llm:listModels] error', providerId, err?.message ?? err)
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
  ipcMain.handle('session:create', async (_e, opts: { cwd: string; provider: string; model: string; title?: string; mode?: 'code' | 'chat' }) => {
    const id = sessions.createSession(opts.cwd, opts.provider, opts.model, opts.title, opts.mode ?? 'code')
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
  ipcMain.handle('session:updateMode', async (_e, id: string, mode: 'code' | 'chat') => {
    sessions.updateSessionMode(id, mode); return { ok: true }
  })
  ipcMain.handle('session:setCwd', async (_e, id: string, cwd: string) => {
    const s = sessions.getSession(id)
    if (!s) return { ok: false, error: 'Not found' }
    sessions.updateSessionCwd(id, cwd)
    return { ok: true }
  })

  // ── Agent run ──
  // Per-image cap. Anthropic and OpenAI both reject very large images
  // anyway, but base64 inflates ~33%, so we want to reject before that
  // ~10MB blob hits the SQLite write — otherwise a single bad paste leaves
  // a multi-MB row that gets re-loaded on every history fetch.
  const MAX_IMAGE_BYTES_RAW = 8 * 1024 * 1024 // 8MB raw; ~10.7MB as base64
  registerInvoke('agent:send', async (opts: { sessionId: string; message: string; images?: Array<{ id?: string; dataUrl: string; mediaType: string; name?: string }> }) => {
    // Reject overlapping sends for the same session. Without this, a fast
    // double-click on Send (or a queued IPC during a slow stream) spawns a
    // second CodingAgent reading the same SQLite history, both writing
    // assistant messages back, and clobbering each other's `activeRuns`
    // entry — which makes `agent:abort` only stop one of them.
    if (activeRuns.has(opts.sessionId)) {
      return { ok: false, error: 'A run is already in progress for this session' }
    }
    if (opts.images && opts.images.length > 0) {
      for (const img of opts.images) {
        // Estimate raw size from base64 length: ~3/4 of the data segment.
        const dataSegment = img.dataUrl.includes(',') ? img.dataUrl.split(',', 2)[1] ?? '' : img.dataUrl
        const approxBytes = Math.floor((dataSegment.length * 3) / 4)
        if (approxBytes > MAX_IMAGE_BYTES_RAW) {
          return {
            ok: false,
            error: `Image ${img.name || 'attachment'} is ${(approxBytes / 1024 / 1024).toFixed(1)}MB — over the ${MAX_IMAGE_BYTES_RAW / 1024 / 1024}MB cap.`,
          }
        }
      }
    }
    const sess = sessions.getSession(opts.sessionId)
    if (!sess) return { ok: false, error: 'Session not found' }
    const cred = auth.getCredential(sess.provider)
    const route = providerRoute(sess.provider)
    if (route.needsKey && !cred) return { ok: false, error: 'No credentials configured for ' + sess.provider }

    const appConfig = loadAppConfig()

    // Load existing history
    const history = sessions.loadMessages(opts.sessionId)

    // Build the user message. With images attached we use the OpenAI-style
    // content-array shape (`[{type:'text'}, {type:'image_url'}]`) which is
    // the lingua franca our provider adapters speak — Anthropic / Responses
    // API code converts away from this shape on its own. The same array is
    // persisted so reloading the session replays the images correctly.
    const hasImages = !!opts.images && opts.images.length > 0
    const userMsg: ChatCompletionMessageParam = hasImages
      ? {
          role: 'user',
          content: [
            ...(opts.message ? [{ type: 'text' as const, text: opts.message }] : []),
            ...opts.images!.map(img => ({
              type: 'image_url' as const,
              image_url: { url: img.dataUrl },
            })),
          ],
        }
      : { role: 'user', content: opts.message }
    sessions.saveMessage(opts.sessionId, userMsg)

    // Chat-mode sessions get a stripped-down conversational prompt; the
    // default code prompt includes the repo map, project rules, and full
    // coding-agent persona that would only confuse a chat-only session.
    const isChatMode = sess.mode === 'chat'
    const systemPrompt = isChatMode
      ? buildChatModePrompt({
          activeSkillIds: appConfig.activeSkillIds ?? [],
          memoryScope: sess.cwd,
        })
      : buildSystemPrompt({
          cwd: sess.cwd,
          activeSkillIds: appConfig.activeSkillIds ?? [],
          memoryScope: sess.cwd,
        })

    // MCP servers are coding-agent infrastructure — skip them entirely in
    // chat mode so a chat session never blocks on MCP startup or surfaces
    // approval prompts the user wouldn't expect from a plain chat.
    if (!isChatMode) try {
      await mcp.connectToServers(sess.cwd, {
        onStatus: (name, status) => emit('mcp:status', { name, status }),
        approve: async (name, cfg) => {
          // synchronous (blocking) approval — emit event and wait
          return new Promise<boolean>((resolve) => {
            // crypto.randomBytes — Math.random is predictable, and although
            // these tokens are short-lived in-process they're sent over IPC
            // and matched on response, so an unguessable id keeps a buggy
            // renderer from accidentally racing-ahead a wrong approval.
            const token = `mcp_${randomBytes(16).toString('hex')}`
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
        mode: sess.mode,
      },
      {
        onText: (delta) => emit('agent:text', { sessionId: opts.sessionId, delta }),
        onThinking: (delta) => emit('agent:thinking', { sessionId: opts.sessionId, delta }),
        onIteration: (n) => emit('agent:iteration', { sessionId: opts.sessionId, iteration: n }),
        onToolCall: (call) => emit('agent:toolCall', { sessionId: opts.sessionId, call }),
        onTaskChange: (tasks) => emit('agent:tasks', { sessionId: opts.sessionId, tasks }),
        onToolApproval: async (call) => {
          // Race the user's decision against (a) the run being aborted and
          // (b) the renderer being torn down. Without this, hitting Stop
          // while an approval prompt is up would leave the run frozen
          // forever waiting on a button that no longer exists.
          return await new Promise<ApprovalResult>((resolve) => {
            run.pendingApprovals.set(call.id, resolve)
            emit('agent:approvalRequest', { sessionId: opts.sessionId, call })
            const onAbort = () => {
              if (run.pendingApprovals.delete(call.id)) resolve('no')
            }
            if (abort.signal.aborted) onAbort()
            else abort.signal.addEventListener('abort', onAbort, { once: true })
          })
        },
        onAskUser: async (question, options) => {
          const askId = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          return await new Promise<string>((resolve) => {
            run.pendingAsks.set(askId, resolve)
            emit('agent:askUser', { sessionId: opts.sessionId, askId, question, options })
            const onAbort = () => {
              if (run.pendingAsks.delete(askId)) resolve('') // empty = treated as no answer
            }
            if (abort.signal.aborted) onAbort()
            else abort.signal.addEventListener('abort', onAbort, { once: true })
          })
        },
        onOpenPreview: (url: string) => {
          lastPreviewUrl = url
          emit('preview:open', url)
        },
        onCapturePreview: async (url?: string) => {
          const target = (url || lastPreviewUrl || '').trim()
          if (!target) return { ok: false, error: 'No preview URL — call open_preview first or pass a url.' }
          lastPreviewUrl = target
          emit('preview:open', target) // show the user the same page the agent is capturing
          return await captureUrlOffscreen(target)
        },
        onBrowserCommand: browserCommand,
        onPlanExit: (plan) => emit('agent:planExit', { sessionId: opts.sessionId, plan }),
        onUsage: (u) => emit('agent:usage', { sessionId: opts.sessionId, usage: u }),
        onStats: (s) => emit('agent:stats', { sessionId: opts.sessionId, stats: s }),
      },
    )

    try {
      const result = await agent.run(opts.message, opts.images)
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
        stats: {
          tokensPerSecond: result.tokensPerSecond,
          contextWindow: result.contextWindow,
          isLocal: result.isLocal,
        },
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

  registerInvoke('agent:abort', async (sessionId: string) => {
    const run = activeRuns.get(sessionId)
    if (!run) return { ok: false, error: 'No active run' }
    run.abortController.abort()
    return { ok: true }
  })

  registerInvoke('agent:approvalResponse', async (sessionId: string, callId: string, decision: ApprovalResult) => {
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
        const req = http.get('http://127.0.0.1:11434/api/tags', (res) => resolve(res.statusCode === 200))
        req.on('error', () => resolve(false))
        req.setTimeout(3000, () => { req.destroy(); resolve(false) })
      })
    } catch { return false }
  })
  ipcMain.handle('ollama:listModels', async () => {
    try {
      const http = await import('http')
      return await new Promise<any>((resolve, reject) => {
        const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
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

  // ── Cookbook (local model manager) ──
  const cookbookPulls = new Map<string, ChildProcess>()
  const execText = (cmd: string, args: string[]): Promise<string> =>
    new Promise((resolve) => {
      try {
        execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim()))
      } catch { resolve('') }
    })

  ipcMain.handle('cookbook:profile', async () => {
    const totalRamGb = Math.max(1, Math.round(totalmem() / (1024 ** 3)))
    const isDarwin = process.platform === 'darwin'
    const unifiedMemory = isDarwin && process.arch === 'arm64'
    // Chip name: sysctl gives the marketing name on macOS ("Apple M2 Max");
    // everywhere else (Windows/Linux) fall back to os.cpus() model, which is
    // cross-platform ("Intel(R) Core(TM) i7-9700K", "AMD Ryzen 7 5800X", …).
    const chip = (isDarwin ? await execText('sysctl', ['-n', 'machdep.cpu.brand_string']) : '')
      || cpus()[0]?.model?.trim()
      || undefined
    const profile = makeHardwareProfile({ platform: process.platform, arch: process.arch, totalRamGb, unifiedMemory, chip })
    return { ok: true, profile, recommendations: recommendModels(profile, { limit: 8 }) }
  })

  ipcMain.handle('cookbook:ollama', async () => {
    const http = await import('http')
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const installed = !!(await execText(whichCmd, ['ollama']))
    const running = await new Promise<boolean>((resolve) => {
      const req = http.get('http://127.0.0.1:11434/api/tags', (res) => resolve(res.statusCode === 200))
      req.on('error', () => resolve(false))
      req.setTimeout(2500, () => { req.destroy(); resolve(false) })
    })
    let models: Array<{ name: string; size: number }> = []
    if (running) {
      models = await new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            try { const j = JSON.parse(data); resolve((j.models || []).map((m: any) => ({ name: m.name, size: m.size }))) }
            catch { resolve([]) }
          })
        })
        req.on('error', () => resolve([]))
        req.setTimeout(3000, () => { req.destroy(); resolve([]) })
      })
    }
    return { ok: true, installed, running, models }
  })

  ipcMain.handle('cookbook:pull', async (_e, id: string) => {
    if (!id || !/^[\w.:\-/]+$/.test(id)) return { ok: false, error: 'Invalid model id' }
    if (cookbookPulls.has(id)) return { ok: false, error: 'Already pulling that model' }
    return await new Promise<{ ok: boolean; code?: number; error?: string }>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn('ollama', ['pull', id])
      } catch (err: any) {
        resolve({ ok: false, error: err?.message || 'Could not start ollama — is it installed?' }); return
      }
      cookbookPulls.set(id, child)
      const onChunk = (chunk: Buffer) => {
        const text = chunk.toString()
        const pct = text.match(/(\d{1,3})%/)
        const percent = pct ? Math.min(100, parseInt(pct[1], 10)) : undefined
        const status = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop() || ''
        mainWindow?.webContents.send('cookbook:pullProgress', { id, status, percent })
      }
      child.stdout?.on('data', onChunk)
      child.stderr?.on('data', onChunk)
      child.on('error', (err) => {
        cookbookPulls.delete(id)
        mainWindow?.webContents.send('cookbook:pullProgress', { id, status: err.message, done: true, ok: false })
        resolve({ ok: false, error: err.message })
      })
      child.on('close', (code) => {
        cookbookPulls.delete(id)
        const ok = code === 0
        mainWindow?.webContents.send('cookbook:pullProgress', { id, status: ok ? 'Done' : `Exited with code ${code}`, percent: ok ? 100 : undefined, done: true, ok })
        resolve({ ok, code: code ?? undefined })
      })
    })
  })

  ipcMain.handle('cookbook:cancelPull', async (_e, id: string) => {
    const child = cookbookPulls.get(id)
    if (child) { child.kill(); cookbookPulls.delete(id); return { ok: true } }
    return { ok: false }
  })

  // ── Compare (side-by-side model eval) ──
  ipcMain.handle('compare:run', async (_e, opts: { prompt: string; cwd?: string; entries: Array<{ provider: string; model: string }> }) => {
    const appConfig = loadAppConfig()
    const cwd = opts.cwd || homedir()
    // Chat-mode system prompt: pure conversational answer, read-only tools only,
    // so the comparison reflects the models — not destructive side effects.
    const comparePrompt = 'You are a helpful assistant being compared side-by-side with other models. Answer the user as clearly and helpfully as you can.'
    const runOne = async (entry: { provider: string; model: string }) => {
      const cred = auth.getCredential(entry.provider)
      const route = providerRoute(entry.provider)
      if (route.needsKey && !cred) {
        return { provider: entry.provider, model: entry.model, ok: false, error: `No credentials for ${entry.provider}` }
      }
      const started = Date.now()
      try {
        const agent = new CodingAgent(
          {
            provider: route.providerType,
            model: entry.model,
            baseUrl: cred?.baseUrl || route.baseUrl,
            apiKey: cred?.apiKey || 'not-needed',
            cwd,
            systemPrompt: comparePrompt,
            messages: [],
            mode: 'chat',
            approvalMode: 'full-auto',
            reasoningEffort: appConfig.reasoningEffort ?? 'off',
          },
          {},
        )
        const result = await agent.run(opts.prompt)
        return {
          provider: entry.provider,
          model: entry.model,
          ok: true,
          text: result.text,
          latencyMs: Date.now() - started,
          promptTokens: result.totalPromptTokens,
          completionTokens: result.totalCompletionTokens,
        }
      } catch (err: any) {
        return { provider: entry.provider, model: entry.model, ok: false, error: auth.scrubSecrets(err?.message ?? String(err)), latencyMs: Date.now() - started }
      }
    }
    const results = await Promise.all((opts.entries || []).map(runOne))
    return { ok: true, results }
  })

  // ── Deep Research (plan → web search → read → synthesize) ──
  ipcMain.handle('research:run', async (_e, opts: { sessionId?: string; provider?: string; model?: string; cwd?: string; query: string }) => {
    let provider = opts.provider
    let model = opts.model
    let cwd = opts.cwd
    if ((!provider || !model) && opts.sessionId) {
      const sess = sessions.getSession(opts.sessionId)
      if (sess) { provider = provider || sess.provider; model = model || sess.model; cwd = cwd || sess.cwd }
    }
    if (!provider || !model) return { ok: false, error: 'No model selected — open a session first.' }
    const cred = auth.getCredential(provider)
    const route = providerRoute(provider)
    if (route.needsKey && !cred) return { ok: false, error: `No credentials for ${provider}` }
    const appConfig = loadAppConfig()
    const researchPrompt = [
      "You are a deep research agent. Investigate the user's question thoroughly and produce a cited report.",
      'Process:',
      '1. Break the question into 3-6 focused sub-questions.',
      '2. Use web_search to find sources, then web_fetch to read the most relevant pages. Search and read MULTIPLE sources — do not answer from memory alone.',
      '3. Cross-check key claims across sources; note any disagreements.',
      '4. Synthesize a clear, well-structured Markdown report.',
      'Format: a short summary up front, then sections with headers. Cite sources inline as [1], [2], … and end with a "## Sources" list mapping each number to its URL.',
      'Be thorough but skip filler. Prefer primary or authoritative sources.',
    ].join('\n')
    try {
      const agent = new CodingAgent(
        {
          provider: route.providerType,
          model,
          baseUrl: cred?.baseUrl || route.baseUrl,
          apiKey: cred?.apiKey || 'not-needed',
          cwd: cwd || homedir(),
          systemPrompt: researchPrompt,
          messages: [],
          mode: 'chat',
          approvalMode: 'full-auto',
          reasoningEffort: appConfig.reasoningEffort ?? 'medium',
        },
        {
          onText: (delta) => emit('research:progress', { kind: 'text', delta }),
          onToolCall: (call) => emit('research:progress', { kind: 'tool', call }),
        },
      )
      const result = await agent.run(opts.query)
      return { ok: true, report: result.text, promptTokens: result.totalPromptTokens, completionTokens: result.totalCompletionTokens }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Documents (JSON-backed, AI-assisted editor) ──
  const DOCS_PATH = join(CONFIG_DIR, 'documents.json')
  type DocItem = { id: string; title: string; content: string; updatedAt: number }
  const readDocs = (): DocItem[] => {
    try {
      if (existsSync(DOCS_PATH)) {
        const d = JSON.parse(readFileSync(DOCS_PATH, 'utf-8'))
        return Array.isArray(d.documents) ? d.documents : []
      }
    } catch { /* corrupt → fresh */ }
    return []
  }
  const writeDocs = (documents: DocItem[]) => {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(DOCS_PATH, JSON.stringify({ documents }, null, 2))
  }
  ipcMain.handle('documents:list', async () => ({ ok: true, documents: readDocs() }))
  ipcMain.handle('documents:save', async (_e, doc: { id?: string; title: string; content: string }) => {
    const docs = readDocs()
    if (doc.id) {
      const existing = docs.find((d) => d.id === doc.id)
      if (existing) {
        existing.title = doc.title; existing.content = doc.content; existing.updatedAt = Date.now()
        writeDocs(docs); return { ok: true, doc: existing }
      }
    }
    const created = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: doc.title || 'Untitled', content: doc.content || '', updatedAt: Date.now() }
    docs.unshift(created); writeDocs(docs); return { ok: true, doc: created }
  })
  ipcMain.handle('documents:delete', async (_e, id: string) => {
    writeDocs(readDocs().filter((d) => d.id !== id)); return { ok: true }
  })
  ipcMain.handle('documents:assist', async (_e, opts: { sessionId?: string; content: string; instruction: string }) => {
    let provider: string | undefined, model: string | undefined, cwd: string | undefined
    if (opts.sessionId) { const s = sessions.getSession(opts.sessionId); if (s) { provider = s.provider; model = s.model; cwd = s.cwd } }
    if (!provider || !model) return { ok: false, error: 'No model — open a session first.' }
    const cred = auth.getCredential(provider)
    const route = providerRoute(provider)
    if (route.needsKey && !cred) return { ok: false, error: `No credentials for ${provider}` }
    const sys = 'You are a precise document editor. Apply the user instruction to the document and return ONLY the full revised document in Markdown — no preamble, no explanation, and do not wrap the whole thing in a code fence.'
    const task = `Instruction: ${opts.instruction}\n\n--- Document ---\n${opts.content}`
    try {
      const agent = new CodingAgent(
        { provider: route.providerType, model, baseUrl: cred?.baseUrl || route.baseUrl, apiKey: cred?.apiKey || 'not-needed', cwd: cwd || homedir(), systemPrompt: sys, messages: [], mode: 'chat', approvalMode: 'full-auto', reasoningEffort: loadAppConfig().reasoningEffort ?? 'off' },
        {},
      )
      const result = await agent.run(task)
      return { ok: true, content: result.text }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── Notes & Tasks (JSON-backed quick capture) ──
  const NOTES_PATH = join(CONFIG_DIR, 'notes.json')
  type NoteItem = { id: string; text: string; createdAt: number }
  type TaskItem = { id: string; text: string; done: boolean; createdAt: number }
  const readNotesStore = (): { notes: NoteItem[]; tasks: TaskItem[] } => {
    try {
      if (existsSync(NOTES_PATH)) {
        const d = JSON.parse(readFileSync(NOTES_PATH, 'utf-8'))
        return { notes: Array.isArray(d.notes) ? d.notes : [], tasks: Array.isArray(d.tasks) ? d.tasks : [] }
      }
    } catch { /* corrupt file → start fresh */ }
    return { notes: [], tasks: [] }
  }
  const writeNotesStore = (store: { notes: NoteItem[]; tasks: TaskItem[] }) => {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(NOTES_PATH, JSON.stringify(store, null, 2))
  }
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

  ipcMain.handle('notes:get', async () => ({ ok: true, ...readNotesStore() }))
  ipcMain.handle('notes:addNote', async (_e, text: string) => {
    const t = String(text || '').trim()
    if (!t) return { ok: false, error: 'Empty note' }
    const store = readNotesStore()
    const note = { id: genId(), text: t, createdAt: Date.now() }
    store.notes.unshift(note); writeNotesStore(store); return { ok: true, note }
  })
  ipcMain.handle('notes:deleteNote', async (_e, id: string) => {
    const store = readNotesStore(); store.notes = store.notes.filter((n) => n.id !== id); writeNotesStore(store); return { ok: true }
  })
  ipcMain.handle('notes:addTask', async (_e, text: string) => {
    const t = String(text || '').trim()
    if (!t) return { ok: false, error: 'Empty task' }
    const store = readNotesStore()
    const task = { id: genId(), text: t, done: false, createdAt: Date.now() }
    store.tasks.unshift(task); writeNotesStore(store); return { ok: true, task }
  })
  ipcMain.handle('notes:toggleTask', async (_e, id: string) => {
    const store = readNotesStore(); const t = store.tasks.find((x) => x.id === id); if (t) t.done = !t.done; writeNotesStore(store); return { ok: true }
  })
  ipcMain.handle('notes:deleteTask', async (_e, id: string) => {
    const store = readNotesStore(); store.tasks = store.tasks.filter((t) => t.id !== id); writeNotesStore(store); return { ok: true }
  })

  // Reject a hung network promise so the UI surfaces an error instead of
  // spinning forever on an unreachable or misconfigured server.
  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s — check the host and credentials.`)), ms))])

  // ── Email (IMAP fetch + SMTP send) ──
  const EMAIL_PATH = join(CONFIG_DIR, 'email.json')
  type EmailAccount = { email: string; password: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }
  const readEmailAccount = (): EmailAccount | null => {
    try {
      if (existsSync(EMAIL_PATH)) {
        const a = JSON.parse(readFileSync(EMAIL_PATH, 'utf-8'))
        return { ...a, password: auth.decryptSecret(a.password || '') }
      }
    } catch { /* corrupt → none */ }
    return null
  }
  const writeEmailAccount = (a: EmailAccount) => {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(EMAIL_PATH, JSON.stringify({ ...a, password: auth.encryptSecret(a.password || '') }, null, 2), { mode: 0o600 })
  }
  const makeImap = async (a: EmailAccount): Promise<any> => {
    const mod: any = await import('imapflow')
    const ImapFlow = mod.ImapFlow || mod.default?.ImapFlow
    return new ImapFlow({ host: a.imapHost, port: a.imapPort, secure: a.imapPort === 993, auth: { user: a.email, pass: a.password }, logger: false, socketTimeout: 30000 })
  }

  ipcMain.handle('email:getAccount', async () => {
    const a = readEmailAccount()
    if (!a) return { ok: true, account: null }
    return { ok: true, account: { email: a.email, imapHost: a.imapHost, imapPort: a.imapPort, smtpHost: a.smtpHost, smtpPort: a.smtpPort, passwordSet: !!a.password } }
  })
  ipcMain.handle('email:saveAccount', async (_e, input: { email: string; password?: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }) => {
    const prev = readEmailAccount()
    const account: EmailAccount = {
      email: input.email,
      password: input.password ? input.password : (prev?.password || ''),
      imapHost: input.imapHost, imapPort: Number(input.imapPort) || 993,
      smtpHost: input.smtpHost, smtpPort: Number(input.smtpPort) || 465,
    }
    writeEmailAccount(account)
    return { ok: true }
  })
  ipcMain.handle('email:list', async (_e, opts?: { limit?: number }) => {
    const a = readEmailAccount(); if (!a) return { ok: false, error: 'No email account configured' }
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 25))
    try {
      const client = await makeImap(a)
      await withTimeout(client.connect(), 15000, 'Mail server')
      const messages: any[] = []
      const lock = await client.getMailboxLock('INBOX')
      try {
        const total = client.mailbox && typeof client.mailbox !== 'boolean' ? client.mailbox.exists : 0
        if (total > 0) {
          const start = Math.max(1, total - limit + 1)
          for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
            const from = msg.envelope?.from?.[0]
            messages.push({
              uid: msg.uid,
              from: from?.address || '',
              fromName: from?.name || from?.address || '',
              subject: msg.envelope?.subject || '(no subject)',
              date: msg.envelope?.date ? new Date(msg.envelope.date).getTime() : 0,
              seen: msg.flags ? msg.flags.has('\\Seen') : false,
            })
          }
        }
      } finally { lock.release() }
      await client.logout()
      messages.reverse()
      return { ok: true, messages }
    } catch (err: any) { return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) } }
  })
  ipcMain.handle('email:get', async (_e, uid: number) => {
    const a = readEmailAccount(); if (!a) return { ok: false, error: 'No email account configured' }
    try {
      const client = await makeImap(a)
      await withTimeout(client.connect(), 15000, 'Mail server')
      let result: any = null
      const lock = await client.getMailboxLock('INBOX')
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (msg && msg.source) {
          const mp: any = await import('mailparser')
          const parsed = await mp.simpleParser(msg.source)
          result = {
            uid,
            from: parsed.from?.text || '',
            to: (parsed.to as any)?.text || '',
            subject: parsed.subject || '(no subject)',
            date: parsed.date ? parsed.date.getTime() : 0,
            text: parsed.text || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
          }
          try { await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }) } catch { /* best-effort read receipt */ }
        }
      } finally { lock.release() }
      await client.logout()
      if (!result) return { ok: false, error: 'Message not found' }
      return { ok: true, message: result }
    } catch (err: any) { return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) } }
  })
  ipcMain.handle('email:send', async (_e, opts: { to: string; subject: string; text: string }) => {
    const a = readEmailAccount(); if (!a) return { ok: false, error: 'No email account configured' }
    try {
      const nm: any = await import('nodemailer')
      const createTransport = nm.createTransport || nm.default?.createTransport
      const transport = createTransport({ host: a.smtpHost, port: a.smtpPort, secure: a.smtpPort === 465, auth: { user: a.email, pass: a.password }, connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000 })
      await withTimeout(transport.sendMail({ from: a.email, to: opts.to, subject: opts.subject, text: opts.text }), 30000, 'Mail send')
      return { ok: true }
    } catch (err: any) { return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) } }
  })

  // ── Calendar (CalDAV via tsdav) ──
  const CAL_PATH = join(CONFIG_DIR, 'calendar.json')
  type CalAccount = { url: string; username: string; password: string }
  const readCalAccount = (): CalAccount | null => {
    try {
      if (existsSync(CAL_PATH)) {
        const a = JSON.parse(readFileSync(CAL_PATH, 'utf-8'))
        return { ...a, password: auth.decryptSecret(a.password || '') }
      }
    } catch { /* corrupt → none */ }
    return null
  }
  const writeCalAccount = (a: CalAccount) => {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(CAL_PATH, JSON.stringify({ ...a, password: auth.encryptSecret(a.password || '') }, null, 2), { mode: 0o600 })
  }
  const parseIcsDate = (s: string): number => {
    if (!s) return 0
    const m = s.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/)
    if (!m) return Date.parse(s) || 0
    const [, y, mo, d, h = '00', mi = '00', se = '00', z] = m
    return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}${z ? 'Z' : ''}`) || 0
  }
  const parseIcsEvent = (ics: string) => {
    const block = ics.slice(ics.indexOf('BEGIN:VEVENT'))
    const get = (re: RegExp) => { const m = block.match(re); return m ? m[1].trim() : '' }
    return {
      summary: get(/SUMMARY:(.*)/) || '(untitled)',
      start: parseIcsDate(get(/DTSTART[^:\n]*:([^\n]*)/)),
      end: parseIcsDate(get(/DTEND[^:\n]*:([^\n]*)/)),
      location: get(/LOCATION:(.*)/),
    }
  }
  ipcMain.handle('calendar:getAccount', async () => {
    const a = readCalAccount()
    if (!a) return { ok: true, account: null }
    return { ok: true, account: { url: a.url, username: a.username, passwordSet: !!a.password } }
  })
  ipcMain.handle('calendar:saveAccount', async (_e, input: { url: string; username: string; password?: string }) => {
    const prev = readCalAccount()
    writeCalAccount({ url: input.url, username: input.username, password: input.password ? input.password : (prev?.password || '') })
    return { ok: true }
  })
  ipcMain.handle('calendar:events', async (_e, opts?: { start?: number; end?: number }) => {
    const a = readCalAccount(); if (!a) return { ok: false, error: 'No calendar account configured' }
    const start = opts?.start ?? Date.now()
    const end = opts?.end ?? (Date.now() + 30 * 24 * 60 * 60 * 1000)
    try {
      const dav: any = await import('tsdav')
      const createDAVClient = dav.createDAVClient || dav.default?.createDAVClient
      const client: any = await withTimeout(createDAVClient({ serverUrl: a.url, credentials: { username: a.username, password: a.password }, authMethod: 'Basic', defaultAccountType: 'caldav' }), 15000, 'CalDAV server')
      const calendars: any = await withTimeout(client.fetchCalendars(), 15000, 'CalDAV')
      const events: any[] = []
      for (const cal of calendars) {
        let objs: any[] = []
        try {
          objs = await client.fetchCalendarObjects({ calendar: cal, timeRange: { start: new Date(start).toISOString(), end: new Date(end).toISOString() } })
        } catch { objs = [] }
        for (const o of objs) {
          if (!o?.data || !String(o.data).includes('BEGIN:VEVENT')) continue
          events.push({ ...parseIcsEvent(String(o.data)), calendar: cal.displayName || '' })
        }
      }
      events.sort((x, y) => x.start - y.start)
      return { ok: true, events }
    } catch (err: any) { return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) } }
  })

  // ── Auth / credentials ──
  ipcMain.handle('auth:list', async () => ({ ok: true, credentials: auth.getCredentials().map(c => ({ ...c, apiKey: c.apiKey ? `${c.apiKey.slice(0, 4)}…${c.apiKey.slice(-4)}` : '' })) }))
  ipcMain.handle('auth:save', async (_e, cred: auth.AuthCredential) => {
    auth.saveCredential({ ...cred, createdAt: cred.createdAt || new Date().toISOString() })
    return { ok: true }
  })
  ipcMain.handle('auth:delete', async (_e, providerId: string) => ({ ok: auth.deleteCredential(providerId) }))

  // ── Provider definitions (id, methods, baseUrl, consoleUrl, description) ──
  registerInvoke('auth:providers', async () => ({ ok: true, providers: auth.PROVIDERS }))

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

  // ── Anthropic OAuth PKCE (Claude Pro/Max subscription) ──
  ipcMain.handle('auth:anthropicOAuth', async () => {
    try {
      const cred = await loginAnthropicOAuth((msg) => emitAuthStatus('anthropic', 'oauth', msg))
      return { ok: true, credential: cred }
    } catch (err: any) {
      return { ok: false, error: auth.scrubSecrets(err?.message ?? String(err)) }
    }
  })

  // ── OpenAI Codex OAuth PKCE (ChatGPT Plus/Pro subscription) ──
  ipcMain.handle('auth:openaiOAuth', async () => {
    try {
      const cred = await loginOpenAICodexOAuth((msg) => emitAuthStatus('openai', 'oauth', msg))
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
  ipcMain.handle('config:save', async (_e, config: AppConfig) => {
    saveAppConfig(config)
    // Side-effects of changed flags. Cheap to re-apply on every save —
    // they're idempotent — and avoids requiring the renderer to know which
    // keys are "live" vs "persisted-only".
    applyKeepAlivePreference()
    applyAutoLaunchPreference()
    refreshTrayMenu()
    return { ok: true }
  })

  // ── Remote access ──
  // The renderer drives all remote-access state through these handlers so
  // the Settings panel doesn't have to know anything about the HTTP server's
  // internals (port binding, device-token storage, etc.).
  ipcMain.handle('remote:status', async () => {
    const cfg = loadAppConfig()
    const port = cfg.remote?.port ?? 7843
    return {
      ok: true,
      enabled: !!cfg.remote?.enabled,
      running: !!remoteServer,
      port,
      // Devices are returned WITHOUT their tokens — there's no need to show
      // the secret in the device list, and not exposing it via IPC is one
      // less surface for renderer-side leaks.
      devices: (cfg.remote?.devices ?? []).map((d) => ({
        id: d.id,
        label: d.label,
        platform: d.platform,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
      })),
      addresses: remoteServer ? remoteServer.addresses() : localAddresses(port),
    }
  })
  ipcMain.handle('remote:setEnabled', async (_e, enabled: boolean) => {
    const cfg = loadAppConfig()
    const next: AppConfig = {
      ...cfg,
      remote: {
        enabled,
        port: cfg.remote?.port ?? 7843,
        devices: cfg.remote?.devices ?? [],
      },
    }
    saveAppConfig(next)
    if (enabled) {
      const result = await startRemoteServerNow()
      refreshTrayMenu()
      return result
    } else {
      await stopRemoteServerNow()
      return { ok: true }
    }
  })
  ipcMain.handle('remote:setPort', async (_e, port: number) => {
    if (typeof port !== 'number' || port < 1024 || port > 65535) {
      return { ok: false, error: 'Port must be between 1024 and 65535' }
    }
    const cfg = loadAppConfig()
    const next: AppConfig = {
      ...cfg,
      remote: {
        enabled: cfg.remote?.enabled ?? false,
        port,
        devices: cfg.remote?.devices ?? [],
      },
    }
    saveAppConfig(next)
    if (remoteServer) {
      await stopRemoteServerNow()
      return await startRemoteServerNow()
    }
    return { ok: true }
  })

  /** Generate a fresh pairing code. The code expires in 5 minutes;
   *  generating a new one invalidates any prior un-redeemed code. The
   *  renderer turns the returned URI into a QR for the phone to scan. */
  ipcMain.handle('remote:beginPairing', async () => {
    const cfg = loadAppConfig()
    if (!cfg.remote?.enabled) return { ok: false, error: 'Enable remote access first' }
    if (!remoteServer) return { ok: false, error: 'Remote server not running' }
    const { code, expiresAt } = issuePairingCode()
    const port = cfg.remote.port
    // Pairing URI: stable across platforms, deep-linkable from a future
    // native phone app. The host portion is the most-likely-routable LAN IP.
    const lanUrls = remoteServer.addresses().filter((u) => !u.includes('127.0.0.1'))
    const primaryHost = lanUrls[0] ?? `http://127.0.0.1:${port}`
    const pairingUri = `codemaxxing://pair?host=${encodeURIComponent(primaryHost)}&code=${code}`
    return {
      ok: true,
      code,
      expiresAt,
      // Plain HTTP URL the redeeming client should POST to. Phone apps that
      // can't deep-link `codemaxxing://` (e.g. browsers) use this directly.
      pairUrl: `${primaryHost}/api/pair`,
      pairingUri,
      ttlSeconds: Math.floor((expiresAt - Date.now()) / 1000),
    }
  })

  /** Cancel an outstanding pairing code. Used when the user closes the
   *  pairing modal — we don't want stale codes lingering until expiry. */
  ipcMain.handle('remote:cancelPairing', async () => {
    pendingPairings.clear()
    return { ok: true }
  })

  /** Revoke a previously paired device. Removes it from the device list
   *  AND restarts the server so any in-flight requests using that device's
   *  token are immediately rejected. (Without the restart, an existing SSE
   *  connection would happily keep streaming for hours.) */
  ipcMain.handle('remote:revokeDevice', async (_e, deviceId: string) => {
    const cfg = loadAppConfig()
    const before = cfg.remote?.devices ?? []
    const after = before.filter((d) => d.id !== deviceId)
    if (before.length === after.length) return { ok: false, error: 'Device not found' }
    saveAppConfig({ ...cfg, remote: { enabled: cfg.remote?.enabled ?? false, port: cfg.remote?.port ?? 7843, devices: after } })
    if (remoteServer) {
      await stopRemoteServerNow()
      await startRemoteServerNow()
    }
    refreshTrayMenu()
    mainWindow?.webContents.send('remote:devicesChanged')
    return { ok: true }
  })

  // ── Themes ──
  ipcMain.handle('themes:list', async () => ({
    ok: true,
    // Themes: light variants first (named so users searching for "light"
    // find them immediately), then the original Codemaxxing default and
    // the dark family. Every theme is a contiguous palette tested for
    // text-on-bg readability — `muted` and `toolResult` colors had been
    // tuned to where they were nearly invisible on certain dark themes
    // (tokyo-night, hacker, blood-moon, synthwave); those are bumped here
    // to at least ~3.5:1 contrast against bg without losing the vibe.
    themes: [
      // ── LIGHT THEMES ─────────────────────────────────────────────────
      { key: 'light', name: 'Light', description: 'Clean white background — the new default for daytime work', isLight: true, colors: { primary: '#2563EB', secondary: '#7C3AED', muted: '#52525B', text: '#18181B', userInput: '#18181B', response: '#18181B', tool: '#2563EB', toolResult: '#52525B', error: '#DC2626', success: '#16A34A', warning: '#D97706', border: '#D4D4D8', suggestion: '#7C3AED', bg: '#FFFFFF', bgSubtle: '#F4F4F5' } },
      { key: 'github-light', name: 'GitHub Light', description: 'Familiar GitHub palette — clean & professional', isLight: true, colors: { primary: '#0969DA', secondary: '#8250DF', muted: '#656D76', text: '#1F2328', userInput: '#1F2328', response: '#1F2328', tool: '#0969DA', toolResult: '#656D76', error: '#CF222E', success: '#1A7F37', warning: '#9A6700', border: '#D1D9E0', suggestion: '#8250DF', bg: '#FFFFFF', bgSubtle: '#F6F8FA' } },
      { key: 'solarized-light', name: 'Solarized Light', description: 'Classic warm cream — gentle on the eyes for long sessions', isLight: true, colors: { primary: '#268BD2', secondary: '#6C71C4', muted: '#657B83', text: '#073642', userInput: '#073642', response: '#073642', tool: '#268BD2', toolResult: '#657B83', error: '#DC322F', success: '#859900', warning: '#B58900', border: '#93A1A1', suggestion: '#6C71C4', bg: '#FDF6E3', bgSubtle: '#EEE8D5' } },
      { key: 'paper', name: 'Paper', description: 'Warm cream notebook — like writing on real paper', isLight: true, colors: { primary: '#8B6332', secondary: '#6E5B4F', muted: '#6B6B5E', text: '#2C2A26', userInput: '#2C2A26', response: '#2C2A26', tool: '#5A6E8F', toolResult: '#6B6B5E', error: '#A4424C', success: '#5C7A3E', warning: '#B5882B', border: '#D9D2C5', suggestion: '#8B6332', bg: '#FAF7F2', bgSubtle: '#F0EBE0' } },
      { key: 'high-contrast-light', name: 'High Contrast Light', description: 'Maximum legibility — accessibility-first', isLight: true, colors: { primary: '#0033CC', secondary: '#6B0099', muted: '#3F3F3F', text: '#000000', userInput: '#000000', response: '#000000', tool: '#0033CC', toolResult: '#3F3F3F', error: '#B00020', success: '#006600', warning: '#8C5400', border: '#9CA3AF', suggestion: '#6B0099', bg: '#FFFFFF', bgSubtle: '#F2F2F2' } },

      // ── DARK THEMES ──────────────────────────────────────────────────
      { key: 'codemaxxing', name: 'Codemaxxing', description: 'Default dark — calm, balanced, easy on the eyes', colors: { primary: '#7AA2F7', secondary: '#BB9AF7', muted: '#9AA5CE', text: '#C0CAF5', userInput: '#9ECE6A', response: '#C0CAF5', tool: '#7DCFFF', toolResult: '#9AA5CE', error: '#F7768E', success: '#9ECE6A', warning: '#E0AF68', border: '#565F89', suggestion: '#BB9AF7', bg: '#0a0a0f', bgSubtle: '#0d0d14' } },
      { key: 'ember', name: 'Ember', description: 'Warm coral on deep slate — cozy and focused', colors: { primary: '#E8826B', secondary: '#E6B07A', muted: '#8A93A6', text: '#E4E2DD', userInput: '#7FB5B5', response: '#E4E2DD', tool: '#7FB5B5', toolResult: '#9AA0AE', error: '#E5677A', success: '#8FB573', warning: '#E6B07A', border: '#2A303D', suggestion: '#E8826B', bg: '#171B26', bgSubtle: '#12161F' } },
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

  // ── File search (for @-mentions and command palette) ──
  // Simple ranked search. Walks cwd BFS, skipping common heavy dirs, and ranks
  // by basename match quality. Returns relative paths. Capped to keep snappy.
  const FILE_EXCLUDES = new Set([
    'node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', '.next', '.turbo',
    '.cache', '.vite', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.DS_Store',
  ])
  const MAX_FILE_SCAN = 5000 // upper bound on entries walked per query
  const SEARCH_TIMEOUT_MS = 400

  function scoreFilePath(rel: string, q: string): number {
    if (!q) return 1 // no query — everything ranks equal; sort by path length
    const base = basename(rel).toLowerCase()
    const full = rel.toLowerCase()
    const needle = q.toLowerCase()
    if (base === needle) return 1000
    if (base.startsWith(needle)) return 800 - base.length
    if (base.includes(needle)) return 600 - base.length
    if (full.includes(needle)) return 400 - full.length
    // Fuzzy: all chars of q appear in order in base
    let i = 0
    for (const ch of base) { if (ch === needle[i]) i++; if (i === needle.length) break }
    if (i === needle.length) return 200 - base.length
    i = 0
    for (const ch of full) { if (ch === needle[i]) i++; if (i === needle.length) break }
    if (i === needle.length) return 100 - full.length
    return -1
  }

  // List entries in one directory (non-recursive). Used by the Files panel
  // tree view — children are fetched lazily on expand. Directories sort first,
  // then files; both alphabetically.
  ipcMain.handle('files:tree', async (_e, opts: { path: string }) => {
    try {
      const { path } = opts
      if (!path || !existsSync(path)) return { ok: false, error: 'invalid path', entries: [] }
      const st = statSync(path)
      if (!st.isDirectory()) return { ok: false, error: 'not a directory', entries: [] }
      let names: string[]
      try { names = readdirSync(path) } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err), entries: [] }
      }
      const entries = [] as Array<{ name: string; path: string; dir: boolean; size: number; hidden: boolean }>
      for (const name of names) {
        if (FILE_EXCLUDES.has(name)) continue
        const full = join(path, name)
        try {
          const s = statSync(full)
          entries.push({
            name,
            path: full,
            dir: s.isDirectory(),
            size: s.isFile() ? s.size : 0,
            hidden: name.startsWith('.'),
          })
        } catch { /* skip unreadable */ }
      }
      entries.sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1
        if (a.hidden !== b.hidden) return a.hidden ? 1 : -1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
      return { ok: true, entries }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err), entries: [] }
    }
  })

  // Read a single file for in-app viewing. Caps size and refuses to touch
  // obvious binaries so the renderer doesn't choke.
  const MAX_READ_BYTES = 1024 * 1024 // 1 MB
  const BINARY_EXTS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'heic',
    'mp4', 'mov', 'webm', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac',
    'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
    'pdf', 'psd', 'sketch', 'fig',
    'exe', 'dll', 'so', 'dylib', 'class', 'jar', 'wasm',
    'ttf', 'otf', 'woff', 'woff2',
    'node', 'DS_Store',
  ])
  ipcMain.handle('files:read', async (_e, opts: { path: string; maxBytes?: number }) => {
    try {
      const { path } = opts
      const cap = Math.min(opts.maxBytes ?? MAX_READ_BYTES, MAX_READ_BYTES)
      if (!path || !existsSync(path)) return { ok: false, error: 'File not found' }
      const st = statSync(path)
      if (!st.isFile()) return { ok: false, error: 'Not a regular file' }
      const ext = extname(path).replace(/^\./, '').toLowerCase()
      if (BINARY_EXTS.has(ext)) {
        return { ok: true, binary: true, size: st.size, ext, truncated: false, content: '' }
      }
      const truncated = st.size > cap
      const mtime = st.mtimeMs
      const buf = readFileSync(path)
      const slice = truncated ? buf.subarray(0, cap) : buf
      // Heuristic: if the first 4KB contains a null byte, treat as binary
      const scan = slice.subarray(0, Math.min(4096, slice.length))
      for (let i = 0; i < scan.length; i++) {
        if (scan[i] === 0) return { ok: true, binary: true, size: st.size, ext, truncated, mtime, content: '' }
      }
      return { ok: true, binary: false, size: st.size, ext, truncated, mtime, content: slice.toString('utf8') }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  // Write a single file back to disk. Refuses to leave the session cwd,
  // refuses binary extensions, and supports optimistic-concurrency via
  // `expectedMtime`. If the file's mtime has drifted, the handler returns a
  // { conflict: true, currentMtime, currentContent } packet so the renderer
  // can show a "keep mine / reload / show diff" banner instead of silently
  // clobbering agent-authored writes.
  ipcMain.handle('files:write', async (_e, opts: {
    path: string
    cwd: string
    content: string
    expectedMtime?: number
    force?: boolean
  }) => {
    try {
      const { path, cwd, content, expectedMtime, force } = opts
      if (!path || !cwd) return { ok: false, error: 'missing path/cwd' }
      if (!existsSync(cwd)) return { ok: false, error: 'cwd does not exist' }
      const rel = relative(cwd, path)
      if (!rel || rel.startsWith('..') || rel.includes('/..')) {
        return { ok: false, error: 'path is outside the session working directory' }
      }
      const ext = extname(path).replace(/^\./, '').toLowerCase()
      if (BINARY_EXTS.has(ext)) {
        return { ok: false, error: 'binary files cannot be edited here' }
      }
      if (content.length > MAX_READ_BYTES) {
        return { ok: false, error: `file exceeds ${MAX_READ_BYTES / 1024 / 1024} MB cap` }
      }
      if (existsSync(path)) {
        const st = statSync(path)
        if (!st.isFile()) return { ok: false, error: 'not a regular file' }
        if (!force && typeof expectedMtime === 'number') {
          // Allow ~2ms jitter — some filesystems don't store sub-ms precision.
          if (Math.abs(st.mtimeMs - expectedMtime) > 2) {
            let currentContent = ''
            let binary = false
            const cap = MAX_READ_BYTES
            const truncated = st.size > cap
            const buf = readFileSync(path)
            const slice = truncated ? buf.subarray(0, cap) : buf
            const scan = slice.subarray(0, Math.min(4096, slice.length))
            for (let i = 0; i < scan.length; i++) {
              if (scan[i] === 0) { binary = true; break }
            }
            if (!binary) currentContent = slice.toString('utf8')
            return {
              ok: false,
              conflict: true,
              currentMtime: st.mtimeMs,
              currentContent,
              truncated,
            }
          }
        }
      }
      writeFileSync(path, content, 'utf8')
      const st2 = statSync(path)
      return { ok: true, mtime: st2.mtimeMs, size: st2.size }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('files:search', async (_e, opts: { cwd: string; query: string; limit?: number }) => {
    try {
      const { cwd, query } = opts
      const limit = Math.max(1, Math.min(opts.limit ?? 30, 200))
      if (!cwd || !existsSync(cwd)) return { ok: false, error: 'invalid cwd', files: [] }
      const q = (query ?? '').trim()
      const start = Date.now()
      const queue: string[] = [cwd]
      const results: Array<{ path: string; score: number; dir: boolean }> = []
      let scanned = 0
      while (queue.length > 0 && scanned < MAX_FILE_SCAN) {
        if (Date.now() - start > SEARCH_TIMEOUT_MS) break
        const dir = queue.shift()!
        let entries: string[]
        try { entries = readdirSync(dir) } catch { continue }
        for (const name of entries) {
          if (name.startsWith('.') && name !== '.env' && name !== '.gitignore') continue
          if (FILE_EXCLUDES.has(name)) continue
          scanned++
          const full = join(dir, name)
          let st
          try { st = statSync(full) } catch { continue }
          const rel = relative(cwd, full)
          if (st.isDirectory()) {
            queue.push(full)
            // Allow dirs to match too, lower priority
            const score = scoreFilePath(rel, q)
            if (score > 0 || !q) results.push({ path: rel, score: score - 50, dir: true })
          } else if (st.isFile()) {
            const score = scoreFilePath(rel, q)
            if (score > 0 || !q) results.push({ path: rel, score, dir: false })
          }
          if (scanned >= MAX_FILE_SCAN) break
        }
      }
      // Sort: higher score first, then shorter path, files before dirs at same score
      results.sort((a, b) => (b.score - a.score) || (a.dir === b.dir ? a.path.length - b.path.length : a.dir ? 1 : -1))
      const files = results.slice(0, limit).map(r => ({
        path: r.path,
        name: basename(r.path),
        dir: r.dir,
        ext: r.dir ? '' : extname(r.path).replace(/^\./, ''),
      }))
      return { ok: true, files, truncated: scanned >= MAX_FILE_SCAN }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err), files: [] }
    }
  })

  // ── Preview: run commands in session cwd, stream stdout/stderr ──
  // (activeChildren is hoisted to module scope for shutdown cleanup.)
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
