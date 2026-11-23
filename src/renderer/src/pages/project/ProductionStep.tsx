import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Film,
  History,
  Image as ImageIcon,
  Lock,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  Stethoscope,
  Trash2,
  Volume2,
  Wand2
} from 'lucide-react'
import { getFlow2ApiModel } from '@shared/flow2api-catalog'
import { getImageModel } from '@shared/higgsfield'
import { resolveActive } from '@shared/providers'
import { isDefaultCostume, isNarratorName } from '@shared/script'
import {
  checkScriptDoctor,
  computeEpisodeRhythm,
  getClipImageStatus,
  getClipVideoStatus,
  isVideoDialogue,
  referenceLimit,
  type GenerationPrerequisitesContext
} from '@shared/validation'
import type {
  AppSettings,
  DraftShot,
  EpisodeScriptDraft,
  LockWord,
  NewAssetProposal,
  ProjectBundle,
  ScriptVersion
} from '@shared/types'
import { AutoTextarea } from '../../components/AutoTextarea'
import { Badge, Button, IconButton, Menu, Spinner, confirmDialog, cx } from '../../components/ui'
import { clipNumber, errorText, secLabel } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { AnimaticPreviewModal } from './AnimaticPreviewModal'
import { BatchEstimateModal } from './BatchEstimateModal'
import { NewAssetsBanner } from './NewAssetsBanner'
import { DoctorDrawer, LocksDrawer, SnapshotModals } from './ProductionDrawers'
import { ShotCard } from './ShotCard'

type StatusFilter = 'all' | 'missing' | 'stale' | 'ready'

