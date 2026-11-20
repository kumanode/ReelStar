# Daftar Tugas: Studio Drama Short Multi-Episode

Rincian setiap tugas ada di [plan.md](plan.md); desain di
[spec](../docs/superpowers/specs/2026-11-20-drama-short-flow-design.md).

## Fase 1 — Fondasi episode (tanpa perubahan tampilan)

- [ ] Tugas 1 — Migrasi database (episodes, kolom klip/karakter/aset/job, tabel varian/lokasi/prop, backfill Ep 1).
- [ ] Tugas 2 — Tipe bersama (`Episode`, kolom baru, bundle dan snapshot per episode).
- [ ] Tugas 3 — Repo: CRUD episode, `getBundle`/`clipsOf`/`saveSnapshot`/`replaceScript`/`duplicateProject` per episode.
- [ ] Tugas 4 — Pemanggil di main process meneruskan `episodeId`; job menyimpan `episode_id`.
- [ ] Tugas 5 — IPC `episodes:*` dan `projects:get` dengan `episodeId` (ipc, api, preload).
- [ ] Tugas 6 — Store renderer per episode; UI lama membuka episode pertama/terakhir.
- [ ] Tugas 7 — Ekspor per episode (nama file, cache, status `exported`).
- [ ] Tugas 8 — Dev harness: `seedEpisodes`, `checkIsolation`, uji salinan database lama.
- [ ] Checkpoint 1 — typecheck/build bersih, ekspor proyek lama identik, isolasi 2 episode terbukti, dokumen diperbarui.

## Fase 2 — Studio Hub & Lorebook

- [ ] Tugas 9 — Kerangka Studio: header, sidebar yang bisa ciut (otomatis ciut di Editor), buka episode/tab terakhir.
- [ ] Tugas 10 — Episode Hub tanpa AI: keadaan kosong, CRUD dan urutan episode, kartu yang bisa diedit.
- [ ] Tugas 11 — Lorebook karakter: grid, panel detail, gaya suara, alias, "Dipakai di", lembar 3 tampak.
- [ ] Tugas 12 — Varian kostum: lembar dari edit lembar dasar, unggah pengganti, tanda basi.
- [ ] Tugas 13 — Lokasi dan prop: CRUD, lembar tunggal, chip di kartu klip.
- [ ] Tugas 14 — Gabung dan hapus aset dengan ringkasan dampak.
- [ ] Tugas 15 — Home kartu serial dan modal Buat serial baru.
- [ ] Tugas 16 — Hapus alur narasi lama dan tulis ulang dokumentasi terkait.
- [ ] Checkpoint 2 — kriteria fase 2 + screenshot 1180×720 dan 1600×900, terang dan gelap.

## Fase 3 — Planner & naskah dua tahap

- [ ] Tugas 17 — Input sumber (novel / naskah jadi) di Episode Hub.
- [ ] Tugas 18 — Planner episode bertahap dengan validasi, coba ulang, dan lanjutkan.
- [ ] Tugas 19 — Rencana isi per episode dengan konteks antar-episode dan usulan aset baru.
- [ ] Tugas 20 — Tab Rencana & Tinjau.
- [ ] Tugas 21 — Konfirmasi rencana menjadi klip.
- [ ] Tugas 22 — Tahap prompt visual untuk klip yang kosong.
- [ ] Checkpoint 3 — novel contoh, naskah jadi kata per kata, Ep 2 menjawab cliffhanger Ep 1.

## Fase 4 — Prompt, suara & generate

- [ ] Prasyarat — Uji suara Veo: 3–4 shot dialog bahasa Indonesia, tokoh yang sama.
- [ ] Tugas 23 — Flag `nativeAudio`, prompt dialog, suara tidak dimatikan untuk klip dialog.
- [ ] Tugas 24 — Ekstraksi audio video + Whisper menjadi aset audio klip.
- [ ] Tugas 25 — Take TTS per suara untuk narator.
- [ ] Tugas 26 — Kompilasi prompt berlabel dan urutan gambar referensi di `src/shared/`.
- [ ] Tugas 27 — Syarat sebelum generate.
- [ ] Tugas 28 — Hash basis, status hasil, badge di Storyboard.
- [ ] Tugas 29 — Batch "Buat yang belum ada", estimasi kredit, total kredit per episode.
- [ ] Tugas 30 — Catat perubahan keputusan teknis.
- [ ] Checkpoint 4 — sampel dialog lolos, lalu kriteria fase 4.

## Fase 5 — Opsional

- [ ] Speed ramp durasi video vs suara
- [ ] Sambung frame terakhir ke frame awal shot berikutnya
- [ ] Magic Wand perbaikan prompt
- [ ] Tombol cepat gerak kamera
- [ ] Auto-draft 1 klik
- [ ] Preset subtitle kreatif
- [ ] Ekspor draft CapCut
- [ ] Storyboard grid
- [ ] Video dari gambar referensi
- [ ] Pemeriksaan otomatis video (layar hitam, gambar macet)
- [ ] Riwayat versi dengan rollback
- [ ] Lip-sync TTS lewat model ber-`audio_url`
