# Rencana Peningkatan Alur & Fitur dari Referensi Drama Short

> **Status:** rencana saja. Belum ada kode yang diubah.
> **Untuk agent:** kerjakan per gelombang, jangan lompat ke gelombang berikutnya sebelum verifikasi gelombang
> sebelumnya bersih.

**Tujuan:** Memakai ide dari tujuh repo referensi (huobao-drama, drama-skills, awesome-short-drama-skills,
dramaclaw, LocalMiniDrama, dramaxis, short-drama-factory) untuk memperbaiki alur produksi dan fitur ReelStar,
tanpa mengubah prinsip yang sudah dipegang: pratinjau = ekspor, BYOK, migrasi hanya ditambah di akhir.

**Arsitektur:** Tiga gelombang. Gelombang A hanya memakai kode yang sudah ada atau memperbaiki sambungan yang
putus. Gelombang B menambah data baru (migrasi). Gelombang C menambah infrastruktur kerja (job center, versi
naskah, grup kerja, paket kirim).

**Tech Stack:** TypeScript strict, Electron, React, SQLite (better-sqlite3), FFmpeg.

**Referensi ide:**

| Repo | Ide yang diambil |
|---|---|
| huobao-drama | rail progres, batch + retry failed, thumbnail/poster, tes koneksi penyedia |
| zenstory-ai/drama-skills | continuity lock + lock words, validasi lintas dokumen, preview-lalu-konfirmasi, audit task |
| awesome-short-drama-skills | kadens hook/paywall, ronde 3 episode |
| dramaclaw | aset identitas stabil + varian, task center dengan resume |
| LocalMiniDrama | workflow group, parameter storyboard, pustaka scene lintas episode |
| dramaxis | quality gate, versi naskah + rollback, preset platform ekspor |
| short-drama-factory | four-beat 15 detik, jangkar visual, ledger kontinuitas, rotasi reversal |

## Global Constraints

- Teks antarmuka Bahasa Indonesia santai ("kamu"); nama kode dan komentar Bahasa Inggris.
- Semua aturan yang memengaruhi gambar/suara final ditulis di `src/shared/` dan dipakai pratinjau + ekspor.
- Setiap input baru yang masuk prompt **wajib** masuk basis hash (`shared/hash.ts`), kalau tidak hasil lama
  dianggap "terkini" padahal prompt berubah.
- Migrasi hanya ditambah di akhir `MIGRATIONS` di `src/main/db/index.ts`. Jangan mengubah migrasi lama.
- Kolom klip baru wajib ditambahkan di semua tempat sesuai AGENTS.md aturan 4.
- `npm run typecheck` dan `npm run build` wajib bersih.

## Review Focus

1. **Paritas pratinjau/ekspor** tetap utuh setelah preset ekspor dan lock words ditambahkan.
2. **Tidak ada tagihan dobel**: job yang dilanjutkan memakai `remote_id` yang sudah ada, bukan submit ulang.
3. **Tidak ada false positive** di Dokter Naskah untuk narator, OS/VO, dan shot tanpa dialog.
4. **Hash berubah** ketika lock words atau referensi per shot berubah.

---

# Gelombang A — Pakai yang sudah ada

Tanpa migrasi, tanpa alur berbayar baru. Tiga item, semuanya memperbaiki sambungan yang sudah putus.

## A1. `shot_detail` dari AI dibuang sebelum sampai ke prompt

**Masalah.** Skema meminta sutradara detail per shot, prompt gambar/video sudah membacanya, tetapi jembatan
antara keduanya tidak ada. Akibatnya `lighting`, `blocking`, `cameraMotion`, `nonSpeakingReaction`, dan
`speechDelivery` selalu kosong.

**Bukti kode.**

| Lokasi | Isi |
|---|---|
| `src/main/story.ts:373-386` | skema meminta `shot_detail` (camera_motion, lighting, blocking, dst.) |
| `src/main/story.ts:429-438` | `RawDraftShot.shot_detail` sudah diketik |
| `src/main/story.ts:514-527` | `cleanShots` tidak memetakan `shot_detail` |
| `src/main/repo.ts:1362` | menyimpan `shot.shotDetail` yang selalu `{}` |
| `src/shared/prompts.ts:213,280,283,295` | membaca `clip.shotDetail` untuk lighting, kamera, reaksi, cara bicara |

