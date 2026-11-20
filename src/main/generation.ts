import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { estimateWordTimings, WHISPER_TIMING } from '@shared/captions'
import { spokenWords, stripVoiceTags } from '@shared/speech'
import { getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, resolutionOptions, videoBody, type HfModel } from '@shared/higgsfield'
import { getStyle, NO_TEXT } from '@shared/styles'
import { collectReferenceSheets, compileClipPrompt, compileClipVideoPrompt } from '@shared/prompts'
import {
  computeCharacterSheetBasisHash,
  computeClipTtsBasisHash,
  computeClipVideoBasisHash,
  computeDerivativeSheetBasisHash,
  computeLocationSheetBasisHash,
  computePropSheetBasisHash
} from '@shared/hash'
import {
  checkClipImagePrerequisites,
  checkClipVideoPrerequisites,
  clipImageBasis,
  getClipImageStatus,
  getClipVideoStatus,
  isVideoDialogue,
  planBatch,
  referenceLimit,
  videoSecondsFor,
  type ClipStatusResult,
  type GenerationPrerequisitesContext
} from '@shared/validation'
import type {
  AspectRatio,
  Asset,
  BatchEstimateItem,
  BatchEstimateResult,
  Character,
  CharacterDerivative,
  Clip,
  CreditEstimate,
  Job,
  Location,
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
  getJob,
  getLocation,
  getProject,
  getProp,
  insertAsset,
  insertJob,
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
import { extractAudio, probeDurationMs, probeHasAudio, probeSize } from './services/audio'
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
  return `${c.name}: ${c.description}`
}

function sheetPrompt(project: Project, c: Character): string {
  const style = getStyle(project.styleId)
  return [
    style.prompt,
    `Character reference sheet for "${c.name}": ${c.description}. The character is ${style.characterHint}.`,
    'Show the SAME character three times side by side: front view, three-quarter view and side view, full body, neutral standing pose, evenly spaced, on a plain light neutral background (this overrides any background instruction above). Consistent proportions, costume and colors in all three views.'
  ].join('\n\n')
}

function derivativeSheetPrompt(project: Project, c: Character, d: CharacterDerivative): string {
  const style = getStyle(project.styleId)
  return [
    style.prompt,
    `Character reference sheet variant for "${c.name}" (${d.name}). Base appearance: ${c.description}. Costume change: ${d.promptChange}. The character is ${style.characterHint}.`,
    'Show the SAME character three times side by side: front view, three-quarter view and side view, full body, neutral standing pose, evenly spaced, on a plain light neutral background. Consistent proportions, face, hair, and costume in all three views matching the costume modification.'
  ].join('\n\n')
}

function locationSheetPrompt(project: Project, l: Location): string {
  const style = getStyle(project.styleId)
  return [
    style.prompt,
    `Location environment reference for "${l.name}": ${l.description || l.name}.`,
    'Clean architectural or landscape establishing shot, cinematic composition, NO people, NO characters, empty scenery, high detail, clear lighting.'
  ].join('\n\n')
}

