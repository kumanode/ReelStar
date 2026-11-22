import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { estimateWordTimings, WHISPER_TIMING } from '@shared/captions'
import { spokenWords, stripVoiceTags } from '@shared/speech'
import { computeSpeechTrimWindow } from '@shared/timeline'
import { getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, resolutionOptions, videoBody, type HfModel } from '@shared/higgsfield'
import { getStyle, NO_TEXT, resolveStylePrompt } from '@shared/styles'
import {
  collectReferenceSheets,
  compileClipPrompt,
  compileClipVideoPrompt,
  findPlannedAnchorClipId,
  findSceneAnchorForClip,
  formatCharacterTraits,
  formatLocationDetails,
  formatPropDetails,
  type ReferenceSheetItem
} from '@shared/prompts'
import { resolveActive, withActiveTts } from '@shared/providers'
import {
  computeClipTtsBasisHash,
  computeClipVideoBasisHash,
} from '@shared/hash'
import {
  checkClipImagePrerequisites,
  checkClipVideoPrerequisites,
  clipImageBasis,
  getClipImageStatus,
  getClipVideoStatus,
  getCharacterSheetStatus,
  getDerivativeSheetStatus,
  getLocationSheetStatus,
  getPropSheetStatus,
  isVideoDialogue,
  planBatch,
  planBatchSheets,
  referenceLimit,
  videoSecondsFor,
  type ClipStatusResult,
  type SheetStatusResult,
  type GenerationPrerequisitesContext
} from '@shared/validation'
import type {
  AspectRatio,
  Asset,
  BatchEstimateItem,
  BatchEstimateResult,
  BatchEstimateSheetItem,
  BatchEstimateSheetResult,
  SeriesProgressSummary,
  Character,
  CharacterDerivative,
  Clip,
  CreditEstimate,
  Job,
  Location,
  LockWord,
  PrerequisiteSheetEstimate,
  Project,
  Prop,
  ThumbnailRequest,
  WordTiming
} from '@shared/types'
import { getDb } from './db'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { assetAbsPath, dataDir } from './paths'
import {
  activeJobFor,
  activeJobsOf,
  assetsOf,
  charactersOf,
  clipsOf,
  derivativesOf,
  firstClipOf,
  getAsset,
  getCharacter,
  getClip,
  getDerivative,
  getEpisode,
  getJob,
  getLocation,
  getProject,
  getProp,
  insertAsset,
  insertJob,
  listEpisodes,
  locationsOf,
  patchClip,
  propsOf,
  setCharacterSheet,
  setDerivativeSheet,
  setLocationSheet,
  setPropSheet,
  touchProject,
  unfinishedJobs,
  updateAssetMeta,
  updateJob
} from './repo'
import { dropCache, getSettings, readCache, writeCache } from './settings'
import { extractAudio, extractLastFrame, probeDurationMs, probeHasAudio, probeSize } from './services/audio'
import { timeScript, whisperReady } from './whisper'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as f2a from './services/flow2api'
import * as hf from './services/higgsfield'
import { getFlow2ApiModel, resolveFlow2ApiModelId, resolveFlow2ApiVideo } from '@shared/flow2api-catalog'
import { downloadTo, sleep } from './services/http'

const DAY = 24 * 60 * 60 * 1000

function extFromType(contentType: string, url: string, fallback: string): string {
  if (/png/.test(contentType)) return '.png'
  if (/jpe?g/.test(contentType)) return '.jpg'
  if (/webp/.test(contentType)) return '.webp'
  if (/mp4/.test(contentType)) return '.mp4'
  const m = /\.(png|jpe?g|webp|mp4|mov)(\?|$)/i.exec(url)
  return m ? `.${m[1].toLowerCase()}` : fallback
}

