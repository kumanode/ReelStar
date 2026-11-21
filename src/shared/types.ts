export type LockWordSource = 'character' | 'costume' | 'location' | 'prop' | 'manual'

export interface LockWord {
  id: string
  label: string
  text: string
  source: LockWordSource
  sourceId?: string
  enabled: boolean
}

export type ProjectStatus = 'draft' | 'script' | 'storyboard' | 'editing' | 'exported'
export type SourceKind = 'novel' | 'screenplay'
export type DialogAudio = 'video' | 'tts'
export type EpisodeStatus = 'draft' | 'planned' | 'script' | 'storyboard' | 'editing' | 'exported'
export type ResultStatus = 'current' | 'stale' | 'missing' | 'blocked'
export type AspectRatio = '16:9' | '9:16'
export type ProviderId = string
export type VisualProvider = ProviderId
export type TtsProvider = ProviderId
export type LlmProvider = ProviderId
export type ApiProvider = ProviderId
/** Where a live model list comes from: an LLM provider, or a TTS catalog. */
export type ModelSource = ProviderId
export type MotionType = 'camera' | 'video'
export type CameraPresetId = 'zoomin' | 'zoomout' | 'panleft' | 'panright' | 'kenburns' | 'shake' | 'static'
export type MotionStrength = 'halus' | 'sedang' | 'kuat'
export type TransitionId = 'cut' | 'fade' | 'slideleft' | 'zoomin' | 'dipblack' | 'dissolve' | 'wipeleft' | 'wiperight'
export type FilterId = 'normal' | 'warm' | 'cold' | 'cyberpunk' | 'noir' | 'vintage'
export type CaptionStyleId =
  | 'karaoke'
  | 'tebal'
  | 'minimal'
  | 'subtitle'
  | 'hormozi'
  | 'wordpill'
  | 'crimson'
  | 'ghostmist'
  | 'ritual'
  | 'none'
export type CaptionPosition = 'atas' | 'tengah' | 'bawah'
export type CaptionSize = 'kecil' | 'sedang' | 'besar'
/** 1 idea, 2 script, 3 storyboard, 4 editor */
export type Step = 1 | 2 | 3 | 4

export interface CameraCustomFraming {
  start: { x: number; y: number; zoom: number }
  end: { x: number; y: number; zoom: number }
}

export interface SfxItem {
  id: string
  assetId: string
  name: string
  startMs: number
  durationMs: number
  inMs?: number
  volumeDb?: number
  /** Placed by "SFX otomatis"; running it again replaces these and keeps the ones placed by hand. */
  auto?: boolean
}

export interface BuiltinSfx {
  id: string
  name: string
  fileName: string
  durationMs: number
  description: string
}

export interface SmartSfxCue {
  clipId: string
  timeOffsetSec: number
  name: string
  prompt: string
  durationSec: number
  volumeDb: number
}

export interface EditorSettings {
  captionStyle: CaptionStyleId
  captionPosition: CaptionPosition
  captionSize: CaptionSize
  /** Caption size as a multiple of the style's size (0.5–1.8); overrides captionSize when set. */
  captionScale?: number
  /** Custom look on top of the chosen caption style; unset fields keep the style's own. */
  captionFont?: string
  captionColor?: string
  captionHighlight?: string
  /** Box behind the caption: a color and opacity, or null for no box. */
  captionBg?: { color: string; opacity: number } | null
  musicAssetId: string | null
  musicVolumeDb: number
  duckMusic: boolean
  /** Color grading filter applied project-wide unless overridden per clip. */
  filter?: FilterId
  /** Custom Ken Burns camera framing per clip id. */
  clipFraming?: Record<string, CameraCustomFraming>
  /** Logos, watermarks and text placed over the video. */
  overlays: Overlay[]
  /** Volume change for all narration, in dB. */
  voiceVolumeDb?: number
  /** Background music on the timeline: from `musicStartMs` to `musicEndMs` (null: the end), `musicInMs` into the song. */
  musicStartMs?: number
  musicEndMs?: number | null
  musicInMs?: number
  /** Last prompt written for making background music in an outside AI (Suno, Udio, …). */
  musicPrompt?: MusicPrompt | null
  /** Sound effects (SFX) placed along the timeline. */
  sfx?: SfxItem[]
}

