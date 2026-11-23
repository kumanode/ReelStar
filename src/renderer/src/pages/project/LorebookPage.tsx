import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Users,
  MapPin,
  Package,
  Plus,
  Search,
  Sparkles,
  Upload,
  MoreVertical,
  GitMerge,
  Trash2,
  X,
  Shirt,
  ArrowRight,
  Lock,
  RefreshCw,
  GitBranch,
  CheckCircle2,
  Clock,
  Flame,
  AlertTriangle,
  Wand2,
  FileSearch,
  Images
} from 'lucide-react'
import type {
  AssetUsageSummary,
  Character,
  Location,
  Prop,
  VoiceOption,
  LorebookExtractionResult,
  AcceptLorebookCandidatesInput,
  LockWord,
  ContinuityItem,
  ContinuityKind,
  ContinuityStatus,
  ContinuityTier
} from '@shared/types'
import { buildLockWords } from '@shared/lock'
import { resolveActive } from '@shared/providers'
import {
  getCharacterSheetStatus,
  getDerivativeSheetStatus,
  getLocationSheetStatus,
  getPropSheetStatus
} from '@shared/validation'
import { detectCharacterGender, geminiVoiceGender, resolveClipTtsVoice } from '@shared/models'
import { Badge, Button, Field, IconButton, Menu, Modal, Segmented, confirmDialog, cx, inputCls } from '../../components/ui'
import { GeneratingOverlay } from '../../components/ClipVisual'
import { AutoTextarea } from '../../components/AutoTextarea'
import { Select } from '../../components/Select'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useTtsProject } from '../../lib/useTtsProject'
import { isRunning, jobFor, useProject } from '../../store/project'
import { MergeAssetModal } from './MergeAssetModal'
import { BatchEstimateSheetModal } from './BatchEstimateSheetModal'
import { CandidateReviewModal } from './CandidateReviewModal'
import { SeriesGuidelinesModal } from './SeriesGuidelinesModal'

type LorebookTab = 'cast' | 'world' | 'rules'
type WorldFilter = 'all' | 'location' | 'prop'
type RulesSubTab = 'lock' | 'continuity' | 'guidelines'

const LOCK_SOURCE_LABEL: Record<LockWord['source'], string> = {
  character: 'Karakter',
  costume: 'Kostum',
  location: 'Lokasi',
  prop: 'Prop',
  manual: 'Manual'
}

/**
 * Local draft state for async-persisted Lorebook entities (locations & props) so rapid typing and
 * trailing spaces never get overwritten by in-flight IPC responses.
 */
function useDebouncedDraft<T extends Record<string, string>>(
  entityId: string | undefined,
  source: T | null,
  onCommit: (id: string, dirty: Partial<T>) => Promise<void>,
  delayMs = 300
) {
  const [draft, setDraft] = useState<T | null>(source)
  const entityIdRef = useRef<string | undefined>(entityId)
  const pendingRef = useRef<Partial<T> | null>(null)
  const pendingIdRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(0)
  const inFlightPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const editingRef = useRef(false)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  const flushNow = (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const id = pendingIdRef.current
    const patch = pendingRef.current
    if (!id || !patch) return inFlightPromiseRef.current
    pendingIdRef.current = null
    pendingRef.current = null
    inFlightRef.current += 1
    const p = commitRef.current(id, patch).finally(() => {
      inFlightRef.current = Math.max(0, inFlightRef.current - 1)
    })
    inFlightPromiseRef.current = p
    return p
  }

  // Flush the previous entity's pending edits immediately before switching selection.
  useEffect(() => {
    if (entityIdRef.current !== entityId) {
      void flushNow()
      entityIdRef.current = entityId
      editingRef.current = false
      setDraft(source)
    }
  }, [entityId])

  useEffect(() => {
    return () => {
      void flushNow()
    }
  }, [])

  // Sync external updates (e.g. AI Enrich or refreshLorebook) only when not actively editing.
  const sourceKey = source ? JSON.stringify(source) : ''
  useEffect(() => {
    if (!entityId || !source) {
      setDraft(null)
      return
    }
    if (!editingRef.current && !pendingRef.current && inFlightRef.current === 0) {
      setDraft(source)
    }
  }, [entityId, sourceKey])

  const setField = <K extends keyof T>(key: K, value: T[K]): void => {
    if (!entityId) return
    setDraft((prev) => (prev ? { ...prev, [key]: value } : source ? { ...source, [key]: value } : null))
    pendingIdRef.current = entityId
    const nextPending: Partial<T> = Object.assign({}, pendingRef.current ?? undefined)
    nextPending[key] = value
    pendingRef.current = nextPending
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void flushNow()
    }, delayMs)
  }

  const onFocus = (): void => {
    editingRef.current = true
  }

  const onBlur = (): void => {
    editingRef.current = false
    void flushNow()
  }

  const activeDraft = (entityIdRef.current === entityId ? draft : source) ?? source

  return {
    draft: activeDraft,
    setField,
    onFocus,
    onBlur,
    flushNow
  }
}

