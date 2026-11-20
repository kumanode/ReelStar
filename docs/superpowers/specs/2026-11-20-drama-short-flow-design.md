# Design Document: AI Short Drama Multi-Episode Studio Flow

- **Project:** ReelStar (Desktop Electron + React + TypeScript + SQLite)
- **Topik:** Transformasi alur kerja menjadi pembuat serial drama short AI (mengadopsi flow ArcReel)
- **Tanggal:** 2026-11-20
- **Status:** Proposed Design (revisi 4 — dicocokkan dengan repo ArcReel; suara dialog dari model video)
- **Pendekatan tata letak:** Opsi A — Studio Hub & Workspace

Keputusan yang sudah diambil:
- **K1 (2026-11-20):** alur narasi lama dihapus; semua proyek adalah serial.
- **K2 (2026-11-20):** suara dialog tokoh dibuat oleh model video (Veo) sekaligus dengan gerak bibirnya, bukan TTS.

---

## 1. Intent & Why

Aplikasi saat ini (ReelStar / Bang Story) dirancang untuk video narasi cerita YouTube tunggal: satu narator utama,
durasi 1–30 menit, satu daftar pemeran per proyek, dan empat langkah linier (Ide → Naskah → Storyboard → Editor).
Dialog multi-suara sudah ada (`clips.speaker_id`, `characters.tts_voice`/`tts_provider`, `ensureSpeaker`), tetapi
masih berupa TTS di atas video tanpa gerak bibir.

Format **AI Short Drama vertikal (9:16)** seperti ReelShort, DramaBox, dan TikTok Series butuh:

1. **Multi-episode dengan cliffhanger**: cerita panjang dipecah menjadi episode 60–90 detik yang saling menyambung.
2. **Konsistensi pemeran dengan variasi busana**: wajah tetap sama di semua episode, busana berubah sesuai alur.
3. **Dialog berbalas yang terlihat diucapkan**: close-up tokoh yang bicara dengan bibir yang bergerak sesuai kalimat.
4. **Prompt visual terstruktur**: isi cerita dipisah dari prompt gambar/video, dengan titik tinjau di antaranya.

**Tujuan:** mengadopsi alur kerja drama ArcReel (`C:\Project\ArcReel`) ke ReelStar, sambil mempertahankan Electron,
SQLite lokal, Player HTML5, timeline multi-track, dan exporter FFmpeg lokal.

**Keputusan produk:** ReelStar menjadi aplikasi serial drama saja. Alur narasi 4 langkah **dihapus**. Proyek yang
sudah tersimpan tidak hilang: masing-masing menjadi serial dengan satu episode, dan klipnya tetap bisa dibuka,
diedit, dan diekspor di Studio Episode (narator = klip tanpa pembicara, tetap memakai TTS).

### Rujukan ArcReel

| Konsep ArcReel | Sumber | Di spec ini |
|---|---|---|
| Kerangka episode (hook, story beats, teaser episode berikutnya), perencanaan bertahap | ADR 0031, 0032, `lib/episode/episode_ledger.py` | §8.A |
| Jenis sumber: novel (adaptasi) vs naskah jadi (ambil apa adanya) | ADR 0036 | §8.A |
| Naskah dua tahap + halaman tinjau isi sebelum prompt visual | ADR 0041, 0080 | §8.B |
| Identifikasi aset baru per episode, alias, gabung, hapus | ADR 0092, panduan workflow §6 | §8.C, §6.H |
| Varian kostum sebagai sub-identitas, lembar dari edit lembar dasar | ADR 0072 | §6.G |
| Lembar karakter 3 tampak; lokasi/prop 1 gambar | ADR 0066 | §8.D |
| Satu shot satu pemilik suara; dialog dari model video, narator dari TTS | ADR 0040, 0089, `lib/speech/character_voice.py` | §6.C |
| Syarat generate: aset terdaftar dan punya lembar; durasi dari pilihan model | ADR 0073, 0018 | §6.I |
| Status hasil terkini/basi/belum ada/terblokir; batch hanya isi yang belum ada | ADR 0062 | §6.J |
| Estimasi biaya dan batch semua-atau-tidak-sama-sekali | ADR 0061, PRODUCT.md | §6.J |
| Fitur fork (speed ramp, sambung frame, Magic Wand, auto-draft, CapCut, dll.) | commit fork | §10 fase 5 |

---

## 2. Goals, Non-Goals, Anti-Goals

### Goals
- **Serial multi-episode** dengan kerangka per episode dan kesinambungan antar-episode.
- **AI Episode Planner** dari novel atau naskah jadi, bertahap untuk teks panjang.
- **Naskah dua tahap**: rencana isi → tinjau & konfirmasi → prompt visual.
- **Lorebook bersama**: karakter (wajah, varian kostum, gaya suara, alias), lokasi, prop — dengan usulan aset baru
  per episode, gabung, dan hapus yang aman.
- **Dialog bersuara dari model video** dengan gerak bibir; narator/suara batin tetap TTS.
- **Kontrol biaya dan hasil**: status terkini/basi per hasil, generate massal hanya untuk yang belum ada, estimasi
  biaya sebelum batch.
- **Editor dan ekspor tetap dipakai**: episode diekspor per episode lewat FFmpeg lokal.

### Non-Goals
- **Tidak memindahkan backend** ke Python/Docker/FastAPI. Tetap Electron + TypeScript + better-sqlite3.
- **Tidak mengubah engine render**: `exporter.ts`, filter warna, gerak kamera, dan caption styler tetap.
- **Tidak menghapus provider**: Higgsfield, Flow2API, Gemini TTS, dan ElevenLabs tetap didukung.
- **Tidak mempertahankan alur narasi YouTube panjang**: proyek lama hanya dijamin bisa dibuka, diedit, diekspor.
- **Tidak mengambil dari ArcReel**: agent chat, server/Docker, PostgreSQL, multi-bahasa UI, mode iklan/produk,
  mode narasi, marketplace, pustaka aset global.

### Anti-Goals
- Jangan membuat episode sebagai proyek terpisah. Semua episode dalam satu serial berbagi Lorebook.
- Jangan mengubah migrasi lama. Migrasi baru hanya ditambahkan di akhir `MIGRATIONS`.
- Jangan menyimpan ID aset di kolom JSON yang ditulis renderer (lihat §6.B).
- Jangan memakai `<select>` bawaan browser; pakai komponen `Select`/`Popover`.
- Jangan membuat ulang hasil berbayar secara otomatis. Hasil yang basi tetap dipakai sampai pengguna memintanya.
- Jangan mengulang bug di `docs/keputusan-teknis.md`. Keputusan yang sengaja diubah oleh spec ini dicatat di §6.C.

---

## 3. Bahasa Desain & Tampilan

