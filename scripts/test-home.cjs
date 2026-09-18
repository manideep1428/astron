const { _electron } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astron-home-'))
const bootstrap = path.join(temp, 'bootstrap.cjs')
fs.writeFileSync(
  bootstrap,
  `const { app } = require('electron'); app.setPath('userData', ${JSON.stringify(temp)}); require(${JSON.stringify(path.join(root, 'out/main/index.js'))});`
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
;(async () => {
  let app
  try {
    app = await _electron.launch({ args: [bootstrap], env, timeout: 30000 })
    let page
    for (let i = 0; i < 100; i++) {
      page = app
        .windows()
        .find((p) => p.url().includes('index.html') && !p.url().includes('window='))
      if (page) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.ok(page, 'Main window opens on first launch')
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator('.home-intro h1').waitFor()
    assert.equal(await page.locator('.home-section').count(), 4)
    assert.equal(
      await page.getByPlaceholder('Try: Research OpenAI Agents SDK docs and compare modes').count(),
      1
    )
    await page
      .getByPlaceholder('Try: Research OpenAI Agents SDK docs and compare modes')
      .fill('Draft stays while navigating')
    for (const id of ['playground', 'settings', 'guide', 'agents']) {
      await page.locator(`nav a[href="#${id}"]`).click()
      await page.waitForFunction((sectionId) => {
        const top = document.getElementById(sectionId).getBoundingClientRect().top
        return top >= 0 && top < 500
      }, id)
      assert.equal(
        await page.locator(`nav a[href="#${id}"]`).getAttribute('aria-current'),
        'location'
      )
      const top = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top)
      assert.ok(top >= 0 && top < 500, `${id} scrolls into view: ${top}`)
    }
    assert.equal(
      await page
        .getByPlaceholder('Try: Research OpenAI Agents SDK docs and compare modes')
        .inputValue(),
      'Draft stays while navigating'
    )
    await page.getByPlaceholder('Try: Research OpenAI Agents SDK docs and compare modes').fill('')
    await page.locator('.home-main').evaluate((el) => {
      el.style.scrollBehavior = 'auto'
      el.scrollTop = 0
    })
    const screenshot = path.join(root, 'scripts', 'astron-home.png')
    await page.screenshot({ path: screenshot })
    await page.setViewportSize({ width: 720, height: 800 })
    assert.ok(
      await page.locator('.home-main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      'No narrow-window horizontal overflow'
    )
    assert.deepEqual(errors, [], 'No renderer errors')
    console.log(
      'PASS: all sections, navigation, draft preservation, narrow layout, renderer errors. Screenshot:',
      screenshot
    )
  } finally {
    if (app) await app.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
