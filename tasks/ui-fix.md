# Daftar Tugas: Merapikan Tampilan

Hasil audit tampilan tanggal 2026-11-20 (branch `fase-4-prompt-generate`). Aplikasi dijalankan lewat dev harness
(`seed` + `seedEpisodes`) di ukuran 1440×900 dan 1180×720, tema gelap. Semua halaman lolos cek "keluar layar",
tapi ada tumpang-tindih dan teks terpotong di dalam panel.

Aturan yang wajib diikuti: [docs/konvensi.md](../docs/konvensi.md), terutama aturan UI no. 11 (rapi di jendela
minimal 1180×720, grid berisi konten panjang pakai `min-w-0` / `minmax(0,1fr)`).

## P1 — Rusak atau tumpang-tindih

- [x] Tugas 1 — Storyboard responsif di 1180×720.
  - Penyebab: panel kanan dipatok 540 px (`grid-cols-[minmax(0,1fr)_540px]`,
    `StoryboardStep.tsx` ~baris 1166) dan grid kartu dipaksa `grid-cols-4` (~baris 1199).
  - Gejala: "4 klip · 0:17" pecah 4 baris, tombol "Tambah klip" terpotong (hanya "+"), scrollbar horizontal di
    grid, judul kartu "Senja …", teks "Suara siap" terpotong.
  - Arah: panel kanan menyusut (`grid-cols-[minmax(0,1fr)_clamp(360px,34vw,480px)]`), grid kartu pakai
    `repeat(auto-fill, minmax(140px, 1fr))` untuk 9:16 dan `180px` untuk 16:9, baris judul diberi `min-w-0` dan `whitespace-nowrap`.
- [x] Tugas 2 — Badge di thumbnail kartu Storyboard tidak saling menimpa.
  - Badge kiri ("01", "GAMBAR"/"VIDEO AI") dan kanan ("ESTIMATE"/"SYNCED") sama-sama `absolute` di atas
    gambar. Di 1440 "GAMBAR" jadi "GAMB"; di 1180 nomor klip ikut tertutup.
  - Arah: satu baris badge dengan `absolute inset-x-0 top-0 flex items-center justify-between p-2 pointer-events-none gap-1` + label Indonesia "Video AI", "Gambar", "Sinkron", "Estimasi" (≥11 px).
- [x] Tugas 3 — Editor tetap layak di 1180×720.
  - Pratinjau tinggal ±300 px, rel alat kiri butuh scrollbar ("Caption" terpotong), Inspector terpotong.
  - Arah: tinggi chrome atas dipangkas (Tugas 13), rel alat kiri lebih ringkas (`h-12 w-14`, teks 11 px, ikon 16 px, muat 7 tab dalam 360 px tanpa scrollbar), kolom rel dikurangi ke 72 px, Inspector 340 px.
- [x] Tugas 4 — Label jalur timeline tidak terpotong.
  - "Capti…", "Suara …", "Efe…", "Overl…" di semua ukuran.
  - Arah: lebarkan kolom label `LABEL_W` dari 140 px menjadi 164 px sehingga nama jalur muat utuh.
- [x] Tugas 5 — Galeri gaya di modal "Buat Serial Baru" cukup tinggi.
  - Nama gaya ("Stickman berwarna") terpotong di bawah dan galeri di-scroll di area kecil.
  - Arah: hapus `max-h-60 overflow-y-auto` di kontainer `StylePicker`; modal sendiri yang di-scroll (`max-h-full overflow-y-auto`).

## P2 — Kurang presisi atau tidak konsisten

- [x] Tugas 6 — Episode Hub sejajar.
  - Label "HOOK" dan "CLIFFHANGER" beda lebar, sehingga isian mulai di posisi berbeda (±57 px)
    (`EpisodeHub.tsx` ~baris 443–470). Arah: label dengan lebar tetap yang sama (`w-24 shrink-0 text-center`).
  - Kartu episode hanya selebar setengah layar, tautan "Tampilkan sumber cerita" jauh di kanan. Arah: kontainer kartu saat 1 episode memakai `max-w-3xl` yang selaras.
- [x] Tugas 7 — Kartu Storyboard terpilih tidak menggeser isi.
  - Border lebih tebal menggeser badge/durasi/judul 2–3 px. Arah: pakai `border-2` di semua keadaan (`border-accent` vs `border-line hover:border-line-3`).
- [x] Tugas 8 — Format durasi seragam.
  - Kartu menulis "0:04" untuk 3,6 dtk dan total "0:17" untuk 16,8 dtk; Editor menulis "3,6 dtk" dan
    "00:16.8". Arah: memakai formatter `secLabel` ("3,6 dtk", "16,8 dtk") dengan koma desimal sesuai konvensi.
- [x] Tugas 9 — Teks antarmuka berbahasa Indonesia, tanpa singkatan dan emoji.
  - "ESTIMATE"/"SYNCED" (Storyboard) -> "Estimasi"/"Sinkron", "EST"/"SYNC" (`Timeline.tsx`) -> "Estimasi"/"Sinkron", "Gbr Terkini" -> "Gambar terbaru", "Generate N gambar" -> "Buat N gambar", "Cari character atau alias…" -> "Cari karakter atau alias…", "Shorts Guide" -> "Panduan Shorts", emoji 🗣️ diganti ikon Lucide `<Mic />`.
