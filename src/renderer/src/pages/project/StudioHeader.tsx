import { useState, useMemo, useRef } from 'react'
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2, Pencil, MoreVertical, Copy, Download, Trash2, Coins } from 'lucide-react'
import { Button, IconButton, Menu, confirmDialog, cx } from '../../components/ui'
import { Select } from '../../components/Select'
import { Popover } from '../../components/Popover'
import { ThemeToggle } from '../../components/ThemeToggle'
import { relativeTime, errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'

function SaveStatus() {
  const { saveState, saveError, savedAt, save } = useProject()
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-sun-ink">
        <Loader2 className="size-3.5 animate-[spin_0.8s_linear_infinite]" />
        Menyimpan…
      </span>
    )
  }
  if (saveState === 'dirty') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-accent-dark">
        <span className="size-[7px] rounded-full bg-accent" />
        Ada perubahan
      </span>
    )
  }
  if (saveState === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-bad-ink" title={saveError ?? ''}>
        <AlertCircle className="size-3.5" />
        Gagal menyimpan ·
        <button type="button" className="font-semibold underline" onClick={() => void save()}>
          Coba lagi
        </button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-ok-ink">
      <CheckCircle2 className="size-3.5" />
      Tersimpan · {savedAt ? relativeTime(savedAt) : 'baru saja'}
    </span>
  )
}

export function StudioHeader({ onOpenExport }: { onOpenExport?: () => void }) {
  const { project, episode, episodes, switchEpisode, updateProject, flush, jobs } = useProject()
  const { go, toast } = useApp()
  const [editingTitle, setEditingTitle] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const creditAnchor = useRef<HTMLButtonElement | null>(null)

  const episodeOptions = useMemo(() => {
    return episodes.map((ep) => ({
      value: ep.id,
      label: `Ep ${ep.episodeNum}: ${ep.title}`
    }))
  }, [episodes])

  // Count estimated credits used per episode from completed generation jobs
  const episodeCreditsMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const j of Object.values(jobs)) {
      if (j.status === 'done') {
        const payload = (j as any).payload ?? {}
        const creds = typeof payload.credits === 'number' ? payload.credits : j.kind === 'video' ? 10 : 1
        const epKey = j.episodeId || 'unassigned'
        map.set(epKey, (map.get(epKey) ?? 0) + creds)
      }
    }
    return map
  }, [jobs])

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
      toast('info', `Proyek diduplikasi sebagai "${copy.title}"`)
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
      await window.api.projects.remove(project.id)
      toast('info', `Serial "${project.title}" telah dihapus`)
      go({ name: 'home' })
    } catch (err) {
      toast('error', `Gagal menghapus: ${errorText(err)}`)
    }
  }

  return (
    <header className="grid h-16 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-line bg-surface px-4">
      {/* Left: Back button, Serial title, Aspect ratio, Episode selector */}
      <div className="flex min-w-0 items-center gap-3">
        <IconButton
          label="Kembali ke beranda"
          onClick={async () => {
            await flush()
            go({ name: 'home' })
          }}
        >
          <ArrowLeft className="size-[18px]" />
        </IconButton>

        <div className="flex items-center gap-2">
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
              className="h-8 w-56 rounded-lg border border-line-2 bg-paper px-2.5 font-display text-base font-bold text-ink outline-none transition-colors focus:border-ink"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span
                onClick={() => setEditingTitle(true)}
                className="cursor-pointer truncate font-display text-base font-bold text-ink hover:underline"
                title="Klik untuk mengubah judul serial"
              >
                {project.title}
              </span>
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

          <span className="rounded-md border border-line-2 bg-sand px-2 py-0.5 font-mono text-[11px] font-bold text-ink-2">
            {project.aspectRatio}
          </span>
        </div>

        {/* Episode selector */}
        {episodes.length > 0 && episode && (
          <div className="min-w-[180px] max-w-[260px]">
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

      {/* Middle: Save status */}
      <div className="flex items-center justify-center">
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
            <span>{currentEpisodeCredits.toLocaleString('id-ID')} kredit</span>
            {episode && (
              <span className="font-mono text-[10px] text-muted">(Ep {episode.episodeNum})</span>
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
              <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-xs font-bold text-ink">
                <span>Total Seluruh Serial</span>
                <span className="font-mono text-accent-dark">{totalSeriesCredits.toLocaleString('id-ID')} kredit</span>
              </div>
            </div>
          </Popover>
        </div>

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
    </header>
  )
}
