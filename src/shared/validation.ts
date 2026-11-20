import { FLOW2API_VIDEO_MODELS, getFlow2ApiModel } from './flow2api-catalog'
import { getImageModel, getVideoModel, maxRefs } from './higgsfield'
import { collectReferenceSheets } from './prompts'
import { computeClipImageBasisHash, computeClipVideoBasisHash, computeClipTtsBasisHash } from './hash'
import { estimateNarrationMs } from './script'
import type { Asset, Character, CharacterDerivative, Clip, Job, Location, Project, Prop } from './types'

export type ClipGenerationStatus = 'current' | 'stale' | 'missing' | 'blocked'

export interface GenerationPrerequisitesContext {
  characters: Character[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  assets: Asset[] | Record<string, Asset>
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

  if (!clip.imageAssetId || !findAsset(ctx.assets, clip.imageAssetId)) {
    blockers.push('Klip belum punya gambar storyboard. Buat gambarnya dulu.')
  }

  if (clip.speakerId && project.dialogAudio === 'video') {
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
  const basisHash = computeClipVideoBasisHash({ project, clip, characters: ctx.characters })
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
