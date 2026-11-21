import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getImageModel, getVideoModel } from '@shared/higgsfield'
import type { AppSettings, ProviderDef, ProviderRole, RoleSettings } from '@shared/types'
import { getDb } from './db'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultTtsProvider: 'gemini',
  defaultLanguage: 'id',
  exportFolder: null,
  whisperAuto: true,
  higgsfieldConcurrency: 3,
  flow2apiConcurrency: 2,
  imageGenerationMode: 'final',
  storyStyleProfiles: [],

  providers: {
    llm: {
      activeId: 'gemini',
      models: {
        gemini: { llm: 'gemini-3.8-flash' },
        openrouter: { llm: 'meta-llama/llama-3.3-70b-instruct' },
        groq: { llm: 'llama-3.3-70b-versatile' },
        custom: { llm: '' }
      }
    },
    tts: {
      activeId: 'gemini',
      models: {
        gemini: { tts: 'gemini-3.8-flash-tts' },
        elevenlabs: { tts: 'eleven_multilingual_v2' }
      }
    },
    visual: {
      activeId: 'flow2api',
      models: {
        higgsfield: { image: DEFAULT_IMAGE_MODEL, video: DEFAULT_VIDEO_MODEL },
        flow2api: { image: 'gemini-3.1-flash-image', video: 'veo-3.1-fast-i2v' }
      }
    }
  },
  customProviders: [],

  llmProvider: 'gemini',
  llmModels: { gemini: 'gemini-3.8-flash', openrouter: '', groq: '', custom: '' },
  customBaseUrl: '',
  geminiTtsModel: 'gemini-3.8-flash-tts',
  elevenModel: 'eleven_multilingual_v2',
  imageModel: DEFAULT_IMAGE_MODEL,
  videoModel: DEFAULT_VIDEO_MODEL,
  defaultVisualProvider: 'flow2api',
  flow2apiBaseUrl: 'http://localhost:8000/v1',
  flow2apiImageModel: 'gemini-3.1-flash-image',
  flow2apiVideoModel: 'veo-3.1-fast-i2v'
}

