# Codemaxxing Remote API

Wire protocol for clients that drive a Codemaxxing desktop instance from
another device. This is the contract the future native phone app, an eventual
PWA, or any external tool will speak.

> **Status:** Preview. The shape below is intended to be stable for v1
> clients. Breaking changes will bump the `info.protocolVersion` field.

## Network model

The desktop runs an HTTP+SSE server on a configurable port (default `7843`),
bound to `0.0.0.0`. By default it's reachable from any host on the same LAN.
For off-LAN access the user is expected to layer a tunnel (Tailscale, Cloudflare
Tunnel, etc.) — the API itself does not handle NAT traversal or TLS.

- **Transport**: HTTP/1.1 over TCP. Plaintext by default. TLS is the tunnel's
  responsibility.
- **Authentication**: Bearer tokens, one per paired device. Issued via the
  pairing flow (`/api/pair`).
- **Streaming**: Server-Sent Events on `/api/events`. Long-lived GET, one
  named event per agent emission.
- **CORS**: Permissive (`Access-Control-Allow-Origin: *`). The bearer token
  is the security boundary, not the Origin header.

## Pairing flow

```
┌─────────────────┐                ┌──────────────┐
│   Desktop       │                │   Phone      │
└────────┬────────┘                └──────┬───────┘
         │                                │
         │  user clicks "Pair a device"   │
         │  → POST /api/pair (skip)       │
         ├─ generates code "X4FJ7P"        │
         ├─ shows code + QR               │
         │                                │
         │   ◄────── user scans QR ─────  │
         │                                │
         │   ◄── POST /api/pair ─────────┤
         │       {code, label, platform} │
         │                                │
         ├─ validates code                │
         ├─ generates device token        │
         ├─ persists device record        │
         │                                │
         │  ─── 200 OK ──────────────────►│
         │       {token, device}          │
         │                                │
         │   ◄── GET /api/info, etc. ────┤
         │       Authorization: Bearer …  │
         │                                │
```

### `POST /api/pair` (no auth)

Redeem a pairing code for a permanent device token.

**Request:**
```json
{
  "code": "X4FJ7P",
  "label": "Marcos's iPhone",
  "platform": "ios"
}
```

`platform` ∈ `ios`, `android`, `macos`, `windows`, `linux`, `browser`, `cli`, `unknown`.

**Response (success):**
```json
{
  "ok": true,
  "device": {
    "id": "dev_a8B2c3D4",
    "label": "Marcos's iPhone",
    "platform": "ios",
    "createdAt": 1765678900000
  },
  "token": "AbCdEf0123456789…"
}
```

**Response (failure):** `400` with `{ "ok": false, "error": "Invalid or expired pairing code" }`.

**Notes:**
- Pairing codes are 6 chars from a 30-character ambiguity-free alphabet,
  expire in 5 minutes, and are single-use. A new pairing on the desktop
  invalidates any unredeemed code.
- The returned `token` is the only place the secret appears — store it
  securely on the device immediately. The desktop only persists a hash-
  equivalent comparison and can't display the token after pairing.
- The pairing URI advertised by the desktop has the form:
  ```
  codemaxxing://pair?host=http://192.168.1.42:7843&code=X4FJ7P
  ```
  Native clients should register `codemaxxing://` as a deep-link scheme.

## Authentication

Every endpoint except `/health`, `/api/info`, and `/api/pair` requires:

```
Authorization: Bearer <device-token>
```

