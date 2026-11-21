# Rencana: Halaman Pengaturan Berbasis Katalog Penyedia

Status: **draf, belum dikerjakan** (2026-11-21).

## Tujuan

Menyiapkan halaman Pengaturan untuk menampung banyak penyedia AI tanpa berubah menjadi satu halaman panjang.
Pola yang dipakai adalah **sidebar → daftar penyedia → panel detail** seperti ArcReel, tetapi tetap memakai bahasa
visual ReelStar (kertas, tinta, aksen oranye). Perubahan ini juga memisahkan kredensial penyedia dari pilihan model
bawaan, sehingga menambah penyedia baru tidak lagi menambah isian di halaman yang sama.

Hasil akhir yang diinginkan:

- Setiap peran (cerita/LLM, suara/TTS, gambar & video) punya daftar penyedia sendiri dengan status yang terlihat.
- Penyedia custom bisa ditambah, diubah, dan dihapus tanpa mengubah kode.
- Pilihan model bawaan punya halamannya sendiri.
- Sidebar menandai bagian yang konfigurasinya belum lengkap.

## Acuan

- Mockup interaktif (sementara): `C:\Users\PopGore\AppData\Local\Temp\opencode\reelstar-settings-mockup.html`.
- Pola ArcReel:
  - `frontend/src/components/pages/SystemConfigPage.tsx` — sidebar berkelompok + pemilihan section.
  - `frontend/src/components/pages/ProviderSection.tsx` — rail penyedia + panel detail.
  - `frontend/src/components/shared/page-shell/PageSidebar.tsx`, `PageShell.tsx`.
  - `frontend/src/components/shared/master-detail/SecondaryRail.tsx`, `DetailPane.tsx`.
  - `frontend/src/components/pages/settings/MediaModelSection.tsx` — halaman model bawaan terpisah.
  - `frontend/src/components/pages/settings/CustomProviderForm.tsx` — formulir penyedia custom.
- **Lisensi:** ArcReel berlisensi **AGPL-3.0**. Pola dan idenya boleh ditiru, tetapi kodenya **jangan disalin atau
  diterjemahkan baris per baris**. Tulis ulang dari pemahaman sendiri dengan komponen ReelStar.

## Kondisi sekarang

- `src/renderer/src/pages/Settings.tsx` (821 baris) berisi tiga tab: `services`, `general`, `about`.
- Tab `services` menumpuk empat bagian di satu halaman: `LlmSection`, `TtsSection`, `VisualSection`, `WhisperSection`.
  Masing-masing memakai satu `ProviderSelect` (dropdown) dan hanya formulir penyedia terpilih yang tampil.
- `KeyForm` menangani simpan/tes/hapus kunci, termasuk endpoint custom dan Flow2API.
- Penyedia masih berupa union hardcoded:
  - `src/shared/types.ts`: `LlmProvider`, `TtsProvider`, `VisualProvider`, `ApiProvider`, `ModelSource`.
  - `src/shared/models.ts`: `LLM_PROVIDERS`.
  - `src/main/secrets.ts`: array `PROVIDERS` dan `PROVIDER_NAMES`.
  - `src/main/settings.ts`: `DEFAULT_SETTINGS` dengan field per penyedia (`customBaseUrl`, `flow2apiBaseUrl`,
    `geminiTtsModel`, `elevenModel`, `imageModel`, `videoModel`, `flow2apiImageModel`, `flow2apiVideoModel`).
- `src/main/services/llm.ts`: `fetchModels` dan `cacheKey` memilih berdasarkan `ModelSource`; `testLlm` bercabang
  per `LlmProvider`.
- `src/renderer/src/lib/useModels.ts`: menerima `ModelSource` (union).
- `src/renderer/src/store/app.ts`: `Route` hanya `{ name: 'settings'; back?: Route }`, belum punya section/penyedia.
- `docs/konvensi.md` aturan UI no. 3 masih menyebut "satu dropdown penyedia per bagian". Aturan itu diganti oleh
  rencana ini.

## Keputusan desain