**Files.**
- Modify: `src/main/story.ts`
- Modify: `src/renderer/src/pages/project/PlanStep.tsx`

**Interfaces.**
- Consumes: `RawDraftShot.shot_detail`
- Produces: `DraftShot.shotDetail` terisi (`ShotDetail`), tersimpan lewat `updateShot` yang sudah ada.

- [ ] **Step 1: Petakan `shot_detail` di `cleanShots`**

  Tambahkan konversi snake_case → camelCase dengan `str()` yang sudah dipakai di file itu:
  `camera_motion → cameraMotion`, `camera_reason → cameraReason`, `lighting`, `blocking`,
  `non_speaking_reaction → nonSpeakingReaction`, `sfx_ambience → sfxAmbience`,
  `speech_delivery → speechDelivery`, `dialogue_type → dialogueType`.
  Hanya isi `shotDetail` kalau ada minimal satu nilai tidak kosong, supaya draft lama tetap ringkas.

- [ ] **Step 2: Tampilkan dan izinkan edit di Rencana**

  Di kartu shot `PlanStep.tsx`, tambahkan bagian "Sutradara" (bisa dilipat): gerak kamera + alasan, lighting,
  blocking, reaksi tokoh lain, SFX/ambience, cara bicara, tipe dialog. Simpan lewat
  `updateShot(idx, { shotDetail: { ...shot.shotDetail, [field]: value } })` yang sudah ada di
  `PlanStep.tsx:378`. Tipe dialog memakai `Select` (bukan `<select>`).

- [ ] **Step 3: Verifikasi**

  Run: `npm run typecheck` lalu `npm run build`.
  Run dev harness: seed proyek, buka Rencana, susun naskah, lalu `console.log(clip.shotDetail)` di Storyboard.
  Expected: field terisi, bukan `{}`. Generate satu gambar dan periksa prompt yang tersimpan di `assets.prompt`
  memuat baris `Lighting:` / `Blocking & character staging:`.

**Risiko.** Prompt jadi lebih panjang. `compileClipPrompt` sudah punya jalur trim
(`src/shared/prompts.ts:252-262`), tetapi jalur trim itu membuang lighting/blocking. Periksa apakah model yang
dipakai punya `promptLimit` kecil; kalau ya, letakkan baris sutradara sebelum `framingLine` agar tidak terbuang
lebih dulu.

**Ukuran:** S.

## A2. Dokter Naskah: tiga fungsi siap pakai, nol pemanggil

**Masalah.** `checkScriptDoctor`, `computeEpisodeRhythm`, dan `validateSpeechDuration` sudah ditulis lengkap
tetapi tidak diimpor di mana pun. Yang berjalan di UI hanya cek aset dan dialog > 20 kata.

**Bukti kode.**

| Lokasi | Isi |
|---|---|
| `src/shared/validation.ts:487` | `checkScriptDoctor` (7 aturan) |
| `src/shared/validation.ts:670` | `computeEpisodeRhythm` |
| `src/shared/validation.ts:469` | `validateSpeechDuration` |
| `src/renderer/src/pages/project/PlanStep.tsx:184-278` | cek ad-hoc: aset belum terdaftar + dialog > 20 kata |

**Files.**
- Modify: `src/shared/validation.ts`
- Modify: `src/renderer/src/pages/project/PlanStep.tsx`
- Create: `src/renderer/src/pages/project/ScriptDoctorPanel.tsx`

**Interfaces.**
- Consumes: `EpisodeScriptDraft`, `Episode`, `{ characters, locations, props, derivatives }`
- Produces: `ScriptDoctorIssue[]` dengan `shotIndex` untuk lompat ke shot; `ShotRhythmSegment[]` untuk strip ritme.

- [ ] **Step 1: Perbaiki aturan yang salah sasaran**

  - Lewatkan pengecekan pembicara untuk nama narator (`isNarratorName` dari `shared/script.ts`).
  - Aturan "pembicara harus terlihat" hanya berlaku untuk `dialogueType === 'dialogue'` (setelah A1); `os`, `vo`,
    dan `narration` tidak butuh bibir di layar.
  - `WEAK_HOOK` jangan lolos hanya karena ada teks; hook harus punya aksi visual atau emosi.

