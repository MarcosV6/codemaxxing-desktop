import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const [platform, arch] = process.argv.slice(2)
if (!platform || !arch) {
  console.error('Usage: node scripts/smoke-packaged.mjs <mac|win|linux> <arch>')
  process.exit(2)
}

const candidates = {
  mac: [
    resolve(`release/mac-${arch}/Codemaxxing.app/Contents/MacOS/Codemaxxing`),
    resolve('release/mac/Codemaxxing.app/Contents/MacOS/Codemaxxing'),
  ],
  win: [
    resolve(arch === 'x64' ? 'release/win-unpacked/Codemaxxing.exe' : `release/win-${arch}-unpacked/Codemaxxing.exe`),
  ],
  linux: [
    resolve(arch === 'x64' ? 'release/linux-unpacked/codemaxxing-desktop' : `release/linux-${arch}-unpacked/codemaxxing-desktop`),
  ],
}

if (!(platform in candidates)) {
  console.error(`Unsupported platform: ${platform}`)
  process.exit(2)
}

let executable = ''
for (const candidate of candidates[platform]) {
  try {
    await access(candidate)
    executable = candidate
    break
  } catch {
    // Try the next electron-builder output directory.
  }
}

if (!executable) {
  console.error(`Packaged executable not found for ${platform} ${arch}`)
  process.exit(1)
}

const command = platform === 'linux' ? 'xvfb-run' : executable
// GitHub's unprivileged hosted runner cannot configure Electron's setuid
// sandbox helper as root:4755. Disable Chromium's sandbox only for this
// disposable CI launch; normal packaged-app launches remain sandboxed.
const args = platform === 'linux' ? ['-a', executable, '--no-sandbox'] : []
const output = []
const child = spawn(command, args, {
  // xvfb-run starts both Xvfb and Electron. Give the wrapper its own process
  // group so cleanup can terminate the entire tree after the healthy window.
  detached: platform === 'linux',
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const capture = (chunk) => {
  if (output.join('').length < 32_000) output.push(String(chunk))
}
child.stdout.on('data', capture)
child.stderr.on('data', capture)

const exitResult = new Promise((resolveExit) => {
  child.once('error', (error) => resolveExit({ early: true, error }))
  child.once('exit', (code, signal) => resolveExit({ early: true, code, signal }))
})
const healthyResult = new Promise((resolveHealthy) => {
  setTimeout(() => resolveHealthy({ early: false }), 10_000)
})

const result = await Promise.race([exitResult, healthyResult])
if (result.early) {
  process.stdout.write(output.join(''))
  console.error(`Packaged app exited before the smoke window: ${JSON.stringify(result)}`)
  process.exit(1)
}

const stopChildTree = (signal) => {
  try {
    if (platform === 'linux' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    child.kill(signal)
  }
}

stopChildTree('SIGTERM')
await Promise.race([
  exitResult,
  new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
])
if (child.exitCode === null && child.signalCode === null) stopChildTree('SIGKILL')

process.stdout.write(output.join(''))
console.log(`Packaged launch smoke passed: ${platform} ${arch}`)
