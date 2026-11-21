import { create } from 'zustand'
import type {
  Asset,
  Character,
  CharacterDerivative,
  Clip,
  ContinuityItem,
  ContinuityKind,
  ContinuityStatus,
  ContinuityTier,
  Episode,
  Job,
  Location,
  Project,
  ProjectBundle,
  ProjectSnapshot,
  Prop,
  WordTiming
} from '@shared/types'
import { errorText } from '../lib/format'
import { useApp } from './app'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface ProjectState {
  loaded: boolean
  project: Project | null
  episode: Episode | null
  episodes: Episode[]
  derivatives: CharacterDerivative[]
  locations: Location[]
  props: Prop[]
  characters: Character[]
  continuityItems: ContinuityItem[]
  clips: Clip[]
  assets: Record<string, Asset>
  jobs: Record<string, Job>
  saveState: SaveState
  saveError: string | null
  savedAt: number | null
  selectedClipId: string | null
  canUndo: boolean
  canRedo: boolean

  activeView: 'hub' | 'lorebook' | 'episode'
  activeTab: 'plan' | 'storyboard' | 'editor'
  sidebarCollapsed: boolean

  setActiveView(view: 'hub' | 'lorebook' | 'episode'): void
  setActiveTab(tab: 'plan' | 'storyboard' | 'editor'): void
  setSidebarCollapsed(collapsed: boolean): void
  toggleSidebar(): void

  switchEpisode(episodeId: string): Promise<void>
  createEpisode(input?: Partial<Episode>): Promise<Episode>
  updateEpisode(id: string, patch: Partial<Episode>): Promise<void>
  removeEpisode(id: string): Promise<void>
  removeAllEpisodes(): Promise<void>
  reorderEpisodes(episodeIds: string[]): Promise<void>
  refreshEpisodes(): Promise<void>

  addDerivative(input: { characterId: string; name: string; promptChange?: string }): Promise<CharacterDerivative>
  updateDerivative(id: string, patch: Partial<CharacterDerivative>): Promise<void>
  removeDerivative(id: string): Promise<void>

  addLocation(input: { name: string; description?: string; aliases?: string[] }): Promise<Location>
  updateLocation(id: string, patch: Partial<Location>): Promise<void>
  removeLocation(id: string): Promise<void>

  addProp(input: { name: string; description?: string; aliases?: string[] }): Promise<Prop>
  updateProp(id: string, patch: Partial<Prop>): Promise<void>
  removeProp(id: string): Promise<void>

  refreshLorebook(): Promise<void>

  loadContinuityItems(projectId?: string): Promise<void>
  addContinuityItem(input: {
    kind: ContinuityKind
    name: string
    detail?: string
    plantedEpisodeId: string
    tier?: ContinuityTier
    status?: ContinuityStatus
  }): Promise<ContinuityItem>
  updateContinuityItem(
    id: string,
    patch: Partial<Pick<ContinuityItem, 'name' | 'detail' | 'status' | 'tier' | 'payoffEpisodeId'>>
  ): Promise<void>
  removeContinuityItem(id: string): Promise<void>

  load(bundle: ProjectBundle, opts?: { keepHistory?: boolean }): void
  unload(): void
  select(clipId: string | null): void
  checkpoint(): void
  beginHistoryGesture(): void
  endHistoryGesture(): void
  undo(): void
  redo(): void
  /** Saves caption words typed or retimed by the user; unlike a caption sync, this can be undone. */
  editWords(assetId: string, words: WordTiming[]): Promise<Asset>
  updateProject(patch: Partial<Project>): void
  updateEditor(patch: Partial<Project['editor']>): void
  applyEditor(patch: Partial<Project['editor']>): void
  updateClip(id: string, patch: Partial<Clip>): void
  updateClips(patch: Partial<Clip>): void
  updateCharacter(id: string, patch: Partial<Character>): void
  addClip(afterId: string | null): string
  removeClip(id: string): void
  moveClip(id: string, dir: -1 | 1): void
  addCharacter(init?: { name: string; description: string; ttsVoice?: string | null; ttsProvider?: Character['ttsProvider'] }): string
  removeCharacter(id: string): void
  save(): Promise<void>
  flush(): Promise<void>

  applyClip(clipId: string, patch: Partial<Clip>): void
  applyCharacter(characterId: string, patch: Partial<Character>): void
  /** Adds a character the main process already saved, so the next save does not drop it. */
  receiveCharacter(character: Character): void
  addAsset(asset: Asset): void
  upsertJob(job: Job): void
}

