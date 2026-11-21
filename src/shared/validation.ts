import { FLOW2API_VIDEO_MODELS, getFlow2ApiModel } from './flow2api-catalog'
import { getImageModel, getVideoModel, maxRefs, modelSupportsNativeAudio } from './higgsfield'
import { collectReferenceSheets } from './prompts'
import {
  computeClipImageBasisHash,
  computeClipVideoBasisHash,
  computeClipTtsBasisHash,
  computeCharacterSheetBasisHash,
  computeDerivativeSheetBasisHash,
  computeLocationSheetBasisHash,
  computePropSheetBasisHash
} from './hash'
import { estimateNarrationMs } from './script'
import type {
  Asset,
  Character,
  CharacterDerivative,
  Clip,
  Episode,
  EpisodeScriptDraft,
  Job,
  Location,
  Project,
  Prop,
  ScriptDoctorIssue,
  SheetGenerationStatus
} from './types'

export const MIN_EPISODE_DURATION_SEC = 30
export const MAX_EPISODE_DURATION_SEC = 180
export const MAX_SERIES_DURATION_SEC = 3600 // 1 jam
export const DEFAULT_TARGET_EPISODE_COUNT = 3
export const MIN_TARGET_EPISODES = 1
export const MAX_TARGET_EPISODES = 20

export function calculateSeriesDuration(
  targetEpisodeCount: number | null | undefined,
  durationSec: number
): { totalEstimatedSec: number | null; isOverOneHour: boolean } {
  if (targetEpisodeCount == null || targetEpisodeCount <= 0) {
    return { totalEstimatedSec: null, isOverOneHour: false }
  }
  const totalEstimatedSec = targetEpisodeCount * durationSec
  return {
    totalEstimatedSec,
    isOverOneHour: totalEstimatedSec > MAX_SERIES_DURATION_SEC
  }
}

export const EPISODE_DURATION_OPTIONS = [
  { value: 45, label: '45 detik' },
  { value: 60, label: '60 detik (default)' },
  { value: 75, label: '75 detik' },
  { value: 90, label: '90 detik' },
  { value: 120, label: '120 detik (2 menit)' },
  { value: 150, label: '150 detik (2,5 menit)' },
  { value: 180, label: '180 detik (3 menit)' }
]

export type ClipGenerationStatus = 'current' | 'stale' | 'missing' | 'blocked'

