import { createHash, randomUUID } from 'node:crypto'
import { CAMERA_PRESETS, MOTION_STRENGTHS, TRANSITIONS } from '@shared/motion'
import { formatChapters } from '@shared/chapters'
import { LANGUAGES } from '@shared/models'
import { formatCharacterTraits, formatLocationDetails, formatPropDetails } from '@shared/prompts'
import { isNarratorName, needsVisual, visualSourceOf } from '@shared/script'
import { getStyle, resolveStylePrompt } from '@shared/styles'
import { MIN_EPISODE_DURATION_SEC, MAX_EPISODE_DURATION_SEC, cleanShotDetail, defaultDialogueType } from '@shared/validation'
import type {
  CameraPresetId,
  CandidateCharacter,
  CandidateDerivative,
  CandidateLocation,
  CandidateProp,
  Clip,
  DraftShot,
  EnrichLorebookResult,
  Episode,
  EpisodeScriptDraft,
  LorebookExtractionResult,
  MotionStrength,
  MusicPrompt,
  NewAssetProposal,
  PlanBatchScriptsResult,
  PlanEpisodesInput,
  ProjectBundle,
  SmartSfxCue,
  SourceKind,
  StoryBeatPhase,
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
  listContinuityItems,
  listEpisodes,
  locationsOf,
  patchClip,
  propsOf,
  saveScriptVersion,
  setPlanProgress,
  syncProjectSeriesLocks,
  touchProject,
  updateCharacter,
  updateEpisode,
  updateLocation,
  updateProp,
  type SceneVisual,
  fillEmptyFields
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
  const rawSource = (input.sourceText ?? project.sourceText ?? '').trim()
  const sourceText = rawSource || (project.synopsis ?? '').trim()
  const sourceKind: SourceKind = input.sourceKind ?? project.sourceKind ?? 'novel'
  const targetDuration = Math.max(
    MIN_EPISODE_DURATION_SEC,
    Math.min(input.targetDurationSec ?? project.durationSec ?? 60, MAX_EPISODE_DURATION_SEC)
  )
  const targetEpisodeCount = input.targetEpisodeCount ?? project.targetEpisodeCount ?? null
  const mode = input.mode ?? 'replace'

  if (!sourceText) {
    throw new Error('Teks sumber cerita atau sinopsis masih kosong. Masukkan cerita atau sinopsis terlebih dahulu.')
  }

  let from = 0
  if (mode === 'replace') {
    clearEpisodesForReplan(projectId)
  } else {
    const progress = getPlanProgress(projectId)
    const existingEps = listEpisodes(projectId)
    if (progress) {
      if (hashText(sourceText.slice(0, progress.coveredChars)) !== progress.coveredHash) {
        throw new Error('Bagian sumber yang sudah direncanakan telah berubah. Pakai "Rencanakan ulang" supaya episode sesuai teks terbaru.')
      }
      from = progress.coveredChars
    } else if (existingEps.some((e) => e.status !== 'draft')) {
      throw new Error('Belum ada catatan sampai mana sumber direncanakan. Pakai "Rencanakan ulang" untuk memulai dari awal.')
    } else if (
      existingEps.length > 0 &&
      existingEps.every(
        (e) =>
          e.status === 'draft' &&
          !e.summary.trim() &&
          !(e.hook ?? '').trim() &&
          !(e.cliffhanger ?? '').trim() &&
          !e.scriptDraft &&
          clipsOf(projectId, e.id).length === 0
      )
    ) {
      // Fresh projects start with a blank Episode 1 draft; clear it so generated episodes fill from Episode 1.
      clearEpisodesForReplan(projectId)
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

  const customPlanner = project.promptTemplates?.episode_planner?.trim()
  const systemBase = customPlanner ? `${customPlanner}\n\n${system}` : system
  const effectiveSystem = project.seriesGuidelines
    ? `${systemBase}\n\nCreator Guidelines for this series:\n${project.seriesGuidelines}`
    : systemBase

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
        const res = await generateJson<RawEpisodePlanResponse>({ system: effectiveSystem, prompt, schema: EPISODE_PLAN_SCHEMA, name: 'episode_planner' })
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
            description: 'REQUIRED for all spoken dialogue/vo/os shots (70–85% of shots): exact Lorebook name of the character who speaks, who must also be listed in characters for on-screen dialogue. Empty string ONLY for pure narrator voice-over or the few silent reaction/insert shots (max 15–25%).'
          },
          text: {
            type: 'string',
            description: 'REQUIRED spoken Indonesian dialogue line or internal monologue (V.O.) for 70–85% of shots (punchy, dramatic, 4–14 words). Leave empty "" ONLY for rare silent reaction or prop-insert shots (at most 15–25% of the episode).'
          },
          emotion: { type: 'string', description: 'Emotional delivery and facial expression, e.g. "marah, mencemooh".' },
          framing: { type: 'string', description: 'Shot framing: close-up, medium shot, extreme close-up, two-shot, over-the-shoulder, wide.' },
          durationSec: { type: 'integer', description: 'Shot duration in seconds (typically 3 to 7).' },
          beat: { type: 'string', enum: ['hook', 'confrontation', 'twist', 'aftermath'], description: 'Story rhythm beat phase in vertical drama formula: hook, confrontation, twist, aftermath.' },
          continue_from_previous: {
            type: 'boolean',
            description: 'Set true ONLY when this shot immediately continues the unbroken physical motion of the preceding shot in the exact same location and angle.'
          },
          shot_detail: {
            type: 'object',
            additionalProperties: false,
            properties: {
              camera_motion: { type: 'string', description: 'Camera movement, e.g. "slow pan left", "whip pan", "static", "dramatic push in".' },
              camera_reason: { type: 'string', description: 'Cinematic rationale for this camera choice.' },
              lighting: { type: 'string', description: 'Lighting setup, e.g. "chiaroscuro, rim light, low-key dramatic".' },
              blocking: { type: 'string', description: 'Character staging and physical movement in frame.' },
              non_speaking_reaction: { type: 'string', description: 'What other visible non-speaking characters are doing or emoting.' },
              sfx_ambience: { type: 'string', description: 'Sound effect cue or background ambience.' },
              speech_delivery: { type: 'string', description: 'Voice intonation delivery, e.g. "berbisik sinis", "membentak tegas", "suara bergetar".' },
              dialogue_type: { type: 'string', enum: ['dialogue', 'os', 'vo', 'narration'], description: 'Type: dialogue (on-screen lip sync), os (off-screen character), vo (voice-over internal monologue), narration (story narrator).' }
            }
          }
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
  speakerName?: string
  character_speaking?: string
  text?: string
  dialogue?: string
  line?: string
  spoken_text?: string
  spokenLine?: string
  narration?: string
  voiceover?: string
  script?: string
  emotion?: string
  framing?: string
  durationSec?: number
  beat?: string
  continue_from_previous?: boolean
  shot_detail?: {
    camera_motion?: string
    camera_reason?: string
    lighting?: string
    blocking?: string
    non_speaking_reaction?: string
    sfx_ambience?: string
    speech_delivery?: string
    dialogue_type?: string
  }
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
        const cDerivs = derivs
          .filter((d) => d.characterId === c.id)
          .map((d) => (d.costumeKeyphrase ? `${d.name} [${d.costumeKeyphrase}]` : d.name))
        const visual = formatCharacterTraits(c, true)
        const n = c.profile?.narrative
        const narrativeBits = [
          n?.role ? `role: ${n.role}` : '',
          n?.desire ? `desire: ${n.desire}` : '',
          n?.secret ? `secret: ${n.secret}` : '',
          n?.speechPattern ? `speech: ${n.speechPattern}` : '',
          c.voiceStyle ? `voice: ${c.voiceStyle}` : ''
        ].filter(Boolean).join('; ')
        return `- ${c.name} (aliases: ${c.aliases.join(', ') || 'none'}; variants: ${cDerivs.join(', ') || 'default'}): ${visual}${narrativeBits ? ` | Narrative: ${narrativeBits}` : ''}`
      }).join('\n')
    : '(Belum ada karakter terdaftar di Lorebook)'

  const locSummary = locs.length
    ? locs.map((l) => `- ${l.name} (aliases: ${l.aliases.join(', ') || 'none'}): ${formatLocationDetails(l)}`).join('\n')
    : '(Belum ada lokasi terdaftar di Lorebook)'

  const propSummary = prs.length
    ? prs.map((p) => `- ${formatPropDetails(p)}${p.profile?.significance ? ` — ${p.profile.significance}` : ''}`).join('\n')
    : '(Belum ada prop terdaftar di Lorebook)'

  const openContinuity = listContinuityItems(projectId).filter((ci) => ci.status === 'open')
  const continuitySummary = openContinuity.length
    ? openContinuity
        .map((ci) => {
          const plantedEp = allEpisodes.find((e) => e.id === ci.plantedEpisodeId)
          const epLabel = plantedEp ? `Episode ${plantedEp.episodeNum}` : 'Episode sebelumnya'
          return `- [${ci.tier.toUpperCase()}] ${ci.kind}: "${ci.name}" (ditanam di ${epLabel}) — ${ci.detail}`
        })
        .join('\n')
    : '(Tidak ada benang cerita terbuka)'

  const system = [
    project.promptTemplates?.script_draft?.trim() ||
      'You are an award-winning vertical short drama director, cinematographer, and scriptwriter (9:16 prestige mobile drama).',
    'You are planning a gripping, visually cinematic shot-by-shot script for an episode in an intense vertical short drama series.',
    'Follow these critical short drama directing & visual storytelling rules:',
    '1. MANDATORY SPOKEN DIALOGUE (CRITICAL): Vertical short drama is driven by sharp, emotionally charged Indonesian dialogue! At least 70% to 85% of the shots MUST have a non-empty "text" (spoken dialogue line or sharp internal monologue V.O.) AND a valid "speaker" (exact Lorebook character name) with dialogue_type="dialogue" (on-screen lip-sync) or "vo" (inner thought). Even if the source input is a short synopsis without written quotes, YOU MUST invent crisp, natural, high-drama Indonesian lines that fit each character\'s personality and conflict. Reserve silent shots (text: "") strictly for 15% to 25% of shots (emotional reactions or dramatic prop inserts)—NEVER return an episode where most shots have empty text!',
    '2. CINEMATIC VARIETY (NO TALKING-HEAD MONOTONY): Never repeat the same close-up framing 3+ times in a row. Weave establishing wide/medium shots (whenever entering a new location), over-the-shoulder (OTS) confrontation shots, dynamic two-shots with foreground/background depth, tight emotional close-ups, silent listener reaction shots, power-angle shots (low-angle for dominance, high-angle for vulnerability, Dutch angle for shock), and extreme close-up INSERT shots (trembling hands, eyes widening, hero props, phone screen, dropped objects).',
    '3. SHOW, DON\'T TELL: Every shot\'s visualAction and blocking must show concrete physical behavior, posture, gaze direction, spatial separation (left/right/foreground/background), and direct prop interaction—not generic "berdiri berbicara".',
    '4. FOUR-BEAT EMOTIONAL ESCALATION: Pace the episode through hook (instant visual/emotional jolt in shots 1-2) → confrontation (rising power struggle) → twist (sharp visual reveal or reversal) → aftermath (heart-stopping cliffhanger freeze moment). Escalate lighting contrast and camera energy across the beats.',
    '5. ONE SHOT = ONE SPEAKER: At most one character speaks per shot. When dialogue_type is "dialogue", the speaker MUST be listed in characters so lip-sync video models can animate them speaking.',
    '6. CONTINUITY & CLIFFHANGER PAYOFF: If the previous episode ended on a cliffhanger, resolve or escalate it immediately in the opening shots. Keep costumes, locations, time-of-day lighting, and prop states strictly consistent within the same scene. Set continue_from_previous=true ONLY when a shot directly continues an unbroken physical action from the immediately preceding shot.',
    '7. LOREBOOK FIDELITY: Match characters, costume variants, locations, and props to REGISTERED LOREBOOK ASSETS by their exact names/aliases whenever possible. Honor each character\'s narrative role, secret, and speech pattern so dialogue feels sharp and authentic.',
    '8. RICH SHOT DETAILS & SPEECH PACING: Populate shot_detail on EVERY shot with vivid camera_motion, camera_reason, lighting (consistent with location & beat), concrete spatial blocking, non_speaking_reaction (whenever 2+ characters are visible), sfx_ambience, speech_delivery, and dialogue_type. Keep spoken lines punchy (4–14 words, < 2.6 words/second so they never overflow).',
    'If the story introduces a genuinely new recurring character, costume variant, location, or prop not in the Lorebook, propose it in "newAssets" with concrete visual details.',
    'Write dialogue ("text"), visualAction, emotions, and titles in gripping, natural Indonesian.',
    project.seriesGuidelines ? `Creator guidelines for this series:\n${project.seriesGuidelines}` : ''
  ].filter(Boolean).join('\n')

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
    `Props:\n${propSummary}`,
    `\n--- OPEN CONTINUITY THREADS (Payoff or advance if relevant to this episode) ---`,
    `${continuitySummary}`
  ].join('\n\n')

  const normalizeDraftShots = (rawShots: RawDraftShot[]): DraftShot[] =>
    rawShots.map((s, i) => {
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

      // Accept common LLM fallback field names so dialogue is never silently dropped.
      const text =
        str(s.text) ||
        str(s.dialogue) ||
        str(s.line) ||
        str(s.spoken_text) ||
        str(s.spokenLine) ||
        str(s.narration) ||
        str(s.voiceover) ||
        str(s.script)
      const rawSpeaker = str(s.speaker) || str(s.speakerName) || str(s.character_speaking)
      const characters = Array.isArray(s.characters) ? s.characters.map(str).filter(Boolean) : []
      let speaker = rawSpeaker && !isNarratorName(rawSpeaker) ? rawSpeaker : null
      const rawDialogueType = s.shot_detail?.dialogue_type
      // If dialogue text exists for an on-screen dialogue shot but speaker was omitted, assign first visible character.
      if (text && !speaker && rawDialogueType === 'dialogue' && characters.length > 0) {
        speaker = characters[0]
      }
      const shotDetail = cleanShotDetail(s.shot_detail, speaker, text)
      const isVisibleDialogue = (shotDetail?.dialogueType ?? defaultDialogueType(speaker, text)) === 'dialogue'
      if (speaker && isVisibleDialogue && !characters.some((c) => c.toLowerCase() === speaker!.toLowerCase())) {
        characters.unshift(speaker)
      }

      const wordCount = text.trim().split(/\s+/).filter(Boolean).length
      const minDurForSpeech = wordCount > 0 ? Math.ceil(wordCount / 2.8) : 2
      const requestedDur = Number(s.durationSec) || 5
      const durationSec = Math.max(minDurForSpeech, Math.min(requestedDur, 12))

      const rawBeat = str(s.beat)
      const beat = rawBeat && ['hook', 'confrontation', 'twist', 'aftermath'].includes(rawBeat) ? (rawBeat as StoryBeatPhase) : undefined

      return {
        title: str(s.title) || `Shot ${i + 1}`,
        sourceExcerpt: str(s.sourceExcerpt),
        visualAction: str(s.visualAction),
        characters,
        costumes: costumeMap,
        location: str(s.location) || null,
        props: Array.isArray(s.props) ? s.props.map(str).filter(Boolean) : [],
        speaker,
        text,
        emotion: str(s.emotion),
        framing: str(s.framing) || 'medium shot',
        durationSec,
        ...(beat ? { beat } : {}),
        ...(i > 0 && s.continue_from_previous ? { continueFromPrevious: true } : {}),
        shotDetail
      }
    })

  let res = await generateJson<RawScriptDraftResponse>({
    system,
    prompt,
    schema: SCRIPT_DRAFT_SCHEMA,
    name: `episode_script_${episodeId}`
  })

  let rawShots = res.shots ?? []
  if (!rawShots.length) {
    throw new Error('AI belum menghasilkan shot untuk episode ini. Coba lagi.')
  }

  let cleanShots = normalizeDraftShots(rawShots)
  const minVoicedShots = cleanShots.length >= 4 ? Math.ceil(cleanShots.length * 0.4) : 1
  const voicedCount = cleanShots.filter((s) => s.text.trim().length > 0).length

  // Guard against silent-episode drafts: retry once with an explicit dialogue correction if AI left dialog blank.
  if (voicedCount < minVoicedShots) {
    emit.storyProgress({
      projectId,
      message: `Melengkapi dialog & suara tokoh untuk ${ep.title}…`
    })
    const retryPrompt = [
      prompt,
      `\nIMPORTANT CORRECTION: Your previous draft returned only ${voicedCount} spoken shots out of ${cleanShots.length} (most shots had empty "text" and "speaker"). ` +
        `This is a vertical drama episode—at least 70–85% of the shots MUST include sharp, natural Indonesian spoken dialogue in the "text" field and the speaking character's exact Lorebook name in the "speaker" field (with shot_detail.dialogue_type = "dialogue" or "vo"). Rewrite the shots now with full dramatic dialogue.`
    ].join('\n\n')
    try {
      const retryRes = await generateJson<RawScriptDraftResponse>({
        system,
        prompt: retryPrompt,
        schema: SCRIPT_DRAFT_SCHEMA,
        name: `episode_script_retry_${episodeId}`
      })
      if (retryRes.shots?.length) {
        const retryClean = normalizeDraftShots(retryRes.shots)
        if (retryClean.filter((s) => s.text.trim().length > 0).length > voicedCount) {
          res = retryRes
          rawShots = retryRes.shots
          cleanShots = retryClean
        }
      }
    } catch {
      // Keep original draft if retry fails transiently.
    }
  }

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
  saveScriptVersion(episodeId, draft, 'Rencana draft AI')
  emit.storyProgress({ projectId, message: `Rencana naskah untuk ${ep.title} (${cleanShots.length} shot) selesai disusun!` })

  return draft
}

