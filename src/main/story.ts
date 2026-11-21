import { createHash } from 'node:crypto'
import { CAMERA_PRESETS, MOTION_STRENGTHS, TRANSITIONS } from '@shared/motion'
import { formatChapters } from '@shared/chapters'
import { LANGUAGES } from '@shared/models'
import { isNarratorName, needsVisual, visualSourceOf } from '@shared/script'
import { getStyle } from '@shared/styles'
import { MIN_EPISODE_DURATION_SEC, MAX_EPISODE_DURATION_SEC } from '@shared/validation'
import type {
  CameraPresetId,
  Clip,
  DraftShot,
  Episode,
  EpisodeScriptDraft,
  MotionStrength,
  MusicPrompt,
  NewAssetProposal,
  PlanBatchScriptsResult,
  PlanEpisodesInput,
  ProjectBundle,
  SmartSfxCue,
  SourceKind,
  ThumbnailConcept,
  TransitionId,
  YoutubeMetadata
} from '@shared/types'
import {
  applyVisuals,
  charactersOf,
  clearEpisodesForReplan,
  clipsOf,
  confirmEpisodeScriptRepo,
  createEpisode,
  derivativesOf,
  getBundle,
  getEpisode,
  getPlanProgress,
  getProject,
  listEpisodes,
  locationsOf,
  patchClip,
  propsOf,
  setPlanProgress,
  updateEpisode,
  type SceneVisual
} from './repo'
import { generateJson } from './services/llm'
import { emit } from './events'

const CAMERA_IDS = CAMERA_PRESETS.map((c) => c.id)
const STRENGTH_IDS = MOTION_STRENGTHS.map((m) => m.id)
const TRANSITION_IDS = TRANSITIONS.map((t) => t.id)

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function languageOf(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.english ?? 'Indonesian'
}

// ---------- Phase 3: AI Episode Planner & Script Drafting ----------

const EPISODE_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    episodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Catchy, dramatic episode title in Indonesian (e.g. Penghinaan di Lobi).' },
          summary: { type: 'string', description: '1-2 sentence synopsis of the episode arc in Indonesian.' },
          hook: { type: 'string', description: 'Intense opening hook in Indonesian: high drama, confrontation, or mystery that immediately grips the audience.' },
          story_beats: {
            type: 'array',
            items: { type: 'string' },
            description: '3 to 6 key dramatic story beats in chronological order, in Indonesian.'
          },
          cliffhanger: { type: 'string', description: 'Addictive closing cliffhanger in Indonesian: high suspense, secret reveal, or critical dilemma.' },
          next_teaser: { type: 'string', description: 'One intriguing teaser sentence for the upcoming episode in Indonesian.' },
          target_duration_sec: { type: 'integer', description: 'Estimated target duration in seconds (usually 60 to 90).' },
          source_excerpt: { type: 'string', description: 'The exact slice of source text covered by this episode.' }
        },
        required: ['title', 'summary', 'hook', 'story_beats', 'cliffhanger', 'next_teaser', 'target_duration_sec', 'source_excerpt']
      }
    }
  },
  required: ['episodes']
}

interface RawEpisodePlanItem {
  title?: string
  summary?: string
  hook?: string
  story_beats?: string[]
  cliffhanger?: string
  next_teaser?: string
  target_duration_sec?: number
  source_excerpt?: string
}

interface RawEpisodePlanResponse {
  episodes?: RawEpisodePlanItem[]
}

/** Source characters per planner call: small enough for any model's context and output, big enough for a few episodes. */
const PLAN_WINDOW_CHARS = 9000
const PLAN_ATTEMPTS = 3

const hashText = (text: string): string => createHash('sha1').update(text).digest('hex')

/** Cuts the source at paragraph (or sentence) boundaries so no episode starts mid-sentence. */
/**
 * Splits a series-wide episode target over the source windows by their length. Largest-remainder rounding keeps
 * the sum equal to the target (each window still gets at least one episode, since every window is planned).
 */
export function splitEpisodeTarget(windowLengths: number[], target: number): number[] {
  if (!windowLengths.length) return []
  const total = windowLengths.reduce((a, b) => a + b, 0) || 1
  const exact = windowLengths.map((len) => (len / total) * Math.max(target, windowLengths.length))
  const out = exact.map((x) => Math.max(1, Math.floor(x)))
  let left = Math.max(target, windowLengths.length) - out.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++
  // The one-episode floor can overshoot when a short window rounds down to zero; take it back from the largest.
  while (left < 0) {
    const big = out.indexOf(Math.max(...out))
    if (out[big] <= 1) break
    out[big]--
    left++
  }
  return out
}

function planWindows(text: string, from: number): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = []
  const minCut = PLAN_WINDOW_CHARS * 0.5
  let start = from
  while (start < text.length) {
    let end = Math.min(text.length, start + PLAN_WINDOW_CHARS)
    if (end < text.length) {
      const slice = text.slice(start, end)
      const para = slice.lastIndexOf('\n\n')
      const line = slice.lastIndexOf('\n')
      const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
      const cut = para > minCut ? para + 2 : line > minCut ? line + 1 : sentence > minCut ? sentence + 2 : -1
      if (cut > 0) end = start + cut
    }
    windows.push({ start, end })
    start = end
  }
  return windows
}

/** Returns why a planner reply cannot be stored, or null when every episode has what the series needs. */
function planProblem(items: RawEpisodePlanItem[]): string | null {
  if (!items.length) return 'tidak ada episode'
  for (const [i, item] of items.entries()) {
    const n = i + 1
    if (!str(item.title)) return `episode ${n} tanpa judul`
    if (!str(item.summary)) return `episode ${n} tanpa ringkasan`
    if (!str(item.hook)) return `episode ${n} tanpa hook`
    if (!str(item.cliffhanger)) return `episode ${n} tanpa cliffhanger`
    if (!Array.isArray(item.story_beats) || item.story_beats.map(str).filter(Boolean).length < 2) return `episode ${n} kurang dari 2 beat`
  }
  return null
}

