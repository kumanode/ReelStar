import { getStyle } from './styles'
import { NO_MUSIC, NO_MUSIC_DIALOG } from './higgsfield'
import type { AspectRatio, Character, CharacterDerivative, Clip, Location, Prop } from './types'

export interface ReferenceSheetItem {
  kind: 'character' | 'derivative' | 'location' | 'prop'
  id: string
  name: string
  sheetAssetId: string
}

export interface CompileClipPromptOptions {
  project: {
    id: string
    styleId: string
    aspectRatio: AspectRatio
  }
  clip: Clip
  characters: Character[]
  derivatives?: CharacterDerivative[]
  locations?: Location[]
  props?: Prop[]
  refNames?: string[]
  limit?: number
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

/**
 * Collects reference sheet assets for a clip following the 4-tier priority order (§8.C):
 * 1. Costume variant sheet of focus character / speaker (or base character sheet if no variant)
 * 2. Sheets of other visible characters
 * 3. Location sheet
 * 4. Prop sheets
 */
export function collectReferenceSheets(
  clip: Clip,
  characters: Character[],
  derivatives: CharacterDerivative[] = [],
  locations: Location[] = [],
  props: Prop[] = [],
  maxRefs = 3
): ReferenceSheetItem[] {
  const result: ReferenceSheetItem[] = []
  const seenSheets = new Set<string>()

  function add(item: ReferenceSheetItem | null) {
    if (!item || !item.sheetAssetId) return
    if (seenSheets.has(item.sheetAssetId)) return
    seenSheets.add(item.sheetAssetId)
    result.push(item)
  }

  const charMap = new Map(characters.map((c) => [c.id, c]))
  const derivMap = new Map(derivatives.map((d) => [d.id, d]))
  const locMap = new Map(locations.map((l) => [l.id, l]))
  const propMap = new Map(props.map((p) => [p.id, p]))

  const visibleCharIds = clip.characterIds || []
  if (visibleCharIds.length > 0) {
    // 1. Focus character: speaker if visible in scene, otherwise first visible character
    const focusCharId =
      clip.speakerId && visibleCharIds.includes(clip.speakerId) ? clip.speakerId : visibleCharIds[0]
    const focusChar = charMap.get(focusCharId)
    if (focusChar) {
      const costumeId = clip.costumeIds?.[focusCharId]
      const deriv = costumeId ? derivMap.get(costumeId) : null
      if (deriv && deriv.sheetAssetId) {
        add({
          kind: 'derivative',
          id: deriv.id,
          name: `${focusChar.name} (${deriv.name})`,
          sheetAssetId: deriv.sheetAssetId
        })
      } else if (focusChar.sheetAssetId) {
        add({
          kind: 'character',
          id: focusChar.id,
          name: focusChar.name,
          sheetAssetId: focusChar.sheetAssetId
        })
      }
    }

    // 2. Other visible characters
    for (const cid of visibleCharIds) {
      if (cid === focusCharId) continue
      const ch = charMap.get(cid)
      if (!ch) continue
      const costumeId = clip.costumeIds?.[cid]
      const deriv = costumeId ? derivMap.get(costumeId) : null
      if (deriv && deriv.sheetAssetId) {
        add({
          kind: 'derivative',
          id: deriv.id,
          name: `${ch.name} (${deriv.name})`,
          sheetAssetId: deriv.sheetAssetId
        })
      } else if (ch.sheetAssetId) {
        add({
          kind: 'character',
          id: ch.id,
          name: ch.name,
          sheetAssetId: ch.sheetAssetId
        })
      }
    }
  }

  // 3. Location sheet
  if (clip.locationId) {
    const loc = locMap.get(clip.locationId)
    if (loc && loc.sheetAssetId) {
      add({
        kind: 'location',
        id: loc.id,
        name: loc.name,
        sheetAssetId: loc.sheetAssetId
      })
    }
  }

  // 4. Prop sheets
  if (clip.propIds && clip.propIds.length > 0) {
    for (const pid of clip.propIds) {
      const pr = propMap.get(pid)
      if (pr && pr.sheetAssetId) {
        add({
          kind: 'prop',
          id: pr.id,
          name: pr.name,
          sheetAssetId: pr.sheetAssetId
        })
      }
    }
  }

  return result.slice(0, maxRefs)
}

function characterLine(c: Character): string {
  const v = c.profile?.visual
  const traits = v ? [v.bodyType, v.hair, v.facialFeatures, v.distinctiveFeatures].filter(Boolean).join(', ') : ''
  return `${c.name}: ${c.description}${traits ? ` (${traits})` : ''}`
}

/** One line per character for short prompt limits: identity and outfit together, since there is no Wardrobe block. */
function compactCharacterLine(c: Character, deriv: CharacterDerivative | null): string {
  const outfit = deriv ? [deriv.name, deriv.costumeKeyphrase || deriv.promptChange].filter(Boolean).join(' - ') : ''
  return outfit ? `${c.name}: ${c.description}; wears ${outfit}` : `${c.name}: ${c.description}`
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

/**
 * Compiles a structured, labelled image prompt for a clip (§8.C):
 * Scene, Wardrobe, Action & Emotion, Location & Setting, Props, Recurring Characters, Art style, Avoid.
 */
export function compileClipPrompt(opts: CompileClipPromptOptions): string {
  const { project, clip, characters, derivatives = [], locations = [], props = [], refNames = [], limit = 4000 } = opts
  const style = getStyle(project.styleId)
  const split = splitAvoid(clip.visualPrompt)
  const avoid = split.avoid

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

  const parts: string[] = []

  const loc = clip.locationId ? locMap.get(clip.locationId) : null
  // Lorebook data is the source of truth for setting, framing and costumes. writePrompts copied them into the
  // storyboard prompt when it ran; those copies go stale when a costume's prompt_change or a location is edited,
  // so they are replaced here, and the basis hash (built from this prompt) marks the image stale.
  const scene = withoutLines(split.scene, ['framing', ...(loc ? ['setting'] : []), ...(visibleChars.length ? ['wardrobe'] : [])])
  const settingLine = loc ? `Setting: ${loc.name}${loc.description ? `, ${loc.description}` : ''}.` : ''

  // Props line
  const clipProps = (clip.propIds || []).map((pid) => propMap.get(pid)).filter(Boolean) as Prop[]
  const propsLine = clipProps.length ? `Key items/props present: ${clipProps.map((p) => `${p.name} (${p.description || 'in frame'})`).join(', ')}.` : ''

  // Emotion line
  const emotionLine = clip.emotion ? `Subject emotion: intense ${clip.emotion} expression.` : ''

  // Expanded Shot Details: Lighting & Blocking
  const lightingLine = clip.shotDetail?.lighting ? `Lighting: ${clip.shotDetail.lighting}.` : ''
  const blockingLine = clip.shotDetail?.blocking ? `Blocking & character staging: ${clip.shotDetail.blocking}.` : ''

  // Framing line
  const orientation = project.aspectRatio === '9:16' ? 'vertical 9:16 full-bleed' : `${project.aspectRatio} full-bleed`
  const framingLine = `Framing & composition: ${clip.framing || 'medium close-up'}, ${orientation}, shallow depth of field, clear atmospheric lighting.`

  // Scene description
  const sceneBlock = [settingLine, scene, emotionLine, propsLine, lightingLine, blockingLine, framingLine].filter(Boolean).join('\n')
  parts.push(`Scene:\n${sceneBlock}`)

  // Wardrobe & Characters
  if (visibleChars.length > 0) {
    const wardrobeLines = visibleChars.map(({ char, deriv }) => {
      if (deriv) {
        const kp = deriv.costumeKeyphrase ? `. Key costume elements: ${deriv.costumeKeyphrase}` : ''
        return `${char.name} wears custom outfit "${deriv.name}": ${deriv.promptChange || 'modified attire'}${kp}.`
      }
      return `${char.name} wears default outfit as shown on their reference sheet.`
    })

    parts.push(
      `Wardrobe:\n${wardrobeLines.join('\n')}\n\n` +
      `Recurring characters in this scene. Keep each one's body, face, hair and skin exactly as described${refNames.length ? ' and as on their reference sheet' : ''}:\n` +
      visibleChars.map(({ char }) => characterLine(char)).join('\n')
    )
  }

  // Reference images instruction
  if (refNames.length > 0) {
    parts.push(
      `Reference images are provided in this exact order: ${refNames.join(', ')}. Use them strictly for identity, face consistency, costume details and colors. Do not copy the sheet layout, poses or plain background.`
    )
  }

  parts.push(`Art style: ${style.prompt}`)
  if (avoid) parts.push(`Must not appear in the image: ${avoid}.`)
  parts.push(`Frame format ${project.aspectRatio}, full-bleed composition.`)

  const full = parts.join('\n\n')
  if (full.length <= limit) return full

  // Gracefully trim to fit shorter prompt limits
  return [
    scene,
    visibleChars.map(({ char, deriv }) => compactCharacterLine(char, deriv)).join('; '),
    loc ? `Setting: ${loc.name}` : '',
    avoid && `Must not appear: ${avoid}.`,
    style.prompt
  ].filter(Boolean).join('\n\n')
}

/**
 * Compiles a video prompt for a clip (§8.C and §6.C):
 * Subject motion + camera movement + object interaction.
 * For video dialogue clips (§6.C), adds exact spoken line block and dialogue variant ending.
 * Otherwise ends with NO_MUSIC.
 */
export function compileClipVideoPrompt(
  project: { styleId: string; aspectRatio: AspectRatio; dialogAudio?: 'video' | 'tts' },
  clip: Clip,
  characters: Character[] = [],
  maxLen = 2000
): string {
  const { scene } = splitAvoid(clip.visualPrompt)
  let baseMotion = clip.videoPrompt.trim()
  if (!baseMotion) {
    const cam = clip.shotDetail?.cameraMotion ? `Camera motion: ${clip.shotDetail.cameraMotion}.` : 'The camera slowly pushes in.'
    baseMotion = `${scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, ${cam} Keep the art style of the first frame.`
  }
  if (clip.shotDetail?.nonSpeakingReaction) {
    baseMotion = `${baseMotion} Reaction: ${clip.shotDetail.nonSpeakingReaction}.`
  }

  const charMap = new Map(characters.map((c) => [c.id, c]))
  const isVideoDialog = clip.speakerId && project.dialogAudio === 'video' && clip.narration.trim()

  if (isVideoDialog) {
    const speaker = charMap.get(clip.speakerId!)
    const speakerName = speaker?.name || 'Character'
    const emotion = clip.emotion ? `with intense ${clip.emotion} expression` : 'with natural expression'
    const voiceStyle = speaker?.voiceStyle ? `, voice style: ${speaker.voiceStyle}` : ''
    const delivery = clip.shotDetail?.speechDelivery ? `, speech delivery: ${clip.shotDetail.speechDelivery}` : ''
    const dialogBlock = `Spoken line: "${clip.narration.trim()}", spoken by ${speakerName} ${emotion}${voiceStyle}${delivery}. Lip movements naturally sync with the spoken words. ${NO_MUSIC_DIALOG}`

    const combined = `${baseMotion}\n\n${dialogBlock}`
    if (combined.length <= maxLen) return combined
    return `${baseMotion.slice(0, maxLen - dialogBlock.length - 10)}...\n\n${dialogBlock}`
  }

  // Non-dialog video prompt: append NO_MUSIC instruction
  const combined = `${baseMotion.replace(/\s*No background music[^\n]*$/i, '').trim()} ${NO_MUSIC}`
  if (combined.length <= maxLen) return combined
  return `${baseMotion.slice(0, maxLen - NO_MUSIC.length - 5)}... ${NO_MUSIC}`
}
