import { useEffect, useState } from 'react'
import { AudioLines, Captions, Download, FolderOpen, Trash2 } from 'lucide-react'
import type { AppSettings, WhisperStatus } from '@shared/types'
import { Badge, Button, Progress, Switch, confirmDialog } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'

const mb = (n: number): string => `${Math.round(n / 1_000_000).toLocaleString('id-ID')} MB`

/** Settings for the local Whisper Small model that times caption words against the real voice. */
export function WhisperSection({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const { toast } = useApp()
  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [pendingAction, setPendingAction] = useState<'download' | 'cancel' | 'remove' | null>(null)
  const [savingAuto, setSavingAuto] = useState(false)

  useEffect(() => {
    void window.api.whisper
      .status()
      .then(setStatus)
      .catch((e) => toast('error', errorText(e)))
    return window.api.on.whisper(setStatus)
  }, [])

  if (!status) return null
  const busy = status.state === 'downloading' || status.state === 'verifying'

  const startDownload = async (): Promise<void> => {
    setPendingAction('download')
    try {
      await window.api.whisper.download()
    } catch (e) {
      toast('error', `Gagal mengunduh model Whisper: ${errorText(e)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const cancelDownload = async (): Promise<void> => {
    setPendingAction('cancel')
    try {
      await window.api.whisper.cancel()
    } catch (e) {
      toast('error', `Gagal membatalkan unduhan: ${errorText(e)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Hapus model Whisper?',
      body: `File model (${mb(status.total)}) dihapus dari komputer ini. Caption yang sudah disinkronkan tetap aman, dan model bisa diunduh lagi kapan saja.`,
      confirm: 'Hapus model',
      danger: true
    })
    if (!ok) return
    setPendingAction('remove')
    try {
      await window.api.whisper.remove()
    } catch (e) {
      toast('error', `Gagal menghapus model Whisper: ${errorText(e)}`)
    } finally {
      setPendingAction(null)
    }
  }

  const toggleWhisperAuto = async (v: boolean): Promise<void> => {
    setSavingAuto(true)
    try {
      onSettings(await window.api.settings.set({ whisperAuto: v }))
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setSavingAuto(false)
    }
  }

  return (
    <>
      <div className="mt-5 flex items-start gap-3">
        <span className="mt-1 text-ink">
          <Captions className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[22px] font-bold leading-tight">Caption akurat</h2>
          <p className="text-sm text-ink-2">Menyamakan waktu tiap kata caption dengan suara narasi, langsung di komputer ini.</p>
        </div>
      </div>
      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-ink bg-ink text-paper">
            <AudioLines className="size-5" />
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-base font-bold">Whisper Small</span>
            <span className="text-[13px] text-ink-2">Pengenal suara multibahasa (termasuk Indonesia) lewat whisper.cpp · {mb(status.total)}</span>
          </div>
          {status.state === 'ready' ? (
            <Badge tone="ok">Siap dipakai</Badge>
          ) : busy ? (
            <Badge tone="warn">{status.state === 'verifying' ? 'Memeriksa file' : 'Mengunduh'}</Badge>
          ) : (
            <Badge tone="draft">Belum diunduh</Badge>
          )}
        </div>

        <p className="text-[13px] leading-relaxed text-ink-2">
          Dipakai untuk suara Gemini TTS, yang tidak mengirim waktu per kata. Suara ElevenLabs sudah membawa waktu kata yang presisi. Setelah diunduh,
          Whisper berjalan tanpa internet dan tanpa biaya.
        </p>

        {busy && (
          <div className="flex flex-col gap-1.5">
            <Progress value={status.total ? status.received / status.total : 0} />
            <span className="font-mono text-xs text-ink-2">
              {mb(status.received)} dari {mb(status.total)}
              {status.state === 'verifying' ? ' · memeriksa keutuhan file…' : ''}
            </span>
          </div>
        )}
        {status.error && !busy && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad-ink">{status.error}</p>}

        <div className="flex flex-wrap gap-2">
          {status.state === 'ready' ? (
            <>
              <Button icon={<FolderOpen className="size-4" />} disabled={pendingAction !== null} onClick={() => void window.api.whisper.openFolder()}>
                Buka folder
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="size-4" />}
                loading={pendingAction === 'remove'}
                disabled={pendingAction !== null}
                onClick={() => void remove()}
              >
                Hapus model
              </Button>
            </>
          ) : busy ? (
            <Button
              loading={pendingAction === 'cancel'}
              disabled={status.state === 'verifying' || pendingAction !== null}
              onClick={() => void cancelDownload()}
            >
              Batal
            </Button>
          ) : (
            <Button
              variant="accent"
              icon={<Download className="size-4" />}
              loading={pendingAction === 'download'}
              disabled={pendingAction !== null}
              onClick={() => void startDownload()}
            >
              {status.received > 0 ? `Lanjutkan unduhan (${mb(status.total - status.received)} lagi)` : `Unduh model (${mb(status.total)})`}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-dashed border-line pt-4">
          <div className="flex-1">
            <p className="text-sm font-semibold">Sinkronkan otomatis</p>
            <p className="text-[13px] text-muted">Setiap kali suara narasi Gemini dibuat, caption langsung disamakan dengan suaranya.</p>
          </div>
          <Switch
            on={settings.whisperAuto}
            disabled={savingAuto}
            onChange={(v) => void toggleWhisperAuto(v)}
            label="Sinkronkan caption otomatis"
          />
        </div>
      </section>
    </>
  )
}
