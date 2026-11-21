import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { estimateWordTimings } from '@shared/captions'
import { anchorPoint } from '@shared/overlays'
import { NO_MUSIC, NO_MUSIC_DIALOG, modelSupportsNativeAudio } from '@shared/higgsfield'
import { collectReferenceSheets, compileClipPrompt, compileClipVideoPrompt } from '@shared/prompts'
import { computeClipImageBasisHash, computeClipVideoBasisHash, computeDerivativeSheetBasisHash } from '@shared/hash'
import {
  MAX_EPISODE_DURATION_SEC,
  MAX_SERIES_DURATION_SEC,
  MIN_EPISODE_DURATION_SEC,
  checkClipImagePrerequisites,
  checkClipVideoPrerequisites,
  clipImageBasis,
  getClipImageStatus,
  getClipVideoStatus,
  getDerivativeSheetStatus,
  planBatch,
  planBatchSheets,
  referenceLimit,
  videoSecondsFor,
  checkScriptDoctor,
  computeEpisodeRhythm,
  validateSpeechDuration
} from '@shared/validation'
import { EXPORT_PRESETS, getExportPreset, validatePresetDuration } from '@shared/exportPresets'
import { checkLockCompliance } from '@shared/lock'
import { resolveActive } from '@shared/providers'
import { exportDeliveryPackage } from './package'
import { startExport } from './exporter'
import { assetAbsPath, binPath } from './paths'
import { extractAudio, probeDurationMs, probeHasAudio } from './services/audio'
import { parts } from './narration'
import {
  acceptLorebookCandidates,
  confirmEpisodeScriptRepo,
  createContinuityItem,
  createEpisode,
  createProject,
  getBundle,
  getClip,
  getPlanProgress,
  insertAsset,
  listContinuityItems,
  listEpisodes,
  listScriptVersions,
  patchClip,
  removeAllEpisodes,
  replaceStory,
  saveScriptVersion,
  saveSnapshot,
  setCharacterSheet,
  setDerivativeSheet,
  setLocationSheet,
  setPropSheet,
  touchProject,
  updateContinuityItem,
  updateDerivative
} from './repo'
import { getSettings, setSettings } from './settings'
import { needsScriptDraft, planEpisodes, splitEpisodeTarget, writePrompts } from './story'
import { batchEstimate, batchEstimateSheets, derivativeWaveBlocker, extractVideoDialogueAudio, generateMissingImages, seriesProgress, setActiveAsset } from './generation'
import { recordCheck, setSecret } from './secrets'
import type { ApiProvider, Asset, Character, Clip, DraftShot, EpisodeScriptDraft, ExportOptions } from '@shared/types'

/**
 * Real speech for the demo clips (Windows' built-in English voice) with estimated caption timings, so
 * Whisper caption syncing can be tested without a TTS key.
 */
async function addDemoSpeech(projectId: string): Promise<void> {
  const lines = [
    'In the year thirteen thirty six, the sun set over the capital of Majapahit.',
    'Before Queen Tribhuwana, Gajah Mada was named the prime minister.',
    'He swore he would not rest until the whole archipelago was united.',
    'The ministers laughed at him, but history proved him right.'
  ]
  const b = getBundle(projectId)
  for (const [i, c] of b.clips.entries()) {
    const text = lines[i % lines.length]
    const rel = `audio/speech-${i}.wav`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${abs.replace(/'/g, "''")}'); $s.Speak('${text}'); $s.Dispose()`
    // stdin must be closed, or PowerShell waits on it and blocks the main process.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    const ms = await probeDurationMs(abs)
    const asset = insertAsset({
      projectId,
      clipId: c.id,
      kind: 'audio',
      provider: 'demo',
      prompt: text,
      localPath: rel,
      durationMs: ms,
      meta: { words: estimateWordTimings(text, ms / 1000), estimatedTimings: true }
    })
    patchClip(c.id, { audioAssetId: asset.id, durationMs: ms + 400 })
  }
  const fresh = getBundle(projectId)
  saveSnapshot({
    project: fresh.project,
    episodeId: fresh.episode!.id,
    characters: fresh.characters,
    clips: fresh.clips.map((c, i) => ({ ...c, narration: lines[i % lines.length] }))
  })
}

/** A flat test logo and a two-line caption, to check overlay placement in the preview and in the export. */
function addDemoOverlays(projectId: string): void {
  const rel = 'overlays/demo-logo.png'
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  execFileSync(binPath(ffmpegStatic!), ['-y', '-f', 'lavfi', '-i', 'color=c=0xE4572E:s=360x120', '-frames:v', '1', abs], { windowsHide: true })
  const logo = insertAsset({ projectId, kind: 'overlay', provider: 'demo', prompt: 'logo-demo.png', localPath: rel, width: 360, height: 120 })
  const b = getBundle(projectId)
  saveSnapshot({
    project: {
      ...b.project,
      editor: {
        ...b.project.editor,
        overlays: [
          { id: 'ov-logo', kind: 'image', assetId: logo.id, anchor: 9, ...anchorPoint(9, 16 / 9), width: 0.16, opacity: 0.85, start: 0, end: null },
          {
            id: 'ov-text',
            kind: 'text',
            text: 'ReelStar\nshort drama ai',
            anchor: 5,
            x: 0.5,
            y: 0.42,
            size: 0.065,
            color: '#FFFFFF',
            style: 'box',
            bold: true,
            start: 0.5,
            end: 12
          }
        ]
      }
    },
    episodeId: b.episode!.id,
    characters: b.characters,
    clips: b.clips
  })
}

/** Moving test videos on every clip (the first with a strong zoom on top), to test camera over AI video. */
function addDemoVideos(projectId: string): void {
  const ff = binPath(ffmpegStatic!)
  for (const [i, c] of getBundle(projectId).clips.entries()) {
    const rel = `videos/demo-${i}.mp4`
    const abs = assetAbsPath(projectId, rel)
    mkdirSync(dirname(abs), { recursive: true })
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=24:d=6`, '-vf', `hue=h=${i * 50}`, '-pix_fmt', 'yuv420p', abs], { windowsHide: true })
    const v = insertAsset({ projectId, clipId: c.id, kind: 'video', provider: 'demo', localPath: rel, durationMs: 6000, width: 1280, height: 720 })
    patchClip(c.id, { videoAssetId: v.id, motionType: 'video', ...(i === 0 ? { videoCamera: 'zoomin', videoStrength: 'kuat' } : {}) })
  }
}