Tetap memakai sistem desain ReelStar yang ada (`src/renderer/src/styles.css`, `docs/konvensi.md`). Tidak ada tema
atau palet baru. Mockup brainstorm di `.superpowers/brainstorm/` memakai tema bawaan alat brainstorm (gelap, ungu);
itu **bukan** acuan warna.

### Tema dan token

- **Tema "kertas & tinta"**, terang sebagai bawaan, dengan varian gelap lewat pengaturan tema yang sudah ada
  (`html.dark`). Semua layar baru hanya memakai token, tidak pernah warna hex langsung, agar kedua tema benar.
- Latar halaman `paper`, kartu `surface`, isian `sand`; teks `ink` / `ink-2` / `muted`; garis `line` / `line-2` /
  `line-3`; bayangan `shadow-ink*` untuk kartu yang menonjol.
- `accent` hanya untuk tombol aksi utama dan cincin item yang sedang diedit (`SELECTED` di `Timeline.tsx`).
  Item yang tidak dipilih tidak boleh berwarna accent.
- Pilihan aktif di daftar/grid ditandai latar `bg-sun-soft` (aturan UI no. 6), bukan centang.
- **Font**: `Plus Jakarta Sans` (teks), `Bricolage Grotesque` (`font-display`, judul serial dan episode),
  `JetBrains Mono` (`font-mono`: durasi, timecode, kredit, nomor shot).
- **Ikon**: `lucide-react`.
- **Bahasa antarmuka**: Indonesia santai dengan sapaan "kamu"; angka desimal memakai koma ("3,5 dtk").

### Pemetaan status ke `Badge` (tone yang sudah ada)

| Status | Tone | Contoh label |
|---|---|---|
| Episode `draft` | `draft` | Draf |
| Episode `planned` | `info` | Kerangka siap |
| Episode `script` / `storyboard` | `info` | Naskah / Storyboard |
| Episode `editing` | `warn` | Diedit |
| Episode `exported` | `ok` | Terekspor |
| Hasil terkini | `ok` | Terkini |
| Hasil basi | `warn` | Basi |
| Hasil belum ada | `draft` | Belum ada |
| Hasil terblokir | `bad` | Terblokir (alasan di tooltip/popover) |
| Hook dan cliffhanger | `ink` (pil gelap, agar tidak tertukar dengan status `warn`) | label "Hook" / "Cliffhanger" |

Tone `warn` sudah berarti `bg-sun-soft text-sun-ink`, jadi tidak perlu tone baru.

### Komponen yang dipakai ulang

`Button`, `IconButton`, `Chip`, `Segmented`, `Badge`, `Switch`, `Field`, `Progress`, `Modal`, `Menu`,
`confirmDialog` (`components/ui.tsx`), `Select`, `Popover`, `ModelPicker`, `AutoTextarea`, `StylePicker`.
Komponen baru dibuat hanya jika tidak ada padanannya, dan ditaruh di `components/` bila dipakai lebih dari satu layar.

### Aturan UI yang berlaku khusus untuk fitur ini

- **Pilihan visual pakai grid thumbnail** (aturan no. 2): pemilih varian kostum, lokasi, dan prop menampilkan
  thumbnail lembar referensinya. Aset tanpa lembar tampil dengan placeholder bergaris dan badge "Belum ada lembar".
- **Pengaturan di tempat itemnya** (aturan no. 7): chip kostum, lokasi, prop, pembicara, dan durasi ada langsung di
  kartu shot/klip; klik chip membuka `Popover` pemilihnya.
- **Simpan otomatis** (aturan no. 10): kartu episode, kolom Lorebook, dan rencana naskah tersimpan otomatis.
  **Konfirmasi** rencana bukan tombol simpan, tetapi langkah resmi yang mengubah rencana menjadi klip.
- **Kurangi klik** (aturan no. 5): AI mengisi kostum bawaan, lokasi, framing, dan durasi; pengguna hanya mengoreksi.
- **Ukuran minimal** (aturan no. 11): setiap layar baru harus rapi di jendela 1180×720 (lihat §4 "Lebar layar").
- **Aksi berbayar** selalu menyebut perkiraan kredit di tombolnya atau di dialog sebelum dijalankan.
- **Aksi yang menimpa atau menghapus** memakai `confirmDialog` gaya bahaya dan menyebut apa saja yang terdampak.

---

## 4. Tata Letak dan Layar

Opsi A (Studio Hub & Workspace) adalah satu-satunya tata letak proyek. Halaman langkah lama (`IdeaStep.tsx`,
`ScriptStep.tsx`, stepper 4 langkah) dihapus. `StoryboardStep.tsx`, `EditorStep.tsx`, `CharacterModal.tsx`, dan
`ExportDialog.tsx` dipakai ulang dan disesuaikan.

### Kerangka

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Pembalasan Sang Pewaris  9:16   [Ep 1 ▾]          ◆ 1.240 kredit  ⚙  ⋯    │  header
├────────────┬─────────────────────────────────────────────────────────────────┤
│ ≡          │                                                                 │
│ Episode Hub│                         WORKSPACE                               │
│ Lorebook   │                                                                 │
│ ────────── │   Studio Episode:  [Rencana & Tinjau] [Storyboard] [Editor]     │
│ EPISODE    │                                                                 │
│ 1 Lobi   ● │                                                                 │
│ 2 Rahasia ●│                                                                 │
│ 3 Rapat   ○│                                                                 │
│ + Episode  │                                                                 │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

- **Header**: tombol kembali ke Home, judul serial (`font-display`), rasio aspek, **pemilih episode** (`Select`,
  selalu ada agar pindah episode tetap bisa saat sidebar ciut), total kredit terpakai (klik → rincian per
  episode), pengaturan serial, menu lain (duplikat, hapus).
- **Sidebar kiri** (lebar 200px): Episode Hub, Lorebook, lalu daftar episode berurutan (drag untuk mengubah urutan)
  dengan judul terpotong dan titik status berwarna sesuai tabel §3. Item aktif `bg-sun-soft`.
- **Lebar layar**: sidebar bisa diciutkan menjadi rel ikon 48px (tombol ≡, diingat per pengguna). Di tab
  **Editor**, sidebar **otomatis ciut** agar player, timeline, dan inspector tetap memakai lebar penuh seperti
  sekarang; pindah episode lewat pemilih di header. Di 1180px, tab lain tetap memakai sidebar penuh.
- **Saat proyek dibuka**: kembali ke episode dan tab terakhir yang dibuka; proyek baru tanpa episode membuka
  Episode Hub.

### Home

- Kartu serial: sampul, judul, rasio aspek, jumlah episode, ringkasan progres (misal "3/8 terekspor" dengan
  `Progress`), terakhir diubah.
- Proyek lama tampil sebagai serial berisi 1 episode, tanpa tanda khusus.

### Buat serial baru (`Modal`)

