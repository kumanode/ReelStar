import { LEGACY_STYLES } from './legacyStyles'
import { NO_TEXT } from './styleText'
export type StyleCategory = 'liveaction' | 'animation' | 'custom'

export interface VisualStyle {
  id: string
  name: string
  category: StyleCategory
  niche: string
  /** Tile colors used for the picker until a real sample image exists. */
  swatch: string
  ink: string
  /** Appended to every image prompt in the project. */
  prompt: string
  /** How characters should look on the character sheet. */
  characterHint: string
}

export const STYLE_CATEGORIES: { id: StyleCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'liveaction', label: 'Live Action' },
  { id: 'animation', label: 'Animasi' },
  { id: 'custom', label: 'Kustom' }
]

export { NO_TEXT } from './styleText'

export const VISUAL_STYLES: VisualStyle[] = [
  // ==========================================
  // LIVE ACTION (20 styles)
  // ==========================================
  {
    id: 'premium_drama',
    name: 'Premium Drama',
    category: 'liveaction',
    niche: 'Drama TV · Komposisi rapi',
    swatch: '#3D342D',
    ink: '#F5EBE6',
    prompt:
      'High-end prestige TV drama cinematography, master framing, Arri Alexa LF cinema camera, naturalistic motivated lighting, shallow depth of field, warm-neutral subtle elegant color grading, crisp 4K photographic texture, television broadcast quality. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic prestige television drama character captured with naturalistic cinematic lighting and refined 4K skin texture'
  },
  {
    id: 'sinetron_indonesia',
    name: 'Sinetron Indonesia',
    category: 'liveaction',
    niche: 'Melodrama TV · Pencahayaan terang',
    swatch: '#8B5E3C',
    ink: '#FEF3C7',
    prompt:
      'Indonesian prime-time television soap opera (sinetron) cinematography, crisp high-clarity digital broadcast TV camera look, bright even high-key warm studio and motivated lighting, flattering key and fill light with clean glossy skin highlights, warm cream and vibrant natural color grading, shallow-to-moderate depth of field, minimal film grain, expressive melodramatic television drama framing. ' +
      NO_TEXT,
    characterHint:
      'a realistic contemporary Indonesian television drama character with polished TV-ready styling and expressive eyes, lit by bright even warm broadcast lighting'
  },
  {
    id: 'horor_indonesia',
    name: 'Horor Indonesia',
    category: 'liveaction',
    niche: 'Mistis lokal · Gelap mencekam',
    swatch: '#1C2621',
    ink: '#D6E2D8',
    prompt:
      'Indonesian supernatural horror cinema still, atmospheric 35mm filmic live-action cinematography with subtle organic grain, dark low-key chiaroscuro lighting, sickly desaturated teal-green and damp earthy umber color grading, dim warm flickering practical tungsten or oil-lamp side glow against deep ink-black shadows, humid tropical night mist, eerie negative space, haunting Indonesian mystical dread aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a realistic Indonesian horror cinema character with pale natural skin texture and tense atmosphere, dramatically sculpted by dim warm side light and cold eerie low-key shadows'
  },
  {
    id: 'cinematic_historical',
    name: 'Cinematic Historical',
    category: 'liveaction',
    niche: 'Cahaya profesional · Kualitas TV',
    swatch: '#4A3326',
    ink: '#EAD7C5',
    prompt:
      'High-budget historical period drama cinematography, rich theatrical color palette, warm dramatic side lighting and soft rim highlights, atmospheric candle and lantern-toned glow, delicate atmospheric haze, shallow cinematic depth of field, prestige television broadcast production value. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic historical period drama character lit by warm dramatic side light and subtle rim glow, captured on cinema cameras'
  },
  {
    id: 'zhang_yimou',
    name: 'Zhang Yimou',
    category: 'liveaction',
    niche: 'Warna tegas · Ritual',
    swatch: '#8B1E1E',
    ink: '#FBE8A6',
    prompt:
      'Zhang Yimou cinematic aesthetic, rich saturated jewel-tone primary colors accented with lavish crimson and gold tones, grand symmetrical composition, bold ceremonial visual balance, intense atmospheric mood, poetic dramatic lighting, monumental live-action cinema scale. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic live-action cinema character styled in Zhang Yimou theatrical lighting with rich saturated color harmony and dramatic contrast'
  },
  {
    id: 'ancient_xianxia',
    name: 'Ancient Xianxia',
    category: 'liveaction',
    niche: 'Linjiangxian · Filter lembut',
    swatch: '#3A506B',
    ink: '#E0FBFC',
    prompt:
      'Ethereal ancient Chinese Xianxia fantasy live-action drama cinematography, luminous soft-focus romantic bloom filter, swirling atmospheric mist, subtle glowing ethereal light motes, serene jade-teal and pearlescent ivory-gold celestial lighting, dreamlike mythological fantasy tone. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic ethereal Xianxia fantasy character bathed in soft luminous bloom and celestial atmospheric lighting'
  },
  {
    id: 'theatrical_film',
    name: 'Theatrical Film',
    category: 'liveaction',
    niche: 'Grading DaVinci · Sinematik',
    swatch: '#242B35',
    ink: '#F0F3F4',
    prompt:
      'Theatrical feature film still, master DaVinci Resolve color grading, subtle organic 35mm film grain, rich deep shadow roll-off, moody teal and warm amber cinematic contrast, creamy shallow depth-of-field bokeh, dramatic storytelling framing, blockbuster cinema aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic theatrical feature film character with natural textured skin, nuanced lighting, and rich cinema color grading'
  },
  {
    id: 'spartan_epic',
    name: 'Spartan Epic',
    category: 'liveaction',
    niche: 'Gladiator · Kontras tinggi',
    swatch: '#5C2D1E',
    ink: '#F5D6BA',
    prompt:
      'Gritty Spartan epic film still, Gladiator live-action aesthetic, harsh high-contrast dramatic lighting with piercing sunbeams, desaturated bronze-ochre and scorched charcoal color grading, gritty dust and airborne ember atmosphere, raw weathered texture, visceral epic cinema intensity. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic gritty epic film character with raw weathered skin texture, harsh dramatic contrast, and intense cinematic lighting'
  },
  {
    id: 'blade_runner',
    name: 'Blade Runner',
    category: 'liveaction',
    niche: 'Minimalis · Partikel siber',
    swatch: '#0E3B43',
    ink: '#48E5C2',
    prompt:
      'Blade Runner 2049 neo-noir sci-fi live-action cinematography, stark moody cold cyan and deep slate-blue color palette, wet rain-slicked surface reflections, dense volumetric mist and atmospheric haze, dark minimalist architectural shadows, crisp realistic cinematic contrast. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic neo-noir sci-fi live-action character lit by cold moody cyan rim light and soft rainy night reflections'
  },
  {
    id: 'game_of_thrones',
    name: 'Game of Thrones',
    category: 'liveaction',
    niche: 'Epik dingin · Intrik',
    swatch: '#2B2D42',
    ink: '#EDF2F4',
    prompt:
      'Grimdark medieval epic live-action film still, Game of Thrones cinematography aesthetic, cold desaturated slate-gray and muted earth tones, overcast diffused natural lighting, chilling atmospheric mist, gritty weathered organic textures, somber dramatic realism. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic grimdark medieval drama character with raw weathered realistic features under cold desaturated overcast lighting'
  },
  {
    id: 'breaking_bad',
    name: 'Breaking Bad',
    category: 'liveaction',
    niche: 'Filter Latin · Estetika kriminal',
    swatch: '#8C5A24',
    ink: '#FDE68A',
    prompt:
      'Gritty crime thriller cinematography, intense New Mexico sun-bleached amber and burnt-orange color grade, harsh direct sunlight with razor-sharp shadows, raw unpolished photographic realism, crisp dry texture, high-tension neo-western crime drama atmosphere. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic grounded crime drama character with raw natural weathered skin texture under harsh high-contrast sunlight'
  },
  {
    id: 'kdrama_idol',
    name: 'K-Drama Idol',
    category: 'liveaction',
    niche: 'Cahaya lembut · Romansa',
    swatch: '#D4A373',
    ink: '#FEFAE0',
    prompt:
      'Korean romantic drama live-action film still, airy high-key soft diffused beauty lighting, clean bright natural backlight, gentle pastel-neutral color palette, smooth luminous skin tones, dreamy shallow depth of field, tender polished contemporary Seoul drama aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic stylish Korean drama character with luminous natural skin and gentle flattering diffused lighting'
  },
  {
    id: 'kurosawa',
    name: 'Kurosawa',
    category: 'liveaction',
    niche: 'Hitam-putih kontras · Epik',
    swatch: '#262626',
    ink: '#F5F5F5',
    prompt:
      'Akira Kurosawa epic cinema still, deep high-contrast black and white 35mm cinematography, dramatic chiaroscuro sky lighting, crisp silver highlights and rich charcoal blacks, swirling atmospheric mist and wind energy, bold dynamic staging, classic Japanese cinematic realism. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic dramatic black-and-white cinema character sculpted by stark high-contrast classic Japanese film lighting'
  },
  {
    id: 'nolan',
    name: 'Nolan',
    category: 'liveaction',
    niche: 'IMAX · Biru-abu dingin',
    swatch: '#1E293B',
    ink: '#E2E8F0',
    prompt:
      'Christopher Nolan film still, crisp 70mm IMAX live-action cinematography, clean cool steely blue-gray color palette, sharp high-clarity realistic lighting, grounded practical cinematic scale, deep restrained contrast, intense cerebral thriller atmosphere. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic live-action thriller character captured on 70mm IMAX with crisp cool blue-gray natural lighting'
  },
  {
    id: 'tarantino',
    name: 'Tarantino',
    category: 'liveaction',
    niche: 'Kontras tinggi · Keras, retro',
    swatch: '#7F1D1D',
    ink: '#FEF08A',
    prompt:
      'Quentin Tarantino retro cinema still, punchy vibrant 1970s Technicolor aesthetic, high-contrast saturated crimson red and bold yellow-amber tones, crisp theatrical lighting, snappy wide-angle cinematic framing, bold edgy pulp crime atmosphere. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic charismatic retro pulp cinema character lit with bold high-contrast vibrant 1970s color grading'
  },
  {
    id: 'david_lynch',
    name: 'David Lynch',
    category: 'liveaction',
    niche: 'Keseharian · Mimpi buruk surealis',
    swatch: '#31101E',
    ink: '#FCA5A5',
    prompt:
      'David Lynch surrealist live-action film still, eerie unsettling dreamlike atmosphere, deep oppressive noir shadows pierced by sinister crimson-red ambient light, high enigmatic contrast, textured vintage film grain, haunting subconscious thriller aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic surrealist thriller character lit by moody sinister crimson side light and deep uncanny shadows'
  },
  {
    id: 'wes_anderson',
    name: 'Wes Anderson',
    category: 'liveaction',
    niche: 'Warna permen · Makaron',
    swatch: '#BE185D',
    ink: '#FCE7F3',
    prompt:
      'Wes Anderson whimsical live-action film still, meticulous symmetrical balanced composition, quirky color-blocked pastel palette of pistachio green, pale candy pink, and soft mustard yellow, crisp flat-lit vintage storybook lighting, clean stylized deadpan aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic deadpan whimsical cinema character photographed with crisp even lighting and clean pastel color harmony'
  },
  {
    id: 'wong_kar_wai',
    name: 'Wong Kar-wai',
    category: 'liveaction',
    niche: 'Butiran film · Kota Asia',
    swatch: '#1C312E',
    ink: '#6EE7B7',
    prompt:
      'Wong Kar-wai live-action film still, In the Mood for Love aesthetic, subtle nostalgic 35mm film grain, moody nocturnal emerald-olive and rich crimson color palette with warm amber glow, drifting atmospheric haze, shallow painterly depth of field, deep romantic melancholy. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic nostalgic Hong Kong cinema character bathed in moody emerald shadows, warm amber highlights, and soft atmospheric haze'
  },
  {
    id: 'shaw_brothers',
    name: 'Shaw Brothers',
    category: 'liveaction',
    niche: 'Wuxia Hong Kong · Sinematik',
    swatch: '#78350F',
    ink: '#FEF3C7',
    prompt:
      'Hong Kong wuxia live-action cinema still, dramatic theatrical chiaroscuro lighting, rich warm lantern-amber glow against deep dark sepia and charcoal shadows, crisp cinematic contrast, subtle atmospheric smoke haze, classic martial arts drama aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic dramatic Hong Kong wuxia cinema character sculpted by warm lantern-toned theatrical lighting and deep shadows'
  },
  {
    id: 'live_cyberpunk',
    name: 'Live Cyberpunk',
    category: 'liveaction',
    niche: 'Sinematik · Ultra HD',
    swatch: '#0284C7',
    ink: '#E0F2FE',
    prompt:
      'Live-action cyberpunk film still, ultra-high-definition photorealistic cinematic realism, dark rainy night atmosphere, vivid electric cyan and neon magenta rim lighting, wet glossy reflections, sharp micro-detailed textures, atmospheric volumetric haze. ' +
      NO_TEXT,
    characterHint:
      'a photorealistic live-action cyberpunk character lit by vivid electric cyan and neon magenta rim highlights with crisp skin and material detail'
  },

  // ==========================================
  // ANIMATION (18 styles)
  // ==========================================
  {
    id: 'game_cg_3d',
    name: '3D Game CG',
    category: 'animation',
    niche: 'Sinematik · Unreal Engine',
    swatch: '#1F2937',
    ink: '#38BDF8',
    prompt:
      'AAA next-gen video game 3D CG cinematic cutscene render, Unreal Engine 5 photorealistic stylized realism, crisp ray-traced specular reflections, volumetric atmospheric lighting, sleek cool steel-gray palette with subtle electric cyan accents, ultra-detailed PBR material shaders. ' +
      NO_TEXT,
    characterHint:
      'a hyper-detailed Unreal Engine 5 AAA 3D game CGI character with realistic skin shaders and crisp volumetric rim lighting'
  },
  {
    id: 'chinese_3d',
    name: 'Chinese 3D',
    category: 'animation',
    niche: 'Sinematik · Unreal Engine',
    swatch: '#2D3A34',
    ink: '#A7F3D0',
    prompt:
      'Chinese 3D donghua animation film render, Unreal Engine 5 aesthetic, refined semi-photorealistic stylized 3D rendering, soft misty overcast cinematic natural lighting, harmonious muted jade-green and slate-gray palette, delicate translucent fabric and hair physics, high-budget CG beauty. ' +
      NO_TEXT,
    characterHint:
      'a refined Chinese 3D donghua CG character with smooth stylized-realistic features, delicate hair strands, and soft cinematic lighting'
  },
  {
    id: 'kyoto_animation',
    name: 'Kyoto Animation',
    category: 'animation',
    niche: 'Cel lembut · Tateishi',
    swatch: '#FDA4AF',
    ink: '#4C0519',
    prompt:
      'Kyoto Animation 2D anime film still, exquisite soft cel shading, delicate fine line art, warm nostalgic afternoon sunlight with gentle dappled glow, soft pastel color harmony, lush masterfully painted atmospheric backgrounds, emotional anime cinema polish. ' +
      NO_TEXT,
    characterHint:
      'a 2D Kyoto Animation style anime character with clean delicate line art, soft cel shading, and bright expressive eyes'
  },
  {
    id: 'arcane_oil',
    name: 'Arcane (Oil 3D)',
    category: 'animation',
    niche: 'Arcane · Fortiche',
    swatch: '#7C2D12',
    ink: '#FED7AA',
    prompt:
      'Fortiche Arcane animation style, stylized 3D rendering layered with hand-painted oil brush stroke textures, sharp gritty graphic line work, sculptural chiaroscuro painterly lighting, rich moody bronze-rust shadows with vivid luminous color accents, cinematic prestige animation aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a stylized Arcane-inspired 3D character with visible hand-painted oil brushwork on skin, sharp expressive contours, and dramatic painterly lighting'
  },
  {
    id: 'us_3d_animation',
    name: 'US 3D Animation',
    category: 'animation',
    niche: 'Sinematik · Pixar',
    swatch: '#1E3A8A',
    ink: '#DBEAFE',
    prompt:
      'Pixar and Disney style 3D animated feature film render, appealing stylized proportions, soft subsurface-scattering textures, vibrant luminous storybook color palette, rich volumetric rim lighting, soft cinematic depth of field, warm polished family animation aesthetic. ' +
      NO_TEXT,
    characterHint:
      'an appealing Pixar-style stylized 3D animated character with expressive sparkling eyes, soft subsurface-scattering skin, and warm cinematic lighting'
  },
  {
    id: 'hardcore_ink',
    name: 'Hardcore Ink',
    category: 'animation',
    niche: 'Wushan · Kuas kering',
    swatch: '#18181B',
    ink: '#E4E4E7',
    prompt:
      'Traditional Chinese wuxia ink-wash animation art, fierce dynamic dry-brush calligraphy strokes and expressive splash-ink splatters, stark high-contrast monochrome black sumi ink on textured off-white rice paper, swirling ink mist effects, bold martial brushstroke energy. ' +
      NO_TEXT,
    characterHint:
      'a dramatic monochrome Chinese ink-wash character rendered with fierce dry-brush calligraphy lines and expressive ink-splatter textures'
  },
  {
    id: 'ink_papercut',
    name: 'Ink & Papercut',
    category: 'animation',
    niche: 'Wushan · Warna pekat',
    swatch: '#991B1B',
    ink: '#FEF2F2',
    prompt:
      'Stylized Chinese ink-wash and graphic silhouette animation art, bold high-contrast tri-tone palette of stark sumi black, warm cream parchment, and dramatic fiery crimson-red accents, crisp graphic ink contours, layered atmospheric shadow depth, expressive textured brushwork. ' +
      NO_TEXT,
    characterHint:
      'a stylized Chinese graphic ink-art character with crisp dark contours, layered ink shading, and bold crimson-and-black color harmony'
  },
  {
    id: 'felt_stopmotion',
    name: 'Felt Stopmotion',
    category: 'animation',
    niche: 'Stop-motion · Cahaya realistis',
    swatch: '#78350F',
    ink: '#FEF3C7',
    prompt:
      'Handmade needle-felted wool stop-motion animation still, tactile visible fuzzy wool and felt fiber textures, handcrafted miniature set craftsmanship, soft warm artisanal studio lighting, shallow miniature macro depth of field, charming cozy tactile stop-motion aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a handcrafted needle-felted wool stop-motion puppet character with visible fuzzy wool fibers and glossy glass-bead eyes'
  },
  {
    id: 'clay_stopmotion',
    name: 'Clay Stopmotion',
    category: 'animation',
    niche: 'Stop-motion · Komposisi rapi',
    swatch: '#C2410C',
    ink: '#FFEDD5',
    prompt:
      'Claymation stop-motion animation still, Aardman aesthetic, handcrafted sculpted plasticine clay textures with subtle visible fingerprint and tool marks, playful chunky stylized forms, rich matte clay colors, crisp miniature studio spotlighting with soft shadow falloff. ' +
      NO_TEXT,
    characterHint:
      'a handcrafted plasticine claymation puppet character with chunky expressive stylized features and visible sculpted clay textures'
  },
  {
    id: 'jp_horror',
    name: 'JP Horror',
    category: 'animation',
    niche: 'Saturasi rendah · Horor anime',
    swatch: '#27272A',
    ink: '#F4F4F5',
    prompt:
      'Chilling Japanese horror dark anime digital painting, semi-realistic painterly illustration, heavily desaturated pale ghostly gray and muted cold tones, oppressive gloomy shadows, dim eerie low-key lighting, unsettling uncanny psychological dread atmosphere. ' +
      NO_TEXT,
    characterHint:
      'a chilling Japanese horror semi-realistic dark anime character with pale desaturated tones and eerie shadowed features'
  },
  {
    id: 'kr_webtoon',
    name: 'KR Webtoon',
    category: 'animation',
    niche: 'Semi-realistis · Romantis',
    swatch: '#312E81',
    ink: '#E0E7FF',
    prompt:
      'Top-ranking Korean romance manhwa webtoon digital art, polished semi-realistic anime illustration, delicate fine linework with soft luminous airbrushed shading, warm golden-peach romantic backlight glow, dreamy soft bokeh, glamorous contemporary webtoon aesthetic. ' +
      NO_TEXT,
    characterHint:
      'a glamorous semi-realistic Korean romance webtoon character with refined delicate features, fine linework, and soft luminous shading'
  },
  {
    id: 'zenless_zone_zero',
    name: 'Zenless Zone Zero',
    category: 'animation',
    niche: 'Zenless Zone Zero · Neo-siber',
    swatch: '#1E1B4B',
    ink: '#A5B4FC',
    prompt:
      'Zenless Zone Zero neo-cyberpunk anime game visual style, crisp sleek cel-shaded 2D anime illustration, sharp clean dark line art, vivid electric violet and neon cyan rim highlights with kinetic light streaks, glossy specular accents, high-contrast stylish urban action framing. ' +
      NO_TEXT,
    characterHint:
      'a stylish neo-cyberpunk cel-shaded anime character with sharp crisp line art, vivid cyan-violet rim lighting, and sleek modern game-art shading'
  },
  {
    id: 'ghibli',
    name: 'Ghibli',
    category: 'animation',
    niche: 'Miyazaki · Tekstur hangat',
    swatch: '#065F46',
    ink: '#D1FAE5',
    prompt:
      'Studio Ghibli Hayao Miyazaki hand-painted 2D anime film still, lush gouache and watercolor painted textures, warm nostalgic natural sunlight, gentle organic ink outlines, soft harmonious storybook colors, peaceful timeless hand-crafted anime wonder. ' +
      NO_TEXT,
    characterHint:
      'a charming Studio Ghibli hand-painted 2D anime character with gentle organic line art, expressive eyes, and warm nostalgic tones'
  },
  {
    id: 'demon_slayer',
    name: 'Demon Slayer',
    category: 'animation',
    niche: 'Garis tebal · Aksi',
    swatch: '#991B1B',
    ink: '#FEE2E2',
    prompt:
      'Ufotable Demon Slayer anime aesthetic, thick bold black brush-calligraphy contour lines, dramatic high-contrast dynamic cel shading, moody deep night shadows pierced by vivid crimson and warm ember rim highlights, swirling atmospheric mist, intense cinematic action anime look. ' +
      NO_TEXT,
    characterHint:
      'an intense dynamic anime character drawn with thick bold black brush-calligraphy contour lines and high-contrast dramatic cel shading'
  },
  {
    id: 'anim_cyberpunk',
    name: 'Anim Cyberpunk',
    category: 'animation',
    niche: 'Sinematik · HD',
    swatch: '#4C1D95',
    ink: '#EDE9FE',
    prompt:
      'High-definition cyberpunk anime film still, crisp detailed 2D anime cel shading, moody dark rain-slicked night atmosphere, vivid glowing cyan and neon magenta-violet accent reflections, sleek high-contrast glossy lighting, futuristic anime cinema polish. ' +
      NO_TEXT,
    characterHint:
      'a crisp high-definition cyberpunk anime character with clean sharp cel shading and vivid cyan-magenta night rim lighting'
  },
  {
    id: 'bloodborne',
    name: 'Bloodborne',
    category: 'animation',
    niche: 'Gotik · Kabut dingin',
    swatch: '#18181B',
    ink: '#A1A1AA',
    prompt:
      'Dark Victorian gothic fantasy concept art, Bloodborne visual aesthetic, heavily desaturated charcoal-slate and cold ash palette, dense chilling atmospheric mist, pale overcast moonlight with deep brooding shadows, gritty weathered painterly textures, oppressive gothic horror atmosphere. ' +
      NO_TEXT,
    characterHint:
      'a grim dark-fantasy gothic character rendered in gritty painterly concept-art realism with cold pale moonlight and deep shadows'
  },
  {
    id: 'junji_ito',
    name: 'Junji Ito',
    category: 'animation',
    niche: 'Horor · Garis tajam',
    swatch: '#111827',
    ink: '#F3F4F6',
    prompt:
      'Junji Ito inspired horror manga illustration, sharp intense ink linework with dense shadow hatching, stark dramatic chiaroscuro contrast, heavily muted sickly desaturated tones dominated by deep ink blacks, uncanny distorted shadows, claustrophobic psychological horror aesthetic. ' +
      NO_TEXT,
    characterHint:
      'an eerie Japanese horror manga character rendered with sharp intense ink linework, dense dark shadow hatching, and stark unsettling contrast'
  },
  {
    id: 'retro_anime_90s',
    name: '90s Retro Anime',
    category: 'animation',
    niche: 'Watanabe · Kamiyama',
    swatch: '#831843',
    ink: '#FCE7F3',
    prompt:
      'Authentic 1990s retro anime film cel still, Shinichiro Watanabe and Kenji Kamiyama era aesthetic, sharp hand-drawn cel ink line work, classic flat cel shading with rich deep shadows, warm nostalgic dusk-amber and cool slate palette, subtle 35mm analog film grain and soft vintage halation. ' +
      NO_TEXT,
    characterHint:
      'a classic 1990s hand-drawn cel anime character with sharp ink linework, vintage cel shading, and subtle analog film grain'
  },

  // ==========================================
  // CUSTOM
  // ==========================================
  {
    id: 'custom_style',
    name: 'Gaya Kustom',
    category: 'custom',
    niche: 'Prompt bebas pengguna',
    swatch: '#4F46E5',
    ink: '#FFFFFF',
    prompt: NO_TEXT,
    characterHint: 'rendered strictly in the user-specified custom visual style'
  }
]

