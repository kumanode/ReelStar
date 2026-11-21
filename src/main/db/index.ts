import Database from 'better-sqlite3'
import { dbPath } from '../paths'

let db: Database.Database | null = null

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    synopsis TEXT NOT NULL DEFAULT '',
    duration_sec INTEGER NOT NULL DEFAULT 60,
    language TEXT NOT NULL DEFAULT 'id',
    aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    style_id TEXT NOT NULL DEFAULT 'stickman',
    tts_provider TEXT NOT NULL DEFAULT 'gemini',
    tts_voice TEXT NOT NULL DEFAULT 'Charon',
    image_model TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    step INTEGER NOT NULL DEFAULT 1,
    cover_asset_id TEXT,
    editor_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE characters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sheet_asset_id TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX characters_project ON characters(project_id);
  CREATE TABLE clips (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    visual_prompt TEXT NOT NULL DEFAULT '',
    narration TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 5000,
    character_ids TEXT NOT NULL DEFAULT '[]',
    motion_type TEXT NOT NULL DEFAULT 'camera',
    camera_preset TEXT NOT NULL DEFAULT 'zoomin',
    motion_strength TEXT NOT NULL DEFAULT 'halus',
    video_prompt TEXT NOT NULL DEFAULT '',
    transition TEXT NOT NULL DEFAULT 'fade',
    image_asset_id TEXT,
    video_asset_id TEXT,
    audio_asset_id TEXT
  );
  CREATE INDEX clips_project ON clips(project_id, sort);
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    clip_id TEXT,
    character_id TEXT,
    kind TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    prompt TEXT,
    remote_id TEXT,
    remote_url TEXT,
    local_path TEXT NOT NULL,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX assets_project ON assets(project_id);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    clip_id TEXT,
    character_id TEXT,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    remote_id TEXT,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    result_asset_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX jobs_project ON jobs(project_id, status);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE secrets (
    provider TEXT PRIMARY KEY,
    value BLOB NOT NULL,
    last_ok INTEGER,
    last_message TEXT,
    checked_at INTEGER
  );
  `,
  `
  CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE projects ADD COLUMN video_model TEXT;
  `,
  // The script step sits between idea and storyboard, so later steps move up by one.
  `
  ALTER TABLE clips ADD COLUMN story TEXT NOT NULL DEFAULT '';
  ALTER TABLE clips ADD COLUMN visual_source TEXT;
  UPDATE projects SET step = step + 1 WHERE step >= 2;
  `,
  // Video resolution picked per project; null keeps the model's recommended one.
  `
  ALTER TABLE projects ADD COLUMN video_resolution TEXT;
  `,
  // Editor: camera over AI video, transition length, narration volume per clip.
  `
  ALTER TABLE clips ADD COLUMN video_camera TEXT NOT NULL DEFAULT 'static';
  ALTER TABLE clips ADD COLUMN video_strength TEXT NOT NULL DEFAULT 'halus';
  ALTER TABLE clips ADD COLUMN transition_ms INTEGER;
  ALTER TABLE clips ADD COLUMN voice_gain_db REAL NOT NULL DEFAULT 0;
  `,
  // Timeline editing: video in-point, voice trim and placement.
  `
  ALTER TABLE clips ADD COLUMN media_in_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE clips ADD COLUMN voice_in_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE clips ADD COLUMN voice_out_ms INTEGER;
  ALTER TABLE clips ADD COLUMN voice_start_ms INTEGER NOT NULL DEFAULT 0;
  `,
  // Color grading filter per clip
  `
  ALTER TABLE clips ADD COLUMN filter TEXT NOT NULL DEFAULT 'normal';
  `,
  // Multi-voice: character voice assignment
  `
  ALTER TABLE characters ADD COLUMN tts_voice TEXT;
  `,
  `
  ALTER TABLE clips ADD COLUMN speaker_id TEXT;
  ALTER TABLE characters ADD COLUMN tts_provider TEXT;
  UPDATE characters SET tts_provider = (SELECT tts_provider FROM projects WHERE projects.id = characters.project_id) WHERE tts_voice IS NOT NULL;
  `,
  // Reviewed hooks and story outlines belong to the project so interrupted writing can resume.
  `
  ALTER TABLE projects ADD COLUMN story_plan_json TEXT;
  `,
  // Drama studio multi-episode: serial projects, episodes, drama clip fields, and lorebook assets.
  `
  ALTER TABLE projects ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'novel';
  ALTER TABLE projects ADD COLUMN dialog_audio TEXT NOT NULL DEFAULT 'video';

  CREATE TABLE episodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    episode_num INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    hook TEXT NOT NULL DEFAULT '',
    story_beats_json TEXT NOT NULL DEFAULT '[]',
    cliffhanger TEXT NOT NULL DEFAULT '',
    next_teaser TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    source_kind TEXT,
    script_draft_json TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    duration_sec INTEGER NOT NULL DEFAULT 75,
    sort INTEGER NOT NULL DEFAULT 0,
    editor_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX episodes_project ON episodes(project_id, sort);

  INSERT INTO episodes (id, project_id, episode_num, title, summary, status, duration_sec, sort, editor_json, created_at, updated_at)
    SELECT lower(hex(randomblob(16))), id, 1, title, synopsis,
      CASE WHEN status IN ('draft','script','storyboard','editing','exported') THEN status ELSE 'editing' END,
      duration_sec, 0, editor_json, created_at, updated_at
    FROM projects;
  UPDATE projects SET dialog_audio = 'tts';

  ALTER TABLE clips ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;
  UPDATE clips SET episode_id = (SELECT e.id FROM episodes e WHERE e.project_id = clips.project_id);
  CREATE INDEX clips_episode ON clips(episode_id, sort);

  ALTER TABLE clips ADD COLUMN emotion TEXT NOT NULL DEFAULT '';
  ALTER TABLE clips ADD COLUMN costume_ids TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE clips ADD COLUMN location_id TEXT;
  ALTER TABLE clips ADD COLUMN prop_ids TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE clips ADD COLUMN framing TEXT NOT NULL DEFAULT '';
  ALTER TABLE clips ADD COLUMN source_excerpt TEXT NOT NULL DEFAULT '';

  ALTER TABLE characters ADD COLUMN voice_style TEXT NOT NULL DEFAULT '';
  ALTER TABLE characters ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE character_derivatives (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt_change TEXT NOT NULL DEFAULT '',
    sheet_asset_id TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX character_derivatives_character ON character_derivatives(character_id, sort);

  CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    aliases_json TEXT NOT NULL DEFAULT '[]',
    sheet_asset_id TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX locations_project ON locations(project_id, sort);

  CREATE TABLE props (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    aliases_json TEXT NOT NULL DEFAULT '[]',
    sheet_asset_id TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX props_project ON props(project_id, sort);

  ALTER TABLE assets ADD COLUMN derivative_id TEXT;
  ALTER TABLE assets ADD COLUMN location_id TEXT;
  ALTER TABLE assets ADD COLUMN prop_id TEXT;
  ALTER TABLE assets ADD COLUMN episode_id TEXT;
  ALTER TABLE jobs ADD COLUMN episode_id TEXT;
  `,
  `
  ALTER TABLE projects ADD COLUMN target_episode_count INTEGER;
  `,
  `
  ALTER TABLE characters ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE character_derivatives ADD COLUMN costume_keyphrase TEXT NOT NULL DEFAULT '';
  ALTER TABLE locations ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE props ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';
  `,
  `
  ALTER TABLE clips ADD COLUMN shot_detail_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE clips ADD COLUMN continue_from_previous INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN series_guidelines TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN prompt_templates_json TEXT NOT NULL DEFAULT '{}';
  `,
  `
  ALTER TABLE projects ADD COLUMN series_lock_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE episodes ADD COLUMN lock_words_json TEXT NOT NULL DEFAULT '[]';
  `,
  `
  CREATE TABLE continuity_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    tier TEXT NOT NULL DEFAULT 'hot',
    planted_episode_id TEXT NOT NULL,
    payoff_episode_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX continuity_items_project ON continuity_items(project_id, status);

  ALTER TABLE clips ADD COLUMN reference_asset_ids_json TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE script_versions (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    draft_json TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX script_versions_episode ON script_versions(episode_id, created_at);
  `
]

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db!.exec(MIGRATIONS[v])
      db!.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
