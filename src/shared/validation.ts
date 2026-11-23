import { FLOW2API_IMAGE_MODELS, FLOW2API_VIDEO_MODELS, getFlow2ApiModel } from './flow2api-catalog'
import { getImageModel, getVideoModel, maxRefs, modelSupportsNativeAudio } from './higgsfield'
import { collectReferenceSheets, findSceneAnchorForClip, hasReferenceOverride } from './prompts'
import {
  computeClipImageBasisHash,
  computeClipVideoBasisHash,
  computeClipTtsBasisHash,
  computeCharacterSheetBasisHash,
  computeDerivativeSheetBasisHash,
  computeLocationSheetBasisHash,
  computePropSheetBasisHash
} from './hash'
import { estimateNarrationMs, isDefaultCostume, isNarratorName } from './script'
import { resolveClipTtsVoice } from './models'
import { spokenWords, tagPauseSec } from './speech'
import type {
  Asset,
  Character,
  CharacterDerivative,
  Clip,
  ContinuityItem,
  DialogueType,
  Episode,
  EpisodeScriptDraft,
  Job,
  Location,
  LockWord,
  Project,
  Prop,
  ScriptDoctorIssue,
  SheetGenerationStatus,
  ShotDetail,
  StoryBeatPhase
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
  /** Active global models resolved via resolveActive() */
  activeImageModel?: string
  activeVideoModel?: string
  lockWords?: LockWord[]
  /** Clip IDs being generated in the same video batch, so chained `continueFromPrevious` clips are not blocked. */
  queuedClipIds?: Set<string>
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

export interface SheetStatusResult {
  status: SheetGenerationStatus
  blockers: string[]
  basisHash: string
  hasResult: boolean
}

type ProjectModels = Pick<Project, 'imageModel' | 'videoModel'>

function findAsset(assets: Asset[] | Record<string, Asset>, id: string | null | undefined): Asset | null {
  if (!id) return null
  if (Array.isArray(assets)) return assets.find((a) => a.id === id) ?? null
  return assets[id] ?? null
}

function normalizeFlow2ApiModel(id: string | null | undefined, kind: 'image' | 'video'): string | null {
  const clean = (id ?? '')
    .trim()
    .replace(/-\d+s-(landscape|portrait)$/, '')
    .replace(/-(landscape|portrait)$/, '')
  if (!clean) return null
  const catalog = kind === 'image' ? FLOW2API_IMAGE_MODELS : FLOW2API_VIDEO_MODELS
  return catalog.find((m) => m.id === clean)?.id ?? null
}

function effectiveImageModelId(projectModel: string | null | undefined, ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiImageModel' | 'activeImageModel'>): string | null {
  const raw = ctx.activeImageModel?.trim() || (ctx.isFlow2Api ? (ctx.flow2apiImageModel?.trim() || null) : (projectModel?.trim() || null))
  if (ctx.isFlow2Api) {
    return raw || normalizeFlow2ApiModel(projectModel, 'image') || getFlow2ApiModel(null, 'image').id
  }
  return getImageModel(raw).id
}

function effectiveVideoModelId(projectModel: string | null | undefined, ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiVideoModel' | 'activeVideoModel'>): string | null {
  const raw = ctx.activeVideoModel?.trim() || (ctx.isFlow2Api ? (ctx.flow2apiVideoModel?.trim() || null) : (projectModel?.trim() || null))
  if (ctx.isFlow2Api) {
    return raw || normalizeFlow2ApiModel(projectModel, 'video') || getFlow2ApiModel(null, 'video').id
  }
  return getVideoModel(raw).id
}

/**
 * How many reference sheets the image model takes. Status and generation both read this, so the basis hash
 * of a fresh image always matches the one the storyboard computes.
 */
export function referenceLimit(project: ProjectModels, ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiImageModel' | 'activeImageModel'>): number {
  const modelId = effectiveImageModelId(project.imageModel, ctx)
  if (ctx.isFlow2Api) {
    const m = getFlow2ApiModel(modelId, 'image')
    return m.supportsRef ? m.maxRefs : 0
  }
  return maxRefs(getImageModel(modelId))
}

/** Allowed video lengths in seconds, or null when the model takes any length. */
function videoDurations(project: ProjectModels, ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiVideoModel' | 'activeVideoModel'>): number[] | { min: number; max: number } | null {
  const modelId = effectiveVideoModelId(project.videoModel, ctx)
  if (ctx.isFlow2Api) {
    const id = (modelId ?? '')
      .trim()
      .replace(/-\d+s-(landscape|portrait)$/, '')
      .replace(/-(landscape|portrait)$/, '')
    const model = FLOW2API_VIDEO_MODELS.find((m) => m.id === id) ?? getFlow2ApiModel(null, 'video')
    return model.durations.length ? [...model.durations].sort((a, b) => a - b) : null
  }
  const d = getVideoModel(modelId).durations
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
  clip: Pick<Clip, 'durationMs' | 'speakerId' | 'narration'> & { shotDetail?: Pick<ShotDetail, 'dialogueType'> | null },
  ctx: Pick<GenerationPrerequisitesContext, 'isFlow2Api' | 'flow2apiVideoModel' | 'activeVideoModel'>
): { seconds: number; longest: number; speechMs: number; fits: boolean } {
  const speechMs = isVideoDialogue(project, clip) ? estimateNarrationMs(clip.narration) : 0
  // Tolerate up to 150ms of MP4/AAC container padding so a 4s video probed at 4040ms does not bump to 5s/6s.
  const paddedClipMs = clip.durationMs > 1150 ? clip.durationMs - 150 : clip.durationMs
  const want = Math.max(1, Math.ceil(Math.max(paddedClipMs, speechMs) / 1000))
  const d = videoDurations(project, ctx)
  if (!d) return { seconds: want, longest: Infinity, speechMs, fits: true }
  if (Array.isArray(d)) {
    const longest = d[d.length - 1]
    return { seconds: d.find((v) => v >= want) ?? longest, longest, speechMs, fits: speechMs <= longest * 1000 }
  }
  return { seconds: Math.min(d.max, Math.max(d.min, want)), longest: d.max, speechMs, fits: speechMs <= d.max * 1000 }
}

/** A line spoken on screen by a character is voiced by the video model when the series uses video dialogue. */
/**
 * Whether the video model voices this clip (with lip sync). Only on-screen dialogue qualifies: off-screen (O.S.)
 * lines, inner monologue (V.O.) and narration have no visible speaker to sync, so they always go to TTS. Video
 * generation, TTS batches, narration and the Storyboard all read this one rule.
 */
export function isVideoDialogue(
  project: Pick<Project, 'dialogAudio'>,
  clip: Pick<Clip, 'speakerId' | 'narration'> & { shotDetail?: Pick<ShotDetail, 'dialogueType'> | null }
): boolean {
  if (!clip.speakerId || project.dialogAudio !== 'video' || !clip.narration.trim()) return false
  return (clip.shotDetail?.dialogueType ?? 'dialogue') === 'dialogue'
}

/**
 * What a clip image needs before it can be generated (§6.I). Sheets are required only when the model can
 * take them as references; a model without references would never look at them.
 */
export function checkClipImagePrerequisites(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): PrerequisitesCheckResult {
  const blockers: string[] = []
  const manualOverride = hasReferenceOverride(clip)
  const needsSheets = referenceLimit(project, ctx) > 0 && !manualOverride
  const charMap = new Map(ctx.characters.map((c) => [c.id, c]))
  const derivMap = new Map(ctx.derivatives.map((d) => [d.id, d]))
  const locMap = new Map(ctx.locations.map((l) => [l.id, l]))
  const propMap = new Map(ctx.props.map((p) => [p.id, p]))
  const hasSheet = (id: string | null | undefined): boolean => !!id && !!findAsset(ctx.assets, id)

  if (manualOverride && referenceLimit(project, ctx) > 0) {
    const missingManual = clip.referenceAssetIds.filter((id) => !hasSheet(id))
    if (missingManual.length > 0) {
      blockers.push('Salah satu gambar referensi manual pada adegan ini sudah tidak tersedia. Pilih ulang referensi manualnya.')
    }
  }

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
  const vModelId = effectiveVideoModelId(project.videoModel, ctx) ?? project.videoModel
  // Flow2API text-to-video models (e.g. veo-3.1-fast) ignore any initial image, so do not block on missing images.
  const needsInitialImage = !(ctx.isFlow2Api && !getFlow2ApiModel(vModelId, 'video').supportsRef)

  if (needsInitialImage) {
    if (clip.continueFromPrevious) {
      if (ctx.clips && ctx.clips.length > 0) {
        // Scope to the clip's own episode so clips from other episodes (which also start at sort 0) never interleave.
        const sameEpisode = clip.episodeId ? ctx.clips.filter((c) => c.episodeId === clip.episodeId) : ctx.clips
        const sorted = [...sameEpisode].sort((a, b) => a.sort - b.sort)
        const idx = sorted.findIndex((c) => c.id === clip.id)
        if (idx <= 0) {
          blockers.push('Shot pertama tidak bisa menyambung dari shot sebelumnya.')
        } else {
          const prev = sorted[idx - 1]
          const prevAssetId = prev.videoAssetId || prev.imageAssetId || null
          const prevWillGenerate = !!ctx.queuedClipIds?.has(prev.id)
          if (!prevWillGenerate && (!prevAssetId || !findAsset(ctx.assets, prevAssetId))) {
            blockers.push('Shot sebelumnya belum memiliki video atau gambar untuk disambung.')
          }
        }
      } else if (!clip.imageAssetId || !findAsset(ctx.assets, clip.imageAssetId)) {
        blockers.push('Klip belum punya gambar storyboard. Buat gambarnya dulu.')
      }
    } else if (!clip.imageAssetId || !findAsset(ctx.assets, clip.imageAssetId)) {
      blockers.push('Klip belum punya gambar storyboard. Buat gambarnya dulu.')
    }
  }

  // Only on-screen dialogue uses the video model's native audio; O.S./V.O./narration always go through TTS.
  if (clip.speakerId && project.dialogAudio === 'video' && (clip.shotDetail?.dialogueType ?? 'dialogue') === 'dialogue') {
    const isFlow = !!ctx.isFlow2Api
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
  const activeImageModel = effectiveImageModelId(project.imageModel, ctx)
  const sceneAnchor = findSceneAnchorForClip(clip, ctx.clips)
  const refs = collectReferenceSheets(clip, ctx.characters, ctx.derivatives, ctx.locations, ctx.props, referenceLimit(project, ctx), sceneAnchor)
  const refSheetAssetIds = refs.map((r) => r.sheetAssetId)
  const lockWords = ctx.lockWords || project.seriesLock || []
  const basisHash = computeClipImageBasisHash({
    project: { ...project, imageModel: activeImageModel },
    clip,
    characters: ctx.characters,
    derivatives: ctx.derivatives,
    locations: ctx.locations,
    props: ctx.props,
    refSheetAssetIds,
    refItems: refs,
    lockWords,
    imageModel: activeImageModel
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
    const sameEpisode = clip.episodeId ? ctx.clips.filter((c) => c.episodeId === clip.episodeId) : ctx.clips
    const sorted = [...sameEpisode].sort((a, b) => a.sort - b.sort)
    const idx = sorted.findIndex((c) => c.id === clip.id)
    if (idx > 0) {
      const prev = sorted[idx - 1]
      prevAssetId = prev.videoAssetId || prev.imageAssetId || null
    }
  }
  const activeVideoModel = effectiveVideoModelId(project.videoModel, ctx)
  const lockWords = ctx.lockWords || project.seriesLock || []
  let seconds = videoSecondsFor(project, clip, ctx).seconds
  // Non-destructive trimming (such as autoTrimSilence after dialogue extraction) shortens clip.durationMs
  // inside an already-generated video; keep the requested duration if the existing video still covers it.
  const existingVideo = findAsset(ctx.assets, clip.videoAssetId)
  const requestedSec = existingVideo?.meta?.requestedSeconds
  if (
    typeof requestedSec === 'number' &&
    seconds <= requestedSec &&
    (clip.mediaInMs > 0 ||
      clip.voiceInMs > 0 ||
      clip.voiceOutMs != null ||
      (existingVideo?.durationMs != null && clip.durationMs <= existingVideo.durationMs + 250))
  ) {
    seconds = requestedSec
  }
  const basisHash = computeClipVideoBasisHash({
    project: { ...project, videoModel: activeVideoModel },
    clip,
    characters: ctx.characters,
    seconds,
    prevAssetId,
    lockWords,
    videoModel: activeVideoModel
  })
  return resultStatus(ctx.assets, clip.videoAssetId, basisHash, checkClipVideoPrerequisites(clip, project, ctx))
}

/** Status of clip narration audio (§6.J). */
export function getClipAudioStatus(clip: Clip, project: Project, ctx: GenerationPrerequisitesContext): ClipStatusResult {
  // Same gender-aware resolution as narration and generateClipTts so basis hashes always match.
  const voice = resolveClipTtsVoice(clip, ctx.characters, project)
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

export function getCharacterSheetStatus(
  character: Character,
  project: Pick<Project, 'styleId' | 'imageModel'> & { seriesGuidelines?: string },
  assets: Asset[] | Record<string, Asset>,
  imageModelOverride?: string
): SheetStatusResult {
  const blockers: string[] = []
  if (!character.name.trim()) blockers.push('Nama karakter masih kosong.')
  const basisHash = computeCharacterSheetBasisHash({
    name: character.name,
    description: character.description,
    styleId: project.styleId,
    imageModel: imageModelOverride || project.imageModel,
    profile: character.profile,
    seriesGuidelines: project.seriesGuidelines
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
  project: Pick<Project, 'imageModel'> & { styleId?: string; seriesGuidelines?: string },
  assets: Asset[] | Record<string, Asset>,
  baseSheetWillBeGenerated = false,
  imageModelOverride?: string
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
    imageModel: imageModelOverride || project.imageModel,
    costumeKeyphrase: derivative.costumeKeyphrase,
    styleId: project.styleId,
    seriesGuidelines: project.seriesGuidelines
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
  project: Pick<Project, 'styleId' | 'imageModel'> & { seriesGuidelines?: string },
  assets: Asset[] | Record<string, Asset>,
  imageModelOverride?: string
): SheetStatusResult {
  const blockers: string[] = []
  if (!location.name.trim()) blockers.push('Nama lokasi masih kosong.')
  const basisHash = computeLocationSheetBasisHash({
    name: location.name,
    description: location.description,
    styleId: project.styleId,
    imageModel: imageModelOverride || project.imageModel,
    profile: location.profile,
    seriesGuidelines: project.seriesGuidelines
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
  project: Pick<Project, 'styleId' | 'imageModel'> & { seriesGuidelines?: string },
  assets: Asset[] | Record<string, Asset>,
  imageModelOverride?: string
): SheetStatusResult {
  const blockers: string[] = []
  if (!prop.name.trim()) blockers.push('Nama prop masih kosong.')
  const basisHash = computePropSheetBasisHash({
    name: prop.name,
    description: prop.description,
    styleId: project.styleId,
    imageModel: imageModelOverride || project.imageModel,
    profile: prop.profile,
    seriesGuidelines: project.seriesGuidelines
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
  const words = spokenWords(text)
  const wordCount = words.length
  const pauseSec = tagPauseSec(text)
  const speakingSec = Math.max(0.5, durationSec - pauseSec)
  const wordsPerSecond = durationSec > 0 ? wordCount / speakingSec : wordCount
  const maxRecommendedWords = Math.max(0, Math.floor(speakingSec * WORDS_PER_SECOND_MAX))
  return {
    valid: wordCount === 0 || (durationSec > pauseSec && wordsPerSecond <= WORDS_PER_SECOND_MAX),
    wordCount,
    maxRecommendedWords,
    wordsPerSecond: Math.round(wordsPerSecond * 10) / 10
  }
}

export function defaultDialogueType(speaker?: string | null, text?: string | null): DialogueType {
  if (speaker && speaker.trim() && !isNarratorName(speaker)) return 'dialogue'
  if (text && text.trim()) return 'narration'
  return 'dialogue'
}

export function cleanShotDetail(
  raw: Partial<ShotDetail> | Record<string, unknown> | undefined,
  speaker?: string | null,
  text?: string | null
): ShotDetail | undefined {
  if (!raw) {
    const dt = defaultDialogueType(speaker, text)
    return dt ? { dialogueType: dt } : undefined
  }
  const detail: ShotDetail = {}
  const cm = String(raw.cameraMotion || (raw as Record<string, unknown>).camera_motion || '').trim()
  if (cm) detail.cameraMotion = cm
  const cr = String(raw.cameraReason || (raw as Record<string, unknown>).camera_reason || '').trim()
  if (cr) detail.cameraReason = cr
  const cp = String(raw.cameraPov || (raw as Record<string, unknown>).camera_pov || '').trim()
  if (cp) detail.cameraPov = cp
  const lt = String(raw.lighting || '').trim()
  if (lt) detail.lighting = lt
  const bl = String(raw.blocking || '').trim()
  if (bl) detail.blocking = bl
  const pp = String(raw.propPlacement || (raw as Record<string, unknown>).prop_placement || '').trim()
  if (pp) detail.propPlacement = pp
  const sam = String(raw.sceneAnchorMode || (raw as Record<string, unknown>).scene_anchor_mode || '').trim()
  if (sam === 'auto' || sam === 'off') detail.sceneAnchorMode = sam
  const nr = String(raw.nonSpeakingReaction || (raw as Record<string, unknown>).non_speaking_reaction || '').trim()
  if (nr) detail.nonSpeakingReaction = nr
  const sfx = String(raw.sfxAmbience || (raw as Record<string, unknown>).sfx_ambience || '').trim()
  if (sfx) detail.sfxAmbience = sfx
  const sd = String(raw.speechDelivery || (raw as Record<string, unknown>).speech_delivery || '').trim()
  if (sd) detail.speechDelivery = sd
  const dt = (raw.dialogueType || (raw as Record<string, unknown>).dialogue_type) as DialogueType | undefined
  const validDt = dt && ['dialogue', 'os', 'vo', 'narration'].includes(dt) ? dt : defaultDialogueType(speaker, text)
  if (validDt) detail.dialogueType = validDt

  return Object.keys(detail).length > 0 ? detail : undefined
}

export function checkScriptDoctor(
  draft: EpisodeScriptDraft,
  episode: Episode,
  registered: {
    characters: Character[]
    locations: Location[]
    props: Prop[]
    derivatives?: CharacterDerivative[]
  },
  previousEpisode?: Episode,
  continuityContext?: {
    items: ContinuityItem[]
    episodes: Episode[]
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
    if (!hasVisualTension && !hasEmotion) {
      issues.push({
        code: 'WEAK_HOOK',
        severity: 'warning',
        shotIndex: 0,
        title: 'Hook Pembuka Kurang Menggigit',
        description: 'Shot 1 membuka episode, namun belum memiliki aksi visual dramatis atau emosi yang kuat.',
        suggestion: 'Mulai dengan konfrontasi langsung, bahaya mendadak, atau ekspresi dramatis yang memicu rasa penasaran penonton.'
      })
    }
  }

  // 1b. Unresolved cliffhanger from previous episode
  if (previousEpisode?.cliffhanger && previousEpisode.cliffhanger.trim()) {
    const prevCliff = previousEpisode.cliffhanger.toLowerCase()
    const keywords = prevCliff.split(/\W+/).filter((w) => w.length > 3)
    const earlyText = shots.slice(0, 3).map((s) => `${s.text} ${s.visualAction} ${s.title}`).join(' ').toLowerCase()
    const matchesKeyword = keywords.some((kw) => earlyText.includes(kw))
    if (!matchesKeyword && keywords.length > 0) {
      issues.push({
        code: 'CLIFFHANGER_UNRESOLVED',
        severity: 'info',
        shotIndex: 0,
        title: 'Resolusi Cliffhanger Episode Sebelumnya',
        description: `Episode sebelumnya ditutup dengan: "${previousEpisode.cliffhanger}". Pastikan pembuka episode ini menjawab atau menyambung momen gantung tersebut.`,
        suggestion: 'Mulai adegan dengan reaksi atau dampak langsung dari kejadian di akhir episode sebelumnya.'
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

  // 3. Talking head monotony: >= 4 consecutive shots with closeup framing and on-screen dialogue
  let consecutiveDialogueCloseups = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const dType = s.shotDetail?.dialogueType ?? defaultDialogueType(s.speaker, s.text)
    const isCloseup = /\b(close[\s-]?up|extreme\s+close[\s-]?up|ecu|cu|mcu)\b/i.test(s.framing || '')
    const hasDialogue = dType === 'dialogue' && Boolean(s.text?.trim() && s.speaker?.trim())
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

  // 3b. Dialogue run too long: > 6 consecutive dialogue shots without action/reaction
  let consecutiveDialogueShots = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const dType = s.shotDetail?.dialogueType ?? defaultDialogueType(s.speaker, s.text)
    const hasDialogue = dType === 'dialogue' && Boolean(s.text && s.text.trim())
    const isActionOrReaction = !hasDialogue || Boolean(s.shotDetail?.nonSpeakingReaction) || !s.speaker
    if (hasDialogue && !s.shotDetail?.nonSpeakingReaction) {
      consecutiveDialogueShots++
      if (consecutiveDialogueShots > 6) {
        issues.push({
          code: 'DIALOGUE_RUN_TOO_LONG',
          severity: 'warning',
          shotIndex: i,
          title: `Rangkaian Dialog Terlalu Panjang (${consecutiveDialogueShots} Shot)`,
          description: `Ada ${consecutiveDialogueShots} shot dialog berturut-turut tanpa jeda shot aksi atau reaksi hening. Tempo drama vertikal membutuhkan aksi visual agar penonton tidak jenuh.`,
          suggestion: 'Sisipkan shot reaksi hening karakter non-speaking, gerak aksi fisik, atau visual objek penting.'
        })
        consecutiveDialogueShots = 0
      }
    } else if (isActionOrReaction) {
      consecutiveDialogueShots = 0
    }
  }

  // 3c. Visual anchor missing: 4 consecutive dialogue shots without visual action/reaction
  let dialogueWithoutAnchor = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const dType = s.shotDetail?.dialogueType ?? defaultDialogueType(s.speaker, s.text)
    const isDialogue = dType === 'dialogue' && Boolean(s.text && s.text.trim())
    const hasVisualAnchor = Boolean(
      (s.visualAction && s.visualAction.length > 25) ||
      s.shotDetail?.nonSpeakingReaction ||
      s.shotDetail?.blocking ||
      /wide|long|establishing|insert/i.test(s.framing || '')
    )
    if (isDialogue && !hasVisualAnchor) {
      dialogueWithoutAnchor++
      if (dialogueWithoutAnchor >= 4) {
        issues.push({
          code: 'VISUAL_ANCHOR_MISSING',
          severity: 'warning',
          shotIndex: i,
          title: 'Jangkar Visual Tidak Ditemukan',
          description: `Terdapat ${dialogueWithoutAnchor} shot dialog berurutan tanpa aksi visual atau jangkar panggung yang jelas.`,
          suggestion: 'Tambahkan detail blocking, reaksi fisik, atau gunakan shot insert/sudut dinamis sebagai jangkar adegan.'
        })
        dialogueWithoutAnchor = 0
      }
    } else {
      dialogueWithoutAnchor = 0
    }
  }

  // 3d. Four-beat formula check
  const beatsFound = new Set(shots.map((s) => s.beat).filter(Boolean))
  if (beatsFound.size > 0) {
    const requiredBeats: StoryBeatPhase[] = ['hook', 'confrontation', 'twist', 'aftermath']
    const missingBeats = requiredBeats.filter((b) => !beatsFound.has(b))
    if (missingBeats.length > 0) {
      issues.push({
        code: 'FOUR_BEAT_INCOMPLETE',
        severity: 'info',
        title: 'Pola Empat Babak (Four-Beat) Belum Lengkap',
        description: `Struktur dramatik belum mencakup fase: ${missingBeats.join(', ')}.`,
        suggestion: 'Formula drama vertikal ideal: Hook (0-15s) → Konfrontasi (15-45s) → Twist/Pembalikan (45-60s) → Aftermath/Cliffhanger.'
      })
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
  const charCanonical = new Map<string, string>()
  for (const c of registered.characters) {
    const canon = c.name.trim().toLowerCase()
    charCanonical.set(canon, canon)
    for (const a of c.aliases || []) charCanonical.set(a.trim().toLowerCase(), canon)
  }
  const knownChars = new Set([
    ...charCanonical.keys(),
    ...(draft.newAssets || [])
      .filter((a) => a.kind === 'character' && a.action !== 'ignore')
      .map((a) => a.name.trim().toLowerCase())
  ])
  const knownLocs = new Set([
    ...registered.locations.map((l) => l.name.trim().toLowerCase()),
    ...registered.locations.flatMap((l) => l.aliases.map((a) => a.trim().toLowerCase())),
    ...(draft.newAssets || [])
      .filter((a) => a.kind === 'location' && a.action !== 'ignore')
      .map((a) => a.name.trim().toLowerCase())
  ])
  const canonChar = (name: string): string => {
    const key = name.trim().toLowerCase()
    return charCanonical.get(key) ?? key
  }

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]
    const dType = s.shotDetail?.dialogueType ?? defaultDialogueType(s.speaker, s.text)
    const isVisibleDialogue = dType === 'dialogue'
    const speakerTrim = (s.speaker || '').trim()
    if (speakerTrim && isVisibleDialogue && !isNarratorName(speakerTrim) && !knownChars.has(speakerTrim.toLowerCase())) {
      issues.push({
        code: 'UNREGISTERED_SPEAKER',
        severity: 'warning',
        shotIndex: i,
        title: `Pembicara "${speakerTrim}" Belum Terdaftar`,
        description: `Karakter "${speakerTrim}" di Shot ${i + 1} tidak ditemukan di Lorebook maupun usulan aset baru.`,
        suggestion: `Daftarkan "${speakerTrim}" di Lorebook atau tambahkan ke usulan aset baru.`
      })
    }
    if (speakerTrim && isVisibleDialogue && !isNarratorName(speakerTrim)) {
      const spCanon = canonChar(speakerTrim)
      const isVisible = (s.characters || []).some((c) => canonChar(c) === spCanon)
      if (!isVisible) {
        issues.push({
          code: 'SPEAKER_NOT_VISIBLE',
          severity: 'warning',
          shotIndex: i,
          title: `Pembicara "${speakerTrim}" Harus Terlihat di Shot`,
          description: `Untuk dialog langsung (on-screen), karakter "${speakerTrim}" harus masuk daftar karakter shot agar gerak bibir/ekspresi dapat disinkronkan.`,
          suggestion: `Tambahkan "${speakerTrim}" ke karakter shot, atau ubah tipe dialog menjadi O.S. (Off-Screen) / V.O. jika suara datang dari luar layar.`
        })
      }
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

  // 6. Wardrobe continuity check (across contiguous shots in the same non-empty location, including shot-reverse-shot)
  const lastCostumeInBlock = new Map<string, { raw: string; norm: string }>()
  let activeLocKey = ''
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const locKey = (shot.location || '').trim().toLowerCase()
    if (!locKey || locKey !== activeLocKey) {
      lastCostumeInBlock.clear()
      activeLocKey = locKey
    }
    if (!locKey) continue
    const costumeEntries = Object.entries(shot.costumes || {})
    for (const charName of shot.characters || []) {
      const cKey = canonChar(charName)
      const matchedEntry = costumeEntries.find(([k]) => canonChar(k) === cKey)
      const rawCostume = (matchedEntry?.[1] || '').trim()
      const normCostume = isDefaultCostume(rawCostume) ? 'default' : rawCostume.toLowerCase()
      const displayCostume = isDefaultCostume(rawCostume) ? 'default' : rawCostume
      const prev = lastCostumeInBlock.get(cKey)
      if (prev && prev.norm !== normCostume) {
        issues.push({
          code: 'UNEXPLAINED_WARDROBE_CHANGE',
          severity: 'warning',
          shotIndex: i,
          title: `Perubahan Pakaian Mendadak (${charName})`,
          description: `Di Shot ${i + 1}, ${charName} berganti dari "${prev.raw}" ke "${displayCostume}" di lokasi yang sama tanpa jeda waktu.`,
          suggestion: 'Pastikan kostum konsisten sepanjang adegan, kecuali cerita memang memuat adegan ganti pakaian.'
        })
      }
      lastCostumeInBlock.set(cKey, { raw: displayCostume, norm: normCostume })
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

  // 8. Cross-episode continuity checks (Hot items open >3 episodes)
  if (continuityContext?.items && continuityContext.episodes) {
    const allEps = continuityContext.episodes
    const currentIdx = allEps.findIndex((e) => e.id === episode.id)
    if (currentIdx !== -1) {
      for (const item of continuityContext.items) {
        if (item.status === 'open' && item.tier === 'hot') {
          const plantedIdx = allEps.findIndex((e) => e.id === item.plantedEpisodeId)
          if (plantedIdx !== -1) {
            const ageInEpisodes = currentIdx - plantedIdx
            if (ageInEpisodes >= 3) {
              const plantedNum = allEps[plantedIdx].episodeNum ?? plantedIdx + 1
              issues.push({
                code: 'CONTINUITY_OPEN_TOO_LONG',
                severity: 'warning',
                title: `Benang Cerita Belum Dibayar: "${item.name}"`,
                description: `Petunjuk "${item.name}" (${item.kind}) ditanam di Episode ${plantedNum} (${ageInEpisodes} episode lalu) berstatus HOT, tetapi belum pernah diselesaikan atau dibayar.`,
                suggestion: `Bahas atau bayar benang cerita ini pada episode sekarang agar audiens tidak kehilangan jejak, atau tandai sebagai Lunas di Lorebook.`
              })
            }
          }
        }
      }
    }
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
    const hasText = Boolean(s.text?.trim())
    const hasSpeaker = Boolean(s.speaker?.trim() && !isNarratorName(s.speaker))
    let type: 'action' | 'dialogue' | 'reaction' | 'silent' = 'silent'
    if (hasText && hasSpeaker) type = 'dialogue'
    else if (s.shotDetail?.nonSpeakingReaction || s.emotion?.toLowerCase().includes('reaksi')) type = 'reaction'
    else if (!hasText && s.visualAction?.trim()) type = 'action'
    else if (hasText) type = 'dialogue'

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
