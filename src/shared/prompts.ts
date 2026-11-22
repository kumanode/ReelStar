import { resolveStylePrompt } from './styles'
import { NO_MUSIC, NO_MUSIC_DIALOG } from './higgsfield'
import { filterLockWordsForClip, renderLockBlock } from './lock'
import type { AspectRatio, Character, CharacterDerivative, Clip, Location, Prop, LockWord } from './types'

export interface ReferenceSheetItem {
  kind: 'character' | 'derivative' | 'location' | 'prop' | 'scene_anchor' | 'custom'
  id: string
  name: string
  sheetAssetId: string
}

export interface SceneAnchorRef {
  clipId: string
  clipNumber: number
  clipTitle: string
  imageAssetId: string
}

export interface CameraPovOption {
  value: string
  label: string
  prompt: string
}

export const CAMERA_POV_OPTIONS: CameraPovOption[] = [
  { value: '', label: 'Otomatis (Ikuti AI Director)', prompt: '' },
  { value: 'eye-level', label: 'Eye-Level (Sejajar Mata)', prompt: 'eye-level natural cinema camera perspective' },
  {
    value: 'ots',
    label: 'Over-the-Shoulder (OTS)',
    prompt: 'over-the-shoulder (OTS) camera shot looking past the foreground character\'s blurred shoulder directly at the facing subject'
  },
  {
    value: 'reverse-ots',
    label: 'Reverse Angle / Counter-OTS',
    prompt: 'reverse-angle counter over-the-shoulder shot from the opposite side of the conversation along the 180-degree axis (preserving exact room and prop positions in perspective)'
  },
  {
    value: 'first-person-pov',
    label: 'POV Mata Tokoh (First-Person)',
    prompt: 'immersive first-person character POV looking directly from eye height toward the target subject/object'
  },
  {
    value: 'low-angle',
    label: 'Low Angle (Dramatis / Berwibawa)',
    prompt: 'dramatic low-angle upward camera perspective emphasizing authority, tension, and imposing stature'
  },
  {
    value: 'high-angle',
    label: 'High Angle (Tertekan / Rentan)',
    prompt: 'elevated high-angle downward camera perspective emphasizing vulnerability, isolation, or pressure'
  },
  {
    value: 'top-down',
    label: 'Top-Down / Bird\'s Eye',
    prompt: 'overhead top-down bird\'s-eye camera angle looking straight down at the table, hands, props, and staging'
  },
  {
    value: 'dutch-tilt',
    label: 'Dutch Tilt (Miring / Tegang)',
    prompt: 'subtle cinematic Dutch tilt camera angle creating psychological unease and rising conflict'
  },
  {
    value: 'insert-prop',
    label: 'Insert Detail Prop / Tangan',
    prompt: 'tight cinematic insert close-up focusing sharply on the hero prop and interacting hands on the exact same surface'
  }
]

export function describeCameraPov(pov?: string): string {
  const raw = (pov ?? '').trim()
  if (!raw) return ''
  const preset = CAMERA_POV_OPTIONS.find((o) => o.value === raw.toLowerCase())
  return preset ? preset.prompt : raw
}

function isEstablishingFraming(framing?: string): boolean {
  return /\b(wide|establishing|master|medium|two[\s-]?shot|full|long)\b/i.test(framing || '')
}

function contiguousLocationBlock(clip: Clip, episodeClips?: Clip[]): { sorted: Clip[]; block: Clip[]; clipIdxInBlock: number } | null {
  if (!clip.locationId || !episodeClips || episodeClips.length < 2) return null
  const sameEp = clip.episodeId ? episodeClips.filter((c) => c.episodeId === clip.episodeId) : episodeClips
  const sorted = [...sameEp].sort((a, b) => a.sort - b.sort)
  const pos = sorted.findIndex((c) => c.id === clip.id)
  if (pos <= 0) return null
  let start = pos
  while (start > 0 && sorted[start - 1].locationId === clip.locationId) start--
  let end = pos
  while (end + 1 < sorted.length && sorted[end + 1].locationId === clip.locationId) end++
  if (start === pos) return null
  return { sorted, block: sorted.slice(start, end + 1), clipIdxInBlock: pos - start }
}

/**
 * Finds the planned anchor clip ID (earlier shot in the same contiguous location block) so batch generation
 * renders 1 anchor per location block first before fanning out POV/angle shots in parallel.
 */
export function findPlannedAnchorClipId(clip: Clip, episodeClips?: Clip[]): string | null {
  if (clip.shotDetail?.sceneAnchorMode === 'off' || hasReferenceOverride(clip)) return null
  const info = contiguousLocationBlock(clip, episodeClips)
  if (!info) return null
  const earlier = info.block.slice(0, info.clipIdxInBlock)
  const establishing = earlier.find((c) => isEstablishingFraming(c.framing))
  return (establishing ?? earlier[0])?.id ?? null
}

