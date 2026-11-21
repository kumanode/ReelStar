import { compileClipPrompt, compileClipVideoPrompt } from './prompts'
import type { AspectRatio, Character, CharacterDerivative, Clip, DialogAudio, Location, Prop, LockWord } from './types'

/**
 * 64-bit FNV-1a hash implementation in pure TypeScript.
 * Deterministic across Node.js and browser environments.
 */
export function fnv1a(str: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ 0x2289412e
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 0x01000193)
    h2 = Math.imul(h2 ^ (ch >>> 4), 0x01000193)
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return `${part1}${part2}`
}

export interface ClipImageBasisParams {
  project: {
    id: string
    styleId: string
    aspectRatio: AspectRatio
    imageModel?: string | null
  }
  clip: Clip
  characters: Character[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  refSheetAssetIds: string[]
  lockWords?: LockWord[]
  imageModel?: string | null
}

/**
 * Computes basis hash for a clip image based on direct inputs (§6.J):
 * compiled prompt, ordered reference sheet asset IDs, model, and aspect ratio.
 */
export function computeClipImageBasisHash(params: ClipImageBasisParams): string {
  const { project, clip, characters, derivatives, locations, props, refSheetAssetIds, lockWords } = params
  const activeImageModel = params.imageModel || project.imageModel || 'default'
  const compiledPrompt = compileClipPrompt({
    project: { id: project.id, styleId: project.styleId, aspectRatio: project.aspectRatio },
    clip,
    characters,
    derivatives,
    locations,
    props,
    lockWords
  })

  return fnv1a(
    JSON.stringify([
      'image',
      activeImageModel,
      project.aspectRatio,
      compiledPrompt,
      refSheetAssetIds
    ])
  )
}

export interface ClipVideoBasisParams {
  project: {
    styleId: string
    aspectRatio: AspectRatio
    videoModel?: string | null
    dialogAudio?: DialogAudio
  }
  clip: Clip
  characters: Character[]
  /** The video length actually requested (videoSecondsFor), not the clip length: a dialogue clip takes the
   *  video's length afterwards, and that must not make the same video look stale. */
  seconds: number
  prevAssetId?: string | null
  lockWords?: LockWord[]
  videoModel?: string | null
}

/**
 * Computes basis hash for a clip video based on direct inputs (§6.J):
 * compiled video prompt, initial image asset id, clip duration, model, and speech dialogue.
 */
export function computeClipVideoBasisHash(params: ClipVideoBasisParams): string {
  const { project, clip, characters, seconds, prevAssetId, lockWords } = params
  const activeVideoModel = params.videoModel || project.videoModel || 'default'
  const compiledVideoPrompt = compileClipVideoPrompt(project, clip, characters, lockWords || [])
  const durationSec = seconds

  return fnv1a(
    JSON.stringify([
      'video',
      activeVideoModel,
      clip.continueFromPrevious ? `prev:${prevAssetId || 'none'}` : clip.imageAssetId || null,
      durationSec,
      compiledVideoPrompt,
      project.dialogAudio || 'tts',
      clip.speakerId && project.dialogAudio === 'video' ? clip.narration.trim() : null,
      Boolean(clip.continueFromPrevious)
    ])
  )
}

/**
 * Profiles read from the database default to {} and may hold empty strings, while older callers passed none.
 * Both mean "no profile", so they hash the same; otherwise every sheet would turn stale without any edit.
 */
function profileKey(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object') return null
  const filled = Object.entries(profile as Record<string, unknown>).filter(
    ([, v]) => v != null && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length)
  )
  return filled.length ? JSON.stringify(Object.fromEntries(filled.sort(([a], [b]) => a.localeCompare(b)))) : null
}

/** Basis hash for a character 3-view reference sheet. */
export function computeCharacterSheetBasisHash(params: {
  name: string
  description: string
  styleId: string
  imageModel: string | null
  profile?: unknown
}): string {
  return fnv1a(
    JSON.stringify([
      'character-sheet',
      params.name.trim(),
      params.description.trim(),
      params.styleId,
      params.imageModel || 'default',
      profileKey(params.profile)
    ])
  )
}

/** Basis hash for a character costume variant sheet. */
export function computeDerivativeSheetBasisHash(params: {
  baseSheetAssetId: string | null
  promptChange: string
  imageModel: string | null
  costumeKeyphrase?: string
}): string {
  return fnv1a(
    JSON.stringify([
      'derivative-sheet',
      params.baseSheetAssetId || null,
      params.promptChange.trim(),
      params.costumeKeyphrase ? params.costumeKeyphrase.trim() : '',
      params.imageModel || 'default'
    ])
  )
}

/** Basis hash for a location environment sheet. */
export function computeLocationSheetBasisHash(params: {
  name: string
  description: string
  styleId: string
  imageModel: string | null
  profile?: unknown
}): string {
  return fnv1a(
    JSON.stringify([
      'location-sheet',
      params.name.trim(),
      (params.description || '').trim(),
      params.styleId,
      params.imageModel || 'default',
      profileKey(params.profile)
    ])
  )
}

/** Basis hash for a prop reference sheet. */
export function computePropSheetBasisHash(params: {
  name: string
  description: string
  styleId: string
  imageModel: string | null
  profile?: unknown
}): string {
  return fnv1a(
    JSON.stringify([
      'prop-sheet',
      params.name.trim(),
      (params.description || '').trim(),
      params.styleId,
      params.imageModel || 'default',
      profileKey(params.profile)
    ])
  )
}

/** Basis hash for a clip narration TTS take. */
export function computeClipTtsBasisHash(params: {
  narration: string
  voice: string
  ttsProvider: string
}): string {
  return fnv1a(
    JSON.stringify([
      'tts',
      params.ttsProvider,
      params.voice,
      params.narration.trim()
    ])
  )
}