1. Judul dan rasio aspek (`Segmented`: 9:16 bawaan, 16:9).
2. Gaya visual (`StylePicker`, grid thumbnail).
3. Sumber suara dialog (`Segmented`: "Dari video (Veo)" bawaan, "TTS"), dengan satu kalimat penjelasan.
4. Model gambar dan video (`ModelPicker`); jika "Dari video" dipilih, model video tanpa suara dinonaktifkan dengan
   tooltip alasannya (aturan no. 4).
5. Tombol "Buat serial" → membuka Episode Hub.

### Episode Hub

- **Keadaan kosong**: dua kartu pilihan besar — "Tempel atau unggah cerita" dan "Mulai dari episode kosong".
- **Sumber**: `AutoTextarea` untuk teks sumber + tombol unggah `.txt`/`.md`; `Segmented` jenis sumber
  ("Novel / cerita" atau "Naskah jadi") dengan penjelasan singkat bedanya; target durasi per episode; jumlah episode
  (opsional).
- **Tombol "Pecah jadi episode"**: selama berjalan, tampil `Progress` per batch ("Batch 2 dari 4 · 6 episode
  direncanakan") dan kartu episode muncul satu per satu. Batch gagal tampil sebagai baris error dengan tombol
  "Coba lagi". Setelah selesai dan sumber masih tersisa: tombol "Lanjutkan perencanaan".
- **Kartu episode** (grid 2 kolom di ≥1180px, `minmax(0,1fr)`): nomor dan judul (bisa diedit langsung), badge
  status, label Hook dan Cliffhanger (`Badge` tone `ink`), story beats sebagai daftar bernomor, teaser, durasi target,
  tombol "Buka". Semua kolom bisa diedit langsung dan tersimpan otomatis. Menu kartu: sisipkan episode sebelum/
  sesudah, hapus (konfirmasi bahaya).

### Lorebook

- Tab `Segmented`: Karakter · Lokasi · Prop. Kolom cari di kanan atas, tombol "+ Tambah".
- **Grid kartu** (thumbnail lembar 1:1 atau 3:1 untuk karakter, nama, alias pertama, jumlah varian, badge status
  lembar, jumlah episode yang memakai).
- **Panel detail karakter** (mengembangkan `CharacterModal.tsx`, tampil sebagai panel kanan di Lorebook):
  - lembar dasar (3 tampak) dengan tombol Buat / Buat ulang (dengan kredit) / Unggah, dan badge status;
  - deskripsi fisik, **gaya suara** (`AutoTextarea`, contoh di placeholder), suara TTS (untuk narator/mode TTS),
    alias (chip yang bisa ditambah/hapus);
  - **Varian kostum**: baris thumbnail varian; tiap varian punya nama, perubahan tampilan, lembar (Buat dari lembar
    dasar / Unggah), badge Basi jika lembar dasarnya berubah. Tombol "Buat" dinonaktifkan dengan tooltip jika
    lembar dasar belum ada;
  - "Dipakai di": daftar episode dan jumlah shot, klik → buka episode itu.
- Panel detail lokasi/prop: lembar tunggal, deskripsi, alias, "Dipakai di".
- **Menu kartu**: Gabungkan ke…, Hapus.
  - **Dialog gabung**: pilih aset tujuan dari grid thumbnail sejenis; untuk karakter, `Segmented` "Gabung sebagai
    karakter yang sama" / "Jadikan varian"; ringkasan dampak per episode (jumlah rujukan diubah, jumlah gambar/video
    menjadi basi); deskripsi aset yang digabung bisa disalin. Tombol bahaya "Gabungkan".
  - **Dialog hapus**: jika masih dipakai, sebut episode dan jumlah rujukannya, dengan tombol "Gabungkan saja…"
    di samping tombol bahaya "Hapus".

### Studio Episode — Rencana & Tinjau

