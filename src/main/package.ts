import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { assetAbsPath, dataDir } from './paths'
import { getBundle, listContinuityItems } from './repo'
import { getSettings } from './settings'
import type { Clip } from '@shared/types'

const execFileAsync = promisify(execFile)

function safeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'file'
  )
}

function srtTime(ms: number): string {
  const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0')
  const totalSeconds = ms / 1000
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  const millis = Math.floor(ms % 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(millis, 3)}`
}

function buildClipsSrt(clips: Clip[]): string {
  let elapsedMs = 0
  const cues: string[] = []
  let cueIndex = 1

  for (const clip of clips) {
    const text = (clip.narration || '').trim()
    const startMs = elapsedMs
    const endMs = elapsedMs + clip.durationMs
    elapsedMs = endMs

    if (text) {
      cues.push(`${cueIndex}\n${srtTime(startMs)} --> ${srtTime(endMs)}\n${text}\n`)
      cueIndex++
    }
  }

  return cues.join('\n') + '\n'
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
      // Look in default export directory for matching mp4
      try {
        const files = readdirSync(defaultDir)
        const matchPrefix = safeFilename(project.title)
        const matched = files
          .filter((f) => f.endsWith('.mp4') && f.startsWith(matchPrefix))
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
    const srtContent = buildClipsSrt(clips)
    const srtFileName = `${safeFilename(project.title)}${epSuffix}.srt`
    writeFileSync(join(stagingDir, srtFileName), srtContent, 'utf8')

    // 3. Collect Thumbnails & Cover
    const thumbDir = join(stagingDir, 'thumbnails')
    mkdirSync(thumbDir, { recursive: true })

    if (project.coverAssetId && assetMap.has(project.coverAssetId)) {
      const coverAsset = assetMap.get(project.coverAssetId)!
      const abs = assetAbsPath(projectId, coverAsset.localPath)
      if (existsSync(abs)) {
        copyFileSync(abs, join(thumbDir, 'cover.jpg'))
      }
    }

    const thumbAssets = assets.filter((a) => a.kind === 'image' && a.meta.thumbnail === true)
    let thumbIndex = 1
    for (const ta of thumbAssets) {
      const abs = assetAbsPath(projectId, ta.localPath)
      if (existsSync(abs)) {
        copyFileSync(abs, join(thumbDir, `thumbnail-${thumbIndex}.jpg`))
        thumbIndex++
      }
    }

    // 4. Collect Lorebook reference assets
    const loreDir = join(stagingDir, 'lorebook')
    mkdirSync(loreDir, { recursive: true })

    for (const ch of characters) {
      if (ch.sheetAssetId && assetMap.has(ch.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(ch.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          copyFileSync(abs, join(loreDir, `character-${safeFilename(ch.name)}.jpg`))
        }
      }
    }

    for (const loc of locations) {
      if (loc.sheetAssetId && assetMap.has(loc.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(loc.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          copyFileSync(abs, join(loreDir, `location-${safeFilename(loc.name)}.jpg`))
        }
      }
    }

    for (const prop of props) {
      if (prop.sheetAssetId && assetMap.has(prop.sheetAssetId)) {
        const abs = assetAbsPath(projectId, assetMap.get(prop.sheetAssetId)!.localPath)
        if (existsSync(abs)) {
          copyFileSync(abs, join(loreDir, `prop-${safeFilename(prop.name)}.jpg`))
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

    await execFileAsync('tar.exe', ['-a', '-c', '-f', finalZipPath, '-C', stagingDir, '.'])

    return finalZipPath
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