export interface GenerationPrerequisitesContext {
  characters: Character[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  assets: Asset[] | Record<string, Asset>
  clips?: Clip[]
  activeJobs?: Job[]
  isFlow2Api?: boolean
  /** Flow2API image model from the app settings, used when the project names a Higgsfield model. */
  flow2apiImageModel?: string
  /** Flow2API video model from the app settings, used when the project names a Higgsfield model. */
  flow2apiVideoModel?: string
}

export interface PrerequisitesCheckResult {
  ok: boolean
  blockers: string[]
}

export interface ClipStatusResult {
  status: ClipGenerationStatus
  blockers: string[]
  basisHash: string
  /** True when the clip already has a result; a blocked clip with a result is not in the way of a batch. */
  hasResult: boolean
}

type ProjectModels = Pick<Project, 'imageModel' | 'videoModel'>

function findAsset(assets: Asset[] | Record<string, Asset>, id: string | null | undefined): Asset | null {
  if (!id) return null
  if (Array.isArray(assets)) return assets.find((a) => a.id === id) ?? null
  return assets[id] ?? null
}

/** Flow2API model ids never contain "/", Higgsfield ids always do; a Higgsfield id falls back to the settings. */
function flow2apiId(projectModel: string | null | undefined, fallback: string | undefined): string | null {
  return projectModel && !projectModel.includes('/') ? projectModel : fallback ?? null
}

/**
 * How many reference sheets the image model takes. Status and generation both read this, so the basis hash
 * of a fresh image always matches the one the storyboard computes.
 */
export function referenceLimit(project: ProjectModels, ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiImageModel'>): number {
  if (ctx.isFlow2Api) {
    const m = getFlow2ApiModel(flow2apiId(project.imageModel, ctx.flow2apiImageModel), 'image')
    return m.supportsRef ? m.maxRefs : 0
  }
  return maxRefs(getImageModel(project.imageModel))
}

/** Allowed video lengths in seconds, or null when the model takes any length. */
function videoDurations(project: ProjectModels, ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiVideoModel'>): number[] | { min: number; max: number } | null {
  if (ctx.isFlow2Api) {
    const id = (flow2apiId(project.videoModel, ctx.flow2apiVideoModel) ?? '')
      .trim()
      .replace(/-\d+s-(landscape|portrait)$/, '')
      .replace(/-(landscape|portrait)$/, '')
    const model = FLOW2API_VIDEO_MODELS.find((m) => m.id === id) ?? getFlow2ApiModel(null, 'video')
    return model.durations.length ? [...model.durations].sort((a, b) => a - b) : null
  }
  const d = getVideoModel(project.videoModel).durations
  if (!d) return null
  return 'values' in d ? [...d.values].sort((a, b) => a - b) : d
}

/**
 * The length to request for a clip's video: the shortest allowed length that covers the clip (and, for
 * dialogue spoken by the video model, the line), or the longest one. `fits` is false when even the longest
 * length is too short for the line.
 */
export function videoSecondsFor(
  project: ProjectModels & Pick<Project, 'dialogAudio'>,
  clip: Pick<Clip, 'durationMs' | 'speakerId' | 'narration'>,
  ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiVideoModel'>
): { seconds: number; longest: number; speechMs: number; fits: boolean } {
  const speechMs = isVideoDialogue(project, clip) ? estimateNarrationMs(clip.narration) : 0
  const want = Math.max(1, Math.ceil(Math.max(clip.durationMs, speechMs) / 1000))
  const d = videoDurations(project, ctx)
  if (!d) return { seconds: want, longest: Infinity, speechMs, fits: true }
  if (Array.isArray(d)) {
    const longest = d[d.length - 1]
    return { seconds: d.find((v) => v >= want) ?? longest, longest, speechMs, fits: speechMs <= longest * 1000 }
  }
  return { seconds: Math.min(d.max, Math.max(d.min, want)), longest: d.max, speechMs, fits: speechMs <= d.max * 1000 }
}

/** A line spoken on screen by a character is voiced by the video model when the series uses video dialogue. */
export function isVideoDialogue(project: Pick<Project, 'dialogAudio'>, clip: Pick<Clip, 'speakerId' | 'narration'>): boolean {
  return !!clip.speakerId && project.dialogAudio === 'video' && !!clip.narration.trim()
}

/**
 * What a clip image needs before it can be generated (§6.I). Sheets are required only when the model can
 * take them as references; a model without references would never look at them.
 */
export function checkClipImagePrerequisites(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): PrerequisitesCheckResult {
  const blockers: string[] = []
  const needsSheets = referenceLimit(project, ctx) > 0
  const charMap = new Map(ctx.characters.map((c) => [c.id, c]))
  const derivMap = new Map(ctx.derivatives.map((d) => [d.id, d]))
  const locMap = new Map(ctx.locations.map((l) => [l.id, l]))
  const propMap = new Map(ctx.props.map((p) => [p.id, p]))
  const hasSheet = (id: string | null | undefined): boolean => !!id && !!findAsset(ctx.assets, id)

  for (const cid of clip.characterIds || []) {
    const ch = charMap.get(cid)
    if (!ch) {
      blockers.push('Ada karakter di adegan ini yang tidak terdaftar di Lorebook.')
      continue
    }
    const costumeId = clip.costumeIds?.[cid]
    if (costumeId) {
      const deriv = derivMap.get(costumeId)
      if (!deriv) blockers.push(`Varian kostum untuk "${ch.name}" tidak terdaftar di Lorebook.`)
      else if (needsSheets && !hasSheet(deriv.sheetAssetId)) blockers.push(`Varian kostum "${deriv.name}" (${ch.name}) belum punya lembar referensi.`)
    } else if (needsSheets && !hasSheet(ch.sheetAssetId)) {
      blockers.push(`Karakter "${ch.name}" belum punya lembar referensi.`)
    }
  }

  if (clip.locationId) {
    const loc = locMap.get(clip.locationId)
    if (!loc) blockers.push('Lokasi adegan ini tidak terdaftar di Lorebook.')
    else if (needsSheets && !hasSheet(loc.sheetAssetId)) blockers.push(`Lokasi "${loc.name}" belum punya lembar referensi.`)
  }

  for (const pid of clip.propIds || []) {
    const pr = propMap.get(pid)
    if (!pr) blockers.push('Ada prop di adegan ini yang tidak terdaftar di Lorebook.')
    else if (needsSheets && !hasSheet(pr.sheetAssetId)) blockers.push(`Prop "${pr.name}" belum punya lembar referensi.`)
  }

  return { ok: blockers.length === 0, blockers }
}

/**
 * What a clip video needs (§6.I). The length is fitted to the model, never a reason to block; only a spoken
 * line longer than the model's longest video is.
 */
export function checkClipVideoPrerequisites(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): PrerequisitesCheckResult {
  const blockers: string[] = []

  if (clip.continueFromPrevious) {
    if (ctx.clips && ctx.clips.length > 0) {
      const sorted = [...ctx.clips].sort((a, b) => a.sort - b.sort)
      const idx = sorted.findIndex((c) => c.id === clip.id)
      if (idx <= 0) {
        blockers.push('Shot pertama tidak bisa menyambung dari shot sebelumnya.')
      } else {
        const prev = sorted[idx - 1]
        const prevAssetId = prev.videoAssetId || prev.imageAssetId || null
        if (!prevAssetId || !findAsset(ctx.assets, prevAssetId)) {
          blockers.push('Shot sebelumnya belum memiliki video atau gambar untuk disambung.')
        }
      }
    } else if (!clip.imageAssetId || !findAsset(ctx.assets, clip.imageAssetId)) {
      blockers.push('Klip belum punya gambar storyboard. Buat gambarnya dulu.')
    }
  } else if (!clip.imageAssetId || !findAsset(ctx.assets, clip.imageAssetId)) {
    blockers.push('Klip belum punya gambar storyboard. Buat gambarnya dulu.')
  }

  if (clip.speakerId && project.dialogAudio === 'video') {
    const isFlow = !!ctx.isFlow2Api
    const vModelId = isFlow ? (flow2apiId(project.videoModel, ctx.flow2apiVideoModel) ?? project.videoModel) : project.videoModel
    if (!modelSupportsNativeAudio(vModelId, isFlow)) {
      blockers.push('Model video terpilih tidak mendukung dialog bersuara. Ganti model video yang mendukung suara (misal Veo 3.1) atau alihkan mode dialog ke TTS.')
    }
    const speaker = ctx.characters.find((c) => c.id === clip.speakerId)
    if (!speaker) blockers.push('Pembicara dialog tidak terdaftar di Lorebook.')
    else if (!(clip.characterIds || []).includes(clip.speakerId)) {
      blockers.push(`Pembicara "${speaker.name}" harus terlihat di adegan ini supaya gerak bibirnya bisa dibuat.`)
    }
    if (!clip.narration.trim()) blockers.push('Teks dialog masih kosong.')
    else {
      const fit = videoSecondsFor(project, clip, ctx)
      if (!fit.fits) {
        blockers.push(
          `Ucapan dialog (±${Math.round(fit.speechMs / 1000)} dtk) lebih panjang dari video terpanjang model (${fit.longest} dtk). Pecah adegan atau perpendek kalimat.`
        )
      }
    }
  }

  return { ok: blockers.length === 0, blockers }
}

/** What clip narration audio needs (§6.I). */
export function checkClipAudioPrerequisites(clip: Clip, _project: Project, _ctx: GenerationPrerequisitesContext): PrerequisitesCheckResult {
  const blockers = clip.narration.trim() ? [] : ['Naskah narasi masih kosong.']
  return { ok: blockers.length === 0, blockers }
}

/**
 * Turns a result asset and its expected basis into a status. Results made before basis hashes existed have
 * no record of their inputs: they count as current, or every old project would be queued for regeneration.
 */
function resultStatus(assets: Asset[] | Record<string, Asset>, assetId: string | null | undefined, basisHash: string, prereqs: PrerequisitesCheckResult): ClipStatusResult {
  const asset = findAsset(assets, assetId)
  if (asset) {
    const stored = (asset.meta as Record<string, unknown> | undefined)?.basisHash
    if (typeof stored !== 'string' || stored === basisHash) return { status: 'current', blockers: [], basisHash, hasResult: true }
    return prereqs.ok
      ? { status: 'stale', blockers: [], basisHash, hasResult: true }
      : { status: 'blocked', blockers: prereqs.blockers, basisHash, hasResult: true }
  }
  return prereqs.ok
    ? { status: 'missing', blockers: [], basisHash, hasResult: false }
    : { status: 'blocked', blockers: prereqs.blockers, basisHash, hasResult: false }
}

/** The basis hash a clip image is generated from, with the same reference sheets generation will send. */
export function clipImageBasis(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): { basisHash: string; refSheetAssetIds: string[] } {
  const refs = collectReferenceSheets(clip, ctx.characters, ctx.derivatives, ctx.locations, ctx.props, referenceLimit(project, ctx))
  const refSheetAssetIds = refs.map((r) => r.sheetAssetId)
  const basisHash = computeClipImageBasisHash({
    project,
    clip,
    characters: ctx.characters,
    derivatives: ctx.derivatives,
    locations: ctx.locations,
    props: ctx.props,
    refSheetAssetIds
  })
  return { basisHash, refSheetAssetIds }
}

/** Status of a clip image (§6.J). */
export function getClipImageStatus(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): ClipStatusResult {
  const { basisHash } = clipImageBasis(clip, project, ctx)
  return resultStatus(ctx.assets, clip.imageAssetId, basisHash, checkClipImagePrerequisites(clip, project, ctx))
}

/** Status of a clip video (§6.J). */
export function getClipVideoStatus(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): ClipStatusResult {
  let prevAssetId: string | null = null
  if (clip.continueFromPrevious && ctx.clips) {
    const sorted = [...ctx.clips].sort((a, b) => a.sort - b.sort)
    const idx = sorted.findIndex((c) => c.id === clip.id)
    if (idx > 0) {
      const prev = sorted[idx - 1]
      prevAssetId = prev.videoAssetId || prev.imageAssetId || null
    }
  }
  const basisHash = computeClipVideoBasisHash({
    project,
    clip,
    characters: ctx.characters,
    seconds: videoSecondsFor(project, clip, ctx).seconds,
    prevAssetId
  })
  return resultStatus(ctx.assets, clip.videoAssetId, basisHash, checkClipVideoPrerequisites(clip, project, ctx))
}

/** Status of clip narration audio (§6.J). */
export function getClipAudioStatus(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): ClipStatusResult {
  const char = clip.speakerId ? ctx.characters.find((c) => c.id === clip.speakerId) : null
  // Same fallback as generateClipTts, or every Gemini take without a chosen voice would look stale.
  const voice = (char?.ttsProvider === project.ttsProvider ? char?.ttsVoice : null) || project.ttsVoice || (project.ttsProvider === 'gemini' ? 'Charon' : '')
  const basisHash = computeClipTtsBasisHash({ narration: clip.narration, voice, ttsProvider: project.ttsProvider })
  return resultStatus(ctx.assets, clip.audioAssetId, basisHash, checkClipAudioPrerequisites(clip, project, ctx))
}

/**
 * Splits clips for a batch run: which ones it makes, and which blocked ones stop it (all-or-nothing, §6.J).
 * A blocked clip that already has a result only stops the batch when stale results are being remade.
 */
export function planBatch<T extends { status: ClipStatusResult }>(items: T[], includeStale: boolean): { targets: T[]; blocking: T[] } {
  const targets = items.filter((i) => i.status.status === 'missing' || (includeStale && i.status.status === 'stale'))
  const blocking = items.filter((i) => i.status.status === 'blocked' && (!i.status.hasResult || includeStale))
  return { targets, blocking }
}

/**
 * What the storyboard and inspector say about the voice of a clip the video model speaks, or null for any other
 * clip. Narration never voices these clips, so a missing or outdated voice is fixed by remaking the video.
 */
export function dialogVoiceNote(
  project: Pick<Project, 'dialogAudio'>,
  clip: Pick<Clip, 'speakerId' | 'narration' | 'audioAssetId' | 'videoAssetId'>,
  assets: Record<string, Asset>
): { tone: 'info' | 'warn'; text: string } | null {
  if (!isVideoDialogue(project, clip)) return null
  const voice = clip.audioAssetId ? assets[clip.audioAssetId] : null
  const video = clip.videoAssetId ? assets[clip.videoAssetId] : null
  const error = video?.meta.dialogAudioError
  if (typeof error === 'string' && (!voice || voice.meta.videoAssetId !== video?.id)) {
    return { tone: 'warn', text: `Suara dialog tidak bisa diambil dari video ini (${error}). Buat ulang videonya.` }
  }
  if (voice && (voice.prompt ?? '').trim() !== clip.narration.trim()) {
    return { tone: 'warn', text: 'Teks dialog berubah sejak video dibuat. Buat ulang videonya supaya ucapan dan gerak bibir ikut berubah.' }
  }
  if (!voice) return { tone: 'info', text: 'Klip dialog video: suara dan gerak bibir dibuat langsung oleh AI video saat generate video.' }
  return null
}

export interface SheetStatusResult {
  status: SheetGenerationStatus
  blockers: string[]
  basisHash: string
  hasResult: boolean
}

export function getCharacterSheetStatus(
  character: Character,
  project: Pick<Project, 'styleId' | 'imageModel'>,
  assets: Asset[] | Record<string, Asset>
): SheetStatusResult {
  const blockers: string[] = []
  if (!character.name.trim()) blockers.push('Nama karakter masih kosong.')
  const basisHash = computeCharacterSheetBasisHash({
    name: character.name,
    description: character.description,
    styleId: project.styleId,
    imageModel: project.imageModel,
    profile: character.profile
  })
  const asset = findAsset(assets, character.sheetAssetId)
  if (asset) {
    if (asset.meta?.uploaded) return { status: 'current', blockers: [], basisHash, hasResult: true }
    const stored = (asset.meta as Record<string, unknown> | undefined)?.basisHash
    if (typeof stored !== 'string' || stored === basisHash) return { status: 'current', blockers: [], basisHash, hasResult: true }
    return blockers.length === 0
      ? { status: 'stale', blockers: [], basisHash, hasResult: true }
      : { status: 'blocked', blockers, basisHash, hasResult: true }
  }
  return blockers.length === 0
    ? { status: 'missing', blockers: [], basisHash, hasResult: false }
    : { status: 'blocked', blockers, basisHash, hasResult: false }
}

export function getDerivativeSheetStatus(
  derivative: CharacterDerivative,
  character: Character | undefined,
  project: Pick<Project, 'imageModel'>,
  assets: Asset[] | Record<string, Asset>,
  baseSheetWillBeGenerated = false
): SheetStatusResult {
  const blockers: string[] = []
  if (!character) {
    blockers.push('Karakter induk tidak ditemukan.')
  } else if (!character.sheetAssetId && !baseSheetWillBeGenerated) {
    blockers.push(`Karakter "${character.name}" belum punya lembar referensi dasar.`)
  }
  const basisHash = computeDerivativeSheetBasisHash({
    baseSheetAssetId: character?.sheetAssetId ?? null,
    promptChange: derivative.promptChange,
    imageModel: project.imageModel,
    costumeKeyphrase: derivative.costumeKeyphrase
  })
  const asset = findAsset(assets, derivative.sheetAssetId)
  if (asset) {
    // Stale (§6.G): a generated variant sheet records the base sheet and prompt_change it was made from, so
    // editing the costume change or remaking the base sheet both mark it. Uploaded sheets never go stale; sheets
    // from before basis hashes fall back to "base sheet is newer".
    if (asset.meta?.uploaded) return { status: 'current', blockers: [], basisHash, hasResult: true }
    const stored = (asset.meta as Record<string, unknown> | undefined)?.basisHash
    const baseSheet = findAsset(assets, character?.sheetAssetId)
    const isStale = typeof stored === 'string' ? stored !== basisHash : !!baseSheet && baseSheet.createdAt > asset.createdAt
    if (!isStale) return { status: 'current', blockers: [], basisHash, hasResult: true }
    return blockers.length === 0
      ? { status: 'stale', blockers: [], basisHash, hasResult: true }
      : { status: 'blocked', blockers, basisHash, hasResult: true }
  }
  return blockers.length === 0
    ? { status: 'missing', blockers: [], basisHash, hasResult: false }
    : { status: 'blocked', blockers, basisHash, hasResult: false }
}

export function getLocationSheetStatus(
  location: Location,
  project: Pick<Project, 'styleId' | 'imageModel'>,
  assets: Asset[] | Record<string, Asset>
): SheetStatusResult {
  const blockers: string[] = []
  if (!location.name.trim()) blockers.push('Nama lokasi masih kosong.')
  const basisHash = computeLocationSheetBasisHash({
    name: location.name,
    description: location.description,
    styleId: project.styleId,
    imageModel: project.imageModel,
    profile: location.profile
  })
  const asset = findAsset(assets, location.sheetAssetId)
  if (asset) {
    if (asset.meta?.uploaded) return { status: 'current', blockers: [], basisHash, hasResult: true }
    const stored = (asset.meta as Record<string, unknown> | undefined)?.basisHash
    if (typeof stored !== 'string' || stored === basisHash) return { status: 'current', blockers: [], basisHash, hasResult: true }
    return blockers.length === 0
      ? { status: 'stale', blockers: [], basisHash, hasResult: true }
      : { status: 'blocked', blockers, basisHash, hasResult: true }
  }
  return blockers.length === 0
    ? { status: 'missing', blockers: [], basisHash, hasResult: false }
    : { status: 'blocked', blockers, basisHash, hasResult: false }
}

export function getPropSheetStatus(
  prop: Prop,
  project: Pick<Project, 'styleId' | 'imageModel'>,
  assets: Asset[] | Record<string, Asset>
): SheetStatusResult {
  const blockers: string[] = []
  if (!prop.name.trim()) blockers.push('Nama prop masih kosong.')
  const basisHash = computePropSheetBasisHash({
    name: prop.name,
    description: prop.description,
    styleId: project.styleId,
    imageModel: project.imageModel,
    profile: prop.profile
  })
  const asset = findAsset(assets, prop.sheetAssetId)
  if (asset) {
    if (asset.meta?.uploaded) return { status: 'current', blockers: [], basisHash, hasResult: true }
    const stored = (asset.meta as Record<string, unknown> | undefined)?.basisHash
    if (typeof stored !== 'string' || stored === basisHash) return { status: 'current', blockers: [], basisHash, hasResult: true }
    return blockers.length === 0
      ? { status: 'stale', blockers: [], basisHash, hasResult: true }
      : { status: 'blocked', blockers, basisHash, hasResult: true }
  }
  return blockers.length === 0
    ? { status: 'missing', blockers: [], basisHash, hasResult: false }
    : { status: 'blocked', blockers, basisHash, hasResult: false }
}

export function planBatchSheets<T extends { status: SheetStatusResult }>(items: T[], includeStale: boolean): { targets: T[]; blocking: T[] } {
  const targets = items.filter((i) => i.status.status === 'missing' || (includeStale && i.status.status === 'stale'))
  const blocking = items.filter((i) => i.status.status === 'blocked' && (!i.status.hasResult || includeStale))
  return { targets, blocking }
}

// ---------- Phase 7: Speech Duration, Script Doctor & Rhythm Indicator ----------

export const WORDS_PER_SECOND_MAX = 3.2
export const WORDS_PER_SECOND_RECOMMENDED = 2.6

export function validateSpeechDuration(text: string, durationSec: number): {
  valid: boolean
  wordCount: number
  maxRecommendedWords: number
  wordsPerSecond: number
} {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const wordsPerSecond = durationSec > 0 ? wordCount / durationSec : wordCount
  const maxRecommendedWords = Math.floor(durationSec * WORDS_PER_SECOND_MAX)
  return {
    valid: wordsPerSecond <= WORDS_PER_SECOND_MAX,
    wordCount,
    maxRecommendedWords,
    wordsPerSecond: Math.round(wordsPerSecond * 10) / 10
  }
}

export function checkScriptDoctor(
  draft: EpisodeScriptDraft,
  episode: Episode,
  registered: {
    characters: Character[]
    locations: Location[]
    props: Prop[]
    derivatives?: CharacterDerivative[]
  }
): ScriptDoctorIssue[] {
  const issues: ScriptDoctorIssue[] = []
  const shots = draft.shots || []
  if (!shots.length) {
    issues.push({
      code: 'EMPTY_SHOTS',
      severity: 'error',
      title: 'Naskah Belum Memiliki Shot',
      description: 'Episode ini belum memiliki daftar shot yang tersusun.'
    })
    return issues
  }

  // 1. Hook on First Shot
  const firstShot = shots[0]
  if (firstShot) {
    const hasVisualTension = Boolean(firstShot.visualAction && firstShot.visualAction.length > 10)
    const hasEmotion = Boolean(firstShot.emotion && firstShot.emotion.trim())
    const hasSpeech = Boolean(firstShot.text && firstShot.text.trim())
    if (!hasVisualTension && !hasEmotion && !hasSpeech) {
      issues.push({
        code: 'WEAK_HOOK',
        severity: 'warning',
        shotIndex: 0,
        title: 'Hook Pembuka Kurang Menggigit',
        description: 'Shot 1 membuka episode, namun belum memiliki aksi visual dramatis, emosi kuat, atau dialog pembuka.',
        suggestion: 'Mulai dengan konfrontasi langsung, pertanyaan misterius, atau ekspresi dramatis.'
      })
    }
  }

  // 2. Cliffhanger on Last Shot
  const lastShot = shots[shots.length - 1]
  if (lastShot && shots.length > 1) {
    const hasEmotion = Boolean(lastShot.emotion && lastShot.emotion.trim())
    const hasText = Boolean(lastShot.text && lastShot.text.trim())
    if (!hasEmotion && !hasText) {
      issues.push({
        code: 'WEAK_CLIFFHANGER',
        severity: 'warning',
        shotIndex: shots.length - 1,
        title: 'Penutup Kurang Menggantung (Cliffhanger Lemah)',
        description: 'Shot penutup episode tidak memiliki punchline emosional atau momen gantung.',
        suggestion: 'Akhiri dengan reaksi terkejut, tatapan ancaman, atau kalimat menggantung.'
      })
    }
  }

  // 3. Talking head monotony: >= 4 consecutive shots with closeup framing and dialogue
  let consecutiveDialogueCloseups = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const isCloseup = /close|cu/i.test(s.framing || '')
    const hasDialogue = Boolean(s.text && s.speaker)
    if (isCloseup && hasDialogue) {
      consecutiveDialogueCloseups++
      if (consecutiveDialogueCloseups >= 4) {
        issues.push({
          code: 'TALKING_HEAD_MONOTONY',
          severity: 'warning',
          shotIndex: i,
          title: 'Monotoni Percakapan (Talking Head)',
          description: `Ada ${consecutiveDialogueCloseups} shot close-up dialog berurutan. Penonton drama vertikal mudah bosan.`,
          suggestion: 'Sisipkan shot reaksi pendengar (reaction shot), shot gerak tangan/benda, atau variasi sudut kamera.'
        })
        consecutiveDialogueCloseups = 0
      }
    } else {
      consecutiveDialogueCloseups = 0
    }
  }