/**
 * Finds the best ALREADY-RENDERED earlier shot in the same contiguous location block to serve as a
 * Scene Continuity Anchor (locking room geometry, furniture, lighting, and prop placement across POV cuts).
 */
export function findSceneAnchorForClip(clip: Clip, episodeClips?: Clip[]): SceneAnchorRef | null {
  if (clip.shotDetail?.sceneAnchorMode === 'off' || hasReferenceOverride(clip)) return null
  const info = contiguousLocationBlock(clip, episodeClips)
  if (!info) return null
  const earlierRendered = info.block.slice(0, info.clipIdxInBlock).filter((c) => Boolean(c.imageAssetId))
  if (!earlierRendered.length) return null
  const anchor = earlierRendered.find((c) => isEstablishingFraming(c.framing)) ?? earlierRendered[0]
  if (!anchor?.imageAssetId) return null
  const num = info.sorted.findIndex((c) => c.id === anchor.id) + 1
  return {
    clipId: anchor.id,
    clipNumber: num,
    clipTitle: anchor.title || `Shot ${num}`,
    imageAssetId: anchor.imageAssetId
  }
}

export interface CompileClipPromptOptions {
  project: {
    id: string
    styleId: string
    aspectRatio: AspectRatio
    seriesGuidelines?: string
  }
  clip: Clip
  characters: Character[]
  derivatives?: CharacterDerivative[]
  locations?: Location[]
  props?: Prop[]
  /** Preferred structured reference items (exact order sent to image model) for explicit Image 1..N role binding. */
  refItems?: ReferenceSheetItem[]
  /** Legacy name-only list kept for backward compatibility when refItems is omitted. */
  refNames?: string[]
  lockWords?: LockWord[]
  limit?: number
}

const joinUnique = (parts: Array<string | undefined | null>, sep = ', '): string => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts) {
    const clean = (raw ?? '').trim().replace(/\.$/, '')
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out.join(sep)
}

/** Splits the storyboard's "Avoid:" line off the scene, so it can be phrased as a clear instruction. */
export function splitAvoid(visual: string): { scene: string; avoid: string } {
  const lines = visual.split('\n')
  const i = lines.findIndex((l) => /^\s*avoid\s*:/i.test(l))
  if (i < 0) return { scene: visual.trim(), avoid: '' }
  const avoid = lines[i].replace(/^\s*avoid\s*:\s*/i, '').replace(/\.$/, '').trim()
  lines.splice(i, 1)
  return { scene: lines.join('\n').trim(), avoid }
}

/** Whether the creator picked this shot's references by hand. Shared so the UI badge and generation agree. */
export function hasReferenceOverride(clip: Pick<Clip, 'referenceAssetIds'>): clip is Pick<Clip, 'referenceAssetIds'> & { referenceAssetIds: string[] } {
  return Array.isArray(clip.referenceAssetIds) && clip.referenceAssetIds.length > 0
}

function resolveOverrideRefs(
  clip: Clip,
  characters: Character[],
  derivatives: CharacterDerivative[],
  locations: Location[],
  props: Prop[]
): ReferenceSheetItem[] {
  const overrideResult: ReferenceSheetItem[] = []
  const seen = new Set<string>()
  for (const assetId of clip.referenceAssetIds ?? []) {
    if (!assetId || seen.has(assetId)) continue
    seen.add(assetId)
    const ch = characters.find((c) => c.sheetAssetId === assetId)
    if (ch) {
      overrideResult.push({ kind: 'character', id: ch.id, name: ch.name, sheetAssetId: assetId })
      continue
    }
    const d = derivatives.find((dv) => dv.sheetAssetId === assetId)
    if (d) {
      const parent = characters.find((c) => c.id === d.characterId)
      overrideResult.push({ kind: 'derivative', id: d.id, name: `${parent?.name ?? ''} (${d.name})`.trim(), sheetAssetId: assetId })
      continue
    }
    const loc = locations.find((l) => l.sheetAssetId === assetId)
    if (loc) {
      overrideResult.push({ kind: 'location', id: loc.id, name: loc.name, sheetAssetId: assetId })
      continue
    }
    const pr = props.find((p) => p.sheetAssetId === assetId)
    if (pr) {
      overrideResult.push({ kind: 'prop', id: pr.id, name: pr.name, sheetAssetId: assetId })
      continue
    }
    overrideResult.push({ kind: 'custom', id: assetId, name: 'Referensi Kustom', sheetAssetId: assetId })
  }
  return overrideResult
}