```
┌─ Ep 2 · Rahasia di Ruang Rapat ─────────────── [Buat rencana] [Konfirmasi ▸] ┐
│ Hook ▸ …   Cliffhanger ▸ …   Kostum bawaan: Satria [Seragam Satpam ▾] …     │
├──────────────────────────────────────────────┬───────────────────────────────┤
│ 01 close-up · 4 dtk · Lobi Kantor            │ ASET BARU DI EPISODE INI (3)  │
│  ┌ Manajer · marah, menghina ─────────────┐  │ ┌ Pak Hendra   karakter ────┐ │
│  │ "Satpam miskin macam kamu…"            │  │ │ Buat baru ▾               │ │
│  └────────────────────────────────────────┘  │ │ Alasan: tokoh baru…       │ │
│  Aksi: Manajer menunjuk ke kamera…           │ └───────────────────────────┘ │
│  [Satria/Seragam Satpam] [Manajer] [Kopi]    │ ┌ Jas Formal  varian Satria ┐ │
│ 02 close-up · 4 dtk · reaksi Satria          │ │ Jadikan varian ▾          │ │
│  …                                           │ └───────────────────────────┘ │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

- **Baris atas**: hook dan cliffhanger episode (bisa diedit), **kostum bawaan per tokoh** untuk episode ini (chip
  per tokoh → `Popover` grid thumbnail varian).
- **Daftar shot** (kolom kiri, `minmax(0,1fr)`): nomor, framing, durasi (`Select` dari pilihan durasi model),
  lokasi. Balon dialog dengan nama pembicara dan emosi; balon narator berwarna `sand` dan miring; shot tanpa suara
  menampilkan "— tanpa suara —". Di bawahnya aksi visual dan chip rujukan (karakter/varian, prop). Semua kolom bisa
  diklik dan diedit di tempat. Kutipan sumber bisa dibuka (ikon buku). Shot bisa disisipkan, dihapus, dan
  di-drag.
- **Peringatan per shot** (ikon dan tooltip, tidak memblokir penyimpanan): pembicara tidak terlihat di shot,
  ucapan terlalu panjang untuk durasi, rujukan ke nama yang belum terdaftar dan tidak diusulkan.
- **Panel Aset baru** (kolom kanan 300px): kartu per usulan dengan jenis, nama, deskripsi, `Select` tindakan
  (Buat baru / Gabung ke… / Jadikan varian dari… / Abaikan), aset tujuan bila perlu, dan alasan AI.
- **Buat rencana**: jika rencana atau klip sudah ada, minta konfirmasi bahwa rencana lama diganti.
- **Konfirmasi ▸**: dinonaktifkan dengan jumlah masalah yang menghalangi (misal "2 nama belum terdaftar").
  Jika episode sudah punya klip, `confirmDialog` bahaya menyebut jumlah klip dan hasil media yang dilepas.
  Setelah berhasil, tab pindah ke Storyboard.
- **Keadaan setelah dikonfirmasi** (tidak ada rencana aktif): tampilkan ringkasan naskah episode dari klip
  (hanya baca, tiap shot klik → kartu di Storyboard) dan tombol "Susun ulang dengan AI".

### Studio Episode — Storyboard

- Memakai `StoryboardStep.tsx` yang ada, ditambah per kartu klip:
  - badge status gambar dan video (tabel §3); badge Terblokir membuka `Popover` daftar alasan dan tombol menuju
    perbaikannya (misal "Buat lembar Lokasi Lobi");
  - chip kostum, lokasi, prop, pembicara (aturan no. 7);
  - balon ucapan dengan ikon sumber suara (video / TTS / tanpa suara);
  - untuk klip dialog dari video: tombol "Buat video" dengan keterangan bahwa suara ikut dibuat, dan tanpa tombol
    "Buat suara".
- **Bar atas**: tombol "Tulis prompt visual" (hanya untuk klip yang prompt-nya kosong), "Buat yang belum ada"
  (gambar / video / suara narator), filter status (Semua · Belum ada · Basi · Terblokir).
- **Dialog estimasi batch** (`Modal`): jumlah item per jenis, perkiraan kredit per jenis dan total, model yang
  dipakai. Jika ada item terblokir: tombol jalankan nonaktif, daftar item terblokir dengan alasan dan tautan ke
  kartunya.

### Studio Episode — Editor

- `EditorStep.tsx` yang ada untuk episode aktif; sidebar otomatis ciut (lihat Kerangka).
- Klip dialog dari video menampilkan suaranya di track suara seperti klip lain; inspector menyebut sumber suara
  "Dari video" dan menonaktifkan rekam ulang suara dengan tooltip "Ubah kalimat lalu buat ulang video".
- Tombol **Render Episode** membuka `ExportDialog.tsx` dengan nama file bawaan `<Judul Serial> - Ep <N>.mp4`.

### Verifikasi tampilan

Setiap fase yang mengubah layar menyertakan skrip dev harness yang mengambil screenshot di 1180×720 dan 1600×900,
tema terang dan gelap, dan memeriksa isi halaman lewat `console.log` (sesuai `docs/pengembangan.md`).

---

## 5. Perubahan Skema Database

Satu migrasi baru ditambahkan di akhir `MIGRATIONS` (`src/main/db/index.ts`). `foreign_keys = ON` sudah aktif.

```sql
-- Serial: sumber cerita dan cara suara dialog dibuat.
ALTER TABLE projects ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'novel';      -- novel | screenplay
ALTER TABLE projects ADD COLUMN dialog_audio TEXT NOT NULL DEFAULT 'video';     -- video | tts

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_num INTEGER NOT NULL,             -- ID internal, tidak dipakai ulang; urutan tayang = sort
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  story_beats_json TEXT NOT NULL DEFAULT '[]',
  cliffhanger TEXT NOT NULL DEFAULT '',
  next_teaser TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',     -- potongan sumber episode ini (hasil planner atau diisi sendiri)
  source_kind TEXT,                         -- NULL = ikut proyek
  script_draft_json TEXT,                   -- rencana isi yang belum dikonfirmasi (§8.B); hanya nama, tanpa ID aset
  status TEXT NOT NULL DEFAULT 'draft',
  duration_sec INTEGER NOT NULL DEFAULT 75,
  sort INTEGER NOT NULL DEFAULT 0,
  editor_json TEXT,                         -- NULL = pakai projects.editor_json
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX episodes_project ON episodes(project_id, sort);

-- Setiap proyek lama menjadi serial dengan satu episode. Editor, status, dan durasinya pindah ke episode itu
-- agar timeline lama (musik, overlay, SFX, framing) tetap utuh. Proyek lama memakai TTS untuk semua suara.
INSERT INTO episodes (id, project_id, episode_num, title, summary, status, duration_sec, sort, editor_json, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), id, 1, title, synopsis,
    CASE WHEN status IN ('draft','script','storyboard','editing','exported') THEN status ELSE 'editing' END,
    duration_sec, 0, editor_json, created_at, updated_at
  FROM projects;
UPDATE projects SET dialog_audio = 'tts';

ALTER TABLE clips ADD COLUMN episode_id TEXT REFERENCES episodes(id) ON DELETE CASCADE;
UPDATE clips SET episode_id = (SELECT e.id FROM episodes e WHERE e.project_id = clips.project_id);
CREATE INDEX clips_episode ON clips(episode_id, sort);

-- Shot drama.
ALTER TABLE clips ADD COLUMN emotion TEXT NOT NULL DEFAULT '';
ALTER TABLE clips ADD COLUMN costume_ids TEXT NOT NULL DEFAULT '{}';   -- { [characterId]: derivativeId }
ALTER TABLE clips ADD COLUMN location_id TEXT;
ALTER TABLE clips ADD COLUMN prop_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE clips ADD COLUMN framing TEXT NOT NULL DEFAULT '';         -- close-up, medium, wide, ...
ALTER TABLE clips ADD COLUMN source_excerpt TEXT NOT NULL DEFAULT '';  -- kutipan sumber, untuk tinjau dan buat ulang

-- Karakter: gaya suara (dipakai prompt video) dan alias (dipakai AI mengenali nama lain).
ALTER TABLE characters ADD COLUMN voice_style TEXT NOT NULL DEFAULT '';
ALTER TABLE characters ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';

-- Varian kostum: tabel sendiri karena lembar referensinya adalah aset milik main process.
CREATE TABLE character_derivatives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                        -- unik per karakter (tanpa beda huruf besar/kecil)
  prompt_change TEXT NOT NULL DEFAULT '',
  sheet_asset_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX character_derivatives_character ON character_derivatives(character_id, sort);

-- "locations", bukan "scenes": di kode, scene/adegan sudah berarti klip (ScriptScene).
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  sheet_asset_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX locations_project ON locations(project_id, sort);

