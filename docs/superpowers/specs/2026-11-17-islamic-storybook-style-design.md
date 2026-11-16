# Design Doc: Penambahan Gaya Visual "Buku Cerita Islami" & Pembersihan 4 Gaya Visual

**Tanggal:** 2026-11-17  
**Status:** Menunggu Persetujuan  
**Penulis:** Antigravity  

---

## 1. Intent & The Why
1. Menambahkan gaya visual khusus untuk video cerita/kisah Nabi dalam Islam di Bang Story (**Buku cerita Islami** / `islamic_storybook`). Gaya ini mematuhi etika visual Islam (anikonisme) dengan tidak menampilkan wajah fisik nabi (tampak belakang/aura cahaya keemasan lembut) serta latar Timur Tengah kuno yang hangat.
2. Merampingkan daftar pilihan gaya visual dengan menghapus 4 gaya yang tidak lagi diinginkan oleh pengguna:
   - **Kartun flat** (`flat`)
   - **Buku cerita cat air** (`watercolor`)
   - **Diorama miniatur** (`diorama`)
   - **Diorama isometrik 3D** (`isometric3d`)

---

## 2. Goals, Non-Goals, & Anti-Goals

### Goals
- Menambahkan gaya visual baru ke `VISUAL_STYLES` di `src/shared/styles.ts`:
  - `id`: `'islamic_storybook'`
  - `name`: `'Buku cerita Islami'`
  - `category`: `'2d'`
  - `niche`: `'Kisah nabi, sirah, religi'`
  - `swatch`: `'#D99B52'` (warna oker gurun emas hangat), `ink`: `'#1F1D1A'`
  - `prompt`: Formula visual 2D gouache bertekstur perkamen kuno dengan instruksi anikonisme yang aman dan diakhiri `NO_TEXT`.
  - `characterHint`: Panduan karakter lembar referensi untuk AI generator.
- Menghapus 4 gaya dari `VISUAL_STYLES` di `src/shared/styles.ts`:
  - `flat`, `watercolor`, `diorama`, `isometric3d`.
- Menyiapkan thumbnail aset `src/renderer/src/assets/styles/islamic_storybook.webp` (640x358, 16:9 proporsional).
- Menghapus aset thumbnail yang sudah tidak terpakai: `flat.webp`, `watercolor.webp`, `diorama.webp`, `isometric3d.webp` di `src/renderer/src/assets/styles/`.

### Non-Goals
- Mengubah skema database (kolom `style_id` adalah `TEXT`, fallback otomatis aman ke `VISUAL_STYLES[0]`).
- Mengubah komponen UI (StyleMenu, StylePicker, IdeaStep memuat `VISUAL_STYLES` secara dinamis).

### Anti-Goals
- Tidak merusak kompatibilitas proyek eksisting (fungsi `getStyle` memiliki fallback bawaan ke style pertama jika ada ID lama yang dipanggil).

---

## 3. Detailed Changes

### A. Penambahan Style Baru di `src/shared/styles.ts`
```typescript
{
  id: 'islamic_storybook',
  name: 'Buku cerita Islami',
  category: '2d',
  niche: 'Kisah nabi, sirah, religi',
  swatch: '#D99B52',
  ink: '#1F1D1A',
  prompt:
    'Warm 2D Islamic storybook illustration, soft gouache painting textures on vintage aged parchment paper, warm desert palette of golden sand, terracotta, and gentle lapis lazuli blue. Ancient Middle Eastern oasis setting with date palm trees, clay architecture, and peaceful atmosphere. Holy figures and prophets are respectfully depicted from behind in pure white garments with a soft radiant golden light aura around them, strictly no facial features. Friendly community characters with modest traditional attire, cinematic storybook depth. ' +
    NO_TEXT,
  characterHint: 'a respectful character in ancient Middle Eastern modest attire, or a holy figure seen from behind in glowing white garments with a soft golden light aura'
}
```

### B. Penghapusan 4 Style di `src/shared/styles.ts`
Hapus objek dengan ID:
- `'flat'`
- `'watercolor'`
- `'diorama'`
- `'isometric3d'`

### C. Aset Thumbnail
- Buat `src/renderer/src/assets/styles/islamic_storybook.webp` (640x358).
- Hapus file:
  - `src/renderer/src/assets/styles/flat.webp`
  - `src/renderer/src/assets/styles/watercolor.webp`
  - `src/renderer/src/assets/styles/diorama.webp`
  - `src/renderer/src/assets/styles/isometric3d.webp`

---

## 4. Verifikasi & Pengujian
1. TDD / Unit assert:
   - `getStyle('islamic_storybook')` mengembalikan style baru dengan benar.
   - `getStyle('flat')`, `getStyle('watercolor')`, `getStyle('diorama')`, `getStyle('isometric3d')` secara aman melakukan fallback ke default tanpa crash.
2. Jalankan `npm run typecheck` (harus bersih).
3. Jalankan `npm run build` (harus bersih, bundle berkurang ukurannya karena aset lama dihapus).