export async function confirmEpisodeScript(projectId: string, episodeId: string, draft: EpisodeScriptDraft): Promise<ProjectBundle> {
  saveScriptVersion(episodeId, draft, 'Naskah dikonfirmasi')
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

export interface WritePromptsOptions {
  /** Rewrites every clip even if it already has a prompt (used by "Optimasi Ulang Semua Prompt"). */
  force?: boolean
  /** Use the LLM Visual Director to craft cinematic English image/video prompts (default: true, falls back cleanly when offline). */
  useAi?: boolean
  /** Surface LLM failures as errors instead of falling back to the local template. */
  requireAi?: boolean
}

const SHOT_PROMPTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          shot_number: { type: 'integer', description: '1-based shot index matching the input shot number.' },
          action: {
            type: 'string',
            description:
              'Vivid cinematic English freeze-frame description of this exact moment: concrete pose, gaze direction, facial micro-expression, physical interaction with props, foreground/midground/background composition. Name every visible Lorebook character verbatim.'
          },
          lighting: {
            type: 'string',
            description:
              'Motivated English cinematography lighting (key direction, rim/practical lights, shadow contrast, color temperature) consistent with the location and visual style.'
          },
          blocking: {
            type: 'string',
            description:
              'Clear English 180-degree spatial staging in frame (e.g. "Dina on screen-left facing right, Bima opposite on screen-right facing left, Pak Gunawan at center-midground") keeping consistent left/right geography across consecutive shots in the same room.'
          },
          camera_pov: {
            type: 'string',
            description:
              'Specific English 3D camera POV / angle placement (e.g. "over-the-shoulder (OTS) from behind Dina\'s right shoulder looking across the table at Bima", "reverse-angle OTS from behind Bima\'s left shoulder toward Dina", "eye-level medium close-up facing Pak Gunawan", "low-angle dramatic shot", "insert close-up looking down at the table").'
          },
          prop_placement: {
            type: 'string',
            description:
              'Fixed physical position of every visible prop and key furniture landmark in this shot so props never teleport across POV cuts (e.g. "maroon project folder open on the dark wood table directly in front of Dina; silver laptop angled slightly left of the folder; tall windows stay on the left wall"). Empty string if no props.'
          },
          framing: {
            type: 'string',
            description:
              'English camera framing, shot size, and perspective matching the visual style (e.g. "low-angle medium close-up, tight dramatic framing" or "over-the-shoulder close-up").'
          },
          avoid: {
            type: 'string',
            description:
              'Comma-separated English pitfalls to prevent for THIS shot (e.g. "swapped faces, wrong costume/outfit, teleported props, shifted background furniture, distorted hands, split screen, turnaround grid, on-screen text, watermark").'
          },
          video_motion: {
            type: 'string',
            description:
              'Concrete 1-2 sentence English AI-video motion direction for Veo 3.1 / Kling: exact subject gestures, facial micro-expressions, prop movement, subtle background motion, and ONE smooth continuous camera move. No scene cuts, no music or soundtrack.'
          },
          camera_motion: {
            type: 'string',
            description: 'Short English camera movement label (e.g. "slow tense dolly in", "subtle handheld micro-shake", "static locked frame").'
          },
          camera_preset: { type: 'string', enum: CAMERA_IDS },
          motion_strength: { type: 'string', enum: STRENGTH_IDS },
          transition: { type: 'string', enum: TRANSITION_IDS }
        },
        required: [
          'shot_number',
          'action',
          'lighting',
          'blocking',
          'camera_pov',
          'prop_placement',
          'framing',
          'avoid',
          'video_motion',
          'camera_motion',
          'camera_preset',
          'motion_strength',
          'transition'
        ]
      }
    }
  },
  required: ['shots']
}

