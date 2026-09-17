const { _electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Never hang: report progress and exit before the outer command timeout.
setTimeout(() => { console.error('WATCHDOG: timed out'); process.exit(2) }, 24000).unref?.()

// Isolated profile: never modify the user's config or send audio to an API.
const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'astron-assistant-'))
const bootstrap = path.join(temporary, 'bootstrap.cjs')
fs.writeFileSync(bootstrap, `
const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(temporary)});
const cp = require('node:child_process');
const originalSpawn = cp.spawn;
cp.spawn = function(file, args, opts) {
 const child = originalSpawn(file, args, opts);
 if (args?.some(a => String(a).includes('assistant_hotkeys.ps1'))) global.testHotkey = child;
 return child;
};
require(${JSON.stringify(path.join(root, 'out/main/index.js'))});
`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
let app
async function launch() {
  app = await _electron.launch({ args: [bootstrap, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], env, timeout: 30000 })
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
  for (let i = 0; i < 100; i++) {
    const page = app.windows().find(p => p.url().includes('window=assistant'))
    if (page) {
      page.on('console', (msg) => console.log(`[renderer] ${msg.text()}`))
      await page.locator('.assistant-card').waitFor()
      return page
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Assistant did not load')
}
async function key(line) {
  await app.evaluate((_, line) => {
    if (!global.testHotkey) throw new Error('Shortcut listener not started')
    global.testHotkey.stdout.emit('data', Buffer.from(line + '\n'))
  }, line)
}
async function dashboardCount() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.webContents.getURL().includes('window=')).length)
}
;(async () => {
  const log = (message) => console.log(new Date().toISOString().slice(11, 19), message)
  try {
    log('launch 1')
    await launch()
    log('first-run dashboard check')
    assert.equal(await dashboardCount(), 1, 'First launch opens Dashboard')
    await app.close(); app = null
    log('launch 2 (background)')
    const page = await launch()
    log('background dashboard check')
    assert.equal(await dashboardCount(), 0, 'Later launch stays in background')
    for (let i = 0; i < 50 && !(await app.evaluate(() => Boolean(global.testHotkey))); i++) {
      await new Promise(r => setTimeout(r, 200))
    }
    assert.ok(await app.evaluate(() => Boolean(global.testHotkey)), 'Shortcut listener started')
    log('shortcut listener ready')
    assert.equal(await page.evaluate(() => document.querySelector('.assistant-card').className), 'assistant-card assistant-idle')
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=assistant')).isVisible()), false)
    log('idle: overlay hidden')
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      window.testTracks = []
      navigator.mediaDevices.getUserMedia = async opts => {
        const stream = await original(opts)
        window.testTracks.push(...stream.getTracks())
        return stream
      }
    })
    await app.evaluate(({ ipcMain }) => {
      global.testSubmissions = 0
      ipcMain.removeHandler('assistant:submit')
      ipcMain.handle('assistant:submit', (_, request) => {
        if (request.audio.byteLength <= 44) throw new Error('Empty WAV')
        global.testSubmissions++
        return { text: 'Mock task', runId: 'test' }
      })
    })
    log('press')
    await key('ASSISTANT_PRESS')
    await page.locator('.assistant-listening').waitFor({ timeout: 8000 })
    log('listening; dashboard still closed')
    assert.equal(await dashboardCount(), 0)
    // Hold long enough to pass the 250ms minimum-speech guard with the fake mic.
    await page.waitForTimeout(1500)
    await key('ASSISTANT_RELEASE')
    log('release')
    let outcome = ''
    for (let i = 0; i < 40; i++) {
      const state = await page.evaluate(() => ({
        cls: document.querySelector('.assistant-card').className,
        label: document.querySelector('.assistant-copy p').textContent,
        tracks: window.testTracks.map(t => t.readyState).join(','),
        submissions: undefined
      }))
      if (state.cls.includes('done') || state.cls.includes('error')) { outcome = state.cls; log('final state:', JSON.stringify(state)); break }
      await new Promise(r => setTimeout(r, 200))
    }
    await page.locator('.assistant-done, .assistant-error').first().waitFor({ timeout: 4000 }).catch(() => undefined)
    const finalLabel = await page.evaluate(() => document.querySelector('.assistant-copy p').textContent)
    log('label:', finalLabel, 'submissions:', await app.evaluate(() => global.testSubmissions))
    assert.ok(outcome.includes('done'), `Expected done, got: ${outcome} (${finalLabel})`)
    assert.equal(await page.evaluate(() => window.testTracks.every(t => t.readyState === 'ended')), true, 'Release closes microphone')
    assert.equal(await app.evaluate(() => global.testSubmissions), 1)
    log('submitted; mic closed')
    for (let i = 0; i < 25; i++) {
      if (!(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=assistant')).isVisible()))) break
      await new Promise(r => setTimeout(r, 200))
    }
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=assistant')).isVisible()), false, 'Overlay auto-hides')
    log('auto-hid')
    await page.evaluate(() => window.astronApi.showDashboard())
    assert.equal(await dashboardCount(), 1, 'Dashboard can still open')
    log('PASS all checks. Shortcut events simulated; physical keys not tested.')
  } finally {
    if (app) await app.close()
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