CREATE TABLE props (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  sheet_asset_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX props_project ON props(project_id, sort);

-- Pemilik aset dan job yang baru.
ALTER TABLE assets ADD COLUMN derivative_id TEXT;
ALTER TABLE assets ADD COLUMN location_id TEXT;
ALTER TABLE assets ADD COLUMN prop_id TEXT;
ALTER TABLE assets ADD COLUMN episode_id TEXT;   -- musik/SFX/overlay milik satu episode
ALTER TABLE jobs ADD COLUMN episode_id TEXT;
```

Catatan:
- `clips.episode_id` di SQLite tetap nullable (`ADD COLUMN` dengan `REFERENCES` harus default NULL), tetapi setelah
  migrasi setiap klip punya episode dan kode baru selalu mengisinya. Tipe `Clip.episodeId` di TypeScript `string`.
- `costume_ids`, `prop_ids`, `location_id`, dan `script_draft_json` tidak menyimpan ID aset, jadi aman ditulis renderer.
- Proyek lama mendapat `dialog_audio = 'tts'` agar suaranya tidak berubah; proyek baru default `'video'`.
- Kolom lama yang tidak dipakai lagi (`projects.step`, `projects.story_plan_json` versi hook) **tidak dihapus**;
  kode hanya berhenti membacanya.
- Nilai `status` proyek lama perlu dicek di kode sebelum migrasi ditulis; pemetaan `CASE` di atas adalah jaring
  pengaman, bukan daftar final.
- Hash basis hasil (§6.J) disimpan di `assets.meta_json`, tidak perlu kolom baru.

---

## 6. Aturan Arsitektur Kritis

### A. Isolasi klip per episode

| Fungsi | Sekarang | Menjadi |
|---|---|---|
| `getBundle` (`repo.ts`) | semua klip proyek | klip episode aktif (`getBundle(projectId, episodeId)`) |
| `saveSnapshot` | `DELETE FROM clips WHERE project_id = ?` | `... AND episode_id = ?` |
| `replaceScript` | hapus semua klip proyek | diganti konfirmasi rencana (§8.B), hanya klip episode itu |
| `replaceStory` (dev harness) | hapus semua klip dan karakter | klip episode saja; karakter tidak dihapus |
| `clipsOf` / `generateNarration` / `syncCaptions` / `generateVisuals` / estimasi kredit | per proyek | per episode |
| `insertClipAfter`, `addClip` (store) | — | mewarisi `episodeId` |
| `duplicateProject` | salin klip | salin semua tabel baru; petakan ulang semua ID (§6.E) |

Karakter, varian, lokasi, dan prop tetap per proyek. Penghapusan karakter di `saveSnapshot` tetap memakai daftar
karakter lengkap proyek, karena renderer selalu memuat seluruh Lorebook.

### B. Kepemilikan aset

Tautan aset (`sheet_asset_id`, `image_asset_id`, `video_asset_id`, `audio_asset_id`) **hanya ditulis main process**
dan tidak ikut `saveSnapshot`. Varian kostum, lokasi, dan prop punya tabel sendiri dengan kolom `sheet_asset_id`.
Hasil job baru dikirim lewat event dan di-rebase ke riwayat undo, sama seperti lembar karakter sekarang.

### C. Suara: satu klip, satu pemilik suara

Satu klip = satu shot = paling banyak satu ucapan (`clip.narration` + `clip.speakerId` + `clip.emotion`). Pemilik
suara klip diturunkan, tidak disimpan:

| Klip | Pemilik suara | Cara dibuat |
|---|---|---|
| `speakerId` terisi, `dialog_audio = 'video'` | **dialog dari video** | kalimat masuk prompt video; model video menyuarakan dan menggerakkan bibir |
| `speakerId` terisi, `dialog_audio = 'tts'` | dialog TTS | seperti sekarang (tanpa lip-sync) |
| `speakerId` kosong, `narration` terisi | narator / suara batin | TTS; video dibuat tanpa suara |
| `narration` kosong | tanpa suara | shot reaksi/suasana |

Karena satu klip hanya punya satu ucapan, dialog dan narasi tidak pernah bercampur dalam satu permintaan video
(ArcReel ADR 0089). Dua orang bicara dalam satu momen dipecah jadi dua klip.

**Dialog dari video — alur:**
1. Syarat: model video proyek mendukung suara (Veo 3.1 lewat Flow2API; model Higgsfield yang punya
   `generate_audio`). Katalog mendapat flag `nativeAudio`. Model tanpa suara → klip dialog **terblokir** dengan
   pesan yang menyarankan ganti model atau beralih ke `dialog_audio = 'tts'`.
2. Pembicara wajib ada di `characterIds` dan terlihat di gambar storyboard (model akan membuat orang yang terlihat
   yang berbicara). Penyimpanan tetap diizinkan, generate yang diblokir.
3. Prompt video memuat: kalimat persis dalam tanda kutip, siapa yang mengucapkan, `emotion`, dan
   `characters.voice_style` (misal "pria 30-an, suara berat dan tenang") agar warna suara antar-shot dijaga.
   Penutup `NO_MUSIC` diganti varian dialog: hanya suara ucapan, tanpa musik latar dan tanpa nyanyian.
   `generate_audio`/`sound` tidak dimatikan untuk klip ini.
4. Setelah video selesai, main process **mengekstrak track audio** video dengan FFmpeg menjadi aset `audio` milik
   klip itu, lalu menjalankan Whisper untuk waktu per kata (ejaan tetap dari naskah lewat `align.ts`). Aset ini
   dipasang ke `clip.audioAssetId` dengan `meta.source = 'video'`.
5. Engine pemutaran, waveform, caption, ducking musik, dan exporter tidak berubah: mereka tetap membaca
   `audioAssetId`. Audio di dalam file video tetap tidak pernah dipakai langsung.
6. Durasi: klip dialog memakai durasi pilihan model (Veo: 4/6/8 detik). Panjang ucapan diperkirakan
   (`estimateNarrationMs`); kalau melebihi durasi terpilih, durasi dinaikkan ke pilihan berikutnya, dan kalau
   melebihi pilihan terpanjang, klip harus dipecah (terblokir sampai diperbaiki).
7. Memperbaiki kalimat berarti membuat ulang video. Tombol "Buat ulang suara" tidak ada untuk klip dialog dari video.

**Keputusan teknis yang diubah:** "Prompt video selalu melarang musik ... Audio dari file video tidak pernah dipakai
di ekspor" diperbarui: untuk klip dialog dari video, model diminta bersuara (tetap tanpa musik), dan suaranya
diekstrak menjadi aset audio klip. Catat ini di `docs/keputusan-teknis.md` saat fase 4.

**Narator / TTS — cara merekam** (menjaga keputusan "narasi direkam satu kali utuh"): `parts()` di `narration.ts`
memotong take setiap kali suara berganti. Pengelompokan diganti: klip TTS satu episode dikelompokkan **per suara**
(semua kalimat narator dalam Ep 1 menjadi satu take dengan `<long pause>`), lalu dipotong per klip dengan jalur
Whisper/`cutsFromWords` yang sama. Batas panjang take tetap berlaku. Klip dialog dari video dilewati.

**Risiko yang diterima:** warna suara satu tokoh bisa sedikit berbeda antar-shot (Veo tidak menerima rekaman suara
referensi), dan model bisa menambahkan suara latar. Fase 4 dimulai dengan sampel kecil (§10) untuk menilai mutu
dialog bahasa Indonesia sebelum generate massal.

### D. Pengaturan editor per episode

- `episodes.editor_json` NULL berarti episode memakai `projects.editor_json` sebagai template.
- Begitu episode diedit di Editor, salinannya disimpan ke `episodes.editor_json`. `clipFraming`, `musicAssetId`,
  `overlays`, dan `sfx` adalah milik episode itu.
- `saveSnapshot` menulis `editor_json` ke episode aktif. `projects.editor_json` hanya diubah lewat pengaturan serial.

### E. Arti kolom proyek dan duplikasi

- `projects.step` tidak dipakai; navigasi per episode lewat `episodes.status`.
- `projects.status` = status serial, dihitung dari episodenya.
- `projects.duration_sec` = target durasi default per episode; `aspect_ratio` default `9:16` untuk proyek baru.
- `projects.synopsis` = sinopsis serial; `projects.source_text` = sumber utuh.

`duplicateProject` memetakan ulang ID di: `episodes`, `clips.episode_id`, `character_derivatives`, `locations`,
`props`, `clips.costume_ids` (kunci dan nilai), `clips.location_id`, `clips.prop_ids`, kolom pemilik baru di
`assets`, dan isi `episodes.editor_json`.

### F. Kode yang dihapus

Bersamaan dengan fase 2:
- Halaman langkah Ide dan Naskah, stepper 4 langkah, dan pemilihan durasi 1–30 menit.
- Di `story.ts`: alur hook, kerangka babak/bab, penulisan naskah per kelompok untuk video panjang. Bagian yang masih
  berguna (pemanggil LLM, parsing JSON, pemetaan nama karakter, `ensureSpeaker`, prompt musik) dipakai ulang.
- `narrationSplit.ts` dihapus jika tidak ada pemakai lagi.
- Entri `docs/keputusan-teknis.md` yang tidak berlaku lagi ditandai usang dengan alasan, bukan dihapus diam-diam.
  `docs/alur-produksi.md` dan peta kode di `AGENTS.md` ditulis ulang.

### G. Varian kostum (sub-identitas karakter)

- Varian berbagi nama, suara, gaya suara, dan alias dengan karakter induknya; `speakerId` selalu menunjuk karakter
  induk, tidak pernah varian.
- **Lembar varian dibuat dengan mengedit lembar dasar** (image-to-image dengan `prompt_change` sebagai instruksi).
  Tanpa lembar dasar, lembar varian tidak bisa dibuat.
- Lembar varian bisa diganti dengan **upload** sendiri; lembar hasil upload tidak pernah dianggap basi.
- Lembar varian hasil generate menjadi **basi** jika lembar dasar dibuat ulang atau `prompt_change` diubah (§6.J);
  tidak dibuat ulang otomatis.
- Di prompt, tampilan tokoh = deskripsi dasar + `prompt_change` varian.

### H. Gabung dan hapus aset

ReelStar memakai ID (bukan nama seperti ArcReel), jadi penggantian nama tidak perlu menulis ulang naskah.
- **Gabung** (karakter, lokasi, prop) ke aset sejenis yang dipertahankan: semua rujukan di klip
  (`characterIds`, `speakerId`, `costumeIds`, `locationId`, `propIds`) dan di `script_draft_json` (berdasarkan nama)
  diarahkan ke aset yang dipertahankan; nama dan alias aset yang digabung menjadi alias. Varian ikut pindah; varian
  bernama sama digabung. Karakter juga bisa digabung **sebagai varian** dari karakter lain.
- Sebelum konfirmasi, dialog menampilkan per episode berapa rujukan yang diubah dan berapa gambar/video yang
  menjadi basi.
- **Hapus**: dialog menunjukkan episode mana yang masih merujuk aset itu dan menawarkan "Gabungkan saja". Rujukan
  tidak ditulis ulang; klip yang merujuk aset terhapus menjadi terblokir saat generate.
- Lembar dan file aset yang digabung/dihapus tidak dihapus dari disk saat itu juga (bisa dipulihkan lewat undo
  selama aplikasi terbuka); pembersihan file yatim dilakukan saat proyek dibuka berikutnya.

### I. Syarat sebelum generate

Generate (per klip atau massal) ditolak dengan alasan yang jelas jika:
- klip merujuk karakter, varian, lokasi, atau prop yang tidak terdaftar atau belum punya lembar referensi;
- durasi klip bukan salah satu durasi yang didukung model video (`durations` di katalog: daftar nilai untuk
  Flow2API, daftar nilai atau rentang `min`–`max` untuk Higgsfield);
- klip dialog dari video tidak memenuhi §6.C (model tanpa suara, pembicara tidak terlihat, ucapan terlalu panjang);
- ada job lain yang sedang berjalan untuk hasil yang sama.

Saat menulis dan mengedit, aturan ini hanya berupa peringatan; yang diblokir hanya pengeluaran kredit.

### J. Status hasil dan biaya

Setiap hasil berbayar (lembar aset, gambar storyboard, video, audio) menyimpan **hash basis** di `assets.meta_json`:
hash dari input langsungnya (prompt terkompilasi, ID dan hash lembar referensi, teks ucapan, durasi, model).
Statusnya dihitung saat dibaca, tidak disimpan:
- **Terkini**: hash basis sama dengan input sekarang.
- **Basi**: hasil ada dan tetap bisa dipakai/diekspor, tetapi inputnya sudah berubah.
- **Belum ada**: tidak ada hasil.
- **Terblokir**: syarat §6.I tidak terpenuhi.

Fungsi hash ditulis sekali di `src/shared/` agar Storyboard, estimasi, dan generator memakai aturan yang sama.

- "Buat yang belum ada" hanya mengisi hasil berstatus belum ada; hasil basi dibuat ulang hanya jika dipilih.
- Sebelum batch, tampilkan jumlah item dan **estimasi kredit** per jenis. Jika ada satu item terblokir, **seluruh
  batch tidak dijalankan** dan setiap item yang bermasalah ditampilkan dengan alasannya.
- Header serial menampilkan total kredit yang sudah dipakai per episode (dari job yang selesai).

### K. Kolom klip dan IPC baru (aturan AGENTS.md no. 4 dan 5)

Kolom klip baru (`episodeId`, `emotion`, `costumeIds`, `locationId`, `propIds`, `framing`, `sourceExcerpt`)
ditambahkan di: tipe `Clip`, migrasi, `toClip`, upsert `saveSnapshot`, `duplicateProject`, `insertClipAfter`,
`CLIP_COLS`, nilai bawaan `addClip`, dan daftar `Omit` di `StoryClip`.

IPC baru (masing-masing di `ipc.ts`, `shared/api.ts`, `preload/index.ts`):
`episodes:list/create/update/remove/reorder`, `lorebook:derivatives/locations/props` (CRUD),
`lorebook:merge`, `lorebook:references`, `story:planEpisodes`, `story:planEpisodeScript`,
`story:confirmEpisodeScript`, `story:writePrompts`, `generation:derivativeSheet/locationSheet/propSheet`,
`generation:batchEstimate`. `projects:get` menerima `episodeId` opsional. IPC alur narasi dihapus dari ketiga tempat.

---

## 7. Tipe Baru (`src/shared/types.ts`)

```typescript
export type SourceKind = 'novel' | 'screenplay'
export type DialogAudio = 'video' | 'tts'
export type EpisodeStatus = 'draft' | 'planned' | 'script' | 'storyboard' | 'editing' | 'exported'
export type ResultStatus = 'current' | 'stale' | 'missing' | 'blocked'

export interface Episode {
  id: string
  projectId: string
  episodeNum: number        // ID internal; tampilan "Ep N" dihitung dari urutan sort
  title: string
  summary: string
  hook: string
  storyBeats: string[]
  cliffhanger: string
  nextTeaser: string
  sourceText: string
  sourceKind: SourceKind | null
  status: EpisodeStatus
  durationSec: number
  sort: number
  editor: EditorSettings | null
  createdAt: number
  updatedAt: number
}

/** Rencana isi satu episode sebelum dikonfirmasi. Semua rujukan memakai nama, bukan ID. */
export interface EpisodeScriptDraft {
  shots: DraftShot[]
  newAssets: NewAssetProposal[]
  createdAt: number
}

export interface DraftShot {
  title: string
  sourceExcerpt: string
  visualAction: string
  characters: string[]
  costumes: Record<string, string>   // nama karakter -> nama varian
  location: string | null
  props: string[]
  speaker: string | null             // null = narator / tanpa suara
  text: string
  emotion: string
  framing: string
  durationSec: number
}

export interface NewAssetProposal {
  kind: 'character' | 'derivative' | 'location' | 'prop'
  name: string
  description: string
  action: 'create' | 'merge' | 'derivative' | 'ignore'
  target?: string                    // aset yang dituju untuk merge/derivative
  reason: string
}

export interface CharacterDerivative {
  id: string
  projectId: string
  characterId: string
  name: string
  promptChange: string
  sheetAssetId: string | null
  sort: number
}

export interface Location {
  id: string
  projectId: string
  name: string
  description: string
  aliases: string[]
  sheetAssetId: string | null
  sort: number
}

export interface Prop {
  id: string
  projectId: string
  name: string
  description: string
  aliases: string[]
  sheetAssetId: string | null
  sort: number
}

// Tambahan pada Clip: episodeId, emotion, costumeIds, locationId, propIds, framing, sourceExcerpt
// Tambahan pada Character: voiceStyle: string, aliases: string[]
// Tambahan pada Asset: derivativeId, locationId, propId, episodeId (string | null)
// Tambahan pada Project: sourceText, sourceKind, dialogAudio
// Tambahan pada ExportOptions: episodeId: string
// Project: field step dan storyPlan versi hook/babak dihapus dari tipe
```

---

## 8. Logika Naskah & Prompt

### A. AI Episode Planner (sumber → daftar episode)

- **Sumber**: `projects.source_text` dengan `source_kind`:
  - `novel`: AI mengadaptasi (boleh menyusun ulang adegan dan menulis dialog).
  - `screenplay`: **ambil apa adanya** — pembagian episode, dialog, dan narasi dari penulis dipertahankan kata per
    kata; AI hanya merapikan menjadi shot.
- Episode juga bisa dibuat manual dengan `source_text` sendiri, atau tanpa sumber (ditulis langsung di tab Rencana).
- **Teks panjang** diproses per jendela: setiap batch merencanakan episode yang alurnya utuh di dalam jendela,
  hanya menyimpan sampai titik potong terakhir yang yakin, dan sisanya dibaca batch berikutnya. Output divalidasi
  (kolom wajib, potongan sumber berurutan dan tidak tumpang tindih); jika gagal, dicoba ulang dengan alasan
  kegagalannya. Progres per batch dikirim ke UI. "Lanjutkan perencanaan" mulai dari akhir episode terakhir.
- **Output per episode** (disimpan ke `episodes`, status `planned`, bisa diedit):
  ```json
  {
    "title": "Penghinaan di Lobi",
    "summary": "Satria yang menyamar sebagai satpam diremehkan, namun kedatangan konvoi rahasia memicu tanda tanya.",
    "hook": "Satria disiram kopi panas oleh manajer lobi di depan umum.",
    "story_beats": ["Satria dihina manajer", "Alina diam-diam membela", "Konvoi Mahardika tiba"],
    "cliffhanger": "Sebuah Rolls-Royce berplat kehormatan keluarga Mahardika berhenti di depan lobi.",
    "next_teaser": "Siapa sebenarnya satpam itu?",
    "target_duration_sec": 75,
    "source_excerpt": "…potongan teks sumber untuk episode ini…"
  }
  ```

### B. Naskah dua tahap dengan langkah tinjau

**Tahap 1 — Rencana isi** (`story:planEpisodeScript`): AI menulis `EpisodeScriptDraft` ke `episodes.script_draft_json`.
Konteks yang dikirim:
- kerangka episode ini (hook, story beats, cliffhanger) dan `source_text`-nya;
- **episode sebelumnya**: ringkasan, cliffhanger (harus dijawab oleh hook episode ini), dan varian kostum terakhir
  tiap tokoh;
- **episode berikutnya**: judul, hook, dan story beats, agar akhir episode ini mengarah ke sana;
- Lorebook: nama, alias, deskripsi singkat karakter/varian/lokasi/prop yang sudah terdaftar.

Aturan isi:
- shot-reverse-shot: sekitar 80% shot percakapan adalah close-up pembicara atau reaksinya;
- satu shot paling banyak satu ucapan; pembicara harus terlihat di shot dialog;
- **kostum bawaan per tokoh per episode**; kostum per shot hanya berbeda jika cerita memang berganti busana;
- durasi shot dipilih dari durasi yang didukung model video proyek;
- shot pertama memuat hook, shot terakhir memuat cliffhanger.

**Tinjau** (tab Rencana & Tinjau): semua kolom setiap shot bisa diedit (durasi dari pilihan model; pembicara dari
karakter terdaftar atau usulan baru; rujukan dari aset terdaftar atau usulan baru). Panel **Aset baru di episode
ini** menampilkan setiap usulan dengan tindakan AI (buat baru / gabung ke aset lama / jadikan varian / abaikan) dan
alasannya; pengguna bisa mengubahnya.

**Konfirmasi** (`story:confirmEpisodeScript`), dalam satu transaksi:
1. daftarkan aset baru sesuai tindakan yang dipilih (aset bernama persis sama dengan aset terdaftar selalu digabung);
2. tolak konfirmasi jika masih ada rujukan ke nama yang tidak terdaftar dan tidak diusulkan, dengan daftar shot
   dan namanya;
3. ganti klip episode ini dengan shot dari rencana (nama → ID). Jika episode sudah punya klip, dialog konfirmasi
   (gaya bahaya) menyebut klip dan hasil media yang akan dilepas; asetnya tetap di proyek, tidak dihapus;
4. kosongkan `script_draft_json`, status episode menjadi `script`.

Setelah konfirmasi, klip adalah satu-satunya sumber isi episode. Menyusun ulang seluruh episode = buat rencana baru
lalu konfirmasi lagi.

**Tahap 2 — Prompt visual** (`story:writePrompts`): AI hanya mengisi `visualPrompt` dan `videoPrompt` untuk klip
yang masih kosong (atau yang dipilih pengguna). Teks ucapan, pembicara, dan emosi diteruskan apa adanya, tidak
ditulis ulang.

### C. Prompt visual (memakai format berlabel yang ada)

Prompt mengisi struktur `clipPrompt` di `generation.ts` (lihat keputusan "Prompt visual berlabel dan baris Wardrobe"):
- **Subjek**: karakter yang terlihat (`characterIds`).
- **Wardrobe**: deskripsi dasar + `promptChange` varian dari `costumeIds`.
- **Aksi & emosi**: aksi visual + `emotion`.
- **Lokasi & suasana**: deskripsi lokasi, pencahayaan, komposisi vertikal 9:16, dan prop.

Di UI, rujukan tampil sebagai chip `@[Satria/Seragam Satpam]` dan `@[Lobi Kantor]`; ini hanya tampilan dari ID yang
tersimpan, bukan teks yang diurai dari prompt.

**Prompt video**: gerak subjek + interaksi objek + gerak kamera. Untuk klip dialog dari video, ditambah blok ucapan
(§6.C langkah 3) dan penutup varian dialog; selain itu tetap `NO_MUSIC`.

**Gambar referensi** dibatasi `maxRefs(model)`. Urutan prioritas:
1. lembar varian kostum tokoh fokus/pembicara (atau lembar dasar jika tanpa varian);
2. lembar karakter lain yang terlihat;
3. lembar lokasi;
4. lembar prop.

Aturan ini ditulis sekali di `src/shared/` agar estimasi kredit, hash basis, dan generator memakai urutan yang sama.

### D. Lembar referensi

- **Karakter**: tiga tampak (depan, samping, belakang) dalam satu gambar, latar polos.
- **Varian**: hasil edit lembar karakter (§6.G), tata letak sama.
- **Lokasi** dan **prop**: satu gambar tunggal, tanpa orang.

---

## 9. Pratinjau & Ekspor

1. Memilih episode memuat bundle episode itu (`getBundle(projectId, episodeId)`) ke store `project.ts`.
2. Player 9:16 memutar klip berurutan; panduan Safe Zone yang ada membantu menjaga caption di area aman.
3. Suara per klip (dialog hasil ekstraksi video atau TTS) ada di track suara utama; ducking musik memakai pengaturan
   yang sudah ada.
4. **Render Episode** memanggil `export:start(projectId, { ...opts, episodeId })`. Cache render bertahap memakai kunci
   yang mencakup `episodeId`. Nama file bawaan: `<Judul Serial> - Ep <N>.mp4`. Setelah berhasil,
   `episodes.status = 'exported'`.

---

## 10. Fase Pengerjaan

Setiap fase harus lolos `npm run typecheck`, `npm run build`, dan skrip dev harness sendiri dengan
`STUDIO_USER_DATA` sementara.

| Fase | Isi | Selesai jika |
|---|---|---|
| **1. Fondasi episode** | Migrasi (§5), isolasi klip (§6.A), `duplicateProject`, `editor_json` per episode, ekspor per episode. UI lama sementara membuka episode pertama. | Salinan database proyek lama yang punya musik/overlay/SFX: setelah migrasi, timeline dan hasil ekspornya sama (durasi video = audio, cuplikan frame cocok). Proyek dengan 2 episode: menyimpan Ep 2 tidak mengubah klip Ep 1 (cek lewat `console.log`). |
| **2. Studio Hub & Lorebook** | Layout Opsi A, CRUD dan urutan episode, varian kostum (§6.G), lokasi, prop, lembar referensi (§8.D), alias, gabung/hapus (§6.H); hapus kode alur narasi (§6.F) | Proyek lama terbuka sebagai Ep 1; lembar varian dari edit lembar dasar dan tidak hilang setelah autosave/undo; gabung dua karakter memindahkan semua rujukan klip; `typecheck` bersih. |
| **3. Planner & naskah dua tahap** | Sumber novel/naskah jadi, planner bertahap (§8.A), rencana isi + konteks antar-episode, tab Rencana & Tinjau, usulan aset baru, konfirmasi (§8.B) | Novel contoh dipecah jadi episode berkerangka; naskah jadi contoh mempertahankan dialog kata per kata; rencana Ep 2 menjawab cliffhanger Ep 1; konfirmasi menolak nama tak terdaftar dan mendaftarkan aset baru. |
| **4. Prompt, suara & generate** | Prompt visual (§8.C), syarat generate (§6.I), dialog dari video + ekstraksi audio + Whisper (§6.C), take TTS per suara untuk narator, hash basis & status (§6.J), batch + estimasi kredit | Dimulai dengan sampel: 2 tokoh, 4 shot dialog Veo bahasa Indonesia — suara bisa dimengerti, bibir cocok, caption sesuai kata. Lalu: ubah `prompt_change` → hasil terkait menjadi basi; batch dengan satu klip terblokir tidak menjalankan apa pun. |
| **5. Opsional (dari ArcReel dan fork)** | Speed ramp untuk menyamakan durasi video dan suara; menyambung frame terakhir shot ke frame awal shot berikutnya; Magic Wand perbaikan prompt; tombol cepat gerak kamera; auto-draft 1 klik (rencana → konfirmasi → prompt → generate dengan satu persetujuan biaya); preset subtitle kreatif; ekspor draft CapCut; storyboard grid; video dari gambar referensi tanpa storyboard; pemeriksaan otomatis video (layar hitam, gambar macet); riwayat versi gambar/video dengan rollback; lip-sync dari TTS lewat model ber-`audio_url` sebagai alternatif `dialog_audio = 'tts'` | Diprioritaskan setelah fase 4 dipakai pada satu serial nyata. |

Setelah setiap fase, catat keputusan baru di `docs/keputusan-teknis.md` dan perbarui `docs/data-model.md`.

---

## 11. Keputusan Terbuka

- **K3 — Konsistensi suara dialog antar-shot.** Veo hanya dipandu `voice_style` di prompt. Jika hasil sampel fase 4
  terlalu berubah-ubah, pilihan berikutnya: model video yang menerima rekaman suara referensi, atau
  `dialog_audio = 'tts'` + lip-sync berbasis `audio_url` (fase 5).
- **K4 — Suara latar dari model video.** Jika Veo tetap menambahkan musik/ambient di klip dialog walau dilarang,
  pertimbangkan pemisahan vokal saat ekstraksi audio. Diputuskan setelah sampel fase 4.
