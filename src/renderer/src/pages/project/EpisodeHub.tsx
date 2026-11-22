import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import {
  Plus,
  Minus,
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
  AlertTriangle,
  BookOpen
} from 'lucide-react'
import type { Episode, EpisodeStatus, SourceKind } from '@shared/types'
import {
  calculateSeriesDuration,
  DEFAULT_TARGET_EPISODE_COUNT,
  EPISODE_DURATION_OPTIONS,
  MAX_SERIES_DURATION_SEC,
  MAX_TARGET_EPISODES,
  MIN_TARGET_EPISODES
} from '@shared/validation'
import { Badge, Button, IconButton, Menu, Segmented, confirmDialog, cx } from '../../components/ui'
import { Select } from '../../components/Select'
import { AutoTextarea } from '../../components/AutoTextarea'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { errorText } from '../../lib/format'
import { SeriesGuidelinesModal } from './SeriesGuidelinesModal'

const STATUS_BADGE: Record<EpisodeStatus, { tone: 'draft' | 'info' | 'warn' | 'ok' | 'bad' | 'ink'; label: string }> = {
  draft: { tone: 'draft', label: 'Draf' },
  planned: { tone: 'info', label: 'Siap Naskah' },
  script: { tone: 'info', label: 'Naskah' },
  storyboard: { tone: 'info', label: 'Storyboard' },
  editing: { tone: 'warn', label: 'Editor' },
  exported: { tone: 'ok', label: 'Terekspor' }
}

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
    characters,
    locations,
    props,
    createEpisode,
    updateEpisode,
    removeEpisode,
    removeAllEpisodes,
    reorderEpisodes,
    switchEpisode,
    setActiveView,
    setActiveTab,
    openLorebookAndExtract,
    pendingAutoPlanProjectId,
    consumeAutoPlan,
    flush,
    load
  } = useProject()
  const { toast } = useApp()

  const [isPlanning, setIsPlanning] = useState(false)
  const [planMessage, setPlanMessage] = useState<string | null>(null)
  const [isBatchDrafting, setIsBatchDrafting] = useState(false)
  const [guidelinesOpen, setGuidelinesOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autoPlanRanRef = useRef(false)

  useEffect(() => {
    return window.api.on.storyProgress((progressEvent) => {
      if (progressEvent.projectId === project?.id) {
        setPlanMessage(progressEvent.message)
      }
    })
  }, [project?.id])

  // Auto-plan episodes immediately when created from New Serial modal with "Langsung pecah jadi episode otomatis".
  useEffect(() => {
    if (!project?.id || pendingAutoPlanProjectId !== project.id) return
    if (autoPlanRanRef.current) return
    const text = (project.sourceText || project.synopsis || '').trim()
    consumeAutoPlan()
    if (!text) return
    autoPlanRanRef.current = true
    void handlePlanEpisodes(false)
  }, [pendingAutoPlanProjectId, project?.id])

  if (!project) return null

  const targetEpCount = project.targetEpisodeCount ?? null
  const targetDurationSec = project.durationSec ?? 60
  const { totalEstimatedSec, isOverOneHour } = calculateSeriesDuration(targetEpCount, targetDurationSec)
  const hasStory = !!project.sourceText?.trim() || !!project.synopsis?.trim()
  const hasExtractableContent =
    hasStory ||
    episodes.some((e) => e.summary.trim() || e.hook?.trim() || e.sourceText?.trim() || e.scriptDraft?.shots?.length)
  const hasPlannedEpisodes = episodes.some(
    (e) =>
      e.status !== 'draft' ||
      e.summary.trim().length > 0 ||
      (e.hook ?? '').trim().length > 0 ||
      (e.cliffhanger ?? '').trim().length > 0 ||
      !!e.scriptDraft
  )
  const lorebookEmpty = characters.length === 0 && locations.length === 0 && props.length === 0
  const episodesNeedingDraft = episodes.filter(
    (e) => !e.scriptDraft && (e.status === 'planned' || (e.status === 'draft' && e.summary.trim().length > 0))
  ).length

  const handlePlanEpisodes = async (continuation = false) => {
    if (!hasStory) {
      toast('info', 'Masukkan teks sumber cerita atau premis serial terlebih dahulu.')
      return
    }
    if (isOverOneHour) {
      toast('error', 'Total durasi melebihi batas 1 jam. Sesuaikan target episode atau durasi sebelum melanjutkan.')
      return
    }
    if (!continuation && hasPlannedEpisodes) {
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
        sourceText: project.sourceText || project.synopsis,
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
      // If Lorebook is still empty after fresh serial planning, take the creator directly into auto-extraction.
      if (!continuation && lorebookEmpty && count > 0) {
        load(await window.api.projects.get(project.id), { keepHistory: false })
        openLorebookAndExtract()
        return
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
          `${res.plannedEpisodeIds.length} draf dibuat, ${res.failedEpisodes.length} gagal. Tekan lagi untuk mencoba ulang yang gagal: ${failed}`
        )
      } else if (res.plannedEpisodeIds.length > 0) {
        toast('success', `Draf naskah dibuat untuk ${res.plannedEpisodeIds.length} episode. Buka episode untuk meninjau & mengonfirmasi.`)
      } else {
        toast('info', 'Semua episode sudah memiliki draf naskah atau klip.')
      }
    } catch (err) {
      toast('error', `Gagal menyusun naskah: ${errorText(err)}`)
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

  const handleGoToLorebook = async () => {
    await flush()
    if (lorebookEmpty && hasExtractableContent) {
      openLorebookAndExtract()
    } else {
      setActiveView('lorebook')
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
    setActiveTab('production')
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
    setActiveTab('production')
    setActiveView('episode')
  }

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto bg-paper p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Episode Hub</h1>
            <p className="text-sm text-ink-2">
              Pecah cerita jadi episode, lalu lanjut ke Lorebook untuk tokoh & lokasi.
            </p>
          </div>
          <Button
            variant="accent"
            size="sm"
            className="shrink-0"
            icon={<Sparkles className="size-3.5" />}
            onClick={() => void handleGoToLorebook()}
            title={
              lorebookEmpty && hasStory
                ? 'Buka Lorebook dan langsung ekstrak karakter, kostum, lokasi, dan prop dari cerita dengan AI'
                : 'Buka Lorebook untuk mengelola karakter, lokasi, dan prop'
            }
          >
            Lanjut ke Lorebook
            <ArrowRight className="size-3.5" />
          </Button>
        </div>

        {/* Source Story Card */}
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BookText className="size-4 text-accent" />
                <h2 className="font-display text-sm font-bold text-ink">Sumber Cerita</h2>
              </div>
              <div className="flex items-center gap-2">
                <Segmented<SourceKind>
                  value={project.sourceKind ?? 'novel'}
                  onChange={(v) => updateProject({ sourceKind: v })}
                  options={[
                    { id: 'novel', label: 'Novel / Cerita' },
                    { id: 'screenplay', label: 'Naskah Jadi' }
                  ]}
                  size="sm"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Upload className="size-3.5" />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Unggah
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </div>

            <AutoTextarea
              value={project.sourceText || project.synopsis || ''}
              onChange={(e) => {
                const v = e.target.value
                updateProject({ sourceText: v, ...(!project.synopsis.trim() || project.synopsis === project.sourceText ? { synopsis: v.slice(0, 400) } : {}) })
              }}
              placeholder={
                project.sourceKind === 'screenplay'
                  ? 'Tempel naskah jadi di sini (dialog dan adegan dipertahankan kata per kata)...'
                  : 'Tempel novel, cerpen, atau sinopsis cerita di sini...'
              }
              minRows={3}
              maxHeight={180}
              className="w-full rounded-xl border border-line-2 bg-paper p-3 text-sm text-ink outline-none transition-colors focus:border-ink"
            />

            {/* Compact Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-muted">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <span>Episode:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={targetEpCount == null || targetEpCount <= MIN_TARGET_EPISODES}
                      onClick={() => updateProject({ targetEpisodeCount: Math.max(MIN_TARGET_EPISODES, (targetEpCount ?? 3) - 1) })}
                      className="flex size-7 items-center justify-center rounded-lg border border-line bg-paper text-ink transition-colors hover:bg-surface disabled:opacity-40"
                      title="Kurangi target episode"
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-9 text-center font-mono text-sm font-bold text-ink">
                      {targetEpCount ?? 'Auto'}
                    </span>
                    <button
                      type="button"
                      disabled={targetEpCount != null && targetEpCount >= MAX_TARGET_EPISODES}
                      onClick={() => updateProject({ targetEpisodeCount: Math.min(MAX_TARGET_EPISODES, (targetEpCount ?? 3) + 1) })}
                      className="flex size-7 items-center justify-center rounded-lg border border-line bg-paper text-ink transition-colors hover:bg-surface disabled:opacity-40"
                      title="Tambah target episode"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateProject({ targetEpisodeCount: targetEpCount == null ? DEFAULT_TARGET_EPISODE_COUNT : null })}
                      className={cx(
                        'rounded px-2 py-1 text-[11px] font-semibold transition-colors',
                        targetEpCount == null
                          ? 'bg-accent-soft text-accent-dark'
                          : 'bg-paper text-muted hover:text-ink'
                      )}
                      title={targetEpCount == null ? 'Setel target angka' : 'Otomatis mengikuti panjang cerita'}
                    >
                      Auto
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>Durasi:</span>
                  <div className="w-40">
                    <Select
                      label="Target durasi episode"
                      value={targetDurationSec}
                      options={EPISODE_DURATION_OPTIONS}
                      onChange={(v) => updateProject({ durationSec: Number(v) })}
                      size="sm"
                    />
                  </div>
                </div>

                {totalEstimatedSec != null && (
                  <span className={cx('font-mono font-semibold', isOverOneHour ? 'text-bad' : 'text-ink-2')}>
                    ≈ {formatDuration(totalEstimatedSec)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isPlanning && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-dark">
                    <Loader2 className="size-3.5 animate-spin" />
                    {planMessage || 'Memproses…'}
                  </span>
                )}
                {hasPlannedEpisodes && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isPlanning || !hasStory || isOverOneHour}
                    onClick={() => void handlePlanEpisodes(true)}
                    title="Lanjutkan memecah teks cerita baru yang ditambahkan di bagian bawah"
                  >
                    Lanjutkan cerita baru
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  icon={isPlanning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  disabled={isPlanning || !hasStory || isOverOneHour}
                  onClick={() => void handlePlanEpisodes(false)}
                >
                  {hasPlannedEpisodes ? 'Rencanakan ulang' : 'Pecah jadi episode'}
                </Button>
              </div>
            </div>

            {isOverOneHour && (
              <div className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft/60 px-3 py-2 text-xs text-bad-ink">
                <AlertTriangle className="size-4 shrink-0 text-bad" />
                <span>
                  Total durasi serial maksimal 1 jam (60 menit). Kurangi jumlah episode atau durasinya terlebih dahulu.
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Empty State when no episodes exist */}
        {episodes.length === 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-2 bg-surface p-8 text-center transition-all hover:border-ink hover:bg-paper"
            >
              <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-accent-soft text-accent-dark">
                <Upload className="size-6" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-ink">Unggah file cerita</h3>
                <p className="mt-1 text-xs text-muted">
                  Muat file .txt atau .md untuk dipecah otomatis jadi beberapa episode.
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
                <h3 className="font-display text-base font-bold text-ink">Mulai dari episode manual</h3>
                <p className="mt-1 text-xs text-muted">
                  Buat 1 episode kosong dan tulis rencana shot sendiri dari awal.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Episode Cards Section */}
        {episodes.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-ink-2" />
                <h2 className="font-display text-base font-bold text-ink">Daftar Episode ({episodes.length})</h2>
                <span className="text-xs text-muted">
                  · Est. {formatDuration(episodes.reduce((acc, ep) => acc + (ep.durationSec || targetDurationSec), 0))}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isBatchDrafting && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCancelBatchDrafting()}
                    className="text-bad hover:bg-bad-soft"
                  >
                    Berhenti
                  </Button>
                )}

                {hasPlannedEpisodes && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={isBatchDrafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                    disabled={isBatchDrafting || isPlanning || episodesNeedingDraft === 0}
                    onClick={() => void handlePlanAllScripts()}
                    title="Buat draf naskah shot untuk semua episode yang belum memiliki draf"
                  >
                    {isBatchDrafting
                      ? 'Menyusun naskah…'
                      : episodesNeedingDraft > 0
                        ? `Buat Draf Naskah (${episodesNeedingDraft} ep)`
                        : 'Semua episode sudah bernaskah'}
                  </Button>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="size-3.5" />}
                  disabled={isBatchDrafting || isPlanning}
                  onClick={() => void handleCreateEmptyEpisode()}
                  title="Tambahkan satu episode kosong baru di akhir daftar"
                >
                  Tambah Episode
                </Button>

                <Menu
                  trigger={(open) => (
                    <IconButton label="Opsi daftar episode" onClick={open} size={32}>
                      <MoreVertical className="size-4" />
                    </IconButton>
                  )}
                  items={[
                    {
                      label: 'Arahan & Prompt Serial',
                      icon: <BookOpen className="size-3.5" />,
                      run: () => setGuidelinesOpen(true)
                    },
                    {
                      label: 'Hapus Semua Episode',
                      icon: <Trash2 className="size-3.5" />,
                      danger: true,
                      run: () => void handleDeleteAllEpisodes()
                    }
                  ]}
                />
              </div>
            </div>

            <div className={cx('grid gap-4', episodes.length === 1 ? 'grid-cols-1 max-w-3xl' : 'grid-cols-1 md:grid-cols-2')}>
              {episodes.map((ep, idx) => {
                const badgeInfo =
                  ep.status === 'planned' && ep.scriptDraft
                    ? { tone: 'warn' as const, label: 'Tinjau Naskah' }
                    : STATUS_BADGE[ep.status] || STATUS_BADGE.draft
                return (
                  <div
                    key={ep.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:border-ink-2 hover:shadow-xs"
                  >
                    {/* Card Header: Ep number, title, status, menu */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="flex h-6 shrink-0 items-center justify-center rounded-md bg-sand px-2 font-mono text-xs font-bold text-ink">
                          Ep {ep.episodeNum}
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
                    <div className="flex flex-col gap-2 rounded-xl border border-line-2/60 bg-paper p-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-24 shrink-0 rounded border border-line-2/60 bg-sand px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted">
                          Hook
                        </span>
                        <input
                          defaultValue={ep.hook ?? ''}
                          placeholder="Kejutan pembuka..."
                          onBlur={(e) => void updateEpisode(ep.id, { hook: e.target.value })}
                          className="flex-1 rounded-lg border border-line-2/60 bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-muted/60 transition-colors focus:border-ink"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-24 shrink-0 rounded border border-line-2/60 bg-sand px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted">
                          Cliffhanger
                        </span>
                        <input
                          defaultValue={ep.cliffhanger ?? ''}
                          placeholder="Ketegangan penutup..."
                          onBlur={(e) => void updateEpisode(ep.id, { cliffhanger: e.target.value })}
                          className="flex-1 rounded-lg border border-line-2/60 bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-muted/60 transition-colors focus:border-ink"
                        />
                      </div>

                      <div className="flex flex-col gap-1 border-t border-line pt-2">
                        <span className="text-[11px] font-semibold text-muted">Ringkasan cerita</span>
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

                    {/* Footer: duration and Open Plan button */}
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
                        Buka Produksi
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <SeriesGuidelinesModal
        open={guidelinesOpen}
        onClose={() => setGuidelinesOpen(false)}
      />
    </div>
  )
}
