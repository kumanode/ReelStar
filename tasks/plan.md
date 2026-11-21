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

Diprioritaskan setelah fase 4 dipakai pada satu serial nyata: speed ramp, Magic Wand,
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

## Fase 7 — Lorebook otomatis, shot lebih rinci, dan arahan yang bisa diedit

Tujuan: setelah episode direncanakan, tokoh/lokasi/prop sudah tersedia untuk ditinjau sehingga kreator di Lorebook
tinggal membuat gambar; data shot cukup rinci untuk gambar, video, dan dialog yang konsisten; kreator bisa
mengarahkan gaya AI tanpa menulis ulang prompt di setiap layar.

- Dasar: analisa 2026-11-21 (keluhan pengguna + perbandingan dengan huobao-drama, drama-skills, dramaclaw,
  LocalMiniDrama, short-drama-factory, Jellyfish, ViMax). Yang diambil hanya **ide alur**; huobao-drama
  (CC BY-NC-SA) dan dramaclaw (Elastic 2.0) tidak boleh disalin kodenya.
- Dikerjakan di branch sendiri (mis. `fase-7-lorebook-shot`) dari `fase-6-alur-serial` setelah fase 6 di-merge.
- Urutan: **36 → 37 → 38 → 39 → 40 → 41 → 42 → 43**. Tugas 36 murni tampilan dan bisa dikerjakan lebih dulu
  secara terpisah.
- Prinsip yang dibawa dari fase 6: AI tidak pernah menyimpan atau menimpa data kreator tanpa langkah tinjau; aksi
  berbiaya selalu menampilkan estimasi dulu.
- Di luar cakupan: infinite canvas, previz 3D, cerita bercabang (alur ReelStar tetap linear).

### Tugas 36 — Rapikan Buat Serial Baru, target episode, dan kartu sumber
- Modal "Buat Serial Baru" (`Home.tsx`): pakai `EPISODE_DURATION_OPTIONS` dari `shared/validation.ts` (hapus dua
  daftar durasi lokal), tambahkan target jumlah episode + total estimasi + peringatan 1 jam (logika sama dengan
  Episode Hub, ditulis sekali di `shared/`), tambahkan jenis sumber (Novel/Naskah Jadi) dan kolom/unggah teks
  sumber opsional.
- Perbaiki klaim premis: planner hanya membaca teks sumber. Pilih satu dan catat di `docs/keputusan-teknis.md`:
  (a) premis tanpa sumber boleh direncanakan — planner memakai premis sebagai bahan cerita; atau (b) teks bantuan
  diubah dan Hub meminta teks sumber. Rekomendasi: (a), karena serial dari ide satu kalimat adalah alur umum.
- Ganti dropdown target episode (21 opsi, kotak cari muncul otomatis, menu selebar tombol 128 px) dengan input
  angka −/+ (1–20) dan sakelar "Otomatis". Bila tetap `Select`, minimal `searchable={false}` + `menuWidth`.
- Kartu "Sumber & Target" selalu tampil di Episode Hub; hanya kotak teks sumbernya yang bisa dilipat. Target,
  durasi, total estimasi, dan tombol Rencanakan tidak boleh ikut tersembunyi.
- Berkas utama: `Home.tsx`, `EpisodeHub.tsx`, `shared/validation.ts`, `story.ts` (bila opsi a).
- Kriteria selesai: serial baru bisa diberi target dan sumber sejak awal; nilai modal dan Hub sama; dropdown tidak
  terpotong di 1180×720; pengaturan perencanaan selalu terlihat.

### Tugas 37 — Ekstraksi Lorebook dan character bible
- Langkah baru "Siapkan Lorebook": AI membaca seluruh sumber (per potongan seperti planner) dan episode yang sudah
  direncanakan, lalu menghasilkan **kandidat** tokoh, varian kostum per episode, lokasi, dan prop. Nama yang sama
  atau alias digabung (dedup) sebelum ditampilkan.
- Kolom terstruktur:
  - Tokoh — visual: usia, gender, ciri wajah, rambut, postur, pakaian bawaan, ciri khas; naratif: peran,
    keinginan, rahasia, perkembangan, ciri cara bicara; suara: gaya suara (dipakai TTS/Veo).
  - Varian kostum — **frasa kunci kostum**: satu kalimat tetap yang ditempel apa adanya ke setiap prompt shot
    (menguatkan `promptChange`), plus episode tempat varian dipakai.
  - Lokasi — jenis tempat, waktu/pencahayaan bawaan, suasana, detail tetap. Prop — bentuk, bahan, status.