export async function planEpisodes(input: PlanEpisodesInput): Promise<Episode[]> {
  const projectId = input.projectId
  const project = getProject(projectId)
  const sourceText = (input.sourceText ?? project.sourceText ?? '').trim()
  const sourceKind: SourceKind = input.sourceKind ?? project.sourceKind ?? 'novel'
  const targetDuration = Math.max(
    MIN_EPISODE_DURATION_SEC,
    Math.min(input.targetDurationSec ?? project.durationSec ?? 60, MAX_EPISODE_DURATION_SEC)
  )
  const targetEpisodeCount = input.targetEpisodeCount ?? project.targetEpisodeCount ?? null
  const mode = input.mode ?? 'replace'

  if (!sourceText) {
    throw new Error('Teks sumber cerita masih kosong. Masukkan novel atau naskah serial dulu.')
  }

  let from = 0
  if (mode === 'replace') {
    clearEpisodesForReplan(projectId)
  } else {
    const progress = getPlanProgress(projectId)
    if (progress) {
      if (hashText(sourceText.slice(0, progress.coveredChars)) !== progress.coveredHash) {
        throw new Error('Bagian sumber yang sudah direncanakan telah berubah. Pakai "Rencanakan ulang" supaya episode sesuai teks terbaru.')
      }
      from = progress.coveredChars
    } else if (listEpisodes(projectId).some((e) => e.status !== 'draft')) {
      throw new Error('Belum ada catatan sampai mana sumber direncanakan. Pakai "Rencanakan ulang" untuk memulai dari awal.')
    }
    if (from >= sourceText.length) {
      throw new Error('Semua teks sumber sudah dipecah jadi episode. Tambahkan lanjutan cerita di bawah teks sumber, lalu lanjutkan lagi.')
    }
  }

  const windows = planWindows(sourceText, from)
  // Fixed once before the loop: episodes saved by earlier windows of this run must not shrink the later shares.
  const windowTargets = targetEpisodeCount
    ? splitEpisodeTarget(
        windows.map((w) => w.end - w.start),
        Math.max(1, targetEpisodeCount - (mode === 'continue' ? listEpisodes(projectId).filter((e) => e.status !== 'draft').length : 0))
      )
    : null
  const system = sourceKind === 'screenplay'
    ? [
        'You are an expert drama script supervisor.',
        `You are structuring one part of a completed screenplay into vertical short drama episodes (around ${targetDuration} seconds each).`,
        'CRITICAL RULE: Preserve all original character dialogue, narration, scene flow, and names VERBATIM.',
        'Do not rewrite, summarize, or alter character lines.',
        'Cover the given part completely and in order: every line of it belongs to exactly one episode, nothing outside it.',
        'Divide it into cohesive episodes with clear beginning beats, middle escalation, and a strong cliffhanger moment.',
        'source_excerpt must be the exact, unedited slice of the part that the episode covers.',
        'All output fields must be in Indonesian.'
      ].join(' ')
    : [
        'You are an award-winning vertical short drama showrunner adapting a novel/story into a viral multi-episode short drama series.',
        `You receive one part of the source at a time. Target duration per episode is around ${targetDuration} seconds (about 12-18 shots).`,
        'Cover the given part completely and in order, and nothing outside it.',
        'Every episode MUST follow the addictive short drama formula:',
        '1) Shocking or dramatic opening Hook in the first 5 seconds.',
        '2) Fast-paced conflict escalation with emotional stakes.',
        '3) Heart-pounding Cliffhanger ending that forces the viewer to watch the next episode immediately.',
        'Ensure continuity: each episode Hook must directly address or escalate the previous episode Cliffhanger, including the one given as context.',
        'source_excerpt must be the exact slice of the given part that the episode covers.',
        'All titles, summaries, hooks, beats, teasers, and excerpts must be in gripping, natural Indonesian.'
      ].join(' ')

  for (const [wi, w] of windows.entries()) {
    const part = sourceText.slice(w.start, w.end)
    const existing = listEpisodes(projectId)
    const prev = existing[existing.length - 1]
    const label = windows.length > 1 ? `bagian ${wi + 1} dari ${windows.length}` : 'teks sumber'
    emit.storyProgress({ projectId, message: `Merencanakan episode dari ${label}...` })

    const windowTargetCount = windowTargets?.[wi] ?? null

    const prompt = [
      `Serial Title: ${project.title || '(untitled)'}`,
      `Source Type: ${sourceKind === 'screenplay' ? 'Naskah Jadi (Screenplay)' : 'Novel / Prosa'}`,
      `Target Duration per Episode: ${targetDuration} seconds`,
      windowTargetCount ? `Target Number of Episodes for this part: about ${windowTargetCount} episodes` : '',
      prev && prev.status !== 'draft'
        ? `Previous Episode ${prev.episodeNum} (${prev.title}): ${prev.summary}\nIts cliffhanger, which the first new episode must pick up: ${prev.cliffhanger}`
        : 'This part starts the series.',
      w.end < sourceText.length ? 'More source text follows after this part.' : 'This is the last part of the source: the final episode may resolve the story.',
      `Source Part:\n"""\n${part}\n"""`
    ].filter(Boolean).join('\n\n')

    let items: RawEpisodePlanItem[] = []
    let problem: string | null = 'belum dicoba'
    for (let attempt = 1; attempt <= PLAN_ATTEMPTS && problem; attempt++) {
      if (attempt > 1) emit.storyProgress({ projectId, message: `Mengulang ${label} (percobaan ${attempt}): ${problem}...` })
      try {
        const res = await generateJson<RawEpisodePlanResponse>({ system, prompt, schema: EPISODE_PLAN_SCHEMA, name: 'episode_planner' })
        items = res.episodes ?? []
        problem = planProblem(items)
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e)
      }
    }
    if (problem) {
      const done = listEpisodes(projectId).filter((e) => e.status !== 'draft').length
      throw new Error(
        `Gagal merencanakan ${label} setelah ${PLAN_ATTEMPTS} percobaan (${problem}). ` +
          (done ? `${done} episode sebelumnya sudah tersimpan; tekan "Lanjutkan perencanaan" untuk mencoba lagi dari bagian ini.` : 'Coba lagi.')
      )
    }

    for (const item of items) {
      createEpisode(projectId, {
        title: str(item.title),
        summary: str(item.summary),
        hook: str(item.hook),
        storyBeats: (item.story_beats ?? []).map(str).filter(Boolean),
        cliffhanger: str(item.cliffhanger),
        nextTeaser: str(item.next_teaser),
        sourceText: str(item.source_excerpt) || (items.length === 1 ? part : ''),
        sourceKind,
        status: 'planned',
        durationSec: Math.max(
          MIN_EPISODE_DURATION_SEC,
          Math.min(Number(item.target_duration_sec) || targetDuration, MAX_EPISODE_DURATION_SEC)
        )
      })
    }
    setPlanProgress(projectId, { coveredChars: w.end, coveredHash: hashText(sourceText.slice(0, w.end)) })
  }

  const finalEps = listEpisodes(projectId)
  if (targetEpisodeCount) {
    const diff = finalEps.length - targetEpisodeCount
    if (diff !== 0) {
      emit.storyProgress({
        projectId,
        message: `Rencana episode tersimpan: ${finalEps.length} episode dibuat (target: ${targetEpisodeCount}, selisih ${diff > 0 ? '+' : ''}${diff}).`
      })
    } else {
      emit.storyProgress({
        projectId,
        message: `Rencana episode tersimpan: tepat ${finalEps.length} episode sesuai target.`
      })
    }
  } else {
    emit.storyProgress({ projectId, message: 'Rencana episode tersimpan.' })
  }
  return finalEps
}

