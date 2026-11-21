import { useState, useMemo, useEffect } from 'react'
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
  AlertTriangle
} from 'lucide-react'
import type {
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
import { geminiVoiceGender } from '@shared/models'
import { Badge, Button, Field, IconButton, Menu, Modal, Segmented, Spinner, confirmDialog, cx, inputCls } from '../../components/ui'
import { AutoTextarea } from '../../components/AutoTextarea'
import { Select } from '../../components/Select'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useTtsProject } from '../../lib/useTtsProject'
import { isRunning, jobFor, useProject } from '../../store/project'
import { MergeAssetModal } from './MergeAssetModal'
import { BatchEstimateSheetModal } from './BatchEstimateSheetModal'
import { CandidateReviewModal } from './CandidateReviewModal'

type LorebookTab = 'character' | 'location' | 'prop' | 'lock' | 'continuity'

export function LorebookPage() {
  const {
    project,
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
    refreshLorebook
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

  const [activeTab, setActiveTab] = useState<LorebookTab>('character')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newLockLabel, setNewLockLabel] = useState('')
  const [newLockText, setNewLockText] = useState('')
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
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

  const handleCreateContinuity = async () => {
    if (!newContName.trim()) {
      toast('info', 'Nama benang cerita tidak boleh kosong.')
      return
    }
    const epId = newContPlantedEp || episodes[0]?.id || ''
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
        payoffEpisodeId: newStatus === 'paid' ? (payoffEpId ?? episodes[0]?.id ?? null) : null
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

  const handleExtractLorebook = async () => {
    if (!project) return
    const hasStory =
      !!project.sourceText?.trim() ||
      !!project.synopsis?.trim() ||
      episodes.some((e) => e.summary.trim() || e.hook?.trim() || e.sourceText?.trim() || e.scriptDraft?.shots?.length)
    if (!hasStory) {
      toast('info', 'Teks cerita atau ringkasan episode masih kosong. Isi dulu di Episode Hub sebelum ekstraksi.')
      return
    }
    setExtracting(true)
    try {
      await flush()
      const result = await window.api.lorebook.extract(project.id)
      const count = result.characters.length + result.derivatives.length + result.locations.length + result.props.length
      if (count === 0) {
        toast('info', 'Tidak ada entitas baru yang terdeteksi dari cerita.')
        return
      }
      setReviewResult(result)
      setReviewModalOpen(true)
    } catch (err) {
      toast('error', `Gagal mengekstrak Lorebook: ${errorText(err)}`)
    } finally {
      setExtracting(false)
    }
  }

  // Triggered when the creator clicks "Lanjut ke Lorebook" from Episode Hub so AI immediately extracts entities.
  useEffect(() => {
    if (!pendingLorebookExtract || !project || extracting) return
    consumeLorebookExtract()
    void handleExtractLorebook()
  }, [pendingLorebookExtract, project?.id])

  const handleAcceptCandidates = async (input: AcceptLorebookCandidatesInput) => {
    try {
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

  const hasSelection =
    (activeTab === 'character' && !!selectedCharacter) ||
    (activeTab === 'location' && !!selectedLocation) ||
    (activeTab === 'prop' && !!selectedProp)

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
    const nextNum = locations.length + 1
    const loc = await addLocation({
      name: `Lokasi ${nextNum}`,
      description: ''
    })
    setSelectedId(loc.id)
  }

  const handleAddProp = async () => {
    const nextNum = props.length + 1
    const pr = await addProp({
      name: `Prop ${nextNum}`,
      description: ''
    })
    setSelectedId(pr.id)
  }

  // Deletion handlers with impact warning
  const handleDeleteCharacter = async (char: Character) => {
    const usage = characterUsageMap.get(char.id)
    const usedCount = usage?.total ?? 0
    const ok = await confirmDialog({
      title: `Hapus karakter "${char.name}"?`,
      body:
        usedCount > 0
          ? `Karakter ini masih dirujuk di ${usedCount} shot pada ${usage?.episodes.size} episode. Rujukan tidak akan ditulis ulang; klip yang merujuk karakter ini akan terblokir saat generate. Kamu bisa menggabungkannya ke karakter lain sebagai alternatif.`
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
    const usage = locationUsageMap.get(loc.id)
    const usedCount = usage?.total ?? 0
    const ok = await confirmDialog({
      title: `Hapus lokasi "${loc.name}"?`,
      body:
        usedCount > 0
          ? `Lokasi ini masih dirujuk di ${usedCount} shot. Klip yang merujuk lokasi ini akan terblokir saat generate.`
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
    const usage = propUsageMap.get(pr.id)
    const usedCount = usage?.total ?? 0
    const ok = await confirmDialog({
      title: `Hapus prop "${pr.name}"?`,
      body:
        usedCount > 0
          ? `Prop ini masih dirujuk di ${usedCount} shot. Klip yang merujuk prop ini akan terblokir saat generate.`
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
      await window.api.generate.characterSheet(charId)
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
      await flush()
      await window.api.lorebook.generateLocationSheet(locId)
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
      await flush()
      await window.api.lorebook.generatePropSheet(propId)
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
    const charDerivs = derivatives.filter((d) => d.characterId === charId)
    const nextNum = charDerivs.length + 1
    const d = await addDerivative({
      characterId: charId,
      name: `Kostum ${nextNum}`,
      promptChange: 'Pakaian alternatif...'
    })
    toast('info', `Varian "${d.name}" ditambahkan`)
  }

  const handleGenerateDerivativeSheet = async (derivId: string) => {
    try {
      await flush()
      await window.api.lorebook.generateDerivativeSheet(derivId)
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
              { id: 'character', label: <span className="flex items-center gap-1.5"><Users className="size-3.5" /> Karakter</span> },
              { id: 'location', label: <span className="flex items-center gap-1.5"><MapPin className="size-3.5" /> Lokasi</span> },
              { id: 'prop', label: <span className="flex items-center gap-1.5"><Package className="size-3.5" /> Prop</span> },
              { id: 'lock', label: <span className="flex items-center gap-1.5"><Lock className="size-3.5" /> Kunci Serial</span> },
              { id: 'continuity', label: <span className="flex items-center gap-1.5"><GitBranch className="size-3.5" /> Kontinuitas</span> }
            ]}
            size="sm"
          />

          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={activeTab === 'lock' ? 'Cari kunci kontinuitas...' : activeTab === 'continuity' ? 'Cari benang cerita...' : `Cari ${activeTab === 'character' ? 'karakter' : activeTab === 'location' ? 'lokasi' : 'prop'} atau alias...`}
              className="h-8 w-56 rounded-lg border border-line-2 bg-paper pl-8 pr-2.5 text-xs text-ink outline-none transition-colors focus:border-ink"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab !== 'lock' && activeTab !== 'continuity' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={extracting}
                icon={<Sparkles className="size-3.5 text-accent" />}
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

              <Button
                variant="secondary"
                size="sm"
                icon={<Sparkles className="size-3.5" />}
                onClick={() => setBatchModalOpen(true)}
              >
                Buat semua lembar
              </Button>
            </>
          )}

          {activeTab === 'continuity' && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => setContinuityModalOpen(true)}
            >
              Tambah Benang Cerita
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowRight className="size-3.5" />}
            onClick={() => {
              // Open the first episode still waiting for its script, so the creator lands where the next step is.
              const next = episodes.find((e) => e.status === 'draft' || e.status === 'planned') ?? episodes[0]
              if (next) {
                void switchEpisode(next.id)
                setActiveView('episode')
                setProjectActiveTab('plan')
              } else {
                setActiveView('hub')
              }
            }}
          >
            Lanjut ke Naskah
          </Button>

          {activeTab !== 'lock' && activeTab !== 'continuity' && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                if (activeTab === 'character') handleAddCharacter()
                else if (activeTab === 'location') handleAddLocation()
                else handleAddProp()
              }}
            >
              {activeTab === 'character' ? 'Tambah Karakter' : activeTab === 'location' ? 'Tambah Lokasi' : 'Tambah Prop'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area: Split View (Grid on Left, Details on Right) */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Card Grid */}
        <div className="scroll-thin flex-1 overflow-y-auto p-6">
          {/* Characters Tab */}
          {activeTab === 'character' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredCharacters.map((char) => {
                const sheet = char.sheetAssetId ? assets[char.sheetAssetId] : null
                const isSelected = selectedId === char.id
                const charDerivs = derivatives.filter((d) => d.characterId === char.id)
                const usage = characterUsageMap.get(char.id)
                const usedInEps = usage?.episodes.size ?? 0

                return (
                  <div
                    key={char.id}
                    onClick={() => setSelectedId(char.id)}
                    className={cx(
                      'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface transition-all',
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
                          <Badge tone="warn" className="text-[10px]">
                            Basi
                          </Badge>
                        )}
                        <Menu
                          trigger={(open) => (
                            <button
                              type="button"
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
                            aka {char.aliases[0]}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <span className="rounded bg-sand px-1.5 py-0.5 font-medium">
                          {charDerivs.length} varian
                        </span>
                        <span className="rounded bg-sand px-1.5 py-0.5 font-medium">
                          {usedInEps} episode ({usage?.total ?? 0} shot)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Locations Tab */}
          {activeTab === 'location' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredLocations.map((loc) => {
                const sheet = loc.sheetAssetId ? assets[loc.sheetAssetId] : null
                const isSelected = selectedId === loc.id
                const usage = locationUsageMap.get(loc.id)

                return (
                  <div
                    key={loc.id}
                    onClick={() => setSelectedId(loc.id)}
                    className={cx(
                      'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface transition-all',
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
                          <Badge tone="warn" className="text-[10px]">
                            Basi
                          </Badge>
                        )}
                        <Menu
                          trigger={(open) => (
                            <button
                              type="button"
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
                          {usage?.episodes.size ?? 0} episode ({usage?.total ?? 0} shot)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Props Tab */}
          {activeTab === 'prop' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredProps.map((pr) => {
                const sheet = pr.sheetAssetId ? assets[pr.sheetAssetId] : null
                const isSelected = selectedId === pr.id
                const usage = propUsageMap.get(pr.id)

                return (
                  <div
                    key={pr.id}
                    onClick={() => setSelectedId(pr.id)}
                    className={cx(
                      'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-surface transition-all',
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
                          <Badge tone="warn" className="text-[10px]">
                            Basi
                          </Badge>
                        )}
                        <Menu
                          trigger={(open) => (
                            <button
                              type="button"
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
                          {usage?.episodes.size ?? 0} episode ({usage?.total ?? 0} shot)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Series Lock Words Tab */}
          {activeTab === 'lock' && (
            <div className="flex max-w-4xl flex-col gap-6">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-ink">
                      Kunci Kontinuitas Serial (Lock Words)
                    </h3>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      Frasa identitas yang ditempel <strong>apa adanya (verbatim)</strong> ke setiap prompt gambar dan video agar konsistensi visual tokoh, kostum, lokasi, dan prop terjaga di seluruh episode. Frasa otomatis bisa dinonaktifkan, dan frasa kustom manual bisa ditambahkan.
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
                      onChange={(e) => setNewLockLabel(e.target.value)}
                      placeholder="Label (mis. Tahi lalat bawah mata kiri)"
                      className="h-8 rounded-lg border border-line-2 bg-surface px-3 text-xs text-ink outline-none focus:border-ink"
                    />
                    <input
                      value={newLockText}
                      onChange={(e) => setNewLockText(e.target.value)}
                      placeholder="Teks Verbatim (mis. Small dark beauty mark below left eye)"
                      className="h-8 rounded-lg border border-line-2 bg-surface px-3 text-xs text-ink outline-none focus:border-ink sm:col-span-2"
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
                          checked={lock.enabled}
                          onChange={() => handleToggleLock(lock.id)}
                          className="mt-0.5 size-4 rounded border-line text-ink focus:ring-0"
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-xs font-bold">{lock.label}</span>
                            <span className="rounded bg-sand px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
                              {lock.source}
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

          {/* Continuity Items Tab */}
          {activeTab === 'continuity' && (
            <div className="flex max-w-4xl flex-col gap-6">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-display text-base font-bold text-ink">
                      Benang Cerita & Kontinuitas Antar-Episode
                    </h3>
                    <p className="mt-1 text-xs text-muted leading-relaxed">
                      Lacak petunjuk awal (foreshadow), barang kunci (prop), aturan dunia, dan dinamika hubungan yang ditanam di episode tertentu agar dibayar dan diselesaikan tepat waktu tanpa ada plot hole.
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
                        : 'Catat petunjuk awal atau rahasia cerita yang ditanam agar Script Doctor mengingatkanmu membayarnya.'}
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
                            ? 'border-amber-500/40 bg-amber-500/5'
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
                                  <span className="flex items-center gap-1 font-semibold text-bad">
                                    <Flame className="size-3" /> HOT
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-muted">
                                    <Clock className="size-3" /> COLD
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
                                <span className={isHotAlert ? 'font-semibold text-amber-600' : ''}>
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
                              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600">
                                <AlertTriangle className="size-3.5 shrink-0" />
                                <span>
                                  Perhatian: Benang cerita HOT ini sudah terbuka lebih dari 3 episode tanpa dibayar!
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
                                  icon={<CheckCircle2 className="size-3.5 text-good" />}
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
          {activeTab === 'character' && selectedCharacter && (
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
                  {isRunning(jobFor(jobs, 'sheet', { characterId: selectedCharacter.id })) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper/80 backdrop-blur-[2px]">
                      <Spinner className="size-6 text-accent" />
                      <span className="text-xs font-semibold text-ink">Memproses lembar karakter…</span>
                    </div>
                  )}
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
              <Field label="Suara TTS Khusus" hint="Digunakan saat mode audio narator atau dialog TTS aktif.">
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
                    { value: '', label: `Bawaan narator (${ttsProject?.ttsVoice || 'Utama'})` },
                    ...voices.map((v) => {
                      const gen = geminiVoiceGender(v.id)
                      const genTag = gen === 'female' ? 'Perempuan' : gen === 'male' ? 'Laki-laki' : ''
                      return {
                        value: v.id,
                        label: genTag ? `${v.name} (${genTag})` : v.name,
                        hint: v.description || undefined
                      }
                    })
                  ]}
                />
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
                    className="h-6 w-36 rounded border border-line-2 bg-paper px-2 text-xs text-ink outline-none focus:border-ink"
                  />
                </div>
              </div>

              {/* Character Bible (Visual & Narrative Profiles) */}
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-display text-xs font-bold text-ink">Character Bible (Profil Mendalam)</span>
                  <Badge tone="info" className="text-[10px]">
                    Konsistensi Shot & Prompt
                  </Badge>
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

                  <Field label="Pakaian Bawaan / Khas" className="text-[11px]">
                    <input
                      value={selectedCharacter.profile?.visual?.defaultOutfit ?? ''}
                      onChange={(e) => {
                        const v = { ...(selectedCharacter.profile?.visual ?? {}), defaultOutfit: e.target.value }
                        updateCharacter(selectedCharacter.id, {
                          profile: { ...(selectedCharacter.profile ?? {}), visual: v }
                        })
                      }}
                      placeholder="Contoh: Jas abu-abu gelap potongan modern"
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
                              className="font-bold text-ink bg-transparent border-b border-transparent hover:border-line focus:border-ink outline-none transition-colors"
                            />
                            <div className="flex items-center gap-1">
                              {isStale && (
                                <Badge tone="warn" className="text-[11px]">
                                  Basi
                                </Badge>
                              )}
                              <button
                                type="button"
                                onClick={() => void removeDerivative(variant.id)}
                                className="rounded p-1 text-muted transition-colors hover:bg-bad-soft hover:text-bad-ink"
                                title="Hapus varian kostum"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-semibold text-accent">Frasa Kunci Kostum</label>
                            <input
                              defaultValue={variant.costumeKeyphrase ?? ''}
                              onBlur={(e) => void updateDerivative(variant.id, { costumeKeyphrase: e.target.value })}
                              placeholder="Misal: gaun merah pesta malam, setelan jas hitam"
                              className="w-full rounded-lg border border-line-2/70 bg-surface px-2.5 py-1 text-xs text-ink outline-none transition-colors focus:border-ink"
                            />
                          </div>

                          <AutoTextarea
                            defaultValue={variant.promptChange}
                            onBlur={(e) => void updateDerivative(variant.id, { promptChange: e.target.value })}
                            placeholder="Deskripsi perubahan pakaian atau gaya..."
                            minRows={1}
                            maxHeight={120}
                            className="w-full rounded-lg border border-line-2/70 bg-surface p-2 text-xs text-ink outline-none transition-colors focus:border-ink"
                          />

                          <div className="flex items-center gap-2 pt-1">
                            {variantSheet ? (
                              <img
                                src={variantSheet.url}
                                alt={variant.name}
                                className="size-10 rounded-lg border border-line bg-surface object-contain"
                              />
                            ) : (
                              <div className="flex size-10 items-center justify-center rounded-lg border border-dashed border-line-2 bg-surface text-muted">
                                <Shirt className="size-4" />
                              </div>
                            )}

                            <div className="flex flex-1 items-center gap-1.5">
                              <Button
                                variant="secondary"
                                size="sm"
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
                  const usage = characterUsageMap.get(selectedCharacter.id)
                  if (!usage || usage.total === 0) {
                    return <span className="text-muted">Belum dipakai di episode mana pun.</span>
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      {Array.from(usage.episodes.entries()).map(([epId, count]) => {
                        const ep = episodes.find((e) => e.id === epId)
                        return (
                          <button
                            key={epId}
                            type="button"
                            onClick={() => {
                              void switchEpisode(epId)
                              setActiveView('episode')
                            }}
                            className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-sand"
                          >
                            <span className="font-medium text-ink">
                              Ep {ep?.episodeNum ?? '?'}: {ep?.title ?? 'Episode'}
                            </span>
                            <span className="text-muted">{count} shot ▸</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Detail Panel for Location */}
          {activeTab === 'location' && selectedLocation && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-display text-base font-bold text-ink">Detail Lokasi</h3>
                <IconButton label="Tutup detail" onClick={() => setSelectedId(null)} size={28}>
                  <X className="size-4" />
                </IconButton>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-muted">Lembar Referensi Lingkungan</span>
                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-line bg-paper">
                  {selectedLocation.sheetAssetId && assets[selectedLocation.sheetAssetId] ? (
                    <img
                      src={assets[selectedLocation.sheetAssetId].url}
                      alt={selectedLocation.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted">
                      <MapPin className="size-8 text-muted/60" />
                      <span>Belum ada lembar pemandangan</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
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

              <Field label="Nama Lokasi">
                <input
                  value={selectedLocation.name}
                  onChange={(e) => updateLocation(selectedLocation.id, { name: e.target.value })}
                  className={cx(inputCls, 'h-10 text-sm')}
                />
              </Field>

              <Field label="Deskripsi Suasana & Lingkungan">
                <AutoTextarea
                  value={selectedLocation.description}
                  onChange={(e) => updateLocation(selectedLocation.id, { description: e.target.value })}
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
                    className="h-6 w-36 rounded border border-line-2 bg-paper px-2 text-xs text-ink outline-none focus:border-ink"
                  />
                </div>
              </div>

              {/* Location Profile */}
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3.5">
                <span className="font-display text-xs font-bold text-ink">Profil Lingkungan Lokasi</span>
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
                    value={selectedLocation.profile?.timeOfDayLighting ?? ''}
                    onChange={(e) => {
                      updateLocation(selectedLocation.id, {
                        profile: { ...(selectedLocation.profile ?? {}), timeOfDayLighting: e.target.value }
                      })
                    }}
                    placeholder="Contoh: Malam hari temaram, lampu neon basah"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Gaya Arsitektur / Desain" className="text-[11px]">
                  <input
                    value={selectedLocation.profile?.architecturalStyle ?? ''}
                    onChange={(e) => {
                      updateLocation(selectedLocation.id, {
                        profile: { ...(selectedLocation.profile ?? {}), architecturalStyle: e.target.value }
                      })
                    }}
                    placeholder="Contoh: Modern minimalis mewah, lantai marmer"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Fitur Utama / Landmark Penting" className="text-[11px]">
                  <input
                    value={selectedLocation.profile?.keyFeatures ?? ''}
                    onChange={(e) => {
                      updateLocation(selectedLocation.id, {
                        profile: { ...(selectedLocation.profile ?? {}), keyFeatures: e.target.value }
                      })
                    }}
                    placeholder="Contoh: Jendela kaca besar menghadap gedung pencakar langit"
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>
              </div>

              {/* Usage List */}
              <div className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
                <span className="font-semibold text-ink">Dipakai di Episode:</span>
                {(() => {
                  const usage = locationUsageMap.get(selectedLocation.id)
                  if (!usage || usage.total === 0) {
                    return <span className="text-muted">Belum dipakai di episode mana pun.</span>
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      {Array.from(usage.episodes.entries()).map(([epId, count]) => {
                        const ep = episodes.find((e) => e.id === epId)
                        return (
                          <button
                            key={epId}
                            type="button"
                            onClick={() => {
                              void switchEpisode(epId)
                              setActiveView('episode')
                            }}
                            className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-sand"
                          >
                            <span className="font-medium text-ink">
                              Ep {ep?.episodeNum ?? '?'}: {ep?.title ?? 'Episode'}
                            </span>
                            <span className="text-muted">{count} shot ▸</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Detail Panel for Prop */}
          {activeTab === 'prop' && selectedProp && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="font-display text-base font-bold text-ink">Detail Prop</h3>
                <IconButton label="Tutup detail" onClick={() => setSelectedId(null)} size={28}>
                  <X className="size-4" />
                </IconButton>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-muted">Lembar Referensi Prop</span>
                <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-paper">
                  {selectedProp.sheetAssetId && assets[selectedProp.sheetAssetId] ? (
                    <img
                      src={assets[selectedProp.sheetAssetId].url}
                      alt={selectedProp.name}
                      className="size-full object-contain"
                    />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-xs text-muted">
                      <Package className="size-8 text-muted/60" />
                      <span>Belum ada lembar prop</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
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

              <Field label="Nama Prop">
                <input
                  value={selectedProp.name}
                  onChange={(e) => updateProp(selectedProp.id, { name: e.target.value })}
                  className={cx(inputCls, 'h-10 text-sm')}
                />
              </Field>

              <Field label="Deskripsi Bentuk & Bahan">
                <AutoTextarea
                  value={selectedProp.description}
                  onChange={(e) => updateProp(selectedProp.id, { description: e.target.value })}
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
                    className="h-6 w-36 rounded border border-line-2 bg-paper px-2 text-xs text-ink outline-none focus:border-ink"
                  />
                </div>
              </div>

              {/* Prop Profile */}
              <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper/60 p-3.5">
                <span className="font-display text-xs font-bold text-ink">Profil Prop & Benda</span>
                <Field label="Kategori Prop" className="text-[11px]">
                  <input
                    value={selectedProp.profile?.category ?? ''}
                    onChange={(e) => {
                      updateProp(selectedProp.id, {
                        profile: { ...(selectedProp.profile ?? {}), category: e.target.value }
                      })
                    }}
                    placeholder="Senjata, Dokumen, Perhiasan, Kendaraan, Gadget..."
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Tampilan Fisik Detail" className="text-[11px]">
                  <input
                    value={selectedProp.profile?.appearance ?? ''}
                    onChange={(e) => {
                      updateProp(selectedProp.id, {
                        profile: { ...(selectedProp.profile ?? {}), appearance: e.target.value }
                      })
                    }}
                    placeholder="Bentuk, material, warna dominan, keausan..."
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>

                <Field label="Arti Penting / Fungsi Cerita" className="text-[11px]">
                  <input
                    value={selectedProp.profile?.significance ?? ''}
                    onChange={(e) => {
                      updateProp(selectedProp.id, {
                        profile: { ...(selectedProp.profile ?? {}), significance: e.target.value }
                      })
                    }}
                    placeholder="Kunci warisan keluarga, bukti pembunuhan..."
                    className={cx(inputCls, 'h-8 text-xs')}
                  />
                </Field>
              </div>

              {/* Usage List */}
              <div className="flex flex-col gap-2 border-t border-line pt-4 text-xs">
                <span className="font-semibold text-ink">Dipakai di Episode:</span>
                {(() => {
                  const usage = propUsageMap.get(selectedProp.id)
                  if (!usage || usage.total === 0) {
                    return <span className="text-muted">Belum dipakai di episode mana pun.</span>
                  }
                  return (
                    <div className="flex flex-col gap-1">
                      {Array.from(usage.episodes.entries()).map(([epId, count]) => {
                        const ep = episodes.find((e) => e.id === epId)
                        return (
                          <button
                            key={epId}
                            type="button"
                            onClick={() => {
                              void switchEpisode(epId)
                              setActiveView('episode')
                            }}
                            className="flex items-center justify-between rounded-lg p-2 text-left hover:bg-sand"
                          >
                            <span className="font-medium text-ink">
                              Ep {ep?.episodeNum ?? '?'}: {ep?.title ?? 'Episode'}
                            </span>
                            <span className="text-muted">{count} shot ▸</span>
                          </button>
                        )
                      })}
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
                  { value: 'hot', label: 'HOT (Harus dibayar segera)' },
                  { value: 'cold', label: 'COLD (Slow-burn / Jangka panjang)' }
                ]}
              />
            </Field>
          </div>

          <Field label="Ditanam di Episode">
            <Select<string>
              label="Episode"
              value={newContPlantedEp || episodes[0]?.id || ''}
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
    </div>
  )
}