- Tinjau kandidat: terima, gabung ke entri yang ada, atau abaikan (pola tinjau usulan aset di Rencana & Tinjau).
  Tidak ada yang tersimpan tanpa diterima.
- Pemicu: tombol "Lanjut ke Lorebook" menjalankan ekstraksi bila Lorebook masih kosong; di Lorebook ada tombol
  "Perbarui dari cerita" yang hanya menambah kandidat baru. Berjalan sebagai proses dengan progres dan bisa
  dibatalkan.
- Prompt lembar referensi (`sheetPrompt`, `derivativeSheetPrompt`) disusun dari kolom terstruktur dan tetap bisa
  diedit; hash basis lembar ikut kolom baru agar lembar lama jadi basi.
- Naskah shot (`planEpisodeScript`) memakai character bible (ciri cara bicara, gaya suara) dan frasa kunci kostum.
- Berkas utama: `story.ts` (ekstraksi), `repo.ts` + migrasi (kolom profil), `shared/types.ts`, `shared/hash.ts`,
  `generation.ts` (prompt lembar), `LorebookPage.tsx` (form + tinjau kandidat), `EpisodeHub.tsx`, IPC 3 tempat.
- Catatan kode: tokoh kini hanya punya `description` bebas. Simpan profil sebagai satu kolom JSON per tabel
  (`profile_json`) agar migrasi kecil; `description` tetap terbaca untuk proyek lama dan diisi sebagai ringkasan.
- Kriteria selesai: dari novel contoh, Lorebook terisi kandidat yang bisa ditinjau; tidak ada duplikat untuk nama
  + alias yang sama; menerima kandidat lalu "Buat semua lembar" langsung bisa jalan tanpa mengetik prompt.

### Tugas 38 — Skema shot diperluas dan dialog lebih tepat
- Kolom shot baru di draf dan klip: gerak kamera + alasannya, keadaan awal dan akhir, pencahayaan/waktu, posisi dan
  arah pandang pemain (blocking), reaksi tokoh yang tidak bicara, SFX/ambien, cara penyampaian ucapan (terpisah
  dari emosi).
- Jenis teks: dialog di layar, suara dari luar layar (O.S.), monolog batin (V.O. tokoh), dan narasi. Klip O.S./V.O.
  tidak mewajibkan pembicara terlihat dan diarahkan ke TTS, bukan lip-sync Veo.
- Batas kata per durasi: konstanta di `shared/` (sekitar 2,5–3 kata/detik bahasa Indonesia) dan batas panjang
  video model. Draf yang melanggar ditandai di Rencana & Tinjau dengan saran memecah shot; tidak dipotong diam-diam.
- `compileClipPrompt`/`compileClipVideoPrompt` memakai kolom baru (kamera, framing, blocking, pencahayaan); prompt
  cadangan "camera slowly pushes in" diganti prompt dari data shot. Hash basis ikut berubah.
- UI: kolom baru tampil ringkas di kartu Rencana & Tinjau dan Inspector Storyboard (bagian "Detail shot" yang bisa
  dilipat).
- Berkas utama: `story.ts` (`SCRIPT_DRAFT_SCHEMA`, prompt sistem), `shared/types.ts` (`DraftShot`, `Clip`),
  `shared/prompts.ts`, `shared/validation.ts`, `repo.ts`, `PlanStep.tsx`, `StoryboardStep.tsx`.
- Catatan kode: kolom klip baru wajib di semua tempat (AGENTS.md no. 4). Pertimbangkan satu kolom JSON
  `shot_detail_json` untuk mengurangi titik sentuh; tetap ikuti daftar itu (tipe, migrasi, `toClip`,
  `saveSnapshot`, `duplicateProject`, `insertClipAfter`, `CLIP_COLS`, `addClip`).
- Kriteria selesai: draf baru berisi kolom kamera/pencahayaan/blocking; prompt video berbeda antar shot sesuai data;
  ucapan terlalu panjang ditandai; klip O.S. tidak diblokir karena pembicara tak terlihat.

### Tugas 39 — Dokter naskah sebelum konfirmasi
- Pemeriksaan draf naskah per episode: aturan tetap (tanpa AI) dulu — hook di shot pertama, cliffhanger di shot
  terakhir, ucapan terlalu panjang, tokoh/varian/lokasi yang tidak ada di Lorebook, kostum berganti tanpa alasan,
  durasi total vs target episode; lalu opsi "Periksa dengan AI" untuk ritme dan kontinuitas antar-episode.