interface RawShotPromptItem {
  shot_number?: number
  action?: string
  lighting?: string
  blocking?: string
  camera_pov?: string
  prop_placement?: string
  framing?: string
  avoid?: string
  video_motion?: string
  camera_motion?: string
  camera_preset?: string
  motion_strength?: string
  transition?: string
}

interface RawShotPromptsResponse {
  shots?: RawShotPromptItem[]
}

function buildWardrobeLine(
  clip: Clip,
  chars: ReturnType<typeof charactersOf>,
  derivs: ReturnType<typeof derivativesOf>
): string {
  const wardrobeParts: string[] = []
  const charIds = clip.characterIds || []
  const costumeIds = clip.costumeIds || {}
  for (const cid of charIds) {
    const ch = chars.find((c) => c.id === cid)
    if (!ch) continue
    const did = costumeIds[cid]
    const deriv = did ? derivs.find((d) => d.id === did) : null
    if (deriv) {
      const kp = deriv.costumeKeyphrase ? `, key elements: ${deriv.costumeKeyphrase}` : ''
      wardrobeParts.push(`${ch.name} - custom: ${deriv.name} (${deriv.promptChange || 'modified outfit'}${kp})`)
    } else {
      const defOutfit = ch.profile?.visual?.defaultOutfit?.trim()
      wardrobeParts.push(
        defOutfit
          ? `${ch.name} - default outfit (${defOutfit}) matching character sheet`
          : `${ch.name} - default appearance as on character sheet`
      )
    }
  }
  return wardrobeParts.length ? `Wardrobe: ${wardrobeParts.join('; ')}` : ''
}

function inferCameraPresetFromMotion(motionText: string | undefined, framing: string | undefined): {
  cameraPreset: CameraPresetId
  motionStrength: MotionStrength
} {
  const m = `${motionText || ''} ${framing || ''}`.toLowerCase()
  if (/shake|handheld|impact|slap|shock|trembl|jolt/.test(m)) return { cameraPreset: 'shake', motionStrength: 'kuat' }
  if (/pan\s*left|track\s*left|slide\s*left/.test(m)) return { cameraPreset: 'panleft', motionStrength: 'sedang' }
  if (/pan\s*right|track\s*right|slide\s*right/.test(m)) return { cameraPreset: 'panright', motionStrength: 'sedang' }
  if (/pull\s*back|dolly\s*out|zoom\s*out|reveal|wide|establishing/.test(m)) return { cameraPreset: 'zoomout', motionStrength: 'halus' }
  if (/static|locked|still|hold/.test(m)) return { cameraPreset: 'static', motionStrength: 'halus' }
  if (/dramatic|whip|fast|intense|twist|push\s*in/.test(m)) return { cameraPreset: 'zoomin', motionStrength: 'kuat' }
  return { cameraPreset: 'zoomin', motionStrength: 'sedang' }
}

