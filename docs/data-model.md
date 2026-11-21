# Model data

Tipe TypeScript-nya ada di `src/shared/types.ts`; skema SQLite di `src/main/db/index.ts`; akses database di
`src/main/repo.ts`. Kolom database memakai `snake_case`, properti TypeScript memakai `camelCase`.

## Tabel

| Tabel | Isi |
|---|---|
| `projects` | satu baris per proyek; pengaturan editor disimpan sebagai JSON di `editor_json` |
| `episodes` | serial episode per proyek, masing-masing memiliki naskah, status, dan `editor_json` terpisah |
| `clips` | adegan/klip berurutan (`sort`) dalam episode (`episode_id`) |
| `characters` | pemeran proyek + lembar karakternya (`sheet_asset_id`), `voice_style`, dan `aliases` |
| `character_derivatives` | varian kostum atau ekspresi karakter per proyek |
| `locations` | lokasi/latar cerita per proyek |
| `props` | barang/properti kunci per proyek |
| `assets` | setiap file: gambar, video, audio narasi, musik, overlay, ekspor; menyimpan `local_path` relatif |
| `jobs` | pekerjaan AI/render beserta status dan progresnya |
| `settings` | pengaturan aplikasi (key → JSON) |
| `secrets` | kunci API terenkripsi + hasil tes terakhir |
| `cache` | cache bebas (daftar model, estimasi kredit, daftar suara), dengan `updated_at` |

Relasi `project_id` dan `episode_id` memakai `ON DELETE CASCADE`. Tidak ada foreign key antara klip dan aset; klip menunjuk aset
lewat `image_asset_id`, `video_asset_id`, `audio_asset_id`. Aset lama tetap tersimpan sebagai riwayat versi.

## Migrasi

`MIGRATIONS` adalah array SQL. Saat database dibuka, setiap migrasi setelah `PRAGMA user_version` dijalankan
dalam transaksi, lalu `user_version` dinaikkan.

| # | Isi |
|---|---|
| 1 | Skema awal (semua tabel di atas kecuali `cache`) |
| 2 | Tabel `cache` |
| 3 | `projects.video_model` |
| 4 | `clips.story`, `clips.visual_source`; langkah lama digeser karena langkah Naskah disisipkan |
| 5 | `projects.video_resolution` |
| 6 | `clips.video_camera`, `video_strength`, `transition_ms`, `voice_gain_db` |
| 7 | `clips.media_in_ms`, `voice_in_ms`, `voice_out_ms`, `voice_start_ms` |
| 8 | `clips.filter` |
| 9 | `characters.tts_voice` |
| 10 | `clips.speaker_id`, `characters.tts_provider` |
| 11 | `projects.story_plan_json` untuk hook dan kerangka cerita yang ditinjau |
| 12 | Studio multi-episode: `episodes` + backfill Episode 1; kolom drama `clips` (`episode_id`, `emotion`, `costume_ids`, `location_id`, `prop_ids`, `framing`, `source_excerpt`); tabel `character_derivatives`, `locations`, `props`; kolom aset & job `episode_id` |
| 13 | `projects.target_episode_count` untuk target jumlah episode serial |
| 14 | Fase 7 Lorebook: `profile_json` pada `characters`, `locations`, `props`; `costume_keyphrase` pada `character_derivatives` |
| 15 | Fase 7 Sinematografi & Arahan: `shot_detail_json` dan `continue_from_previous` pada `clips`; `series_guidelines` dan `prompt_templates_json` pada `projects` |

**Aturan:** tambahkan migrasi baru di akhir. Jangan mengubah migrasi yang sudah ada, karena pengguna lama sudah
menjalankannya.

## Proyek (`Project`)