  // 4. Speech duration overflow
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (s.text && s.text.trim()) {
      const check = validateSpeechDuration(s.text, s.durationSec)
      if (!check.valid) {
        issues.push({
          code: 'SPEECH_DURATION_OVERFLOW',
          severity: 'error',
          shotIndex: i,
          title: `Teks Terlalu Panjang untuk Durasi (${check.wordsPerSecond} kata/dtk)`,
          description: `Shot ${i + 1} memiliki ${check.wordCount} kata untuk durasi ${s.durationSec}s. Rekomendasi maksimal ${check.maxRecommendedWords} kata agar tidak terpotong.`,
          suggestion: `Perpanjang durasi shot menjadi minimal ${Math.ceil(check.wordCount / 2.6)} detik atau persingkat kalimat dialog.`
        })
      }
    }
  }

  // 5. Unregistered entities check
  const knownChars = new Set([
    ...registered.characters.map((c) => c.name.toLowerCase()),
    ...registered.characters.flatMap((c) => c.aliases.map((a) => a.toLowerCase())),
    ...(draft.newAssets || []).filter((a) => a.kind === 'character').map((a) => a.name.toLowerCase())
  ])
  const knownLocs = new Set([
    ...registered.locations.map((l) => l.name.toLowerCase()),
    ...registered.locations.flatMap((l) => l.aliases.map((a) => a.toLowerCase())),
    ...(draft.newAssets || []).filter((a) => a.kind === 'location').map((a) => a.name.toLowerCase())
  ])

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    if (s.speaker && !knownChars.has(s.speaker.toLowerCase())) {
      issues.push({
        code: 'UNREGISTERED_SPEAKER',
        severity: 'warning',
        shotIndex: i,
        title: `Pembicara "${s.speaker}" Belum Terdaftar`,
        description: `Karakter "${s.speaker}" di Shot ${i + 1} tidak ditemukan di Lorebook maupun usulan aset baru.`,
        suggestion: `Daftarkan "${s.speaker}" di Lorebook atau tambahkan ke usulan aset baru.`
      })
    }
    if (s.location && s.location.trim() && !knownLocs.has(s.location.trim().toLowerCase())) {
      issues.push({
        code: 'UNREGISTERED_LOCATION',
        severity: 'info',
        shotIndex: i,
        title: `Lokasi "${s.location}" Belum Terdaftar`,
        description: `Lokasi "${s.location}" di Shot ${i + 1} belum terdaftar di Lorebook.`,
        suggestion: 'Daftarkan lokasi di Lorebook untuk menjaga konsistensi arsitektur dan pencahayaan.'
      })
    }
  }

  // 6. Wardrobe continuity check
  for (let i = 0; i < shots.length - 1; i++) {
    const curr = shots[i]
    const next = shots[i + 1]
    for (const charName of curr.characters || []) {
      if ((next.characters || []).includes(charName)) {
        const currCostume = curr.costumes?.[charName] || 'default'
        const nextCostume = next.costumes?.[charName] || 'default'
        if (currCostume !== nextCostume && curr.location === next.location) {
          issues.push({
            code: 'UNEXPLAINED_WARDROBE_CHANGE',
            severity: 'warning',
            shotIndex: i + 1,
            title: `Perubahan Pakaian Mendadak (${charName})`,
            description: `Di Shot ${i + 2}, ${charName} berganti dari "${currCostume}" ke "${nextCostume}" di lokasi yang sama tanpa jeda waktu.`,
            suggestion: 'Pastikan kostum konsisten sepanjang adegan, kecuali cerita memang memuat adegan ganti pakaian.'
          })
        }
      }
    }
  }

  // 7. Episode duration vs target duration delta
  const totalDurationSec = shots.reduce((acc, s) => acc + (s.durationSec || 5), 0)
  const targetSec = episode.durationSec || 60
  const delta = Math.abs(totalDurationSec - targetSec)
  if (delta > 20) {
    issues.push({
      code: 'DURATION_DELTA_LARGE',
      severity: 'info',
      title: `Durasi Total (${totalDurationSec}s) Berbeda dari Target (${targetSec}s)`,
      description: `Total durasi ${shots.length} shot adalah ${totalDurationSec} detik (selisih ${totalDurationSec > targetSec ? '+' : '-'}${delta}s dari target ${targetSec}s).`,
      suggestion: 'Sesuaikan durasi shot atau jumlah shot jika ingin pas dengan target penayangan.'
    })
  }

  return issues
}

