import { useState, useMemo, useRef } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Pencil,
  MoreVertical,
  Copy,
  Download,
  Trash2,
  Coins,
  Clapperboard,
  SlidersHorizontal,
  Activity,
  BookOpen
} from 'lucide-react'
import { Button, IconButton, Menu, Segmented, confirmDialog, cx } from '../../components/ui'
import { Select } from '../../components/Select'
import { Popover } from '../../components/Popover'
import { ThemeToggle } from '../../components/ThemeToggle'
import { relativeTime, errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { TaskCenterModal } from './TaskCenterModal'
import { SeriesGuidelinesModal } from './SeriesGuidelinesModal'

function SaveStatus() {
  const { saveState, saveError, savedAt, save } = useProject()
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-sun-ink">
        <Loader2 className="size-3.5 shrink-0 animate-[spin_0.8s_linear_infinite]" />
        Menyimpan…
      </span>
    )
  }
  if (saveState === 'dirty') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-accent-dark">
        <span className="size-[7px] shrink-0 rounded-full bg-accent" />
        Ada perubahan
      </span>
    )
  }
  if (saveState === 'error') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-bad-ink" title={saveError ?? ''}>
        <AlertCircle className="size-3.5 shrink-0" />
        Gagal menyimpan ·
        <button type="button" className="font-semibold underline" onClick={() => void save()}>
          Coba lagi
        </button>
      </span>
    )
  }
  return (
    // Keep the "Tersimpan" label visible at 1180px so the checkmark never floats alone; hide only the relative timestamp.
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-ok-ink" title={savedAt ? `Tersimpan ${relativeTime(savedAt)}` : 'Tersimpan'}>
      <CheckCircle2 className="size-3.5 shrink-0" />
      <span>Tersimpan</span>
      <span className="hidden min-[1400px]:inline">· {savedAt ? relativeTime(savedAt) : 'baru saja'}</span>
    </span>
  )
}

