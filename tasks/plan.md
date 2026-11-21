# Rencana Implementasi: Studio Drama Short Multi-Episode

Acuan desain: [docs/superpowers/specs/2026-11-20-drama-short-flow-design.md](../docs/superpowers/specs/2026-11-20-drama-short-flow-design.md)
(disebut "spec" di bawah; nomor § merujuk ke sana).

> Rencana sebelumnya di file ini ("Flow Narasi Baru: Gaya Narasi + Kerangka Bab") sudah tidak berlaku karena alur
> narasi dihapus (K1 di spec). Isinya tetap ada di riwayat git (commit `43330d0`).

## Ringkasan

ReelStar diubah dari pembuat video narasi tunggal menjadi studio serial drama vertikal: proyek = serial, berisi
episode; Lorebook (karakter, varian kostum, lokasi, prop) dipakai bersama semua episode; naskah dibuat dua tahap
dengan langkah tinjau; dialog disuarakan model video (Veo) beserta gerak bibirnya; narator tetap TTS. Editor,
pratinjau, dan exporter FFmpeg yang ada dipakai ulang.

## Urutan dan ketergantungan

```
Fase 1  Fondasi episode ──► Fase 2  Studio Hub & Lorebook ──► Fase 3  Planner & naskah ──► Fase 4  Prompt, suara & generate ──► Fase 5  Opsional
                                                                                              ▲
                                                                     Uji suara Veo (manual) ──┘
```

- Setiap fase dikerjakan di branch sendiri dan di-merge setelah checkpoint-nya lolos.
- Rencana rinci per file hanya ditulis untuk **fase 1**. Tugas fase 2–4 di bawah adalah garis besar; rinci ulang
  di awal fase itu berdasarkan kondisi kode terbaru.
- **Uji suara Veo** (3–4 shot dialog bahasa Indonesia, tokoh yang sama) wajib sebelum fase 4 dimulai. Jika gagal,
  §6.C spec diganti ke `dialog_audio = 'tts'` + lip-sync sebelum fase 4 dirinci.
- **Ditunda (2026-11-21):** uji suara Veo dan Checkpoint 4 dijalankan setelah aplikasi siap, yaitu setelah tombol
  dan fitur alur serial (fase 6) jelas. Fase 6 boleh dimulai tanpa menunggu keduanya; jalur
  `dialog_audio = 'tts'` tetap menjadi cadangan bila uji Veo gagal nanti.

## Aturan kerja (berlaku semua fase)

- Selalu: `npm run typecheck` lalu `npm run build`.
- Uji dengan dev harness (`STUDIO_CAPTURE_PLAN`) dan folder data sementara (`STUDIO_USER_DATA`); jangan sentuh data
  dan kunci pengguna. Untuk uji data lama, pakai **salinan** database dengan tabel `secrets` dikosongkan.
- Migrasi hanya ditambahkan di akhir `MIGRATIONS`; kolom klip baru di semua tempat (AGENTS.md no. 4); IPC baru di
  tiga tempat (AGENTS.md no. 5).
- Teks UI bahasa Indonesia ("kamu"); kode dan komentar bahasa Inggris.
- Commit bergaya conventional (`feat`, `fix`, `docs`, `refactor`, `test`).
- Setiap keputusan teknis baru dicatat di `docs/keputusan-teknis.md`; `docs/data-model.md` diperbarui setiap kali
  skema berubah.

---

## Fase 1 — Fondasi episode (tanpa perubahan tampilan)

Tujuan: data proyek bertingkat serial → episode → klip, setiap episode terisolasi, proyek lama tetap identik.
UI lama tetap dipakai dan selalu membuka episode pertama.

### Tugas 1 — Migrasi database
- Tambahkan satu entri di akhir `MIGRATIONS` (`src/main/db/index.ts`) persis seperti §5 spec: kolom proyek
  (`source_text`, `source_kind`, `dialog_audio`), tabel `episodes` + isi episode 1 untuk tiap proyek lama,
  `clips.episode_id` + backfill + indeks, kolom klip drama, kolom karakter (`voice_style`, `aliases_json`), tabel
  `character_derivatives`, `locations`, `props`, kolom pemilik di `assets`, `jobs.episode_id`,
  `UPDATE projects SET dialog_audio = 'tts'` untuk proyek lama.
