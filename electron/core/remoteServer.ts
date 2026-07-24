/**
 * Remote API server — exposes the agent over HTTP + Server-Sent Events so any
 * client (future native phone app, future Windows-built desktop, external
 * tooling, even curl) can drive the same agent the desktop UI does.
 *
 * Design pillars (kept consistent with what a future Claude-Code-style
 * remote experience needs):
 *
 *   1. **Per-device tokens.** Each paired device has its own bearer token,
 *      its own label/platform, its own audit trail. We never share a single
 *      bearer across devices — that would mean "regenerate token = kick
 *      everybody out", which is the opposite of what users expect from
 *      multi-device pairing.
 *
 *   2. **Two-step pairing.** The desktop generates a short, human-readable
 *      pairing code (6 chars, ~30 bits — enough to defeat online guessing
 *      given the 5-minute TTL). The client redeems it via POST /api/pair
 *      to receive a long-lived per-device token. The pairing code is the
 *      ONLY thing exchanged via QR / out-of-band; tokens never appear on
 *      screen during normal use after first pair.
 *
 *   3. **Provenance.** Every authenticated request tags itself with the
 *      device id. Downstream code (approval prompts, audit log) sees
 *      "this turn was driven by Marcos's iPhone" rather than an opaque
 *      Bearer header. Tracked via AsyncLocalStorage so the tag survives
 *      across the agent's many async hops without anyone having to thread
 *      it through every function signature.
 *
 *   4. **Cross-platform out of the box.** No node-gyp, no native compiles,
 *      nothing platform-specific in this file. The Electron desktop runs on
 *      macOS today; the same code path will run on Windows/Linux when those
 *      builds ship.
 *
 *   5. **mDNS/Bonjour service advertising** (optional). Phone apps on the
 *      same LAN can discover desktops without the user ever typing a URL.
 *      This is what makes "open the app, see your Mac, tap to connect" feel
 *      native rather than clunky. Failure to advertise is non-fatal — the
 *      server still works; users just have to enter the URL by hand.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { EventEmitter } from 'events'
import { networkInterfaces } from 'os'
import { randomBytes } from 'crypto'

/** Public shape of a paired device, mirrored from main.ts. We re-declare
 *  rather than import to keep this module a clean stand-alone — eventually
 *  it'll move to its own package as the foundation for the future phone
 *  client's API contract. */
export interface PairedDevice {
  id: string
  label: string
  platform: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'browser' | 'cli' | 'unknown'
  token: string
  createdAt: number
  lastSeenAt: number | null
}

/** Per-request provenance. Every authenticated handler can read this via
 *  `requestContext.getStore()` — and the agent's emit() helper attaches it
 *  to outgoing approval / askUser events so the desktop UI shows the right
 *  "from: <device>" badge. */
export interface RequestSource {
  kind: 'local' | 'remote'
  deviceId?: string
  deviceLabel?: string
  devicePlatform?: PairedDevice['platform']
}
export const requestContext = new AsyncLocalStorage<RequestSource>()

/** Read the active request's source from anywhere in the codebase. Returns
 *  `local` outside an active HTTP request — i.e. when the desktop UI itself
 *  is the caller. This is exactly the right default. */
export function currentRequestSource(): RequestSource {
  return requestContext.getStore() ?? { kind: 'local' }
}

export interface RemoteServerHandlers {
  listSessions: () => Promise<unknown>
  getSession: (id: string) => Promise<unknown>
  createSession: (opts: { cwd: string; provider: string; model: string; title?: string; mode?: string }) => Promise<unknown>
  deleteSession: (id: string) => Promise<unknown>
  agentSend: (opts: { sessionId: string; message: string }) => Promise<unknown>
  agentAbort: (sessionId: string) => Promise<unknown>
  agentApproval: (sessionId: string, callId: string, decision: unknown) => Promise<unknown>
  listProviders: () => Promise<unknown>
  appInfo: () => { name: string; version: string; platform: string }

