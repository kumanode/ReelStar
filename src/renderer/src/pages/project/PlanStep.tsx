import { useState, useEffect, useMemo, useRef } from 'react'
import {
  FileText,
  Sparkles,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  AlertTriangle,
  AlertCircle,
  Clock,
  MapPin,
  MessageSquare,
  User,
  Package,
  Shirt,
  CheckCircle2,
  HelpCircle,
  Loader2
} from 'lucide-react'
import type {
  DraftShot,
  EpisodeScriptDraft,
  NewAssetProposal,
  ProjectBundle
} from '@shared/types'
import { Badge, Button, IconButton, confirmDialog, cx } from '../../components/ui'
import { Popover } from '../../components/Popover'
import { Select } from '../../components/Select'
import { AutoTextarea } from '../../components/AutoTextarea'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { errorText } from '../../lib/format'

const FRAMING_OPTIONS = [
  { value: 'close_up', label: 'Close Up (CU)' },
  { value: 'extreme_close_up', label: 'Extreme Close Up (ECU)' },
  { value: 'medium shot', label: 'Medium Shot (MS)' },
  { value: 'wide shot', label: 'Wide Shot (WS)' },
  { value: 'extreme wide shot', label: 'Extreme Wide (EWS)' }
]

const EMOTION_OPTIONS = [
  { value: 'netral', label: 'Netral' },
  { value: 'marah', label: 'Marah / Murka' },
  { value: 'dingin', label: 'Dingin / Sinis' },
  { value: 'terisak', label: 'Menangis / Terisak' },
  { value: 'panik', label: 'Panik / Terkejut' },
  { value: 'senyum licik', label: 'Senyum Licik' },
  { value: 'tegas', label: 'Tegas / Mengancam' },
  { value: 'lembut', label: 'Lembut / Tersipu' }
]