/** Builds a small project from synthetic media so storyboard, editor and export can be tested without API keys. */
function seedDemo(): string {
  const ff = binPath(ffmpegStatic!)
  const p = createProject({ synopsis: 'Demo: Gajah Mada dan Sumpah Palapa', durationSec: 30, styleId: 'premium_drama', language: 'id' })
  const lines = [
    { t: 'Senja di Majapahit', n: 'Tahun 1336. Senja turun di ibu kota Majapahit, dan istana bersiap untuk upacara penting.', cam: 'zoomin' },
    { t: 'Gajah Mada maju', n: 'Di tengah balairung, patih yang baru dilantik melangkah maju. Namanya Gajah Mada.', cam: 'panright' },
    { t: 'Sumpah Palapa', n: 'Aku tidak akan menikmati palapa, sebelum Nusantara bersatu.', cam: 'kenburns' },
    { t: 'Para menteri tertawa', n: 'Seisi ruangan tertawa, tapi sejarah membuktikan dia benar.', cam: 'shake' }
  ] as const
  replaceStory(
    p.id,
    'Demo Sumpah Palapa',
    [{ name: 'Gajah Mada', description: 'stickman patih with golden warrior headdress and red sash' }],
    lines.map((l) => ({
      title: l.t,
      story: l.t,
      narration: l.n,
      visualPrompt: l.t,
      durationMs: 5000,
      motionType: 'camera',
      cameraPreset: l.cam,
      motionStrength: 'sedang',
      videoPrompt: '',
      transition: 'fade',
      characterNames: ['Gajah Mada']
    }))
  )
  const b = getBundle(p.id)
  b.clips.forEach((clip, i) => {
    const img = `images/demo-${i}.png`
    const wav = `audio/demo-${i}.wav`
    mkdirSync(dirname(assetAbsPath(p.id, img)), { recursive: true })
    mkdirSync(dirname(assetAbsPath(p.id, wav)), { recursive: true })
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-vf', `hue=h=${i * 70}`, '-frames:v', '1', assetAbsPath(p.id, img)], { windowsHide: true })
    const sec = 3.2 + i * 0.4
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 60}:duration=${sec}`, '-ar', '24000', '-ac', '1', assetAbsPath(p.id, wav)], {
      windowsHide: true
    })
    const image = insertAsset({ projectId: p.id, clipId: clip.id, kind: 'image', provider: 'demo', localPath: img, width: 1920, height: 1080 })
    const audio = insertAsset({
      projectId: p.id,
      clipId: clip.id,
      kind: 'audio',
      provider: 'demo',
      prompt: clip.narration,
      localPath: wav,
      durationMs: Math.round(sec * 1000),
      meta: { words: estimateWordTimings(clip.narration, sec), estimatedTimings: true }
    })
    patchClip(clip.id, { imageAssetId: image.id, audioAssetId: audio.id, durationMs: Math.round(sec * 1000) + 400 })
    if (i === 0) touchProject(p.id, { coverAssetId: image.id })
  })
  const music = 'music/demo.wav'
  mkdirSync(dirname(assetAbsPath(p.id, music)), { recursive: true })
  execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=30', '-ar', '44100', assetAbsPath(p.id, music)], { windowsHide: true })
  const m = insertAsset({ projectId: p.id, kind: 'music', provider: 'demo', prompt: 'demo-musik.wav', localPath: music, durationMs: 30000 })
  const fresh = getBundle(p.id)
  saveSnapshot({
    project: { ...fresh.project, step: 4, status: 'editing', editor: { ...fresh.project.editor, musicAssetId: m.id } },
    episodeId: fresh.episode!.id,
    characters: fresh.characters,
    clips: fresh.clips
  })
  return p.id
}

/** Builds a project with 2 episodes, each with 3 clips, to test multi-episode isolation. */
export function seedEpisodes(): { projectId: string; ep1Id: string; ep2Id: string } {
  const p = createProject({ synopsis: 'Demo Multi-Episode Drama', durationSec: 60, styleId: 'premium_drama', language: 'id' })
  const episodes = listEpisodes(p.id)
  const ep1 = episodes[0]
  const ep2 = createEpisode(p.id, { title: 'Episode 2: Pengkhianatan' })

  replaceStory(
    p.id,
    'Episode 1: Awal Mula',
    [{ name: 'Pendekar', description: 'hero with sword' }],
    [
      { title: 'Ep 1 - Adegan 1', story: 'Pertemuan di kedai', narration: 'Kisah dimulai di kedai tua.', visualPrompt: 'Kedai tua', durationMs: 4000, motionType: 'camera', cameraPreset: 'zoomin', motionStrength: 'sedang', videoPrompt: '', transition: 'fade', characterNames: ['Pendekar'] },
      { title: 'Ep 1 - Adegan 2', story: 'Tantangan musuh', narration: 'Musuh datang menantang.', visualPrompt: 'Musuh di pintu', durationMs: 4000, motionType: 'camera', cameraPreset: 'panright', motionStrength: 'sedang', videoPrompt: '', transition: 'fade', characterNames: ['Pendekar'] },
      { title: 'Ep 1 - Adegan 3', story: 'Pertarungan sengit', narration: 'Pedang beradu cepat.', visualPrompt: 'Pertarungan', durationMs: 4000, motionType: 'camera', cameraPreset: 'shake', motionStrength: 'sedang', videoPrompt: '', transition: 'fade', characterNames: ['Pendekar'] }
    ],
    ep1.id
  )

  replaceStory(
    p.id,
    'Episode 2: Pengkhianatan',
    [{ name: 'Pendekar', description: 'hero with sword' }],
    [
      { title: 'Ep 2 - Adegan 1', story: 'Malam hening', narration: 'Malam itu terasa sunyi.', visualPrompt: 'Hutan malam', durationMs: 4000, motionType: 'camera', cameraPreset: 'kenburns', motionStrength: 'sedang', videoPrompt: '', transition: 'fade', characterNames: ['Pendekar'] },
      { title: 'Ep 2 - Adegan 2', story: 'Jebakan rahasia', narration: 'Ternyata ada jebakan.', visualPrompt: 'Jebakan tali', durationMs: 4000, motionType: 'camera', cameraPreset: 'zoomin', motionStrength: 'sedang', videoPrompt: '', transition: 'fade', characterNames: ['Pendekar'] },
      { title: 'Ep 2 - Adegan 3', story: 'Pelarian heroik', narration: 'Pendekar meloloskan diri.', visualPrompt: 'Melompati pagar', durationMs: 4000, motionType: 'camera', cameraPreset: 'panleft', motionStrength: 'sedang', videoPrompt: '', transition: 'fade', characterNames: ['Pendekar'] }
    ],
    ep2.id
  )

  return { projectId: p.id, ep1Id: ep1.id, ep2Id: ep2.id }
}

/** Verifies that editing, saving, or deleting clips in Episode 2 does not bleed into Episode 1. */
export function checkIsolation(projectId: string): boolean {
  const eps = listEpisodes(projectId)
  if (eps.length < 2) throw new Error('checkIsolation butuh minimal 2 episode')
  const [ep1, ep2] = eps

  const b1 = getBundle(projectId, ep1.id)
  const b2 = getBundle(projectId, ep2.id)

  if (b1.clips.length !== 3 || b2.clips.length !== 3) {
    throw new Error(`Jumlah klip tidak sesuai: Ep 1 punya ${b1.clips.length}, Ep 2 punya ${b2.clips.length}`)
  }
  if (!b1.clips.every((c) => c.episodeId === ep1.id)) {
    throw new Error('Ada klip di bundle Episode 1 dengan episode_id yang salah')
  }
  if (!b2.clips.every((c) => c.episodeId === ep2.id)) {
    throw new Error('Ada klip di bundle Episode 2 dengan episode_id yang salah')
  }

  // Mutate Episode 2: remove one clip and update another
  const remainingEp2Clips = b2.clips.slice(0, 2).map((c, i) => ({ ...c, title: `Ep 2 Modif ${i + 1}` }))
  saveSnapshot({
    project: b2.project,
    episodeId: ep2.id,
    characters: b2.characters,
    clips: remainingEp2Clips
  })

  // Verify Episode 1 is completely untouched
  const b1After = getBundle(projectId, ep1.id)
  if (b1After.clips.length !== 3) {
    throw new Error(`Isolasi bocor! Klip Episode 1 berubah jadi ${b1After.clips.length} setelah simpan Episode 2`)
  }
  if (b1After.clips.some((c) => c.title.includes('Modif'))) {
    throw new Error('Isolasi bocor! Perubahan klip Episode 2 tercampur ke Episode 1')
  }

  // Verify Episode 2 reflects its mutation
  const b2After = getBundle(projectId, ep2.id)
  if (b2After.clips.length !== 2) {
    throw new Error(`Episode 2 gagal diperbarui: klip sekarang ${b2After.clips.length}`)
  }

  // Timeline settings (music, SFX, framing) belong to one episode; the caption style is shared as a template.
  const sfxItem = { id: 'sfx-ep2', assetId: 'sfx-asset', name: 'uji', startMs: 500, durationMs: 800, volumeDb: 0 }
  const ep2Editor = { ...b2After.project.editor, musicAssetId: 'music-ep2', sfx: [sfxItem], captionStyle: b2After.project.editor.captionStyle }
  saveSnapshot({
    project: { ...b2After.project, editor: ep2Editor },
    episodeId: ep2.id,
    episodeEditor: ep2Editor,
    characters: b2After.characters,
    clips: b2After.clips
  })
  const e1 = getBundle(projectId, ep1.id).project.editor
  const e2 = getBundle(projectId, ep2.id).project.editor
  if (e1.musicAssetId === 'music-ep2' || (e1.sfx ?? []).some((x) => x.id === 'sfx-ep2')) {
    throw new Error('Isolasi editor bocor! Musik/SFX Episode 2 muncul di Episode 1')
  }
  if (e2.musicAssetId !== 'music-ep2' || !(e2.sfx ?? []).some((x) => x.id === 'sfx-ep2')) {
    throw new Error('Pengaturan editor Episode 2 tidak tersimpan')
  }
  const ep3 = createEpisode(projectId, { title: 'Ep 3 kosong' })
  const e3 = getBundle(projectId, ep3.id).project.editor
  if (e3.musicAssetId || (e3.sfx ?? []).length || e3.clipFraming) {
    throw new Error('Episode baru mewarisi musik/SFX/framing episode lain')
  }
  getBundle(projectId, ep1.id)

  console.log('[checkIsolation] Isolasi klip dan editor per episode BERHASIL')
  return true
}

/** Verifies Phase 3 script planning, validation, confirmation, and prompt writing. */
export async function checkPhase3(projectId: string): Promise<boolean> {
  const eps = listEpisodes(projectId)
  if (!eps.length) throw new Error('checkPhase3 butuh episode yang sudah di-seed')
  const ep = eps[0]

  // Test 1: Reject unmapped entity
  const invalidDraft: EpisodeScriptDraft = {
    shots: [
      {
        title: 'Shot 1',
        sourceExcerpt: 'Hook',
        visualAction: 'Kemunculan musuh asing',
        characters: ['KarakterMisteriusTakDikenal'],
        costumes: {},
        location: null,
        props: [],
        speaker: 'KarakterMisteriusTakDikenal',
        text: 'Siapa kalian?',
        emotion: 'marah',
        framing: 'close_up',
        durationSec: 4
      }
    ],
    newAssets: [],
    createdAt: Date.now()
  }

  let rejected = false
  try {
    confirmEpisodeScriptRepo(projectId, ep.id, invalidDraft)
  } catch (err) {
    if ((err as Error).message.includes('belum terdaftar')) {
      rejected = true
    }
  }
  if (!rejected) {
    throw new Error('confirmEpisodeScriptRepo GAGAL menolak nama karakter yang belum terdaftar!')
  }

  // Test 2: Successful confirmation with proposed newAssets
  const validDraft: EpisodeScriptDraft = {
    shots: [
      {
        title: 'Shot 1 - Pembukaan',
        sourceExcerpt: 'Adegan 1',
        visualAction: 'Pendekar mencabut pedang di depan gerbang istana',
        characters: ['Pendekar'],
        costumes: { Pendekar: 'Jubah Naga' },
        location: 'Gerbang Istana Majapahit',
        props: ['Pedang Pusaka'],
        speaker: 'Pendekar',
        text: 'Demi kehormatan kerajaan!',
        emotion: 'tegas',
        framing: 'close_up',
        durationSec: 5
      },
      {
        title: 'Shot 2 - Jawaban Sekutu',
        sourceExcerpt: 'Adegan 2',
        visualAction: 'Panglima Wira mengangguk mantap memberi hormat',
        characters: ['Panglima Wira'],
        costumes: {},
        location: 'Gerbang Istana Majapahit',
        props: [],
        speaker: 'Panglima Wira',
        text: 'Pasukan kami siap bergerak.',
        emotion: 'dingin',
        framing: 'medium shot',
        durationSec: 4
      }
    ],
    newAssets: [
      {
        kind: 'character',
        name: 'Panglima Wira',
        description: 'Panglima perang perkasa',
        action: 'create',
        reason: 'Tokoh baru dalam cerita'
      },
      {
        kind: 'derivative',
        name: 'Jubah Naga',
        description: 'Jubah tempur bersulam naga',
        action: 'derivative',
        target: 'Pendekar',
        reason: 'Varian kostum Pendekar'
      },
      {
        kind: 'location',
        name: 'Gerbang Istana Majapahit',
        description: 'Gerbang utama bata merah',
        action: 'create',
        reason: 'Lokasi pertemuan'
      },
      {
        kind: 'prop',
        name: 'Pedang Pusaka',
        description: 'Pedang berukir pamor emas',
        action: 'create',
        reason: 'Senjata utama'
      }
    ],
    createdAt: Date.now()
  }

  const bundle = confirmEpisodeScriptRepo(projectId, ep.id, validDraft)

  // Verify bundle & database state
  if (bundle.clips.length !== 2) {
    throw new Error(`Klip hasil konfirmasi salah: diharapkan 2, didapat ${bundle.clips.length}`)
  }
  if (!bundle.characters.some((c) => c.name === 'Panglima Wira')) {
    throw new Error('Aset karakter baru "Panglima Wira" gagal didaftarkan!')
  }
  const updatedEps = listEpisodes(projectId)
  const updatedEp = updatedEps.find((e) => e.id === ep.id)
  if (updatedEp?.status !== 'script') {
    throw new Error(`Status episode seharusnya 'script', didapat '${updatedEp?.status}'`)
  }
  if (updatedEp.scriptDraft !== null && updatedEp.scriptDraft !== undefined) {
    throw new Error('Draf naskah seharusnya dibersihkan setelah konfirmasi!')
  }

  // Test 3: writePrompts
  const promptedBundle = await writePrompts(projectId, ep.id)
  const pClips = promptedBundle.clips
  if (!pClips[0].visualPrompt || !pClips[0].videoPrompt) {
    throw new Error('writePrompts gagal mengisi visualPrompt dan videoPrompt!')
  }
  if (!pClips[0].visualPrompt.includes('Pendekar') || !pClips[0].visualPrompt.includes('Gerbang Istana Majapahit')) {
    throw new Error(`visualPrompt tidak menyertakan entitas: ${pClips[0].visualPrompt}`)
  }

  // Test 4: writePrompts fills only empty prompts and keeps the creator's edits
  patchClip(pClips[0].id, { visualPrompt: 'PROMPT BUATAN KREATOR', videoPrompt: '' })
  const kept = (await writePrompts(projectId, ep.id)).clips[0]
  if (kept.visualPrompt !== 'PROMPT BUATAN KREATOR') throw new Error('writePrompts menimpa prompt gambar yang sudah diedit')
  if (!kept.videoPrompt) throw new Error('writePrompts tidak mengisi prompt video yang kosong')

  const base = validDraft.shots[0]
  const expectReject = (label: string, draft: EpisodeScriptDraft, needle: string): void => {
    try {
      confirmEpisodeScriptRepo(projectId, ep.id, draft)
    } catch (err) {
      if ((err as Error).message.includes(needle)) return
      throw new Error(`${label}: ditolak dengan pesan lain: ${(err as Error).message}`)
    }
    throw new Error(`${label}: seharusnya ditolak`)
  }
  const one = (shot: Partial<EpisodeScriptDraft['shots'][number]>, newAssets: EpisodeScriptDraft['newAssets'] = []): EpisodeScriptDraft => ({
    shots: [{ ...base, ...shot }],
    newAssets,
    createdAt: Date.now()
  })

  // Test 5: a speaker must be on screen; unknown costumes and orphan variants are refused
  expectReject('Pembicara tak terlihat', one({ characters: ['Panglima Wira'], speaker: 'Pendekar' }), 'harus terlihat')
  expectReject('Kostum tak terdaftar', one({ costumes: { Pendekar: 'Baju Zirah Emas' } }), 'kostum "Baju Zirah Emas"')
  expectReject(
    'Varian tanpa karakter',
    one({}, [{ kind: 'derivative', name: 'Jubah Perak', description: '', action: 'create', reason: '' }]),
    'Jubah Perak'
  )
  if (getBundle(projectId, ep.id).clips.length !== 2) throw new Error('Konfirmasi yang ditolak mengubah klip')

  // Test 6: narration has no speaker character; "default" costume keeps the base sheet
  const narrated = confirmEpisodeScriptRepo(projectId, ep.id, one({ speaker: 'Narator', text: 'Malam itu semuanya berubah.', costumes: { Pendekar: 'default' } }))
  if (narrated.clips[0].speakerId !== null) throw new Error('Narator dianggap tokoh')
  if (narrated.characters.some((c) => c.name.toLowerCase() === 'narator')) throw new Error('Karakter "Narator" ikut dibuat')
  if (Object.keys(narrated.clips[0].costumeIds).length) throw new Error('Kostum "default" seharusnya memakai lembar dasar')

  // Test 7: re-planning never throws away an episode that has clips, and needs no AI call to refuse
  let guarded = false
  try {
    await planEpisodes({ projectId, sourceText: 'Cerita uji.', mode: 'replace' })
  } catch (err) {
    guarded = (err as Error).message.includes('sudah punya klip')
  }
  if (!guarded) throw new Error('Rencanakan ulang tidak menolak episode yang sudah punya klip')
  let noProgress = false
  try {
    await planEpisodes({ projectId, sourceText: 'Cerita uji.', mode: 'continue' })
  } catch (err) {
    noProgress = (err as Error).message.includes('Belum ada catatan')
  }
  if (!noProgress) throw new Error('Lanjutkan perencanaan tanpa catatan progres seharusnya ditolak')

  console.log('[checkPhase3] Semua pengujian backend Fase 3 BERHASIL!')
  return true
}

async function checkPhase4(projectId: string): Promise<boolean> {
  const episodes = listEpisodes(projectId)
  const ep = episodes[0]
  if (!ep) throw new Error('Episode tidak ditemukan')

  // Run checkPhase3 first to ensure lorebook entities & clips exist
  await checkPhase3(projectId)

  const bundle = getBundle(projectId, ep.id)
  const clip = bundle.clips[0]
  const project = bundle.project

  // 1. Test prompts compilation
  const prompt = compileClipPrompt({
    project,
    clip,
    characters: bundle.characters,
    derivatives: bundle.derivatives,
    locations: bundle.locations,
    props: bundle.props
  })
  if (!prompt.includes('Pendekar') || !prompt.includes('Wardrobe:') || !prompt.includes('Setting:')) {
    throw new Error(`compileClipPrompt tidak menghasilkan blok yang diharapkan: ${prompt}`)
  }

  const vidPrompt = compileClipVideoPrompt(project, clip, bundle.characters)
  if (!vidPrompt.endsWith(NO_MUSIC)) {
    throw new Error(`compileClipVideoPrompt harus diakhiri dengan NO_MUSIC: ${vidPrompt}`)
  }

  // 2. Test 4-tier reference collecting
  const refs = collectReferenceSheets(
    clip,
    bundle.characters,
    bundle.derivatives,
    bundle.locations,
    bundle.props
  )
  console.log(`[checkPhase4] Prompt compilation OK, refs count: ${refs.length}`)

  // 3. Prerequisites follow the model: sheets are required only when the model takes references
  const flowCtx = {
    characters: bundle.characters,
    derivatives: bundle.derivatives,
    locations: bundle.locations,
    props: bundle.props,
    assets: bundle.assets,
    activeJobs: [],
    isFlow2Api: true
  }
  const noRefProject = { ...project, imageModel: 'higgsfield-ai/soul/v2/standard' }
  if (referenceLimit(noRefProject, {}) !== 0) throw new Error('Soul seharusnya tidak memakai lembar referensi')
  if (!checkClipImagePrerequisites(clip, noRefProject, { ...flowCtx, isFlow2Api: false }).ok) {
    throw new Error('Model tanpa referensi tidak boleh mewajibkan lembar')
  }
  const imgPrereq = checkClipImagePrerequisites(clip, project, flowCtx)
  if (imgPrereq.ok || !imgPrereq.blockers.some((b) => b.includes('lembar'))) {
    throw new Error(`Flow2API (pakai referensi) seharusnya mewajibkan lembar: ${imgPrereq.blockers.join(', ')}`)
  }
  if (getClipImageStatus(clip, project, flowCtx).status !== 'blocked') throw new Error("Status gambar tanpa lembar harus 'blocked'")

  // 4. Basis hash: deterministic and sensitive to the prompt
  const hashArgs = { project, clip, characters: bundle.characters, derivatives: bundle.derivatives, locations: bundle.locations, props: bundle.props, refSheetAssetIds: [] }
  if (computeClipImageBasisHash(hashArgs) !== computeClipImageBasisHash(hashArgs)) throw new Error('computeClipImageBasisHash tidak deterministik!')
  if (computeClipImageBasisHash(hashArgs) === computeClipImageBasisHash({ ...hashArgs, clip: { ...clip, visualPrompt: clip.visualPrompt + ' detail' } })) {
    throw new Error('computeClipImageBasisHash tidak berubah saat prompt diubah!')
  }

  // 5. All-or-nothing batch while sheets are missing (Flow2API takes references)
  const before = getSettings().providers.visual.activeId
  setSettings({ providers: { ...getSettings().providers, visual: { activeId: 'flow2api', models: getSettings().providers.visual.models } } })
  try {
    const estimate = await batchEstimate(projectId, ep.id, 'image', false)
    if (estimate.canRun || !estimate.items.some((it) => it.status === 'blocked')) throw new Error('batchEstimate seharusnya terblokir')
    if (estimate.totalCredits !== null) throw new Error('Flow2API tidak memakai kredit Higgsfield; total harus kosong')
    let rejected = false
    try {
      generateMissingImages(projectId, ep.id, false)
    } catch (err) {
      rejected = (err as Error).message.includes('terblokir')
    }
    if (!rejected) throw new Error('generateMissingImages seharusnya menolak batch (semua atau tidak sama sekali)')
  } finally {
    setSettings({ providers: { ...getSettings().providers, visual: { activeId: before, models: getSettings().providers.visual.models } } })
  }

  // 6. A freshly made image is current: give every entity a sheet, then store an image with the basis
  //    generation would write. Then legacy results (no basis) count as current too.
  const fakeImage = (extra: Parameters<typeof insertAsset>[0]['meta'] = {}): string =>
    insertAsset({ projectId, kind: 'image', localPath: 'images/uji.png', meta: extra }).id
  for (const c of bundle.characters) setCharacterSheet(c.id, fakeImage())
  for (const d of bundle.derivatives) setDerivativeSheet(d.id, fakeImage())
  for (const l of bundle.locations) setLocationSheet(l.id, fakeImage())
  for (const p of bundle.props) setPropSheet(p.id, fakeImage())
  const withSheets = getBundle(projectId, ep.id)
  const sheetCtx = { ...flowCtx, characters: withSheets.characters, derivatives: withSheets.derivatives, locations: withSheets.locations, props: withSheets.props, assets: withSheets.assets }
  const target = withSheets.clips[0]
  if (getClipImageStatus(target, project, sheetCtx).status !== 'missing') throw new Error('Dengan semua lembar, status harus missing')
  const { basisHash } = clipImageBasis(target, project, sheetCtx)
  patchClip(target.id, { imageAssetId: fakeImage({ basisHash }) })
  let after = getBundle(projectId, ep.id)
  const freshCtx = { ...sheetCtx, assets: after.assets }
  if (getClipImageStatus(after.clips[0], project, freshCtx).status !== 'current') throw new Error('Gambar yang baru dibuat harus current, bukan basi')
  const soulCtx = { ...freshCtx, isFlow2Api: false }
  const soulBasis = clipImageBasis(after.clips[0], noRefProject, soulCtx).basisHash
  patchClip(target.id, { imageAssetId: fakeImage({ basisHash: soulBasis }) })
  after = getBundle(projectId, ep.id)
  if (getClipImageStatus(after.clips[0], noRefProject, { ...soulCtx, assets: after.assets }).status !== 'current') {
    throw new Error('Gambar Higgsfield tanpa referensi harus current setelah dibuat')
  }
  patchClip(target.id, { imageAssetId: fakeImage() })
  after = getBundle(projectId, ep.id)
  if (getClipImageStatus(after.clips[0], project, { ...freshCtx, assets: after.assets }).status !== 'current') {
    throw new Error('Gambar lama tanpa basisHash harus dianggap current')
  }
  patchClip(target.id, { imageAssetId: fakeImage({ basisHash: 'lama' }) })
  after = getBundle(projectId, ep.id)
  if (getClipImageStatus(after.clips[0], project, { ...freshCtx, assets: after.assets }).status !== 'stale') {
    throw new Error('Gambar dengan basis berbeda harus basi')
  }

  // 7. Video length is fitted to the model instead of blocking; a blocked clip that already has a result
  //    does not stop a batch of missing ones.
  const videoProject = { ...project, videoModel: 'veo-3.1-fast-i2v' }
  const vctx = { ...freshCtx, assets: after.assets }
  const fiveSec = { ...after.clips[0], durationMs: 5000 }
  if (videoSecondsFor(videoProject, fiveSec, vctx).seconds !== 6) throw new Error('Klip 5 dtk seharusnya dibuat jadi video 6 dtk')
  if (getClipVideoStatus(fiveSec, videoProject, vctx).status !== 'missing') throw new Error('Klip 5 dtk tidak boleh terblokir karena durasi')
  const dialog = { ...fiveSec, speakerId: fiveSec.characterIds[0], narration: Array(60).fill('kata').join(' ') }
  if (getClipVideoStatus(dialog, { ...videoProject, dialogAudio: 'video' }, vctx).status !== 'blocked') {
    throw new Error('Dialog yang lebih panjang dari video terpanjang harus terblokir')
  }
  const done = { status: { status: 'blocked' as const, blockers: ['x'], basisHash: '', hasResult: true } }
  const todo = { status: { status: 'missing' as const, blockers: [], basisHash: '', hasResult: false } }
  if (planBatch([done, todo], false).blocking.length !== 0) throw new Error('Klip yang sudah punya hasil tidak boleh membatalkan batch')
  if (planBatch([done, todo], true).blocking.length !== 1) throw new Error('Saat membuat ulang yang basi, klip terblokir harus membatalkan batch')

  // 8. Tugas 25: Per-voice take grouping in parts()
  const mockChars: Character[] = [
    { id: 'char-budi', name: 'Budi', ttsProvider: 'gemini', ttsVoice: 'BudiVoice' } as Character
  ]
  const mockClips: Clip[] = [
    { id: 'c1', narration: 'Narasi adegan satu', speakerId: null } as Clip,
    { id: 'c2', narration: 'Halo apa kabar', speakerId: 'char-budi' } as Clip,
    { id: 'c3', narration: 'Narasi adegan dua', speakerId: null } as Clip,
    { id: 'c4', narration: 'Kabar baik sekali', speakerId: 'char-budi' } as Clip
  ]
  const groupedTakes = parts(mockClips, 'gemini', mockChars, 'Charon')
  if (groupedTakes.length !== 2) throw new Error(`parts() seharusnya mengelompokkan 2 kelompok suara, didapat: ${groupedTakes.length}`)
  const g0Ids = groupedTakes[0].map((c) => c.id)
  const g1Ids = groupedTakes[1].map((c) => c.id)
  const narratorTogether = (g0Ids.includes('c1') && g0Ids.includes('c3')) || (g1Ids.includes('c1') && g1Ids.includes('c3'))
  const charTogether = (g0Ids.includes('c2') && g0Ids.includes('c4')) || (g1Ids.includes('c2') && g1Ids.includes('c4'))
  if (!narratorTogether || !charTogether) throw new Error('parts() harus mengumpulkan klip per suara ke dalam satu take kontinu')

  // 9. Tugas 23: nativeAudio catalog flag, dialogue ending, and prerequisites check
  if (!modelSupportsNativeAudio('veo-3.1-fast-i2v', true)) throw new Error('Veo 3.1 Fast I2V harus mendukung nativeAudio')
  if (!modelSupportsNativeAudio('veo-3.1-lite-i2v', true)) throw new Error('Veo 3.1 Lite I2V harus mendukung nativeAudio')
  if (modelSupportsNativeAudio('omni-1.1-flash', true)) throw new Error('Omni 1.1 Flash tidak boleh mendukung nativeAudio')

  const omniProject = { ...videoProject, videoModel: 'omni-1.1-flash', dialogAudio: 'video' as const }
  const dialogClip = { ...after.clips[0], speakerId: after.clips[0].characterIds[0], narration: 'Halo dunia' }
  const omniPrereq = checkClipVideoPrerequisites(dialogClip, omniProject, { ...vctx, isFlow2Api: true })
  if (omniPrereq.ok || !omniPrereq.blockers.some((b) => b.includes('tidak mendukung dialog bersuara'))) {
    throw new Error('checkClipVideoPrerequisites harus memblokir klip dialog pada model video tanpa audio')
  }

  const dialogPrompt = compileClipVideoPrompt(omniProject, dialogClip, bundle.characters)
  if (!dialogPrompt.includes(NO_MUSIC_DIALOG)) {
    throw new Error(`compileClipVideoPrompt untuk dialog video harus memuat NO_MUSIC_DIALOG: ${dialogPrompt}`)
  }

  // 10. Tugas 24: Audio extraction from video to clip audio asset
  const tmpVideo = join(app.getPath('temp'), `reelstar-test-dialog-${Date.now()}.mp4`)
  const ff = binPath(ffmpegStatic!)
  execFileSync(ff, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-c:v', 'mpeg4',
    '-c:a', 'aac',
    '-t', '1',
    tmpVideo
  ], { windowsHide: true })

  const hasAudioStream = await probeHasAudio(tmpVideo)
  if (!hasAudioStream) throw new Error('probeHasAudio gagal mendeteksi stream audio pada video uji')

  // Direct test of extractAudio
  const tmpWav = join(app.getPath('temp'), `reelstar-test-extract-${Date.now()}.wav`)
  await extractAudio(tmpVideo, tmpWav)
  const probeWavMs = await probeDurationMs(tmpWav)
  if (probeWavMs < 500) throw new Error('extractAudio menghasilkan file audio dengan durasi tidak valid')

  const testClip = after.clips[0]
  const speakerId = testClip.characterIds[0] ?? bundle.characters[0]?.id
  saveSnapshot({ ...bundle, episodeId: ep.id, project: { ...bundle.project, dialogAudio: 'video' } })
  patchClip(testClip.id, { speakerId, narration: 'Satu dua tiga empat', durationMs: 1000 })

  // A generated dialogue video lives in the project folder like any other asset: 3 s, with sound.
  const addVideo = (withSound: boolean): Asset => {
    const rel = `videos/uji-dialog-${randomUUID()}.mp4`
    const abs = assetAbsPath(project.id, rel)
    mkdirSync(dirname(abs), { recursive: true })
    const input = withSound ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3'] : []
    execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=3', ...input, '-c:v', 'mpeg4', ...(withSound ? ['-c:a', 'aac'] : ['-an']), '-t', '3', abs], { windowsHide: true })
    return insertAsset({ projectId: project.id, clipId: testClip.id, kind: 'video', localPath: rel, durationMs: 3000 })
  }
  const video = addVideo(true)
  patchClip(testClip.id, { videoAssetId: video.id })

  const extractedAsset = await extractVideoDialogueAudio(project.id, testClip.id, video)
  if (!extractedAsset) throw new Error('extractVideoDialogueAudio gagal menghasilkan aset audio')
  if (extractedAsset.kind !== 'audio' || extractedAsset.provider !== 'video' || extractedAsset.meta.source !== 'video') {
    throw new Error(`Aset hasil ekstraksi tidak valid: kind=${extractedAsset.kind}, provider=${extractedAsset.provider}`)
  }
  if (extractedAsset.meta.videoAssetId !== video.id) throw new Error('Suara hasil ekstraksi harus mencatat video asalnya')
  // The voice is the final audio of the clip: it must keep full quality, not Whisper's 16 kHz mono.
  const info = spawnSync(ff, ['-hide_banner', '-i', assetAbsPath(project.id, extractedAsset.localPath)], { encoding: 'utf8', windowsHide: true }).stderr
  if (!/48000 Hz, (stereo|2 channels)/.test(info)) throw new Error(`Suara dialog harus 48 kHz stereo: ${info.split('\n').find((l) => l.includes('Audio:'))}`)

  const patchedClip = getClip(testClip.id)
  if (patchedClip.audioAssetId !== extractedAsset.id) throw new Error('Clip audioAssetId harus mengarah ke aset audio yang diekstrak')
  if (patchedClip.durationMs !== 3000) throw new Error(`Klip dialog harus ikut panjang video (3000 ms), didapat ${patchedClip.durationMs}`)

  // Picking another video from history swaps the voice only when that video has its own extracted voice.
  const silent = addVideo(false)
  const none = await extractVideoDialogueAudio(project.id, testClip.id, silent)
  if (none) throw new Error('Video tanpa suara tidak boleh menghasilkan aset audio')
  const silentMeta = getBundle(projectId, ep.id).assets.find((a) => a.id === silent.id)?.meta
  if (typeof silentMeta?.dialogAudioError !== 'string') throw new Error('Video tanpa suara harus dicatat alasannya di aset video')
  await setActiveAsset(testClip.id, silent.id)
  if (getClip(testClip.id).audioAssetId !== extractedAsset.id) throw new Error('Video tanpa suara pasangan tidak boleh mengganti suara klip')
  patchClip(testClip.id, { audioAssetId: null })
  await setActiveAsset(testClip.id, video.id)
  if (getClip(testClip.id).audioAssetId !== extractedAsset.id) throw new Error('Memilih video lama harus mengembalikan suara pasangannya')

  // The video stays current after the clip took the video's length (the hash uses the requested length).
  const dialogProject = { ...getBundle(projectId, ep.id).project, videoModel: 'veo-3.1-fast-i2v', dialogAudio: 'video' as const }
  const beforeClip = { ...getClip(testClip.id), durationMs: 2500 }
  const askCtx = { ...vctx, assets: getBundle(projectId, ep.id).assets }
  const requested = videoSecondsFor(dialogProject, beforeClip, askCtx).seconds
  const hash = computeClipVideoBasisHash({ project: dialogProject, clip: beforeClip, characters: askCtx.characters, seconds: requested })
  const stamped = insertAsset({ projectId: project.id, clipId: testClip.id, kind: 'video', localPath: video.localPath, durationMs: requested * 1000, meta: { basisHash: hash } })
  const grown = { ...beforeClip, videoAssetId: stamped.id, durationMs: requested * 1000 }
  if (getClipVideoStatus(grown, dialogProject, { ...askCtx, assets: getBundle(projectId, ep.id).assets }).status !== 'current') {
    throw new Error('Video dialog tidak boleh jadi basi hanya karena klip mengikuti panjang videonya')
  }
  console.log(`[checkPhase4] Ekstraksi audio video OK: asset ${extractedAsset.id}, durasi: ${extractedAsset.durationMs}ms`)

  // 11. Kriteria fase 4: editing a costume's prompt_change makes the variant sheet and the images wearing it stale.
  const lb = getBundle(projectId, ep.id)
  const deriv = lb.derivatives[0]
  if (!deriv) throw new Error('Butuh varian kostum dari checkPhase3')
  const wearer = lb.clips.find((c) => c.characterIds.includes(deriv.characterId)) ?? lb.clips[0]
  patchClip(wearer.id, { costumeIds: { [deriv.characterId]: deriv.id } })
  const ctxA = { ...flowCtx, characters: lb.characters, derivatives: lb.derivatives, locations: lb.locations, props: lb.props, assets: lb.assets }
  const worn = getClip(wearer.id)
  if (worn.costumeIds[deriv.characterId] !== deriv.id) throw new Error('patchClip gagal menyimpan costumeIds')
  patchClip(wearer.id, { imageAssetId: fakeImage({ basisHash: clipImageBasis(worn, project, ctxA).basisHash }) })
  const lbB = getBundle(projectId, ep.id)
  const ctxB = { ...ctxA, assets: lbB.assets }
  if (getClipImageStatus(getClip(wearer.id), project, ctxB).status !== 'current') throw new Error('Gambar berkostum harus current sebelum kostum diubah')
  const sheetBasis = (change: string): string =>
    computeDerivativeSheetBasisHash({ baseSheetAssetId: lb.characters.find((c) => c.id === deriv.characterId)?.sheetAssetId ?? null, promptChange: change, imageModel: project.imageModel })
  updateDerivative(deriv.id, { promptChange: `${deriv.promptChange} dengan sabuk emas` })
  const lbC = getBundle(projectId, ep.id)
  const ctxC = { ...ctxB, derivatives: lbC.derivatives, assets: lbC.assets }
  if (getClipImageStatus(getClip(wearer.id), project, ctxC).status !== 'stale') throw new Error('Mengubah prompt_change harus membuat gambar yang memakainya basi')
  if (sheetBasis(deriv.promptChange) === sheetBasis(lbC.derivatives.find((d) => d.id === deriv.id)!.promptChange)) {
    throw new Error('Mengubah prompt_change harus mengubah basis lembar varian')
  }
  const compiled = compileClipPrompt({ project, clip: getClip(wearer.id), characters: lbC.characters, derivatives: lbC.derivatives, locations: lbC.locations, props: lbC.props })
  if (!compiled.includes('sabuk emas') || (compiled.match(/^Wardrobe:/gm) ?? []).length !== 1) {
    throw new Error(`Prompt harus memakai kostum terbaru dari Lorebook, sekali saja: ${compiled}`)
  }

  console.log('[checkPhase4] Semua pengujian backend Fase 4 BERHASIL!')
  return true
}

export async function checkPhase6(projectId: string): Promise<boolean> {
  // 1. Run checkPhase4 first to ensure project has full entities
  await checkPhase4(projectId)
  console.log('[checkPhase6] Prasyarat Fase 4 terpenuhi')

  // 2. Target episode count & 1-hour series validation
  const b0 = getBundle(projectId)
  b0.project.targetEpisodeCount = 5
  saveSnapshot({
    project: b0.project,
    episodeId: b0.episode?.id ?? b0.episodes[0]!.id,
    characters: b0.characters,
    clips: b0.clips
  })
  const bUpdated = getBundle(projectId)
  if (bUpdated.project.targetEpisodeCount !== 5) {
    throw new Error(`targetEpisodeCount gagal disimpan: ${bUpdated.project.targetEpisodeCount}`)
  }

  // Verify duration limits
  if (MIN_EPISODE_DURATION_SEC !== 30 || MAX_EPISODE_DURATION_SEC !== 180 || MAX_SERIES_DURATION_SEC !== 3600) {
    throw new Error('Konstanta durasi tidak sesuai spesifikasi')
  }

  // 3. Lorebook batch planning & 2-wave execution
  const testItems = [
    { id: '1', status: { status: 'missing' as const, blockers: [], basisHash: 'a', hasResult: false } },
    { id: '2', status: { status: 'stale' as const, blockers: [], basisHash: 'b', hasResult: true } },
    { id: '3', status: { status: 'blocked' as const, blockers: ['error'], basisHash: 'c', hasResult: false } },
    { id: '4', status: { status: 'current' as const, blockers: [], basisHash: 'd', hasResult: true } }
  ]
  const p1 = planBatchSheets(testItems, false)
  if (p1.targets.length !== 1 || p1.blocking.length !== 1) throw new Error('planBatchSheets false gagal')
  const p2 = planBatchSheets(testItems, true)
  if (p2.targets.length !== 2 || p2.blocking.length !== 1) throw new Error('planBatchSheets true gagal')

  const estimate = await batchEstimateSheets(projectId, true)
  if (typeof estimate.canRun !== 'boolean' || !Array.isArray(estimate.items)) {
    throw new Error('batchEstimateSheets harus mengembalikan hasil estimasi valid')
  }
  const wave1Targets = estimate.items.filter((t) => t.kind !== 'derivative' && (t.status === 'missing' || t.status === 'stale'))
  const wave2Targets = estimate.items.filter((t) => t.kind === 'derivative' && (t.status === 'missing' || t.status === 'stale'))
  console.log(`[checkPhase6] Lorebook wave targets: wave1=${wave1Targets.length}, wave2=${wave2Targets.length}`)

  // 3b. Wave 2 rules: cancelling stops every variant; a failed or missing base sheet skips with a reason.
  if (derivativeWaveBlocker('done', true, false) !== null) throw new Error('Varian dengan lembar dasar selesai harus jalan')
  if (derivativeWaveBlocker(null, true, false) !== null) throw new Error('Varian dengan lembar dasar lama harus jalan')
  if (derivativeWaveBlocker('done', true, true)?.skip !== 'canceled') throw new Error('Batal di gelombang 1 harus menghentikan varian')
  if (derivativeWaveBlocker('failed', false, false)?.skip !== 'failed') throw new Error('Lembar dasar gagal harus melewati varian')
  if (derivativeWaveBlocker(null, false, false)?.skip !== 'failed') throw new Error('Tanpa lembar dasar varian harus dilewati')

  // 3c. Variant sheets from before basis hashes are stale when the base sheet is newer (regression guard).
  const legacyChar = { id: 'c', name: 'A', sheetAssetId: 'base' } as Character
  const legacyDeriv = { id: 'd', characterId: 'c', name: 'V', promptChange: 'x', sheetAssetId: 'var' } as unknown as Parameters<typeof getDerivativeSheetStatus>[0]
  const legacyAssets = (baseAt: number, varAt: number) =>
    [{ id: 'base', createdAt: baseAt, meta: {} }, { id: 'var', createdAt: varAt, meta: {} }] as unknown as Asset[]
  if (getDerivativeSheetStatus(legacyDeriv, legacyChar, { imageModel: null }, legacyAssets(2, 1)).status !== 'stale') {
    throw new Error('Lembar varian lama dengan lembar dasar lebih baru harus basi')
  }
  if (getDerivativeSheetStatus(legacyDeriv, legacyChar, { imageModel: null }, legacyAssets(1, 2)).status !== 'current') {
    throw new Error('Lembar varian lama yang lebih baru dari lembar dasar harus terkini')
  }

  // 3d. Episode targets split over source windows add up to the target, at least one per window.
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0)
  const cases: [number[], number, number][] = [
    [[9000, 9000, 2000], 5, 5],
    [[100, 100, 9000], 3, 3],
    [[100, 100, 100], 2, 3],
    [[9000], 7, 7]
  ]
  for (const [lens, target, want] of cases) {
    const got = splitEpisodeTarget(lens, target)
    if (sum(got) !== want || got.some((n) => n < 1)) throw new Error(`splitEpisodeTarget(${lens}, ${target}) = ${got}`)
  }

  // 3e. "Buat semua naskah" only fills empty planned episodes and never touches drafts or clips.
  const ep = (status: string, summary = 'ada', scriptDraft: unknown = null) =>
    ({ status, summary, scriptDraft }) as Parameters<typeof needsScriptDraft>[0]
  const draftCases: [Parameters<typeof needsScriptDraft>[0], number, boolean][] = [
    [ep('planned'), 0, true],
    [ep('planned', 'ada', { shots: [] }), 0, false],
    [ep('planned'), 2, false],
    [ep('draft', ''), 0, false],
    [ep('draft', 'ringkasan manual'), 0, true],
    [ep('script'), 0, false]
  ]
  for (const [e, clips, want] of draftCases) {
    if (needsScriptDraft(e, clips) !== want) throw new Error(`needsScriptDraft(${e.status}, draf=${!!e.scriptDraft}, klip=${clips}) harus ${want}`)
  }

  // 3f. Progress summary counts what the hub shows.
  const prog = seriesProgress(projectId)
  if (prog.totalEpisodes !== listEpisodes(projectId).length) throw new Error('seriesProgress.totalEpisodes salah')
  console.log(`[checkPhase6] Progres: ${JSON.stringify(prog)}`)

  // 4. Remove all episodes (Task 35)
  const epsBefore = listEpisodes(projectId)
  if (epsBefore.length === 0) throw new Error('Harus ada episode sebelum removeAllEpisodes')
  const sheetIdsBefore = getBundle(projectId).characters.map((c) => c.sheetAssetId).filter(Boolean)

  removeAllEpisodes(projectId)

  const epsAfter = listEpisodes(projectId)
  if (epsAfter.length !== 0) {
    throw new Error(`removeAllEpisodes gagal: masih ada ${epsAfter.length} episode`)
  }
  const bAfterDelete = getBundle(projectId)
  if (bAfterDelete.episode !== null) {
    throw new Error('Setelah removeAllEpisodes, bAfterDelete.episode harus null')
  }
  if (bAfterDelete.clips.length !== 0) {
    throw new Error('Setelah removeAllEpisodes, clips harus kosong')
  }
  // Lorebook must still be preserved!
  if (bAfterDelete.characters.length === 0) {
    throw new Error('removeAllEpisodes TIDAK boleh menghapus karakter Lorebook')
  }
  const assetIdsAfter = new Set(bAfterDelete.assets.map((x) => x.id))
  if (sheetIdsBefore.some((id) => !assetIdsAfter.has(id!))) throw new Error('removeAllEpisodes TIDAK boleh menghapus lembar Lorebook')
  if (bAfterDelete.assets.some((x) => x.clipId || x.episodeId)) throw new Error('Aset klip/episode harus ikut terhapus')
  if (getPlanProgress(projectId)) throw new Error('plan_progress harus dihapus agar perencanaan mulai dari awal')

  console.log('[checkPhase6] Semua pengujian backend Fase 6 BERHASIL!')
  return true
}

export async function checkPhase7(projectId: string): Promise<boolean> {
  // 1. Ensure Phase 6 baseline is met
  await checkPhase6(projectId)
  console.log('[checkPhase7] Prasyarat Fase 6 terpenuhi')

  // Create a clean test episode since checkPhase6 tested removeAllEpisodes
  const testEpisode = createEpisode(projectId, { title: 'Episode 1: Kebangkitan' })

  // 2. Lorebook Candidate Acceptance & Profile Persistence
  const acceptedResult = acceptLorebookCandidates({
    projectId,
    acceptedCharacters: [
      {
        tempId: 'temp_c1',
        name: 'Arjuna Wardhana',
        aliases: ['Arjun', 'Bung Arjuna'],
        description: 'Pemuda karismatik berwajah tegas',
        voiceStyle: 'baritone tegas',
        profile: {
          visual: {
            age: '28',
            gender: 'pria',
            hair: 'hitam rapi belah samping',
            defaultOutfit: 'kemeja putih digulung dan celana chino abu-abu'
          },
          narrative: {
            role: 'protagonist',
            desire: 'membersihkan nama baik keluarga',
            secret: 'tahu rahasia korupsi sindikat'
          }
        }
      }
    ],
    acceptedDerivatives: [
      {
        tempId: 'temp_d1',
        characterName: 'Arjuna Wardhana',
        name: 'Jas Pesta Mewah',
        promptChange: 'jas tuksedo hitam beludru dengan dasi kupu-kupu sutra',
        costumeKeyphrase: 'tuksedo beludru hitam dasi kupu-kupu'
      }
    ],
    acceptedLocations: [
      {
        tempId: 'temp_l1',
        name: 'Gedung Kesenian Tua',
        aliases: ['Gedung Tua', 'Teater Lama'],
        description: 'Gedung pertunjukan kolonial bergaya neo-klasik',
        profile: {
          placeType: 'teater pertunjukan',
          interiorExterior: 'interior',
          lighting: 'sorotan lampu panggung temaram'
        }
      }
    ],
    acceptedProps: [
      {
        tempId: 'temp_p1',
        name: 'Kotak Musik Antik',
        aliases: ['Kotak Emas'],
        description: 'Kotak musik berukir motif teratai emas',
        profile: {
          category: 'pusaka',
          appearance: 'logam kuningan bersepuh emas dengan kristal di tengah',
          significance: 'berisi gulungan mikrofilm rahasia'
        }
      }
    ]
  })

  if (acceptedResult.createdCharacters.length !== 1 || acceptedResult.createdDerivatives.length !== 1 || acceptedResult.createdLocations.length !== 1 || acceptedResult.createdProps.length !== 1) {
    throw new Error('acceptLorebookCandidates gagal mengembalikan entitas yang baru dibuat')
  }

  // Verify persistence in bundle
  const bLore = getBundle(projectId)
  const savedChar = bLore.characters.find((c) => c.name === 'Arjuna Wardhana')
  if (!savedChar || savedChar.profile?.visual?.hair !== 'hitam rapi belah samping' || savedChar.profile?.narrative?.role !== 'protagonist') {
    throw new Error('Profil karakter (visual & narasi) gagal disimpan atau diambil dari basis data')
  }

  const savedDeriv = bLore.derivatives.find((d) => d.name === 'Jas Pesta Mewah')
  if (!savedDeriv || savedDeriv.costumeKeyphrase !== 'tuksedo beludru hitam dasi kupu-kupu') {
    throw new Error('Costume keyphrase varian kostum gagal disimpan ke basis data')
  }

  const savedLoc = bLore.locations.find((l) => l.name === 'Gedung Kesenian Tua')
  if (!savedLoc || savedLoc.profile?.interiorExterior !== 'interior') {
    throw new Error('Profil lokasi gagal disimpan ke basis data')
  }

  const savedProp = bLore.props.find((p) => p.name === 'Kotak Musik Antik')
  if (!savedProp || savedProp.profile?.category !== 'pusaka') {
    throw new Error('Profil prop gagal disimpan ke basis data')
  }

  // 3. Series Guidelines & Prompt Templates Persistence
  bLore.project.seriesGuidelines = 'Suasana noir penuh intrik balas dendam keluarga konglomerat.'
  bLore.project.promptTemplates = {
    episode_planner: 'Custom showrunner instructions for noir thriller series.'
  }
  saveSnapshot({
    project: bLore.project,
    episodeId: testEpisode.id,
    characters: bLore.characters,
    clips: []
  })

  const bTemplates = getBundle(projectId)
  if (bTemplates.project.seriesGuidelines !== 'Suasana noir penuh intrik balas dendam keluarga konglomerat.') {
    throw new Error('series_guidelines gagal disimpan di proyek')
  }
  if (bTemplates.project.promptTemplates?.episode_planner !== 'Custom showrunner instructions for noir thriller series.') {
    throw new Error('prompt_templates_json gagal disimpan di proyek')
  }

  // 4. Speech Pacing Validation (Tugas 38)
  const normalSpeech = validateSpeechDuration('Halo semua, selamat datang di acara ini.', 5)
  if (!normalSpeech.valid) {
    throw new Error('Teks bicara wajar untuk durasi 5 detik seharusnya valid')
  }
  const overlyLongSpeech = validateSpeechDuration(
    'Ini adalah dialog yang sangat amat panjang sekali dan tidak mungkin bisa diucapkan dalam waktu dua detik saja tanpa terpotong atau terburu-buru secara tidak wajar bagi telinga pendengar.',
    2
  )
  if (overlyLongSpeech.valid) {
    throw new Error('Teks bicara terlalu panjang untuk durasi 2 detik seharusnya tidak valid')
  }
  if (overlyLongSpeech.maxRecommendedWords >= overlyLongSpeech.wordCount) {
    throw new Error('maxRecommendedWords harus lebih kecil dari wordCount ketika teks melebihi batas')
  }

  // 5. Script Doctor & Episode Rhythm (Tugas 39)
  const testShots: DraftShot[] = [
    {
      title: 'Shot 1 - Pembuka',
      sourceExcerpt: 'Adegan 1',
      visualAction: 'Arjuna menatap gedung tua di tengah hujan lebat',
      characters: ['Arjuna Wardhana'],
      costumes: {},
      location: 'Gedung Kesenian Tua',
      props: [],
      speaker: null,
      text: '',
      emotion: 'tegang',
      framing: 'wide shot',
      durationSec: 4,
      shotDetail: {
        cameraMotion: 'slow push-in tracking shot',
        cameraReason: 'membangun atmosfer misteri',
        lighting: 'dramatic blue moody rim lighting'
      }
    },
    {
      title: 'Shot 2 - Dialog',
      sourceExcerpt: 'Adegan 2',
      visualAction: 'Arjuna berbisik ke mikrofon tersembunyi',
      characters: ['Arjuna Wardhana'],
      costumes: {},
      location: 'Gedung Kesenian Tua',
      props: ['Kotak Musik Antik'],
      speaker: 'Arjuna Wardhana',
      text: 'Target sudah terlihat di lantai dua.',
      emotion: 'waspada',
      framing: 'close up',
      durationSec: 3,
      shotDetail: {
        cameraMotion: 'handheld slight shake',
        speechDelivery: 'berbisik lirih penuh desakan',
        dialogueType: 'dialogue'
      }
    },
    {
      title: 'Shot 3 - Penutup',
      sourceExcerpt: 'Adegan 3',
      visualAction: 'Sebuah tembakan meletus, lampu seketika padam total',
      characters: [],
      costumes: {},
      location: 'Gedung Kesenian Tua',
      props: [],
      speaker: null,
      text: '',
      emotion: 'panik',
      framing: 'extreme close up',
      durationSec: 3,
      shotDetail: {
        cameraMotion: 'rapid zoom-out Dutch angle',
        sfxAmbience: 'bunyi tembakan menggelegar dan teriakan penonton'
      }
    }
  ]

  const testDraft: EpisodeScriptDraft = {
    createdAt: Date.now(),
    shots: testShots,
    newAssets: []
  }

  const scriptIssues = checkScriptDoctor(testDraft, testEpisode, {
    characters: bLore.characters,
    locations: bLore.locations,
    props: bLore.props,
    derivatives: bLore.derivatives
  })
  if (!Array.isArray(scriptIssues)) {
    throw new Error('checkScriptDoctor harus mengembalikan daftar issue array')
  }

  const rhythm = computeEpisodeRhythm(testDraft)
  if (rhythm.length !== 3) {
    throw new Error(`computeEpisodeRhythm harus menghasilkan 3 segmen, didapat: ${rhythm.length}`)
  }
  if (!rhythm[0].pacing || !rhythm[2].pacing) {
    throw new Error('Segmen ritme harus memiliki penilaian pacing')
  }

  // 6. Connected Shots & Cinematography (Tugas 38 & 43)
  const draftWithConnection: EpisodeScriptDraft = {
    createdAt: Date.now(),
    shots: [
      {
        title: 'Shot A',
        sourceExcerpt: 'A',
        visualAction: 'Karakter melangkah maju',
        characters: ['Arjuna Wardhana'],
        costumes: {},
        location: null,
        props: [],
        speaker: null,
        text: '',
        emotion: 'netral',
        framing: 'medium',
        durationSec: 4,
        shotDetail: {
          cameraMotion: 'forward dolly',
          lighting: 'high key'
        }
      },
      {
        title: 'Shot B (Connected)',
        sourceExcerpt: 'B',
        visualAction: 'Karakter meraih gagang pintu',
        characters: ['Arjuna Wardhana'],
        costumes: {},
        location: null,
        props: [],
        speaker: null,
        text: '',
        emotion: 'fokus',
        framing: 'close up',
        durationSec: 4,
        continueFromPrevious: true,
        shotDetail: {
          cameraMotion: 'handheld tracking',
          lighting: 'ambient'
        }
      }
    ],
    newAssets: []
  }

  confirmEpisodeScriptRepo(projectId, testEpisode.id, draftWithConnection)
  const bAfterConfirm = getBundle(projectId, testEpisode.id)
  const clipA = bAfterConfirm.clips[0]!
  const clipB = bAfterConfirm.clips[1]!

  if (!clipB.continueFromPrevious) {
    throw new Error('continueFromPrevious pada DraftShot harus tersimpan ke Clip setelah confirmEpisodeScriptRepo')
  }
  if (!clipA.shotDetail || clipA.shotDetail.cameraMotion !== 'forward dolly') {
    throw new Error('shotDetail pada Clip harus tersimpan dari DraftShot')
  }

  // Clip B connected requires Clip A to have video asset
  const prereqBeforeVideo = checkClipVideoPrerequisites(clipB, bAfterConfirm.project, {
    assets: bAfterConfirm.assets,
    clips: bAfterConfirm.clips,
    characters: bAfterConfirm.characters,
    derivatives: bAfterConfirm.derivatives,
    locations: bAfterConfirm.locations,
    props: bAfterConfirm.props
  })
  if (prereqBeforeVideo.ok || !prereqBeforeVideo.blockers.some((b) => b.includes('video atau gambar'))) {
    throw new Error('Clip B dengan continueFromPrevious: true harus diblokir jika clip A belum memiliki video/gambar')
  }

  // Mock video for Clip A
  const mockVideoAsset = insertAsset({
    projectId,
    clipId: clipA.id,
    kind: 'video',
    provider: 'demo',
    localPath: 'videos/mock-clip-a.mp4',
    durationMs: 4000
  })
  patchClip(clipA.id, { videoAssetId: mockVideoAsset.id })

  const freshBundleWithVideo = getBundle(projectId, testEpisode.id)
  const prereqAfterVideo = checkClipVideoPrerequisites(freshBundleWithVideo.clips[1]!, freshBundleWithVideo.project, {
    assets: freshBundleWithVideo.assets,
    clips: freshBundleWithVideo.clips,
    characters: freshBundleWithVideo.characters,
    derivatives: freshBundleWithVideo.derivatives,
    locations: freshBundleWithVideo.locations,
    props: freshBundleWithVideo.props
  })
  if (!prereqAfterVideo.ok) {
    throw new Error(`Clip B seharusnya siap setelah clip A memiliki video, tapi: ${prereqAfterVideo.blockers.join(', ')}`)
  }

  // Verify hash basis sensitivity to connected shots
  const hashStandalone = computeClipVideoBasisHash({
    clip: { ...clipB, continueFromPrevious: false },
    project: freshBundleWithVideo.project,
    characters: freshBundleWithVideo.characters,
    seconds: 4,
    prevAssetId: null
  })
  const hashConnected = computeClipVideoBasisHash({
    clip: clipB,
    project: freshBundleWithVideo.project,
    characters: freshBundleWithVideo.characters,
    seconds: 4,
    prevAssetId: mockVideoAsset.id
  })
  if (hashStandalone === hashConnected) {
    throw new Error('computeClipVideoBasisHash harus berbeda antara shot mandiri vs shot tersambung dari klip sebelumnya')
  }

  // Verify prompt compilation incorporates visual profile and shot detail
  const compiledPrompt = compileClipPrompt({
    project: freshBundleWithVideo.project,
    clip: clipA,
    characters: freshBundleWithVideo.characters,
    derivatives: freshBundleWithVideo.derivatives,
    locations: freshBundleWithVideo.locations,
    props: freshBundleWithVideo.props
  })
  if (!compiledPrompt.includes('hitam rapi belah samping')) {
    throw new Error(`compileClipPrompt harus menyertakan profil visual karakter: ${compiledPrompt}`)
  }
  if (!compiledPrompt.includes('high key')) {
    throw new Error(`compileClipPrompt harus menyertakan lighting dari shotDetail: ${compiledPrompt}`)
  }

  console.log('[checkPhase7] Semua pengujian backend Fase 7 BERHASIL!')
  return true
}

export async function checkPhase8(projectId: string): Promise<boolean> {
  // 1. Ensure Phase 7 baseline is met
  await checkPhase7(projectId)
  console.log('[checkPhase8] Prasyarat Fase 7 terpenuhi')

  const episodes = listEpisodes(projectId)
  const ep = episodes[0]
  if (!ep) throw new Error('Episode tidak ditemukan untuk checkPhase8')

  // 2. Test Cross-Episode Continuity Items (Tugas 47)
  const item1 = createContinuityItem(
    projectId,
    'prop',
    'Cincin Giok Pusaka',
    'Cincin peninggalan kakek yang memiliki ukiran naga',
    ep.id,
    'hot',
    'open'
  )
  if (!item1.id || item1.name !== 'Cincin Giok Pusaka') {
    throw new Error('createContinuityItem gagal membuat item kontinuitas')
  }

  const items = listContinuityItems(projectId)
  if (!items.some((i) => i.id === item1.id)) {
    throw new Error('listContinuityItems tidak menemukan item kontinuitas yang baru dibuat')
  }

  const updatedItem = updateContinuityItem(item1.id, {
    status: 'paid',
    payoffEpisodeId: ep.id
  })
  if (updatedItem.status !== 'paid' || updatedItem.payoffEpisodeId !== ep.id) {
    throw new Error('updateContinuityItem gagal memperbarui status item')
  }

  // 3. Test Continuity Lock Words (Tugas 45)
  const lockCompliancePass = checkLockCompliance('Seorang pemuda berambut hitam rapi mengenakan kemeja putih', [
    { id: 'lock-1', label: 'Rambut', text: 'hitam rapi', source: 'manual', enabled: true }
  ])
  if (!lockCompliancePass.compliant || lockCompliancePass.missing.length > 0) {
    throw new Error('checkLockCompliance seharusnya compliant')
  }

  const lockComplianceFail = checkLockCompliance('Seorang pemuda berambut cokelat mengenakan jaket kulit', [
    { id: 'lock-1', label: 'Rambut', text: 'hitam rapi', source: 'manual', enabled: true }
  ])
  if (lockComplianceFail.compliant || lockComplianceFail.missing.length === 0) {
    throw new Error('checkLockCompliance gagal mendeteksi ketidakpatuhan kata kunci kontinuitas')
  }

  // 4. Test Script Versioning & Snapshot Rollback (Tugas 50)
  const mockDraft: EpisodeScriptDraft = {
    shots: [
      {
        title: 'Shot Uji Versi',
        sourceExcerpt: 'Adegan Pembuka',
        visualAction: 'Pahlawan menatap ufuk barat',
        characters: ['Arjuna Wardhana'],
        costumes: {},
        location: 'Gerbang Istana Majapahit',
        props: [],
        speaker: 'Arjuna Wardhana',
        text: 'Waktunya telah tiba.',
        emotion: 'tegas',
        framing: 'close_up',
        durationSec: 4
      }
    ],
    newAssets: [],
    createdAt: Date.now()
  }

  const savedVer = saveScriptVersion(ep.id, mockDraft, 'Snapshot uji coba devharness')
  if (!savedVer.id || savedVer.note !== 'Snapshot uji coba devharness') {
    throw new Error('saveScriptVersion gagal menyimpan versi naskah')
  }
  const versions = listScriptVersions(ep.id)
  if (!versions.some((v) => v.id === savedVer.id)) {
    throw new Error('listScriptVersions tidak mengembalikan versi naskah yang baru disimpan')
  }

  // 5. Test Per-shot Reference Overrides (Tugas 48)
  const bundle = getBundle(projectId, ep.id)
  const clip = bundle.clips[0]
  if (clip) {
    const hashWithoutRef = computeClipImageBasisHash({
      clip: { ...clip, referenceAssetIds: [] },
      project: bundle.project,
      characters: bundle.characters,
      derivatives: bundle.derivatives,
      locations: bundle.locations,
      props: bundle.props,
      refSheetAssetIds: []
    })
    const hashWithRef = computeClipImageBasisHash({
      clip: { ...clip, referenceAssetIds: ['custom-ref-asset-id-123'] },
      project: bundle.project,
      characters: bundle.characters,
      derivatives: bundle.derivatives,
      locations: bundle.locations,
      props: bundle.props,
      refSheetAssetIds: ['custom-ref-asset-id-123']
    })
    if (hashWithoutRef === hashWithRef) {
      throw new Error('computeClipImageBasisHash harus berubah ketika referenceAssetIds / refSheetAssetIds berubah!')
    }
  }

  // 6. Test Platform Export Presets (Tugas 49)
  if (!EXPORT_PRESETS.some((p) => p.id === 'tiktok') || !EXPORT_PRESETS.some((p) => p.id === 'shorts')) {
    throw new Error('EXPORT_PRESETS katalog tidak lengkap')
  }
  const tiktokPreset = getExportPreset('tiktok')!
  const tiktokWarn = validatePresetDuration(tiktokPreset, 700)
  if (tiktokWarn.valid || !tiktokWarn.warning?.includes('TikTok')) {
    throw new Error('validatePresetDuration gagal mendeteksi durasi yang melebihi batas preset TikTok')
  }

  // 7. Test Provider Resolution & Active Models (Tugas 54 & 56)
  const settings = getSettings()
  const activeLlm = resolveActive(settings, 'llm')
  if (!activeLlm.provider || !activeLlm.model) {
    throw new Error('resolveActive gagal mengembalikan provider dan model aktif untuk LLM')
  }

  // 8. Test Delivery Package Exporter (Tugas 52)
  const pkgPath = await exportDeliveryPackage(projectId, ep.id)
  if (!pkgPath || !existsSync(pkgPath) || !pkgPath.endsWith('.zip')) {
    throw new Error(`exportDeliveryPackage gagal menghasilkan file zip yang valid: ${pkgPath}`)
  }
  console.log(`[checkPhase8] Paket pengiriman berhasil diekspor ke: ${pkgPath}`)

  console.log('[checkPhase8] Semua pengujian backend Fase 8 BERHASIL!')
  return true
}

/**
 * For harness runs: keep painting and timers going while the test window sits behind other windows, so
 * screenshots show the current state. Must run before the app is ready.
 */
export function prepareHarness(): void {
  if (app.isPackaged || !process.env.STUDIO_CAPTURE_PLAN) return
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
}

/**
 * Development-only test harness. Set STUDIO_CAPTURE_PLAN to a JSON file of steps
 * ([{ "js": "...", "wait": 800, "shot": "C:/tmp/home.png" }, ...], optionally with "quit": true
 * on the last step) to drive the UI and capture screenshots. STUDIO_LOG collects renderer console output.
 * Never active in a packaged build.
 */
export function attachDevHarness(win: BrowserWindow): void {
  if (app.isPackaged) return
  const log = process.env.STUDIO_LOG
  if (log) {
    win.webContents.on('console-message', (e) => {
      appendFileSync(log, `[${e.level}] ${e.message}\n`)
    })
    win.webContents.on('render-process-gone', (_e, d) => appendFileSync(log, `[gone] ${d.reason}\n`))
  }
  const planPath = process.env.STUDIO_CAPTURE_PLAN
  if (!planPath) return
  let plan: {
    main?: 'seed' | 'seedEpisodes' | 'checkIsolation' | 'checkPhase3' | 'checkPhase4' | 'checkPhase6' | 'checkPhase7' | 'checkPhase8' | 'export' | 'key' | 'overlays' | 'speech' | 'videos'
    openProject?: boolean
    exportTo?: string
    encoder?: ExportOptions['encoder']
    /** For main "export": an existing project instead of the seeded demo. */
    projectId?: string
    /** For main "key": store a fake key for this provider and mark its last check as passed or failed. */
    provider?: ApiProvider
    ok?: boolean
    js?: string
    /** Real mouse input: press on the element (or its edge handle), move by dx pixels, release. */
    drag?: { selector: string; at?: 'left' | 'right' | 'center'; dx: number; dy?: number; fy?: number }
    /** Real mouse click on an element, or at a point inside it (fraction of its width). */
    click?: { selector: string; fx?: number; pointJs?: string }
    /** A real key press, e.g. "s" or "Delete". */
    key?: string
    resize?: { width: number; height: number }
    wait?: number
    shot?: string
    quit?: boolean
  }[]
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8').replace(/^﻿/, ''))
  } catch (e) {
    console.error('[harness] plan tidak valid:', (e as Error).message)
    return
  }
  let demoId: string | null = null
  win.webContents.once('did-finish-load', async () => {
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    await sleep(2000)
    for (const step of plan) {
      try {
        if (step.main === 'seed') demoId = seedDemo()
        if (step.main === 'seedEpisodes') demoId = seedEpisodes().projectId
        if (step.main === 'checkIsolation' && (step.projectId ?? demoId)) checkIsolation((step.projectId ?? demoId)!)
        if (step.main === 'checkPhase3' && (step.projectId ?? demoId)) await checkPhase3((step.projectId ?? demoId)!)
        if (step.main === 'checkPhase4' && (step.projectId ?? demoId)) await checkPhase4((step.projectId ?? demoId)!)
        if (step.main === 'checkPhase6' && (step.projectId ?? demoId)) await checkPhase6((step.projectId ?? demoId)!)
        if (step.main === 'checkPhase7' && (step.projectId ?? demoId)) await checkPhase7((step.projectId ?? demoId)!)
        if (step.main === 'checkPhase8' && (step.projectId ?? demoId)) await checkPhase8((step.projectId ?? demoId)!)
        if (step.openProject && demoId) {
          await win.webContents.executeJavaScript(`(() => { window.useApp?.getState().go({ name: 'project', id: ${JSON.stringify(demoId)} }); })()`)
        }
        if (step.main === 'overlays' && demoId) addDemoOverlays(demoId)
        if (step.main === 'videos' && demoId) addDemoVideos(demoId)
        if (step.main === 'speech' && demoId) await addDemoSpeech(demoId)
        if (step.main === 'key' && step.provider) {
          setSecret(step.provider, 'dev-harness-fake-key')
          recordCheck(step.provider, step.ok !== false, step.ok === false ? 'Kunci ditolak (uji)' : 'Terhubung (uji)')
        }
        if (step.main === 'export' && (step.projectId ?? demoId)) {
          startExport((step.projectId ?? demoId)!, {
            fileName: 'demo-export',
            resolution: 1080,
            fps: 30,
            burnCaptions: true,
            writeSrt: true,
            normalizeAudio: true,
            duckMusic: true,
            folder: step.exportTo ?? app.getPath('temp'),
            encoder: step.encoder ?? 'cpu'
          })
        }
        if (step.js) await win.webContents.executeJavaScript(step.js, true)
        if (step.drag || step.click) {
          const target = step.drag ?? step.click!
          const rect = (await win.webContents.executeJavaScript(
            `(() => { const el = document.querySelector(${JSON.stringify(target.selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`,
            true
          )) as { x: number; y: number; w: number; h: number } | null
          if (!rect) throw new Error(`element tidak ada: ${target.selector}`)
          const at = step.drag?.at ?? 'center'
          const fx = step.click?.fx ?? (at === 'left' ? 0 : at === 'right' ? 1 : 0.5)
          let x0 = Math.round(rect.x + Math.min(rect.w - 2, Math.max(2, rect.w * fx + (at === 'left' ? 3 : at === 'right' ? -3 : 0))))
          let y0 = Math.round(rect.y + rect.h * (step.drag?.fy ?? 0.5))
          if (step.click?.pointJs) {
            const pt = (await win.webContents.executeJavaScript(step.click.pointJs, true)) as { x: number; y: number }
            x0 = Math.round(pt.x)
            y0 = Math.round(pt.y)
          }
          const send = (type: 'mouseDown' | 'mouseUp' | 'mouseMove', x: number, y: number, held = false): void =>
            win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: held ? ['leftbuttondown'] : [] })
          send('mouseMove', x0, y0)
          send('mouseDown', x0, y0)
          if (step.drag) {
            const steps = 12
            for (let i = 1; i <= steps; i++) {
              await sleep(16)
              // Without the held-button flag Chromium sees buttons = 0 and drops pointer capture on the first move.
              send('mouseMove', x0 + Math.round((step.drag.dx * i) / steps), y0 + Math.round(((step.drag.dy ?? 0) * i) / steps), true)
            }
          }
          await sleep(30)
          send('mouseUp', x0 + (step.drag?.dx ?? 0), y0 + (step.drag?.dy ?? 0))
        }
        if (step.key) {
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode: step.key })
          win.webContents.sendInputEvent({ type: 'char', keyCode: step.key })
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode: step.key })
        }
        if (step.resize) {
          win.setContentSize(step.resize.width, step.resize.height)
        }
      } catch (e) {
        console.error('[harness] step failed:', (e as Error).message, (e as Error).stack)
        if (log) appendFileSync(log, `[harness] step failed: ${(e as Error).message}\n`)
      }
      await sleep(step.wait ?? 800)
      if (step.shot) {
        try {
          const img = await win.webContents.capturePage()
          writeFileSync(step.shot, img.toPNG())
        } catch (e) {
          if (log) appendFileSync(log, `[harness] screenshot failed: ${(e as Error).message}\n`)
        }
      }
      if (step.quit) app.quit()
    }
  })
}
