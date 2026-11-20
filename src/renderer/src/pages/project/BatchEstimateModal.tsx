import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import type { BatchEstimateResult } from '@shared/types'
import { Button, Modal } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'

interface BatchEstimateModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  episodeId?: string
  kind: 'image' | 'video'
  onStarted: () => void
  onSelectClip?: (clipId: string) => void
}

export function BatchEstimateModal({
  open,
  onClose,
  projectId,
  episodeId,
  kind,
  onStarted,
  onSelectClip
}: BatchEstimateModalProps) {
  const { toast } = useApp()
  const [includeStale, setIncludeStale] = useState(false)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [result, setResult] = useState<BatchEstimateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)

    window.api.generate
      .batchEstimate(projectId, episodeId, kind, includeStale)
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
  }, [open, projectId, episodeId, kind, includeStale])

  const handleStart = async () => {
    if (!result?.canRun) return
    setStarting(true)
    try {
      if (kind === 'image') {
        await window.api.generate.missingImages(projectId, episodeId, includeStale)
      } else {
        await window.api.generate.missingVideos(projectId, episodeId, includeStale)
      }
      toast('info', `Memulai pembuatan ${result.totalItems} ${kind === 'image' ? 'gambar' : 'video'} adegan…`)
      onStarted()
      onClose()
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setStarting(false)
    }
  }

  const isImage = kind === 'image'
  const blockedItems = result?.items.filter((it) => it.status === 'blocked') ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isImage ? 'Buat Gambar Adegan' : 'Buat Video AI'}
      subtitle="Perkiraan biaya dan validasi syarat sebelum generate"
      width={520}
    >
      <div className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted">
            Menghitung perkiraan kredit dan memeriksa syarat…
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
                <span className="text-xs text-muted">Jumlah Item Target</span>
                <span className="font-display text-2xl font-bold text-ink">
                  {result.totalItems} {isImage ? 'gambar' : 'video'}
                </span>
                <span className="text-[11px] text-muted">
                  {result.missingCount} belum ada · {result.staleCount} basi
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line bg-sand/60 p-3.5">
                <span className="text-xs text-muted">Perkiraan Biaya Kredit</span>
                <span className="font-display text-2xl font-bold text-accent-dark font-mono">
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
                  <span className="font-semibold">Sertakan {result.staleCount} adegan basi</span>
                  <span className="text-[11px] text-muted">
                    Buat ulang gambar yang input naskah atau lembar referensinya sudah berubah
                  </span>
                </div>
              </label>
            )}

            {/* All-or-nothing check notice (§6.J) */}
            {result.blockedCount > 0 ? (
              <div className="flex flex-col gap-2 rounded-xl border border-bad bg-bad-soft p-3.5 text-xs text-bad-ink">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="size-4 shrink-0 text-bad" />
                  <span>
                    Batch tidak dapat dijalankan: {result.blockedCount} adegan terblokir
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-bad-ink/90">
                  Sesuai aturan semua-atau-tidak-sama-sekali, generate massal tidak akan dijalankan jika ada
                  adegan yang belum memenuhi syarat lembar referensi atau format durasi.
                </p>

                <div className="mt-1 flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
                  {blockedItems.map((it) => (
                    <div
                      key={it.clipId}
                      className="flex flex-col gap-0.5 rounded-lg border border-bad/30 bg-surface/90 p-2 text-ink"
                    >
                      <div className="flex items-center justify-between font-semibold text-xs">
                        <span>
                          Shot {it.clipIndex} · {it.title}
                        </span>
                        {onSelectClip && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectClip(it.clipId)
                              onClose()
                            }}
                            className="text-[11px] font-semibold text-accent-dark underline hover:text-accent"
                          >
                            Periksa adegan →
                          </button>
                        )}
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
              <div className="flex items-center gap-2.5 rounded-xl border border-line bg-sand/40 p-3.5 text-xs text-ink">
                <CheckCircle2 className="size-4 text-ok" />
                <span>Semua adegan di episode ini sudah memiliki hasil terkini.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-ok/40 bg-ok-soft p-3 text-xs text-ok-ink">
                <CheckCircle2 className="size-4 shrink-0 text-ok" />
                <span>Semua syarat adegan terpenuhi. Siap dijalankan.</span>
              </div>
            )}
          </>
        ) : null}

        {/* Modal actions */}
        <div className="mt-2 flex items-center justify-end gap-2.5 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose} disabled={starting}>
            Batal
          </Button>
          <Button
            variant="accent"
            icon={<Sparkles className="size-4" />}
            loading={starting}
            disabled={loading || !result?.canRun || result.totalItems === 0}
            onClick={() => void handleStart()}
          >
            Mulai Buat {result?.totalItems ?? 0} {isImage ? 'Gambar' : 'Video'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
