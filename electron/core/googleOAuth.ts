/**
 * Google OAuth PKCE flow (Desktop-app loopback)
 *
 * One sign-in connects BOTH Gmail (IMAP/SMTP via XOAUTH2) and Google
 * Calendar (REST v3). Uses the user's own OAuth client (created free in
 * Google Cloud Console, "Desktop app" type) — the id/secret are pasted once
 * in the app and stored locally; for installed apps Google treats the secret
 * as non-confidential.
 *
 * Mirrors anthropicOAuth.ts: loopback http server + shell.openExternal.
 * Difference: Google allows ANY loopback port for Desktop clients, so we
 * bind port 0 and use whatever the OS hands us — no fixed-port collisions.
 */

import { createServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import { shell } from 'electron'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
// mail.google.com = full IMAP/SMTP access (required for XOAUTH2);
// calendar = Google Calendar REST; openid email = identify the account.
const SCOPES = 'openid email https://mail.google.com/ https://www.googleapis.com/auth/calendar'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Pull the email claim out of an id_token without verifying — fine here:
 *  the token came straight from Google's token endpoint over TLS. */
function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf-8'))
    return typeof payload?.email === 'string' ? payload.email : null
  } catch { return null }
}

export interface GoogleTokens {
  email: string
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

export async function loginGoogleOAuth(
  clientId: string,
  clientSecret: string,
  onStatus?: (msg: string) => void,
): Promise<GoogleTokens> {
  const { verifier, challenge } = generatePKCE()
  const state = base64url(randomBytes(16))

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); server.close(); fn() } }
    // Don't leave a dangling server if the user abandons the browser tab.
    const timer = setTimeout(() => finish(() => reject(new Error('Google sign-in timed out (5 min) — try again.'))), 5 * 60_000)

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return }

      const err = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      if (err || !code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(`<h1>Sign-in failed</h1><p>${err ?? 'missing code or state mismatch'} — you can close this tab and try again.</p>`)
        finish(() => reject(new Error(`Google sign-in failed: ${err ?? 'missing code/state'}`)))
        return
      }

      onStatus?.('Exchanging code for tokens…')
      try {
        const addr = server.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        const tokenRes = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            code,
            code_verifier: verifier,
            redirect_uri: `http://127.0.0.1:${port}/callback`,
          }),
        })
        if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`)
        const data = (await tokenRes.json()) as {
          access_token: string; refresh_token?: string; expires_in: number; id_token?: string
        }
        if (!data.refresh_token) {
          // Happens when the consent screen was skipped (already granted) —
          // prompt=consent below should prevent it, but be explicit.
          throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and sign in again.')
        }
        const email = (data.id_token && emailFromIdToken(data.id_token)) || 'Google account'

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:-apple-system,system-ui,sans-serif;background:#1a1814;color:#d4bd8a;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>💪 Google connected!</h1><p>Email + Calendar are ready. You can close this tab and return to Codemaxxing.</p></div></body></html>')

        finish(() => resolve({
          email,
          accessToken: data.access_token,
          refreshToken: data.refresh_token!,
          expiresAt: Date.now() + data.expires_in * 1000,
        }))
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end(`<h1>Error</h1><p>${e?.message ?? String(e)}</p>`)
        finish(() => reject(e))
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline', // refresh token
        prompt: 'consent',      // force refresh_token even on re-auth
      })
      onStatus?.('Opening Google sign-in in your browser…')
      void shell.openExternal(`${AUTHORIZE_URL}?${params}`)
    })
    server.on('error', (e) => finish(() => reject(e)))
  })
}

export async function refreshGoogleToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status}): ${await res.text()}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
}

/** Best-effort revocation on disconnect. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' })
  } catch { /* best-effort */ }
}
