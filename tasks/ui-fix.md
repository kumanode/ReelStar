# Daftar Tugas: Merapikan Tampilan

Hasil audit tampilan tanggal 2026-11-20 (branch `fase-4-prompt-generate`). Aplikasi dijalankan lewat dev harness
(`seed` + `seedEpisodes`) di ukuran 1440×900 dan 1180×720, tema gelap. Semua halaman lolos cek "keluar layar",
tapi ada tumpang-tindih dan teks terpotong di dalam panel.

Aturan yang wajib diikuti: [docs/konvensi.md](../docs/konvensi.md), terutama aturan UI no. 11 (rapi di jendela
minimal 1180×720, grid berisi konten panjang pakai `min-w-0` / `minmax(0,1fr)`).

## P1 — Rusak atau tumpang-tindih

- [ ] Tugas 1 — Storyboard responsif di 1180×720.
  - Penyebab: panel kanan dipatok 540 px (`grid-cols-[minmax(0,1fr)_540px]`,
    `StoryboardStep.tsx` ~baris 1166) dan grid kartu dipaksa `grid-cols-4` (~baris 1199).
  - Gejala: "4 klip · 0:17" pecah 4 baris, tombol "Tambah klip" terpotong (hanya "+"), scrollbar horizontal di
    grid, judul kartu "Senja …", teks "Suara siap" terpotong.
  - Arah: panel kanan menyusut (mis. `clamp`/persentase dengan batas bawah), grid kartu pakai
    `repeat(auto-fill, minmax(<lebar minimum>, 1fr))`, baris judul diberi `whitespace-nowrap` dan `min-w-0`.
- [ ] Tugas 2 — Badge di thumbnail kartu Storyboard tidak saling menimpa.
  - Badge kiri ("01", "GAMBAR"/"VIDEO AI") dan kanan ("ESTIMATE"/"SYNCED") sama-sama `absolute` di atas
    gambar (~baris 1251–1268). Di 1440 "GAMBAR" jadi "GAMB"; di 1180 nomor klip ikut tertutup.
  - Arah: satu baris badge dengan `flex justify-between` + `min-w-0`, atau pindahkan status sinkron ke bawah
    kartu (baris status).
- [ ] Tugas 3 — Editor tetap layak di 1180×720.
  - Pratinjau tinggal ±300 px, rel alat kiri butuh scrollbar ("Caption" terpotong), Inspector terpotong.
  - Arah: kurangi tinggi chrome atas (lihat Tugas 13), rel alat lebih ringkas (ikon + label kecil, jarak
    rapat), tinggi minimum pratinjau.
- [ ] Tugas 4 — Label jalur timeline tidak terpotong.
  - "Capti…", "Suara …", "Efe…", "Overl…" di semua ukuran.
  - Arah: lebarkan kolom label atau tampilkan ikon mata/kunci hanya saat hover, sehingga nama jalur muat utuh.
- [ ] Tugas 5 — Galeri gaya di modal "Buat Serial Baru" cukup tinggi.
  - Nama gaya ("Stickman berwarna") terpotong di bawah dan galeri di-scroll di area kecil.
  - Arah: tinggi galeri cukup untuk satu baris kartu utuh beserta namanya; modal yang di-scroll, bukan galerinya.

## P2 — Kurang presisi atau tidak konsisten

- [ ] Tugas 6 — Episode Hub sejajar.
  - Label "HOOK" dan "CLIFFHANGER" beda lebar, sehingga isian mulai di posisi berbeda (±57 px)
    (`EpisodeHub.tsx` ~baris 443–470). Arah: label dengan lebar tetap yang sama (grid 2 kolom).
  - Kartu episode hanya selebar setengah layar, tautan "Tampilkan sumber cerita" jauh di kanan. Arah: kartu
    dan tautan memakai lebar kontainer yang sama.
- [ ] Tugas 7 — Kartu Storyboard terpilih tidak menggeser isi.
  - Border lebih tebal menggeser badge/durasi/judul 2–3 px. Arah: tandai pilihan dengan `ring`/`outline`
    (tidak memengaruhi layout) atau border sama tebal di semua kartu.
- [ ] Tugas 8 — Format durasi seragam.
  - Kartu menulis "0:04" untuk 3,6 dtk dan total "0:17" untuk 16,8 dtk; Editor menulis "3,6 dtk" dan
    "00:16.8". Arah: satu formatter bersama (mis. "3,6 dtk" per klip, total "0:16,8" atau "16,8 dtk"),
    pakai koma desimal sesuai konvensi.
