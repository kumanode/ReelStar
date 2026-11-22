import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { EVENTS, type StudioApi } from '../shared/api'

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args)

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }

const api: StudioApi = {
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    get: call('projects:get'),
    save: call('projects:save'),
    remove: call('projects:remove'),
    duplicate: call('projects:duplicate'),
    setCover: call('projects:setCover'),
    progress: call('projects:progress')
  },
  episodes: {
    list: call('episodes:list'),
    create: call('episodes:create'),
    update: call('episodes:update'),
    remove: call('episodes:remove'),
    removeAll: call('episodes:removeAll'),
    reorder: call('episodes:reorder')
  },
  lorebook: {
    createCharacter: call('lorebook:createCharacter'),
    updateCharacter: call('lorebook:updateCharacter'),
    removeCharacter: call('lorebook:removeCharacter'),
    pickCharacterSheet: call('lorebook:pickCharacterSheet'),

    listDerivatives: call('lorebook:listDerivatives'),
    createDerivative: call('lorebook:createDerivative'),
    updateDerivative: call('lorebook:updateDerivative'),
    removeDerivative: call('lorebook:removeDerivative'),
    generateDerivativeSheet: call('lorebook:generateDerivativeSheet'),
    pickDerivativeSheet: call('lorebook:pickDerivativeSheet'),

    listLocations: call('lorebook:listLocations'),
    createLocation: call('lorebook:createLocation'),
    updateLocation: call('lorebook:updateLocation'),
    removeLocation: call('lorebook:removeLocation'),
    generateLocationSheet: call('lorebook:generateLocationSheet'),
    pickLocationSheet: call('lorebook:pickLocationSheet'),

    listProps: call('lorebook:listProps'),
    createProp: call('lorebook:createProp'),
    updateProp: call('lorebook:updateProp'),
    removeProp: call('lorebook:removeProp'),
    generatePropSheet: call('lorebook:generatePropSheet'),
    pickPropSheet: call('lorebook:pickPropSheet'),

    assetUsage: call('lorebook:assetUsage'),
    merge: call('lorebook:merge'),
    extract: call('lorebook:extract'),
    cancelExtract: call('lorebook:cancelExtract'),
    acceptCandidates: call('lorebook:acceptCandidates'),
    enrich: call('lorebook:enrich')
  },
  story: {
    planEpisodes: call('story:planEpisodes'),
    planEpisodeScript: call('story:planEpisodeScript'),
    planAllScripts: call('story:planAllScripts'),
    cancelBatchScripts: call('story:cancelBatchScripts'),
    confirmEpisodeScript: call('story:confirmEpisodeScript'),
    writePrompts: call('story:writePrompts'),
    visuals: call('story:visuals'),
    musicPrompt: call('story:musicPrompt'),
    planSmartSfx: call('story:planSmartSfx'),
    generateMusic: call('story:generateMusic'),
    youtubeMetadata: call('story:youtubeMetadata'),
    thumbnailConcept: call('story:thumbnailConcept')
  },
  continuity: {
    list: call('continuity:list'),
    create: call('continuity:create'),
    update: call('continuity:update'),
    remove: call('continuity:remove')
  },
  scriptVersions: {
    list: call('scriptVersions:list'),
    save: call('scriptVersions:save')
  },
  generate: {
    thumbnail: call('generate:thumbnail'),
    clipImage: call('generate:clipImage'),
    clipVideo: call('generate:clipVideo'),
    clipTts: call('generate:clipTts'),
    characterSheet: call('generate:characterSheet'),
    missingImages: call('generate:missingImages'),
    missingVideos: call('generate:missingVideos'),
    clipsVideo: call('generate:clipsVideo'),
    missingTts: call('generate:missingTts'),
    narration: call('generate:narration'),
    syncCaptions: call('generate:syncCaptions'),
    cancel: call('generate:cancel'),
    cancelProject: call('generate:cancelProject'),
    estimate: call('generate:estimate'),
    batchEstimate: call('generate:batchEstimate'),
    batchEstimateSheets: call('generate:batchEstimateSheets'),
    missingSheets: call('generate:missingSheets')
  },
  clips: {
    split: call('clips:split'),
    detachVoice: call('clips:detachVoice'),
    autoTrimEpisode: call('clips:autoTrimEpisode')
  },
  assets: {
    setActive: call('assets:setActive'),
    setWords: call('assets:setWords'),
    pickMusic: call('assets:pickMusic'),
    pickImage: call('assets:pickImage'),
    pickReference: call('assets:pickReference'),
    listBuiltinSfx: call('assets:listBuiltinSfx'),
    addBuiltinSfx: call('assets:addBuiltinSfx'),
    generateSfx: call('assets:generateSfx'),
    pickSfx: call('assets:pickSfx'),
    importSfx: call('assets:importSfx'),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    replaceClipMedia: call('assets:replaceClipMedia')
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
    keys: call('settings:keys'),
    setKey: call('settings:setKey'),
    setCustom: call('settings:setCustom'),
    setFlow2Api: call('settings:setFlow2Api'),
    clearKey: call('settings:clearKey'),
    revealKey: call('settings:revealKey'),
    testKey: call('settings:testKey'),
    voices: call('settings:voices')
  },
  models: {
    list: call('models:list')
  },
  exporter: {
    start: call('export:start'),
    nvencAvailable: call('export:nvencAvailable'),
    defaultFolder: call('export:defaultFolder'),
    pickFolder: call('export:pickFolder'),
    reveal: call('export:reveal'),
    saveThumbnail: call('export:saveThumbnail'),
    saveClipThumbnail: call('export:saveClipThumbnail'),
    exportPackage: call('export:package')
  },
  app: {
    openExternal: call('app:openExternal'),
    copyText: call('app:copyText'),
    version: call('app:version')
  },
  whisper: {
    status: call('whisper:status'),
    download: call('whisper:download'),
    cancel: call('whisper:cancel'),
    remove: call('whisper:remove'),
    openFolder: call('whisper:openFolder')
  },
  on: {
    storyProgress: listen(EVENTS.storyProgress),
    whisper: listen(EVENTS.whisper),
    job: listen(EVENTS.job),
    clip: listen(EVENTS.clip),
    character: listen(EVENTS.character),
    asset: listen(EVENTS.asset)
  }
}

contextBridge.exposeInMainWorld('api', api)