function buildFallbackShotPrompt(
  clip: Clip,
  prevClip: Clip | null,
  orientation: string,
  chars: ReturnType<typeof charactersOf>,
  derivs: ReturnType<typeof derivativesOf>,
  locs: ReturnType<typeof locationsOf>,
  prs: ReturnType<typeof propsOf>
): {
  visualPrompt: string
  videoPrompt: string
  cameraPreset: CameraPresetId
  motionStrength: MotionStrength
  transition: TransitionId
} {
  const loc = clip.locationId ? locs.find((l) => l.id === clip.locationId) : null
  const settingLine = loc ? `Setting: ${formatLocationDetails(loc)}` : ''

  const visibleNames = (clip.characterIds || [])
    .map((id) => chars.find((c) => c.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  const clipProps = (clip.propIds || [])
    .map((id) => prs.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))

  const baseAction = clip.story.trim() || clip.narration.trim() || 'Character in dramatic confrontation'
  const emotionDesc = clip.emotion?.trim() ? `, expression: ${clip.emotion.trim()}` : ''
  const blockingDesc = clip.shotDetail?.blocking?.trim() ? `. Staging: ${clip.shotDetail.blocking.trim()}` : ''
  const propCue = clipProps.length ? `. Visible props: ${clipProps.map(formatPropDetails).join('; ')}` : ''
  const nameLead =
    visibleNames.length && !visibleNames.some((n) => baseAction.toLowerCase().includes(n.toLowerCase()))
      ? `${visibleNames.join(' and ')} — `
      : ''
  const actionLine = `Action: ${nameLead}${baseAction}${emotionDesc}${blockingDesc}${propCue}`

  const wardrobeLine = buildWardrobeLine(clip, chars, derivs)
  const lightingCue = clip.shotDetail?.lighting?.trim() || 'motivated dramatic lighting'
  const framingLine = `Framing: ${orientation} shot, ${clip.framing || 'medium close-up'}, ${lightingCue}`
  const avoidLine = `Avoid: swapped character faces, wrong outfit colors, deformed eyes, bad hands, split-screen grid, white studio sheet backdrop, on-screen text, subtitles, watermark`

  const camMotion = clip.shotDetail?.cameraMotion?.trim() || 'smooth subtle cinematic camera push-in'
  const reaction = clip.shotDetail?.nonSpeakingReaction?.trim() ? ` Listener reaction: ${clip.shotDetail.nonSpeakingReaction.trim()}.` : ''
  const videoPrompt = `${baseAction.replace(/\.$/, '')}. Natural micro-expressions and lifelike posture.${reaction} Camera: ${camMotion}.`

  const { cameraPreset, motionStrength } = inferCameraPresetFromMotion(clip.shotDetail?.cameraMotion, clip.framing)
  const locationChanged = prevClip && prevClip.locationId !== clip.locationId
  const transition: TransitionId = locationChanged ? 'fade' : 'cut'

  return {
    visualPrompt: [settingLine, actionLine, wardrobeLine, framingLine, avoidLine].filter(Boolean).join('\n'),
    videoPrompt,
    cameraPreset,
    motionStrength,
    transition
  }
}

export async function writePrompts(
  projectId: string,
  episodeId: string,
  clipIds?: string[],
  options: WritePromptsOptions = {}
): Promise<ProjectBundle> {
  const clips = clipsOf(projectId, episodeId)
  const forceOverwrite = Boolean(clipIds?.length || options.force)
  const targets = clips.filter((c) => (clipIds ? clipIds.includes(c.id) : options.force ? true : needsVisual(c) || !c.videoPrompt.trim()))
  if (!targets.length) return getBundle(projectId, episodeId)

  const project = getProject(projectId)
  const episode = getEpisode(episodeId)
  const chars = charactersOf(projectId)
  const locs = locationsOf(projectId)
  const prs = propsOf(projectId)
  const derivs = derivativesOf(projectId)
  const { style, prompt: effectiveStylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const orientation = project.aspectRatio === '9:16' ? 'vertical 9:16' : `horizontal ${project.aspectRatio}`

  const clipIndexMap = new Map(clips.map((c, idx) => [c.id, idx]))
  const aiByClipId = new Map<string, RawShotPromptItem>()

  if (options.useAi !== false) {
    const visualTpl = project.promptTemplates?.visual_prompt?.trim()
    const videoTpl = project.promptTemplates?.video_prompt?.trim()
    const mediumRule =
      style.category === 'animation'
        ? `7. STYLE-AUTHENTIC MEDIUM (${style.name}): Match the chosen animation/illustration/stop-motion medium authentically (line art, brushwork, cel shading, 3D CG shaders, or tactile wool/clay craft as defined by Target Visual Style). Do NOT force photorealistic DSLR lens jargon or real-human photographic skin-pore cues onto 2D anime, ink, or stop-motion styles.${isRestrictedPalette ? ' Respect the style\'s monochrome or strict restricted palette.' : ''}`
        : style.category === 'custom'
          ? '7. CUSTOM VISUAL STYLE: Follow the creator\'s Series visual guidelines and target art style verbatim for rendering medium, textures, and lighting.'
          : `7. LIVE-ACTION CINEMATOGRAPHY (${style.name}): Use grounded cinema framing, motivated natural/practical lighting, and realistic blocking matching Target Visual Style.${isRestrictedPalette ? ' Respect the style\'s black-and-white / restricted palette.' : ''}`
    const system = [
      'You are an elite Visual Director and Cinematographer for vertical short drama series across all visual mediums (live-action, 2D anime, webtoon, 3D CG, ink art, and stop-motion).',
      'Your mission: transform Indonesian storyboard shots into razor-sharp, vivid, cohesive ENGLISH image & video prompts optimized for multimodal reference-based image generation and AI video.',
      'CRITICAL CONSISTENCY RULES:',
      '1. STRICT LOREBOOK FIDELITY & COSTUME LOCK: Every shot MUST respect the exact registered Lorebook characters (name verbatim, age, face, hair, build), exact outfits (whether cultural wear like batik/kebaya/hanfu, armor, uniforms, streetwear, or formal attire — NEVER invent or substitute generic default clothing unless explicitly listed in that character\'s Lorebook!), location architecture/lighting, and prop appearance. When mentioning clothes in "action", echo the exact Lorebook garment/pattern or leave attire to the Lorebook Wardrobe block.',
      '2. SPATIAL CLARITY & SPEAKER PROMINENCE: Whenever 2+ characters appear, explicitly specify left/right/foreground/background positions in both "action" and "blocking" so the image model NEVER swaps faces or blends costumes. Whenever a shot has a speaking character (on-screen dialogue), frame the SPEAKER prominently in foreground or center-midground (never tiny or obscured at the far end of a long table) so their facial expression, lip-sync, and exact outfit read clearly.',
      '3. 180-DEGREE SET GEOGRAPHY & FIXED PROP PERMANENCE: For consecutive shots in the SAME location, lock ONE consistent 3D room/set map (which wall has windows/doors, furniture/landmark shape & material, light direction, who sits/stands screen-left vs screen-right, and exact physical spot of every prop). Vary "camera_pov" dynamically across cuts (e.g. Wide Establishing -> Over-the-Shoulder (OTS) past Character A\'s shoulder onto B -> Reverse OTS onto A -> Medium Close-Up on Speaker -> Insert Close-Up on Prop) WITHOUT moving or teleporting background furniture, windows, or props! Record exact prop & landmark positions in "prop_placement".',
      '4. CINEMATIC 9:16 VERTICAL COMPOSITION & EPISODE COHESION: Make every frame visually striking with foreground depth elements (doorframes, blurred shoulders, table edges), dynamic angles, expressive body language, and consistent set materials, light direction, and mood across same-location shots.',
      '5. SINGLE-TAKE VIDEO MOTION: Write concrete English "video_motion" for Veo 3.1 / Omni 1.2 Flash: natural acting gestures, eye movement, prop interaction, subtle ambient motion, and ONE smooth camera move. For on-screen dialogue shots, keep framing steady for clean lip-sync. Never mention background music or scene cuts.',
      '6. PURE ENGLISH OUTPUT: Write every output field in crisp, concrete cinematic English (never Indonesian), except keeping exact character/location/prop proper names verbatim.',
      mediumRule,
      visualTpl ? `Creator visual prompt note: ${visualTpl}` : '',
      videoTpl ? `Creator video prompt note: ${videoTpl}` : '',
      project.seriesGuidelines ? `Series visual guidelines:\n${project.seriesGuidelines}` : ''
    ].filter(Boolean).join('\n')

    const charBible = chars.length
      ? chars.map((c) => {
          const variants = derivs
            .filter((d) => d.characterId === c.id)
            .map((d) => `${d.name}: ${d.promptChange}${d.costumeKeyphrase ? ` [KEY: ${d.costumeKeyphrase}]` : ''}`)
            .join(' | ')
          return `- ${c.name}: ${formatCharacterTraits(c, true)}${variants ? ` || Costumes: ${variants}` : ''}`
        }).join('\n')
      : '(none)'

    const locBible = locs.length
      ? locs.map((l) => `- ${l.name}: ${formatLocationDetails(l)}`).join('\n')
      : '(none)'

    const propBible = prs.length
      ? prs.map((p) => `- ${formatPropDetails(p)}`).join('\n')
      : '(none)'

    const BATCH_SIZE = 12
    const batches: Clip[][] = []
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      batches.push(targets.slice(i, i + BATCH_SIZE))
    }

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      const batchNumbers = batch.map((c) => (clipIndexMap.get(c.id) ?? 0) + 1)
      emit.storyProgress({
        projectId,
        message:
          batches.length > 1
            ? `Mengoptimasi prompt visual & video AI (bagian ${bi + 1}/${batches.length})…`
            : `Mengoptimasi ${batch.length} prompt visual & video dengan AI Director…`
      })

      // Include immediate neighbors so lighting and blocking flow seamlessly across cuts.
      const contextNums = new Set<number>()
      for (const n of batchNumbers) {
        contextNums.add(n)
        if (n > 1) contextNums.add(n - 1)
        if (n < clips.length) contextNums.add(n + 1)
      }

      const shotDescriptions = [...contextNums]
        .sort((a, b) => a - b)
        .map((n) => {
          const c = clips[n - 1]
          const loc = c.locationId ? locs.find((l) => l.id === c.locationId) : null
          const visibleChars = (c.characterIds || [])
            .map((cid) => {
              const ch = chars.find((x) => x.id === cid)
              if (!ch) return null
              const did = c.costumeIds?.[cid]
              const d = did ? derivs.find((x) => x.id === did) : null
              return d ? `${ch.name} (wearing "${d.name}")` : `${ch.name} (default outfit)`
            })
            .filter(Boolean)
          const visibleProps = (c.propIds || [])
            .map((pid) => prs.find((p) => p.id === pid)?.name)
            .filter(Boolean)
          const speaker = c.speakerId ? chars.find((x) => x.id === c.speakerId)?.name : null
          const dType = c.shotDetail?.dialogueType ?? (c.speakerId ? 'dialogue' : 'narration')
          const isTarget = batchNumbers.includes(n)
          return [
            `Shot ${n}${isTarget ? ' [GENERATE]' : ' [CONTEXT ONLY]'}: ${c.title}`,
            `- Location: ${loc ? loc.name : '(unspecified)'}`,
            `- Visible Characters: ${visibleChars.length ? visibleChars.join(', ') : '(none)'}`,
            `- Props: ${visibleProps.length ? visibleProps.join(', ') : '(none)'}`,
            `- Dialogue (${dType}${speaker ? `, speaker: ${speaker}` : ''}): ${c.narration.trim() || '(silent)'}`,
            `- Indonesian Visual Action: ${c.story.trim() || '(none)'}`,
            `- Emotion: ${c.emotion.trim() || '(natural)'}`,
            `- Requested Framing: ${c.framing.trim() || 'medium close-up'}`,
            c.shotDetail?.cameraPov ? `- Requested Camera POV: ${c.shotDetail.cameraPov}` : '',
            c.shotDetail?.lighting ? `- Director Lighting Note: ${c.shotDetail.lighting}` : '',
            c.shotDetail?.blocking ? `- Director Blocking Note: ${c.shotDetail.blocking}` : '',
            c.shotDetail?.propPlacement ? `- Fixed Prop Placement Note: ${c.shotDetail.propPlacement}` : '',
            c.shotDetail?.cameraMotion ? `- Director Camera Note: ${c.shotDetail.cameraMotion}` : '',
            c.shotDetail?.nonSpeakingReaction ? `- Non-Speaking Reaction: ${c.shotDetail.nonSpeakingReaction}` : '',
            c.shotDetail?.speechDelivery ? `- Speech Delivery: ${c.shotDetail.speechDelivery}` : ''
          ].filter(Boolean).join('\n')
        })
        .join('\n\n')

      const prompt = [
        `Series: ${project.title || '(untitled)'} | Episode ${episode?.episodeNum ?? 1}: ${episode?.title ?? ''}`,
        `Format: ${orientation} (${project.aspectRatio})`,
        `Target Visual Style: ${style.name} (${style.category}) — ${effectiveStylePrompt}`,
        `--- LOREBOOK VISUAL BIBLE ---\nCharacters:\n${charBible}\n\nLocations:\n${locBible}\n\nProps:\n${propBible}`,
        `--- EPISODE SHOTS ---\n${shotDescriptions}`,
        `Write cinematic English prompts ONLY for shots marked [GENERATE]: ${batchNumbers.join(', ')}.`,
        `Allowed camera_preset: ${CAMERA_IDS.join(', ')}. Allowed motion_strength: ${STRENGTH_IDS.join(', ')}. Allowed transition: ${TRANSITION_IDS.join(', ')}.`
      ].join('\n\n')

      try {
        const res = await generateJson<RawShotPromptsResponse>({
          system,
          prompt,
          schema: SHOT_PROMPTS_SCHEMA,
          name: `shot_prompts_${episodeId}_${bi + 1}`
        })
        for (const item of res.shots ?? []) {
          const num = Number(item.shot_number)
          if (!Number.isInteger(num) || !batchNumbers.includes(num)) continue
          const targetClip = clips[num - 1]
          if (targetClip && (str(item.action) || str(item.video_motion))) {
            aiByClipId.set(targetClip.id, item)
          }
        }
      } catch (err) {
        if (options.requireAi) {
          throw err
        }
        console.warn('[story] AI writePrompts unavailable, falling back to structured local prompts:', err instanceof Error ? err.message : String(err))
        break
      }
    }
  }

  for (const clip of targets) {
    const idx = clipIndexMap.get(clip.id) ?? 0
    const prevClip = idx > 0 ? clips[idx - 1] : null
    const ai = aiByClipId.get(clip.id)
    const fallback = buildFallbackShotPrompt(clip, prevClip, orientation, chars, derivs, locs, prs)

    let visualPrompt = fallback.visualPrompt
    let videoPrompt = fallback.videoPrompt
    let cameraPreset = fallback.cameraPreset
    let motionStrength = fallback.motionStrength
    let transition = fallback.transition
    let nextFraming = clip.framing
    let nextShotDetail = clip.shotDetail

    if (ai) {
      const loc = clip.locationId ? locs.find((l) => l.id === clip.locationId) : null
      const settingLine = loc ? `Setting: ${formatLocationDetails(loc)}` : ''
      const visibleNames = (clip.characterIds || [])
        .map((id) => chars.find((c) => c.id === id)?.name)
        .filter((n): n is string => Boolean(n))

      let actionText = str(ai.action)
      if (actionText && visibleNames.length && !visibleNames.some((n) => actionText.toLowerCase().includes(n.toLowerCase()))) {
        actionText = `${visibleNames.join(' and ')}: ${actionText}`
      }
      const actionLine = actionText ? `Action: ${actionText}` : ''
      const wardrobeLine = buildWardrobeLine(clip, chars, derivs)
      const aiFraming = str(ai.framing) || clip.framing || 'medium close-up'
      const aiLighting = str(ai.lighting)
      const aiBlocking = str(ai.blocking)
      const aiCameraPov = str(ai.camera_pov)
      const aiPropPlacement = str(ai.prop_placement)
      const aiCamMotion = str(ai.camera_motion)
      const framingLine = `Framing: ${orientation} shot, ${aiFraming}${aiLighting ? `, ${aiLighting}` : ''}`
      const avoidLine = `Avoid: ${str(ai.avoid) || 'swapped character faces, wrong costume/outfit, teleported props, shifted background furniture, deformed hands, split-screen turnaround grid, plain studio background, on-screen text, subtitles, watermark'}`

      visualPrompt = [settingLine, actionLine, wardrobeLine, framingLine, avoidLine].filter(Boolean).join('\n')
      videoPrompt = str(ai.video_motion) || fallback.videoPrompt

      const cam = str(ai.camera_preset) as CameraPresetId
      const strength = str(ai.motion_strength) as MotionStrength
      const trans = str(ai.transition) as TransitionId
      cameraPreset = CAMERA_IDS.includes(cam) ? cam : fallback.cameraPreset
      motionStrength = STRENGTH_IDS.includes(strength) ? strength : fallback.motionStrength
      transition = TRANSITION_IDS.includes(trans) ? trans : fallback.transition
      if (aiFraming) nextFraming = aiFraming
      nextShotDetail = {
        ...(clip.shotDetail ?? {}),
        ...(aiLighting ? { lighting: aiLighting } : {}),
        ...(aiBlocking ? { blocking: aiBlocking } : {}),
        ...(!clip.shotDetail?.cameraPov && aiCameraPov ? { cameraPov: aiCameraPov } : {}),
        ...(aiPropPlacement ? { propPlacement: aiPropPlacement } : {}),
        ...(aiCamMotion ? { cameraMotion: aiCamMotion } : {})
      }
    }

    // Without an explicit list or force flag, only empty prompts (or ones whose scene text changed since)
    // are written, so prompts the creator edited stay theirs.
    const patch: Partial<Clip> = {}
    if (forceOverwrite || needsVisual(clip)) {
      Object.assign(patch, {
        visualPrompt,
        visualSource: visualSourceOf(clip),
        framing: nextFraming,
        shotDetail: nextShotDetail,
        cameraPreset,
        motionStrength,
        transition
      })
    }
    if (forceOverwrite || !clip.videoPrompt.trim()) {
      patch.videoPrompt = videoPrompt
    }
    if (Object.keys(patch).length > 0) {
      patchClip(clip.id, patch)
    }
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

// ---------- Phase 7: Lorebook Extraction from Story ----------

const LOREBOOK_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Character full name in the story' },
          description: { type: 'string', description: 'Comprehensive visual appearance in 1-2 Indonesian sentences' },
          voiceStyle: { type: 'string', description: 'Speaking tone / vocal style in Indonesian (e.g. tegas, sinis, dingin), or "" if unknown' },
          aliases: { type: 'array', items: { type: 'string' }, description: 'Aliases, nicknames, or title forms (empty array if none)' },
          visual: {
            type: 'object',
            additionalProperties: false,
            properties: {
              age: { type: 'string', description: 'Age range, e.g. "25-30 tahun", or ""' },
              gender: { type: 'string', description: 'Pria / Wanita, or ""' },
              bodyType: { type: 'string', description: 'Body build and posture, or ""' },
              facialFeatures: { type: 'string', description: 'Distinct face features, or ""' },
              hair: { type: 'string', description: 'Hair length, color, parting, texture, styling, or ""' },
              distinctiveFeatures: { type: 'string', description: 'Unique physical identifiers (skin tone, scars, mole, beard/mustache, smile lines), or ""' },
              accessories: { type: 'string', description: 'Recurring accessories (eyewear frame shape, wristwatch, earrings, rings, bag), or ""' },
              defaultOutfit: { type: 'string', description: 'Exact signature wardrobe: garment cut, fabric/pattern (e.g. exact batik motif & colors, sleeve length, collar, trousers/skirt, footwear — explicitly note "tanpa jas/blazer" if no jacket), or ""' }
            },
            required: ['age', 'gender', 'bodyType', 'facialFeatures', 'hair', 'distinctiveFeatures', 'accessories', 'defaultOutfit']
          },
          narrative: {
            type: 'object',
            additionalProperties: false,
            properties: {
              role: { type: 'string', description: 'Role in story (protagonis, antagonis, pendukung), or ""' },
              desire: { type: 'string', description: 'Main motivation or desire, or ""' },
              secret: { type: 'string', description: 'Hidden secret or vulnerability, or ""' },
              arc: { type: 'string', description: 'Character trajectory or transformation, or ""' },
              speechPattern: { type: 'string', description: 'Speech mannerism or habits, or ""' }
            },
            required: ['role', 'desire', 'secret', 'arc', 'speechPattern']
          }
        },
        required: ['name', 'description', 'voiceStyle', 'aliases', 'visual', 'narrative']
      }
    },
    derivatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          characterName: { type: 'string', description: 'Character who wears this costume' },
          name: { type: 'string', description: 'Name of the costume variant (e.g. Gaun Merah Pesta, Jas Hitam Kantor)' },
          promptChange: { type: 'string', description: 'Description of the changed attire and makeup' },
          costumeKeyphrase: { type: 'string', description: 'Short, memorable anchor keyphrase for image/video prompts' }
        },
        required: ['characterName', 'name', 'promptChange', 'costumeKeyphrase']
      }
    },
    locations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Location name' },
          description: { type: 'string', description: 'Visual atmosphere and scenic details' },
          aliases: { type: 'array', items: { type: 'string' }, description: 'Aliases or alternate names (empty array if none)' },
          profile: {
            type: 'object',
            additionalProperties: false,
            properties: {
              interiorExterior: { type: 'string', description: 'Interior / Eksterior, or ""' },
              timeOfDayLighting: { type: 'string', description: 'Exact light sources, window light direction, color temperature & time of day, or ""' },
              architecturalStyle: { type: 'string', description: 'Design/architectural aesthetic, wall & floor materials, or ""' },
              spatialLayout: { type: 'string', description: '4-wall 3D room layout & fixed landmarks (left wall, right wall, center furniture, windows, doors) for multi-POV continuity, or ""' },
              colorPalette: { type: 'string', description: 'Dominant wall, floor, and furniture color palette, or ""' },
              keyFeatures: { type: 'string', description: 'Defining permanent physical features & fixed furniture, or ""' }
            },
            required: ['interiorExterior', 'timeOfDayLighting', 'architecturalStyle', 'spatialLayout', 'colorPalette', 'keyFeatures']
          }
        },
        required: ['name', 'description', 'aliases', 'profile']
      }
    },
    props: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Single distinct hero prop name (do NOT bundle two unrelated objects into one prop)' },
          description: { type: 'string', description: 'Concrete physical appearance' },
          aliases: { type: 'array', items: { type: 'string' }, description: 'Aliases or alternate names (empty array if none)' },
          profile: {
            type: 'object',
            additionalProperties: false,
            properties: {
              category: { type: 'string', description: 'Category (dokumen, elektronik, senjata, perhiasan, dll), or ""' },
              sizeScale: { type: 'string', description: 'Real-world size relative to human hand/body (e.g. "ukuran A4, 14 inci, seukuran telapak tangan"), or ""' },
              shape: { type: 'string', description: 'Exact silhouette and proportions, or ""' },
              material: { type: 'string', description: 'Surface material & finish (kulit matte, plastik glossy, logam perak, kertas kaku), or ""' },
              appearance: { type: 'string', description: 'Exact colors, texture, and state (open/closed, neat/worn), or ""' },
              distinctiveDetails: { type: 'string', description: 'Unique markings, clasps, stickers, engravings, or wear, or ""' },
              significance: { type: 'string', description: 'Plot or emotional significance, or ""' }
            },
            required: ['category', 'sizeScale', 'shape', 'material', 'appearance', 'distinctiveDetails', 'significance']
          }
        },
        required: ['name', 'description', 'aliases', 'profile']
      }
    }
  },
  required: ['characters', 'derivatives', 'locations', 'props']
}

