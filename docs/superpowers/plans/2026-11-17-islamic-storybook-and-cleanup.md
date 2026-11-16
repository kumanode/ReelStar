# Penambahan Gaya Buku Cerita Islami & Pembersihan 4 Gaya Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan gaya visual baru `islamic_storybook` (Buku cerita Islami) beserta thumbnail pratinjaunya, dan menghapus 4 gaya yang tidak diinginkan (`flat`, `watercolor`, `diorama`, `isometric3d`) dari katalog `VISUAL_STYLES` serta membersihkan file thumbnail lamanya.

**Architecture:** Memperbarui array `VISUAL_STYLES` di `src/shared/styles.ts`, membuat file WebP `islamic_storybook.webp` berukuran 640x358 (16:9), dan menghapus 4 file `.webp` lama di `src/renderer/src/assets/styles/`. Memverifikasi bahwa `getStyle` menangani style baru dan melakukan fallback aman pada ID yang dihapus.

**Tech Stack:** TypeScript, React, Vite, Electron, Python Pillow.

**Spec:** `docs/superpowers/specs/2026-11-17-islamic-storybook-style-design.md`

## Global Constraints

- Teks antarmuka berbahasa Indonesia santai ("kamu"), nama kode dan komentar berbahasa Inggris.
- Formula prompt untuk `islamic_storybook` wajib mematuhi etika visual Islam (anikonisme) dan diakhiri `NO_TEXT`.
- Menghapus 4 gaya (`flat`, `watercolor`, `diorama`, `isometric3d`) tanpa memutus fallback di fungsi `getStyle`.
- TypeScript strict: bebas dari unused imports/vars, lolos `npm run typecheck` dan `npm run build`.

## Review Focus

1. **Fallback safety**: Memanggil ID gaya yang telah dihapus (`flat`, `watercolor`, dsb) tidak boleh menghasilkan undefined atau error, melainkan mengembalikan `VISUAL_STYLES[0]`.
2. **Ketersediaan Thumbnail**: File `islamic_storybook.webp` ada dengan ukuran 640x358 dan proporsional (tidak gepeng).
3. **Pembersihan Aset**: File aset 4 gaya lama benar-benar terhapus sehingga tidak ikut ter-bundle di Vite.
4. **Kompilasi Bundle**: `npm run build` berhasil tanpa referensi rusak.

---

### Task 1: Generate Thumbnail Baru & Hapus Aset Lama

**Files:**
- Create: `src/renderer/src/assets/styles/islamic_storybook.webp`
- Delete: `src/renderer/src/assets/styles/flat.webp`
- Delete: `src/renderer/src/assets/styles/watercolor.webp`
- Delete: `src/renderer/src/assets/styles/diorama.webp`
- Delete: `src/renderer/src/assets/styles/isometric3d.webp`

**Interfaces:**
- Consumes: `C:\Users\PopGore\.gemini\antigravity\brain\c818c1d0-5fb1-453a-8a9b-63c500c038bd\warm_islamic_storybook_2d_1794856754555.jpg`
- Produces: File `islamic_storybook.webp` (640, 358).

- [ ] **Step 1: Konversi gambar menjadi `islamic_storybook.webp` dan hapus 4 thumbnail lama**

Jalankan skrip Python untuk:
1. Resize `warm_islamic_storybook_2d_1794856754555.jpg` menjadi (640, 358) dan simpan sebagai `src/renderer/src/assets/styles/islamic_storybook.webp`.
2. Hapus `flat.webp`, `watercolor.webp`, `diorama.webp`, dan `isometric3d.webp` di `src/renderer/src/assets/styles/`.

- [ ] **Step 2: Verifikasi file thumbnail**

Run: `python -c "import os; print('New exists:', os.path.exists('src/renderer/src/assets/styles/islamic_storybook.webp')); [print(f, 'deleted:', not os.path.exists(f'src/renderer/src/assets/styles/{f}')) for f in ['flat.webp', 'watercolor.webp', 'diorama.webp', 'isometric3d.webp']]"`  
Expected: `New exists: True`, dan semua 4 file lama berstatus `deleted: True`.

---

### Task 2: Modifikasi `VISUAL_STYLES` di `src/shared/styles.ts`

**Files:**
- Modify: `src/shared/styles.ts`

**Interfaces:**
- Consumes: Definisi baru `islamic_storybook`.
- Produces: Array `VISUAL_STYLES` yang telah diperbarui tanpa 4 gaya lama dan dengan penambahan `islamic_storybook`.

- [ ] **Step 1: Tulis tes verifikasi RED**

Run: `npx tsx -e "import { getStyle, VISUAL_STYLES } from './src/shared/styles'; console.assert(getStyle('islamic_storybook').id === 'islamic_storybook', 'islamic_storybook not added yet'); console.assert(!VISUAL_STYLES.some(s => ['flat','watercolor','diorama','isometric3d'].includes(s.id)), 'old styles still exist');"`  
Expected: Assertions fail (RED).

- [ ] **Step 2: Tambahkan `islamic_storybook` dan hapus 4 gaya lama di `src/shared/styles.ts`**

Edit `src/shared/styles.ts`:
1. Sisipkan objek `islamic_storybook`.
2. Hapus blok `flat`, `watercolor`, `diorama`, dan `isometric3d`.

- [ ] **Step 3: Jalankan tes verifikasi GREEN**

Run: `npx tsx -e "import { getStyle, VISUAL_STYLES } from './src/shared/styles'; console.assert(getStyle('islamic_storybook').id === 'islamic_storybook', 'failed to find islamic_storybook'); console.assert(!VISUAL_STYLES.some(s => ['flat','watercolor','diorama','isometric3d'].includes(s.id)), 'failed to remove old styles'); console.assert(getStyle('flat').id === 'stickman', 'fallback failed'); console.log('ALL STYLE ASSERTIONS PASSED');"`  
Expected: `ALL STYLE ASSERTIONS PASSED`.

---

### Task 3: Verifikasi Typecheck dan Build Proyek

**Files:**
- Verify: `src/shared/styles.ts`
- Verify: `src/renderer/src/assets/styles/`

- [ ] **Step 1: Jalankan typecheck proyek**

Run: `npm run typecheck`  
Expected: Exit code 0 tanpa error TypeScript.

- [ ] **Step 2: Jalankan build aplikasi**

Run: `npm run build`  
Expected: Exit code 0, Vite renderer dan Electron berhasil di-build tanpa aset yang hilang.