export function ProductionStep() {
  const {
    project,
    episode,
    episodes,
    clips,
    characters,
    derivatives,
    locations,
    props,
    continuityItems,
    assets,
    jobs,
    updateEpisode,
    addClip,
    removeClip,
    select,
    setActiveView,
    flush,
    load,
    refreshLorebook,
    upsertJob
  } = useProject()
  const { toast } = useApp()

  const [draft, setDraft] = useState<EpisodeScriptDraft | null>(episode?.scriptDraft ?? null)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isWritingPrompts, setIsWritingPrompts] = useState(false)
  const [planMessage, setPlanMessage] = useState<string | null>(null)
  const [busyTtsBatch, setBusyTtsBatch] = useState(false)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedShotIds, setExpandedShotIds] = useState<Set<string>>(() => new Set())
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(() => new Set())
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [locksOpen, setLocksOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [saveSnapOpen, setSaveSnapOpen] = useState(false)
  const [versions, setVersions] = useState<ScriptVersion[]>([])

  // Separated batch modal state (image vs video, optional selected clipIds)
  const [batchModal, setBatchModal] = useState<{ kind: 'image' | 'video'; clipIds?: string[] } | null>(null)
  const [animaticClipId, setAnimaticClipId] = useState<string | null | undefined>(undefined)

  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  useEffect(() => {
    void window.api.settings.get().then(setAppSettings).catch(() => setAppSettings(null))
  }, [])

  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDraftRef = useRef<{ episodeId: string; draft: EpisodeScriptDraft } | null>(null)
  const ownSavedDraftsRef = useRef(new WeakSet<EpisodeScriptDraft>())
  const prevEpisodeIdRef = useRef<string | undefined>(episode?.id)
  const aiOpSeqRef = useRef(0)

  const flushPendingDraftSave = () => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
    const pending = pendingDraftRef.current
    pendingDraftRef.current = null
    if (pending) {
      ownSavedDraftsRef.current.add(pending.draft)
      void useProject.getState().updateEpisode(pending.episodeId, { scriptDraft: pending.draft })
    }
  }

  const cancelPendingDraftSave = () => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
    pendingDraftRef.current = null
  }

  const scheduleDraftSave = (targetEpId: string, nextDraft: EpisodeScriptDraft) => {
    ownSavedDraftsRef.current.add(nextDraft)
    pendingDraftRef.current = { episodeId: targetEpId, draft: nextDraft }
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null
      const pending = pendingDraftRef.current
      pendingDraftRef.current = null
      if (pending) {
        void useProject.getState().updateEpisode(pending.episodeId, { scriptDraft: pending.draft })
      }
    }, 400)
  }

  useEffect(() => {
    if (prevEpisodeIdRef.current !== episode?.id) {
      flushPendingDraftSave()
      prevEpisodeIdRef.current = episode?.id
      setDraft(episode?.scriptDraft ?? null)
      setSelectedBatchIds(new Set())
      setExpandedShotIds(new Set())
      return
    }
    const incoming = episode?.scriptDraft ?? null
    // Ignore store echoes of our own debounced local edits so typing never gets clobbered.
    if (incoming && ownSavedDraftsRef.current.has(incoming)) return
    if (pendingDraftRef.current?.episodeId === episode?.id) return
    setDraft(incoming)
  }, [episode?.id, episode?.scriptDraft])

  useEffect(() => () => flushPendingDraftSave(), [])

  // Clear clip batch selection when entering Draft mode so hidden clips are not targeted.
  useEffect(() => {
    if (draft) setSelectedBatchIds(new Set())
  }, [draft])

  useEffect(() => {
    return window.api.on.storyProgress((ev) => {
      if (ev.projectId === project?.id) setPlanMessage(ev.message)
    })
  }, [project?.id])

  const loadVersions = async () => {
    if (!episode) return
    const targetEpId = episode.id
    try {
      const list = await window.api.scriptVersions.list(targetEpId)
      if (useProject.getState().episode?.id === targetEpId) {
        setVersions(list)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadVersions()
  }, [episode?.id])

  const activeImage = resolveActive(appSettings, 'image')
  const activeVideo = resolveActive(appSettings, 'video')

  const seriesLocks = project?.seriesLock ?? []
  const episodeLocks = episode?.lockWords ?? []
  const activeLocks = useMemo(
    () => [...seriesLocks, ...episodeLocks].filter((l) => l.enabled),
    [seriesLocks, episodeLocks]
  )

  const prereqCtx = useMemo<GenerationPrerequisitesContext>(
    () => ({
      characters,
      derivatives,
      locations,
      props,
      assets,
      clips,
      activeJobs: Object.values(jobs),
      isFlow2Api: activeImage.provider.protocol === 'flow2api',
      flow2apiImageModel: activeImage.model,
      flow2apiVideoModel: activeVideo.model,
      activeImageModel: activeImage.model,
      activeVideoModel: activeVideo.model,
      lockWords: [...seriesLocks, ...episodeLocks]
    }),
    [characters, derivatives, locations, props, assets, clips, jobs, activeImage, activeVideo, seriesLocks, episodeLocks]
  )

  // Registered + proposed entity name lookup (case-insensitive) for draft validation & quick-fix chips.
  const knownDraftNames = useMemo(() => {
    const charNames = new Set<string>()
    for (const c of characters) {
      charNames.add(c.name.trim().toLowerCase())
      for (const a of c.aliases ?? []) charNames.add(a.trim().toLowerCase())
    }
    const locNames = new Set<string>()
    for (const l of locations) {
      locNames.add(l.name.trim().toLowerCase())
      for (const a of l.aliases ?? []) locNames.add(a.trim().toLowerCase())
    }
    const propNames = new Set<string>()
    for (const p of props) {
      propNames.add(p.name.trim().toLowerCase())
      for (const a of p.aliases ?? []) propNames.add(a.trim().toLowerCase())
    }
    for (const p of draft?.newAssets ?? []) {
      if (p.action === 'ignore') continue
      const key = p.name.trim().toLowerCase()
      if (p.kind === 'character' && (p.action === 'create' || p.action === 'merge' || p.action === 'derivative')) {
        charNames.add(key)
      }
      if (p.kind === 'location') locNames.add(key)
      if (p.kind === 'prop') propNames.add(key)
    }
    return { charNames, locNames, propNames }
  }, [draft, characters, locations, props])

  // Draft validation (blocking unmapped entities) when a draft is open.
  const draftBlockingCount = useMemo(() => {
    if (!draft?.shots?.length) return 0
    const { charNames, locNames, propNames } = knownDraftNames
    let count = 0
    for (const s of draft.shots) {
      for (const name of s.characters ?? []) {
        if (name.trim() && !charNames.has(name.trim().toLowerCase())) count++
      }
      if (s.location?.trim() && !locNames.has(s.location.trim().toLowerCase())) count++
      for (const pr of s.props ?? []) {
        if (pr.trim() && !propNames.has(pr.trim().toLowerCase())) count++
      }
      if (s.speaker?.trim() && !isNarratorName(s.speaker)) {
        const spk = s.speaker.trim().toLowerCase()
        if (!charNames.has(spk)) count++
      }
    }
    return count
  }, [draft, knownDraftNames])

  // Build an analysis draft from confirmed clips when no pending draft is open, so Script Doctor & Rhythm always work.
  const analysisDraft = useMemo<EpisodeScriptDraft | null>(() => {
    if (draft) return draft
    if (!clips.length) return null
    const charMap = new Map(characters.map((c) => [c.id, c.name]))
    const derivMap = new Map(derivatives.map((d) => [d.id, d.name]))
    const locMap = new Map(locations.map((l) => [l.id, l.name]))
    const propMap = new Map(props.map((p) => [p.id, p.name]))
    return {
      createdAt: episode?.updatedAt ?? 0,
      newAssets: [],
      shots: clips.map((c) => {
        const costumes: Record<string, string> = {}
        for (const [cid, did] of Object.entries(c.costumeIds ?? {})) {
          const cn = charMap.get(cid)
          const dn = derivMap.get(did)
          if (cn && dn) costumes[cn] = dn
        }
        return {
          title: c.title,
          sourceExcerpt: c.sourceExcerpt,
          visualAction: c.story,
          characters: c.characterIds.map((id) => charMap.get(id) ?? '').filter(Boolean),
          costumes,
          location: c.locationId ? (locMap.get(c.locationId) ?? null) : null,
          props: c.propIds.map((id) => propMap.get(id) ?? '').filter(Boolean),
          speaker: c.speakerId ? (charMap.get(c.speakerId) ?? null) : null,
          text: c.narration,
          emotion: c.emotion,
          framing: c.framing,
          durationSec: Math.max(1, Math.round(c.durationMs / 1000)),
          shotDetail: c.shotDetail
        }
      })
    }
  }, [draft, clips, characters, derivatives, locations, props, episode?.updatedAt])

  const previousEpisode = useMemo(() => {
    if (!episode) return undefined
    const idx = episodes.findIndex((e) => e.id === episode.id)
    return idx > 0 ? episodes[idx - 1] : undefined
  }, [episode, episodes])

  const doctorIssues = useMemo(() => {
    if (!analysisDraft || !episode) return []
    return checkScriptDoctor(
      analysisDraft,
      episode,
      { characters, locations, props, derivatives },
      previousEpisode,
      { items: continuityItems, episodes }
    )
  }, [analysisDraft, episode, characters, locations, props, derivatives, previousEpisode, continuityItems, episodes])

  const rhythmSegments = useMemo(
    () => (analysisDraft ? computeEpisodeRhythm(analysisDraft) : []),
    [analysisDraft]
  )

  const clipStats = useMemo(() => {
    if (!project) return { missingImages: 0, missingVideos: 0, missingTts: 0, stale: 0, ready: 0, totalMs: 0 }
    let missingImages = 0
    let missingVideos = 0
    let missingTts = 0
    let stale = 0
    let ready = 0
    let totalMs = 0
    for (const c of clips) {
      totalMs += c.durationMs
      const is = getClipImageStatus(c, project, prereqCtx).status
      const vs = getClipVideoStatus(c, project, prereqCtx).status
      if (!c.imageAssetId) missingImages++
      if (!c.videoAssetId) missingVideos++
      if (c.narration.trim() && !isVideoDialogue(project, c) && !c.audioAssetId) missingTts++
      if (is === 'stale' || vs === 'stale') stale++
      if (is === 'current' && vs === 'current') ready++
    }
    return { missingImages, missingVideos, missingTts, stale, ready, totalMs }
  }, [clips, project, prereqCtx])

  const refCap = useMemo(() => (project ? referenceLimit(project, prereqCtx) : 0), [project, prereqCtx])
  const activeImageModelLabel = useMemo(() => {
    if (activeImage.provider.protocol === 'flow2api') {
      return `Flow2API · ${getFlow2ApiModel(activeImage.model, 'image').name}`
    }
    return `${activeImage.provider.name} · ${getImageModel(activeImage.model).name}`
  }, [activeImage])

  const episodeSheetStats = useMemo(() => {
    const charMap = new Map(characters.map((c) => [c.id, c]))
    const derivMap = new Map(derivatives.map((d) => [d.id, d]))
    const locMap = new Map(locations.map((l) => [l.id, l]))
    const propMap = new Map(props.map((p) => [p.id, p]))
    const needed = new Map<string, boolean>()

    for (const c of clips) {
      for (const cid of c.characterIds || []) {
        const ch = charMap.get(cid)
        if (!ch) continue
        const did = c.costumeIds?.[cid]
        if (did) {
          const d = derivMap.get(did)
          if (d) needed.set(`deriv:${d.id}`, Boolean(d.sheetAssetId && assets[d.sheetAssetId]))
        } else {
          needed.set(`char:${ch.id}`, Boolean(ch.sheetAssetId && assets[ch.sheetAssetId]))
        }
      }
      if (c.locationId) {
        const loc = locMap.get(c.locationId)
        if (loc) needed.set(`loc:${loc.id}`, Boolean(loc.sheetAssetId && assets[loc.sheetAssetId]))
      }
      for (const pid of c.propIds || []) {
        const pr = propMap.get(pid)
        if (pr) needed.set(`prop:${pr.id}`, Boolean(pr.sheetAssetId && assets[pr.sheetAssetId]))
      }
    }

    let ready = 0
    for (const ok of needed.values()) if (ok) ready++
    return { total: needed.size, ready, missing: needed.size - ready }
  }, [clips, characters, derivatives, locations, props, assets])

  const visibleClips = useMemo(() => {
    if (!project) return []
    return clips
      .map((clip, index) => ({ clip, index }))
      .filter(({ clip }) => {
        if (statusFilter === 'all') return true
        const is = getClipImageStatus(clip, project, prereqCtx).status
        const vs = getClipVideoStatus(clip, project, prereqCtx).status
        if (statusFilter === 'missing') return !clip.imageAssetId || !clip.videoAssetId
        if (statusFilter === 'stale') return is === 'stale' || vs === 'stale'
        return is === 'current' && vs === 'current'
      })
  }, [clips, project, prereqCtx, statusFilter])

  if (!project || !episode) return null

  const confirmAndWritePrompts = async (targetDraft: EpisodeScriptDraft) => {
    const targetProjectId = project.id
    const targetEpId = episode.id
    const targetEpNum = episode.episodeNum
    const opId = ++aiOpSeqRef.current
    cancelPendingDraftSave()
    setIsConfirming(true)
    setPlanMessage('Mengonfirmasi draf shot & mendaftarkan aset baru…')
    try {
      await flush()
      const confirmed: ProjectBundle = await window.api.story.confirmEpisodeScript(targetProjectId, targetEpId, targetDraft)
      if (useProject.getState().episode?.id === targetEpId) {
        load(confirmed)
        setDraft(null)
        void loadVersions()
      }
      await refreshLorebook()

      // Auto-chain prompt writing right after confirmation so there is no separate manual "Tulis Prompt" gate.
      if (aiOpSeqRef.current === opId) {
        setIsConfirming(false)
        setIsWritingPrompts(true)
        setPlanMessage('Menulis prompt visual & video untuk semua shot…')
      }
      const withPrompts = await window.api.story.writePrompts(targetProjectId, targetEpId)
      if (useProject.getState().episode?.id === targetEpId) {
        load(withPrompts)
      }
      toast('success', `Episode ${targetEpNum} siap diproduksi (${withPrompts.clips.length} shot + prompt visual)!`)
    } catch (err) {
      toast('error', `Gagal memproses naskah: ${errorText(err)}`)
    } finally {
      if (aiOpSeqRef.current === opId) {
        setIsConfirming(false)
        setIsWritingPrompts(false)
        setPlanMessage(null)
      }
    }
  }

  const handlePlanScript = async () => {
    const targetProjectId = project.id
    const targetEpId = episode.id
    const targetEpNum = episode.episodeNum
    const targetEpTitle = episode.title
    if (clips.length > 0) {
      const ok = await confirmDialog({
        title: 'Susun Ulang Shot Episode?',
        body: `Episode ${targetEpNum} sudah memiliki ${clips.length} shot. AI akan membuat draf baru yang bisa kamu tinjau dulu sebelum menggantikan shot lama.`,
        confirm: 'Buat draf baru',
        danger: true
      })
      if (!ok) return
    }

    const opId = ++aiOpSeqRef.current
    cancelPendingDraftSave()
    setIsPlanning(true)
    setPlanMessage(`Menyusun shot untuk ${targetEpTitle}…`)
    try {
      await flush()
      const newDraft = await window.api.story.planEpisodeScript(targetProjectId, targetEpId)
      if (useProject.getState().episode?.id === targetEpId) {
        setDraft(newDraft)
      }
      await updateEpisode(targetEpId, { scriptDraft: newDraft })
      toast('success', `Draf ${newDraft.shots.length} shot berhasil dibuat. Tinjau sebentar lalu klik Setujui & Susun Prompt.`)
    } catch (err) {
      toast('error', `Gagal menyusun shot: ${errorText(err)}`)
    } finally {
      if (aiOpSeqRef.current === opId) {
        setIsPlanning(false)
        setPlanMessage(null)
      }
    }
  }

  const handleConfirmDraft = async () => {
    if (!draft?.shots.length) return
    if (draftBlockingCount > 0) {
      toast('error', `Masih ada ${draftBlockingCount} nama yang belum terdaftar di draf. Tinjau usulan aset atau edit shot dulu.`)
      return
    }
    if (clips.length > 0) {
      const ok = await confirmDialog({
        title: 'Gantikan Shot Lama dengan Draf Baru?',
        body: `Episode ini memiliki ${clips.length} shot lama. Mengonfirmasi akan menggantinya dengan ${draft.shots.length} shot baru dan menulis prompt visualnya.`,
        confirm: 'Setujui & Susun Prompt',
        danger: true
      })
      if (!ok) return
    }
    await confirmAndWritePrompts(draft)
  }

  const handleRewriteAllPrompts = async () => {
    if (!clips.length) return
    const targetProjectId = project.id
    const targetEpId = episode.id
    const opId = ++aiOpSeqRef.current
    setIsWritingPrompts(true)
    setPlanMessage('Menyusun prompt visual & video yang masih kosong…')
    try {
      await flush()
      const bundle = await window.api.story.writePrompts(targetProjectId, targetEpId)
      if (useProject.getState().episode?.id === targetEpId) {
        load(bundle)
      }
      toast('success', 'Prompt visual & video berhasil diperbarui.')
    } catch (err) {
      toast('error', `Gagal menulis prompt: ${errorText(err)}`)
    } finally {
      if (aiOpSeqRef.current === opId) {
        setIsWritingPrompts(false)
        setPlanMessage(null)
      }
    }
  }

  const handleOptimizeAllPromptsAi = async () => {
    if (!clips.length) return
    const targetProjectId = project.id
    const targetEpId = episode.id
    const hasExisting = clips.some((c) => c.visualPrompt.trim() || c.videoPrompt.trim())
    if (hasExisting) {
      const ok = await confirmDialog({
        title: 'Optimasi Ulang Semua Prompt dengan AI?',
        body: `AI Visual Director akan menyusun ulang prompt gambar & video berbahasa Inggris yang lebih sinematik dan selaras dengan Lorebook untuk seluruh ${clips.length} shot episode ini.`,
        confirm: 'Optimasi Semua Prompt',
        danger: false
      })
      if (!ok) return
    }
    const opId = ++aiOpSeqRef.current
    setIsWritingPrompts(true)
    setPlanMessage(`Mengoptimasi ${clips.length} prompt visual & video dengan AI Director…`)
    try {
      await flush()
      const bundle = await window.api.story.writePrompts(targetProjectId, targetEpId, undefined, {
        force: true,
        useAi: true,
        requireAi: true
      })
      if (useProject.getState().episode?.id === targetEpId) {
        load(bundle)
      }
      toast('success', `${bundle.clips.length} shot berhasil dioptimasi dengan AI Visual Director!`)
    } catch (err) {
      toast('error', `Gagal mengoptimasi prompt: ${errorText(err)}`)
    } finally {
      if (aiOpSeqRef.current === opId) {
        setIsWritingPrompts(false)
        setPlanMessage(null)
      }
    }
  }

  const handleBatchTts = async (onlyIds?: string[]) => {
    setBusyTtsBatch(true)
    try {
      await flush()
      if (onlyIds?.length) {
        const targets = clips.filter((c) => onlyIds.includes(c.id) && c.narration.trim() && !isVideoDialogue(project, c))
        if (!targets.length) {
          toast('info', 'Shot yang dipilih tidak membutuhkan TTS (dialog memakai suara video).')
          return
        }
        for (const c of targets) {
          const job = await window.api.generate.clipTts(c.id)
          upsertJob(job)
        }
        toast('info', `Memulai pembuatan suara TTS untuk ${targets.length} shot terpilih.`)
      } else {
        const job = await window.api.generate.narration(project.id, 'missing', episode.id)
        upsertJob(job)
        toast('info', 'Merekam suara TTS untuk shot Monolog Batin / Narator (1 take per suara)…')
      }
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setBusyTtsBatch(false)
    }
  }

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedBatchIds)
    if (!ids.length) return
    const ok = await confirmDialog({
      title: `Hapus ${ids.length} shot terpilih?`,
      body: 'Shot yang dihapus akan dilepas dari episode ini.',
      confirm: `Hapus ${ids.length} Shot`,
      danger: true
    })
    if (!ok) return
    for (const id of ids) removeClip(id)
    setSelectedBatchIds(new Set())
    toast('info', `${ids.length} shot berhasil dihapus.`)
  }

  const updateDraftProposal = (idx: number, patch: Partial<NewAssetProposal>) => {
    if (!draft) return
    const nextAssets = draft.newAssets.map((a, i) => (i === idx ? { ...a, ...patch } : a))
    const nextDraft = { ...draft, newAssets: nextAssets }
    setDraft(nextDraft)
    scheduleDraftSave(episode.id, nextDraft)
  }

  const updateDraftShot = (idx: number, patch: Partial<DraftShot>) => {
    if (!draft) return
    const nextShots = draft.shots.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    const nextDraft = { ...draft, shots: nextShots }
    setDraft(nextDraft)
    scheduleDraftSave(episode.id, nextDraft)
  }

  const removeDraftShot = (idx: number) => {
    if (!draft || draft.shots.length <= 1) return
    const nextDraft = { ...draft, shots: draft.shots.filter((_, i) => i !== idx) }
    setDraft(nextDraft)
    scheduleDraftSave(episode.id, nextDraft)
  }

  const proposeDraftAsset = (kind: 'character' | 'location' | 'prop', name: string) => {
    if (!draft || !name.trim()) return
    const clean = name.trim()
    if (draft.newAssets.some((a) => a.name.trim().toLowerCase() === clean.toLowerCase())) return
    const proposal: NewAssetProposal = {
      kind,
      name: clean,
      description: '',
      action: 'create',
      reason: 'Ditambahkan dari peringatan shot draf'
    }
    const nextDraft = { ...draft, newAssets: [...draft.newAssets, proposal] }
    setDraft(nextDraft)
    scheduleDraftSave(episode.id, nextDraft)
    toast('info', `"${clean}" ditambahkan ke usulan aset baru.`)
  }

  const toggleSelectBatch = (id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedBatchIds.size === clips.length && clips.length > 0) setSelectedBatchIds(new Set())
    else setSelectedBatchIds(new Set(clips.map((c) => c.id)))
  }

  const toggleExpandShot = (id: string) => {
    setExpandedShotIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const jumpToShotIndex = (idx: number) => {
    const c = clips[idx]
    if (!c) return
    const el = document.getElementById(`shot-card-${c.id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      select(c.id)
    }
  }

  const selectedIds = Array.from(selectedBatchIds)
  const selectedTtsCount = clips.filter(
    (c) => selectedBatchIds.has(c.id) && c.narration.trim() && !isVideoDialogue(project, c)
  ).length
  const hasClips = clips.length > 0
  const busyAi = isPlanning || isConfirming || isWritingPrompts
  const allShotsSilent = hasClips && clips.every((c) => !c.narration.trim())
  const incompleteCount = clips.filter((c) => !c.imageAssetId || !c.videoAssetId).length
  const readyCount = clipStats.ready

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-paper">
      {/* BAR 1: PRIMARY STUDIO ACTION BAR (Compact, responsive, zero right-edge clipping) */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-md bg-ink px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper">
              Ep {episode.episodeNum}
            </span>
            <h2 className="max-w-[220px] truncate font-display text-sm font-bold text-ink sm:max-w-[300px]" title={episode.title}>
              {episode.title}
            </h2>
          </div>
          {!draft && hasClips && (
            <span className="hidden shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[11px] text-muted sm:inline-flex">
              {clips.length} shot · {secLabel(clipStats.totalMs || episode.durationSec * 1000)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {draft ? (
            <>
              <Badge tone="warn">Mode Draf</Badge>
              <Button
                variant="secondary"
                size="sm"
                icon={<Save className="size-3.5" />}
                disabled={busyAi}
                onClick={() => setSaveSnapOpen(true)}
                title="Simpan kondisi draf naskah saat ini sebagai snapshot"
              >
                Simpan Snapshot
              </Button>
            </>
          ) : !hasClips ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Sparkles className="size-3.5" />}
              loading={busyAi}
              onClick={() => void handlePlanScript()}
              title="Susun daftar shot dan prompt visual secara otomatis"
            >
              {busyAi ? (planMessage || 'Memproses…') : 'Susun Shot & Prompt'}
            </Button>
          ) : (
            <>
              <Button
                variant={clipStats.missingImages > 0 ? 'primary' : 'secondary'}
                size="sm"
                icon={<ImageIcon className="size-3.5" />}
                onClick={() => setBatchModal({ kind: 'image' })}
                title="Generate khusus gambar storyboard (termasuk prasyarat lembar kosong otomatis)"
              >
                {clipStats.missingImages > 0 ? `Buat Gambar (${clipStats.missingImages})` : 'Gambar ✓'}
              </Button>

              <Button
                variant={clipStats.missingImages === 0 && clipStats.missingVideos > 0 ? 'primary' : 'secondary'}
                size="sm"
                icon={<Film className="size-3.5" />}
                onClick={() => setBatchModal({ kind: 'video' })}
                title="Generate khusus Video AI (terpisah penuh dari gambar)"
              >
                {clipStats.missingVideos > 0 ? `Buat Video (${clipStats.missingVideos})` : 'Video ✓'}
              </Button>

              {clipStats.missingTts > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Volume2 className="size-3.5" />}
                  loading={busyTtsBatch}
                  onClick={() => void handleBatchTts()}
                  title="Rekam suara TTS untuk shot Monolog Batin / Narasi (dialog memakai suara video)"
                >
                  TTS ({clipStats.missingTts})
                </Button>
              )}

              <div className="mx-0.5 hidden h-5 w-px bg-line sm:block" />

              <Button
                variant="secondary"
                size="sm"
                icon={<Play className="size-3.5" />}
                onClick={() => setAnimaticClipId(clips[0]?.id ?? null)}
                title="Putar pratinjau animatic episode"
              >
                Animatic
              </Button>

              <Menu
                trigger={(open) => (
                  <IconButton label="Opsi produksi lainnya" size={32} onClick={open}>
                    <MoreHorizontal className="size-4" />
                  </IconButton>
                )}
                items={[
                  {
                    label: 'Susun ulang shot dengan AI',
                    icon: <Sparkles className="size-3.5" />,
                    disabled: busyAi,
                    run: () => void handlePlanScript()
                  },
                  {
                    label: 'Optimasi semua prompt dengan AI',
                    icon: <Wand2 className="size-3.5" />,
                    disabled: busyAi,
                    run: () => void handleOptimizeAllPromptsAi()
                  },
                  {
                    label: 'Tulis prompt visual yang kosong',
                    icon: <RefreshCw className="size-3.5" />,
                    disabled: busyAi,
                    run: () => void handleRewriteAllPrompts()
                  },
                  {
                    label: selectedBatchIds.size === clips.length ? 'Batal pilih semua shot' : 'Pilih semua shot (batch)',
                    icon: selectedBatchIds.size === clips.length ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />,
                    run: toggleSelectAll
                  },
                  {
                    label: 'Sinkron caption (Whisper)',
                    icon: <Volume2 className="size-3.5" />,
                    disabled: busyAi,
                    run: async () => {
                      try {
                        await flush()
                        const job = await window.api.generate.syncCaptions(project.id, 'stale', episode.id)
                        upsertJob(job)
                        toast('info', 'Menyinkronkan waktu caption dengan Whisper…')
                      } catch (e) {
                        toast('error', errorText(e))
                      }
                    }
                  },
                  {
                    label: 'Tambah shot kosong di akhir',
                    icon: <Plus className="size-3.5" />,
                    run: () => addClip(clips[clips.length - 1]?.id ?? null)
                  }
                ]}
              />
            </>
          )}
        </div>
      </div>

      {/* MULTI-SELECT BATCH BAR — SEPARATED IMAGE / VIDEO / TTS FOR SELECTED SHOTS */}
      {!draft && selectedIds.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-2 bg-sun-soft px-4 py-2 text-xs text-sun-ink">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono font-bold text-ink">
              {selectedIds.length}/{clips.length} shot dipilih
            </span>
            {selectedIds.length < clips.length && (
              <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
                Pilih semua
              </Button>
            )}
            <span className="hidden font-medium lg:inline">Jalankan aksi terpisah hanya pada shot terpilih:</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              icon={<ImageIcon className="size-3.5" />}
              onClick={() => setBatchModal({ kind: 'image', clipIds: selectedIds })}
            >
              Gambar ({selectedIds.length})
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Film className="size-3.5" />}
              onClick={() => setBatchModal({ kind: 'video', clipIds: selectedIds })}
            >
              Video ({selectedIds.length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Volume2 className="size-3.5" />}
              loading={busyTtsBatch}
              disabled={selectedTtsCount === 0}
              title={
                selectedTtsCount === 0
                  ? 'Shot yang dipilih tidak membutuhkan TTS (dialog memakai suara video)'
                  : `Rekam suara TTS untuk ${selectedTtsCount} shot terpilih`
              }
              onClick={() => void handleBatchTts(selectedIds)}
            >
              TTS ({selectedTtsCount})
            </Button>
            <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => void handleBatchDelete()}>
              Hapus
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedBatchIds(new Set())}>
              Batal pilih
            </Button>
          </div>
        </div>
      )}

      {/* BAR 2: STUDIO UTILITY, READINESS & FILTER BAR (All controls cleanly wrapped, never clipped) */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-4 py-1.5 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setDoctorOpen((v) => !v)
              setLocksOpen(false)
            }}
            className={cx(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
              doctorOpen ? 'border-line-2 bg-sun-soft text-sun-ink' : 'border-line bg-surface text-ink-2 hover:text-ink'
            )}
          >
            <Stethoscope className="size-3" />
            <span>Cek Naskah</span>
            {doctorIssues.length > 0 && (
              <span
                className={cx(
                  'rounded-full px-1.5 font-mono text-[11px]',
                  doctorOpen ? 'bg-sun text-[var(--color-on-sun)]' : 'bg-sun-soft text-sun-ink'
                )}
              >
                {doctorIssues.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setLocksOpen((v) => !v)
              setDoctorOpen(false)
            }}
            className={cx(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
              locksOpen ? 'border-line-2 bg-info-soft text-info-ink' : 'border-line bg-surface text-ink-2 hover:text-ink'
            )}
          >
            <Lock className="size-3" />
            <span>Kunci ({activeLocks.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink-2 transition-colors hover:text-ink"
          >
            <History className="size-3" />
            <span>Versi ({versions.length})</span>
          </button>

          {!draft && hasClips && (
            <button
              type="button"
              onClick={() => setActiveView('lorebook')}
              title={`${activeImageModelLabel} (${refCap > 0 ? `maks ${refCap} referensi/shot` : 'tanpa dukungan referensi'}) · Klik untuk buka Dunia & Pemeran`}
              className={cx(
                'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
                refCap === 0
                  ? 'border-bad-ink/40 bg-bad-soft text-bad-ink'
                  : episodeSheetStats.missing > 0
                    ? 'border-line-2 bg-sun-soft text-sun-ink hover:border-ink-2'
                    : 'border-line bg-surface text-ink-2 hover:text-ink'
              )}
            >
              {refCap === 0 ? (
                <AlertTriangle className="size-3 shrink-0" />
              ) : (
                <CheckCircle2 className={cx('size-3 shrink-0', episodeSheetStats.missing > 0 ? 'text-sun-ink' : 'text-ok-ink')} />
              )}
              <span className="max-w-[150px] truncate">{activeImageModelLabel.replace(/^Flow2API · /, '')}</span>
              {refCap > 0 && episodeSheetStats.total > 0 && (
                <span className="font-mono text-[11px] opacity-85">
                  · {episodeSheetStats.ready}/{episodeSheetStats.total} lembar
                </span>
              )}
            </button>
          )}
        </div>

        {/* Right: Rhythm indicator + Status filter pills */}
        {!draft && hasClips && (
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            {rhythmSegments.length > 0 && (
              <div
                className="hidden h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 2xl:inline-flex"
                title="Ritme episode: oranye = dialog, biru = reaksi, kuning = monolog, abu = hening"
              >
                <Activity className="size-3 text-muted" />
                <div className="flex h-2 w-16 items-center gap-0.5 overflow-hidden rounded">
                  {rhythmSegments.slice(0, 12).map((seg) => (
                    <div
                      key={seg.shotIndex}
                      className={cx(
                        'h-full flex-1',
                        seg.type === 'dialogue'
                          ? 'bg-accent'
                          : seg.type === 'reaction'
                            ? 'bg-info-ink'
                            : seg.type === 'silent'
                              ? 'bg-line-3'
                              : 'bg-sun'
                      )}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5">
              {(
                [
                  { k: 'all', l: `Semua ${clips.length}` },
                  { k: 'missing', l: `Kurang ${incompleteCount}` },
                  ...(clipStats.stale > 0 ? [{ k: 'stale' as const, l: `Basi ${clipStats.stale}` }] : []),
                  { k: 'ready', l: `Siap ${readyCount}` }
                ] as { k: StatusFilter; l: string }[]
              ).map((f) => (
                <button
                  key={f.k}
                  type="button"
                  onClick={() => setStatusFilter(f.k)}
                  className={cx(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
                    statusFilter === f.k ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
                  )}
                >
                  {f.l}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CONTEXTUAL WARNINGS (only when action is needed: 0-ref model or all-silent episode) */}
      {!draft && hasClips && refCap === 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-bad-ink/25 bg-bad-soft px-4 py-2 text-xs text-bad-ink">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>{activeImageModelLabel}</strong> tidak mendukung lembar referensi Lorebook. Ganti ke <strong>Gemini 3.1 Flash Image</strong> di Pengaturan agar tokoh, lokasi &amp; prop konsisten.
            </span>
          </div>
        </div>
      )}

      {!draft && allShotsSilent && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-2 bg-sun-soft px-4 py-2 text-xs text-sun-ink">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Semua shot belum memiliki teks dialog, sehingga video AI akan dibuat <strong>tanpa suara bicara</strong>. Tulis dialog di kartu shot atau susun ulang dengan AI.
            </span>
          </div>
          <Button size="sm" variant="secondary" icon={<Sparkles className="size-3.5" />} loading={busyAi} onClick={() => void handlePlanScript()}>
            Susun Ulang + Dialog AI
          </Button>
        </div>
      )}

      {/* PROGRESSIVE DISCLOSURE DRAWERS */}
      {doctorOpen && (
        <DoctorDrawer
          issues={doctorIssues}
          onClose={() => setDoctorOpen(false)}
          onJumpToShot={(idx) => {
            setDoctorOpen(false)
            jumpToShotIndex(idx)
          }}
        />
      )}

      {locksOpen && (
        <LocksDrawer
          episodeNum={episode.episodeNum}
          seriesLocks={seriesLocks}
          episodeLocks={episodeLocks}
          onToggleEpisodeLock={(id) => {
            const updated = episodeLocks.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l))
            void updateEpisode(episode.id, { lockWords: updated })
          }}
          onAddEpisodeLock={(label, text) => {
            const next: LockWord = { id: `ep-manual-${Date.now()}`, label, text, source: 'manual', enabled: true }
            void updateEpisode(episode.id, { lockWords: [...episodeLocks, next] })
          }}
          onRemoveEpisodeLock={(id) => {
            void updateEpisode(episode.id, { lockWords: episodeLocks.filter((l) => l.id !== id) })
          }}
          onOpenLorebookRules={() => {
            setLocksOpen(false)
            setActiveView('lorebook')
          }}
          onClose={() => setLocksOpen(false)}
        />
      )}

      {/* MAIN SCROLLABLE CANVAS */}
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-12">
          {/* Inline progress notice while AI writes shots or prompts */}
          {busyAi && planMessage && (
            <div className="flex items-center gap-3 rounded-xl border border-line-2 bg-sun-soft px-4 py-3 text-xs font-semibold text-sun-ink">
              <Spinner className="size-4 text-accent" />
              <span>{planMessage}</span>
            </div>
          )}

          {/* INLINE PENDING DRAFT BANNER + QUICK DRAFT EDITOR */}
          {draft && (
            <>
              <NewAssetsBanner
                episodeNum={episode.episodeNum}
                draft={draft}
                characters={characters}
                derivatives={derivatives}
                locations={locations}
                props={props}
                blockingCount={draftBlockingCount}
                confirming={isConfirming}
                writingPrompts={isWritingPrompts}
                onUpdateProposal={updateDraftProposal}
                onConfirm={() => void handleConfirmDraft()}
                onDiscardDraft={
                  hasClips
                    ? () => {
                        cancelPendingDraftSave()
                        setDraft(null)
                        void updateEpisode(episode.id, { scriptDraft: null })
                      }
                    : undefined
                }
              />

              {/* Compact editable preview of draft shots before confirmation */}
              <div className="flex flex-col gap-2.5">
                {draft.shots.map((s, idx) => (
                  <div
                    key={idx}
                    id={`draft-shot-${idx}`}
                    className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-ink px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper">
                          {clipNumber(idx)}
                        </span>
                        <input
                          value={s.title}
                          onChange={(e) => updateDraftShot(idx, { title: e.target.value })}
                          aria-label={`Judul shot draf ${clipNumber(idx)}`}
                          placeholder={`Shot ${clipNumber(idx)}`}
                          className="rounded bg-transparent px-1 font-display text-sm font-bold text-ink outline-none hover:bg-sand focus:bg-sand focus-visible:ring-2 focus-visible:ring-accent/35"
                        />
                        {s.framing && <Badge tone="draft">{s.framing}</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {s.speaker && <Badge tone="warn">{s.speaker}</Badge>}
                        {s.emotion && <Badge tone="draft">{s.emotion}</Badge>}
                        <span className="font-mono text-[11px] text-muted">{s.durationSec} dtk</span>
                        {draft.shots.length > 1 && (
                          <IconButton label="Hapus shot draf" size={26} onClick={() => removeDraftShot(idx)}>
                            <Trash2 className="size-3.5 text-bad-ink" />
                          </IconButton>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <AutoTextarea
                        value={s.text}
                        onChange={(e) => updateDraftShot(idx, { text: e.target.value })}
                        aria-label={`Dialog atau monolog shot draf ${clipNumber(idx)}`}
                        placeholder="Dialog / Monolog batin (kosongkan jika tanpa suara)…"
                        minRows={1}
                        maxHeight={100}
                        className="w-full rounded-xl border border-line bg-paper p-2.5 text-xs text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                      />
                      <AutoTextarea
                        value={s.visualAction}
                        onChange={(e) => updateDraftShot(idx, { visualAction: e.target.value })}
                        aria-label={`Aksi visual shot draf ${clipNumber(idx)}`}
                        placeholder="Aksi visual di layar…"
                        minRows={1}
                        maxHeight={100}
                        className="w-full rounded-xl border border-line bg-paper p-2.5 text-xs text-ink-2 outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {(s.characters ?? []).map((cn) => {
                        const costume = s.costumes?.[cn]
                        const unmapped = cn.trim() && !knownDraftNames.charNames.has(cn.trim().toLowerCase())
                        return (
                          <span
                            key={cn}
                            className={cx(
                              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5',
                              unmapped ? 'border-bad-ink/40 bg-bad-soft text-bad-ink' : 'border-line bg-sand text-ink'
                            )}
                          >
                            <span>
                              @{cn}
                              {costume && !isDefaultCostume(costume) ? `/${costume}` : ''}
                            </span>
                            {unmapped && (
                              <button
                                type="button"
                                onClick={() => proposeDraftAsset('character', cn)}
                                className="ml-1 font-bold underline"
                              >
                                + Usulkan
                              </button>
                            )}
                          </span>
                        )
                      })}
                      {s.location && (() => {
                        const unmapped = !knownDraftNames.locNames.has(s.location.trim().toLowerCase())
                        return (
                          <span
                            className={cx(
                              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5',
                              unmapped ? 'border-bad-ink/40 bg-bad-soft text-bad-ink' : 'border-line bg-sand text-ink'
                            )}
                          >
                            <span>@{s.location}</span>
                            {unmapped && (
                              <button
                                type="button"
                                onClick={() => proposeDraftAsset('location', s.location!)}
                                className="ml-1 font-bold underline"
                              >
                                + Usulkan
                              </button>
                            )}
                          </span>
                        )
                      })()}
                      {(s.props ?? []).map((pr) => {
                        const unmapped = pr.trim() && !knownDraftNames.propNames.has(pr.trim().toLowerCase())
                        return (
                          <span
                            key={pr}
                            className={cx(
                              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5',
                              unmapped ? 'border-bad-ink/40 bg-bad-soft text-bad-ink' : 'border-line bg-sand text-ink'
                            )}
                          >
                            <span>@{pr}</span>
                            {unmapped && (
                              <button
                                type="button"
                                onClick={() => proposeDraftAsset('prop', pr)}
                                className="ml-1 font-bold underline"
                              >
                                + Usulkan
                              </button>
                            )}
                          </span>
                        )
                      })}
                      {s.speaker && !isNarratorName(s.speaker) && !knownDraftNames.charNames.has(s.speaker.trim().toLowerCase()) && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-bad-ink/40 bg-bad-soft px-2 py-0.5 text-bad-ink">
                          <span>Pembicara "{s.speaker}" belum terdaftar</span>
                          <button
                            type="button"
                            onClick={() => proposeDraftAsset('character', s.speaker!)}
                            className="ml-1 font-bold underline"
                          >
                            + Usulkan
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* EMPTY STATE (No draft and no confirmed clips yet) */}
          {!draft && !hasClips && (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line-3 bg-surface px-6 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-sun-soft text-sun-ink">
                <Sparkles className="size-6" />
              </div>
              <div className="max-w-md space-y-1">
                <h2 className="font-display text-lg font-bold text-ink">Mulai Produksi Ep {episode.episodeNum}</h2>
                <p className="text-xs leading-relaxed text-muted">
                  Satu klik akan menyusun daftar shot, dialog, dan usulan aset baru dari kerangka episode ini, lalu
                  otomatis menulis prompt visual setelah kamu setujui.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button variant="accent" icon={<Sparkles className="size-4" />} loading={busyAi} onClick={() => void handlePlanScript()}>
                  Susun Shot &amp; Prompt dengan AI
                </Button>
                <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => addClip(null)}>
                  Tambah Shot Manual
                </Button>
              </div>
            </div>
          )}

          {/* CONFIRMED UNIFIED SHOT CARDS */}
          {!draft && hasClips && (
            <>
              {visibleClips.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-2 bg-surface px-6 py-12 text-center">
                  <p className="text-sm font-semibold text-ink">Tidak ada shot yang cocok dengan filter ini.</p>
                  <Button variant="secondary" size="sm" onClick={() => setStatusFilter('all')}>
                    Tampilkan semua shot
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {visibleClips.map(({ clip, index }) => (
                    <ShotCard
                      key={clip.id}
                      clip={clip}
                      index={index}
                      total={clips.length}
                      project={project}
                      characters={characters}
                      derivatives={derivatives}
                      locations={locations}
                      props={props}
                      assets={assets}
                      jobs={jobs}
                      prereqCtx={prereqCtx}
                      activeLocks={activeLocks}
                      previousClipImageAssetId={index > 0 ? (clips[index - 1]?.imageAssetId ?? null) : null}
                      checked={selectedBatchIds.has(clip.id)}
                      expanded={expandedShotIds.has(clip.id)}
                      onToggleCheck={() => toggleSelectBatch(clip.id)}
                      onToggleExpand={() => toggleExpandShot(clip.id)}
                      onPlayAnimatic={() => setAnimaticClipId(clip.id)}
                    />
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => addClip(clips[clips.length - 1]?.id ?? null)}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 bg-surface text-xs font-semibold text-ink-2 transition-colors hover:border-ink-2 hover:text-ink"
              >
                <Plus className="size-4" />
                Tambah Shot Baru di Akhir Episode
              </button>
            </>
          )}
        </div>
      </div>

      {/* SEPARATED BATCH ESTIMATE MODAL (IMAGE OR VIDEO) */}
      <BatchEstimateModal
        open={batchModal !== null}
        onClose={() => setBatchModal(null)}
        projectId={project.id}
        episodeId={episode.id}
        kind={batchModal?.kind ?? 'image'}
        clipIds={batchModal?.clipIds}
        onStarted={() => {
          if (batchModal?.clipIds) setSelectedBatchIds(new Set())
        }}
        onSelectClip={(cid) => {
          const el = document.getElementById(`shot-card-${cid}`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          select(cid)
        }}
      />

      {/* ANIMATIC 9:16 PREVIEW MODAL */}
      <AnimaticPreviewModal
        open={animaticClipId !== undefined}
        onClose={() => setAnimaticClipId(undefined)}
        project={project}
        clips={clips}
        assets={assets}
        characters={characters}
        initialClipId={animaticClipId ?? null}
        onJumpToClip={(cid) => {
          const el = document.getElementById(`shot-card-${cid}`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          select(cid)
        }}
      />

      {/* SNAPSHOT HISTORY & SAVE MODALS */}
      <SnapshotModals
        episodeNum={episode.episodeNum}
        historyOpen={historyOpen}
        onCloseHistory={() => setHistoryOpen(false)}
        saveOpen={saveSnapOpen}
        onCloseSave={() => setSaveSnapOpen(false)}
        versions={versions}
        canSaveSnapshot={Boolean(draft)}
        onSaveSnapshot={async (note) => {
          if (!draft) return
          await window.api.scriptVersions.save(episode.id, draft, note)
          toast('success', 'Snapshot naskah berhasil disimpan.')
          void loadVersions()
        }}
        onRestoreVersion={async (v) => {
          const ok = await confirmDialog({
            title: 'Pulihkan Versi Naskah?',
            body: `Draf saat ini akan diganti dengan snapshot "${v.note || 'Versi'}".`,
            confirm: 'Pulihkan',
            danger: true
          })
          if (!ok) return
          cancelPendingDraftSave()
          setDraft(v.draft)
          await updateEpisode(episode.id, { scriptDraft: v.draft })
          setHistoryOpen(false)
          toast('success', 'Draf naskah dipulihkan.')
        }}
      />
    </div>
  )
}
