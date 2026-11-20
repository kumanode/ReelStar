import { useEffect, useState } from 'react'
import { AlertTriangle, GitMerge, UserPlus } from 'lucide-react'
import type { AssetUsageSummary } from '@shared/types'
import { Button, Modal, Segmented, Spinner, cx } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'

interface MergeModalProps {
  open: boolean
  onClose: () => void
  kind: 'character' | 'location' | 'prop'
  sourceId: string
  sourceName: string
  onMerged?: () => void
}

export function MergeAssetModal({
  open,
  onClose,
  kind,
  sourceId,
  sourceName,
  onMerged
}: MergeModalProps) {
  const { project, characters, locations, props, assets, refreshLorebook, load, flush } = useProject()
  const { toast } = useApp()

  const [targetId, setTargetId] = useState<string>('')
  const [asVariant, setAsVariant] = useState<boolean>(false)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [usage, setUsage] = useState<AssetUsageSummary | null>(null)
  const [merging, setMerging] = useState(false)

  // Fetch usage summary when opening
  useEffect(() => {
    if (!open || !project || !sourceId) return
    let active = true
    setLoadingUsage(true)
    window.api.lorebook
      .assetUsage(project.id, kind, sourceId)
      .then((summary) => {
        if (active) setUsage(summary)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingUsage(false)
      })
    return () => {
      active = false
    }
  }, [open, project?.id, kind, sourceId])

  if (!open || !project) return null

  // Candidates for merge targets (excluding source itself)
  const candidates: { id: string; name: string; sheetAssetId?: string | null }[] =
    kind === 'character'
      ? characters.filter((c) => c.id !== sourceId)
      : kind === 'location'
        ? locations.filter((l) => l.id !== sourceId)
        : props.filter((p) => p.id !== sourceId)

  const handleMerge = async () => {
    if (!targetId) {
      toast('info', 'Pilih aset tujuan penggabungan')
      return
    }
    setMerging(true)
    try {
      // A save still waiting would write the old references back after the merge.
      await flush()
      const res = await window.api.lorebook.merge({
        projectId: project.id,
        kind,
        sourceId,
        targetId,
        asVariant: kind === 'character' ? asVariant : false
      })
      toast('success', res.message)
      await refreshLorebook()
      // Reload current project bundle to update all clips and character references
      const freshBundle = await window.api.projects.get(project.id)
      // Undo history points at the merged-away asset, so it cannot be replayed safely.
      load(freshBundle, { keepHistory: false })
      if (onMerged) onMerged()
      onClose()
    } catch (err) {
      toast('error', `Gagal menggabungkan: ${errorText(err)}`)
    } finally {
      setMerging(false)
    }
  }

  const kindLabel = kind === 'character' ? 'Karakter' : kind === 'location' ? 'Lokasi' : 'Prop'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Gabungkan ${kindLabel} "${sourceName}"`}
      subtitle={`Arahkan semua rujukan ${kindLabel.toLowerCase()} ini ke aset lain yang dipertahankan.`}
      width={640}
    >
      <div className="flex flex-col gap-4 text-sm text-ink">
        {/* Character Merge Mode Switch */}
        {kind === 'character' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">Mode Penggabungan</span>
            <Segmented
              value={asVariant ? 'variant' : 'same'}
              onChange={(v) => setAsVariant(v === 'variant')}
              options={[
                { id: 'same', label: 'Gabung sebagai karakter yang sama' },
                { id: 'variant', label: 'Jadikan varian kostum tokoh tujuan' }
              ]}
              size="sm"
            />
            <p className="text-xs text-muted">
              {asVariant
                ? `Karakter "${sourceName}" akan menjadi varian kostum tokoh tujuan dengan tampilan dan deskripsi yang dipertahankan.`
                : `Semua rujukan klip "${sourceName}" akan diganti dengan tokoh tujuan, dan nama "${sourceName}" akan dicatat sebagai alias.`}
            </p>
          </div>
        )}

        {/* Impact Summary */}
        <div className="rounded-xl border border-line bg-paper p-3.5">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <AlertTriangle className="size-4 text-accent" />
            <span>Ringkasan Dampak</span>
          </div>
          {loadingUsage ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Spinner />
              Menghitung pemakaian di seluruh episode…
            </div>
          ) : usage && usage.totalCount > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5 text-xs text-ink-2">
              <p>
                Aset ini dipakai di <strong>{usage.totalCount} shot</strong> pada{' '}
                <strong>{usage.episodes.length} episode</strong>:
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-muted">
                {usage.episodes.map((ep) => (
                  <li key={ep.episodeId}>
                    Ep {ep.episodeNum} ({ep.title}): {ep.count} shot
                  </li>
                ))}
              </ul>
              <p className="text-accent-dark">
                Setelah digabung, semua shot di atas akan dialihkan ke aset tujuan yang kamu pilih.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Aset ini belum pernah dipakai di klip mana pun. Penggabungan aman dilakukan tanpa dampak ke adegan.
            </p>
          )}
        </div>

        {/* Target Candidate Picker */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-ink">
            Pilih {kindLabel} Tujuan ({candidates.length} pilihan):
          </span>
          {candidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-6 text-center text-xs text-muted">
              Tidak ada {kindLabel.toLowerCase()} lain dalam proyek ini untuk digabungkan.
            </div>
          ) : (
            <div className="scroll-thin grid max-h-56 grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3">
              {candidates.map((cand) => {
                const sheet = cand.sheetAssetId ? assets[cand.sheetAssetId] : null
                const isSelected = targetId === cand.id
                return (
                  <button
                    key={cand.id}
                    type="button"
                    onClick={() => setTargetId(cand.id)}
                    className={cx(
                      'flex flex-col items-center gap-2 rounded-xl border p-2.5 text-center transition-all',
                      isSelected
                        ? 'border-accent bg-accent-soft text-accent-dark ring-2 ring-accent'
                        : 'border-line bg-surface hover:border-ink-2 hover:bg-sand/30'
                    )}
                  >
                    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-paper">
                      {sheet ? (
                        <img src={sheet.url} alt={cand.name} className="size-full object-cover" />
                      ) : (
                        <UserPlus className="size-5 text-muted" />
                      )}
                    </div>
                    <span className="truncate text-xs font-semibold text-ink" title={cand.name}>
                      {cand.name}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button onClick={onClose} disabled={merging}>
            Batal
          </Button>
          <Button
            variant="primary"
            icon={<GitMerge className="size-4" />}
            loading={merging}
            disabled={!targetId || merging}
            onClick={() => void handleMerge()}
          >
            Gabungkan
          </Button>
        </div>
      </div>
    </Modal>
  )
}
