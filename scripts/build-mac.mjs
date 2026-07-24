import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const builder = resolve(root, 'node_modules/.bin/electron-builder')
const hasCredentialEnv = Boolean(
  process.env.CSC_LINK?.trim() || process.env.CSC_NAME?.trim(),
)
const identities = process.platform === 'darwin' && !hasCredentialEnv
  ? spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  : null
const hasDeveloperId = identities?.status === 0 &&
  /Developer ID Application:/.test(identities.stdout || '')

const args = ['--mac', ...process.argv.slice(2)]
if (!hasCredentialEnv && !hasDeveloperId) {
  // electron-builder otherwise skips signing entirely when no certificate is
  // found. A full ad-hoc bundle signature is still preferable for beta builds
  // and is compatible with the hardenedRuntime:false configuration.
  args.push('-c.mac.identity=-')
}

const result = spawnSync(builder, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