- Hasil berupa kartu masalah bertingkat (wajib/disarankan/catatan) dengan tombol lompat ke shot. Kreator tetap bisa
  konfirmasi walau ada catatan; masalah "wajib" meminta konfirmasi tambahan.
- Indikator ritme episode: bar per shot diwarnai durasi dan ukuran shot.
- Berkas utama: `shared/` (aturan pemeriksaan, dipakai renderer dan dev harness), `story.ts` (opsi AI),
  `PlanStep.tsx`.
- Kriteria selesai: draf contoh dengan ucapan panjang dan tokoh tak terdaftar memunculkan kartu yang tepat; tidak
  ada perubahan draf otomatis.

### Tugas 40 — Arahan serial dan template prompt
- **Arahan serial** (pengaturan proyek): catatan sutradara yang ikut ke planner, naskah, ekstraksi Lorebook, prompt
  gambar, dan prompt video. Contoh: era, budaya, palet warna, aturan busana.
- **Template per tahap** yang bisa diganti dan dikembalikan ke bawaan: planner episode, naskah shot, ekstraksi
  Lorebook, lembar referensi, prompt gambar, prompt video, dokter naskah. Disimpan per proyek (bawaan aplikasi tetap
  di kode). Variabel wajib (mis. sumber, daftar Lorebook) divalidasi sebelum disimpan; skema JSON keluaran tetap di
  kode dan tidak bisa diedit.
- Perubahan arahan/template menandai hasil terkait sebagai basi lewat hash basis, tidak membuat ulang otomatis.
- Berkas utama: `story.ts`, `shared/prompts.ts`, `shared/hash.ts`, `repo.ts` + migrasi, halaman pengaturan proyek.
- Kriteria selesai: arahan serial terlihat efeknya di prompt gambar/video; template rusak ditolak dengan pesan yang
  jelas; "kembalikan ke bawaan" bekerja.

### Tugas 41 — Pusat tugas
- Panel tugas global: job berjalan/antre/gagal/selesai per proyek dengan progres, durasi, pesan error, tombol batal,
  coba ulang yang gagal (satuan dan semua), dan lompat ke shot/aset/episode asal.
- Termasuk proses non-job (draf massal, ekstraksi Lorebook) agar semua pekerjaan panjang terlihat di satu tempat.
- Berkas utama: komponen baru di `renderer/src/components`, `App.tsx` (listener event job sudah ada di sana),
  `jobs.ts`, IPC untuk coba ulang.
- Kriteria selesai: batch lembar dan video terlihat di panel; job gagal bisa diulang tanpa mengulang yang sukses.

### Tugas 42 — Lanjutkan semua (pipeline bertahap)
- Satu aksi per episode atau serial: naskah → konfirmasi (tetap manual) → prompt → gambar → video → suara, yang
  melewati hasil yang sudah ada, berhenti di setiap langkah berbiaya untuk konfirmasi estimasi, dan bisa dilanjutkan
  setelah gagal/batal.
- Memakai fungsi batch yang sudah ada (`generateMissingImages`, `generateMissingVideos`, narasi), bukan jalur baru.
- Berkas utama: `EpisodeHub.tsx`/`StudioHeader.tsx`, orkestrasi di main, Pusat tugas (Tugas 41).
- Kriteria selesai: episode setengah jadi bisa dilanjutkan tanpa mengulang langkah yang sudah selesai; tidak ada
  langkah berbiaya yang jalan tanpa konfirmasi.

### Tugas 43 — Sambung frame terakhir antar-shot (dipindah dari fase 5)
- Opsi per shot "lanjut dari shot sebelumnya": frame terakhir video shot sebelumnya dipakai sebagai frame awal (atau
  referensi) shot berikutnya, hanya untuk model yang mendukung; sumber frame masuk hash basis sehingga shot
  berikutnya basi bila video sebelumnya diganti.
- Berkas utama: `generation.ts` (ambil frame dengan FFmpeg), `shared/higgsfield.ts` + katalog Flow2API (dukungan
  model), `shared/validation.ts`, `StoryboardStep.tsx`.
- Kriteria selesai: dua shot berurutan dengan opsi aktif memakai frame terakhir yang benar; mengganti video
  sebelumnya menandai shot berikutnya basi.