export function StudioHeader({ onOpenExport }: { onOpenExport?: () => void }) {
  const {
    project,
    episode,
    episodes,
    switchEpisode,
    updateProject,
    flush,
    assets,
    jobs,
    activeView,
    activeTab,
    setActiveTab
  } = useProject()
  const { go, toast } = useApp()
  const [editingTitle, setEditingTitle] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [taskCenterOpen, setTaskCenterOpen] = useState(false)
  const [guidelinesOpen, setGuidelinesOpen] = useState(false)
  const creditAnchor = useRef<HTMLButtonElement | null>(null)

  const activeJobsCount = useMemo(() => {
    return Object.values(jobs).filter((j) => j.status === 'running' || j.status === 'queued').length
  }, [jobs])

  const episodeOptions = useMemo(() => {
    return episodes.map((ep) => ({
      value: ep.id,
      // Titles like "Episode 1: Awal Mula" would read "Ep 1: Episode 1: …", so the repeated number is dropped.
      label: `Ep ${ep.episodeNum} · ${ep.title.replace(/^\s*(episode|ep)\.?\s*\d+\s*[:\-–—·]?\s*/i, '') || ep.title}`
    }))
  }, [episodes])

  // Credits are read from results: Higgsfield's quote is stored on each image/video it made. Flow2API results and
  // older ones carry none, so they add nothing instead of a guessed price.
  const episodeCreditsMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of Object.values(assets)) {
      const creds = a.meta.credits
      if (typeof creds !== 'number' || !Number.isFinite(creds)) continue
      const epKey = a.episodeId || 'series'
      map.set(epKey, (map.get(epKey) ?? 0) + creds)
    }
    return map
  }, [assets])

  const currentEpisodeCredits = episode?.id ? episodeCreditsMap.get(episode.id) ?? 0 : 0
  const totalSeriesCredits = useMemo(() => {
    let sum = 0
    for (const c of episodeCreditsMap.values()) sum += c
    return sum
  }, [episodeCreditsMap])

  if (!project) return null

  const handleDuplicate = async () => {
    try {
      await flush()
      const copy = await window.api.projects.duplicate(project.id)
      toast('info', `Serial diduplikasi sebagai "${copy.title}"`)
    } catch (err) {
      toast('error', `Gagal menduplikasi: ${errorText(err)}`)
    }
  }

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: 'Hapus serial ini?',
      body: `Semua episode, klip, naskah, dan rekaman dalam "${project.title}" akan dihapus permanen.`,
      confirm: 'Hapus serial',
      danger: true
    })
    if (!ok) return
    try {
      const deletedTitle = project.title
      await window.api.projects.remove(project.id)
      // Unload before navigating away so ProjectPage unmount does not flush a deleted project.
      useProject.getState().unload()
      toast('info', `Serial "${deletedTitle}" telah dihapus`)
      go({ name: 'home' })
    } catch (err) {
      toast('error', `Gagal menghapus: ${errorText(err)}`)
    }
  }

  return (
    <header className="grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line bg-surface px-4">
      {/* Left: Back button, Serial title, Aspect ratio, Episode selector */}
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButton
          label="Kembali ke beranda"
          onClick={async () => {
            await flush()
            go({ name: 'home' })
          }}
        >
          <ArrowLeft className="size-[18px]" />
        </IconButton>

        <div className="flex min-w-0 items-center gap-2">
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={project.title}
              aria-label="Judul serial"
              onBlur={(e) => {
                updateProject({ title: e.target.value.trim() || project.title })
                setEditingTitle(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              className="h-8 w-44 rounded-lg border border-line-2 bg-paper px-2.5 font-display text-base font-bold text-ink outline-none transition-colors focus:border-ink xl:w-56"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="block min-w-0 max-w-[130px] cursor-pointer truncate rounded font-display text-left text-base font-bold text-ink hover:underline xl:max-w-[220px]"
                title="Klik untuk mengubah judul serial"
              >
                {project.title}
              </button>
              <button
                type="button"
                aria-label="Ganti nama serial"
                onClick={() => setEditingTitle(true)}
                className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted transition-colors hover:border-line-2 hover:bg-sand hover:text-ink"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          )}

          <span className="shrink-0 rounded-md border border-line-2 bg-sand px-2 py-0.5 font-mono text-[11px] font-bold text-ink-2">
            {project.aspectRatio}
          </span>
        </div>

        {/* Episode selector */}
        {episodes.length > 0 && episode && (
          <div className="w-[140px] shrink-0 xl:w-[180px]">
            <Select
              label="Pilih episode"
              value={episode.id}
              options={episodeOptions}
              onChange={(epId) => void switchEpisode(epId)}
              size="sm"
            />
          </div>
        )}
      </div>

      {/* Middle: Step Tabs (when in episode view) & Save status */}
      <div className="flex min-w-0 items-center justify-center gap-3">
        {activeView === 'episode' && episode && (
          <Segmented
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                id: 'production',
                label: (
                  <span className="flex items-center gap-1.5 text-xs">
                    <Clapperboard className="size-3.5" /> Produksi
                  </span>
                )
              },
              {
                id: 'editor',
                label: (
                  <span className="flex items-center gap-1.5 text-xs">
                    <SlidersHorizontal className="size-3.5" /> Editor &amp; Rilis
                  </span>
                )
              }
            ]}
            size="sm"
          />
        )}
        <SaveStatus />
      </div>

      {/* Right: Credits, Menu, Theme */}
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <button
            ref={creditAnchor}
            type="button"
            onClick={() => setCreditOpen((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-full border border-line bg-sand px-3 py-1 text-xs font-semibold text-ink hover:border-ink"
            title={`Total kredit terpakai di Ep ${episode?.episodeNum ?? 1}: ${currentEpisodeCredits}. Klik untuk rincian semua episode.`}
          >
            <span className="text-accent-dark">◆</span>
            <span className="tabular-nums">{currentEpisodeCredits.toLocaleString('id-ID')} kredit</span>
            {episode && (
              <span className="hidden text-xs text-muted tabular-nums min-[1400px]:inline">(Ep {episode.episodeNum})</span>
            )}
          </button>
          <Popover
            anchor={creditAnchor}
            open={creditOpen}
            onClose={() => setCreditOpen(false)}
            width={280}
            align="right"
          >
            <div className="flex flex-col gap-2.5 p-3.5">
              <div className="flex items-center gap-2 border-b border-line pb-2">
                <Coins className="size-4 text-accent" />
                <span className="font-display text-xs font-bold text-ink">Penggunaan Kredit Serial</span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                {episodes.map((ep) => {
                  const creds = episodeCreditsMap.get(ep.id) ?? 0
                  const isCur = ep.id === episode?.id
                  return (
                    <div
                      key={ep.id}
                      className={cx(
                        'flex items-center justify-between rounded-lg px-2 py-1',
                        isCur ? 'bg-sun-soft font-semibold text-sun-ink' : 'text-ink'
                      )}
                    >
                      <span className="truncate">Ep {ep.episodeNum}: {ep.title}</span>
                      <span className="font-mono text-[11px]">{creds.toLocaleString('id-ID')} kr</span>
                    </div>
                  )
                })}
              </div>
              {(episodeCreditsMap.get('series') ?? 0) > 0 && (
                <div className="flex items-center justify-between px-2 text-xs text-ink-2">
                  <span>Lembar Lorebook</span>
                  <span className="font-mono text-[11px]">{(episodeCreditsMap.get('series') ?? 0).toLocaleString('id-ID')} kr</span>
                </div>
              )}
              <p className="px-2 text-[11px] leading-snug text-muted">Dihitung dari harga Higgsfield tiap hasil. Hasil Flow2API tidak memakai kredit.</p>
              <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-xs font-bold text-ink">
                <span>Total Seluruh Serial</span>
                <span className="font-mono text-accent-dark">{totalSeriesCredits.toLocaleString('id-ID')} kredit</span>
              </div>
            </div>
          </Popover>
        </div>

        <Button
          variant={activeJobsCount > 0 ? 'accent' : 'secondary'}
          size="sm"
          icon={activeJobsCount > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5 text-accent" />}
          onClick={() => setTaskCenterOpen(true)}
          title="Pusat Tugas (Task Center): pantau dan batalkan pekerjaan AI latar belakang"
        >
          <span>Tugas</span>
          {activeJobsCount > 0 && (
            <span className="flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">
              {activeJobsCount}
            </span>
          )}
        </Button>

        <ThemeToggle />

        {onOpenExport && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="size-3.5" />}
            onClick={onOpenExport}
            title="Ekspor episode aktif"
          >
            Ekspor
          </Button>
        )}

        <Menu
          trigger={(open) => (
            <IconButton label="Menu lainnya" onClick={open} size={36}>
              <MoreVertical className="size-4" />
            </IconButton>
          )}
          items={[
            {
              label: 'Arahan & Template Prompt',
              icon: <BookOpen className="size-4" />,
              run: () => setGuidelinesOpen(true)
            },
            {
              label: 'Duplikasi serial',
              icon: <Copy className="size-4" />,
              run: () => void handleDuplicate()
            },
            {
              label: 'Hapus serial',
              icon: <Trash2 className="size-4" />,
              danger: true,
              run: () => void handleDelete()
            }
          ]}
        />
      </div>

      <TaskCenterModal
        open={taskCenterOpen}
        onClose={() => setTaskCenterOpen(false)}
      />

      <SeriesGuidelinesModal
        open={guidelinesOpen}
        onClose={() => setGuidelinesOpen(false)}
      />
    </header>
  )
}
