import type { AspectRatio } from './types'

export interface ExportPreset {
  id: string
  name: string
  platform: 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'custom'
  aspectRatio: AspectRatio
  resolution: 720 | 1080 | 2160
  fps: 30 | 60
  videoBitrate?: string
  maxDurationSec?: number
  description: string
  badge?: string
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    platform: 'tiktok',
    aspectRatio: '9:16',
    resolution: 1080,
    fps: 30,
    videoBitrate: '8000k',
    maxDurationSec: 600,
    description: '1080×1920 (9:16), 30 fps, bitrate 8 Mbps. Standar video vertikal TikTok.',
    badge: 'Populer'
  },
  {
    id: 'reels',
    name: 'Instagram Reels',
    platform: 'instagram',
    aspectRatio: '9:16',
    resolution: 1080,
    fps: 30,
    videoBitrate: '8000k',
    maxDurationSec: 90,
    description: '1080×1920 (9:16), 30 fps, bitrate 8 Mbps. Maksimal 90 detik.',
    badge: 'Maks 90s'
  },
  {
    id: 'shorts',
    name: 'YouTube Shorts',
    platform: 'youtube',
    aspectRatio: '9:16',
    resolution: 1080,
    fps: 30,
    videoBitrate: '10000k',
    maxDurationSec: 60,
    description: '1080×1920 (9:16), 30 fps, bitrate 10 Mbps. Batas Shorts 60 detik.',
    badge: 'Maks 60s'
  },
  {
    id: 'youtube_standard',
    name: 'YouTube Standard',
    platform: 'youtube',
    aspectRatio: '16:9',
    resolution: 1080,
    fps: 30,
    videoBitrate: '12000k',
    description: '1920×1080 (16:9), 30 fps, bitrate 12 Mbps. Format landscape YouTube.'
  },
  {
    id: 'facebook_reels',
    name: 'Facebook Reels',
    platform: 'facebook',
    aspectRatio: '9:16',
    resolution: 1080,
    fps: 30,
    videoBitrate: '8000k',
    maxDurationSec: 90,
    description: '1080×1920 (9:16), 30 fps, bitrate 8 Mbps. Maksimal 90 detik.'
  },
  {
    id: 'custom',
    name: 'Kustom',
    platform: 'custom',
    aspectRatio: '9:16',
    resolution: 1080,
    fps: 30,
    description: 'Atur resolusi, frame rate, dan opsi encoding secara manual.'
  }
]

export function getExportPreset(id: string): ExportPreset | undefined {
  return EXPORT_PRESETS.find((p) => p.id === id)
}

export function validatePresetDuration(preset: ExportPreset, durationSec: number): { valid: boolean; warning?: string } {
  if (preset.maxDurationSec && durationSec > preset.maxDurationSec) {
    return {
      valid: false,
      warning: `Durasi video (${Math.round(durationSec)}s) melebihi batas maksimal ${preset.name} (${preset.maxDurationSec}s). Video mungkin akan dipotong atau ditolak oleh platform.`
    }
  }
  return { valid: true }
}