- **Checkpoint 7** — typecheck/build bersih; dev harness (`STUDIO_USER_DATA` sementara) menguji: dedup kandidat
  Lorebook, migrasi profil pada salinan database lama, kolom shot baru di prompt, batas kata per durasi, aturan
  dokter naskah, template rusak ditolak, dan basi akibat arahan/template/frame sebelumnya; screenshot modal Home,
  Hub, Lorebook (tinjau kandidat), Rencana & Tinjau, dan Pusat tugas di 1180×720 terang dan gelap.

## Fase 8 — Kontinuitas, referensi per shot, pengiriman, dan pengaturan global

Tujuan: wajah, kostum, dan prop tetap sama antar-shot dan antar-episode; kreator bisa melihat dan mengatur referensi
setiap shot; hasil ekspor siap diunggah ke platform tujuan tanpa diolah ulang; penyedia dan model AI diatur sekali
di Pengaturan dan berlaku untuk semua proyek.

- Dasar: [rencana referensi drama short](../docs/superpowers/plans/2026-11-21-referensi-drama-short.md)
  (huobao-drama, drama-skills, awesome-short-drama-skills, dramaclaw, LocalMiniDrama, dramaxis,
  short-drama-factory), ditambah tinjauan kode 2026-11-21. Seperti fase 7, yang diambil hanya **ide alur**.
- Yang **tidak** diulang di sini karena sudah tercakup fase 7: pemetaan `shot_detail` (Tugas 38), panel Dokter
  Naskah dan strip ritme (Tugas 39), pusat tugas dan coba ulang yang gagal (Tugas 41). Sisa dan bug dari dua tugas
  pertama dikumpulkan di Tugas 44.
- Dikerjakan di branch sendiri (mis. `fase-8-kontinuitas`) setelah fase 7 di-merge.
- Pengaturan global (Tugas 53–58) dirinci di [setting.md](setting.md); di sini hanya ringkasan dan kriteria.
- Urutan: **44 → 54 → 45 → 46 → 47 → 48**, lalu 55 → 56 → 57 → 58. Tugas 54 (resolver penyedia/model) dikerjakan
  sebelum 45 dan 48 karena ketiganya mengubah `shared/hash.ts` dan `generation.ts`; dengan begitu hash hasil hanya
  berubah polanya sekali dan lock/referensi langsung memakai model dari resolver. Tugas 53 murni tampilan dan boleh
  dikerjakan kapan saja. Tugas 49–52 tidak saling bergantung dan boleh dikerjakan kapan saja setelah 44. Tugas 49
  menyentuh ekspor, jadi diuji paling akhir.
- Setiap input baru yang memengaruhi prompt harus ikut mengubah hash basis. Uji wajibnya: mengubah input itu membuat
  hasil lama menjadi `stale`, bukan tetap `current`.

### Tugas 44 — Rapikan sisa Tugas 38–39
- Select tipe dialog di `PlanStep.tsx` memakai nilai bawaan `'spoken'`, padahal nilai itu tidak ada di
  `DialogueType` (`dialogue|os|vo|narration`). Nilai bawaan harus diambil dari pembicara: ada pembicara → `dialogue`,
  hanya teks → `narration`. Pakai logika yang sama dengan `cleanShots`, ditulis sekali di `shared/`.
- `cleanShots` (`story.ts`) selalu mengisi `shotDetail` dengan string kosong. Simpan hanya kunci yang berisi supaya
  draf dan `shot_detail_json` tetap ringkas, dan supaya badge "Terisi" tidak menyala karena data kosong.
- Dokter Naskah (`shared/validation.ts`):
  - `UNREGISTERED_SPEAKER` dan aturan "pembicara harus terlihat" hanya berlaku untuk `dialogueType === 'dialogue'`.
    O.S., V.O., dan narasi tidak butuh tokoh di layar.
  - `WEAK_HOOK` tidak boleh lolos hanya karena shot pertama punya teks. Shot itu harus punya aksi visual atau emosi.
- Prompt video (`compileClipVideoPrompt`): shot O.S./V.O. tidak boleh meminta gerak bibir, dan di mode
  `dialog_audio = 'video'` shot seperti itu diarahkan ke TTS (sesuai kriteria Tugas 38).
- Jalur trim `compileClipPrompt` (dipakai saat prompt melebihi `promptLimit`) sekarang membuang pencahayaan,
  blocking, props, emosi, dan framing. Urutkan prioritasnya: identitas, kostum, dan lokasi dipertahankan paling
  akhir, dan detail sutradara dipotong lebih dulu daripada identitas.