export interface YoutubeMetadata {
  titles: string[]
  description: string
  chapters: string
  hashtags: string[]
}

/** A thumbnail idea written for one chosen title, so the picture and the title sell the same promise. */
export interface ThumbnailConcept {
  title: string
  /** English image prompt: the scene only, without the text instructions added at generation time. */
  prompt: string
  /** Layout, lighting and emotion, in the video language, for the user to read. */
  composition: string
  /** 2–4 word text drawn on the thumbnail; complements the title rather than repeating it. */
  textHook: string
}

export interface ThumbnailRequest {
  title: string
  prompt: string
  textHook: string
  /** Draw `textHook` in the image; off leaves clean space for text added in another tool. */
  withText: boolean
  variation: number
}

export interface MusicPrompt {
  /** Suno "Style of Music": comma-separated English tags. */
  style: string
  /** Suno "Exclude styles". */
  exclude: string
  title: string
  /** One paragraph for other music AIs (Udio, ElevenLabs Music, Stable Audio, …). */
  description: string
  /** Why this music fits, in Indonesian, for the user. */
  reason: string
  /** Video length when it was written, in seconds. */
  durationSec: number
}

/**
 * Where an overlay sits: `anchor` is a numpad position on the overlay itself (7 top-left, 5 center,
 * 3 bottom-right, the same numbering as ASS n), and `x`/`y` place that point as a fraction of the frame.
 */
interface OverlayBase {
  id: string
  anchor: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  x: number
  y: number
  /** Seconds on the final timeline; `end` null means until the video ends. */
  start: number
  end: number | null
}

export interface ImageOverlay extends OverlayBase {
  kind: 'image'
  assetId: string
  /** Width as a fraction of the frame width. */
  width: number
  opacity: number
}

export type TextOverlayStyle = 'plain' | 'outline' | 'box'

export interface TextOverlay extends OverlayBase {
  kind: 'text'
  text: string
  /** Font size as a fraction of the frame height. */
  size: number
  color: string
  style: TextOverlayStyle
  bold: boolean
}

export type Overlay = ImageOverlay | TextOverlay

export interface Project {
  id: string
  title: string
  synopsis: string
  sourceText: string
  sourceKind: SourceKind
  dialogAudio: DialogAudio
  storyPlan: StoryPlan | null
  durationSec: number
  targetEpisodeCount?: number | null
  seriesGuidelines?: string
  promptTemplates?: Record<string, string>
  seriesLock?: LockWord[]
  language: string
  aspectRatio: AspectRatio
  styleId: string
  ttsProvider: TtsProvider
  ttsVoice: string
  /** Higgsfield endpoint ids; null falls back to the app default. */
  imageModel: string | null
  videoModel: string | null
  /** One of the video model's resolutions, e.g. "720p"; null or unsupported uses the default (1080p when offered). */
  videoResolution: string | null
  status: ProjectStatus
  step: Step
  coverAssetId: string | null
  editor: EditorSettings
  createdAt: number
  updatedAt: number
}

export interface Episode {
  id: string
  projectId: string
  episodeNum: number
  title: string
  summary: string
  hook: string
  storyBeats: string[]
  cliffhanger: string
  nextTeaser: string
  sourceText: string
  sourceKind: SourceKind | null
  sourceExcerpt?: string
  scriptDraft?: EpisodeScriptDraft | null
  lockWords?: LockWord[]
  status: EpisodeStatus
  durationSec: number
  sort: number
  editor: EditorSettings | null
  createdAt: number
  updatedAt: number
}

export interface EpisodeScriptDraft {
  shots: DraftShot[]
  newAssets: NewAssetProposal[]
  createdAt: number
}

export type DialogueType = 'dialogue' | 'os' | 'vo' | 'narration'
export type StoryBeatPhase = 'hook' | 'confrontation' | 'twist' | 'aftermath'

export interface ShotDetail {
  cameraMotion?: string
  cameraReason?: string
  lighting?: string
  blocking?: string
  nonSpeakingReaction?: string
  sfxAmbience?: string
  speechDelivery?: string
  dialogueType?: DialogueType
}

