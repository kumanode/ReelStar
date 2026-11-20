import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui'
import { errorText } from '../../lib/format'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'
import { StudioHeader } from './StudioHeader'
import { StudioSidebar } from './StudioSidebar'
import { EpisodeHub } from './EpisodeHub'
import { LorebookPage } from './LorebookPage'
import { PlanStep } from './PlanStep'
import { StoryboardStep } from './StoryboardStep'
import { EditorStep } from './EditorStep'
import { ExportDialog } from './ExportDialog'

export function ProjectPage({ id }: { id: string }) {
  const { load, unload, loaded, project, activeView, activeTab } = useProject()
  const { toast, go } = useApp()
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.projects
      .get(id)
      .then((b) => alive && load(b))
      .catch((e) => {
        toast('error', errorText(e))
        go({ name: 'home' })
      })
    return () => {
      alive = false
      void useProject.getState().flush().then(unload)
    }
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void useProject.getState().save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded || !project)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-2">
        <Spinner />
        Membuka serial…
      </div>
    )

  return (
    <div className="flex h-full flex-col bg-paper">
      <StudioHeader onOpenExport={() => setExportOpen(true)} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <StudioSidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {activeView === 'hub' && <EpisodeHub />}
          {activeView === 'lorebook' && <LorebookPage />}
          {activeView === 'episode' && (
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab === 'plan' && <PlanStep />}
              {activeTab === 'storyboard' && <StoryboardStep />}
              {activeTab === 'editor' && <EditorStep />}
            </div>
          )}
        </main>
      </div>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}
