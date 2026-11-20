import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Asset,
  AssetKind,
  AssetMeta,
  AssetUsageSummary,
  Character,
  CharacterDerivative,
  DraftShot,
  Clip,
  EditorSettings,
  Episode,
  EpisodeScriptDraft,
  FilterId,
  Job,
  JobKind,
  JobStatus,
  Location,
  MergeAssetInput,
  NewProjectInput,
  Project,
  ProjectBundle,
  ProjectSnapshot,
  ProjectSummary,
  Prop,
  StoryPlan
} from '@shared/types'
import { isDefaultCostume, isNarratorName, visualSourceOf } from '@shared/script'
import { detectGender, FEMALE_GEMINI_VOICES, MALE_GEMINI_VOICES, geminiVoiceGender } from '@shared/models'
import { getDb } from './db'
import { assetUrl, projectDir, projectsRoot } from './paths'
import { getSettings } from './settings'

export const DEFAULT_EDITOR: EditorSettings = {
  captionStyle: 'karaoke',
  captionPosition: 'bawah',
  captionSize: 'sedang',
  musicAssetId: null,
  musicVolumeDb: -18,
  duckMusic: true,
  overlays: []
}

/**
 * The look a new episode inherits from the series: caption style, filter and volumes carry over, but music,
 * sound effects and per-clip framing belong to another episode's timeline. Only full-length overlays
 * (a logo or watermark) carry over; timed ones were placed for another cut.
 */
function seriesEditorTemplate(e: EditorSettings): EditorSettings {
  return {
    ...e,
    musicAssetId: null,
    musicStartMs: undefined,
    musicEndMs: undefined,
    musicInMs: undefined,
    musicPrompt: null,
    sfx: [],
    clipFraming: undefined,
    overlays: (e.overlays ?? []).filter((o) => o.start <= 0 && o.end == null)
  }
}

/** Each episode has its own timeline settings; the project row only keeps the series template. */
export function editorOf(project: Project, episode: Episode | null | undefined): EditorSettings {
  if (episode?.editor) return { ...DEFAULT_EDITOR, ...episode.editor }
  return seriesEditorTemplate(project.editor)
}

type Row = Record<string, any>

const toProject = (r: Row): Project => ({
  id: r.id,
  title: r.title,
  synopsis: r.synopsis,
  sourceText: r.source_text ?? '',
  sourceKind: r.source_kind ?? 'novel',
  dialogAudio: r.dialog_audio ?? 'video',
  storyPlan: r.story_plan_json ? JSON.parse(r.story_plan_json) : null,
  durationSec: r.duration_sec,
  language: r.language,
  aspectRatio: r.aspect_ratio,
  styleId: r.style_id,
  ttsProvider: r.tts_provider,
  ttsVoice: r.tts_voice,
  imageModel: r.image_model,
  videoModel: r.video_model,
  videoResolution: r.video_resolution ?? null,
  status: r.status,
  step: r.step,
  coverAssetId: r.cover_asset_id,
  editor: { ...DEFAULT_EDITOR, ...JSON.parse(r.editor_json || '{}') },
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toEpisode = (r: Row): Episode => ({
  id: r.id,
  projectId: r.project_id,
  episodeNum: r.episode_num,
  title: r.title,
  summary: r.summary,
  hook: r.hook,
  storyBeats: JSON.parse(r.story_beats_json || '[]'),
  cliffhanger: r.cliffhanger,
  nextTeaser: r.next_teaser,
  sourceText: r.source_text ?? '',
  sourceKind: r.source_kind ?? null,
  scriptDraft: r.script_draft_json ? JSON.parse(r.script_draft_json) : null,
  status: r.status,
  durationSec: r.duration_sec,
  sort: r.sort,
  editor: r.editor_json ? JSON.parse(r.editor_json) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toCharacter = (r: Row): Character => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  sheetAssetId: r.sheet_asset_id,
  sort: r.sort,
  ttsVoice: r.tts_voice ?? null,
  ttsProvider: r.tts_provider ?? null,
  voiceStyle: r.voice_style ?? '',
  aliases: JSON.parse(r.aliases_json || '[]')
})

const toCharacterDerivative = (r: Row): CharacterDerivative => ({
  id: r.id,
  projectId: r.project_id,
  characterId: r.character_id,
  name: r.name,
  promptChange: r.prompt_change,
  sheetAssetId: r.sheet_asset_id ?? null,
  sort: r.sort
})

const toLocation = (r: Row): Location => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  aliases: JSON.parse(r.aliases_json || '[]'),
  sheetAssetId: r.sheet_asset_id ?? null,
  sort: r.sort
})

const toProp = (r: Row): Prop => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  aliases: JSON.parse(r.aliases_json || '[]'),
  sheetAssetId: r.sheet_asset_id ?? null,
  sort: r.sort
})

const toClip = (r: Row): Clip => ({
  id: r.id,
  projectId: r.project_id,
  episodeId: r.episode_id,
  sort: r.sort,
  title: r.title,
  story: r.story ?? '',
  visualPrompt: r.visual_prompt,
  visualSource: r.visual_source ?? null,
  narration: r.narration,
  durationMs: r.duration_ms,
  characterIds: JSON.parse(r.character_ids || '[]'),
  motionType: r.motion_type,
  cameraPreset: r.camera_preset,
  motionStrength: r.motion_strength,
  videoPrompt: r.video_prompt,
  transition: r.transition,
  videoCamera: r.video_camera ?? 'static',
  videoStrength: r.video_strength ?? 'halus',
  transitionMs: r.transition_ms ?? null,
  voiceGainDb: r.voice_gain_db ?? 0,
  mediaInMs: r.media_in_ms ?? 0,
  voiceInMs: r.voice_in_ms ?? 0,
  voiceOutMs: r.voice_out_ms ?? null,
  voiceStartMs: r.voice_start_ms ?? 0,
  speakerId: r.speaker_id ?? null,
  filter: r.filter || 'normal',
  imageAssetId: r.image_asset_id,
  videoAssetId: r.video_asset_id,
  audioAssetId: r.audio_asset_id,
  emotion: r.emotion ?? '',
  costumeIds: JSON.parse(r.costume_ids || '{}'),
  locationId: r.location_id ?? null,
  propIds: JSON.parse(r.prop_ids || '[]'),
  framing: r.framing ?? '',
  sourceExcerpt: r.source_excerpt ?? ''
})

export const toAsset = (r: Row): Asset => ({
  id: r.id,
  projectId: r.project_id,
  clipId: r.clip_id,
  characterId: r.character_id,
  derivativeId: r.derivative_id ?? null,
  locationId: r.location_id ?? null,
  propId: r.prop_id ?? null,
  episodeId: r.episode_id ?? null,
  kind: r.kind,
  provider: r.provider,
  model: r.model,
  prompt: r.prompt,
  remoteId: r.remote_id,
  remoteUrl: r.remote_url,
  localPath: r.local_path,
  url: assetUrl(r.project_id, r.local_path),
  durationMs: r.duration_ms,
  width: r.width,
  height: r.height,
  meta: JSON.parse(r.meta_json || '{}'),
  createdAt: r.created_at
})

