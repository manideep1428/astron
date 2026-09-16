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