- Nilai `status` proyek lama sudah dicek: `ProjectStatus` = `draft | script | storyboard | editing | exported`,
  sama dengan `EpisodeStatus` minus `planned`, jadi `CASE` hanya jaring pengaman.
- Kriteria selesai: database baru dan salinan database lama sama-sama naik ke versi terbaru tanpa error; setiap
  klip punya `episode_id`; setiap proyek punya tepat satu episode.
- Berkas: `src/main/db/index.ts`.
- Ketergantungan: tidak ada.

### Tugas 2 — Tipe bersama
- `src/shared/types.ts`: tipe `Episode`, `EpisodeStatus`, `SourceKind`, `DialogAudio`, `CharacterDerivative`,
  `Location`, `Prop` (§7); kolom baru di `Clip`, `Character`, `Asset`, `Project`; `ExportOptions.episodeId`.
- `ProjectBundle` mendapat `episode: Episode` (episode aktif) dan `episodes: Episode[]` (ringkas, untuk navigasi).
  `ProjectSnapshot` mendapat `episodeId` dan editor milik episode.
- Bundle juga mendapat `derivatives`, `locations`, dan `props` (dibaca dari tabel barunya, masih kosong di fase 1)
  agar fase 2 tidak perlu mengubah bentuk bundle lagi.
- Kriteria selesai: typecheck menunjukkan semua tempat yang harus diubah (dipakai sebagai daftar kerja tugas 3–6).
- Berkas: `src/shared/types.ts`, `src/shared/api.ts`.
- Ketergantungan: tugas 1.

### Tugas 3 — Repo: episode dan isolasi klip
- `repo.ts`: `toEpisode`, `listEpisodes`, `getEpisode`, `createEpisode`, `updateEpisode`, `removeEpisode`,
  `reorderEpisodes` (mengatur `sort`; `episode_num` = nomor tertinggi + 1, tidak dipakai ulang).
- `getBundle(projectId, episodeId?)`: tanpa `episodeId` → episode terakhir dibuka (simpan di `settings`, kunci per
  proyek) atau episode pertama. Hanya klip episode itu.
- `clipsOf(projectId, episodeId)`; `toClip`, `CLIP_COLS`, upsert `saveSnapshot`, `insertClipAfter` (mewarisi
  `episode_id` klip acuan), dan `StoryClip` `Omit` mendapat kolom klip baru.
- `saveSnapshot`: `DELETE` klip dibatasi `episode_id`; `editor_json` ditulis ke episode aktif.
- `replaceScript` dan `replaceStory`: hanya klip episode yang dituju; `replaceStory` tidak lagi menghapus karakter.
- `createProject` membuat episode 1; `duplicateProject` menyalin dan memetakan ulang semua tabel dan kolom baru
  (§6.E).
- Kriteria selesai: proyek dengan 2 episode — menyimpan, menulis ulang naskah, atau menyisipkan klip di Ep 2 tidak
  mengubah jumlah dan isi klip Ep 1; duplikasi proyek menghasilkan episode dan klip dengan ID baru yang konsisten.
- Berkas: `src/main/repo.ts`.
- Ketergantungan: tugas 2.

### Tugas 4 — Pemanggil di main process
- Semua pemanggil `getBundle` / `clipsOf` (`generation.ts`, `story.ts`, `narration.ts`, `editing.ts`,
  `exporter.ts`, `ipc.ts`, `devharness.ts`) menerima dan meneruskan `episodeId`. Job baru menyimpan `episode_id`.
- `activeProjectJob` untuk narasi dan ekspor dibatasi per episode.
- Kriteria selesai: tidak ada lagi pemanggilan yang membaca klip seluruh proyek kecuali yang memang butuh
  (duplikasi, penghapusan proyek, hitungan pemakaian aset).
- Berkas: berkas di atas.
- Ketergantungan: tugas 3.

