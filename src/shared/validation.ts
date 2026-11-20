import { FLOW2API_VIDEO_MODELS, getFlow2ApiModel } from './flow2api-catalog'
import { getVideoModel } from './higgsfield'
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
}

export interface PrerequisitesCheckResult {
  ok: boolean
  blockers: string[]
}

export interface ClipStatusResult {
  status: ClipGenerationStatus
  blockers: string[]
  basisHash: string
}

function findAsset(assets: Asset[] | Record<string, Asset>, id: string | null | undefined): Asset | null {
  if (!id) return null
  if (Array.isArray(assets)) {
    return assets.find((a) => a.id === id) ?? null
  }
  return assets[id] ?? null
}

/**
 * Validates pre-generation prerequisites for generating a clip image (§6.I).
 */
export function checkClipImagePrerequisites(
  clip: Clip,
  _project: Project,
  ctx: GenerationPrerequisitesContext
): PrerequisitesCheckResult {
  const blockers: string[] = []
  const charMap = new Map(ctx.characters.map((c) => [c.id, c]))
  const derivMap = new Map(ctx.derivatives.map((d) => [d.id, d]))
  const locMap = new Map(ctx.locations.map((l) => [l.id, l]))
  const propMap = new Map(ctx.props.map((p) => [p.id, p]))

  // 1. Character & costume variant checks
  for (const cid of clip.characterIds || []) {
    const ch = charMap.get(cid)
    if (!ch) {
      blockers.push(`Karakter tidak terdaftar di Lorebook.`)
      continue
    }

    const costumeId = clip.costumeIds?.[cid]
    if (costumeId) {
      const deriv = derivMap.get(costumeId)
      if (!deriv) {
        blockers.push(`Varian kostum untuk "${ch.name}" tidak terdaftar di Lorebook.`)
      } else if (!deriv.sheetAssetId || !findAsset(ctx.assets, deriv.sheetAssetId)) {
        blockers.push(`Varian kostum "${deriv.name}" (${ch.name}) belum memiliki lembar referensi.`)
      }
    } else {
      if (!ch.sheetAssetId || !findAsset(ctx.assets, ch.sheetAssetId)) {
        blockers.push(`Karakter "${ch.name}" belum memiliki lembar referensi dasar.`)
      }
    }
  }

  // 2. Location check
  if (clip.locationId) {
    const loc = locMap.get(clip.locationId)
    if (!loc) {
      blockers.push(`Lokasi tidak terdaftar di Lorebook.`)
    } else if (!loc.sheetAssetId || !findAsset(ctx.assets, loc.sheetAssetId)) {
      blockers.push(`Lokasi "${loc.name}" belum memiliki lembar referensi.`)
    }
  }

  // 3. Prop checks
  for (const pid of clip.propIds || []) {
    const pr = propMap.get(pid)
    if (!pr) {
      blockers.push(`Prop tidak terdaftar di Lorebook.`)
    } else if (!pr.sheetAssetId || !findAsset(ctx.assets, pr.sheetAssetId)) {
      blockers.push(`Prop "${pr.name}" belum memiliki lembar referensi.`)
    }
  }

  // 4. Active job check
  if (
    ctx.activeJobs?.some(
      (j) => j.clipId === clip.id && j.kind === 'image' && (j.status === 'queued' || j.status === 'running')
    )
  ) {
    blockers.push(`Proses generate gambar sedang berjalan untuk adegan ini.`)
  }

  return {
    ok: blockers.length === 0,
    blockers
  }
}

/**
 * Validates pre-generation prerequisites for generating a clip video (§6.I).
 */
