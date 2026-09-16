/**
 * Offline verification of the OpenAI switch.
 *
 * 1. config.ts  – .env loading, saved key precedence, legacy Smallest token is
 *                 never adopted, and a stale/custom apiUrl is ignored.
 * 2. stt.ts     – multipart request shape, model field, success parsing,
 *                 OpenAI error surfacing, and missing-key short circuit.
 * 3. browser    – resolveOpenTarget/isOpenOnlyTask, plus a real Chromium run of
 *                 the "open <url>" branch against a local page (no external net).
 *
 * Runs the real TypeScript sources through a tiny transpiling loader, so nothing
 * here reads or writes the user's config file and no API credits are spent.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
setTimeout(() => {
  console.error('WATCHDOG: timed out')
  process.exit(2)
}, 110_000).unref?.()

/** Transpile-on-demand CommonJS loader with per-context module caching. */
function createTsContext(stubs = {}) {
  const cache = new Map()
  function load(file) {
    const resolved = path.resolve(file)
    if (cache.has(resolved)) return cache.get(resolved).exports
    const mod = { exports: {} }
    cache.set(resolved, mod)
    const js = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', js)
    fn(
      mod.exports,
      (spec) => {
        if (spec in stubs) return stubs[spec]
        if (spec.startsWith('.')) {
          const base = path.resolve(path.dirname(resolved), spec)
          for (const candidate of [base + '.ts', path.join(base, 'index.ts')]) {
            if (fs.existsSync(candidate)) return load(candidate)
          }
          return require(base)
        }
        return require(spec)
      },
      mod,
      resolved,
      path.dirname(resolved)
    )
    return mod.exports
  }
  return { load }
}

/** Minimal OpenAI-shaped server that records every request it receives. */
function startMock() {
  const requests = []
  let responder = () => ({ status: 200, body: JSON.stringify({ text: 'hello world' }) })
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
      const out = responder(req)
      res.writeHead(out.status, { 'Content-Type': out.contentType || 'application/json' })
      res.end(out.body)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        requests,
        setResponder: (fn) => {
          responder = fn
        },
        close: () => new Promise((r) => server.close(r))
      })
    })
  })
}
const CONFIG = path.join(root, 'src/main/config.ts')
const STT = path.join(root, 'src/main/stt.ts')
const WORKER = path.join(root, 'src/main/agent/agents/browserWorker.ts')
const POOL = path.join(root, 'src/main/agent/environments/browserPool.ts')

async function testConfig() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astron-cfg-'))
  const cwd = process.cwd()
  const saved = {
    key: process.env.OPENAI_API_KEY,
    lang: process.env.OPENAI_LANGUAGE,
    gpt: process.env.GPT_API_KEY
  }
  try {
    // A temp .env is the first candidate, so the repo .env is never read here.
    fs.writeFileSync(path.join(temp, '.env'), 'OPENAI_API_KEY=sk-from-dotenv\nOPENAI_LANGUAGE=de\n')
    process.chdir(temp)
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_LANGUAGE
    delete process.env.GPT_API_KEY
    const electronStub = { app: { getPath: () => temp, getAppPath: () => temp } }
    const load = () => createTsContext({ electron: electronStub }).load(CONFIG)

    const api = load()
    const fromEnv = api.configManager.get()
    assert.equal(fromEnv.openaiApiKey, 'sk-from-dotenv', '.env supplies the key')
    assert.equal(fromEnv.language, 'de', '.env supplies the default language')
    assert.equal(api.DEFAULT_STT_URL, 'https://api.openai.com/v1/audio/transcriptions')
    assert.equal(fromEnv.apiUrl, api.DEFAULT_STT_URL)

    fs.writeFileSync(
      path.join(temp, 'astron_config.json'),
      JSON.stringify({
        openaiApiKey: 'sk-saved-by-user',
        apiUrl: 'https://legacy.example/v1/stt',
        language: '',
        smallestAiToken: 'sk-legacy-smallest',
        history: [{ id: 'h1', timestamp: 1, text: 'kept', durationMs: 5 }],
        autoPaste: false
      })
    )
    const cfg = load().configManager.get()
    assert.equal(cfg.openaiApiKey, 'sk-saved-by-user', 'saved key wins over .env')
    assert.equal(cfg.apiUrl, api.DEFAULT_STT_URL, 'stale saved endpoint is replaced')
    assert.equal(cfg.language, 'de', 'blank saved language falls back to the default')
    assert.equal(cfg.history.length, 1, 'history survives the provider switch')
    assert.equal('autoPaste' in cfg, false, 'removed dictation preferences are not resurrected')
    assert.equal('soundCues' in cfg, false, 'removed dictation preferences are not resurrected')
    assert.equal('smallestAiToken' in cfg, false, 'legacy Smallest token is dropped')
    console.log('PASS config: .env fallback, saved key precedence, stale endpoint replaced')
  } finally {
    process.chdir(cwd)
    for (const [name, value] of [
      ['OPENAI_API_KEY', saved.key],
      ['OPENAI_LANGUAGE', saved.lang],
      ['GPT_API_KEY', saved.gpt]
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

async function testStt(mock) {
  const settings = { openaiApiKey: 'sk-test-key', language: 'en' }
  const fakeConfig = {
    DEFAULT_STT_URL: 'https://api.openai.com/v1/audio/transcriptions',
    configManager: {
      get: () => ({ ...settings, apiUrl: `http://127.0.0.1:${mock.port}/v1/audio/transcriptions` })
    }
  }
  const stt = createTsContext({ './config': fakeConfig }).load(STT)

  delete process.env.OPENAI_TRANSCRIBE_MODEL
  assert.equal(stt.transcribeModel(), 'gpt-4o-mini-transcribe', 'default model')
  process.env.OPENAI_TRANSCRIBE_MODEL = 'whisper-1'
  assert.equal(stt.transcribeModel(), 'whisper-1', 'model is overridable')
  delete process.env.OPENAI_TRANSCRIBE_MODEL

  const wav = Buffer.concat([Buffer.from('RIFF____WAVE'), Buffer.from([1, 2, 3, 4])])
  const ok = await stt.transcribeAudio(wav, 1200)
  assert.equal(ok.success, true)
  assert.equal(ok.text, 'hello world')
  assert.equal(ok.durationMs, 1200, 'reports the real recording time')

  const req = mock.requests.at(-1)
  assert.equal(req.url, '/v1/audio/transcriptions', 'posts to the transcription path')
  assert.equal(req.headers.authorization, 'Bearer sk-test-key')
  assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=----AstronBoundary/)
  const boundary = req.headers['content-type'].split('boundary=')[1]
  const body = req.body.toString('latin1')
  assert.match(body, /name="model"\r\n\r\ngpt-4o-mini-transcribe/)
  assert.match(body, /name="response_format"\r\n\r\njson/)
  assert.match(body, /name="language"\r\n\r\nen/)
  assert.match(body, /name="file"; filename="speech\.wav"\r\nContent-Type: audio\/wav/)
  assert.ok(body.includes('RIFF____WAVE'), 'audio bytes are uploaded')
  assert.ok(body.endsWith(`--${boundary}--\r\n`), 'multipart body is terminated')
  console.log('PASS stt: multipart shape, model field, success parsing')

  mock.setResponder(() => ({
    status: 401,
    body: JSON.stringify({ error: { message: 'Incorrect API key provided' } })
  }))
  const bad = await stt.transcribeAudio(wav, 10)
  assert.equal(bad.success, false)
  assert.match(bad.error, /401/)
  assert.match(bad.error, /Incorrect API key provided/)

  mock.setResponder(() => ({ status: 500, body: 'upstream boom', contentType: 'text/plain' }))
  const broken = await stt.transcribeAudio(wav, 10)
  assert.equal(broken.success, false)
  assert.match(broken.error, /500/)
  assert.match(broken.error, /upstream boom/)
  console.log('PASS stt: OpenAI error message surfaced for 401 and non-JSON 500')

  mock.setResponder(() => ({ status: 200, body: JSON.stringify({ text: 'unused' }) }))
  settings.openaiApiKey = ''
  delete process.env.OPENAI_API_KEY
  delete process.env.GPT_API_KEY
  const before = mock.requests.length
  const noKey = await stt.transcribeAudio(wav, 10)
  assert.equal(noKey.success, false)
  assert.match(noKey.error, /OpenAI API key in Settings/)
  assert.equal(mock.requests.length, before, 'no request is sent without a key')
  console.log('PASS stt: missing key short circuits without a network call')
}
/** Local stand-in for a website, so the browser run needs no external network. */
function startLocalPage() {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(
      '<html><head><title>Astron Local Test Page</title></head>' +
        '<body><main>local page body for the open-browser check</main></body></html>'
    )
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: server.address().port,
        hits,
        close: () => new Promise((r) => server.close(r))
      })
    )
  })
}