export interface DraftShot {
  title: string
  sourceExcerpt: string
  visualAction: string
  characters: string[]
  costumes: Record<string, string>
  location: string | null
  props: string[]
  speaker: string | null
  text: string
  emotion: string
  framing: string
  durationSec: number
  beat?: StoryBeatPhase
  shotDetail?: ShotDetail
  continueFromPrevious?: boolean
  referenceAssetIds?: string[] | null
}

export interface NewAssetProposal {
  kind: 'character' | 'derivative' | 'location' | 'prop'
  name: string
  description: string
  action: 'create' | 'merge' | 'derivative' | 'ignore'
  target?: string
  reason: string
}

export interface PlanEpisodesInput {
  projectId: string
  sourceText?: string
  sourceKind?: SourceKind
  targetDurationSec?: number
  targetEpisodeCount?: number
  /** replace: start over from the top of the source; continue: plan the part not yet covered. */
  mode?: 'replace' | 'continue'
}

export type ContinuityKind = 'foreshadow' | 'prop' | 'rule' | 'relationship'
export type ContinuityStatus = 'open' | 'paid' | 'dropped'
export type ContinuityTier = 'hot' | 'cold'

export interface ContinuityItem {
  id: string
  projectId: string
  kind: ContinuityKind
  name: string
  detail: string
  status: ContinuityStatus
  tier: ContinuityTier
  plantedEpisodeId: string
  payoffEpisodeId: string | null
  createdAt: number
}

export interface ScriptVersion {
  id: string
  episodeId: string
  draft: EpisodeScriptDraft
  note: string
  createdAt: number
}

export interface CharacterVisualProfile {
  age?: string
  gender?: string
  face?: string
  facialFeatures?: string
  hair?: string
  body?: string
  bodyType?: string
  defaultOutfit?: string
  distinguishingFeatures?: string
  distinctiveFeatures?: string
}

export interface CharacterNarrativeProfile {
  role?: string
  desire?: string
  secret?: string
  arc?: string
  speechPattern?: string
}

export interface CharacterProfile {
  visual?: CharacterVisualProfile
  narrative?: CharacterNarrativeProfile
  voiceStyle?: string
}

export interface LocationProfile {
  placeType?: string
  interiorExterior?: string
  lighting?: string
  timeOfDayLighting?: string
  atmosphere?: string
  architecturalStyle?: string
  fixedDetails?: string
  keyFeatures?: string
}

export interface PropProfile {
  shape?: string
  category?: string
  material?: string
  appearance?: string
  status?: string
  significance?: string
}

export interface CharacterDerivative {
  id: string
  projectId: string
  characterId: string
  name: string
  promptChange: string
  costumeKeyphrase?: string
  sheetAssetId: string | null
  sort: number
}

export interface Location {
  id: string
  projectId: string
  name: string
  description: string
  aliases: string[]
  profile?: LocationProfile
  sheetAssetId: string | null
  sort: number
}

export interface Prop {
  id: string
  projectId: string
  name: string
  description: string
  aliases: string[]
  profile?: PropProfile
  sheetAssetId: string | null
  sort: number
}

export interface CandidateCharacter {
  tempId: string
  name: string
  aliases: string[]
  description: string
  profile: CharacterProfile
  voiceStyle: string
}

export interface CandidateDerivative {
  tempId: string
  characterName: string
  name: string
  promptChange: string
  costumeKeyphrase: string
  episodeNums?: number[]
}

export interface CandidateLocation {
  tempId: string
  name: string
  aliases: string[]
  description: string
  profile: LocationProfile
}

export interface CandidateProp {
  tempId: string
  name: string
  aliases: string[]
  description: string
  profile: PropProfile
}

export interface LorebookExtractionResult {
  characters: CandidateCharacter[]
  derivatives: CandidateDerivative[]
  locations: CandidateLocation[]
  props: CandidateProp[]
}

export interface AcceptLorebookCandidatesInput {
  projectId: string
  acceptedCharacters: CandidateCharacter[]
  acceptedDerivatives: CandidateDerivative[]
  acceptedLocations: CandidateLocation[]
  acceptedProps: CandidateProp[]
}

export interface AssetUsageSummary {
  kind: 'character' | 'derivative' | 'location' | 'prop'
  id: string
  name: string
  episodes: { episodeId: string; episodeNum: number; title: string; count: number }[]
  totalCount: number
}