### Tugas 5 — IPC
- `episodes:list/create/update/remove/reorder`; `projects:get` menerima `episodeId` opsional.
- Tiga tempat: `handle(...)` di `ipc.ts`, tipe di `shared/api.ts`, `call(...)` di `preload/index.ts`.
- Kriteria selesai: typecheck bersih; harness bisa membuat episode kedua lewat IPC.
- Ketergantungan: tugas 3.

### Tugas 6 — Store renderer
- `store/project.ts`: bundle berisi episode aktif; snapshot mengirim `episodeId` dan editor episode; `addClip`
  mengisi `episodeId` dan nilai bawaan kolom klip baru.
- UI lama tidak diubah dan membuka episode pertama/terakhir dibuka.
- Kriteria selesai: proyek seed bisa diedit dan tersimpan seperti sebelumnya.
- Berkas: `src/renderer/src/store/project.ts` (+ pemanggil `projects.get`).
- Ketergantungan: tugas 5.

### Tugas 7 — Ekspor per episode
- `startExport(projectId, opts)` memakai `opts.episodeId`; kunci cache render bertahap mencakup `episodeId`;
  nama file bawaan `<Judul Serial> - Ep <N>.mp4` (untuk proyek 1 episode tetap judul proyek agar perilaku lama sama);
  selesai → `episodes.status = 'exported'`.
- Kriteria selesai: ekspor Ep 1 dan Ep 2 menghasilkan dua file berbeda dengan isi klip masing-masing.
- Berkas: `src/main/exporter.ts`, `src/renderer/src/pages/project/ExportDialog.tsx`.
- Ketergantungan: tugas 4.

### Tugas 8 — Dev harness dan uji
- Aksi harness baru: `{"main":"seedEpisodes"}` (proyek demo 2 episode), `{"main":"checkIsolation"}` (cetak jumlah
  klip per episode lewat `console.log` sebelum/sesudah operasi tulis di Ep 2).
- Skrip uji migrasi: salinan database proyek lama yang punya musik, overlay, dan SFX → buka, ekspor, bandingkan
  dengan ekspor sebelum migrasi (durasi video = audio, cuplikan frame dengan ffmpeg).
- Kriteria selesai: semua kriteria fase 1 di §10 spec terpenuhi.
- Berkas: `src/main/devharness.ts`, skrip JSON uji di `docs/pengembangan.md` (atau folder skrip harness yang ada).
- Ketergantungan: tugas 1–7.

### Checkpoint 1
- [ ] Typecheck dan build bersih.
- [ ] Ekspor proyek lama sebelum dan sesudah migrasi identik.
- [ ] Isolasi 2 episode terbukti lewat harness.
- [ ] `docs/data-model.md` dan `docs/keputusan-teknis.md` diperbarui.

---

## Fase 2 — Studio Hub & Lorebook (garis besar)

- **Tugas 9** — Kerangka Studio: header (pemilih episode, kredit), sidebar 200px yang bisa ciut dan otomatis ciut
  di tab Editor, buka episode/tab terakhir (§4 Kerangka).
- **Tugas 10** — Episode Hub tanpa AI: keadaan kosong, tambah/sisipkan/hapus/urutkan episode, kartu episode yang
  bisa diedit langsung dan tersimpan otomatis.
- **Tugas 11** — Lorebook karakter: grid kartu, panel detail (mengembangkan `CharacterModal.tsx`) dengan gaya suara,
  alias, "Dipakai di"; lembar karakter 3 tampak.
- **Tugas 12** — Varian kostum: CRUD, lembar dari edit lembar dasar, unggah pengganti, tanda basi bila lembar dasar
  atau perubahan tampilan berubah (§6.G).
- **Tugas 13** — Lokasi dan prop: CRUD, lembar tunggal, grid thumbnail, chip di kartu klip Storyboard.
- **Tugas 14** — Gabung dan hapus aset dengan ringkasan dampak (§6.H).
- **Tugas 15** — Home kartu serial dan modal Buat serial baru.
- **Tugas 16** — Hapus alur narasi lama (`IdeaStep.tsx`, `ScriptStep.tsx`, stepper, kode hook/babak di `story.ts`,
  IPC terkait) dan tulis ulang `docs/alur-produksi.md` serta peta kode di `AGENTS.md` (§6.F).
