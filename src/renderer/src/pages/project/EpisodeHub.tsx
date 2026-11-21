import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import {
  Plus,
  Upload,
  BookText,
  Sparkles,
  ArrowRight,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  Clock,
  Layers,
  Loader2,
  AlertTriangle
} from 'lucide-react'
import type { Episode, EpisodeStatus, SeriesProgressSummary, SourceKind } from '@shared/types'
import { EPISODE_DURATION_OPTIONS, MAX_SERIES_DURATION_SEC } from '@shared/validation'
import { Badge, Button, IconButton, Menu, Segmented, confirmDialog, cx } from '../../components/ui'
import { Select } from '../../components/Select'
import { AutoTextarea } from '../../components/AutoTextarea'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { errorText } from '../../lib/format'

const STATUS_BADGE: Record<EpisodeStatus, { tone: 'draft' | 'info' | 'warn' | 'ok' | 'bad' | 'ink'; label: string }> = {
  draft: { tone: 'draft', label: 'Draf' },
  planned: { tone: 'info', label: 'Direncanakan' },
  script: { tone: 'info', label: 'Naskah' },
  storyboard: { tone: 'info', label: 'Storyboard' },
  editing: { tone: 'warn', label: 'Editor' },
  exported: { tone: 'ok', label: 'Terekspor' }
}

