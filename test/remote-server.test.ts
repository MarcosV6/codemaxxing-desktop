import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  startRemoteServer,
  type PairedDevice,
  type RemoteServerHandle,
  type RemoteServerHandlers,
} from '../electron/core/remoteServer'

const activeServers: RemoteServerHandle[] = []

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.stop()))
})

async function makeServer() {
  const token = 'test-token'
  const device: PairedDevice = {
    id: 'dev_test',
    label: 'Beta tester',
    platform: 'browser',
    token,
    createdAt: Date.now(),
    lastSeenAt: null,
  }
  const handlers: RemoteServerHandlers = {
    listSessions: async () => ({ ok: true, sessions: [{ id: 'session-1' }] }),
    getSession: async (id) => ({ ok: true, id }),
    createSession: async (opts) => ({ ok: true, opts }),
    deleteSession: async (id) => ({ ok: true, id }),
    agentSend: async () => ({ ok: true }),
    agentAbort: async () => ({ ok: true }),
    agentApproval: async () => ({ ok: true }),
    listProviders: async () => ({ ok: true, providers: [] }),
    appInfo: () => ({ name: 'Codemaxxing', version: 'test', platform: process.platform }),
    resolveToken: (presented) => presented === token ? device : null,
    touchDevice: () => {},
    redeemPairing: (code) => code === 'BETA42'
      ? { ok: true, device }
      : { ok: false, error: 'Invalid or expired pairing code' },
  }
  const server = await startRemoteServer({ port: 0, bus: new EventEmitter(), handlers })
  activeServers.push(server)
  return { baseUrl: `http://127.0.0.1:${server.port}`, token }
}

describe('remote API server', () => {
  it('exposes public health, protects sessions, and accepts a paired token', async () => {
    const { baseUrl, token } = await makeServer()

    const health = await fetch(`${baseUrl}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })

    const denied = await fetch(`${baseUrl}/api/sessions`)
    expect(denied.status).toBe(401)

    const paired = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'beta42', label: 'Browser', platform: 'browser' }),
    })
    expect(paired.status).toBe(200)
    expect((await paired.json() as { token?: string }).token).toBe(token)

    const sessions = await fetch(`${baseUrl}/api/sessions`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(sessions.status).toBe(200)
    expect(await sessions.json()).toEqual({ ok: true, sessions: [{ id: 'session-1' }] })
  })

  it('rejects oversized request bodies before JSON parsing', async () => {
    const { baseUrl } = await makeServer()
    const response = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'NOPE00', padding: 'x'.repeat(1024 * 1024) }),
    })
    expect(response.status).toBe(413)
  })

  it('throttles repeated failed pairing attempts', async () => {
    const { baseUrl } = await makeServer()
    let response: Response | null = null
    for (let attempt = 0; attempt < 21; attempt++) {
      response = await fetch(`${baseUrl}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'NOPE00' }),
      })
    }
    expect(response?.status).toBe(429)
    expect(response?.headers.get('retry-after')).toBe('60')
  })
})