- **Checkpoint 2** — kriteria fase 2 di §10 spec + screenshot 1180×720 dan 1600×900, tema terang dan gelap.

## Fase 3 — Planner & naskah dua tahap (garis besar)

- **Tugas 17** — Input sumber di Episode Hub: teks/unggah, jenis sumber (novel / naskah jadi), durasi target.
- **Tugas 18** — Planner episode bertahap per jendela dengan validasi, coba ulang, progres per batch, dan
  "Lanjutkan perencanaan" (§8.A).
- **Tugas 19** — Rencana isi per episode dengan konteks episode sebelum dan sesudah serta Lorebook; usulan aset baru
  (§8.B tahap 1).
- **Tugas 20** — Tab Rencana & Tinjau: daftar shot yang bisa diedit di tempat, peringatan per shot, panel aset
  baru, kostum bawaan per tokoh (§4).
- **Tugas 21** — Konfirmasi rencana: daftarkan aset baru, tolak nama tak terdaftar, ganti klip episode dalam satu
  transaksi, dialog bahaya bila menimpa klip.
- **Tugas 22** — Tahap prompt visual: isi `visualPrompt`/`videoPrompt` hanya untuk klip yang kosong atau dipilih.
- **Checkpoint 3** — kriteria fase 3 di §10 spec (novel contoh, naskah jadi kata per kata, Ep 2 menjawab
  cliffhanger Ep 1).

## Fase 4 — Prompt, suara & generate (garis besar)

- **Prasyarat** — uji suara Veo lulus (lihat "Urutan dan ketergantungan").
- **Tugas 23** — Flag `nativeAudio` di katalog Flow2API/Higgsfield; varian penutup prompt untuk dialog; jangan
  matikan suara untuk klip dialog dari video.
- **Tugas 24** — Ekstraksi audio video menjadi aset audio klip + Whisper + `align.ts` (§6.C langkah 4).
- **Tugas 25** — Take TTS per suara untuk narator di `narration.ts`; lewati klip dialog dari video.
- **Tugas 26** — Kompilasi prompt berlabel dengan varian kostum, lokasi, prop, dan urutan gambar referensi di
  `src/shared/` (§8.C).
- **Tugas 27** — Syarat sebelum generate (§6.I) sebagai satu fungsi di `src/shared/`.
- **Tugas 28** — Hash basis dan status hasil (terkini/basi/belum ada/terblokir) + badge di Storyboard (§6.J).
- **Tugas 29** — "Buat yang belum ada", dialog estimasi batch, batch semua-atau-tidak-sama-sekali, total kredit per
  episode di header.
- **Tugas 30** — Catat perubahan keputusan teknis (audio dari video, `NO_MUSIC` varian dialog).
- **Checkpoint 4** — sampel 2 tokoh × 4 shot dialog lolos, lalu kriteria fase 4 di §10 spec.

## Fase 5 — Opsional

Diprioritaskan setelah fase 4 dipakai pada satu serial nyata: speed ramp, sambung frame antar-shot, Magic Wand,
tombol cepat gerak kamera, auto-draft 1 klik, preset subtitle kreatif, ekspor draft CapCut, storyboard grid, video
dari gambar referensi, pemeriksaan otomatis video, riwayat versi dengan rollback, lip-sync TTS lewat model
ber-`audio_url`.

## Fase 6 — Penyempurnaan alur serial

Tujuan: pengguna bisa menetapkan skala serial, memahami langkah berikutnya, dan menjalankan pekerjaan berulang
secara massal tanpa kehilangan kendali atas draf atau biaya generate.

- Dikerjakan di branch sendiri (mis. `fase-6-alur-serial`), dibuat dari branch fase 4 setelah perubahan terakhirnya
  di-commit.
