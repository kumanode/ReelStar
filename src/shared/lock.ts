import type { Character, CharacterDerivative, Clip, Location, LockWord, Prop } from './types'

const joinUnique = (parts: Array<string | undefined | null>): string => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of parts) {
    const clean = (raw ?? '').trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out.join(', ')
}

export function buildLockWords(params: {
  characters?: Character[]
  derivatives?: CharacterDerivative[]
  locations?: Location[]
  props?: Prop[]
  existing?: LockWord[]
}): LockWord[] {
  const { characters = [], derivatives = [], locations = [], props = [], existing = [] } = params
  const existingMap = new Map<string, LockWord>()
  for (const item of existing) {
    existingMap.set(item.id, item)
  }

  const result: LockWord[] = []

  // 1. Character locks (face, hair, build & distinguishing traits)
  for (const c of characters) {
    const v = c.profile?.visual
    const traits = v
      ? joinUnique([
          v.age,
          v.gender,
          v.bodyType || v.body,
          v.hair,
          v.facialFeatures || v.face,
          v.distinctiveFeatures || v.distinguishingFeatures,
          v.accessories
        ])
      : ''
    const text = traits ? `${c.name}: ${traits}` : (c.description ? `${c.name}: ${c.description}` : '')
    if (text) {
      const id = `char-${c.id}`
      const prev = existingMap.get(id)
      result.push({
        id,
        label: `${c.name} (wajah & rambut)`,
        text,
        source: 'character',
        sourceId: c.id,
        enabled: prev ? prev.enabled : true
      })
    }
  }

  // 2. Costume variant locks (costume keyphrase)
  for (const d of derivatives) {
    const text = d.costumeKeyphrase?.trim() || d.promptChange?.trim()
    if (text) {
      const id = `costume-${d.id}`
      const prev = existingMap.get(id)
      result.push({
        id,
        label: `Kostum "${d.name}"`,
        text: d.costumeKeyphrase?.trim() ? `Costume ${d.name}: ${d.costumeKeyphrase}` : `Costume: ${d.promptChange}`,
        source: 'costume',
        sourceId: d.id,
        enabled: prev ? prev.enabled : true
      })
    }
  }

  // 3. Location locks (permanent architectural & lighting traits)
  for (const l of locations) {
    const v = l.profile
    const traits = v
      ? joinUnique([
          v.interiorExterior || v.placeType,
          v.architecturalStyle,
          v.colorPalette,
          v.spatialLayout,
          v.fixedDetails,
          v.keyFeatures,
          v.timeOfDayLighting || v.lighting,
          v.atmosphere
        ])
      : ''
    const text = traits ? `${l.name}: ${traits}` : (l.description ? `${l.name}: ${l.description}` : '')
    if (text) {
      const id = `loc-${l.id}`
      const prev = existingMap.get(id)
      result.push({
        id,
        label: `Lokasi "${l.name}"`,
        text,
        source: 'location',
        sourceId: l.id,
        enabled: prev ? prev.enabled : true
      })
    }
  }

  // 4. Prop locks (shape/material/appearance)
  for (const p of props) {
    const v = p.profile
    const traits = v
      ? joinUnique([v.category, v.sizeScale, v.material, v.shape, v.appearance, v.distinctiveDetails, v.status])
      : ''
    const text = traits ? `${p.name}: ${traits}` : (p.description ? `${p.name}: ${p.description}` : '')
    if (text) {
      const id = `prop-${p.id}`
      const prev = existingMap.get(id)
      result.push({
        id,
        label: `Prop "${p.name}"`,
        text,
        source: 'prop',
        sourceId: p.id,
        enabled: prev ? prev.enabled : true
      })
    }
  }

  // 5. Retain all manual entries
  for (const item of existing) {
    if (item.source === 'manual') {
      result.push(item)
    }
  }

  return result
}

/**
 * Filters lock words down to those relevant to a specific clip so off-screen characters,
 * unrelated costumes, other locations, or absent props never bleed into this shot's prompt.
 * Manual locks (and legacy locks without a sourceId) remain global.
 */
export function filterLockWordsForClip(
  lockWords: LockWord[] = [],
  clip?: Pick<Clip, 'characterIds' | 'costumeIds' | 'locationId' | 'propIds'> | null
): LockWord[] {
  if (!lockWords.length || !clip) return lockWords
  const charIds = new Set(clip.characterIds ?? [])
  const costumeIds = new Set(Object.values(clip.costumeIds ?? {}).filter(Boolean))
  const propIds = new Set(clip.propIds ?? [])
  const locId = clip.locationId ?? null

  return lockWords.filter((w) => {
    if (w.source === 'manual' || !w.sourceId) return true
    if (w.source === 'character') return charIds.has(w.sourceId)
    if (w.source === 'costume') return costumeIds.has(w.sourceId)
    if (w.source === 'location') return locId === w.sourceId
    if (w.source === 'prop') return propIds.has(w.sourceId)
    return true
  })
}

export function renderLockBlock(lockWords: LockWord[] = []): string {
  const active = (lockWords || []).filter((w) => w.enabled && w.text.trim())
  if (!active.length) return ''
  const lines = active.map((w) => w.text.trim()).join('; ')
  return `LOCKED (keep verbatim): ${lines}.`
}

export function checkLockCompliance(
  prompt: string,
  lockWords: LockWord[] = []
): { compliant: boolean; missing: LockWord[] } {
  const active = (lockWords || []).filter((w) => w.enabled && w.text.trim())
  if (!active.length) return { compliant: true, missing: [] }
  const lowerPrompt = prompt.toLowerCase()
  const missing: LockWord[] = []
  for (const w of active) {
    const keyPhrases = w.text
      .split(/[;,]/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 4)
    const found = keyPhrases.length === 0 || keyPhrases.some((phrase) => lowerPrompt.includes(phrase))
    if (!found) {
      missing.push(w)
    }
  }
  return { compliant: missing.length === 0, missing }
}
