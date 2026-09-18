const { _electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/renderer/src/utils/agentDots.ts'), 'utf8')
const context = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
const { deriveAgentDots } = context.exports
const run = { id: 'test', prompt: 'Simulated task', status: 'running', agents: ['working', 'completed', 'failed', 'paused', 'idle', 'waiting-approval'].map((status, i) => ({ id: `agent-${i}`, runId: 'test', role: `Worker ${i}`, task: 'Test', status, progress: 30 })) }
assert.equal(deriveAgentDots([]).length, 0)
assert.equal(deriveAgentDots([run]).length, 6)
assert.equal(deriveAgentDots([{ ...run, status: 'completed' }]).length, 0)
assert.equal(deriveAgentDots([{ ...run, status: 'paused' }])[0].bounce, false)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astron-dots-'))
const bootstrap = path.join(temp, 'bootstrap.cjs')
fs.writeFileSync(bootstrap, `const { app } = require('electron'); app.setPath('userData', ${JSON.stringify(temp)}); require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
;(async () => {
  let app
  try {
    app = await _electron.launch({ args: [bootstrap], env })
    let page
    for (let i = 0; i < 100; i++) {
      page = app.windows().find(p => p.url().includes('window=agent-hub'))
      if (page) break
      await new Promise(r => setTimeout(r, 100))
    }
    assert.ok(page)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await app.evaluate(({ ipcMain }) => {
      global.dotRuns = []
      ipcMain.removeHandler('hub:info')
      ipcMain.handle('hub:info', () => ({ port: 0, token: '' }))
      ipcMain.removeHandler('agent:list')
      ipcMain.handle('agent:list', () => global.dotRuns)
    })
    await page.reload()
    await page.locator('.agent-dots').waitFor({ state: 'attached' })
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=agent-hub')).isVisible())
    assert.equal(await visible(), false)
    const update = async runs => {
      await app.evaluate(({ BrowserWindow }, runs) => {
        global.dotRuns = runs
        BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=agent-hub')).webContents.send('agent:event', { runId: 'test', type: 'run-updated', status: runs[0]?.status, at: Date.now() })
      }, runs)
    }
    await update([run])
    await page.waitForFunction(() => document.querySelectorAll('.agent-orb').length === 6)
    assert.equal(await visible(), true)
    const dots = await page.locator('.agent-orb').evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, text: el.textContent.trim(), color: getComputedStyle(el.firstElementChild).backgroundColor, animation: getComputedStyle(el.firstElementChild).animationName, right: el.getBoundingClientRect().right })))
    assert.ok(dots.every(d => d.width === 26 && d.text === ''))
    assert.equal(dots[0].color, 'rgb(251, 191, 36)')
    assert.equal(dots[1].color, 'rgb(52, 211, 153)')
    assert.equal(dots[2].color, 'rgb(248, 113, 113)')
    assert.equal(dots[0].animation, 'agent-dot-bounce')
    assert.equal(dots[3].animation, 'none')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(temp, 'agent-dots.png') })
    await page.locator('.agent-orb').first().dispatchEvent('click')
    await page.locator('.agent-popover').waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.locator('[data-status="working"]').evaluate(el => getComputedStyle(el).animationName), 'none')
    await update([{ ...run, status: 'completed' }])
    await page.waitForFunction(() => document.querySelectorAll('.agent-orb').length === 0)
    for (let i = 0; i < 20 && await visible(); i++) await page.waitForTimeout(50)
    assert.equal(await visible(), false)
    await update([run])
    await page.waitForFunction(() => document.querySelectorAll('.agent-orb').length === 6)
    assert.equal(await page.locator('.agent-popover').count(), 0)
    assert.deepEqual(errors, [])
    console.log('PASS: mapping, idle hidden, six separate 26px circles, colors, bounce, reduced motion, hover, completion hide, restart. Screenshot:', path.join(temp, 'agent-dots.png'))
  } finally {
    if (app) await app.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})().catch(e => { console.error(e); process.exitCode = 1 })
