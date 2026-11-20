import { useState, useRef, type ChangeEvent } from 'react'
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
  Layers
} from 'lucide-react'
import type { Episode, EpisodeStatus, SourceKind } from '@shared/types'
import { Badge, Button, IconButton, Menu, Segmented, confirmDialog } from '../../components/ui'
import { AutoTextarea } from '../../components/AutoTextarea'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { errorText } from '../../lib/format'

const STATUS_BADGE: Record<EpisodeStatus, { tone: 'draft' | 'info' | 'warn' | 'ok' | 'bad' | 'ink'; label: string }> = {
  draft: { tone: 'draft', label: 'Draf' },
  planned: { tone: 'warn', label: 'Direncanakan' },
  script: { tone: 'info', label: 'Naskah' },
  storyboard: { tone: 'info', label: 'Storyboard' },
  editing: { tone: 'warn', label: 'Editor' },
  exported: { tone: 'ok', label: 'Terekspor' }
}

export function EpisodeHub() {
  const {
    project,
    updateProject,
    episodes,
    createEpisode,
    updateEpisode,
    removeEpisode,
    reorderEpisodes,
    switchEpisode,
    setActiveView
  } = useProject()
  const { toast } = useApp()

  const [showSource, setShowSource] = useState(Boolean(project?.sourceText))
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!project) return null

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
    // Reorder episodes array with new episode inserted at atIndex
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
          <div className="flex items-center gap-2">
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
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
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

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted">
                <div className="flex items-center gap-4">
                  <span>{(project.sourceText ?? '').length.toLocaleString()} karakter</span>
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    <span>Target durasi default: {project.durationSec ?? 60} dtk/episode</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ink"
                    size="sm"
                    icon={<Sparkles className="size-3.5 text-sun" />}
                    onClick={() => {
                      toast('info', 'Planner AI otomatis akan diaktifkan di Fase 3. Kamu bisa membuat dan menyusun episode secara langsung sekarang.')
                    }}
                  >
                    Pecah jadi episode
                  </Button>
                </div>
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
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-2 bg-surface p-8 text-center transition-all hover:border-ink hover:bg-sand/30"
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent-dark">
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
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line-2 bg-surface p-8 text-center transition-all hover:border-ink hover:bg-sand/30"
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-sun-soft text-sun-ink">
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="size-4 text-ink-2" />
                <h2 className="font-display text-base font-bold text-ink">Daftar Episode ({episodes.length})</h2>
              </div>
              {!showSource && (
                <button
                  type="button"
                  onClick={() => setShowSource(true)}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Tampilkan sumber cerita
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {episodes.map((ep, idx) => {
                const badgeInfo = STATUS_BADGE[ep.status] || STATUS_BADGE.draft
                return (
                  <div
                    key={ep.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm transition-all hover:border-ink-2"
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
                          className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-0.5 font-display text-sm font-bold text-ink outline-none hover:border-line focus:border-ink focus:bg-paper"
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
                    <div className="flex flex-col gap-2 rounded-xl bg-paper/60 p-2.5 text-xs">
                      {/* Hook */}
                      <div className="flex items-baseline gap-1.5">
                        <Badge tone="ink" className="px-1.5 py-0 text-[10px]">Hook</Badge>
                        <input
                          defaultValue={ep.hook ?? ''}
                          placeholder="Kejutan pembuka..."
                          onBlur={(e) => void updateEpisode(ep.id, { hook: e.target.value })}
                          className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-ink outline-none placeholder:text-muted/60 hover:border-line focus:border-ink focus:bg-surface"
                        />
                      </div>

                      {/* Cliffhanger */}
                      <div className="flex items-baseline gap-1.5">
                        <Badge tone="ink" className="px-1.5 py-0 text-[10px]">Cliffhanger</Badge>
                        <input
                          defaultValue={ep.cliffhanger ?? ''}
                          placeholder="Ketegangan penutup..."
                          onBlur={(e) => void updateEpisode(ep.id, { cliffhanger: e.target.value })}
                          className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-ink outline-none placeholder:text-muted/60 hover:border-line focus:border-ink focus:bg-surface"
                        />
                      </div>

                      {/* Summary / Beats */}
                      <div className="flex flex-col gap-1 border-t border-line/60 pt-1.5">
                        <span className="font-semibold text-muted">Ringkasan cerita:</span>
                        <AutoTextarea
                          defaultValue={ep.summary ?? ''}
                          placeholder="Inti konflik dan perkembangan adegan di episode ini..."
                          minRows={1}
                          maxHeight={100}
                          onBlur={(e) => void updateEpisode(ep.id, { summary: e.target.value })}
                          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-muted/60 hover:border-line focus:border-ink focus:bg-surface"
                        />
                      </div>
                    </div>

                    {/* Footer: duration and Open button */}
                    <div className="flex items-center justify-between border-t border-line pt-2 text-xs">
                      <div className="flex items-center gap-1 text-muted">
                        <Clock className="size-3" />
                        <span>{ep.durationSec || project.durationSec || 60} dtk</span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<ArrowRight className="size-3.5" />}
                        onClick={() => void handleOpenEpisode(ep.id)}
                      >
                        Buka
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
