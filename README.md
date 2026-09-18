# Astron

Astron is a Windows-first desktop assistant built with Electron, React, and TypeScript. It combines a live voice session, a voice-driven task launcher, and a multi-agent "computer use" workspace in a single background app: the main window stays out of your way, a small assistant card handles voice commands, and agents keep working while you do something else.

## Features

- **Voice assistant** – hold `Ctrl + Win + A` to open a small robot card and speak a task. On release, Astron transcribes the request and starts a background agent run. The full app never has to open.
- **Agent hub** – describe a goal (for example, _"Research OpenAI Agents SDK docs and compare modes"_), pick 1–5 agents, and run. Agents get roles (research / browser / verifier), stream progress, screenshots, findings, and a merged summary. You can pause, resume, cancel, and approve sensitive local-PC steps.
- **Live voice (WS)** – streams 16 kHz PCM to a local hub, transcribes it with OpenAI, and answers with the same GPT model that plans agent runs. Speech-to-text output is also offered to agents, so command-like speech can start a background run.
- **All-in-one home window** – agent hub, live voice, settings, and a quick guide on one scrollable page with sidebar navigation. Close the window and Astron keeps running in the tray.
- **Status at a glance** – one small always-on-top circle per active agent (yellow bouncing dot while working, green when done, red on failure). The circles appear only while a run is active and expand on hover.

## Requirements

- Node.js 20.19+ and npm (Vite 7 requirement)
- Windows 10/11 or macOS (Intel or Apple Silicon). macOS integration is implemented but still needs native-device verification; voice tasks use push-to-talk on Windows, while the macOS shortcut toggles recording.

## Getting started

```bash
npm install
npm run dev      # development with HMR
```

The first launch opens the home window. After that, Astron starts quietly in the background; reopen it from the tray icon.

### Production build

```bash
npm run build            # typecheck + build to out/
npm start                # run the built app
npm run build:win        # Windows NSIS installer in dist/
npm run build:mac        # macOS DMG
npm run build:linux      # AppImage / snap / deb
```

### macOS setup

- Voice task: **Control + Command + A**, tap once to start and again to send. Release alone does not finish recording on Mac.
- Allow **Microphone** in System Settings → Privacy & Security for voice tasks and Live Voice. Screen Recording is only needed by browser agents that capture screenshots.
- Build on macOS with `npm run build:mac`. Configuration produces separate `arm64` and `x64` DMGs. Code signing and notarization are not configured for public distribution.
- For browser research, install Playwright's Chromium on the target machine with `npx playwright install chromium` from the project root. Browser binaries are not bundled into the installer.

Mac-specific code paths are tested with mocks on Windows, not a real Mac. Before release, test microphone permission grant/denial, the voice-task toggle, close/reopen from the menu bar/Dock, and both processor architectures.

## Keyboard shortcuts

The following table describes **Windows** shortcuts; use the toggles above on macOS.

| Shortcut                | Action                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `Ctrl + Win + A` (hold) | Voice assistant: speak a task, release to start a background agent run |

The assistant card is non-focusable, so your cursor never leaves the app you are working in.

## Configuration

Settings are stored as `astron_config.json` in Electron's `app.getPath('userData')` directory (normally an Astron folder under `%APPDATA%` on Windows; development profiles can differ). Edit supported preferences from **Settings** in the home window:

- OpenAI API key (used for speech-to-text and for agent planning/merging)
- Computer-use settings: permission mode (`ask` / `my-computer` / `detached` / `auto`), max agents (1–5), sequential vs. parallel execution, ask-before-sensitive, activity display, agent communication

A legacy `wisprflow_config.json` is copied only when it exists in the same user-data directory and no new configuration exists; migration does not search other profile directories.

### Environment variables

Astron loads a `.env` file from the project root if present:

| Variable                            | Purpose                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY` (or `GPT_API_KEY`) | OpenAI key for transcription and agent planning; can also be saved in the UI (plaintext config file) |
| `OPENAI_TRANSCRIBE_MODEL`           | Speech-to-text model; defaults to `gpt-4o-mini-transcribe` (use `whisper-1` for the older model)     |
| `OPENAI_MODEL` (or `GPT_MODEL`)     | Planner/reply model for the Responses API; defaults to `gpt-4.1-mini`                                |
| `OPENAI_LANGUAGE`                   | Default transcription language when no saved language exists; defaults to `en`                       |
| `AGENT_BROWSER_HEADFUL`             | Set to `1` to let browser agents drive a visible Chromium window instead of a headless one           |

Saved nonempty key/language values take precedence over their environment defaults. Astron always sends transcription to `https://api.openai.com/v1/audio/transcriptions`; a URL saved by an older build is ignored so the key can never be posted to a stale endpoint. Never commit a real API key or `.env` file.