export function checkClipVideoPrerequisites(
  clip: Clip,
  project: Project,
  ctx: GenerationPrerequisitesContext
): PrerequisitesCheckResult {
  const blockers: string[] = []

  // 1. Initial image prerequisite
  if (!clip.imageAssetId || !findAsset(ctx.assets, clip.imageAssetId)) {
    blockers.push(`Klip belum memiliki gambar storyboard. Buat gambar terlebih dahulu.`)
  }

  // 2. Also check base entity prerequisites
  const imgPrereqs = checkClipImagePrerequisites(clip, project, ctx)
  for (const b of imgPrereqs.blockers) {
    if (!b.includes('generate gambar sedang berjalan')) {
      blockers.push(b)
    }
  }

  // 3. Duration check against video model
  const durationSec = Math.max(1, Math.round(clip.durationMs / 1000))
  if (ctx.isFlow2Api) {
    const cleanId = (project.videoModel || '').trim().replace(/-\d+s-(landscape|portrait)$/, '').replace(/-(landscape|portrait)$/, '')
    const known = FLOW2API_VIDEO_MODELS.find((m) => m.id === cleanId)
    const model = known ?? getFlow2ApiModel(null, 'video')
    if (model.durations.length > 0 && !model.durations.includes(durationSec)) {
      blockers.push(
        `Durasi klip (${durationSec} dtk) tidak didukung model video ${model.name}. Pilihan yang didukung: ${model.durations.join(', ')} dtk.`
      )
    }
  } else {
    try {
      const model = getVideoModel(project.videoModel)
      if (model.durations) {
        if ('values' in model.durations && !model.durations.values.includes(durationSec)) {
          blockers.push(
            `Durasi klip (${durationSec} dtk) tidak didukung model ${model.name}. Pilihan: ${model.durations.values.join(', ')} dtk.`
          )
        } else if ('min' in model.durations && (durationSec < model.durations.min || durationSec > model.durations.max)) {
          blockers.push(
            `Durasi klip (${durationSec} dtk) di luar batas model ${model.name} (${model.durations.min}–${model.durations.max} dtk).`
          )
        }
      }
    } catch {
      // Model might not be resolved, let backend handle fallback
    }
  }

  // 4. Video dialogue prerequisites (§6.C)
  if (clip.speakerId && project.dialogAudio === 'video') {
    const speaker = ctx.characters.find((c) => c.id === clip.speakerId)
    if (!speaker) {
      blockers.push(`Pembicara dialog tidak terdaftar di Lorebook.`)
    } else if (!(clip.characterIds || []).includes(clip.speakerId)) {
      blockers.push(`Pembicara "${speaker.name}" harus termasuk dalam karakter yang terlihat di adegan ini.`)
    }

    if (!clip.narration.trim()) {
      blockers.push(`Teks dialog masih kosong.`)
    } else {
      const estMs = estimateNarrationMs(clip.narration)
      if (estMs > clip.durationMs + 1000) {
        blockers.push(
          `Ucapan dialog (${Math.round(estMs / 1000)} dtk) melebihi durasi video (${durationSec} dtk). Pecah adegan atau perpendek kalimat.`
        )
      }
    }
  }

  // 5. Active job check
  if (
    ctx.activeJobs?.some(
      (j) => j.clipId === clip.id && j.kind === 'video' && (j.status === 'queued' || j.status === 'running')
    )
  ) {
    blockers.push(`Proses generate video sedang berjalan untuk adegan ini.`)
  }

  return {
    ok: blockers.length === 0,
    blockers
  }
}

/**
 * Validates pre-generation prerequisites for generating clip TTS audio (§6.I).
 */
export function checkClipAudioPrerequisites(
  clip: Clip,
  _project: Project,
  ctx: GenerationPrerequisitesContext
): PrerequisitesCheckResult {
  const blockers: string[] = []

  if (!clip.narration.trim()) {
    blockers.push(`Naskah narasi masih kosong.`)
  }

  if (
    ctx.activeJobs?.some(
      (j) => j.clipId === clip.id && j.kind === 'tts' && (j.status === 'queued' || j.status === 'running')
    )
  ) {
    blockers.push(`Proses pembuatan suara sedang berjalan untuk adegan ini.`)
  }

  return {
    ok: blockers.length === 0,
    blockers
  }
}