- [x] Tugas 10 — Ukuran huruf minimum 11 px.
  - Semua 22 tempat yang memakai `text-[10px]`/`text-[9px]`/`text-[8px]` telah dinaikkan ke `text-[11px]`.
- [x] Tugas 11 — Font angka konsisten.
  - "30 dtk" (Hub), panel Storyboard, dan header kredit memakai font teks dengan `tabular-nums`; mono hanya untuk waktu/timecode aktif yang berjalan.
- [x] Tugas 12 — Tombol yang tidak bisa dipakai tidak tampil membingungkan.
  - "Generate 0 gambar" nonaktif diganti menjadi chip status "Semua gambar siap" saat `stats.needImg === 0`.

## P3 — Kerapian struktur

- [x] Tugas 13 — Kurangi bilah bertumpuk di halaman episode.
  - Sub-header episode digabungkan dengan tab episode (Rencana/Storyboard/Editor) ke dalam `StudioHeader.tsx`, menghemat 44 px ruang vertikal di semua langkah episode.
- [x] Tugas 14 — Satu tombol AI di tab Rencana.
  - Tombol kanan atas hanya muncul sebagai "Susun ulang rencana AI" ketika sudah ada draf; saat draf kosong, hanya ada tombol hero utama di tengah.
- [x] Tugas 15 — Penamaan konsisten.
  - Tombol footer Storyboard "Kembali ke naskah" diganti menjadi "Kembali ke rencana" dan berpindah ke tab Rencana.
- [x] Tugas 16 — Satukan jalur membuat proyek.
  - Formulir beranda dan modal "Serial baru" disatukan: tombol Mulai pada hero membuka `NewSerialModal` terisi otomatis dengan opsi yang dipilih, dan modal memiliki opsi lengkap yang sama.
- [x] Tugas 17 — Kurangi ruang kosong.
  - Lorebook: panel detail kanan hanya dirender jika ada item yang dipilih; jika belum ada, grid kartu membentang penuh. Hub: kontainer kartu episode diperbaiki saat 1 episode.
- [x] Tugas 18 — Footer Storyboard jelas.
  - Footer menampilkan dua progress bar terpisah ("Gambar" dan "Suara") dengan angka `x/total`, dan panel kanan diberi padding bawah `pb-20` agar naskah tidak tertutup footer.
- [x] Tugas 19 — Latar modal gelap di tema gelap.
  - `bg-ink/50` (yang menjadi putih susu di tema gelap) diganti dengan `bg-black/60 backdrop-blur-[2px]`.

## Perlu dicek terpisah

- [x] Modal estimasi batch (`BatchEstimateModal.tsx`): dicek dan diuji via dev harness, label dan teks telah disesuaikan dengan bahasa desain dan ukuran font.
- [x] Tampilan mode terang sudah difoto dan diaudit via dev harness.
- [x] Proyek demo multi-episode judul tertimpa: diperbaiki di `replaceStory` (`src/main/repo.ts`) agar tidak menimpa judul proyek pada proyek multi-episode.

## Checkpoint

- [x] `npm run typecheck` dan `npm run build` bersih.
- [x] Screenshot dev harness di 1180×720 dan 1440×900, tema terang dan gelap: Beranda, modal Serial baru,
  Pengaturan, Hub, Lorebook, Rencana, Storyboard, modal estimasi batch, Editor.
- [x] Skrip audit (cek elemen keluar layar, teks terpotong, huruf < 11 px) dijalankan di setiap halaman;
  0 masalah ditemukan pada semua halaman.

## Pemeriksaan ulang (2026-11-20)

Audit ulang di 1180×720, tema gelap dan terang, menemukan beberapa poin yang belum beres. Semuanya sudah diperbaiki:

- Tugas 3: rel alat Editor masih bergulir (tab Musik terpotong). Tombol kini berbagi tinggi rel (36–48 px), jadi
  semua tab muat tanpa scrollbar.
- Tugas 4: jalur efek suara masih "Efek S…" karena memuat tiga tombol. Label diganti "Efek", sama dengan tab rel.
- Tugas 1/2: "Belum ada suara" pecah tiga baris di kartu. Baris status kini membungkus per chip, dan klip dialog
  video menulis "Suara dari video".
- Tugas 8: kepala panel klip memakai `secLabel` ("Klip 01 · 4,0 dtk"); daftar video AI juga.
- Tugas 9: sisa label "Generate" (video AI, SFX kustom, musik latar, SFX otomatis) diganti "Buat …"; satuan "s"
  menjadi "dtk".
- Header 1180 px: status simpan satu baris (waktu tampil mulai 1400 px, teks mulai 1280 px), pemilih episode 180 px
  dan tidak lagi menulis "Ep 1: Episode 1: …", label "(Ep N)" di kredit tampil mulai 1400 px.

Skrip audit: 0 huruf < 11 px, 0 elemen keluar layar, tidak ada scroll horizontal. Teks terpotong yang tersisa hanya
deskripsi filter di Inspector (sengaja dipotong satu baris) dan teks pembaca layar "Tersimpan".