const SCRIPT_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'Short scene label, e.g. "Shot 1: Tamparan Manajer".' },
          sourceExcerpt: { type: 'string', description: 'Source text excerpt corresponding to this shot.' },
          visualAction: { type: 'string', description: 'Concise, clear visual action describing what happens on screen.' },
          characters: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of characters visible in the shot.'
          },
          costumes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                character: { type: 'string' },
                variant: { type: 'string' }
              },
              required: ['character', 'variant']
            },
            description: 'Costume variant for each visible character: a registered variant name, a newly proposed variant, or "default" for the look on the base character sheet.'
          },
          location: { type: 'string', description: 'Location name where the shot takes place.' },
          props: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key props visible or used in this shot.'
          },
          speaker: {
            type: 'string',
            description: 'Name of the on-screen character who speaks the line, who must also be listed in characters. Empty string for narration (voice-over) and for silent shots.'
          },
          text: { type: 'string', description: 'Dialogue line spoken in the shot, or narration text. Empty if silent.' },
          emotion: { type: 'string', description: 'Emotional delivery and facial expression, e.g. "marah, mencemooh".' },
          framing: { type: 'string', description: 'Shot framing: close-up, medium shot, extreme close-up, two-shot, over-the-shoulder, wide.' },
          durationSec: { type: 'integer', description: 'Shot duration in seconds (typically 3 to 7).' }
        },
        required: ['title', 'sourceExcerpt', 'visualAction', 'characters', 'costumes', 'location', 'props', 'speaker', 'text', 'emotion', 'framing', 'durationSec']
      }
    },
    newAssets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['character', 'derivative', 'location', 'prop'] },
          name: { type: 'string', description: 'Name of the entity.' },
          description: { type: 'string', description: 'Visual appearance, style, or details.' },
          action: { type: 'string', enum: ['create', 'merge', 'derivative', 'ignore'] },
          target: { type: 'string', description: 'Name or ID of existing target entity if action is merge or derivative' },
          reason: { type: 'string', description: 'Explanation why this asset is needed in this episode.' }
        },
        required: ['kind', 'name', 'description', 'action', 'target', 'reason']
      }
    }
  },
  required: ['shots', 'newAssets']
}

interface RawCostumeItem {
  character?: string
  variant?: string
}

interface RawDraftShot {
  title?: string
  sourceExcerpt?: string
  visualAction?: string
  characters?: string[]
  costumes?: RawCostumeItem[] | Record<string, string>
  location?: string
  props?: string[]
  speaker?: string
  text?: string
  emotion?: string
  framing?: string
  durationSec?: number
}

interface RawScriptDraftResponse {
  shots?: RawDraftShot[]
  newAssets?: NewAssetProposal[]
}