interface HistoryEntry {
  project: Project
  episode?: Episode | null
  characters: Character[]
  clips: Clip[]
  assets: Record<string, Asset>
  selectedClipId: string | null
}

const MAX_HISTORY = 30
const HISTORY_COOLDOWN_MS = 400
let past: HistoryEntry[] = []
let future: HistoryEntry[] = []
let lastHistoryTime = -Infinity
let historyGestureDepth = 0
const copyAssetIndex = (assets: Record<string, Asset>): Record<string, Asset> => ({ ...assets })

function recordHistory(get: () => ProjectState, set: (patch: Partial<ProjectState>) => void, force = false): void {
  const s = get()
  if (!s.project) return
  if (historyGestureDepth > 0 && !force) return
  const now = performance.now()
  if (!force && now - lastHistoryTime < HISTORY_COOLDOWN_MS) {
    return
  }
  lastHistoryTime = now
  const entry: HistoryEntry = {
    project: structuredClone(s.project),
    episode: s.episode ? structuredClone(s.episode) : null,
    characters: structuredClone(s.characters),
    clips: structuredClone(s.clips),
    assets: copyAssetIndex(s.assets),
    selectedClipId: s.selectedClipId
  }
  past.push(entry)
  if (past.length > MAX_HISTORY) past.shift()
  future = []
  set({ canUndo: true, canRedo: false })
}

function rebaseClip(clipId: string, patch: Partial<Clip>): void {
  for (const entry of [...past, ...future]) {
    entry.clips = entry.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip)
  }
}

// Word saves started here, per asset. Main emits the updated asset before the save resolves, so a counted
// asset event is the user's own edit; any other change to existing words comes from a job (Whisper sync).
const pendingWordEdits = new Map<string, number>()

function sendWords(assetId: string, words: WordTiming[]): Promise<Asset> {
  pendingWordEdits.set(assetId, (pendingWordEdits.get(assetId) ?? 0) + 1)
  return window.api.assets.setWords(assetId, words).finally(() => {
    const left = (pendingWordEdits.get(assetId) ?? 1) - 1
    if (left > 0) pendingWordEdits.set(assetId, left)
    else pendingWordEdits.delete(assetId)
  })
}

function rebaseAsset(asset: Asset, fromJob: boolean): void {
  for (const entry of [...past, ...future]) {
    // A job's new caption timing replaces the old one everywhere, so undo never brings back estimated words.
    if (!entry.assets[asset.id] || fromJob) entry.assets = { ...entry.assets, [asset.id]: asset }
  }
}

function restoreWords(assetId: string, words: Asset['meta']['words']): void {
  void sendWords(assetId, words ?? []).catch((error: unknown) => {
    useApp.getState().toast('error', `Caption tidak tersimpan: ${errorText(error)}`)
  })
}

const AUTOSAVE_MS = 1200
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let changedDuringSave = false

function snapshot(s: ProjectState): ProjectSnapshot {
  const { createdAt: _c, updatedAt: _u, coverAssetId: _cv, ...project } = s.project!
  return {
    project,
    episodeId: s.episode?.id || '',
    // project.editor holds the active episode's timeline settings (see getBundle).
    episodeEditor: s.project!.editor,
    characters: s.characters.map(({ sheetAssetId: _s, ...c }) => c),
    clips: s.clips.map(({ imageAssetId: _i, videoAssetId: _v, audioAssetId: _a, ...c }) => c)
  }
}

