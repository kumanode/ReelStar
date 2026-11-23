import type { Character, Clip, LlmProvider, Project } from './types'

export const LLM_PROVIDERS: { id: LlmProvider; name: string; note: string; link: string | null; linkLabel: string }[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    note: 'Kunci ini juga dipakai untuk suara narator Gemini TTS.',
    link: 'https://aistudio.google.com/apikey',
    linkLabel: 'Buat kunci di Google AI Studio'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    note: 'Satu kunci untuk ratusan model dari banyak penyedia, termasuk model gratis.',
    link: 'https://openrouter.ai/settings/keys',
    linkLabel: 'Buat kunci di OpenRouter'
  },
  {
    id: 'groq',
    name: 'Groq',
    note: 'Inferensi sangat cepat untuk model open-source seperti Llama, Qwen, dan GPT-OSS.',
    link: 'https://console.groq.com/keys',
    linkLabel: 'Buat kunci di console Groq'
  },
  {
    id: 'custom',
    name: 'Endpoint custom',
    note: 'Server apa pun yang kompatibel dengan OpenAI API, misalnya Ollama, LM Studio, vLLM, DeepSeek, atau xAI Grok.',
    link: null,
    linkLabel: ''
  }
]

export function llmName(id: LlmProvider): string {
  return LLM_PROVIDERS.find((p) => p.id === id)?.name ?? id
}

/** Higgsfield image and video models live in ./higgsfield.ts, generated from the API docs. */

/**
 * Gemini 3.8 TTS Voice Library voices that ship with a sample in the app (assets/voices/<id>.mp3). Used
 * when the live voice list cannot be fetched; the tone comes from each sample's persona.
 */
export const GEMINI_LIBRARY_VOICES: { id: string; name: string; tone: string }[] = [
  { id: 'en-us-arlo', name: 'Arlo', tone: 'asisten pribadi' },
  { id: 'en-us-bodi', name: 'Bodi', tone: 'pengajar sastra' },
  { id: 'en-us-brio', name: 'Brio', tone: 'pembaca berita bisnis' },
  { id: 'en-us-cruz', name: 'Cruz', tone: 'penasihat keuangan' },
  { id: 'en-us-daro', name: 'Daro', tone: 'layanan pelanggan, empatik' },
  { id: 'en-us-elio', name: 'Elio', tone: 'formal, resmi' },
  { id: 'en-us-enya', name: 'Enya', tone: 'pemandu teknis' },
  { id: 'en-us-enzo', name: 'Enzo', tone: 'pencerita petualangan' },
  { id: 'en-us-finn', name: 'Finn', tone: 'asisten pribadi' },
  { id: 'en-us-fola', name: 'Fola', tone: 'layanan pelanggan' },
  { id: 'en-us-gero', name: 'Gero', tone: 'hangat, menenangkan' },
  { id: 'en-us-hali', name: 'Hali', tone: 'layanan pelanggan' },
  { id: 'en-us-jett', name: 'Jett', tone: 'pemandu teknis' },
  { id: 'en-us-lora', name: 'Lora', tone: 'concierge elegan' },
  { id: 'en-us-ludo', name: 'Ludo', tone: 'pengajar teknologi' },
  { id: 'en-us-lumi', name: 'Lumi', tone: 'pengajar sastra' },
  { id: 'en-us-mako', name: 'Mako', tone: 'presentasi produk' },
  { id: 'en-us-neno', name: 'Neno', tone: 'lembut, pendengar' },
  { id: 'en-us-nika', name: 'Nika', tone: 'lembut, pendengar' },
  { id: 'en-us-nyla', name: 'Nyla', tone: 'pemandu teknis' },
  { id: 'en-us-rami', name: 'Rami', tone: 'pembaca berita' },
  { id: 'en-us-riko', name: 'Riko', tone: 'pencerita fantasi' },
  { id: 'en-us-rina', name: 'Rina', tone: 'hangat, menenangkan' },
  { id: 'en-us-tari', name: 'Tari', tone: 'tenang, menenangkan' },
  { id: 'en-us-tavi', name: 'Tavi', tone: 'concierge elegan' },
  { id: 'en-us-tova', name: 'Tova', tone: 'formal, resmi' },
  { id: 'en-us-varo', name: 'Varo', tone: 'pengajar matematika' },
  { id: 'en-us-veda', name: 'Veda', tone: 'pembaca berita' },
  { id: 'en-us-zali', name: 'Zali', tone: 'dramatis, fantasi gelap' },
  { id: 'en-us-zeno', name: 'Zeno', tone: 'pembawa acara' }
]

/** Tone of any Gemini voice we know, by id. */
export function geminiVoiceTone(id: string): string | undefined {
  return GEMINI_LIBRARY_VOICES.find((v) => v.id === id)?.tone ?? GEMINI_VOICES.find((v) => v.id === id)?.tone
}