/**
 * Computes the generation status (current, stale, missing, or blocked) for a clip image (§6.J).
 */
export function getClipImageStatus(
  clip: Clip,
  project: Project,
  ctx: GenerationPrerequisitesContext
): ClipStatusResult {
  const prereqs = checkClipImagePrerequisites(clip, project, ctx)

  const refItems = collectReferenceSheets(
    clip,
    ctx.characters,
    ctx.derivatives,
    ctx.locations,
    ctx.props,
    3
  )
  const basisHash = computeClipImageBasisHash({
    project,
    clip,
    characters: ctx.characters,
    derivatives: ctx.derivatives,
    locations: ctx.locations,
    props: ctx.props,
    refSheetAssetIds: refItems.map((r) => r.sheetAssetId)
  })

  if (!prereqs.ok) {
    return {
      status: 'blocked',
      blockers: prereqs.blockers,
      basisHash
    }
  }

  const asset = findAsset(ctx.assets, clip.imageAssetId)
  if (!asset) {
    return {
      status: 'missing',
      blockers: [],
      basisHash
    }
  }

  const assetBasisHash = (asset.meta as Record<string, unknown> | undefined)?.basisHash
  if (assetBasisHash === basisHash) {
    return {
      status: 'current',
      blockers: [],
      basisHash
    }
  }

  return {
    status: 'stale',
    blockers: [],
    basisHash
  }
}

/**
 * Computes the generation status (current, stale, missing, or blocked) for a clip video (§6.J).
 */
export function getClipVideoStatus(
  clip: Clip,
  project: Project,
  ctx: GenerationPrerequisitesContext
): ClipStatusResult {
  const prereqs = checkClipVideoPrerequisites(clip, project, ctx)

  const basisHash = computeClipVideoBasisHash({
    project,
    clip,
    characters: ctx.characters
  })

  if (!prereqs.ok) {
    return {
      status: 'blocked',
      blockers: prereqs.blockers,
      basisHash
    }
  }

  const asset = findAsset(ctx.assets, clip.videoAssetId)
  if (!asset) {
    return {
      status: 'missing',
      blockers: [],
      basisHash
    }
  }

  const assetBasisHash = (asset.meta as Record<string, unknown> | undefined)?.basisHash
  if (assetBasisHash === basisHash) {
    return {
      status: 'current',
      blockers: [],
      basisHash
    }
  }

  return {
    status: 'stale',
    blockers: [],
    basisHash
  }
}

/**
 * Computes the generation status for clip TTS audio (§6.J).
 */
export function getClipAudioStatus(
  clip: Clip,
  project: Project,
  ctx: GenerationPrerequisitesContext
): ClipStatusResult {
  const prereqs = checkClipAudioPrerequisites(clip, project, ctx)

  const char = clip.speakerId ? ctx.characters.find((c) => c.id === clip.speakerId) : null
  const voice = (char?.ttsProvider === project.ttsProvider ? char?.ttsVoice : null) || project.ttsVoice || ''
  const basisHash = computeClipTtsBasisHash({
    narration: clip.narration,
    voice,
    ttsProvider: project.ttsProvider
  })

  if (!prereqs.ok) {
    return {
      status: 'blocked',
      blockers: prereqs.blockers,
      basisHash
    }
  }

  const asset = findAsset(ctx.assets, clip.audioAssetId)
  if (!asset) {
    return {
      status: 'missing',
      blockers: [],
      basisHash
    }
  }

  const assetBasisHash = (asset.meta as Record<string, unknown> | undefined)?.basisHash
  if (assetBasisHash === basisHash) {
    return {
      status: 'current',
      blockers: [],
      basisHash
    }
  }

  return {
    status: 'stale',
    blockers: [],
    basisHash
  }
}