function propSheetPrompt(project: Project, p: Prop): string {
  const style = getStyle(project.styleId)
  return [
    style.prompt,
    `Prop reference sheet for "${p.name}": ${p.description || p.name}.`,
    'Isolated studio shot of the single object, clean light neutral background, high detail, centered, NO people, NO hands holding it.'
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

async function resolveReferenceUrls(
  model: HfModel,
  items: { sheetAssetId: string; name: string }[],
  signal: AbortSignal
): Promise<{ urls: string[]; names: string[] }> {
  const limit = maxRefs(model)
  if (limit === 0 || !items.length) return { urls: [], names: [] }
  const urls: string[] = []
  const names: string[] = []
  for (const it of items) {
    if (urls.length >= limit) break
    const sheet = getAsset(it.sheetAssetId)
    if (!sheet) continue
    urls.push(await publicUrlFor(sheet, signal))
    names.push(it.name)
  }
  return { urls, names }
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
}

/**
 * Takes the spoken line out of a freshly generated dialogue video and makes it the clip's voice (§6.C), with
 * caption words timed by Whisper. The clip takes the video's length so the line is never cut at the old clip end.
 * When the video has no usable sound the reason is stored on the video asset, so the storyboard can say so instead
 * of leaving a silent clip (narration skips dialogue clips, so nothing else would voice it).
 */
export async function extractVideoDialogueAudio(projectId: string, clipId: string, video: Asset, signal?: AbortSignal): Promise<Asset | null> {
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

  const patch: Partial<Clip> = {
    audioAssetId: asset.id,
    durationMs: Math.max(1000, video.durationMs ?? durationMs ?? clip.durationMs),
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
      ...(payload.basisHash ? { basisHash: payload.basisHash } : {})
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
    await extractVideoDialogueAudio(job.projectId, job.clipId, asset, ctx.signal)
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
    ctx.progress(0.08, 'Mengirim ke Higgsfield')
    const submitStartedAt = Date.now()
    const requestId = await hf.submit(endpoint, body, ctx.signal)
    console.info('[higgsfield] submit accepted', { model: payload.model, elapsedMs: Date.now() - submitStartedAt })
    ctx.setRemote(requestId)
    updateJobPayload(job.id, payload)
    return finishHiggsfield(ctx, job, requestId, payload)
  }, beforeQueue)
}

function updateJobPayload(jobId: string, payload: HfPayload): void {
  getDb().prepare('UPDATE jobs SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), jobId)
}

function isFlow2Api(): boolean {
  return getSettings().defaultVisualProvider === 'flow2api'
}

/** Everything the shared status and prerequisite rules read, gathered once per call. */
function prereqContext(projectId: string): GenerationPrerequisitesContext {
  const s = getSettings()
  return {
    characters: charactersOf(projectId),
    derivatives: derivativesOf(projectId),
    locations: locationsOf(projectId),
    props: propsOf(projectId),
    assets: assetsOf(projectId),
    activeJobs: activeJobsOf(projectId),
    isFlow2Api: isFlow2Api(),
    flow2apiImageModel: s.flow2apiImageModel,
    flow2apiVideoModel: s.flow2apiVideoModel
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
  const prereqs = checkClipImagePrerequisites(clip, getProject(clip.projectId), prereqContext(clip.projectId))
  if (!prereqs.ok) {
    throw new Error(`Syarat generate gambar tidak terpenuhi:\n- ${prereqs.blockers.join('\n- ')}`)
  }

  if (isFlow2Api()) {
    const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const fresh = getClip(clipId)
      const project = getProject(fresh.projectId)
      const pctx = prereqContext(project.id)
      const allChars = pctx.characters
      const allDerivs = pctx.derivatives
      const allLocs = pctx.locations
      const allProps = pctx.props
      const limit = referenceLimit(project, pctx)

      const refItems = collectReferenceSheets(fresh, allChars, allDerivs, allLocs, allProps, limit)

      const refBuffers: Buffer[] = []
      for (const it of refItems) {
        const sheet = getAsset(it.sheetAssetId)
        if (sheet && refBuffers.length < limit) {
          const abs = assetAbsPath(project.id, sheet.localPath)
          if (existsSync(abs)) refBuffers.push(readFileSync(abs))
        }
      }

      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
      const modelId = resolveFlow2ApiModelId(baseModel, project.aspectRatio)
      const prompt = compileClipPrompt({
        project,
        clip: fresh,
        characters: allChars.filter((c) => fresh.characterIds.includes(c.id)),
        derivatives: allDerivs,
        locations: allLocs,
        props: allProps,
        refNames: refItems.map((r) => r.name),
        limit: 4000
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
    })
  }

  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const model = getImageModel(project.imageModel)
    const pctx = prereqContext(project.id)
    const allChars = pctx.characters
    const allDerivs = pctx.derivatives
    const allLocs = pctx.locations
    const allProps = pctx.props

    const refItems = collectReferenceSheets(fresh, allChars, allDerivs, allLocs, allProps, referenceLimit(project, pctx))
    const refs = await resolveReferenceUrls(model, refItems, ctx.signal)
    const prompt = compileClipPrompt({
      project,
      clip: fresh,
      characters: allChars.filter((c) => fresh.characterIds.includes(c.id)),
      derivatives: allDerivs,
      locations: allLocs,
      props: allProps,
      refNames: refs.names,
      limit: promptLimit(model)
    })
    const { basisHash } = clipImageBasis(fresh, project, pctx)
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, project.aspectRatio, refs.urls, getSettings().imageGenerationMode === 'draft' ? resolutionOptions(model)[0] : undefined),
      payload: { target: 'clip-image', model: model.id, prompt, basisHash }
    }
  })
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
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
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
    const model = getImageModel(project.imageModel)
    const refs = await resolveReferenceUrls(
      model,
      chars.map((c) => ({ sheetAssetId: c.sheetAssetId || '', name: c.name })),
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
  const basisHash = computeCharacterSheetBasisHash({
    name: c.name,
    description: c.description,
    styleId: project.styleId,
    imageModel: project.imageModel
  })

  if (isFlow2Api()) {
    const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const prompt = sheetPrompt(project, getCharacter(characterId))
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
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
    const model = getImageModel(project.imageModel)
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
  const basisHash = computeDerivativeSheetBasisHash({
    baseSheetAssetId: c.sheetAssetId,
    promptChange: d.promptChange,
    imageModel: project.imageModel
  })

  if (isFlow2Api()) {
    const job = insertJob({ projectId: c.projectId, characterId: c.id, kind: 'sheet', provider: 'flow2api', payload: { target: 'derivative-sheet', derivativeId } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
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
    const model = getImageModel(project.imageModel)
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
  const basisHash = computeLocationSheetBasisHash({
    name: l.name,
    description: l.description,
    styleId: project.styleId,
    imageModel: project.imageModel
  })

  if (isFlow2Api()) {
    const job = insertJob({ projectId: l.projectId, kind: 'image', provider: 'flow2api', payload: { target: 'location-sheet', locationId } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
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
    const model = getImageModel(project.imageModel)
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
  const basisHash = computePropSheetBasisHash({
    name: pr.name,
    description: pr.description,
    styleId: project.styleId,
    imageModel: project.imageModel
  })

  if (isFlow2Api()) {
    const job = insertJob({ projectId: pr.projectId, kind: 'image', provider: 'flow2api', payload: { target: 'prop-sheet', propId } })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const baseModel = (project.imageModel && !project.imageModel.includes('/') ? project.imageModel : null) ?? getSettings().flow2apiImageModel
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
    const model = getImageModel(project.imageModel)
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'prop-sheet', propId, model: model.id, prompt, basisHash }
    }
  })
}

export function generateClipVideo(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'video')
  if (existing) return existing
  const clip = getClip(clipId)
  if (!clip.imageAssetId) throw new Error('Buat gambar klip ini dulu sebelum membuat video AI.')

  const prereqs = checkClipVideoPrerequisites(clip, getProject(clip.projectId), prereqContext(clip.projectId))
  if (!prereqs.ok) {
    throw new Error(`Syarat generate video tidak terpenuhi:\n- ${prereqs.blockers.join('\n- ')}`)
  }

  if (isFlow2Api()) {
    const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'flow2api' })
    emit.job(job)
    return runJob(job, 'flow2api', async (ctx) => {
      const fresh = getClip(clipId)
      const image = getAsset(fresh.imageAssetId)
      if (!image) throw new Error('Gambar klip tidak ditemukan')
      const project = getProject(fresh.projectId)
      const allChars = charactersOf(project.id)

      const imgAbs = assetAbsPath(project.id, image.localPath)
      if (!existsSync(imgAbs)) throw new Error('File gambar klip tidak ditemukan di disk')
      const imgBuffer = readFileSync(imgAbs)

      const durationSec = videoSecondsFor(project, fresh, prereqContext(project.id)).seconds
      const baseModel = (project.videoModel && !project.videoModel.includes('/') ? project.videoModel : null) ?? getSettings().flow2apiVideoModel
      const video = resolveFlow2ApiVideo(baseModel, project.aspectRatio, durationSec)
      const modelId = video.model

      const prompt = compileClipVideoPrompt(project, fresh, allChars, 2000)
      const basisHash = computeClipVideoBasisHash({ project, clip: fresh, characters: allChars, seconds: durationSec })

      ctx.progress(0.04, 'Menyiapkan video Flow2API (Veo)')
      const { mediaUrl } = await f2a.generateVideo({
        prompt,
        model: modelId,
        aspectRatio: video.aspectRatio,
        durationSec: video.durationSec,
        initialImage: video.withImage ? imgBuffer : undefined,
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
      await extractVideoDialogueAudio(project.id, clipId, asset, ctx.signal)
      return asset.id
    })
  }

  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')
    const project = getProject(fresh.projectId)
    const model = getVideoModel(project.videoModel)
    const allChars = charactersOf(project.id)

    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const url = await publicUrlFor(image, ctx.signal)
    let prompt = compileClipVideoPrompt(project, fresh, allChars, promptLimit(model))
    if (model.input.mode === 'reference') {
      prompt = `Open on the exact scene of the reference image and keep its art style, characters and composition. ${prompt}`
    }
    const seconds = videoSecondsFor(project, fresh, prereqContext(project.id)).seconds
    const basisHash = computeClipVideoBasisHash({ project, clip: fresh, characters: allChars, seconds })
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
      payload: { target: 'clip-video', model: model.id, prompt, basisHash }
    }
  })
}

