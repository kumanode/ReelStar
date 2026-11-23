import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Film,
  Image as ImageIcon,
  Link2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Package,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  User,
  Volume2,
  Wand2,
  X
} from 'lucide-react'
import { checkLockCompliance, filterLockWordsForClip } from '@shared/lock'
import { CAMERA_PRESETS, MOTION_STRENGTHS } from '@shared/motion'
import {
  CAMERA_POV_OPTIONS,
  collectAllAvailableReferenceSheets,
  compileClipPrompt,
  findPlannedAnchorClipId,
  findSceneAnchorForClip,
  hasReferenceOverride,
  type ReferenceSheetItem
} from '@shared/prompts'
import {
  dialogVoiceNote,
  getClipImageStatus,
  getClipVideoStatus,
  isVideoDialogue,
  referenceLimit,
  type GenerationPrerequisitesContext
} from '@shared/validation'
import type {
  Asset,
  CameraPresetId,
  Character,
  CharacterDerivative,
  Clip,
  DialogueType,
  Job,
  Location,
  LockWord,
  MotionStrength,
  Project,
  Prop
} from '@shared/types'
import { AutoTextarea } from '../../components/AutoTextarea'
import { ClipVisual } from '../../components/ClipVisual'
import { Popover } from '../../components/Popover'
import { Select } from '../../components/Select'
import { Badge, Button, IconButton, Menu, Switch, confirmDialog, cx } from '../../components/ui'
import { clipNumber, errorText, secLabel } from '../../lib/format'
import { useApp } from '../../store/app'
import { isRunning, jobFor, useProject } from '../../store/project'

const DIALOGUE_TYPE_OPTIONS: { value: DialogueType; label: string }[] = [
  { value: 'dialogue', label: 'Dialog (Lip-Sync)' },
  { value: 'vo', label: 'Monolog Batin (V.O. · TTS)' },
  { value: 'os', label: 'Off-Screen (O.S. · TTS)' },
  { value: 'narration', label: 'Narasi (TTS)' }
]