- [ ] Tugas 9 — Teks antarmuka berbahasa Indonesia, tanpa singkatan dan emoji.
  - "ESTIMATE"/"SYNCED" (Storyboard), "EST"/"SYNC" (`Timeline.tsx` ~baris 793), "Gbr Terkini"
    (`StoryboardStep.tsx` ~baris 240), "Generate N gambar", "Cari character atau alias…" (Lorebook),
    "Shorts Guide" (Editor), emoji 🗣️ di kartu (~baris 1280; ganti ikon lucide).
  - Usulan: "Estimasi"/"Sinkron", "Gambar terbaru", "Buat N gambar", "Cari karakter atau alias…",
    "Panduan Shorts".
- [ ] Tugas 10 — Ukuran huruf minimum 11 px.
  - 22 tempat memakai `text-[10px]`/`text-[9px]` (badge kartu, "(Ep 1)" di header kredit, label durasi
    timeline, deskripsi filter warna di Editor). Arah: naikkan ke ≥11 px atau jadikan token ukuran bersama.
- [ ] Tugas 11 — Font angka konsisten.
  - "30 dtk" (Hub), "Klip 01 · 0:00 – 0:04" (panel Storyboard), "(Ep 1)" memakai mono, angka lain tidak.
    Arah: mono hanya untuk waktu/timecode yang berjalan (pemutar, ruler timeline); sisanya font teks dengan
    `tabular-nums`.
- [ ] Tugas 12 — Tombol yang tidak bisa dipakai tidak tampil membingungkan.
  - "Generate 0 gambar" nonaktif padahal semua gambar siap. Arah: ganti jadi status "Semua gambar siap" atau
    sembunyikan.

## P3 — Kerapian struktur

- [ ] Tugas 13 — Kurangi bilah bertumpuk di halaman episode.
  - Header, sub-header "Ep 1: …", toolbar, dan judul halaman memakan ±200 px; judul episode tampil 4 kali
    (dropdown header, sub-header, judul halaman, sidebar). Arah: gabungkan sub-header dengan tab
    (Rencana/Storyboard/Editor) ke header atau ke toolbar, dan hapus judul ganda.
- [ ] Tugas 14 — Satu tombol AI di tab Rencana.
  - "Buat rencana AI" (kanan atas) dan "Mulai Susun Rencana dengan AI" (tengah) sama fungsinya. Arah: saat
    kosong cukup tombol tengah; tombol atas muncul setelah ada rencana (mis. "Susun ulang").
- [ ] Tugas 15 — Penamaan konsisten.
  - Tab "Rencana & Tinjau" vs tombol footer Storyboard "Kembali ke naskah". Arah: "Kembali ke rencana".
- [ ] Tugas 16 — Satukan jalur membuat proyek.
  - Formulir beranda (durasi/bahasa/rasio/gaya/TTS + Mulai) berbeda isian dengan modal "Serial baru"
    (judul/rasio/sumber suara/gaya). Arah: tentukan satu alur; yang lain hanya pintu masuk ke alur itu.
- [ ] Tugas 17 — Kurangi ruang kosong.
  - Lorebook: panel detail kosong lebar, grid kartu sempit. Storyboard: area kosong di bawah kartu. Hub:
    separuh kanan kosong. Arah: lebar kontainer konsisten, panel detail Lorebook menyusut atau tersembunyi
    saat belum ada pilihan.
- [ ] Tugas 18 — Footer Storyboard jelas.
  - Dua angka progres ("gambar siap", "suara siap") tapi satu bilah; di 1180 teks bantuan pecah 2 baris dan
    footer menutupi isian naskah narasi di panel kanan. Arah: dua bilah kecil atau satu bilah gabungan dengan
    label jelas; panel kanan diberi padding bawah setinggi footer.
- [ ] Tugas 19 — Latar modal gelap di tema gelap.
  - Lapisan belakang modal abu terang sehingga tampilan kusam. Arah: overlay gelap semi-transparan (mis.
    `bg-black/60`) di kedua tema.

## Perlu dicek terpisah

- [ ] Modal estimasi batch (`BatchEstimateModal.tsx`) belum terlihat: tombolnya nonaktif di data demo.
  Uji dengan klip tanpa gambar.
- [ ] Tampilan mode terang belum difoto.
- [ ] Proyek demo multi-episode tampil di beranda dengan judul "Episode 2: Pengkhianatan". Cek apakah
  `replaceStory` menimpa judul proyek atau hanya efek data `seedEpisodes`.

## Checkpoint

- [ ] `npm run typecheck` dan `npm run build` bersih.
- [ ] Screenshot dev harness di 1180×720 dan 1440×900, tema terang dan gelap: Beranda, modal Serial baru,
  Pengaturan, Hub, Lorebook, Rencana, Storyboard, modal estimasi batch, Editor.
- [ ] Skrip audit (cek elemen keluar layar, teks terpotong, huruf < 11 px) dijalankan di setiap halaman;
  tidak ada teks terpotong yang tidak disengaja.