- [ ] **Step 2: Tambah aturan ritme dari short-drama-factory**

  - `DIALOGUE_RUN_TOO_LONG`: lebih dari 6 shot dialog murni berurutan tanpa shot aksi/reaksi (E24).
  - `VISUAL_ANCHOR_MISSING`: tidak ada shot aksi/reaksi di antara 4 shot dialog (jangkar visual).
  - `FOUR_BEAT_SKEW`: blok waktu 0–15 / 15–45 / 45–85 / 85–110 detik (diskalakan ke durasi target episode)
    tidak punya hook, konfrontasi, pembalikan, dan aftermath.
  - `CLIFFHANGER_UNRESOLVED`: episode N tidak membuka dengan resolusi cliffhanger episode N-1. Butuh parameter
    opsional `previousEpisode` supaya tidak memecah pemanggil lama.

- [ ] **Step 3: Panel Dokter Naskah di Rencana**

  - Panggil `checkScriptDoctor(draft, episode, { characters, locations, props, derivatives })`.
  - Kelompokkan per severity (error / warning / info), badge jumlah, filter "hanya error".
  - Klik issue → scroll ke kartu shot + sorot (`shotIndex`).
  - Tampilkan `computeEpisodeRhythm` sebagai strip horizontal: lebar = durasi, warna = pacing, ikon = tipe shot.
  - Tombol deterministik: "Perpanjang durasi" (set `durationSec = ceil(kata / 2.6)`) dan "Bagi jadi 2 shot".
  - Tombol AI ("Minta AI perbaiki shot ini") ditandai terpisah dan tidak otomatis, karena berbiaya.

- [ ] **Step 4: Verifikasi**

  Run: `npm run typecheck`, `npm run build`.
  Dev harness: buat draft dengan 8 shot close-up dialog → muncul `TALKING_HEAD_MONOTONY`. Shot 1 tanpa aksi
  visual → `WEAK_HOOK`. Shot 2 detik berisi 12 kata → `SPEECH_DURATION_OVERFLOW` dan tombol perbaikan mengubah
  durasi. Pastikan narator tidak memicu `UNREGISTERED_SPEAKER`.

**Ukuran:** M.

## A3. Preset platform di ekspor

**Masalah.** Ekspor hanya punya 720/1080/4K dan 30/60 fps dengan CRF tetap. Tidak ada bitrate per platform,
ukuran 1080×1440 (RED), cek 60 detik Shorts, atau matte blur 9:16 untuk proyek 16:9.

**Bukti kode.**

| Lokasi | Isi |
|---|---|
| `src/shared/types.ts:909-921` | `ExportOptions` hanya resolution + fps + encoder |
| `src/main/exporter.ts:44-48` | `outputSize` dari aspect + resolution |
| `src/main/exporter.ts:350-352, 826-828` | encoder CRF/CQ tetap |
| `src/main/exporter.ts:703-704` | estimasi ruang disk per resolution |
| `src/renderer/src/pages/project/ExportDialog.tsx:10-14, 489-519` | pilihan 720/1080/4K + fps |

**Files.**
- Create: `src/shared/exportPresets.ts`
- Modify: `src/shared/types.ts` (`ExportOptions`)
- Modify: `src/main/exporter.ts`
- Modify: `src/renderer/src/pages/project/ExportDialog.tsx`

**Interfaces.**
- Produces: `EXPORT_PRESETS: ExportPreset[]` dengan `{ id, label, w, h, fps, bitrateKbps, maxDurationSec?, note }`.

- [ ] **Step 1: Katalog preset**

  Minimal: TikTok/Reels/Shorts (1080×1920), RED (1080×1440), Douyin (1080×1920, 8000k),
  Kuaishou (1080×1920, 6000k), Bilibili (1920×1080), YouTube (1920×1080), dan Kustom.

- [ ] **Step 2: Perluas `ExportOptions` tanpa memecah payload lama**

  Tambah semua sebagai opsional: `presetId?: string`, `targetSize?: { w: number; h: number } | null`,
  `videoBitrateKbps?: number | null`, `maxDurationSec?: number | null`.

