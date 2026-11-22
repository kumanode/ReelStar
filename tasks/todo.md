# Daftar Tugas: Studio Drama Short Multi-Episode

Rincian setiap tugas ada di [plan.md](plan.md); desain di
[spec](../docs/superpowers/specs/2026-11-20-drama-short-flow-design.md).

## Fase 1 — Fondasi episode (tanpa perubahan tampilan)

- [x] Tugas 1 — Migrasi database (episodes, kolom klip/karakter/aset/job, tabel varian/lokasi/prop, backfill Ep 1).
- [x] Tugas 2 — Tipe bersama (`Episode`, kolom baru, bundle dan snapshot per episode).
- [x] Tugas 3 — Repo: CRUD episode, `getBundle`/`clipsOf`/`saveSnapshot`/`replaceScript`/`duplicateProject` per episode.
- [x] Tugas 4 — Pemanggil di main process meneruskan `episodeId`; job menyimpan `episode_id`.
- [x] Tugas 5 — IPC `episodes:*` dan `projects:get` dengan `episodeId` (ipc, api, preload).
- [x] Tugas 6 — Store renderer per episode; UI lama membuka episode pertama/terakhir.
- [x] Tugas 7 — Ekspor per episode (nama file, cache, status `exported`).
- [x] Tugas 8 — Dev harness: `seedEpisodes`, `checkIsolation`, uji salinan database lama.
- [x] Checkpoint 1 — typecheck/build bersih, ekspor proyek lama identik, isolasi 2 episode terbukti, dokumen diperbarui.

## Fase 2 — Studio Hub & Lorebook

- [x] Tugas 9 — Kerangka Studio: header, sidebar yang bisa ciut (otomatis ciut di Editor), buka episode/tab terakhir.
- [x] Tugas 10 — Episode Hub tanpa AI: keadaan kosong, CRUD dan urutan episode, kartu yang bisa diedit.
- [x] Tugas 11 — Lorebook karakter: grid, panel detail, gaya suara, alias, "Dipakai di", lembar 3 tampak.
- [x] Tugas 12 — Varian kostum: lembar dari edit lembar dasar, unggah pengganti, tanda basi.
- [x] Tugas 13 — Lokasi dan prop: CRUD, lembar tunggal, chip di kartu klip.
- [x] Tugas 14 — Gabung dan hapus aset dengan ringkasan dampak.
- [x] Tugas 15 — Home kartu serial dan modal Buat serial baru.
- [x] Tugas 16 — Hapus alur narasi lama dan tulis ulang dokumentasi terkait.
- [x] Checkpoint 2 — kriteria fase 2 + screenshot 1180×720 dan 1600×900, terang dan gelap.

## Fase 3 — Planner & naskah dua tahap

- [x] Tugas 17 — Input sumber (novel / naskah jadi) di Episode Hub.
- [x] Tugas 18 — Planner episode bertahap dengan validasi, coba ulang, dan lanjutkan.
- [x] Tugas 19 — Rencana isi per episode dengan konteks antar-episode dan usulan aset baru.
- [x] Tugas 20 — Tab Rencana & Tinjau.
- [x] Tugas 21 — Konfirmasi rencana menjadi klip.
- [x] Tugas 22 — Tahap prompt visual untuk klip yang kosong.
- [x] Checkpoint 3 — novel contoh, naskah jadi kata per kata, Ep 2 menjawab cliffhanger Ep 1.

## Fase 4 — Prompt, suara & generate

- [ ] Prasyarat — Uji suara Veo: 3–4 shot dialog bahasa Indonesia, tokoh yang sama (ditunda sampai aplikasi siap dan fitur fase 6 jelas).
- [x] Tugas 23 — Flag `nativeAudio`, prompt dialog, suara tidak dimatikan untuk klip dialog.
- [x] Tugas 24 — Ekstraksi audio video + Whisper menjadi aset audio klip.
- [x] Tugas 25 — Take TTS per suara untuk narator.
- [x] Tugas 26 — Kompilasi prompt berlabel dan urutan gambar referensi di `src/shared/`.
- [x] Tugas 27 — Syarat sebelum generate.
- [x] Tugas 28 — Hash basis, status hasil, badge di Storyboard.
- [x] Tugas 29 — Batch "Buat yang belum ada", estimasi kredit, total kredit per episode.
- [x] Tugas 30 — Catat perubahan keputusan teknis.
- [ ] Checkpoint 4 — sampel dialog lolos, lalu kriteria fase 4 (ditunda bersama uji suara Veo).