export async function planEpisodeScript(projectId: string, episodeId: string): Promise<EpisodeScriptDraft> {
  const project = getProject(projectId)
  const ep = getEpisode(episodeId)
  if (!ep || ep.projectId !== projectId) throw new Error('Episode tidak ditemukan.')

  const allEpisodes = listEpisodes(projectId)
  const epIdx = allEpisodes.findIndex((e) => e.id === episodeId)
  const prevEp = epIdx > 0 ? allEpisodes[epIdx - 1] : null
  const nextEp = epIdx >= 0 && epIdx < allEpisodes.length - 1 ? allEpisodes[epIdx + 1] : null

  const chars = charactersOf(projectId)
  const locs = locationsOf(projectId)
  const prs = propsOf(projectId)
  const derivs = derivativesOf(projectId)

  emit.storyProgress({ projectId, message: `Menyusun rencana naskah shot untuk ${ep.title}...` })

  const castSummary = chars.length
    ? chars.map((c) => {
        const cDerivs = derivs.filter((d) => d.characterId === c.id).map((d) => d.name)
        return `- ${c.name} (aliases: ${c.aliases.join(', ') || 'none'}, variants: ${cDerivs.join(', ') || 'default'}): ${c.description}`
      }).join('\n')
    : '(Belum ada karakter terdaftar di Lorebook)'

  const locSummary = locs.length
    ? locs.map((l) => `- ${l.name} (aliases: ${l.aliases.join(', ') || 'none'}): ${l.description}`).join('\n')
    : '(Belum ada lokasi terdaftar di Lorebook)'

  const propSummary = prs.length
    ? prs.map((p) => `- ${p.name}: ${p.description}`).join('\n')
    : '(Belum ada prop terdaftar di Lorebook)'

  const system = [
    'You are a master vertical short drama scriptwriter and director.',
    'You are planning the shot-by-shot script for an episode in an intense vertical short drama series (9:16 format).',
    'Follow these critical short drama directing rules:',
    '1. SHOT-REVERSE-SHOT: Around 80% of conversation shots must be close-up or reaction shots of the speaker or listener with intense facial expressions.',
    '2. ONE SHOT = AT MOST ONE SPEECH: Exactly one character speaks per shot. If a character speaks dialogue, they MUST be visible in that shot.',
    '3. HOOK AND CLIFFHANGER: The first shot must vividly display the opening Hook. The last shot must land on the heart-stopping Cliffhanger.',
    '4. CONTINUITY: If a previous episode ended on a cliffhanger, this episode must immediately resolve or escalate it in the opening beats.',
    '5. DEFAULT COSTUMES: Each character wears a consistent costume variant for the episode unless an explicit wardrobe change occurs in the story.',
    '6. LOREBOOK & ASSET DETECTION: Match characters, locations, and props to registered entities whenever possible.',
    'If the story introduces a new recurring character, costume variant, location, or prop not in the Lorebook, propose it in "newAssets" with kind, name, description, action, target, and reason.',
    'Write dialogue, action, emotions, and titles in natural, dramatic Indonesian.'
  ].join('\n')

  const prompt = [
    `Current Episode: ${ep.title} (Target duration: ${ep.durationSec}s)`,
    `Episode Hook: ${ep.hook || '(none)'}`,
    `Story Beats:\n${(ep.storyBeats ?? []).map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
    `Episode Cliffhanger: ${ep.cliffhanger || '(none)'}`,
    ep.sourceText ? `Episode Source Text:\n"""\n${ep.sourceText}\n"""` : `Serial Synopsis:\n${project.synopsis}`,
    prevEp ? `Previous Episode (${prevEp.title}): Summary: ${prevEp.summary}. Cliffhanger to resolve: ${prevEp.cliffhanger}` : 'This is Episode 1 (Premiere).',
    nextEp ? `Next Episode (${nextEp.title}): Hook leading to: ${nextEp.hook}. Beats: ${(nextEp.storyBeats ?? []).join(', ')}` : 'This is the Final Episode.',
    `\n--- REGISTERED LOREBOOK ASSETS ---`,
    `Characters:\n${castSummary}`,
    `Locations:\n${locSummary}`,
    `Props:\n${propSummary}`
  ].join('\n\n')

  const res = await generateJson<RawScriptDraftResponse>({
    system,
    prompt,
    schema: SCRIPT_DRAFT_SCHEMA,
    name: `episode_script_${episodeId}`
  })

  const rawShots = res.shots ?? []
  if (!rawShots.length) {
    throw new Error('AI belum menghasilkan shot untuk episode ini. Coba lagi.')
  }

  const cleanShots: DraftShot[] = rawShots.map((s, i) => {
    const costumeMap: Record<string, string> = {}
    if (Array.isArray(s.costumes)) {
      for (const item of s.costumes) {
        if (item.character && item.variant) {
          costumeMap[str(item.character)] = str(item.variant)
        }
      }
    } else if (s.costumes && typeof s.costumes === 'object') {
      for (const [k, v] of Object.entries(s.costumes)) {
        if (typeof v === 'string') costumeMap[str(k)] = str(v)
      }
    }

    // Narration has no on-screen speaker; a speaker who talks must be visible for the video model to lip-sync.
    const rawSpeaker = str(s.speaker)
    const speaker = rawSpeaker && !isNarratorName(rawSpeaker) ? rawSpeaker : null
    const characters = Array.isArray(s.characters) ? s.characters.map(str).filter(Boolean) : []
    if (speaker && !characters.some((c) => c.toLowerCase() === speaker.toLowerCase())) characters.unshift(speaker)

    return {
      title: str(s.title) || `Shot ${i + 1}`,
      sourceExcerpt: str(s.sourceExcerpt),
      visualAction: str(s.visualAction),
      characters,
      costumes: costumeMap,
      location: str(s.location) || null,
      props: Array.isArray(s.props) ? s.props.map(str).filter(Boolean) : [],
      speaker,
      text: str(s.text),
      emotion: str(s.emotion),
      framing: str(s.framing) || 'medium shot',
      durationSec: Math.max(2, Math.min(Number(s.durationSec) || 5, 12))
    }
  })

  const cleanProposals: NewAssetProposal[] = (res.newAssets ?? []).map((p) => ({
    kind: p.kind,
    name: str(p.name),
    description: str(p.description),
    action: p.action,
    target: str(p.target) || undefined,
    reason: str(p.reason)
  })).filter((p) => p.name)

  const draft: EpisodeScriptDraft = {
    shots: cleanShots,
    newAssets: cleanProposals,
    createdAt: Date.now()
  }

  updateEpisode(episodeId, { scriptDraft: draft })
  emit.storyProgress({ projectId, message: `Rencana naskah untuk ${ep.title} (${cleanShots.length} shot) selesai disusun!` })

  return draft
}

export async function confirmEpisodeScript(projectId: string, episodeId: string, draft: EpisodeScriptDraft): Promise<ProjectBundle> {
  return confirmEpisodeScriptRepo(projectId, episodeId, draft)
}

/**
 * Whether "Buat semua naskah" should write a draft for this episode: it is planned (or a hand-made episode with
 * a summary to work from) and has neither a draft nor clips, so nothing the creator made can be overwritten.
 */
export function needsScriptDraft(ep: Pick<Episode, 'status' | 'scriptDraft' | 'summary'>, clipCount: number): boolean {
  if (clipCount > 0 || ep.scriptDraft) return false
  return ep.status === 'planned' || (ep.status === 'draft' && ep.summary.trim().length > 0)
}

// Stops between episodes: a draft already being written by the LLM is finished and kept.
const batchScriptControllers = new Map<string, AbortController>()

export function cancelBatchScripts(projectId: string): void {
  const ctrl = batchScriptControllers.get(projectId)
  if (ctrl) {
    ctrl.abort()
    batchScriptControllers.delete(projectId)
  }
}

export async function planAllMissingEpisodeScripts(
  projectId: string
): Promise<PlanBatchScriptsResult> {
  cancelBatchScripts(projectId)
  const ctrl = new AbortController()
  batchScriptControllers.set(projectId, ctrl)

  const episodes = listEpisodes(projectId)
  const plannedEpisodeIds: string[] = []
  const skippedEpisodeIds: string[] = []
  const failedEpisodes: { episodeId: string; title: string; error: string }[] = []

  try {
    for (const [idx, ep] of episodes.entries()) {
      if (ctrl.signal.aborted) break

      if (!needsScriptDraft(ep, clipsOf(projectId, ep.id).length)) {
        skippedEpisodeIds.push(ep.id)
        continue
      }

      emit.storyProgress({
        projectId,
        message: `Menyusun draf naskah Episode ${ep.episodeNum} (${idx + 1}/${episodes.length}): ${ep.title}...`
      })

      try {
        await planEpisodeScript(projectId, ep.id)
        plannedEpisodeIds.push(ep.id)
      } catch (err) {
        failedEpisodes.push({
          episodeId: ep.id,
          title: ep.title,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  } finally {
    if (batchScriptControllers.get(projectId) === ctrl) {
      batchScriptControllers.delete(projectId)
    }
  }

  emit.storyProgress({
    projectId,
    message: `Selesai menyusun naskah (${plannedEpisodeIds.length} draf dibuat, ${skippedEpisodeIds.length} dilewati, ${failedEpisodes.length} gagal).`
  })

  return {
    plannedEpisodeIds,
    skippedEpisodeIds,
    failedEpisodes
  }
}

export async function writePrompts(projectId: string, episodeId: string, clipIds?: string[]): Promise<ProjectBundle> {
  const clips = clipsOf(projectId, episodeId)
  const targets = clips.filter((c) => (clipIds ? clipIds.includes(c.id) : needsVisual(c) || !c.videoPrompt.trim()))
  if (!targets.length) return getBundle(projectId, episodeId)

  const project = getProject(projectId)
  const chars = charactersOf(projectId)
  const locs = locationsOf(projectId)
  const derivs = derivativesOf(projectId)
  const orientation = project.aspectRatio === '9:16' ? 'vertical 9:16' : `horizontal ${project.aspectRatio}`

  for (const clip of targets) {
    const loc = clip.locationId ? locs.find((l) => l.id === clip.locationId) : null
    // Without a registered location the action carries the setting; a made-up default would fight the story.
    const settingLine = loc ? `Setting: ${loc.name}${loc.description ? `, ${loc.description}` : ''}` : ''

    const actionDesc = clip.story.trim() || clip.narration.trim() || 'Character facing camera'
    const emotionDesc = clip.emotion ? `, intense expression of ${clip.emotion}` : ''
    const actionLine = `Action: ${actionDesc}${emotionDesc}`

    const wardrobeParts: string[] = []
    const charIds = clip.characterIds || []
    const costumeIds = clip.costumeIds || {}
    for (const cid of charIds) {
      const ch = chars.find((c) => c.id === cid)
      if (!ch) continue
      const did = costumeIds[cid]
      const deriv = did ? derivs.find((d) => d.id === did) : null
      if (deriv) {
        wardrobeParts.push(`${ch.name} - custom: ${deriv.name} (${deriv.promptChange || 'formal clothes'})`)
      } else {
        wardrobeParts.push(`${ch.name} - default appearance as on character sheet`)
      }
    }
    const wardrobeLine = wardrobeParts.length ? `Wardrobe: ${wardrobeParts.join('; ')}` : ''

    const framingLine = `Framing: ${orientation} shot, ${clip.framing || 'medium close-up'}, shallow depth of field, cinematic lighting`
    const avoidLine = `Avoid: deformed eyes, bad hands, blurry faces, on-screen text, subtitles, watermark`

    const visualPrompt = [settingLine, actionLine, wardrobeLine, framingLine, avoidLine].filter(Boolean).join('\n')
    const videoPrompt = `Subtle micro-expressions, ${clip.story || 'looking with tension'}, subtle camera push-in, cinematic short drama lighting`

    // Without an explicit list only empty prompts (or ones whose scene text changed since) are written,
    // so prompts the creator edited stay theirs.
    const patch: Partial<Clip> = {}
    if (clipIds || needsVisual(clip)) Object.assign(patch, { visualPrompt, visualSource: visualSourceOf(clip) })
    if (clipIds || !clip.videoPrompt.trim()) patch.videoPrompt = videoPrompt
    patchClip(clip.id, patch)
  }

  return getBundle(projectId, episodeId)
}

// ---------- visual prompts for reviewed scenes ----------

const VISUAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    world: {
      type: 'string',
      description:
        'One English sentence that fixes the world of the whole video: the place (planet, country, city), the era or year, the technology level and who the people are (for example "humans living in a pressurized colony on Mars around 2150"). Every setting below must agree with it.'
    },
    characters: {
      type: 'array',
      description: 'Every recurring character in the requested scenes, including the existing ones unchanged. Empty if there are none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          identity: {
            type: 'string',
            description:
              'English, what the character is and looks like WITHOUT clothing: species (write "human" for people), gender, age, height and build, skin tone, face, hair, permanent body traits. No clothing, no art-style words.'
          },
          outfit: {
            type: 'string',
            description:
              'English, the default outfit the character wears in MOST of their scenes, with colors and one signature accessory. Choose what fits most scenes: everyday indoor clothes if most scenes are indoors, a spacesuit or armor only if most scenes need it.'
          }
        },
        required: ['name', 'identity', 'outfit']
      }
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scene: { type: 'integer', description: 'The scene number from the script.' },
          setting: {
            type: 'string',
            description:
              'English, self-contained: where and when, always naming the world explicitly (planet or country, era) even if the story makes it obvious, indoor or outdoor, 3 to 5 concrete props or architecture details that prove the world (for example a window showing the red Martian desert), lighting, time of day, color mood.'
          },
          action: {
            type: 'string',
            description:
              'English: the ONE moment shown. Every visible person with role, age, pose and expression, what they are doing, and the concrete visual evidence of what the narration says. Recurring characters by name plus a short role ("Leo, the colony doctor").'
          },
          wardrobe: {
            type: 'array',
            description: 'Clothing of every person visible in the image, including extras.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', description: 'Character name, or a short label for an extra ("the teenager").' },
                source: {
                  type: 'string',
                  enum: ['reference', 'custom'],
                  description:
                    'reference = the recurring character wears their default outfit as on the reference sheet; custom = a different outfit for this scene (always custom for extras).'
                },
                outfit: { type: 'string', description: 'English. For custom: the full outfit with colors. For reference: a few words naming it.' }
              },
              required: ['name', 'source', 'outfit']
            }
          },
          framing: { type: 'string', description: 'English: shot size, camera angle and composition, e.g. "medium full shot, eye level, the height chart fully visible".' },
          avoid: {
            type: 'string',
            description:
              'English, comma-separated: 3 to 6 things an image model is likely to get wrong for THIS scene, e.g. "Earth landscape, aliens, green skin, spacesuits indoors, helmets".'
          },
          characters: { type: 'array', items: { type: 'string' }, description: 'Names of recurring characters visible in the image.' },
          camera: { type: 'string', enum: CAMERA_IDS, description: 'Camera move over the still image that fits the scene mood.' },
          strength: {
            type: 'string',
            enum: STRENGTH_IDS,
            description: 'How strong the camera move is: halus (subtle, calm or emotional), sedang (medium), kuat (strong, action or big reveals).'
          },
          motion: {
            type: 'string',
            description:
              'English direction for animating this still image into a short AI video: what each character does (gesture, expression, small action), what moves in the environment (wind, fire, water, crowd, dust) and one simple camera move. One or two sentences, no dialogue, no on-screen text, never mention music or sound.'
          },
          transition: {
            type: 'string',
            enum: TRANSITION_IDS,
            description: 'Transition into the next scene: fade for calm or time passing, cut for fast action, slideleft for a change of place, zoomin for a dramatic reveal.'
          }
        },
        required: ['scene', 'setting', 'action', 'wardrobe', 'framing', 'avoid', 'characters', 'camera', 'strength', 'motion', 'transition']
      }
    }
  },
  required: ['world', 'characters', 'scenes']
}

type VisualScene = {
  scene?: number
  setting?: string
  action?: string
  wardrobe?: { name?: string; source?: string; outfit?: string }[]
  framing?: string
  avoid?: string
  characters?: string[]
  camera?: string
  strength?: string
  motion?: string
  transition?: string
}

interface VisualPlan {
  world?: string
  characters?: { name?: string; identity?: string; outfit?: string }[]
  scenes?: VisualScene[]
}

/** A character description for image prompts: body and face first, then the outfit shown on the reference sheet. */
function characterLook(c: { identity?: string; outfit?: string }): string {
  const who = str(c.identity).replace(/\.$/, '')
  const outfit = str(c.outfit).replace(/\.$/, '')
  return [who && `${who}.`, outfit && `Default outfit: ${outfit}.`].filter(Boolean).join(' ')
}

/**
 * The scene's image prompt as labelled lines the user can read and edit in the storyboard. The image
 * generator reads the Wardrobe and Avoid lines (see clipPrompt in generation.ts).
 */
function visualText(a: VisualScene): string {
  const wardrobe = (a.wardrobe ?? [])
    .filter((w) => str(w.name))
    .map((w) =>
      w.source === 'reference'
        ? `${str(w.name)} - default outfit as on the reference sheet${str(w.outfit) ? ` (${str(w.outfit)})` : ''}`
        : `${str(w.name)} - custom for this scene: ${str(w.outfit)}`
    )
  return [
    str(a.setting) && `Setting: ${str(a.setting)}`,
    str(a.action) && `Action: ${str(a.action)}`,
    wardrobe.length > 0 && `Wardrobe: ${wardrobe.join('; ')}`,
    str(a.framing) && `Framing: ${str(a.framing)}`,
    str(a.avoid) && `Avoid: ${str(a.avoid)}`
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Designs one image per scene (plus camera move, transition and AI-video direction) from the reviewed
 * script. "missing" only covers scenes without a plan or whose story changed since; "all" redoes every scene.
 */
export async function generateVisuals(projectId: string, mode: 'missing' | 'all', episodeId?: string): Promise<ProjectBundle> {
  const project = getProject(projectId)
  const clips = clipsOf(projectId, episodeId)
  if (!clips.length) throw new Error('Naskah masih kosong. Tambahkan adegan dulu.')
  const empty = clips.findIndex((c) => !c.story.trim() && !c.narration.trim())
  if (empty >= 0) throw new Error(`Adegan ${empty + 1} masih kosong. Isi alur atau narasinya dulu.`)
  const targets = clips.map((c, i) => ({ clip: c, n: i + 1 })).filter((t) => mode === 'all' || needsVisual(t.clip))
  if (!targets.length) return getBundle(projectId, episodeId)

  let known = charactersOf(projectId)
  const system = [
    'You are the storyboard artist for a faceless YouTube video. The script is final; you design the pictures.',
    'For each requested scene you describe ONE still image, choose the camera move and its strength over that image, the transition into the next scene, and write how the image would move if it is animated as an AI video.',
    'Rules for the image descriptions, which go to a text-to-image model that never sees the script:',
    '1. Every scene is self-contained. Always name the world (planet or country, era, technology) in the setting, even when the story makes it obvious, and add background details that prove it. Without this the model falls back to present-day Earth.',
    '2. Turn narration into a literal, showable moment. When the narration is a general statement ("after generations, children grow taller"), invent one concrete situation that shows it with visible evidence (a height chart, a comparison with an adult, an old photo), never a symbol or a vague mood.',
    '3. Describe people plainly as humans. Do not use words an image model may read literally or as fantasy, such as Martian, alien, native, creature, mutant, hybrid or "-born", unless they really are not human; describe the difference concretely instead ("a human teenager, about 2.1 m tall, very slender, long limbs, normal human face").',
    '4. Clothing must suit the place and action: no spacesuits or helmets inside a pressurized room, a spacesuit outside on an airless surface, period clothing for history. A recurring character keeps their default outfit (source "reference") unless the scene needs something else; then use "custom" and describe the new outfit in full. Describe the clothing of every extra too.',
    '5. Keep every recurring character visually consistent: reuse the existing characters exactly as given (same name, identity and outfit) and only add characters that are missing. Characters are only people who appear in several scenes; one-off people are extras described inside the scene.',
    '6. No readable text, signs, captions or labels in the image. Vary shot sizes, angles and camera moves across scenes so the video never feels repetitive.',
    'Write "world", "identity", "outfit", "setting", "action", "wardrobe", "framing", "avoid" and "motion" in English.'
  ].join('\n')
  const arc = clips.map((c, i) => `${i + 1}. ${c.title}: ${(c.story || c.narration).slice(0, 110)}`).join('\n')
  const groups: (typeof targets)[] = []
  for (let i = 0; i < targets.length; i += 20) groups.push(targets.slice(i, i + 20))
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    const wanted = new Set(group.map((t) => t.n))
    for (const t of group) {
      if (t.n > 1) wanted.add(t.n - 1)
      if (t.n < clips.length) wanted.add(t.n + 1)
    }
    const localScript = [...wanted].sort((a, b) => a - b).map((n) => {
      const c = clips[n - 1]
      return `Scene ${n}: ${c.title}\nStory: ${c.story || '(none)'}\nNarration (${languageOf(project.language)}): ${c.narration || '(none)'}`
    }).join('\n\n')
    const prompt = [
      `Visual style of the video (for framing only): ${getStyle(project.styleId).name}.`,
      `Frame format: ${project.aspectRatio === '9:16' ? 'vertical 9:16' : 'horizontal 16:9'}.`,
      `Idea: ${project.synopsis}`,
      `Story arc summary by scene:\n${arc}`,
      known.length ? `Recurring characters (preserve identity and outfit across all groups):\n${known.map((c) => `- ${c.name}: ${c.description}`).join('\n')}` : 'There are no known recurring characters yet.',
      `Full script for this group and its neighbors only:\n${localScript}`,
      `Write visual plans for scenes ${group.map((t) => t.n).join(', ')} only. Keep scene numbers unchanged.`,
      `Allowed camera values: ${CAMERA_IDS.join(', ')}. Allowed strength values: ${STRENGTH_IDS.join(', ')}. Allowed transition values: ${TRANSITION_IDS.join(', ')}.`
    ].join('\n\n')
    emit.storyProgress({ projectId, message: `Menyusun visual kelompok ${gi + 1} dari ${groups.length}` })
    const plan = await generateJson<VisualPlan>({ system, prompt, schema: VISUAL_SCHEMA, name: `visuals-part-${gi + 1}` })
    const answers = (plan.scenes ?? []).filter((s) => str(s.setting) || str(s.action))
    if (!answers.length) throw new Error(`Model tidak menghasilkan visual untuk kelompok ${gi + 1}. Coba lagi.`)
    const byNumber = new Map<number, (typeof answers)[number]>()
    const loose: typeof answers = []
    for (const a of answers) {
      const n = Number(a.scene)
      if (Number.isInteger(n) && group.some((t) => t.n === n) && !byNumber.has(n)) byNumber.set(n, a)
      else loose.push(a)
    }
    const updates: SceneVisual[] = []
    for (const t of group) {
      const a = byNumber.get(t.n) ?? loose.shift()
      if (a) updates.push(toSceneVisual(t.clip, a))
    }
    if (updates.length !== group.length) throw new Error(`Visual kelompok ${gi + 1} hanya mencakup ${updates.length} dari ${group.length} adegan. Coba lagi.`)
    applyVisuals(projectId, (plan.characters ?? []).filter((c) => str(c.name)).map((c) => ({ name: str(c.name), description: characterLook(c) })), updates)
    known = charactersOf(projectId)
    emit.storyProgress({ projectId, message: `Visual ${gi + 1} dari ${groups.length} kelompok selesai` })
  }
  return getBundle(projectId, episodeId)
}

function toSceneVisual(clip: Clip, a: NonNullable<VisualPlan['scenes']>[number]): SceneVisual {
  const camera = str(a.camera) as CameraPresetId
  const strength = str(a.strength) as MotionStrength
  const transition = str(a.transition) as TransitionId
  return {
    clipId: clip.id,
    visualPrompt: visualText(a),
    characterNames: Array.isArray(a.characters) ? a.characters.filter((n): n is string => typeof n === 'string') : [],
    cameraPreset: CAMERA_IDS.includes(camera) ? camera : clip.cameraPreset,
    motionStrength: STRENGTH_IDS.includes(strength) ? strength : clip.motionStrength,
    videoPrompt: str(a.motion),
    transition: TRANSITION_IDS.includes(transition) ? transition : clip.transition
  }
}

// ---------- background music ----------

const MUSIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Short English track title, max 40 characters.' },
    style: {
      type: 'string',
      description:
        'Suno "Style of Music" field: 6 to 12 comma-separated English tags covering genre, mood, main instruments, tempo in BPM and "instrumental". Max 180 characters.'
    },
    exclude: { type: 'string', description: 'Suno "Exclude styles" field: comma-separated English tags to avoid, such as vocals or anything that would fight the voice-over. Max 80 characters.' },
    description: {
      type: 'string',
      description:
        'One English paragraph (50 to 90 words) for any text-to-music AI: genre, mood, instruments, tempo, how the energy moves from the opening to the ending, instrumental with no vocals, sits under a narrator, and the target length.'
    },
    reason: { type: 'string', description: 'One sentence in Indonesian telling the creator why this music suits the video.' }
  },
  required: ['title', 'style', 'exclude', 'description', 'reason']
}

/** A prompt for background music that suits the story, to paste into Suno or another music AI. */
export async function generateMusicPrompt(projectId: string, episodeId?: string): Promise<MusicPrompt> {
  const b = getBundle(projectId, episodeId)
  const p = b.project
  const clips = b.clips
  if (!clips.some((c) => c.narration.trim() || c.story.trim()) && !p.synopsis.trim()) throw new Error('Naskah masih kosong.')
  const durationSec = Math.max(10, Math.round(clips.reduce((n, c) => n + c.durationMs, 0) / 1000) || p.durationSec)
  const style = getStyle(p.styleId)
  const system = [
    'You are a music supervisor for faceless YouTube storytelling videos.',
    'You pick background music that supports a voice-over without competing with it: instrumental, no vocals or choirs with words, clear space in the mid range where the voice sits.',
    'Match the setting and era of the story (for example gamelan or kendang colours for an old Javanese kingdom, orchestral for epic history, lo-fi for a calm explainer) and follow its emotional arc from the hook to the ending.',
    'Write the music fields in English, because music AIs understand English best. Never name real artists or copyrighted songs.'
  ].join(' ')
  const scenes = clips
    .map((c, i) => `${i + 1}. ${c.title}: ${c.story || c.narration}`.slice(0, 260))
    .join('\n')
  const prompt = [
    `Video title: ${p.title || '(untitled)'}`,
    `Idea: ${p.synopsis}`,
    `Visual style: ${style.name}.`,
    `Video length: about ${durationSec} seconds.`,
    `Scenes:\n${scenes}`
  ].join('\n\n')
  const r = await generateJson<Partial<MusicPrompt>>({ system, prompt, schema: MUSIC_SCHEMA, name: 'music' })
  const out: MusicPrompt = {
    title: str(r.title),
    style: str(r.style),
    exclude: str(r.exclude),
    description: str(r.description),
    reason: str(r.reason),
    durationSec
  }
  if (!out.style && !out.description) throw new Error('Model tidak menghasilkan prompt musik. Coba lagi.')
  return out
}

const SMART_SFX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          clipIndex: {
            type: 'integer',
            description: '1-based index of the scene where this sound effect occurs.'
          },
          timeOffsetSec: {
            type: 'number',
            description: 'Seconds from the start of the scene (e.g. 0.5).'
          },
          name: {
            type: 'string',
            description: 'Short Indonesian name for the sound effect (e.g. Pintu Berderit, Kilat Petir, Langkah Kaki).'
          },
          prompt: {
            type: 'string',
            description: 'Descriptive, cinematic English sound effect prompt for ElevenLabs text-to-sound (e.g. Old heavy wooden door creaking open slowly in an abandoned mansion, reverb).'
          },
          durationSec: {
            type: 'number',
            description: 'Duration of the sound in seconds, between 1.0 and 5.0.'
          },
          volumeDb: {
            type: 'number',
            description: 'Target volume in dB, usually between -12 and -6 so it sits nicely under narration.'
          }
        },
        required: ['clipIndex', 'timeOffsetSec', 'name', 'prompt', 'durationSec', 'volumeDb']
      }
    }
  },
  required: ['cues']
}

/** Plans 3–6 contextual sound effects based on the story script and visual descriptions. */
export async function planSmartSfx(projectId: string, episodeId?: string): Promise<SmartSfxCue[]> {
  const b = getBundle(projectId, episodeId)
  const clips = b.clips
  if (!clips.length) throw new Error('Belum ada adegan dalam proyek.')

  const scenes = clips
    .map((c, i) => {
      const dur = Math.max(1, Math.round(c.durationMs / 1000))
      return `Scene ${i + 1} (id: ${c.id}, duration: ${dur}s, title: ${c.title}):\n- Story: ${c.story || c.narration}\n- Visual: ${c.visualPrompt || ''}`
    })
    .join('\n\n')

  const system = [
    'You are a professional cinematic sound designer and Foley supervisor for YouTube storytelling videos.',
    'Carefully review the story scenes and choose 3 to 6 key moments across the video that benefit most from impactful sound effects (SFX).',
    'Do not oversaturate; select meaningful moments: door knocks, thunderclaps, gunshots, footsteps, eerie wind, sword clash, glass break, heartbeat, explosions, etc.',
    'For each sound effect, write a rich cinematic English description for ElevenLabs Text-to-Sound-Effects API.',
    'Never include speech, dialogue, or music in the sound effect prompts.'
  ].join(' ')

  const prompt = `Review these scenes and produce 3-6 cinematic sound cues:\n\n${scenes}`

  interface SmartSfxRaw {
    cues?: {
      clipIndex?: number
      timeOffsetSec?: number
      name?: string
      prompt?: string
      durationSec?: number
      volumeDb?: number
    }[]
  }

  const r = await generateJson<SmartSfxRaw>({
    system,
    prompt,
    schema: SMART_SFX_SCHEMA,
    name: 'smart_sfx'
  })

  const rawCues = r.cues ?? []
  const out: SmartSfxCue[] = []

  for (const c of rawCues) {
    const idx = typeof c.clipIndex === 'number' ? Math.round(c.clipIndex) - 1 : -1
    const clip = clips[idx]
    if (!clip) continue
    const clipDurSec = Math.max(1, clip.durationMs / 1000)
    const timeOffsetSec = Math.max(0, Math.min(typeof c.timeOffsetSec === 'number' ? c.timeOffsetSec : 0.5, clipDurSec - 0.5))
    const durationSec = Math.max(0.5, Math.min(typeof c.durationSec === 'number' ? c.durationSec : 2.5, 10))
    const volumeDb = Math.max(-24, Math.min(typeof c.volumeDb === 'number' ? c.volumeDb : -8, 0))
    const name = str(c.name) || 'Efek Suara'
    const promptText = str(c.prompt)
    if (!promptText) continue

    out.push({
      clipId: clip.id,
      timeOffsetSec,
      name,
      prompt: promptText,
      durationSec,
      volumeDb
    })
  }

  return out
}

const YOUTUBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titles: {
      type: 'array',
      items: { type: 'string' },
      description: '3 catchy, high-CTR YouTube titles in the video language.'
    },
    description: {
      type: 'string',
      description: 'SEO-optimized YouTube video description with a strong hook, summary of the story, and call to action.'
    },
    hashtags: {
      type: 'array',
      items: { type: 'string' },
      description: '5 to 8 relevant trending hashtags including the core topic.'
    }
  },
  required: ['titles', 'description', 'hashtags']
}

export async function generateYoutubeMetadata(projectId: string, episodeId?: string): Promise<YoutubeMetadata> {
  const b = getBundle(projectId, episodeId)
  const p = b.project
  const clips = b.clips
  if (!clips.length) throw new Error('Naskah masih kosong.')
  const lang = languageOf(p.language)
  const chapters = formatChapters(clips)
  const durationSec = Math.max(10, Math.round(clips.reduce((n, c) => n + c.durationMs, 0) / 1000) || p.durationSec)
  const scenes = clips.slice(0, 40).map((c, i) => `${i + 1}. ${c.title}: ${(c.story || c.narration).slice(0, 120)}`).join('\n')
  const system = [
    'You are a YouTube packaging and SEO expert for high-engagement storytelling channels.',
    `The video language is ${lang}. Write titles and description in ${lang}.`,
    'Focus on emotional hooks, high CTR, and viewer retention.'
  ].join(' ')
  const prompt = [
    `Video Title: ${p.title || '(untitled)'}`,
    `Synopsis / Concept: ${p.synopsis}`,
    `Duration: ${durationSec}s`,
    `Scenes:\n${scenes}`,
    `Timeline Chapters:\n${chapters}`
  ].join('\n\n')

  const r = await generateJson<Partial<YoutubeMetadata>>({ system, prompt, schema: YOUTUBE_SCHEMA, name: 'youtube_meta' })
  const titles = Array.isArray(r.titles) ? r.titles.map(str).filter(Boolean) : [p.title]
  const description = str(r.description)
  const hashtags = Array.isArray(r.hashtags) ? r.hashtags.map(str).filter(Boolean) : ['#Storytelling', '#BangStory']

  return {
    titles: titles.length ? titles : [p.title],
    description: description ? `${description}\n\n⏱️ DAFTAR BAB:\n${chapters}\n\n${hashtags.join(' ')}` : `${p.synopsis}\n\n⏱️ DAFTAR BAB:\n${chapters}\n\n${hashtags.join(' ')}`,
    chapters,
    hashtags
  }
}

const THUMBNAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'string',
      description:
        'English image prompt for the thumbnail scene: one focal subject, emotion, setting, lighting, camera distance. No instructions about text.'
    },
    composition: { type: 'string', description: 'Short explanation of layout, lighting and emotion, in the video language.' },
    textHook: { type: 'string', description: '2-4 word uppercase thumbnail text in the video language that complements the title.' }
  },
  required: ['prompt', 'composition', 'textHook']
}

/**
 * A thumbnail concept for the title the user picked. Written after the title on purpose: a thumbnail that
 * shows the same promise as the title converts better than one planned in isolation.
 */
export async function generateThumbnailConcept(projectId: string, title: string, episodeId?: string): Promise<ThumbnailConcept> {
  const b = getBundle(projectId, episodeId)
  const p = b.project
  const clean = title.trim()
  if (!clean) throw new Error('Pilih atau tulis judul dulu.')
  if (!b.clips.length) throw new Error('Naskah masih kosong.')
  const lang = languageOf(p.language)
  const scenes = b.clips.slice(0, 40).map((c, i) => `${i + 1}. ${c.title}: ${(c.story || c.narration).slice(0, 120)}`).join('\n')
  const cast = b.characters.map((c) => `- ${c.name}: ${c.description}`).join('\n')
  const system = [
    'You design YouTube thumbnails for storytelling channels that get high click-through rates.',
    'The thumbnail and the title must work as a pair: the picture shows the emotional moment the title promises,',
    'raises a question, and does not spoil the ending.',
    'Keep it simple enough to read at phone size: one focal subject (usually the main character, face large and',
    'expressive), one strong prop or setting cue, high contrast, and empty space on one side for big text.',
    `Write prompt in English. Write composition and textHook in ${lang}.`,
    'textHook adds tension the title does not already say (never repeat the title word for word).'
  ].join(' ')
  const prompt = [
    `Chosen title: ${clean}`,
    `Synopsis: ${p.synopsis}`,
    `Visual style: ${getStyle(p.styleId).name}`,
    cast && `Characters:\n${cast}`,
    `Scenes:\n${scenes}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const r = await generateJson<Partial<ThumbnailConcept>>({ system, prompt, schema: THUMBNAIL_SCHEMA, name: 'thumbnail_concept' })
  return {
    title: clean,
    prompt: str(r.prompt) || `Dramatic close-up of the main character reacting to the moment described by the title "${clean}", high contrast, atmospheric lighting`,
    composition: str(r.composition),
    textHook: str(r.textHook).toUpperCase() || clean.split(/\s+/).slice(0, 3).join(' ').toUpperCase()
  }
}
