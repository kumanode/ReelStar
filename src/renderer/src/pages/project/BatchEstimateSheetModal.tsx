import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import type { BatchEstimateSheetResult } from '@shared/types'
import { Button, Modal } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'

interface BatchEstimateSheetModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  onStarted: () => void
}

const KIND_LABEL: Record<string, string> = {
  character: 'Karakter',
  derivative: 'Varian Kostum',
  location: 'Lokasi',
  prop: 'Prop'
}

export function BatchEstimateSheetModal({
  open,
  onClose,
  projectId,
  onStarted
}: BatchEstimateSheetModalProps) {
  const { toast } = useApp()
  const [includeStale, setIncludeStale] = useState(false)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [result, setResult] = useState<BatchEstimateSheetResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)

    window.api.generate
      .batchEstimateSheets(projectId, includeStale)
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, projectId, includeStale])

  const handleStart = async () => {
    if (!result?.canRun) return
    setStarting(true)
    try {
      await window.api.generate.missingSheets(projectId, includeStale)
      toast('info', `Memulai pembuatan ${result.totalItems} lembar Lorebook…`)
      onStarted()
      onClose()
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setStarting(false)
    }
  }

  const blockedItems = result?.items.filter((it) => it.status === 'blocked') ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat Lembar Lorebook (Batch)"
      subtitle="Perkiraan biaya dan validasi syarat sebelum generate massal"
      width={520}
    >
      <div className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted">
            Menghitung perkiraan kredit dan memeriksa status lembar…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-bad bg-bad-soft p-4 text-xs text-bad-ink">
            Gagal memeriksa status: {error}
          </div>
        ) : result ? (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col rounded-xl border border-line bg-sand/60 p-3.5">
                <span className="text-xs text-muted">Jumlah Lembar Target</span>
                <span className="font-display text-2xl font-bold text-ink">
                  {result.totalItems} lembar
                </span>
                <span className="text-[11px] text-muted">
                  {result.missingCount} belum ada · {result.staleCount} basi
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line bg-sand/60 p-3.5">
                <span className="text-xs text-muted">Perkiraan Biaya Kredit</span>
                <span className="font-display text-2xl font-bold text-accent-dark tabular-nums">
                  {result.totalCredits != null ? `≈ ${result.totalCredits.toLocaleString('id-ID')} kr` : '—'}
                </span>
                <span className="truncate text-[11px] text-muted">
                  Model: {result.items[0]?.model || 'Standar'}
                </span>
              </div>
            </div>

            {/* Toggle to include stale items */}
            {result.staleCount > 0 && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line-2 bg-surface p-2.5 text-xs text-ink hover:bg-sand/30">
                <input
                  type="checkbox"
                  checked={includeStale}
                  onChange={(e) => setIncludeStale(e.target.checked)}
                  className="size-4 rounded accent-accent"
                />
                <div className="flex flex-col">
                  <span className="font-semibold">Sertakan {result.staleCount} lembar basi</span>
                  <span className="text-[11px] text-muted">
                    Buat ulang lembar yang nama, deskripsi, atau kostum variasinya sudah diedit
                  </span>
                </div>
              </label>
            )}

            {/* All-or-nothing check notice */}
            {result.blockedCount > 0 ? (
              <div className="flex flex-col gap-2 rounded-xl border border-bad bg-bad-soft p-3.5 text-xs text-bad-ink">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="size-4 shrink-0 text-bad" />
                  <span>
                    Batch tidak dapat dijalankan: {result.blockedCount} aset terblokir
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-bad-ink/90">
                  Generate massal menerapkan aturan semua-atau-tidak-sama-sekali agar tidak membuang kredit.
                  Perbaiki aset yang terblokir sebelum memulai proses.
                </p>

                <div className="mt-1 flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
                  {blockedItems.map((it) => (
                    <div
                      key={it.id}
                      className="flex flex-col gap-0.5 rounded-lg border border-bad/30 bg-surface/90 p-2 text-ink"
                    >
                      <div className="flex items-center justify-between font-semibold text-xs">
                        <span>
                          [{KIND_LABEL[it.kind] || it.kind}] {it.name}
                        </span>
                      </div>
                      <ul className="list-inside list-disc text-[11px] text-bad-ink">
                        {it.blockers.map((b, bi) => (
                          <li key={bi}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : result.totalItems === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-4 text-xs text-muted">
                <CheckCircle2 className="size-4 text-ok-ink" />
                <span>Semua aset Lorebook sudah memiliki lembar referensi terkini.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft/30 p-3 text-xs text-ok-ink">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>
                  Semua prasyarat terpenuhi. Lembar karakter dasar, lokasi, dan prop akan dibuat lebih dulu, diikuti oleh varian kostum secara berurutan.
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Sparkles className="size-3.5" />}
                disabled={!result.canRun || starting}
                onClick={() => void handleStart()}
              >
                {starting
                  ? 'Memulai…'
                  : `Mulai buat ${result.totalItems} lembar`}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