function gatherAutoCandidates(
  clip: Clip,
  characters: Character[],
  derivatives: CharacterDerivative[],
  locations: Location[],
  props: Prop[]
): {
  focusChar: ReferenceSheetItem | null
  otherChars: ReferenceSheetItem[]
  location: ReferenceSheetItem | null
  propItems: ReferenceSheetItem[]
} {
  const charMap = new Map(characters.map((c) => [c.id, c]))
  const derivMap = new Map(derivatives.map((d) => [d.id, d]))
  const locMap = new Map(locations.map((l) => [l.id, l]))
  const propMap = new Map(props.map((p) => [p.id, p]))
  const seenSheets = new Set<string>()

  const take = (item: ReferenceSheetItem | null): ReferenceSheetItem | null => {
    if (!item || !item.sheetAssetId || seenSheets.has(item.sheetAssetId)) return null
    seenSheets.add(item.sheetAssetId)
    return item
  }

  const charRef = (cid: string): ReferenceSheetItem | null => {
    const ch = charMap.get(cid)
    if (!ch) return null
    const costumeId = clip.costumeIds?.[cid]
    const deriv = costumeId ? derivMap.get(costumeId) : null
    if (deriv?.sheetAssetId) {
      return take({
        kind: 'derivative',
        id: deriv.id,
        name: `${ch.name} (${deriv.name})`,
        sheetAssetId: deriv.sheetAssetId
      })
    }
    if (ch.sheetAssetId) {
      return take({
        kind: 'character',
        id: ch.id,
        name: ch.name,
        sheetAssetId: ch.sheetAssetId
      })
    }
    return null
  }

  let focusChar: ReferenceSheetItem | null = null
  const otherChars: ReferenceSheetItem[] = []
  const visibleCharIds = clip.characterIds || []
  if (visibleCharIds.length > 0) {
    const focusCharId =
      clip.speakerId && visibleCharIds.includes(clip.speakerId) ? clip.speakerId : visibleCharIds[0]
    focusChar = charRef(focusCharId)
    for (const cid of visibleCharIds) {
      if (cid === focusCharId) continue
      const item = charRef(cid)
      if (item) otherChars.push(item)
    }
  }

  let location: ReferenceSheetItem | null = null
  if (clip.locationId) {
    const loc = locMap.get(clip.locationId)
    if (loc?.sheetAssetId) {
      location = take({
        kind: 'location',
        id: loc.id,
        name: loc.name,
        sheetAssetId: loc.sheetAssetId
      })
    }
  }

  const propItems: ReferenceSheetItem[] = []
  for (const pid of clip.propIds || []) {
    const pr = propMap.get(pid)
    if (pr?.sheetAssetId) {
      const item = take({
        kind: 'prop',
        id: pr.id,
        name: pr.name,
        sheetAssetId: pr.sheetAssetId
      })
      if (item) propItems.push(item)
    }
  }

  return { focusChar, otherChars, location, propItems }
}

/**
 * Returns ALL available reference sheets for a clip ordered by balanced scene-consistency priority
 * (without truncating to model capacity). Useful for UI to show active vs overflow sheets.
 */