interface LorebookExtractRun {
  ctrl: AbortController
  reason: 'cancel' | 'superseded' | null
}

const lorebookExtractControllers = new Map<string, LorebookExtractRun>()

const countLorebookEntities = (r: LorebookExtractionResult): number =>
  r.characters.length + r.derivatives.length + r.locations.length + r.props.length

export async function extractLorebookFromStory(projectId: string): Promise<LorebookExtractionResult> {
  const p = getProject(projectId)
  const episodes = listEpisodes(projectId)
  const epSummaries = episodes
    .map((e) => {
      const epClips = !e.scriptDraft?.shots?.length ? clipsOf(projectId, e.id) : []
      const clipLines = epClips
        .map((c) => [c.story?.trim(), c.narration?.trim(), c.visualPrompt?.trim()].filter(Boolean).join(' — '))
        .filter(Boolean)
      const parts = [
        `Ep ${e.episodeNum} (${e.title}):`,
        e.hook ? `Hook: ${e.hook}` : '',
        e.summary ? `Summary: ${e.summary}` : '',
        e.storyBeats?.length ? `Beats: ${e.storyBeats.join('; ')}` : '',
        e.cliffhanger ? `Cliffhanger: ${e.cliffhanger}` : '',
        e.sourceText?.trim() ? `Excerpt: ${e.sourceText.trim()}` : '',
        e.scriptDraft?.shots?.length
          ? `Draft shots: ${e.scriptDraft.shots
              .map((s) =>
                [
                  s.location ? `[Loc: ${s.location}]` : '',
                  s.characters?.length ? `[Chars: ${s.characters.join(', ')}]` : '',
                  s.props?.length ? `[Props: ${s.props.join(', ')}]` : '',
                  s.speaker ? `${s.speaker}: "${s.text}"` : s.text
                ]
                  .filter(Boolean)
                  .join(' ')
              )
              .join(' | ')}`
          : clipLines.length
            ? `Clips: ${clipLines.join(' | ')}`
            : ''
      ].filter(Boolean)
      return parts.length > 1 ? parts.join('\n') : ''
    })
    .filter(Boolean)
    .join('\n\n')

  const sourceText = p.sourceText.trim()
  const synopsisText = p.synopsis.trim()
  const source = sourceText || synopsisText || epSummaries
  if (!source) throw new Error('Tidak ada teks cerita, sinopsis, atau ringkasan episode untuk diekstrak ke Lorebook.')

  emit.storyProgress({ projectId, message: 'Menganalisis cerita untuk mengekstrak Lorebook & profil karakter...' })

  const system = [
    p.promptTemplates?.lorebook_extract ||
      'You are an expert story analyst and visual director specializing in worldbuilding bibles for vertical drama series.',
    'Extract ALL characters mentioned or implied in the story, synopsis, or episode plans (protagonists, antagonists, supporting characters — even if mentioned only briefly), their notable costume variants with anchor keyphrases, key locations/settings, and important props.',
    'CONCRETE VISUAL PRECISION (CRITICAL FOR AI IMAGE CONSISTENCY): Never write vague adjectives like "tampan", "cantik", "berwibawa", "pakai batik", or "mewah" alone. Always specify observable, camera-ready traits:',
    '- Characters: exact age number, skin tone, face shape, eye shape, eyebrow/jawline, exact hair length/color/parting, height/build, one memorable distinguishing mark, recurring accessories (glasses frame, watch, jewelry), and HYPER-SPECIFIC default outfit (exact garment cut, fabric type, exact motif/pattern e.g. "kemeja batik lengan panjang motif parang cokelat soga & emas, kerah kancing, tanpa jas/blazer", trousers/skirt color, footwear).',
    '- Costume variants: concrete garment silhouette, fabric/motif, exact color palette, makeup/hair change, plus a crisp 4–8 word anchor keyphrase (e.g. "gaun sutra merah marun bahu terbuka, anting mutiara") that locks wardrobe consistency.',
    '- Locations: interior/exterior, architectural style, dominant colorPalette, wall & floor materials, 4-wall spatialLayout (what sits on left wall, right wall, center furniture, windows/doors so every POV angle stays consistent), exact light sources & color temperature, and permanent keyFeatures.',
    '- Props: SEPARATE distinct hero objects into individual props (never merge "Laptop & Map" into 1 prop if characters interact with them separately). Always specify sizeScale (relative to a human hand/table), exact shape, material finish (matte/glossy/metal/paper), exact colors, distinctiveDetails (clasps, stickers, papers sticking out, scratches), and condition.',
    'If the text is a short synopsis or episode outline, still extract every person, place, and key object present and infer concrete, cohesive Indonesian visual details for each.',
    'Return ONE JSON object with exact top-level keys "characters", "derivatives", "locations", and "props" (each an array). Use "" for unknown string subfields and [] for empty arrays — never omit an entity or return all four arrays empty when people, places, or objects appear in the story.',
    p.seriesGuidelines ? `Creator guidelines for this series:\n${p.seriesGuidelines}` : ''
  ].filter(Boolean).join('\n\n')

  const merged: LorebookExtractionResult = { characters: [], derivatives: [], locations: [], props: [] }
  // The whole source is read part by part like the episode planner, so characters, places and props that only
  // appear late in a long novel are found too. Each part sees the names found so far, to reuse them, and the
  // results are merged by name and alias.
  const windows = planWindows(source, 0)
  const run: LorebookExtractRun = { ctrl: new AbortController(), reason: null }
  const prevRun = lorebookExtractControllers.get(projectId)
  if (prevRun) {
    prevRun.reason = 'superseded'
    prevRun.ctrl.abort()
  }
  lorebookExtractControllers.set(projectId, run)
  let sawUnrecognizedShape = false
  try {
    for (const [wi, w] of windows.entries()) {
      if (run.ctrl.signal.aborted) break
      const label = windows.length > 1 ? `bagian ${wi + 1} dari ${windows.length}` : 'cerita'
      const slice = source.slice(w.start, w.end)
      const known = [...merged.characters, ...merged.locations, ...merged.props].map((x) => x.name)
      const basePrompt = [
        p.title ? `Series Title: ${p.title}` : '',
        synopsisText && source !== synopsisText ? `Series Synopsis: ${synopsisText}` : '',
        epSummaries && source !== epSummaries ? `Planned Episodes:\n${epSummaries}` : '',
        known.length ? `Already found in earlier parts (reuse these exact names when they appear again):\n${known.join(', ')}` : '',
        `Source Story Content (${label}):\n"""\n${slice}\n"""`
      ].filter(Boolean).join('\n\n')

      const maxAttempts = slice.trim().length >= 20 ? 2 : 1
      let parsedWindow: LorebookExtractionResult = { characters: [], derivatives: [], locations: [], props: [] }
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (run.ctrl.signal.aborted) break
        emit.storyProgress({
          projectId,
          message:
            attempt === 1
              ? `Mengekstrak Lorebook dari ${label}...`
              : `Mengulang ekstraksi ${label} karena belum ada entitas terdeteksi...`
        })
        const prompt =
          attempt === 1
            ? basePrompt
            : `${basePrompt}\n\nIMPORTANT: Your previous response returned no entities. Re-read the story carefully and extract every person/character, setting/location, and key object/prop into the JSON keys "characters", "derivatives", "locations", and "props".`

        let res: unknown
        try {
          res = await generateJson<unknown>({
            system,
            prompt,
            schema: LOREBOOK_EXTRACTION_SCHEMA,
            name: 'lorebook_extraction',
            signal: run.ctrl.signal
          })
        } catch (e) {
          if (run.ctrl.signal.aborted) break
          // Earlier parts are kept: the creator can still review them instead of losing the whole run.
          if (countLorebookEntities(merged) > 0) {
            emit.storyProgress({
              projectId,
              message: `Gagal mengekstrak ${label}: ${e instanceof Error ? e.message : String(e)}. Hasil bagian sebelumnya tetap bisa ditinjau.`
            })
            break
          }
          throw e
        }
        const inspected = parseLorebookCandidatesWithMeta(res)
        parsedWindow = inspected.result
        if (countLorebookEntities(parsedWindow) > 0) break
        if (!inspected.recognizedContainer) sawUnrecognizedShape = true
        console.warn(
          `[story] lorebook extraction returned 0 items (window ${wi + 1}/${windows.length}, attempt ${attempt}/${maxAttempts}); top-level keys:`,
          res && typeof res === 'object' ? Object.keys(res as Record<string, unknown>) : typeof res
        )
      }
      mergeLorebookCandidates(merged, parsedWindow)
    }
  } finally {
    if (lorebookExtractControllers.get(projectId) === run) lorebookExtractControllers.delete(projectId)
  }

  // Superseded runs must not resolve as "no entities found" and falsely pop a toast over the active run.
  if (run.reason === 'superseded') throw new Error('Ekstraksi digantikan oleh permintaan baru.')
  if (run.reason === 'cancel' && countLorebookEntities(merged) === 0) throw new Error('Ekstraksi dibatalkan.')
  if (countLorebookEntities(merged) === 0 && sawUnrecognizedShape) {
    throw new Error('Format balasan AI tidak sesuai untuk ekstraksi Lorebook. Coba ulangi atau pilih model LLM lain di Pengaturan.')
  }

  emit.storyProgress({
    projectId,
    message: run.ctrl.signal.aborted
      ? 'Ekstraksi dihentikan; hasil yang sudah ditemukan tetap bisa ditinjau.'
      : `Ekstraksi selesai: ${merged.characters.length} karakter, ${merged.derivatives.length} kostum, ${merged.locations.length} lokasi, dan ${merged.props.length} prop.`
  })
  return merged
}