export function LorebookPage() {
  const {
    project,
    episode,
    characters,
    derivatives,
    locations,
    props,
    assets,
    jobs,
    episodes,
    clips,
    addCharacter,
    updateCharacter,
    removeCharacter,
    addDerivative,
    updateDerivative,
    removeDerivative,
    addLocation,
    updateLocation,
    removeLocation,
    addProp,
    updateProp,
    removeProp,
    continuityItems,
    addContinuityItem,
    updateContinuityItem,
    removeContinuityItem,
    updateProject,
    switchEpisode,
    setActiveView,
    setActiveTab: setProjectActiveTab,
    pendingLorebookExtract,
    consumeLorebookExtract,
    flush,
    refreshLorebook,
    upsertJob
  } = useProject()
  const { toast } = useApp()

  // Sheet hashes include the globally active image model, so the "Basi" badges need it to match generation.
  const [activeImageModel, setActiveImageModel] = useState<string | undefined>(undefined)
  useEffect(() => {
    void window.api.settings
      .get()
      .then((s) => setActiveImageModel(resolveActive(s, 'image').model))
      .catch(() => setActiveImageModel(undefined))
  }, [])

  // Pull latest Lorebook sheets/entities when entering Lorebook so sheets finished in background always appear.
  useEffect(() => {
    if (!project?.id) return
    void flush()
      .then(() => refreshLorebook())
      .catch(() => {})
  }, [project?.id])

  const [activeTab, setActiveTab] = useState<LorebookTab>('cast')
  const [worldFilter, setWorldFilter] = useState<WorldFilter>('all')
  const [rulesSubTab, setRulesSubTab] = useState<RulesSubTab>('lock')
  const [guidelinesModalOpen, setGuidelinesModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newLockLabel, setNewLockLabel] = useState('')
  const [newLockText, setNewLockText] = useState('')
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [enrichingTarget, setEnrichingTarget] = useState<string | null>(null)
  const extractingRef = useRef(false)
  const extractSeqRef = useRef(0)
  const [reviewResult, setReviewResult] = useState<LorebookExtractionResult | null>(null)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)

  // Merge modal state
  const [mergeState, setMergeState] = useState<{
    open: boolean
    kind: 'character' | 'location' | 'prop'
    sourceId: string
    sourceName: string
  }>({ open: false, kind: 'character', sourceId: '', sourceName: '' })

  // Continuity state
  const [continuityFilter, setContinuityFilter] = useState<'all' | 'open' | 'paid' | 'dropped'>('all')
  const [continuityModalOpen, setContinuityModalOpen] = useState(false)
  const [newContKind, setNewContKind] = useState<ContinuityKind>('foreshadow')
  const [newContTier, setNewContTier] = useState<ContinuityTier>('hot')
  const [newContName, setNewContName] = useState('')
  const [newContDetail, setNewContDetail] = useState('')
  const [newContPlantedEp, setNewContPlantedEp] = useState('')

  useEffect(() => {
    if (newContPlantedEp && episodes.some((e) => e.id === newContPlantedEp)) return
    setNewContPlantedEp(episode?.id ?? episodes[0]?.id ?? '')
  }, [episodes, episode?.id, newContPlantedEp])

  const handleCreateContinuity = async () => {
    if (!newContName.trim()) {
      toast('info', 'Nama benang cerita tidak boleh kosong.')
      return
    }
    const epId =
      (newContPlantedEp && episodes.some((e) => e.id === newContPlantedEp) ? newContPlantedEp : '') ||
      episode?.id ||
      episodes[0]?.id ||
      ''
    try {
      await addContinuityItem({
        kind: newContKind,
        tier: newContTier,
        name: newContName.trim(),
        detail: newContDetail.trim(),
        plantedEpisodeId: epId,
        status: 'open'
      })
      toast('success', 'Benang cerita berhasil ditambahkan.')
      setNewContName('')
      setNewContDetail('')
      setContinuityModalOpen(false)
    } catch (err) {
      toast('error', `Gagal menambahkan: ${errorText(err)}`)
    }
  }

  const handleToggleContinuityStatus = async (item: ContinuityItem, newStatus: ContinuityStatus, payoffEpId?: string) => {
    try {
      await updateContinuityItem(item.id, {
        status: newStatus,
        payoffEpisodeId: newStatus === 'paid' ? (payoffEpId ?? episode?.id ?? episodes[episodes.length - 1]?.id ?? null) : null
      })
      toast('success', newStatus === 'paid' ? 'Benang cerita ditandai lunas.' : newStatus === 'dropped' ? 'Benang cerita diabaikan.' : 'Benang cerita dibuka kembali.')
    } catch (err) {
      toast('error', `Gagal mengubah status: ${errorText(err)}`)
    }
  }

  const handleRemoveContinuity = async (item: ContinuityItem) => {
    const ok = await confirmDialog({
      title: 'Hapus Benang Cerita',
      body: `Hapus catatan "${item.name}"? Tindakan ini tidak dapat dibatalkan.`,
      confirm: 'Hapus',
      danger: true
    })
    if (!ok) return
    try {
      await removeContinuityItem(item.id)
      toast('info', 'Benang cerita dihapus.')
    } catch (err) {
      toast('error', `Gagal menghapus: ${errorText(err)}`)
    }
  }

  const handleEnrichLorebook = async (target?: { kind: 'character' | 'location' | 'prop'; id: string }) => {
    if (!project || enrichingTarget) return
    const key = target ? target.id : 'all'
    if (!target) {
      const total = characters.length + locations.length + props.length
      if (total === 0) {
        toast('info', 'Belum ada tokoh, lokasi, atau prop untuk diperkaya.')
        return
      }
      const ok = await confirmDialog({
        title: 'Perkaya Detail Semua Lorebook dengan AI?',
        body: `AI akan melengkapi detail visual siap-kamera (motif batik/pakaian, ciri wajah, aksesoris, tata letak 4 dinding lokasi, serta skala & material prop) untuk ${characters.length} tokoh, ${locations.length} lokasi, dan ${props.length} prop tanpa mengubah konsep yang sudah kamu tulis.`,
        confirm: 'Perkaya Semua Detail',
        danger: false
      })
      if (!ok) return
    }
    setEnrichingTarget(key)
    try {
      await Promise.all([flush(), locDraft.flushNow(), propDraft.flushNow()])
      const res = await window.api.lorebook.enrich(project.id, target)
      const freshBundle = await window.api.projects.get(project.id)
      useProject.getState().load(freshBundle)
      const totalUpdated = res.updatedCharacters + res.updatedLocations + res.updatedProps
      if (totalUpdated > 0) {
        toast(
          'success',
          target
            ? 'Detail visual diperkaya oleh AI. Buat ulang lembarnya bila ingin gambar referensi ikut diperbarui.'
            : `Berhasil memperkaya ${res.updatedCharacters} tokoh, ${res.updatedLocations} lokasi, dan ${res.updatedProps} prop!`
        )
      } else {
        toast('info', 'Tidak ada item yang diperbarui.')
      }
    } catch (err) {
      toast('error', `Gagal memperkaya detail Lorebook: ${errorText(err)}`)
    } finally {
      setEnrichingTarget(null)
    }
  }

  const handleExtractLorebook = async () => {
    if (!project || extractingRef.current) return
    const hasStory =
      !!project.sourceText?.trim() ||
      !!project.synopsis?.trim() ||
      episodes.some((e) => e.summary.trim() || e.hook?.trim() || e.sourceText?.trim() || e.scriptDraft?.shots?.length) ||
      clips.some((c) => c.story?.trim() || c.narration?.trim() || c.visualPrompt?.trim())
    if (!hasStory) {
      toast('info', 'Teks cerita atau ringkasan episode masih kosong. Isi dulu di Episode Hub sebelum ekstraksi.')
      return
    }
    const seq = ++extractSeqRef.current
    extractingRef.current = true
    setExtracting(true)
    try {
      await flush()
      const result = await window.api.lorebook.extract(project.id)
      if (seq !== extractSeqRef.current) return
      const count = result.characters.length + result.derivatives.length + result.locations.length + result.props.length
      if (count === 0) {
        toast('info', 'Tidak ada entitas baru yang terdeteksi dari cerita.')
        return
      }
      setReviewResult(result)
      setReviewModalOpen(true)
    } catch (err) {
      if (seq !== extractSeqRef.current) return
      const msg = errorText(err)
      if (/Ekstraksi digantikan/i.test(msg)) return
      if (/Ekstraksi dibatalkan|Dibatalkan/i.test(msg)) {
        toast('info', 'Ekstraksi Lorebook dibatalkan.')
        return
      }
      toast('error', `Gagal mengekstrak Lorebook: ${msg}`)
    } finally {
      if (seq === extractSeqRef.current) {
        extractingRef.current = false
        setExtracting(false)
      }
    }
  }

  // Triggered when the creator enters Lorebook with an auto-extract intent from Episode Hub.
  // Check live store state + ref synchronously so React StrictMode's double effect never launches two overlapping runs.
  useEffect(() => {
    if (!pendingLorebookExtract || !project) return
    if (!useProject.getState().pendingLorebookExtract || extractingRef.current) return
    consumeLorebookExtract()
    void handleExtractLorebook()
  }, [pendingLorebookExtract, project?.id])

  const handleAcceptCandidates = async (input: AcceptLorebookCandidatesInput) => {
    try {
      // Flush pending project/character edits before main merges accepted candidates into SQLite.
      await flush()
      const res = await window.api.lorebook.acceptCandidates(input)
      await refreshLorebook()
      toast(
        'success',
        `Berhasil memasukkan ${res.createdCharacters.length} karakter, ${res.createdDerivatives.length} varian, ${res.createdLocations.length} lokasi, dan ${res.createdProps.length} prop ke Lorebook.`
      )
    } catch (err) {
      toast('error', `Gagal menyimpan aset: ${errorText(err)}`)
    }
  }

  const seriesLocks = project?.seriesLock || []

  const handleSyncLocks = () => {
    if (!project) return
    const updated = buildLockWords({ characters, derivatives, locations, props, existing: seriesLocks })
    updateProject({ seriesLock: updated })
    toast('success', 'Kunci kontinuitas berhasil disinkronkan dari Lorebook.')
  }

  const handleToggleLock = (id: string) => {
    if (!project) return
    const updated = seriesLocks.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l))
    updateProject({ seriesLock: updated })
  }

  const handleAddManualLock = () => {
    if (!project || !newLockText.trim()) return
    const newLock: LockWord = {
      id: `manual-${Date.now()}`,
      label: newLockLabel.trim() || 'Kunci Manual',
      text: newLockText.trim(),
      source: 'manual',
      enabled: true
    }
    updateProject({ seriesLock: [...seriesLocks, newLock] })
    setNewLockLabel('')
    setNewLockText('')
    toast('success', 'Kunci manual berhasil ditambahkan.')
  }

  const handleRemoveManualLock = (id: string) => {
    if (!project) return
    const updated = seriesLocks.filter((l) => l.id !== id)
    updateProject({ seriesLock: updated })
  }

  const filteredLocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return seriesLocks
    return seriesLocks.filter((l) => l.label.toLowerCase().includes(q) || l.text.toLowerCase().includes(q))
  }, [seriesLocks, searchQuery])

  // Voices come from the global TTS provider, the one narration and clip TTS actually use.
  const ttsProject = useTtsProject(project)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  useEffect(() => {
    if (!ttsProject) return
    window.api.settings.voices(ttsProject.ttsProvider).then(setVoices).catch(() => {})
  }, [ttsProject?.ttsProvider])


  // Ensure selected item exists or auto-select first item
  const selectedCharacter = characters.find((c) => c.id === selectedId)
  const selectedLocation = locations.find((l) => l.id === selectedId)
  const selectedProp = props.find((p) => p.id === selectedId)

  const locDraftSource = useMemo(
    () =>
      selectedLocation
        ? {
            name: selectedLocation.name,
            description: selectedLocation.description,
            timeOfDayLighting: selectedLocation.profile?.timeOfDayLighting ?? '',
            architecturalStyle: selectedLocation.profile?.architecturalStyle ?? '',
            spatialLayout: selectedLocation.profile?.spatialLayout ?? '',
            colorPalette: selectedLocation.profile?.colorPalette ?? '',
            keyFeatures: selectedLocation.profile?.keyFeatures ?? ''
          }
        : null,
    [selectedLocation]
  )

  const locDraft = useDebouncedDraft(selectedLocation?.id, locDraftSource, async (id, dirty) => {
    const patch: Partial<Location> = {}
    if (dirty.name !== undefined) patch.name = dirty.name
    if (dirty.description !== undefined) patch.description = dirty.description
    const profileKeys = [
      'timeOfDayLighting',
      'architecturalStyle',
      'spatialLayout',
      'colorPalette',
      'keyFeatures'
    ] as const
    if (profileKeys.some((k) => dirty[k] !== undefined)) {
      const currentLoc = useProject.getState().locations.find((l) => l.id === id)
      const nextProfile = { ...(currentLoc?.profile ?? {}) }
      for (const k of profileKeys) {
        if (dirty[k] !== undefined) nextProfile[k] = dirty[k]
      }
      patch.profile = nextProfile
    }
    if (Object.keys(patch).length > 0) await updateLocation(id, patch)
  })

  const propDraftSource = useMemo(
    () =>
      selectedProp
        ? {
            name: selectedProp.name,
            description: selectedProp.description,
            category: selectedProp.profile?.category ?? '',
            sizeScale: selectedProp.profile?.sizeScale ?? '',
            shape: selectedProp.profile?.shape ?? '',
            material: selectedProp.profile?.material ?? '',
            appearance: selectedProp.profile?.appearance ?? '',
            distinctiveDetails: selectedProp.profile?.distinctiveDetails ?? '',
            significance: selectedProp.profile?.significance ?? ''
          }
        : null,
    [selectedProp]
  )

  const propDraft = useDebouncedDraft(selectedProp?.id, propDraftSource, async (id, dirty) => {
    const patch: Partial<Prop> = {}
    if (dirty.name !== undefined) patch.name = dirty.name
    if (dirty.description !== undefined) patch.description = dirty.description
    const profileKeys = [
      'category',
      'sizeScale',
      'shape',
      'material',
      'appearance',
      'distinctiveDetails',
      'significance'
    ] as const
    if (profileKeys.some((k) => dirty[k] !== undefined)) {
      const currentProp = useProject.getState().props.find((pr) => pr.id === id)
      const nextProfile = { ...(currentProp?.profile ?? {}) }
      for (const k of profileKeys) {
        if (dirty[k] !== undefined) nextProfile[k] = dirty[k]
      }
      patch.profile = nextProfile
    }
    if (Object.keys(patch).length > 0) await updateProp(id, patch)
  })

  // Cross-episode usage cache queried from SQLite so counts and warnings cover every episode, not just the active one.
  const [usageCache, setUsageCache] = useState<Record<string, AssetUsageSummary>>({})

  const selectedEntityRef = useMemo<{ kind: 'character' | 'location' | 'prop'; id: string } | null>(() => {
    if (activeTab === 'cast' && selectedCharacter) return { kind: 'character', id: selectedCharacter.id }
    if (activeTab === 'world' && selectedLocation) return { kind: 'location', id: selectedLocation.id }
    if (activeTab === 'world' && selectedProp) return { kind: 'prop', id: selectedProp.id }
    return null
  }, [activeTab, selectedCharacter?.id, selectedLocation?.id, selectedProp?.id])

  useEffect(() => {
    if (!project?.id || !selectedEntityRef) return
    let active = true
    const { kind, id } = selectedEntityRef
    void window.api.lorebook
      .assetUsage(project.id, kind, id)
      .then((summary) => {
        if (active) setUsageCache((prev) => ({ ...prev, [`${kind}:${id}`]: summary }))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [project?.id, selectedEntityRef?.kind, selectedEntityRef?.id, episodes.length, clips.length])

  const tabUsageTargetsKey = useMemo(() => {
    if (activeTab === 'cast') return characters.map((c) => `character:${c.id}`).join(',')
    if (activeTab === 'world') {
      return [...locations.map((l) => `location:${l.id}`), ...props.map((p) => `prop:${p.id}`)].join(',')
    }
    return ''
  }, [activeTab, characters, locations, props])

  useEffect(() => {
    if (!project?.id || !tabUsageTargetsKey) return
    let active = true
    const entries = tabUsageTargetsKey.split(',').map((token) => {
      const idx = token.indexOf(':')
      return { kind: token.slice(0, idx) as 'character' | 'location' | 'prop', id: token.slice(idx + 1) }
    })
    void Promise.all(
      entries.map(async ({ kind, id }) => {
        try {
          const summary = await window.api.lorebook.assetUsage(project.id, kind, id)
          return [`${kind}:${id}`, summary] as const
        } catch {
          return null
        }
      })
    ).then((results) => {
      if (!active) return
      const next: Record<string, AssetUsageSummary> = {}
      for (const r of results) {
        if (r) next[r[0]] = r[1]
      }
      if (Object.keys(next).length > 0) {
        setUsageCache((prev) => ({ ...prev, ...next }))
      }
    })
    return () => {
      active = false
    }
  }, [project?.id, tabUsageTargetsKey, episodes.length, clips.length])

  const hasSelection =
    (activeTab === 'cast' && !!selectedCharacter) ||
    (activeTab === 'world' && (!!selectedLocation || !!selectedProp))

  const cardGridCls = hasSelection
    ? 'grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3'
    : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

  // Filtered lists by search query
  const filteredCharacters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return characters
    return characters.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    )
  }, [characters, searchQuery])

  const filteredLocations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return locations
    return locations.filter(
      (l) => l.name.toLowerCase().includes(q) || (l.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    )
  }, [locations, searchQuery])

  const filteredProps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return props
    return props.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    )
  }, [props, searchQuery])

  const filteredContinuity = useMemo(() => {
    return continuityItems.filter((item) => {
      if (continuityFilter !== 'all' && item.status !== continuityFilter) return false
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        item.name.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q)
      )
    })
  }, [continuityItems, continuityFilter, searchQuery])

  // Compute usage counts for all assets across episodes
  const characterUsageMap = useMemo(() => {
    const map = new Map<string, { total: number; episodes: Map<string, number> }>()
    for (const c of clips) {
      for (const charId of c.characterIds || []) {
        let entry = map.get(charId)
        if (!entry) {
          entry = { total: 0, episodes: new Map() }
          map.set(charId, entry)
        }
        entry.total += 1
        entry.episodes.set(c.episodeId, (entry.episodes.get(c.episodeId) ?? 0) + 1)
      }
    }
    return map
  }, [clips])

  const locationUsageMap = useMemo(() => {
    const map = new Map<string, { total: number; episodes: Map<string, number> }>()
    for (const c of clips) {
      if (c.locationId) {
        let entry = map.get(c.locationId)
        if (!entry) {
          entry = { total: 0, episodes: new Map() }
          map.set(c.locationId, entry)
        }
        entry.total += 1
        entry.episodes.set(c.episodeId, (entry.episodes.get(c.episodeId) ?? 0) + 1)
      }
    }
    return map
  }, [clips])

  const propUsageMap = useMemo(() => {
    const map = new Map<string, { total: number; episodes: Map<string, number> }>()
    for (const c of clips) {
      for (const propId of c.propIds || []) {
        let entry = map.get(propId)
        if (!entry) {
          entry = { total: 0, episodes: new Map() }
          map.set(propId, entry)
        }
        entry.total += 1
        entry.episodes.set(c.episodeId, (entry.episodes.get(c.episodeId) ?? 0) + 1)
      }
    }
    return map
  }, [clips])

  // After every hook above: an earlier return would change the hook order once the project loads.
  if (!project) return null

  // Creation handlers
  const handleAddCharacter = () => {
    const nextNum = characters.length + 1
    const id = addCharacter({
      name: `Tokoh ${nextNum}`,
      description: ''
    })
    setSelectedId(id)
  }

  const handleAddLocation = async () => {
    try {
      const nextNum = locations.length + 1
      const loc = await addLocation({
        name: `Lokasi ${nextNum}`,
        description: ''
      })
      setSelectedId(loc.id)
    } catch (err) {
      toast('error', `Gagal menambahkan lokasi: ${errorText(err)}`)
    }
  }

  const handleAddProp = async () => {
    try {
      const nextNum = props.length + 1
      const pr = await addProp({
        name: `Prop ${nextNum}`,
        description: ''
      })
      setSelectedId(pr.id)
    } catch (err) {
      toast('error', `Gagal menambahkan prop: ${errorText(err)}`)
    }
  }

  const getCrossEpisodeUsage = async (
    kind: 'character' | 'location' | 'prop',
    entityId: string
  ): Promise<{ totalCount: number; episodeCount: number }> => {
    try {
      await flush()
      const summary = await window.api.lorebook.assetUsage(project.id, kind, entityId)
      setUsageCache((prev) => ({ ...prev, [`${kind}:${entityId}`]: summary }))
      return { totalCount: summary.totalCount, episodeCount: summary.episodes.length }
    } catch {
      const cached = usageCache[`${kind}:${entityId}`]
      if (cached) return { totalCount: cached.totalCount, episodeCount: cached.episodes.length }
      const fallback =
        kind === 'character'
          ? characterUsageMap.get(entityId)
          : kind === 'location'
            ? locationUsageMap.get(entityId)
            : propUsageMap.get(entityId)
      return { totalCount: fallback?.total ?? 0, episodeCount: fallback?.episodes.size ?? 0 }
    }
  }

  // Deletion handlers with cross-episode impact warning
  const handleDeleteCharacter = async (char: Character) => {
    const { totalCount: usedCount, episodeCount: usedEps } = await getCrossEpisodeUsage('character', char.id)
    const ok = await confirmDialog({
      title: `Hapus karakter "${char.name}"?`,
      body:
        usedCount > 0
          ? `Karakter ini masih dirujuk di ${usedCount} shot pada ${usedEps} episode. Rujukan tidak akan ditulis ulang; klip yang merujuk karakter ini akan terblokir saat generate. Kamu bisa menggabungkannya ke karakter lain sebagai alternatif.`
          : `Karakter "${char.name}" beserta seluruh varian kostumnya akan dihapus permanen.`,
      confirm: 'Hapus karakter',
      cancel: 'Batal',
      danger: true
    })
    if (!ok) return
    removeCharacter(char.id)
    if (selectedId === char.id) setSelectedId(null)
    toast('info', `Karakter "${char.name}" telah dihapus`)
  }

  const handleDeleteLocation = async (loc: Location) => {
    const { totalCount: usedCount, episodeCount: usedEps } = await getCrossEpisodeUsage('location', loc.id)
    const ok = await confirmDialog({
      title: `Hapus lokasi "${loc.name}"?`,
      body:
        usedCount > 0
          ? `Lokasi ini masih dirujuk di ${usedCount} shot pada ${usedEps} episode. Klip yang merujuk lokasi ini akan terblokir saat generate.`
          : `Lokasi "${loc.name}" akan dihapus permanen.`,
      confirm: 'Hapus lokasi',
      danger: true
    })
    if (!ok) return
    await removeLocation(loc.id)
    if (selectedId === loc.id) setSelectedId(null)
    toast('info', `Lokasi "${loc.name}" telah dihapus`)
  }

  const handleDeleteProp = async (pr: Prop) => {
    const { totalCount: usedCount, episodeCount: usedEps } = await getCrossEpisodeUsage('prop', pr.id)
    const ok = await confirmDialog({
      title: `Hapus prop "${pr.name}"?`,
      body:
        usedCount > 0
          ? `Prop ini masih dirujuk di ${usedCount} shot pada ${usedEps} episode. Klip yang merujuk prop ini akan terblokir saat generate.`
          : `Prop "${pr.name}" akan dihapus permanen.`,
      confirm: 'Hapus prop',
      danger: true
    })
    if (!ok) return
    await removeProp(pr.id)
    if (selectedId === pr.id) setSelectedId(null)
    toast('info', `Prop "${pr.name}" telah dihapus`)
  }

  // Generation & Upload helpers
  const handleGenerateCharacterSheet = async (charId: string) => {
    try {
      await flush()
      const job = await window.api.generate.characterSheet(charId)
      upsertJob(job)
      toast('info', 'Pembuatan lembar karakter dimulai')
    } catch (err) {
      toast('error', `Gagal membuat lembar: ${errorText(err)}`)
    }
  }

  const handlePickCharacterSheet = async (charId: string) => {
    try {
      const asset = await window.api.lorebook.pickCharacterSheet(charId)
      if (asset) {
        updateCharacter(charId, { sheetAssetId: asset.id })
        toast('success', 'Lembar karakter berhasil diunggah')
      }
    } catch (err) {
      toast('error', `Gagal mengunggah: ${errorText(err)}`)
    }
  }

  const handleGenerateLocationSheet = async (locId: string) => {
    try {
      await Promise.all([flush(), locDraft.flushNow()])
      const job = await window.api.lorebook.generateLocationSheet(locId)
      upsertJob(job)
      toast('info', 'Pembuatan lembar lokasi dimulai')
    } catch (err) {
      toast('error', `Gagal membuat lembar: ${errorText(err)}`)
    }
  }

  const handlePickLocationSheet = async (locId: string) => {
    try {
      const asset = await window.api.lorebook.pickLocationSheet(locId)
      if (asset) {
        await updateLocation(locId, { sheetAssetId: asset.id })
        toast('success', 'Lembar lokasi berhasil diunggah')
      }
    } catch (err) {
      toast('error', `Gagal mengunggah: ${errorText(err)}`)
    }
  }

  const handleGeneratePropSheet = async (propId: string) => {
    try {
      await Promise.all([flush(), propDraft.flushNow()])
      const job = await window.api.lorebook.generatePropSheet(propId)
      upsertJob(job)
      toast('info', 'Pembuatan lembar prop dimulai')
    } catch (err) {
      toast('error', `Gagal membuat lembar: ${errorText(err)}`)
    }
  }

  const handlePickPropSheet = async (propId: string) => {
    try {
      const asset = await window.api.lorebook.pickPropSheet(propId)
      if (asset) {
        await updateProp(propId, { sheetAssetId: asset.id })
        toast('success', 'Lembar prop berhasil diunggah')
      }
    } catch (err) {
      toast('error', `Gagal mengunggah: ${errorText(err)}`)
    }
  }

  // Costume variant helpers
  const handleAddVariant = async (charId: string) => {
    try {
      const charDerivs = derivatives.filter((d) => d.characterId === charId)
      const nextNum = charDerivs.length + 1
      const d = await addDerivative({
        characterId: charId,
        name: `Kostum ${nextNum}`,
        promptChange: 'Pakaian alternatif...'
      })
      toast('info', `Varian "${d.name}" ditambahkan`)
    } catch (err) {
      toast('error', `Gagal menambahkan varian: ${errorText(err)}`)
    }
  }

  const handleDeleteVariant = async (variant: { id: string; name: string }) => {
    const ok = await confirmDialog({
      title: `Hapus varian "${variant.name}"?`,
      body: 'Varian kostum beserta lembar referensinya akan dihapus permanen.',
      confirm: 'Hapus varian',
      danger: true
    })
    if (!ok) return
    try {
      await removeDerivative(variant.id)
      toast('info', `Varian "${variant.name}" telah dihapus`)
    } catch (err) {
      toast('error', `Gagal menghapus varian: ${errorText(err)}`)
    }
  }

  const handleGenerateDerivativeSheet = async (derivId: string) => {
    try {
      await flush()
      const job = await window.api.lorebook.generateDerivativeSheet(derivId)
      upsertJob(job)
      toast('info', 'Pembuatan lembar varian dimulai')
    } catch (err) {
      toast('error', `Gagal membuat lembar varian: ${errorText(err)}`)
    }
  }

  const handlePickDerivativeSheet = async (derivId: string) => {
    try {
      const asset = await window.api.lorebook.pickDerivativeSheet(derivId)
      if (asset) {
        await updateDerivative(derivId, { sheetAssetId: asset.id })
        toast('success', 'Lembar varian berhasil diunggah')
      }
    } catch (err) {
      toast('error', `Gagal mengunggah: ${errorText(err)}`)
    }
  }

  // Alias chip addition / deletion
  const handleAddAlias = (
    currentAliases: string[],
    newAlias: string,
    onUpdate: (updated: string[]) => void
  ) => {
    const clean = newAlias.trim()
    if (!clean || currentAliases.includes(clean)) return
    onUpdate([...currentAliases, clean])
  }

  const handleRemoveAlias = (
    currentAliases: string[],
    aliasToRemove: string,
    onUpdate: (updated: string[]) => void
  ) => {
    onUpdate(currentAliases.filter((a) => a !== aliasToRemove))
  }

  return (
    <div className="flex h-full flex-col bg-paper">
      {/* Top Bar: Tabs, Search, Add Button. It wraps instead of clipping: at 1180×720 with the sidebar open the
          actions do not fit beside the tabs, and a clipped "Tambah" button cannot be reached at all. */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface px-6 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented<LorebookTab>
            value={activeTab}
            onChange={(tab) => {
              setActiveTab(tab)
              setSelectedId(null)
            }}
            options={[
              {
                id: 'cast',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" /> Pemeran ({characters.length})
                  </span>
                )
              },
              {
                id: 'world',
                label: (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3.5" /> Dunia ({locations.length + props.length})
                  </span>
                )
              },
              {
                id: 'rules',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Lock className="size-3.5" /> Aturan Serial
                  </span>
                )
              }
            ]}
            size="sm"
          />

          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
            <input
              value={searchQuery}
              aria-label="Cari di Lorebook"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'rules'
                  ? 'Cari kunci atau benang cerita...'
                  : activeTab === 'cast'
                    ? 'Cari pemeran atau alias...'
                    : 'Cari lokasi, prop, atau alias...'
              }
              className="h-8 w-56 rounded-lg border border-line-2 bg-paper pl-8 pr-2.5 text-xs text-ink outline-none placeholder:text-muted transition-colors focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab !== 'rules' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={extracting}
                icon={<FileSearch className="size-3.5 text-accent" />}
                onClick={handleExtractLorebook}
                title="Ekstrak otomatis karakter, varian pakaian, lokasi, dan prop dari teks cerita atau premis"
              >
                {extracting ? 'Menganalisis cerita...' : 'Ekstrak dari Cerita'}
              </Button>
              {extracting && project && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void window.api.lorebook.cancelExtract(project.id)}
                  title="Berhenti membaca cerita; yang sudah ditemukan tetap bisa ditinjau"
                >
                  Berhenti
                </Button>
              )}

              {(characters.length > 0 || locations.length > 0 || props.length > 0) && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={enrichingTarget === 'all'}
                  disabled={Boolean(enrichingTarget && enrichingTarget !== 'all')}
                  icon={<Wand2 className="size-3.5 text-accent" />}
                  onClick={() => void handleEnrichLorebook()}
                  title="Lengkapi detail visual tokoh (wajah, motif baju/batik, aksesoris), tata ruang 4 sisi lokasi, dan skala/material prop dengan AI"
                >
                  {enrichingTarget === 'all' ? 'Memperkaya...' : 'Perkaya Detail AI'}
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                icon={<Images className="size-3.5" />}
                onClick={() => setBatchModalOpen(true)}
              >
                Buat semua lembar
              </Button>
            </>
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowRight className="size-3.5" />}
            onClick={async () => {
              const next = episodes.find((e) => e.status === 'draft' || e.status === 'planned') ?? episodes[0]
              if (next) {
                await switchEpisode(next.id)
                setActiveView('episode')
                setProjectActiveTab('production')
              } else {
                setActiveView('hub')
              }
            }}
          >
            Lanjut ke Produksi
          </Button>

          {activeTab === 'cast' && (
            <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={handleAddCharacter}>
              Tambah Pemeran
            </Button>
          )}
          {activeTab === 'world' && (
            <>
              <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={handleAddLocation}>
                Lokasi
              </Button>
              <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} onClick={handleAddProp}>
                Prop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area: Split View (Grid on Left, Details on Right) */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Card Grid */}
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
          {/* Tab 1: Pemeran (Characters) */}
          {activeTab === 'cast' && filteredCharacters.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 bg-surface/60 px-6 py-12 text-center">
              <Users className="size-8 text-muted/60" />
              <p className="mt-2 font-display text-sm font-bold text-ink">
                {searchQuery.trim() ? 'Pemeran tidak ditemukan' : 'Belum ada pemeran'}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted">
                {searchQuery.trim()
                  ? 'Coba kata kunci lain atau hapus pencarianmu.'
                  : 'Tambahkan pemeran secara manual lewat tombol di kanan atas, atau klik "Ekstrak dari Cerita" untuk mendeteksi otomatis.'}
              </p>
            </div>
          )}
          {activeTab === 'cast' && filteredCharacters.length > 0 && (
            <div className={cardGridCls}>
              {filteredCharacters.map((char) => {
                const sheet = char.sheetAssetId ? assets[char.sheetAssetId] : null
                const isSelected = selectedId === char.id
                const charDerivs = derivatives.filter((d) => d.characterId === char.id)
                const cachedUsage = usageCache[`character:${char.id}`]
                const localUsage = characterUsageMap.get(char.id)
                const usedInEps = cachedUsage ? cachedUsage.episodes.length : (localUsage?.episodes.size ?? 0)
                const usedTotal = cachedUsage ? cachedUsage.totalCount : (localUsage?.total ?? 0)

                return (
                  <div
                    key={char.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(char.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedId(char.id)
                      }
                    }}
                    className={cx(
                      'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface transition-all focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
                      isSelected ? 'border-ink bg-sun-soft/25 shadow-ink' : 'border-line hover:border-ink-2 hover:shadow-xs'
                    )}
                  >
                    {/* Thumbnail: 3-view character sheet */}
                    <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-line bg-sand">
                      {sheet ? (
                        <img src={sheet.url} alt={char.name} className="size-full object-contain" />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted">
                          <Users className="size-7" />
                          <span className="text-[11px]">Belum ada lembar</span>
                        </div>
                      )}
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        {project && getCharacterSheetStatus(char, project, assets, activeImageModel).status === 'stale' && (
                          <Badge tone="warn" className="text-[11px]">
                            Basi
                          </Badge>
                        )}
                        <Menu
                          trigger={(open) => (
                            <button
                              type="button"
                              aria-label={`Opsi untuk ${char.name}`}
                              title="Opsi"
                              onClick={(e) => {
                                e.stopPropagation()
                                open()
                              }}
                              className="flex size-6 items-center justify-center rounded-lg border border-line-2 bg-surface/95 text-muted transition-colors hover:border-ink hover:text-ink"
                            >
                              <MoreVertical className="size-3.5" />
                            </button>
                          )}
                          items={[
                            {
                              label: 'Gabungkan ke…',
                              icon: <GitMerge className="size-3.5" />,
                              run: () => {
                                setMergeState({
                                  open: true,
                                  kind: 'character',
                                  sourceId: char.id,
                                  sourceName: char.name
                                })
                              }
                            },
                            {
                              label: 'Hapus karakter',
                              icon: <Trash2 className="size-3.5" />,
                              danger: true,
                              run: () => void handleDeleteCharacter(char)
                            }
                          ]}
                        />
                      </div>
                    </div>

                    {/* Card Info */}
                    <div className="flex flex-col gap-2 p-3">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-display text-sm font-bold text-ink" title={char.name}>
                          {char.name}
                        </span>
                        {char.aliases?.[0] && (
                          <span className="max-w-[100px] truncate rounded bg-sand px-1.5 py-0.5 text-[11px] text-muted">
                            alias {char.aliases[0]}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <span className="rounded bg-sand px-1.5 py-0.5 font-medium">
                          {charDerivs.length} varian
                        </span>
                        <span className="rounded bg-sand px-1.5 py-0.5 font-medium">
                          {usedInEps} episode ({usedTotal} shot)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Tab 2: Dunia (Lokasi + Prop with filter chip) */}
          {activeTab === 'world' && (
            <div className="mb-4 flex items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `Semua (${filteredLocations.length + filteredProps.length})` },
                  { id: 'location', label: `Lokasi (${filteredLocations.length})` },
                  { id: 'prop', label: `Prop (${filteredProps.length})` }
                ] as { id: WorldFilter; label: string }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setWorldFilter(f.id)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    worldFilter === f.id
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line bg-surface text-ink-2 hover:text-ink'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Locations Grid */}
          {activeTab === 'world' && (worldFilter === 'all' || worldFilter === 'location') && filteredLocations.length > 0 && (
            <div className="mb-6">
              {worldFilter === 'all' && filteredProps.length > 0 && (
                <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                  <MapPin className="size-3.5" /> Lokasi ({filteredLocations.length})
                </h4>
              )}
              <div className={cardGridCls}>
              {filteredLocations.map((loc) => {
                const sheet = loc.sheetAssetId ? assets[loc.sheetAssetId] : null
                const isSelected = selectedId === loc.id
                const cachedUsage = usageCache[`location:${loc.id}`]
                const localUsage = locationUsageMap.get(loc.id)
                const locEps = cachedUsage ? cachedUsage.episodes.length : (localUsage?.episodes.size ?? 0)
                const locTotal = cachedUsage ? cachedUsage.totalCount : (localUsage?.total ?? 0)

                return (
                  <div
                    key={loc.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(loc.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedId(loc.id)
                      }
                    }}
                    className={cx(
                      'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface transition-all focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
                      isSelected ? 'border-ink bg-sun-soft/25 shadow-ink' : 'border-line hover:border-ink-2 hover:shadow-xs'
                    )}
                  >
                    <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-line bg-sand">
                      {sheet ? (
                        <img src={sheet.url} alt={loc.name} className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted">
                          <MapPin className="size-7" />
                          <span className="text-[11px]">Belum ada lembar</span>
                        </div>
                      )}
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        {project && getLocationSheetStatus(loc, project, assets, activeImageModel).status === 'stale' && (
                          <Badge tone="warn" className="text-[11px]">
                            Basi
                          </Badge>
                        )}
                        <Menu
                          trigger={(open) => (
                            <button
                              type="button"
                              aria-label={`Opsi untuk ${loc.name}`}
                              title="Opsi"
                              onClick={(e) => {
                                e.stopPropagation()
                                open()
                              }}
                              className="flex size-6 items-center justify-center rounded-lg border border-line-2 bg-surface/95 text-muted transition-colors hover:border-ink hover:text-ink"
                            >
                              <MoreVertical className="size-3.5" />
                            </button>
                          )}
                          items={[
                            {
                              label: 'Gabungkan ke…',
                              icon: <GitMerge className="size-3.5" />,
                              run: () => {
                                setMergeState({
                                  open: true,
                                  kind: 'location',
                                  sourceId: loc.id,
                                  sourceName: loc.name
                                })
                              }
                            },
                            {
                              label: 'Hapus lokasi',
                              icon: <Trash2 className="size-3.5" />,
                              danger: true,
                              run: () => void handleDeleteLocation(loc)
                            }
                          ]}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 p-3">
                      <span className="truncate font-display text-sm font-bold text-ink" title={loc.name}>
                        {loc.name}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="rounded bg-sand px-1.5 py-0.5 font-medium">
                          {locEps} episode ({locTotal} shot)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
              </div>
            </div>
          )}

          {/* Props Grid */}
          {activeTab === 'world' && (worldFilter === 'all' || worldFilter === 'prop') && filteredProps.length > 0 && (
            <div>
              {worldFilter === 'all' && filteredLocations.length > 0 && (
                <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                  <Package className="size-3.5" /> Prop ({filteredProps.length})
                </h4>
              )}
              <div className={cardGridCls}>
              {filteredProps.map((pr) => {
                const sheet = pr.sheetAssetId ? assets[pr.sheetAssetId] : null
                const isSelected = selectedId === pr.id
                const cachedUsage = usageCache[`prop:${pr.id}`]
                const localUsage = propUsageMap.get(pr.id)
                const propEps = cachedUsage ? cachedUsage.episodes.length : (localUsage?.episodes.size ?? 0)
                const propTotal = cachedUsage ? cachedUsage.totalCount : (localUsage?.total ?? 0)

                return (
                  <div
                    key={pr.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(pr.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedId(pr.id)
                      }
                    }}
                    className={cx(
                      'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface transition-all focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
                      isSelected ? 'border-ink bg-sun-soft/25 shadow-ink' : 'border-line hover:border-ink-2 hover:shadow-xs'
                    )}
                  >
                    <div className="relative aspect-square w-full overflow-hidden border-b border-line bg-sand">
                      {sheet ? (
                        <img src={sheet.url} alt={pr.name} className="size-full object-contain" />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted">
                          <Package className="size-7" />
                          <span className="text-[11px]">Belum ada lembar</span>
                        </div>
                      )}
                      <div className="absolute top-2 right-2 flex items-center gap-1">
                        {project && getPropSheetStatus(pr, project, assets, activeImageModel).status === 'stale' && (
                          <Badge tone="warn" className="text-[11px]">
                            Basi
                          </Badge>
                        )}
                        <Menu
                          trigger={(open) => (
                            <button
                              type="button"
                              aria-label={`Opsi untuk ${pr.name}`}
                              title="Opsi"
                              onClick={(e) => {
                                e.stopPropagation()
                                open()
                              }}
                              className="flex size-6 items-center justify-center rounded-lg border border-line-2 bg-surface/95 text-muted transition-colors hover:border-ink hover:text-ink"
                            >
                              <MoreVertical className="size-3.5" />
                            </button>
                          )}
                          items={[
                            {
                              label: 'Gabungkan ke…',
                              icon: <GitMerge className="size-3.5" />,
                              run: () => {
                                setMergeState({
                                  open: true,
                                  kind: 'prop',
                                  sourceId: pr.id,
                                  sourceName: pr.name
                                })
                              }
                            },
                            {
                              label: 'Hapus prop',
                              icon: <Trash2 className="size-3.5" />,
                              danger: true,
                              run: () => void handleDeleteProp(pr)
                            }
                          ]}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 p-3">
                      <span className="truncate font-display text-sm font-bold text-ink" title={pr.name}>
                        {pr.name}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="rounded bg-sand px-1.5 py-0.5 font-medium">
                          {propEps} episode ({propTotal} shot)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
              </div>
            </div>
          )}

          {activeTab === 'world' &&
            ((worldFilter === 'all' && filteredLocations.length === 0 && filteredProps.length === 0) ||
              (worldFilter === 'location' && filteredLocations.length === 0) ||
              (worldFilter === 'prop' && filteredProps.length === 0)) && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 bg-surface/60 px-6 py-12 text-center">
                <MapPin className="size-8 text-muted/60" />
                <p className="mt-2 font-display text-sm font-bold text-ink">
                  {worldFilter === 'location'
                    ? 'Belum ada lokasi'
                    : worldFilter === 'prop'
                      ? 'Belum ada prop'
                      : 'Belum ada lokasi atau prop'}
                </p>
                <p className="mt-1 max-w-sm text-xs text-muted">
                  Tambahkan secara manual lewat tombol di kanan atas, atau klik &quot;Ekstrak dari Cerita&quot; untuk mendeteksi otomatis.
                </p>
              </div>
            )}
          {activeTab === 'rules' && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'lock', label: 'Kunci Kontinuitas' },
                  { id: 'continuity', label: `Kontinuitas (${continuityItems.length})` },
                  { id: 'guidelines', label: 'Arahan & Template Prompt' }
                ] as { id: RulesSubTab; label: string }[]
              ).map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setRulesSubTab(sub.id)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    rulesSubTab === sub.id
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line bg-surface text-ink-2 hover:text-ink'
                  )}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}

          {/* Guidelines & Prompt Templates sub-section inside Aturan Serial */}
          {activeTab === 'rules' && rulesSubTab === 'guidelines' && project && (
            <div className="flex max-w-4xl flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-ink">Arahan Gaya &amp; Template Prompt Serial</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Aturan nada cerita, gaya bahasa, dan pantangan adegan yang disematkan otomatis ke prompt AI di seluruh episode.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setGuidelinesModalOpen(true)}>
                  Kelola Template Prompt AI
                </Button>
              </div>
              <AutoTextarea
                value={project.seriesGuidelines ?? ''}
                onChange={(e) => updateProject({ seriesGuidelines: e.target.value })}
                placeholder="Contoh: Serial drama vertikal tempo cepat. Tokoh utama selalu tenang dan dingin. Hindari dialog terlalu panjang..."
                minRows={6}
                maxHeight={260}
                className="w-full rounded-xl border border-line bg-paper p-3 text-xs leading-relaxed text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
              />
            </div>
          )}

          {/* Series Lock Words Sub-Tab */}
          {activeTab === 'rules' && rulesSubTab === 'lock' && (
            <div className="flex max-w-4xl flex-col gap-6">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-ink">
                      Kunci Kontinuitas Serial
                    </h3>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      Frasa identitas yang ditempel <strong>apa adanya</strong> ke setiap prompt gambar dan video agar konsistensi visual tokoh, kostum, lokasi, dan prop terjaga di seluruh episode. Frasa otomatis bisa dinonaktifkan, dan frasa kustom manual bisa ditambahkan.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={handleSyncLocks}
                  >
                    Sinkronkan dari Lorebook
                  </Button>
                </div>

                {/* Add Manual Lock Word Form */}
                <div className="mt-5 rounded-xl border border-line bg-paper p-4">
                  <h4 className="text-xs font-semibold text-ink">Tambah Kunci Manual Baru</h4>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      value={newLockLabel}
                      aria-label="Label kunci manual"
                      onChange={(e) => setNewLockLabel(e.target.value)}
                      placeholder="Label (mis. Tahi lalat bawah mata kiri)"
                      className="h-8 rounded-lg border border-line-2 bg-surface px-3 text-xs text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                    />
                    <input
                      value={newLockText}
                      aria-label="Teks kunci manual"
                      onChange={(e) => setNewLockText(e.target.value)}
                      placeholder="Teks kunci (mis. Tahi lalat kecil gelap di bawah mata kiri)"
                      className="h-8 rounded-lg border border-line-2 bg-surface px-3 text-xs text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35 sm:col-span-2"
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus className="size-3.5" />}
                      onClick={handleAddManualLock}
                      disabled={!newLockText.trim()}
                    >
                      Tambah Kunci
                    </Button>
                  </div>
                </div>
              </div>

              {/* Lock Words List */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-ink">
                    Daftar Kunci ({filteredLocks.filter((l) => l.enabled).length} aktif / {filteredLocks.length} total)
                  </span>
                </div>

                {filteredLocks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line p-8 text-center">
                    <Lock className="size-8 text-muted/50" />
                    <p className="mt-2 text-xs font-medium text-ink">Belum ada kunci kontinuitas.</p>
                    <p className="text-[11px] text-muted">Klik &ldquo;Sinkronkan dari Lorebook&rdquo; untuk membuat kunci otomatis dari karakter, lokasi, dan prop.</p>
                  </div>
                ) : (
                  filteredLocks.map((lock) => (
                    <div
                      key={lock.id}
                      className={cx(
                        'flex items-start justify-between gap-4 rounded-xl border p-3.5 transition-colors',
                        lock.enabled
                          ? 'border-line bg-surface text-ink'
                          : 'border-line/60 bg-sand/30 opacity-60'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          aria-label={`Aktifkan kunci ${lock.label}`}
                          checked={lock.enabled}
                          onChange={() => handleToggleLock(lock.id)}
                          className="mt-0.5 size-4 rounded border-line text-ink focus:ring-0"
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-xs font-bold">{lock.label}</span>
                            <span className="rounded bg-sand px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                              {LOCK_SOURCE_LABEL[lock.source] ?? lock.source}
                            </span>
                          </div>
                          <p className="rounded bg-sand/60 px-2 py-1 font-mono text-xs text-ink/90">
                            {lock.text}
                          </p>
                        </div>
                      </div>

                      {lock.source === 'manual' && (
                        <IconButton
                          label="Hapus kunci manual"
                          onClick={() => handleRemoveManualLock(lock.id)}
                          className="text-bad hover:text-bad/80"
                          size={28}
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Continuity Items Sub-Tab */}
          {activeTab === 'rules' && rulesSubTab === 'continuity' && (
            <div className="flex max-w-4xl flex-col gap-6">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-display text-base font-bold text-ink">
                      Benang Cerita & Kontinuitas Antar-Episode
                    </h3>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      Lacak petunjuk awal, barang kunci, aturan dunia, dan dinamika hubungan yang ditanam di episode tertentu agar dibayar dan diselesaikan tepat waktu tanpa celah cerita.
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus className="size-3.5" />}
                    onClick={() => setContinuityModalOpen(true)}
                  >
                    Tambah Benang Cerita
                  </Button>
                </div>

                {/* Filter Pills */}
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <Segmented<'all' | 'open' | 'paid' | 'dropped'>
                    value={continuityFilter}
                    onChange={setContinuityFilter}
                    options={[
                      { id: 'all', label: `Semua (${continuityItems.length})` },
                      { id: 'open', label: `Aktif (${continuityItems.filter((i) => i.status === 'open').length})` },
                      { id: 'paid', label: `Lunas (${continuityItems.filter((i) => i.status === 'paid').length})` },
                      { id: 'dropped', label: `Diabaikan (${continuityItems.filter((i) => i.status === 'dropped').length})` }
                    ]}
                    size="sm"
                  />
                </div>
              </div>

              {/* Continuity Items List */}
              <div className="flex flex-col gap-3">
                {filteredContinuity.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface/50 p-12 text-center">
                    <GitBranch className="size-8 text-muted" />
                    <p className="mt-3 text-sm font-medium text-ink">Belum ada benang cerita</p>
                    <p className="mt-1 text-xs text-muted">
                      {searchQuery
                        ? 'Tidak ada hasil yang cocok dengan pencarianmu.'
                        : 'Catat petunjuk awal atau rahasia cerita yang ditanam agar pemeriksa naskah mengingatkanmu membayarnya.'}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      icon={<Plus className="size-3.5" />}
                      onClick={() => setContinuityModalOpen(true)}
                    >
                      Tambah Catatan Pertama
                    </Button>
                  </div>
                ) : (
                  filteredContinuity.map((item) => {
                    const plantedEp = episodes.find((e) => e.id === item.plantedEpisodeId)
                    const payoffEp = item.payoffEpisodeId ? episodes.find((e) => e.id === item.payoffEpisodeId) : null
                    const plantedIdx = episodes.findIndex((e) => e.id === item.plantedEpisodeId)
                    const ageInEpisodes = plantedIdx !== -1 ? Math.max(0, episodes.length - 1 - plantedIdx) : 0
                    const isHotAlert = item.status === 'open' && item.tier === 'hot' && ageInEpisodes >= 3

                    const kindLabels: Record<ContinuityKind, string> = {
                      foreshadow: 'Petunjuk / Rahasia',
                      prop: 'Barang Kunci',
                      rule: 'Aturan Dunia',
                      relationship: 'Hubungan Tokoh'
                    }

                    return (
                      <div
                        key={item.id}
                        className={cx(
                          'flex flex-col gap-3 rounded-2xl border p-4.5 transition-colors',
                          isHotAlert
                            ? 'border-sun bg-sun-soft/40'
                            : item.status === 'open'
                            ? 'border-line bg-surface'
                            : 'border-line/60 bg-surface/50 opacity-80'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-1 flex-col gap-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-display text-sm font-bold text-ink">
                                {item.name}
                              </span>
                              <Badge tone={item.tier === 'hot' ? 'bad' : 'draft'}>
                                {item.tier === 'hot' ? (
                                  <span className="flex items-center gap-1 font-semibold text-bad-ink">
                                    <Flame className="size-3" /> Mendesak
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-muted">
                                    <Clock className="size-3" /> Jangka Panjang
                                  </span>
                                )}
                              </Badge>
                              <Badge tone="draft">
                                {kindLabels[item.kind] ?? item.kind}
                              </Badge>
                              <Badge
                                tone={
                                  item.status === 'open'
                                    ? 'ok'
                                    : item.status === 'paid'
                                    ? 'info'
                                    : 'draft'
                                }
                              >
                                {item.status === 'open'
                                  ? 'Aktif'
                                  : item.status === 'paid'
                                  ? 'Lunas'
                                  : 'Diabaikan'}
                              </Badge>
                            </div>

                            {item.detail && (
                              <p className="text-xs text-ink/80 leading-relaxed whitespace-pre-wrap">
                                {item.detail}
                              </p>
                            )}

                            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                              <span>
                                Ditanam di:{' '}
                                <strong className="text-ink">
                                  {plantedEp ? `Episode ${plantedEp.episodeNum} (${plantedEp.title})` : 'Episode awal'}
                                </strong>
                              </span>
                              {item.status === 'open' && ageInEpisodes > 0 && (
                                <span className={isHotAlert ? 'font-semibold text-sun-ink' : ''}>
                                  • {ageInEpisodes} episode lalu
                                </span>
                              )}
                              {payoffEp && (
                                <span>
                                  • Dibayar di:{' '}
                                  <strong className="text-ink">
                                    Episode {payoffEp.episodeNum} ({payoffEp.title})
                                  </strong>
                                </span>
                              )}
                            </div>

                            {isHotAlert && (
                              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-sun-soft px-3 py-1.5 text-xs text-sun-ink">
                                <AlertTriangle className="size-3.5 shrink-0" />
                                <span>
                                  Perhatian: Benang cerita mendesak ini sudah terbuka lebih dari 3 episode tanpa dibayar!
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {item.status === 'open' ? (
                              <>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={<CheckCircle2 className="size-3.5 text-ok-ink" />}
                                  onClick={() => handleToggleContinuityStatus(item, 'paid')}
                                  title="Tandai telah dibayar / diselesaikan"
                                >
                                  Tandai Lunas
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleToggleContinuityStatus(item, 'dropped')}
                                  title="Abaikan benang cerita ini"
                                >
                                  Abaikan
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleToggleContinuityStatus(item, 'open')}
                                title="Buka kembali benang cerita ini"
                              >
                                Buka Kembali
                              </Button>
                            )}
                            <IconButton
                              label="Hapus benang cerita"
                              onClick={() => handleRemoveContinuity(item)}
                              className="text-bad hover:text-bad/80"
                              size={28}
                            >
                              <Trash2 className="size-3.5" />
                            </IconButton>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Detail Panel */}
        {hasSelection && (
          <div className="scroll-thin w-[420px] shrink-0 border-l border-line bg-surface p-5 overflow-y-auto">
            {/* Detail Panel for Character */}
          {activeTab === 'cast' && selectedCharacter && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-display text-base font-bold text-ink">Detail Karakter</h3>
                <IconButton label="Tutup detail" onClick={() => setSelectedId(null)} size={28}>
                  <X className="size-4" />
                </IconButton>
              </div>

              {/* 3-View Sheet Preview & Actions */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-muted">Lembar Referensi (3 Tampak)</span>
                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-line bg-paper">
                  {selectedCharacter.sheetAssetId && assets[selectedCharacter.sheetAssetId] ? (
                    <img
                      src={assets[selectedCharacter.sheetAssetId].url}
                      alt={selectedCharacter.name}
                      className="size-full object-contain"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted">
                      <Users className="size-8 text-muted/60" />
                      <span>Belum ada lembar 3 tampak</span>
                    </div>
                  )}
                  {(() => {
                    const charJob = jobFor(jobs, 'sheet', { characterId: selectedCharacter.id })
                    return isRunning(charJob) && charJob ? (
                      <GeneratingOverlay
                        job={charJob}
                        hasBackdrop={Boolean(selectedCharacter.sheetAssetId && assets[selectedCharacter.sheetAssetId])}
                      />
                    ) : null
                  })()}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    icon={<Sparkles className="size-3.5 text-accent" />}
                    onClick={() => void handleGenerateCharacterSheet(selectedCharacter.id)}
                  >
                    {selectedCharacter.sheetAssetId ? 'Buat ulang' : 'Buat lembar AI'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Upload className="size-3.5" />}
                    onClick={() => void handlePickCharacterSheet(selectedCharacter.id)}
                  >
                    Unggah
                  </Button>
                </div>
              </div>

              {/* Basic Fields: Name, Appearance, Voice Style */}
              <Field label="Nama Karakter">
                <input
                  value={selectedCharacter.name}
                  onChange={(e) => updateCharacter(selectedCharacter.id, { name: e.target.value })}
                  className={cx(inputCls, 'h-10 text-sm')}
                />
              </Field>

              <Field
                label="Penampilan Fisik"
                hint="Ciri wajah, rambut, tubuh, dan pakaian bawaan untuk lembar 3 tampak."
              >
                <AutoTextarea
                  value={selectedCharacter.description}
                  onChange={(e) => updateCharacter(selectedCharacter.id, { description: e.target.value })}
                  placeholder="Contoh: Pria 30-an, wajah tegas, rambut hitam pendek disisir rapi. Pakaian bawaan: kemeja putih dan dasi hitam."
                  minRows={2}
                  maxHeight={160}
                  className={cx(inputCls, 'p-2.5 text-xs leading-relaxed')}
                />
              </Field>

              <Field
                label="Gaya Suara Dialog"
                hint="Instruksi ekspresi suara saat model video (Veo) atau narator mengucapkan dialog."
              >
                <AutoTextarea
                  value={selectedCharacter.voiceStyle ?? ''}
                  onChange={(e) => updateCharacter(selectedCharacter.id, { voiceStyle: e.target.value })}
                  placeholder="Contoh: Nada dingin, berwibawa, bicara lambat dan terukur, tidak mudah tersulut emosi."
                  minRows={2}
                  maxHeight={140}
                  className={cx(inputCls, 'p-2.5 text-xs leading-relaxed')}
                />
              </Field>

              {/* Voice Selector */}
              <Field label="Suara TTS Khusus" hint="Kosongkan untuk otomatis mengikuti kelamin pemeran (Gemini) atau narator utama.">
                {(() => {
                  const detectedGender = detectCharacterGender(selectedCharacter)
                  const autoVoice = ttsProject
                    ? resolveClipTtsVoice({ speakerId: selectedCharacter.id }, characters, ttsProject)
                    : ''
                  const autoLabel =
                    ttsProject?.ttsProvider === 'gemini' && (detectedGender === 'female' || detectedGender === 'male')
                      ? `Otomatis (${detectedGender === 'female' ? 'Perempuan' : 'Laki-laki'} · ${autoVoice})`
                      : `Bawaan narator (${ttsProject?.ttsVoice || 'Utama'})`
                  return (
                    <Select
                      label="Suara TTS"
                      size="sm"
                      value={selectedCharacter.ttsVoice || ''}
                      onChange={(v) =>
                        updateCharacter(selectedCharacter.id, {
                          ttsVoice: v || null,
                          ttsProvider: v ? ttsProject?.ttsProvider ?? null : null
                        })
                      }
                      options={[
                        { value: '', label: autoLabel },
                        ...voices.map((v) => {
                          const gen = v.gender ?? geminiVoiceGender(v.id)
                          const genTag = gen === 'female' ? 'Perempuan' : gen === 'male' ? 'Laki-laki' : ''
                          return {
                            value: v.id,
                            label: genTag ? `${v.name} (${genTag})` : v.name,
                            hint: v.description || undefined
                          }
                        })
                      ]}
                    />
                  )
                })()}
              </Field>

              {/* Aliases */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-ink">Nama Alias / Panggilan</span>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedCharacter.aliases ?? []).map((alias) => (
                    <span
                      key={alias}
                      className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-sand px-2.5 py-0.5 text-xs text-ink"
                    >
                      <span>{alias}</span>
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveAlias(selectedCharacter.aliases ?? [], alias, (updated) =>
                            updateCharacter(selectedCharacter.id, { aliases: updated })
                          )
                        }
                        className="text-muted hover:text-bad-ink"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    placeholder="+ Tambah alias (Enter)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const val = (e.target as HTMLInputElement).value
                        handleAddAlias(selectedCharacter.aliases ?? [], val, (updated) =>
                          updateCharacter(selectedCharacter.id, { aliases: updated })
                        )
                        ;(e.target as HTMLInputElement).value = ''
                      }
                    }}
                    className="h-6 w-36 rounded border border-line-2 bg-paper px-2 text-xs text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                  />
                </div>
              </div>

              {/* Character Bible (Visual & Narrative Profiles) */}
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-xs font-bold text-ink">Profil Lengkap Karakter</span>
                    <Badge tone="info" className="text-[11px]">
                      Konsistensi Shot &amp; Prompt
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={enrichingTarget === selectedCharacter.id}
                    disabled={Boolean(enrichingTarget && enrichingTarget !== selectedCharacter.id)}
                    icon={<Wand2 className="size-3 text-accent" />}
                    onClick={() => void handleEnrichLorebook({ kind: 'character', id: selectedCharacter.id })}
                    title="Lengkapi detail wajah, motif pakaian, dan aksesoris tokoh ini dengan AI"
                  >
                    Perkaya AI
                  </Button>
                </div>

                {/* Visual Traits */}
                <div className="flex flex-col gap-2 pt-1 border-t border-line/60">
                  <span className="text-[11px] font-semibold text-muted">Profil Visual</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Usia" className="text-[11px]">
                      <input
                        value={selectedCharacter.profile?.visual?.age ?? ''}
                        onChange={(e) => {
                          const v = { ...(selectedCharacter.profile?.visual ?? {}), age: e.target.value }
                          updateCharacter(selectedCharacter.id, {
                            profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                          })
                        }}
                        placeholder="Contoh: 28 tahun"
                        className={cx(inputCls, 'h-8 text-xs')}
                      />
                    </Field>
                    <Field label="Gender" className="text-[11px]">
                      <input
                        value={selectedCharacter.profile?.visual?.gender ?? ''}
                        onChange={(e) => {
                          const v = { ...(selectedCharacter.profile?.visual ?? {}), gender: e.target.value }
                          updateCharacter(selectedCharacter.id, {
                            profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                          })
                        }}
                        placeholder="Contoh: Pria / Wanita"
                        className={cx(inputCls, 'h-8 text-xs')}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Bentuk Tubuh" className="text-[11px]">
                      <input
                        value={selectedCharacter.profile?.visual?.bodyType ?? selectedCharacter.profile?.visual?.body ?? ''}
                        onChange={(e) => {
                          const v = { ...(selectedCharacter.profile?.visual ?? {}), bodyType: e.target.value, body: e.target.value }
                          updateCharacter(selectedCharacter.id, {
                            profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                          })
                        }}
                        placeholder="Contoh: Tinggi tegap, atletis"
                        className={cx(inputCls, 'h-8 text-xs')}
                      />
                    </Field>
                    <Field label="Rambut" className="text-[11px]">
                      <input
                        value={selectedCharacter.profile?.visual?.hair ?? ''}
                        onChange={(e) => {
                          const v = { ...(selectedCharacter.profile?.visual ?? {}), hair: e.target.value }
                          updateCharacter(selectedCharacter.id, {
                            profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                          })
                        }}
                        placeholder="Contoh: Pendek bergelombang hitam"
                        className={cx(inputCls, 'h-8 text-xs')}
                      />
                    </Field>
                  </div>

                  <Field label="Ciri Wajah" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.visual?.facialFeatures ?? selectedCharacter.profile?.visual?.face ?? ''}
                      onChange={(e) => {
                        const v = { ...(selectedCharacter.profile?.visual ?? {}), facialFeatures: e.target.value, face: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                        })
                      }}
                      placeholder="Contoh: Rahang tegas, mata tajam elang"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>

                  <Field label="Ciri Unik / Tanda Lahir" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.visual?.distinctiveFeatures ?? selectedCharacter.profile?.visual?.distinguishingFeatures ?? ''}
                      onChange={(e) => {
                        const v = { ...(selectedCharacter.profile?.visual ?? {}), distinctiveFeatures: e.target.value, distinguishingFeatures: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                        })
                      }}
                      placeholder="Contoh: Bekas luka tipis di alis kiri"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>

                  <Field label="Aksesoris Tetap" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.visual?.accessories ?? ''}
                      onChange={(e) => {
                        const v = { ...(selectedCharacter.profile?.visual ?? {}), accessories: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                        })
                      }}
                      placeholder="Contoh: Kacamata bingkai tipis hitam, jam tangan kulit cokelat"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>

                  <Field label="Pakaian Bawaan / Khas" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.visual?.defaultOutfit ?? ''}
                      onChange={(e) => {
                        const v = { ...(selectedCharacter.profile?.visual ?? {}), defaultOutfit: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                        })
                      }}
                      placeholder="Contoh: Kemeja batik parang cokelat soga lengan panjang, celana bahan hitam, tanpa jas"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>
                </div>

                {/* Narrative Traits */}
                <div className="flex flex-col gap-2 pt-2 border-t border-line/60">
                  <span className="text-[11px] font-semibold text-muted">Profil Naratif</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Peran" className="text-[11px]">
                      <input
                        value={selectedCharacter.profile?.narrative?.role ?? ''}
                        onChange={(e) => {
                          const n = { ...(selectedCharacter.profile?.narrative ?? {}), role: e.target.value }
                          updateCharacter(selectedCharacter.id, {
                            profile: { ...(selectedCharacter.profile ?? {}), narrative: n }
                          })
                        }}
                        placeholder="Protagonis, Antagonis, Mentor..."
                        className={cx(inputCls, 'h-8 text-xs')}
                      />
                    </Field>
                    <Field label="Pola Bicara" className="text-[11px]">
                      <input
                        value={selectedCharacter.profile?.narrative?.speechPattern ?? ''}
                        onChange={(e) => {
                          const n = { ...(selectedCharacter.profile?.narrative ?? {}), speechPattern: e.target.value }
                          updateCharacter(selectedCharacter.id, {
                            profile: { ...(selectedCharacter.profile ?? {}), narrative: n }
                          })
                        }}
                        placeholder="Lugas, sinis, berbisik..."
                        className={cx(inputCls, 'h-8 text-xs')}
                      />
                    </Field>
                  </div>

                  <Field label="Motivasi / Keinginan Utama" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.narrative?.desire ?? ''}
                      onChange={(e) => {
                        const n = { ...(selectedCharacter.profile?.narrative ?? {}), desire: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), narrative: n }
                        })
                      }}
                      placeholder="Apa yang paling dia inginkan di cerita ini?"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>

                  <Field label="Rahasia / Titik Lemah" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.narrative?.secret ?? ''}
                      onChange={(e) => {
                        const n = { ...(selectedCharacter.profile?.narrative ?? {}), secret: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), narrative: n }
                        })
                      }}
                      placeholder="Hal yang disembunyikan atau kelemahan emosional"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>

                  <Field label="Arc Perkembangan Watak" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.narrative?.arc ?? ''}
                      onChange={(e) => {
                        const n = { ...(selectedCharacter.profile?.narrative ?? {}), arc: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), narrative: n }
                        })
                      }}
                      placeholder="Dari egois menjadi rela berkorban..."
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>
                </div>
              </div>

              {/* Costume Variants Section */}
              <div className="flex flex-col gap-2.5 border-t border-line pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shirt className="size-4 text-accent" />
                    <span className="font-display text-sm font-bold text-ink">Varian Kostum</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus className="size-3" />}
                    onClick={() => void handleAddVariant(selectedCharacter.id)}
                  >
                    Tambah Varian
                  </Button>
                </div>

                <div className="flex flex-col gap-3">
                  {derivatives
                    .filter((d) => d.characterId === selectedCharacter.id)
                    .map((variant) => {
                      const variantSheet = variant.sheetAssetId ? assets[variant.sheetAssetId] : null
                      const isStale =
                        getDerivativeSheetStatus(
                          variant,
                          selectedCharacter,
                          { imageModel: project?.imageModel ?? null },
                          assets,
                          false,
                          activeImageModel
                        ).status === 'stale'

                      return (
                        <div
                          key={variant.id}
                          className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <input
                              defaultValue={variant.name}
                              onBlur={(e) => void updateDerivative(variant.id, { name: e.target.value })}
                              className="rounded font-bold text-ink bg-transparent border-b border-transparent hover:border-line focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35 outline-none transition-colors"
                            />
                            <div className="flex items-center gap-1">
                              {isStale && (
                                <Badge tone="warn" className="text-[11px]">
                                  Basi
                                </Badge>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteVariant(variant)}
                                className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-bad-soft hover:text-bad-ink"
                                title="Hapus varian kostum"
                                aria-label={`Hapus varian kostum ${variant.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-accent-ink">Frasa Kunci Kostum</label>
                            <input
                              defaultValue={variant.costumeKeyphrase ?? ''}
                              onBlur={(e) => void updateDerivative(variant.id, { costumeKeyphrase: e.target.value })}
                              placeholder="Misal: gaun merah pesta malam, setelan jas hitam"
                              className="w-full rounded-lg border border-line-2/70 bg-surface px-2.5 py-1 text-xs text-ink outline-none placeholder:text-muted transition-colors focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                            />
                          </div>

                          <AutoTextarea
                            defaultValue={variant.promptChange}
                            onBlur={(e) => void updateDerivative(variant.id, { promptChange: e.target.value })}
                            placeholder="Deskripsi perubahan pakaian atau gaya..."
                            minRows={1}
                            maxHeight={120}
                            className="w-full rounded-lg border border-line-2/70 bg-surface p-2 text-xs text-ink outline-none placeholder:text-muted transition-colors focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                          />

                          <div className="flex items-center gap-2 pt-1">
                            {(() => {
                              const derivJob = jobFor(jobs, 'sheet', { derivativeId: variant.id })
                              const derivRunning = isRunning(derivJob)
                              return (
                                <>
                                  <div className="relative size-10 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
                                    {variantSheet ? (
                                      <img
                                        key={variantSheet.id}
                                        src={variantSheet.url}
                                        alt={variant.name}
                                        className="rs-media-reveal size-full object-contain"
                                      />
                                    ) : (
                                      <div className="flex size-full items-center justify-center text-muted">
                                        <Shirt className="size-4" />
                                      </div>
                                    )}
                                    {derivRunning && derivJob && (
                                      <GeneratingOverlay job={derivJob} hasBackdrop={Boolean(variantSheet)} compact />
                                    )}
                                  </div>

                                  <div className="flex flex-1 items-center gap-1.5">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      loading={derivRunning}
                                      disabled={!selectedCharacter.sheetAssetId}
                                      title={
                                        !selectedCharacter.sheetAssetId
                                          ? 'Buat lembar karakter dasar terlebih dahulu'
                                          : 'Buat lembar varian dari lembar dasar'
                                      }
                                      onClick={() => void handleGenerateDerivativeSheet(variant.id)}
                                    >
                                      {variantSheet ? 'Buat ulang' : 'Buat lembar'}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void handlePickDerivativeSheet(variant.id)}
                                    >
                                      Unggah
                                    </Button>
                                  </div>
                                </>
                              )
                            })()}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>

              {/* Usage List ("Dipakai di") */}
              <div className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
                <span className="font-semibold text-ink">Dipakai di Episode:</span>
                {(() => {
                  const cached = usageCache[`character:${selectedCharacter.id}`]
                  const rows = cached
                    ? cached.episodes
                    : Array.from(characterUsageMap.get(selectedCharacter.id)?.episodes.entries() ?? []).map(([epId, count]) => {
                        const ep = episodes.find((e) => e.id === epId)
                        return { episodeId: epId, episodeNum: ep?.episodeNum ?? 0, title: ep?.title ?? 'Episode', count }
                      })
                  if (rows.length === 0) {
                    return <span className="text-muted">Belum dipakai di episode mana pun.</span>
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      {rows.map((row) => (
                        <button
                          key={row.episodeId}
                          type="button"
                          onClick={() => {
                            void switchEpisode(row.episodeId)
                            setActiveView('episode')
                          }}
                          className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-sand"
                        >
                          <span className="font-medium text-ink">
                            Ep {row.episodeNum || '?'}: {row.title}
                          </span>
                          <span className="text-muted">{row.count} shot ▸</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Detail Panel for Location */}
          {activeTab === 'world' && selectedLocation && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-display text-base font-bold text-ink">Detail Lokasi</h3>
                <IconButton label="Tutup detail" onClick={() => setSelectedId(null)} size={28}>
                  <X className="size-4" />
                </IconButton>
              </div>

              {(() => {
                const locJob = jobFor(jobs, 'image', { locationId: selectedLocation.id })
                const locRunning = isRunning(locJob)
                const locSheet = selectedLocation.sheetAssetId ? assets[selectedLocation.sheetAssetId] : null
                return (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-muted">Lembar Referensi Lingkungan</span>
                    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-line bg-paper">
                      {locSheet ? (
                        <img
                          key={locSheet.id}
                          src={locSheet.url}
                          alt={selectedLocation.name}
                          className="rs-media-reveal size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted">
                          <MapPin className="size-8 text-muted/60" />
                          <span>Belum ada lembar pemandangan</span>
                        </div>
                      )}
                      {locRunning && locJob && (
                        <GeneratingOverlay job={{ ...locJob, kind: 'sheet' }} hasBackdrop={Boolean(locSheet)} />
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        loading={locRunning}
                        icon={<Sparkles className="size-3.5 text-accent" />}
                        onClick={() => void handleGenerateLocationSheet(selectedLocation.id)}
                      >
                        {selectedLocation.sheetAssetId ? 'Buat ulang' : 'Buat lembar AI'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Upload className="size-3.5" />}
                        onClick={() => void handlePickLocationSheet(selectedLocation.id)}
                      >
                        Unggah
                      </Button>
                    </div>
                  </div>
                )
              })()}

              <Field label="Nama Lokasi">
                <input
                  value={locDraft.draft?.name ?? selectedLocation.name}
                  onFocus={locDraft.onFocus}
                  onBlur={locDraft.onBlur}
                  onChange={(e) => locDraft.setField('name', e.target.value)}
                  className={cx(inputCls, 'h-10 text-sm')}
                />
              </Field>

              <Field label="Deskripsi Suasana & Lingkungan">
                <AutoTextarea
                  value={locDraft.draft?.description ?? selectedLocation.description}
                  onFocus={locDraft.onFocus}
                  onBlur={locDraft.onBlur}
                  onChange={(e) => locDraft.setField('description', e.target.value)}
                  placeholder="Arsitektur, pencahayaan, waktu (siang/malam), furnitur, suasana..."
                  minRows={2}
                  maxHeight={160}
                  className={cx(inputCls, 'p-2.5 text-xs leading-relaxed')}
                />
              </Field>

              {/* Aliases */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-ink">Nama Alias Lokasi</span>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedLocation.aliases ?? []).map((alias) => (
                    <span
                      key={alias}
                      className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-sand px-2.5 py-0.5 text-xs text-ink"
                    >
                      <span>{alias}</span>
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveAlias(selectedLocation.aliases ?? [], alias, (updated) =>
                            updateLocation(selectedLocation.id, { aliases: updated })
                          )
                        }
                        className="text-muted hover:text-bad-ink"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    placeholder="+ Tambah alias (Enter)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const val = (e.target as HTMLInputElement).value
                        handleAddAlias(selectedLocation.aliases ?? [], val, (updated) =>
                          updateLocation(selectedLocation.id, { aliases: updated })
                        )
                        ;(e.target as HTMLInputElement).value = ''
                      }
                    }}
                    className="h-6 w-36 rounded border border-line-2 bg-paper px-2 text-xs text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                  />
                </div>
              </div>

              {/* Location Profile */}
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-xs font-bold text-ink">Profil Lingkungan Lokasi</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={enrichingTarget === selectedLocation.id}
                    disabled={Boolean(enrichingTarget && enrichingTarget !== selectedLocation.id)}
                    icon={<Wand2 className="size-3 text-accent" />}
                    onClick={() => void handleEnrichLorebook({ kind: 'location', id: selectedLocation.id })}
                    title="Lengkapi tata ruang 4 dinding, palet warna, dan arah cahaya lokasi ini dengan AI"
                  >
                    Perkaya AI
                  </Button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted">Tipe Ruang</span>
                  <Segmented<'interior' | 'exterior' | 'mixed'>
                    value={
                      selectedLocation.profile?.interiorExterior === 'exterior'
                        ? 'exterior'
                        : selectedLocation.profile?.interiorExterior === 'mixed'
                          ? 'mixed'
                          : 'interior'
                    }
                    onChange={(val) => {
                      updateLocation(selectedLocation.id, {
                        profile: { ...(selectedLocation.profile ?? {}), interiorExterior: val }
                      })
                    }}
                    options={[
                      { id: 'interior', label: 'Interior (Dalam)' },
                      { id: 'exterior', label: 'Eksterior (Luar)' },
                      { id: 'mixed', label: 'Campuran' }
                    ]}
                    size="sm"
                  />
                </div>

                <Field label="Waktu & Pencahayaan Khas" className="text-[11px]">
                  <input
                    value={locDraft.draft?.timeOfDayLighting ?? selectedLocation.profile?.timeOfDayLighting ?? ''}
                    onFocus={locDraft.onFocus}
                    onBlur={locDraft.onBlur}
                    onChange={(e) => locDraft.setField('timeOfDayLighting', e.target.value)}
                    placeholder="Contoh: Malam hari temaram, lampu neon basah"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Gaya Arsitektur / Desain" className="text-[11px]">
                  <input
                    value={locDraft.draft?.architecturalStyle ?? selectedLocation.profile?.architecturalStyle ?? ''}
                    onFocus={locDraft.onFocus}
                    onBlur={locDraft.onBlur}
                    onChange={(e) => locDraft.setField('architecturalStyle', e.target.value)}
                    placeholder="Contoh: Modern minimalis mewah, lantai marmer"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Tata Letak 4 Sisi / Geografi Ruang (Multi-POV)" className="text-[11px]">
                  <input
                    value={locDraft.draft?.spatialLayout ?? selectedLocation.profile?.spatialLayout ?? ''}
                    onFocus={locDraft.onFocus}
                    onBlur={locDraft.onBlur}
                    onChange={(e) => locDraft.setField('spatialLayout', e.target.value)}
                    placeholder="Contoh: Jendela tinggi dinding kiri, meja kayu panjang di tengah, pintu kaca di dinding belakang"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Palet Warna & Material Dominan" className="text-[11px]">
                  <input
                    value={locDraft.draft?.colorPalette ?? selectedLocation.profile?.colorPalette ?? ''}
                    onFocus={locDraft.onFocus}
                    onBlur={locDraft.onBlur}
                    onChange={(e) => locDraft.setField('colorPalette', e.target.value)}
                    placeholder="Contoh: Kayu walnut gelap, dinding abu-abu hangat, aksen kuningan & kaca bening"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Fitur Utama / Landmark Penting" className="text-[11px]">
                  <input
                    value={locDraft.draft?.keyFeatures ?? selectedLocation.profile?.keyFeatures ?? ''}
                    onFocus={locDraft.onFocus}
                    onBlur={locDraft.onBlur}
                    onChange={(e) => locDraft.setField('keyFeatures', e.target.value)}
                    placeholder="Contoh: Jendela kaca besar menghadap gedung pencakar langit"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>
              </div>

              {/* Usage List */}
              <div className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
                <span className="font-semibold text-ink">Dipakai di Episode:</span>
                {(() => {
                  const cached = usageCache[`location:${selectedLocation.id}`]
                  const rows = cached
                    ? cached.episodes
                    : Array.from(locationUsageMap.get(selectedLocation.id)?.episodes.entries() ?? []).map(([epId, count]) => {
                        const ep = episodes.find((e) => e.id === epId)
                        return { episodeId: epId, episodeNum: ep?.episodeNum ?? 0, title: ep?.title ?? 'Episode', count }
                      })
                  if (rows.length === 0) {
                    return <span className="text-muted">Belum dipakai di episode mana pun.</span>
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      {rows.map((row) => (
                        <button
                          key={row.episodeId}
                          type="button"
                          onClick={() => {
                            void switchEpisode(row.episodeId)
                            setActiveView('episode')
                          }}
                          className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-sand"
                        >
                          <span className="font-medium text-ink">
                            Ep {row.episodeNum || '?'}: {row.title}
                          </span>
                          <span className="text-muted">{row.count} shot ▸</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Detail Panel for Prop */}
          {activeTab === 'world' && selectedProp && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-display text-base font-bold text-ink">Detail Prop</h3>
                <IconButton label="Tutup detail" onClick={() => setSelectedId(null)} size={28}>
                  <X className="size-4" />
                </IconButton>
              </div>

              {(() => {
                const propJob = jobFor(jobs, 'image', { propId: selectedProp.id })
                const propRunning = isRunning(propJob)
                const propSheet = selectedProp.sheetAssetId ? assets[selectedProp.sheetAssetId] : null
                return (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-muted">Lembar Referensi Prop</span>
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-paper">
                      {propSheet ? (
                        <img
                          key={propSheet.id}
                          src={propSheet.url}
                          alt={selectedProp.name}
                          className="rs-media-reveal size-full object-contain"
                        />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted">
                          <Package className="size-8 text-muted/60" />
                          <span>Belum ada lembar prop</span>
                        </div>
                      )}
                      {propRunning && propJob && (
                        <GeneratingOverlay job={{ ...propJob, kind: 'sheet' }} hasBackdrop={Boolean(propSheet)} />
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        loading={propRunning}
                        icon={<Sparkles className="size-3.5 text-accent" />}
                        onClick={() => void handleGeneratePropSheet(selectedProp.id)}
                      >
                        {selectedProp.sheetAssetId ? 'Buat ulang' : 'Buat lembar AI'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Upload className="size-3.5" />}
                        onClick={() => void handlePickPropSheet(selectedProp.id)}
                      >
                        Unggah
                      </Button>
                    </div>
                  </div>
                )
              })()}

              <Field label="Nama Prop">
                <input
                  value={propDraft.draft?.name ?? selectedProp.name}
                  onFocus={propDraft.onFocus}
                  onBlur={propDraft.onBlur}
                  onChange={(e) => propDraft.setField('name', e.target.value)}
                  className={cx(inputCls, 'h-10 text-sm')}
                />
              </Field>

              <Field label="Deskripsi Bentuk & Bahan">
                <AutoTextarea
                  value={propDraft.draft?.description ?? selectedProp.description}
                  onFocus={propDraft.onFocus}
                  onBlur={propDraft.onBlur}
                  onChange={(e) => propDraft.setField('description', e.target.value)}
                  placeholder="Material, warna, ukiran, ukuran, kegunaan khusus..."
                  minRows={2}
                  maxHeight={160}
                  className={cx(inputCls, 'p-2.5 text-xs leading-relaxed')}
                />
              </Field>

              {/* Aliases */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-ink">Nama Alias Prop</span>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedProp.aliases ?? []).map((alias) => (
                    <span
                      key={alias}
                      className="inline-flex items-center gap-1 rounded-full border border-line-2 bg-sand px-2.5 py-0.5 text-xs text-ink"
                    >
                      <span>{alias}</span>
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveAlias(selectedProp.aliases ?? [], alias, (updated) =>
                            updateProp(selectedProp.id, { aliases: updated })
                          )
                        }
                        className="text-muted hover:text-bad-ink"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    placeholder="+ Tambah alias (Enter)"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const val = (e.target as HTMLInputElement).value
                        handleAddAlias(selectedProp.aliases ?? [], val, (updated) =>
                          updateProp(selectedProp.id, { aliases: updated })
                        )
                        ;(e.target as HTMLInputElement).value = ''
                      }
                    }}
                    className="h-6 w-36 rounded border border-line-2 bg-paper px-2 text-xs text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                  />
                </div>
              </div>

              {/* Prop Profile */}
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-xs font-bold text-ink">Profil Prop &amp; Benda</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={enrichingTarget === selectedProp.id}
                    disabled={Boolean(enrichingTarget && enrichingTarget !== selectedProp.id)}
                    icon={<Wand2 className="size-3 text-accent" />}
                    onClick={() => void handleEnrichLorebook({ kind: 'prop', id: selectedProp.id })}
                    title="Lengkapi skala, bentuk, material, dan detail unik prop ini dengan AI"
                  >
                    Perkaya AI
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Kategori Prop" className="text-[11px]">
                    <input
                      value={propDraft.draft?.category ?? selectedProp.profile?.category ?? ''}
                      onFocus={propDraft.onFocus}
                      onBlur={propDraft.onBlur}
                      onChange={(e) => propDraft.setField('category', e.target.value)}
                      placeholder="Dokumen, Elektronik, Perhiasan..."
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>
                  <Field label="Ukuran / Skala Nyata" className="text-[11px]">
                    <input
                      value={propDraft.draft?.sizeScale ?? selectedProp.profile?.sizeScale ?? ''}
                      onFocus={propDraft.onFocus}
                      onBlur={propDraft.onBlur}
                      onChange={(e) => propDraft.setField('sizeScale', e.target.value)}
                      placeholder="Contoh: Ukuran A4, 14 inci, seukuran telapak"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Bentuk & Proporsi" className="text-[11px]">
                    <input
                      value={propDraft.draft?.shape ?? selectedProp.profile?.shape ?? ''}
                      onFocus={propDraft.onFocus}
                      onBlur={propDraft.onBlur}
                      onChange={(e) => propDraft.setField('shape', e.target.value)}
                      placeholder="Contoh: Persegi panjang tipis berlipat"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>
                  <Field label="Material & Finishing" className="text-[11px]">
                    <input
                      value={propDraft.draft?.material ?? selectedProp.profile?.material ?? ''}
                      onFocus={propDraft.onFocus}
                      onBlur={propDraft.onBlur}
                      onChange={(e) => propDraft.setField('material', e.target.value)}
                      placeholder="Contoh: Kulit matte, aluminium perak, kertas"
                      className={cx(inputCls, 'h-8 text-xs')}
                    />
                  </Field>
                </div>

                <Field label="Tampilan Fisik & Warna Detail" className="text-[11px]">
                  <input
                    value={propDraft.draft?.appearance ?? selectedProp.profile?.appearance ?? ''}
                    onFocus={propDraft.onFocus}
                    onBlur={propDraft.onBlur}
                    onChange={(e) => propDraft.setField('appearance', e.target.value)}
                    placeholder="Warna dominan, tekstur permukaan, kondisi terbuka/tertutup..."
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Detail & Tanda Unik" className="text-[11px]">
                  <input
                    value={propDraft.draft?.distinctiveDetails ?? selectedProp.profile?.distinctiveDetails ?? ''}
                    onFocus={propDraft.onFocus}
                    onBlur={propDraft.onBlur}
                    onChange={(e) => propDraft.setField('distinctiveDetails', e.target.value)}
                    placeholder="Contoh: Klip logam perak, kertas laporan mencuat, goresan halus"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Arti Penting / Fungsi Cerita" className="text-[11px]">
                  <input
                    value={propDraft.draft?.significance ?? selectedProp.profile?.significance ?? ''}
                    onFocus={propDraft.onFocus}
                    onBlur={propDraft.onBlur}
                    onChange={(e) => propDraft.setField('significance', e.target.value)}
                    placeholder="Kunci warisan keluarga, bukti pembunuhan..."
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>
              </div>

              {/* Usage List */}
              <div className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
                <span className="font-semibold text-ink">Dipakai di Episode:</span>
                {(() => {
                  const cached = usageCache[`prop:${selectedProp.id}`]
                  const rows = cached
                    ? cached.episodes
                    : Array.from(propUsageMap.get(selectedProp.id)?.episodes.entries() ?? []).map(([epId, count]) => {
                        const ep = episodes.find((e) => e.id === epId)
                        return { episodeId: epId, episodeNum: ep?.episodeNum ?? 0, title: ep?.title ?? 'Episode', count }
                      })
                  if (rows.length === 0) {
                    return <span className="text-muted">Belum dipakai di episode mana pun.</span>
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      {rows.map((row) => (
                        <button
                          key={row.episodeId}
                          type="button"
                          onClick={() => {
                            void switchEpisode(row.episodeId)
                            setActiveView('episode')
                          }}
                          className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-sand"
                        >
                          <span className="font-medium text-ink">
                            Ep {row.episodeNum || '?'}: {row.title}
                          </span>
                          <span className="text-muted">{row.count} shot ▸</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>

      {/* Merge Modal */}
      <MergeAssetModal
        open={mergeState.open}
        onClose={() => setMergeState((prev) => ({ ...prev, open: false }))}
        kind={mergeState.kind}
        sourceId={mergeState.sourceId}
        sourceName={mergeState.sourceName}
      />

      {/* Batch Sheet Modal */}
      <BatchEstimateSheetModal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        projectId={project?.id || ''}
        onStarted={() => {}}
      />

      {/* Candidate Review Modal */}
      <CandidateReviewModal
        open={reviewModalOpen}
        result={reviewResult}
        projectId={project?.id || ''}
        onClose={() => setReviewModalOpen(false)}
        onAccept={handleAcceptCandidates}
      />

      {/* Continuity Item Modal */}
      <Modal
        open={continuityModalOpen}
        onClose={() => setContinuityModalOpen(false)}
        title="Tambah Benang Cerita"
        subtitle="Catat petunjuk awal, rahasia, barang kunci, atau dinamika cerita antar-episode."
        width={520}
      >
        <div className="flex flex-col gap-4">
          <Field label="Nama Benang Cerita" hint="Petunjuk atau plot point yang ingin dilacak">
            <input
              value={newContName}
              onChange={(e) => setNewContName(e.target.value)}
              placeholder="Mis. Rahasia liontin giok merah / Utang darah keluarga"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kategori">
              <Select<ContinuityKind>
                label="Kategori"
                value={newContKind}
                onChange={setNewContKind}
                options={[
                  { value: 'foreshadow', label: 'Petunjuk Awal (Foreshadow)' },
                  { value: 'prop', label: 'Barang Kunci (Key Prop)' },
                  { value: 'rule', label: 'Aturan Dunia (World Rule)' },
                  { value: 'relationship', label: 'Dinamika Hubungan' }
                ]}
              />
            </Field>

            <Field label="Prioritas">
              <Select<ContinuityTier>
                label="Prioritas"
                value={newContTier}
                onChange={setNewContTier}
                options={[
                  { value: 'hot', label: 'Mendesak (Harus dibayar segera)' },
                  { value: 'cold', label: 'Jangka panjang (Slow-burn)' }
                ]}
              />
            </Field>
          </div>

          <Field label="Ditanam di Episode">
            <Select<string>
              label="Episode"
              value={newContPlantedEp || episode?.id || episodes[0]?.id || ''}
              onChange={setNewContPlantedEp}
              options={episodes.map((e) => ({
                value: e.id,
                label: `Episode ${e.episodeNum}: ${e.title}`
              }))}
            />
          </Field>

          <Field label="Detail / Catatan Cerita" hint="Jelaskan bagaimana unsur ini ditanam dan rencananya diselesaikan">
            <AutoTextarea
              value={newContDetail}
              onChange={(e) => setNewContDetail(e.target.value)}
              placeholder="Mis. Protagonis menemukan liontin tersembunyi di bawah bantal. Di episode selanjutnya, musuh utama mengenali liontin ini sebagai milik klan yang dibantai."
              minRows={3}
            />
          </Field>

          <div className="mt-2 flex items-center justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setContinuityModalOpen(false)}>
              Batal
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateContinuity}
              disabled={!newContName.trim()}
            >
              Simpan Benang Cerita
            </Button>
          </div>
        </div>
      </Modal>

      <SeriesGuidelinesModal open={guidelinesModalOpen} onClose={() => setGuidelinesModalOpen(false)} />
    </div>
  )
}