| Properti | Arti |
|---|---|
| `title`, `synopsis` | judul (diisi AI saat menulis naskah) dan ide cerita |
| `sourceText`, `sourceKind` | bahan sumber serial (novel / naskah jadi) |
| `dialogAudio` | mode suara serial: `video` (suara bawaan video Veo/Sora) atau `tts` (suara narasi/karakter dipotong) |
| `storyPlan` | plan cerita JSON sebelum naskah dibuat: gaya narasi, judul, pertanyaan, pembuka, bab (ringkasan, detail kunci, `beats`, sasaran adegan), penutup, hal yang dihindari, sifat isi, serta fakta untuk dicek. Field baru bersifat opsional agar plan lama (`hook` + `brief` + babak) tetap terbaca; dinormalisasi saat naskah dibuat. |
| `durationSec`, `language`, `aspectRatio` | target durasi, bahasa naskah/suara, `16:9` atau `9:16` |
| `targetEpisodeCount` | target jumlah episode untuk planner; null = "Otomatis" (planner mengikuti panjang sumber, seperti proyek lama) |
| `seriesGuidelines` | instruksi / batasan panduan gaya, nada cerita, atau aturan semesta serial dari kreator |
| `promptTemplates` | kamus kustomisasi template prompt AI (`PromptTemplateKey` → template string) |
| `styleId` | gaya visual (`src/shared/styles.ts`, 24 gaya) |
| `ttsProvider`, `ttsVoice` | `gemini` atau `elevenlabs` + ID suara |
| `imageModel`, `videoModel`, `videoResolution` | model Higgsfield per proyek (null = bawaan aplikasi) |
| `status`, `step` | `draft`/`script`/`storyboard`/`editing`/`exported`; langkah 1 Ide, 2 Naskah, 3 Storyboard, 4 Editor |
| `coverAssetId` | gambar sampul kartu proyek |
| `editor` | `EditorSettings` (JSON), bawaan proyek/fallback untuk episode |

## Episode (`Episode`)

Satu episode = satu bab/bagian serial dengan naskah, durasi target, status produksi, dan pengaturan timeline terpisah (`editor_json`).

| Properti | Arti |
|---|---|
| `projectId` | relasi ke proyek serial |
| `episodeNum`, `sort` | nomor episode (1..N) dan urutan di serial |
| `title`, `summary` | judul episode dan ringkasan isi |
| `hook`, `cliffhanger`, `nextTeaser` | hook pembuka, cliffhanger penutup, dan teaser episode selanjutnya |
| `storyBeats` | daftar beat cerita yang direncanakan |
| `sourceText`, `sourceKind` | kutipan/potongan teks sumber khusus episode ini |
| `scriptDraft` | draft naskah dua tahap (adegan, pemeran, properti, lokasi, usulan aset baru) |
| `status` | status produksi episode (`draft`/`script`/`storyboard`/`editing`/`exported`) |
| `durationSec` | target durasi episode (detik, default 75) |
| `editor` | `EditorSettings` (JSON) per episode; menimpa pengaturan proyek untuk timeline dan caption |

## Klip (`Clip`)

Satu klip = satu adegan: gambar atau video, suara narasinya, dan geraknya. Klip selalu terisolasi per episode (`episodeId`).