1. **Tiga kolom, dengan dua kolom untuk halaman tanpa daftar.** Sidebar 246 px, rail penyedia 292 px, detail
   fleksibel. Halaman Umum, Tentang, Whisper, dan Model bawaan memakai sidebar + detail saja.
2. **Sidebar berkelompok:**
   - **Penyedia:** Cerita (LLM), Suara (TTS), Gambar & video, Whisper (lokal).
   - **Default:** Model bawaan.
   - **Sistem:** Umum, Tentang aplikasi.
3. **Rail penyedia dipisah menjadi penyedia bawaan dan penyedia custom.** Tiap baris menampilkan logo, nama, dan
   status (`Terhubung` / `Tersimpan` / `Belum diatur` / `Gagal terhubung`). Tombol **Tambah penyedia** ada di bawah
   daftar custom.
4. **Panel detail berisi tiga kartu:** identitas penyedia, kunci API (dan base URL bila perlu), serta model. Kartu
   kinerja (concurrency) hanya muncul untuk penyedia visual.
5. **Status dihitung sekali di satu tempat.** Badge rail, badge detail, dan penanda warning di sidebar memakai
   `KeyStatus` yang sama; jangan menghitung ulang di komponen.
6. **Katalog penyedia menjadi sumber kebenaran.** Satu penyedia punya `roles: ProviderRole[]`, sehingga Gemini bisa
   muncul di LLM dan TTS dengan satu kunci. Penyedia custom juga memakai bentuk yang sama.
7. **Kredensial tetap per aplikasi, bukan per proyek.** Yang bisa berbeda per proyek hanya pilihan penyedia/model
   di langkah Ide cerita, seperti sekarang.
8. **Tidak ada migrasi database.** Setting disimpan sebagai key/value JSON, dan tabel `secrets` sudah memakai
   `provider TEXT`. Penyesuaian data lama cukup dilakukan saat `getSettings()` membaca nilai lama.
9. **Model bawaan dipisah per tujuan.** Satu penyedia visual bisa punya model gambar dan model video sendiri
   (`image`, `video`), sedangkan LLM/TTS hanya satu slot.
10. **Bahasa visual tetap ReelStar.** Token warna, `shadow-ink`, font Bricolage/Plus Jakarta, dan `ProviderLogo`
    dipakai ulang. Jangan memakai warna atau komponen ArcReel.

## Data model yang dituju

```ts
// src/shared/providers.ts
export type ProviderRole = 'llm' | 'tts' | 'visual'
export type ProviderKind = 'preset' | 'custom'
export type ModelPurpose = 'llm' | 'tts' | 'image' | 'video'

export interface ProviderDef {
  id: string                 // 'gemini', 'openrouter', id custom
  name: string
  roles: ProviderRole[]
  kind: ProviderKind
  logo?: ProviderLogoId      // penyedia custom memakai ikon server
  note: string
  docs?: { link: string; label: string }
  baseUrl?: string           // custom dan Flow2API
  keyOptional?: boolean      // custom lokal tanpa token
}
```

```ts
// src/shared/types.ts
export interface ProviderSettings {
  /** Penyedia yang dipakai peran ini. */
  defaultId: string
  /** Model per tujuan. LLM/TTS hanya memakai satu kunci; visual memakai image dan video. */
  models: Partial<Record<ModelPurpose, string>>
}

export interface AppSettings {
  // ...
  providers: Record<ProviderRole, ProviderSettings>
  customProviders: ProviderDef[]
}
```

Catatan transisi:

- `LlmProvider`, `TtsProvider`, `VisualProvider`, `ApiProvider`, dan `ModelSource` menjadi `string` (atau alias
  `ProviderId`) supaya id custom bisa masuk.
- Field lama (`llmProvider`, `llmModels`, `customBaseUrl`, `flow2apiBaseUrl`, `geminiTtsModel`, `elevenModel`,
  `imageModel`, `videoModel`, `flow2apiImageModel`, `flow2apiVideoModel`, `defaultVisualProvider`) dibaca sekali
  oleh `getSettings()` lalu dipetakan ke `providers`. Setelah semua pemanggil pindah, field lama dihapus dari
  `DEFAULT_SETTINGS` dan `AppSettings`.
