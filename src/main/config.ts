import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'

export interface HistoryItem {
  id: string
  timestamp: number
  text: string
  durationMs: number
}

export interface ComputerUseConfig {
  mode: 'ask' | 'my-computer' | 'detached' | 'auto'
  maxAgents: number
  execution: 'sequential' | 'parallel'
  askBeforeSensitive: boolean
  showActivity: boolean
  allowAgentComms: boolean
}

export interface AppConfig {
  hasOpenedDashboard?: boolean
  openaiApiKey: string
  apiUrl: string
  language: string
  /** Transcripts recorded by older dictation builds; retained, no longer written. */
  history: HistoryItem[]
  computerUse: ComputerUseConfig
}

export const DEFAULT_COMPUTER_USE: ComputerUseConfig = {
  mode: 'auto',
  maxAgents: 3,
  execution: 'parallel',
  askBeforeSensitive: true,
  showActivity: true,
  allowAgentComms: true
}

/** OpenAI batch speech-to-text endpoint (accepts multipart audio uploads). */
export const DEFAULT_STT_URL = 'https://api.openai.com/v1/audio/transcriptions'

/** Never send an OpenAI key to a saved legacy or custom endpoint. */
function normalizeApiUrl(): string {
  return DEFAULT_STT_URL
}

function loadEnvFile(): void {
  const envPaths = [
    join(process.cwd(), '.env'),
    join(app.getAppPath(), '.env'),
    join(__dirname, '../../.env')
  ]

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf-8')
        content.split(/\r?\n/).forEach((line) => {
          const trimmed = line.trim()
          if (trimmed && !trimmed.startsWith('#')) {
            const idx = trimmed.indexOf('=')
            if (idx > 0) {
              const key = trimmed.substring(0, idx).trim()
              const val = trimmed
                .substring(idx + 1)
                .trim()
                .replace(/^["']|["']$/g, '')
              process.env[key] = val
            }
          }
        })
        console.log(`Loaded environment variables from ${envPath}`)
        break
      } catch (err) {
        console.warn('Failed to parse .env file:', err)
      }
    }
  }
}

class ConfigManager {
  private configPath: string
  private config: AppConfig

  constructor() {
    loadEnvFile()
    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    this.configPath = join(userDataPath, 'astron_config.json')
    // One-time migration from the previous product name so saved settings
    // (including the API token) survive the rename.
    const legacyPath = join(userDataPath, 'wisprflow_config.json')
    if (!existsSync(this.configPath) && existsSync(legacyPath)) {
      try {
        // Validate before adopting: an old instance may still be writing the
        // legacy file, and a torn copy must never become the live config.
        JSON.parse(readFileSync(legacyPath, 'utf-8').replace(/^\uFEFF/, ''))
        copyFileSync(legacyPath, this.configPath)
        console.log('Migrated legacy wisprflow_config.json to astron_config.json')
      } catch (err) {
        console.warn('Could not migrate legacy config file:', err)
      }
    }
    this.config = this.load()
  }

  private load(): AppConfig {
    const envKey = process.env.OPENAI_API_KEY?.trim() || process.env.GPT_API_KEY?.trim() || ''
    const envLang = process.env.OPENAI_LANGUAGE || 'en'

    const defaultConfig: AppConfig = {
      openaiApiKey: envKey,
      apiUrl: normalizeApiUrl(),
      language: envLang,
      history: [],
      computerUse: { ...DEFAULT_COMPUTER_USE }
    }

    try {
      if (existsSync(this.configPath)) {
        // Strip a UTF-8 BOM: files edited in Notepad would otherwise fail to parse
        // and silently drop the saved token.
        const data = readFileSync(this.configPath, 'utf-8').replace(/^\uFEFF/, '')
        const parsed = JSON.parse(data) as Partial<AppConfig>
        // Allow-list the known fields: history and preferences survive, while a
        // credential saved by a previous provider can never be adopted or written back.
        return {
          openaiApiKey: parsed.openaiApiKey?.trim() || envKey,
          apiUrl: normalizeApiUrl(),
          language: parsed.language || envLang,
          history: Array.isArray(parsed.history) ? parsed.history : defaultConfig.history,
          computerUse: { ...DEFAULT_COMPUTER_USE, ...(parsed.computerUse || {}) },
          hasOpenedDashboard: parsed.hasOpenedDashboard
        }
      }
    } catch (err) {
      console.error('Failed to load config file, using defaults:', err)
    }
    return defaultConfig
  }

  public get(): AppConfig {
    // If no key was saved, fall back to the OpenAI environment credentials.
    if (!this.config.openaiApiKey) {
      this.config.openaiApiKey =
        process.env.OPENAI_API_KEY?.trim() || process.env.GPT_API_KEY?.trim() || ''
    }
    return { ...this.config }
  }

  public save(newConfig: Partial<AppConfig>): AppConfig {
    const merged = { ...this.config, ...newConfig }
    this.config = {
      ...merged,
      apiUrl: normalizeApiUrl()
    }
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save config file:', err)
    }
    return { ...this.config }
  }

}


export const configManager = new ConfigManager()