/** Stops a running Lorebook extraction; what was found so far is still returned for review. */
export function cancelLorebookExtraction(projectId: string): void {
  const run = lorebookExtractControllers.get(projectId)
  if (!run) return
  run.reason = 'cancel'
  run.ctrl.abort()
}

const nameKey = (x: string): string => x.trim().toLowerCase()

/**
 * Merges the candidates found in one source part into the running result. The same name or a shared alias is one
 * entry: aliases are joined and empty fields are filled from the newer find, so no duplicate reaches the review.
 */
export function mergeLorebookCandidates(into: LorebookExtractionResult, add: LorebookExtractionResult): void {
  const keysOf = (x: { name: string; aliases?: string[] }) => [x.name, ...(x.aliases ?? [])].map(nameKey).filter(Boolean)
  const mergeList = <T extends { tempId: string; name: string; aliases?: string[] }>(list: T[], items: T[]): void => {
    for (const item of items) {
      const keys = new Set(keysOf(item))
      const hit = list.find((x) => keysOf(x).some((k) => keys.has(k)))
      if (!hit) {
        list.push(item)
        continue
      }
      const aliases = [...new Set([...(hit.aliases ?? []), item.name, ...(item.aliases ?? [])])].filter((a) => nameKey(a) !== nameKey(hit.name))
      Object.assign(hit, fillEmptyFields(hit, item), { tempId: hit.tempId, name: hit.name, aliases })
    }
  }
  mergeList(into.characters, add.characters)
  mergeList(into.locations, add.locations)
  mergeList(into.props, add.props)
  for (const d of add.derivatives) {
    const owner = into.characters.find((c) => keysOf(c).includes(nameKey(d.characterName)))
    const ownerKeys = new Set(owner ? keysOf(owner) : [nameKey(d.characterName)])
    // Variants follow their character's main name, so the review links them to one entry.
    const item = owner ? { ...d, characterName: owner.name } : d
    const same = into.derivatives.find((x) => nameKey(x.name) === nameKey(d.name) && ownerKeys.has(nameKey(x.characterName)))
    if (same) Object.assign(same, fillEmptyFields(same, item), { tempId: same.tempId })
    else into.derivatives.push(item)
  }
}

