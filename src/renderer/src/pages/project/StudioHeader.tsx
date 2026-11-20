import { useState, useMemo } from 'react'
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2, Pencil, MoreVertical, Copy, Download, Trash2 } from 'lucide-react'
import { Badge, IconButton, Menu, confirmDialog } from '../../components/ui'
import { Select } from '../../components/Select'
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

  const episodeOptions = useMemo(() => {
    return episodes.map((ep) => ({
      value: ep.id,
      label: `Ep ${ep.episodeNum}: ${ep.title}`
    }))
  }, [episodes])

  // Count estimated credits used from completed generation jobs
  const usedCredits = useMemo(() => {
    let sum = 0
    for (const j of Object.values(jobs)) {
      if (j.status === 'done') {
        const payload = (j as any).payload ?? {}
        sum += typeof payload.credits === 'number' ? payload.credits : 10
      }
    }
    return sum
  }, [jobs])

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
    <header className="grid h-16 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-line bg-surface px-4 shadow-sm">
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
              className="h-8 w-56 rounded-lg border border-ink bg-surface px-2 font-display text-base font-bold outline-none"
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
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-sand hover:text-ink"
              >
                <Pencil className="size-3" />
              </button>
            </div>
          )}

          <Badge tone="ink" className="text-[11px] font-mono">
            {project.aspectRatio}
          </Badge>
        </div>

        {/* Episode selector */}
        {episodes.length > 0 && episode && (
          <div className="w-48">
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
        <div
          className="flex items-center gap-1.5 rounded-full border border-line bg-sand px-3 py-1 text-xs font-semibold text-ink"
          title={`Total estimasi kredit terpakai untuk serial ini: ${usedCredits}`}
        >
          <span className="text-accent-dark">◆</span>
          <span>{usedCredits.toLocaleString()} kredit</span>
        </div>

        <ThemeToggle />

        {onOpenExport && (
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line-2 bg-surface px-3 text-xs font-semibold text-ink hover:border-ink hover:bg-paper"
            title="Ekspor episode aktif"
          >
            <Download className="size-3.5" />
            Ekspor
          </button>
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