- Urutan yang disarankan: **35 → 32 → 31 → 34 → 33** (dari yang kecil dan berisiko rendah ke yang terbesar).
- Setiap tugas di bawah punya bagian **Catatan kode**: temuan dari pengecekan kode 2026-11-21 yang harus dijawab
  saat tugas itu dirinci.

### Tugas 31 — Target jumlah dan durasi serial
- Tambahkan pengaturan jumlah episode yang diinginkan di Episode Hub, di samping target durasi per episode.
- Tampilkan estimasi total durasi (jumlah episode × durasi target); jika jumlah episode atau durasi diubah,
  perbarui estimasi langsung. Contoh: 3 episode × 2 menit = sekitar 6 menit.
- Teruskan jumlah episode yang diminta ke planner agar hasil perencanaan menargetkan jumlah tersebut. Jika sumber
  cerita tidak cocok dengan target, tampilkan hasil/selisihnya dan biarkan pengguna meninjau, bukan diam-diam
  mengklaim target tercapai.
- Validasi batas durasi total serial maksimal 1 jam; jelaskan cara menyesuaikan target bila jumlah × durasi
  melampaui batas.
- Periksa pilihan durasi saat ini (45–120 detik di UI, dibatasi 30–180 detik di planner) agar target baru yang
  lebih panjang dapat diatur tanpa nilai UI dan batas planner berbeda.
- Berkas utama: `src/renderer/src/pages/project/EpisodeHub.tsx`, tipe/API dan `src/main/story.ts` untuk input
  planner; migrasi hanya jika pengaturan perlu disimpan dan tidak cocok dengan kolom yang sudah ada.
- Kriteria selesai: jumlah episode dan durasi dapat diatur; estimasi total benar; planner menerima target jumlah;
  serial di atas satu jam ditolak atau diberi jalur koreksi yang jelas.
- Catatan kode:
  - Planner memecah sumber per ±9.000 karakter (`planWindows`, `PLAN_WINDOW_CHARS` di `story.ts`) dan memanggil
    LLM sekali per potongan. Target jumlah episode harus dibagi ke setiap potongan (mis. sebanding panjang
    potongan), dan mode `continue` harus tahu sisa target dari episode yang sudah tersimpan.
  - Batas durasi episode saat ini tertulis dua kali di `story.ts` (`Math.max(30, Math.min(…, 180))` untuk input dan
    untuk tiap hasil) dan UI hanya menawarkan 45–120 detik. Pindahkan batas ke satu konstanta di `src/shared/` yang
    dipakai UI dan planner.
  - Dengan maksimal 180 detik per episode, batas 1 jam = paling banyak 20 episode × 3 menit. Tentukan yang divalidasi:
    target (jumlah × durasi) sebelum planner jalan, lalu tampilkan selisih terhadap jumlah `durationSec` hasil
    planner sesudahnya.
  - `Project` belum punya tempat untuk jumlah episode target (`episodeCount` hanya ada di `ProjectSummary` dan
    berarti jumlah episode yang ada). Kemungkinan perlu migrasi kolom baru di `projects` + `docs/data-model.md`.

### Tugas 32 — Navigasi lanjut dan ringkasan progres
- Tambahkan tombol lanjut yang kontekstual di Episode Hub, termasuk **Lanjut ke Lorebook** setelah perencanaan
  episode selesai.
- Di Lorebook, sediakan aksi lanjut ke penulisan naskah setelah aset yang diperlukan ditinjau/dibuat.
- Tampilkan progres serial: episode yang direncanakan, draf naskah, sudah dikonfirmasi, aset yang belum punya
  lembar, dan gambar/video adegan yang belum dibuat.
- Berkas utama: `EpisodeHub.tsx`, `LorebookPage.tsx`, dan komponen navigasi/progres yang sudah ada.
- Kriteria selesai: pengguna selalu melihat langkah berikutnya dan progresnya; tombol membuka layar/episode yang
  tepat tanpa mengubah atau mengonfirmasi draf secara otomatis.
