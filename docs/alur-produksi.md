# Alur Produksi: Studio Drama Short Multi-Episode

ReelStar adalah studio produksi drama pendek (short drama) multi-episode (9:16 vertikal atau 16:9).
Satu serial (proyek) terdiri dari banyak episode yang berbagi aset cerita di **Lorebook**, dikelola melalui **Episode Hub**, dan diproduksi per episode di **Studio Episode**.

```
Sumber Cerita (Novel / Naskah Jadi)
           │
           ▼
     [Episode Hub] ──► Rencana Episode (Hook, Cliffhanger, Story Beats)
           │            └─► Otomatis lanjut ke ekstrak Lorebook jika masih kosong
           ▼
  [Dunia & Pemeran] ──► 3 Tab: Pemeran (Karakter + Varian) · Dunia (Lokasi + Prop) · Aturan Serial
           │
           ▼
   [Studio Episode] (2 Tab)
   ├─► Produksi (Terpadu: Susun Shot → Setujui Aset Inline → Prompt Otomatis
   │             • Tombol terpisah: Buat Gambar [Smart Dependency Lembar→Gambar] · Buat Video · Buat TTS
   │             • Seleksi multi-shot, Progressive Disclosure Doctor/Kunci/Versi, Pratinjau Animatic)
   └─► Editor & Rilis (Bar Finishing Drama: Auto-Trim Hening · Smart AI SFX · Musik ElevenLabs,
                       Timeline Multi-Track, Safe Zone 9:16, Caption Whisper)
           │
           ▼
     Ekspor MP4 & Paket Pengiriman ZIP per Episode (<Judul Serial> - Ep <N>.mp4)
```

---

## 1. Kerangka Studio & Navigasi

Aplikasi menggunakan layout **Studio Hub & Workspace**:
- **Studio Header (`StudioHeader.tsx`)**:
  - Judul serial (bisa diedit di tempat).
  - Badge rasio aspek (9:16 vertikal atau 16:9).
  - Dropdown pemilih episode aktif.
  - Tracker kredit Higgsfield (tersedia/terpakai).
  - Tombol aksi utama (Render Episode, status simpan otomatis, toggle tema, menu opsi).
- **Studio Sidebar (`StudioSidebar.tsx`)**:
  - Lebar 200px, dapat diciutkan ke 48px rail.
  - Otomatis ciut saat membuka tab **Editor** untuk memberikan ruang horizontal maksimal bagi timeline dan player.
  - Navigasi cepat: Episode Hub, Lorebook, dan daftar episode dengan indikator status dot (draf, siap, diekspor).

---

## 2. Sumber Cerita & Episode Hub (`EpisodeHub.tsx`)

Episode Hub adalah pusat manajemen episode di tingkat serial:
- **Input Sumber**: Mendukung dua jenis sumber cerita:
  - *Novel / Ide Kasar*: Teks prosa atau bab novel yang nantinya dipecah menjadi episode oleh planner.
  - *Naskah Jadi*: Naskah yang sudah dibagi per adegan/episode.
- **Kartu Episode (Grid 2 Kolom)**:
  - Nomor dan judul episode (bisa diedit langsung).
  - Hook dan Cliffhanger (penentu ketegangan awal dan akhir episode).
  - Story Beats: Poin-poin alur cerita sebagai daftar bernomor.
  - Target durasi (default ~60–120 detik per episode).
  - Tombol navigasi langsung ke Studio Episode ("Buka").
  - Menu kartu: Sisipkan episode sebelum/sesudah, dan hapus episode dengan konfirmasi keamanan.

---

## 3. Lorebook: Aset Bersama Multi-Episode (`LorebookPage.tsx`)

Lorebook menyimpan seluruh entitas cerita serial yang dapat dirujuk di setiap episode:
- **Karakter**:
  - Lembar karakter 3-tampak (depan, tiga perempat, samping) dibuat via AI atau diunggah mandiri.
  - Deskripsi fisik wajah, tubuh, dan rambut tanpa baju.
  - Gaya suara dialog (`voiceStyle`) untuk instruksi ekspresi model video atau TTS.
  - Suara TTS khusus untuk mode audio narator.
  - Alias / nama panggilan alternatif.
  - "Dipakai di": Daftar episode dan adegan yang merujuk karakter tersebut.
- **Varian Kostum (`CharacterDerivative`)**:
  - Sub-identitas karakter yang mewarisi nama, wajah, dan suara karakter induk.
  - Dibuat via image-to-image dari lembar dasar karakter dengan instruksi perubahan baju (`promptChange`).
  - Lembar varian ditandai **Basi** jika lembar dasar karakter dibuat ulang atau deskripsi berubah. Lembar hasil unggahan mandiri tidak pernah basi.