const CHAR_ARRAY_KEYS = ['characters', 'karakter', 'tokoh', 'pemeran', 'cast', 'people']
const DERIV_ARRAY_KEYS = ['derivatives', 'costumes', 'costume_variants', 'costumeVariants', 'variants', 'kostum', 'varian', 'outfits']
const LOC_ARRAY_KEYS = ['locations', 'lokasi', 'places', 'settings', 'tempat']
const PROP_ARRAY_KEYS = ['props', 'properti', 'objects', 'items', 'benda']
const WRAPPER_KEYS = ['lorebook', 'lorebook_extraction', 'lorebookExtraction', 'result', 'data', 'entities', 'output']

function pickArray(obj: Record<string, unknown>, candidates: string[]): unknown[] | null {
  const lowerMap = new Map<string, unknown>()
  for (const [k, v] of Object.entries(obj)) lowerMap.set(k.toLowerCase(), v)
  for (const key of candidates) {
    const hit = lowerMap.get(key.toLowerCase())
    if (Array.isArray(hit)) return hit
  }
  return null
}

function unwrapLorebookRoot(res: unknown): Record<string, unknown> | null {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return null
  let cur = res as Record<string, unknown>
  const hasAnyList = (o: Record<string, unknown>): boolean =>
    Boolean(
      pickArray(o, CHAR_ARRAY_KEYS) ||
        pickArray(o, DERIV_ARRAY_KEYS) ||
        pickArray(o, LOC_ARRAY_KEYS) ||
        pickArray(o, PROP_ARRAY_KEYS)
    )
  if (hasAnyList(cur)) return cur
  for (const wk of WRAPPER_KEYS) {
    const nested = cur[wk]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const rec = nested as Record<string, unknown>
      if (hasAnyList(rec)) return rec
    }
  }
  // Single-key wrapper fallback (e.g. { worldbuilding: { characters: [...] } }).
  const entries = Object.entries(cur)
  if (entries.length === 1 && entries[0][1] && typeof entries[0][1] === 'object' && !Array.isArray(entries[0][1])) {
    const rec = entries[0][1] as Record<string, unknown>
    if (hasAnyList(rec)) return rec
  }
  return cur
}

function parseLorebookCandidatesWithMeta(res: unknown): { result: LorebookExtractionResult; recognizedContainer: boolean } {
  const root = unwrapLorebookRoot(res)
  if (!root) return { result: { characters: [], derivatives: [], locations: [], props: [] }, recognizedContainer: false }

  const charArr = pickArray(root, CHAR_ARRAY_KEYS)
  const derivArr = pickArray(root, DERIV_ARRAY_KEYS)
  const locArr = pickArray(root, LOC_ARRAY_KEYS)
  const propArr = pickArray(root, PROP_ARRAY_KEYS)
  const recognizedContainer = Boolean(charArr || derivArr || locArr || propArr)

  const rawChars = charArr ?? []
  const rawDerivs = derivArr ?? []
  const rawLocs = locArr ?? []
  const rawProps = propArr ?? []

  const entityName = (o: any): string => str(o?.name ?? o?.nama ?? o?.fullName ?? o?.full_name ?? o?.title)
  const entityDesc = (o: any): string => str(o?.description ?? o?.deskripsi ?? o?.visualDescription ?? o?.visual_description ?? o?.summary)

  const characters: CandidateCharacter[] = rawChars
    .map((item: any): CandidateCharacter => {
      const c = typeof item === 'string' ? { name: item } : (item ?? {})
      const vis = c.visual ?? c.profile?.visual ?? {}
      const nar = c.narrative ?? c.profile?.narrative ?? {}
      return {
        tempId: randomUUID(),
        name: entityName(c),
        description: entityDesc(c),
        voiceStyle: str(c.voiceStyle ?? c.voice_style ?? c.gaya_suara),
        aliases: Array.isArray(c.aliases) ? c.aliases.map(str).filter(Boolean) : [],
        profile: {
          visual: {
            age: str(vis.age ?? vis.usia),
            gender: str(vis.gender ?? vis.jenis_kelamin),
            bodyType: str(vis.bodyType ?? vis.body_type),
            facialFeatures: str(vis.facialFeatures ?? vis.facial_features),
            hair: str(vis.hair ?? vis.rambut),
            distinctiveFeatures: str(vis.distinctiveFeatures ?? vis.distinctive_features),
            accessories: str(vis.accessories ?? vis.aksesoris),
            defaultOutfit: str(vis.defaultOutfit ?? vis.default_outfit)
          },
          narrative: {
            role: str(nar.role ?? nar.peran),
            desire: str(nar.desire),
            secret: str(nar.secret),
            arc: str(nar.arc),
            speechPattern: str(nar.speechPattern ?? nar.speech_pattern)
          }
        }
      }
    })
    .filter((c) => Boolean(c.name))

  const derivatives: CandidateDerivative[] = rawDerivs
    .map((d: any): CandidateDerivative => ({
      tempId: randomUUID(),
      characterName: str(d?.characterName ?? d?.character_name ?? d?.character ?? d?.owner ?? d?.tokoh ?? d?.karakter),
      name: entityName(d),
      promptChange: str(d?.promptChange ?? d?.prompt_change ?? d?.description ?? d?.deskripsi),
      costumeKeyphrase: str(d?.costumeKeyphrase ?? d?.costume_keyphrase ?? d?.keyphrase)
    }))
    .filter((d) => Boolean(d.name && d.characterName))

  const locations: CandidateLocation[] = rawLocs
    .map((item: any): CandidateLocation => {
      const l = typeof item === 'string' ? { name: item } : (item ?? {})
      const prof = l.profile ?? {}
      return {
        tempId: randomUUID(),
        name: entityName(l),
        description: entityDesc(l),
        aliases: Array.isArray(l.aliases) ? l.aliases.map(str).filter(Boolean) : [],
        profile: {
          interiorExterior: str(prof.interiorExterior ?? prof.interior_exterior ?? l.interiorExterior ?? l.interior_exterior),
          timeOfDayLighting: str(prof.timeOfDayLighting ?? prof.time_of_day_lighting ?? l.timeOfDayLighting ?? l.time_of_day_lighting),
          architecturalStyle: str(prof.architecturalStyle ?? prof.architectural_style ?? l.architecturalStyle ?? l.architectural_style),
          spatialLayout: str(prof.spatialLayout ?? prof.spatial_layout ?? l.spatialLayout ?? l.spatial_layout),
          colorPalette: str(prof.colorPalette ?? prof.color_palette ?? l.colorPalette ?? l.color_palette),
          keyFeatures: str(prof.keyFeatures ?? prof.key_features ?? l.keyFeatures ?? l.key_features)
        }
      }
    })
    .filter((l) => Boolean(l.name))

  const props: CandidateProp[] = rawProps
    .map((item: any): CandidateProp => {
      const pr = typeof item === 'string' ? { name: item } : (item ?? {})
      const prof = pr.profile ?? {}
      return {
        tempId: randomUUID(),
        name: entityName(pr),
        description: entityDesc(pr),
        aliases: Array.isArray(pr.aliases) ? pr.aliases.map(str).filter(Boolean) : [],
        profile: {
          category: str(prof.category ?? prof.kategori ?? pr.category),
          sizeScale: str(prof.sizeScale ?? prof.size_scale ?? pr.sizeScale ?? pr.size_scale),
          shape: str(prof.shape ?? prof.bentuk ?? pr.shape),
          material: str(prof.material ?? prof.bahan ?? pr.material),
          appearance: str(prof.appearance ?? prof.tampilan ?? pr.appearance),
          distinctiveDetails: str(prof.distinctiveDetails ?? prof.distinctive_details ?? pr.distinctiveDetails),
          significance: str(prof.significance ?? prof.signifikansi ?? pr.significance)
        }
      }
    })
    .filter((pr) => Boolean(pr.name))

  return { result: { characters, derivatives, locations, props }, recognizedContainer }
}

