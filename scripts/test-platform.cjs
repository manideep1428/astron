const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')

// Exercise the real hotkey routing without capturing physical input.
function load(file, platform, mocks) {
  const filename = path.join(root, file)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { platform, cwd: () => root, resourcesPath: root },
    __dirname: path.dirname(filename), console,
    setTimeout, clearTimeout, Buffer
  }, { filename })
  return module.exports
}

const silent = {
  onAssistantPress() {},
  onAssistantRelease() {}
}

;(async () => {
  for (const registrationFails of [false, true]) {
    const callbacks = new Map()
    let unregisters = 0
    const { HotkeyManager } = load('src/main/hotkey.ts', 'darwin', {
      electron: { globalShortcut: {
        register: (key, callback) => { callbacks.set(key, callback); return !registrationFails },
        unregisterAll: () => { unregisters++ }
      } },
      child_process: { spawn: () => { throw new Error('Mac must not spawn Windows listener') } }
    })
    let assistant = 0
    const manager = new HotkeyManager()
    manager.start({ ...silent, onAssistantToggle: () => { assistant++ } })
    assert.deepEqual([...callbacks.keys()], ['Control+Command+A'], 'only the voice-task chord registers')
    if (!registrationFails) {
      callbacks.get('Control+Command+A')()
      callbacks.get('Control+Command+A')()
      assert.equal(assistant, 2)
    }
    manager.stop()
    assert.equal(unregisters, 1)
  }
  console.log('PASS: macOS voice-task shortcut dispatch/registration failure')

  {
    const spawned = []
    const { HotkeyManager } = load('src/main/hotkey.ts', 'win32', {
      electron: {
        app: { getAppPath: () => root },
        globalShortcut: { register: () => true, unregisterAll: () => {} }
      },
      fs: { existsSync: () => true },
      child_process: {
        spawn: (file, args) => {
          spawned.push({ file, args })
          return { stdout: { on() {} }, stderr: { on() {} }, on() {}, kill() {} }
        }
      }
    })
    const manager = new HotkeyManager()
    manager.start({ ...silent, onAssistantToggle() {} })
    assert.equal(spawned.length, 1, 'one listener process')
    assert.equal(spawned[0].file, 'powershell.exe')
    assert.ok(
      spawned[0].args.some((arg) => String(arg).includes('assistant_hotkeys.ps1')),
      'the voice-task listener script is used'
    )
    manager.stop()
    console.log('PASS: Windows listener watches only the voice-task chord')
  }

  console.log('ALL PASS: platform shortcut branches (no dictation chords registered)')
})().catch((err) => {
  console.error(err)
  process.exitCode = 1
})