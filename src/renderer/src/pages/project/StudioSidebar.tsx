import { useState } from 'react'
import { LayoutGrid, BookOpen, PanelLeftClose, PanelLeft, Plus } from 'lucide-react'
import type { EpisodeStatus } from '@shared/types'
import { cx } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'

const STATUS_DOT: Record<EpisodeStatus, string> = {
  draft: 'bg-sand border border-line-2',
  planned: 'bg-info-ink',
  script: 'bg-sun-ink',
  storyboard: 'bg-accent',
  editing: 'bg-accent-dark',
  exported: 'bg-ok-ink'
}

const STATUS_LABEL: Record<EpisodeStatus, string> = {
  draft: 'Draf',
  planned: 'Siap Naskah',
  script: 'Naskah',
  storyboard: 'Produksi',
  editing: 'Editor',
  exported: 'Terekspor'
}

export function StudioSidebar() {
  const {
    activeView,
    setActiveView,
    setActiveTab,
    sidebarCollapsed,
    toggleSidebar,
    episodes,
    episode,
    characters,
    locations,
    props,
    switchEpisode,
    createEpisode
  } = useProject()
  const { toast } = useApp()
  const [creating, setCreating] = useState(false)

  const missingSheetsCount =
    characters.filter((c) => !c.sheetAssetId).length +
    locations.filter((l) => !l.sheetAssetId).length +
    props.filter((p) => !p.sheetAssetId).length

  const handleOpenEpisode = async (epId: string) => {
    try {
      await switchEpisode(epId)
      // Preserve whichever episode tab (Produksi / Editor & Rilis) the creator is currently using.
      setActiveView('episode')
    } catch (err) {
      toast('error', `Gagal membuka episode: ${errorText(err)}`)
    }
  }

  const handleAddEpisode = async () => {
    if (creating) return
    setCreating(true)
    try {
      const nextNum = episodes.length + 1
      const newEp = await createEpisode({
        title: `Episode ${nextNum}`,
        episodeNum: nextNum
      })
      await switchEpisode(newEp.id)
      setActiveTab('production')
      setActiveView('episode')
    } catch (err) {
      toast('error', `Gagal menambah episode: ${errorText(err)}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <aside
      className={cx(
        'flex shrink-0 flex-col border-r border-line bg-surface transition-all duration-200 select-none',
        sidebarCollapsed ? 'w-12 items-center' : 'w-[220px]'
      )}
    >
      {/* Top bar: Collapse toggle */}
      <div className={cx('flex h-12 w-full items-center border-b border-line px-2.5', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {!sidebarCollapsed && <span className="font-display text-xs font-bold uppercase tracking-wider text-muted">Studio</span>}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Buka bilah samping' : 'Ciutkan bilah samping'}
          aria-expanded={!sidebarCollapsed}
          className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sand hover:text-ink"
          title={sidebarCollapsed ? 'Buka bilah samping (≡)' : 'Ciutkan bilah samping'}
        >
          {sidebarCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      {/* Main navigation: Hub & Lorebook */}
      <div className="flex w-full flex-col gap-1 p-1.5">
        <button
          type="button"
          onClick={() => setActiveView('hub')}
          aria-label="Episode Hub"
          aria-current={activeView === 'hub' ? 'page' : undefined}
          title="Episode Hub"
          className={cx(
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
            activeView === 'hub' ? 'bg-sun-soft text-ink' : 'text-ink-2 hover:bg-sand hover:text-ink',
            sidebarCollapsed && 'justify-center px-0'
          )}
        >
          <LayoutGrid className="size-4 shrink-0" />
          {!sidebarCollapsed && <span>Episode Hub</span>}
        </button>

        <button
          type="button"
          onClick={() => setActiveView('lorebook')}
          aria-label={
            missingSheetsCount > 0
              ? `Dunia & Pemeran (${missingSheetsCount} lembar belum dibuat)`
              : 'Dunia & Pemeran'
          }
          aria-current={activeView === 'lorebook' ? 'page' : undefined}
          title={
            missingSheetsCount > 0
              ? `Dunia & Pemeran (${missingSheetsCount} lembar belum dibuat)`
              : 'Dunia & Pemeran (Lorebook)'
          }
          className={cx(
            'relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
            activeView === 'lorebook' ? 'bg-sun-soft text-ink' : 'text-ink-2 hover:bg-sand hover:text-ink',
            sidebarCollapsed && 'justify-center px-0'
          )}
        >
          <BookOpen className="size-4 shrink-0" />
          {!sidebarCollapsed && <span className="flex-1 truncate text-left">Dunia &amp; Pemeran</span>}
          {!sidebarCollapsed && missingSheetsCount > 0 && (
            <span className="rounded-full bg-sun-soft px-1.5 py-0.5 font-mono text-[11px] font-bold text-sun-ink">
              {missingSheetsCount}
            </span>
          )}
          {sidebarCollapsed && missingSheetsCount > 0 && (
            <span
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent"
              aria-hidden="true"
            />
          )}
        </button>
      </div>

      <div className="w-full px-2">
        <div className="border-t border-line" />
      </div>

      {/* Episode section header */}
      <div className={cx('flex w-full items-center px-2.5 pt-3 pb-1', sidebarCollapsed ? 'justify-center' : 'justify-between')}>
        {!sidebarCollapsed ? (
          <>
            <span className="font-display text-[11px] font-bold tracking-wider text-muted uppercase">Episode</span>
            <button
              type="button"
              disabled={creating}
              aria-label="Tambah episode baru"
              onClick={() => void handleAddEpisode()}
              className="flex size-6 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sand hover:text-ink disabled:opacity-40"
              title="Tambah episode baru"
            >
              <Plus className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={creating}
            aria-label="Tambah episode baru"
            onClick={() => void handleAddEpisode()}
            className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sand hover:text-ink disabled:opacity-40"
            title="Tambah episode baru"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {/* Episode list */}
      <div className="scroll-thin flex flex-1 w-full flex-col gap-1 overflow-y-auto p-1.5">
        {episodes.map((ep) => {
          const isActive = activeView === 'episode' && episode?.id === ep.id
          const dotClass = STATUS_DOT[ep.status] || STATUS_DOT.draft

          if (sidebarCollapsed) {
            return (
              <button
                key={ep.id}
                type="button"
                aria-label={`Episode ${ep.episodeNum}: ${ep.title} (${STATUS_LABEL[ep.status]})`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => void handleOpenEpisode(ep.id)}
                title={`Ep ${ep.episodeNum}: ${ep.title} (${STATUS_LABEL[ep.status]})`}
                className={cx(
                  'relative flex size-8 items-center justify-center rounded-lg font-mono text-xs font-bold transition-colors',
                  isActive ? 'bg-sun-soft text-ink' : 'text-ink-2 hover:bg-sand hover:text-ink'
                )}
              >
                <span>{ep.episodeNum}</span>
                <span className={cx('absolute right-1 bottom-1 size-1.5 rounded-full', dotClass)} />
              </button>
            )
          }

          return (
            <button
              key={ep.id}
              type="button"
              aria-label={`Episode ${ep.episodeNum}: ${ep.title} (${STATUS_LABEL[ep.status]})`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => void handleOpenEpisode(ep.id)}
              className={cx(
                'group flex h-8 w-full items-center justify-between rounded-lg px-2 text-xs transition-colors',
                isActive ? 'bg-sun-soft text-ink font-semibold' : 'text-ink-2 hover:bg-sand hover:text-ink'
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="font-mono text-muted group-hover:text-ink-2">{ep.episodeNum}</span>
                <span className="truncate">{ep.title}</span>
              </div>
              <span className={cx('size-2 shrink-0 rounded-full', dotClass)} title={STATUS_LABEL[ep.status]} />
            </button>
          )
        })}
      </div>
    </aside>
  )
}