export interface ShotRhythmSegment {
  shotIndex: number
  title: string
  durationSec: number
  pacing: 'fast' | 'moderate' | 'slow'
  type: 'action' | 'dialogue' | 'reaction' | 'silent'
  emotionIntensity: 'low' | 'medium' | 'high'
}

export function computeEpisodeRhythm(draft: EpisodeScriptDraft): ShotRhythmSegment[] {
  return (draft.shots || []).map((s, idx) => {
    const dur = s.durationSec || 5
    const pacing: 'fast' | 'moderate' | 'slow' = dur <= 3 ? 'fast' : dur <= 6 ? 'moderate' : 'slow'
    let type: 'action' | 'dialogue' | 'reaction' | 'silent' = 'action'
    if (s.text && s.speaker) type = 'dialogue'
    else if (s.shotDetail?.nonSpeakingReaction || s.emotion?.toLowerCase().includes('reaksi')) type = 'reaction'
    else if (!s.text) type = 'silent'

    const em = (s.emotion || '').toLowerCase()
    const highWords = ['marah', 'histeris', 'menjerit', 'menampar', 'teriak', 'panik', 'syok', 'climax', 'intense', 'benci', 'ancam']
    const isHigh = highWords.some((w) => em.includes(w))
    const emotionIntensity: 'low' | 'medium' | 'high' = isHigh ? 'high' : em.length > 0 ? 'medium' : 'low'

    return {
      shotIndex: idx,
      title: s.title || `Shot ${idx + 1}`,
      durationSec: dur,
      pacing,
      type,
      emotionIntensity
    }
  })
}
