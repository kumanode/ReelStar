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
  const elapsedRef = useRef(0)
  const mutedRef = useRef(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])

  useEffect(() => {
    if (!open) return
    const idx = initialClipId ? clips.findIndex((c) => c.id === initialClipId) : 0
    setIndex(idx >= 0 ? idx : 0)
    elapsedRef.current = 0
    setElapsedMs(0)
    setPlaying(true)
  }, [open, initialClipId, clips.length])

  const clip = clips[index] ?? null
  const image = clip?.imageAssetId ? assets[clip.imageAssetId] ?? null : null
  const video = clip?.videoAssetId ? assets[clip.videoAssetId] ?? null : null
  const audio = clip?.audioAssetId ? assets[clip.audioAssetId] ?? null : null
  const durMs = Math.max(1200, clip?.durationMs ?? 3000)

  // Reset shot progress only when switching shots or reopening, never on pause/resume.
  useEffect(() => {
    elapsedRef.current = 0
    setElapsedMs(0)
  }, [open, clip?.id])

  // Keep mute synced without recreating the Audio element or restarting playback.
  useEffect(() => {
    mutedRef.current = muted
    if (audioRef.current) audioRef.current.muted = muted
  }, [muted])

  // Load clip audio when entering a shot; play/pause is handled separately so resume continues in place.
  useEffect(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (!open || !clip || !audio) return
    const el = new Audio(audio.url)
    el.currentTime = Math.max(0, (clip.voiceInMs ?? 0) / 1000)
    el.muted = mutedRef.current
    audioRef.current = el
    return () => {
      el.pause()
      if (audioRef.current === el) audioRef.current = null
    }
  }, [open, clip?.id, audio?.id])

  // Play or pause the loaded clip audio without rewinding.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (!open || !playing) {
      el.pause()
      return
    }
    void el.play().catch(() => {})
  }, [open, playing, clip?.id, audio?.id])

  // Seek video to clip start only when the clip/video changes or the modal opens.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !open) return
    v.currentTime = Math.max(0, (clip?.mediaInMs ?? 0) / 1000)
  }, [open, clip?.id, video?.id])

  // Play or pause HTML5 video without rewinding on resume.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (!open || !playing) {
      v.pause()
      return
    }
    void v.play().catch(() => {})
  }, [open, playing, clip?.id, video?.id])

  // Advance timer from current position & apply shared Ken Burns camera motion on storyboard images.
  useEffect(() => {
    if (!open || !playing || !clip) return
    let raf = 0
    let last = performance.now()
    let localMs = elapsedRef.current

    const tick = (now: number): void => {
      const dt = Math.min(100, now - last)
      last = now
      localMs += dt
      const clamped = Math.min(durMs, localMs)
      elapsedRef.current = clamped
      setElapsedMs(clamped)

      if (imgRef.current && !video) {
        const p = Math.min(1, localMs / durMs)
        imgRef.current.style.transform = cameraCss(cameraAt(clip.cameraPreset, clip.motionStrength, p, localMs / 1000))
      }

      if (localMs >= durMs) {
        if (index < clips.length - 1) {
          elapsedRef.current = 0
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

  // Keyboard shortcuts while preview is open: Space play/pause, Left/Right step shots.
  useEffect(() => {
    if (!open || clips.length === 0) return
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIndex((i) => Math.max(0, i - 1))
        setElapsedMs(0)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIndex((i) => Math.min(clips.length - 1, i + 1))
        setElapsedMs(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, clips.length])

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
                muted={muted || Boolean(audio)}
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
              <span className="rounded-md bg-black/75 px-2 py-0.5 text-[11px] font-semibold text-white">
                {video ? 'Video AI' : image ? 'Gambar' : 'Kosong'} · {(durMs / 1000).toFixed(1).replace('.', ',')} dtk
              </span>
            </div>

            {/* Bottom subtitle preview */}
            {clip.narration.trim() && (
              <div className="pointer-events-none absolute inset-x-3 bottom-4 rounded-xl bg-black/80 px-3 py-2 text-center">
                <div className="mb-0.5 text-[11px] font-semibold text-sun">
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
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
              <span className="min-w-0 truncate font-semibold text-ink">{clip.title || `Shot ${clipNumber(index)}`}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {mmss(elapsedMs)} / {mmss(durMs)}
              </span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <div className="flex shrink-0 items-center gap-1.5">
              <IconButton
                label={muted ? 'Nyalakan suara' : 'Bisukan suara'}
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </IconButton>
              {audio ? (
                <Badge tone="ok">Ada suara</Badge>
              ) : video && isDialog ? (
                <Badge tone="info">Audio video</Badge>
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
                    elapsedRef.current = 0
                    setElapsedMs(0)
                    if (clips.length === 1) {
                      if (videoRef.current) videoRef.current.currentTime = Math.max(0, (clips[0]?.mediaInMs ?? 0) / 1000)
                      if (audioRef.current) audioRef.current.currentTime = Math.max(0, (clips[0]?.voiceInMs ?? 0) / 1000)
                    }
                    setIndex(0)
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
