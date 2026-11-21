# Rencana: Halaman Pengaturan Berbasis Katalog Penyedia

Status: **selesai di Fase 8** ([plan.md](plan.md), Tugas 53–58) (2026-11-21). Revisi 2026-11-21: penyedia dan model berlaku **global** untuk
semua proyek; penyedia custom versi pertama hanya untuk LLM.

## Tujuan

Menyiapkan halaman Pengaturan untuk menampung banyak penyedia AI tanpa berubah menjadi satu halaman panjang.
Pola yang dipakai adalah **sidebar → daftar penyedia → panel detail** seperti ArcReel, tetapi tetap memakai bahasa
visual ReelStar (kertas, tinta, aksen oranye). Perubahan ini juga memisahkan kredensial penyedia dari pilihan model aktif
global, sehingga menambah penyedia baru tidak lagi menambah isian di halaman yang sama.

Hasil akhir yang diinginkan:

- Setiap peran (cerita/LLM, suara/TTS, gambar & video) punya daftar penyedia sendiri dengan status yang terlihat.
- Penyedia custom (LLM) bisa ditambah, diubah, dan dihapus tanpa mengubah kode.
- Penyedia dan model yang aktif diatur sekali di Pengaturan dan berlaku untuk **semua proyek**. Tidak ada lagi
  pilihan penyedia/model per proyek.
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
- **Setting sekarang setengah global, setengah per proyek**, dan itu sumber bug:
  - Penyedia visual global (`defaultVisualProvider`, dibaca `isFlow2Api()` di `generation.ts`), tetapi model
    gambar/video disimpan per proyek (`projects.image_model`, `video_model`). Karena itu `generation.ts` menebak
    pemilik model lewat `!model.includes('/')` di sekitar sepuluh tempat. Kalau penyedia visual diganti, proyek lama
    membawa id model milik penyedia lain.
  - Penyedia TTS per proyek (`projects.tts_provider`) dan per tokoh (`characters.tts_provider`), tetapi model TTS
    global (`geminiTtsModel`, `elevenModel`).
  - LLM sudah global (`llmProvider`, `llmModels`).

## Keputusan desain

1. **Tiga kolom, dengan dua kolom untuk halaman tanpa daftar.** Sidebar 246 px, rail penyedia 292 px, detail
   fleksibel. Halaman Umum, Tentang, Whisper, dan Model aktif memakai sidebar + detail saja.
2. **Sidebar berkelompok:**
   - **Penyedia:** Cerita (LLM), Suara (TTS), Gambar & video, Whisper (lokal).
   - **Aktif:** Model aktif.
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
7. **Semua setting penyedia dan model global.** Kredensial, penyedia aktif per peran, dan model aktif per tujuan
   berlaku untuk semua proyek. Proyek tidak menyimpan dan tidak menimpa pilihan itu. Alasannya: satu sumber
   kebenaran, tidak ada lagi tebakan pemilik model, dan pengguna cukup mengatur sekali.
   - Yang tetap per proyek/tokoh adalah **isi kreatif**, bukan konfigurasi: suara narator (`projects.tts_voice`),
     suara tokoh (`characters.tts_voice`), gaya visual, rasio, bahasa. Suara terikat ke penyedia TTS, jadi kalau
     penyedia TTS global berbeda dengan penyedia tempat suara itu dipilih, suara tersebut dilewati dan dipakai
     suara bawaan penyedia, sama seperti logika `charVoice` sekarang di `generation.ts`. UI menandai tokoh yang
     suaranya belum dipilih untuk penyedia aktif.
8. **Tidak ada migrasi database.** Setting disimpan sebagai key/value JSON, dan tabel `secrets` sudah memakai
   `provider TEXT`. Kolom lama `projects.tts_provider`, `projects.image_model`, `projects.video_model`, dan
   `characters.tts_provider` dibiarkan di skema (migrasi tidak boleh diubah) tetapi tidak lagi dibaca untuk
   menentukan penyedia/model. `characters.tts_provider` tetap ditulis sebagai penanda penyedia milik suara tokoh.
9. **Model aktif dipisah per tujuan.** Satu penyedia visual punya slot model gambar dan model video sendiri
   (`image`, `video`), sedangkan LLM/TTS hanya satu slot. Slot disimpan per penyedia, sehingga berpindah dari
   Flow2API ke Higgsfield lalu kembali tidak menghapus pilihan model Flow2API.
10. **Mengganti model aktif berarti hasil lama menjadi basi, bukan dibuat ulang.** Hash basis memakai model yang
    benar-benar dipakai (hasil resolver global). Sebelum menyimpan penggantian penyedia/model gambar atau video,
    tampilkan konfirmasi: "Gambar dan video di semua serial akan ditandai basi. Tidak ada yang dibuat ulang
    otomatis."