export interface MergeAssetInput {
  projectId: string
  kind: 'character' | 'location' | 'prop'
  sourceId: string
  targetId: string
  asVariant?: boolean
}

export interface StoryAct {
  title: string
  summary: string
  scenes: number
  /** Brief points this act is responsible for; optional because plans saved before briefs have none. */
  beats?: string[]
  keyDetail?: string
}

export type StoryStyleId = 'casual-education' | 'horror-folklore' | 'documentary' | 'fiction' | 'custom-example'

export interface StoryStyleProfile {
  id: string
  name: string
  guidance: string
  createdAt: number
}

export type StoryFormat = 'story' | 'list' | 'explainer' | 'documentary' | 'factcheck'
/** How strictly the writer treats truth: real facts, told belief (folklore, legends, horror), or invented fiction. */
export type StoryFactMode = 'factual' | 'folklore' | 'fiction'

/** What the creator actually wants delivered, read from the idea before any hook or outline is written. */
export interface StoryBrief {
  format: StoryFormat
  factMode: StoryFactMode
  tone: string
  angle: string
  mustCover: string[]
  avoid: string[]
}

export interface StoryPlan {
  hookMode: 'automatic' | 'manual'
  hookOptions: string[]
  hook: string
  title: string
  acts: StoryAct[]
  /** Optional so plans saved before briefs existed still load; the script step creates one when missing. */
  brief?: StoryBrief
  /** New story flow fields; optional so plans saved by older builds remain readable. */
  style?: StoryStyleId
  styleProfileId?: string
  question?: string
  opening?: string
  customOpening?: string
  closing?: string
  avoid?: string[]
  factMode?: StoryFactMode
  factsToVerify?: string[]
}

export interface Character {
  id: string
  projectId: string
  name: string
  description: string
  sheetAssetId: string | null
  sort: number
  ttsVoice?: string | null
  ttsProvider?: TtsProvider | null
  voiceStyle: string
  aliases: string[]
  profile?: CharacterProfile
}

/** A rewritten scene. speakerId null means the narrator voices it; newCharacter is a speaker the revision added. */
export interface SceneRevision {
  story: string
  narration: string
  speakerId: string | null
  newCharacter?: Character
}

export interface Clip {
  id: string
  projectId: string
  episodeId: string
  sort: number
  title: string
  /** What happens in the scene, in the script's language (the Naskah step). */
  story: string
  visualPrompt: string
  /** The story text the current visual plan was written from; null before any plan. */
  visualSource: string | null
  narration: string
  durationMs: number
  characterIds: string[]
  motionType: MotionType
  cameraPreset: CameraPresetId
  motionStrength: MotionStrength
  videoPrompt: string
  transition: TransitionId
  /** Camera move drawn over the AI video ('static' keeps the video as it is). */
  videoCamera: CameraPresetId
  videoStrength: MotionStrength
  /** Length of the transition into the next clip; null uses the default (0.4 s). */
  transitionMs: number | null
  /** Volume change for this clip's narration, in dB. */
  voiceGainDb: number
  /** Where the clip's video starts, in ms into the video file (trimmed from the left on the timeline). */
  mediaInMs: number
  /** The clip's voice trimmed to `voiceInMs`–`voiceOutMs` of its audio (null: to the end), placed `voiceStartMs` into the clip. */
  voiceInMs: number
  voiceOutMs: number | null
  voiceStartMs: number
  /** Character assigned to speak this scene; null uses the project narrator. */
  speakerId: string | null
  /** Color grading mood filter. */
  filter: FilterId
  imageAssetId: string | null
  videoAssetId: string | null
  audioAssetId: string | null
  emotion: string
  costumeIds: Record<string, string>
  locationId: string | null
  propIds: string[]
  framing: string
  sourceExcerpt: string
  shotDetail?: ShotDetail
  continueFromPrevious?: boolean
  referenceAssetIds?: string[] | null
}

export type AssetKind = 'image' | 'video' | 'audio' | 'music' | 'sfx' | 'overlay' | 'export'

export interface WordTiming {
  text: string
  start: number
  end: number
}

export interface AssetMeta {
  words?: WordTiming[]
  estimatedTimings?: boolean
  voice?: string
  [key: string]: unknown
}