- [ ] **Step 3: Exporter menghormati preset**

  - `outputSize` menerima override `targetSize`.
  - Encoder: kalau `videoBitrateKbps` ada, pakai `-b:v`, `-maxrate`, `-bufsize` (dan `-cq` untuk NVENC);
    kalau tidak, tetap CRF seperti sekarang.
  - Estimasi ruang disk memakai bitrate preset, bukan tabel `mbPerSec` per resolution.
  - Kalau `maxDurationSec` ada dan total lebih panjang, tampilkan peringatan di UI sebelum render.

- [ ] **Step 4: UI**

  Grid preset (bukan `<select>`), tampilkan konsekuensi: ukuran file perkiraan, fps, dan "video 78 dtk akan
  melebihi batas 60 dtk Shorts". Opsi matte blur 9:16 untuk proyek 16:9 dibuat terpisah dan default mati.

- [ ] **Step 5: Verifikasi**

  Run: `npm run typecheck`, `npm run build`.
  Dev harness: `{"main":"seed"}` lalu `{"main":"export"}` untuk preset Shorts dan RED.
  Periksa dengan `ffprobe`: lebar/tinggi, fps, bitrate, dan durasi video vs audio (selisih < 100 ms).

**Risiko.** Ini menyentuh ekspor, area paling sensitif. Jangan mengubah `planSegments` atau transisi; hanya
ukuran output dan parameter encoder. Matte blur adalah perubahan filter graph — kerjakan terakhir dan terpisah.

**Ukuran:** M (tanpa matte), L (dengan matte).

---

# Gelombang B — Fitur alur (butuh migrasi)

Semua migrasi ditambahkan sebagai entri baru di akhir `MIGRATIONS` (`src/main/db/index.ts:6`).

## B1. Continuity lock / lock words

**Masalah.** Tidak ada frasa identitas yang dipaku verbatim ke semua prompt. Prompt dirakit ulang dari deskripsi
tiap kali, jadi kostum/wajah bisa melenceng antar shot. `costumeKeyphrase` ada, tetapi hanya untuk kostum.

**Bukti kode.** `src/shared/prompts.ts:226-238` merakit wardrobe dari deskripsi; `src/main/db/index.ts:247`
menambah `costume_keyphrase`.

**Files.**
- Modify: `src/main/db/index.ts` (migrasi)
- Create: `src/shared/lock.ts`
- Modify: `src/shared/prompts.ts`
- Modify: `src/shared/hash.ts`
- Modify: `src/main/repo.ts` (baca/tulis lock words)
- Modify: `src/renderer/src/pages/project/LorebookPage.tsx` atau panel di Rencana

**Interfaces.**
- Produces: `buildLockWords(...): LockWord[]`, `renderLockBlock(lockWords): string`,
  `checkLockCompliance(prompt, lockWords): LockWord[]` (yang hilang).

- [ ] **Step 1: Migrasi**

  `ALTER TABLE episodes ADD COLUMN lock_words_json TEXT NOT NULL DEFAULT '[]'` dan
  `ALTER TABLE projects ADD COLUMN series_lock_json TEXT NOT NULL DEFAULT '[]'`.

- [ ] **Step 2: Bangun lock words**

  Dari karakter (nama + ciri wajah/rambut), varian kostum (`costumeKeyphrase`), lokasi (ciri tetap), prop
  (bentuk/material), dan tambahan manual. Setiap lock word punya `id`, `label`, `text`, `source`, `enabled`.

- [ ] **Step 3: Sisipkan ke prompt dan hash**

  Blok `LOCKED (keep verbatim): ...` ditaruh setelah scene, sebelum art style, di `compileClipPrompt` dan
  `compileClipVideoPrompt`. **Wajib** masukkan lock words ke `computeClipImageBasisHash` dan
  `computeClipVideoBasisHash`, supaya mengubah lock menandai hasil lama sebagai basi.

- [ ] **Step 4: Validasi**

  `checkLockCompliance` melaporkan lock word yang hilang karena prompt terpotong. Tampilkan sebagai warning di
  Storyboard, bukan blocker.

- [ ] **Step 5: Verifikasi**

  Ubah satu lock word → status gambar berubah `current → stale`. `npm run typecheck`, `npm run build`.

**Ukuran:** M.

