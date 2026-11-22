import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { cameraAt, cameraCss } from '@shared/motion'
import { isVideoDialogue } from '@shared/validation'
import type { Asset, Character, Clip, Project } from '@shared/types'
import { Badge, Button, IconButton, Modal, cx } from '../../components/ui'
import { clipNumber, mmss } from '../../lib/format'

interface AnimaticPreviewModalProps {
  open: boolean
  onClose: () => void
  project: Project
  clips: Clip[]
  assets: Record<string, Asset>
  characters: Character[]
  initialClipId?: string | null
  onJumpToClip?: (clipId: string) => void
}

/**
 * Lightweight 9:16 / 16:9 animatic player inside Tab Produksi so creators can check pacing,
 * framing, and dialogue flow before spending Video AI credits.
 */
export function AnimaticPreviewModal({
  open,
  onClose,
  project,
  clips,
  assets,
  characters,
  initialClipId,
  onJumpToClip
}: AnimaticPreviewModalProps) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])

  useEffect(() => {
    if (!open) return
    const idx = initialClipId ? clips.findIndex((c) => c.id === initialClipId) : 0
    setIndex(idx >= 0 ? idx : 0)
    setElapsedMs(0)
    setPlaying(true)
  }, [open, initialClipId, clips.length])

  const clip = clips[index] ?? null
  const image = clip?.imageAssetId ? assets[clip.imageAssetId] ?? null : null
  const video = clip?.videoAssetId ? assets[clip.videoAssetId] ?? null : null
  const audio = clip?.audioAssetId ? assets[clip.audioAssetId] ?? null : null
  const durMs = Math.max(1200, clip?.durationMs ?? 3000)

  // Play clip audio (TTS or extracted dialogue audio) when available.
  useEffect(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (!open || !playing || !clip || !audio || muted) return
    const el = new Audio(audio.url)
    el.currentTime = Math.max(0, (clip.voiceInMs ?? 0) / 1000)
    audioRef.current = el
    void el.play().catch(() => {})
    return () => {
      el.pause()
    }
  }, [open, playing, clip?.id, audio?.id, muted])

  // Sync HTML5 video preview when a clip already has video.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (!open || !playing) {
      v.pause()
      return
    }
    v.currentTime = Math.max(0, (clip?.mediaInMs ?? 0) / 1000)
    void v.play().catch(() => {})
  }, [open, playing, clip?.id, video?.id])

  // Advance timer & apply shared Ken Burns camera motion on storyboard images.
  useEffect(() => {
    if (!open || !playing || !clip) return
    let raf = 0
    let last = performance.now()
    let localMs = 0
    setElapsedMs(0)

    const tick = (now: number): void => {
      const dt = Math.min(100, now - last)
      last = now
      localMs += dt
      setElapsedMs(Math.min(durMs, localMs))

      if (imgRef.current && !video) {
        const p = Math.min(1, localMs / durMs)
        imgRef.current.style.transform = cameraCss(cameraAt(clip.cameraPreset, clip.motionStrength, p, localMs / 1000))
      }

      if (localMs >= durMs) {
        if (index < clips.length - 1) {
          setIndex((i) => i + 1)
        } else {
          setPlaying(false)
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, playing, clip?.id, durMs, index, clips.length, video])

  if (!open) return null

  const speaker = clip?.speakerId ? charById.get(clip.speakerId) ?? null : null
  const dType = clip?.shotDetail?.dialogueType ?? 'dialogue'
  const isInner = dType === 'vo' || dType === 'narration' || (!clip?.speakerId && !!clip?.narration.trim())
  const isDialog = clip ? isVideoDialogue(project, clip) : false
  const aspectCls = project.aspectRatio === '9:16' ? 'aspect-[9/16] h-[min(430px,58vh)]' : 'aspect-video w-full max-w-[540px]'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pratinjau Animatic"
      subtitle="Periksa alur visual, framing, dan teks sebelum membuat Video AI"
      width={620}
    >
      {!clip ? (
        <div className="py-12 text-center text-xs text-muted">Belum ada shot di episode ini.</div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {/* Visual frame */}
          <div
            className={cx(
              'relative overflow-hidden rounded-2xl border-2 border-line-2 bg-sand shadow-ink-md flex items-center justify-center',
              aspectCls
            )}
          >
            {video ? (
              <video
                ref={videoRef}
                src={video.url}
                muted
                playsInline
                className="size-full object-cover"
              />
            ) : image ? (
              <img
                ref={imgRef}
                src={image.url}
                alt={clip.title}
                draggable={false}
                className="size-full object-cover will-change-transform"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted">
                <span className="font-mono text-sm font-bold text-ink">Shot {clipNumber(index)}</span>
                <span>Belum ada gambar storyboard</span>
              </div>
            )}

            {/* Top HUD */}
            <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-center justify-between gap-2">
              <span className="rounded-md bg-black/75 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                {clipNumber(index)} / {clipNumber(clips.length - 1)}
              </span>
              <span className="rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-white">
                {video ? 'Video AI' : image ? 'Gambar' : 'Kosong'} · {(durMs / 1000).toFixed(1).replace('.', ',')} dtk
              </span>
            </div>

            {/* Bottom subtitle preview */}
            {clip.narration.trim() && (
              <div className="pointer-events-none absolute inset-x-3 bottom-4 rounded-xl bg-black/80 px-3 py-2 text-center">
                <div className="mb-0.5 text-[10px] font-semibold text-sun">
                  {speaker ? speaker.name : 'Narator'}
                  {isDialog ? ' · Dialog' : isInner ? ' · Monolog Batin' : ' · O.S.'}
                </div>
                <p className={cx('text-xs leading-snug text-white', isInner && 'italic')}>
                  {clip.narration}
                </p>
              </div>
            )}
          </div>

          {/* Progress strip across current shot */}
          <div className="w-full flex flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sand">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-75"
                style={{ width: `${Math.min(100, (elapsedMs / durMs) * 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span className="truncate font-semibold text-ink">{clip.title || `Shot ${clipNumber(index)}`}</span>
              <span className="font-mono tabular-nums">
                {mmss(elapsedMs)} / {mmss(durMs)}
              </span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex w-full items-center justify-between border-t border-line pt-3">
            <div className="flex items-center gap-1.5">
              <IconButton
                label={muted ? 'Nyalakan suara' : 'Bisukan suara'}
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </IconButton>
              {audio ? (
                <Badge tone="ok">Ada suara</Badge>
              ) : (
                <Badge tone="draft">Tanpa suara</Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              <IconButton
                label="Shot sebelumnya"
                disabled={index === 0}
                onClick={() => {
                  setIndex((i) => Math.max(0, i - 1))
                  setElapsedMs(0)
                }}
              >
                <ChevronLeft className="size-4" />
              </IconButton>

              <Button
                variant="primary"
                size="sm"
                icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                onClick={() => {
                  if (!playing && index === clips.length - 1 && elapsedMs >= durMs - 50) {
                    setIndex(0)
                    setElapsedMs(0)
                  }
                  setPlaying((p) => !p)
                }}
              >
                {playing ? 'Jeda' : 'Putar'}
              </Button>

              <IconButton
                label="Shot berikutnya"
                disabled={index >= clips.length - 1}
                onClick={() => {
                  setIndex((i) => Math.min(clips.length - 1, i + 1))
                  setElapsedMs(0)
                }}
              >
                <ChevronRight className="size-4" />
              </IconButton>
            </div>

            {onJumpToClip ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onJumpToClip(clip.id)
                  onClose()
                }}
              >
                Edit Shot ini
              </Button>
            ) : (
              <div className="w-20" />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