  /** Look up a device by token. Returns null if unknown / revoked. The
   *  server calls this on every authed request. Implementations should
   *  use a constant-time compare. */
  resolveToken: (token: string) => PairedDevice | null

  /** Mark a device as "just seen now" for audit / Settings UI display.
   *  Implementations debounce / persist as appropriate. */
  touchDevice: (deviceId: string) => void

  /** Redeem a pairing code → permanent device token. Implementations
   *  validate the code is current + unexpired, atomically mark it consumed,
   *  generate a token, persist the new device. */
  redeemPairing: (code: string, label: string, platform: PairedDevice['platform']) => { ok: true; device: PairedDevice } | { ok: false; error: string }
}

export interface RemoteServerHandle {
  port: number
  stop: () => Promise<void>
  /** Local URLs the user could plausibly hand a client. Loopback last. */
  addresses: () => string[]
}

export interface StartRemoteServerOpts {
  port: number
  bus: EventEmitter
  handlers: RemoteServerHandlers
}

/** Channel names that should be relayed to SSE subscribers. Mirrors the set
 *  the renderer subscribes to via the agent.* preload bridge — keeps remote
 *  clients in lockstep with the desktop UI, no surprises about which event a
 *  given client sees. */
const SSE_CHANNELS = [
  'agent:text',
  'agent:thinking',
  'agent:toolCall',
  'agent:iteration',
  'agent:tasks',
  'agent:approvalRequest',
  'agent:askUser',
  'agent:planExit',
  'agent:usage',
  'agent:stats',
  'agent:done',
  'agent:error',
  'agent:started',
] as const

/** URL-safe random token. 32 bytes / 256 bits — resistant to brute force on
 *  any realistic timeline. Used for permanent per-device bearers. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Short, human-readable pairing code. Avoids ambiguous chars (0/O, 1/I/l)
 *  so users don't fat-finger the redemption on a phone. 6 chars from a
 *  ~30-char alphabet ≈ 30 bits of entropy — fine because the code is
 *  single-use, time-limited (5 min), and rate-limited (`MAX_PAIRING_TRIES`
 *  per code). */
const PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export function generatePairingCode(): string {
  const len = 6
  let out = ''
  const buf = randomBytes(len)
  for (let i = 0; i < len; i++) {
    out += PAIRING_ALPHABET[(buf[i] ?? 0) % PAIRING_ALPHABET.length]
  }
  return out
}

/** Constant-time string compare. Avoids timing leaks on early-mismatch
 *  fast-paths. */
export function timingSafeStrEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export function localAddresses(port: number): string[] {
  const ifaces = networkInterfaces()
  const ipv4: string[] = []
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const info of list) {
      // IPv4 only — bracketed-host IPv6 URLs confuse copy-paste consumers
      // and we already hit the IPv6-localhost foot-gun once with LM Studio.
      if (info.family !== 'IPv4') continue
      if (info.internal) continue
      ipv4.push(`http://${info.address}:${port}`)
    }
  }
  ipv4.push(`http://127.0.0.1:${port}`)
  return ipv4
}

