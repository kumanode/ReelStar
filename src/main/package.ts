import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { timelineChunks } from '@shared/captions'
import { stripVoiceTags } from '@shared/speech'
import { clipCaptionWords, voiceSpan } from '@shared/timeline'
import type { Asset, Clip, WordTiming } from '@shared/types'
import { assetAbsPath, dataDir } from './paths'
import { getBundle, listContinuityItems } from './repo'
import { getSettings } from './settings'

const execFileAsync = promisify(execFile)
const UNKNOWN_AUDIO_MS = 10 * 60 * 1000

function safeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'file'
  )
}

function uniqueName(dir: string, base: string, ext: string): string {
  let candidate = `${base}${ext}`
  let n = 2
  while (existsSync(join(dir, candidate))) {
    candidate = `${base}-${n}${ext}`
    n++
  }
  return candidate
}

function srtTimeSec(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

function buildBundleSrt(clips: Clip[], assetMap: Map<string, Asset>): string {
  let elapsedSec = 0
  const items: { start: number; words: WordTiming[]; key?: string; offset?: number }[] = []

  for (const clip of clips) {
    const startSec = elapsedSec
    elapsedSec += clip.durationMs / 1000
    const audio = clip.audioAssetId ? assetMap.get(clip.audioAssetId) : undefined
    if (!audio) continue
    const audioMs = audio.durationMs ?? UNKNOWN_AUDIO_MS
    const words = audio.meta.words ?? []
    if (words.length > 0) {
      const shown = clipCaptionWords(clip, words, audioMs)
      items.push({ start: startSec, words: shown.words, key: audio.id, offset: shown.offset })
    } else {
      const clean = stripVoiceTags(clip.narration || '')
      const span = voiceSpan(clip, audioMs)
      if (clean && span.playMs > 0) {
        items.push({
          start: startSec,
          words: [{ text: clean, start: span.startMs / 1000, end: (span.startMs + span.playMs) / 1000 }],
          key: audio.id
        })
      }
    }
  }

  const chunks = timelineChunks(items)
  if (!chunks.length) return ''
  return (
    chunks
      .map((c, i) => {
        const next = chunks[i + 1]
        const end = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.6
        return `${i + 1}\n${srtTimeSec(c.start)} --> ${srtTimeSec(end)}\n${c.words.map((w) => w.text).join(' ')}\n`
      })
      .join('\n') + '\n'
  )
}

function computeSha256(filePath: string): string {
  const buf = readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

function collectAllFiles(dir: string, baseDir: string = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  let results: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(collectAllFiles(full, baseDir))
    } else if (entry.isFile()) {
      results.push(full)
    }
  }
  return results
}


/**
 * Windows' own bsdtar writes zip archives. A bare "tar.exe" can resolve to Git's GNU tar when Git sits earlier in
 * PATH; GNU tar reads "C:\..." as a remote host and cannot write zips, so the system copy is called by its path.
 */