export function generateClipTts(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'tts')
  if (existing) return existing
  const clip = getClip(clipId)
  const project = getProject(clip.projectId)
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'tts', provider: project.ttsProvider })
  emit.job(job)
  return runJob(job, 'tts', async (ctx) => {
    const fresh = getClip(clipId)
    const p = getProject(fresh.projectId)
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
      if (!voice) throw new Error('Pilih suara ElevenLabs dulu di langkah Ide cerita.')
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

/**
 * Makes the missing (and, when asked, stale) images of an episode (§6.J). All or nothing: if a clip that would
 * be made is blocked, nothing starts.
 */
export function generateMissingImages(projectId: string, episodeId?: string, includeStale = false): Job[] {
  const project = getProject(projectId)
  const ctx = prereqContext(projectId)
  const items = clipsOf(projectId, episodeId).map((clip, i) => ({ clip, index: i + 1, title: clip.title || `Shot ${i + 1}`, status: getClipImageStatus(clip, project, ctx) }))
  const { targets, blocking } = planBatch(items, includeStale)
  if (blocking.length) throw new Error(blockedMessage('gambar', blocking))
  return targets.map((t) => generateClipImage(t.clip.id))
}

/** Generates AI video for the clips the creator picked; every one of them needs an image. */
export function generateClipsVideo(clipIds: string[]): Job[] {
  if (!clipIds.length) return []
  for (const id of clipIds) {
    const clip = getClip(id)
    if (!clip.imageAssetId) {
      throw new Error(`Klip "${clip.title || id}" belum memiliki gambar. Buat gambarnya dulu sebelum dijadikan video.`)
    }
  }
  return clipIds.map((id) => generateClipVideo(id))
}

/**
 * Turns the clips that have an image into videos (§6.J), with the same all-or-nothing rule as images.
 */
export function generateMissingVideos(projectId: string, episodeId?: string, includeStale = false): Job[] {
  const project = getProject(projectId)
  const ctx = prereqContext(projectId)
  const items = clipsOf(projectId, episodeId).map((clip, i) => ({ clip, index: i + 1, title: clip.title || `Shot ${i + 1}`, status: getClipVideoStatus(clip, project, ctx) }))
  const { targets, blocking } = planBatch(items, includeStale)
  if (blocking.length) throw new Error(blockedMessage('video', blocking))
  return targets.map((t) => generateClipVideo(t.clip.id))
}

export function generateMissingTts(projectId: string, episodeId?: string): Job[] {
  const project = getProject(projectId)
  return clipsOf(projectId, episodeId)
    .filter((c) => !c.audioAssetId && c.narration.trim() && !isVideoDialogue(project, c))
    .map((c) => generateClipTts(c.id))
}

/**
 * What a batch would make and cost (§6.J). Video credits follow each clip's fitted length. Flow2API does not
 * spend Higgsfield credits, so its cost is null rather than a made-up number.
 */
export async function batchEstimate(
  projectId: string,
  episodeId: string | undefined,
  kind: 'image' | 'video',
  includeStale = false
): Promise<BatchEstimateResult> {
  const project = getProject(projectId)
  const ctx = prereqContext(projectId)
  const settings = getSettings()
  const modelName =
    kind === 'image'
      ? ctx.isFlow2Api
        ? getFlow2ApiModel(project.imageModel && !project.imageModel.includes('/') ? project.imageModel : settings.flow2apiImageModel, 'image').name
        : getImageModel(project.imageModel).name
      : ctx.isFlow2Api
        ? getFlow2ApiModel(project.videoModel && !project.videoModel.includes('/') ? project.videoModel : settings.flow2apiVideoModel, 'video').name
        : getVideoModel(project.videoModel).name

  const items = clipsOf(projectId, episodeId).map((clip, i) => ({
    clip,
    index: i + 1,
    title: clip.title || `Shot ${i + 1}`,
    status: kind === 'image' ? getClipImageStatus(clip, project, ctx) : getClipVideoStatus(clip, project, ctx)
  }))
  const { targets, blocking } = planBatch(items, includeStale)

  // One estimate per distinct video length: the price depends on it, and lookups are cached anyway.
  const priceBySeconds = new Map<number, number | null>()
  const priceOf = async (clip: Clip): Promise<number | null> => {
    if (ctx.isFlow2Api) return null
    const seconds = kind === 'video' ? videoSecondsFor(project, clip, ctx).seconds : 0
    if (!priceBySeconds.has(seconds)) {
      const est = await estimateCredits(kind, (kind === 'image' ? project.imageModel : project.videoModel) || '', project.aspectRatio, seconds || 5, project.videoResolution).catch(() => null)
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
  const totalCredits = prices.length && prices.every((p) => p != null) ? Math.round(prices.reduce<number>((a, p) => a + (p ?? 0), 0) * 10) / 10 : null
  return {
    canRun: blocking.length === 0 && targets.length > 0,
    totalItems: targets.length,
    totalCredits,
    items: out,
    blockedCount: blocking.length,
    missingCount: items.filter((i) => i.status.status === 'missing').length,
    staleCount: items.filter((i) => i.status.status === 'stale').length
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