async function testBrowser(local) {
  const ctx = createTsContext()
  const worker = ctx.load(WORKER)

  assert.equal(worker.DEFAULT_OPEN_URL, 'https://www.google.com')
  assert.equal(worker.resolveOpenTarget('open browser'), null, 'bare "open browser" names no site')
  assert.equal(worker.resolveOpenTarget('open example.com'), 'https://example.com')
  assert.equal(
    worker.resolveOpenTarget('go to https://news.ycombinator.com'),
    'https://news.ycombinator.com'
  )
  assert.equal(worker.resolveOpenTarget('research the OpenAI agents SDK'), null)
  assert.equal(worker.isOpenOnlyTask('open browser'), true)
  assert.equal(worker.isOpenOnlyTask('open example.com'), true)
  assert.equal(worker.isOpenOnlyTask('open the docs and summarise them'), false)
  assert.equal(worker.isOpenOnlyTask('research agent frameworks'), false)
  console.log('PASS browser: "open browser"/URL parsing never turns into a web search')

  const pool = ctx.load(POOL).browserPool
  const url = `http://127.0.0.1:${local.port}/`
  const steps = []
  let result
  let env
  try {
    env = await pool.acquire('open-browser test')
    result = await worker.runBrowserTask(env.id, `open ${url}`, (msg, p) =>
      steps.push(`${msg}@${p}`)
    )
  } catch (err) {
    if (/Executable doesn't exist|playwright install/i.test(String(err))) {
      console.log('SKIP browser run: Chromium missing (run: npx playwright install chromium)')
      return
    }
    throw err
  } finally {
    if (env) pool.release(env.id)
    await pool.shutdown()
  }

  assert.ok(local.hits.length >= 1, 'the local page was requested (no external network)')
  assert.match(result.text, /Astron Local Test Page/, 'page title captured')
  assert.equal(result.finalUrl, url)
  assert.ok(result.screenshot.startsWith('iVBOR'), 'PNG screenshot captured')
  assert.ok(
    steps.some((s) => s.startsWith('Opening http://127.0.0.1')),
    'progress was streamed to the UI'
  )
  console.log('PASS browser: real Chromium run of "open <url>" reported title + screenshot')
}

;(async () => {
  const mock = await startMock()
  const local = await startLocalPage()
  try {
    await testConfig()
    await testStt(mock)
    await testBrowser(local)
    console.log('ALL PASS: OpenAI config, transcription, and browser-open checks')
  } finally {
    await mock.close()
    await local.close()
  }
})().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