- **Lokasi & Prop**:
  - Lokasi: Deskripsi suasana, arsitektur, pencahayaan, dan lembar referensi 1:1.
  - Prop: Deskripsi bahan, warna, bentuk, dan lembar referensi 1:1.
- **Penggabungan & Penghapusan Aset (`MergeAssetModal.tsx`)**:
  - Penggabungan aset sejenis (misal 2 karakter duplikat) mengalihkan seluruh rujukan klip di semua episode secara atomik.
  - Dialog menampilkan ringkasan dampak per episode (jumlah rujukan klip yang diubah dan media yang menjadi basi).

---

## 4. Studio Episode: Produksi Terpadu (`ProductionStep.tsx`, `ShotCard.tsx`, `generation.ts`, `story.ts`)

Tab **Produksi** menyatukan penyusunan naskah shot, tinjauan aset baru, prompt visual, dan generasi media ke satu
kanvas tanpa bolak-balik antar tab:
- **Susun Shot & Prompt (1 alur)**: `story:planEpisodeScript` menghasilkan draf shot dan usulan aset baru. Usulan aset
  tampil sebagai banner inline (`NewAssetsBanner.tsx`). Saat dikonfirmasi (`story:confirmEpisodeScript`), sistem
  otomatis melanjutkan ke `story:writePrompts` untuk mengisi prompt visual & video yang kosong.
- **Pemisahan tegas tombol generasi**: `Buat Gambar`, `Buat Video`, dan `Buat TTS` berdiri terpisah di toolbar atas,
  bar seleksi multi-shot, dan tiap kartu shot (`ShotCard.tsx`).
- **Smart Dependency Batch (khusus Gambar)**: saat kreator klik `Buat Gambar`, lembar Lorebook terdaftar yang masih
  kosong otomatis dijadwalkan di Tahap 1 (Gelombang 1 karakter/lokasi/prop → Gelombang 2 varian kostum) sebelum
  Gelombang 3 gambar shot, tanpa memaksa keluar ke Lorebook. Untuk batch Video, shot tanpa gambar tetap dilewati agar
  kredit video tidak terpakai tanpa persetujuan gambar.
- **Progressive Disclosure**: Dokter Naskah (`Cek Naskah`), Kunci Kontinuitas (`Kunci`), Riwayat Snapshot (`Versi`),
  dan Bar Ritme tampil sebagai pill ringkas di sub-header; `Detail & Prompt` beserta override referensi per shot
  dilipat per kartu.
- **Pratinjau Animatic (`AnimaticPreviewModal.tsx`)**: memutar urutan gambar/video, audio, dan subtitle langsung di
  Tab Produksi sebelum membakar kredit Video AI.
- **Status Hasil**: setiap klip menampilkan badge status Gambar dan Video terpisah (`Terkini`, `Basi`, `Belum`,
  `Terblokir`) dari hash basis input.

---

## 6. Narasi & Suara (`narration.ts`, `whisper.ts`)

ReelStar mendukung dua mode audio dialog:
1. **Audio dari Video (`dialog_audio: 'video'`)**: Model video generasi baru (seperti Veo) membuat video sekaligus suara dialog karakter secara alami. Suara diekstraksi ke track audio klip.
2. **Audio dari Narator TTS (`dialog_audio: 'tts'`)**: Narasi direkam utuh per kelompok suara (Gemini TTS atau ElevenLabs), lalu dipotong per adegan di jeda kalimat alami.
- **Caption Sinkron Whisper**: Whisper Small lokal (`whisper-cli.exe`) mencocokkan waktu kata secara presisi menggunakan DTW (`-nfa -dtw small`) tanpa prompt naskah agar terhindar dari halusinasi kata.

---

## 7. Editor Timeline & Ekspor (`EditorStep.tsx`, `exporter.ts`)

- **Timeline Terpadu**:
  - Track video dengan thumbnail frame dan penanda transisi (cut, fade, zoomin, dll.).
  - Track suara klip (dialog/narasi) dengan visualisasi waveform dan teks caption.
  - Track musik latar dan track efek suara (SFX).
- **Pratinjau Sinkron**: Player menjaga klip sebelum/sekarang/sesudah tetap terpasang untuk mencegah glitch transisi.
- **Ekspor MP4**:
  - Merender MP4 dengan resolusi proyek (default 1080×1920 untuk 9:16).
  - Nama file otomatis `<Judul Serial> - Ep <N>.mp4`.
  - Cache render bertahap per klip untuk mempercepat ekspor ulang saat hanya beberapa adegan yang diubah.
  - Setelah ekspor sukses, episode ditandai `exported`.