function windowsTar(): string {
  const systemTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(systemTar) ? systemTar : 'tar.exe'
}
export async function exportDeliveryPackage(
  projectId: string,
  episodeId?: string,
  videoPath?: string,
  outZipPath?: string
): Promise<string> {
  const bundle = getBundle(projectId, episodeId)
  const { project, episode, clips, characters, derivatives, locations, props, assets } = bundle
  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const continuityItems = listContinuityItems(projectId)

  const settings = getSettings()
  const defaultDir = settings.exportFolder ?? join(app.getPath('videos'), 'ReelStar')
  mkdirSync(defaultDir, { recursive: true })

  const epSuffix = episode ? `-ep${episode.episodeNum}` : ''
  const zipName = safeFilename(`${project.title}${epSuffix}-delivery.zip`)
  const finalZipPath = outZipPath || join(defaultDir, zipName)
  mkdirSync(dirname(finalZipPath), { recursive: true })

  const stagingDir = join(dataDir(), 'tmp', `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(stagingDir, { recursive: true })

  try {
    // 1. Copy video file if available
    let bundledVideoName: string | null = null
    let candidateVideo = videoPath && existsSync(videoPath) ? videoPath : null

    if (!candidateVideo) {
      // Look in default export directory for matching mp4 (supports both raw title and slugified filename)
      try {
        const files = readdirSync(defaultDir)
        const safePrefix = safeFilename(project.title).toLowerCase()
        const slugPrefix =
          project.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'video'
        const epRe = episode
          ? new RegExp(`(?:^|[\\s._-])ep(?:isode)?[\\s._-]*0*${episode.episodeNum}(?![0-9])`, 'i')
          : null
        const matched = files
          .filter((f) => {
            const lower = f.toLowerCase()
            if (!lower.endsWith('.mp4')) return false
            if (!lower.startsWith(safePrefix) && !lower.startsWith(slugPrefix)) return false
            if (epRe && !epRe.test(lower)) return false
            return true
          })
          .map((f) => join(defaultDir, f))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
        if (matched.length > 0) {
          candidateVideo = matched[0]
        }
      } catch {
        // Ignore directory read issues
      }
    }

    if (candidateVideo && existsSync(candidateVideo)) {
      bundledVideoName = `${safeFilename(project.title)}${epSuffix}.mp4`
      copyFileSync(candidateVideo, join(stagingDir, bundledVideoName))
    }

    // 2. Build Subtitles SRT
    const srtContent = buildBundleSrt(clips, assetMap)
    const srtFileName = `${safeFilename(project.title)}${epSuffix}.srt`
    writeFileSync(join(stagingDir, srtFileName), srtContent, 'utf8')

    // 3. Collect Thumbnails & Cover
    const thumbDir = join(stagingDir, 'thumbnails')
    mkdirSync(thumbDir, { recursive: true })

    if (project.coverAssetId && assetMap.has(project.coverAssetId)) {
      const coverAsset = assetMap.get(project.coverAssetId)!
      const abs = assetAbsPath(projectId, coverAsset.localPath)
      if (existsSync(abs)) {
        const ext = extname(abs).toLowerCase() || '.png'
        copyFileSync(abs, join(thumbDir, uniqueName(thumbDir, 'cover', ext)))
      }
    }

    const thumbAssets = assets.filter((a) => a.kind === 'image' && a.meta.thumbnail === true)
    let thumbIndex = 1
    for (const ta of thumbAssets) {
      const abs = assetAbsPath(projectId, ta.localPath)
      if (existsSync(abs)) {
        const ext = extname(abs).toLowerCase() || '.png'
        copyFileSync(abs, join(thumbDir, uniqueName(thumbDir, `thumbnail-${thumbIndex}`, ext)))
        thumbIndex++
      }
    }

    // 4. Collect Lorebook reference assets
    const loreDir = join(stagingDir, 'lorebook')
    mkdirSync(loreDir, { recursive: true })

    const charById = new Map(characters.map((ch) => [ch.id, ch]))
    for (const ch of characters) {
      if (ch.sheetAssetId && assetMap.has(ch.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(ch.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          const ext = extname(abs).toLowerCase() || '.png'
          copyFileSync(abs, join(loreDir, uniqueName(loreDir, `character-${safeFilename(ch.name)}`, ext)))
        }
      }
    }

    for (const d of derivatives) {
      if (d.sheetAssetId && assetMap.has(d.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(d.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          const charName = charById.get(d.characterId)?.name || 'character'
          const ext = extname(abs).toLowerCase() || '.png'
          copyFileSync(abs, join(loreDir, uniqueName(loreDir, `variant-${safeFilename(charName)}-${safeFilename(d.name)}`, ext)))
        }
      }
    }

    for (const loc of locations) {
      if (loc.sheetAssetId && assetMap.has(loc.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(loc.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          const ext = extname(abs).toLowerCase() || '.png'
          copyFileSync(abs, join(loreDir, uniqueName(loreDir, `location-${safeFilename(loc.name)}`, ext)))
        }
      }
    }

    for (const prop of props) {
      if (prop.sheetAssetId && assetMap.has(prop.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(prop.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          const ext = extname(abs).toLowerCase() || '.png'
          copyFileSync(abs, join(loreDir, uniqueName(loreDir, `prop-${safeFilename(prop.name)}`, ext)))
        }
      }
    }

    // 5. Generate manifest.json
    const totalDurationMs = clips.reduce((sum, c) => sum + c.durationMs, 0)
    const preliminaryFiles = collectAllFiles(stagingDir).map((f) => relative(stagingDir, f).replace(/\\/g, '/'))

    const manifest = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      generator: 'ReelStar Drama Short Studio',
      project: {
        id: project.id,
        title: project.title,
        synopsis: project.synopsis,
        aspectRatio: project.aspectRatio,
        styleId: project.styleId
      },
      episode: episode
        ? {
            id: episode.id,
            episodeNum: episode.episodeNum,
            title: episode.title,
            summary: episode.summary,
            hook: episode.hook,
            cliffhanger: episode.cliffhanger
          }
        : null,
      stats: {
        totalClips: clips.length,
        totalDurationSec: Math.round(totalDurationMs / 1000),
        characterCount: characters.length,
        derivativeCount: derivatives.length,
        locationCount: locations.length,
        propCount: props.length,
        continuityItemCount: continuityItems.length
      },
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        ttsVoice: c.ttsVoice,
        voiceStyle: c.voiceStyle
      })),
      continuityItems: continuityItems.map((ci) => ({
        id: ci.id,
        name: ci.name,
        kind: ci.kind,
        tier: ci.tier,
        status: ci.status,
        plantedEpisodeId: ci.plantedEpisodeId,
        payoffEpisodeId: ci.payoffEpisodeId
      })),
      shots: clips.map((c, i) => ({
        index: i + 1,
        id: c.id,
        title: c.title,
        story: c.story,
        visualPrompt: c.visualPrompt,
        narration: c.narration,
        durationMs: c.durationMs,
        motionType: c.motionType,
        cameraPreset: c.cameraPreset,
        hasImage: Boolean(c.imageAssetId),
        hasVideo: Boolean(c.videoAssetId),
        hasAudio: Boolean(c.audioAssetId)
      })),
      includedFiles: preliminaryFiles
    }

    writeFileSync(join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    // 6. Generate checksums.txt (SHA-256 for all files excluding checksums.txt)
    const allFiles = collectAllFiles(stagingDir)
    const checksumLines: string[] = []

    for (const fullPath of allFiles) {
      const rel = relative(stagingDir, fullPath).replace(/\\/g, '/')
      if (rel === 'checksums.txt') continue
      const hash = computeSha256(fullPath)
      checksumLines.push(`${hash}  ${rel}`)
    }

    writeFileSync(join(stagingDir, 'checksums.txt'), checksumLines.join('\n') + '\n', 'utf8')

    // 7. Compress using Windows native tar.exe (-a auto selects zip format based on .zip extension)
    if (existsSync(finalZipPath)) {
      rmSync(finalZipPath, { force: true })
    }

    await execFileAsync(windowsTar(), ['-a', '-c', '-f', finalZipPath, '-C', stagingDir, '.'])

    return finalZipPath
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