export function collectAllAvailableReferenceSheets(
  clip: Clip,
  characters: Character[],
  derivatives: CharacterDerivative[] = [],
  locations: Location[] = [],
  props: Prop[] = [],
  targetSlots = 3,
  sceneAnchor?: SceneAnchorRef | null
): ReferenceSheetItem[] {
  if (hasReferenceOverride(clip)) {
    return resolveOverrideRefs(clip, characters, derivatives, locations, props)
  }

  const { focusChar, otherChars, location, propItems } = gatherAutoCandidates(
    clip,
    characters,
    derivatives,
    locations,
    props
  )

  const anchorItem: ReferenceSheetItem | null =
    sceneAnchor?.imageAssetId && clip.shotDetail?.sceneAnchorMode !== 'off'
      ? {
          kind: 'scene_anchor',
          id: sceneAnchor.clipId,
          name: `Shot ${sceneAnchor.clipNumber} (${sceneAnchor.clipTitle})`,
          sheetAssetId: sceneAnchor.imageAssetId
        }
      : null

  const canonical: ReferenceSheetItem[] = [
    ...(focusChar ? [focusChar] : []),
    ...otherChars,
    ...(location ? [location] : []),
    ...(anchorItem ? [anchorItem] : []),
    ...propItems
  ]

  // When everything fits within the model's slot budget, preserve canonical order.
  if (targetSlots <= 0 || canonical.length <= targetSlots) {
    return canonical
  }

  // Balanced slot allocation: guarantee location, scene anchor, and hero prop on insert shots
  // don't get silently starved by extra characters.
  const isPropInsert =
    propItems.length > 0 &&
    (clip.shotDetail?.cameraPov === 'insert-prop' ||
      /\b(insert|detail|macro|hand|object|prop|ring|letter|phone|weapon)\b/i.test(`${clip.framing || ''} ${clip.title || ''}`))

  const selected: ReferenceSheetItem[] = []
  const pickedIds = new Set<string>()
  const pick = (item: ReferenceSheetItem | null | undefined): void => {
    if (!item || pickedIds.has(item.sheetAssetId) || selected.length >= targetSlots) return
    pickedIds.add(item.sheetAssetId)
    selected.push(item)
  }

  // Slot 1: Focus character / speaker (or primary prop on pure insert shot with no characters)
  if (focusChar) pick(focusChar)

  if (targetSlots === 2) {
    // 2-slot budget: focus character + scene anchor/location (or primary prop on insert)
    if (isPropInsert) pick(propItems[0])
    pick(anchorItem ?? location)
    pick(otherChars[0])
    pick(location)
    pick(propItems[0])
  } else if (targetSlots === 3) {
    // 3-slot budget:
    // - Prop insert shot: [focusChar, primaryProp, anchor/location]
    // - 2+ characters + location: [focusChar, secondChar, anchor/location]
    // - 1 character + location + prop: [focusChar, anchor/location, primaryProp]
    if (isPropInsert) {
      pick(propItems[0])
      pick(anchorItem ?? location)
      pick(otherChars[0])
    } else if (otherChars.length > 0 && (anchorItem || location)) {
      pick(otherChars[0])
      pick(anchorItem ?? location)
    } else {
      pick(anchorItem ?? location)
      pick(propItems[0])
      for (const ch of otherChars) pick(ch)
    }
  } else {
    // 4-6+ slots (Flow2API Nano Banana 2 = 6 slots):
    // Reserve slots for scene anchor, location (or prop on insert), and primary prop, while keeping all main cast.
    const reserveCount = (anchorItem ? 1 : 0) + (location ? 1 : 0) + (propItems.length > 0 ? 1 : 0)
    const charRoom = Math.max(0, targetSlots - selected.length - reserveCount)
    for (const ch of otherChars.slice(0, charRoom)) pick(ch)
    if (isPropInsert) pick(propItems[0])
    pick(anchorItem)
    pick(location)
    pick(propItems[0])
    for (const ch of otherChars) pick(ch)
    for (const pr of propItems) pick(pr)
  }

  // Append overflow items after the selected slots so callers inspecting the full list see what was truncated.
  const overflow = canonical.filter((item) => !pickedIds.has(item.sheetAssetId))
  return [...selected, ...overflow]
}

/**
 * Collects reference sheet assets for a clip capped to `maxRefs` (matching the active image model's limit).
 * Manual overrides replace automatic selection; automatic selection balances characters, location, scene anchor,
 * and hero props.
 */
export function collectReferenceSheets(
  clip: Clip,
  characters: Character[],
  derivatives: CharacterDerivative[] = [],
  locations: Location[] = [],
  props: Prop[] = [],
  maxRefs = 3,
  sceneAnchor?: SceneAnchorRef | null
): ReferenceSheetItem[] {
  if (maxRefs <= 0) return []
  return collectAllAvailableReferenceSheets(clip, characters, derivatives, locations, props, maxRefs, sceneAnchor).slice(0, maxRefs)
}

export function formatCharacterTraits(c: Character, includeDefaultOutfit = true): string {
  const v = c.profile?.visual
  const traits = v
    ? joinUnique([
        v.age,
        v.gender,
        v.bodyType || v.body,
        v.facialFeatures || v.face,
        v.hair,
        v.distinctiveFeatures || v.distinguishingFeatures,
        v.accessories ? `accessories: ${v.accessories}` : undefined,
        includeDefaultOutfit ? v.defaultOutfit : undefined
      ])
    : ''
  const desc = (c.description || '').trim().replace(/\.$/, '')
  if (desc && traits) return `${desc} (${traits})`
  return desc || traits
}

export function formatLocationDetails(loc: Location): string {
  const p = loc.profile
  const extra = p
    ? joinUnique([
        p.interiorExterior || p.placeType,
        p.architecturalStyle,
        p.colorPalette ? `palette: ${p.colorPalette}` : undefined,
        p.timeOfDayLighting || p.lighting,
        p.atmosphere,
        p.spatialLayout ? `room layout: ${p.spatialLayout}` : undefined,
        p.keyFeatures,
        p.fixedDetails
      ])
    : ''
  const desc = (loc.description || '').trim().replace(/\.$/, '')
  return joinUnique([loc.name, desc, extra], ', ')
}

export function formatPropDetails(p: Prop): string {
  const pr = p.profile
  const extra = pr
    ? joinUnique([
        pr.category,
        pr.sizeScale ? `scale: ${pr.sizeScale}` : undefined,
        pr.shape,
        pr.material,
        pr.appearance,
        pr.distinctiveDetails,
        pr.status
      ])
    : ''
  const desc = (p.description || '').trim().replace(/\.$/, '')
  const body = joinUnique([desc, extra], '; ')
  return body ? `${p.name} (${body})` : p.name
}