export function geminiVoiceName(id: string): string {
  return GEMINI_LIBRARY_VOICES.find((v) => v.id === id)?.name ?? id
}

// Voice genders follow Google's Gemini TTS voice list; auto-cast speakers draw from these pools.
export const FEMALE_GEMINI_VOICES = [
  'Kore',
  'Aoede',
  'Leda',
  'Despina',
  'Callirrhoe',
  'Zephyr',
  'Autonoe',
  'Sulafat',
  'Erinome',
  'Laomedeia',
  'Achernar',
  'Gacrux',
  'Pulcherrima',
  'Vindemiatrix'
]

export const MALE_GEMINI_VOICES = [
  'Fenrir',
  'Orus',
  'Charon',
  'Puck',
  'Alnilam',
  'Schedar',
  'Achird',
  'Iapetus',
  'Rasalgethi',
  'Zubenelgenubi',
  'Sadaltager',
  'Sadachbia',
  'Algieba',
  'Algenib',
  'Umbriel',
  'Enceladus'
]

export function geminiVoiceGender(id: string): 'female' | 'male' | undefined {
  if (FEMALE_GEMINI_VOICES.includes(id)) return 'female'
  if (MALE_GEMINI_VOICES.includes(id)) return 'male'
  return undefined
}

/** Parses an explicit gender label (e.g. from Lorebook profile.visual.gender or ElevenLabs labels.gender). */
export function parseGenderText(raw?: string | null): 'female' | 'male' | 'unknown' {
  const text = (raw ?? '').trim().toLowerCase()
  if (!text) return 'unknown'
  if (/^(f|p|female|perempuan|wanita|cewek|woman|girl)$/i.test(text)) return 'female'
  if (/^(m|l|male|laki-?laki|laki|pria|cowok|man|boy)$/i.test(text)) return 'male'
  if (/\b(perempuan|wanita|female|woman|girl|cewek)\b/i.test(text)) return 'female'
  if (/\b(laki-?laki|pria|male|man|boy|cowok)\b/i.test(text)) return 'male'
  return 'unknown'
}

/**
 * Guesses a character's gender from their name and their own description. Only pass text about that
 * character: a scene note that mentions someone else ("Budi hugs his mother") would skew the guess.
 * Neutral kinship words (saudara, kakak, adik) are left out on purpose.
 */
export function detectGender(name: string, description = ''): 'female' | 'male' | 'unknown' {
  const text = `${name} ${description}`.toLowerCase()
  const femaleMatches =
    text.match(
      /\b(female|woman|women|girl|mother|mom|sister|daughter|wife|lady|queen|princess|witch|waitress|actress|heroine|perempuan|wanita|cewek|gadis|ibu|bunda|mama|istri|janda|putri|ratu|nenek|oma|tante|mbak|teh|nyonya|nona|saudari)\b/g
    ) || []
  const maleMatches =
    text.match(
      /\b(male|man|men|boy|father|dad|brother|son|husband|lord|king|prince|wizard|actor|hero|laki-?laki|pria|cowok|ayah|bapak|papa|suami|duda|pangeran|raja|kakek|opa|paman|om|mas|bang|kang|tuan)\b/g
    ) || []

  if (femaleMatches.length > maleMatches.length) return 'female'
  if (maleMatches.length > femaleMatches.length) return 'male'

  const trimmed = name.trim().toLowerCase()
  if (/^(ibu|bu|bunda|mbak|teh|ny\.|nona|mama|tante|oma)\b/.test(trimmed)) return 'female'
  if (/^(pak|bapak|mas|kang|om|tn\.|tuan|papa|bang|opa)\b/.test(trimmed)) return 'male'

  return 'unknown'
}

/**
 * Detects a Lorebook character's gender, preferring their explicit `profile.visual.gender` before falling
 * back to name, aliases, and description clues.
 */
export function detectCharacterGender(
  c: Pick<Character, 'name' | 'description' | 'profile'> & { aliases?: string[] }
): 'female' | 'male' | 'unknown' {
  const fromProfile = parseGenderText(c.profile?.visual?.gender)
  if (fromProfile !== 'unknown') return fromProfile
  const extra = [
    c.description,
    ...(c.aliases ?? []),
    c.profile?.visual?.face,
    c.profile?.visual?.hair,
    c.profile?.visual?.body,
    c.profile?.visual?.defaultOutfit,
    c.profile?.narrative?.role
  ]
    .filter(Boolean)
    .join(' ')
  return detectGender(c.name, extra)
}

/**
 * Resolves the TTS voice for a clip (shared by narration, single-clip TTS, and audio basis-hash validation):
 * 1. Explicit character voice matching the active TTS provider.
 * 2. When using Gemini and the speaker has no manual voice yet, deterministically picks a female or male
 *    Gemini voice based on the character's detected gender (avoiding the narrator and other cast voices).
 * 3. Falls back to the project's narrator voice.
 */