export function PlanStep() {
  const {
    project,
    episode,
    updateEpisode,
    characters,
    derivatives,
    locations,
    props,
    clips,
    load,
    setActiveTab,
    refreshLorebook
  } = useProject()
  const { toast } = useApp()

  const [draft, setDraft] = useState<EpisodeScriptDraft | null>(episode?.scriptDraft ?? null)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [planMessage, setPlanMessage] = useState<string | null>(null)
  const hookAnchor = useRef<HTMLButtonElement>(null)
  const [hookOpen, setHookOpen] = useState(false)
  const costumeAnchor = useRef<HTMLButtonElement>(null)
  const [costumeOpen, setCostumeOpen] = useState(false)

  // Keep local draft in sync if episode changes
  useEffect(() => {
    setDraft(episode?.scriptDraft ?? null)
  }, [episode?.id, episode?.scriptDraft])

  // Listen to background progress
  useEffect(() => {
    return window.api.on.storyProgress((progress) => {
      if (progress.projectId === project?.id) {
        setPlanMessage(progress.message)
      }
    })
  }, [project?.id])

  if (!project || !episode) return null

  // Sets of registered names (case-insensitive)
  const registeredCharNames = useMemo(() => {
    const set = new Set<string>()
    for (const c of characters) {
      set.add(c.name.trim().toLowerCase())
      for (const a of c.aliases ?? []) set.add(a.trim().toLowerCase())
    }
    return set
  }, [characters])

  const registeredLocNames = useMemo(() => {
    const set = new Set<string>()
    for (const l of locations) {
      set.add(l.name.trim().toLowerCase())
      for (const a of l.aliases ?? []) set.add(a.trim().toLowerCase())
    }
    return set
  }, [locations])

  const registeredPropNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of props) {
      set.add(p.name.trim().toLowerCase())
      for (const a of p.aliases ?? []) set.add(a.trim().toLowerCase())
    }
    return set
  }, [props])

  // Sets of proposed new asset names
  const proposedCharNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of draft?.newAssets ?? []) {
      if (p.kind === 'character' && p.action !== 'ignore') {
        set.add(p.name.trim().toLowerCase())
      }
    }
    return set
  }, [draft?.newAssets])

  const proposedLocNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of draft?.newAssets ?? []) {
      if (p.kind === 'location' && p.action !== 'ignore') {
        set.add(p.name.trim().toLowerCase())
      }
    }
    return set
  }, [draft?.newAssets])

  const proposedPropNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of draft?.newAssets ?? []) {
      if (p.kind === 'prop' && p.action !== 'ignore') {
        set.add(p.name.trim().toLowerCase())
      }
    }
    return set
  }, [draft?.newAssets])

  // Compute issues per shot
  const shotIssues = useMemo(() => {
    if (!draft?.shots) return []
    return draft.shots.map((s, idx) => {
      const issues: {
        type: 'unmapped_char' | 'unmapped_speaker' | 'unmapped_location' | 'unmapped_prop' | 'long_dialogue' | 'missing_speaker'
        message: string
        name?: string
        kind?: 'character' | 'location' | 'prop'
      }[] = []

      // Unmapped characters in shot
      for (const c of s.characters ?? []) {
        const q = c.trim().toLowerCase()
        if (q && !registeredCharNames.has(q) && !proposedCharNames.has(q)) {
          issues.push({
            type: 'unmapped_char',
            message: `Karakter "${c}" belum terdaftar di Lorebook atau usulan aset`,
            name: c,
            kind: 'character'
          })
        }
      }

      // Unmapped speaker
      if (s.speaker?.trim()) {
        const q = s.speaker.trim().toLowerCase()
        if (!registeredCharNames.has(q) && !proposedCharNames.has(q)) {
          issues.push({
            type: 'unmapped_speaker',
            message: `Pembicara "${s.speaker}" belum terdaftar di Lorebook atau usulan aset`,
            name: s.speaker,
            kind: 'character'
          })
        }
      }

      // Unmapped location
      if (s.location?.trim()) {
        const q = s.location.trim().toLowerCase()
        if (!registeredLocNames.has(q) && !proposedLocNames.has(q)) {
          issues.push({
            type: 'unmapped_location',
            message: `Lokasi "${s.location}" belum terdaftar di Lorebook atau usulan aset`,
            name: s.location,
            kind: 'location'
          })
        }
      }

      // Unmapped props
      for (const p of s.props ?? []) {
        const q = p.trim().toLowerCase()
        if (q && !registeredPropNames.has(q) && !proposedPropNames.has(q)) {
          issues.push({
            type: 'unmapped_prop',
            message: `Prop "${p}" belum terdaftar di Lorebook atau usulan aset`,
            name: p,
            kind: 'prop'
          })
        }
      }

      // Long dialogue (>20 words)
      if (s.text?.trim()) {
        const wordCount = s.text.trim().split(/\s+/).length
        if (wordCount > 20) {
          issues.push({
            type: 'long_dialogue',
            message: `Dialog panjang (${wordCount} kata). Disarankan bagi menjadi 2 shot untuk ritme vertical drama.`
          })
        }
        if (!s.speaker?.trim()) {
          issues.push({
            type: 'missing_speaker',
            message: 'Terdapat teks dialog namun nama pembicara belum ditentukan.'
          })
        }
      }

      return { shotIndex: idx, issues }
    })
  }, [draft?.shots, registeredCharNames, proposedCharNames, registeredLocNames, proposedLocNames, registeredPropNames, proposedPropNames])

  const totalUnmapped = useMemo(() => {
    return shotIssues.reduce((acc, curr) => {
      const unmapped = curr.issues.filter((i) => i.type.startsWith('unmapped_'))
      return acc + unmapped.length
    }, 0)
  }, [shotIssues])

  // Handlers for AI Script Planning
  const handlePlanScript = async () => {
    if (clips.length > 0) {
      const ok = await confirmDialog({
        title: 'Susun Ulang Rencana Naskah?',
        body: `Episode ${episode.episodeNum} sudah memiliki ${clips.length} klip. Menjalankan AI planner akan membuat draf naskah baru yang dapat kamu tinjau sebelum dikonfirmasi.`,
        confirm: 'Buat draf baru',
        danger: true
      })
      if (!ok) return
    }

    setIsPlanning(true)
    setPlanMessage(`Menyusun naskah shot untuk ${episode.title}...`)
    try {
      const newDraft = await window.api.story.planEpisodeScript(project.id, episode.id)
      setDraft(newDraft)
      await updateEpisode(episode.id, { scriptDraft: newDraft })
      toast('success', `Draf naskah (${newDraft.shots.length} shot) berhasil dibuat!`)
    } catch (err) {
      toast('error', `Gagal menyusun naskah: ${errorText(err)}`)
    } finally {
      setIsPlanning(false)
      setPlanMessage(null)
    }
  }

  // Handlers for Confirming Script
  const handleConfirmScript = async () => {
    if (!draft || !draft.shots.length) {
      toast('info', 'Draf naskah masih kosong.')
      return
    }

    if (totalUnmapped > 0) {
      toast('error', `Masih ada ${totalUnmapped} aset tak terdaftar yang belum diusulkan. Periksa peringatan merah pada shot.`)
      return
    }

    if (clips.length > 0) {
      const ok = await confirmDialog({
        title: 'Konfirmasi Rencana Naskah?',
        body: `Episode ini memiliki ${clips.length} klip lama. Mengonfirmasi rencana akan menggantikan klip lama dengan ${draft.shots.length} shot baru dan mendaftarkan aset baru ke Lorebook. Lanjutkan?`,
        confirm: 'Konfirmasi & Buat Klip',
        danger: true
      })
      if (!ok) return
    }

    setIsConfirming(true)
    try {
      const bundle: ProjectBundle = await window.api.story.confirmEpisodeScript(project.id, episode.id, draft)
      load(bundle)
      await refreshLorebook()
      toast('success', `Naskah Episode ${episode.episodeNum} berhasil dikonfirmasi!`)
      setActiveTab('storyboard')
    } catch (err) {
      toast('error', `Gagal mengonfirmasi naskah: ${errorText(err)}`)
    } finally {
      setIsConfirming(false)
    }
  }

  // Quick action: propose an unmapped entity to newAssets
  const handleProposeAsset = (kind: 'character' | 'location' | 'prop', name: string) => {
    if (!draft) return
    const existing = draft.newAssets.find((a) => a.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      toast('info', `"${name}" sudah ada dalam daftar usulan aset.`)
      return
    }
    const newProposal: NewAssetProposal = {
      kind,
      name,
      description: '',
      action: 'create',
      reason: 'Ditambahkan dari peringatan shot'
    }
    const updatedDraft: EpisodeScriptDraft = {
      ...draft,
      newAssets: [...draft.newAssets, newProposal]
    }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
    toast('info', `"${name}" ditambahkan ke usulan aset baru`)
  }

  // Inline Shot modifications
  const updateShot = (idx: number, patch: Partial<DraftShot>) => {
    if (!draft) return
    const newShots = [...draft.shots]
    newShots[idx] = { ...newShots[idx], ...patch }
    const updatedDraft = { ...draft, shots: newShots }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  const handleMoveShot = (idx: number, dir: -1 | 1) => {
    if (!draft) return
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= draft.shots.length) return
    const newShots = [...draft.shots]
    const [moved] = newShots.splice(idx, 1)
    newShots.splice(targetIdx, 0, moved)
    const updatedDraft = { ...draft, shots: newShots }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  const handleDeleteShot = (idx: number) => {
    if (!draft) return
    const newShots = draft.shots.filter((_, i) => i !== idx)
    const updatedDraft = { ...draft, shots: newShots }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  const handleAddShot = (afterIdx?: number) => {
    if (!draft) return
    const newShot: DraftShot = {
      title: `Shot ${(draft.shots.length + 1)}`,
      sourceExcerpt: '',
      visualAction: '',
      characters: characters[0] ? [characters[0].name] : [],
      costumes: {},
      location: locations[0]?.name ?? null,
      props: [],
      speaker: characters[0]?.name ?? null,
      text: '',
      emotion: 'netral',
      framing: 'medium shot',
      durationSec: 5
    }
    const newShots = [...draft.shots]
    if (typeof afterIdx === 'number') {
      newShots.splice(afterIdx + 1, 0, newShot)
    } else {
      newShots.push(newShot)
    }
    const updatedDraft = { ...draft, shots: newShots }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  // Proposal modifications
  const updateProposal = (idx: number, patch: Partial<NewAssetProposal>) => {
    if (!draft) return
    const newAssets = [...draft.newAssets]
    newAssets[idx] = { ...newAssets[idx], ...patch }
    const updatedDraft = { ...draft, newAssets }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  const handleDeleteProposal = (idx: number) => {
    if (!draft) return
    const newAssets = draft.newAssets.filter((_, i) => i !== idx)
    const updatedDraft = { ...draft, newAssets }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  const handleAddManualProposal = () => {
    if (!draft) return
    const newProposal: NewAssetProposal = {
      kind: 'character',
      name: `Karakter Baru ${draft.newAssets.length + 1}`,
      description: '',
      action: 'create',
      reason: 'Usulan manual pengguna'
    }
    const updatedDraft = { ...draft, newAssets: [...draft.newAssets, newProposal] }
    setDraft(updatedDraft)
    void updateEpisode(episode.id, { scriptDraft: updatedDraft })
  }

  const handleCreateEmptyDraft = () => {
    const emptyDraft: EpisodeScriptDraft = {
      shots: [
        {
          title: 'Shot 1',
          sourceExcerpt: episode.hook || '',
          visualAction: 'Adegan pembuka menampilkan hook dramatis',
          characters: characters[0] ? [characters[0].name] : [],
          costumes: {},
          location: locations[0]?.name ?? null,
          props: [],
          speaker: characters[0]?.name ?? null,
          text: 'Dialog atau ucapan pembuka',
          emotion: 'tegas',
          framing: 'close_up',
          durationSec: 5
        }
      ],
      newAssets: [],
      createdAt: Date.now()
    }
    setDraft(emptyDraft)
    void updateEpisode(episode.id, { scriptDraft: emptyDraft })
  }

  const totalDurationSec = (draft?.shots ?? []).reduce((acc, s) => acc + (s.durationSec || 5), 0)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paper">
      {/* Top Header Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="font-mono text-xs font-bold text-accent">EPISODE {episode.episodeNum}</span>
            <input
              type="text"
              value={episode.title}
              onChange={(e) => void updateEpisode(episode.id, { title: e.target.value })}
              className="block font-display text-lg font-bold text-ink outline-none transition-colors hover:text-accent focus:text-accent"
              placeholder="Judul episode..."
            />
          </div>

          <div className="hidden h-8 w-px bg-line md:block" />

          {/* Hook & Cliffhanger Preview Popover */}
          <button
            ref={hookAnchor}
            type="button"
            onClick={() => setHookOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-line-2 bg-paper px-2.5 py-1 text-xs text-ink-2 hover:border-ink hover:text-ink"
          >
            <Sparkles className="size-3.5 text-sun" />
            <span>Hook & Cliffhanger</span>
          </button>
          <Popover
            anchor={hookAnchor}
            open={hookOpen}
            onClose={() => setHookOpen(false)}
            width={320}
          >
            <div className="flex w-80 flex-col gap-3 p-3">
              <div>
                <label className="text-[11px] font-bold text-ink">Hook Pembuka (Detik 0-5)</label>
                <AutoTextarea
                  value={episode.hook ?? ''}
                  onChange={(e) => void updateEpisode(episode.id, { hook: e.target.value })}
                  placeholder="Momen dramatis di detik awal..."
                  minRows={2}
                  className="mt-1 w-full rounded-lg border border-line-2 bg-surface p-2 text-xs text-ink outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-ink">Cliffhanger Penutup</label>
                <AutoTextarea
                  value={episode.cliffhanger ?? ''}
                  onChange={(e) => void updateEpisode(episode.id, { cliffhanger: e.target.value })}
                  placeholder="Momen gantung yang bikin penasaran..."
                  minRows={2}
                  className="mt-1 w-full rounded-lg border border-line-2 bg-surface p-2 text-xs text-ink outline-none focus:border-ink"
                />
              </div>
            </div>
          </Popover>

          {/* Character Costumes Popover */}
          {characters.length > 0 && (
            <>
              <button
                ref={costumeAnchor}
                type="button"
                onClick={() => setCostumeOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-line-2 bg-paper px-2.5 py-1 text-xs text-ink-2 hover:border-ink hover:text-ink"
              >
                <Shirt className="size-3.5 text-accent" />
                <span>Kostum Karakter ({characters.length})</span>
              </button>
              <Popover
                anchor={costumeAnchor}
                open={costumeOpen}
                onClose={() => setCostumeOpen(false)}
                width={280}
              >
                <div className="flex w-72 flex-col gap-2 p-3">
                  <span className="text-xs font-bold text-ink">Kostum Default Episode Ini</span>
                  <p className="text-[11px] text-muted">Varian pakaian default yang dikenakan karakter di episode ini.</p>
                  <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pt-1">
                    {characters.map((c) => {
                      const cDerivs = derivatives.filter((d) => d.characterId === c.id)
                      return (
                        <div key={c.id} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 text-xs">
                          <span className="truncate font-medium text-ink">{c.name}</span>
                          <span className="text-[11px] text-muted">
                            {cDerivs.length ? `${cDerivs.length} varian tersedia` : 'Bawaan'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Popover>
            </>
          )}
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2">
          {isPlanning && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-dark">
              <Loader2 className="size-3.5 animate-spin" />
              <span>{planMessage || 'Sedang menyusun rencana...'}</span>
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            icon={isPlanning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-sun" />}
            disabled={isPlanning || isConfirming}
            onClick={() => void handlePlanScript()}
          >
            {draft ? 'Susun ulang rencana AI' : 'Buat rencana AI'}
          </Button>

          {draft && (
            <Button
              variant="primary"
              size="sm"
              icon={isConfirming ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
              disabled={isPlanning || isConfirming || totalUnmapped > 0}
              onClick={() => void handleConfirmScript()}
            >
              Konfirmasi ▸
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Column: Shot List or Hero Empty State */}
        <div className="scroll-thin flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
          {!draft ? (
            /* Empty Draft State */
            <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-6 py-12 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-dark shadow-sm">
                <FileText className="size-8" />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-xl font-bold text-ink">
                  Rencanakan Naskah Episode {episode.episodeNum}
                </h2>
                <p className="text-sm text-ink-2">
                  AI akan membagi naskah menjadi shot-by-shot dengan rasio shot-reverse-shot ~80%, maksimal 1 ucapan per shot, dan mendeteksi otomatis tokoh atau lokasi baru.
                </p>
              </div>

              {clips.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-line-2 bg-surface px-4 py-2 text-xs text-ink-2">
                  <Clock className="size-4 text-sun" />
                  <span>Episode ini saat ini memiliki {clips.length} klip di storyboard.</span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  variant="primary"
                  icon={isPlanning ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-sun" />}
                  loading={isPlanning}
                  onClick={() => void handlePlanScript()}
                >
                  Mulai Susun Rencana dengan AI
                </Button>
                <Button variant="secondary" onClick={handleCreateEmptyDraft}>
                  Tulis Draf Manual
                </Button>
                {clips.length > 0 && (
                  <Button variant="ghost" onClick={() => setActiveTab('storyboard')}>
                    Buka Storyboard
                  </Button>
                )}
              </div>
            </div>
          ) : (
            /* Active Draft: Shot by Shot Cards */
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
              {/* Draft Status & Warnings Summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="flex items-center gap-4 text-xs">
                  <span className="font-bold text-ink">{draft.shots.length} Shot</span>
                  <span className="text-muted">•</span>
                  <span className="flex items-center gap-1 text-ink-2">
                    <Clock className="size-3.5" /> Total ~{totalDurationSec} detik
                  </span>
                  <span className="text-muted">•</span>
                  <span className="text-muted">Target: {episode.durationSec}s</span>
                </div>

                {totalUnmapped > 0 ? (
                  <div className="flex items-center gap-1.5 rounded-lg bg-bad-soft px-2.5 py-1 text-xs font-semibold text-bad-ink">
                    <AlertCircle className="size-3.5" />
                    <span>{totalUnmapped} aset belum terdaftar (perlu ditangani sebelum konfirmasi)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-lg bg-ok-soft px-2.5 py-1 text-xs font-semibold text-ok-ink">
                    <CheckCircle2 className="size-3.5" />
                    <span>Semua aset terdaftar & siap dikonfirmasi</span>
                  </div>
                )}
              </div>

              {/* Shot Cards */}
              <div className="flex flex-col gap-4">
                {draft.shots.map((shot, idx) => {
                  const issues = shotIssues[idx]?.issues ?? []
                  return (
                    <div
                      key={idx}
                      className={cx(
                        'flex flex-col gap-3 rounded-2xl border bg-surface p-4 shadow-sm transition-all',
                        issues.some((i) => i.type.startsWith('unmapped_'))
                          ? 'border-bad-ink/40 bg-bad-soft/10'
                          : 'border-line hover:border-line-2'
                      )}
                    >
                      {/* Shot Top Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 items-center justify-center rounded-lg bg-ink font-mono text-xs font-bold text-paper">
                            {idx + 1}
                          </span>
                          <span className="font-display text-xs font-bold text-ink">
                            {shot.title || `Shot ${idx + 1}`}
                          </span>
                          <div className="w-36">
                            <Select
                              label="Framing shot"
                              value={shot.framing || 'medium shot'}
                              options={FRAMING_OPTIONS}
                              onChange={(val) => updateShot(idx, { framing: String(val) })}
                              size="sm"
                            />
                          </div>
                          <div className="flex items-center gap-1 text-xs text-ink-2">
                            <input
                              type="number"
                              min={2}
                              max={15}
                              value={shot.durationSec || 5}
                              onChange={(e) => updateShot(idx, { durationSec: Math.max(2, Math.min(15, Number(e.target.value) || 5)) })}
                              className="w-12 rounded border border-line-2 bg-paper px-1.5 py-0.5 text-center font-mono text-xs text-ink outline-none focus:border-ink"
                            />
                            <span>dtk</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <IconButton
                            label="Pindah ke atas"
                            size={28}
                            disabled={idx === 0}
                            onClick={() => handleMoveShot(idx, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label="Pindah ke bawah"
                            size={28}
                            disabled={idx === draft.shots.length - 1}
                            onClick={() => handleMoveShot(idx, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label="Hapus shot"
                            size={28}
                            onClick={() => handleDeleteShot(idx)}
                          >
                            <Trash2 className="size-3.5 text-bad-ink" />
                          </IconButton>
                        </div>
                      </div>

                      {/* Warnings if any */}
                      {issues.length > 0 && (
                        <div className="flex flex-col gap-1.5 rounded-xl bg-sand/40 p-2.5 text-xs">
                          {issues.map((issue, issueIdx) => (
                            <div key={issueIdx} className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-bad-ink">
                                <AlertTriangle className="size-3.5 shrink-0" />
                                <span>{issue.message}</span>
                              </div>
                              {issue.name && issue.kind && (
                                <button
                                  type="button"
                                  onClick={() => handleProposeAsset(issue.kind!, issue.name!)}
                                  className="shrink-0 rounded bg-accent-soft px-2 py-0.5 font-semibold text-accent-dark transition-colors hover:bg-accent hover:text-white"
                                >
                                  + Usulkan "{issue.name}"
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Visual Action Description */}
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-ink-2">Aksi Visual & Kamera</label>
                        <AutoTextarea
                          value={shot.visualAction}
                          onChange={(e) => updateShot(idx, { visualAction: e.target.value })}
                          placeholder="Deskripsikan gerak kamera dan aksi karakter di shot ini..."
                          minRows={2}
                          className="w-full rounded-xl border border-line bg-paper p-2.5 text-xs text-ink outline-none transition-colors focus:border-ink"
                        />
                      </div>

                      {/* Dialogue & Speaker Balloon */}
                      <div className="rounded-xl border border-line-2 bg-paper/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="size-3.5 text-accent" />
                            <span className="text-xs font-bold text-ink">Balon Dialog</span>
                            <div className="w-36">
                              <Select
                                label="Pembicara"
                                value={shot.speaker ?? ''}
                                options={[
                                  { value: '', label: '(Tanpa Dialog)' },
                                  ...characters.map((c) => ({ value: c.name, label: c.name })),
                                  ...draft.newAssets.filter((a) => a.kind === 'character').map((a) => ({ value: a.name, label: `${a.name} (Usulan)` }))
                                ]}
                                onChange={(val) => updateShot(idx, { speaker: String(val) || null })}
                                size="sm"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-muted">Emosi:</span>
                            <div className="w-32">
                              <Select
                                label="Emosi dialog"
                                value={shot.emotion || 'netral'}
                                options={EMOTION_OPTIONS}
                                onChange={(val) => updateShot(idx, { emotion: String(val) })}
                                size="sm"
                              />
                            </div>
                          </div>
                        </div>

                        <AutoTextarea
                          value={shot.text}
                          onChange={(e) => updateShot(idx, { text: e.target.value })}
                          placeholder="Ucapan karakter (maksimal 1 kalimat per shot)..."
                          minRows={1}
                          className="w-full rounded-lg border border-line bg-surface p-2 text-xs text-ink outline-none focus:border-ink"
                        />
                      </div>

                      {/* Entities: Characters, Location, Props */}
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                        {/* Location Picker */}
                        <div className="flex items-center gap-1.5">
                          <MapPin className="size-3.5 text-muted" />
                          <div className="w-36">
                            <Select
                              label="Lokasi shot"
                              value={shot.location ?? ''}
                              options={[
                                { value: '', label: '(Pilih Lokasi)' },
                                ...locations.map((l) => ({ value: l.name, label: l.name })),
                                ...draft.newAssets.filter((a) => a.kind === 'location').map((a) => ({ value: a.name, label: `${a.name} (Usulan)` }))
                              ]}
                              onChange={(val) => updateShot(idx, { location: String(val) || null })}
                              size="sm"
                            />
                          </div>
                        </div>

                        {/* Visible Character Tags */}
                        <div className="flex items-center gap-1.5">
                          <User className="size-3.5 text-muted" />
                          <span className="text-[11px] text-muted">Tampak:</span>
                          <div className="flex flex-wrap gap-1">
                            {shot.characters?.map((charName, cIdx) => (
                              <span
                                key={cIdx}
                                className="inline-flex items-center gap-1 rounded bg-sand px-1.5 py-0.5 text-[11px] font-medium text-ink"
                              >
                                {charName}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextChars = shot.characters.filter((_, i) => i !== cIdx)
                                    updateShot(idx, { characters: nextChars })
                                  }}
                                  className="text-muted hover:text-bad-ink"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                const avail = characters.find((c) => !shot.characters?.includes(c.name))
                                if (avail) {
                                  updateShot(idx, { characters: [...(shot.characters ?? []), avail.name] })
                                } else {
                                  toast('info', 'Semua karakter terdaftar sudah ada di shot ini.')
                                }
                              }}
                              className="rounded border border-line-2 bg-paper px-1 text-[11px] text-ink-2 hover:border-ink"
                            >
                              + Tokoh
                            </button>
                          </div>
                        </div>

                        {/* Props Tags */}
                        <div className="flex items-center gap-1.5">
                          <Package className="size-3.5 text-muted" />
                          <span className="text-[11px] text-muted">Prop:</span>
                          <div className="flex flex-wrap gap-1">
                            {shot.props?.map((propName, pIdx) => (
                              <span
                                key={pIdx}
                                className="inline-flex items-center gap-1 rounded bg-sand px-1.5 py-0.5 text-[11px] font-medium text-ink"
                              >
                                {propName}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextProps = shot.props.filter((_, i) => i !== pIdx)
                                    updateShot(idx, { props: nextProps })
                                  }}
                                  className="text-muted hover:text-bad-ink"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                const avail = props.find((p) => !shot.props?.includes(p.name))
                                if (avail) {
                                  updateShot(idx, { props: [...(shot.props ?? []), avail.name] })
                                } else {
                                  toast('info', 'Semua prop sudah terpilih atau belum ada prop terdaftar.')
                                }
                              }}
                              className="rounded border border-line-2 bg-paper px-1 text-[11px] text-ink-2 hover:border-ink"
                            >
                              + Prop
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Bottom Add Shot Button */}
                <div className="flex justify-center py-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus className="size-4" />}
                    onClick={() => handleAddShot()}
                  >
                    Tambah shot baru
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (320px): Proposed New Assets Panel */}
        <div className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h3 className="font-display text-sm font-bold text-ink">
                Usulan Aset Baru ({draft?.newAssets?.length ?? 0})
              </h3>
            </div>
            {draft && (
              <IconButton
                label="Tambah usulan manual"
                size={26}
                onClick={handleAddManualProposal}
              >
                <Plus className="size-3.5" />
              </IconButton>
            )}
          </div>

          <div className="scroll-thin flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {!draft || !draft.newAssets.length ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-xs text-muted">
                <HelpCircle className="size-8 text-line-2" />
                <span>Belum ada usulan aset baru di episode ini.</span>
                <span className="max-w-[200px] text-[11px]">
                  AI akan mendeteksi karakter, kostum, atau lokasi baru saat draf naskah disusun.
                </span>
              </div>
            ) : (
              draft.newAssets.map((asset, aIdx) => (
                <div
                  key={aIdx}
                  className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3 text-xs shadow-sm"
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        tone={
                          asset.kind === 'character'
                            ? 'ink'
                            : asset.kind === 'derivative'
                              ? 'info'
                              : asset.kind === 'location'
                                ? 'warn'
                                : 'draft'
                        }
                      >
                        {asset.kind === 'character'
                          ? 'Karakter'
                          : asset.kind === 'derivative'
                            ? 'Kostum'
                            : asset.kind === 'location'
                              ? 'Lokasi'
                              : 'Prop'}
                      </Badge>
                    </div>
                    <IconButton
                      label="Hapus usulan"
                      size={22}
                      onClick={() => handleDeleteProposal(aIdx)}
                    >
                      <Trash2 className="size-3 text-bad-ink" />
                    </IconButton>
                  </div>

                  <div>
                    <input
                      type="text"
                      value={asset.name}
                      onChange={(e) => updateProposal(aIdx, { name: e.target.value })}
                      placeholder="Nama aset..."
                      className="w-full rounded border border-line bg-surface px-2 py-1 font-bold text-ink outline-none focus:border-ink"
                    />
                  </div>

                  {asset.reason && (
                    <p className="text-[11px] text-muted italic">
                      Alasan: {asset.reason}
                    </p>
                  )}

                  <div className="flex flex-col gap-1 pt-1">
                    <label className="text-[10px] font-semibold text-muted">Aksi Konfirmasi</label>
                    <Select
                      label="Aksi aset"
                      value={asset.action}
                      options={[
                        { value: 'create', label: 'Daftarkan baru ke Lorebook' },
                        { value: 'merge', label: 'Gabungkan dengan aset terdaftar (Alias)' },
                        { value: 'derivative', label: 'Sebagai varian kostum karakter' },
                        { value: 'ignore', label: 'Abaikan / Jangan buat' }
                      ]}
                      onChange={(val) => updateProposal(aIdx, { action: val as NewAssetProposal['action'] })}
                      size="sm"
                    />
                  </div>

                  {/* Target picker for merge or derivative */}
                  {(asset.action === 'merge' || asset.action === 'derivative') && (
                    <div className="flex flex-col gap-1 pt-1">
                      <label className="text-[10px] font-semibold text-muted">
                        {asset.action === 'merge' ? 'Target Aset Penggabungan:' : 'Karakter Induk:'}
                      </label>
                      <Select
                        label="Pilih target"
                        value={asset.target ?? ''}
                        options={
                          asset.action === 'derivative' || asset.kind === 'character'
                            ? characters.map((c) => ({ value: c.id, label: c.name }))
                            : asset.kind === 'location'
                              ? locations.map((l) => ({ value: l.id, label: l.name }))
                              : props.map((p) => ({ value: p.id, label: p.name }))
                        }
                        onChange={(val) => updateProposal(aIdx, { target: String(val) })}
                        size="sm"
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
