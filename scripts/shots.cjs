/* Generate README screenshots by driving the renderer (dev-mocks) in a hidden
 * offscreen Electron window and writing PNGs to docs/screenshots/.
 *
 * Usage: start the dev server (npm run dev) on :5173, then:
 *   npx electron scripts/shots.cjs
 * Reproducible — re-run any time the UI changes. Not part of the app bundle. */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const URL = process.env.SHOTS_URL || 'http://localhost:5173'
const OUT = path.join(__dirname, '..', 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1000,
    webPreferences: { offscreen: true },
  })
  await win.loadURL(URL)
  await sleep(2000) // app init + web fonts

  const js = (code) => win.webContents.executeJavaScript(code)
  const pickTheme = async (prefix) => {
    await js(`document.querySelector('button[title="Settings"]')?.click()`)
    await sleep(350)
    await js(`[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Appearance')?.click()`)
    await sleep(350)
    await js(`(()=>{const c=[...document.querySelectorAll('div,button')].find(d=>(d.textContent?.trim()||'').startsWith(${JSON.stringify(prefix)}));c&&c.click()})()`)
    await sleep(350)
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    await sleep(500)
  }
  const openDemo = async () => {
    await js(`(()=>{const i=[...document.querySelectorAll('aside *')].find(e=>e.textContent==='Streaming demo');i&&i.dispatchEvent(new MouseEvent('click',{bubbles:true}))})()`)
    await sleep(1000)
  }
  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, name), img.toPNG())
    console.log('wrote', name, img.getSize())
  }

  await pickTheme('Ember')
  await sleep(400)
  await shot('hero.png')

  await openDemo()
  await shot('chat-ember.png')

  await pickTheme('Synthwave')
  await openDemo()
  await shot('chat-synthwave.png')

  await pickTheme('Ember')
  await js(`document.querySelector('button[title="Cookbook"]')?.click()`)
  await sleep(800)
  await shot('cookbook.png')

  win.destroy()
  app.quit()
}

app.whenReady().then(run).catch((e) => { console.error(e); app.quit() })