- Catatan kode: data progres sudah ada (`Episode.status`, `scriptDraft`, `sheetAssetId`, status hasil klip). Hitung
  lewat fungsi di `src/shared/validation.ts` (mis. `getClipImageStatus`/`getClipVideoStatus`) supaya angka ringkasan
  sama dengan badge Storyboard, bukan menghitung ulang di halaman.

### Tugas 33 — Generate lembar Lorebook secara batch
- Tambahkan aksi batch untuk lembar karakter, varian kostum, lokasi, dan prop yang belum memiliki hasil.
- Sebelum mulai, tampilkan jenis/jumlah aset, estimasi biaya yang tersedia, dan aset yang terblokir beserta
  alasannya. Jangan mulai batch jika prasyarat generate tidak terpenuhi.
- Pertahankan generate satu aset secara individual; batch tidak boleh menimpa lembar yang sudah ada kecuali
  pengguna memilih secara eksplisit untuk menyertakan hasil basi/membuat ulang.
- Ikuti pola estimasi dan pemeriksaan batch di Tugas 29, serta dukung status/progres dan pembatalan bila job
  berjalan.
- Berkas utama: `LorebookPage.tsx`, API/preload/IPC, serta generator dan estimasi aset Lorebook di
  `src/main/generation.ts`.
- Kriteria selesai: batch hanya memproses aset yang dipilih dan memenuhi prasyarat; estimasi/status sesuai dengan
  item yang dijalankan; lembar lama tidak terganti tanpa pilihan eksplisit.
- Catatan kode:
  - Varian kostum bergantung pada lembar dasar: `generateDerivativeSheet` menolak bila karakter belum punya
    `sheetAssetId`. Batch harus dua gelombang: lembar karakter dasar (plus lokasi/prop) dulu, lalu varian setelah job
    lembar dasarnya selesai. Varian yang lembar dasarnya ikut dibuat di batch yang sama tidak boleh dianggap
    terblokir.
  - Belum ada fungsi status lembar. Hash basis sudah tersimpan di `asset.meta.basisHash`
    (`compute*SheetBasisHash` di `shared/hash.ts`), tetapi status basi hanya dihitung di `LorebookPage.tsx` dan hanya
    untuk varian. Tambahkan fungsi status lembar (terkini/basi/belum ada/terblokir) di `shared/validation.ts`, setara
    `getClipImageStatus`, dan pakai di halaman dan batch.
  - `planBatch`/`batchEstimate` di `generation.ts` masih khusus klip; buat versi untuk aset Lorebook atau jadikan
    generik. Pembatalan bisa memakai `jobs.cancelProject(projectId, 'sheet')`.

### Tugas 34 — Buat draf naskah untuk semua episode
- Tambahkan tombol **Buat semua naskah** di sebelah kanan judul daftar episode di Episode Hub.
- Buat draf hanya untuk episode yang belum memiliki draf/klip naskah; jangan menimpa draf atau klip yang sudah
  ada tanpa persetujuan eksplisit.
- Jalankan secara berurutan, tampilkan episode/progres yang sedang dikerjakan, dan laporkan episode yang gagal
  agar pengguna bisa mencoba lagi.
- Aksi ini hanya membuat draf untuk ditinjau; tidak mengonfirmasi rencana, mendaftarkan usulan aset, atau
  mengganti klip secara otomatis.
- Berkas utama: `EpisodeHub.tsx`, `src/main/story.ts`, dan API/preload/IPC jika diperlukan untuk orkestrasi batch.
- Kriteria selesai: draf dibuat untuk episode yang memenuhi syarat; episode yang sudah ada tetap utuh; kegagalan
  satu episode tidak menghapus atau mengganti hasil episode lain.
- Catatan kode:
  - `planEpisodeScript` selalu menimpa `scriptDraft` (`updateEpisode(episodeId, { scriptDraft: draft })`). Syarat
    "belum punya draf" dicek di main, bukan hanya di UI: episode berstatus `planned`, `scriptDraft` kosong, dan tanpa
    klip.
  - Fungsi ini memanggil LLM langsung, tidak lewat sistem job, jadi tidak bisa dibatalkan dengan `jobs.cancel`.
    Pilih: orkestrasi berurutan di renderer dengan tombol "Berhenti setelah episode ini", atau fungsi batch baru di
    main dengan `AbortSignal`.
  - Draf episode N membaca episode sebelum dan sesudahnya, jadi urutan berurutan (bukan paralel) memang wajib.