- `secrets.ts`: `PROVIDERS` dan `PROVIDER_NAMES` dibangun dari `PRESET_PROVIDERS` + `customProviders`, bukan
  ditulis manual. Kunci yang sudah tersimpan dengan id lama tetap terbaca karena id-nya tidak berubah.

## Batasan yang harus disadari

- **Gemini dipakai bersama LLM dan TTS.** Satu kunci, dua peran. UI harus tetap menampilkan keterangan itu dan
  tidak membuat dua isian kunci.
- **Flow2API bukan penyedia custom** walaupun punya base URL. Ia tetap penyedia bawaan dengan `baseUrl` dan
  `keyOptional`.
- **Penyedia custom tanpa validasi id bisa bentrok.** Id dibuat dari slug nama, dicek unik terhadap preset dan
  custom lain, dan tidak boleh diubah setelah dibuat (atau perubahan id harus memindahkan kunci di `secrets`).
- **Menghapus penyedia yang sedang menjadi default** harus memilih pengganti otomatis dan memberi tahu pengguna;
  jangan meninggalkan `defaultId` yang tidak ada.
- **`defaultVisualProvider` dipakai di main** (`repo.ts`, `generation.ts`, `devharness.ts`). Semua pemanggil harus
  ikut pindah ke `providers.visual.defaultId`.
- **Jendela minimal 1180×720.** Sidebar 246 px + rail 292 px menyisakan sekitar 640 px untuk detail. Uji di ukuran
  itu; kartu dan baris tombol tidak boleh terpotong.
- **Model list per penyedia custom** perlu `cacheKey` yang membedakan base URL, sama seperti `customBaseUrl`
  sekarang.

## Tugas

### Tugas 1 — Kerangka tiga kolom (tanpa mengubah data model)

Pecah `Settings.tsx` menjadi folder `src/renderer/src/pages/settings/`:

- `SettingsPage.tsx` — shell, sidebar, pemilihan section/penyedia.
- `SettingsSidebar.tsx` — nav berkelompok + penanda warning.
- `ProviderRail.tsx` — daftar penyedia per peran, status, tombol tambah.
- `ProviderDetail.tsx` — kartu identitas, kunci, model, kinerja.
- `KeyForm.tsx` — pindahkan `KeyForm` dari `Settings.tsx` tanpa mengubah perilakunya.
- `sections/GeneralSection.tsx`, `AboutSection.tsx`, `WhisperSection.tsx`.

Perubahan pendukung:

- `src/renderer/src/store/app.ts`: `Route` menjadi
  `{ name: 'settings'; section?: SettingsSection; provider?: string; back?: Route }`.
- Halaman dengan rail: `llm`, `tts`, `visual`. Tanpa rail: `whisper`, `models`, `general`, `about`.
- Daftar penyedia masih memakai `LLM_PROVIDERS` dan daftar TTS/visual yang sekarang; belum ada katalog baru.
- Tombol **Tambah penyedia** boleh tampil tetapi belum berfungsi (atau membuka formulir yang dinonaktifkan) sampai
  Tugas 3.

Kriteria selesai:

- Tampilan baru setara mockup, tanpa kehilangan fitur simpan/tes/hapus kunci.
- `npm run typecheck` dan `npm run build` bersih.
- Screenshot 1180×720 terang dan gelap untuk tiap section.

Berkas utama: `pages/Settings.tsx` (dipecah), `pages/settings/*`, `store/app.ts`, `components/ui.tsx` (bila perlu
penyesuaian kecil).

Ketergantungan: tidak ada.

### Tugas 2 — Katalog penyedia di `shared`

- Buat `src/shared/providers.ts` berisi `ProviderDef`, `PRESET_PROVIDERS`, `providersFor(role, custom)`,
  `providerById(id, custom)`, dan `providerRoles(id)`.