const clampConcurrency = (value: unknown, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const rawMap: Record<string, unknown> = {}
  for (const r of rows) {
    try {
      rawMap[r.key] = JSON.parse(r.value)
    } catch {
      // ignore malformed row
    }
  }

  const out: AppSettings = {
    ...DEFAULT_SETTINGS,
    providers: {
      llm: {
        activeId: DEFAULT_SETTINGS.providers.llm.activeId,
        models: { ...DEFAULT_SETTINGS.providers.llm.models }
      },
      tts: {
        activeId: DEFAULT_SETTINGS.providers.tts.activeId,
        models: { ...DEFAULT_SETTINGS.providers.tts.models }
      },
      visual: {
        activeId: DEFAULT_SETTINGS.providers.visual.activeId,
        models: { ...DEFAULT_SETTINGS.providers.visual.models }
      }
    },
    customProviders: []
  }

  if (typeof rawMap.theme === 'string' && ['light', 'dark', 'system'].includes(rawMap.theme)) {
    out.theme = rawMap.theme as AppSettings['theme']
  }
  if (typeof rawMap.defaultLanguage === 'string') out.defaultLanguage = rawMap.defaultLanguage
  if (rawMap.exportFolder === null || typeof rawMap.exportFolder === 'string') out.exportFolder = rawMap.exportFolder
  if (typeof rawMap.whisperAuto === 'boolean') out.whisperAuto = rawMap.whisperAuto
  out.higgsfieldConcurrency = clampConcurrency(rawMap.higgsfieldConcurrency, 4, DEFAULT_SETTINGS.higgsfieldConcurrency)
  out.flow2apiConcurrency = clampConcurrency(rawMap.flow2apiConcurrency, 3, DEFAULT_SETTINGS.flow2apiConcurrency)
  if (rawMap.imageGenerationMode === 'draft' || rawMap.imageGenerationMode === 'final') {
    out.imageGenerationMode = rawMap.imageGenerationMode
  }
  if (Array.isArray(rawMap.storyStyleProfiles)) {
    out.storyStyleProfiles = rawMap.storyStyleProfiles.filter(
      (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.guidance === 'string'
    )
  }

  if (Array.isArray(rawMap.customProviders)) {
    out.customProviders = rawMap.customProviders.filter(
      (p): p is ProviderDef => Boolean(p && typeof p.id === 'string' && typeof p.name === 'string')
    )
  }

  const legacyCustomBaseUrl = typeof rawMap.customBaseUrl === 'string' ? rawMap.customBaseUrl.trim() : ''
  if (legacyCustomBaseUrl && !out.customProviders.some((p) => p.id === 'custom')) {
    out.customProviders.unshift({
      id: 'custom',
      name: 'Endpoint custom',
      roles: ['llm'],
      kind: 'custom',
      protocol: 'openai-chat',
      note: 'Server apa pun yang kompatibel dengan OpenAI API, misalnya Ollama, LM Studio, vLLM, DeepSeek, atau xAI Grok.',
      baseUrl: legacyCustomBaseUrl
    })
  }

  if (rawMap.providers && typeof rawMap.providers === 'object') {
    const rawProviders = rawMap.providers as Record<string, Partial<RoleSettings>>
    for (const role of ['llm', 'tts', 'visual'] as ProviderRole[]) {
      if (rawProviders[role]) {
        if (typeof rawProviders[role]?.activeId === 'string' && rawProviders[role]!.activeId) {
          out.providers[role].activeId = rawProviders[role]!.activeId
        }
        if (rawProviders[role]?.models && typeof rawProviders[role]!.models === 'object') {
          out.providers[role].models = {
            ...out.providers[role].models,
            ...rawProviders[role]!.models
          }
        }
      }
    }
  } else {
    // Normalization from legacy fields
    if (typeof rawMap.llmProvider === 'string' && rawMap.llmProvider) {
      out.providers.llm.activeId = rawMap.llmProvider
    }
    if (rawMap.llmModels && typeof rawMap.llmModels === 'object') {
      const lm = rawMap.llmModels as Record<string, string>
      for (const [k, v] of Object.entries(lm)) {
        if (typeof v === 'string') {
          out.providers.llm.models[k] = { ...(out.providers.llm.models[k] || {}), llm: v }
        }
      }
    }
    if (typeof rawMap.defaultTtsProvider === 'string' && rawMap.defaultTtsProvider) {
      out.providers.tts.activeId = rawMap.defaultTtsProvider
    }
    if (typeof rawMap.geminiTtsModel === 'string') {
      out.providers.tts.models.gemini = { ...(out.providers.tts.models.gemini || {}), tts: rawMap.geminiTtsModel }
    }
    if (typeof rawMap.elevenModel === 'string') {
      out.providers.tts.models.elevenlabs = { ...(out.providers.tts.models.elevenlabs || {}), tts: rawMap.elevenModel }
    }
    if (typeof rawMap.defaultVisualProvider === 'string' && rawMap.defaultVisualProvider) {
      out.providers.visual.activeId = rawMap.defaultVisualProvider
    }
    if (typeof rawMap.imageModel === 'string') {
      out.providers.visual.models.higgsfield = {
        ...(out.providers.visual.models.higgsfield || {}),
        image: getImageModel(rawMap.imageModel).id
      }
    }
    if (typeof rawMap.videoModel === 'string') {
      out.providers.visual.models.higgsfield = {
        ...(out.providers.visual.models.higgsfield || {}),
        video: getVideoModel(rawMap.videoModel).id
      }
    }
    if (typeof rawMap.flow2apiImageModel === 'string') {
      out.providers.visual.models.flow2api = {
        ...(out.providers.visual.models.flow2api || {}),
        image: rawMap.flow2apiImageModel
      }
    }
    if (typeof rawMap.flow2apiVideoModel === 'string') {
      out.providers.visual.models.flow2api = {
        ...(out.providers.visual.models.flow2api || {}),
        video: rawMap.flow2apiVideoModel
      }
    }
  }

  // Populate legacy fields on out for backward compatibility
  out.llmProvider = out.providers.llm.activeId
  out.defaultTtsProvider = out.providers.tts.activeId
  out.defaultVisualProvider = out.providers.visual.activeId
  out.customBaseUrl = legacyCustomBaseUrl || out.customProviders.find((p) => p.id === 'custom')?.baseUrl || ''
  out.llmModels = Object.fromEntries(
    Object.entries(out.providers.llm.models).map(([k, v]) => [k, v?.llm || ''])
  )
  out.geminiTtsModel = out.providers.tts.models.gemini?.tts || 'gemini-3.8-flash-tts'
  out.elevenModel = out.providers.tts.models.elevenlabs?.tts || 'eleven_multilingual_v2'
  out.imageModel = out.providers.visual.models.higgsfield?.image || DEFAULT_IMAGE_MODEL
  out.videoModel = out.providers.visual.models.higgsfield?.video || DEFAULT_VIDEO_MODEL
  out.flow2apiBaseUrl = (rawMap.flow2apiBaseUrl as string) || 'http://localhost:8000/v1'
  out.flow2apiImageModel = out.providers.visual.models.flow2api?.image || 'gemini-3.1-flash-image'
  out.flow2apiVideoModel = out.providers.visual.models.flow2api?.video || 'veo-3.1-fast-i2v'

  return out
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  getDb().transaction(() => {
    let providersUpdated = false
    const nextProviders = {
      llm: { ...current.providers.llm, models: { ...current.providers.llm.models } },
      tts: { ...current.providers.tts, models: { ...current.providers.tts.models } },
      visual: { ...current.providers.visual, models: { ...current.providers.visual.models } }
    }

    if (patch.providers && typeof patch.providers === 'object') {
      for (const [role, rolePatch] of Object.entries(patch.providers)) {
        if (!rolePatch) continue
        const rKey = role as ProviderRole
        const existingRole = nextProviders[rKey]
        const mergedModels = { ...existingRole.models }
        if (rolePatch.models) {
          for (const [pId, pModels] of Object.entries(rolePatch.models)) {
            mergedModels[pId] = { ...(mergedModels[pId] || {}), ...pModels }
          }
        }
        nextProviders[rKey] = {
          activeId: rolePatch.activeId ?? existingRole.activeId,
          models: mergedModels
        }
      }
      providersUpdated = true
    }

    // Handle legacy patch sync to providers
    if (patch.defaultVisualProvider && patch.defaultVisualProvider !== current.providers.visual.activeId) {
      nextProviders.visual.activeId = patch.defaultVisualProvider
      providersUpdated = true
    }
    if (patch.llmProvider && patch.llmProvider !== current.providers.llm.activeId) {
      nextProviders.llm.activeId = patch.llmProvider
      providersUpdated = true
    }
    if (patch.defaultTtsProvider && patch.defaultTtsProvider !== current.providers.tts.activeId) {
      nextProviders.tts.activeId = patch.defaultTtsProvider
      providersUpdated = true
    }
    if (patch.flow2apiImageModel) {
      nextProviders.visual.models.flow2api = {
        ...(nextProviders.visual.models.flow2api || {}),
        image: patch.flow2apiImageModel
      }
      providersUpdated = true
    }
    if (patch.flow2apiVideoModel) {
      nextProviders.visual.models.flow2api = {
        ...(nextProviders.visual.models.flow2api || {}),
        video: patch.flow2apiVideoModel
      }
      providersUpdated = true
    }

    if (providersUpdated) {
      stmt.run('providers', JSON.stringify(nextProviders))
    }

    for (const [k, v] of Object.entries(patch)) {
      if (k === 'providers') continue
      if (k === 'customProviders') {
        stmt.run('customProviders', JSON.stringify(v))
        continue
      }
      let value: unknown = v
      if (k === 'llmModels') value = { ...current.llmModels, ...(v as object) }
      if (k === 'higgsfieldConcurrency') value = clampConcurrency(v, 4, current.higgsfieldConcurrency)
      if (k === 'flow2apiConcurrency') value = clampConcurrency(v, 3, current.flow2apiConcurrency)
      if (k === 'imageGenerationMode' && v !== 'draft' && v !== 'final') value = current.imageGenerationMode
      stmt.run(k, JSON.stringify(value))
    }
  })()
  return getSettings()
}

// ---------- small key/value cache (model lists) ----------

export function readCache<T>(key: string): { value: T; updatedAt: number } | null {
  const row = getDb().prepare('SELECT value, updated_at FROM cache WHERE key = ?').get(key) as
    | { value: string; updated_at: number }
    | undefined
  return row ? { value: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null
}

export function writeCache(key: string, value: unknown): number {
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), now)
  return now
}

export function dropCache(prefix: string): void {
  getDb().prepare('DELETE FROM cache WHERE key LIKE ?').run(`${prefix}%`)
}
