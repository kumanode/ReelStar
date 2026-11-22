import { useState } from 'react'
import { AlertCircle, AlertTriangle, History, Lock, Plus, Trash2, X } from 'lucide-react'
import type { LockWord, ScriptDoctorIssue, ScriptVersion } from '@shared/types'
import { Badge, Button, IconButton, Modal, Switch, cx, inputCls } from '../../components/ui'

interface DoctorDrawerProps {
  issues: ScriptDoctorIssue[]
  onClose: () => void
  onJumpToShot?: (shotIndex: number) => void
}

export function DoctorDrawer({ issues, onClose, onJumpToShot }: DoctorDrawerProps) {
  return (
    <div className="shrink-0 border-b border-line bg-sun-soft px-5 py-3 text-xs">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-sun-ink">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Catatan Dokter Naskah ({issues.length})</span>
            <span className="font-normal opacity-80">— saran ritme &amp; struktur, tidak memblokir penyimpanan</span>
          </div>
          <Button variant="secondary" size="sm" icon={<X className="size-3.5" />} onClick={onClose}>
            Tutup
          </Button>
        </div>

        {issues.length === 0 ? (
          <p className="text-sun-ink/90">Tidak ada catatan masalah. Ritme dan struktur episode sudah rapi.</p>
        ) : (
          <div className="scroll-thin flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
            {issues.map((issue, idx) => (
              <div
                key={`${issue.code}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-ink"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {issue.severity === 'error' ? (
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-bad-ink" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-sun-ink" />
                  )}
                  <div className="min-w-0">
                    <span className="font-semibold">{issue.title}</span>
                    {issue.description && <p className="text-[11px] text-ink-2">{issue.description}</p>}
                    {issue.suggestion && <p className="text-[11px] text-muted">{issue.suggestion}</p>}
                  </div>
                </div>
                {typeof issue.shotIndex === 'number' && onJumpToShot && (
                  <button
                    type="button"
                    onClick={() => onJumpToShot(issue.shotIndex!)}
                    className="shrink-0 text-[11px] font-semibold text-accent-dark underline hover:text-accent"
                  >
                    Lompat ke Shot {issue.shotIndex + 1} →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface LocksDrawerProps {
  episodeNum: number
  seriesLocks: LockWord[]
  episodeLocks: LockWord[]
  onToggleEpisodeLock: (id: string) => void
  onAddEpisodeLock: (label: string, text: string) => void
  onRemoveEpisodeLock: (id: string) => void
  onOpenLorebookRules: () => void
  onClose: () => void
}

export function LocksDrawer({
  episodeNum,
  seriesLocks,
  episodeLocks,
  onToggleEpisodeLock,
  onAddEpisodeLock,
  onRemoveEpisodeLock,
  onOpenLorebookRules,
  onClose
}: LocksDrawerProps) {
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')

  const handleAdd = () => {
    if (!text.trim()) return
    onAddEpisodeLock(label.trim() || 'Kunci Episode', text.trim())
    setLabel('')
    setText('')
  }

  return (
    <div className="shrink-0 border-b border-line bg-info-soft px-5 py-3 text-xs">
      <div className="mx-auto flex max-w-5xl flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-info-ink">
            <Lock className="size-3.5 shrink-0" />
            <span>Kunci Kontinuitas Ep {episodeNum}</span>
            <span className="font-normal opacity-85">— ditempel verbatim ke semua prompt gambar &amp; video episode ini</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenLorebookRules}>
              Kelola Kunci Serial
            </Button>
            <Button variant="secondary" size="sm" icon={<X className="size-3.5" />} onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>

        {seriesLocks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-info-ink">Dari Serial:</span>
            {seriesLocks.map((l) => (
              <span
                key={l.id}
                className={cx(
                  'rounded-lg border border-line bg-surface px-2 py-0.5 text-[11px] text-ink',
                  !l.enabled && 'opacity-50 line-through'
                )}
                title={l.text}
              >
                {l.label}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {episodeLocks.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-ink">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Switch on={l.enabled} onChange={() => onToggleEpisodeLock(l.id)} label={`Aktifkan ${l.label}`} />
                <div className="min-w-0">
                  <span className="font-semibold">{l.label}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted">{l.text}</span>
                </div>
              </div>
              <IconButton label="Hapus kunci episode" size={28} onClick={() => onRemoveEpisodeLock(l.id)}>
                <Trash2 className="size-3.5 text-bad-ink" />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (mis. Lampu Ruang Rapat)"
            className="h-8 w-44 rounded-lg border border-line-2 bg-surface px-2.5 text-xs text-ink outline-none focus:border-ink"
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Frasa kunci bahasa Inggris yang wajib masuk prompt…"
            className="h-8 min-w-[220px] flex-1 rounded-lg border border-line-2 bg-surface px-2.5 font-mono text-xs text-ink outline-none focus:border-ink"
          />
          <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} disabled={!text.trim()} onClick={handleAdd}>
            Tambah Kunci
          </Button>
        </div>
      </div>
    </div>
  )
}

interface SnapshotModalsProps {
  episodeNum: number
  historyOpen: boolean
  onCloseHistory: () => void
  saveOpen: boolean
  onCloseSave: () => void
  versions: ScriptVersion[]
  canSaveSnapshot: boolean
  onSaveSnapshot: (note: string) => Promise<void>
  onRestoreVersion: (version: ScriptVersion) => Promise<void>
}

export function SnapshotModals({
  episodeNum,
  historyOpen,
  onCloseHistory,
  saveOpen,
  onCloseSave,
  versions,
  canSaveSnapshot,
  onSaveSnapshot,
  onRestoreVersion
}: SnapshotModalsProps) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSnapshot(note.trim() || 'Snapshot manual')
      setNote('')
      onCloseSave()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        open={historyOpen}
        onClose={onCloseHistory}
        title={`Riwayat Versi Naskah (Ep ${episodeNum})`}
        subtitle="Pulihkan draf naskah ke titik sebelumnya kapan saja."
        width={560}
      >
        <div className="flex flex-col gap-3">
          {versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted">
              <History className="size-8 opacity-40" />
              <p className="mt-2">Belum ada snapshot naskah tersimpan untuk episode ini.</p>
            </div>
          ) : (
            <div className="scroll-thin flex max-h-[380px] flex-col gap-2 overflow-y-auto pr-1">
              {versions.map((v, idx) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-display text-xs font-bold text-ink">
                        {v.note || `Versi #${versions.length - idx}`}
                      </span>
                      <Badge tone="draft">{v.draft.shots?.length ?? 0} shot</Badge>
                    </div>
                    <span className="text-[11px] text-muted">
                      {new Date(v.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => void onRestoreVersion(v)}>
                    Pulihkan
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line pt-3">
            {canSaveSnapshot ? (
              <span className="text-[11px] text-muted">Memulihkan versi hanya mengubah draf sebelum konfirmasi.</span>
            ) : (
              <span className="text-[11px] text-muted">Simpan snapshot tersedia saat ada draf naskah aktif.</span>
            )}
            <Button variant="secondary" size="sm" onClick={onCloseHistory}>
              Tutup
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={saveOpen}
        onClose={onCloseSave}
        title="Simpan Snapshot Naskah"
        subtitle={`Simpan kondisi draf Episode ${episodeNum} saat ini agar bisa dipulihkan nanti.`}
        width={460}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink">Catatan Snapshot</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
              placeholder="Mis. Sebelum revisi dialog adegan 3"
              className={inputCls}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            <Button variant="secondary" size="sm" onClick={onCloseSave} disabled={saving}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>
              Simpan Snapshot
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