## B2. Ledger kontinuitas lintas episode

**Masalah.** Tidak ada catatan foreshadow, prop, atau aturan dunia; tidak ada verifikasi payoff. Prompt planner
menyebut "resolve cliffhanger" tetapi tidak ada yang memeriksa hasilnya.

**Files.**
- Modify: `src/main/db/index.ts`
- Modify: `src/main/repo.ts`
- Modify: `src/shared/types.ts`, `src/shared/api.ts`, `src/preload/index.ts`
- Modify: `src/main/story.ts` (prompt planner)
- Modify: `src/shared/validation.ts`
- Modify: `src/renderer/src/pages/project/LorebookPage.tsx` atau `EpisodeHub.tsx`

- [ ] **Step 1: Tabel `continuity_items`**

  `id, project_id, kind (foreshadow|prop|rule|relationship), name, detail, status (open|paid|dropped),
  tier (hot|cold), planted_episode_id, payoff_episode_id, created_at`.

- [ ] **Step 2: UI daftar + tandai payoff**

  Tab "Kontinuitas": item open, umur (sudah berapa episode), tombol "Dibayar di episode ini".

- [ ] **Step 3: Aturan baru di Dokter Naskah**

  `CONTINUITY_OPEN_TOO_LONG` (hot > 3 episode), `PAYOFF_MISSING` (dijadwalkan payoff di episode ini tetapi tidak
  ada shot yang menyebut), `PROP_VANISHED` (prop muncul lalu hilang tanpa alasan).

- [ ] **Step 4: Prompt planner**

  Sertakan item open yang jatuh tempo + instruksi menutupnya di `planEpisodeScript`.

**Ukuran:** M–L.

## B3. Binding referensi per shot

**Masalah.** `collectReferenceSheets` memilih otomatis; pengguna tidak bisa melihat, menimpa, atau mengunggah
referensi sendiri.

**Files.**
- Modify: `src/main/db/index.ts`, `src/main/repo.ts`, `src/shared/types.ts`
- Modify: `src/main/generation.ts` (`resolveReferenceUrls`)
- Modify: `src/shared/hash.ts`
- Modify: `src/renderer/src/pages/project/editor/Inspector.tsx` atau `StoryboardStep.tsx`

- [ ] **Step 1: Kolom `reference_asset_ids_json` di `clips`**

  `null` berarti otomatis (perilaku sekarang). Isi berarti override, tetap dipotong ke `maxRefs(model)`.

- [ ] **Step 2: UI chip referensi**

  Tampilkan lembar yang dipakai berurutan (karakter/kostum → lokasi → prop), tombol lepas, tombol
  "Unggah referensi" (Asset `image` dengan `clipId`).

- [ ] **Step 3: Hash**

  Masukkan daftar id referensi ke `computeClipImageBasisHash`.

- [ ] **Step 4: Verifikasi**

  Lepas satu referensi → gambar jadi `stale`; generate ulang memakai urutan baru. Cek `assets.prompt` memuat
  `Reference images are provided in this exact order: ...` yang sesuai.

**Ukuran:** M.

---

# Gelombang C — Infrastruktur kerja

## C1. Job center + retry failed

**Kondisi sekarang.** `resumeJobs` (`src/main/generation.ts:1470`) sudah melanjutkan job Higgsfield lewat
`remote_id`, tetapi job Flow2API ditandai gagal karena tidak ada remote id. Tidak ada UI daftar job; status hanya
terlihat per klip.

**Files.**
- Modify: `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`
- Modify: `src/main/generation.ts`
- Create: `src/renderer/src/pages/project/JobCenter.tsx`
- Modify: `src/renderer/src/pages/project/StoryboardStep.tsx` (tombol "Ulangi yang gagal")

- [ ] **Step 1: API**

  `jobs.retryFailed(projectId, episodeId?, kind?)`, `jobs.resume(jobId)`.

- [ ] **Step 2: Panel Aktivitas**

  Daftar job dari store, filter status/kind, batalkan, ulangi yang gagal, ringkasan biaya per batch.

- [ ] **Step 3: Retry failed**

  Kumpulkan klip yang job terakhirnya `failed`, lalu panggil ulang per klip dengan modal estimasi gabungan.
  Jangan submit ulang job yang punya `remote_id` dan masih `running`.