11. **Penyedia custom versi pertama hanya untuk LLM** (protokol kompatibel OpenAI). `generation.ts` hanya mengenal
    API Higgsfield dan Flow2API, dan TTS hanya Gemini/ElevenLabs, jadi penyedia custom gambar/video/suara belum
    bisa dipanggil. `ProviderDef` diberi kolom `protocol` supaya bisa diperluas nanti (lihat [comfyui.md](comfyui.md)).
12. **Penyedia `custom` yang lama menjadi entri pertama `customProviders`** dengan id `custom`, nama "Endpoint
    custom", dan `baseUrl` dari `customBaseUrl`. Id-nya sama, jadi kunci di `secrets` tetap terbaca. Slug `custom`
    masuk daftar id yang dipesan.
13. **Bahasa visual tetap ReelStar.** Token warna, `shadow-ink`, font Bricolage/Plus Jakarta, dan `ProviderLogo`
    dipakai ulang. Jangan memakai warna atau komponen ArcReel.

## Data model yang dituju

```ts
// src/shared/providers.ts
export type ProviderRole = 'llm' | 'tts' | 'visual'
export type ProviderKind = 'preset' | 'custom'
export type ModelPurpose = 'llm' | 'tts' | 'image' | 'video'
/** Wire protocol the main process speaks; custom providers may only pick 'openai-chat' in v1. */
export type ProviderProtocol = 'gemini' | 'openai-chat' | 'elevenlabs' | 'higgsfield' | 'flow2api'

export interface ProviderDef {
  id: string                 // 'gemini', 'openrouter', id custom
  name: string
  roles: ProviderRole[]
  kind: ProviderKind
  protocol: ProviderProtocol
  logo?: ProviderLogoId      // penyedia custom memakai ikon server
  note: string
  docs?: { link: string; label: string }
  baseUrl?: string           // custom dan Flow2API
  keyOptional?: boolean      // custom lokal tanpa token
}

/** The only place that decides which provider/model is used; main and renderer both call it. */
export function resolveActive(settings: AppSettings, purpose: ModelPurpose): { provider: ProviderDef; model: string }
```

```ts
// src/shared/types.ts
export interface RoleSettings {
  /** Penyedia aktif untuk peran ini, berlaku untuk semua proyek. */
  activeId: string
  /** Model per penyedia per tujuan, supaya berpindah penyedia tidak menghapus pilihan model penyedia lain. */
  models: Record<string, Partial<Record<ModelPurpose, string>>>
}

export interface AppSettings {
  // ...
  providers: Record<ProviderRole, RoleSettings>
  customProviders: ProviderDef[]
  // concurrency tetap satu nilai global seperti sekarang
}
```

Catatan transisi:

- `LlmProvider`, `TtsProvider`, `VisualProvider`, `ApiProvider`, dan `ModelSource` menjadi `string` (atau alias
  `ProviderId`) supaya id custom bisa masuk.
- Field lama (`llmProvider`, `llmModels`, `customBaseUrl`, `flow2apiBaseUrl`, `geminiTtsModel`, `elevenModel`,
  `imageModel`, `videoModel`, `flow2apiImageModel`, `flow2apiVideoModel`, `defaultVisualProvider`) dibaca sekali
  oleh `getSettings()` lalu dipetakan ke `providers`. Setelah semua pemanggil pindah, field lama dihapus dari
  `DEFAULT_SETTINGS` dan `AppSettings`.
- Penyedia TTS aktif awal: nilai `tts_provider` dari proyek yang terakhir dibuka bila ada, kalau tidak `gemini`.
  Model gambar/video per proyek **tidak** dipindahkan ke global; yang dipakai adalah nilai global lama
  (`imageModel`/`flow2apiImageModel` sesuai penyedia visual). Proyek yang dulu memakai model berbeda akan melihat
  hasilnya basi, dan itu diterangkan sekali lewat pemberitahuan setelah pembaruan.
- `Project.ttsProvider`, `imageModel`, dan `videoModel` di `shared/types.ts` ditandai `@deprecated` lalu dihapus
  dari tipe setelah semua pemanggil memakai `resolveActive`; kolomnya tetap di database.
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
- **`defaultVisualProvider` dipakai di main dan renderer**: `repo.ts`, `generation.ts`, `devharness.ts`,
  `Home.tsx`, `ModelSection.tsx`, `StoryboardStep.tsx`, dan `Settings.tsx`. Nilai cadangannya pun berbeda
  (`Home.tsx` memakai `'higgsfield'`, `DEFAULT_SETTINGS` memakai `'flow2api'`). Semua pindah ke `resolveActive`.