function saveFile(projectId: string, folder: string, ext: string, bytes: Buffer): string {
  const rel = `${folder}/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  return rel
}

/** A URL Higgsfield can fetch for a stored asset: its own recent result URL, or a fresh upload. */
async function publicUrlFor(asset: Asset, signal: AbortSignal): Promise<string> {
  if (asset.remoteUrl && asset.provider === 'higgsfield' && Date.now() - asset.createdAt < 6 * DAY) return asset.remoteUrl
  const up = asset.meta.uploadedUrl as string | undefined
  const at = asset.meta.uploadedAt as number | undefined
  if (up && at && Date.now() - at < 0.5 * DAY) return up
  const url = await hf.uploadFile(assetAbsPath(asset.projectId, asset.localPath), signal)
  updateAssetMeta(asset.id, { ...asset.meta, uploadedUrl: url, uploadedAt: Date.now() })
  return url
}

function imageProgress(ctx: TaskCtx, what: string) {
  return (status: hf.HfStatus, elapsed: number): void => {
    if (status === 'queued') ctx.progress(0.12, 'Mengantre di Higgsfield')
    else ctx.progress(0.12, `${what} · ${Math.floor(elapsed / 1000)} dtk`)
  }
}

// ---------- prompts ----------

function characterLine(c: Character): string {
  const traits = formatCharacterTraits(c, true)
  return traits ? `${c.name}: ${traits}` : `${c.name}: ${c.description}`
}

function applyTemplate(template: string | undefined, vars: Record<string, string>): string | null {
  const raw = template?.trim()
  if (!raw) return null
  return raw.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

function sheetPrompt(project: Project, c: Character): string {
  const { style, prompt: stylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const fullTraits = formatCharacterTraits(c, true) || c.description || c.name
  const paletteNote = isRestrictedPalette ? ' Render strictly within the monochrome or restricted palette of the art style above.' : ''
  const custom = applyTemplate(project.promptTemplates?.character_sheet, {
    name: c.name,
    description: fullTraits
  })
  if (custom) {
    return [stylePrompt, custom, `The character is ${style.characterHint}.${paletteNote} No text, no labels, no watermarks.`].join('\n\n')
  }
  const renderCue =
    style.category === 'animation'
      ? 'even clean lighting matching the exact target art style above so face design, garment cut, textile motif/pattern, footwear, and accessories are unmistakable'
      : 'even soft studio lighting so true face colors, garment cut, textile motif/pattern, footwear, and accessories are unmistakable'
  return [
    stylePrompt,
    `Master character reference sheet for "${c.name}": ${fullTraits}. The character is ${style.characterHint}.${paletteNote}`,
    'Layout: a clean horizontal character model sheet showing a razor-sharp close-up head-and-shoulders face portrait on the far left (capturing exact eye shape, features, hairline, eyewear/jewelry, and collar/fabric pattern clearly for close-ups), followed side-by-side by THREE full-body turnaround views of the EXACT SAME character: front view, three-quarter view, and side profile view in a neutral standing pose, evenly spaced.',
    `Plain flat light-gray neutral backdrop (overrides any background cue in the style above), ${renderCue}. Identical face, hairstyle, proportions, and default outfit across every view. No text, no annotations, no arrows, no watermarks.`
  ].join('\n\n')
}

function derivativeSheetPrompt(project: Project, c: Character, d: CharacterDerivative): string {
  const { style, prompt: stylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const identityOnly = formatCharacterTraits(c, false) || c.description || c.name
  const costumeDesc = [d.promptChange, d.costumeKeyphrase ? `Key locked costume elements: ${d.costumeKeyphrase}` : '']
    .filter(Boolean)
    .join('. ')
  const paletteNote = isRestrictedPalette ? ' Render strictly within the monochrome or restricted palette of the art style above.' : ''
  const custom = applyTemplate(project.promptTemplates?.derivative_sheet, {
    name: c.name,
    variantName: d.name,
    description: identityOnly,
    costumeChange: costumeDesc
  })
  if (custom) {
    return [
      stylePrompt,
      'Reference Image 1 is the base character sheet for this exact character. Strictly preserve the exact same face, eyes, facial structure, hairstyle, age, and body proportions from Reference Image 1—change ONLY the clothing/styling.',
      custom,
      `The character is ${style.characterHint}.${paletteNote} No text, no labels, no watermarks.`
    ].join('\n\n')
  }
  return [
    stylePrompt,
    `Reference Image 1 is the master character sheet for "${c.name}". STRICT IDENTITY LOCK: preserve the EXACT SAME face, eyes, facial structure, hairstyle, age, and body build from Reference Image 1 (${identityOnly}). Change ONLY the outfit and styling.${paletteNote}`,
    `Costume variant "${d.name}": ${costumeDesc || 'modified attire'}. The character is ${style.characterHint}.`,
    'Layout: match Reference Image 1 cleanly—show a crisp close-up head-and-shoulders portrait alongside front, three-quarter, and side full-body standing views of this SAME character wearing the new costume, evenly spaced on a plain flat light-gray neutral backdrop. Identical face and new outfit details across all views. No text, no labels, no watermarks.'
  ].join('\n\n')
}

function locationSheetPrompt(project: Project, l: Location): string {
  const { prompt: stylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const fullDetails = formatLocationDetails(l)
  const paletteNote = isRestrictedPalette ? ' Render strictly within the monochrome or restricted palette of the art style above.' : ''
  const custom = applyTemplate(project.promptTemplates?.location_sheet, {
    name: l.name,
    description: fullDetails
  })
  if (custom) {
    return [stylePrompt, custom, `Strictly NO people, NO characters, empty environment reference, no text or watermarks.${paletteNote}`].join('\n\n')
  }
  return [
    stylePrompt,
    `Master location environment reference for "${l.name}": ${fullDetails}.${paletteNote}`,
    'Single unbroken wide architectural or landscape corner establishing frame positioned to reveal at least two to three walls (or clear spatial boundaries), ground/floor, ceiling/sky, windows/doors, primary furniture/landmarks, surface textures, palette, and exact light direction together for 3D multi-POV scene continuity. Rendered strictly in the target art style above. Strictly NO people, NO silhouettes, NO characters, no split-screen grid lines, empty scenery, crisp detail, no text or watermarks.'
  ].join('\n\n')
}

function propSheetPrompt(project: Project, p: Prop): string {
  const { style, prompt: stylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const fullDetails = formatPropDetails(p)
  const significance = p.profile?.significance ? ` Story context: ${p.profile.significance}.` : ''
  const paletteNote = isRestrictedPalette ? ' Render strictly within the monochrome or restricted palette of the art style above.' : ''
  const custom = applyTemplate(project.promptTemplates?.prop_sheet, {
    name: p.name,
    description: `${fullDetails}${significance}`
  })
  if (custom) {
    return [stylePrompt, custom, `Isolated object reference, NO people, NO hands, no text or watermarks.${paletteNote}`].join('\n\n')
  }
  const renderCue =
    style.category === 'animation'
      ? 'rendered strictly in the exact target art style above with clean even lighting'
      : 'with even soft studio lighting'
  return [
    stylePrompt,
    `Master prop reference sheet for "${p.name}": ${fullDetails}.${significance}${paletteNote}`,
    `Clean horizontal reference sheet showing TWO views of this EXACT SAME single hero object side-by-side: a crisp three-quarter hero view on the left and a top-down or detail close-up view on the right, clearly showing exact proportions, surface texture, material finish, clasps/markings, and palette on a plain flat light-gray neutral backdrop ${renderCue}. Strictly NO people, NO hands holding it, no text, no labels, no watermarks.`
  ].join('\n\n')
}

// ---------- waiting for character sheets ----------

async function waitForSheets(characterIds: string[], signal: AbortSignal): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 15 * 60 * 1000) {
    const pending = characterIds.some((id) => activeJobFor({ characterId: id }, 'sheet'))
    if (!pending) return
    await sleep(2000, signal)
  }
}

/**
 * When a shot belongs to the same contiguous location block as an earlier anchor shot whose image is
 * currently generating (e.g. during a batch), wait without holding a queue slot so this POV shot
 * inherits the freshly rendered Scene Continuity Anchor image for consistent background & prop placement.
 */
async function waitForSceneAnchorImage(clip: Clip, signal: AbortSignal, onWait?: () => void): Promise<void> {
  if (!clip.locationId || clip.shotDetail?.sceneAnchorMode === 'off') return
  const episodeClips = clipsOf(clip.projectId, clip.episodeId)
  const anchorId = findPlannedAnchorClipId(clip, episodeClips)
  if (!anchorId || anchorId === clip.id) return
  const started = Date.now()
  let notified = false
  while (Date.now() - started < 15 * 60 * 1000) {
    if (!activeJobFor({ clipId: anchorId }, 'image')) return
    if (!notified) {
      notified = true
      onWait?.()
    }
    await sleep(1500, signal)
  }
}

/**
 * When a shot continues from the previous shot's last frame and the previous shot's video is currently
 * generating (e.g. during a batch), wait for that video to finish so we extract its real final frame
 * instead of falling back to its static storyboard image.
 */
async function waitForPreviousClipVideo(clip: Clip, signal: AbortSignal, onWait?: () => void): Promise<void> {
  if (!clip.continueFromPrevious) return
  const episodeClips = clipsOf(clip.projectId, clip.episodeId).sort((a, b) => a.sort - b.sort)
  const idx = episodeClips.findIndex((c) => c.id === clip.id)
  if (idx <= 0) return
  const prevId = episodeClips[idx - 1].id
  const started = Date.now()
  let notified = false
  while (Date.now() - started < 15 * 60 * 1000) {
    if (!activeJobFor({ clipId: prevId }, 'video')) return
    if (!notified) {
      notified = true
      onWait?.()
    }
    await sleep(2000, signal)
  }
}

async function resolveReferenceUrls(
  model: HfModel,
  items: ReferenceSheetItem[],
  signal: AbortSignal
): Promise<{ urls: string[]; names: string[]; items: ReferenceSheetItem[] }> {
  const limit = maxRefs(model)
  if (limit === 0 || !items.length) return { urls: [], names: [], items: [] }
  const urls: string[] = []
  const names: string[] = []
  const loaded: ReferenceSheetItem[] = []
  for (const it of items) {
    if (urls.length >= limit) break
    const sheet = getAsset(it.sheetAssetId)
    if (!sheet) continue
    urls.push(await publicUrlFor(sheet, signal))
    names.push(it.name)
    loaded.push(it)
  }
  return { urls, names, items: loaded }
}

// ---------- finishing a Higgsfield request (also used to resume after a restart) ----------

interface HfPayload {
  target: 'clip-image' | 'sheet' | 'clip-video' | 'thumbnail' | 'derivative-sheet' | 'location-sheet' | 'prop-sheet'
  model: string
  prompt: string
  resolution?: string
  derivativeId?: string
  locationId?: string
  propId?: string
  basisHash?: string
  credits?: number
  autoTrimSilence?: boolean
}

/**
 * Takes the spoken line out of a freshly generated dialogue video and makes it the clip's voice (§6.C), with
 * caption words timed by Whisper. The clip takes the video's length so the line is never cut at the old clip end,
 * or trims leading/trailing silence non-destructively when `autoTrimSilence` is enabled and Whisper succeeded.
 * When the video has no usable sound the reason is stored on the video asset, so the storyboard can say so instead
 * of leaving a silent clip (narration skips dialogue clips, so nothing else would voice it).
 */
export async function extractVideoDialogueAudio(
  projectId: string,
  clipId: string,
  video: Asset,
  signal?: AbortSignal,
  autoTrimSilence = true
): Promise<Asset | null> {
  const project = getProject(projectId)
  const clip = getClip(clipId)
  if (!isVideoDialogue(project, clip)) return null
  const videoAbs = assetAbsPath(project.id, video.localPath)

  const fail = (reason: string): null => {
    console.warn(`[videoDialogue] ${reason}`)
    const fresh = getAsset(video.id)
    if (fresh) {
      updateAssetMeta(fresh.id, { ...fresh.meta, dialogAudioError: reason })
      const updated = getAsset(fresh.id)
      if (updated) emit.asset(updated)
    }
    return null
  }

  if (!(await probeHasAudio(videoAbs).catch(() => false))) return fail('video tidak punya jalur suara')

  const rel = `audio/${randomUUID()}.wav`
  const abs = assetAbsPath(project.id, rel)
  mkdirSync(dirname(abs), { recursive: true })
  try {
    await extractAudio(videoAbs, abs, signal)
  } catch (err) {
    if (signal?.aborted) throw err
    return fail((err as Error).message)
  }

  const durationMs = await probeDurationMs(abs).catch(() => null)
  const durationSec = durationMs ? durationMs / 1000 : 0
  const scriptWords = spokenWords(clip.narration)

  let words: WordTiming[] = estimateWordTimings(clip.narration, durationSec)
  let estimated = true
  let timedBy: string | undefined
  if (getSettings().whisperAuto && whisperReady() && scriptWords.length && durationSec > 0) {
    const tmp = join(dataDir(), 'tmp', `dialog-align-${randomUUID()}`)
    try {
      const timed = await timeScript(abs, scriptWords, project.language, durationSec, tmp, signal)
      if (timed?.length) {
        words = timed
        estimated = false
        timedBy = WHISPER_TIMING
      }
    } catch (e) {
      if (signal?.aborted) throw e
      console.warn('[whisper-dialog]', (e as Error).message)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  const asset = insertAsset({
    projectId: project.id,
    clipId: clip.id,
    kind: 'audio',
    provider: 'video',
    prompt: clip.narration,
    localPath: rel,
    durationMs,
    // videoAssetId pairs the voice with its video, so picking an older video from history brings its voice back.
    meta: { words, estimatedTimings: estimated, source: 'video', videoAssetId: video.id, ...(timedBy ? { timedBy } : {}) }
  })
  emit.asset(asset)

  const totalMs = Math.max(1000, video.durationMs ?? durationMs ?? clip.durationMs)
  const trim = autoTrimSilence && timedBy === WHISPER_TIMING ? computeSpeechTrimWindow(words, totalMs) : null
  const patch: Partial<Clip> = trim
    ? {
        audioAssetId: asset.id,
        mediaInMs: trim.mediaInMs,
        durationMs: trim.durationMs,
        voiceInMs: trim.voiceInMs,
        voiceOutMs: trim.voiceOutMs,
        voiceStartMs: trim.voiceStartMs
      }
    : {
        audioAssetId: asset.id,
        durationMs: totalMs,
        voiceInMs: 0,
        voiceOutMs: null,
        voiceStartMs: 0
      }
  patchClip(clip.id, patch)
  emit.clip({ clipId: clip.id, patch })
  touchProject(project.id)
  return asset
}

async function finishHiggsfield(ctx: TaskCtx, job: Job, requestId: string, payload: HfPayload): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const progressLabel =
    isVideo
      ? 'Membuat video'
      : payload.target === 'sheet'
        ? 'Membuat lembar karakter'
        : payload.target === 'derivative-sheet'
          ? 'Membuat lembar varian'
          : payload.target === 'location-sheet'
            ? 'Membuat lembar lokasi'
            : payload.target === 'prop-sheet'
              ? 'Membuat lembar prop'
              : 'Membuat gambar'
  const result = await hf.waitForResult(
    requestId,
    imageProgress(ctx, progressLabel),
    ctx.signal,
    isVideo ? 30 * 60 * 1000 : 15 * 60 * 1000
  )
  const url = isVideo ? result.video?.url : result.images?.[0]?.url
  if (!url) throw new Error('Higgsfield selesai tanpa file hasil')
  ctx.progress(0.93, 'Mengunduh hasil')
  const downloadStartedAt = Date.now()
  const { bytes, contentType } = await downloadTo(url, ctx.signal)
  if (ctx.signal.aborted) throw new Error('Dibatalkan')
  console.info('[higgsfield] download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
  const rel = saveFile(job.projectId, isVideo ? 'videos' : 'images', extFromType(contentType, url, isVideo ? '.mp4' : '.png'), bytes)
  const abs = assetAbsPath(job.projectId, rel)
  const size = await probeSize(abs)
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  if (ctx.signal.aborted) throw new Error('Dibatalkan')
  const asset = insertAsset({
    projectId: job.projectId,
    clipId: job.clipId,
    characterId: job.characterId,
    derivativeId: payload.derivativeId ?? null,
    locationId: payload.locationId ?? null,
    propId: payload.propId ?? null,
    // Episode of the clip, so the header can total credits per episode; sheets belong to the whole series.
    episodeId: job.clipId ? getClip(job.clipId).episodeId || null : null,
    kind: isVideo ? 'video' : 'image',
    provider: 'higgsfield',
    model: payload.model,
    prompt: payload.prompt,
    remoteId: requestId,
    remoteUrl: url,
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null,
    // Thumbnails have no clip; the flag is how the export dialog finds them again.
    meta: {
      ...(payload.target === 'thumbnail' ? { thumbnail: true } : {}),
      ...(payload.resolution ? { resolution: payload.resolution } : {}),
      ...(payload.basisHash ? { basisHash: payload.basisHash } : {}),
      ...(typeof payload.credits === 'number' ? { credits: payload.credits } : {})
    }
  })
  emit.asset(asset)
  if (payload.target === 'sheet' && job.characterId) {
    setCharacterSheet(job.characterId, asset.id)
    emit.character({ characterId: job.characterId, patch: { sheetAssetId: asset.id } })
  } else if (payload.target === 'derivative-sheet' && payload.derivativeId) {
    setDerivativeSheet(payload.derivativeId, asset.id)
  } else if (payload.target === 'location-sheet' && payload.locationId) {
    setLocationSheet(payload.locationId, asset.id)
  } else if (payload.target === 'prop-sheet' && payload.propId) {
    setPropSheet(payload.propId, asset.id)
  } else if (payload.target === 'clip-image' && job.clipId) {
    patchClip(job.clipId, { imageAssetId: asset.id })
    emit.clip({ clipId: job.clipId, patch: { imageAssetId: asset.id } })
    const project = getProject(job.projectId)
    const first = firstClipOf(job.projectId)
    if (!project.coverAssetId || first?.id === job.clipId) touchProject(job.projectId, { coverAssetId: asset.id })
  } else if (payload.target === 'clip-video' && job.clipId) {
    const patch = { videoAssetId: asset.id, motionType: 'video' as const, mediaInMs: 0 }
    patchClip(job.clipId, patch)
    emit.clip({ clipId: job.clipId, patch })
    await extractVideoDialogueAudio(job.projectId, job.clipId, asset, ctx.signal, payload.autoTrimSilence ?? true)
  }
  touchProject(job.projectId)
  return asset.id
}

function startHiggsfield(
  job: Job,
  build: (ctx: TaskCtx) => Promise<{ endpoint: string; body: Record<string, unknown>; payload: HfPayload }>,
  beforeQueue?: (ctx: TaskCtx) => Promise<void>
): Job {
  emit.job(job)
  return runJob(job, 'higgsfield', async (ctx) => {
    ctx.progress(0.04, 'Menyiapkan prompt')
    const { endpoint, body, payload } = await build(ctx)
    if (typeof body.resolution === 'string' || typeof body.resolution === 'number') payload.resolution = String(body.resolution)
    // What this request costs is stored with its result, so the header adds up real prices instead of guesses.
    if (payload.credits == null) payload.credits = (await requestCredits(endpoint, body)) ?? undefined
    ctx.progress(0.08, 'Mengirim ke Higgsfield')
    const submitStartedAt = Date.now()
    const requestId = await hf.submit(endpoint, body, ctx.signal)
    console.info('[higgsfield] submit accepted', { model: payload.model, elapsedMs: Date.now() - submitStartedAt })
    ctx.setRemote(requestId)
    updateJobPayload(job.id, payload)
    return finishHiggsfield(ctx, job, requestId, payload)
  }, beforeQueue)
}

/**
 * Credits Higgsfield quotes for a request. The price depends on the settings, not on the prompt or the
 * reference images, so those are left out of the cache key and one quote serves every similar request.
 */
async function requestCredits(endpoint: string, body: Record<string, unknown>): Promise<number | null> {
  const priced: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (k === 'prompt') priced[k] = 'estimate'
    else if (typeof v === 'string' && /^https?:\/\//.test(v)) priced[k] = 'https://example.com/ref.png'
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' && /^https?:\/\//.test(x))) priced[k] = v.map(() => 'https://example.com/ref.png')
    else priced[k] = v
  }
  const key = `estimate:${endpoint}:${JSON.stringify(priced)}`
  const hit = readCache<CreditEstimate>(key)
  if (hit && Date.now() - hit.updatedAt < DAY) return hit.value.credits
  const value = await hf.estimate(endpoint, priced)
  if (value) writeCache(key, value)
  return value?.credits ?? null
}

function updateJobPayload(jobId: string, payload: HfPayload): void {
  getDb().prepare('UPDATE jobs SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), jobId)
}

function isFlow2Api(): boolean {
  return resolveActive(getSettings(), 'image').provider.protocol === 'flow2api'
}

/** Everything the shared status and prerequisite rules read, gathered once per call. */
/** The image model picked under Pengaturan › Model aktif; projects no longer choose their own (Tugas 54). */
function activeImageModelId(): string {
  return resolveActive(getSettings(), 'image').model
}

function prereqContext(projectId: string, episodeId?: string): GenerationPrerequisitesContext {
  const s = getSettings()
  const activeImage = resolveActive(s, 'image')
  const activeVideo = resolveActive(s, 'video')
  let lockWords: LockWord[] = []
  try {
    const project = getProject(projectId)
    const episode = episodeId ? getEpisode(episodeId) : undefined
    lockWords = [...(project.seriesLock || []), ...(episode?.lockWords || [])]
  } catch {
    // If project cannot be fetched, proceed with empty locks
  }
  return {
    characters: charactersOf(projectId),
    derivatives: derivativesOf(projectId),
    locations: locationsOf(projectId),
    props: propsOf(projectId),
    assets: assetsOf(projectId),
    clips: clipsOf(projectId, episodeId),
    activeJobs: activeJobsOf(projectId),
    isFlow2Api: activeImage.provider.protocol === 'flow2api',
    flow2apiImageModel: activeImage.model,
    flow2apiVideoModel: activeVideo.model,
    activeImageModel: activeImage.model,
    activeVideoModel: activeVideo.model,
    lockWords
  }
}

function blockedMessage(kind: 'gambar' | 'video', blocking: { index: number; title: string; status: ClipStatusResult }[]): string {
  const details = blocking.map((b) => `Shot ${b.index} (${b.title}):\n  • ${b.status.blockers.join('\n  • ')}`).join('\n')
  return `Batch ${kind} dibatalkan karena beberapa adegan terblokir (semua atau tidak sama sekali):\n${details}`
}

// ---------- public entry points ----------

export function generateClipImage(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'image')
  if (existing) return existing
  const clip = getClip(clipId)
  const prereqs = checkClipImagePrerequisites(clip, getProject(clip.projectId), prereqContext(clip.projectId, clip.episodeId))
  if (!prereqs.ok) {
    throw new Error(`Syarat generate gambar tidak terpenuhi:\n- ${prereqs.blockers.join('\n- ')}`)
  }

  const waitForAnchor = async (ctx: TaskCtx): Promise<void> => {
    await waitForSceneAnchorImage(clip, ctx.signal, () =>
      ctx.progress(0.02, 'Menunggu shot jangkar selesai agar latar & prop konsisten…')
    )
  }

  if (isFlow2Api()) {
    const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'flow2api' })
    emit.job(job)
    return runJob(
      job,
      'flow2api',
      async (ctx) => {
        const fresh = getClip(clipId)
        const project = getProject(fresh.projectId)
        const pctx = prereqContext(project.id, fresh.episodeId)
        const allChars = pctx.characters
        const allDerivs = pctx.derivatives
        const allLocs = pctx.locations
        const allProps = pctx.props
        const limit = referenceLimit(project, pctx)
        const sceneAnchor = findSceneAnchorForClip(fresh, pctx.clips)

        const refItems = collectReferenceSheets(fresh, allChars, allDerivs, allLocs, allProps, limit, sceneAnchor)

        // Keep loadedRefs strictly aligned with refBuffers so Image 1..N indices in the prompt never shift.
        const refBuffers: Buffer[] = []
        const loadedRefs: ReferenceSheetItem[] = []
        for (const it of refItems) {
          const sheet = getAsset(it.sheetAssetId)
          if (sheet && refBuffers.length < limit) {
            const abs = assetAbsPath(project.id, sheet.localPath)
            if (existsSync(abs)) {
              refBuffers.push(readFileSync(abs))
              loadedRefs.push(it)
            }
          }
        }

        const baseModel = resolveActive(getSettings(), 'image').model
        const modelId = resolveFlow2ApiModelId(baseModel, project.aspectRatio)
        const prompt = compileClipPrompt({
          project,
          clip: fresh,
          characters: allChars.filter((c) => fresh.characterIds.includes(c.id)),
          derivatives: allDerivs,
          locations: allLocs,
          props: allProps,
          refItems: loadedRefs,
          refNames: loadedRefs.map((r) => r.name),
          lockWords: pctx.lockWords,
          limit: 6000
        })
        const { basisHash } = clipImageBasis(fresh, project, pctx)

        ctx.progress(0.04, 'Menyiapkan prompt Flow2API')
        const { mediaUrl } = await f2a.generateImage({
          prompt,
          model: modelId,
          referenceImages: refBuffers,
          signal: ctx.signal,
          onProgress: (p, msg) => ctx.progress(p, msg)
        })

        ctx.progress(0.93, 'Mengunduh hasil')
        const downloadStartedAt = Date.now()
        const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
        if (ctx.signal.aborted) throw new Error('Dibatalkan')
        console.info('[flow2api] download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
        const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
        const abs = assetAbsPath(project.id, rel)
        const size = await probeSize(abs)
        if (ctx.signal.aborted) throw new Error('Dibatalkan')
        const asset = insertAsset({
          projectId: project.id,
          clipId: fresh.id,
          kind: 'image',
          provider: 'flow2api',
          model: modelId,
          prompt,
          remoteUrl: mediaUrl,
          localPath: rel,
          width: size?.width ?? null,
          height: size?.height ?? null,
          meta: { basisHash }
        })
        emit.asset(asset)
        patchClip(clipId, { imageAssetId: asset.id })
        emit.clip({ clipId, patch: { imageAssetId: asset.id } })
        const first = firstClipOf(project.id)
        if (!project.coverAssetId || first?.id === clipId) touchProject(project.id, { coverAssetId: asset.id })
        touchProject(project.id)
        return asset.id
      },
      waitForAnchor
    )
  }

  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'higgsfield' })
  return startHiggsfield(
    job,
    async (ctx) => {
      const fresh = getClip(clipId)
      const project = getProject(fresh.projectId)
      const model = getImageModel(activeImageModelId())
      const pctx = prereqContext(project.id, fresh.episodeId)
      const allChars = pctx.characters
      const allDerivs = pctx.derivatives
      const allLocs = pctx.locations
      const allProps = pctx.props
      const sceneAnchor = findSceneAnchorForClip(fresh, pctx.clips)

      const refItems = collectReferenceSheets(fresh, allChars, allDerivs, allLocs, allProps, referenceLimit(project, pctx), sceneAnchor)
      const refs = await resolveReferenceUrls(model, refItems, ctx.signal)
      const prompt = compileClipPrompt({
        project,
        clip: fresh,
        characters: allChars.filter((c) => fresh.characterIds.includes(c.id)),
        derivatives: allDerivs,
        locations: allLocs,
        props: allProps,
        refItems: refs.items,
        refNames: refs.names,
        lockWords: pctx.lockWords,
        limit: promptLimit(model)
      })
      const { basisHash } = clipImageBasis(fresh, project, pctx)
      return {
        endpoint: model.id,
        body: imageBody(model, prompt, project.aspectRatio, refs.urls, getSettings().imageGenerationMode === 'draft' ? resolutionOptions(model)[0] : undefined),
        payload: { target: 'clip-image', model: model.id, prompt, basisHash }
      }
    },
    waitForAnchor
  )
}

/** The characters in the most scenes: thumbnails show the lead, not the whole cast. */
function leadCharacters(projectId: string, max: number): Character[] {
  const count = new Map<string, number>()
  for (const clip of clipsOf(projectId)) for (const id of clip.characterIds) count.set(id, (count.get(id) ?? 0) + 1)
  return charactersOf(projectId)
    .filter((c) => count.has(c.id))
    .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0))
    .slice(0, max)
}

function thumbnailPrompt(project: Project, req: ThumbnailRequest, chars: Character[], refNames: string[]): string {
  const drawText = req.withText && !!req.textHook.trim()
  // Every style forbids text for scene frames; left in, it fights the hook instruction and models drop the text.
  const stylePrompt = drawText ? getStyle(project.styleId).prompt.replace(NO_TEXT, '').trim() : getStyle(project.styleId).prompt
  const parts = [
    `YouTube thumbnail, 16:9, for a video titled "${req.title.trim()}".`,
    `Scene:\n${req.prompt.trim()}`
  ]
  if (chars.length) parts.push(`Characters, keep their look exactly:\n${chars.map(characterLine).join('\n')}`)
  if (refNames.length)
    parts.push(
      `Reference images are character sheets, in this order: ${refNames.join(', ')}. Use them for identity, face and colors only; do not copy the sheet layout or background.`
    )
  // Image models misspell long text, so only the short hook is drawn; the title itself stays in YouTube's title field.
  parts.push(
    drawText
      ? `Draw the text "${req.textHook.trim()}" exactly as written, huge bold sans-serif capital letters with a thick dark outline, filling about a third of the frame on the empty side, fully inside the frame. No other text, logos or watermarks.`
      : 'No text, letters, logos or watermarks anywhere. Leave clean empty space on one side for a title added later.'
  )
  parts.push(
    'Thumbnail rules: one clear focal subject close to the camera with a strong readable facial expression, bold contrast, saturated colors, uncluttered background, readable at small size.'
  )
  parts.push(`Art style: ${stylePrompt}`)
  parts.push(`Variation ${req.variation}: use a distinct camera angle, pose and expression from the other variations.`)
  return parts.join('\n\n')
}

export function generateThumbnail(projectId: string, req: ThumbnailRequest): Job {
  const project = getProject(projectId)
  const variation = req.variation
  const chars = leadCharacters(projectId, 2)
  if (isFlow2Api()) {
    const job = insertJob({ projectId, kind: 'image', provider: 'flow2api', payload: { target: 'thumbnail', variation } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      await waitForSheets(chars.map((c) => c.id), ctx.signal)
      const refBuffers: Buffer[] = []
      const refNames: string[] = []
      for (const c of chars) {
        const sheet = getAsset(getCharacter(c.id).sheetAssetId)
        const abs = sheet && assetAbsPath(projectId, sheet.localPath)
        if (abs && existsSync(abs)) {
          refBuffers.push(readFileSync(abs))
          refNames.push(c.name)
        }
      }
      const variedPrompt = thumbnailPrompt(project, req, chars, refNames)
      const baseModel = resolveActive(getSettings(), 'image').model
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')
      const { mediaUrl } = await f2a.generateImage({ prompt: variedPrompt, model: modelId, referenceImages: refBuffers, signal: ctx.signal, onProgress: (progress, message) => ctx.progress(progress, message) })
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] thumbnail download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(projectId, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const size = await probeSize(assetAbsPath(projectId, rel))
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({ projectId, kind: 'image', provider: 'flow2api', model: modelId, prompt: variedPrompt, remoteUrl: mediaUrl, localPath: rel, width: size?.width ?? null, height: size?.height ?? null, meta: { thumbnail: true } })
      emit.asset(asset)
      return asset.id
    })
  }
  const job = insertJob({ projectId, kind: 'image', provider: 'higgsfield', payload: { target: 'thumbnail', variation } })
  return startHiggsfield(job, async (ctx) => {
    const model = getImageModel(activeImageModelId())
    const refs = await resolveReferenceUrls(
      model,
      chars.map((c) => ({ kind: 'character' as const, id: c.id, sheetAssetId: c.sheetAssetId || '', name: c.name })),
      ctx.signal
    )
    const variedPrompt = thumbnailPrompt(project, req, chars, refs.names)
    return {
      endpoint: model.id,
      body: imageBody(model, variedPrompt, '16:9', refs.urls),
      payload: { target: 'thumbnail', model: model.id, prompt: variedPrompt }
    }
  })
}

export function generateCharacterSheet(characterId: string): Job {
  const existing = activeJobFor({ characterId }, 'sheet')
  if (existing) return existing
  const c = getCharacter(characterId)
  const project = getProject(c.projectId)
  // The same function the Lorebook badge uses, so a fresh sheet is never "stale" the moment it lands.
  const basisHash = getCharacterSheetStatus(c, project, [], activeImageModelId()).basisHash

  if (isFlow2Api()) {
    const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const prompt = sheetPrompt(project, getCharacter(characterId))
      const baseModel = resolveActive(getSettings(), 'image').model
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')

      ctx.progress(0.04, 'Menyiapkan prompt lembar karakter Flow2API')
      const { mediaUrl } = await f2a.generateImage({
        prompt,
        model: modelId,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh lembar karakter')
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] character sheet download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        characterId,
        kind: 'image',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        width: size?.width ?? null,
        height: size?.height ?? null,
        meta: { basisHash }
      })
      setCharacterSheet(characterId, asset.id)
      emit.character({ characterId, patch: { sheetAssetId: asset.id } })
      emit.asset(asset)
      touchProject(c.projectId)
      return asset.id
    })
  }

  const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'higgsfield' })
  return startHiggsfield(job, async () => {
    const model = getImageModel(activeImageModelId())
    const prompt = sheetPrompt(project, getCharacter(characterId))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'sheet', model: model.id, prompt, basisHash }
    }
  })
}

export function generateDerivativeSheet(derivativeId: string): Job {
  const d = getDerivative(derivativeId)
  if (!d) throw new Error('Varian kostum tidak ditemukan')
  const c = getCharacter(d.characterId)
  if (!c.sheetAssetId) throw new Error('Buat lembar karakter dasar terlebih dahulu sebelum membuat varian kostum.')
  const baseSheet = getAsset(c.sheetAssetId)
  if (!baseSheet) throw new Error('Lembar karakter dasar tidak ditemukan.')

  const project = getProject(c.projectId)
  const prompt = derivativeSheetPrompt(project, c, d)
  const basisHash = getDerivativeSheetStatus(d, c, project, [], false, activeImageModelId()).basisHash

  if (isFlow2Api()) {
    const job = insertJob({ projectId: c.projectId, characterId: c.id, kind: 'sheet', provider: 'flow2api', payload: { target: 'derivative-sheet', derivativeId } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const baseModel = resolveActive(getSettings(), 'image').model
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')

      const refBuffers: Buffer[] = []
      const absSheet = assetAbsPath(project.id, baseSheet.localPath)
      if (existsSync(absSheet)) {
        refBuffers.push(readFileSync(absSheet))
      }

      ctx.progress(0.04, 'Menyiapkan prompt lembar varian Flow2API')
      const { mediaUrl } = await f2a.generateImage({
        prompt,
        model: modelId,
        referenceImages: refBuffers,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh lembar varian')
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        characterId: c.id,
        derivativeId: d.id,
        kind: 'image',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        width: size?.width ?? null,
        height: size?.height ?? null,
        meta: { basisHash }
      })
      setDerivativeSheet(d.id, asset.id)
      emit.asset(asset)
      touchProject(c.projectId)
      return asset.id
    })
  }

  const job = insertJob({ projectId: c.projectId, characterId: c.id, kind: 'sheet', provider: 'higgsfield', payload: { target: 'derivative-sheet', derivativeId } })
  return startHiggsfield(job, async (ctx) => {
    const model = getImageModel(activeImageModelId())
    const refUrl = await publicUrlFor(baseSheet, ctx.signal)
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', [refUrl]),
      payload: { target: 'derivative-sheet', derivativeId, model: model.id, prompt, basisHash }
    }
  })
}

export function generateLocationSheet(locationId: string): Job {
  const l = getLocation(locationId)
  if (!l) throw new Error('Lokasi tidak ditemukan')
  const project = getProject(l.projectId)
  const prompt = locationSheetPrompt(project, l)
  const basisHash = getLocationSheetStatus(l, project, [], activeImageModelId()).basisHash

  if (isFlow2Api()) {
    const job = insertJob({ projectId: l.projectId, kind: 'image', provider: 'flow2api', payload: { target: 'location-sheet', locationId } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const baseModel = resolveActive(getSettings(), 'image').model
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')

      ctx.progress(0.04, 'Menyiapkan prompt lembar lokasi Flow2API')
      const { mediaUrl } = await f2a.generateImage({
        prompt,
        model: modelId,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh lembar lokasi')
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        locationId: l.id,
        kind: 'image',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        width: size?.width ?? null,
        height: size?.height ?? null,
        meta: { basisHash }
      })
      setLocationSheet(l.id, asset.id)
      emit.asset(asset)
      touchProject(l.projectId)
      return asset.id
    })
  }

  const job = insertJob({ projectId: l.projectId, kind: 'image', provider: 'higgsfield', payload: { target: 'location-sheet', locationId } })
  return startHiggsfield(job, async () => {
    const model = getImageModel(activeImageModelId())
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'location-sheet', locationId, model: model.id, prompt, basisHash }
    }
  })
}

export function generatePropSheet(propId: string): Job {
  const pr = getProp(propId)
  if (!pr) throw new Error('Prop tidak ditemukan')
  const project = getProject(pr.projectId)
  const prompt = propSheetPrompt(project, pr)
  const basisHash = getPropSheetStatus(pr, project, [], activeImageModelId()).basisHash

  if (isFlow2Api()) {
    const job = insertJob({ projectId: pr.projectId, kind: 'image', provider: 'flow2api', payload: { target: 'prop-sheet', propId } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const baseModel = resolveActive(getSettings(), 'image').model
      const modelId = resolveFlow2ApiModelId(baseModel, '16:9')

      ctx.progress(0.04, 'Menyiapkan prompt lembar prop Flow2API')
      const { mediaUrl } = await f2a.generateImage({
        prompt,
        model: modelId,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh lembar prop')
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const rel = saveFile(project.id, 'images', extFromType(contentType, mediaUrl, '.png'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        propId: pr.id,
        kind: 'image',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        width: size?.width ?? null,
        height: size?.height ?? null,
        meta: { basisHash }
      })
      setPropSheet(pr.id, asset.id)
      emit.asset(asset)
      touchProject(pr.projectId)
      return asset.id
    })
  }

  const job = insertJob({ projectId: pr.projectId, kind: 'image', provider: 'higgsfield', payload: { target: 'prop-sheet', propId } })
  return startHiggsfield(job, async () => {
    const model = getImageModel(activeImageModelId())
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'prop-sheet', propId, model: model.id, prompt, basisHash }
    }
  })
}

async function resolveInitialImageForClip(
  fresh: Clip,
  project: Project
): Promise<{ buffer: Buffer; asset: Asset; prevAssetId?: string }> {
  if (fresh.continueFromPrevious) {
    const episodeClips = clipsOf(project.id, fresh.episodeId).sort((a, b) => a.sort - b.sort)
    const idx = episodeClips.findIndex((c) => c.id === fresh.id)
    if (idx > 0) {
      const prev = episodeClips[idx - 1]
      if (prev.videoAssetId) {
        const videoAsset = getAsset(prev.videoAssetId)
        if (videoAsset) {
          const videoAbs = assetAbsPath(project.id, videoAsset.localPath)
          const frameRel = `images/lastframe-${fresh.id}.png`
          const frameAbs = assetAbsPath(project.id, frameRel)
          mkdirSync(dirname(frameAbs), { recursive: true })
          await extractLastFrame(videoAbs, frameAbs)
          const size = await probeSize(frameAbs).catch(() => null)
          const frameAsset = insertAsset({
            projectId: project.id,
            clipId: fresh.id,
            kind: 'image',
            provider: 'local',
            prompt: `Frame terakhir ${prev.title}`,
            localPath: frameRel,
            width: size?.width ?? null,
            height: size?.height ?? null,
            meta: { extractedFromVideo: prev.videoAssetId }
          })
          emit.asset(frameAsset)
          const buf = readFileSync(frameAbs)
          return { buffer: buf, asset: frameAsset, prevAssetId: videoAsset.id }
        }
      } else if (prev.imageAssetId) {
        const imgAsset = getAsset(prev.imageAssetId)
        if (imgAsset) {
          const abs = assetAbsPath(project.id, imgAsset.localPath)
          const buf = readFileSync(abs)
          return { buffer: buf, asset: imgAsset, prevAssetId: imgAsset.id }
        }
      }
    }
  }

  const image = getAsset(fresh.imageAssetId)
  if (!image) throw new Error('Gambar klip tidak ditemukan')
  const imgAbs = assetAbsPath(project.id, image.localPath)
  if (!existsSync(imgAbs)) throw new Error('File gambar klip tidak ditemukan di disk')
  const buf = readFileSync(imgAbs)
  return { buffer: buf, asset: image }
}

export function generateClipVideo(clipId: string, autoTrimSilence = true): Job {
  const existing = activeJobFor({ clipId }, 'video')
  if (existing) return existing
  const clip = getClip(clipId)

  const prereqs = checkClipVideoPrerequisites(clip, getProject(clip.projectId), prereqContext(clip.projectId, clip.episodeId))
  if (!prereqs.ok) {
    throw new Error(`Syarat generate video tidak terpenuhi:\n- ${prereqs.blockers.join('\n- ')}`)
  }

  if (isFlow2Api()) {
    const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      await waitForPreviousClipVideo(getClip(clipId), ctx.signal, () => ctx.progress(0.02, 'Menunggu video shot sebelumnya selesai'))
      const fresh = getClip(clipId)
      const project = getProject(fresh.projectId)
      const allChars = charactersOf(project.id)
      const initial = await resolveInitialImageForClip(fresh, project)

      const pctx = prereqContext(project.id, fresh.episodeId)
      const durationSec = videoSecondsFor(project, fresh, pctx).seconds
      const baseModel = resolveActive(getSettings(), 'video').model
      const video = resolveFlow2ApiVideo(baseModel, project.aspectRatio, durationSec)
      const modelId = video.model

      const prompt = compileClipVideoPrompt(project, fresh, allChars, pctx.lockWords || [], 2000)
      const basisHash = computeClipVideoBasisHash({ project: { ...project, videoModel: baseModel }, clip: fresh, characters: allChars, seconds: durationSec, prevAssetId: initial.prevAssetId, lockWords: pctx.lockWords, videoModel: baseModel })

      ctx.progress(0.04, baseModel.toLowerCase().includes('omni') ? 'Menyiapkan video Flow2API (Omni)' : 'Menyiapkan video Flow2API (Veo)')
      const { mediaUrl } = await f2a.generateVideo({
        prompt,
        model: modelId,
        aspectRatio: video.aspectRatio,
        durationSec: video.durationSec,
        initialImage: video.withImage ? initial.buffer : undefined,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.progress(p, msg)
      })

      ctx.progress(0.93, 'Mengunduh video hasil')
      const downloadStartedAt = Date.now()
      const { bytes, contentType } = await downloadTo(mediaUrl, ctx.signal)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      console.info('[flow2api] video download completed', { elapsedMs: Date.now() - downloadStartedAt, bytes: bytes.length })
      const rel = saveFile(project.id, 'videos', extFromType(contentType, mediaUrl, '.mp4'), bytes)
      const abs = assetAbsPath(project.id, rel)
      const size = await probeSize(abs)
      const durationMs = await probeDurationMs(abs).catch(() => null)
      if (ctx.signal.aborted) throw new Error('Dibatalkan')
      const asset = insertAsset({
        projectId: project.id,
        clipId: fresh.id,
        kind: 'video',
        provider: 'flow2api',
        model: modelId,
        prompt,
        remoteUrl: mediaUrl,
        localPath: rel,
        durationMs,
        width: size?.width ?? null,
        height: size?.height ?? null,
        meta: { basisHash }
      })
      emit.asset(asset)
      const patch = { videoAssetId: asset.id, motionType: 'video' as const, mediaInMs: 0 }
      patchClip(clipId, patch)
      emit.clip({ clipId, patch })
      touchProject(project.id)
      await extractVideoDialogueAudio(project.id, clipId, asset, ctx.signal, autoTrimSilence)
      return asset.id
    })
  }

  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    await waitForPreviousClipVideo(getClip(clipId), ctx.signal, () => ctx.progress(0.02, 'Menunggu video shot sebelumnya selesai'))
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const pctx = prereqContext(project.id, fresh.episodeId)
    const model = getVideoModel(pctx.activeVideoModel || project.videoModel)
    const allChars = charactersOf(project.id)
    const initial = await resolveInitialImageForClip(fresh, project)

    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const url = await publicUrlFor(initial.asset, ctx.signal)
    let prompt = compileClipVideoPrompt(project, fresh, allChars, pctx.lockWords || [], promptLimit(model))
    if (model.input.mode === 'reference') {
      prompt = `Open on the exact scene of the reference image and keep its art style, characters and composition. ${prompt}`
    }
    const seconds = videoSecondsFor(project, fresh, pctx).seconds
    const basisHash = computeClipVideoBasisHash({ project: { ...project, videoModel: model.id }, clip: fresh, characters: allChars, seconds, prevAssetId: initial.prevAssetId, lockWords: pctx.lockWords, videoModel: model.id })
    const isVideoDialog = isVideoDialogue(project, fresh)
    return {
      endpoint: model.id,
      body: videoBody(
        model,
        prompt,
        url,
        seconds,
        project.aspectRatio,
        project.videoResolution,
        null,
        isVideoDialog
      ),
      payload: { target: 'clip-video', model: model.id, prompt, basisHash, autoTrimSilence }
    }
  })
}

export function generateClipTts(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'tts')
  if (existing) return existing
  const clip = getClip(clipId)
  const project = withActiveTts(getProject(clip.projectId), getSettings())
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'tts', provider: project.ttsProvider })
  emit.job(job)
  return runJob(job, 'tts', async (ctx) => {
    const fresh = getClip(clipId)
    const p = withActiveTts(getProject(fresh.projectId), getSettings())
    const text = fresh.narration.trim()
    if (!text) throw new Error('Naskah klip ini masih kosong')
    ctx.progress(0.2, 'Membuat suara')
    let rel: string
    let words: WordTiming[] | undefined
    let estimated = false
    const char = fresh.speakerId ? charactersOf(p.id).find((c) => c.id === fresh.speakerId) : null
    const charVoice = char?.ttsProvider === p.ttsProvider ? char.ttsVoice : null
    const voice = charVoice || p.ttsVoice || (p.ttsProvider === 'gemini' ? 'Charon' : '')
    if (p.ttsProvider === 'elevenlabs') {
      if (!voice) throw new Error('Pilih suara ElevenLabs dulu di Lorebook atau Storyboard.')
      const out = await eleven.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.mp3', out.audio)
      words = out.words
    } else {
      const wav = await gemini.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.wav', wav)
    }
    ctx.progress(0.85, 'Mengukur durasi')
    const audioMs = await probeDurationMs(assetAbsPath(p.id, rel))
    if (!words?.length) {
      words = estimateWordTimings(stripVoiceTags(text), audioMs / 1000)
      estimated = true
    }
    const basisHash = computeClipTtsBasisHash({
      narration: text,
      voice,
      ttsProvider: p.ttsProvider
    })
    const asset = insertAsset({
      projectId: p.id,
      clipId,
      kind: 'audio',
      provider: p.ttsProvider,
      model: p.ttsProvider === 'gemini' ? getSettings().geminiTtsModel : getSettings().elevenModel,
      prompt: text,
      localPath: rel,
      durationMs: audioMs,
      meta: { words, estimatedTimings: estimated, voice, basisHash }
    })
    emit.asset(asset)
    const durationMs = Math.max(1500, audioMs + 400)
    const patch = { audioAssetId: asset.id, durationMs, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
    patchClip(clipId, patch)
    emit.clip({ clipId, patch })
    touchProject(p.id)
    return asset.id
  })
}

interface NeededSheet {
  id: string
  name: string
  kind: 'character' | 'derivative' | 'location' | 'prop'
  characterId?: string
}

/**
 * Finds registered Lorebook entities referenced by `clips` that are missing their reference sheet (when the
 * active image model takes references). Base characters of needed derivatives are included first so Wave 1
 * can generate the base sheet before Wave 2 edits it into the costume variant.
 */
function collectMissingSheetsForClips(
  project: Project,
  clips: Clip[],
  ctx: GenerationPrerequisitesContext
): NeededSheet[] {
  if (referenceLimit(project, ctx) <= 0) return []
  const assetIds = new Set(Array.isArray(ctx.assets) ? ctx.assets.map((a) => a.id) : Object.keys(ctx.assets))
  const hasSheet = (id: string | null | undefined): boolean => !!id && assetIds.has(id)
  const charMap = new Map(ctx.characters.map((c) => [c.id, c]))
  const derivMap = new Map(ctx.derivatives.map((d) => [d.id, d]))
  const locMap = new Map(ctx.locations.map((l) => [l.id, l]))
  const propMap = new Map(ctx.props.map((p) => [p.id, p]))

  const seen = new Set<string>()
  const out: NeededSheet[] = []
  const add = (item: NeededSheet): void => {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }

  for (const clip of clips) {
    for (const cid of clip.characterIds || []) {
      const ch = charMap.get(cid)
      if (!ch) continue
      const derivId = clip.costumeIds?.[cid]
      if (derivId) {
        const deriv = derivMap.get(derivId)
        if (deriv && !hasSheet(deriv.sheetAssetId)) {
          if (!hasSheet(ch.sheetAssetId)) add({ id: ch.id, name: ch.name, kind: 'character' })
          add({ id: deriv.id, name: `${ch.name} - ${deriv.name}`, kind: 'derivative', characterId: ch.id })
        }
      } else if (!hasSheet(ch.sheetAssetId)) {
        add({ id: ch.id, name: ch.name, kind: 'character' })
      }
    }
    if (clip.locationId) {
      const loc = locMap.get(clip.locationId)
      if (loc && !hasSheet(loc.sheetAssetId)) add({ id: loc.id, name: loc.name, kind: 'location' })
    }
    for (const pid of clip.propIds || []) {
      const pr = propMap.get(pid)
      if (pr && !hasSheet(pr.sheetAssetId)) add({ id: pr.id, name: pr.name, kind: 'prop' })
    }
  }
  return out
}

/** Simulates that `sheets` already exist so prerequisite checks only surface unfixable blockers. */
function withSimulatedSheets(ctx: GenerationPrerequisitesContext, sheets: NeededSheet[]): GenerationPrerequisitesContext {
  if (!sheets.length) return ctx
  const fakeAssets: Asset[] = Array.isArray(ctx.assets) ? [...ctx.assets] : Object.values(ctx.assets)
  const charIds = new Set(sheets.filter((s) => s.kind === 'character').map((s) => s.id))
  const derivIds = new Set(sheets.filter((s) => s.kind === 'derivative').map((s) => s.id))
  const locIds = new Set(sheets.filter((s) => s.kind === 'location').map((s) => s.id))
  const propIds = new Set(sheets.filter((s) => s.kind === 'prop').map((s) => s.id))
  const makePlaceholder = (id: string): Asset => ({
    id,
    projectId: '',
    clipId: null,
    characterId: null,
    derivativeId: null,
    locationId: null,
    propId: null,
    episodeId: null,
    kind: 'image',
    provider: null,
    model: null,
    prompt: null,
    remoteId: null,
    remoteUrl: null,
    localPath: '',
    url: '',
    durationMs: null,
    width: null,
    height: null,
    meta: {},
    createdAt: 0
  })

  for (const s of sheets) fakeAssets.push(makePlaceholder(`__pending_sheet_${s.kind}_${s.id}`))

  return {
    ...ctx,
    assets: fakeAssets,
    characters: ctx.characters.map((c) => (charIds.has(c.id) ? { ...c, sheetAssetId: `__pending_sheet_character_${c.id}` } : c)),
    derivatives: ctx.derivatives.map((d) => (derivIds.has(d.id) ? { ...d, sheetAssetId: `__pending_sheet_derivative_${d.id}` } : d)),
    locations: ctx.locations.map((l) => (locIds.has(l.id) ? { ...l, sheetAssetId: `__pending_sheet_location_${l.id}` } : l)),
    props: ctx.props.map((p) => (propIds.has(p.id) ? { ...p, sheetAssetId: `__pending_sheet_prop_${p.id}` } : p))
  }
}

async function waitJobsSettled(jobIds: string[]): Promise<{ anyCanceled: boolean; failedIds: Set<string> }> {
  const settled = (id: string) => !['queued', 'running'].includes(getJob(id)?.status ?? '')
  while (!jobIds.every(settled)) {
    await new Promise((r) => setTimeout(r, 500))
  }
  const anyCanceled = jobIds.some((id) => getJob(id)?.status === 'canceled')
  const failedIds = new Set(jobIds.filter((id) => getJob(id)?.status === 'failed'))
  return { anyCanceled, failedIds }
}

/**
 * Makes the missing (and, when asked, stale) images of an episode (§6.J), optionally narrowed to `clipIds`.
 * When `autoGenerateSheets` is true, missing Lorebook sheets needed by those clips are generated first
 * (Wave 1: characters/locations/props → Wave 2: costume variants → Wave 3: clip images) so creators never
 * have to ping-pong back to Lorebook.
 */
export function generateMissingImages(
  projectId: string,
  episodeId?: string,
  includeStale = false,
  clipIds?: string[],
  autoGenerateSheets = false
): Job[] {
  const project = getProject(projectId)
  const ctx = prereqContext(projectId, episodeId)
  const idFilter = clipIds?.length ? new Set(clipIds) : null
  const allEpisodeClips = clipsOf(projectId, episodeId)
  const scoped = allEpisodeClips
    .map((clip, i) => ({ clip, index: i + 1, title: clip.title || `Shot ${i + 1}` }))
    .filter((it) => !idFilter || idFilter.has(it.clip.id))

  // When explicit clipIds are chosen, treat them as explicit targets (including regenerating current ones).
  const candidateClips = idFilter
    ? scoped.map((it) => it.clip)
    : scoped.filter((it) => !it.clip.imageAssetId || includeStale).map((it) => it.clip)

  const neededSheets = autoGenerateSheets ? collectMissingSheetsForClips(project, candidateClips, ctx) : []
  const evalCtx = neededSheets.length ? withSimulatedSheets(ctx, neededSheets) : ctx

  const items = scoped.map((it) => ({
    ...it,
    status: getClipImageStatus(it.clip, project, evalCtx)
  }))

  let targets: typeof items
  let blocking: typeof items
  if (idFilter) {
    blocking = items.filter((it) => it.status.status === 'blocked')
    targets = items.filter((it) => it.status.status !== 'blocked')
  } else {
    const planned = planBatch(items, includeStale)
    targets = planned.targets
    blocking = planned.blocking
  }
  if (blocking.length) throw new Error(blockedMessage('gambar', blocking))
  if (!targets.length) return []

  const finalSheets = autoGenerateSheets ? collectMissingSheetsForClips(project, targets.map((t) => t.clip), ctx) : []
  if (!finalSheets.length) {
    return targets.map((t) => generateClipImage(t.clip.id))
  }

  // Wave 1: base characters, locations, props
  const wave1Jobs = new Map<string, Job>()
  for (const s of finalSheets) {
    if (s.kind === 'character') wave1Jobs.set(s.id, generateCharacterSheet(s.id))
    else if (s.kind === 'location') wave1Jobs.set(s.id, generateLocationSheet(s.id))
    else if (s.kind === 'prop') wave1Jobs.set(s.id, generatePropSheet(s.id))
  }
  const wave2Targets = finalSheets.filter((s) => s.kind === 'derivative')
  const targetClipIds = targets.map((t) => t.clip.id)

  void (async () => {
    const wave1Ids = [...wave1Jobs.values()].map((j) => j.id)
    const w1 = wave1Ids.length ? await waitJobsSettled(wave1Ids) : { anyCanceled: false, failedIds: new Set<string>() }
    if (w1.anyCanceled) return

    const wave2Jobs: Job[] = []
    for (const d of wave2Targets) {
      const deriv = getDerivative(d.id)
      if (!deriv) continue
      try {
        const char = getCharacter(deriv.characterId)
        const parentJob = wave1Jobs.get(char.id)
        const blocker = derivativeWaveBlocker(
          parentJob ? (getJob(parentJob.id)?.status ?? null) : null,
          !!char.sheetAssetId,
          w1.anyCanceled
        )
        if (!blocker) wave2Jobs.push(generateDerivativeSheet(d.id))
        else if (blocker.skip === 'failed') recordSkippedSheet(projectId, deriv.characterId, d.id, blocker.reason)
      } catch (err) {
        recordSkippedSheet(projectId, deriv.characterId, d.id, err instanceof Error ? err.message : String(err))
      }
    }

    if (wave2Jobs.length) {
      const w2 = await waitJobsSettled(wave2Jobs.map((j) => j.id))
      if (w2.anyCanceled) return
    }

    // Wave 3: generate clip images for clips whose prerequisites are now satisfied.
    for (const cid of targetClipIds) {
      try {
        generateClipImage(cid)
      } catch (err) {
        console.warn('[smart-batch-image] skipped clip after sheet wave:', cid, (err as Error).message)
      }
    }
  })()

  return [...wave1Jobs.values()]
}

/** Generates AI video for the clips the creator picked; checks all video prerequisites (including continueFromPrevious). */
export function generateClipsVideo(clipIds: string[], autoTrimSilence = true): Job[] {
  if (!clipIds.length) return []
  for (const id of clipIds) {
    const clip = getClip(id)
    const prereqs = checkClipVideoPrerequisites(clip, getProject(clip.projectId), prereqContext(clip.projectId, clip.episodeId))
    if (!prereqs.ok) {
      throw new Error(`Klip "${clip.title || id}" tidak memenuhi syarat video:\n- ${prereqs.blockers.join('\n- ')}`)
    }
  }
  return clipIds.map((id) => generateClipVideo(id, autoTrimSilence))
}

/**
 * Turns the clips that have an image into videos (§6.J). Clips without a storyboard image are skipped so
 * image and video generation remain strictly separate.
 */
export function generateMissingVideos(
  projectId: string,
  episodeId?: string,
  includeStale = false,
  clipIds?: string[],
  autoTrimSilence = true
): Job[] {
  const project = getProject(projectId)
  const ctx = prereqContext(projectId, episodeId)
  const idFilter = clipIds?.length ? new Set(clipIds) : null
  const allScoped = clipsOf(projectId, episodeId)
    .map((clip, i) => ({ clip, index: i + 1, title: clip.title || `Shot ${i + 1}`, status: getClipVideoStatus(clip, project, ctx) }))
    .filter((it) => !idFilter || idFilter.has(it.clip.id))

  // Keep image and video strictly separated: clips without a storyboard image are skipped, not auto-imaged.
  const withImage = allScoped.filter((it) => !!it.clip.imageAssetId || !!it.clip.continueFromPrevious)

  let targets: typeof withImage
  let blocking: typeof withImage
  if (idFilter) {
    blocking = withImage.filter((it) => it.status.status === 'blocked')
    targets = withImage.filter((it) => it.status.status !== 'blocked')
  } else {
    const planned = planBatch(withImage, includeStale)
    targets = planned.targets
    blocking = planned.blocking
  }
  if (blocking.length) throw new Error(blockedMessage('video', blocking))
  return targets.map((t) => generateClipVideo(t.clip.id, autoTrimSilence))
}

export function generateMissingTts(projectId: string, episodeId?: string): Job[] {
  const project = getProject(projectId)
  return clipsOf(projectId, episodeId)
    .filter((c) => !c.audioAssetId && c.narration.trim() && !isVideoDialogue(project, c))
    .map((c) => generateClipTts(c.id))
}

/**
 * What a batch would make and cost (§6.J). Supports optional `clipIds` selection and smart prerequisite sheets
 * (`autoGenerateSheets`) for image batches. Video batches never auto-generate missing images.
 */
export async function batchEstimate(
  projectId: string,
  episodeId: string | undefined,
  kind: 'image' | 'video',
  includeStale = false,
  clipIds?: string[],
  autoGenerateSheets = false
): Promise<BatchEstimateResult> {
  const project = getProject(projectId)
  const ctx = prereqContext(projectId, episodeId)
  const settings = getSettings()
  const activeImage = resolveActive(settings, 'image')
  const activeVideo = resolveActive(settings, 'video')
  const modelName =
    kind === 'image'
      ? ctx.isFlow2Api
        ? getFlow2ApiModel(activeImage.model, 'image').name
        : getImageModel(activeImage.model).name
      : ctx.isFlow2Api
        ? getFlow2ApiModel(activeVideo.model, 'video').name
        : getVideoModel(activeVideo.model).name

  const idFilter = clipIds?.length ? new Set(clipIds) : null
  const allScoped = clipsOf(projectId, episodeId)
    .map((clip, i) => ({ clip, index: i + 1, title: clip.title || `Shot ${i + 1}` }))
    .filter((it) => !idFilter || idFilter.has(it.clip.id))

  let skippedMissingImageCount = 0
  let prerequisiteSheets: PrerequisiteSheetEstimate[] = []
  let prerequisiteCredits: number | null = null
  let evalCtx = ctx
  let scopedForEval = allScoped

  if (kind === 'video') {
    const missingImg = allScoped.filter((it) => !it.clip.imageAssetId && !it.clip.continueFromPrevious)
    skippedMissingImageCount = missingImg.length
    scopedForEval = allScoped.filter((it) => !!it.clip.imageAssetId || !!it.clip.continueFromPrevious)
  } else if (autoGenerateSheets) {
    const candidateClips = idFilter
      ? allScoped.map((it) => it.clip)
      : allScoped.filter((it) => !it.clip.imageAssetId || includeStale).map((it) => it.clip)
    const needed = collectMissingSheetsForClips(project, candidateClips, ctx)
    if (needed.length) {
      evalCtx = withSimulatedSheets(ctx, needed)
      let pricePerSheet: number | null = null
      if (!ctx.isFlow2Api) {
        const est = await estimateCredits('image', activeImage.model, '16:9', 0, null).catch(() => null)
        pricePerSheet = est?.credits ?? null
      }
      prerequisiteSheets = needed.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        estimatedCredits: pricePerSheet
      }))
      prerequisiteCredits = pricePerSheet != null ? Math.round(needed.length * pricePerSheet * 10) / 10 : null
    }
  }

  const items = scopedForEval.map((it) => ({
    ...it,
    status: kind === 'image' ? getClipImageStatus(it.clip, project, evalCtx) : getClipVideoStatus(it.clip, project, evalCtx)
  }))

  let targets: typeof items
  let blocking: typeof items
  if (idFilter) {
    blocking = items.filter((it) => it.status.status === 'blocked')
    targets = items.filter((it) => it.status.status !== 'blocked')
  } else {
    const planned = planBatch(items, includeStale)
    targets = planned.targets
    blocking = planned.blocking
  }

  // Filter prerequisiteSheets down to only those actually needed by the final `targets`.
  if (kind === 'image' && autoGenerateSheets && prerequisiteSheets.length) {
    const actualNeeded = collectMissingSheetsForClips(project, targets.map((t) => t.clip), ctx)
    const neededKeys = new Set(actualNeeded.map((s) => `${s.kind}:${s.id}`))
    prerequisiteSheets = prerequisiteSheets.filter((s) => neededKeys.has(`${s.kind}:${s.id}`))
    if (!prerequisiteSheets.length) {
      prerequisiteCredits = null
    } else if (prerequisiteSheets.every((s) => s.estimatedCredits != null)) {
      prerequisiteCredits = Math.round(prerequisiteSheets.reduce((a, s) => a + (s.estimatedCredits ?? 0), 0) * 10) / 10
    } else {
      prerequisiteCredits = null
    }
  }

  // One estimate per distinct video length: the price depends on it, and lookups are cached anyway.
  const priceBySeconds = new Map<number, number | null>()
  const priceOf = async (clip: Clip): Promise<number | null> => {
    if (ctx.isFlow2Api) return null
    const seconds = kind === 'video' ? videoSecondsFor(project, clip, ctx).seconds : 0
    if (!priceBySeconds.has(seconds)) {
      const est = await estimateCredits(kind, (kind === 'image' ? ctx.activeImageModel : ctx.activeVideoModel) || '', project.aspectRatio, seconds || 5, project.videoResolution).catch(() => null)
      priceBySeconds.set(seconds, est?.credits ?? null)
    }
    return priceBySeconds.get(seconds) ?? null
  }

  const shown = items.filter((it) => targets.includes(it) || blocking.includes(it))
  const out: BatchEstimateItem[] = []
  for (const it of shown) {
    out.push({
      clipId: it.clip.id,
      clipIndex: it.index,
      title: it.title,
      kind,
      model: modelName,
      status: it.status.status,
      blockers: it.status.blockers,
      estimatedCredits: targets.includes(it) ? await priceOf(it.clip) : null
    })
  }

  const prices = out.filter((o) => o.status !== 'blocked').map((o) => o.estimatedCredits)
  const itemsCredits = prices.length && prices.every((p) => p != null) ? Math.round(prices.reduce<number>((a, p) => a + (p ?? 0), 0) * 10) / 10 : null
  const totalCredits =
    itemsCredits != null && (!prerequisiteSheets.length || prerequisiteCredits != null)
      ? Math.round((itemsCredits + (prerequisiteCredits ?? 0)) * 10) / 10
      : null

  return {
    canRun: blocking.length === 0 && targets.length > 0,
    totalItems: targets.length,
    totalCredits,
    items: out,
    blockedCount: blocking.length,
    missingCount: items.filter((i) => i.status.status === 'missing').length,
    staleCount: items.filter((i) => i.status.status === 'stale').length,
    ...(prerequisiteSheets.length ? { prerequisiteSheets, prerequisiteCredits } : {}),
    ...(skippedMissingImageCount > 0 ? { skippedMissingImageCount } : {})
  }
}

interface SheetBatchItem {
  id: string
  name: string
  kind: 'character' | 'derivative' | 'location' | 'prop'
  status: SheetStatusResult
}

/** Every Lorebook entity with its sheet status. Shared by the estimate and the run so both see the same targets. */
function sheetBatchItems(
  projectId: string,
  includeStale: boolean
): { targets: SheetBatchItem[]; blocking: SheetBatchItem[]; all: SheetBatchItem[] } {
  const project = getProject(projectId)
  const characters = charactersOf(projectId)
  const assets = assetsOf(projectId)
  const model = activeImageModelId()

  const charItems: SheetBatchItem[] = characters.map((c) => ({
    id: c.id,
    name: c.name,
    kind: 'character',
    status: getCharacterSheetStatus(c, project, assets, model)
  }))
  const charTargets = new Set(
    charItems.filter((i) => i.status.status === 'missing' || (includeStale && i.status.status === 'stale')).map((i) => i.id)
  )

  const derivItems: SheetBatchItem[] = derivativesOf(projectId).map((d) => {
    const parent = characters.find((c) => c.id === d.characterId)
    // A variant whose base sheet is made earlier in this same batch is not blocked: wave 2 waits for it.
    const baseWillBeGenerated = !!parent && charTargets.has(parent.id)
    return {
      id: d.id,
      name: `${parent ? parent.name + ' - ' : ''}${d.name}`,
      kind: 'derivative',
      status: getDerivativeSheetStatus(d, parent, project, assets, baseWillBeGenerated, model)
    }
  })
  const locItems: SheetBatchItem[] = locationsOf(projectId).map((l) => ({
    id: l.id,
    name: l.name,
    kind: 'location',
    status: getLocationSheetStatus(l, project, assets, model)
  }))
  const propItems: SheetBatchItem[] = propsOf(projectId).map((p) => ({
    id: p.id,
    name: p.name,
    kind: 'prop',
    status: getPropSheetStatus(p, project, assets, model)
  }))

  const all = [...charItems, ...derivItems, ...locItems, ...propItems]
  return { ...planBatchSheets(all, includeStale), all }
}

export async function batchEstimateSheets(projectId: string, includeStale = false): Promise<BatchEstimateSheetResult> {
  const ctx = prereqContext(projectId)
  const settings = getSettings()
  const activeImage = resolveActive(settings, 'image')
  const modelName = ctx.isFlow2Api
    ? getFlow2ApiModel(activeImage.model, 'image').name
    : getImageModel(activeImage.model).name
  const { targets, blocking, all } = sheetBatchItems(projectId, includeStale)

  // Sheets are always one 16:9 image, so one lookup prices the whole batch; Flow2API spends no Higgsfield credits.
  let pricePerSheet: number | null = null
  if (!ctx.isFlow2Api) {
    const est = await estimateCredits('image', activeImage.model, '16:9', 0, null).catch(() => null)
    pricePerSheet = est?.credits ?? null
  }

  const items: BatchEstimateSheetItem[] = all
    .filter((it) => targets.includes(it) || blocking.includes(it))
    .map((it) => ({
      id: it.id,
      name: it.name,
      kind: it.kind,
      model: modelName,
      status: it.status.status,
      blockers: it.status.blockers,
      estimatedCredits: targets.includes(it) ? pricePerSheet : null
    }))

  return {
    canRun: blocking.length === 0 && targets.length > 0,
    totalItems: targets.length,
    totalCredits: pricePerSheet != null ? Math.round(targets.length * pricePerSheet * 10) / 10 : null,
    items,
    blockedCount: blocking.length,
    missingCount: all.filter((i) => i.status.status === 'missing').length,
    staleCount: all.filter((i) => i.status.status === 'stale').length
  }
}

/** Why a wave-2 variant must not start once wave 1 has settled, or null when it can. */
export function derivativeWaveBlocker(
  parentJobStatus: Job['status'] | null,
  parentHasSheet: boolean,
  anyWave1Canceled: boolean
): { skip: 'canceled' } | { skip: 'failed'; reason: string } | null {
  // Cancelling any part of the batch stops the variants too: they would spend credits the creator just refused.
  if (anyWave1Canceled) return { skip: 'canceled' }
  if (parentJobStatus && parentJobStatus !== 'done') {
    return { skip: 'failed', reason: 'Lembar karakter dasar gagal dibuat, jadi varian kostum ini dilewati.' }
  }
  if (!parentHasSheet) return { skip: 'failed', reason: 'Karakter belum punya lembar dasar, jadi varian kostum ini dilewati.' }
  return null
}

/**
 * Makes the missing (and, when asked, stale) Lorebook sheets in two waves: base characters, locations and props
 * first, then costume variants, which are edits of their base sheet and need it on disk. All or nothing (§6.J):
 * if anything that would be made is blocked, nothing starts.
 */
export function generateMissingSheets(projectId: string, includeStale = false): Job[] {
  const { targets, blocking } = sheetBatchItems(projectId, includeStale)
  if (blocking.length) {
    const reasons = blocking.map((b) => `${b.name}: ${b.status.blockers.join(', ')}`).join('\n')
    throw new Error(`Ada ${blocking.length} lembar Lorebook yang terblokir:\n${reasons}`)
  }

  const wave1Jobs = new Map<string, Job>()
  for (const t of targets) {
    if (t.kind === 'character') wave1Jobs.set(t.id, generateCharacterSheet(t.id))
    else if (t.kind === 'location') wave1Jobs.set(t.id, generateLocationSheet(t.id))
    else if (t.kind === 'prop') wave1Jobs.set(t.id, generatePropSheet(t.id))
  }
  const wave2Targets = targets.filter((t) => t.kind === 'derivative')

  if (wave2Targets.length > 0) {
    void (async () => {
      const ids = [...wave1Jobs.values()].map((j) => j.id)
      const settled = (id: string) => !['queued', 'running'].includes(getJob(id)?.status ?? '')
      while (!ids.every(settled)) {
        await new Promise((r) => setTimeout(r, 500))
      }
      const anyCanceled = ids.some((id) => getJob(id)?.status === 'canceled')
      for (const d of wave2Targets) {
        const deriv = getDerivative(d.id)
        if (!deriv) continue
        try {
          const char = getCharacter(deriv.characterId)
          const parentJob = wave1Jobs.get(char.id)
          const blocker = derivativeWaveBlocker(
            parentJob ? (getJob(parentJob.id)?.status ?? null) : null,
            !!char.sheetAssetId,
            anyCanceled
          )
          if (!blocker) generateDerivativeSheet(d.id)
          else if (blocker.skip === 'failed') recordSkippedSheet(projectId, deriv.characterId, d.id, blocker.reason)
        } catch (err) {
          recordSkippedSheet(projectId, deriv.characterId, d.id, err instanceof Error ? err.message : String(err))
        }
      }
    })()
  }

  return [...wave1Jobs.values()]
}

/** A failed job row, so a variant that wave 2 could not start shows up in the job list instead of vanishing. */
function recordSkippedSheet(projectId: string, characterId: string, derivativeId: string, reason: string): void {
  const job = insertJob({
    projectId,
    characterId,
    kind: 'sheet',
    provider: isFlow2Api() ? 'flow2api' : 'higgsfield',
    payload: { target: 'derivative-sheet', derivativeId }
  })
  emit.job(updateJob(job.id, { status: 'failed', error: reason, message: null }))
}


/**
 * The series progress shown in the Episode Hub. Sheet and clip counts use the same status functions as the
 * Lorebook badges and the Storyboard, so the summary never disagrees with what those screens show.
 */
const noResult = (status: ClipStatusResult['status'], assetId: string | null): boolean =>
  status === 'missing' || (status === 'blocked' && !assetId)

export function seriesProgress(projectId: string): SeriesProgressSummary {
  const project = getProject(projectId)
  const baseCtx = prereqContext(projectId)
  const episodes = listEpisodes(projectId)
  const episodeById = new Map(episodes.map((e) => [e.id, e]))
  const ctxForClip = (c: Clip): GenerationPrerequisitesContext => {
    const ep = c.episodeId ? episodeById.get(c.episodeId) : undefined
    if (!ep?.lockWords?.length) return baseCtx
    return { ...baseCtx, lockWords: [...(project.seriesLock || []), ...ep.lockWords] }
  }
  const { all: sheets } = sheetBatchItems(projectId, false)
  const clips = clipsOf(projectId)

  const notConfirmed = episodes.filter((e) => e.status === 'draft' || e.status === 'planned')
  return {
    totalEpisodes: episodes.length,
    plannedEpisodes: notConfirmed.length,
    draftScriptEpisodes: notConfirmed.filter((e) => !!e.scriptDraft).length,
    confirmedEpisodes: episodes.length - notConfirmed.length,
    totalAssets: sheets.length,
    missingSheets: sheets.filter((i) => i.status.status === 'missing' || (i.status.status === 'blocked' && !i.status.hasResult)).length,
    totalClips: clips.length,
    // A blocked clip with no result yet still counts as "not made": the Storyboard shows it without a picture.
    missingClipImages: clips.filter((c) => noResult(getClipImageStatus(c, project, ctxForClip(c)).status, c.imageAssetId)).length,
    missingClipVideos: clips.filter((c) => noResult(getClipVideoStatus(c, project, ctxForClip(c)).status, c.videoAssetId)).length,
    missingClipAudio: clips.filter((c) => c.narration.trim() && !isVideoDialogue(project, c) && !c.audioAssetId).length
  }
}

/** After a restart, keep polling Higgsfield requests that were already submitted; fail the rest. */
export function resumeJobs(): void {
  for (const row of unfinishedJobs()) {
    const payload = JSON.parse(row.payload_json || '{}') as Partial<HfPayload>
    if (row.provider === 'higgsfield' && row.remote_id && payload.target) {
      const job = getJob(row.id)!
      runJob(job, 'higgsfield', (ctx) => finishHiggsfield(ctx, job, row.remote_id, payload as HfPayload))
    } else {
      emit.job(updateJob(row.id, { status: 'failed', error: 'Terhenti karena aplikasi ditutup. Coba lagi.', message: null }))
    }
  }
}

export async function setActiveAsset(clipId: string, assetId: string): Promise<void> {
  const asset = getAsset(assetId)
  if (!asset || asset.clipId !== clipId) throw new Error('Aset tidak cocok dengan klip ini')
  const patch: Partial<Clip> =
    asset.kind === 'image'
      ? { imageAssetId: asset.id }
      : asset.kind === 'video'
        ? { videoAssetId: asset.id, mediaInMs: 0 }
        : asset.kind === 'audio'
          ? { audioAssetId: asset.id, durationMs: Math.max(1500, (asset.durationMs ?? 0) + 400), voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
          : {}
  if (asset.kind === 'video') {
    const voice = assetsOf(asset.projectId).find((a) => a.kind === 'audio' && a.clipId === clipId && a.meta.videoAssetId === asset.id)
    if (voice) Object.assign(patch, { audioAssetId: voice.id, durationMs: Math.max(1000, asset.durationMs ?? voice.durationMs ?? 0), voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 })
  }
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
}

/** Estimates that failed recently (no key, or a model the account cannot use), so pickers do not keep asking. */
const failedEstimates = new Map<string, number>()

/**
 * Credits for one image, or one clip video of about `seconds`. The model pickers ask for every model,
 * so answers are kept for a day and failures for ten minutes.
 */
export async function estimateCredits(
  kind: 'image' | 'video',
  modelId: string,
  aspect: AspectRatio,
  seconds = 5,
  resolution?: string | null
): Promise<CreditEstimate | null> {
  if (isFlow2Api()) return null
  const model = kind === 'image' ? getImageModel(modelId) : getVideoModel(modelId)
  const body =
    kind === 'image'
      ? imageBody(model, 'estimate', aspect, [])
      : videoBody(model, 'estimate', 'https://example.com/frame.png', seconds, aspect, resolution)
  const key = `estimate:${model.id}:${JSON.stringify(body)}`
  const hit = readCache<CreditEstimate>(key)
  if (hit && Date.now() - hit.updatedAt < DAY) return hit.value
  const failedAt = failedEstimates.get(key)
  if (failedAt && Date.now() - failedAt < 10 * 60 * 1000) return null
  const value = await hf.estimate(model.id, body)
  if (value) writeCache(key, value)
  else failedEstimates.set(key, Date.now())
  return value
}

/** Prices can differ per account, so a new Higgsfield key starts from fresh estimates. */
export function forgetEstimates(): void {
  failedEstimates.clear()
  dropCache('estimate:')
}