export function resolveClipTtsVoice(
  clip: Pick<Clip, 'speakerId'>,
  characters: Pick<Character, 'id' | 'name' | 'description' | 'aliases' | 'profile' | 'ttsVoice' | 'ttsProvider' | 'sort'>[],
  project: Pick<Project, 'ttsProvider' | 'ttsVoice'>
): string {
  const defaultVoice = project.ttsVoice || (project.ttsProvider === 'gemini' ? 'Charon' : '')
  if (!clip.speakerId) return defaultVoice
  const char = characters.find((c) => c.id === clip.speakerId)
  if (!char) return defaultVoice
  if (char.ttsVoice && char.ttsProvider === project.ttsProvider) return char.ttsVoice

  if (project.ttsProvider === 'gemini') {
    const gender = detectCharacterGender(char)
    if (gender === 'female' || gender === 'male') {
      const pool = gender === 'female' ? FEMALE_GEMINI_VOICES : MALE_GEMINI_VOICES
      const used = new Set<string>([defaultVoice])
      for (const other of characters) {
        if (other.id !== char.id && other.ttsVoice && other.ttsProvider === 'gemini') used.add(other.ttsVoice)
      }
      // Assign deterministically in cast order so two same-gender characters without manual voices stay distinct.
      const sameGenderAuto = characters
        .filter(
          (other) =>
            !(other.ttsVoice && other.ttsProvider === 'gemini') && detectCharacterGender(other) === gender
        )
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id.localeCompare(b.id))
      const available = pool.filter((v) => !used.has(v))
      const pickPool = available.length ? available : pool.filter((v) => v !== defaultVoice)
      const list = pickPool.length ? pickPool : pool
      const idx = Math.max(0, sameGenderAuto.findIndex((other) => other.id === char.id))
      return list[idx % list.length]
    }
  }

  return defaultVoice
}

/** The 30 classic prebuilt voices. */
export const GEMINI_VOICES: { id: string; tone: string }[] = [
  { id: 'Charon', tone: 'informatif' },
  { id: 'Kore', tone: 'tegas' },
  { id: 'Puck', tone: 'ceria' },
  { id: 'Zephyr', tone: 'cerah' },
  { id: 'Fenrir', tone: 'bersemangat' },
  { id: 'Leda', tone: 'muda' },
  { id: 'Orus', tone: 'tegas' },
  { id: 'Aoede', tone: 'santai' },
  { id: 'Callirrhoe', tone: 'santai' },
  { id: 'Autonoe', tone: 'cerah' },
  { id: 'Enceladus', tone: 'berbisik' },
  { id: 'Iapetus', tone: 'jernih' },
  { id: 'Umbriel', tone: 'santai' },
  { id: 'Algieba', tone: 'halus' },
  { id: 'Despina', tone: 'halus' },
  { id: 'Erinome', tone: 'jernih' },
  { id: 'Algenib', tone: 'serak' },
  { id: 'Rasalgethi', tone: 'informatif' },
  { id: 'Laomedeia', tone: 'ceria' },
  { id: 'Achernar', tone: 'lembut' },
  { id: 'Alnilam', tone: 'tegas' },
  { id: 'Schedar', tone: 'stabil' },
  { id: 'Gacrux', tone: 'dewasa' },
  { id: 'Pulcherrima', tone: 'lugas' },
  { id: 'Achird', tone: 'ramah' },
  { id: 'Zubenelgenubi', tone: 'kasual' },
  { id: 'Vindemiatrix', tone: 'lembut' },
  { id: 'Sadachbia', tone: 'hidup' },
  { id: 'Sadaltager', tone: 'berwawasan' },
  { id: 'Sulafat', tone: 'hangat' }
]

export const LANGUAGES: { code: string; label: string; english: string }[] = [
  { code: 'id', label: 'Indonesia', english: 'Indonesian' },
  { code: 'en', label: 'English', english: 'English' },
  { code: 'ms', label: 'Melayu', english: 'Malay' },
  { code: 'jv', label: 'Jawa', english: 'Javanese' },
  { code: 'su', label: 'Sunda', english: 'Sundanese' },
  { code: 'es', label: 'Español', english: 'Spanish' },
  { code: 'ar', label: 'العربية', english: 'Arabic' }
]

export const DURATIONS: { sec: number; label: string }[] = [
  { sec: 30, label: '30 detik' },
  { sec: 60, label: '1 menit' },
  { sec: 180, label: '3 menit' },
  { sec: 300, label: '5 menit' },
  { sec: 600, label: '10 menit' },
  { sec: 900, label: '15 menit' },
  { sec: 1200, label: '20 menit' },
  { sec: 1500, label: '25 menit' },
  { sec: 1800, label: '30 menit' }
]

/** Short videos use tighter cuts; long stories need fewer, longer scenes to keep production manageable. */
export function clipCountFor(durationSec: number): number {
  const secondsPerScene = durationSec > 600 ? 8 : 5.5
  return Math.max(3, Math.min(230, Math.round(durationSec / secondsPerScene)))
}