export function parseLorebookCandidates(res: unknown): LorebookExtractionResult {
  return parseLorebookCandidatesWithMeta(res).result
}

const ENRICH_LOREBOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          age: { type: 'string' },
          gender: { type: 'string' },
          bodyType: { type: 'string' },
          facialFeatures: { type: 'string' },
          hair: { type: 'string' },
          distinctiveFeatures: { type: 'string' },
          accessories: { type: 'string' },
          defaultOutfit: { type: 'string' }
        },
        required: [
          'id',
          'description',
          'age',
          'gender',
          'bodyType',
          'facialFeatures',
          'hair',
          'distinctiveFeatures',
          'accessories',
          'defaultOutfit'
        ]
      }
    },
    locations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          interiorExterior: { type: 'string' },
          architecturalStyle: { type: 'string' },
          spatialLayout: { type: 'string' },
          colorPalette: { type: 'string' },
          timeOfDayLighting: { type: 'string' },
          atmosphere: { type: 'string' },
          keyFeatures: { type: 'string' },
          fixedDetails: { type: 'string' }
        },
        required: [
          'id',
          'description',
          'interiorExterior',
          'architecturalStyle',
          'spatialLayout',
          'colorPalette',
          'timeOfDayLighting',
          'atmosphere',
          'keyFeatures',
          'fixedDetails'
        ]
      }
    },
    props: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          sizeScale: { type: 'string' },
          shape: { type: 'string' },
          material: { type: 'string' },
          appearance: { type: 'string' },
          distinctiveDetails: { type: 'string' },
          status: { type: 'string' }
        },
        required: [
          'id',
          'description',
          'category',
          'sizeScale',
          'shape',
          'material',
          'appearance',
          'distinctiveDetails',
          'status'
        ]
      }
    }
  },
  required: ['characters', 'locations', 'props']
}

interface RawEnrichResponse {
  characters?: Array<{
    id?: string
    description?: string
    age?: string
    gender?: string
    bodyType?: string
    facialFeatures?: string
    hair?: string
    distinctiveFeatures?: string
    accessories?: string
    defaultOutfit?: string
  }>
  locations?: Array<{
    id?: string
    description?: string
    interiorExterior?: string
    architecturalStyle?: string
    spatialLayout?: string
    colorPalette?: string
    timeOfDayLighting?: string
    atmosphere?: string
    keyFeatures?: string
    fixedDetails?: string
  }>
  props?: Array<{
    id?: string
    description?: string
    category?: string
    sizeScale?: string
    shape?: string
    material?: string
    appearance?: string
    distinctiveDetails?: string
    status?: string
  }>
}

/**
 * Uses the LLM to enrich sparse/generic Lorebook visual profiles (characters, locations, props) with concrete,
 * camera-ready details while strictly preserving creator intent (never replacing batik with suits, etc.).
 */
export async function enrichLorebookDetails(
  projectId: string,
  target?: { kind: 'character' | 'location' | 'prop'; id: string }
): Promise<EnrichLorebookResult> {
  const project = getProject(projectId)
  const allChars = charactersOf(projectId)
  const allLocs = locationsOf(projectId)
  const allProps = propsOf(projectId)

  const targetChars = target ? (target.kind === 'character' ? allChars.filter((c) => c.id === target.id) : []) : allChars
  const targetLocs = target ? (target.kind === 'location' ? allLocs.filter((l) => l.id === target.id) : []) : allLocs
  const targetProps = target ? (target.kind === 'prop' ? allProps.filter((p) => p.id === target.id) : []) : allProps

  if (!targetChars.length && !targetLocs.length && !targetProps.length) {
    return { updatedCharacters: 0, updatedLocations: 0, updatedProps: 0 }
  }

  emit.storyProgress({
    projectId,
    message: target ? 'Memperkaya detail visual item Lorebook dengan AI…' : 'Memperkaya detail visual semua Tokoh, Lokasi & Prop dengan AI…'
  })

  const { style, prompt: effectiveStylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const system = [
    'You are an expert Production Designer and Visual Continuity Director for vertical drama series across all visual styles (live-action, 2D anime, webtoon, 3D CG, ink art, and stop-motion).',
    'Upgrade sparse or generic Lorebook profiles into concrete, visual-ready descriptions (in clear, natural Indonesian with exact colors/tones, materials, motifs, proportions, and spatial landmarks) matching the project\'s genre and visual style so multimodal AI image generators keep every character, outfit, set, and prop 100% consistent across all camera POVs.',
    'STRICT FIDELITY RULES:',
    '1. NEVER contradict what the creator already wrote! Preserve the exact garment type, era, and genre (e.g. batik, kebaya, hanfu, armor, uniform, streetwear, sci-fi gear, or casual wear) and expand it into concrete motif, cut, material, colors, and footwear — NEVER replace a character\'s stated clothing with generic default attire.',
    `2. STYLE HARMONIZATION (${style.name} · ${style.category}): Tailor material and aesthetic details to harmonize with the project\'s chosen visual style.${isRestrictedPalette ? ' Note that this style uses a monochrome or restricted palette, so focus on tonal contrast, texture, silhouette, and motif clarity.' : ''}`,
    '3. Characters: specify exact age number, skin/surface tone, face shape, jawline/eyes, exact hair length/color/parting, posture/build, distinguishing mark, recurring accessories (glasses shape, watch, jewelry, gear), and full defaultOutfit.',
    '4. Locations: specify interior/exterior, architecturalStyle, dominant colorPalette, concrete 4-wall spatialLayout (left wall, right wall, center furniture/landmarks, windows, doors) for 180-degree multi-POV continuity, exact light sources & mood, atmosphere, and permanent fixedDetails.',
    '5. Props: specify category, real-world sizeScale (relative to human hand/table), exact shape, material & surface finish, exact appearance, distinctiveDetails (clasps, markings, wear), and physical condition/status.',
    'Return ONLY items matching the provided input IDs. Keep IDs verbatim.'
  ].join('\n')

  const payload = {
    seriesTitle: project.title,
    style: `${style.name} (${style.category}) — ${effectiveStylePrompt}`,
    synopsis: (project.synopsis || project.sourceText || '').slice(0, 1500),
    characters: targetChars.map((c) => ({ id: c.id, name: c.name, description: c.description, visual: c.profile?.visual ?? {}, narrative: c.profile?.narrative ?? {} })),
    locations: targetLocs.map((l) => ({ id: l.id, name: l.name, description: l.description, profile: l.profile ?? {} })),
    props: targetProps.map((p) => ({ id: p.id, name: p.name, description: p.description, profile: p.profile ?? {} }))
  }

  const res = await generateJson<RawEnrichResponse>({
    system,
    prompt: `Enrich these Lorebook entries with concrete, camera-ready visual details:\n${JSON.stringify(payload, null, 2)}`,
    schema: ENRICH_LOREBOOK_SCHEMA,
    name: 'enrich_lorebook_details'
  })

  let updatedCharacters = 0
  for (const item of res.characters ?? []) {
    const existing = targetChars.find((c) => c.id === item.id)
    if (!existing) continue
    const prevVis = existing.profile?.visual ?? {}
    updateCharacter(existing.id, {
      description: str(item.description) || existing.description,
      profile: {
        ...existing.profile,
        visual: {
          ...prevVis,
          age: str(item.age) || prevVis.age,
          gender: str(item.gender) || prevVis.gender,
          bodyType: str(item.bodyType) || prevVis.bodyType,
          facialFeatures: str(item.facialFeatures) || prevVis.facialFeatures,
          hair: str(item.hair) || prevVis.hair,
          distinctiveFeatures: str(item.distinctiveFeatures) || prevVis.distinctiveFeatures,
          accessories: str(item.accessories) || prevVis.accessories,
          defaultOutfit: str(item.defaultOutfit) || prevVis.defaultOutfit
        }
      }
    })
    updatedCharacters++
  }

  let updatedLocations = 0
  for (const item of res.locations ?? []) {
    const existing = targetLocs.find((l) => l.id === item.id)
    if (!existing) continue
    const prev = existing.profile ?? {}
    updateLocation(existing.id, {
      description: str(item.description) || existing.description,
      profile: {
        ...prev,
        interiorExterior: str(item.interiorExterior) || prev.interiorExterior,
        architecturalStyle: str(item.architecturalStyle) || prev.architecturalStyle,
        spatialLayout: str(item.spatialLayout) || prev.spatialLayout,
        colorPalette: str(item.colorPalette) || prev.colorPalette,
        timeOfDayLighting: str(item.timeOfDayLighting) || prev.timeOfDayLighting,
        atmosphere: str(item.atmosphere) || prev.atmosphere,
        keyFeatures: str(item.keyFeatures) || prev.keyFeatures,
        fixedDetails: str(item.fixedDetails) || prev.fixedDetails
      }
    })
    updatedLocations++
  }

  let updatedProps = 0
  for (const item of res.props ?? []) {
    const existing = targetProps.find((p) => p.id === item.id)
    if (!existing) continue
    const prev = existing.profile ?? {}
    updateProp(existing.id, {
      description: str(item.description) || existing.description,
      profile: {
        ...prev,
        category: str(item.category) || prev.category,
        sizeScale: str(item.sizeScale) || prev.sizeScale,
        shape: str(item.shape) || prev.shape,
        material: str(item.material) || prev.material,
        appearance: str(item.appearance) || prev.appearance,
        distinctiveDetails: str(item.distinctiveDetails) || prev.distinctiveDetails,
        status: str(item.status) || prev.status
      }
    })
    updatedProps++
  }

  if (updatedCharacters || updatedLocations || updatedProps) {
    syncProjectSeriesLocks(projectId)
    touchProject(projectId)
  }

  return { updatedCharacters, updatedLocations, updatedProps }
}