### Tugas 35 — Hapus semua episode
- Tambahkan tombol **Hapus semua episode** di sebelah kanan judul daftar episode.
- Gunakan dialog konfirmasi bahaya yang menyebut bahwa seluruh episode dan klipnya akan dihapus, tetapi sumber
  cerita dan Lorebook tetap dipertahankan.
- Tangani episode aktif dan job yang sedang berjalan dengan aman; muat ulang state setelah penghapusan dan
  tampilkan keadaan kosong yang menawarkan mulai lagi.
- Berkas utama: `EpisodeHub.tsx` dan API/repo hanya jika operasi hapus massal belum dapat dilakukan dengan aman
  melalui mekanisme penghapusan episode yang ada.
- Kriteria selesai: setelah konfirmasi semua episode/klip hilang, Lorebook dan sumber serial tetap ada, dan UI
  kembali ke keadaan kosong; batal tidak mengubah apa pun.
- Catatan kode: mekanisme yang ada tidak cukup, perlu fungsi repo baru (mis. `removeAllEpisodes`) dalam satu
  transaksi.
  - `removeEpisode` hanya `DELETE FROM episodes`; klip ikut terhapus lewat `ON DELETE CASCADE`, tetapi setting
    `plan_progress:<projectId>` tertinggal sehingga "Lanjutkan perencanaan" mengira sumber sudah tercakup.
    `clearEpisodesForReplan` membersihkannya, tetapi menolak bila ada klip.
  - `assets.episode_id` dan `jobs.episode_id` tidak punya foreign key. Batalkan job proyek yang berjalan
    (`cancelProject`) sebelum menghapus, dan putuskan nasib aset gambar/video/suara klip yang tertinggal (hapus file
    atau biarkan) — catat keputusannya di `docs/keputusan-teknis.md`.
  - Proyek baru selalu dibuat dengan "Episode 1". Periksa store, editor, ekspor, dan devharness tetap aman saat
    proyek tanpa episode sama sekali (store `removeEpisode` sudah menangani daftar kosong; bagian lain belum).

- **Checkpoint 6** *(Selesai 2026-11-21)* — typecheck/build bersih; dev harness memakai `STUDIO_USER_DATA` sementara; verifikasi target
  durasi, navigasi, batch Lorebook, pembuatan draf massal, dan penghapusan massal termasuk batal, kegagalan, serta
  episode yang sudah memiliki hasil.

## Risiko

| Risiko | Dampak | Penanganan |
|---|---|---|
| Veo menghasilkan dialog bahasa Indonesia yang buruk atau tanpa suara lewat Flow2API | Fase 4 berubah arah | Uji sebelum fase 4; jalur `dialog_audio = 'tts'` sudah ada di desain |
| Migrasi merusak timeline proyek lama | Data pengguna rusak | Uji salinan database nyata di tugas 1 dan 8 sebelum merge |
| Pemanggil yang lupa dibatasi per episode | Klip episode lain terhapus | Typecheck sebagai daftar kerja (tugas 2) + harness `checkIsolation` |
| Sidebar membuat editor sesak di 1180×720 | Editor sulit dipakai | Sidebar otomatis ciut di tab Editor (tugas 9) |
| Batch generate menguras kredit | Biaya tak terduga | Estimasi kredit dan batch semua-atau-tidak-sama-sekali (tugas 29) |
| Target jumlah/durasi tidak sesuai panjang sumber | Hasil perencanaan meleset dari ekspektasi | Tampilkan estimasi dan selisih; jangan menyatakan target tercapai bila planner menghasilkan jumlah berbeda |
| Aksi massal menimpa draf/hasil atau menghapus data yang salah | Kehilangan pekerjaan pengguna | Draf massal hanya mengisi yang kosong; hapus semua meminta konfirmasi dan mempertahankan Lorebook/sumber |