## Architecture

```
src/
├── main/           # Electron main process
│   ├── index.ts          # window/tray lifecycle, first-launch logic
│   ├── hub.ts            # local WebSocket hub (127.0.0.1, ports 44517–44777)
│   ├── hotkey.ts         # Windows keyboard listener + hotkey routing
│   ├── voiceSession.ts   # live voice buffering, STT routing, GPT replies
│   ├── stt.ts            # OpenAI transcription
│   ├── config.ts         # config file, env loading, legacy migration
│   └── agent/            # orchestrator, planner, memory, permissions, workers
├── preload/        # contextBridge API (window.astronApi)
└── renderer/       # React UI (home window, overlays, agent dots)
```

Key implementation notes:

- **Local hub** – agent events, RPC, and live-voice audio ride a `ws` WebSocket server bound to `127.0.0.1`. It picks the first free port from `44517, 44518, 44519, 44777`.
- **Overlays** – the assistant card and agent-dots circles run in frameless, transparent, non-focusable windows so they float over other apps without stealing input focus.
- **Agent runs** – the orchestrator shards tasks, assigns roles, merges findings, persists traces and screenshots, and emits events over IPC and the hub.

## Current limitations

- Browser workers perform a deterministic search-and-extract workflow, plus simple "open `example.com`" navigation, not arbitrary autonomous computer use. Local desktop execution is a stub, even after approval.
- Live voice is buffered transcription plus text replies, not a complete realtime speech-to-speech assistant. Replies are emitted as text events, not synthesized audio.
- Windows is the primary target. macOS/Linux packaging scripts exist, but equivalent global shortcuts and desktop integration are not verified.
- Background launch means later launches stay in the tray; it does not mean automatic startup at Windows login.
- Packaging still includes example publishing metadata. Configure signing, release metadata, and update hosting before distribution.

## Development and testing

```bash
npm run typecheck
npm run lint
npm run build
node scripts/test-home.cjs
node scripts/test-assistant.cjs
node scripts/test-agent-dots.cjs
node scripts/test-platform.cjs
node scripts/test-openai.cjs
```

Run these commands from the project root. Build before running Electron tests. The home test checks section navigation, retained task drafts, and narrow-window layout; it saves a screenshot. The assistant test uses a temporary profile, fake microphone input, mocked task submission, and simulated shortcut events. The agent-dots test simulates run events to check the per-agent circles. The platform test runs the macOS/Windows hotkey branches against mocked Electron. The OpenAI test points the transcription client and the browser worker at a local mock server, so it verifies the request shape, error handling, and the "open browser" path without spending API credits or touching the network. Only the optional live-model check needs a real `OPENAI_API_KEY`. None of these validate physical keyboard shortcuts. Quit any running Astron instance before testing to avoid competing shortcut listeners.

## Privacy and data

- Speech transcription and agent planning require network access to OpenAI. Browser research contacts search engines and visited sites.
- The API key and preferences are stored in a local JSON configuration file, **not encrypted credential storage**. Treat configuration files, environment files, traces, and screenshots as sensitive.
- Live Voice continues capturing until stopped; the voice-task shortcut uses push-to-talk. Check Windows microphone permissions if recording fails.
- The WebSocket hub binds to loopback, not a LAN interface. This is not an authentication boundary against other local processes; do not expose it through a proxy or port forward.

## Troubleshooting

| Problem                            | What to check                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| No main window after launch        | Expected after first use. Open Dashboard from the tray or double-click the tray icon. Use tray → Quit to exit fully.               |
| No transcription or a 401 response | Save a valid OpenAI API key in Settings (or set `OPENAI_API_KEY`), allow microphone access, and check network access.               |
| Hotkeys do not respond             | Confirm Astron is running on Windows and its PowerShell listener starts; check for competing shortcuts.                             |
| Hub cannot start                   | Check the four candidate ports: `44517`, `44518`, `44519`, `44777`.                                                                |
| Live voice has no reply            | Text replies need a valid OpenAI key and a model your account can use (`OPENAI_MODEL`). Spoken audio output is not implemented.     |
| Audio deprecation warning          | The current recorder uses `ScriptProcessorNode`; migration to AudioWorklet remains future work.                                    |