- Berkas utama: `story.ts`, `shared/validation.ts`, `shared/prompts.ts`, `PlanStep.tsx`.
- Kriteria selesai: draf dengan shot V.O. tidak memicu peringatan pembicara; Select tipe dialog selalu menampilkan
  salah satu opsinya; prompt model dengan `promptLimit` kecil tetap memuat identitas tokoh dan kostum.

### Tugas 45 — Kunci kontinuitas (lock words)
- Frasa identitas yang ditempel **apa adanya** ke setiap prompt gambar dan video: ciri wajah/rambut tokoh, frasa
  kunci kostum (`costumeKeyphrase` dari Tugas 37), ciri tetap lokasi, bentuk/bahan prop, ditambah frasa manual.
  Setiap frasa punya `id`, `label`, `text`, `source`, dan `enabled`.
- Disimpan per serial (`series_lock_json` di `projects`) dan per episode (`lock_words_json` di `episodes`).
  Keduanya migrasi baru di akhir `MIGRATIONS`.
- `shared/lock.ts`: `buildLockWords`, `renderLockBlock`, `checkLockCompliance`. Blok `LOCKED (keep verbatim): ...`
  ditaruh setelah scene dan sebelum art style, di `compileClipPrompt` dan `compileClipVideoPrompt`, **termasuk jalur
  trim**. Lock yang tetap terpotong dilaporkan sebagai peringatan di Storyboard, bukan pemblokir.
- Hash: karena hash gambar/video dibangun dari prompt hasil kompilasi, lock otomatis ikut. Tetap uji bahwa mengubah
  satu lock membuat hasil `stale`.
- UI: panel kunci di Lorebook (tingkat serial) dan di Rencana & Tinjau (tingkat episode); frasa otomatis bisa
  dimatikan, tidak dihapus.
- Berkas utama: migrasi + `repo.ts`, `shared/lock.ts`, `shared/prompts.ts`, `shared/types.ts`, `LorebookPage.tsx`,
  `PlanStep.tsx`, `StoryboardStep.tsx`, IPC 3 tempat bila perlu.
- Kriteria selesai: semua prompt gambar/video memuat blok LOCKED; mengubah lock menandai hasil terkait basi; proyek
  lama tanpa lock tetap berjalan.

### Tugas 46 — Aturan ritme Dokter Naskah
- Aturan tetap baru (tanpa AI):
  - `DIALOGUE_RUN_TOO_LONG`: lebih dari 6 shot dialog berturut-turut tanpa shot aksi/reaksi.
  - `VISUAL_ANCHOR_MISSING`: 4 shot dialog berturut-turut tanpa satu pun shot aksi/reaksi sebagai jangkar visual.
  - `CLIFFHANGER_UNRESOLVED`: Ep N tidak membuka dengan jawaban cliffhanger Ep N−1. Tambah parameter opsional
    `previousEpisode` agar pemanggil lama tidak pecah. Mulai sebagai `info`, karena pencocokan teks tidak pasti.
- Four-beat (hook / konfrontasi / pembalikan / aftermath, diskalakan ke durasi target episode): tambahkan kolom
  `beat` ke skema shot planner, lalu periksa dari label itu. Tanpa label, aturan ini cukup `info`, supaya tidak
  menghasilkan false positive dari tebakan kata kunci.
- Tombol perbaikan tanpa AI di kartu masalah: "Perpanjang durasi" (durasi = ceil(kata ÷ konstanta kata/detik di
  `shared/`)) dan "Bagi jadi 2 shot". Perbaikan dengan AI dipisahkan, diberi tanda biaya, dan tidak berjalan sendiri.
- Berkas utama: `shared/validation.ts`, `story.ts` (kolom `beat`), `PlanStep.tsx`.
- Kriteria selesai: draf 8 shot close-up dialog memicu aturan ritme; narator dan V.O. tidak memicu peringatan
  pembicara; tombol perbaikan mengubah draf hanya saat diklik.

### Tugas 47 — Catatan kontinuitas lintas episode
- Tabel `continuity_items`: `id, project_id, kind (foreshadow|prop|rule|relationship), name, detail,
  status (open|paid|dropped), tier (hot|cold), planted_episode_id, payoff_episode_id, created_at`.
- Tab "Kontinuitas" di Lorebook atau Episode Hub: daftar item terbuka, umurnya (berapa episode), dan tombol
  "Dibayar di episode ini".