- **Pembacaan model per proyek tersebar.** `project.imageModel`/`videoModel`/`ttsProvider` dibaca di
  `generation.ts`, `narration.ts`, `shared/hash.ts`, `shared/validation.ts`, `StoryboardStep.tsx`,
  `LorebookPage.tsx`, `CharacterModal.tsx`, dan `devharness.ts`. Tebakan `includes('/')` di `generation.ts` dihapus.
- **Hash basis** gambar/video dan lembar referensi memakai model dari `resolveActive`, bukan `project.imageModel`.
  Tanpa itu, mengganti model global tidak membuat hasil lama basi.
- **Satu serial bisa tercampur model** kalau pengguna mengganti model di tengah produksi. Ini konsekuensi yang
  diterima dari setting global; penanganannya adalah konfirmasi di keputusan no. 10 dan status basi yang jujur.
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
- Tambah `resolveActive(settings, purpose)` di `shared/providers.ts` dan pakai di semua pemanggil (daftar di
  Batasan): `generation.ts` (`isFlow2Api` dan sekitar sepuluh tebakan `includes('/')`), `narration.ts`,
  `repo.ts` (`createProject` tidak lagi mengisi model), `shared/hash.ts`, `shared/validation.ts`, `devharness.ts`,
  dan komponen renderer.
- Normalisasi `custom` lama menjadi entri `customProviders` (keputusan no. 12).
- `src/renderer/src/lib/useModels.ts`: tidak perlu berubah selain tipe `source` yang kini `string`.

Kriteria selesai:

- Salinan database lama tetap memuat kunci dan pilihan provider yang sama setelah dibuka.
- Daftar model Gemini/OpenRouter/Groq/ElevenLabs/Flow2API tetap berjalan.
- `grep "includes('/')"` dan `grep "defaultVisualProvider"` di `src/` tidak menemukan apa pun lagi.
- Mengganti model gambar global menandai gambar proyek lama `stale`, bukan `current`.
- Typecheck bersih tanpa `any` baru.

Berkas utama: `shared/providers.ts` (baru), `shared/types.ts`, `shared/models.ts`, `shared/hash.ts`,
`shared/validation.ts`, `main/settings.ts`, `main/secrets.ts`, `main/services/llm.ts`, `main/generation.ts`,
`main/narration.ts`, `main/repo.ts`, `main/devharness.ts`.

Ketergantungan: Tugas 1.

### Tugas 3 — Penyedia custom (LLM) bisa ditambah dan dihapus

- Formulir penyedia baru: nama, base URL, API key (opsional), dan daftar model. Model bisa diambil dari endpoint
  (`/models`) atau ditambah manual. Peran terkunci ke Teks dengan protokol `openai-chat`; pilihan Suara/Gambar/Video
  belum ditampilkan (keputusan no. 11).
- IPC baru di tiga tempat (AGENTS.md no. 5): `providers:add`, `providers:update`, `providers:remove`, dan
  `providers:fetchModels` bila perlu.
- Validasi di main: id unik, `roles` tidak kosong, URL hanya `http`/`https`, dan nama tidak kosong.
- Hapus penyedia: konfirmasi, hapus kuncinya dari `secrets`, dan ganti `defaultId` peran terkait bila penyedia itu
  sedang dipakai.
- Formulir edit memakai komponen yang sama; perubahan base URL harus mengosongkan cache model lama.
- Rail menampilkan penyedia custom di bawah pemisah **Penyedia custom**.

Kriteria selesai:

- Bisa menambah dua penyedia custom LLM, memakai salah satunya, menutup aplikasi, membukanya lagi, dan kuncinya
  masih terbaca.
- Menghapus penyedia custom tidak menyisakan kunci atau `defaultId` yang menggantung.

Berkas utama: `pages/settings/CustomProviderForm.tsx`, `main/ipc.ts`, `shared/api.ts`, `preload/index.ts`,
`main/secrets.ts`, `main/settings.ts`.

Ketergantungan: Tugas 2.

### Tugas 4 — Halaman Model aktif

- Halaman **Model aktif** berisi penyedia + model yang dipakai semua proyek:
  - Cerita (LLM): penyedia + model.
  - Suara (TTS): penyedia + model.
  - Gambar & video: penyedia + model gambar + model video.
- Panel detail penyedia menampilkan model yang tersedia dan tombol "Jadikan aktif"; halaman ini dan panel detail
  menulis ke `providers.<peran>` yang sama.
- Mengganti penyedia/model gambar atau video meminta konfirmasi lebih dulu (keputusan no. 10), dengan jumlah
  serial yang terdampak.