| Properti | Arti |
|---|---|
| `episodeId` | ID episode pemilik klip (`ON DELETE CASCADE`) |
| `sort` | urutan di timeline (klip selalu bersambung tanpa celah) |
| `title`, `story`, `narration` | judul adegan, alur cerita (langkah Naskah), teks narasi (VO, boleh berisi tag `<short pause>` dll.) |
| `visualPrompt` | prompt gambar berlabel: `Setting:`, `Action:`, `Wardrobe:`, `Framing:`, `Avoid:` |
| `visualSource` | teks naskah saat rencana visual dibuat; kalau berbeda dari naskah sekarang, adegan perlu visual baru (`needsVisual`) |
| `characterIds` | pemeran yang tampil |
| `emotion`, `costumeIds` | emosi karakter pada adegan ini dan varian kostum per karakter |
| `locationId`, `propIds` | relasi ke Lorebook lokasi dan properti kunci yang digunakan |
| `framing`, `sourceExcerpt` | komposisi/tipe bidikan (CU, MS, WS, dll.) dan kutipan teks sumber |
| `durationMs` | panjang klip di timeline (diatur ulang ke panjang suara setiap narasi direkam) |
| `motionType` | `camera` (gerak kamera di atas gambar) atau `video` (video AI) |
| `cameraPreset`, `motionStrength` | gerak kamera untuk gambar: zoomin/zoomout/panleft/panright/kenburns/shake/static; halus/sedang/kuat |
| `videoPrompt` | arahan gerak untuk video AI |
| `videoCamera`, `videoStrength` | gerak kamera tambahan di atas video AI (`static` = tanpa gerak) |
| `transition`, `transitionMs` | transisi ke klip berikutnya (`fade`/`slideleft`/`zoomin`/`cut`) dan durasinya (null = 0,4 dtk) |
| `voiceGainDb` | volume suara klip ini (dB) |
| `mediaInMs` | titik mulai video di dalam filenya (tepi kiri klip video yang ditarik) |
| `voiceInMs`, `voiceOutMs`, `voiceStartMs` | potongan suara: bagian file yang dipakai (`out` null = sampai akhir) dan posisinya dari awal klip |
| `speakerId` | pemeran yang berbicara di adegan ini; `null` memakai narator proyek. `characterIds` tetap hanya menandai pemeran yang tampil |
| `shotDetail` | metadata sinematografi & suara shot (`cameraMotion`, `cameraReason`, `lighting`, `blocking`, `nonSpeakingReaction`, `sfxAmbience`, `speechDelivery`, `dialogueType`) |
| `continueFromPrevious` | apakah shot ini menyambung frame akhir video shot sebelumnya (ekstraksi frame `-0.1s` via FFmpeg untuk initial image model video) |
| `imageAssetId`, `videoAssetId`, `audioAssetId` | aset aktif (dimiliki proses utama, tidak ikut snapshot) |

Aturan potongan suara ada di `voiceSpan()` (`src/shared/timeline.ts`): suara yang melewati akhir klip dipotong.

### Menambah kolom klip

Tambahkan di semua tempat berikut, atau data akan hilang diam-diam:

1. `Clip` di `src/shared/types.ts`
2. Migrasi baru di `src/main/db/index.ts`
3. `toClip()` di `repo.ts` (beri nilai bawaan untuk baris lama, misalnya `r.kolom ?? 0`)
4. Upsert di `saveSnapshot()` (kolom INSERT, VALUES, `ON CONFLICT ... SET`, dan nilai bawaan saat `run`)
5. `duplicateProject()` dan `insertClipAfter()` di `repo.ts`
6. `CLIP_COLS` di `repo.ts` kalau proses utama perlu mengubahnya lewat `patchClip`
7. Nilai bawaan di `addClip` (`renderer/src/store/project.ts`)
8. `StoryClip` di `repo.ts` (daftar `Omit`) kalau kolom tidak berasal dari naskah AI

## Entitas Lorebook (`Character`, `CharacterDerivative`, `Location`, `Prop`)

Lorebook menyimpan bible konsistensi visual dan narasi dunia serial drama.

- **`Character`**: Memiliki `name`, `description`, `aliases`, `voiceStyle`, `sheetAssetId`, serta `profile` (`CharacterProfile`).
  - `profile.visual`: `CharacterVisualProfile` (usia, gender, bentuk wajah/mata, gaya rambut, postur tubuh, pakaian bawaan, ciri khas mencolok).
  - `profile.narrative`: `CharacterNarrativeProfile` (peran cerita, hasrat/tujuan, rahasia/konflik batin, busur karakter, pola bicara khas).
- **`CharacterDerivative`**: Varian kostum atau penampilan tokoh. Memiliki `characterId`, `name`, `promptChange`, `sheetAssetId`, dan `costumeKeyphrase`.
  - `costumeKeyphrase`: frasa jangkar deskriptif singkat (misal *"jas wol hitam bergaris emas"*) untuk mengunci prompt visual dan video agar AI tidak melenceng.
