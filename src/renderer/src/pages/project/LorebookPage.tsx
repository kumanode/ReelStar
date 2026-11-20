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
  Shirt
} from 'lucide-react'
import type { Character, Location, Prop, VoiceOption } from '@shared/types'
import { computeDerivativeSheetBasisHash } from '@shared/hash'
import { geminiVoiceGender } from '@shared/models'
import { Badge, Button, Field, IconButton, Menu, Segmented, Spinner, confirmDialog, cx, inputCls } from '../../components/ui'
import { AutoTextarea } from '../../components/AutoTextarea'
import { Select } from '../../components/Select'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { isRunning, jobFor, useProject } from '../../store/project'
import { MergeAssetModal } from './MergeAssetModal'

type LorebookTab = 'character' | 'location' | 'prop'

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
    switchEpisode,
    setActiveView,
    flush
  } = useProject()
  const { toast } = useApp()

  const [activeTab, setActiveTab] = useState<LorebookTab>('character')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Merge modal state
  const [mergeState, setMergeState] = useState<{
    open: boolean
    kind: 'character' | 'location' | 'prop'
    sourceId: string
    sourceName: string
  }>({ open: false, kind: 'character', sourceId: '', sourceName: '' })

  // Voices list for TTS
  const [voices, setVoices] = useState<VoiceOption[]>([])
  useEffect(() => {
    if (!project) return
    window.api.settings.voices(project.ttsProvider).then(setVoices).catch(() => {})
  }, [project?.ttsProvider])

  if (!project) return null

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
      {/* Top Bar: Tabs, Search, Add Button */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
        <div className="flex items-center gap-4">
          <Segmented<LorebookTab>
            value={activeTab}
            onChange={(tab) => {
              setActiveTab(tab)
              setSelectedId(null)
            }}
            options={[
              { id: 'character', label: <span className="flex items-center gap-1.5"><Users className="size-3.5" /> Karakter</span> },
              { id: 'location', label: <span className="flex items-center gap-1.5"><MapPin className="size-3.5" /> Lokasi</span> },
              { id: 'prop', label: <span className="flex items-center gap-1.5"><Package className="size-3.5" /> Prop</span> }
            ]}
            size="sm"
          />

          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Cari ${activeTab === 'character' ? 'karakter' : activeTab === 'location' ? 'lokasi' : 'prop'} atau alias...`}
              className="h-8 w-56 rounded-lg border border-line-2 bg-paper pl-8 pr-2.5 text-xs text-ink outline-none transition-colors focus:border-ink"
            />
          </div>
        </div>

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
                      ttsProvider: v ? project.ttsProvider ?? null : null
                    })
                  }
                  options={[
                    { value: '', label: `Bawaan narator (${project.ttsVoice || 'Utama'})` },
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
                      const baseSheet = selectedCharacter.sheetAssetId
                        ? assets[selectedCharacter.sheetAssetId]
                        : null
                      // Stale (§6.G): a generated variant sheet records the base sheet and prompt_change it was made from,
                      // so editing the costume change or remaking the base sheet both mark it. Uploaded sheets never go
                      // stale; sheets from before basis hashes fall back to "base sheet is newer".
                      const storedBasis = variantSheet?.meta?.basisHash
                      const isStale =
                        !!variantSheet &&
                        !variantSheet.meta?.uploaded &&
                        (typeof storedBasis === 'string'
                          ? storedBasis !==
                            computeDerivativeSheetBasisHash({
                              baseSheetAssetId: selectedCharacter.sheetAssetId,
                              promptChange: variant.promptChange,
                              imageModel: project?.imageModel ?? null
                            })
                          : !!baseSheet && baseSheet.createdAt > variantSheet.createdAt)

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
    </div>
  )
}
