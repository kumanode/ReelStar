import { LayoutGrid, BookOpen, PanelLeftClose, PanelLeft, Plus } from 'lucide-react'
import type { EpisodeStatus } from '@shared/types'
import { cx } from '../../components/ui'
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
  planned: 'Direncanakan',
  script: 'Naskah',
  storyboard: 'Storyboard',
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
    switchEpisode,
    createEpisode
  } = useProject()

  const handleOpenEpisode = async (epId: string) => {
    await switchEpisode(epId)
    setActiveTab('plan')
    setActiveView('episode')
  }

  const handleAddEpisode = async () => {
    const nextNum = episodes.length + 1
    const newEp = await createEpisode({
      title: `Episode ${nextNum}`,
      episodeNum: nextNum
    })
    await switchEpisode(newEp.id)
    setActiveTab('plan')
    setActiveView('episode')
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
          title="Lorebook"
          className={cx(
            'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
            activeView === 'lorebook' ? 'bg-sun-soft text-ink' : 'text-ink-2 hover:bg-sand hover:text-ink',
            sidebarCollapsed && 'justify-center px-0'
          )}
        >
          <BookOpen className="size-4 shrink-0" />
          {!sidebarCollapsed && <span>Lorebook</span>}
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
              onClick={() => void handleAddEpisode()}
              className="flex size-6 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sand hover:text-ink"
              title="Tambah episode baru"
            >
              <Plus className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleAddEpisode()}
            className="flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sand hover:text-ink"
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
