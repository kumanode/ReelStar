import { useEffect, useState } from 'react'
import { withActiveTts } from '@shared/providers'
import type { AppSettings, Project } from '@shared/types'

/**
 * The open project with the global TTS provider applied (see withActiveTts). Voice pickers and the "voice made
 * for another provider" note read this, so they match what narration and clip TTS will actually use.
 */
export function useTtsProject(project: Project | null): Project | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  useEffect(() => {
    void window.api.settings.get().then(setSettings).catch(() => setSettings(null))
  }, [])
  return project ? withActiveTts(project, settings) : null
}