export interface Asset {
  id: string
  projectId: string
  clipId: string | null
  characterId: string | null
  derivativeId: string | null
  locationId: string | null
  propId: string | null
  episodeId: string | null
  kind: AssetKind
  provider: string | null
  model: string | null
  prompt: string | null
  remoteId: string | null
  remoteUrl: string | null
  localPath: string
  url: string
  durationMs: number | null
  width: number | null
  height: number | null
  meta: AssetMeta
  createdAt: number
}

/** "narration" voices several scenes in one take and cuts it per scene. */
export type JobKind = 'story' | 'image' | 'sheet' | 'video' | 'tts' | 'narration' | 'align' | 'export'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface Job {
  id: string
  projectId: string
  episodeId: string | null
  clipId: string | null
  characterId: string | null
  kind: JobKind
  provider: string
  status: JobStatus
  progress: number
  message: string | null
  error: string | null
  resultAssetId: string | null
  createdAt: number
  updatedAt: number
}

export interface ProjectBundle {
  project: Project
  episode: Episode | null
  episodes: Episode[]
  characters: Character[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  clips: Clip[]
  assets: Asset[]
  jobs: Job[]
}

export interface ProjectSummary {
  id: string
  title: string
  styleId: string
  status: ProjectStatus
  step: Step
  clipCount: number
  totalMs: number
  coverUrl: string | null
  updatedAt: number
  aspectRatio: AspectRatio
  episodeCount: number
  exportedCount: number
  seriesGuidelines?: string
}

/** What the renderer sends on save. Asset links are owned by the main process and never overwritten by a save. */
export interface ProjectSnapshot {
  project: Omit<Project, 'createdAt' | 'updatedAt' | 'coverAssetId'>
  episodeId: string
  episodeEditor?: EditorSettings
  characters: Omit<Character, 'sheetAssetId'>[]
  clips: Omit<Clip, 'imageAssetId' | 'videoAssetId' | 'audioAssetId'>[]
}

export interface NewProjectInput {
  title?: string
  synopsis?: string
  durationSec?: number
  targetEpisodeCount?: number | null
  seriesGuidelines?: string
  promptTemplates?: Record<string, string>
  seriesLock?: LockWord[]
  sourceText?: string
  sourceKind?: SourceKind
  language?: string
  aspectRatio?: AspectRatio
  styleId?: string
  ttsProvider?: TtsProvider
  dialogAudio?: DialogAudio
  imageModel?: string
  videoModel?: string
}

export type ScriptDoctorSeverity = 'error' | 'warning' | 'info'

export interface ScriptDoctorIssue {
  code: string
  severity: ScriptDoctorSeverity
  shotIndex?: number
  title: string
  description: string
  suggestion?: string
}

export type PromptTemplateKey =
  | 'episode_planner'
  | 'script_draft'
  | 'lorebook_extract'
  | 'character_sheet'
  | 'derivative_sheet'
  | 'location_sheet'
  | 'prop_sheet'
  | 'visual_prompt'
  | 'video_prompt'
  | 'script_doctor'

export interface PromptTemplateDef {
  name: string
  description: string
  template: string
  placeholders?: string[]
}

export const DEFAULT_PROMPT_TEMPLATES: Record<PromptTemplateKey, PromptTemplateDef> = {
  episode_planner: {
    name: 'Perencana Episode',
    description: 'Instruksi sistem untuk memecah teks cerita sumber menjadi episode terstruktur.',
    template: 'You are an elite showrunner and director for viral vertical short drama series (9:16 format). Adapt the story into tightly paced episodes with opening hook, story beats, and cliffhanger.'
  },
  script_draft: {
    name: 'Penyusun Naskah Shot',
    description: 'Instruksi sistem untuk menyusun detail naskah shot-by-shot beserta proposal aset baru.',
    template: 'You are a master vertical short drama scriptwriter and director. Plan shot-by-shot scripts with intense expressions, strict character continuity, framing, blocking, lighting, and audio delivery.'
  },
  lorebook_extract: {
    name: 'Ekstraksi Lorebook',
    description: 'Instruksi sistem untuk mengekstrak tokoh, varian pakaian, latar lokasi, dan prop penting.',
    template: 'You are an expert story analyst and visual director specializing in worldbuilding bibles. Extract all recurring characters with visual and narrative profiles, costume variants, key locations, and memorable props.'
  },
  character_sheet: {
    name: 'Lembar Karakter',
    description: 'Prompt untuk lembar referensi karakter 3-sudut (depan, 3/4, samping).',
    template: 'Character reference sheet for "{name}": {description}. Show the SAME character three times side by side: front view, three-quarter view and side view, full body, neutral standing pose, on a plain light neutral background.',
    placeholders: ['name', 'description']
  },
  derivative_sheet: {
    name: 'Lembar Kostum Varian',
    description: 'Prompt untuk varian kostum atau dandanan karakter.',
    template: 'Character reference sheet variant for "{name}" ({variantName}). Base appearance: {description}. Costume change: {costumeChange}. Consistent face, hair, and costume in all three views matching the modification.',
    placeholders: ['name', 'variantName', 'description', 'costumeChange']
  },
  location_sheet: {
    name: 'Lembar Lokasi',
    description: 'Prompt untuk pemandangan lingkungan arsitektur / lanskap tanpa orang.',
    template: 'Location environment reference for "{name}": {description}. Clean architectural or landscape establishing shot, cinematic composition, NO people, NO characters, empty scenery, high detail, clear lighting.',
    placeholders: ['name', 'description']
  },
  prop_sheet: {
    name: 'Lembar Prop',
    description: 'Prompt untuk objek atau benda terisolasi studio.',
    template: 'Prop reference sheet for "{name}": {description}. Isolated studio shot of the single object, clean light neutral background, high detail, centered, NO people, NO hands holding it.',
    placeholders: ['name', 'description']
  },
  visual_prompt: {
    name: 'Prompt Gambar Shot',
    description: 'Template prompt gambar adegan per shot.',
    template: 'Structured scene prompt with setting, characters, wardrobe, props, framing, and art style.'
  },
  video_prompt: {
    name: 'Prompt Video Shot',
    description: 'Template prompt gerak video dan sinkronisasi dialog bibir.',
    template: 'Subject motion, camera movement, object interaction, and dialogue lip-sync.'
  },
  script_doctor: {
    name: 'Dokter Naskah',
    description: 'Pemeriksaan ritme, hook, cliffhanger, kontinuitas kostum, dan aturan drama pendek.',
    template: 'Analyze script draft for hook strength, cliffhanger payoff, talking-head monotony, and wardrobe continuity.'
  }
}

export interface KeyStatus {
  provider: ApiProvider
  configured: boolean
  lastOk: boolean | null
  lastMessage: string | null
  checkedAt: number | null
  /** Masked key for display, e.g. "sk-or-v1…9f3c". Null when there is no readable key. */
  preview: string | null
  /** A key is stored but can no longer be decrypted and must be entered again. */
  unreadable: boolean
}

export interface KeyTestResult {
  ok: boolean
  message: string
}

export interface VoiceOption {
  id: string
  name: string
  description: string
  previewUrl?: string | null
}

export type ThemePreference = 'system' | 'light' | 'dark'
export type ActiveTheme = 'light' | 'dark'

export type ProviderRole = 'llm' | 'tts' | 'visual'
export type ProviderKind = 'preset' | 'custom'
export type ModelPurpose = 'llm' | 'tts' | 'image' | 'video'
export type ProviderProtocol = 'gemini' | 'openai-chat' | 'elevenlabs' | 'higgsfield' | 'flow2api'
export type ProviderLogoId = 'gemini' | 'openrouter' | 'groq' | 'elevenlabs' | 'higgsfield' | 'flow2api' | 'custom'

export interface ProviderDef {
  id: string
  name: string
  roles: ProviderRole[]
  kind: ProviderKind
  protocol: ProviderProtocol
  logo?: ProviderLogoId
  note: string
  docs?: { link: string; label: string }
  baseUrl?: string
  keyOptional?: boolean
}

export interface RoleSettings {
  /** Penyedia aktif untuk peran ini, berlaku untuk semua proyek. */
  activeId: string
  /** Model per penyedia per tujuan, supaya berpindah penyedia tidak menghapus pilihan model penyedia lain. */
  models: Record<string, Partial<Record<ModelPurpose, string>>>
}

export interface AppSettings {
  theme: ThemePreference
  defaultTtsProvider: TtsProvider
  defaultLanguage: string
  exportFolder: string | null
  whisperAuto: boolean
  higgsfieldConcurrency: number
  flow2apiConcurrency: number
  imageGenerationMode: 'draft' | 'final'
  storyStyleProfiles: StoryStyleProfile[]

