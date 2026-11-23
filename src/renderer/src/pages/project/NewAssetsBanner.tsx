import { useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Sparkles, X } from 'lucide-react'
import type {
  Character,
  CharacterDerivative,
  EpisodeScriptDraft,
  Location,
  NewAssetProposal,
  Prop
} from '@shared/types'
import { Badge, Button, Modal, cx } from '../../components/ui'
import { Select } from '../../components/Select'

interface NewAssetsBannerProps {
  episodeNum: number
  draft: EpisodeScriptDraft
  characters: Character[]
  derivatives?: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  blockingCount: number
  confirming: boolean
  writingPrompts: boolean
  onUpdateProposal: (index: number, patch: Partial<NewAssetProposal>) => void
  onConfirm: () => void
  onDiscardDraft?: () => void
}

const KIND_LABEL: Record<NewAssetProposal['kind'], string> = {
  character: 'Karakter',
  derivative: 'Varian kostum',
  location: 'Lokasi',
  prop: 'Prop'
}

const ACTION_OPTIONS: { value: NewAssetProposal['action']; label: string }[] = [
  { value: 'create', label: 'Buat aset baru' },
  { value: 'merge', label: 'Gabung ke aset lama' },
  { value: 'derivative', label: 'Jadikan varian kostum' },
  { value: 'ignore', label: 'Abaikan' }
]

/**
 * Inline approval strip at the top of Tab Produksi for a pending EpisodeScriptDraft so creators can
 * review newly detected Lorebook assets and confirm → write visual prompts in one step.
 */