A failed token returns `401 { "ok": false, "error": "unauthorized" }` —
indistinguishable from a missing one (no oracle for "valid format but wrong
token" vs "garbage"). The desktop tracks `lastSeenAt` per device and
surfaces it in the Settings → Remote panel.

## Endpoints

### Public (no auth)

#### `GET /health`
Liveness probe.
```json
{ "ok": true }
```

#### `GET /api/info`
Server identity. Used by clients to confirm "I'm pointed at the right thing"
before pairing.
```json
{
  "ok": true,
  "info": {
    "name": "Codemaxxing",
    "version": "1.0.0",
    "platform": "darwin"
  }
}
```

### Sessions

#### `GET /api/sessions`
List all sessions on this desktop.
```json
{
  "ok": true,
  "sessions": [
    { "id": "s_…", "title": "…", "cwd": "/Users/marcos/foo", "provider": "anthropic", "model": "claude-sonnet-4-6", "mode": "code", "createdAt": 1765… }
  ]
}
```

#### `GET /api/sessions/:id`
Full session including persisted message history.
```json
{
  "ok": true,
  "session": {
    "id": "s_…",
    "title": "…",
    "cwd": "/Users/marcos/foo",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "mode": "code",
    "messages": [
      { "id": "m_…", "type": "user", "content": "…", "createdAt": 1765… },
      { "id": "m_…", "type": "assistant", "segments": [...], "createdAt": 1765… }
    ]
  }
}
```

#### `POST /api/sessions`
Create a new session.

**Request:**
```json
{
  "cwd": "/Users/marcos/foo",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "title": "(optional)",
  "mode": "code"
}
```

**Response:**
```json
{ "ok": true, "id": "s_…" }
```

#### `DELETE /api/sessions/:id`

```json
{ "ok": true }
```

### Agent

#### `POST /api/agent/send`
Send a message into a session. Fire-and-forget — returns `200` immediately.
Stream the response via `/api/events`.

```json
{
  "sessionId": "s_…",
  "message": "Refactor src/auth.ts to use the new SDK"
}
```

```json
{ "ok": true }
```

#### `POST /api/agent/abort`
Cancel an in-flight turn.

```json
{ "sessionId": "s_…" }
```

#### `POST /api/agent/approval`
Respond to a pending approval request (received via SSE as `agent:approvalRequest`).

```json
{
  "sessionId": "s_…",
  "callId": "call_…",
  "decision": "yes"
}
```

`decision` ∈ `"yes"`, `"no"`, `"always"`. `"always"` allowlists the exact
command pattern for this session.

### Providers

#### `GET /api/providers`
List configured LLM providers (Anthropic, OpenAI, OpenRouter, LM Studio,
Ollama, etc.) with auth state.

### Streaming events

#### `GET /api/events?session=<sessionId>`
Long-lived SSE stream. Open one connection per active session view (or one
without `session=` to receive ALL events for ALL sessions).

Each line is `event: <name>\ndata: <json>\n\n`. Recognized events:

| Event                    | Payload                                                                     | Meaning                                          |
|--------------------------|------------------------------------------------------------------------------|---------------------------------------------------|
| `open`                   | `{ at, filter }`                                                             | Stream is live (sent once at start)               |
| `ping`                   | `<timestamp>`                                                                | Keep-alive every 20s                              |
| `agent:started`          | `{ sessionId, iteration }`                                                   | A turn began                                      |
| `agent:text`             | `{ sessionId, delta }`                                                       | New text token                                    |
| `agent:thinking`         | `{ sessionId, delta }`                                                       | New reasoning token (extended-thinking models)    |
| `agent:toolCall`         | `{ sessionId, call }`                                                        | Tool call created or status changed               |
| `agent:iteration`        | `{ sessionId, iteration }`                                                   | Loop tick                                         |
| `agent:tasks`            | `{ sessionId, tasks }`                                                       | Plan-mode task list updated                       |
| `agent:approvalRequest`  | `{ sessionId, callId, kind, summary, command? }`                             | Tool needs user approval before running           |
| `agent:askUser`          | `{ sessionId, askId, question }`                                             | Agent asked the user a question                   |
| `agent:planExit`         | `{ sessionId, plan }`                                                        | Plan-mode exited with a final plan                |
| `agent:usage`            | `{ sessionId, usage }`                                                       | Token usage update                                |
| `agent:stats`            | `{ sessionId, stats }`                                                       | Cost/perf stats                                   |
| `agent:done`             | `{ sessionId, ok }`                                                          | Turn finished                                     |
| `agent:error`            | `{ sessionId, error }`                                                       | Turn errored out                                  |

**Important:** Both the desktop UI and remote clients see the SAME event
stream (fan-out via the desktop's internal `agentBus`). There is no remote-
specific event format and no remote-only filtering — keeping the wire
protocol small means future client work is straightforward.

## Provenance & approval

When a remote client triggers an agent turn, the request's `device` is
attached to the request via `AsyncLocalStorage` and threads through every
event the agent emits. Future protocol versions will include a `from` field
on `agent:approvalRequest`:

```json
{
  "sessionId": "s_…",
  "callId": "call_…",
  "kind": "shell",
  "summary": "rm -rf node_modules",
  "from": { "kind": "remote", "deviceId": "dev_…", "deviceLabel": "Marcos's iPhone", "devicePlatform": "ios" }
}
```

For v1, this metadata is captured server-side but not yet relayed in the
event payload — the desktop UI shows the local approval dialog as before.
A v1.1 client should include the `from` field in any approval UX.

## Platform considerations

- **iOS** — register `codemaxxing://` as URL Scheme in the app's
  Info.plist. Use `NSURLSessionWebSocketTask` is NOT recommended (we use SSE,
  not WS); use `URLSession.bytes(for:)` for line-by-line SSE consumption.
- **Android** — register `codemaxxing://` in the manifest. OkHttp + EventSource library is the cleanest path.
- **Windows desktop client** — same protocol; the Codemaxxing Windows
  desktop ships a paired-as-driver mode where one Windows machine drives a
  Mac (or vice versa) over LAN/Tailscale. Wire shape is identical.
- **PWA / browser** — `EventSource` works natively. Note Safari's lack of
  custom headers on `EventSource` means the bearer token has to go in a
  query parameter for browser clients (`?token=...` is also accepted as a
  fallback). Native clients should always use the header.

## Tunnel / off-LAN connectivity

The recommended path for cellular access is **Tailscale** on both devices:

1. Install Tailscale on the desktop and the phone.
2. Both devices join the same tailnet.
3. Use the Mac's Tailscale IP (`100.x.y.z`) or `<host>.<tailnet>.ts.net` in
   the client URL.

Codemaxxing does **not** bundle Tailscale or run its own relay. We considered
WebRTC P2P with TURN fallback and a custom relay service; both were rejected
for v1. Tailscale gives you P2P-with-relay-fallback for free, end-to-end
encrypted, with no infra for us to operate. A future v2 may add an opt-in
hosted relay for users who don't want to install Tailscale.

## Security model

- **Per-device tokens.** Revoking one device doesn't kick the others.
- **Single-use, time-limited pairing codes.** No long-lived shared secret.
- **Constant-time token comparison.** No timing oracle on token prefix.
- **Auth on every endpoint.** No "internal" endpoints; even read-only paths
  require a token.
- **Audit fields per device.** `createdAt` and `lastSeenAt` exposed in the
  desktop Settings panel.
- **Approval prompts always go to the desktop.** Even when a remote client
  drives a session, destructive tool calls (shell, edit, etc.) gate at the
  desktop's approval UI.

What we DON'T do (and you shouldn't expect):

- **No TLS on the wire.** Plain HTTP. Use a tunnel for off-LAN access.
- **No replay protection.** Bearer tokens are stable; if a token leaks, the
  user must revoke that specific device.
- **No rate limiting per token.** Currently the only rate limit is the
  per-pair-code-attempts cap during pairing.

## Versioning

This document describes **v1 (preview)** of the wire protocol. v1.1 will:
- Add `from` to approval/askUser events
- Add `mDNS/Bonjour` service discovery (no protocol change, just a
  discovery layer)
- Optionally add WebSocket as a parallel transport to SSE

Breaking changes will bump the major version number returned in `/api/info`.
