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
  // LIVE ACTION (16 styles)
  // ==========================================
  {
    id: 'premium_drama',
    name: 'Premium Drama',
    category: 'liveaction',
    niche: 'Drama TV · Komposisi rapi',
    swatch: '#3D342D',
    ink: '#F5EBE6',
    prompt:
      'High-end prestige TV drama cinematography, master framing, Arri Alexa LF cinema camera, naturalistic motivated interior lighting, shallow depth of field, sophisticated wardrobe, subtle elegant color grading, crisp 4K texture, television broadcast quality. ' +
      NO_TEXT,
    characterHint: 'a character in high-end prestige television drama attire, naturalistic cinematic lighting and elegant styling'
  },
  {
    id: 'cinematic_historical',
    name: 'Cinematic Historical',
    category: 'liveaction',
    niche: 'Cahaya profesional · Kualitas TV',
    swatch: '#4A3326',
    ink: '#EAD7C5',
    prompt:
      'High-budget historical period drama cinematography, authentic period costumes and ornate imperial set decoration, warm dramatic side lighting, atmospheric candle and lantern glow, soft atmospheric haze, cinematic depth, television broadcast production value. ' +
      NO_TEXT,
    characterHint: 'a historical period drama character in elaborate traditional royal or noble attire, cinematic side lighting'
  },
  {
    id: 'zhang_yimou',
    name: 'Zhang Yimou',
    category: 'liveaction',
    niche: 'Warna tegas · Ritual',
    swatch: '#8B1E1E',
    ink: '#FBE8A6',
    prompt:
      'Zhang Yimou cinematic aesthetic, rich saturated primary colors, lavish crimson and gold silks, grand architectural symmetry, ritualistic composition, flowing fabrics, intense atmospheric mood, poetic dramatic lighting, monumental scale. ' +
      NO_TEXT,
    characterHint: 'a character draped in lavish ceremonial silk with striking bold monochromatic accents in the style of Zhang Yimou'
  },
  {
    id: 'ancient_xianxia',
    name: 'Ancient Xianxia',
    category: 'liveaction',
    niche: 'Linjiangxian · Filter lembut',
    swatch: '#3A506B',
    ink: '#E0FBFC',
    prompt:
      'Ethereal ancient Chinese Xianxia fantasy live-action drama still, flowing white silk robes, misty heavenly peaks and ethereal glowing particles, soft focus romantic bloom filter, celestial atmospheric lighting, serene mythological fantasy tone. ' +
      NO_TEXT,
    characterHint: 'a graceful immortal Xianxia practitioner with pristine flowing robes and ethereal magical glow'
  },
  {
    id: 'theatrical_film',
    name: 'Theatrical Film',
    category: 'liveaction',
    niche: 'Grading DaVinci · Sinematik',
    swatch: '#242B35',
    ink: '#F0F3F4',
    prompt:
      'Theatrical film still, master DaVinci Resolve color grading, organic 35mm film grain, anamorphic lens flare, rich shadow roll-off, cinematic filmic contrast, dramatic storytelling framing, blockbuster film aesthetic. ' +
      NO_TEXT,
    characterHint: 'a cinematic character in a dramatic film scene, nuanced expression and rich cinematic grading'
  },
  {
    id: 'spartan_epic',
    name: 'Spartan Epic',
    category: 'liveaction',
    niche: 'Gladiator · Kontras tinggi',
    swatch: '#5C2D1E',
    ink: '#F5D6BA',
    prompt:
      'Gritty Spartan epic film still, Gladiator aesthetic, harsh dramatic contrast, battle-worn leather and bronze armor, sweat and battlefield dust, fiery embers in the smoke, intense muscular dynamism, epic historical warfare atmosphere. ' +
      NO_TEXT,
    characterHint: 'a fierce battle-tested warrior in weathered bronze armor and crimson cloak with grit and scars'
  },
  {
    id: 'blade_runner',
    name: 'Blade Runner',
    category: 'liveaction',
    niche: 'Minimalis · Partikel siber',
    swatch: '#0E3B43',
    ink: '#48E5C2',
    prompt:
      'Blade Runner 2049 aesthetic, neo-noir cyberpunk live action still, minimalist monolithic brutalist architecture, neon billboard reflections in rainy streets, floating volumetric dust and cyber particles, anamorphic lens flares, moody cyan and amber lighting. ' +
      NO_TEXT,
    characterHint: 'a futuristic cyber-noir investigator in a heavy trench coat against neon-lit rainy reflections'
  },
  {
    id: 'game_of_thrones',
    name: 'Game of Thrones',
    category: 'liveaction',
    niche: 'Epik dingin · Intrik',
    swatch: '#2B2D42',
    ink: '#EDF2F4',
    prompt:
      'Grimdark medieval fantasy live action film still, Game of Thrones aesthetic, heavy fur cloaks and weathered iron plate armor, cold desaturated slate-gray and muted earth tones, stone fortress interior, flickering torchlight, somber political intrigue mood. ' +
      NO_TEXT,
    characterHint: 'a rugged noble lord or warrior in heavy layered fur cloak and weathered chainmail, somber gaze'
  },
  {
    id: 'breaking_bad',
    name: 'Breaking Bad',
    category: 'liveaction',
    niche: 'Filter Latin · Estetika kriminal',
    swatch: '#8C5A24',
    ink: '#FDE68A',
    prompt:
      'Crime drama cinematography, iconic New Mexico Latin yellow-orange sun-bleached color grade, harsh desert sun and sharp desert shadows, asphalt highway, gritty realism, high-tension crime thriller atmosphere. ' +
      NO_TEXT,
    characterHint: 'an intense grounded character with weathered features and rimmed glasses under harsh desert sunlight'
  },
  {
    id: 'kdrama_idol',
    name: 'K-Drama Idol',
    category: 'liveaction',
    niche: 'Cahaya lembut · Romansa',
    swatch: '#D4A373',
    ink: '#FEFAE0',
    prompt:
      'Korean romantic drama close-up film still, soft diffused beauty lighting, pastel knit sweater, porcelain skin, shallow depth of field with sunlit sheer curtains, tender romantic atmosphere, pristine modern Seoul aesthetic. ' +
      NO_TEXT,
    characterHint: 'an attractive stylish Korean drama protagonist with soft styled hair and gentle warm gaze'
  },
  {
    id: 'kurosawa',
    name: 'Kurosawa',
    category: 'liveaction',
    niche: 'Hitam-putih kontras · Epik',
    swatch: '#262626',
    ink: '#F5F5F5',
    prompt:
      'Akira Kurosawa cinema still, deep high-contrast black and white 35mm cinematography, wind-swept pampas grass fields, stoic samurai warrior in traditional armor, dramatic storm clouds, dynamic staging, legendary Japanese cinematic realism. ' +
      NO_TEXT,
    characterHint: 'a stoic weathered samurai warrior with tied hair in ornate traditional armor, dramatic black and white'
  },
  {
    id: 'nolan',
    name: 'Nolan',
    category: 'liveaction',
    niche: 'IMAX · Biru-abu dingin',
    swatch: '#1E293B',
    ink: '#E2E8F0',
    prompt:
      'Christopher Nolan film still, 70mm IMAX cinematography, clean cool blue-gray color palette, modern glass skyscraper reflections, tailored bespoke dark suit, crisp realistic lighting, intense cerebral atmosphere, practical cinematic scale. ' +
      NO_TEXT,
    characterHint: 'a sharp-eyed professional in a tailored dark suit and tie, sleek modern architectural backdrop'
  },
  {
    id: 'tarantino',
    name: 'Tarantino',
    category: 'liveaction',
    niche: 'Kontras tinggi · Keras, retro',
    swatch: '#7F1D1D',
    ink: '#FEF08A',
    prompt:
      'Quentin Tarantino retro cinema still, vibrant 1970s Technicolor aesthetic, retro American neon diner booth, high-contrast saturated red and yellow tones, snappy wide-angle framing, edgy pulp crime atmosphere. ' +
      NO_TEXT,
    characterHint: 'a charismatic sharp-dressed mobster or gangster in a vibrant collared shirt and blazer inside a retro diner'
  },
  {
    id: 'david_lynch',
    name: 'David Lynch',
    category: 'liveaction',
    niche: 'Keseharian · Mimpi buruk surealis',
    swatch: '#31101E',
    ink: '#FCA5A5',
    prompt:
      'David Lynch surrealist film still, eerie unsettling dreamlike atmosphere, uncanny vintage hotel room, red velvet lampshade casting sinister shadows, deep enigmatic contrast, haunting subconscious thriller aesthetic. ' +
      NO_TEXT,
    characterHint: 'a character with an enigmatic haunting expression, stylized vintage makeup, dramatic moody red lamp lighting'
  },
  {
    id: 'wes_anderson',
    name: 'Wes Anderson',
    category: 'liveaction',
    niche: 'Warna permen · Makaron',
    swatch: '#BE185D',
    ink: '#FCE7F3',
    prompt:
      'Wes Anderson whimsical film still, perfect center-framed symmetrical composition, quirky color-blocked pastel palette of pistachio green, pale candy pink and mustard yellow, eccentric tailored costume, deadpan vintage aesthetic. ' +
      NO_TEXT,
    characterHint: 'an eccentric quirky character in a sharply pressed retro suit standing dead-center with a deadpan expression'
  },
  {
    id: 'wong_kar_wai',
    name: 'Wong Kar-wai',
    category: 'liveaction',
    niche: 'Butiran film · Kota Asia',
    swatch: '#1C312E',
    ink: '#6EE7B7',
    prompt:
      'Wong Kar-wai film still, In the Mood for Love aesthetic, heavy 35mm film grain, moody neon-lit Hong Kong alleyway at night, glowing tea house signs, cigarette smoke haze, emerald green and crimson tones, deep romantic nostalgia. ' +
      NO_TEXT,
    characterHint: 'an elegant woman in an ornate traditional floral cheongsam qipao amidst moody neon lights and soft smoke'
  },
  {
    id: 'shaw_brothers',
    name: 'Shaw Brothers',
    category: 'liveaction',
    niche: 'Wuxia Hong Kong · Sinematik',
    swatch: '#78350F',
    ink: '#FEF3C7',
    prompt:
      'Classic Shaw Brothers Hong Kong wuxia cinema still, retro 1970s kung fu film look, saturated color palette, authentic martial arts staging, dramatic tavern interior, theatrical lighting, cinematic vintage action aesthetic. ' +
      NO_TEXT,
    characterHint: 'a traditional Hong Kong martial arts hero with classic kung fu attire and focused combat gaze'
  },
  {
    id: 'live_cyberpunk',
    name: 'Live Cyberpunk',
    category: 'liveaction',
    niche: 'Sinematik · Ultra HD',
    swatch: '#0284C7',
    ink: '#E0F2FE',
    prompt:
      'Live-action cyberpunk film still, photorealistic cinematic realism, towering holographic skyscrapers in rain, neon-lit alley reflections, cybernetic implants, ultra high-definition 8K texture, atmospheric volumetric haze. ' +
      NO_TEXT,
    characterHint: 'a live-action cyberpunk protagonist with subtle glowing cyberware and high-tech leather jacket'
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
      'AAA next-gen video game cinematic cutscene render, Unreal Engine 5, hyper-detailed carbon fiber sci-fi nanosuit armor, chromatic iridescence, futuristic spaceship corridor, ray-traced reflections, volumetric fog. ' +
      NO_TEXT,
    characterHint: 'a futuristic soldier in high-tech iridescent carbon-fiber exoskeleton armor, volumetric sci-fi lighting'
  },
  {
    id: 'chinese_3d',
    name: 'Chinese 3D',
    category: 'animation',
    niche: 'Sinematik · Unreal Engine',
    swatch: '#2D3A34',
    ink: '#A7F3D0',
    prompt:
      'Chinese 3D donghua animation film render, Unreal Engine 5 aesthetic, photorealistic stylized character, traditional ancient water town background, canal with stone bridge, delicate green hanfu silk dress, cinematic natural lighting. ' +
      NO_TEXT,
    characterHint: 'an ancient Chinese donghua heroine with ornate updo hairstyle and elegant pastel green hanfu silk'
  },
  {
    id: 'kyoto_animation',
    name: 'Kyoto Animation',
    category: 'animation',
    niche: 'Cel lembut · Tateishi',
    swatch: '#FDA4AF',
    ink: '#4C0519',
    prompt:
      'Kyoto Animation film still, exquisite soft cel animation, fluttering cherry blossom petals, sun-dappled school pathway, delicate expressive eyes, subtle wind motion, warm nostalgic afternoon lighting, masterfully painted background. ' +
      NO_TEXT,
    characterHint: 'a schoolgirl in sailor uniform with soft flowing dark hair and bright expressive eyes under cherry blossom trees'
  },
  {
    id: 'arcane_oil',
    name: 'Arcane (Oil 3D)',
    category: 'animation',
    niche: 'Arcane · Fortiche',
    swatch: '#7C2D12',
    ink: '#FED7AA',
    prompt:
      'Fortiche Arcane animation style, stylized 3D character with hand-painted oil brush stroke textures, dramatic glowing hextech crystals in background, steampunk leather jacket, dynamic gritty line work, vibrant painterly lighting. ' +
      NO_TEXT,
    characterHint: 'a rebellious steampunk character with vibrant colored hair, expressive facial tattoos, and weathered leather jacket'
  },
  {
    id: 'us_3d_animation',
    name: 'US 3D Animation',
    category: 'animation',
    niche: 'Sinematik · Pixar',
    swatch: '#1E3A8A',
    ink: '#DBEAFE',
    prompt:
      'Pixar and Disney style 3D animation movie render, endearing toddler character with big round sparkling brown eyes, chubby cheeks, soft subsurface scattering skin, colorful whimsical enchanted forest with bioluminescent trees. ' +
      NO_TEXT,
    characterHint: 'an adorable stylized 3D animated toddler with big curious eyes and joyful expressive smile'
  },
  {
    id: 'hardcore_ink',
    name: 'Hardcore Ink',
    category: 'animation',
    niche: 'Wushan · Kuas kering',
    swatch: '#18181B',
    ink: '#E4E4E7',
    prompt:
      'Traditional Chinese wuxia ink wash painting, dynamic dry brush calligraphy strokes, fierce swordsman in flowing black hanfu holding a katana blade, swirling black smoke and mist, dramatic mountain peak backdrop, high contrast monochrome with splash ink. ' +
      NO_TEXT,
    characterHint: 'a fierce wuxia swordsman with flowing black ink robes, swirling dry brush calligraphy effects'
  },
  {
    id: 'ink_papercut',
    name: 'Ink & Papercut',
    category: 'animation',
    niche: 'Wushan · Warna pekat',
    swatch: '#991B1B',
    ink: '#FEF2F2',
    prompt:
      'Traditional Chinese papercut and ink painting hybrid art, bold fiery crimson sun, layered shadow papercut mountains, dynamic martial artist in crimson kung fu robes, crisp silhouette edges, rich textured folk art aesthetic. ' +
      NO_TEXT,
    characterHint: 'a martial artist in crimson robes performing a dynamic kung fu stance against a giant crimson sun'
  },
  {
    id: 'felt_stopmotion',
    name: 'Felt Stopmotion',
    category: 'animation',
    niche: 'Stop-motion · Cahaya realistis',
    swatch: '#78350F',
    ink: '#FEF3C7',
    prompt:
      'Handmade needle felted wool stop-motion puppet, visible fuzzy yarn and felt fiber texture, charming handcrafted doll face with glass bead eyes, cozy hearth fireplace with warm glowing embers, tactile artisanal lighting. ' +
      NO_TEXT,
    characterHint: 'a cute handcrafted needle-felted wool puppet child with soft wool hair and big glass bead eyes'
  },
  {
    id: 'clay_stopmotion',
    name: 'Clay Stopmotion',
    category: 'animation',
    niche: 'Stop-motion · Komposisi rapi',
    swatch: '#C2410C',
    ink: '#FFEDD5',
    prompt:
      'Claymation stop-motion animation still, Wallace and Gromit and Aardman aesthetic, handcrafted plasticine character with exaggerated toothy grin, visible fingerprint textures, detailed colorful miniature market stall set, studio spotlighting. ' +
      NO_TEXT,
    characterHint: 'a goofy humorous plasticine clay figure with visible handcrafted fingerprints and wide comical grin'
  },
  {
    id: 'jp_horror',
    name: 'JP Horror',
    category: 'animation',
    niche: 'Saturasi rendah · Horor anime',
    swatch: '#27272A',
    ink: '#F4F4F5',
    prompt:
      'Chilling Japanese anime horror still, desaturated muted ghostly palette, pale girl with hollow blank eyes and disheveled long hair in an abandoned decaying wooden house, eerie quiet dread, gloomy atmospheric shadows. ' +
      NO_TEXT,
    characterHint: 'a pale spectral girl with vacant white eyes in a tattered white dress, eerie horror atmosphere'
  },
  {
    id: 'kr_webtoon',
    name: 'KR Webtoon',
    category: 'animation',
    niche: 'Semi-realistis · Romantis',
    swatch: '#312E81',
    ink: '#E0E7FF',
    prompt:
      'Top-ranking Korean manhwa romance webtoon digital art, semi-realistic handsome male lead, stylish parted soft wavy hair, glowing golden sunset overlooking city skyline from high-rise penthouse, sharp digital shading, romantic atmosphere. ' +
      NO_TEXT,
    characterHint: 'a glamorous semi-realistic Korean webtoon male lead with refined features and soft glowing sunset lighting'
  },
  {
    id: 'zenless_zone_zero',
    name: 'Zenless Zone Zero',
    category: 'animation',
    niche: 'Zenless Zone Zero · Neo-siber',
    swatch: '#1E1B4B',
    ink: '#A5B4FC',
    prompt:
      'Zenless Zone Zero game anime visual style, stylish neo-cyberpunk cel-shaded anime heroine, silver long hair, futuristic tech jacket with combat harness, vibrant neon signs and holographic city streets, high-contrast dynamic action framing. ' +
      NO_TEXT,
    characterHint: 'a cool anime combat operative with silver hair and tactical sci-fi jacket against holographic neon lights'
  },
  {
    id: 'ghibli',
    name: 'Ghibli',
    category: 'animation',
    niche: 'Miyazaki · Tekstur hangat',
    swatch: '#065F46',
    ink: '#D1FAE5',
    prompt:
      'Studio Ghibli Hayao Miyazaki anime still, lush painterly green meadow under blue summer sky, fluffy gouache clouds, charming girl in a simple white summer dress, gentle breeze blowing hair, warm nostalgic storybook wonder. ' +
      NO_TEXT,
    characterHint: 'a charming gentle anime girl with windblown hair in a sunlit grassy field, hand-painted Ghibli warmth'
  },
  {
    id: 'demon_slayer',
    name: 'Demon Slayer',
    category: 'animation',
    niche: 'Garis tebal · Aksi',
    swatch: '#991B1B',
    ink: '#FEE2E2',
    prompt:
      'Ufotable anime aesthetic, Demon Slayer style, thick bold black calligraphy contour lines, intense determined swordsman under a blood-red moon, dark misty forest, vibrant glowing flame sparks, dramatic dynamic action lighting. ' +
      NO_TEXT,
    characterHint: 'a fierce anime demon hunter with spiky hair and dark haori robe, glowing elemental embers'
  },
  {
    id: 'anim_cyberpunk',
    name: 'Anim Cyberpunk',
    category: 'animation',
    niche: 'Sinematik · HD',
    swatch: '#4C1D95',
    ink: '#EDE9FE',
    prompt:
      'High-definition cyberpunk anime film still, detailed robotic cybernetic prosthetic arm, rain-soaked asphalt with neon reflections, anime cyborg woman in high-collar tech jacket, glowing teal cybernetic eyes, futuristic Tokyo night. ' +
      NO_TEXT,
    characterHint: 'an anime cyborg heroine with an intricate chrome cybernetic arm standing on a rainy neon-lit street'
  },
  {
    id: 'bloodborne',
    name: 'Bloodborne',
    category: 'animation',
    niche: 'Gotik · Kabut dingin',
    swatch: '#18181B',
    ink: '#A1A1AA',
    prompt:
      'Dark Victorian gothic dark fantasy concept art, Bloodborne aesthetic, hunter in a weathered black leather tricorn hat and long duster coat, cobblestone streets of a cursed cathedral city, chilling cold mist and pale moonlight. ' +
      NO_TEXT,
    characterHint: 'a grim gothic hunter wearing a tricorn hat and heavy weathered duster coat amidst cold mist and gothic spires'
  },
  {
    id: 'junji_ito',
    name: 'Junji Ito',
    category: 'animation',
    niche: 'Horor · Garis tajam',
    swatch: '#111827',
    ink: '#F3F4F6',
    prompt:
      'Junji Ito classic horror manga aesthetic, intense detailed pen and ink cross-hatching, sharp claustrophobic dark corridor, gaunt shadowed figure with intense piercing stare, ominous heavy ink shadows, psychological body horror atmosphere. ' +
      NO_TEXT,
    characterHint: 'a haunting gaunt figure with sunken eyes and dense eerie ink hatching in a dark oppressive corridor'
  },
  {
    id: 'retro_anime_90s',
    name: '90s Retro Anime',
    category: 'animation',
    niche: 'Watanabe · Kamiyama',
    swatch: '#831843',
    ink: '#FCE7F3',
    prompt:
      'Authentic 1990s retro anime film cel still, Shinichiro Watanabe and Kenji Kamiyama aesthetic, rooftop sunset overlooking 90s Tokyo skyline with glowing neon kanji, sharp hand-drawn cel line work, film grain, nostalgic evening glow. ' +
      NO_TEXT,
    characterHint: 'a cool 90s anime heroine with dark bob hair standing on a rooftop at dusk overlooking city lights'
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
    characterHint: 'sesuai deskripsi karakter kustom'
  }
]

export function getStyle(id: string): VisualStyle {
  return VISUAL_STYLES.find((s) => s.id === id) ?? LEGACY_STYLES.find((s) => s.id === id) ?? VISUAL_STYLES[0]
}

/** True for a style from the old catalog: shown on its project, never offered in the picker. */
export function isLegacyStyle(id: string): boolean {
  return !VISUAL_STYLES.some((s) => s.id === id) && LEGACY_STYLES.some((s) => s.id === id)
}