const newId = (): string => crypto.randomUUID()

export const useProject = create<ProjectState>((set, get) => {
  const touch = (): void => {
    if (get().saveState === 'saving') changedDuringSave = true
    set({ saveState: get().saveState === 'saving' ? 'saving' : 'dirty' })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void get().save(), AUTOSAVE_MS)
  }
  const resort = (clips: Clip[]): Clip[] => clips.map((c, i) => ({ ...c, sort: i }))

  return {
    loaded: false,
    project: null,
    episode: null,
    episodes: [],
    derivatives: [],
    locations: [],
    props: [],
    characters: [],
    continuityItems: [],
    clips: [],
    assets: {},
    jobs: {},
    saveState: 'saved',
    saveError: null,
    savedAt: null,
    selectedClipId: null,
    canUndo: false,
    canRedo: false,

    activeView: 'episode',
    activeTab: 'storyboard',
    sidebarCollapsed: false,

    setActiveView: (view) => {
      set({ activeView: view })
      const p = get().project
      if (p) localStorage.setItem(`last_view:${p.id}`, view)
    },
    setActiveTab: (tab) => {
      const willCollapse = tab === 'editor'
      set({ activeTab: tab, sidebarCollapsed: willCollapse })
      const p = get().project
      if (p) localStorage.setItem(`last_tab:${p.id}`, tab)
    },
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

    switchEpisode: async (episodeId) => {
      const p = get().project
      if (!p || get().episode?.id === episodeId) return
      await get().flush()
      try {
        const bundle = await window.api.projects.get(p.id, episodeId)
        get().load(bundle, { keepHistory: false })
        localStorage.setItem(`last_episode:${p.id}`, episodeId)
      } catch (err) {
        useApp.getState().toast('error', `Gagal membuka episode: ${errorText(err)}`)
      }
    },
    createEpisode: async (input) => {
      const p = get().project
      if (!p) throw new Error('Proyek belum dimuat')
      await get().flush()
      const ep = await window.api.episodes.create(p.id, input)
      set({ episodes: [...get().episodes, ep] })
      return ep
    },
    updateEpisode: async (id, patch) => {
      await window.api.episodes.update(id, patch)
      set({
        episodes: get().episodes.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        ...(get().episode?.id === id ? { episode: { ...get().episode!, ...patch } } : {})
      })
    },
    removeEpisode: async (id) => {
      const p = get().project
      if (!p) return
      await window.api.episodes.remove(id)
      const remaining = get().episodes.filter((e) => e.id !== id)
      set({ episodes: remaining })
      if (get().episode?.id === id) {
        if (remaining.length > 0) {
          await get().switchEpisode(remaining[0].id)
        } else {
          set({ episode: null, clips: [], activeView: 'hub' })
        }
      }
    },
    removeAllEpisodes: async () => {
      const p = get().project
      if (!p) return
      await window.api.episodes.removeAll(p.id)
      try {
        localStorage.removeItem(`last_episode:${p.id}`)
      } catch {
        // ignore storage errors
      }
      const b = await window.api.projects.get(p.id)
      set({
        episodes: [],
        episode: null,
        clips: [],
        assets: Object.fromEntries(b.assets.map((a) => [a.id, a])),
        activeView: 'hub'
      })
    },
    reorderEpisodes: async (episodeIds) => {
      const p = get().project
      if (!p) return
      const updated = await window.api.episodes.reorder(p.id, episodeIds)
      set({ episodes: updated })
    },
    refreshEpisodes: async () => {
      const p = get().project
      if (!p) return
      const eps = await window.api.episodes.list(p.id)
      set({ episodes: eps })
      if (get().episode) {
        const cur = eps.find((e) => e.id === get().episode!.id)
        if (cur) set({ episode: cur })
      }
    },

    addDerivative: async (input) => {
      const p = get().project!
      const d = await window.api.lorebook.createDerivative({ projectId: p.id, ...input })
      set({ derivatives: [...get().derivatives, d] })
      return d
    },
    updateDerivative: async (id, patch) => {
      const updated = await window.api.lorebook.updateDerivative(id, patch)
      set({ derivatives: get().derivatives.map((d) => (d.id === id ? updated : d)) })
    },
    removeDerivative: async (id) => {
      await window.api.lorebook.removeDerivative(id)
      set({ derivatives: get().derivatives.filter((d) => d.id !== id) })
    },
    addLocation: async (input) => {
      const p = get().project!
      const l = await window.api.lorebook.createLocation({ projectId: p.id, ...input })
      set({ locations: [...get().locations, l] })
      return l
    },
    updateLocation: async (id, patch) => {
      const updated = await window.api.lorebook.updateLocation(id, patch)
      set({ locations: get().locations.map((l) => (l.id === id ? updated : l)) })
    },
    removeLocation: async (id) => {
      await window.api.lorebook.removeLocation(id)
      set({ locations: get().locations.filter((l) => l.id !== id) })
    },
    addProp: async (input) => {
      const p = get().project!
      const pr = await window.api.lorebook.createProp({ projectId: p.id, ...input })
      set({ props: [...get().props, pr] })
      return pr
    },
    updateProp: async (id, patch) => {
      const updated = await window.api.lorebook.updateProp(id, patch)
      set({ props: get().props.map((pr) => (pr.id === id ? updated : pr)) })
    },
    removeProp: async (id) => {
      await window.api.lorebook.removeProp(id)
      set({ props: get().props.filter((pr) => pr.id !== id) })
    },
    refreshLorebook: async () => {
      const p = get().project
      if (!p) return
      const bundle = await window.api.projects.get(p.id, get().episode?.id)
      set({
        characters: bundle.characters,
        derivatives: bundle.derivatives ?? [],
        locations: bundle.locations ?? [],
        props: bundle.props ?? [],
        assets: Object.fromEntries(bundle.assets.map((a) => [a.id, a]))
      })
    },

    loadContinuityItems: async (projectId) => {
      const pid = projectId ?? get().project?.id
      if (!pid) return
      try {
        const items = await window.api.continuity.list(pid)
        set({ continuityItems: items })
      } catch (err) {
        console.error('Failed to load continuity items:', err)
      }
    },
    addContinuityItem: async (input) => {
      const p = get().project!
      const item = await window.api.continuity.create({ projectId: p.id, ...input })
      set({ continuityItems: [...get().continuityItems, item] })
      return item
    },
    updateContinuityItem: async (id, patch) => {
      const updated = await window.api.continuity.update(id, patch)
      set({
        continuityItems: get().continuityItems.map((ci) => (ci.id === id ? updated : ci))
      })
    },
    removeContinuityItem: async (id) => {
      await window.api.continuity.remove(id)
      set({
        continuityItems: get().continuityItems.filter((ci) => ci.id !== id)
      })
    },

    load: (b, opts) => {
      if (!opts?.keepHistory) {
        past = []
        future = []
        historyGestureDepth = 0
        lastHistoryTime = -Infinity
      }
      const lastView = (localStorage.getItem(`last_view:${b.project.id}`) as 'hub' | 'lorebook' | 'episode') || null
      const lastTab = (localStorage.getItem(`last_tab:${b.project.id}`) as 'plan' | 'storyboard' | 'editor') || null

      let defaultView: 'hub' | 'lorebook' | 'episode' = 'episode'
      if (lastView) {
        defaultView = lastView
      } else if (!b.episode || (!b.clips.length && b.episodes.length <= 1 && b.episode.status === 'draft')) {
        defaultView = 'hub'
      }

      const defaultTab: 'plan' | 'storyboard' | 'editor' =
        lastTab || (b.episode?.status === 'editing' || b.episode?.status === 'exported' ? 'editor' : 'storyboard')

      const shouldCollapseSidebar = defaultTab === 'editor'

      set({
        loaded: true,
        project: b.project,
        episode: b.episode ?? null,
        episodes: b.episodes ?? [],
        derivatives: b.derivatives ?? [],
        locations: b.locations ?? [],
        props: b.props ?? [],
        characters: b.characters,
        clips: b.clips,
        assets: Object.fromEntries(b.assets.map((a) => [a.id, a])),
        jobs: Object.fromEntries(b.jobs.map((j) => [j.id, j])),
        saveState: 'saved',
        saveError: null,
        savedAt: b.project.updatedAt,
        selectedClipId: get().selectedClipId && b.clips.some((c) => c.id === get().selectedClipId) ? get().selectedClipId : (b.clips[0]?.id ?? null),
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        activeView: defaultView,
        activeTab: defaultTab,
        sidebarCollapsed: shouldCollapseSidebar
      })
      void get().loadContinuityItems(b.project.id)
    },
    unload: () => {
      if (timer) clearTimeout(timer)
      past = []
      future = []
      historyGestureDepth = 0
      lastHistoryTime = -Infinity
      set({
        loaded: false,
        project: null,
        episode: null,
        episodes: [],
        derivatives: [],
        locations: [],
        props: [],
        characters: [],
        continuityItems: [],
        clips: [],
        assets: {},
        jobs: {},
        selectedClipId: null,
        saveState: 'saved',
        canUndo: false,
        canRedo: false,
        activeView: 'episode',
        activeTab: 'storyboard',
        sidebarCollapsed: false
      })
    },
    select: (clipId) => set({ selectedClipId: clipId }),

    checkpoint: () => {
      recordHistory(get, set, true)
    },
    beginHistoryGesture: () => {
      if (historyGestureDepth === 0) recordHistory(get, set, true)
      historyGestureDepth += 1
    },
    endHistoryGesture: () => { historyGestureDepth = Math.max(0, historyGestureDepth - 1) },
    undo: () => {
      const s = get()
      if (!s.project || past.length === 0) return
      const current: HistoryEntry = {
        project: structuredClone(s.project),
        episode: s.episode ? structuredClone(s.episode) : null,
        characters: structuredClone(s.characters),
        clips: structuredClone(s.clips),
        assets: copyAssetIndex(s.assets),
        selectedClipId: s.selectedClipId
      }
      const prev = past.pop()!
      future.push(current)
      if (future.length > MAX_HISTORY) future.shift()

      for (const [id, prevAsset] of Object.entries(prev.assets)) {
        const curAsset = s.assets[id]
        if (curAsset && JSON.stringify(curAsset.meta.words) !== JSON.stringify(prevAsset.meta.words)) {
          restoreWords(id, prevAsset.meta.words)
        }
      }

      set({
        project: prev.project,
        episode: prev.episode ?? get().episode,
        characters: prev.characters,
        clips: prev.clips,
        assets: prev.assets,
        selectedClipId: prev.selectedClipId && prev.clips.some((c) => c.id === prev.selectedClipId)
          ? prev.selectedClipId
          : (prev.clips[0]?.id ?? null),
        canUndo: past.length > 0,
        canRedo: true
      })
      touch()
    },
    redo: () => {
      const s = get()
      if (!s.project || future.length === 0) return
      const current: HistoryEntry = {
        project: structuredClone(s.project),
        episode: s.episode ? structuredClone(s.episode) : null,
        characters: structuredClone(s.characters),
        clips: structuredClone(s.clips),
        assets: copyAssetIndex(s.assets),
        selectedClipId: s.selectedClipId
      }
      const next = future.pop()!
      past.push(current)
      if (past.length > MAX_HISTORY) past.shift()

      for (const [id, nextAsset] of Object.entries(next.assets)) {
        const curAsset = s.assets[id]
        if (curAsset && JSON.stringify(curAsset.meta.words) !== JSON.stringify(nextAsset.meta.words)) {
          restoreWords(id, nextAsset.meta.words)
        }
      }

      set({
        project: next.project,
        episode: next.episode ?? get().episode,
        characters: next.characters,
        clips: next.clips,
        assets: next.assets,
        selectedClipId: next.selectedClipId && next.clips.some((c) => c.id === next.selectedClipId)
          ? next.selectedClipId
          : (next.clips[0]?.id ?? null),
        canUndo: true,
        canRedo: future.length > 0
      })
      touch()
    },

    editWords: (assetId, words) => {
      recordHistory(get, set)
      return sendWords(assetId, words)
    },

    updateProject: (patch) => {
      recordHistory(get, set)
      set({ project: { ...get().project!, ...patch } })
      touch()
    },
    updateEditor: (patch) => {
      recordHistory(get, set)
      const p = get().project!
      const ep = get().episode
      const editor = { ...p.editor, ...patch }
      set({
        project: { ...p, editor },
        ...(ep ? { episode: { ...ep, editor: { ...(ep.editor ?? p.editor), ...patch } } } : {})
      })
      touch()
    },
    applyEditor: (patch) => {
      const p = get().project
      if (!p) return
      const ep = get().episode
      const editor = { ...p.editor, ...patch }
      set({
        project: { ...p, editor },
        ...(ep ? { episode: { ...ep, editor: { ...(ep.editor ?? p.editor), ...patch } } } : {})
      })
      touch()
    },
    updateClip: (id, patch) => {
      recordHistory(get, set)
      set({ clips: get().clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
      touch()
    },
    updateClips: (patch) => {
      recordHistory(get, set, true)
      set({ clips: get().clips.map((clip) => ({ ...clip, ...patch })) })
      touch()
    },
    updateCharacter: (id, patch) => {
      recordHistory(get, set)
      set({ characters: get().characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
      touch()
    },
    addClip: (afterId) => {
      recordHistory(get, set, true)
      const p = get().project!
      const clips = [...get().clips]
      const at = afterId ? clips.findIndex((c) => c.id === afterId) + 1 : clips.length
      const clip: Clip = {
        id: newId(),
        projectId: p.id,
        episodeId: get().episode?.id || '',
        sort: at,
        title: 'Adegan baru',
        story: '',
        visualPrompt: '',
        visualSource: null,
        narration: '',
        durationMs: 5000,
        characterIds: [],
        emotion: '',
        costumeIds: {},
        locationId: null,
        propIds: [],
        framing: '',
        sourceExcerpt: '',
        shotDetail: {},
        continueFromPrevious: false,
        referenceAssetIds: null,
        motionType: 'camera',
        cameraPreset: 'zoomin',
        motionStrength: 'halus',
        videoPrompt: '',
        transition: 'fade',
        videoCamera: 'static',
        videoStrength: 'halus',
        transitionMs: null,
        voiceGainDb: 0,
        mediaInMs: 0,
        voiceInMs: 0,
        voiceOutMs: null,
        voiceStartMs: 0,
        speakerId: null,
        filter: (get().episode?.editor ?? p.editor).filter ?? 'normal',
        imageAssetId: null,
        videoAssetId: null,
        audioAssetId: null
      }
      clips.splice(at, 0, clip)
      set({ clips: resort(clips), selectedClipId: clip.id })
      touch()
      return clip.id
    },
    removeClip: (id) => {
      recordHistory(get, set, true)
      const clips = get().clips
      const i = clips.findIndex((c) => c.id === id)
      const rest = resort(clips.filter((c) => c.id !== id))
      const project = get().project!
      const clipFraming = project.editor.clipFraming ? { ...project.editor.clipFraming } : undefined
      if (clipFraming) delete clipFraming[id]
      set({ clips: rest, selectedClipId: rest[Math.min(i, rest.length - 1)]?.id ?? null,
        project: { ...project, editor: { ...project.editor, clipFraming } } })
      touch()
    },
    moveClip: (id, dir) => {
      recordHistory(get, set, true)
      const clips = [...get().clips]
      const i = clips.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= clips.length) return
      ;[clips[i], clips[j]] = [clips[j], clips[i]]
      set({ clips: resort(clips) })
      touch()
    },
    addCharacter: (init) => {
      recordHistory(get, set, true)
      const p = get().project!
      const c: Character = {
        id: newId(),
        projectId: p.id,
        name: init?.name.trim() || 'Pemeran baru',
        description: init?.description.trim() ?? '',
        sheetAssetId: null,
        sort: get().characters.length,
        ttsVoice: init?.ttsVoice ?? null,
        ttsProvider: init?.ttsProvider ?? null,
        voiceStyle: '',
        aliases: []
      }
      set({ characters: [...get().characters, c] })
      touch()
      return c.id
    },
    removeCharacter: (id) => {
      recordHistory(get, set, true)
      set({
        characters: get().characters.filter((c) => c.id !== id),
        clips: get().clips.map((c) => ({ ...c, characterIds: c.characterIds.filter((x) => x !== id), speakerId: c.speakerId === id ? null : c.speakerId }))
      })
      touch()
    },

    save: async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (!get().project) return
      if (inFlight) {
        changedDuringSave = true
        return inFlight
      }
      if (get().saveState === 'saved') return
      changedDuringSave = false
      set({ saveState: 'saving', saveError: null })
      inFlight = (async () => {
        try {
          const { updatedAt } = await window.api.projects.save(snapshot(get()))
          set({ savedAt: updatedAt, saveState: changedDuringSave ? 'dirty' : 'saved' })
        } catch (e) {
          set({ saveState: 'error', saveError: errorText(e) })
        } finally {
          inFlight = null
        }
        if (changedDuringSave) {
          changedDuringSave = false
          timer = setTimeout(() => void get().save(), 300)
        }
      })()
      return inFlight
    },
    flush: async () => {
      if (inFlight) await inFlight
      if (get().saveState === 'dirty' || get().saveState === 'error') await get().save()
    },

    applyClip: (clipId, patch) => {
      rebaseClip(clipId, patch)
      set({ clips: get().clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) })
    },
    applyCharacter: (characterId, patch) =>
      set({ characters: get().characters.map((c) => (c.id === characterId ? { ...c, ...patch } : c)) }),
    receiveCharacter: (character) => {
      if (character.projectId !== get().project?.id || get().characters.some((c) => c.id === character.id)) return
      set({ characters: [...get().characters, character] })
    },
    addAsset: (asset) => {
      if (asset.projectId !== get().project?.id) return
      const prev = get().assets[asset.id]
      const wordsChanged = !!prev && JSON.stringify(prev.meta.words) !== JSON.stringify(asset.meta.words)
      rebaseAsset(asset, wordsChanged && !pendingWordEdits.has(asset.id))
      set({ assets: { ...get().assets, [asset.id]: asset } })
    },
    upsertJob: (job) => {
      if (job.projectId !== get().project?.id) return
      set({ jobs: { ...get().jobs, [job.id]: job } })
    }
  }
})

;(window as unknown as { useProject?: typeof useProject }).useProject = useProject

/** Latest active or recent job of a kind for a clip or character. */
export function jobFor(jobs: Record<string, Job>, kind: Job['kind'], target: { clipId?: string; characterId?: string }): Job | null {
  let best: Job | null = null
  for (const j of Object.values(jobs)) {
    if (j.kind !== kind) continue
    if (target.clipId && j.clipId !== target.clipId) continue
    if (target.characterId && j.characterId !== target.characterId) continue
    if (!best || j.createdAt > best.createdAt) best = j
  }
  return best
}

export const isRunning = (j: Job | null | undefined): boolean => !!j && (j.status === 'queued' || j.status === 'running')