/** One line per character for short prompt limits: identity and outfit together, since there is no Wardrobe block. */
function compactCharacterLine(c: Character, deriv: CharacterDerivative | null): string {
  const outfit = deriv ? joinUnique([deriv.name, deriv.costumeKeyphrase || deriv.promptChange], ' - ') : ''
  const base = formatCharacterTraits(c, !deriv)
  return outfit ? `${c.name}: ${base}; wears ${outfit}` : `${c.name}: ${base}`
}

/** Drops "<label>:" lines from the storyboard prompt; the compiled prompt writes those from Lorebook data instead. */
const withoutLines = (text: string, labels: string[]): string => {
  if (!labels.length) return text
  const pattern = new RegExp(`^\\s*(${labels.join('|')})\\s*:`, 'i')
  return text
    .split('\n')
    .filter((l) => !pattern.test(l))
    .join('\n')
    .trim()
}

function renderReferenceGuide(refItems?: ReferenceSheetItem[], refNames: string[] = []): string {
  if (refItems && refItems.length > 0) {
    const lines = refItems.map((item, idx) => {
      const n = idx + 1
      if (item.kind === 'character') {
        return `- Reference Image ${n} [CHARACTER: ${item.name}]: Copy exact face, hair, features, build, and exact outfit/fabric pattern. Ignore turnaround grid and plain backdrop.`
      }
      if (item.kind === 'derivative') {
        return `- Reference Image ${n} [CHARACTER COSTUME: ${item.name}]: Copy exact face, hair, build, and this exact costume variant (cut, motif, styling). Ignore plain backdrop.`
      }
      if (item.kind === 'location') {
        return `- Reference Image ${n} [LOCATION: ${item.name}]: Match exact room walls, floor, furniture, palette, and lighting. Place characters naturally inside this space.`
      }
      if (item.kind === 'prop') {
        return `- Reference Image ${n} [PROP: ${item.name}]: Match exact object shape, scale, material, surface detail, and markings.`
      }
      if (item.kind === 'scene_anchor') {
        return `- Reference Image ${n} [SCENE CONTINUITY ANCHOR: ${item.name}]: Earlier shot from this EXACT SAME set. CHANGE camera to the NEW POV/angle in Scene (do NOT clone anchor framing/poses), while STRICTLY PRESERVING room walls, furniture, lighting, 180-degree left/right positions, and exact prop placement.`
      }
      return `- Reference Image ${n} [CONTINUITY ANCHOR: ${item.name}]: Keep consistent lighting, palette, and look.`
    })
    return [
      'REFERENCE IMAGE BINDING (exact attached order — treat as strict visual truth):',
      ...lines,
      'STRICT IDENTITY & COSTUME LOCK: Never swap faces or outfits between Reference Images; never cover, alter, or replace a character\'s exact reference outfit/motif with invented generic clothing; never copy turnaround grids or plain studio backdrops.'
    ].join('\n')
  }
  if (refNames.length > 0) {
    const indexed = refNames.map((name, idx) => `Image ${idx + 1}: ${name}`).join(', ')
    return `REFERENCE IMAGE BINDING (exact order): ${indexed}. Match exact identity, face consistency, exact outfit/fabric pattern, location architecture, and prop details. Never replace a character's outfit with invented generic clothing, and never copy sheet grids or plain backgrounds.`
  }
  return ''
}

function buildFramingLine(project: { aspectRatio: AspectRatio }, clip: Clip, styleCategory: 'liveaction' | 'animation' | 'custom'): string {
  const orientation = project.aspectRatio === '9:16' ? 'vertical 9:16 full-bleed' : `${project.aspectRatio} full-bleed`
  const framing = (clip.framing || 'medium close-up').trim()
  const isWide = /\b(wide|establishing|long|full)\b/i.test(framing)
  const isClose = /\b(close|cu|ecu|portrait|over-the-shoulder|ots)\b/i.test(framing)
  const depth =
    styleCategory === 'animation'
      ? isWide
        ? 'crisp layered foreground-to-background environmental clarity'
        : isClose
          ? 'strong focal emphasis on eyes and facial expression with softly separated background'
          : 'clear visual depth separating foreground subjects from background'
      : isWide
        ? 'crisp deep architectural clarity from foreground to background'
        : isClose
          ? 'shallow depth of field with tack-sharp focus on eyes and facial micro-expressions'
          : 'natural cinematic depth of field separating subjects from background'
  const lightingFallback = clip.shotDetail?.lighting?.trim() ? '' : ', cohesive lighting matching the art style'
  return `Framing & composition: ${framing}, ${orientation}, ${depth}${lightingFallback}.`
}

/**
 * Compiles a structured, labelled image prompt for a clip (§8.C):
 * Explicit Reference Guide, Art style, Scene (Setting, POV, Action, Props, Placement, Blocking, Framing),
 * Wardrobe & Characters, Shot-Scoped Lock Words, Avoid.
 */
