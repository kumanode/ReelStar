import { compileClipPrompt, compileClipVideoPrompt } from './prompts'
import type { AspectRatio, Character, CharacterDerivative, Clip, DialogAudio, Location, Prop } from './types'

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
    imageModel: string | null
  }
  clip: Clip
  characters: Character[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  refSheetAssetIds: string[]
}

/**
 * Computes basis hash for a clip image based on direct inputs (§6.J):
 * compiled prompt, ordered reference sheet asset IDs, model, and aspect ratio.
 */
export function computeClipImageBasisHash(params: ClipImageBasisParams): string {
  const { project, clip, characters, derivatives, locations, props, refSheetAssetIds } = params
  const compiledPrompt = compileClipPrompt({
    project,
    clip,
    characters,
    derivatives,
    locations,
    props
  })

  return fnv1a(
    JSON.stringify([
      'image',
      project.imageModel || 'default',
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
    videoModel: string | null
    dialogAudio?: DialogAudio
  }
  clip: Clip
  characters: Character[]
}

/**
 * Computes basis hash for a clip video based on direct inputs (§6.J):
 * compiled video prompt, initial image asset id, clip duration, model, and speech dialogue.
 */
export function computeClipVideoBasisHash(params: ClipVideoBasisParams): string {
  const { project, clip, characters } = params
  const compiledVideoPrompt = compileClipVideoPrompt(project, clip, characters)
  const durationSec = Math.max(1, Math.round(clip.durationMs / 1000))

  return fnv1a(
    JSON.stringify([
      'video',
      project.videoModel || 'default',
      clip.imageAssetId || null,
      durationSec,
      compiledVideoPrompt,
      project.dialogAudio || 'tts',
      clip.speakerId && project.dialogAudio === 'video' ? clip.narration.trim() : null
    ])
  )
}

/** Basis hash for a character 3-view reference sheet. */
export function computeCharacterSheetBasisHash(params: {
  name: string
  description: string
  styleId: string
  imageModel: string | null
}): string {
  return fnv1a(
    JSON.stringify([
      'character-sheet',
      params.name.trim(),
      params.description.trim(),
      params.styleId,
      params.imageModel || 'default'
    ])
  )
}

/** Basis hash for a character costume variant sheet. */
export function computeDerivativeSheetBasisHash(params: {
  baseSheetAssetId: string | null
  promptChange: string
  imageModel: string | null
}): string {
  return fnv1a(
    JSON.stringify([
      'derivative-sheet',
      params.baseSheetAssetId || null,
      params.promptChange.trim(),
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
}): string {
  return fnv1a(
    JSON.stringify([
      'location-sheet',
      params.name.trim(),
      (params.description || '').trim(),
      params.styleId,
      params.imageModel || 'default'
    ])
  )
}

/** Basis hash for a prop reference sheet. */
export function computePropSheetBasisHash(params: {
  name: string
  description: string
  styleId: string
  imageModel: string | null
}): string {
  return fnv1a(
    JSON.stringify([
      'prop-sheet',
      params.name.trim(),
      (params.description || '').trim(),
      params.styleId,
      params.imageModel || 'default'
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