- [ ] **Step 4: Jujur soal Flow2API**

  Kalau penyedia tidak memberi id yang bisa dilacak, tandai "tidak bisa dilanjutkan" dan tawarkan ulang, jangan
  berpura-pura bisa resume.

**Ukuran:** M.

## C2. Versi naskah + rollback

**Files.** `src/main/db/index.ts`, `src/main/repo.ts`, `src/shared/types.ts`, `src/shared/api.ts`,
`src/preload/index.ts`, `src/main/ipc.ts`, `PlanStep.tsx`.

- [ ] **Step 1:** Tabel `script_versions(id, episode_id, draft_json, created_at, note)`.
- [ ] **Step 2:** Simpan versi setiap kali planner menghasilkan draft dan setiap konfirmasi; simpan maksimal 20
  per episode.
- [ ] **Step 3:** Dropdown versi + "Pulihkan" di Rencana (pakai `Select`).

**Ukuran:** S–M.

## C3. Workflow group

**Files.** `StoryboardStep.tsx`, `src/shared/api.ts` (kalau perlu orkestrasi baru).

- [ ] **Step 1:** Mode pilih beberapa shot (checkbox di kartu).
- [ ] **Step 2:** Aksi grup: "Gambar ulang", "Video ulang", "Suara ulang" — memakai
  `generateClipsVideo(clipIds)`, `generateMissingImages`, `missingTts` yang sudah ada.
- [ ] **Step 3:** Modal estimasi gabungan sebelum jalan.

**Ukuran:** S–M.

## C4. Paket pengiriman

**Files.** `src/main/exporter.ts` (atau modul baru `src/main/package.ts`), `ExportDialog.tsx`.

- [ ] **Step 1:** Setelah MP4 selesai, tulis `manifest.json` (durasi, resolusi, fps, daftar aset, versi naskah,
  hash file) + `checksums.txt` + SRT kalau dipilih.
- [ ] **Step 2:** Zip semua ke satu folder kirim. Tanpa menambah dependensi baru kalau `archiver` belum ada —
  gunakan `zip` bawaan sistem atau tulis ZIP sederhana hanya kalau memang perlu.

**Ukuran:** S.

---

# Urutan dan ketergantungan

```
A1 ──► A2        (A2 memakai shotDetail untuk membedakan dialogue/OS/VO)
A3               (independen, tapi sentuh ekspor → uji paling akhir di gelombang A)
B1 ──► B3        (keduanya mengubah hash; kerjakan B1 dulu agar pola hash konsisten)
B2               (independen dari B1, tetapi memakai panel Dokter Naskah dari A2)
C2 ──► C1        (versi naskah memudahkan rollback saat retry mengubah hasil)
C3 ──► C1        (retry failed adalah bahan untuk grup kerja)
C4               (independen)
```

# Verifikasi per gelombang

1. `npm run typecheck` — wajib bersih (strict, `noUnusedLocals`, `noUnusedParameters`).
2. `npm run build` — wajib bersih.
3. Perubahan UI: jalankan dev harness dengan `STUDIO_CAPTURE_PLAN` dan `STUDIO_USER_DATA` sementara, ambil
   screenshot, dan periksa isi halaman lewat `console.log` (lebih andal daripada screenshot saja).
4. Perubahan ekspor: `{"main":"seed"}` lalu `{"main":"export"}`, periksa dengan `ffprobe` (resolusi, fps,
   bitrate, durasi video vs audio) dan cuplikan frame.
5. Perubahan hash: pastikan mengubah input baru menandai hasil lama sebagai `stale`, bukan `current`.

# Yang sengaja tidak dikerjakan

- Kanvas tak terbatas dan node graph (dramaclaw, LocalMiniDrama): perubahan besar, tidak sepadan sebelum alur
  dasar rapi.
- Ekspor `.draft` CapCut/Jianying (dramaxis): butuh reverse engineering format, di luar cakupan.
- Agent chat dalam aplikasi (LocalMiniDrama): menarik, tetapi lebih baik setelah Dokter Naskah dan ledger stabil.
- Ekstraksi gaya visual dari gambar referensi (dramaclaw): katalog gaya sudah ada; ini fitur baru, bukan
  perbaikan alur.