export function compileClipPrompt(opts: CompileClipPromptOptions): string {
  const {
    project,
    clip,
    characters,
    derivatives = [],
    locations = [],
    props = [],
    refItems,
    refNames = [],
    lockWords = [],
    limit = 6000
  } = opts
  const { style, prompt: stylePrompt, isRestrictedPalette } = resolveStylePrompt(project)
  const split = splitAvoid(clip.visualPrompt)
  const avoid = split.avoid
  const scopedLocks = filterLockWordsForClip(lockWords, clip)
  const lockBlock = renderLockBlock(scopedLocks)

  const charMap = new Map(characters.map((c) => [c.id, c]))
  const derivMap = new Map(derivatives.map((d) => [d.id, d]))
  const locMap = new Map(locations.map((l) => [l.id, l]))
  const propMap = new Map(props.map((p) => [p.id, p]))

  const visibleChars: { char: Character; deriv: CharacterDerivative | null }[] = []
  for (const cid of clip.characterIds || []) {
    const c = charMap.get(cid)
    if (c) {
      const did = clip.costumeIds?.[cid]
      visibleChars.push({ char: c, deriv: did ? derivMap.get(did) ?? null : null })
    }
  }

  // Build exact 1-based reference image lookup per entity so we never falsely claim a missing sheet is attached.
  const refIndexByKey = new Map<string, number>()
  if (refItems) {
    refItems.forEach((item, idx) => {
      refIndexByKey.set(`${item.kind}:${item.id}`, idx + 1)
    })
  }
  const refIdxForChar = (c: Character, d: CharacterDerivative | null): number | undefined =>
    (d ? refIndexByKey.get(`derivative:${d.id}`) : undefined) ?? refIndexByKey.get(`character:${c.id}`)
  const locRefIdx = clip.locationId ? refIndexByKey.get(`location:${clip.locationId}`) : undefined
  const anchorRefIdx = refItems ? refItems.findIndex((item) => item.kind === 'scene_anchor') + 1 : 0

  const parts: string[] = []

  // Place Reference Image Binding and Art Style FIRST so both identity and visual medium (2D anime, 3D, stop-motion,
  // monochrome ink, or live-action) govern the entire frame before scene prose is parsed.
  const refGuide = renderReferenceGuide(refItems, refNames)
  if (refGuide) parts.push(refGuide)

  const paletteNote = isRestrictedPalette
    ? ' Render all skin, costumes, props, and environments strictly within this monochrome or restricted art-style palette.'
    : ''
  parts.push(`Art style: ${stylePrompt}${paletteNote}`)

  const loc = clip.locationId ? locMap.get(clip.locationId) : null
  // Lorebook data is the source of truth for setting, framing and costumes. writePrompts copied them into the
  // storyboard prompt when it ran; those copies go stale when a costume's prompt_change or a location is edited,
  // so they are replaced here, and the basis hash (built from this prompt) marks the image stale.
  const scene = withoutLines(split.scene, ['framing', ...(loc ? ['setting'] : []), ...(visibleChars.length ? ['wardrobe'] : [])])
  const settingLine = loc
    ? `Setting${locRefIdx ? ` [Reference Image ${locRefIdx}]` : ''}: ${formatLocationDetails(loc)}.`
    : ''

  // Camera POV & angle (explicit 3D camera shift while keeping background & props fixed)
  const povDesc = describeCameraPov(clip.shotDetail?.cameraPov)
  const povLine = povDesc
    ? `Camera POV & angle: ${povDesc}.${anchorRefIdx > 0 ? ` Move the camera to THIS new POV/angle (do NOT clone Reference Image ${anchorRefIdx}'s framing or pose), while keeping the exact same room architecture, furniture, lighting, and prop locations from Reference Image ${anchorRefIdx} consistent in 3D perspective.` : ''}`
    : anchorRefIdx > 0
      ? `Camera continuity: shoot from the new framing/angle described below (do NOT clone Reference Image ${anchorRefIdx}'s exact pose or composition), while strictly preserving the exact same room, furniture, lighting, and prop placement shown in Reference Image ${anchorRefIdx}.`
      : ''

  // Props line (includes full PropProfile scale/material/shape/markings + exact ref index when attached)
  const clipProps = (clip.propIds || []).map((pid) => propMap.get(pid)).filter(Boolean) as Prop[]
  const propsLine = clipProps.length
    ? `Key items/props present (keep exact appearance & scale): ${clipProps
        .map((p) => {
          const pIdx = refIndexByKey.get(`prop:${p.id}`)
          return `${pIdx ? `[Reference Image ${pIdx}] ` : ''}${formatPropDetails(p)}`
        })
        .join('; ')}.`
    : ''

  const propPlacementLine = clip.shotDetail?.propPlacement?.trim()
    ? `Fixed prop placement & set landmarks (DO NOT move or omit): ${clip.shotDetail.propPlacement.trim()}.`
    : ''

  // Emotion line (respects subtle/calm emotions without forcing "intense" on everything)
  const emotionLine = clip.emotion?.trim() ? `Facial expression & emotional tone: ${clip.emotion.trim()}.` : ''

  // Expanded Shot Details: Lighting & Blocking
  const lightingLine = clip.shotDetail?.lighting?.trim() ? `Lighting: ${clip.shotDetail.lighting.trim()}.` : ''
  const blockingLine = clip.shotDetail?.blocking?.trim()
    ? `Blocking & 180-degree staging: ${clip.shotDetail.blocking.trim()}.`
    : visibleChars.length >= 2
      ? `Character staging: clearly separate ${visibleChars.map((v) => v.char.name).join(' and ')} in frame with distinct positions, faces, and outfits so identities and clothes never blend.`
      : ''

  // Framing line
  const framingLine = buildFramingLine(project, clip, style.category)

  // Scene description
  const sceneBlock = [
    settingLine,
    povLine,
    scene,
    emotionLine,
    propsLine,
    propPlacementLine,
    lightingLine,
    blockingLine,
    framingLine
  ]
    .filter(Boolean)
    .join('\n')
  parts.push(`Scene:\n${sceneBlock}`)

  // Wardrobe & Characters (strictly bound to each character's own Reference Image index when present)
  if (visibleChars.length > 0) {
    const wardrobeLines = visibleChars.map(({ char, deriv }) => {
      const cIdx = refIdxForChar(char, deriv)
      if (deriv) {
        const kp = deriv.costumeKeyphrase ? `; key elements: ${deriv.costumeKeyphrase}` : ''
        const desc = `${deriv.promptChange || 'modified attire'}${kp}`
        return cIdx
          ? `- ${char.name} [Reference Image ${cIdx}]: EXACT costume "${deriv.name}" from Ref ${cIdx} (${desc}).`
          : `- ${char.name}: EXACT costume "${deriv.name}" (${desc}).`
      }
      const defOutfit = char.profile?.visual?.defaultOutfit?.trim() || char.description?.trim() || ''
      if (cIdx) {
        return `- ${char.name} [Reference Image ${cIdx}]: EXACT outfit from Ref ${cIdx}${defOutfit ? ` (${defOutfit})` : ''}.`
      }
      return `- ${char.name}: EXACT outfit (${defOutfit || 'signature Lorebook outfit'}).`
    })

    parts.push(
      `Wardrobe: (STRICT COSTUME LOCK — preserve exact garment cut, fabric motif/pattern, sleeves & styling from Lorebook/reference; never substitute generic default clothing)\n${wardrobeLines.join('\n')}\n\n` +
      `Character visual details:\n` +
      visibleChars
        .map(({ char, deriv }) => {
          const cIdx = refIdxForChar(char, deriv)
          const traits = formatCharacterTraits(char, false)
          const line = traits ? `${char.name}: ${traits}` : char.name
          return `${cIdx ? `[Reference Image ${cIdx}] ` : ''}${line}`
        })
        .join('\n')
    )
  }

  if (lockBlock) parts.push(lockBlock)

  if (avoid) parts.push(`Must not appear in the image: ${avoid}.`)
  parts.push(`Frame format ${project.aspectRatio}, single unbroken frame rendered strictly in the target Art style above, full-bleed composition.`)

  const full = parts.join('\n\n')
  if (full.length <= limit) return full

  // Gracefully trim to fit shorter prompt limits while keeping reference binding, art style, POV, and wardrobe intact.
  const essentialScene = [povLine, scene, propPlacementLine].filter(Boolean).join('\n')
  const charBlock = `Wardrobe: ${visibleChars.map(({ char, deriv }) => compactCharacterLine(char, deriv)).join('; ')}`
  const locBlock = loc ? `Setting: ${formatLocationDetails(loc)}.` : ''
  const compactRef =
    refItems && refItems.length > 0
      ? `REFERENCE IMAGE BINDING: ${refItems.map((r, i) => `Image ${i + 1}=${r.name} (${r.kind})`).join(', ')}. Match exact identity/costume/location/prop; change POV per Scene while keeping anchor room & props fixed.`
      : refNames.length > 0
        ? `REFERENCE IMAGE BINDING: ${refNames.map((n, i) => `Image ${i + 1}=${n}`).join(', ')}.`
        : ''
  const styleBlock = `Art style: ${stylePrompt}${paletteNote}`
  const avoidBlock = avoid ? `Must not appear: ${avoid}.` : ''

  const candidateParts = [compactRef, styleBlock, essentialScene, charBlock, locBlock, lockBlock, avoidBlock].filter(Boolean)
  let candidate = candidateParts.join('\n\n')
  if (candidate.length <= limit) return candidate

  const withoutAvoid = [essentialScene, charBlock, locBlock, compactRef, lockBlock, styleBlock].filter(Boolean)
  candidate = withoutAvoid.join('\n\n')
  if (candidate.length <= limit) return candidate

  const nonSceneLength = candidate.length - essentialScene.length
  const maxSceneLen = Math.max(0, limit - nonSceneLength - 5)
  const trimmedScene = maxSceneLen > 20 ? `${essentialScene.slice(0, maxSceneLen)}...` : ''

  return [trimmedScene, charBlock, loc ? `Setting: ${loc.name}.` : '', compactRef, lockBlock, styleBlock].filter(Boolean).join('\n\n')
}

/**
 * Compiles a video prompt for a clip (§8.C and §6.C):
 * Subject motion + camera movement + object interaction + single-take coherence.
 * For video dialogue clips (§6.C), adds exact spoken line block and dialogue variant ending.
 * Otherwise ends with NO_MUSIC.
 */
export function compileClipVideoPrompt(
  project: { styleId: string; aspectRatio: AspectRatio; dialogAudio?: 'video' | 'tts' },
  clip: Clip,
  characters: Character[] = [],
  lockWordsOrMaxLen: LockWord[] | number = [],
  maybeMaxLen = 2000
): string {
  const rawLockWords = Array.isArray(lockWordsOrMaxLen) ? lockWordsOrMaxLen : []
  const maxLen = typeof lockWordsOrMaxLen === 'number' ? lockWordsOrMaxLen : maybeMaxLen
  const scopedLocks = filterLockWordsForClip(rawLockWords, clip)
  const lockBlock = renderLockBlock(scopedLocks)

  const { scene } = splitAvoid(clip.visualPrompt)
  let baseMotion = clip.videoPrompt.trim()
  if (!baseMotion) {
    const cam = clip.shotDetail?.cameraMotion ? `Camera motion: ${clip.shotDetail.cameraMotion}.` : 'Smooth subtle cinematic camera push-in.'
    const blocking = clip.shotDetail?.blocking ? ` ${clip.shotDetail.blocking.replace(/\.$/, '')}.` : ''
    baseMotion = `${scene.replace(/\.$/, '')}.${blocking} Natural lifelike character micro-expressions and subtle environmental motion. ${cam}`
  }
  if (clip.shotDetail?.nonSpeakingReaction && !baseMotion.toLowerCase().includes(clip.shotDetail.nonSpeakingReaction.toLowerCase().slice(0, 18))) {
    baseMotion = `${baseMotion} Background/listener reaction: ${clip.shotDetail.nonSpeakingReaction.replace(/\.$/, '')}.`
  }

  const coherenceRule =
    'Single continuous unbroken shot with no scene cuts or sudden camera jumps; strictly preserve the exact faces, hairstyles, costumes, props, lighting, and art style of the starting frame.'

  const charMap = new Map(characters.map((c) => [c.id, c]))
  const dType = clip.shotDetail?.dialogueType ?? (clip.speakerId ? 'dialogue' : 'narration')
  const isVideoDialog = clip.speakerId && project.dialogAudio === 'video' && clip.narration.trim() && dType === 'dialogue'

  if (isVideoDialog) {
    const speaker = charMap.get(clip.speakerId!)
    const speakerName = speaker?.name || 'Character'
    const emotion = clip.emotion ? `with ${clip.emotion} expression` : 'with natural emotional expression'
    const voiceStyle = speaker?.voiceStyle ? `, voice tone: ${speaker.voiceStyle}` : ''
    const delivery = clip.shotDetail?.speechDelivery ? `, delivery: ${clip.shotDetail.speechDelivery}` : ''
    const dialogBlock = `Spoken line: "${clip.narration.trim()}", spoken clearly on-screen by ${speakerName} ${emotion}${voiceStyle}${delivery}. Accurate natural lip-sync, expressive eyes, and subtle head/hand gestures synchronized to the words. ${coherenceRule} ${NO_MUSIC_DIALOG}`
    const suffix = lockBlock ? `${lockBlock}\n\n${dialogBlock}` : dialogBlock

    const combined = `${baseMotion}\n\n${suffix}`
    if (combined.length <= maxLen) return combined
    return `${baseMotion.slice(0, Math.max(0, maxLen - suffix.length - 10))}...\n\n${suffix}`
  }

  // Non-dialog video prompt: append coherence rule + NO_MUSIC instruction
  const cleanBase = baseMotion.replace(/\s*No background music[^\n]*$/i, '').trim()
  const suffix = [lockBlock, coherenceRule, NO_MUSIC].filter(Boolean).join(' ')
  const combined = `${cleanBase} ${suffix}`
  if (combined.length <= maxLen) return combined
  return `${cleanBase.slice(0, Math.max(0, maxLen - suffix.length - 5))}... ${suffix}`
}