export function NewAssetsBanner({
  episodeNum,
  draft,
  characters,
  derivatives = [],
  locations,
  props,
  blockingCount,
  confirming,
  writingPrompts,
  onUpdateProposal,
  onConfirm,
  onDiscardDraft
}: NewAssetsBannerProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [expandedList, setExpandedList] = useState(false)
  const proposals = draft.newAssets ?? []
  const busy = confirming || writingPrompts
  const charNameById = new Map(characters.map((c) => [c.id, c.name]))

  const actionOptionsFor = (p: NewAssetProposal) =>
    p.kind === 'character' || p.kind === 'derivative'
      ? ACTION_OPTIONS
      : ACTION_OPTIONS.filter((o) => o.value !== 'derivative')

  const targetOptionsFor = (p: NewAssetProposal) => {
    if (p.kind === 'derivative') {
      if (p.action === 'merge') {
        return derivatives.map((d) => {
          const parentName = charNameById.get(d.characterId)
          return { value: d.id, label: parentName ? `${d.name} (${parentName})` : d.name }
        })
      }
      return characters.map((c) => ({ value: c.id, label: c.name }))
    }
    if (p.action === 'derivative' || p.kind === 'character') {
      return characters.map((c) => ({ value: c.id, label: c.name }))
    }
    if (p.kind === 'location') {
      return locations.map((l) => ({ value: l.id, label: l.name }))
    }
    return props.map((pr) => ({ value: pr.id, label: pr.name }))
  }

  return (
    <>
      <div className="rounded-2xl border-2 border-sun bg-surface p-4 shadow-ink">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm font-bold text-ink">
                  {proposals.length > 0
                    ? `Draf Ep ${episodeNum} siap · ${proposals.length} usulan aset baru`
                    : `Draf Ep ${episodeNum} siap (${draft.shots.length} shot)`}
                </h3>
                {blockingCount > 0 ? (
                  <Badge tone="bad">
                    <AlertCircle className="mr-1 inline size-3" />
                    {blockingCount} masalah perlu dibereskan
                  </Badge>
                ) : (
                  <Badge tone="ok">
                    <CheckCircle2 className="mr-1 inline size-3" />
                    Siap dikonfirmasi
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Konfirmasi akan mengubah draf menjadi shot aktif, mendaftarkan aset baru ke Lorebook, dan langsung menulis
                prompt visual otomatis.
              </p>

              {proposals.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {(expandedList ? proposals : proposals.slice(0, 6)).map((p, idx) => (
                    <span
                      key={`${p.kind}-${p.name}-${idx}`}
                      className={cx(
                        'inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold',
                        p.action === 'ignore' ? 'bg-draft text-muted line-through' : 'bg-sand text-ink'
                      )}
                    >
                      <span>{p.name}</span>
                      <span className="font-normal text-muted">({KIND_LABEL[p.kind]})</span>
                    </span>
                  ))}
                  {proposals.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setExpandedList((v) => !v)}
                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-ink-2 hover:text-ink"
                    >
                      {expandedList ? (
                        <>
                          Ringkas <ChevronUp className="size-3" />
                        </>
                      ) : (
                        <>
                          +{proposals.length - 6} lagi <ChevronDown className="size-3" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onDiscardDraft && (
              <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} disabled={busy} onClick={onDiscardDraft}>
                Tutup Draf
              </Button>
            )}
            {proposals.length > 0 && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setDetailOpen(true)}>
                Tinjau Aset ({proposals.length})
              </Button>
            )}
            <Button
              variant="accent"
              size="sm"
              loading={busy}
              disabled={blockingCount > 0}
              onClick={onConfirm}
              title={blockingCount > 0 ? `Selesaikan ${blockingCount} masalah dulu sebelum konfirmasi` : undefined}
            >
              {writingPrompts
                ? 'Menulis prompt visual…'
                : confirming
                  ? 'Mengonfirmasi…'
                  : 'Setujui & Susun Prompt'}
            </Button>
          </div>
        </div>
      </div>

      {/* Detailed asset proposal review modal */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={`Tinjau Usulan Aset Baru (Ep ${episodeNum})`}
        subtitle="Ubah tindakan per aset bila ingin menggabungkan ke aset lama atau menjadikannya varian kostum."
        width={640}
      >
        <div className="flex flex-col gap-3">
          <div className="scroll-thin flex max-h-[55vh] flex-col gap-2.5 overflow-y-auto pr-1">
            {proposals.map((asset, idx) => (
              <div key={`${asset.name}-${idx}`} className="flex flex-col gap-2 rounded-xl border border-line bg-paper p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-bold text-ink">{asset.name}</span>
                      <Badge tone="info">{KIND_LABEL[asset.kind]}</Badge>
                    </div>
                    {asset.description && <p className="mt-1 text-xs text-ink-2">{asset.description}</p>}
                    {asset.reason && <p className="mt-0.5 text-[11px] text-muted">Alasan AI: {asset.reason}</p>}
                  </div>
                  <div className="w-[190px] shrink-0">
                    <Select
                      label="Tindakan"
                      size="sm"
                      value={asset.action}
                      options={actionOptionsFor(asset)}
                      onChange={(val) => {
                        const nextAction = val as NewAssetProposal['action']
                        const poolChanged =
                          asset.kind === 'derivative' &&
                          ((asset.action === 'merge') !== (nextAction === 'merge'))
                        onUpdateProposal(idx, {
                          action: nextAction,
                          ...(nextAction === 'ignore' || poolChanged ? { target: undefined } : {})
                        })
                      }}
                    />
                  </div>
                </div>

                {(asset.action === 'merge' || asset.action === 'derivative' || (asset.kind === 'derivative' && asset.action !== 'ignore')) && (() => {
                  const opts = targetOptionsFor(asset)
                  const resolvedTarget = asset.target
                    ? (opts.find((o) => o.value === asset.target || o.label.toLowerCase() === asset.target!.trim().toLowerCase())?.value ?? asset.target)
                    : ''
                  return (
                    <div className="flex items-center gap-2 border-t border-line pt-2">
                      <span className="text-[11px] font-semibold text-muted">
                        {asset.action === 'merge' ? 'Gabung ke:' : 'Karakter induk:'}
                      </span>
                      <div className="w-[220px]">
                        <Select
                          label="Pilih target aset"
                          size="sm"
                          value={resolvedTarget}
                          options={opts}
                          onChange={(val) => onUpdateProposal(idx, { target: String(val) })}
                        />
                      </div>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            <Button variant="secondary" size="sm" onClick={() => setDetailOpen(false)}>
              Selesai Tinjau
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