- **`Location`**: Latar dan lokasi adegan. Memiliki `name`, `description`, `aliases`, `sheetAssetId`, dan `profile` (`LocationProfile`).
  - `profile`: tipe tempat, `interiorExterior` (interior/exterior/mixed), pencahayaan & suasana, gaya arsitektur, dan fitur tetap lingkungan.
- **`Prop`**: Barang atau objek kunci adegan. Memiliki `name`, `description`, `aliases`, `sheetAssetId`, dan `profile` (`PropProfile`).
  - `profile`: bentuk/kategori, warna/material/tampilan visual, dan signifikansi cerita.

## Aset (`Asset`)

| Properti | Arti |
|---|---|
| `kind` | `image`, `video`, `audio`, `music`, `sfx`, `overlay`, `export` |
| `clipId` / `characterId` | pemiliknya (riwayat versi per klip/pemeran) |
| `provider`, `model`, `prompt` | asal file; untuk audio narasi `prompt` = teks narasi saat direkam |
| `remoteId`, `remoteUrl` | ID permintaan dan URL hasil di Higgsfield |
| `localPath` | path relatif di folder proyek; `url` = `studio://asset/...` |
| `durationMs`, `width`, `height` | hasil probe FFmpeg |
| `meta` | JSON bebas, lihat di bawah |

`meta` untuk audio narasi:

| Kunci | Arti |
|---|---|
| `words` | `WordTiming[]` (teks + detik mulai/selesai, relatif ke file) untuk caption |
| `estimatedTimings` | `true` kalau waktu kata masih perkiraan (belum disinkronkan) |
| `timedBy` | `whisper-dtw` kalau waktu kata dari Whisper metode terbaru |
| `voice`, `take` | ID suara dan ID rekaman utuh tempat potongan ini berasal |
| `editedWords` | `true` kalau teks caption diedit manual |

`meta.basisHash` menyimpan nilai hash 64-bit FNV-1a dari seluruh input yang mendasari pembuatan aset (prompt visual/gerak, rasio aspek, model, gaya, serta ID dan hash lembar referensi karakter/lokasi/prop).

Status generasi aset dihitung dinamis di UI (`src/shared/validation.ts`):
- `current`: input saat ini cocok persis dengan `meta.basisHash`.
- `stale`: input berubah sejak media dibuat (misal prompt visual diedit atau lembar karakter diperbarui).
- `missing`: belum ada aset yang dibuat untuk klip ini.
- `blocked`: terdapat prasyarat yang belum terpenuhi (lembar referensi belum siap, speaker tidak sah, atau durasi klip di luar rentang model).

`meta.uploadedUrl`/`uploadedAt` dipakai untuk menggunakan ulang file yang sudah diunggah ke Higgsfield.

Suara karakter disimpan bersama `ttsProvider`. Suara itu hanya dipakai jika providernya sama dengan provider TTS proyek; jika berbeda, adegan memakai suara narator.

Narasi dianggap **basi** (perlu direkam ulang) kalau `asset.prompt` berbeda dari `clip.narration`.

## Pengaturan editor (`EditorSettings`, di `episodes.editor_json`; `projects.editor_json` hanya templat)

| Properti | Arti |
|---|---|
| `captionStyle`, `captionPosition`, `captionSize`, `captionScale` | gaya, posisi, dan ukuran caption |
| `captionFont`, `captionColor`, `captionHighlight`, `captionBg` | penyesuaian di atas gaya (font, warna, sorotan, latar) |
| `musicAssetId`, `musicVolumeDb`, `duckMusic` | musik latar, volume, dan turun otomatis saat narasi |
| `musicStartMs`, `musicEndMs`, `musicInMs` | posisi musik di timeline dan titik mulainya di dalam lagu |
| `voiceVolumeDb` | volume semua narasi |
| `overlays` | logo/gambar dan teks di atas video (`Overlay[]`) |
| `musicPrompt` | prompt musik AI terakhir (untuk Suno dll.) |
| `filter` | filter bawaan klip baru; filter klip yang sudah ada tetap disimpan per klip |
| `sfx` | daftar efek suara: aset, posisi/potongan timeline, dan volume per item |
| `clipFraming` | framing Ken Burns kustom berdasarkan ID klip |