  providers: Record<ProviderRole, RoleSettings>
  customProviders: ProviderDef[]

  /** Legacy fields kept for backward compatibility during transition */
  llmProvider: LlmProvider
  llmModels: Record<string, string>
  customBaseUrl: string
  geminiTtsModel: string
  elevenModel: string
  imageModel: string
  videoModel: string
  defaultVisualProvider: VisualProvider
  flow2apiBaseUrl: string
  flow2apiImageModel: string
  flow2apiVideoModel: string
}

/** What one Higgsfield request would cost, from the API's estimate endpoint. */
export interface CreditEstimate {
  credits: number
  usd: number | null
}

export type ClipGenerationStatus = 'current' | 'stale' | 'missing' | 'blocked'

export interface BatchEstimateItem {
  clipId: string
  clipIndex: number
  title: string
  kind: 'image' | 'video'
  model: string
  status: ClipGenerationStatus
  blockers: string[]
  /** Higgsfield credits for this item; null when unknown or not paid in credits (Flow2API). */
  estimatedCredits: number | null
}

export interface BatchEstimateResult {
  canRun: boolean
  totalItems: number
  /** Null when any price is unknown or the provider does not charge credits (Flow2API). */
  totalCredits: number | null
  items: BatchEstimateItem[]
  blockedCount: number
  missingCount: number
  staleCount: number
}

export type SheetGenerationStatus = 'current' | 'stale' | 'missing' | 'blocked'

export interface BatchEstimateSheetItem {
  id: string
  name: string
  kind: 'character' | 'derivative' | 'location' | 'prop'
  model: string
  status: SheetGenerationStatus
  blockers: string[]
  estimatedCredits: number | null
}

export interface BatchEstimateSheetResult {
  canRun: boolean
  totalItems: number
  totalCredits: number | null
  items: BatchEstimateSheetItem[]
  blockedCount: number
  missingCount: number
  staleCount: number
}

export interface SeriesProgressSummary {
  totalEpisodes: number
  plannedEpisodes: number
  draftScriptEpisodes: number
  confirmedEpisodes: number
  totalAssets: number
  missingSheets: number
  totalClips: number
  missingClipImages: number
  missingClipVideos: number
}

export interface PlanBatchScriptsResult {
  plannedEpisodeIds: string[]
  skippedEpisodeIds: string[]
  failedEpisodes: { episodeId: string; title: string; error: string }[]
}

/** The local Whisper model used to time caption words. */
export interface WhisperStatus {
  state: 'missing' | 'downloading' | 'verifying' | 'ready'
  received: number
  total: number
  error: string | null
}

export interface StoryProgressEvent {
  projectId: string
  message: string
}

export interface ModelOption {
  id: string
  name: string
  description?: string
  contextLength?: number | null
  /** USD per 1M input / output tokens, when the provider publishes it. */
  priceIn?: number | null
  priceOut?: number | null
  /** Short labels the picker can filter on, e.g. "JSON", "Gratis", "Gambar". */
  tags: string[]
  /** Model family, e.g. "Kling", for a brand mark next to the name. */
  family?: string
  /** Higgsfield credits (and dollars) for one request; undefined while unknown, null when it cannot be estimated. */
  credits?: number | null
  usd?: number | null
  /** What the credits pay for, e.g. "10 dtk". */
  creditUnit?: string
}

export interface ModelList {
  models: ModelOption[]
  fetchedAt: number
}

export interface ExportOptions {
  episodeId?: string
  fileName: string
  resolution: 720 | 1080 | 2160
  fps: 30 | 60
  /** Optional so older saved export payloads continue to use CPU encoding. */
  encoder?: 'cpu' | 'nvenc'
  burnCaptions: boolean
  writeSrt: boolean
  normalizeAudio: boolean
  duckMusic: boolean
  folder: string
  presetId?: string
  videoBitrate?: string
}

export interface ClipPatchEvent {
  clipId: string
  patch: Partial<Clip>
}

export interface CharacterPatchEvent {
  characterId: string
  patch: Partial<Character>
}