export const toJob = (r: Row): Job => ({
  id: r.id,
  projectId: r.project_id,
  episodeId: r.episode_id ?? null,
  clipId: r.clip_id,
  characterId: r.character_id,
  kind: r.kind,
  provider: r.provider,
  status: r.status,
  progress: r.progress,
  message: r.message,
  error: r.error,
  resultAssetId: r.result_asset_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

// ---------- episodes ----------

export function listEpisodes(projectId: string): Episode[] {
  return (getDb().prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY sort ASC').all(projectId) as Row[]).map(toEpisode)
}

export function getEpisode(id: string): Episode {
  const r = getDb().prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Episode tidak ditemukan')
  return toEpisode(r)
}

export function createEpisode(projectId: string, input?: Partial<Episode>): Episode {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  const nextNum = (db.prepare('SELECT COALESCE(MAX(episode_num), 0) + 1 AS n FROM episodes WHERE project_id = ?').get(projectId) as Row).n as number
  const nextSort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM episodes WHERE project_id = ?').get(projectId) as Row).s as number
  const title = input?.title?.trim() || `Episode ${nextNum}`
  db.prepare(
    `INSERT INTO episodes (id, project_id, episode_num, title, summary, hook, story_beats_json, cliffhanger, next_teaser,
       source_text, source_kind, script_draft_json, status, duration_sec, sort, editor_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    nextNum,
    title,
    input?.summary ?? '',
    input?.hook ?? '',
    JSON.stringify(input?.storyBeats ?? []),
    input?.cliffhanger ?? '',
    input?.nextTeaser ?? '',
    input?.sourceText ?? '',
    input?.sourceKind ?? null,
    null,
    input?.status ?? 'draft',
    input?.durationSec ?? 75,
    nextSort,
    input?.editor ? JSON.stringify(input.editor) : null,
    now,
    now
  )
  return getEpisode(id)
}

export function updateEpisode(id: string, patch: Partial<Episode>): Episode {
  const entries: [string, unknown][] = []
  if (patch.title !== undefined) entries.push(['title', patch.title])
  if (patch.summary !== undefined) entries.push(['summary', patch.summary])
  if (patch.hook !== undefined) entries.push(['hook', patch.hook])
  if (patch.storyBeats !== undefined) entries.push(['story_beats_json', JSON.stringify(patch.storyBeats)])
  if (patch.cliffhanger !== undefined) entries.push(['cliffhanger', patch.cliffhanger])
  if (patch.nextTeaser !== undefined) entries.push(['next_teaser', patch.nextTeaser])
  if (patch.sourceText !== undefined) entries.push(['source_text', patch.sourceText])
  if (patch.sourceKind !== undefined) entries.push(['source_kind', patch.sourceKind])
  if (patch.scriptDraft !== undefined) entries.push(['script_draft_json', patch.scriptDraft ? JSON.stringify(patch.scriptDraft) : null])
  if (patch.status !== undefined) entries.push(['status', patch.status])
  if (patch.durationSec !== undefined) entries.push(['duration_sec', patch.durationSec])
  if (patch.sort !== undefined) entries.push(['sort', patch.sort])
  if (patch.editor !== undefined) entries.push(['editor_json', patch.editor ? JSON.stringify(patch.editor) : null])
  if (!entries.length) return getEpisode(id)
  entries.push(['updated_at', Date.now()])
  const sets = entries.map(([col]) => `${col} = ?`).join(', ')
  getDb().prepare(`UPDATE episodes SET ${sets} WHERE id = ?`).run(...entries.map(([, val]) => val), id)
  return getEpisode(id)
}

export function removeEpisode(id: string): void {
  getDb().prepare('DELETE FROM episodes WHERE id = ?').run(id)
}

export function reorderEpisodes(projectId: string, episodeIds: string[]): Episode[] {
  const db = getDb()
  db.transaction(() => {
    const stmt = db.prepare('UPDATE episodes SET sort = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    const now = Date.now()
    episodeIds.forEach((id, sort) => stmt.run(sort, now, id, projectId))
  })()
  return listEpisodes(projectId)
}

function getStoredSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row ? JSON.parse(row.value) : null
}

function setStoredSetting(key: string, value: string): void {
  getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}

/** How far into the series source the episode planner got, so an interrupted run can pick up where it stopped. */
export interface PlanProgress {
  /** Characters of the source already turned into episodes. */
  coveredChars: number
  /** Hash of source.slice(0, coveredChars): continuing is only safe if that part is unchanged. */
  coveredHash: string
}

export function getPlanProgress(projectId: string): PlanProgress | null {
  const raw = getStoredSetting(`plan_progress:${projectId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PlanProgress
  } catch {
    return null
  }
}

export function setPlanProgress(projectId: string, progress: PlanProgress | null): void {
  if (progress) setStoredSetting(`plan_progress:${projectId}`, JSON.stringify(progress))
  else getDb().prepare('DELETE FROM settings WHERE key = ?').run(`plan_progress:${projectId}`)
}

/** Clears episodes before a fresh plan. Episodes that already have clips are never thrown away silently. */
export function clearEpisodesForReplan(projectId: string): void {
  const db = getDb()
  const withClips = db
    .prepare(
      `SELECT e.episode_num AS n FROM episodes e
       WHERE e.project_id = ? AND EXISTS (SELECT 1 FROM clips c WHERE c.episode_id = e.id)
       ORDER BY e.sort`
    )
    .all(projectId) as { n: number }[]
  if (withClips.length) {
    throw new Error(
      `Episode ${withClips.map((r) => r.n).join(', ')} sudah punya klip. Hapus episode itu dulu, atau pakai "Lanjutkan perencanaan" untuk menambah episode di belakang.`
    )
  }
  db.transaction(() => {
    db.prepare('DELETE FROM episodes WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM settings WHERE key = ?').run(`plan_progress:${projectId}`)
  })()
}

// ---------- projects ----------

export function listProjects(): ProjectSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM clips c WHERE c.project_id = p.id) AS clip_count,
        (SELECT COALESCE(SUM(duration_ms), 0) FROM clips c WHERE c.project_id = p.id) AS total_ms,
        (SELECT a.local_path FROM assets a WHERE a.id = p.cover_asset_id) AS cover_path,
        (SELECT COUNT(*) FROM episodes ep WHERE ep.project_id = p.id) AS episode_count,
        (SELECT COUNT(*) FROM episodes ep WHERE ep.project_id = p.id AND ep.status = 'exported') AS exported_count
       FROM projects p ORDER BY p.updated_at DESC`
    )
    .all() as Row[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    styleId: r.style_id,
    status: r.status,
    step: r.step,
    clipCount: r.clip_count,
    totalMs: r.total_ms,
    coverUrl: r.cover_path ? assetUrl(r.id, r.cover_path) : null,
    updatedAt: r.updated_at,
    aspectRatio: r.aspect_ratio ?? '9:16',
    episodeCount: Math.max(1, r.episode_count ?? 1),
    exportedCount: r.exported_count ?? 0
  }))
}

export function createProject(input: NewProjectInput): Project {
  const s = getSettings()
  const now = Date.now()
  const id = randomUUID()
  const tts = input.ttsProvider ?? s.defaultTtsProvider
  const aspect = input.aspectRatio ?? '9:16'
  const dialogAudio = input.dialogAudio ?? 'video'
  const imgModel = input.imageModel ?? (s.defaultVisualProvider === 'flow2api' ? s.flow2apiImageModel : s.imageModel)
  const vidModel = input.videoModel ?? (s.defaultVisualProvider === 'flow2api' ? s.flow2apiVideoModel : s.videoModel)

  const db = getDb()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, title, synopsis, duration_sec, language, aspect_ratio, style_id, tts_provider, tts_voice,
        image_model, video_model, status, step, editor_json, source_text, source_kind, dialog_audio, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, '', 'novel', ?, ?, ?)`
    ).run(
      id,
      input.title?.trim() || 'Serial Baru',
      input.synopsis ?? '',
      input.durationSec ?? 60,
      input.language ?? s.defaultLanguage,
      aspect,
      input.styleId ?? 'premium_drama',
      tts,
      tts === 'gemini' ? 'Charon' : '',
      imgModel,
      vidModel,
      JSON.stringify(DEFAULT_EDITOR),
      dialogAudio,
      now,
      now
    )
    const epId = randomUUID()
    db.prepare(
      `INSERT INTO episodes (id, project_id, episode_num, title, summary, status, duration_sec, sort, editor_json, created_at, updated_at)
       VALUES (?, ?, 1, 'Episode 1', '', 'draft', ?, 0, NULL, ?, ?)`
    ).run(epId, id, input.durationSec ?? 60, now, now)
    setStoredSetting(`last_episode:${id}`, epId)
  })()
  projectDir(id)
  return getProject(id)
}

export function getProject(id: string): Project {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Proyek tidak ditemukan')
  return toProject(r)
}