interface ShotCardProps {
  clip: Clip
  index: number
  total: number
  project: Project
  characters: Character[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  assets: Record<string, Asset>
  jobs: Record<string, Job>
  prereqCtx: GenerationPrerequisitesContext
  activeLocks: LockWord[]
  previousClipImageAssetId?: string | null
  checked: boolean
  expanded: boolean
  onToggleCheck: () => void
  onToggleExpand: () => void
  onPlayAnimatic: () => void
}

const REF_KIND_LABEL: Record<ReferenceSheetItem['kind'], string> = {
  character: 'Tokoh',
  derivative: 'Kostum',
  location: 'Lokasi',
  prop: 'Prop',
  scene_anchor: 'Jangkar Latar & Prop',
  custom: 'Kustom'
}

export function ShotCard({
  clip,
  index,
  total,
  project,
  characters,
  derivatives,
  locations,
  props,
  assets,
  jobs,
  prereqCtx,
  activeLocks,
  previousClipImageAssetId,
  checked,
  expanded,
  onToggleCheck,
  onToggleExpand,
  onPlayAnimatic
}: ShotCardProps) {
  const { updateClip, moveClip, addClip, removeClip, flush, load, upsertJob } = useProject()
  const { toast } = useApp()

  const [charPopOpen, setCharPopOpen] = useState(false)
  const [locPopOpen, setLocPopOpen] = useState(false)
  const [propPopOpen, setPropPopOpen] = useState(false)
  const [busyImg, setBusyImg] = useState(false)
  const [busyVid, setBusyVid] = useState(false)
  const [busyTts, setBusyTts] = useState(false)
  const [busyPrompt, setBusyPrompt] = useState(false)
  const [showCompiledPreview, setShowCompiledPreview] = useState(false)
  const charAnchor = useRef<HTMLButtonElement>(null)
  const locAnchor = useRef<HTMLButtonElement>(null)
  const propAnchor = useRef<HTMLButtonElement>(null)

  const image = clip.imageAssetId ? assets[clip.imageAssetId] ?? null : null
  const video = clip.videoAssetId ? assets[clip.videoAssetId] ?? null : null
  const audio = clip.audioAssetId ? assets[clip.audioAssetId] ?? null : null
  const imageJob = jobFor(jobs, 'image', { clipId: clip.id })
  const videoJob = jobFor(jobs, 'video', { clipId: clip.id })
  const ttsJob = jobFor(jobs, 'tts', { clipId: clip.id })

  const imgStatus = useMemo(() => getClipImageStatus(clip, project, prereqCtx), [clip, project, prereqCtx])
  const vidStatus = useMemo(() => getClipVideoStatus(clip, project, prereqCtx), [clip, project, prereqCtx])
  const voiceNotice = useMemo(() => dialogVoiceNote(project, clip, assets), [project, clip, assets])
  const isDialogVideo = isVideoDialogue(project, clip)
  const hasNarration = !!clip.narration.trim()
  const dType: DialogueType = clip.shotDetail?.dialogueType ?? (clip.speakerId ? 'dialogue' : 'narration')
  const isInnerSpeech = dType === 'vo' || dType === 'narration' || (!clip.speakerId && hasNarration)
  const isTrimmed = !!video && (clip.mediaInMs > 0 || (video.durationMs != null && clip.durationMs < video.durationMs - 150))

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])
  const derivById = useMemo(() => new Map(derivatives.map((d) => [d.id, d])), [derivatives])
  const locById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const propById = useMemo(() => new Map(props.map((p) => [p.id, p])), [props])

  const imageVersions = useMemo(
    () => Object.values(assets).filter((a) => a.clipId === clip.id && a.kind === 'image' && !a.meta?.isReference),
    [assets, clip.id]
  )

  const refCap = useMemo(() => referenceLimit(project, prereqCtx), [project, prereqCtx])
  const sceneAnchor = useMemo(() => findSceneAnchorForClip(clip, prereqCtx.clips), [clip, prereqCtx.clips])
  const plannedAnchorId = useMemo(
    () =>
      clip.locationId
        ? findPlannedAnchorClipId({ ...clip, shotDetail: { ...(clip.shotDetail ?? {}), sceneAnchorMode: 'auto' } }, prereqCtx.clips)
        : null,
    [clip, prereqCtx.clips]
  )

  const allRefItems = useMemo(
    () => collectAllAvailableReferenceSheets(clip, characters, derivatives, locations, props, Math.max(1, refCap), sceneAnchor),
    [clip, characters, derivatives, locations, props, refCap, sceneAnchor]
  )
  const refItems = useMemo(() => (refCap > 0 ? allRefItems.slice(0, refCap) : []), [allRefItems, refCap])
  const overflowRefs = useMemo(() => (refCap > 0 ? allRefItems.slice(refCap) : allRefItems), [allRefItems, refCap])

  const cameraPovOptions = useMemo(() => {
    const cur = (clip.shotDetail?.cameraPov ?? '').trim()
    const base = CAMERA_POV_OPTIONS.map((o) => ({ value: o.value, label: o.label }))
    if (cur && !base.some((o) => o.value === cur.toLowerCase())) {
      return [...base, { value: cur, label: `AI: ${cur.length > 42 ? `${cur.slice(0, 40)}…` : cur}` }]
    }
    return base
  }, [clip.shotDetail?.cameraPov])

  const scopedLocks = useMemo(() => filterLockWordsForClip(activeLocks, clip), [activeLocks, clip])

  const compiledPrompt = useMemo(() => {
    if (!expanded) return ''
    return compileClipPrompt({
      project,
      clip,
      characters: characters.filter((c) => clip.characterIds.includes(c.id)),
      derivatives,
      locations,
      props,
      refItems,
      refNames: refItems.map((r) => r.name),
      lockWords: scopedLocks,
      limit: 6000
    })
  }, [expanded, project, clip, characters, derivatives, locations, props, refItems, scopedLocks])

  const lockCompliance = useMemo(() => {
    if (!expanded || !scopedLocks.length) return { compliant: true, missing: [] as LockWord[] }
    return checkLockCompliance(compiledPrompt, scopedLocks)
  }, [expanded, compiledPrompt, scopedLocks])

  const hasSheetAsset = (id: string | null | undefined): boolean => Boolean(id && assets[id])
  const charsSheetsReady =
    clip.characterIds.length > 0 &&
    clip.characterIds.every((cid) => {
      const c = charById.get(cid)
      if (!c) return false
      const did = clip.costumeIds?.[cid]
      if (did) return hasSheetAsset(derivById.get(did)?.sheetAssetId)
      return hasSheetAsset(c.sheetAssetId)
    })
  const locSheetReady = clip.locationId ? hasSheetAsset(locById.get(clip.locationId)?.sheetAssetId) : false
  const propsSheetsReady =
    clip.propIds.length > 0 && clip.propIds.every((pid) => hasSheetAsset(propById.get(pid)?.sheetAssetId))

  const speakerOptions = useMemo(
    () => [{ value: '', label: 'Narator' }, ...characters.map((c) => ({ value: c.id, label: c.name }))],
    [characters]
  )

  const imgBadge =
    imgStatus.status === 'current'
      ? { label: 'Gambar ✓', tone: 'ok' as const }
      : imgStatus.status === 'stale'
        ? { label: 'Gambar Basi', tone: 'warn' as const }
        : imgStatus.status === 'blocked'
          ? { label: 'Perlu Lembar / Syarat', tone: 'bad' as const }
          : { label: 'Belum Gambar', tone: 'draft' as const }

  const vidBadge =
    vidStatus.status === 'current'
      ? { label: 'Video ✓', tone: 'ok' as const }
      : vidStatus.status === 'stale'
        ? { label: 'Video Basi', tone: 'warn' as const }
        : vidStatus.status === 'blocked' && image
          ? { label: 'Video Terblokir', tone: 'bad' as const }
          : { label: 'Belum Video', tone: 'draft' as const }

  const handleGenerateImage = async () => {
    setBusyImg(true)
    try {
      await flush()
      const job = await window.api.generate.clipImage(clip.id)
      upsertJob(job)
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setBusyImg(false)
    }
  }

  const handleGenerateVideo = async () => {
    if (!image && !clip.continueFromPrevious) {
      toast('info', `Buat gambar Shot ${clipNumber(index)} dulu sebelum membuat videonya.`)
      return
    }
    setBusyVid(true)
    try {
      await flush()
      const job = await window.api.generate.clipVideo(clip.id)
      upsertJob(job)
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setBusyVid(false)
    }
  }

  const handleGenerateTts = async () => {
    if (!hasNarration) {
      toast('info', 'Isi teks narasi/monolog batin dulu sebelum membuat suara TTS.')
      return
    }
    setBusyTts(true)
    try {
      await flush()
      const job = await window.api.generate.clipTts(clip.id)
      upsertJob(job)
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setBusyTts(false)
    }
  }

  const handleReplaceMedia = async () => {
    try {
      await flush()
      const asset = await window.api.assets.replaceClipMedia(project.id, clip.id)
      if (asset) toast('success', 'Media klip berhasil diganti.')
    } catch (err) {
      toast('error', errorText(err))
    }
  }

  const handleOptimizePrompt = async () => {
    const targetEpId = useProject.getState().episode?.id
    setBusyPrompt(true)
    try {
      await flush()
      const bundle = await window.api.story.writePrompts(project.id, clip.episodeId, [clip.id], {
        force: true,
        useAi: true,
        requireAi: true
      })
      if (useProject.getState().episode?.id === targetEpId) {
        load(bundle)
      }
      toast('success', `Prompt visual & video Shot ${clipNumber(index)} berhasil dioptimasi AI.`)
    } catch (err) {
      toast('error', `Gagal mengoptimasi prompt: ${errorText(err)}`)
    } finally {
      setBusyPrompt(false)
    }
  }

  const handleAttachPrevShotRef = () => {
    if (!previousClipImageAssetId) return
    const currentIds = hasReferenceOverride(clip) ? (clip.referenceAssetIds ?? []) : refItems.map((r) => r.sheetAssetId)
    if (currentIds.includes(previousClipImageAssetId)) return
    const nextIds = [...currentIds.slice(0, Math.max(0, refCap - 1)), previousClipImageAssetId]
    updateClip(clip.id, { referenceAssetIds: nextIds })
    toast('success', 'Gambar shot sebelumnya dipasang sebagai referensi kontinuitas.')
  }

  const handlePromoteOverflowRef = (sheetAssetId: string) => {
    const currentIds = hasReferenceOverride(clip) ? (clip.referenceAssetIds ?? []) : refItems.map((r) => r.sheetAssetId)
    const filtered = currentIds.filter((id) => id !== sheetAssetId)
    const nextIds = [sheetAssetId, ...filtered].slice(0, Math.max(1, refCap))
    updateClip(clip.id, { referenceAssetIds: nextIds })
    toast('info', 'Urutan referensi diprioritaskan ke slot aktif.')
  }

  const handlePickReference = async () => {
    try {
      await flush()
      const asset = await window.api.assets.pickReference(project.id, clip.id)
      if (!asset) return
      const currentIds = hasReferenceOverride(clip) ? (clip.referenceAssetIds ?? []) : refItems.map((r) => r.sheetAssetId)
      if (!currentIds.includes(asset.id)) {
        updateClip(clip.id, { referenceAssetIds: [asset.id, ...currentIds] })
      }
      toast('success', 'Gambar referensi tambahan dipasang ke shot ini.')
    } catch (err) {
      toast('error', errorText(err))
    }
  }

  const handleRemove = async () => {
    const ok = await confirmDialog({
      title: `Hapus Shot ${clipNumber(index)}?`,
      body: 'Shot beserta tautan gambar, video, dan suaranya akan dilepas dari episode ini.',
      confirm: 'Hapus shot',
      danger: true
    })
    if (ok) removeClip(clip.id)
  }

  const toggleCharacter = (cid: string) => {
    const on = clip.characterIds.includes(cid)
    const nextIds = on ? clip.characterIds.filter((x) => x !== cid) : [...clip.characterIds, cid]
    const nextCostumes = { ...clip.costumeIds }
    if (on) delete nextCostumes[cid]
    updateClip(clip.id, { characterIds: nextIds, costumeIds: nextCostumes })
  }

  const toggleProp = (pid: string) => {
    const on = clip.propIds.includes(pid)
    updateClip(clip.id, { propIds: on ? clip.propIds.filter((x) => x !== pid) : [...clip.propIds, pid] })
  }

  const activeVisualJob = isRunning(videoJob)
    ? videoJob
    : isRunning(imageJob)
      ? imageJob
      : videoJob?.status === 'failed'
        ? videoJob
        : imageJob
  const isAnyGenerating = isRunning(imageJob) || isRunning(videoJob) || isRunning(ttsJob)
  const speakerName = clip.speakerId ? (charById.get(clip.speakerId)?.name ?? null) : null
  const speechBadge = !hasNarration
    ? { label: 'Aksi Hening', tone: 'draft' as const }
    : isDialogVideo
      ? { label: speakerName ? `Dialog · ${speakerName}` : 'Dialog · Lip-Sync', tone: 'warn' as const }
      : dType === 'os'
        ? { label: speakerName ? `Off-Screen · ${speakerName}` : 'Off-Screen · TTS', tone: 'info' as const }
        : { label: speakerName ? `Monolog V.O. · ${speakerName}` : 'Narasi · TTS', tone: 'info' as const }

  const thumbAspect = project.aspectRatio === '9:16' ? 'w-[112px] h-[186px]' : 'w-[172px] h-[108px]'
  const charChipText =
    clip.characterIds.length > 0
      ? clip.characterIds
          .map((id) => {
            const c = charById.get(id)
            const d = clip.costumeIds?.[id] ? derivById.get(clip.costumeIds[id]) : null
            return c ? (d ? `${c.name}/${d.name}` : c.name) : '?'
          })
          .join(', ')
      : 'Pemeran'
  const locChipText = clip.locationId ? (locById.get(clip.locationId)?.name ?? 'Lokasi?') : 'Lokasi'
  const propChipText =
    clip.propIds.length > 0
      ? clip.propIds.map((id) => propById.get(id)?.name ?? '?').join(', ')
      : 'Prop'

  return (
    <article
      id={`shot-card-${clip.id}`}
      className={cx(
        'flex flex-col gap-3 rounded-2xl border bg-surface p-3.5 transition-all',
        isAnyGenerating
          ? 'rs-card-generating border-accent/80'
          : checked
            ? 'border-accent ring-1 ring-accent shadow-ink'
            : 'border-line hover:border-line-3'
      )}
    >
      <div className="flex flex-col gap-3.5 sm:flex-row">
        {/* LEFT: Cinema Preview Frame + Multi-select + Animated Generating State */}
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <div className={cx('relative overflow-hidden rounded-xl border border-line-2 bg-sand shadow-xs', thumbAspect)}>
            <ClipVisual clip={clip} image={image} video={video} job={activeVisualJob} />

            {/* Top overlay: Checkbox + Shot number + Media status pill */}
            <div className="absolute inset-x-1.5 top-1.5 z-20 flex items-center justify-between gap-1">
              <label
                className="flex cursor-pointer items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-white backdrop-blur-[2px]"
                title="Pilih shot untuk aksi batch"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={onToggleCheck}
                  className="size-3 cursor-pointer accent-accent"
                />
                <span className="font-mono text-[11px] font-bold">{clipNumber(index)}</span>
              </label>
              {video ? (
                <span className="rounded bg-ok-ink/95 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">VID</span>
              ) : image ? (
                <span className="rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">IMG</span>
              ) : null}
            </div>

            {/* Center play animatic button when visual exists and idle */}
            {(image || video) && !isRunning(imageJob) && !isRunning(videoJob) && (
              <button
                type="button"
                onClick={onPlayAnimatic}
                aria-label="Pratinjau shot"
                className="absolute inset-0 z-[5] flex items-center justify-center bg-black/0 opacity-0 transition-all hover:bg-black/40 hover:opacity-100"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-black/75 text-white shadow-ink">
                  <Play className="ml-0.5 size-4" fill="currentColor" />
                </span>
              </button>
            )}

            {/* Bottom framing label with subtle cinema gradient */}
            {clip.framing && !isRunning(activeVisualJob) && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2 pb-1.5 pt-4">
                <span className="block truncate text-[11px] font-medium text-white/95" title={clip.framing}>
                  {clip.framing.replace(/_/g, ' ')}
                </span>
              </div>
            )}
          </div>

          {/* Image version dots when > 1 */}
          {imageVersions.length > 1 && (
            <div className="flex items-center justify-center gap-0.5">
              {imageVersions.slice(-4).map((v, vi) => {
                const isActive = v.id === clip.imageAssetId
                return (
                  <button
                    key={v.id}
                    type="button"
                    aria-label={`Versi gambar ${vi + 1}`}
                    aria-current={isActive ? 'true' : undefined}
                    title={`Versi gambar ${vi + 1}`}
                    onClick={() => void window.api.assets.setActive(clip.id, v.id)}
                    className="group flex size-5 items-center justify-center rounded-full"
                  >
                    <span
                      className={cx(
                        'size-2 rounded-full transition-colors',
                        isActive ? 'bg-accent' : 'bg-line-3 group-hover:bg-ink-2'
                      )}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT: 3-Zone Modern Storyboard Content */}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2.5">
          {/* ZONE 1: Compact Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <input
                value={clip.title}
                onChange={(e) => updateClip(clip.id, { title: e.target.value })}
                aria-label="Judul shot"
                placeholder={`Shot ${clipNumber(index)}`}
                className="w-36 min-w-0 rounded-md bg-transparent px-1 font-display text-sm font-bold text-ink outline-none hover:bg-sand focus:bg-sand focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-44 xl:w-52"
              />
              <Badge tone={speechBadge.tone}>{speechBadge.label}</Badge>
              {clip.continueFromPrevious && (
                <Badge tone="info" title="Menyambung frame terakhir dari shot sebelumnya">
                  <Link2 className="mr-1 inline size-3" />
                  Sambung
                </Badge>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <Badge tone={imgBadge.tone} title={imgStatus.blockers.join('\n')}>
                {imgBadge.label}
              </Badge>
              <Badge tone={vidBadge.tone} title={vidStatus.blockers.join('\n')}>
                {vidBadge.label}
              </Badge>
              <span
                className={cx(
                  'rounded-lg border border-line px-2 py-0.5 font-mono text-[11px] tabular-nums',
                  isTrimmed ? 'bg-ok-soft font-semibold text-ok-ink' : 'bg-paper text-ink-2'
                )}
                title={isTrimmed ? 'Durasi dipangkas otomatis (non-destruktif)' : 'Durasi klip'}
              >
                {secLabel(clip.durationMs)}
              </span>
              <Menu
                trigger={(open) => (
                  <IconButton label="Opsi shot" size={26} onClick={open}>
                    <MoreHorizontal className="size-3.5" />
                  </IconButton>
                )}
                items={[
                  ...(index > 0 ? [{ label: 'Pindah ke atas', icon: <ArrowUp className="size-3.5" />, run: () => moveClip(clip.id, -1) }] : []),
                  ...(index < total - 1 ? [{ label: 'Pindah ke bawah', icon: <ArrowDown className="size-3.5" />, run: () => moveClip(clip.id, 1) }] : []),
                  { label: 'Tambah shot setelah ini', icon: <Plus className="size-3.5" />, run: () => addClip(clip.id) },
                  { label: 'Ganti media dari file lokal', icon: <Upload className="size-3.5" />, run: () => void handleReplaceMedia() },
                  { label: 'Hapus shot', icon: <Trash2 className="size-3.5" />, danger: true, run: () => void handleRemove() }
                ]}
              />
            </div>
          </div>

          {/* ZONE 2: Unified Studio Script & Visual Surface (Slim inline controls + clean textareas) */}
          <div
            className={cx(
              'overflow-hidden rounded-xl border border-line',
              isInnerSpeech ? 'bg-sand/55' : 'bg-paper'
            )}
          >
            {/* Slim voice & emotion strip integrated into script box */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line/80 bg-sand/45 px-2.5 py-1.5">
              <div className="w-[152px] shrink-0">
                <Select
                  label="Pembicara"
                  size="sm"
                  value={clip.speakerId ?? ''}
                  options={speakerOptions}
                  onChange={(val) => {
                    const sid = val ? String(val) : null
                    const nextType: DialogueType = sid ? (clip.shotDetail?.dialogueType ?? 'dialogue') : 'narration'
                    updateClip(clip.id, {
                      speakerId: sid,
                      shotDetail: { ...(clip.shotDetail ?? {}), dialogueType: nextType }
                    })
                  }}
                />
              </div>
              <div className="w-[164px] shrink-0">
                <Select
                  label="Jenis ucapan"
                  size="sm"
                  value={dType}
                  options={DIALOGUE_TYPE_OPTIONS}
                  onChange={(val) =>
                    updateClip(clip.id, {
                      shotDetail: { ...(clip.shotDetail ?? {}), dialogueType: val as DialogueType }
                    })
                  }
                />
              </div>
              <input
                value={clip.emotion}
                onChange={(e) => updateClip(clip.id, { emotion: e.target.value })}
                placeholder="Emosi (mis. marah, dingin, panik)"
                aria-label="Emosi"
                className="h-7 min-w-[120px] flex-1 rounded-lg border border-transparent bg-paper/75 px-2.5 text-[11px] text-ink outline-none placeholder:text-muted hover:border-line focus:border-ink focus:bg-paper focus-visible:ring-2 focus-visible:ring-accent/35"
              />
            </div>

            {/* Dialogue & Visual Action textareas (no ugly resize handles) */}
            <div className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <MessageSquare className={cx('mt-1 size-3.5 shrink-0', hasNarration ? 'text-accent' : 'text-muted/60')} />
                <AutoTextarea
                  value={clip.narration}
                  onChange={(e) => updateClip(clip.id, { narration: e.target.value })}
                  aria-label="Dialog atau narasi shot"
                  placeholder="Tulis dialog tokoh atau monolog batin (kosongkan hanya jika shot hening)…"
                  minRows={1}
                  maxHeight={110}
                  className={cx(
                    'w-full resize-none rounded bg-transparent text-[13px] leading-relaxed text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/30',
                    isInnerSpeech && 'italic'
                  )}
                />
              </div>
              <div className="flex items-start gap-2 border-t border-line/70 pt-2">
                <span className="mt-0.5 shrink-0 rounded bg-sand px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Visual
                </span>
                <AutoTextarea
                  value={clip.story}
                  onChange={(e) => updateClip(clip.id, { story: e.target.value })}
                  aria-label="Aksi visual shot"
                  placeholder="Aksi visual di layar dan gerakan tokoh…"
                  minRows={1}
                  maxHeight={96}
                  className="w-full resize-none rounded bg-transparent text-xs leading-relaxed text-ink-2 outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </div>
              {voiceNotice?.tone === 'warn' && (
                <div className="flex items-center gap-1.5 rounded-lg bg-sun-soft px-2.5 py-1.5 text-[11px] font-medium text-sun-ink">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span>{voiceNotice.text}</span>
                </div>
              )}
            </div>
          </div>

          {/* ZONE 3: Stable 2-Side Footer (Entity Chips stay horizontal on left, Actions locked right) */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
            {/* Lorebook chips */}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <button
                ref={charAnchor}
                type="button"
                onClick={() => setCharPopOpen((o) => !o)}
                className="inline-flex h-7 max-w-[140px] items-center gap-1 rounded-lg border border-line bg-sand px-2 text-[11px] font-medium text-ink hover:border-ink-2 xl:max-w-[175px]"
                title={
                  clip.characterIds.length > 0
                    ? `${charChipText} · ${charsSheetsReady ? 'Lembar referensi siap' : 'Sebagian pemeran belum punya lembar referensi'}`
                    : 'Pilih pemeran di shot ini'
                }
              >
                <User className="size-3 shrink-0 text-muted" />
                {clip.characterIds.length > 0 && (
                  <span
                    className={cx(
                      'size-1.5 shrink-0 rounded-full',
                      charsSheetsReady ? 'bg-ok-ink' : 'bg-sun'
                    )}
                  />
                )}
                <span className="truncate">{charChipText}</span>
              </button>
              <Popover anchor={charAnchor} open={charPopOpen} onClose={() => setCharPopOpen(false)} width={280}>
                <div className="flex flex-col gap-2 p-3 text-xs">
                  <span className="font-display text-xs font-bold text-ink">Pemeran &amp; Kostum di Shot ini</span>
                  {characters.length === 0 ? (
                    <span className="text-muted">Belum ada karakter di Lorebook.</span>
                  ) : (
                    <div className="scroll-thin flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                      {characters.map((c) => {
                        const active = clip.characterIds.includes(c.id)
                        const variants = derivatives.filter((d) => d.characterId === c.id)
                        return (
                          <div
                            key={c.id}
                            className={cx(
                              'flex flex-col gap-1 rounded-lg border p-2',
                              active ? 'border-line-2 bg-sun-soft' : 'border-line bg-paper'
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => toggleCharacter(c.id)}
                              className="flex items-center justify-between text-left font-semibold text-ink"
                            >
                              <span>{c.name}</span>
                              <span className="text-[11px] text-muted">{active ? 'Terpasang' : '+ Tambah'}</span>
                            </button>
                            {active && variants.length > 0 && (
                              <Select
                                label="Kostum"
                                size="sm"
                                value={clip.costumeIds?.[c.id] ?? ''}
                                options={[{ value: '', label: 'Kostum bawaan' }, ...variants.map((v) => ({ value: v.id, label: v.name }))]}
                                onChange={(val) => {
                                  const next = { ...clip.costumeIds }
                                  if (val) next[c.id] = String(val)
                                  else delete next[c.id]
                                  updateClip(clip.id, { costumeIds: next })
                                }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </Popover>

              <button
                ref={locAnchor}
                type="button"
                onClick={() => setLocPopOpen((o) => !o)}
                className="inline-flex h-7 max-w-[135px] items-center gap-1 rounded-lg border border-line bg-sand px-2 text-[11px] font-medium text-ink hover:border-ink-2 xl:max-w-[165px]"
                title={
                  clip.locationId
                    ? `${locChipText} · ${locSheetReady ? 'Lembar referensi lokasi siap' : 'Belum punya lembar referensi di Lorebook'}`
                    : 'Pilih lokasi shot'
                }
              >
                <MapPin className="size-3 shrink-0 text-muted" />
                {clip.locationId && (
                  <span
                    className={cx(
                      'size-1.5 shrink-0 rounded-full',
                      locSheetReady ? 'bg-ok-ink' : 'bg-sun'
                    )}
                  />
                )}
                <span className="truncate">{locChipText}</span>
              </button>
              <Popover anchor={locAnchor} open={locPopOpen} onClose={() => setLocPopOpen(false)} width={240}>
                <div className="scroll-thin flex max-h-56 flex-col gap-1 overflow-y-auto p-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      updateClip(clip.id, { locationId: null })
                      setLocPopOpen(false)
                    }}
                    className={cx('rounded-lg px-2.5 py-1.5 text-left', !clip.locationId ? 'bg-sun-soft font-semibold' : 'hover:bg-sand')}
                  >
                    Tanpa lokasi
                  </button>
                  {locations.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        updateClip(clip.id, { locationId: l.id })
                        setLocPopOpen(false)
                      }}
                      className={cx('rounded-lg px-2.5 py-1.5 text-left', clip.locationId === l.id ? 'bg-sun-soft font-semibold' : 'hover:bg-sand')}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              </Popover>

              <button
                ref={propAnchor}
                type="button"
                onClick={() => setPropPopOpen((o) => !o)}
                className="inline-flex h-7 max-w-[140px] items-center gap-1 rounded-lg border border-line bg-sand px-2 text-[11px] font-medium text-ink hover:border-ink-2 xl:max-w-[175px]"
                title={
                  clip.propIds.length > 0
                    ? `${propChipText} · ${propsSheetsReady ? 'Lembar referensi semua prop siap' : 'Sebagian prop belum punya lembar referensi di Lorebook'}`
                    : 'Pilih prop di shot ini'
                }
              >
                <Package className="size-3 shrink-0 text-muted" />
                {clip.propIds.length > 0 && (
                  <span
                    className={cx(
                      'size-1.5 shrink-0 rounded-full',
                      propsSheetsReady ? 'bg-ok-ink' : 'bg-sun'
                    )}
                  />
                )}
                <span className="truncate">{propChipText}</span>
              </button>
              <Popover anchor={propAnchor} open={propPopOpen} onClose={() => setPropPopOpen(false)} width={240}>
                <div className="scroll-thin flex max-h-56 flex-col gap-1 overflow-y-auto p-2 text-xs">
                  {props.length === 0 ? (
                    <span className="px-2 py-1 text-muted">Belum ada prop di Lorebook.</span>
                  ) : (
                    props.map((pr) => {
                      const on = clip.propIds.includes(pr.id)
                      return (
                        <button
                          key={pr.id}
                          type="button"
                          onClick={() => toggleProp(pr.id)}
                          className={cx('flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left', on ? 'bg-sun-soft font-semibold' : 'hover:bg-sand')}
                        >
                          <span>{pr.name}</span>
                          <span className="text-[11px] text-muted">{on ? '✓' : ''}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              </Popover>
            </div>

            {/* Strictly Separated Generation Controls */}
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                icon={expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                onClick={onToggleExpand}
              >
                Detail &amp; Prompt
              </Button>

              <Button
                variant={!image && imgStatus.status !== 'blocked' ? 'accent' : 'secondary'}
                size="sm"
                icon={<ImageIcon className="size-3.5" />}
                loading={busyImg || isRunning(imageJob)}
                onClick={() => void handleGenerateImage()}
                title={imgStatus.status === 'blocked' ? imgStatus.blockers.join('\n') : 'Generate khusus gambar storyboard shot ini'}
              >
                {image ? 'Ulang Gambar' : 'Buat Gambar'}
              </Button>

              <Button
                variant={image && !video && vidStatus.status !== 'blocked' ? 'accent' : 'secondary'}
                size="sm"
                icon={<Film className="size-3.5" />}
                loading={busyVid || isRunning(videoJob)}
                onClick={() => void handleGenerateVideo()}
                title={!image && !clip.continueFromPrevious ? 'Buat gambar shot ini dulu sebelum membuat video' : 'Generate khusus Video AI shot ini'}
              >
                {video ? 'Ulang Video' : 'Buat Video'}
              </Button>

              {hasNarration && !isDialogVideo && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Volume2 className="size-3.5" />}
                  loading={busyTts || isRunning(ttsJob)}
                  onClick={() => void handleGenerateTts()}
                  title="Rekam suara TTS khusus shot ini"
                >
                  {audio ? 'Ulang TTS' : 'Buat TTS'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* EXPANDED DETAIL & PROMPT (Progressive disclosure — hidden by default) */}
      {expanded && (
        <div className="grid grid-cols-1 gap-3 border-t border-line pt-3 text-xs md:grid-cols-3">
          <div className="flex flex-col gap-2.5 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted">
                Prompt Visual (Gambar)
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {scopedLocks.length > 0 && (
                  lockCompliance.compliant ? (
                    <Badge tone="ok" title="Hanya kunci milik tokoh/lokasi/prop di shot ini yang diterapkan">
                      ✓ {scopedLocks.length} Lock shot cocok
                    </Badge>
                  ) : (
                    <Badge tone="warn" title={lockCompliance.missing.map((m) => m.label).join(', ')}>
                      <AlertTriangle className="mr-1 inline size-3" />
                      {lockCompliance.missing.length} kunci terpotong
                    </Badge>
                  )
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Wand2 className="size-3" />}
                  loading={busyPrompt}
                  onClick={() => void handleOptimizePrompt()}
                  title="Susun ulang prompt gambar & video shot ini dengan AI Director (bahasa Inggris sinematik sesuai Lorebook)"
                >
                  Optimasi Prompt AI
                </Button>
              </div>
            </div>
            <AutoTextarea
              value={clip.visualPrompt}
              onChange={(e) => updateClip(clip.id, { visualPrompt: e.target.value })}
              placeholder="Prompt visual berlabel (Setting, Action, Wardrobe, Framing, Avoid)…"
              minRows={3}
              maxHeight={180}
              className="w-full rounded-xl border border-line bg-paper p-2.5 font-mono text-[11px] leading-relaxed text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
            />

            <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted">
              Arahan Gerak Video (Prompt Video)
            </span>
            <AutoTextarea
              value={clip.videoPrompt}
              onChange={(e) => updateClip(clip.id, { videoPrompt: e.target.value })}
              placeholder="Gerak subjek, ekspresi, interaksi objek, dan gerak kamera untuk Video AI…"
              minRows={2}
              maxHeight={120}
              className="w-full rounded-xl border border-line bg-paper p-2.5 font-mono text-[11px] leading-relaxed text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
            />

            {/* Editable Shot Detail (Director Cinematography Notes) */}
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3">
              <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted">
                Arahan Sutradara (POV, Sinematografi &amp; Posisi Prop)
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted">Sudut / POV Kamera</span>
                  <Select
                    label="Sudut / POV Kamera"
                    size="sm"
                    value={clip.shotDetail?.cameraPov ?? ''}
                    options={cameraPovOptions}
                    onChange={(val) =>
                      updateClip(clip.id, {
                        shotDetail: { ...(clip.shotDetail ?? {}), cameraPov: String(val) || undefined }
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted">Framing &amp; Lensa</span>
                  <input
                    value={clip.framing}
                    onChange={(e) => updateClip(clip.id, { framing: e.target.value })}
                    placeholder="Framing (mis. over-the-shoulder medium close-up)"
                    aria-label="Framing"
                    className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                  />
                </div>
                <input
                  value={clip.shotDetail?.blocking ?? ''}
                  onChange={(e) => updateClip(clip.id, { shotDetail: { ...(clip.shotDetail ?? {}), blocking: e.target.value } })}
                  placeholder="Blocking 180° (kiri/kanan/foreground)"
                  aria-label="Blocking posisi"
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
                <input
                  value={clip.shotDetail?.propPlacement ?? ''}
                  onChange={(e) =>
                    updateClip(clip.id, { shotDetail: { ...(clip.shotDetail ?? {}), propPlacement: e.target.value } })
                  }
                  placeholder="Posisi prop & latar tetap (mis. map merah di depan Dina)"
                  aria-label="Posisi prop tetap"
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
                <input
                  value={clip.shotDetail?.lighting ?? ''}
                  onChange={(e) => updateClip(clip.id, { shotDetail: { ...(clip.shotDetail ?? {}), lighting: e.target.value } })}
                  placeholder="Pencahayaan (mis. warm rim light, jendela kiri)"
                  aria-label="Pencahayaan"
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
                <input
                  value={clip.shotDetail?.cameraMotion ?? ''}
                  onChange={(e) => updateClip(clip.id, { shotDetail: { ...(clip.shotDetail ?? {}), cameraMotion: e.target.value } })}
                  placeholder="Gerak kamera video (mis. slow dolly in)"
                  aria-label="Gerak kamera video"
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
                <input
                  value={clip.shotDetail?.nonSpeakingReaction ?? ''}
                  onChange={(e) =>
                    updateClip(clip.id, { shotDetail: { ...(clip.shotDetail ?? {}), nonSpeakingReaction: e.target.value } })
                  }
                  placeholder="Reaksi tokoh lain di frame"
                  aria-label="Reaksi tokoh lain"
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
                <input
                  value={clip.shotDetail?.speechDelivery ?? ''}
                  onChange={(e) =>
                    updateClip(clip.id, { shotDetail: { ...(clip.shotDetail ?? {}), speechDelivery: e.target.value } })
                  }
                  placeholder="Intonasi bicara (mis. berbisik dingin)"
                  aria-label="Intonasi bicara"
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
              </div>
            </div>

            {/* Collapsible preview of the exact compiled prompt sent to Flow2API / Higgsfield */}
            <div className="rounded-xl border border-line bg-sand/40">
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  type="button"
                  onClick={() => setShowCompiledPreview((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-2 hover:text-ink"
                >
                  <Eye className="size-3.5 text-muted" />
                  <span>Pratinjau Prompt Final ke AI ({compiledPrompt.length} kar)</span>
                  {showCompiledPreview ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
                {showCompiledPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      void window.api.app.copyText(compiledPrompt)
                      toast('info', 'Prompt final disalin ke clipboard.')
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-dark hover:text-accent"
                  >
                    <Copy className="size-3" /> Salin
                  </button>
                )}
              </div>
              {showCompiledPreview && (
                <pre className="scroll-thin max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-line bg-paper p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
                  {compiledPrompt}
                </pre>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <span className="font-display text-[11px] font-bold uppercase tracking-wider text-muted">
              Kamera, Sambung &amp; Referensi
            </span>

            <div className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3">
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label="Gerak kamera"
                  size="sm"
                  value={clip.cameraPreset}
                  options={CAMERA_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                  onChange={(val) => updateClip(clip.id, { cameraPreset: val as CameraPresetId })}
                />
                <Select
                  label="Kekuatan"
                  size="sm"
                  value={clip.motionStrength}
                  options={MOTION_STRENGTHS.map((m) => ({ value: m.id, label: m.label }))}
                  onChange={(val) => updateClip(clip.id, { motionStrength: val as MotionStrength })}
                />
              </div>

              {plannedAnchorId && !hasReferenceOverride(clip) && (
                <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-ink-2">Kunci latar &amp; prop ke shot jangkar</div>
                    <div className="truncate text-[11px] text-muted">
                      {clip.shotDetail?.sceneAnchorMode === 'off'
                        ? 'Nonaktif, buat latar & prop segar dari Lorebook saja'
                        : sceneAnchor
                          ? `Terkunci ke Shot ${sceneAnchor.clipNumber} (${sceneAnchor.clipTitle})`
                          : 'Otomatis mengacu ke shot pembuka lokasi ini saat tersedia'}
                    </div>
                  </div>
                  <Switch
                    on={clip.shotDetail?.sceneAnchorMode !== 'off'}
                    onChange={(v) =>
                      updateClip(clip.id, {
                        shotDetail: { ...(clip.shotDetail ?? {}), sceneAnchorMode: v ? 'auto' : 'off' }
                      })
                    }
                    label="Kunci latar dan prop ke shot jangkar"
                  />
                </div>
              )}

              {index > 0 && (
                <div className="flex items-center justify-between border-t border-line pt-2">
                  <span className="text-[11px] font-medium text-ink-2">Sambung frame shot sebelumnya</span>
                  <Switch
                    on={Boolean(clip.continueFromPrevious)}
                    onChange={(v) => updateClip(clip.id, { continueFromPrevious: v })}
                    label="Sambung frame sebelumnya"
                  />
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-line pt-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold text-ink-2">
                    Referensi Aktif ({refItems.length}/{refCap})
                  </span>
                  <div className="flex items-center gap-1.5">
                    {hasReferenceOverride(clip) && (
                      <button
                        type="button"
                        onClick={() => updateClip(clip.id, { referenceAssetIds: null })}
                        className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted hover:text-ink"
                        title="Kembalikan ke pemilihan referensi otomatis"
                      >
                        <RotateCcw className="size-3" /> Reset
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handlePickReference()}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-dark hover:text-accent"
                    >
                      <Upload className="size-3" /> Unggah
                    </button>
                  </div>
                </div>

                {refCap === 0 ? (
                  <span className="rounded-lg bg-sun-soft px-2 py-1.5 text-[11px] leading-snug text-sun-ink">
                    Model gambar aktif tidak memakai gambar referensi. Ganti ke model ber-referensi (mis. Gemini 3.1 Flash Image) di Pengaturan.
                  </span>
                ) : refItems.length === 0 ? (
                  <span className="text-[11px] text-muted">Belum ada lembar referensi terpasang.</span>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {refItems.map((ref, refIdx) => {
                      const sheet = assets[ref.sheetAssetId]
                      return (
                        <div
                          key={ref.sheetAssetId}
                          className="flex items-center justify-between gap-1.5 rounded-lg border border-line bg-surface p-1.5 text-[11px]"
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="flex size-4 shrink-0 items-center justify-center rounded bg-ink font-mono text-[11px] font-bold text-paper">
                              {refIdx + 1}
                            </span>
                            {sheet?.url ? (
                              <img
                                src={sheet.url}
                                alt={ref.name}
                                className="size-6 shrink-0 rounded object-cover border border-line"
                              />
                            ) : (
                              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-sand text-[11px] text-muted">
                                ?
                              </span>
                            )}
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-ink">{ref.name}</div>
                              <div className="text-[11px] text-muted">{REF_KIND_LABEL[ref.kind]}</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`Lepas referensi ${ref.name}`}
                            onClick={() => {
                              const nextIds = refItems
                                .map((r) => r.sheetAssetId)
                                .filter((id) => id !== ref.sheetAssetId)
                              updateClip(clip.id, { referenceAssetIds: nextIds.length ? nextIds : null })
                            }}
                            className="shrink-0 p-0.5 text-muted hover:text-bad-ink"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {refCap > 0 && overflowRefs.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-dashed border-line-2 bg-sand/40 p-2">
                    <span className="text-[11px] font-semibold text-muted">
                      Di luar batas {refCap} slot (dijaga lewat teks &amp; lock words):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {overflowRefs.map((ref) => (
                        <button
                          key={ref.sheetAssetId}
                          type="button"
                          onClick={() => handlePromoteOverflowRef(ref.sheetAssetId)}
                          title={`Klik untuk memprioritaskan ${ref.name} ke Slot #1`}
                          className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-ink hover:text-ink"
                        >
                          <span className="max-w-[110px] truncate">{ref.name}</span>
                          <span className="text-[11px] font-bold text-accent-dark">↑</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {refCap > 0 &&
                  previousClipImageAssetId &&
                  !refItems.some((r) => r.sheetAssetId === previousClipImageAssetId) && (
                    <button
                      type="button"
                      onClick={handleAttachPrevShotRef}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-line bg-sand/70 px-2 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:border-ink hover:text-ink"
                      title="Pasang gambar shot sebelumnya sebagai referensi pencahayaan & warna ruangan"
                    >
                      <Link2 className="size-3" />
                      Pakai gambar shot sebelumnya sbg referensi
                    </button>
                  )}
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