- Pindahkan isi `LLM_PROVIDERS` ke katalog. Tambahkan definisi TTS dan visual (termasuk Flow2API) dengan `roles`.
- Ubah tipe provider di `src/shared/types.ts` menjadi `ProviderId = string` (atau alias), termasuk `ModelSource`.
  Pertahankan nama tipe lama sebagai alias agar perubahan bertahap.
- `src/main/settings.ts`:
  - Tambahkan `providers` dan `customProviders` ke `DEFAULT_SETTINGS`.
  - Normalisasi nilai lama ke bentuk baru di `getSettings()`.
  - Pastikan `setSettings()` tetap menggabungkan `models` per peran, bukan menimpanya.
- `src/main/secrets.ts`: bangun daftar provider dan nama tampilan dari katalog + custom; validasi id sebelum
  menyimpan kunci.
- `src/main/services/llm.ts`: `fetchModels`, `cacheKey`, dan `testLlm` memakai `ProviderDef`, bukan `switch` union.
  Penyedia custom memakai base URL miliknya sendiri.
- Perbarui pemanggil: `generation.ts` (`isFlow2Api`), `repo.ts` (model bawaan proyek), `devharness.ts`.
- `src/renderer/src/lib/useModels.ts`: tidak perlu berubah selain tipe `source` yang kini `string`.

Kriteria selesai:

- Salinan database lama tetap memuat kunci dan pilihan provider yang sama setelah dibuka.
- Daftar model Gemini/OpenRouter/Groq/ElevenLabs/Flow2API tetap berjalan.
- Typecheck bersih tanpa `any` baru.

Berkas utama: `shared/providers.ts` (baru), `shared/types.ts`, `shared/models.ts`, `main/settings.ts`,
`main/secrets.ts`, `main/services/llm.ts`, `main/generation.ts`, `main/repo.ts`, `main/devharness.ts`.

Ketergantungan: Tugas 1.

### Tugas 3 — Penyedia custom bisa ditambah dan dihapus

- Formulir penyedia baru: nama, base URL, API key (opsional), pilihan kemampuan (Teks/Suara/Gambar/Video), dan
  daftar model. Model bisa diambil dari endpoint (`/models`) atau ditambah manual.
- IPC baru di tiga tempat (AGENTS.md no. 5): `providers:add`, `providers:update`, `providers:remove`, dan
  `providers:fetchModels` bila perlu.
- Validasi di main: id unik, `roles` tidak kosong, URL hanya `http`/`https`, dan nama tidak kosong.
- Hapus penyedia: konfirmasi, hapus kuncinya dari `secrets`, dan ganti `defaultId` peran terkait bila penyedia itu
  sedang dipakai.
- Formulir edit memakai komponen yang sama; perubahan base URL harus mengosongkan cache model lama.
- Rail menampilkan penyedia custom di bawah pemisah **Penyedia custom**.

Kriteria selesai:

- Bisa menambah dua penyedia custom (satu LLM, satu visual), memakainya, menutup aplikasi, membukanya lagi, dan
  kuncinya masih terbaca.
- Menghapus penyedia custom tidak menyisakan kunci atau `defaultId` yang menggantung.

Berkas utama: `pages/settings/CustomProviderForm.tsx`, `main/ipc.ts`, `shared/api.ts`, `preload/index.ts`,
`main/secrets.ts`, `main/settings.ts`.

Ketergantungan: Tugas 2.

### Tugas 4 — Halaman Model bawaan

- Pindahkan pemilihan model default dari panel penyedia ke halaman **Model bawaan**:
  - Cerita (LLM): penyedia + model.
  - Suara narator (TTS): penyedia + model.
  - Gambar: penyedia + model gambar.
  - Video: penyedia + model video.
- Panel detail penyedia tetap menampilkan model yang tersedia (untuk memilih saat menyiapkan penyedia), tetapi
  pilihan yang berlaku untuk proyek baru ada di halaman ini.
- Langkah Ide cerita tetap bisa mengganti penyedia/model per proyek; nilai awalnya diambil dari halaman ini.
- `repo.ts`: `createProject` membaca `providers.*.models`, bukan field lama.

Kriteria selesai:

- Mengubah model bawaan tidak mengubah proyek yang sudah ada.
- Proyek baru memakai pilihan dari halaman Model bawaan.
- Flow2API dan penyedia visual custom memakai slot gambar dan video masing-masing.

Berkas utama: `pages/settings/DefaultModelsSection.tsx`, `main/repo.ts`, `pages/project/ModelSection.tsx`
(bila perlu penyesuaian nilai awal).

Ketergantungan: Tugas 2.

### Tugas 5 — Status dan penanda masalah

- Sidebar menampilkan ikon warning pada peran yang belum punya penyedia terhubung (mis. Suara belum diatur).
- Rail menampilkan status dari `KeyStatus`; setelah Tes, badge langsung berubah tanpa memuat ulang halaman.
- Detail menampilkan pesan hasil tes terakhir beserta waktu pengecekan, seperti sekarang.
- Penyedia yang gagal terhubung tetap bisa dibuka untuk diperbaiki.

Kriteria selesai:

- Mencabut kunci membuat badge dan warning berubah tanpa restart.
- Status tidak dihitung ulang di beberapa komponen dengan hasil berbeda.

Berkas utama: `pages/settings/SettingsSidebar.tsx`, `ProviderRail.tsx`, `ProviderDetail.tsx`.

Ketergantungan: Tugas 1 dan 2.

### Tugas 6 — Dokumentasi dan aturan

- `docs/konvensi.md`: ganti aturan "satu dropdown penyedia per bagian" dengan pola sidebar → rail → detail.
- `docs/layanan-ai.md`: bagian pengaturan penyedia, penyedia custom, dan status kunci.
- `docs/keputusan-teknis.md`: alasan katalog penyedia, pemisahan Model bawaan, dan normalisasi setting lama.
- `docs/arsitektur.md`: bila alur setting berubah cukup banyak, tambahkan satu paragraf.
- `AGENTS.md`: peta kode ditambah `pages/settings/` dan `shared/providers.ts`.

Kriteria selesai: dokumen tidak lagi menyebut pola dropdown lama.

## Urutan dan ketergantungan

```
Tugas 1 (kerangka tampilan)
   ├─► Tugas 2 (katalog penyedia) ──► Tugas 3 (penyedia custom)
   │                              ├─► Tugas 4 (model bawaan)
   │                              └─► Tugas 5 (status & warning)
   └────────────────────────────────► Tugas 6 (dokumentasi)
```

Tugas 1 bisa selesai dan di-merge sendiri karena hanya memindahkan tampilan. Tugas 2–5 sebaiknya satu branch
karena mengubah bentuk `AppSettings` dan `ApiProvider` sekaligus.

## Checkpoint

- [ ] Typecheck dan build bersih.
- [ ] Dev harness dengan `STUDIO_USER_DATA` sementara: buka Pengaturan, ganti section, ganti penyedia, simpan
      kunci palsu, tes, hapus.
- [ ] Salinan database lama: kunci dan pilihan provider terbaca setelah normalisasi.
- [ ] Tambah penyedia custom, pakai di proyek baru, restart aplikasi, dan kunci tetap ada.
- [ ] Screenshot 1180×720 dan 1600×900, tema terang dan gelap, untuk: rail gambar & video, detail penyedia,
      formulir penyedia baru, Model bawaan, Umum, Whisper.
- [ ] `docs/konvensi.md`, `docs/layanan-ai.md`, `docs/keputusan-teknis.md`, dan `AGENTS.md` diperbarui.

## Di luar lingkup (versi pertama)

- Penyedia ComfyUI. Rencananya ada di [comfyui.md](comfyui.md).
- Marketplace atau katalog penyedia yang diunduh dari internet (pola "market" ArcReel).
- Kredensial per proyek. Kunci tetap milik aplikasi.
- Impor/ekspor konfigurasi penyedia antar komputer.
- Penyedia serverless (RunPod Serverless, Modal, ComfyDeploy).
- Pengaturan lanjutan per model (harga, kapabilitas, batas konteks) seperti price editor ArcReel.
