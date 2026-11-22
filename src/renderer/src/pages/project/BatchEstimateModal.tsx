import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Film, Image as ImageIcon, Layers, Scissors, Sparkles } from 'lucide-react'
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
  /** When set, only these selected clips are estimated and generated. */
  clipIds?: string[]
  onStarted: () => void
  onSelectClip?: (clipId: string) => void
}

const SHEET_KIND_LABEL: Record<'character' | 'derivative' | 'location' | 'prop', string> = {
  character: 'Karakter',
  derivative: 'Varian kostum',
  location: 'Lokasi',
  prop: 'Prop'
}

export function BatchEstimateModal({
  open,
  onClose,
  projectId,
  episodeId,
  kind,
  clipIds,
  onStarted,
  onSelectClip
}: BatchEstimateModalProps) {
  const { toast } = useApp()
  const [includeStale, setIncludeStale] = useState(false)
  const [autoGenerateSheets, setAutoGenerateSheets] = useState(true)
  const [autoTrimSilence, setAutoTrimSilence] = useState(true)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [result, setResult] = useState<BatchEstimateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clipIdsKey = clipIds?.join(',') ?? ''
  const isSelectedMode = Boolean(clipIds && clipIds.length > 0)
  const isImage = kind === 'image'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)

    window.api.generate
      .batchEstimate(projectId, episodeId, kind, includeStale, isSelectedMode ? clipIds : undefined, isImage ? autoGenerateSheets : false)
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
  }, [open, projectId, episodeId, kind, includeStale, clipIdsKey, autoGenerateSheets, isImage, isSelectedMode])

  const handleStart = async () => {
    if (!result?.canRun) return
    setStarting(true)
    try {
      if (isImage) {
        await window.api.generate.missingImages(
          projectId,
          episodeId,
          includeStale,
          isSelectedMode ? clipIds : undefined,
          autoGenerateSheets
        )
        const sheetCount = result.prerequisiteSheets?.length ?? 0
        toast(
          'info',
          sheetCount > 0
            ? `Memulai ${sheetCount} lembar prasyarat lalu ${result.totalItems} gambar adegan secara berantai…`
            : `Memulai pembuatan ${result.totalItems} gambar adegan…`
        )
      } else {
        await window.api.generate.missingVideos(
          projectId,
          episodeId,
          includeStale,
          isSelectedMode ? clipIds : undefined,
          autoTrimSilence
        )
        toast('info', `Memulai pembuatan ${result.totalItems} video AI…`)
      }
      onStarted()
      onClose()
    } catch (err) {
      toast('error', errorText(err))
    } finally {
      setStarting(false)
    }
  }

  const blockedItems = result?.items.filter((it) => it.status === 'blocked') ?? []
  const prereqSheets = result?.prerequisiteSheets ?? []
  const skippedNoImage = result?.skippedMissingImageCount ?? 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isImage
          ? isSelectedMode
            ? `Buat Gambar (${clipIds!.length} Shot Terpilih)`
            : 'Buat Gambar Storyboard'
          : isSelectedMode
            ? `Buat Video AI (${clipIds!.length} Shot Terpilih)`
            : 'Buat Video AI'
      }
      subtitle={
        isImage
          ? 'Khusus pembuatan gambar — tidak menjalankan Video AI'
          : 'Terpisah dari gambar — hanya memproses shot yang gambarnya sudah siap'
      }
      width={540}
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
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  {isImage ? <ImageIcon className="size-3.5" /> : <Film className="size-3.5" />}
                  Jumlah Target
                </span>
                <span className="font-display text-2xl font-bold text-ink">
                  {result.totalItems} {isImage ? 'gambar' : 'video'}
                </span>
                <span className="text-[11px] text-muted">
                  {isSelectedMode
                    ? `${clipIds!.length} shot dicentang`
                    : `${result.missingCount} belum ada · ${result.staleCount} basi`}
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

            {/* Smart Dependency Batch: Prerequisite sheets wave for images */}
            {isImage && (
              <div className="flex flex-col gap-2">
                {prereqSheets.length > 0 && (
                  <div className="flex flex-col gap-2 rounded-xl border border-line-2 bg-sun-soft p-3.5 text-xs text-sun-ink">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Layers className="size-4 shrink-0" />
                        Tahap 1 (Prasyarat Otomatis): {prereqSheets.length} lembar referensi
                      </span>
                      {result.prerequisiteCredits != null && (
                        <span className="font-mono text-[11px] font-bold">
                          +{result.prerequisiteCredits.toLocaleString('id-ID')} kr
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      Lembar referensi yang masih kosong dibuat dulu secara berantai (karakter dasar → varian → lokasi/prop),
                      lalu gambar storyboard langsung menyusul tanpa perlu pindah ke Lorebook.
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {prereqSheets.map((s) => (
                        <span
                          key={`${s.kind}:${s.id}`}
                          className="rounded-md border border-line-2 bg-surface px-2 py-0.5 text-[11px] font-medium text-ink"
                        >
                          {s.name} <span className="text-muted">({SHEET_KIND_LABEL[s.kind]})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line-2 bg-surface p-2.5 text-xs text-ink hover:bg-sand/30">
                  <input
                    type="checkbox"
                    checked={autoGenerateSheets}
                    onChange={(e) => setAutoGenerateSheets(e.target.checked)}
                    className="size-4 rounded accent-accent"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold">Otomatis buat lembar referensi yang masih kosong</span>
                    <span className="text-[11px] text-muted">
                      Hilangkan blokir lembar kosong dengan menjalankan lembar dulu sebelum gambar adegan
                    </span>
                  </div>
                </label>
              </div>
            )}

            {/* Video-only: skipped shots without image & Auto-Trim option */}
            {!isImage && (
              <div className="flex flex-col gap-2">
                {skippedNoImage > 0 && (
                  <div className="rounded-xl border border-line-2 bg-sun-soft p-3 text-xs text-sun-ink">
                    <strong>{skippedNoImage} shot dilewati</strong> karena belum punya gambar storyboard. Buat gambarnya
                    dulu lewat tombol <strong>Buat Gambar</strong>.
                  </div>
                )}

                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line-2 bg-surface p-2.5 text-xs text-ink hover:bg-sand/30">
                  <input
                    type="checkbox"
                    checked={autoTrimSilence}
                    onChange={(e) => setAutoTrimSilence(e.target.checked)}
                    className="size-4 rounded accent-accent"
                  />
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Scissors className="size-3.5 text-accent" />
                      Aktifkan Auto-Trim Hening setelah ekstraksi Whisper
                    </span>
                    <span className="text-[11px] text-muted">
                      Pangkas jeda kosong awal/akhir klip dialog secara non-destruktif agar ritme drama tetap cepat
                    </span>
                  </div>
                </label>
              </div>
            )}

            {/* Toggle to include stale items (episode-wide mode) */}
            {!isSelectedMode && result.staleCount > 0 && (
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
                    Buat ulang {isImage ? 'gambar' : 'video'} yang input naskah atau referensinya sudah berubah
                  </span>
                </div>
              </label>
            )}

            {/* All-or-nothing check notice (§6.J) */}
            {result.blockedCount > 0 ? (
              <div className="flex flex-col gap-2 rounded-xl border border-bad bg-bad-soft p-3.5 text-xs text-bad-ink">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="size-4 shrink-0 text-bad" />
                  <span>Batch tidak dapat dijalankan: {result.blockedCount} adegan terblokir</span>
                </div>
                <p className="text-[11px] leading-relaxed text-bad-ink/90">
                  Perbaiki syarat di bawah dulu sebelum memulai generate massal.
                </p>

                <div className="mt-1 flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
                  {blockedItems.map((it) => (
                    <div
                      key={it.clipId}
                      className="flex flex-col gap-0.5 rounded-lg border border-bad/30 bg-surface/90 p-2 text-ink"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
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
                <CheckCircle2 className="size-4 text-ok-ink" />
                <span>
                  {!isImage && skippedNoImage > 0
                    ? 'Belum ada shot yang siap dibuatkan video. Buat gambar storyboard dulu lewat Buat Gambar.'
                    : `Semua adegan target sudah memiliki ${isImage ? 'gambar' : 'video'} terkini.`}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl border border-ok-ink/30 bg-ok-soft p-3 text-xs text-ok-ink">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>
                  {prereqSheets.length > 0
                    ? `Siap dijalankan berantai: ${prereqSheets.length} lembar → ${result.totalItems} gambar.`
                    : 'Semua syarat adegan terpenuhi. Siap dijalankan.'}
                </span>
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