- Planner (`planEpisodeScript`) menerima item terbuka yang jatuh tempo beserta instruksi menutupnya. Item usulan AI
  masuk sebagai kandidat yang ditinjau dulu, mengikuti pola Tugas 37.
- Dokter Naskah: `CONTINUITY_OPEN_TOO_LONG` (item hot terbuka lebih dari 3 episode), `PAYOFF_MISSING`, dan
  `PROP_VANISHED`. Dua aturan terakhir berbasis pencocokan teks, jadi mulai sebagai `info`.
- Berkas utama: migrasi + `repo.ts`, `shared/types.ts`, IPC 3 tempat, `story.ts`, `shared/validation.ts`,
  `LorebookPage.tsx`/`EpisodeHub.tsx`; `docs/data-model.md`.
- Kriteria selesai: item yang ditanam di Ep 1 muncul di konteks planner Ep 3; menandai dibayar menutup item; tidak
  ada item yang tersimpan tanpa ditinjau.

### Tugas 48 — Referensi per shot
- Kolom klip `reference_asset_ids_json`: `null` berarti otomatis (perilaku `collectReferenceSheets` sekarang), isi
  berarti override yang tetap dipotong ke `maxRefs(model)`. Kolom klip baru wajib ditambahkan di semua tempat
  (AGENTS.md no. 4).
- UI chip referensi di Inspector/Storyboard dengan urutan tokoh/kostum → lokasi → prop, tombol lepas, dan
  "Unggah referensi" (aset `image` dengan `clipId`).
- `resolveReferenceUrls` (`generation.ts`) memakai override bila ada. Hash sudah memuat `refSheetAssetIds`, jadi
  cukup pastikan nilainya diambil dari daftar override, bukan hasil pilih otomatis.
- Berkas utama: migrasi + `repo.ts`, `shared/types.ts`, `generation.ts`, `shared/hash.ts`, `Inspector.tsx`,
  `StoryboardStep.tsx`, `store/project.ts`.
- Kriteria selesai: melepas satu referensi menandai gambar basi; generate ulang memakai urutan baru, dan prompt di
  `assets.prompt` menyebut urutan yang sama.

### Tugas 49 — Preset platform ekspor
- `shared/exportPresets.ts` dengan `{ id, label, w, h, fps, bitrateKbps, maxDurationSec?, note }`. Mulai dari
  TikTok, Reels, Shorts (1080×1920), YouTube dan Facebook (1920×1080), serta Kustom. Preset pasar China (Douyin,
  Kuaishou, Bilibili, RED) ditunda.
- `ExportOptions` mendapat kolom opsional `presetId`, `videoBitrateKbps`, dan `maxDurationSec` supaya payload lama
  tetap valid. Exporter: bila ada bitrate, pakai `-b:v`/`-maxrate`/`-bufsize`; bila tidak, tetap CRF seperti
  sekarang. Estimasi ruang disk memakai bitrate preset.
- **Untuk sekarang hanya preset dengan rasio yang sama dengan proyek.** Rasio berbeda (mis. 3:4 dari proyek 9:16)
  butuh crop/pad. Itu perubahan filter graph yang harus ditulis di `shared/` dan ikut tampil di pratinjau (AGENTS.md
  no. 1), jadi dijadikan tugas terpisah bersama matte blur 9:16 untuk proyek 16:9.
- UI: grid preset (bukan `<select>`) yang menampilkan perkiraan ukuran file, fps, dan peringatan bila durasi
  melewati `maxDurationSec` (mis. "video 78 dtk melewati batas 60 dtk Shorts").
- Jangan mengubah `planSegments` atau transisi.
- Berkas utama: `shared/exportPresets.ts`, `shared/types.ts`, `exporter.ts`, `ExportDialog.tsx`.
- Kriteria selesai: ekspor demo dengan preset Shorts dan YouTube dicek dengan `ffprobe` (ukuran, fps, bitrate) dan
  selisih durasi video vs audio di bawah 100 ms.

### Tugas 50 — Versi naskah dan rollback (dari fase 5)
- Tabel `script_versions(id, episode_id, draft_json, note, created_at)`. Versi disimpan setiap kali planner
  menghasilkan draf dan setiap konfirmasi, maksimal 20 per episode (yang terlama dibuang).
- Rencana & Tinjau: daftar versi (komponen `Select`) dan tombol "Pulihkan". Memulihkan versi hanya mengganti draf;
  klip yang sudah dikonfirmasi tidak ikut berubah.