export function getStyle(id: string): VisualStyle {
  return VISUAL_STYLES.find((s) => s.id === id) ?? LEGACY_STYLES.find((s) => s.id === id) ?? VISUAL_STYLES[0]
}

const RESTRICTED_PALETTE_STYLE_IDS = new Set(['kurosawa', 'hardcore_ink', 'ink_papercut', 'junji_ito'])

/** True for monochrome or strict tri-tone styles whose palette overrides literal color descriptions. */
export function isRestrictedPaletteStyle(id: string): boolean {
  return RESTRICTED_PALETTE_STYLE_IDS.has(id)
}

/**
 * Resolves the effective art style prompt for a project. For `custom_style`, pulls the creator's
 * `seriesGuidelines` so Lorebook sheets and shot prompts all render in the chosen custom aesthetic.
 */
export function resolveStylePrompt(project: { styleId: string; seriesGuidelines?: string }): {
  style: VisualStyle
  prompt: string
  isRestrictedPalette: boolean
} {
  const style = getStyle(project.styleId)
  const custom = style.id === 'custom_style' ? project.seriesGuidelines?.trim() : ''
  const prompt = custom ? `${custom.replace(/\.$/, '')}. ${NO_TEXT}` : style.prompt
  return { style, prompt, isRestrictedPalette: isRestrictedPaletteStyle(style.id) }
}

/** True for a style from the old catalog: shown on its project, never offered in the picker. */
export function isLegacyStyle(id: string): boolean {
  return !VISUAL_STYLES.some((s) => s.id === id) && LEGACY_STYLES.some((s) => s.id === id)
}
