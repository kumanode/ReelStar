import type { VisualStyle } from './styles'
import { NO_TEXT } from './styleText'

/**
 * Styles from before the drama studio catalog (Nov 2026). They are no longer offered for new series, but projects
 * made with them keep their exact prompt: falling back to another style would change the look of every new image
 * in a series whose earlier images already exist.
 */
export const LEGACY_STYLES: VisualStyle[] = (
  [
  {
    id: 'stickman',
    name: 'Stickman berwarna',
    category: 'animation',
    niche: 'Sejarah, kisah nyata',
    swatch: '#F2B266',
    ink: '#1F1D1A',
    prompt:
      '2D flat vector illustration frame for a YouTube storytelling video. Colorful, detailed flat background (never plain white). ALL characters are simple STICKMAN figures: thin black line bodies, arms and legs, plain round white heads with minimal cartoon faces (dot eyes, small eyebrows, simple mouth), no realistic anatomy. Each stickman wears only small costume pieces that match their role (hat, crown, sash, headcloth, props) while the stick body stays visible. Clean bold outlines, flat colors with light soft shading, every character in the same consistent stickman style, cinematic composition with depth. ' +
      NO_TEXT,
    characterHint: 'a stickman figure with a round white head and thin black line limbs, wearing role-specific costume pieces'
  },
  {
    id: 'oversimplified',
    name: 'Stickman OverSimplified',
    category: 'animation',
    niche: 'Sejarah, biografi, perang',
    swatch: '#EAB308',
    ink: '#1F1D1A',
    prompt:
      '2D flat vector storytelling illustration frame. Simple stylized stickman characters with round white heads, cute bean-shaped capsule bodies, and thick black noodle limbs. Minimalist cartoon faces with expressive dot eyes and small mouths. Characters wear neat miniature role-specific costume accessories (crowns, hats, uniforms, headcloths) over their capsule bodies. Clean bold outlines, flat colors with light soft shading, detailed historical vector background with depth, no realistic human anatomy. ' +
      NO_TEXT,
    characterHint: 'a stylized stickman with a round white head, a simple bean-shaped capsule body, thick noodle limbs, wearing role-specific miniature attire'
  },
  {
    id: 'stickman_comic',
    name: 'Stickman komedi ekspresif',
    category: 'animation',
    niche: 'Komedi, santai, cerita viral',
    swatch: '#EF4444',
    ink: '#FFFFFF',
    prompt:
      'Humorous 2D YouTube storytelling illustration. Stylized white stickman characters with thick bold black contour outlines and a clean white sticker halo border. Exaggerated hilarious facial expressions (wide comical cartoon eyes, open screaming or laughing mouths, dramatic eyebrows). Simple expressive stick limbs in dynamic poses. Vibrant colorful cartoon background with subtle comic action lines, bright energetic mood. ' +
      NO_TEXT,
    characterHint: 'an expressive white cartoon stickman with thick black outlines, a subtle white sticker halo, and an exaggerated funny facial expression'
  },
  {
    id: 'stickman_modern',
    name: 'Stickman modern explainer',
    category: 'animation',
    niche: 'Sains, teknologi, edukasi',
    swatch: '#6366F1',
    ink: '#FFFFFF',
    prompt:
      'Sleek modern 2D flat vector explainer frame. Elegant minimalist geometric stickman silhouette characters with clean proportions and glowing neon accent edge lighting. Harmonious deep color palette, volumetric ambient glow, cinematic atmospheric lighting, stylish vector infographic background with soft depth of field. ' +
      NO_TEXT,
    characterHint: 'a sleek minimalist geometric stickman silhouette with subtle glowing accent outlines'
  },
  {
    id: 'islamic_storybook',
    name: 'Buku cerita Islami',
    category: 'animation',
    niche: 'Kisah nabi, sirah, religi',
    swatch: '#D99B52',
    ink: '#1F1D1A',
    prompt:
      'Warm 2D Islamic storybook illustration, soft gouache painting textures on vintage aged parchment paper, warm desert palette of golden sand, terracotta, and gentle lapis lazuli blue. Ancient Middle Eastern oasis setting with date palm trees, clay architecture, and peaceful atmosphere. Holy figures and prophets are respectfully depicted from behind in pure white garments with a soft radiant golden light aura around them, strictly no facial features. Friendly community characters with modest traditional attire, cinematic storybook depth. ' +
      NO_TEXT,
    characterHint: 'a respectful character in ancient Middle Eastern modest attire, or a holy figure seen from behind in glowing white garments with a soft golden light aura'
  },
  {
    id: 'whiteboard',
    name: 'Whiteboard doodle',
    category: 'animation',
    niche: 'Tutorial, bisnis',
    swatch: '#FFFFFF',
    ink: '#1F1D1A',
    prompt:
      'Hand-drawn whiteboard doodle, black marker line art on a clean white board, one accent color used sparingly (red or blue), simple sketchy characters, arrows and small icons, like a whiteboard animation explainer. ' +
      NO_TEXT,
    characterHint: 'a simple hand-drawn marker doodle character'
  },
  {
    id: 'anime',
    name: 'Anime',
    category: 'animation',
    niche: 'Drama, motivasi, fiksi',
    swatch: '#F5C3CD',
    ink: '#1F1D1A',
    prompt:
      'High-quality anime film still, clean cel shading, expressive characters, detailed painted background, cinematic lighting and color. ' +
      NO_TEXT,
    characterHint: 'an anime character with clean cel shading'
  },
  {
    id: 'pixel',
    name: 'Pixel art',
    category: 'animation',
    niche: 'Gaming, nostalgia',
    swatch: '#8FD694',
    ink: '#1F1D1A',
    prompt: 'Detailed 16-bit pixel art scene, crisp pixels, limited retro palette, video game aesthetic, no blur. ' + NO_TEXT,
    characterHint: 'a 16-bit pixel art character sprite'
  },
  {
    id: 'ghibli',
    name: 'Ghibli anime hangat',
    category: 'animation',
    niche: 'Cerita santai, dongeng, petualangan',
    swatch: '#A2D5C6',
    ink: '#1F1D1A',
    prompt:
      'Studio Ghibli inspired hand-painted anime film still, lush green landscapes, fluffy painterly cumulus clouds, warm nostalgic natural sunlight, charming expressive characters, gentle gouache watercolor textures, peaceful storybook atmosphere. ' +
      NO_TEXT,
    characterHint: 'a charming hand-painted Ghibli-inspired character with gentle expressive features'
  },
  {
    id: 'manhwa',
    name: 'Manhwa webtoon aksi',
    category: 'animation',
    niche: 'Aksi, fantasi modern, reinkarnasi',
    swatch: '#2B1A4A',
    ink: '#C084FC',
    prompt:
      'High-end Korean manhwa webtoon digital art style, glowing vibrant energy aura, sharp dynamic digital ink outlines, dramatic high-contrast lighting, sleek character design, intense expressive eyes, cinematic webtoon panel composition. ' +
      NO_TEXT,
    characterHint: 'a sharp Korean webtoon hero character with subtle glowing aura and stylish hair'
  },
  {
    id: 'woodcut',
    name: 'Ukiran kayu klasik',
    category: 'animation',
    niche: 'Filsafat, mitologi kuno, sejarah',
    swatch: '#D7C4A5',
    ink: '#2C1E14',
    prompt:
      'Detailed antique woodcut engraving print, fine cross-hatched black ink linework, vintage Renaissance etching, textured aged parchment paper background, dramatic chiaroscuro contrast, historical intellectual aesthetic. ' +
      NO_TEXT,
    characterHint: 'a classical figure rendered in vintage cross-hatched woodcut engraving style'
  },
  {
    id: 'horror2d',
    name: 'Horor 2D sinematik',
    category: 'animation',
    niche: 'Horor, misteri, cerita seram',
    swatch: '#1E1B22',
    ink: '#D94B4B',
    prompt:
      'Cinematic 2D horror illustration, painterly digital art, deep shadows and desaturated cold palette with a single sickly accent color (red or green), dramatic low-key lighting, fog and dust in the air, unsettling composition with negative space, subtle film grain, eerie suspenseful mood. ' +
      NO_TEXT,
    characterHint: 'a 2D painterly horror character with a tense expression, lit by harsh low-key light'
  },
  {
    id: 'webcomic',
    name: 'Webcomic barat',
    category: 'animation',
    niche: 'Komedi, drama remaja, slice of life',
    swatch: '#FFB4A2',
    ink: '#1F1D1A',
    prompt:
      'Western webcomic style 2D illustration, clean confident digital line art, flat colors with simple cel shading, expressive exaggerated faces and poses, bright friendly palette, simple readable backgrounds, modern webcomic panel look. ' +
      NO_TEXT,
    characterHint: 'an expressive western webcomic character with clean line art and flat colors'
  },
  {
    id: 'animehorror',
    name: 'Anime horor Jepang',
    category: 'animation',
    niche: 'Cerita seram Jepang, urban legend',
    swatch: '#2A2626',
    ink: '#E5E0D8',
    prompt:
      'Dark Japanese horror anime film still, detailed ink linework with eerie cross-hatching, muted desaturated palette with deep blacks and a faint crimson accent, unsettling distorted perspective, empty quiet Japanese settings (old houses, shrines, school hallways, rainy streets), dim flickering light, creeping dread atmosphere. ' +
      NO_TEXT,
    characterHint: 'a Japanese horror anime character with pale skin, hollow shadowed eyes, drawn with fine eerie ink lines'
  },
  {
    id: 'nusantara',
    name: 'Ilustrasi Nusantara',
    category: 'animation',
    niche: 'Cerita rakyat, legenda, sejarah Indonesia',
    swatch: '#8B4A2B',
    ink: '#F3D9A4',
    prompt:
      'Traditional Indonesian folklore illustration, inspired by wayang kulit shadow puppet silhouettes and batik motifs, ornate carved decorative patterns, earthy palette of sogan brown, deep indigo, gold and cream, elegant stylized figures in Javanese and Balinese traditional attire, layered decorative backgrounds with tropical nature and temples, rich cultural storybook mood. ' +
      NO_TEXT,
    characterHint: 'a stylized Indonesian folklore figure in traditional attire with wayang-inspired ornate details and batik patterns'
  },
  {
    id: 'animation3d',
    name: 'Animasi 3D',
    category: 'animation',
    niche: 'Fabel, keluarga, anak',
    swatch: '#FFD66B',
    ink: '#1F1D1A',
    prompt:
      '3D animated feature film render, stylized characters with big expressive faces, soft global illumination, subsurface scattering, vibrant colors, cinematic depth of field. ' +
      NO_TEXT,
    characterHint: 'a stylized 3D animated film character with an expressive face'
  },
  {
    id: 'clay',
    name: 'Claymation',
    category: 'animation',
    niche: 'Komedi, cerita anak',
    swatch: '#F4A988',
    ink: '#1F1D1A',
    prompt:
      'Claymation stop-motion scene, handcrafted plasticine characters and miniature sets, visible fingerprints and clay texture, soft studio lighting. ' +
      NO_TEXT,
    characterHint: 'a handcrafted plasticine clay character'
  },
  {
    id: 'lowpoly',
    name: 'Low-poly 3D',
    category: 'animation',
    niche: 'Teknologi, sains',
    swatch: '#A7C7E7',
    ink: '#1F1D1A',
    prompt:
      'Low-poly 3D render, faceted geometric shapes, flat-shaded polygons, clean pastel colors, soft ambient lighting. ' + NO_TEXT,
    characterHint: 'a low-poly 3D character with faceted shapes'
  },
  {
    id: 'cinematic',
    name: 'Sinematik realistis',
    category: 'liveaction',
    niche: 'Misteri, sejarah, drama',
    swatch: '#56607A',
    ink: '#FAF7F2',
    prompt:
      'Photorealistic cinematic film still, dramatic natural lighting, shallow depth of field, anamorphic lens look, rich color grading, subtle 35mm film grain. ' +
      NO_TEXT,
    characterHint: 'a photorealistic person, cinematic lighting'
  },
  {
    id: 'archival',
    name: 'Arsip sejarah',
    category: 'liveaction',
    niche: 'Sejarah, perang, tokoh',
    swatch: '#B9A488',
    ink: '#1F1D1A',
    prompt:
      'Vintage archival photograph, faded sepia or black and white, film grain, light scratches and dust, historical documentary look. ' +
      NO_TEXT,
    characterHint: 'a person in a vintage archival sepia photograph'
  },
  {
    id: 'epic',
    name: 'Fantasi epik',
    category: 'liveaction',
    niche: 'Mitologi, legenda',
    swatch: '#6C5B8E',
    ink: '#FAF7F2',
    prompt:
      'Epic realistic fantasy concept art, highly detailed, volumetric light, grand scale, painterly realism, cinematic composition. ' +
      NO_TEXT,
    characterHint: 'an epic realistic fantasy character, concept art'
  },
  {
    id: 'darkfantasy',
    name: 'Dark fantasy mistis',
    category: 'liveaction',
    niche: 'Horor, mitologi, legenda gelap',
    swatch: '#242028',
    ink: '#E8D7B8',
    prompt:
      'Dark fantasy cinematic photograph, dramatic chiaroscuro lighting, deep atmospheric shadows, volumetric fog and mist, gothic folklore tone, weathered textures, rich cinematic mood. ' +
      NO_TEXT,
    characterHint: 'a dark fantasy figure with weathered clothing in moody dramatic lighting'
  },
  {
    id: 'analoghorror',
    name: 'Analog horror VHS',
    category: 'liveaction',
    niche: 'Horor, misteri, konspirasi, SCP',
    swatch: '#1A1D1A',
    ink: '#4ADE80',
    prompt:
      'Authentic 1990s analog found-footage camcorder video still, CRT monitor scanlines, magnetic VHS tape noise and tracking distortion, eerie flashlight lighting, muted retro color grading, grainy low-light realism, uncanny suspenseful atmosphere. ' +
      NO_TEXT,
    characterHint: 'a person in an eerie found-footage VHS recording, harsh direct flashlight illumination'
  }
  ] as VisualStyle[]
).map((s) => ({ ...s, niche: `Gaya lama · ${s.niche}` }))