- Berkas utama: migrasi + `repo.ts`, `shared/types.ts`, IPC 3 tempat, `PlanStep.tsx`.
- Kriteria selesai: membuat draf ulang lalu memulihkan versi lama mengembalikan isi draf persis.

### Tugas 51 — Aksi grup di Storyboard
- Mode pilih beberapa shot (kotak centang di kartu), lalu aksi "Gambar ulang", "Video ulang", dan "Suara ulang".
  Aksi ini memakai fungsi batch yang sudah ada (`generateClipsVideo`, `generateMissingImages`, TTS), bukan jalur baru.
- Modal estimasi gabungan sebelum jalan; progres dan pembatalan lewat Pusat tugas (Tugas 41).
- Penyedia tanpa id job yang bisa dilacak (Flow2API) ditandai "tidak bisa dilanjutkan" dan ditawarkan untuk
  diulang. Jangan berpura-pura bisa melanjutkan.
- Berkas utama: `StoryboardStep.tsx`, IPC bila perlu orkestrasi baru.
- Kriteria selesai: tiga shot terpilih diproses dengan satu konfirmasi biaya; shot yang tidak dipilih tidak
  tersentuh.

### Tugas 52 — Paket kirim
- Setelah MP4 selesai, opsi menulis `manifest.json` (durasi, resolusi, fps, daftar aset, versi naskah, hash file),
  `checksums.txt`, dan SRT bila dipilih, lalu menggabungkannya menjadi satu zip.
- Tanpa dependensi baru: Windows 10/11 sudah punya `tar.exe` yang bisa membuat zip (`tar -a -c -f paket.zip ...`).
- Berkas utama: modul baru `src/main/package.ts`, `ExportDialog.tsx`.
- Kriteria selesai: zip berisi MP4, manifest, dan checksum yang cocok dengan file.

### Tugas 53 — Pengaturan: kerangka tiga kolom
- Pecah `pages/Settings.tsx` (821 baris) menjadi `pages/settings/`: shell + sidebar berkelompok (Penyedia, Aktif,
  Sistem), rail penyedia per peran dengan status, dan panel detail. `KeyForm` dipindah tanpa mengubah perilaku.
