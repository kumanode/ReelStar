# AGENTS.md — panduan untuk AI agent dan pengembang

ReelStar adalah aplikasi desktop (Electron + React + TypeScript) untuk membuat serial drama pendek multi-episode
dari novel atau naskah jadi. AI memecah sumber cerita menjadi episode, lalu menyusun naskah per shot dalam dua
tahap (rencana → tinjau → konfirmasi). Tokoh, varian kostum, lokasi, dan prop dicatat di Lorebook. Higgsfield atau
Flow2API membuat gambar dan video; dialog bisa diucapkan langsung oleh model video (Veo) dengan gerak bibir,
sedangkan narator dan dialog mode TTS memakai Gemini atau ElevenLabs. Setiap episode dirangkai di editor timeline
dan diekspor jadi MP4 dengan FFmpeg. Desain lengkapnya ada di
[spec drama short](docs/superpowers/specs/2026-11-20-drama-short-flow-design.md).

Baca file ini dulu sebelum mengubah kode. Detail lengkapnya ada di folder [`docs/`](docs/README.md).

## Perintah

```bash
npm install            # pasang dependensi (better-sqlite3 dibangun ulang untuk Electron lewat postinstall)
npm run dev            # jalankan aplikasi dalam mode pengembangan (hot reload renderer)
npm run typecheck      # wajib bersih sebelum selesai: tsconfig.node.json + tsconfig.web.json
npm run build          # build ke folder out/ (main, preload, renderer)
npm run dist           # build + installer Windows (NSIS) ke folder dist/
```

Tidak ada framework unit test. Verifikasi dilakukan dengan `npm run typecheck`, `npm run build`, dan **dev harness**
yang menjalankan aplikasi dari skrip JSON (lihat [docs/pengembangan.md](docs/pengembangan.md)).

## Peta kode

```
src/
  main/            proses utama Electron (Node): database, AI, FFmpeg, file
    index.ts       startup, jendela, folder data, switch Chromium
    ipc.ts         semua handler IPC (window.api)
    repo.ts        akses SQLite (proyek, klip, pemeran, aset, job)
    db/index.ts    skema + migrasi (PRAGMA user_version)
    story.ts       planner episode, naskah dua tahap, prompt visual, musik, YouTube metadata (LLM)
    generation.ts  gambar/video Higgsfield/Flow2API, lembar karakter/lokasi/prop, suara dialog dari video, TTS,
                   estimasi kredit
    narration.ts   narasi satu rekaman utuh lalu dipotong per adegan; sinkron caption
    whisper.ts     whisper.cpp lokal (unduh model, kenali kata)
    align.ts, cuts.ts  cocokkan kata naskah ke hasil Whisper; pilih titik potong antar-adegan
    editing.ts     potong (split) klip, lepas suara klip
    exporter.ts    render MP4 dengan FFmpeg
    package.ts     ekspor paket pengiriman siap kirim (.zip, manifest, checksums, SRT, aset)
    fontMetrics.ts lebar teks dari file TTF (untuk kotak caption di ekspor)
    jobs.ts, events.ts  antrean job + event ke renderer
    secrets.ts     kunci API terenkripsi (safeStorage/DPAPI)
    services/      klien API: gemini, elevenlabs, higgsfield, llm (OpenAI-compatible), audio, http
    devharness.ts  otomatisasi uji (hanya mode pengembangan)
  preload/         jembatan aman: window.api (lihat src/shared/api.ts)
  shared/          kode yang dipakai main DAN renderer (tipe, aturan gerak, caption, timeline)
    filters.ts    preset filter warna untuk pratinjau dan ekspor
    sfx.ts        katalog efek suara bawaan
    prompts.ts    prompt gambar/video berlabel dan urutan lembar referensi
    lock.ts       kata kunci kontinuitas (lock words) dan pemeriksaan kepatuhan prompt
    providers.ts  katalog penyedia AI, resolusi model aktif (resolveActive)
    exportPresets.ts preset platform video (TikTok, Reels, Shorts, YouTube) & validasi durasi
    validation.ts syarat generate, status hasil (terkini/basi/belum ada/terblokir), durasi video, batch
    hash.ts       hash basis hasil generate
    styles.ts, legacyStyles.ts  katalog gaya visual; gaya lama tetap terbaca untuk proyek lama
  renderer/src/    tampilan React + Tailwind v4 + Zustand
    pages/project/  Episode Hub, Lorebook, Rencana & Tinjau, Storyboard, Editor, Header, Sidebar
    pages/settings/ Model Aktif, Penyedia & Kunci, Penyedia Custom, Umum, Whisper
    pages/project/editor/  pratinjau (Player), Timeline, Inspector (panel kanan), engine pemutaran
resources/         font caption, SFX bawaan, whisper-cli.exe + DLL, file lisensi
build/             ikon aplikasi untuk installer (icon.ico, icon.png), dibuat dari logo di components/Logo.tsx
docs/              dokumentasi pengembang
```