export function getBundle(id: string, episodeId?: string): ProjectBundle {
  const db = getDb()
  const project = getProject(id)
  const episodes = listEpisodes(id)
  let activeEpisode: Episode | undefined
  if (episodeId) {
    activeEpisode = episodes.find((e) => e.id === episodeId)
  }
  if (!activeEpisode) {
    const lastId = getStoredSetting(`last_episode:${id}`)
    if (lastId) activeEpisode = episodes.find((e) => e.id === lastId)
  }
  if (!activeEpisode) {
    activeEpisode = episodes[0]
  }
  if (!activeEpisode) {
    activeEpisode = createEpisode(id, { title: 'Episode 1' })
  }
  setStoredSetting(`last_episode:${id}`, activeEpisode.id)

  return {
    // Preview and export both read project.editor, so it carries the active episode's timeline settings.
    project: { ...project, editor: editorOf(project, activeEpisode) },
    episode: activeEpisode,
    episodes,
    characters: charactersOf(id),
    derivatives: (db.prepare('SELECT * FROM character_derivatives WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toCharacterDerivative),
    locations: (db.prepare('SELECT * FROM locations WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toLocation),
    props: (db.prepare('SELECT * FROM props WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toProp),
    clips: clipsOf(id, activeEpisode.id),
    assets: (db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(id) as Row[]).map(toAsset),
    jobs: (
      db
        .prepare("SELECT * FROM jobs WHERE project_id = ? AND (status IN ('queued','running') OR updated_at > ?) ORDER BY created_at")
        .all(id, Date.now() - 10 * 60 * 1000) as Row[]
    ).map(toJob)
  }
}

export function touchProject(id: string, patch: Partial<Pick<Project, 'status' | 'step' | 'coverAssetId' | 'title'>> = {}): void {
  const sets: string[] = ['updated_at = @now']
  if (patch.status) sets.push('status = @status')
  if (patch.step) sets.push('step = @step')
  if (patch.coverAssetId !== undefined) sets.push('cover_asset_id = @coverAssetId')
  if (patch.title) sets.push('title = @title')
  getDb()
    .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`)
    .run({ ...patch, id, now: Date.now() })
}

/** Lets the script step keep a brief it had to create for plans saved before briefs existed. */
export function setStoryPlan(id: string, plan: StoryPlan): void {
  getDb().prepare('UPDATE projects SET story_plan_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(plan), Date.now(), id)
}

/** Saves the editable parts of a project. Asset links stay owned by the main process. */
export function saveSnapshot(snap: ProjectSnapshot): number {
  const db = getDb()
  const now = Date.now()
  const p = snap.project
  const epId = snap.episodeId
  db.transaction(() => {
    db.prepare(
      `UPDATE projects SET title = @title, synopsis = @synopsis, story_plan_json = @storyPlan, duration_sec = @durationSec, language = @language,
        aspect_ratio = @aspectRatio, style_id = @styleId, tts_provider = @ttsProvider, tts_voice = @ttsVoice,
        image_model = @imageModel, video_model = @videoModel, video_resolution = @videoResolution, status = @status, step = @step, editor_json = @editor,
        source_text = @sourceText, source_kind = @sourceKind, dialog_audio = @dialogAudio, updated_at = @now
       WHERE id = @id`
    ).run({
      ...p,
      storyPlan: p.storyPlan ? JSON.stringify(p.storyPlan) : null,
      editor: JSON.stringify(p.editor),
      sourceText: p.sourceText ?? '',
      sourceKind: p.sourceKind ?? 'novel',
      dialogAudio: p.dialogAudio ?? 'video',
      now
    })

    if (epId) {
      const epEditor = snap.episodeEditor ?? p.editor
      db.prepare('UPDATE episodes SET editor_json = ?, updated_at = ? WHERE id = ? AND project_id = ?')
        .run(JSON.stringify(epEditor), now, epId, p.id)
    }

    const charIds = snap.characters.map((c) => c.id)
    db.prepare(
      `DELETE FROM characters WHERE project_id = ? AND id NOT IN (${charIds.map(() => '?').join(',') || "''"})`
    ).run(p.id, ...charIds)
    const upChar = db.prepare(
      `INSERT INTO characters (id, project_id, name, description, sort, tts_voice, tts_provider, voice_style, aliases_json)
       VALUES (@id, @projectId, @name, @description, @sort, @ttsVoice, @ttsProvider, @voiceStyle, @aliasesJson)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, sort = excluded.sort,
         tts_voice = excluded.tts_voice, tts_provider = excluded.tts_provider, voice_style = excluded.voice_style, aliases_json = excluded.aliases_json`
    )
    for (const c of snap.characters) {
      upChar.run({
        ...c,
        projectId: p.id,
        ttsVoice: c.ttsVoice ?? null,
        ttsProvider: c.ttsProvider ?? null,
        voiceStyle: c.voiceStyle ?? '',
        aliasesJson: JSON.stringify(c.aliases ?? [])
      })
    }

    const clipIds = snap.clips.map((c) => c.id)
    if (epId) {
      db.prepare(`DELETE FROM clips WHERE project_id = ? AND episode_id = ? AND id NOT IN (${clipIds.map(() => '?').join(',') || "''"})`).run(
        p.id,
        epId,
        ...clipIds
      )
    } else {
      db.prepare(`DELETE FROM clips WHERE project_id = ? AND id NOT IN (${clipIds.map(() => '?').join(',') || "''"})`).run(
        p.id,
        ...clipIds
      )
    }
    const upClip = db.prepare(
      `INSERT INTO clips (id, project_id, episode_id, sort, title, story, visual_prompt, narration, duration_ms, character_ids, motion_type,
         camera_preset, motion_strength, video_prompt, transition, video_camera, video_strength, transition_ms, voice_gain_db,
         media_in_ms, voice_in_ms, voice_out_ms, voice_start_ms, filter, speaker_id, emotion, costume_ids, location_id, prop_ids, framing, source_excerpt)
       VALUES (@id, @projectId, @episodeId, @sort, @title, @story, @visualPrompt, @narration, @durationMs, @characterIds, @motionType,
         @cameraPreset, @motionStrength, @videoPrompt, @transition, @videoCamera, @videoStrength, @transitionMs, @voiceGainDb,
         @mediaInMs, @voiceInMs, @voiceOutMs, @voiceStartMs, @filter, @speakerId, @emotion, @costumeIds, @locationId, @propIds, @framing, @sourceExcerpt)
       ON CONFLICT(id) DO UPDATE SET episode_id = excluded.episode_id, sort = excluded.sort, title = excluded.title, story = excluded.story, visual_prompt = excluded.visual_prompt,
         narration = excluded.narration, duration_ms = excluded.duration_ms, character_ids = excluded.character_ids,
         motion_type = excluded.motion_type, camera_preset = excluded.camera_preset, motion_strength = excluded.motion_strength,
         video_prompt = excluded.video_prompt, transition = excluded.transition, video_camera = excluded.video_camera,
         video_strength = excluded.video_strength, transition_ms = excluded.transition_ms, voice_gain_db = excluded.voice_gain_db,
         media_in_ms = excluded.media_in_ms, voice_in_ms = excluded.voice_in_ms, voice_out_ms = excluded.voice_out_ms,
         voice_start_ms = excluded.voice_start_ms, filter = excluded.filter, speaker_id = excluded.speaker_id,
         emotion = excluded.emotion, costume_ids = excluded.costume_ids, location_id = excluded.location_id, prop_ids = excluded.prop_ids,
         framing = excluded.framing, source_excerpt = excluded.source_excerpt`
    )
    for (const c of snap.clips)
      upClip.run({
        ...c,
        projectId: p.id,
        episodeId: c.episodeId || epId,
        characterIds: JSON.stringify(c.characterIds || []),
        videoCamera: c.videoCamera ?? 'static',
        videoStrength: c.videoStrength ?? 'halus',
        transitionMs: c.transitionMs ?? null,
        voiceGainDb: c.voiceGainDb ?? 0,
        mediaInMs: Math.round(c.mediaInMs ?? 0),
        voiceInMs: Math.round(c.voiceInMs ?? 0),
        voiceOutMs: c.voiceOutMs == null ? null : Math.round(c.voiceOutMs),
        voiceStartMs: Math.round(c.voiceStartMs ?? 0),
        filter: c.filter ?? 'normal',
        speakerId: c.speakerId ?? null,
        emotion: c.emotion ?? '',
        costumeIds: JSON.stringify(c.costumeIds || {}),
        locationId: c.locationId ?? null,
        propIds: JSON.stringify(c.propIds || []),
        framing: c.framing ?? '',
        sourceExcerpt: c.sourceExcerpt ?? ''
      })
  })()
  return now
}

export function removeProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  const dir = join(projectsRoot(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function duplicateProject(id: string): ProjectSummary {
  const db = getDb()
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  if (!p) throw new Error('Proyek tidak ditemukan')
  const newId = randomUUID()
  const now = Date.now()
  const idMap = new Map<string, string>()
  const mapId = (old: string | null | undefined): string | null => {
    if (!old) return null
    if (!idMap.has(old)) idMap.set(old, randomUUID())
    return idMap.get(old)!
  }

  const allEpisodes = listEpisodes(id)
  const allCharacters = charactersOf(id)
  const allClips = (db.prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toClip)
  const allAssets = (db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(id) as Row[]).map(toAsset)
  const allDerivatives = (db.prepare('SELECT * FROM character_derivatives WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toCharacterDerivative)
  const allLocations = (db.prepare('SELECT * FROM locations WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toLocation)
  const allProps = (db.prepare('SELECT * FROM props WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toProp)

  const copyEditor = (editor: EditorSettings | null): EditorSettings | null => {
    if (!editor) return null
    return {
      ...editor,
      musicAssetId: mapId(editor.musicAssetId),
      overlays: (editor.overlays || []).map((overlay) => overlay.kind === 'image'
        ? { ...overlay, assetId: mapId(overlay.assetId)! }
        : overlay),
      sfx: editor.sfx?.map((sfx) => ({ ...sfx, assetId: mapId(sfx.assetId)! })),
      clipFraming: editor.clipFraming
        ? Object.fromEntries(Object.entries(editor.clipFraming).map(([clipId, framing]) => [mapId(clipId)!, framing]))
        : undefined
    }
  }

  db.transaction(() => {
    const projectEditor = copyEditor({ ...DEFAULT_EDITOR, ...JSON.parse(p.editor_json || '{}') })
    db.prepare(
      `INSERT INTO projects (id, title, synopsis, story_plan_json, duration_sec, language, aspect_ratio, style_id, tts_provider, tts_voice,
         image_model, video_model, video_resolution, status, step, cover_asset_id, editor_json, source_text, source_kind, dialog_audio, created_at, updated_at)
       SELECT @newId, @title, synopsis, story_plan_json, duration_sec, language, aspect_ratio, style_id, tts_provider, tts_voice,
         image_model, video_model, video_resolution, status, step, @cover, @editorJson, source_text, source_kind, dialog_audio, @now, @now
       FROM projects WHERE id = @id`
    ).run({
      newId,
      id,
      title: `${p.title} (salinan)`,
      cover: mapId(p.cover_asset_id),
      editorJson: JSON.stringify(projectEditor),
      now
    })

    for (const ep of allEpisodes) {
      db.prepare(
        `INSERT INTO episodes (id, project_id, episode_num, title, summary, hook, story_beats_json, cliffhanger, next_teaser,
           source_text, source_kind, script_draft_json, status, duration_sec, sort, editor_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(ep.id),
        newId,
        ep.episodeNum,
        ep.title,
        ep.summary,
        ep.hook,
        JSON.stringify(ep.storyBeats || []),
        ep.cliffhanger,
        ep.nextTeaser,
        ep.sourceText,
        ep.sourceKind,
        null,
        ep.status,
        ep.durationSec,
        ep.sort,
        ep.editor ? JSON.stringify(copyEditor(ep.editor)) : null,
        now,
        now
      )
    }

    for (const c of allCharacters) {
      db.prepare(
        `INSERT INTO characters (id, project_id, name, description, sheet_asset_id, sort, tts_voice, tts_provider, voice_style, aliases_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(c.id),
        newId,
        c.name,
        c.description,
        mapId(c.sheetAssetId),
        c.sort,
        c.ttsVoice ?? null,
        c.ttsProvider ?? null,
        c.voiceStyle ?? '',
        JSON.stringify(c.aliases || [])
      )
    }

    for (const d of allDerivatives) {
      db.prepare(
        `INSERT INTO character_derivatives (id, project_id, character_id, name, prompt_change, sheet_asset_id, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(d.id),
        newId,
        mapId(d.characterId),
        d.name,
        d.promptChange,
        mapId(d.sheetAssetId),
        d.sort
      )
    }

    for (const l of allLocations) {
      db.prepare(
        `INSERT INTO locations (id, project_id, name, description, aliases_json, sheet_asset_id, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(l.id),
        newId,
        l.name,
        l.description,
        JSON.stringify(l.aliases || []),
        mapId(l.sheetAssetId),
        l.sort
      )
    }

    for (const pr of allProps) {
      db.prepare(
        `INSERT INTO props (id, project_id, name, description, aliases_json, sheet_asset_id, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(pr.id),
        newId,
        pr.name,
        pr.description,
        JSON.stringify(pr.aliases || []),
        mapId(pr.sheetAssetId),
        pr.sort
      )
    }

    for (const a of allAssets) {
      db.prepare(
        `INSERT INTO assets (id, project_id, clip_id, character_id, derivative_id, location_id, prop_id, episode_id, kind, provider, model, prompt, remote_id, remote_url, local_path,
           duration_ms, width, height, meta_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(a.id),
        newId,
        mapId(a.clipId),
        mapId(a.characterId),
        mapId(a.derivativeId),
        mapId(a.locationId),
        mapId(a.propId),
        mapId(a.episodeId),
        a.kind,
        a.provider,
        a.model,
        a.prompt,
        a.remoteId,
        a.remoteUrl,
        a.localPath,
        a.durationMs,
        a.width,
        a.height,
        JSON.stringify(a.meta),
        a.createdAt
      )
    }

    for (const c of allClips) {
      const mappedCostumes: Record<string, string> = {}
      for (const [charId, derivId] of Object.entries(c.costumeIds || {})) {
        const mc = mapId(charId)
        const md = mapId(derivId)
        if (mc && md) mappedCostumes[mc] = md
      }
      db.prepare(
        `INSERT INTO clips (id, project_id, episode_id, sort, title, story, visual_prompt, visual_source, narration, duration_ms, character_ids,
           motion_type, camera_preset, motion_strength, video_prompt, transition, image_asset_id, video_asset_id, audio_asset_id,
           video_camera, video_strength, transition_ms, voice_gain_db, media_in_ms, voice_in_ms, voice_out_ms, voice_start_ms, filter, speaker_id,
           emotion, costume_ids, location_id, prop_ids, framing, source_excerpt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(c.id),
        newId,
        mapId(c.episodeId),
        c.sort,
        c.title,
        c.story,
        c.visualPrompt,
        c.visualSource,
        c.narration,
        c.durationMs,
        JSON.stringify(c.characterIds.map((x) => mapId(x))),
        c.motionType,
        c.cameraPreset,
        c.motionStrength,
        c.videoPrompt,
        c.transition,
        mapId(c.imageAssetId),
        mapId(c.videoAssetId),
        mapId(c.audioAssetId),
        c.videoCamera,
        c.videoStrength,
        c.transitionMs,
        c.voiceGainDb,
        c.mediaInMs,
        c.voiceInMs,
        c.voiceOutMs,
        c.voiceStartMs,
        c.filter ?? 'normal',
        mapId(c.speakerId),
        c.emotion ?? '',
        JSON.stringify(mappedCostumes),
        mapId(c.locationId),
        JSON.stringify((c.propIds || []).map((x) => mapId(x)).filter(Boolean)),
        c.framing ?? '',
        c.sourceExcerpt ?? ''
      )
    }
  })()
  const srcDir = join(projectsRoot(), id)
  if (existsSync(srcDir)) cpSync(srcDir, projectDir(newId), { recursive: true })
  return listProjects().find((pr) => pr.id === newId)!
}

// ---------- story ----------

export type StoryClip = Omit<
  Clip,
  | 'id'
  | 'projectId'
  | 'episodeId'
  | 'sort'
  | 'imageAssetId'
  | 'videoAssetId'
  | 'audioAssetId'
  | 'characterIds'
  | 'visualSource'
  | 'videoCamera'
  | 'videoStrength'
  | 'transitionMs'
  | 'voiceGainDb'
  | 'mediaInMs'
  | 'voiceInMs'
  | 'voiceOutMs'
  | 'voiceStartMs'
  | 'speakerId'
  | 'filter'
  | 'emotion'
  | 'costumeIds'
  | 'locationId'
  | 'propIds'
  | 'framing'
  | 'sourceExcerpt'
> & {
  characterNames: string[]
  filter?: FilterId
  emotion?: string
  costumeIds?: Record<string, string>
  locationId?: string | null
  propIds?: string[]
  framing?: string
  sourceExcerpt?: string
}

/** A complete storyboard in one go (script and visuals); used by the development harness. */
export function replaceStory(
  projectId: string,
  title: string,
  characters: { name: string; description: string }[],
  clips: StoryClip[],
  episodeId?: string
): void {
  const db = getDb()
  const epId = episodeId || listEpisodes(projectId)[0]?.id
  if (!epId) throw new Error('Episode tidak ditemukan')
  db.transaction(() => {
    db.prepare('DELETE FROM clips WHERE project_id = ? AND episode_id = ?').run(projectId, epId)
    const existingChars = charactersOf(projectId)
    const byName = new Map<string, string>()
    for (const c of existingChars) {
      byName.set(c.name.trim().toLowerCase(), c.id)
    }
    let sort = existingChars.length
    for (const c of characters) {
      const key = c.name.trim().toLowerCase()
      if (!byName.has(key)) {
        const id = randomUUID()
        byName.set(key, id)
        db.prepare('INSERT INTO characters (id, project_id, name, description, sort) VALUES (?, ?, ?, ?, ?)').run(
          id,
          projectId,
          c.name,
          c.description,
          sort++
        )
      }
    }
    clips.forEach((c, i) => {
      const ids = c.characterNames.map((n) => byName.get(n.trim().toLowerCase())).filter((x): x is string => !!x)
      db.prepare(
        `INSERT INTO clips (id, project_id, episode_id, sort, title, story, visual_prompt, visual_source, narration, duration_ms, character_ids,
           motion_type, camera_preset, motion_strength, video_prompt, transition, emotion, costume_ids, location_id, prop_ids, framing, source_excerpt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        projectId,
        epId,
        i,
        c.title,
        c.story,
        c.visualPrompt,
        visualSourceOf(c),
        c.narration,
        c.durationMs,
        JSON.stringify(ids),
        c.motionType,
        c.cameraPreset,
        c.motionStrength,
        c.videoPrompt,
        c.transition,
        c.emotion ?? '',
        JSON.stringify(c.costumeIds ?? {}),
        c.locationId ?? null,
        JSON.stringify(c.propIds ?? []),
        c.framing ?? '',
        c.sourceExcerpt ?? ''
      )
    })
    db.prepare("UPDATE episodes SET title = ?, status = 'storyboard', updated_at = ? WHERE id = ?").run(
      title,
      Date.now(),
      epId
    )
    const epCount = listEpisodes(projectId).length
    if (epCount <= 1) {
      db.prepare("UPDATE projects SET title = ?, status = 'storyboard', step = 3, updated_at = ? WHERE id = ?").run(
        title,
        Date.now(),
        projectId
      )
    } else {
      db.prepare("UPDATE projects SET status = 'storyboard', step = 3, updated_at = ? WHERE id = ?").run(
        Date.now(),
        projectId
      )
    }
  })()
}

export interface ScriptScene {
  title: string
  story: string
  narration: string
  durationMs: number
  speaker?: string | null
  gender?: 'female' | 'male' | 'unknown' | null
}

type Gender = 'female' | 'male' | 'unknown'

const GENDER_LABEL: Record<Gender, string> = { female: 'Perempuan', male: 'Laki-laki', unknown: 'Tokoh' }

// Speakers found in the script get this stand-in description until the visual step writes a real look.
const SPEAKER_PLACEHOLDER = /^Tokoh \((Perempuan|Laki-laki|Tokoh)\): /

function speakerPlaceholder(name: string, gender: Gender): string {
  return `Tokoh (${GENDER_LABEL[gender]}): ${name}`
}

function placeholderGender(description: string): Gender | null {
  const m = SPEAKER_PLACEHOLDER.exec(description)
  if (!m) return null
  return m[1] === 'Perempuan' ? 'female' : m[1] === 'Laki-laki' ? 'male' : 'unknown'
}

/**
 * Hands out distinct voices to auto-cast speakers, preferring ones no other character or the narrator uses.
 * Only Gemini has a fixed voice library; ElevenLabs voice IDs belong to the user's account, so other
 * providers get null and the speaker follows the narrator until the creator picks a voice.
 */
function voiceCaster(projectId: string): (gender: Gender) => { voice: string | null; provider: string | null } {
  const db = getDb()
  const proj = db.prepare('SELECT tts_voice, tts_provider FROM projects WHERE id = ?').get(projectId) as Row | undefined
  const provider = (proj?.tts_provider as string | undefined) || 'gemini'
  if (provider !== 'gemini') return () => ({ voice: null, provider: null })
  const used = new Set<string>([
    String(proj?.tts_voice || 'Charon'),
    ...(db.prepare("SELECT tts_voice FROM characters WHERE project_id = ? AND tts_voice IS NOT NULL AND tts_provider = 'gemini'").all(projectId) as Row[]).map(
      (r) => String(r.tts_voice)
    )
  ])
  let lastUnknown: 'female' | 'male' = 'male'
  return (gender) => {
    // Unknown speakers alternate so two of them in a row do not share a voice family.
    const g = gender === 'unknown' ? (lastUnknown = lastUnknown === 'male' ? 'female' : 'male') : gender
    const pool = g === 'female' ? FEMALE_GEMINI_VOICES : MALE_GEMINI_VOICES
    const voice = pool.find((v) => !used.has(v)) ?? pool.find((v) => v !== proj?.tts_voice) ?? pool[0]
    used.add(voice)
    return { voice, provider }
  }
}

function insertSpeaker(projectId: string, name: string, gender: Gender, cast: ReturnType<typeof voiceCaster>): string {
  const db = getDb()
  const id = randomUUID()
  const sort = (db.prepare('SELECT COUNT(*) AS n FROM characters WHERE project_id = ?').get(projectId) as Row).n as number
  const { voice, provider } = cast(gender)
  db.prepare('INSERT INTO characters (id, project_id, name, description, sort, tts_voice, tts_provider) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    projectId,
    name,
    speakerPlaceholder(name, gender),
    sort,
    voice,
    provider
  )
  return id
}

/**
 * Finds the character with this name or adds one as a speaker. Returns the new character when one was
 * created, so the renderer can add it before its next save (a save drops characters it does not know).
 */
export function ensureSpeaker(projectId: string, name: string, gender: Gender): { id: string; created: Character | null } {
  const key = name.trim().toLowerCase()
  const match = charactersOf(projectId).find((c) => c.name.trim().toLowerCase() === key)
  if (match) return { id: match.id, created: null }
  const gen = gender !== 'unknown' ? gender : detectGender(name)
  const id = insertSpeaker(projectId, name.trim(), gen, voiceCaster(projectId))
  return { id, created: charactersOf(projectId).find((c) => c.id === id) ?? null }
}

/**
 * Replaces all scenes with a freshly written script. Characters stay: the visual step reuses the ones
 * whose names come back, so their character sheets survive a rewrite. Speakers new to the project are
 * added with a voice that fits their gender.
 */
export function replaceScript(projectId: string, title: string, scenes: ScriptScene[], episodeId?: string): void {
  const db = getDb()
  const epId = episodeId || listEpisodes(projectId)[0]?.id
  if (!epId) throw new Error('Episode tidak ditemukan')
  db.transaction(() => {
    const existing = db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(projectId) as Row[]
    const byName = new Map<string, string>(existing.map((c) => [String(c.name).trim().toLowerCase(), c.id as string]))
    const cast = voiceCaster(projectId)

    for (const c of scenes) {
      const sp = (c.speaker || '').trim()
      const key = sp.toLowerCase()
      if (!sp || byName.has(key)) continue
      // Only the name is a safe hint here: the scene note may describe other people in the shot.
      const gen = c.gender && c.gender !== 'unknown' ? c.gender : detectGender(sp)
      byName.set(key, insertSpeaker(projectId, sp, gen, cast))
    }

    db.prepare('DELETE FROM clips WHERE project_id = ? AND episode_id = ?').run(projectId, epId)
    const insert = db.prepare(
      `INSERT INTO clips (id, project_id, episode_id, sort, title, story, narration, duration_ms, character_ids, speaker_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`
    )
    scenes.forEach((c, i) => {
      const sp = (c.speaker || '').trim().toLowerCase()
      const speakerId = sp ? (byName.get(sp) ?? null) : null
      insert.run(randomUUID(), projectId, epId, i, c.title, c.story, c.narration, c.durationMs, speakerId)
    })
    db.prepare("UPDATE episodes SET title = ?, status = 'script', updated_at = ? WHERE id = ?").run(title, Date.now(), epId)
    db.prepare("UPDATE projects SET title = ?, status = 'script', step = 2, updated_at = ? WHERE id = ?").run(title, Date.now(), projectId)
  })()
}

/**
 * Confirms an episode's script draft:
 * 1. Registers approved new assets in Lorebook.
 * 2. Rejects if any shots reference unmapped/unregistered character, location, or prop names.
 * 3. Deletes existing clips of the episode and inserts the newly planned shots with mapped IDs.
 * 4. Clears script_draft_json, updates episode status to 'script'.
 * 5. Returns the updated project bundle.
 */
export function confirmEpisodeScriptRepo(projectId: string, episodeId: string, draft: EpisodeScriptDraft): ProjectBundle {
  const db = getDb()
  const ep = getEpisode(episodeId)
  if (!ep || ep.projectId !== projectId) throw new Error('Episode tidak ditemukan.')

  db.transaction(() => {
    const problems: string[] = []
    // 1. Process proposed newAssets
    for (const p of draft.newAssets ?? []) {
      const pName = p.name.trim()
      if (!pName) continue
      const action = p.action || 'create'

      if (action === 'create') {
        if (p.kind === 'character') {
          const chars = charactersOf(projectId)
          if (!chars.some((c) => c.name.toLowerCase() === pName.toLowerCase())) {
            createCharacter({ projectId, name: pName, description: p.description || '' })
          }
        } else if (p.kind === 'derivative') {
          const targetChar = p.target
            ? charactersOf(projectId).find((c) => c.id === p.target || c.name.toLowerCase() === p.target!.trim().toLowerCase())
            : undefined
          // A variant without its character would end up on whoever happens to be first in the cast.
          if (!targetChar) problems.push(`Usulan kostum "${pName}" belum punya karakter tujuan yang terdaftar`)
          if (targetChar) {
            const derivs = derivativesOf(projectId).filter((d) => d.characterId === targetChar.id)
            if (!derivs.some((d) => d.name.toLowerCase() === pName.toLowerCase())) {
              createDerivative({ projectId, characterId: targetChar.id, name: pName, promptChange: p.description || '' })
            }
          }
        } else if (p.kind === 'location') {
          const locs = locationsOf(projectId)
          if (!locs.some((l) => l.name.toLowerCase() === pName.toLowerCase())) {
            createLocation({ projectId, name: pName, description: p.description || '' })
          }
        } else if (p.kind === 'prop') {
          const prs = propsOf(projectId)
          if (!prs.some((pr) => pr.name.toLowerCase() === pName.toLowerCase())) {
            createProp({ projectId, name: pName, description: p.description || '' })
          }
        }
      } else if (action === 'merge' && p.target) {
        if (p.kind === 'character') {
          const targetChar = charactersOf(projectId).find((c) => c.id === p.target || c.name.toLowerCase() === p.target!.toLowerCase())
          if (targetChar && !targetChar.aliases.some((a) => a.toLowerCase() === pName.toLowerCase())) {
            updateCharacter(targetChar.id, { aliases: [...targetChar.aliases, pName] })
          }
        } else if (p.kind === 'location') {
          const targetLoc = locationsOf(projectId).find((l) => l.id === p.target || l.name.toLowerCase() === p.target!.toLowerCase())
          if (targetLoc && !targetLoc.aliases.some((a) => a.toLowerCase() === pName.toLowerCase())) {
            updateLocation(targetLoc.id, { aliases: [...targetLoc.aliases, pName] })
          }
        } else if (p.kind === 'prop') {
          const targetProp = propsOf(projectId).find((pr) => pr.id === p.target || pr.name.toLowerCase() === p.target!.toLowerCase())
          if (targetProp && !targetProp.aliases.some((a) => a.toLowerCase() === pName.toLowerCase())) {
            updateProp(targetProp.id, { aliases: [...targetProp.aliases, pName] })
          }
        }
      } else if (action === 'derivative') {
        const targetChar = p.target
          ? charactersOf(projectId).find((c) => c.id === p.target || c.name.toLowerCase() === p.target!.trim().toLowerCase())
          : undefined
        if (!targetChar) problems.push(`Usulan kostum "${pName}" belum punya karakter tujuan yang terdaftar`)
        if (targetChar) {
          const derivs = derivativesOf(projectId).filter((d) => d.characterId === targetChar.id)
          if (!derivs.some((d) => d.name.toLowerCase() === pName.toLowerCase())) {
            createDerivative({ projectId, characterId: targetChar.id, name: pName, promptChange: p.description || '' })
          }
        }
      }
    }

    // 2. Validate all names referenced in draft.shots
    const allChars = charactersOf(projectId)
    const allLocs = locationsOf(projectId)
    const allProps = propsOf(projectId)

    const findChar = (name: string): Character | undefined => {
      const q = name.trim().toLowerCase()
      return allChars.find((c) => c.name.toLowerCase() === q || c.aliases.some((a) => a.toLowerCase() === q))
    }
    const findLoc = (name: string): Location | undefined => {
      const q = name.trim().toLowerCase()
      return allLocs.find((l) => l.name.toLowerCase() === q || l.aliases.some((a) => a.toLowerCase() === q))
    }
    const findProp = (name: string): Prop | undefined => {
      const q = name.trim().toLowerCase()
      return allProps.find((pr) => pr.name.toLowerCase() === q || pr.aliases.some((a) => a.toLowerCase() === q))
    }

    const findCostume = (charId: string, name: string): CharacterDerivative | undefined => {
      const q = name.trim().toLowerCase()
      return derivativesOf(projectId).find((d) => d.characterId === charId && d.name.toLowerCase() === q)
    }
    const speakerOf = (shot: DraftShot): string | null => (shot.speaker?.trim() && !isNarratorName(shot.speaker) ? shot.speaker.trim() : null)

    const unmapped: string[] = [...problems]
    for (const [i, shot] of (draft.shots ?? []).entries()) {
      const n = i + 1
      for (const c of shot.characters ?? []) {
        if (!findChar(c)) unmapped.push(`Shot ${n}: karakter "${c}" belum terdaftar`)
      }
      const speaker = speakerOf(shot)
      if (speaker && !findChar(speaker)) {
        unmapped.push(`Shot ${n}: pembicara "${speaker}" belum terdaftar`)
      }
      if (speaker && !(shot.characters ?? []).some((c) => findChar(c) && findChar(c)?.id === findChar(speaker)?.id)) {
        unmapped.push(`Shot ${n}: pembicara "${speaker}" harus terlihat di shot`)
      }
      for (const [charName, variant] of Object.entries(shot.costumes ?? {})) {
        if (isDefaultCostume(variant)) continue
        const ch = findChar(charName)
        if (!ch || !findCostume(ch.id, variant)) unmapped.push(`Shot ${n}: kostum "${variant}" untuk ${charName} belum terdaftar`)
      }
      if (shot.location && !findLoc(shot.location)) {
        unmapped.push(`Shot ${n}: lokasi "${shot.location}" belum terdaftar`)
      }
      for (const p of shot.props ?? []) {
        if (!findProp(p)) unmapped.push(`Shot ${n}: prop "${p}" belum terdaftar`)
      }
    }

    if (unmapped.length > 0) {
      throw new Error(`Rencana belum bisa dikonfirmasi karena ada aset yang belum terdaftar:\n${unmapped.slice(0, 10).join('\n')}${unmapped.length > 10 ? `\n...dan ${unmapped.length - 10} lainnya` : ''}`)
    }

    // 3. Delete existing clips of this episode
    db.prepare('DELETE FROM clips WHERE project_id = ? AND episode_id = ?').run(projectId, episodeId)

    // 4. Insert clips
    const insertClip = db.prepare(`
      INSERT INTO clips (
        id, project_id, episode_id, sort, title, visual_prompt, narration,
        duration_ms, character_ids, motion_type, camera_preset, motion_strength,
        video_prompt, transition, speaker_id, emotion, costume_ids, location_id,
        prop_ids, framing, source_excerpt, story
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `)

    for (const [idx, shot] of (draft.shots ?? []).entries()) {
      const clipId = randomUUID()
      const charIds = (shot.characters ?? []).map((cn) => findChar(cn)?.id).filter((id): id is string => !!id)
      const speaker = speakerOf(shot)
      const speakerId = speaker ? findChar(speaker)?.id ?? null : null
      const locId = shot.location ? findLoc(shot.location)?.id ?? null : null
      const propIds = (shot.props ?? []).map((pn) => findProp(pn)?.id).filter((id): id is string => !!id)

      const costumeMap: Record<string, string> = {}
      for (const [charName, varName] of Object.entries(shot.costumes ?? {})) {
        const c = findChar(charName)
        const deriv = c && !isDefaultCostume(varName) ? findCostume(c.id, varName) : undefined
        if (c && deriv) costumeMap[c.id] = deriv.id
      }

      const durMs = Math.max(1000, Math.round((shot.durationSec || 5) * 1000))

      insertClip.run(
        clipId,
        projectId,
        episodeId,
        idx,
        shot.title || `Shot ${idx + 1}`,
        '',
        shot.text || '',
        durMs,
        JSON.stringify(charIds),
        'camera',
        'zoomin',
        'sedang',
        '',
        'fade',
        speakerId,
        shot.emotion || '',
        JSON.stringify(costumeMap),
        locId,
        JSON.stringify(propIds),
        shot.framing || 'medium shot',
        shot.sourceExcerpt || '',
        shot.visualAction || ''
      )
    }

    // 5. Update episode
    db.prepare('UPDATE episodes SET script_draft_json = NULL, status = ?, updated_at = ? WHERE id = ?').run('script', Date.now(), episodeId)
    touchProject(projectId)
  })()

  return getBundle(projectId, episodeId)
}

export interface SceneVisual {
  clipId: string
  visualPrompt: string
  characterNames: string[]
  cameraPreset: Clip['cameraPreset']
  motionStrength: Clip['motionStrength']
  videoPrompt: string
  transition: Clip['transition']
}

/**
 * Stores a visual plan for some scenes. Characters are matched by name: known ones keep their look and
 * sheet, new ones are added. Each updated scene remembers the story it was planned from.
 */
export function applyVisuals(projectId: string, characters: { name: string; description: string }[], scenes: SceneVisual[]): void {
  const db = getDb()
  db.transaction(() => {
    const existing = db.prepare('SELECT id, name, description, tts_voice FROM characters WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]
    const byName = new Map<string, Row>(existing.map((c) => [String(c.name).trim().toLowerCase(), c]))
    const cast = voiceCaster(projectId)
    let sort = existing.length

    for (const c of characters) {
      const key = c.name.trim().toLowerCase()
      if (!key) continue
      const known = byName.get(key)
      if (known) {
        // A speaker the script step added still has a stand-in description: give it the planned look.
        // Voices the creator picked are never touched; only a voice cast without knowing the gender is corrected.
        const castAs = placeholderGender(String(known.description ?? ''))
        if (castAs === null || !c.description.trim()) continue
        db.prepare('UPDATE characters SET description = ? WHERE id = ?').run(c.description, known.id)
        const gen = detectGender(c.name, c.description)
        const voiceGen = known.tts_voice ? geminiVoiceGender(String(known.tts_voice)) : undefined
        if (castAs === 'unknown' && gen !== 'unknown' && voiceGen && voiceGen !== gen) {
          const { voice } = cast(gen)
          if (voice) db.prepare('UPDATE characters SET tts_voice = ? WHERE id = ?').run(voice, known.id)
        }
        continue
      }
      const id = randomUUID()
      // Characters seen only in pictures follow the narrator until the creator gives them a voice.
      db.prepare('INSERT INTO characters (id, project_id, name, description, sort) VALUES (?, ?, ?, ?, ?)').run(
        id,
        projectId,
        c.name.trim(),
        c.description,
        sort++
      )
      byName.set(key, { id, name: c.name, description: c.description, tts_voice: null })
    }
    const update = db.prepare(
      `UPDATE clips SET visual_prompt = @visualPrompt, visual_source = @visualSource, character_ids = @characterIds,
         camera_preset = @cameraPreset, motion_strength = @motionStrength, video_prompt = @videoPrompt, transition = @transition
       WHERE id = @clipId AND project_id = @projectId`
    )
    for (const v of scenes) {
      const clip = getClip(v.clipId)
      const ids = [...new Set(v.characterNames.map((n) => byName.get(n.trim().toLowerCase())?.id as string | undefined).filter((x): x is string => !!x))]
      update.run({ ...v, projectId, visualSource: visualSourceOf(clip), characterIds: JSON.stringify(ids) })
    }
    db.prepare(
      "UPDATE projects SET status = CASE WHEN status IN ('draft', 'script') THEN 'storyboard' ELSE status END, step = 3, updated_at = ? WHERE id = ?"
    ).run(Date.now(), projectId)
  })()
}

// ---------- clips, characters, assets ----------

export function getClip(id: string): Clip {
  const r = getDb().prepare('SELECT * FROM clips WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Klip tidak ditemukan')
  return toClip(r)
}

export function getCharacter(id: string): Character {
  const r = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Pemeran tidak ditemukan')
  return toCharacter(r)
}

export function charactersOf(projectId: string): Character[] {
  return (getDb().prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toCharacter)
}

export function clipsOf(projectId: string, episodeId?: string): Clip[] {
  if (episodeId) {
    return (getDb().prepare('SELECT * FROM clips WHERE project_id = ? AND episode_id = ? ORDER BY sort').all(projectId, episodeId) as Row[]).map(toClip)
  }
  return (getDb().prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toClip)
}

/** The series cover follows the opening clip of the first episode, not whichever episode was generated first. */
export function firstClipOf(projectId: string): Clip | undefined {
  const r = getDb()
    .prepare(
      `SELECT c.* FROM clips c JOIN episodes e ON e.id = c.episode_id
       WHERE c.project_id = ? ORDER BY e.sort, c.sort LIMIT 1`
    )
    .get(projectId) as Row | undefined
  return r ? toClip(r) : undefined
}

const CLIP_COLS: Partial<Record<keyof Clip, string>> = {
  visualPrompt: 'visual_prompt',
  videoPrompt: 'video_prompt',
  visualSource: 'visual_source',
  imageAssetId: 'image_asset_id',
  videoAssetId: 'video_asset_id',
  audioAssetId: 'audio_asset_id',
  durationMs: 'duration_ms',
  motionType: 'motion_type',
  videoCamera: 'video_camera',
  videoStrength: 'video_strength',
  mediaInMs: 'media_in_ms',
  voiceInMs: 'voice_in_ms',
  voiceOutMs: 'voice_out_ms',
  voiceStartMs: 'voice_start_ms',
  filter: 'filter',
  speakerId: 'speaker_id',
  emotion: 'emotion',
  costumeIds: 'costume_ids',
  locationId: 'location_id',
  propIds: 'prop_ids',
  framing: 'framing',
  sourceExcerpt: 'source_excerpt'
}

export function patchClip(id: string, patch: Partial<Clip>): void {
  const entries = Object.entries(patch).filter(([k]) => k in CLIP_COLS)
  if (!entries.length) return
  const sets = entries.map(([k]) => `${CLIP_COLS[k as keyof Clip]} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE clips SET ${sets} WHERE id = ?`)
    // costumeIds and propIds are stored as JSON text; SQLite cannot bind objects or arrays directly.
    .run(...entries.map(([, v]) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)), id)
}

/** Puts a new clip right after another one (used when the editor splits a clip). */
export function insertClipAfter(afterId: string, c: Clip): void {
  const db = getDb()
  db.transaction(() => {
    const after = getClip(afterId)
    db.prepare('UPDATE clips SET sort = sort + 1 WHERE project_id = ? AND episode_id = ? AND sort > ?')
      .run(after.projectId, after.episodeId, after.sort)
    db.prepare(
      `INSERT INTO clips (id, project_id, episode_id, sort, title, story, visual_prompt, visual_source, narration, duration_ms, character_ids,
         motion_type, camera_preset, motion_strength, video_prompt, transition, image_asset_id, video_asset_id, audio_asset_id,
         video_camera, video_strength, transition_ms, voice_gain_db, media_in_ms, voice_in_ms, voice_out_ms, voice_start_ms, filter, speaker_id,
         emotion, costume_ids, location_id, prop_ids, framing, source_excerpt)
       VALUES (@id, @projectId, @episodeId, @sort, @title, @story, @visualPrompt, @visualSource, @narration, @durationMs, @characterIds,
         @motionType, @cameraPreset, @motionStrength, @videoPrompt, @transition, @imageAssetId, @videoAssetId, @audioAssetId,
         @videoCamera, @videoStrength, @transitionMs, @voiceGainDb, @mediaInMs, @voiceInMs, @voiceOutMs, @voiceStartMs, @filter, @speakerId,
         @emotion, @costumeIds, @locationId, @propIds, @framing, @sourceExcerpt)`
    ).run({
      ...c,
      projectId: after.projectId,
      episodeId: after.episodeId,
      sort: after.sort + 1,
      characterIds: JSON.stringify(c.characterIds || []),
      filter: c.filter ?? 'normal',
      speakerId: c.speakerId ?? null,
      emotion: c.emotion ?? '',
      costumeIds: JSON.stringify(c.costumeIds || {}),
      locationId: c.locationId ?? null,
      propIds: JSON.stringify(c.propIds || []),
      framing: c.framing ?? '',
      sourceExcerpt: c.sourceExcerpt ?? ''
    })
  })()
}

/** Text fields of a clip changed outside the editor's own saves (a split moves narration between clips). */
export function patchClipText(id: string, patch: Partial<Pick<Clip, 'title' | 'story' | 'narration' | 'visualSource' | 'transition'>>): void {
  const cols: Record<string, string> = { title: 'title', story: 'story', narration: 'narration', visualSource: 'visual_source', transition: 'transition' }
  const entries = Object.entries(patch).filter(([k]) => k in cols)
  if (!entries.length) return
  getDb()
    .prepare(`UPDATE clips SET ${entries.map(([k]) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id)
}

// ---------- lorebook: characters, derivatives, locations, props ----------

export function createCharacter(input: {
  projectId: string
  name: string
  description?: string
  ttsVoice?: string | null
  ttsProvider?: Character['ttsProvider']
  voiceStyle?: string
  aliases?: string[]
}): Character {
  const db = getDb()
  const id = randomUUID()
  const sort = (db.prepare('SELECT COUNT(*) AS n FROM characters WHERE project_id = ?').get(input.projectId) as Row).n as number
  db.prepare(
    `INSERT INTO characters (id, project_id, name, description, sort, tts_voice, tts_provider, voice_style, aliases_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    input.name.trim(),
    input.description?.trim() ?? '',
    sort,
    input.ttsVoice ?? null,
    input.ttsProvider ?? null,
    input.voiceStyle?.trim() ?? '',
    JSON.stringify(input.aliases ?? [])
  )
  return getCharacter(id)
}

export function updateCharacter(id: string, patch: Partial<Character>): Character {
  const db = getDb()
  const cols: string[] = []
  const vals: any[] = []

  if (patch.name !== undefined) {
    cols.push('name = ?')
    vals.push(patch.name.trim())
  }
  if (patch.description !== undefined) {
    cols.push('description = ?')
    vals.push(patch.description.trim())
  }
  if (patch.ttsVoice !== undefined) {
    cols.push('tts_voice = ?')
    vals.push(patch.ttsVoice)
  }
  if (patch.ttsProvider !== undefined) {
    cols.push('tts_provider = ?')
    vals.push(patch.ttsProvider)
  }
  if (patch.voiceStyle !== undefined) {
    cols.push('voice_style = ?')
    vals.push(patch.voiceStyle.trim())
  }
  if (patch.aliases !== undefined) {
    cols.push('aliases_json = ?')
    vals.push(JSON.stringify(patch.aliases))
  }
  if (patch.sort !== undefined) {
    cols.push('sort = ?')
    vals.push(patch.sort)
  }
  if (patch.sheetAssetId !== undefined) {
    cols.push('sheet_asset_id = ?')
    vals.push(patch.sheetAssetId)
  }

  if (cols.length > 0) {
    vals.push(id)
    db.prepare(`UPDATE characters SET ${cols.join(', ')} WHERE id = ?`).run(...vals)
  }
  return getCharacter(id)
}

export function removeCharacter(id: string): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM character_derivatives WHERE character_id = ?').run(id)
    db.prepare('DELETE FROM characters WHERE id = ?').run(id)
  })()
}

export function setCharacterSheet(id: string, assetId: string | null): void {
  getDb().prepare('UPDATE characters SET sheet_asset_id = ? WHERE id = ?').run(assetId, id)
}

// --- Derivatives (Costume variants) ---

export function derivativesOf(projectId: string, characterId?: string): CharacterDerivative[] {
  const db = getDb()
  if (characterId) {
    return (db.prepare('SELECT * FROM character_derivatives WHERE project_id = ? AND character_id = ? ORDER BY sort').all(projectId, characterId) as Row[]).map(toCharacterDerivative)
  }
  return (db.prepare('SELECT * FROM character_derivatives WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toCharacterDerivative)
}

export function getDerivative(id: string): CharacterDerivative | undefined {
  const r = getDb().prepare('SELECT * FROM character_derivatives WHERE id = ?').get(id) as Row | undefined
  return r ? toCharacterDerivative(r) : undefined
}

export function createDerivative(input: { projectId: string; characterId: string; name: string; promptChange?: string }): CharacterDerivative {
  const db = getDb()
  const id = randomUUID()
  const maxSort = (db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM character_derivatives WHERE character_id = ?').get(input.characterId) as Row).m as number
  db.prepare(
    `INSERT INTO character_derivatives (id, project_id, character_id, name, prompt_change, sheet_asset_id, sort)
     VALUES (?, ?, ?, ?, ?, null, ?)`
  ).run(id, input.projectId, input.characterId, input.name.trim(), input.promptChange?.trim() ?? '', maxSort + 1)
  return getDerivative(id)!
}

export function updateDerivative(id: string, patch: Partial<CharacterDerivative>): CharacterDerivative {
  const db = getDb()
  const cols: string[] = []
  const vals: any[] = []

  if (patch.name !== undefined) {
    cols.push('name = ?')
    vals.push(patch.name.trim())
  }
  if (patch.promptChange !== undefined) {
    cols.push('prompt_change = ?')
    vals.push(patch.promptChange.trim())
  }
  if (patch.sheetAssetId !== undefined) {
    cols.push('sheet_asset_id = ?')
    vals.push(patch.sheetAssetId)
  }
  if (patch.sort !== undefined) {
    cols.push('sort = ?')
    vals.push(patch.sort)
  }

  if (cols.length > 0) {
    vals.push(id)
    db.prepare(`UPDATE character_derivatives SET ${cols.join(', ')} WHERE id = ?`).run(...vals)
  }
  return getDerivative(id)!
}

export function removeDerivative(id: string): void {
  getDb().prepare('DELETE FROM character_derivatives WHERE id = ?').run(id)
}

export function setDerivativeSheet(id: string, assetId: string | null): void {
  getDb().prepare('UPDATE character_derivatives SET sheet_asset_id = ? WHERE id = ?').run(assetId, id)
}

// --- Locations ---

export function locationsOf(projectId: string): Location[] {
  return (getDb().prepare('SELECT * FROM locations WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toLocation)
}

export function getLocation(id: string): Location | undefined {
  const r = getDb().prepare('SELECT * FROM locations WHERE id = ?').get(id) as Row | undefined
  return r ? toLocation(r) : undefined
}

export function createLocation(input: { projectId: string; name: string; description?: string; aliases?: string[] }): Location {
  const db = getDb()
  const id = randomUUID()
  const maxSort = (db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM locations WHERE project_id = ?').get(input.projectId) as Row).m as number
  db.prepare(
    `INSERT INTO locations (id, project_id, name, description, aliases_json, sheet_asset_id, sort)
     VALUES (?, ?, ?, ?, ?, null, ?)`
  ).run(id, input.projectId, input.name.trim(), input.description?.trim() ?? '', JSON.stringify(input.aliases ?? []), maxSort + 1)
  return getLocation(id)!
}

export function updateLocation(id: string, patch: Partial<Location>): Location {
  const db = getDb()
  const cols: string[] = []
  const vals: any[] = []

  if (patch.name !== undefined) {
    cols.push('name = ?')
    vals.push(patch.name.trim())
  }
  if (patch.description !== undefined) {
    cols.push('description = ?')
    vals.push(patch.description.trim())
  }
  if (patch.aliases !== undefined) {
    cols.push('aliases_json = ?')
    vals.push(JSON.stringify(patch.aliases))
  }
  if (patch.sheetAssetId !== undefined) {
    cols.push('sheet_asset_id = ?')
    vals.push(patch.sheetAssetId)
  }
  if (patch.sort !== undefined) {
    cols.push('sort = ?')
    vals.push(patch.sort)
  }

  if (cols.length > 0) {
    vals.push(id)
    db.prepare(`UPDATE locations SET ${cols.join(', ')} WHERE id = ?`).run(...vals)
  }
  return getLocation(id)!
}

export function removeLocation(id: string): void {
  getDb().prepare('DELETE FROM locations WHERE id = ?').run(id)
}

export function setLocationSheet(id: string, assetId: string | null): void {
  getDb().prepare('UPDATE locations SET sheet_asset_id = ? WHERE id = ?').run(assetId, id)
}

// --- Props ---

export function propsOf(projectId: string): Prop[] {
  return (getDb().prepare('SELECT * FROM props WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toProp)
}

export function getProp(id: string): Prop | undefined {
  const r = getDb().prepare('SELECT * FROM props WHERE id = ?').get(id) as Row | undefined
  return r ? toProp(r) : undefined
}

export function createProp(input: { projectId: string; name: string; description?: string; aliases?: string[] }): Prop {
  const db = getDb()
  const id = randomUUID()
  const maxSort = (db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM props WHERE project_id = ?').get(input.projectId) as Row).m as number
  db.prepare(
    `INSERT INTO props (id, project_id, name, description, aliases_json, sheet_asset_id, sort)
     VALUES (?, ?, ?, ?, ?, null, ?)`
  ).run(id, input.projectId, input.name.trim(), input.description?.trim() ?? '', JSON.stringify(input.aliases ?? []), maxSort + 1)
  return getProp(id)!
}

export function updateProp(id: string, patch: Partial<Prop>): Prop {
  const db = getDb()
  const cols: string[] = []
  const vals: any[] = []

  if (patch.name !== undefined) {
    cols.push('name = ?')
    vals.push(patch.name.trim())
  }
  if (patch.description !== undefined) {
    cols.push('description = ?')
    vals.push(patch.description.trim())
  }
  if (patch.aliases !== undefined) {
    cols.push('aliases_json = ?')
    vals.push(JSON.stringify(patch.aliases))
  }
  if (patch.sheetAssetId !== undefined) {
    cols.push('sheet_asset_id = ?')
    vals.push(patch.sheetAssetId)
  }
  if (patch.sort !== undefined) {
    cols.push('sort = ?')
    vals.push(patch.sort)
  }

  if (cols.length > 0) {
    vals.push(id)
    db.prepare(`UPDATE props SET ${cols.join(', ')} WHERE id = ?`).run(...vals)
  }
  return getProp(id)!
}

export function removeProp(id: string): void {
  getDb().prepare('DELETE FROM props WHERE id = ?').run(id)
}

export function setPropSheet(id: string, assetId: string | null): void {
  getDb().prepare('UPDATE props SET sheet_asset_id = ? WHERE id = ?').run(assetId, id)
}

// --- Asset usage and merge ---

export function getAssetUsage(projectId: string, kind: 'character' | 'derivative' | 'location' | 'prop', id: string): AssetUsageSummary {
  const db = getDb()
  const episodes = listEpisodes(projectId)
  const clips = (db.prepare('SELECT episode_id, character_ids, speaker_id, costume_ids, location_id, prop_ids FROM clips WHERE project_id = ?').all(projectId) as Row[])

  let name = ''
  if (kind === 'character') {
    const c = db.prepare('SELECT name FROM characters WHERE id = ?').get(id) as Row | undefined
    name = c?.name ?? ''
  } else if (kind === 'derivative') {
    const d = db.prepare('SELECT name FROM character_derivatives WHERE id = ?').get(id) as Row | undefined
    name = d?.name ?? ''
  } else if (kind === 'location') {
    const l = db.prepare('SELECT name FROM locations WHERE id = ?').get(id) as Row | undefined
    name = l?.name ?? ''
  } else if (kind === 'prop') {
    const pr = db.prepare('SELECT name FROM props WHERE id = ?').get(id) as Row | undefined
    name = pr?.name ?? ''
  }

  const epCounts = new Map<string, number>()
  for (const c of clips) {
    let matched = false
    if (kind === 'character') {
      const charIds: string[] = JSON.parse(c.character_ids || '[]')
      const costumeIds: Record<string, string> = JSON.parse(c.costume_ids || '{}')
      if (charIds.includes(id) || c.speaker_id === id || id in costumeIds) {
        matched = true
      }
    } else if (kind === 'derivative') {
      const costumeIds: Record<string, string> = JSON.parse(c.costume_ids || '{}')
      if (Object.values(costumeIds).includes(id)) {
        matched = true
      }
    } else if (kind === 'location') {
      if (c.location_id === id) {
        matched = true
      }
    } else if (kind === 'prop') {
      const propIds: string[] = JSON.parse(c.prop_ids || '[]')
      if (propIds.includes(id)) {
        matched = true
      }
    }
    if (matched) {
      epCounts.set(c.episode_id, (epCounts.get(c.episode_id) ?? 0) + 1)
    }
  }

  const usageEpisodes: { episodeId: string; episodeNum: number; title: string; count: number }[] = []
  let totalCount = 0
  for (const ep of episodes) {
    const count = epCounts.get(ep.id) ?? 0
    if (count > 0) {
      usageEpisodes.push({ episodeId: ep.id, episodeNum: ep.episodeNum, title: ep.title, count })
      totalCount += count
    }
  }

  return {
    kind,
    id,
    name,
    episodes: usageEpisodes,
    totalCount
  }
}

export function mergeAssets(input: MergeAssetInput): { message: string } {
  const db = getDb()
  const { projectId, kind, sourceId, targetId, asVariant } = input
  if (sourceId === targetId) throw new Error('Aset sumber dan tujuan tidak boleh sama')

  return db.transaction(() => {
    if (kind === 'character') {
      const source = db.prepare('SELECT * FROM characters WHERE id = ? AND project_id = ?').get(sourceId, projectId) as Row | undefined
      const target = db.prepare('SELECT * FROM characters WHERE id = ? AND project_id = ?').get(targetId, projectId) as Row | undefined
      if (!source || !target) throw new Error('Karakter tidak ditemukan')

      const sourceAliases: string[] = JSON.parse(source.aliases_json || '[]')
      const targetAliases: string[] = JSON.parse(target.aliases_json || '[]')
      const combinedAliases = [...new Set([...targetAliases, source.name, ...sourceAliases])].filter((a) => a && a.toLowerCase() !== target.name.toLowerCase())

      if (asVariant) {
        let variant = db.prepare('SELECT * FROM character_derivatives WHERE character_id = ? AND LOWER(name) = LOWER(?)').get(targetId, source.name) as Row | undefined
        let variantId = variant?.id
        if (!variantId) {
          variantId = randomUUID()
          const maxSort = (db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM character_derivatives WHERE character_id = ?').get(targetId) as Row).m as number
          db.prepare(
            'INSERT INTO character_derivatives (id, project_id, character_id, name, prompt_change, sheet_asset_id, sort) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(variantId, projectId, targetId, source.name, source.description, source.sheet_asset_id, maxSort + 1)
        }

        db.prepare('UPDATE characters SET aliases_json = ? WHERE id = ?').run(JSON.stringify(combinedAliases), targetId)
        db.prepare('UPDATE character_derivatives SET character_id = ? WHERE character_id = ?').run(targetId, sourceId)

        const allClips = db.prepare('SELECT id, character_ids, speaker_id, costume_ids FROM clips WHERE project_id = ?').all(projectId) as Row[]
        for (const c of allClips) {
          let charIds: string[] = JSON.parse(c.character_ids || '[]')
          let speakerId: string | null = c.speaker_id
          let costumeIds: Record<string, string> = JSON.parse(c.costume_ids || '{}')
          let changed = false

          if (charIds.includes(sourceId)) {
            charIds = charIds.map((id) => (id === sourceId ? targetId : id))
            charIds = [...new Set(charIds)]
            costumeIds[targetId] = variantId!
            delete costumeIds[sourceId]
            changed = true
          }
          if (speakerId === sourceId) {
            speakerId = targetId
            changed = true
          }
          if (sourceId in costumeIds) {
            costumeIds[targetId] = variantId!
            delete costumeIds[sourceId]
            changed = true
          }

          if (changed) {
            db.prepare('UPDATE clips SET character_ids = ?, speaker_id = ?, costume_ids = ? WHERE id = ?').run(
              JSON.stringify(charIds),
              speakerId,
              JSON.stringify(costumeIds),
              c.id
            )
          }
        }

        db.prepare('DELETE FROM characters WHERE id = ?').run(sourceId)
        return { message: `Karakter "${source.name}" berhasil digabung sebagai varian "${target.name}".` }
      } else {
        db.prepare('UPDATE characters SET aliases_json = ? WHERE id = ?').run(JSON.stringify(combinedAliases), targetId)

        const targetDerivs = (db.prepare('SELECT id, name FROM character_derivatives WHERE character_id = ?').all(targetId) as Row[])
        const targetDerivByName = new Map<string, string>(targetDerivs.map((d) => [String(d.name).toLowerCase(), d.id as string]))

        const sourceDerivs = (db.prepare('SELECT * FROM character_derivatives WHERE character_id = ?').all(sourceId) as Row[])
        const derivMap = new Map<string, string>()
        for (const sd of sourceDerivs) {
          const matchTargetId = targetDerivByName.get(String(sd.name).toLowerCase())
          if (matchTargetId) {
            derivMap.set(sd.id, matchTargetId)
            db.prepare('DELETE FROM character_derivatives WHERE id = ?').run(sd.id)
          } else {
            db.prepare('UPDATE character_derivatives SET character_id = ? WHERE id = ?').run(targetId, sd.id)
            targetDerivByName.set(String(sd.name).toLowerCase(), sd.id)
          }
        }

        const allClips = db.prepare('SELECT id, character_ids, speaker_id, costume_ids FROM clips WHERE project_id = ?').all(projectId) as Row[]
        for (const c of allClips) {
          let charIds: string[] = JSON.parse(c.character_ids || '[]')
          let speakerId: string | null = c.speaker_id
          let costumeIds: Record<string, string> = JSON.parse(c.costume_ids || '{}')
          let changed = false

          if (charIds.includes(sourceId)) {
            charIds = charIds.map((id) => (id === sourceId ? targetId : id))
            charIds = [...new Set(charIds)]
            changed = true
          }
          if (speakerId === sourceId) {
            speakerId = targetId
            changed = true
          }
          if (sourceId in costumeIds) {
            const oldDerivId = costumeIds[sourceId]
            const newDerivId = derivMap.get(oldDerivId) ?? oldDerivId
            delete costumeIds[sourceId]
            costumeIds[targetId] = newDerivId
            changed = true
          }

          if (changed) {
            db.prepare('UPDATE clips SET character_ids = ?, speaker_id = ?, costume_ids = ? WHERE id = ?').run(
              JSON.stringify(charIds),
              speakerId,
              JSON.stringify(costumeIds),
              c.id
            )
          }
        }

        db.prepare('DELETE FROM characters WHERE id = ?').run(sourceId)
        return { message: `Karakter "${source.name}" berhasil digabung ke "${target.name}".` }
      }
    } else if (kind === 'location') {
      const source = db.prepare('SELECT * FROM locations WHERE id = ? AND project_id = ?').get(sourceId, projectId) as Row | undefined
      const target = db.prepare('SELECT * FROM locations WHERE id = ? AND project_id = ?').get(targetId, projectId) as Row | undefined
      if (!source || !target) throw new Error('Lokasi tidak ditemukan')

      const sourceAliases: string[] = JSON.parse(source.aliases_json || '[]')
      const targetAliases: string[] = JSON.parse(target.aliases_json || '[]')
      const combinedAliases = [...new Set([...targetAliases, source.name, ...sourceAliases])].filter((a) => a && a.toLowerCase() !== target.name.toLowerCase())

      db.prepare('UPDATE locations SET aliases_json = ? WHERE id = ?').run(JSON.stringify(combinedAliases), targetId)
      db.prepare('UPDATE clips SET location_id = ? WHERE project_id = ? AND location_id = ?').run(targetId, projectId, sourceId)
      db.prepare('DELETE FROM locations WHERE id = ?').run(sourceId)
      return { message: `Lokasi "${source.name}" berhasil digabung ke "${target.name}".` }
    } else if (kind === 'prop') {
      const source = db.prepare('SELECT * FROM props WHERE id = ? AND project_id = ?').get(sourceId, projectId) as Row | undefined
      const target = db.prepare('SELECT * FROM props WHERE id = ? AND project_id = ?').get(targetId, projectId) as Row | undefined
      if (!source || !target) throw new Error('Prop tidak ditemukan')

      const sourceAliases: string[] = JSON.parse(source.aliases_json || '[]')
      const targetAliases: string[] = JSON.parse(target.aliases_json || '[]')
      const combinedAliases = [...new Set([...targetAliases, source.name, ...sourceAliases])].filter((a) => a && a.toLowerCase() !== target.name.toLowerCase())

      db.prepare('UPDATE props SET aliases_json = ? WHERE id = ?').run(JSON.stringify(combinedAliases), targetId)

      const allClips = db.prepare('SELECT id, prop_ids FROM clips WHERE project_id = ?').all(projectId) as Row[]
      for (const c of allClips) {
        let propIds: string[] = JSON.parse(c.prop_ids || '[]')
        if (propIds.includes(sourceId)) {
          propIds = propIds.map((id) => (id === sourceId ? targetId : id))
          propIds = [...new Set(propIds)]
          db.prepare('UPDATE clips SET prop_ids = ? WHERE id = ?').run(JSON.stringify(propIds), c.id)
        }
      }

      db.prepare('DELETE FROM props WHERE id = ?').run(sourceId)
      return { message: `Prop "${source.name}" berhasil digabung ke "${target.name}".` }
    }
    throw new Error(`Jenis aset ${kind} tidak didukung untuk penggabungan`)
  })()
}

export function getAsset(id: string | null): Asset | null {
  if (!id) return null
  const r = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined
  return r ? toAsset(r) : null
}

export function assetsOf(projectId: string): Asset[] {
  return (getDb().prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(projectId) as Row[]).map(toAsset)
}

export function insertAsset(a: {
  id?: string
  projectId: string
  clipId?: string | null
  characterId?: string | null
  derivativeId?: string | null
  locationId?: string | null
  propId?: string | null
  episodeId?: string | null
  kind: AssetKind
  provider?: string | null
  model?: string | null
  prompt?: string | null
  remoteId?: string | null
  remoteUrl?: string | null
  localPath: string
  durationMs?: number | null
  width?: number | null
  height?: number | null
  meta?: AssetMeta
}): Asset {
  const id = a.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO assets (id, project_id, clip_id, character_id, derivative_id, location_id, prop_id, episode_id, kind, provider, model, prompt, remote_id, remote_url, local_path,
        duration_ms, width, height, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      a.projectId,
      a.clipId ?? null,
      a.characterId ?? null,
      a.derivativeId ?? null,
      a.locationId ?? null,
      a.propId ?? null,
      a.episodeId ?? null,
      a.kind,
      a.provider ?? null,
      a.model ?? null,
      a.prompt ?? null,
      a.remoteId ?? null,
      a.remoteUrl ?? null,
      a.localPath,
      a.durationMs ?? null,
      a.width ?? null,
      a.height ?? null,
      JSON.stringify(a.meta ?? {}),
      Date.now()
    )
  return getAsset(id)!
}

export function updateAssetMeta(id: string, meta: AssetMeta): void {
  getDb().prepare('UPDATE assets SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), id)
}

// ---------- jobs ----------

export function insertJob(j: {
  projectId: string
  episodeId?: string | null
  clipId?: string | null
  characterId?: string | null
  kind: JobKind
  provider: string
  payload?: Record<string, unknown>
}): Job {
  const id = randomUUID()
  const now = Date.now()
  let episodeId = j.episodeId ?? null
  if (!episodeId && j.clipId) {
    try {
      const clip = getClip(j.clipId)
      if (clip?.episodeId) episodeId = clip.episodeId
    } catch {
      // Clip might not exist yet in tests or non-standard flows
    }
  }
  getDb()
    .prepare(
      `INSERT INTO jobs (id, project_id, episode_id, clip_id, character_id, kind, provider, status, progress, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`
    )
    .run(id, j.projectId, episodeId, j.clipId ?? null, j.characterId ?? null, j.kind, j.provider, JSON.stringify(j.payload ?? {}), now, now)
  return getJob(id)!
}

export function getJob(id: string): Job | null {
  const r = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
  return r ? toJob(r) : null
}

export function getJobRaw(id: string): Row | undefined {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
}

export function updateJob(
  id: string,
  patch: Partial<{ status: JobStatus; progress: number; message: string | null; error: string | null; remoteId: string; resultAssetId: string }>
): Job {
  const cols: Record<string, string> = {
    status: 'status',
    progress: 'progress',
    message: 'message',
    error: 'error',
    remoteId: 'remote_id',
    resultAssetId: 'result_asset_id'
  }
  const entries = Object.entries(patch).filter(([k]) => k in cols)
  const sets = [...entries.map(([k]) => `${cols[k]} = ?`), 'updated_at = ?'].join(', ')
  getDb()
    .prepare(`UPDATE jobs SET ${sets} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), Date.now(), id)
  return getJob(id)!
}

export function unfinishedJobs(): Row[] {
  return getDb().prepare("SELECT * FROM jobs WHERE status IN ('queued','running')").all() as Row[]
}

export function activeJobsOf(projectId: string): Job[] {
  return (getDb().prepare("SELECT * FROM jobs WHERE project_id = ? AND status IN ('queued','running')").all(projectId) as Row[]).map(toJob)
}

/** A queued or running job of this kind, such as a narration take. Scoped to episodeId when provided. */
export function activeProjectJob(projectId: string, kind: JobKind, episodeId?: string | null): Job | null {
  const db = getDb()
  if (episodeId) {
    const r = db
      .prepare("SELECT * FROM jobs WHERE project_id = ? AND episode_id = ? AND kind = ? AND status IN ('queued','running') LIMIT 1")
      .get(projectId, episodeId, kind) as Row | undefined
    return r ? toJob(r) : null
  }
  const r = db
    .prepare("SELECT * FROM jobs WHERE project_id = ? AND kind = ? AND status IN ('queued','running') LIMIT 1")
    .get(projectId, kind) as Row | undefined
  return r ? toJob(r) : null
}

export function activeJobFor(target: { clipId?: string; characterId?: string }, kind: JobKind): Job | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM jobs WHERE kind = ? AND status IN ('queued','running') AND ${target.clipId ? 'clip_id' : 'character_id'} = ? LIMIT 1`
    )
    .get(kind, target.clipId ?? target.characterId) as Row | undefined
  return r ? toJob(r) : null
}