- `Route` settings mendapat `section` dan `provider`. Data model belum berubah.
- Pola dari ArcReel (AGPL-3.0) hanya ditiru idenya, kodenya tidak disalin.
- Kriteria selesai: simpan/tes/hapus kunci tetap berfungsi; tidak terpotong di 1180×720.
- Rincian: [setting.md, Tugas 1](setting.md#tugas-1--kerangka-tiga-kolom-tanpa-mengubah-data-model).

### Tugas 54 — Katalog penyedia dan resolver global
- `shared/providers.ts`: `ProviderDef` (dengan `protocol`), `PRESET_PROVIDERS`, dan `resolveActive(settings,
  purpose)` sebagai **satu-satunya** penentu penyedia/model, dipakai main dan renderer.
- Semua setting penyedia dan model menjadi global. `projects.tts_provider`, `image_model`, `video_model` dibiarkan di
  skema tetapi tidak dibaca lagi (tanpa migrasi). Suara narator dan suara tokoh tetap per proyek/tokoh; suara milik
  penyedia lain dilewati dan dipakai suara bawaan.
- Hapus tebakan `includes('/')` di `generation.ts` dan semua pemakaian `defaultVisualProvider` (main dan renderer).
  Hash basis gambar/video/lembar memakai model dari `resolveActive`.
- Normalisasi setting lama di `getSettings()`; endpoint `custom` lama menjadi entri penyedia custom dengan id sama.
- Kriteria selesai: salinan database lama memuat kunci dan pilihan yang sama; mengganti model gambar global
  menandai gambar proyek lama `stale`; `includes('/')` dan `defaultVisualProvider` tidak ada lagi di `src/`.
- Rincian: [setting.md, Tugas 2](setting.md#tugas-2--katalog-penyedia-di-shared).

### Tugas 55 — Penyedia custom (LLM)
- Tambah, ubah, dan hapus penyedia custom berprotokol OpenAI-compatible. Suara/gambar/video custom ditunda karena
  belum ada protokolnya.
- IPC baru di tiga tempat; validasi id unik (slug `custom` dipesan), URL `http`/`https`; hapus penyedia ikut
  menghapus kunci dan memindahkan penyedia aktif bila perlu.
- Kriteria selesai: dua penyedia custom bertahan setelah restart; menghapus tidak menyisakan kunci atau id
  menggantung.
- Rincian: [setting.md, Tugas 3](setting.md#tugas-3--penyedia-custom-llm-bisa-ditambah-dan-dihapus).

### Tugas 56 — Halaman Model aktif
- Penyedia + model aktif untuk Cerita, Suara, serta Gambar & video (slot gambar dan video), disimpan per penyedia.
- Mengganti penyedia/model gambar atau video meminta konfirmasi: hasil di semua serial ditandai basi, tidak dibuat
  ulang.
- `ModelSection.tsx` di proyek menjadi ringkasan baca-saja dengan tautan "Ubah di Pengaturan". Daftar suara narator
  dan tokoh mengikuti penyedia TTS aktif; tokoh yang suaranya milik penyedia lain diberi tanda.
- Kriteria selesai: perubahan berlaku di semua proyek; berpindah penyedia lalu kembali memulihkan model sebelumnya.
- Rincian: [setting.md, Tugas 4](setting.md#tugas-4--halaman-model-aktif).

### Tugas 57 — Status dan penanda masalah di Pengaturan
- Sidebar menandai peran tanpa penyedia terhubung; badge rail dan detail memakai `KeyStatus` yang sama dan berubah
  langsung setelah tes atau kunci dicabut.
- Rincian: [setting.md, Tugas 5](setting.md#tugas-5--status-dan-penanda-masalah).

### Tugas 58 — Dokumentasi pengaturan
- Perbarui `docs/konvensi.md` (aturan dropdown penyedia diganti), `docs/layanan-ai.md`, `docs/keputusan-teknis.md`
  (setting global dan alasannya), `docs/data-model.md` (kolom yang tidak dipakai), dan peta kode `AGENTS.md`. Salin
  mockup dari folder Temp ke `docs/mockup/settings.html`.
- Rincian: [setting.md, Tugas 6](setting.md#tugas-6--dokumentasi-dan-aturan).

- **Checkpoint 8** — typecheck/build bersih; dev harness (`STUDIO_USER_DATA` sementara) menguji: hasil menjadi basi
  saat lock, referensi, atau model aktif diubah, aturan Dokter Naskah tanpa false positive untuk narator/O.S./V.O.,
  migrasi dan normalisasi setting pada salinan database lama, penyedia custom bertahan setelah restart, dan ekspor
  preset diperiksa dengan `ffprobe`; screenshot Lorebook (kunci, kontinuitas), Rencana & Tinjau, Storyboard (chip
  referensi, mode pilih), dialog ekspor, dan Pengaturan (rail, detail, penyedia baru, Model aktif) di 1180×720
  terang dan gelap.

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
| Ekstraksi Lorebook membuat duplikat atau tokoh salah | Lorebook berantakan, lembar terbuang | Dedup nama + alias; semua kandidat ditinjau dulu, tidak ada yang tersimpan otomatis |
| Template prompt yang diedit merusak keluaran AI | Planner/naskah gagal | Validasi variabel wajib, skema JSON tetap di kode, tombol kembalikan ke bawaan |
| Kolom shot/profil baru tidak terbaca di proyek lama | Data lama error | Kolom JSON opsional dengan nilai bawaan; uji salinan database lama di Checkpoint 7 |
| Input prompt baru (lock, referensi) tidak masuk hash basis | Hasil lama tampak terkini padahal prompt berubah | Hash dari prompt hasil kompilasi + daftar referensi efektif; uji `current → stale` di Checkpoint 8 |
| Prompt terpotong di model dengan `promptLimit` kecil | Identitas/kostum hilang, wajah melenceng | Jalur trim mempertahankan identitas, kostum, dan lock; lock yang terpotong ditandai |
| Aturan Dokter Naskah berbasis tebakan teks | Peringatan palsu membuat kreator mengabaikan semuanya | Aturan tak pasti mulai sebagai `info`; four-beat memakai label `beat` dari planner |
| Preset ekspor dengan rasio berbeda | Pratinjau ≠ ekspor | Fase 8 hanya preset rasio sama; crop/pad/matte ditulis di `shared/` sebagai tugas terpisah |
| Model aktif global diganti di tengah produksi | Satu serial tercampur model, banyak hasil basi sekaligus | Konfirmasi sebelum menyimpan dengan jumlah serial terdampak; hasil hanya ditandai basi, tidak dibuat ulang |
| Normalisasi setting lama salah memetakan penyedia/kunci | Kunci pengguna seolah hilang | Id penyedia tidak berubah (termasuk `custom`); uji salinan database lama di Checkpoint 8 |