export async function startRemoteServer(opts: StartRemoteServerOpts): Promise<RemoteServerHandle> {
  const { port, bus, handlers } = opts
  const app = new Hono()

  // Bound unauthenticated parsing work as well as authenticated prompts.
  // The current Hono release enforces this for fixed and chunked bodies.
  app.use('*', bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ ok: false, error: 'request body exceeds 1 MB' }, 413),
  }))

  // CORS open — the auth token is the security boundary, not the Origin
  // header. Native phone apps don't send Origin anyway, and a future PWA /
  // browser-based client needs full CORS.
  app.use('*', cors({
    origin: '*',
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }))

  // ── Auth middleware ──
  // Skipped only for paths that MUST be reachable pre-auth: health probes,
  // service-info banner, and the pairing redemption endpoint (which has its
  // own bounded-attempts protection via the time-limited pairing code).
  const PUBLIC_PATHS = new Set(['/health', '/api/info', '/api/pair'])
  app.use('*', async (c, next) => {
    const path = c.req.path
    if (PUBLIC_PATHS.has(path)) return next()

    const authz = c.req.header('Authorization') ?? ''
    const presented = authz.startsWith('Bearer ') ? authz.slice('Bearer '.length) : ''
    if (!presented) return c.json({ ok: false, error: 'unauthorized' }, 401)

    const device = handlers.resolveToken(presented)
    if (!device) return c.json({ ok: false, error: 'unauthorized' }, 401)

    handlers.touchDevice(device.id)

    // Bind device identity to the async context for the rest of the request
    // tree. Downstream handlers (and the agent runtime under them) read this
    // via `currentRequestSource()` to tag approval prompts / audit logs.
    const source: RequestSource = {
      kind: 'remote',
      deviceId: device.id,
      deviceLabel: device.label,
      devicePlatform: device.platform,
    }
    return await new Promise((resolve, reject) => {
      requestContext.run(source, () => {
        next().then(resolve).catch(reject)
      })
    })
  })

  app.get('/health', (c) => c.json({ ok: true }))
  app.get('/api/info', (c) => c.json({ ok: true, info: handlers.appInfo() }))

  // ── Pairing ──
  // The flow:
  //   1. Desktop UI generates a pairing code, displays it on screen + as QR
  //      (codemaxxing://pair?host=...&port=...&code=ABC123).
  //   2. Client (phone, etc.) POSTs /api/pair with the code + a label +
  //      platform identifier.
  //   3. Server validates the code (must be current, unexpired, and match
  //      a code the desktop generated) and returns a permanent per-device
  //      token. The code is then atomically consumed — single-use only.
  //   4. Client persists token; subsequent calls use it as Bearer.
  const failedPairingAttempts: number[] = []
  const pairingWindowMs = 60_000
  const maxFailedPairingAttempts = 20

  app.post('/api/pair', async (c) => {
    const now = Date.now()
    while (failedPairingAttempts.length > 0 && failedPairingAttempts[0] <= now - pairingWindowMs) {
      failedPairingAttempts.shift()
    }
    if (failedPairingAttempts.length >= maxFailedPairingAttempts) {
      c.header('Retry-After', '60')
      return c.json({ ok: false, error: 'too many pairing attempts; try again in a minute' }, 429)
    }
    const body = await c.req.json().catch(() => ({})) as {
      code?: string
      label?: string
      platform?: string
    }
    if (!body.code || typeof body.code !== 'string') {
      return c.json({ ok: false, error: 'code is required' }, 400)
    }
    const label = (body.label && typeof body.label === 'string' ? body.label.slice(0, 64) : '').trim() || 'Unnamed device'
    const platform: PairedDevice['platform'] = (
      ['ios','android','macos','windows','linux','browser','cli'].includes(body.platform ?? '')
        ? (body.platform as PairedDevice['platform'])
        : 'unknown'
    )
    const result = handlers.redeemPairing(body.code.toUpperCase(), label, platform)
    if (!result.ok) {
      failedPairingAttempts.push(now)
      return c.json({ ok: false, error: result.error }, 400)
    }
    failedPairingAttempts.length = 0
    return c.json({
      ok: true,
      // Echo back the device record minus the token (the client already has
      // it from this response). Lets the client display "you're paired as
      // <label>" without a follow-up call.
      device: {
        id: result.device.id,
        label: result.device.label,
        platform: result.device.platform,
        createdAt: result.device.createdAt,
      },
      token: result.device.token,
    })
  })

  // ── Sessions ──
  app.get('/api/sessions', async (c) => c.json(await handlers.listSessions()))
  app.get('/api/sessions/:id', async (c) => c.json(await handlers.getSession(c.req.param('id'))))
  app.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { cwd?: string; provider?: string; model?: string; title?: string; mode?: string }
    if (!body.cwd || !body.provider || !body.model) {
      return c.json({ ok: false, error: 'cwd, provider, and model are required' }, 400)
    }
    return c.json(await handlers.createSession({
      cwd: body.cwd, provider: body.provider, model: body.model,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
    }))
  })
  app.delete('/api/sessions/:id', async (c) => c.json(await handlers.deleteSession(c.req.param('id'))))

  // ── Agent ──
  app.post('/api/agent/send', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; message?: string }
    if (!body.sessionId || typeof body.message !== 'string') {
      return c.json({ ok: false, error: 'sessionId and message are required' }, 400)
    }
    // Fire-and-forget: kick off the run, return immediately. The client
    // subscribes to /api/events (SSE) for streaming output. We deliberately
    // capture the current AsyncLocalStorage frame and re-enter it inside the
    // detached promise so events emitted by the agent (which happen long
    // after this handler returns) still know which device asked.
    const src = currentRequestSource()
    void requestContext.run(src, async () => {
      try { await handlers.agentSend({ sessionId: body.sessionId!, message: body.message! }) }
      catch (e) { console.error('[remote] agentSend failed:', e) }
    })
    return c.json({ ok: true })
  })
  app.post('/api/agent/abort', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string }
    if (!body.sessionId) return c.json({ ok: false, error: 'sessionId required' }, 400)
    return c.json(await handlers.agentAbort(body.sessionId))
  })
  app.post('/api/agent/approval', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { sessionId?: string; callId?: string; decision?: unknown }
    if (!body.sessionId || !body.callId || body.decision === undefined) {
      return c.json({ ok: false, error: 'sessionId, callId, decision required' }, 400)
    }
    return c.json(await handlers.agentApproval(body.sessionId, body.callId, body.decision))
  })

  // ── Providers ──
  app.get('/api/providers', async (c) => c.json(await handlers.listProviders()))

  // ── Streaming events (SSE) ──
  app.get('/api/events', (c) => {
    const sessionFilter = c.req.query('session') ?? null
    return streamSSE(c, async (stream) => {
      const listeners: Array<{ channel: string; fn: (payload: unknown) => void }> = []
      let closed = false

      const subscribe = (channel: string) => {
        const fn = (payload: unknown) => {
          if (closed) return
          if (sessionFilter && (payload as { sessionId?: string })?.sessionId !== sessionFilter) return
          stream.writeSSE({ event: channel, data: JSON.stringify(payload) }).catch(() => { /* client gone */ })
        }
        bus.on(channel, fn)
        listeners.push({ channel, fn })
      }
      for (const ch of SSE_CHANNELS) subscribe(ch)

      // Heartbeat every 20s. Mobile carriers and corporate Wi-Fi proxies
      // routinely kill idle connections at 30-60s; a periodic comment line
      // keeps the path warm without polluting the event stream.
      const heartbeat = setInterval(() => {
        if (closed) return
        stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {})
      }, 20_000)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        for (const { channel, fn } of listeners) bus.off(channel, fn)
      }

      stream.onAbort(cleanup)

      await stream.writeSSE({ event: 'open', data: JSON.stringify({ at: Date.now(), filter: sessionFilter }) })

      await new Promise<void>((resolve) => {
        const checkClosed = setInterval(() => { if (closed) { clearInterval(checkClosed); resolve() } }, 1000)
      })
      cleanup()
    })
  })

  // Bind to 0.0.0.0 so any LAN client (phone on the same Wi-Fi, work laptop,
  // etc.) can reach the desktop. Loopback-only would defeat the point.
  let server: ServerType | null = null
  let boundPort = port
  await new Promise<void>((resolve, reject) => {
    server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
      if (!info) return reject(new Error('serve callback received no info'))
      boundPort = info.port
      resolve()
    })
  })

  return {
    port: boundPort,
    addresses: () => localAddresses(boundPort),
    stop: async () => {
      if (!server) return
      await new Promise<void>((resolve) => {
        server!.close(() => resolve())
      })
    },
  }
}