## Fase 5 — Opsional

- [ ] Speed ramp durasi video vs suara
- [ ] ~~Sambung frame terakhir ke frame awal shot berikutnya~~ → dipindah ke Tugas 43 (fase 7)
- [ ] Magic Wand perbaikan prompt
- [ ] Tombol cepat gerak kamera
- [ ] Auto-draft 1 klik
- [ ] Preset subtitle kreatif
- [ ] Ekspor draft CapCut
- [ ] Storyboard grid
- [ ] Video dari gambar referensi
- [ ] Pemeriksaan otomatis video (layar hitam, gambar macet)
- [ ] ~~Riwayat versi dengan rollback~~ → dipindah ke Tugas 50 (fase 8)
- [ ] Lip-sync TTS lewat model ber-`audio_url`

## Fase 6 — Penyempurnaan alur serial

Rincian dan kriteria penerimaan: [Fase 6 di plan.md](plan.md#fase-6--penyempurnaan-alur-serial).
Urutan pengerjaan yang disarankan: 35 → 32 → 31 → 34 → 33.

- [x] Tugas 31 — Target jumlah episode, durasi per episode, estimasi total, dan batas serial 1 jam.
- [x] Tugas 32 — Tombol lanjut ke Lorebook/naskah dan ringkasan progres serial.
- [x] Tugas 33 — Generate batch lembar Lorebook dengan estimasi biaya dan pemeriksaan prasyarat.
- [x] Tugas 34 — Buat draf naskah semua episode yang belum punya draf; jangan otomatis konfirmasi/menimpa.
- [x] Tugas 35 — Hapus semua episode dengan konfirmasi; pertahankan sumber cerita dan Lorebook.
- [x] Checkpoint 6 — typecheck/build dan verifikasi alur/batch massal lewat dev harness.

## Fase 7 — Lorebook otomatis, shot lebih rinci, dan arahan yang bisa diedit

Rincian dan kriteria penerimaan: [Fase 7 di plan.md](plan.md#fase-7--lorebook-otomatis-shot-lebih-rinci-dan-arahan-yang-bisa-diedit).
Urutan pengerjaan: 36 → 37 → 38 → 39 → 40 → 41 → 42 → 43.

- [x] Tugas 36 — Modal Buat Serial Baru (durasi, target, sumber), input target episode, kartu Sumber & Target selalu tampil.
- [x] Tugas 37 — Ekstraksi Lorebook + character bible + frasa kunci kostum, dengan tinjau kandidat.
- [x] Tugas 38 — Skema shot diperluas (kamera, pencahayaan, blocking, SFX), jenis teks O.S./V.O., batas kata per durasi.
- [x] Tugas 39 — Dokter naskah dan indikator ritme sebelum konfirmasi.
- [x] Tugas 40 — Arahan serial dan template prompt per tahap yang bisa dikembalikan ke bawaan.
- [x] Tugas 41 — Pusat tugas: progres, batal, coba ulang, lompat ke asal.
- [x] Tugas 42 — Lanjutkan semua: pipeline bertahap dengan konfirmasi biaya.
- [x] Tugas 43 — Sambung frame terakhir antar-shot (dari fase 5).
- [x] Checkpoint 7 — typecheck/build, dev harness, screenshot 1180×720 terang dan gelap.

## Fase 8 — Kontinuitas, referensi per shot, pengiriman, dan pengaturan global

Rincian dan kriteria penerimaan: [Fase 8 di plan.md](plan.md#fase-8--kontinuitas-referensi-per-shot-pengiriman-dan-pengaturan-global).
Urutan pengerjaan: 44 → 54 → 45 → 46 → 47 → 48, lalu 55 → 56 → 57 → 58; tugas 53 kapan saja; tugas 49–52 bebas setelah 44 (49 diuji paling akhir).
Rincian pengaturan: [setting.md](setting.md).

- [x] Tugas 44 — Rapikan sisa Tugas 38–39: nilai bawaan tipe dialog, `shotDetail` ringkas, aturan O.S./V.O., `WEAK_HOOK`, prioritas jalur trim prompt.
- [x] Tugas 45 — Kunci kontinuitas (lock words) per serial dan episode, masuk prompt (termasuk jalur trim) dan hash.
- [x] Tugas 46 — Aturan ritme Dokter Naskah: deretan dialog, jangkar visual, four-beat dengan label `beat`, cliffhanger antar-episode.
- [x] Tugas 47 — Catatan kontinuitas lintas episode (foreshadow, prop, aturan, relasi) + konteks planner.
- [x] Tugas 48 — Referensi per shot: chip, lepas, unggah, override masuk hash.
- [x] Tugas 49 — Preset platform ekspor (rasio sama dengan proyek), bitrate, peringatan durasi.
- [x] Tugas 50 — Versi naskah dan rollback (dari fase 5).
- [x] Tugas 51 — Aksi grup di Storyboard dengan estimasi gabungan.
- [x] Tugas 52 — Paket kirim: manifest, checksum, SRT, zip.
- [x] Tugas 53 — Pengaturan: kerangka tiga kolom (sidebar, rail penyedia, detail), tanpa ubah data model.
- [x] Tugas 54 — Katalog penyedia + `resolveActive`: semua penyedia/model global, hapus tebakan `includes('/')` dan `defaultVisualProvider`.
- [x] Tugas 55 — Penyedia custom LLM: tambah, ubah, hapus; endpoint `custom` lama tetap terbaca.
- [x] Tugas 56 — Halaman Model aktif; pemilih model di proyek jadi ringkasan baca-saja; konfirmasi saat ganti model.
- [x] Tugas 57 — Status dan penanda masalah di Pengaturan dari satu `KeyStatus`.
- [x] Tugas 58 — Dokumentasi pengaturan + salin mockup ke `docs/mockup/`.
- [x] Checkpoint 8 — typecheck/build, dev harness (hash basi termasuk ganti model aktif, Dokter Naskah, migrasi dan normalisasi setting, penyedia custom setelah restart, `ffprobe`), screenshot 1180×720 terang dan gelap.


## Fase 9 — Redesign Alur Produksi Short Drama Terpadu

Rincian dan kriteria penerimaan: [Fase 9 di plan.md](plan.md#fase-9--redesign-alur-produksi-short-drama-terpadu).
Urutan pengerjaan: `59 → 60 → 61 → 62 → 63 → 64`, `65` (paralel setelah 59), `66 → 67 → 68 → Checkpoint 9`.

- [x] Prasyarat — Simpan perubahan lokal di `main` ke stash dan buat branch `fase-9-redesign-alur` dari `origin/fase-8-kontinuitas`.
- [x] Tugas 59 — Kerangka Studio Episode 2 tab (`production` + `editor`), migrasi `activeTab` lama, auto-ciut sidebar di Editor.
- [x] Tugas 60 — Halaman `ProductionStep` & `ShotCard` terpadu (gabungan `PlanStep` + `StoryboardStep`, progressive disclosure untuk Prompt/Detail, Script Doctor, Lock Words, Ritme, Snapshot).
- [x] Tugas 61 — Alur 1 klik `Susun Shot & Prompt` + banner persetujuan aset baru inline + auto-chain `confirmEpisodeScript` → `writePrompts`.
- [x] Tugas 62 — Pemisahan tegas tombol Buat Gambar, Buat Video, dan Buat TTS di toolbar atas, bar seleksi multi-shot, dan per kartu shot (+ `clipIds` opsional di `batchEstimate`).
- [x] Tugas 63 — Smart Dependency Batch khusus Gambar (lembar referensi kosong otomatis dijadwalkan di Tahap 1 sebelum Gambar Tahap 2; Video tetap terpisah & tidak auto-gambar).
- [x] Tugas 64 — Pratinjau Animatic 9:16 (`AnimaticPreviewModal`) langsung di Tab Produksi sebelum generate Video AI.
- [x] Tugas 65 — Pemadatan `LorebookPage` (5 tab → 3 tab: Pemeran, Dunia, Aturan Serial) & auto-ekstrak Lorebook dari `EpisodeHub`.
- [x] Tugas 66 — Auto-Trim hening video dialog berbasis timestamp Whisper (`computeSpeechTrimWindow` di `src/shared/timeline.ts`, non-destruktif, plus IPC `clips:autoTrimEpisode`).
- [x] Tugas 67 — Bar "Finishing Drama" di `EditorStep` (Auto-Trim Hening, Smart AI SFX, Musik ElevenLabs dalam 1 akses cepat).
- [x] Tugas 68 — Salin mockup ke `docs/mockup/redesign-alur.html`, hapus `PlanStep.tsx`/`StoryboardStep.tsx` usang, dan perbarui dokumentasi (`AGENTS.md`, `docs/alur-produksi.md`, `docs/keputusan-teknis.md`).
- [x] Checkpoint 9 — `npm run typecheck`, `npm run build`, uji dev harness end-to-end, screenshot 1180×720 & 1600×900 tema terang/gelap.