// 0 stands for "no target": the planner then follows the source, as it did before targets existed.
const TARGET_EPISODE_OPTIONS = [
  { value: 0, label: 'Otomatis' },
  ...Array.from({ length: 20 }, (_, i) => ({ value: i + 1, label: `${i + 1} episode` }))
]

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s} detik`
  if (s === 0) return `${m} menit`
  return `${m} m ${s} d`
}

export function EpisodeHub() {
  const {
    project,
    updateProject,
    episodes,
    createEpisode,
    updateEpisode,
    removeEpisode,
    removeAllEpisodes,
    reorderEpisodes,
    switchEpisode,
    setActiveView,
    flush,
    load
  } = useProject()
  const { toast } = useApp()

  const [showSource, setShowSource] = useState(Boolean(project?.sourceText))
  const [isPlanning, setIsPlanning] = useState(false)
  const [planMessage, setPlanMessage] = useState<string | null>(null)
  const [isBatchDrafting, setIsBatchDrafting] = useState(false)
  const [progress, setProgress] = useState<SeriesProgressSummary | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return window.api.on.storyProgress((progressEvent) => {
      if (progressEvent.projectId === project?.id) {
        setPlanMessage(progressEvent.message)
      }
    })
  }, [project?.id])

  useEffect(() => {
    if (!project?.id) return
    let alive = true
    window.api.projects
      .progress(project.id)
      .then((p) => {
        if (alive) setProgress(p)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [project?.id, episodes.length, project?.updatedAt, isPlanning, isBatchDrafting])

  if (!project) return null

  const targetEpCount = project.targetEpisodeCount ?? null
  const targetDurationSec = project.durationSec ?? 60
  const totalEstimatedSec = targetEpCount ? targetEpCount * targetDurationSec : null
  const isOverOneHour = totalEstimatedSec != null && totalEstimatedSec > MAX_SERIES_DURATION_SEC

  const handlePlanEpisodes = async (continuation = false) => {
    if (!project.sourceText?.trim()) {
      toast('info', 'Masukkan atau unggah teks sumber cerita terlebih dahulu.')
      return
    }
    if (isOverOneHour) {
      toast('error', 'Total durasi melebihi batas 1 jam. Sesuaikan target episode atau durasi sebelum melanjutkan.')
      return
    }
    if (!continuation && episodes.some((e) => e.status !== 'draft' || e.summary.trim())) {
      const ok = await confirmDialog({
        title: 'Rencanakan ulang serial?',
        body: 'Semua episode akan diganti dengan hasil perencanaan baru dari awal teks sumber. Episode yang sudah punya klip tidak akan dihapus; kalau ada, perencanaan dibatalkan dan kamu diberi tahu episode mana.',
        confirm: 'Rencanakan ulang',
        danger: true
      })
      if (!ok) return
    }

    setIsPlanning(true)
    setPlanMessage('Menganalisis teks sumber...')
    try {
      // The planner reads the saved source and may replace the open episode, so pending edits go first.
      await flush()
      const planned = await window.api.story.planEpisodes({
        projectId: project.id,
        sourceText: project.sourceText,
        sourceKind: project.sourceKind ?? 'novel',
        targetDurationSec,
        targetEpisodeCount: targetEpCount ?? undefined,
        mode: continuation ? 'continue' : 'replace'
      })
      const done = continuation ? 'Perencanaan episode dilanjutkan' : 'Serial selesai dipecah jadi episode'
      // The source decides how many episodes it can carry, so a missed target is reported rather than hidden.
      const count = planned.filter((e) => e.status !== 'draft').length
      if (targetEpCount && count !== targetEpCount) {
        const diff = count - targetEpCount
        toast('info', `${done}: ${count} episode, target ${targetEpCount} (selisih ${diff > 0 ? '+' : ''}${diff}). Tinjau daftarnya, lalu ubah target atau sumber kalau perlu.`)
      } else {
        toast('success', `${done}: ${count} episode.`)
      }
      const plannedSec = planned.reduce((acc, e) => acc + (e.durationSec || targetDurationSec), 0)
      if (plannedSec > MAX_SERIES_DURATION_SEC) {
        toast('info', `Total durasi hasil rencana ${formatDuration(plannedSec)}, lebih dari batas 1 jam. Hapus atau gabungkan beberapa episode, atau pilih durasi per episode yang lebih pendek.`)
      }
    } catch (err) {
      toast('error', `Gagal merencanakan episode: ${errorText(err)}`)
    } finally {
      // Reload even after a failure: earlier parts of the source may already be saved as episodes.
      try {
        load(await window.api.projects.get(project.id), { keepHistory: false })
      } catch {
        // The hub keeps its current list; the toast above already told the creator what happened.
      }
      setIsPlanning(false)
      setPlanMessage(null)
    }
  }

  const handlePlanAllScripts = async () => {
    setIsBatchDrafting(true)
    try {
      await flush()
      const res = await window.api.story.planAllScripts(project.id)
      if (res.failedEpisodes.length > 0) {
        const failed = res.failedEpisodes.map((f) => `${f.title} (${f.error})`).join('; ')
        toast(
          'error',
          `${res.plannedEpisodeIds.length} draf dibuat, ${res.failedEpisodes.length} gagal. Tekan "Buat semua naskah" lagi untuk mencoba ulang yang gagal: ${failed}`
        )
      } else if (res.plannedEpisodeIds.length > 0) {
        toast('success', `Draf naskah dibuat untuk ${res.plannedEpisodeIds.length} episode. Tinjau dan konfirmasi di tab Rencana & Tinjau.`)
      } else {
        toast('info', 'Semua episode sudah memiliki draf naskah atau klip.')
      }
    } catch (err) {
      toast('error', `Gagal menyusun naskah batch: ${errorText(err)}`)
    } finally {
      // Drafts saved before a failure or a stop are kept, so the hub reloads either way.
      try {
        load(await window.api.projects.get(project.id), { keepHistory: false })
      } catch {
        // The toast above already reported the outcome.
      }
      setIsBatchDrafting(false)
    }
  }

  const handleCancelBatchDrafting = async () => {
    try {
      await window.api.story.cancelBatchScripts(project.id)
      toast('info', 'Penyusunan naskah berhenti setelah episode yang sedang dikerjakan selesai.')
    } catch (err) {
      toast('error', errorText(err))
    }
  }

  const handleDeleteAllEpisodes = async () => {
    const ok = await confirmDialog({
      title: 'Hapus semua episode?',
      body: 'Seluruh episode dan klip di dalamnya akan dihapus permanen. Teks sumber cerita dan aset di Lorebook akan tetap dipertahankan.',
      confirm: 'Hapus semua episode',
      danger: true
    })
    if (!ok) return
    try {
      await removeAllEpisodes()
      toast('info', 'Semua episode telah dihapus.')
    } catch (err) {
      toast('error', `Gagal menghapus semua episode: ${errorText(err)}`)
    }
  }

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = String(event.target?.result ?? '')
      updateProject({ sourceText: text })
      setShowSource(true)
      toast('info', `File "${file.name}" berhasil dimuat (${text.length.toLocaleString()} karakter)`)
    }
    reader.onerror = () => {
      toast('error', 'Gagal membaca file teks')
    }
    reader.readAsText(file)
  }

  const handleCreateEmptyEpisode = async () => {
    const nextNum = episodes.length + 1
    const ep = await createEpisode({
      title: `Episode ${nextNum}`,
      episodeNum: nextNum
    })
    await switchEpisode(ep.id)
    setActiveView('episode')
  }

  const handleInsertEpisode = async (atIndex: number) => {
    const nextNum = atIndex + 1
    const newEp = await createEpisode({
      title: `Episode baru`,
      episodeNum: nextNum
    })
    const currentIds = episodes.map((e) => e.id)
    currentIds.splice(atIndex, 0, newEp.id)
    await reorderEpisodes(currentIds)
    toast('info', `Episode baru berhasil disisipkan`)
  }

  const handleMoveEpisode = async (index: number, dir: -1 | 1) => {
    const targetIndex = index + dir
    if (targetIndex < 0 || targetIndex >= episodes.length) return
    const ids = episodes.map((e) => e.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(targetIndex, 0, moved)
    await reorderEpisodes(ids)
  }

  const handleDeleteEpisode = async (ep: Episode) => {
    const ok = await confirmDialog({
      title: `Hapus Episode ${ep.episodeNum}?`,
      body: `Episode "${ep.title}" beserta klip di dalamnya akan dihapus. Perubahan ini tidak bisa dibatalkan.`,
      confirm: 'Hapus episode',
      danger: true
    })
    if (!ok) return
    try {
      await removeEpisode(ep.id)
      toast('info', `Episode ${ep.episodeNum} telah dihapus`)
    } catch (err) {
      toast('error', `Gagal menghapus: ${errorText(err)}`)
    }
  }

  const handleOpenEpisode = async (epId: string) => {
    await switchEpisode(epId)
    setActiveView('episode')
  }

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto bg-paper p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Hub Header */}
        <div className="flex flex-col gap-1 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Episode Hub</h1>
            <p className="text-sm text-ink-2">
              Kelola struktur episode, naskah sumber, dan alur cerita serial drama kamu.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {episodes.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowRight className="size-3.5" />}
                onClick={() => setActiveView('lorebook')}
              >
                Lanjut ke Lorebook
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload className="size-3.5" />}
              onClick={() => fileInputRef.current?.click()}
            >
              Unggah cerita
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="size-3.5" />}
              onClick={() => void handleCreateEmptyEpisode()}
            >
              Tambah episode
            </Button>
          </div>
        </div>

        {/* Source Text Section */}
        {(showSource || episodes.length === 0) && (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookText className="size-4 text-accent" />
                  <h2 className="font-display text-base font-bold text-ink">Sumber Cerita</h2>
                </div>
                <Segmented<SourceKind>
                  value={project.sourceKind ?? 'novel'}
                  onChange={(v) => updateProject({ sourceKind: v })}
                  options={[
                    { id: 'novel', label: 'Novel / Cerita' },
                    { id: 'screenplay', label: 'Naskah Jadi' }
                  ]}
                  size="sm"
                />
              </div>

              <p className="text-xs text-muted">
                {project.sourceKind === 'screenplay'
                  ? 'Naskah jadi mempertahankan dialog dan adegan kata per kata tanpa penulisan ulang bebas.'
                  : 'Novel atau ringkasan cerita akan diadaptasi menjadi shot-shot visual dan dialog ringkas.'}
              </p>

              <AutoTextarea
                value={project.sourceText ?? ''}
                onChange={(e) => updateProject({ sourceText: e.target.value })}
                placeholder="Tempel novel, cerpen, sinopsis, atau naskah serial drama di sini..."
                minRows={3}
                maxHeight={200}
                className="w-full rounded-xl border border-line-2 bg-paper p-3 text-sm text-ink outline-none transition-colors focus:border-ink"
              />

              <div className="flex flex-col gap-3 pt-2 text-xs text-muted">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <span>{(project.sourceText ?? '').length.toLocaleString()} karakter</span>

                    <div className="flex items-center gap-2">
                      <Layers className="size-3.5 text-ink-2" />
                      <span>Target episode:</span>
                      <div className="w-32">
                        <Select
                          label="Target jumlah episode"
                          options={TARGET_EPISODE_OPTIONS}
                          value={targetEpCount ?? 0}
                          onChange={(v) => updateProject({ targetEpisodeCount: Number(v) || null })}
                          size="sm"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Clock className="size-3.5 text-ink-2" />
                      <span>Durasi per episode:</span>
                      <div className="w-44">
                        <Select
                          label="Target durasi episode"
                          value={targetDurationSec}
                          options={EPISODE_DURATION_OPTIONS}
                          onChange={(v) => updateProject({ durationSec: Number(v) })}
                          size="sm"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 font-medium text-ink-2">
                      <span>Total estimasi:</span>
                      <span className={cx('font-mono font-bold', isOverOneHour ? 'text-bad' : 'text-accent-dark')}>
                        {totalEstimatedSec != null ? formatDuration(totalEstimatedSec) : 'mengikuti sumber'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isPlanning && (
                      <div className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-dark">
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>{planMessage || 'Sedang merencanakan episode...'}</span>
                      </div>
                    )}
                    {episodes.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Sparkles className="size-3.5" />}
                        disabled={isPlanning || !project.sourceText?.trim() || isOverOneHour}
                        onClick={() => void handlePlanEpisodes(true)}
                      >
                        Lanjutkan perencanaan
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      icon={isPlanning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      disabled={isPlanning || !project.sourceText?.trim() || isOverOneHour}
                      onClick={() => void handlePlanEpisodes(false)}
                    >
                      {episodes.length > 0 ? 'Rencanakan ulang' : 'Pecah jadi episode'}
                    </Button>
                  </div>
                </div>

                {isOverOneHour && (
                  <div className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft/60 px-3 py-2 text-xs text-bad-ink">
                    <AlertTriangle className="size-4 shrink-0 text-bad" />
                    <span>
                      Total durasi serial maksimal 1 jam (60 menit). Kurangi target jumlah episode atau pilih durasi per episode yang lebih pendek agar perencanaan dapat dijalankan.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Series Progress Summary Card */}
        {episodes.length > 0 && progress && (
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-bold uppercase tracking-wider text-muted">
                Ringkasan Progres Serial
              </span>
              <span className="text-xs text-muted">
                Total {episodes.length} episode · Estimasi durasi {formatDuration(episodes.reduce((acc, ep) => acc + (ep.durationSec || targetDurationSec), 0))}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 pt-1">
              <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
                <span className="text-[11px] text-muted">Rencana Episode</span>
                <span className="font-display text-base font-bold text-ink">
                  {progress.plannedEpisodes} / {progress.totalEpisodes}
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
                <span className="text-[11px] text-muted">Draf Naskah</span>
                <span className="font-display text-base font-bold text-ink">
                  {progress.draftScriptEpisodes} episode
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
                <span className="text-[11px] text-muted">Dikonfirmasi</span>
                <span className="font-display text-base font-bold text-ok-ink">
                  {progress.confirmedEpisodes} episode
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
                <span className="text-[11px] text-muted">Aset Tanpa Lembar</span>
                <span className={cx('font-display text-base font-bold', progress.missingSheets > 0 ? 'text-sun-ink' : 'text-ok-ink')}>
                  {progress.missingSheets} / {progress.totalAssets}
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
                <span className="text-[11px] text-muted">Belum Bergambar</span>
                <span className={cx('font-display text-base font-bold', progress.missingClipImages > 0 ? 'text-sun-ink' : 'text-ok-ink')}>
                  {progress.missingClipImages} / {progress.totalClips}
                </span>
              </div>
              <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
                <span className="text-[11px] text-muted">Belum Bervideo</span>
                <span className={cx('font-display text-base font-bold', progress.missingClipVideos > 0 ? 'text-sun-ink' : 'text-ok-ink')}>
                  {progress.missingClipVideos} / {progress.totalClips}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Empty State when no episodes exist */}
        {episodes.length === 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setShowSource(true)
                fileInputRef.current?.click()
              }}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-2 bg-surface p-8 text-center transition-all hover:border-ink hover:bg-paper"
            >
              <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-accent-soft text-accent-dark">
                <Upload className="size-6" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-ink">Tempel atau unggah cerita</h3>
                <p className="mt-1 text-xs text-muted">
                  Mulai dari file .txt atau salin naskah untuk dipecah jadi serial episode.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => void handleCreateEmptyEpisode()}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-2 bg-surface p-8 text-center transition-all hover:border-ink hover:bg-paper"
            >
              <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-sun-soft text-sun-ink">
                <Plus className="size-6" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-ink">Mulai dari episode kosong</h3>
                <p className="mt-1 text-xs text-muted">
                  Tulis naskah dan rencanakan visual langsung shot demi shot di storyboard.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Episode Cards Grid */}
        {episodes.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-ink-2" />
                <h2 className="font-display text-base font-bold text-ink">Daftar Episode ({episodes.length})</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!showSource && (
                  <button
                    type="button"
                    onClick={() => setShowSource(true)}
                    className="text-xs font-semibold text-accent hover:underline mr-1"
                  >
                    Tampilkan sumber cerita
                  </button>
                )}

                {isBatchDrafting && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCancelBatchDrafting()}
                    className="text-bad hover:bg-bad-soft"
                  >
                    Berhenti setelah episode ini
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  icon={isBatchDrafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  disabled={isBatchDrafting || isPlanning}
                  onClick={() => void handlePlanAllScripts()}
                  title="Buat draf naskah shot untuk episode yang belum memiliki draf"
                >
                  {isBatchDrafting ? 'Menyusun naskah…' : 'Buat semua naskah'}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="size-3.5 text-bad" />}
                  disabled={isBatchDrafting || isPlanning}
                  onClick={() => void handleDeleteAllEpisodes()}
                  className="text-bad hover:bg-bad-soft"
                  title="Hapus seluruh episode dan adegan, tetap pertahankan Lorebook dan teks sumber"
                >
                  Hapus semua episode
                </Button>
              </div>
            </div>

            <div className={cx('grid gap-4', episodes.length === 1 ? 'grid-cols-1 max-w-3xl' : 'grid-cols-1 md:grid-cols-2')}>
              {episodes.map((ep, idx) => {
                const badgeInfo = STATUS_BADGE[ep.status] || STATUS_BADGE.draft
                return (
                  <div
                    key={ep.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:border-ink-2 hover:shadow-xs"
                  >
                    {/* Card Header: Ep number, title, status, menu */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sand font-mono text-xs font-bold text-ink">
                          {ep.episodeNum}
                        </span>
                        <input
                          defaultValue={ep.title}
                          onBlur={(e) => {
                            const val = e.target.value.trim()
                            if (val && val !== ep.title) {
                              void updateEpisode(ep.id, { title: val })
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 font-display text-sm font-bold text-ink outline-none transition-colors hover:border-line-2 focus:border-ink focus:bg-paper"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Badge tone={badgeInfo.tone} className="text-[11px]">
                          {badgeInfo.label}
                        </Badge>
                        <Menu
                          trigger={(open) => (
                            <IconButton label="Opsi episode" onClick={open} size={28}>
                              <MoreVertical className="size-3.5" />
                            </IconButton>
                          )}
                          items={[
                            {
                              label: 'Sisipkan sebelum',
                              icon: <ArrowUp className="size-3.5" />,
                              run: () => void handleInsertEpisode(idx)
                            },
                            {
                              label: 'Sisipkan sesudah',
                              icon: <ArrowDown className="size-3.5" />,
                              run: () => void handleInsertEpisode(idx + 1)
                            },
                            ...(idx > 0
                              ? [
                                  {
                                    label: 'Pindah ke atas',
                                    icon: <ArrowUp className="size-3.5" />,
                                    run: () => void handleMoveEpisode(idx, -1)
                                  }
                                ]
                              : []),
                            ...(idx < episodes.length - 1
                              ? [
                                  {
                                    label: 'Pindah ke bawah',
                                    icon: <ArrowDown className="size-3.5" />,
                                    run: () => void handleMoveEpisode(idx, 1)
                                  }
                                ]
                              : []),
                            {
                              label: 'Hapus episode',
                              icon: <Trash2 className="size-3.5" />,
                              danger: true,
                              run: () => void handleDeleteEpisode(ep)
                            }
                          ]}
                        />
                      </div>
                    </div>

                    {/* Middle: Hook, Cliffhanger, Summary */}
                    <div className="flex flex-col gap-2.5 rounded-xl border border-line-2/60 bg-paper p-3 text-xs">
                      {/* Hook */}
                      <div className="flex items-center gap-2">
                        <span className="w-24 shrink-0 rounded bg-sand px-1.5 py-0.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted border border-line-2/60">
                          Hook
                        </span>
                        <input
                          defaultValue={ep.hook ?? ''}
                          placeholder="Kejutan pembuka..."
                          onBlur={(e) => void updateEpisode(ep.id, { hook: e.target.value })}
                          className="flex-1 rounded-lg border border-line-2/60 bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-muted/60 transition-colors focus:border-ink"
                        />
                      </div>

                      {/* Cliffhanger */}
                      <div className="flex items-center gap-2">
                        <span className="w-24 shrink-0 rounded bg-sand px-1.5 py-0.5 text-center text-[11px] font-bold uppercase tracking-wider text-muted border border-line-2/60">
                          Cliffhanger
                        </span>
                        <input
                          defaultValue={ep.cliffhanger ?? ''}
                          placeholder="Ketegangan penutup..."
                          onBlur={(e) => void updateEpisode(ep.id, { cliffhanger: e.target.value })}
                          className="flex-1 rounded-lg border border-line-2/60 bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-muted/60 transition-colors focus:border-ink"
                        />
                      </div>

                      {/* Summary / Beats */}
                      <div className="flex flex-col gap-1 border-t border-line pt-2">
                        <span className="font-semibold text-muted text-[11px]">Ringkasan cerita:</span>
                        <AutoTextarea
                          defaultValue={ep.summary ?? ''}
                          placeholder="Inti konflik dan perkembangan adegan di episode ini..."
                          minRows={1}
                          maxHeight={100}
                          onBlur={(e) => void updateEpisode(ep.id, { summary: e.target.value })}
                          className="w-full rounded-lg border border-line-2/60 bg-surface p-2 text-xs text-ink outline-none placeholder:text-muted/60 transition-colors focus:border-ink"
                        />
                      </div>
                    </div>

                    {/* Footer: duration and Open button */}
                    <div className="flex items-center justify-between border-t border-line pt-2.5 text-xs">
                      <div className="flex items-center gap-1.5 text-xs text-muted tabular-nums">
                        <Clock className="size-3" />
                        <span>{ep.durationSec || project.durationSec || 60} dtk</span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleOpenEpisode(ep.id)}
                      >
                        Buka
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
