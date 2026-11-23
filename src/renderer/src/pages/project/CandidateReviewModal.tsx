import { useState } from 'react'
import {
  Users,
  MapPin,
  Package,
  Shirt,
  CheckSquare,
  Square,
  Check
} from 'lucide-react'
import type {
  AcceptLorebookCandidatesInput,
  LorebookExtractionResult
} from '@shared/types'
import { Badge, Button, Modal, Segmented, cx } from '../../components/ui'

interface CandidateReviewModalProps {
  open: boolean
  result: LorebookExtractionResult | null
  projectId: string
  onClose: () => void
  onAccept: (input: AcceptLorebookCandidatesInput) => Promise<void>
}

type ReviewTab = 'characters' | 'derivatives' | 'locations' | 'props'

export function CandidateReviewModal({
  open,
  result,
  projectId,
  onClose,
  onAccept
}: CandidateReviewModalProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>('characters')
  const [submitting, setSubmitting] = useState(false)

  // Selection state per item ID (tempId or index)
  const [selectedChars, setSelectedChars] = useState<Set<string>>(() => new Set())
  const [selectedDerivs, setSelectedDerivs] = useState<Set<string>>(() => new Set())
  const [selectedLocs, setSelectedLocs] = useState<Set<string>>(() => new Set())
  const [selectedProps, setSelectedProps] = useState<Set<string>>(() => new Set())

  // Initialize all selected when result changes
  const [lastResult, setLastResult] = useState<LorebookExtractionResult | null>(null)
  if (result && result !== lastResult) {
    setLastResult(result)
    setActiveTab('characters')
    setSelectedChars(new Set(result.characters.map((c, i) => c.tempId || `char-${i}`)))
    setSelectedDerivs(new Set(result.derivatives.map((d, i) => d.tempId || `deriv-${i}`)))
    setSelectedLocs(new Set(result.locations.map((l, i) => l.tempId || `loc-${i}`)))
    setSelectedProps(new Set(result.props.map((p, i) => p.tempId || `prop-${i}`)))
  }

  const formatInteriorExterior = (val: string): string => {
    const up = val.trim().toUpperCase()
    if (up === 'INT') return 'Dalam ruangan'
    if (up === 'EXT') return 'Luar ruangan'
    if (up === 'INT/EXT' || up === 'EXT/INT') return 'Dalam & luar ruangan'
    return val
  }

  const characters = result?.characters || []
  const derivatives = result?.derivatives || []
  const locations = result?.locations || []
  const props = result?.props || []

  const toggleSelect = (set: Set<string>, setFn: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFn(next)
  }

  const toggleAllInCurrentTab = () => {
    if (activeTab === 'characters') {
      const allIds = characters.map((c, i) => c.tempId || `char-${i}`)
      if (selectedChars.size === allIds.length) setSelectedChars(new Set())
      else setSelectedChars(new Set(allIds))
    } else if (activeTab === 'derivatives') {
      const allIds = derivatives.map((d, i) => d.tempId || `deriv-${i}`)
      if (selectedDerivs.size === allIds.length) setSelectedDerivs(new Set())
      else setSelectedDerivs(new Set(allIds))
    } else if (activeTab === 'locations') {
      const allIds = locations.map((l, i) => l.tempId || `loc-${i}`)
      if (selectedLocs.size === allIds.length) setSelectedLocs(new Set())
      else setSelectedLocs(new Set(allIds))
    } else if (activeTab === 'props') {
      const allIds = props.map((p, i) => p.tempId || `prop-${i}`)
      if (selectedProps.size === allIds.length) setSelectedProps(new Set())
      else setSelectedProps(new Set(allIds))
    }
  }

  const totalSelected = selectedChars.size + selectedDerivs.size + selectedLocs.size + selectedProps.size

  const handleConfirm = async () => {
    if (!result) return
    setSubmitting(true)
    try {
      const acceptedCharacters = characters.filter((c, i) => selectedChars.has(c.tempId || `char-${i}`))
      const acceptedDerivatives = derivatives.filter((d, i) => selectedDerivs.has(d.tempId || `deriv-${i}`))
      const acceptedLocations = locations.filter((l, i) => selectedLocs.has(l.tempId || `loc-${i}`))
      const acceptedProps = props.filter((p, i) => selectedProps.has(p.tempId || `prop-${i}`))

      await onAccept({
        projectId,
        acceptedCharacters,
        acceptedDerivatives,
        acceptedLocations,
        acceptedProps
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hasil Ekstraksi Lorebook dari Cerita"
      subtitle="Tinjau karakter, varian pakaian, lokasi, dan prop yang terdeteksi secara otomatis dari cerita. Pilih yang ingin kamu masukkan ke Lorebook."
      width={720}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Check className="size-3.5" />}
            onClick={handleConfirm}
            loading={submitting}
            disabled={submitting || totalSelected === 0}
          >
            {submitting ? 'Menyimpan…' : `Terima ${totalSelected} aset terpilih`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <Segmented<ReviewTab>
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                id: 'characters',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    Karakter ({selectedChars.size}/{characters.length})
                  </span>
                )
              },
              {
                id: 'derivatives',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Shirt className="size-3.5" />
                    Kostum ({selectedDerivs.size}/{derivatives.length})
                  </span>
                )
              },
              {
                id: 'locations',
                label: (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3.5" />
                    Lokasi ({selectedLocs.size}/{locations.length})
                  </span>
                )
              },
              {
                id: 'props',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Package className="size-3.5" />
                    Prop ({selectedProps.size}/{props.length})
                  </span>
                )
              }
            ]}
          />

          <Button variant="ghost" size="sm" onClick={toggleAllInCurrentTab}>
            Pilih / Batal Semua di Tab Ini
          </Button>
        </div>

        {/* Content list */}
        <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
          {activeTab === 'characters' && (
            characters.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted">Tidak ada kandidat karakter baru yang terdeteksi.</p>
            ) : (
              characters.map((c, idx) => {
                const id = c.tempId || `char-${idx}`
                const isSelected = selectedChars.has(id)
                const v = c.profile?.visual
                const n = c.profile?.narrative
                return (
                  <div
                    key={id}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => toggleSelect(selectedChars, setSelectedChars, id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSelect(selectedChars, setSelectedChars, id)
                      }
                    }}
                    className={cx(
                      'cursor-pointer rounded-xl border p-4 transition-all',
                      isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'border-line bg-surface hover:border-line-2'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-accent-ink">
                          {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted" />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">{c.name}</span>
                            {c.voiceStyle && <Badge tone="info">{c.voiceStyle}</Badge>}
                            {n?.role && <Badge tone="warn">{n.role}</Badge>}
                          </div>
                          {c.aliases && c.aliases.length > 0 && (
                            <p className="text-[11px] text-muted">Alias: {c.aliases.join(', ')}</p>
                          )}
                        </div>
                      </div>
                      <Badge tone={isSelected ? 'ok' : 'draft'}>
                        {isSelected ? 'Diterima' : 'Abaikan'}
                      </Badge>
                    </div>

                    <p className="mt-2 text-xs text-ink/80 leading-relaxed">{c.description}</p>

                    {/* Bible Details */}
                    {(v || n) && (
                      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-sand/50 p-2.5 text-[11px]">
                        {v && (
                          <div className="space-y-1">
                            <span className="font-semibold text-ink/70">Profil Visual:</span>
                            {v.age && <div><span className="text-muted">Usia:</span> {v.age}</div>}
                            {v.gender && <div><span className="text-muted">Gender:</span> {v.gender}</div>}
                            {v.hair && <div><span className="text-muted">Rambut:</span> {v.hair}</div>}
                            {v.facialFeatures && <div><span className="text-muted">Wajah:</span> {v.facialFeatures}</div>}
                            {v.distinctiveFeatures && <div><span className="text-muted">Ciri Unik:</span> {v.distinctiveFeatures}</div>}
                            {v.defaultOutfit && <div><span className="text-muted">Pakaian Khas:</span> {v.defaultOutfit}</div>}
                          </div>
                        )}
                        {n && (
                          <div className="space-y-1">
                            <span className="font-semibold text-ink/70">Profil Naratif:</span>
                            {n.desire && <div><span className="text-muted">Motivasi:</span> {n.desire}</div>}
                            {n.secret && <div><span className="text-muted">Rahasia:</span> {n.secret}</div>}
                            {n.arc && <div><span className="text-muted">Arc:</span> {n.arc}</div>}
                            {n.speechPattern && <div><span className="text-muted">Pola Bicara:</span> {n.speechPattern}</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )
          )}

          {activeTab === 'derivatives' && (
            derivatives.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted">Tidak ada varian kostum yang terdeteksi.</p>
            ) : (
              derivatives.map((d, idx) => {
                const id = d.tempId || `deriv-${idx}`
                const isSelected = selectedDerivs.has(id)
                return (
                  <div
                    key={id}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => toggleSelect(selectedDerivs, setSelectedDerivs, id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSelect(selectedDerivs, setSelectedDerivs, id)
                      }
                    }}
                    className={cx(
                      'cursor-pointer rounded-xl border p-4 transition-all',
                      isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'border-line bg-surface hover:border-line-2'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-accent-ink">
                          {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted" />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">{d.name}</span>
                            <Badge tone="info">{d.characterName}</Badge>
                          </div>
                          {d.costumeKeyphrase && (
                            <p className="mt-0.5 text-[11px] font-medium text-accent-ink">
                              Frasa Kunci: &ldquo;{d.costumeKeyphrase}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge tone={isSelected ? 'ok' : 'draft'}>
                        {isSelected ? 'Diterima' : 'Abaikan'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-ink/80">{d.promptChange}</p>
                  </div>
                )
              })
            )
          )}

          {activeTab === 'locations' && (
            locations.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted">Tidak ada lokasi yang terdeteksi.</p>
            ) : (
              locations.map((l, idx) => {
                const id = l.tempId || `loc-${idx}`
                const isSelected = selectedLocs.has(id)
                const p = l.profile
                return (
                  <div
                    key={id}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => toggleSelect(selectedLocs, setSelectedLocs, id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSelect(selectedLocs, setSelectedLocs, id)
                      }
                    }}
                    className={cx(
                      'cursor-pointer rounded-xl border p-4 transition-all',
                      isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'border-line bg-surface hover:border-line-2'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-accent-ink">
                          {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted" />}
                        </span>
                        <div>
                          <span className="text-sm font-semibold text-ink">{l.name}</span>
                          {l.aliases && l.aliases.length > 0 && (
                            <p className="text-[11px] text-muted">Alias: {l.aliases.join(', ')}</p>
                          )}
                        </div>
                      </div>
                      <Badge tone={isSelected ? 'ok' : 'draft'}>
                        {isSelected ? 'Diterima' : 'Abaikan'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-ink/80">{l.description}</p>
                    {p && (
                      <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-lg bg-sand/50 p-2 text-[11px]">
                        {p.interiorExterior && <div><span className="text-muted">Tipe:</span> {formatInteriorExterior(p.interiorExterior)}</div>}
                        {p.timeOfDayLighting && <div><span className="text-muted">Cahaya:</span> {p.timeOfDayLighting}</div>}
                        {p.architecturalStyle && <div><span className="text-muted">Gaya:</span> {p.architecturalStyle}</div>}
                        {p.keyFeatures && <div><span className="text-muted">Fitur:</span> {p.keyFeatures}</div>}
                      </div>
                    )}
                  </div>
                )
              })
            )
          )}

          {activeTab === 'props' && (
            props.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted">Tidak ada prop yang terdeteksi.</p>
            ) : (
              props.map((pr, idx) => {
                const id = pr.tempId || `prop-${idx}`
                const isSelected = selectedProps.has(id)
                const p = pr.profile
                return (
                  <div
                    key={id}
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => toggleSelect(selectedProps, setSelectedProps, id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleSelect(selectedProps, setSelectedProps, id)
                      }
                    }}
                    className={cx(
                      'cursor-pointer rounded-xl border p-4 transition-all',
                      isSelected ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'border-line bg-surface hover:border-line-2'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-accent-ink">
                          {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4 text-muted" />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">{pr.name}</span>
                            {p?.category && <Badge tone="warn">{p.category}</Badge>}
                          </div>
                        </div>
                      </div>
                      <Badge tone={isSelected ? 'ok' : 'draft'}>
                        {isSelected ? 'Diterima' : 'Abaikan'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-ink/80">{pr.description}</p>
                    {p && (
                      <div className="mt-2.5 rounded-lg bg-sand/50 p-2 text-[11px] space-y-1">
                        {p.appearance && <div><span className="text-muted">Tampilan:</span> {p.appearance}</div>}
                        {p.significance && <div><span className="text-muted">Arti Penting:</span> {p.significance}</div>}
                      </div>
                    )}
                  </div>
                )
              })
            )
          )}
        </div>
      </div>
    </Modal>
  )
}