## Aturan yang tidak boleh dilanggar

1. **Pratinjau dan ekspor harus sama.** Semua aturan yang memengaruhi gambar atau suara final ditulis sekali di
   `src/shared/` lalu dipakai pratinjau (renderer) dan ekspor (main):
   `motion.ts` (gerak kamera, transisi), `captions.ts` (gaya, font, pemenggalan baris caption),
   `timeline.ts` (potongan suara/musik, kata caption per klip), `overlays.ts`, `higgsfield.ts`.
   Jangan menghitung ulang aturan itu di satu sisi saja.
2. **Kunci API milik pengguna (BYOK).** Kunci hanya disimpan terenkripsi lewat `secrets.ts`, hanya dikirim ke
   layanannya masing-masing, dan tidak pernah dicetak ke log, error, atau file.
3. **Migrasi database hanya ditambah di akhir** array `MIGRATIONS` di `src/main/db/index.ts`. Jangan mengubah
   migrasi lama; `PRAGMA user_version` menghitung berapa yang sudah dijalankan.
4. **Kolom klip baru** harus ditambahkan di semua tempat: tipe `Clip` (`shared/types.ts`), migrasi, `toClip`,
   upsert di `saveSnapshot`, `duplicateProject`, `insertClipAfter`, `CLIP_COLS` (kalau di-patch dari main), dan
   nilai bawaan `addClip` di `renderer/src/store/project.ts`. Detail: [docs/data-model.md](docs/data-model.md).
5. **IPC baru** butuh tiga tempat: `handle(...)` di `main/ipc.ts`, tipe di `shared/api.ts`, dan `call(...)` di
   `preload/index.ts`.
6. **Teks antarmuka berbahasa Indonesia** (santai, pakai "kamu"); **komentar dan nama di kode berbahasa Inggris**.
   Komentar menjelaskan *kenapa*, bukan *apa*.
7. **TypeScript strict** dengan `noUnusedLocals`/`noUnusedParameters`: hapus impor dan variabel yang tidak dipakai.
8. Jangan memakai `<select>` bawaan browser; pakai komponen `Select`/`Popover`. Aturan UI lain ada di
   [docs/konvensi.md](docs/konvensi.md).
9. Jangan mengulang bug yang sudah diperbaiki. Baca [docs/keputusan-teknis.md](docs/keputusan-teknis.md) sebelum
   mengubah ekspor, narasi, Whisper, caption, atau pratinjau video.

## Cara menguji perubahan

- Selalu: `npm run typecheck` lalu `npm run build`.
- Perubahan tampilan atau alur: jalankan aplikasi dengan dev harness (`STUDIO_CAPTURE_PLAN`), ambil screenshot,
  dan periksa isi halaman lewat `console.log` (lebih andal daripada screenshot saja).
- Perubahan ekspor: ekspor proyek demo (`{"main":"seed"}` lalu `{"main":"export"}`), lalu periksa hasilnya dengan
  ffmpeg (durasi video vs audio, cuplikan frame).
- Gunakan folder data sementara (`STUDIO_USER_DATA`) agar data dan kunci pengguna tidak tersentuh.

## Dokumentasi lanjutan

| Topik | File |
|---|---|
| Arsitektur, proses, IPC, penyimpanan | [docs/arsitektur.md](docs/arsitektur.md) |
| Skema database dan tipe data | [docs/data-model.md](docs/data-model.md) |
| Alur produksi (naskah → visual → suara → caption) | [docs/alur-produksi.md](docs/alur-produksi.md) |
| Editor, timeline, pratinjau, ekspor | [docs/editor-dan-ekspor.md](docs/editor-dan-ekspor.md) |
| Layanan AI dan kunci API | [docs/layanan-ai.md](docs/layanan-ai.md) |
| Setup, dev harness, build, rilis | [docs/pengembangan.md](docs/pengembangan.md) |
| Gaya kode dan aturan UI | [docs/konvensi.md](docs/konvensi.md) |
| Keputusan teknis dan alasannya | [docs/keputusan-teknis.md](docs/keputusan-teknis.md) |
| Masalah yang diketahui dan ide lanjutan | [docs/masalah-diketahui.md](docs/masalah-diketahui.md) |
