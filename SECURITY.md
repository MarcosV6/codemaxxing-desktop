# Security policy

If you discover a security vulnerability in Codemaxxing Desktop, please **do not** file a public GitHub issue. Report it privately so we can fix it before exploitation.

## How to report

Email: **thisismarcos@gmail.com** (subject line: `[codemaxxing-desktop security]`)

Please include:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept if you have one)
- Affected version(s) — find with the version shown in the about screen, or `Codemaxxing.app/Contents/Resources/app.asar` package.json
- Your platform (macOS, Windows, Linux + version)
- Whether the vulnerability is public, semi-public, or held confidentially

We aim to acknowledge reports within 72 hours and have a fix or mitigation in place within 14 days for critical issues. We'll credit reporters in the release notes if you'd like (or keep you anonymous — your call).

## Threat model

This is a coding agent with broad system access. We try to be honest about what it does:

| Capability | Where the trust boundary is |
|---|---|
| **API keys for LLM providers** | Stored in macOS Keychain on Mac, Windows Credential Manager on Windows, libsecret on Linux. Never in plaintext config files. |
| **Shell command execution** | Gated by the **approval flow** — `suggest` (ask every command), `auto-edit` (auto-writes, ask shell), `full-auto` (only intended for sandboxed dirs). |
| **File reads/writes** | Same approval flow. The agent can write any file the user can. |
| **Remote API (HTTP+SSE)** | **Off by default.** When enabled, binds `0.0.0.0` on a configurable port. Auth is per-device bearer tokens issued via a single-use, time-limited pairing code. |
| **Paired devices** | Each device has its own token, individually revokable. Revoking restarts the server to drop in-flight connections. |
| **Tool calls from remote clients** | Same approval flow as local. The desktop window auto-raises on approval requests so the user can see + respond. Approval mode for remote sessions is `suggest` regardless of the global default. |
| **MCP servers** | Spawned as child processes, separate trust boundary. User must explicitly install + approve. |
| **Background agents / cron** | Run with the same agent privileges as foreground. Approval prompts surface to the desktop UI. |

### What we explicitly DON'T claim

- **No TLS on the remote API.** It speaks plain HTTP. For off-LAN access, use a tunnel like Tailscale or Cloudflare Tunnel that handles TLS for you. We surface URLs as `http://` to make this honest.
- **No replay protection on bearer tokens.** Tokens are stable until revoked. If a token leaks, the user must revoke that device.
- **No process sandboxing for child shells.** Tool calls run with the user's full shell environment.
- **No supply-chain attestation.** We don't currently sign builds beyond ad-hoc signing on macOS. Verify GitHub Releases checksums and prefer building from source if you're concerned.
- **No telemetry.** The app does not phone home. Analytics, crash reports, usage data — none. (The agent makes API calls to whichever LLM provider you configure, of course.)

### Known limitations (not vulnerabilities, just disclosures)

- The desktop window can be raised by remote-API events. This is intentional (so you don't miss approval prompts) but means a paired device can interrupt your foreground app on the Mac. Revoke devices you don't trust.
- macOS may suspend the agent loop on battery when the lid is closed. The `keepAliveInBackground` setting starts a `powerSaveBlocker`, which prevents *app* suspension but not *system* sleep. For uninterrupted 24/7 operation, keep the lid open and the Mac plugged in.
- The remote pairing code is 6 characters from a 30-char ambiguity-free alphabet. ~30 bits of entropy, single-use, 5-minute TTL. We consider this safe for online attacker scenarios but NOT for an attacker with screen access — don't display the code in front of cameras or untrusted observers.

## Disclosure timeline

1. **Day 0** — you report
2. **By day 3** — we acknowledge receipt and confirm the issue is reproducible
3. **By day 14** — fix shipped (critical) / patch in flight (medium) / triaged with timeline (low)
4. **After fix lands** — coordinated public disclosure if the issue warrants it; CVE if appropriate

We don't operate a paid bug bounty program. We will, however, give credit and our genuine thanks.
