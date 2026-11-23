import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from './higgsfield'
import type {
  AppSettings,
  Project,
  ModelPurpose,
  ProviderDef,
  ProviderRole
} from './types'

export type {
  ModelPurpose,
  ProviderDef,
  ProviderKind,
  ProviderLogoId,
  ProviderProtocol,
  ProviderRole,
  RoleSettings
} from './types'

export const PRESET_PROVIDERS: ProviderDef[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    roles: ['llm', 'tts'],
    kind: 'preset',
    protocol: 'gemini',
    logo: 'gemini',
    note: 'Kunci ini dipakai bersama untuk menyusun cerita (LLM) dan suara narator (TTS).',
    docs: { link: 'https://aistudio.google.com/apikey', label: 'Google AI Studio' }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    roles: ['llm'],
    kind: 'preset',
    protocol: 'openai-chat',
    logo: 'openrouter',
    note: 'Satu kunci untuk ratusan model dari banyak penyedia, termasuk model gratis.',
    docs: { link: 'https://openrouter.ai/settings/keys', label: 'OpenRouter' },
    baseUrl: 'https://openrouter.ai/api/v1'
  },
  {
    id: 'groq',
    name: 'Groq',
    roles: ['llm'],
    kind: 'preset',
    protocol: 'openai-chat',
    logo: 'groq',
    note: 'Inferensi sangat cepat untuk model open-source seperti Llama, Qwen, dan GPT-OSS.',
    docs: { link: 'https://console.groq.com/keys', label: 'Groq Console' },
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    roles: ['tts'],
    kind: 'preset',
    protocol: 'elevenlabs',
    logo: 'elevenlabs',
    note: 'Suara narasi dan tokoh alami dengan intonasi emosional tinggi.',
    docs: { link: 'https://elevenlabs.io/app/speech-synthesis', label: 'ElevenLabs' }
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    roles: ['visual'],
    kind: 'preset',
    protocol: 'higgsfield',
    logo: 'higgsfield',
    note: 'Generate gambar dan video berbasis kredit dengan konsistensi karakter.',
    docs: { link: 'https://cloud.higgsfield.ai', label: 'Higgsfield Cloud' }
  },
  {
    id: 'flow2api',
    name: 'Flow2API',
    roles: ['visual'],
    kind: 'preset',
    protocol: 'flow2api',
    logo: 'flow2api',
    note: 'Server lokal atau proxy untuk model video Veo dan gambar Flux/SDXL.',
    baseUrl: 'http://localhost:8000/v1',
    keyOptional: true
  }
]

export const RESERVED_PROVIDER_IDS = new Set([
  'gemini',
  'openrouter',
  'groq',
  'elevenlabs',
  'higgsfield',
  'flow2api',
  'custom',
  'system',
  'all',
  'none'
])

export const DEFAULT_PROVIDER_MODELS: Record<string, Partial<Record<ModelPurpose, string>>> = {
  gemini: { llm: 'gemini-3.8-flash', tts: 'gemini-3.8-flash-tts' },
  openrouter: { llm: 'meta-llama/llama-3.3-70b-instruct' },
  groq: { llm: 'llama-3.3-70b-versatile' },
  custom: { llm: '' },
  elevenlabs: { tts: 'eleven_multilingual_v2' },
  higgsfield: { image: DEFAULT_IMAGE_MODEL, video: DEFAULT_VIDEO_MODEL },
  flow2api: { image: 'gemini-3.1-flash-image', video: 'veo-3.1-fast-i2v' }
}

export function allProviders(custom: ProviderDef[] = []): ProviderDef[] {
  return [...PRESET_PROVIDERS, ...(custom || [])]
}

export function providersFor(role: ProviderRole, custom: ProviderDef[] = []): ProviderDef[] {
  return allProviders(custom).filter((p) => p.roles.includes(role))
}

export function providerById(id: string, custom: ProviderDef[] = []): ProviderDef | undefined {
  return allProviders(custom).find((p) => p.id === id)
}

export function providerRoles(id: string, custom: ProviderDef[] = []): ProviderRole[] {
  return providerById(id, custom)?.roles ?? []
}

/**
 * Resolves the currently active provider and model for a given purpose.
 * This is the SINGLE SOURCE OF TRUTH for model resolution across main and renderer.
 */
export function resolveActive(
  settings?: Partial<AppSettings> | null,
  purpose: ModelPurpose = 'llm'
): { provider: ProviderDef; model: string } {
  const role: ProviderRole = purpose === 'llm' ? 'llm' : purpose === 'tts' ? 'tts' : 'visual'
  const custom = settings?.customProviders ?? []
  const available = providersFor(role, custom)
  const roleSettings = settings?.providers?.[role]

  let provider = available.find((p) => p.id === roleSettings?.activeId)
  if (!provider) {
    if (role === 'visual') {
      // Default to flow2api if available, otherwise higgsfield
      provider = available.find((p) => p.id === 'flow2api') || available.find((p) => p.id === 'higgsfield') || available[0]
    } else {
      provider = available.find((p) => p.id === 'gemini') || available[0]
    }
  }
  if (!provider) {
    provider = PRESET_PROVIDERS[0]
  }

  const modelFromSettings = roleSettings?.models?.[provider.id]?.[purpose]
  // Custom providers (e.g. a custom Flow2API endpoint) inherit defaults from their protocol when unset.
  const defaultModel =
    DEFAULT_PROVIDER_MODELS[provider.id]?.[purpose] ||
    DEFAULT_PROVIDER_MODELS[provider.protocol]?.[purpose] ||
    ''
  const model = modelFromSettings && modelFromSettings.trim() ? modelFromSettings.trim() : defaultModel

  return { provider, model }
}

/**
 * The project as text-to-speech sees it: the TTS provider is the global one from Pengaturan › Model aktif
 * (projects.tts_provider is no longer read to choose it). The narrator voice stays creative data of the project,
 * but a voice id only means something to the provider it was picked for, so when the global provider differs
 * the voice is dropped and the provider's default narrator is used.
 */
export function withActiveTts<P extends Pick<Project, 'ttsProvider' | 'ttsVoice'>>(project: P, settings?: Partial<AppSettings> | null): P {
  if (!settings) return project
  const active = resolveActive(settings, 'tts').provider.id as Project['ttsProvider']
  if (active === project.ttsProvider) return project
  return { ...project, ttsProvider: active, ttsVoice: '' }
}
