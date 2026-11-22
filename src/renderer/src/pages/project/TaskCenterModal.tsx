import { useState, useMemo } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Film,
  Image,
  Mic,
  RotateCcw,
  Users,
  X,
  XCircle
} from 'lucide-react'
import type { Job, JobKind, JobStatus } from '@shared/types'
import { Badge, Button, Modal, Progress, Segmented, Spinner, confirmDialog, cx } from '../../components/ui'
import { relativeTime, errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { isRunning, useProject } from '../../store/project'

interface TaskCenterModalProps {
  open: boolean
  onClose: () => void
}

type FilterTab = 'all' | 'active' | 'failed' | 'done'

function getKindIcon(kind: JobKind) {
  switch (kind) {
    case 'video':
      return <Film className="size-4 text-accent" />
    case 'image':
      return <Image className="size-4 text-sun" />
    case 'tts':
    case 'narration':
    case 'align':
      return <Mic className="size-4 text-accent-dark" />
    case 'sheet':
      return <Users className="size-4 text-sun-ink" />
    default:
      return <Activity className="size-4 text-muted" />
  }
}

function getKindLabel(kind: JobKind): string {
  switch (kind) {
    case 'video':
      return 'Generate Video AI'
    case 'image':
      return 'Generate Gambar Shot'
    case 'tts':
      return 'Generate Dialog TTS'
    case 'narration':
      return 'Rekaman Narasi Episode'
    case 'align':
      return 'Sinkronisasi Kata Whisper'
    case 'sheet':
      return 'Lembar Referensi Lorebook'
    case 'export':
      return 'Render Ekspor MP4'
    default:
      return kind
  }
}

function getStatusBadge(status: JobStatus) {
  switch (status) {
    case 'running':
      return (
        <Badge tone="warn" className="flex items-center gap-1 text-[11px]">
          <Spinner className="size-3" /> Berjalan
        </Badge>
      )
    case 'queued':
      return (
        <Badge tone="draft" className="text-[11px]">
          Antre
        </Badge>
      )
    case 'done':
      return (
        <Badge tone="ok" className="flex items-center gap-1 text-[11px]">
          <CheckCircle2 className="size-3" /> Selesai
        </Badge>
      )
    case 'failed':
      return (
        <Badge tone="bad" className="flex items-center gap-1 text-[11px]">
          <AlertCircle className="size-3" /> Gagal
        </Badge>
      )
    case 'canceled':
      return (
        <Badge tone="draft" className="flex items-center gap-1 text-[11px]">
          <XCircle className="size-3" /> Dibatalkan
        </Badge>
      )
  }
}

export function TaskCenterModal({ open, onClose }: TaskCenterModalProps) {
  const {
    project,
    jobs,
    episodes,
    clips,
    characters,
    switchEpisode,
    setActiveView,
    setActiveTab,
    select
  } = useProject()
  const { toast } = useApp()

  const [filterTab, setFilterTab] = useState<FilterTab>('active')
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [cancelingAll, setCancelingAll] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  // Sorted list of jobs newest first
  const allJobsList = useMemo(() => {
    return Object.values(jobs).sort((a, b) => b.createdAt - a.createdAt)
  }, [jobs])

  const runningCount = allJobsList.filter((j) => j.status === 'running').length
  const queuedCount = allJobsList.filter((j) => j.status === 'queued').length
  const failedCount = allJobsList.filter((j) => j.status === 'failed').length
  const doneCount = allJobsList.filter((j) => j.status === 'done').length

  const activeCount = runningCount + queuedCount

  // Filtered list
  const filteredJobs = useMemo(() => {
    switch (filterTab) {
      case 'active':
        return allJobsList.filter((j) => j.status === 'running' || j.status === 'queued')
      case 'failed':
        return allJobsList.filter((j) => j.status === 'failed')
      case 'done':
        return allJobsList.filter((j) => j.status === 'done')
      default:
        return allJobsList
    }
  }, [allJobsList, filterTab])

  if (!project) return null

  const handleCancelJob = async (job: Job) => {
    setCancelingId(job.id)
    try {
      await window.api.generate.cancel(job.id)
      toast('info', `Pekerjaan ${getKindLabel(job.kind)} dibatalkan.`)
    } catch (err) {
      toast('error', `Gagal membatalkan pekerjaan: ${errorText(err)}`)
    } finally {
      setCancelingId(null)
    }
  }

  const handleCancelAll = async () => {
    const ok = await confirmDialog({
      title: 'Batalkan Semua Pekerjaan?',
      body: `Ada ${activeCount} pekerjaan yang sedang berjalan atau antre. Semua proses yang belum selesai akan dihentikan.`,
      confirm: 'Batalkan Semua',
      danger: true
    })
    if (!ok) return

    setCancelingAll(true)
    try {
      await window.api.generate.cancelProject(project.id)
      toast('info', 'Semua pekerjaan yang berjalan telah dibatalkan.')
    } catch (err) {
      toast('error', `Gagal membatalkan semua pekerjaan: ${errorText(err)}`)
    } finally {
      setCancelingAll(false)
    }
  }

  const handleRetryJob = async (job: Job) => {
    setRetryingId(job.id)
    try {
      if (job.kind === 'image' && job.clipId) {
        await window.api.generate.clipImage(job.clipId)
      } else if (job.kind === 'video' && job.clipId) {
        await window.api.generate.clipVideo(job.clipId)
      } else if (job.kind === 'tts' && job.clipId) {
        await window.api.generate.clipTts(job.clipId)
      } else if (job.kind === 'sheet' && job.characterId) {
        await window.api.generate.characterSheet(job.characterId)
      } else {
        toast('info', 'Pekerjaan ini tidak mendukung pengulangan otomatis langsung.')
        return
      }
      toast('success', `Pekerjaan ${getKindLabel(job.kind)} dimasukkan kembali ke antrean.`)
    } catch (err) {
      toast('error', `Gagal mengulang pekerjaan: ${errorText(err)}`)
    } finally {
      setRetryingId(null)
    }
  }

  const handleJumpToOrigin = async (job: Job) => {
    onClose()
    if (job.clipId) {
      if (job.episodeId) {
        await switchEpisode(job.episodeId)
      }
      setActiveView('episode')
      setActiveTab('production')
      select(job.clipId)
    } else if (job.characterId) {
      setActiveView('lorebook')
    } else if (job.episodeId) {
      await switchEpisode(job.episodeId)
      setActiveView('episode')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pusat Tugas (Task Center)"
      subtitle="Pantau proses AI di latar belakang, batalkan tugas berjalan, atau coba ulang tugas yang gagal."
      width={740}
    >
      <div className="flex flex-col gap-4">
        {/* Quick summary status strip */}
        <div className="grid grid-cols-4 gap-2 border-b border-line pb-3">
          <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
            <span className="text-[11px] text-muted">Berjalan</span>
            <span className="font-display text-base font-bold text-accent">
              {runningCount}
            </span>
          </div>
          <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
            <span className="text-[11px] text-muted">Antre</span>
            <span className="font-display text-base font-bold text-ink">
              {queuedCount}
            </span>
          </div>
          <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
            <span className="text-[11px] text-muted">Gagal</span>
            <span className={cx('font-display text-base font-bold', failedCount > 0 ? 'text-bad-ink' : 'text-ink')}>
              {failedCount}
            </span>
          </div>
          <div className="flex flex-col rounded-xl border border-line-2/70 bg-paper p-2.5">
            <span className="text-[11px] text-muted">Selesai</span>
            <span className="font-display text-base font-bold text-ok-ink">
              {doneCount}
            </span>
          </div>
        </div>

        {/* Tab & Bulk cancel */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented<FilterTab>
            value={filterTab}
            onChange={setFilterTab}
            options={[
              { id: 'active', label: `Aktif (${activeCount})` },
              { id: 'failed', label: `Gagal (${failedCount})` },
              { id: 'done', label: `Selesai (${doneCount})` },
              { id: 'all', label: `Semua (${allJobsList.length})` }
            ]}
            size="sm"
          />

          {activeCount > 0 && (
            <Button
              variant="danger"
              size="sm"
              icon={<X className="size-3.5" />}
              loading={cancelingAll}
              onClick={handleCancelAll}
            >
              Batalkan Semua ({activeCount})
            </Button>
          )}
        </div>

        {/* Job List */}
        <div className="max-h-[50vh] overflow-y-auto space-y-2.5 pr-1">
          {filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-muted">
              <Clock className="size-8 text-line-2" />
              <span>Tidak ada tugas dalam kategori ini.</span>
            </div>
          ) : (
            filteredJobs.map((job) => {
              const ep = job.episodeId ? episodes.find((e) => e.id === job.episodeId) : null
              const clip = job.clipId ? clips.find((c) => c.id === job.clipId) : null
              const char = job.characterId ? characters.find((c) => c.id === job.characterId) : null

              const canRetry = (job.status === 'failed' || job.status === 'canceled') && Boolean(job.clipId || job.characterId)
              const canJump = Boolean(job.clipId || job.characterId || job.episodeId)

              return (
                <div
                  key={job.id}
                  className={cx(
                    'flex flex-col gap-2 rounded-xl border p-3.5 text-xs transition-colors',
                    job.status === 'running'
                      ? 'border-accent/40 bg-accent-soft/20'
                      : job.status === 'failed'
                        ? 'border-bad/40 bg-bad-soft/25'
                        : 'border-line bg-surface hover:border-line-2'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-paper">
                        {getKindIcon(job.kind)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{getKindLabel(job.kind)}</span>
                          <span className="text-[11px] text-muted">({job.provider})</span>
                        </div>
                        {/* Target Context */}
                        <div className="flex items-center gap-1.5 text-[11px] text-muted mt-0.5">
                          {ep && <span>Ep {ep.episodeNum}</span>}
                          {clip && <span>· Shot #{clip.sort + 1}</span>}
                          {char && <span>· Tokoh: {char.name}</span>}
                          <span>· {relativeTime(job.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {getStatusBadge(job.status)}

                      {isRunning(job) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<X className="size-3 text-bad-ink" />}
                          loading={cancelingId === job.id}
                          onClick={() => void handleCancelJob(job)}
                          title="Batalkan pekerjaan ini"
                        >
                          Batal
                        </Button>
                      )}

                      {canRetry && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<RotateCcw className="size-3" />}
                          loading={retryingId === job.id}
                          onClick={() => void handleRetryJob(job)}
                          title="Coba ulang proses"
                        >
                          Coba Ulang
                        </Button>
                      )}

                      {canJump && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<ExternalLink className="size-3" />}
                          onClick={() => void handleJumpToOrigin(job)}
                          title="Buka adegan atau karakter asal"
                        >
                          Buka
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar or Message */}
                  {job.status === 'running' && (
                    <div className="space-y-1 pt-1">
                      {job.progress > 0 && <Progress value={job.progress} />}
                      {job.message && (
                        <p className="text-[11px] text-accent-dark font-medium">{job.message}</p>
                      )}
                    </div>
                  )}

                  {/* Error message if failed */}
                  {job.status === 'failed' && job.error && (
                    <p className="rounded-lg bg-bad-soft/60 px-2 py-1 text-[11px] text-bad-ink">
                      {job.error}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-line pt-3 mt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </Modal>
  )
}