Properti opsional baru di `EditorSettings` tidak butuh migrasi; berikan nilai bawaan saat dibaca (`?? 0`).

Saat `duplicateProject()` menyalin `editor_json`, remap semua ID aset dan klip: musik, gambar overlay, SFX, dan kunci `clipFraming`. Kerjakan setelah semua aset dan klip disalin agar peta ID lengkap.

## Pengaturan aplikasi (`AppSettings`, tabel `settings`)

`defaultTtsProvider`, `defaultLanguage`, `exportFolder`, `llmProvider`, `llmModels` (model per penyedia LLM),
`customBaseUrl`, `geminiTtsModel`, `elevenModel`, `imageModel`, `videoModel` (bawaan untuk proyek baru),
`whisperAuto` (sinkron caption otomatis setelah narasi Gemini), `storyStyleProfiles` (nama, aturan gaya, dan waktu
pembuatan; teks contoh narasi tidak disimpan), `providers` (konfigurasi per peran: llm, tts, visual dengan `activeId` dan model tersimpan),
serta `customProviders` (daftar penyedia kustom OpenAI-compatible atau Flow2API).

Kunci baru harus ada di `DEFAULT_SETTINGS` (`src/main/settings.ts`); kunci yang tidak dikenal diabaikan saat
disimpan.

## Kontinuitas Lintas Episode (`continuity_items`, Migrasi 15)

Tabel `continuity_items` melacak janji naratif (mystery box, luka fisik, prop penting, hubungan) antar episode:

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID item |
| `project_id` | `TEXT` | ID proyek pemilik |
| `kind` | `TEXT` | Kategori: `plot_thread`, `character_state`, `prop`, `lore` |
| `name` | `TEXT` | Judul singkat item |
| `detail` | `TEXT` | Penjelasan visual atau naratif |
| `status` | `TEXT` | Status: `open` (belum tuntas), `paid` (terbayar), `dropped` (dibatalkan) |
| `tier` | `TEXT` | Prioritas: `hot` (harus dibayar dalam 3 episode), `cold` (jangka panjang) |
| `planted_episode_id` | `TEXT` | ID episode tempat item pertama kali muncul |
| `payoff_episode_id` | `TEXT NULL` | ID episode tempat payoff terjadi |
| `created_at` | `INTEGER` | Timestamp pembuatan |

Script Doctor memicu peringatan `CONTINUITY_OPEN_TOO_LONG` jika item berstatus `hot` masih `open` selama 3 episode atau lebih.

## Riwayat Versi & Snapshot Naskah (`script_versions`, Migrasi 16)

Tabel `script_versions` mencatat revisi draf naskah per episode untuk rollback dan backup manual:

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID versi |
| `episode_id` | `TEXT` | ID episode |
| `draft_json` | `TEXT` | Snapshot struktur `EpisodeScriptDraft` (shots & proposed new assets) |
| `note` | `TEXT NULL` | Catatan versi (otomatis dari AI planner / konfirmasi atau manual pengguna) |
| `created_at` | `INTEGER` | Timestamp versi |

## Override Lembar Referensi per Shot (`clips.reference_asset_ids_json`, Migrasi 17)

Kolom `reference_asset_ids_json` di tabel `clips` menyimpan array `string[]` berisi ID aset referensi khusus untuk shot tersebut.
Jika kolom ini terisi (panjang > 0), `collectReferenceSheets` memprioritaskan aset kustom ini sebelum mengisi slot referensi otomatis dari karakter/lokasi/prop yang terhubung ke adegan. Basis hash gambar (`meta.basisHash`) sensitif terhadap perubahan array ini.