- `ModelSection.tsx` di proyek tidak lagi memilih penyedia/model. Bagian itu menjadi ringkasan baca-saja
  ("Gambar: Nano Banana lewat Flow2API") dengan tautan **Ubah di Pengaturan** (`Route` ke section `models`).
- Pemilih suara narator dan suara tokoh tetap ada di proyek/Lorebook, tetapi daftar suaranya mengikuti penyedia TTS
  aktif. Tokoh yang suaranya milik penyedia lain diberi tanda "Pilih suara untuk <penyedia>".
- `repo.ts`: `createProject` dan `updateProject` tidak lagi menulis `tts_provider`, `image_model`, `video_model`.

Kriteria selesai:

- Mengubah model aktif berlaku di semua proyek dan menandai hasil terkait basi; tidak ada yang dibuat ulang.
- Berpindah penyedia visual lalu kembali memulihkan pilihan model penyedia sebelumnya.
- Proyek lama yang dibuka setelah pembaruan memakai penyedia/model global tanpa error.

Berkas utama: `pages/settings/ActiveModelsSection.tsx`, `main/repo.ts`, `pages/project/ModelSection.tsx`,
`CharacterModal.tsx`, `LorebookPage.tsx`.

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
- `docs/keputusan-teknis.md`: alasan katalog penyedia, setting global (dan kenapa kolom per proyek dibiarkan
  di skema), model basi saat diganti, dan normalisasi setting lama.
- `docs/data-model.md`: tandai `projects.tts_provider`, `image_model`, `video_model` sebagai tidak dipakai.
- Salin mockup dari folder Temp ke `docs/mockup/settings.html` supaya acuannya tidak hilang.
- `docs/arsitektur.md`: bila alur setting berubah cukup banyak, tambahkan satu paragraf.
- `AGENTS.md`: peta kode ditambah `pages/settings/` dan `shared/providers.ts`.

Kriteria selesai: dokumen tidak lagi menyebut pola dropdown lama.

## Urutan dan ketergantungan

```
Tugas 1 (kerangka tampilan)
   ├─► Tugas 2 (katalog penyedia) ──► Tugas 3 (penyedia custom)
   │                              ├─► Tugas 4 (model aktif)
   │                              └─► Tugas 5 (status & warning)
   └────────────────────────────────► Tugas 6 (dokumentasi)
```

Tugas 1 bisa selesai dan di-merge sendiri karena hanya memindahkan tampilan. Tugas 2–5 sebaiknya satu branch
karena mengubah bentuk `AppSettings` dan `ApiProvider` sekaligus.

## Checkpoint

- [x] Typecheck dan build bersih.
- [ ] Dev harness dengan `STUDIO_USER_DATA` sementara: buka Pengaturan, ganti section, ganti penyedia, simpan
      kunci palsu, tes, hapus.
- [x] Salinan database lama *(diuji dengan baris setting lama yang ditulis ulang di harness `checkSettings`, belum
      dengan salinan `studio.db` asli)*: kunci dan pilihan provider terbaca setelah normalisasi; endpoint `custom` lama muncul
      sebagai penyedia custom dengan kunci yang sama.
- [x] Tambah penyedia custom LLM, jadikan aktif, restart aplikasi, dan kunci tetap ada (`checkSettings` write → read).
- [x] Ganti model gambar aktif → gambar di dua proyek berbeda menjadi `stale`; kembalikan → `current` lagi (`checkSettings`).
- [x] *(Diperbaiki 2026-11-21: TTS memakai penyedia global lewat `withActiveTts`; diuji di `checkSettings`.)* Ganti penyedia TTS → tokoh dengan suara penyedia lama ditandai, narasi tetap bisa dibuat dengan suara bawaan.
- [ ] Screenshot 1180×720 dan 1600×900, tema terang dan gelap, untuk: rail gambar & video, detail penyedia,
      formulir penyedia baru, Model aktif, ringkasan model di proyek, Umum, Whisper.
- [ ] `docs/konvensi.md`, `docs/layanan-ai.md`, `docs/keputusan-teknis.md`, dan `AGENTS.md` diperbarui.

## Di luar lingkup (versi pertama)

- Penyedia ComfyUI. Rencananya ada di [comfyui.md](comfyui.md).
- Marketplace atau katalog penyedia yang diunduh dari internet (pola "market" ArcReel).
- Kredensial, penyedia, atau model per proyek. Semuanya global (keputusan no. 7).
- Penyedia custom untuk suara, gambar, dan video (butuh protokol baru; lihat keputusan no. 11).
- Impor/ekspor konfigurasi penyedia antar komputer.
- Penyedia serverless (RunPod Serverless, Modal, ComfyDeploy).
- Pengaturan lanjutan per model (harga, kapabilitas, batas konteks) seperti price editor ArcReel.
