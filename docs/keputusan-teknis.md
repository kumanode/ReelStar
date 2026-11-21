# Keputusan teknis

Catatan kenapa sesuatu dibuat begitu. Sebagian besar lahir dari bug nyata, jadi baca dulu sebelum mengubah
bagian terkait. Tambahkan entri baru di akhir setiap kali membuat keputusan penting.

### Narasi direkam satu kali utuh, lalu dipotong per adegan
TTS yang dipanggil per klip menghasilkan suara dan intonasi yang berbeda-beda. Satu rekaman utuh lalu dipotong
membuat suaranya konsisten. Jangan menambah tombol "buat suara" per klip.

### Whisper tanpa `--prompt`, dengan DTW
Naskah yang dikirim sebagai prompt membuat Whisper berhalusinasi: dalam uji coba, Whisper mengulang "tidak tidak
tidak..." puluhan kali. Caption klip 1 selesai 2 detik lebih cepat dari suaranya, dan kata-kata awal klip lain
tertumpuk di detik 0. Waktu per kata bawaan whisper.cpp juga kurang presisi. Dari tiga cara yang diuji,
`-nfa -dtw small` tanpa prompt paling akurat: caption hanya meleset sekitar 0,1–0,2 detik dari suara (diuji pada
proyek nyata). Ejaan caption tetap dari naskah (`align.ts`); dari Whisper hanya diambil waktunya.

### Potongan adegan mengikuti kata
Dengan Whisper, adegan dipotong di jeda antara kata terakhir satu adegan dan kata pertama adegan berikutnya
(`cutsFromWords`), jadi potongan tidak pernah jatuh di tengah kata. Tanpa waktu kata, `chooseCuts` memilih dari
jeda yang dideteksi FFmpeg. Gemini diberi `<long pause>` di antara adegan supaya jedanya jelas. ElevenLabs
memakai waktu kata dari API-nya sendiri.

### Sorotan caption bertahan di jeda antar kata
Di jeda antar kata, sorotan tetap di kata terakhir yang sudah diucapkan (`captionAt`), sama seperti ekspor.
Dulu sorotan lompat ke kata terakhir baris lalu balik lagi, sehingga terlihat berkedip.

### Segmen ekspor dibulatkan ke frame + 2 frame cadangan
`xfade` menghentikan seluruh video kalau klip pertama habis sebelum offset transisi. Dengan transisi `cut`
(1 frame) dan durasi klip yang tidak pas di frame, gambar video pernah berhenti setelah klip 1 sementara audio
tetap jalan. `planSegments` membulatkan awal klip ke frame utuh dan menambah 2 frame cadangan.

### Gerak kamera di ekspor memakai filter `perspective`, bukan `zoompan`
`zoompan` membulatkan potongan gambar ke piksel bulat setiap frame, sehingga gerak lambat bergoyang 0,6–0,7 px
per frame (terlihat bergetar, terutama garis tipis). `perspective` (sense=source, cubic) bergerak pecahan piksel:
getarannya 0,02–0,16 px dengan kecepatan hampir sama. Gambar diproses di resolusi aslinya (1×–2× output) lalu
diperkecil, supaya tetap tajam. Catatan: penghitung frame `perspective` mulai dari 1, jadi rumusnya memakai `(on-1)`.

### Kotak caption rounded digambar sendiri
libass hanya bisa membuat kotak bersudut siku. Kotak rounded digambar sebagai drawing ASS di layer bawah teks.
Lebarnya dihitung dari metrik file font (`fontMetrics.ts`), dan baris dipecah dengan fungsi yang sama dengan
pratinjau (`layoutCaptionLines`).

### Ukuran caption memakai metrik `cell` per font
libass mengukur ukuran font dengan winAscent+winDescent, CSS dengan em. Tanpa konversi, caption di ekspor hanya
sekitar 57% ukuran pratinjau. Setiap font di `CAPTION_FONTS` punya nilai `cell` hasil pengukuran file TTF-nya.

### Pratinjau menjaga tiga klip tetap terpasang
Membuat elemen `<video>` baru setiap pindah klip sempat menampilkan frame pertama video (atau poster) sebelum
seek. Akibatnya ada kilasan di sambungan potongan dan di transisi. Klip sebelum/sekarang/sesudah selalu
terpasang dalam urutan timeline. Klip berikutnya menunggu di titik mulainya, dan langsung diputar tanpa seek
ulang (seek ulang menahan video sekitar 150 ms).

### Video overlay hardware dimatikan
Di Windows, Chromium menyerahkan video ke overlay hardware (DirectComposition) yang membulatkan posisi dan
ukuran ke piksel bulat. Gerak kamera di atas video jadi gemetar di pratinjau, padahal gambar halus.
Switch `disable-direct-composition-video-overlays` dan opasitas 0,999 untuk video yang bergerak menahan video
di jalur render biasa. (Pemilik aplikasi masih melihat getaran di pratinjau; lihat masalah-diketahui.md.)

### Suara milik klipnya ("klip tertaut")
Seperti suara bawaan klip video di editor lain: suara bisa dipotong dan digeser di dalam klip, dan terpotong di
akhir klip. Ini menjaga sinkron naskah per adegan dan rekam ulang narasi tetap sederhana.

### Potong klip ikut membelah suara dan naskah
Saat klip dibelah, file suara dipotong di jeda antar kata terdekat, dan teks narasinya dibagi
(`splitNarration`). Dengan begitu tiap bagian punya aset dan naskah yang cocok (tidak dianggap basi), dan bisa
direkam ulang sendiri. Bagian pertama diberi transisi `cut` agar sambungannya mulus.

### Panel Transisi, bukan popup
Popup di timeline menutupi pratinjau, padahal pengguna ingin melihat contoh transisinya. Tombol sambungan
membuka panel di kanan, lalu pratinjau memutar sambungan itu berulang-ulang (audition).

### Prompt visual berlabel dan baris Wardrobe
Model gambar tidak membaca naskah. Prompt yang kurang spesifik menghasilkan latar Bumi dan alien untuk cerita di
Mars, dan baju astronot di semua adegan. Setiap prompt kini menyebut dunia/era dengan jelas, orang disebut
"human", dan baju per adegan ditulis di baris `Wardrobe` (bawaan lembar karakter atau custom).

### Prompt video selalu melarang musik
Beberapa model video (Veo, Grok, MiniMax) membuat musik sendiri tanpa saklar. Setiap prompt diakhiri `NO_MUSIC`,
dan audio dimatikan lewat parameter kalau modelnya punya. Audio dari file video tidak pernah dipakai di ekspor.

### Kunci API dienkripsi safeStorage, kunci kripto dibuat saat startup
Kunci kriptografi `safeStorage` baru tertulis ke `Local State` sekitar 10 detik setelah dibuat. Membuatnya saat
startup (`warmUpEncryption`) mencegah kunci API tidak terbaca setelah aplikasi ditutup paksa.

### YouTube embed diberi Referer berisi ID aplikasi
Halaman dari `file://` tidak mengirim Referer, dan YouTube menolak embed tanpa identitas (Error 153). Header
ditambahkan hanya untuk `https://www.youtube.com/embed/*`.

### Hasil job AI di-rebase ke riwayat undo
Undo menyimpan edit pengguna, sedangkan gambar/video/suara yang selesai dibuat di latar bukan edit yang bisa
dibatalkan. Patch hasil job dan aset barunya dimasukkan ke semua snapshot undo/redo agar undo edit lama tidak
menghapus hasil AI. Penggantian media lokal lewat event main mengikuti aturan yang sama.

### Pembicara disimpan terpisah dari pemeran yang terlihat
`characterIds` dibutuhkan untuk prompt visual dan berarti “tampil di adegan”. Memakai field itu untuk suara
mengubah narasi seluruh adegan menjadi suara karakter tanpa indikasi bahwa ia berbicara. `speakerId` kini
menandai dialog/narasi yang dibacakan karakter; kosong berarti narator. ID suara diikat ke `ttsProvider` untuk
mencegah provider menerima ID yang tidak dikenal.

### Caption aktif memakai tata letak yang terkunci
Aturan jarak pop, padding kapsul, radius, dan durasi animasi berada di `shared/captions.ts` agar pratinjau dan
ekspor memakai nilai yang sama. Spasi di pratinjau menjadi node tersendiri di antara span kata; spasi di dalam
`inline-block` dengan `white-space: nowrap` dapat dibuang browser.

Kata aktif di ekspor digambar sebagai event ASS tersendiri di posisi tengah kata. Teks dasar tetap menempati lebar
normal, sehingga perubahan skala kata aktif tidak menata ulang atau menggeser satu baris. Di baris dasar kata aktif
hanya dibuat transparan (`\alpha&HFF&` lalu `\r`), bukan dihapus: tanpa teksnya, baris dasar kosong dan hanya kata
aktif yang tampil. Kapsul digambar sebagai rounded rectangle ASS (`\p1`) di layer bawah, berpusat di kata dan ikut
membesar bersamanya, memakai ukuran dan padding yang sama dengan pratinjau. Di pratinjau kapsul adalah elemen
`absolute` di belakang kata, bukan padding, supaya lebar baris tidak berubah setiap kata berganti. Pop masuk
dianimasikan selama 80 ms dari skala dasar ke 115%; hitungan pratinjau bergantung pada waktu playhead, sehingga
seek dan scrub menghasilkan posisi yang sama.

Glow (Merah Darah, Bisikan Arwah, Api Ritual) adalah event ASS terpisah di layer 0: hanya outline kata aktif yang
di-blur, teksnya transparan. Kalau glow ditulis di baris caption yang sama, outline gelap kata aktif ikut berubah
warna glow dan kata merah di dalam pendaran merah tidak terbaca. Pratinjau menirunya dengan `text-shadow` di
belakang outline gelap.

### Filter warna tetap memiliki selisih ruang warna
CSS memakai RGB, sedangkan sebagian proses FFmpeg memakai YUV. Brightness FFmpeg memakai LUT RGB multiplikatif
agar mendekati `brightness()` CSS, dan urutan sepia/hue disamakan. Konversi ruang warna tetap dapat menghasilkan
perbedaan kecil, terutama pada gradasi kuat.

### [USANG] Cerita panjang dipecah menjadi kelompok
*Usang sejak Fase 2 (Studio Hub & Lorebook multi-episode).*
Dulu durasi 15–30 menit memakai target sekitar 8 detik per adegan dan dipecah dalam kelompok bab. Arsitektur baru beralih ke format drama short multi-episode (1–2 menit per episode) di mana setiap episode direncanakan dan dikelola secara mandiri di Episode Studio.

### Render ekspor bertahap dan dapat dilanjutkan
Ekspor membuat segmen per klip, menggabungkannya ke blok video 20 klip dengan overlap transisi di batas blok,
mencampur audio per jendela 30 detik, lalu menggabungkan hasil antara sebelum pass MP4 final. Encoder NVENC
tersedia hanya setelah tes encode singkat berhasil; kegagalan NVENC pada render blok atau final mengulang tahap
tersebut dengan CPU. Berkas antara segmen disimpan di cache proyek berdasarkan isi klip, aset, dan opsi render,
lalu dibersihkan setelah ekspor sukses atau proyek dihapus. Pemeriksaan ruang kosong mencakup output dan
perkiraan berkas kerja sementara.

Blok tengah berhenti tepat setelah transisi ke klip terakhirnya (`own` klip-klip sebelumnya + `overlap` transisi
itu), dan blok berikutnya mulai dari klip yang sama setelah `overlap` tersebut. Kalau blok tengah ikut memuat
seluruh klip bersama itu, klip tampil dua kali dan video tertinggal dari audio di setiap batas blok. Proyek demo
hanya 4 klip (satu blok), jadi uji ekspor blok memakai proyek dengan lebih dari 20 klip.

Tiap jendela audio dicampur mulai 3 detik lebih awal lalu bagian itu dibuang, sehingga kompresor ducking dan fade
musik melanjutkan keadaan jendela sebelumnya. Delay memakai satuan sampel (`adelay=…S`) agar suara yang terbelah dua
jendela tersambung tanpa celah.

### Sinkron Whisper melindungi edit kata manual
Klip dengan `meta.editedWords` dilewati saat sinkron caption biasa. UI menunjukkan jumlah klip yang dilindungi;
aksi paksa meminta konfirmasi dan menghapus penanda edit manual sebelum menulis kata hasil sinkron.

### [USANG] Alur hook lama dipertahankan untuk proyek tersimpan
*Usang sejak Fase 2 (Studio Hub & Lorebook multi-episode).*
Dulu kreator memilih hook dan meninjau kerangka babak. Sekarang struktur cerita dirancang multi-episode lewat Episode Hub dan Planner bertahap.

### [USANG] Kerangka bab baru membaca sinopsis langsung
*Usang sejak Fase 2 (Studio Hub & Lorebook multi-episode).*
Format bab tunggal untuk video YouTube panjang digantikan oleh sistem naskah multi-episode dengan hook, cliffhanger, dan story beats per episode.

### [USANG] Profil gaya menyimpan aturan, bukan contoh
*Usang sejak Fase 2 (Studio Hub & Lorebook multi-episode).*
Profil gaya narasi babak lama dihapus demi konsistensi dialog dan narasi drama short.

### Adegan mengikuti kalimat utuh
Jumlah adegan dalam outline adalah sasaran tempo. Narasi satu rekaman dipotong pada batas kalimat dan kalimat panjang
tetap utuh; bila batas alami tidak cocok dengan target, jumlah adegan boleh berbeda. Jangan membelah kalimat secara
otomatis karena potongan itu dapat merusak intonasi dan membuat naskah terputus saat dibacakan.

### Retry Flow2API berhenti saat hasil ambigu
Penolakan HTTP 429/503 sebelum stream adalah satu-satunya kondisi generasi yang dicoba ulang otomatis. Setelah stream
dimulai, koneksi yang putus bisa berarti server sudah menerima dan membuat hasil; permintaan tidak boleh dikirim ulang
diam-diam tanpa idempotensi atau pemeriksaan status yang didukung server.

### Klip diisolasi per episode dengan foreign key ON DELETE CASCADE
Setiap klip memiliki `episode_id` yang terikat ke tabel `episodes`. Membaca (`getBundle`, `clipsOf`), menyimpan snapshot (`saveSnapshot`), menulis naskah (`replaceScript`), dan menyusun timeline selalu dibatasi ke episode aktif. Dengan demikian, penambahan, pengeditan, atau penghapusan adegan di satu episode tidak pernah mempengaruhi klip episode lain. Saat sebuah episode dihapus, semua klipnya otomatis terhapus lewat cascade SQLite.

### Pengaturan editor tersimpan per episode, proyek hanya templat
Setiap episode memiliki `editor_json` sendiri (musik, SFX, overlay, framing klip, gaya caption). `getBundle()`
menaruh pengaturan episode aktif di `bundle.project.editor` lewat `editorOf()`, sehingga pratinjau dan ekspor yang
membaca `project.editor` otomatis memakai milik episode itu. Renderer menyimpan `project.editor` sebagai
`episodeEditor` di snapshot. `projects.editor_json` hanya templat untuk episode yang belum punya pengaturan sendiri:
gaya caption, filter, dan volume ikut, tetapi musik, SFX, framing klip, dan overlay berwaktu **tidak** ikut, karena
itu milik timeline episode lain (dulu Ep 2 mewarisi SFX Ep 1). Hanya overlay sepanjang video (logo/watermark) ikut.

### Planner episode bertahap per bagian sumber
Sumber dipecah per ±9.000 karakter di batas paragraf/kalimat, lalu tiap bagian direncanakan terpisah dengan konteks
cliffhanger episode sebelumnya. Balasan divalidasi (judul, ringkasan, hook, cliffhanger, minimal 2 beat) dan dicoba
ulang hingga 3 kali. Progres disimpan di `settings` kunci `plan_progress:<projectId>` (jumlah karakter yang sudah
direncanakan + hash bagian itu), jadi "Lanjutkan perencanaan" meneruskan dari bagian yang gagal atau dari teks lanjutan
yang ditambahkan di bawah sumber. "Rencanakan ulang" mengganti semua episode, tetapi menolak bila ada episode yang
sudah punya klip, supaya klip tidak pernah terhapus diam-diam.

### Narasi tidak punya pembicara
Shot narasi (voice-over) disimpan dengan `speakerId = null` dan dibacakan suara narator. Nama "Narator" dari AI
dinormalkan menjadi kosong (`isNarratorName`), bukan dijadikan karakter, karena karakter yang berbicara di fase 4
diperlakukan sebagai dialog video dengan lip-sync. Pembicara dialog wajib ada di daftar tokoh yang terlihat di shot.

### Tulis prompt visual tidak menimpa editan kreator
`writePrompts` tanpa daftar klip hanya menulis prompt yang kosong atau yang adegannya berubah sejak prompt dibuat
(`needsVisual`, lewat `visual_source`). Prompt yang diedit kreator tetap utuh.

### Episode aktif diingat lewat pengaturan `last_episode`
Kreator yang berpindah-pindah proyek akan kembali ke episode terakhir yang sedang mereka kerjakan. Posisi ini disimpan di tabel `settings` dengan kunci `last_episode:<projectId>` tanpa menambah status mutabel ke tabel `projects`. Jika belum ada riwayat, sistem otomatis memilih episode pertama berdasarkan urutan `sort`.

### Sidebar Studio 200px dan ciut otomatis di Editor
Ruang kerja Studio mengadopsi navigasi dua tingkat: sidebar 200px (ciut ke 48px rail) untuk Episode Hub, Lorebook, dan daftar episode serial. Di tab Editor, sidebar otomatis diciutkan agar preview player dan track timeline mendapatkan ruang horizontal maksimal pada layar standar (1180×720).

### Lorebook sentral multi-episode dan varian kostum turunan
Karakter, lokasi, dan prop didaftarkan di tingkat proyek (serial) dan dirujuk lintas episode. Varian kostum adalah sub-identitas yang berbagi nama, suara, dan identitas dasar karakter induknya. Lembar varian dibuat dengan mengedit lembar dasar (image-to-image), dan menjadi basi jika lembar dasar dibuat ulang. Lembar hasil unggahan mandiri tidak pernah ditandai basi.

### Penggabungan aset atomik dengan analisis dampak
Aset duplikat dapat digabungkan langsung dengan ringkasan dampak per episode (jumlah rujukan klip yang dialihkan dan media yang menjadi basi). Pengalihan rujukan (`characterIds`, `speakerId`, `costumeIds`, `locationId`, `propIds`) dilakukan dalam satu transaksi database SQLite di level proyek.

### Kompilasi prompt terstruktur dengan 4 lapis prioritas referensi
Prompt visual dan video adegan dirakit oleh modul terpusat di `src/shared/prompts.ts` agar hasil pembuatan gambar/video konsisten antara pratinjau dan ekspor. Modul ini menyusun blok berlabel eksplisit (`Setting:`, `Props:`, `Emotion:`, `Framing:`, `Wardrobe:`, `Recurring characters:`, `Art style:`, dan `Avoid:`). Lembar referensi disusun berdasarkan 4 tingkat prioritas tegas: (1) lembar varian kostum tokoh pembicara/fokus jika ada, jika tidak lembar dasar tokoh pembicara; (2) lembar karakter lain yang tampil di adegan; (3) lembar lokasi utama adegan; (4) lembar prop yang terlihat. Jumlah gambar referensi dipotong sesuai kapasitas model lewat `referenceLimit()` (Higgsfield: `maxRefs(model)`, Flow2API: `maxRefs` katalog). Status dan proses generate memanggil fungsi yang sama, sehingga hash basis gambar yang baru dibuat selalu cocok dengan hash yang dihitung Storyboard. Data Lorebook adalah sumber kebenaran untuk `Setting:` (bila klip punya lokasi), `Framing:`, dan `Wardrobe:` (bila ada tokoh): baris salinan yang ditulis `writePrompts` ke prompt storyboard dibuang dan ditulis ulang dari data terbaru. Karena hash basis gambar dibuat dari prompt hasil kompilasi, mengubah `prompt_change` varian atau deskripsi lokasi langsung membuat gambar yang memakainya basi. Prompt video selalu diakhiri dengan klausa pelarangan musik otomatis (`NO_MUSIC`).

### Hash basis deterministik 64-bit FNV-1a dan status dinamis
Status aset (`current`, `stale`, `missing`, `blocked`) tidak disimpan sebagai kolom mutabel di SQLite. Sebaliknya, hash input disimpan di metadata aset (`asset.meta.basisHash`) saat media berhasil dibuat. Hash ini dihitung menggunakan algoritma deterministik FNV-1a 64-bit di `src/shared/hash.ts` yang mencakup: prompt visual, rasio aspek, model, gaya seni, ID lembar referensi, dan hash lembar referensi terkait. Perubahan pada naskah, prompt, kostum, atau pembaruan lembar karakter otomatis membuat status adegan menjadi `stale` (Basi) secara dinamis tanpa perlu batch update di database. Aset tanpa `basisHash` (dibuat sebelum fase 4) dianggap `current`: tidak ada catatan inputnya, dan menandainya basi akan membuat seluruh proyek lama masuk antrean buat ulang.

### Validasi prasyarat pra-generasi terpusat (canGenerateClip)
Untuk mencegah pemborosan kredit AI pada adegan yang belum siap, fungsi validasi tunggal di `src/shared/validation.ts` memeriksa seluruh kondisi sebelum pembuatan gambar atau video dipicu. Pembuatan diblokir (`blocked`) jika: tokoh, varian, lokasi, atau prop tidak terdaftar; lembarnya belum ada (hanya bila model gambar memakai referensi, karena model tanpa referensi tidak pernah membacanya); pembicara dialog tidak terlihat di adegan; atau ucapan dialog lebih panjang dari video terpanjang model. Durasi klip sendiri **tidak** memblokir: `videoSecondsFor()` memilih durasi terpendek model yang menutupi klip (dan ucapannya), atau yang terpanjang. Job yang sedang berjalan juga bukan alasan blokir; generate ulang mengembalikan job yang sama. UI Storyboard menonaktifkan tombol dan menampilkan tooltip alasan spesifik, sementara main process menolak permintaan secara tegas.

### Aturan All-or-Nothing pada ekspor dan generasi batch
Pembuatan gambar dan video massal melalui `generate.missingImages` dan `generate.missingVideos` menerapkan aturan all-or-nothing: jika satu saja klip yang **akan dibuat** terblokir, seluruh batch digagalkan sebelum kredit terpotong (`planBatch()`). Klip terblokir yang sudah punya hasil hanya ikut menggagalkan batch saat kreator memilih membuat ulang yang basi. Estimasi kredit video dihitung per durasi video yang akan diminta; Flow2API tidak memakai kredit Higgsfield, jadi estimasinya kosong, bukan angka karangan. Dialog estimasi batch (`BatchEstimateModal`) memvalidasi seluruh item terlebih dahulu, menampilkan rincian kredit per model, dan mendaftar seluruh adegan bermasalah dengan tautan langsung agar kreator dapat memperbaikinya sebelum memulai proses.

### Pelacakan kredit per episode pada serial
Saat job Higgsfield dikirim, harga request diminta ke endpoint estimasi (di-cache per model dan pengaturan, tanpa
prompt dan URL referensi) lalu disimpan di `asset.meta.credits` hasilnya, bersama `asset.episode_id` dari klipnya.
Header Studio menjumlahkan angka itu per episode; lembar Lorebook masuk baris "Lembar Lorebook". Hasil Flow2API dan
hasil lama tanpa harga tidak dihitung, bukan diberi angka tebakan.
### Perubahan keputusan teknis: Dialog dari video dan rekaman TTS per suara
Keputusan teknis lama menyatakan bahwa prompt video selalu melarang musik dan audio dari file video tidak pernah dipakai di ekspor. Keputusan ini diperbarui untuk klip dialog video (`clip.speakerId` terisi dan `project.dialogAudio === 'video'`):
1. **Audio Native Video AI**: Model video yang mendukung audio native (`nativeAudio: true`, misal Veo 3.1) diminta menghasilkan suara dialog dan gerak bibir. Penutup prompt `NO_MUSIC` digantikan oleh varian dialog `NO_MUSIC_DIALOG` (`Clear spoken dialogue only: natural speech, ambient room sound, no background music, no soundtrack, no singing or humming.`), dan opsi `sound = 'on'` serta `generate_audio = true` diaktifkan. Model video tanpa `nativeAudio` akan diblokir oleh validasi pra-generasi jika proyek memakai `dialogAudio = 'video'`.
2. **Ekstraksi Audio Video ke Aset Klip**: Setelah video selesai dibuat, proses utama Electron mengekstrak track audio video menjadi file WAV 48 kHz stereo lewat FFmpeg (file ini suara akhir klip di pratinjau dan ekspor; Whisper membuat salinan 16 kHz sendiri) dan menyimpannya sebagai aset audio mandiri klip (`kind: 'audio'`, `provider: 'video'`, `meta.source = 'video'`). Kata per kata diselaraskan menggunakan Whisper (atau perkiraan timing jika Whisper belum siap). Engine pemutaran, timeline, waveform, caption, ducking musik, dan ekspor tetap membaca `clip.audioAssetId` sehingga konsistensi arsitektur terjaga tanpa mengubah player atau exporter. Durasi klip ikut panjang video supaya ucapan tidak terpotong di ujung klip lama; karena itu hash basis video memakai durasi video yang diminta (`videoSecondsFor`), bukan durasi klip. Suara mencatat `meta.videoAssetId`, sehingga memilih video lama dari riwayat ikut mengembalikan suaranya. Kalau video tidak punya suara atau FFmpeg gagal, alasannya disimpan di `meta.dialogAudioError` aset video dan ditampilkan di Storyboard/Inspector, karena narasi TTS tidak pernah mengisi klip dialog.
3. **Perekaman TTS per Suara**: Narasi dan dialog non-video direkam menggunakan sistem take kontinu per suara (`parts()` di `src/main/narration.ts` mengelompokkan klip berdasarkan suara karakter/narator yang sama). Klip dialog video dilewati sepenuhnya oleh jalur TTS agar tidak ada konflik audio ganda.

### Pembersihan menyeluruh saat hapus semua episode
Tindakan "Hapus semua episode" mereset seluruh episode dan klip, serta menghapus file aset fisik klip/episode di disk (gambar, video, audio) dan entri `assets`/`jobs` terkait tanpa memutus entitas Lorebook (karakter, varian kostum, lokasi, prop) maupun teks/kind sumber cerita. Sebelum menghapus, hanya job yang terkait episode/klip yang dibatalkan dan ditunggu berhenti (`cancelEpisodeJobs`); job lembar Lorebook tetap berjalan. File di disk dihapus setelah transaksi database berhasil. Pengaturan `plan_progress` dan `last_episode` di SQLite dihapus sehingga alur perencanaan dapat dimulai segar. Bundle proyek yang kosong mengembalikan `episodes: []`, `episode: null`, dan UI tetap stabil di Episode Hub tanpa membuat episode kosong otomatis.

### Eksekusi dua gelombang pada generate batch Lorebook
Lembar varian kostum (`character_derivatives`) dibuat dengan teknik image-to-image yang mewajibkan lembar karakter dasar induknya telah berwujud file gambar di disk. Karena itu, pembuatan batch lembar Lorebook (`generateMissingSheets`) membagi target ke dalam 2 gelombang (wave): Gelombang 1 mengeksekusi karakter dasar, lokasi, dan prop secara paralel tanpa menunggu satu sama lain. Gelombang 2 secara otomatis mendeteksi selesainya seluruh job gelombang 1 (termasuk penulisan lembar karakter dasar ke disk), lalu memicu pembuatan lembar varian kostum yang belum ada atau basi. Kalau ada job gelombang 1 yang dibatalkan, gelombang 2 tidak dijalankan sama sekali (kreator sudah menolak biayanya). Varian yang lembar dasarnya gagal dicatat sebagai job gagal beserta alasannya, sehingga terlihat di daftar job.

### Batas durasi maksimal serial 1 jam dan pilihan durasi terpadu
Untuk serial drama pendek multi-episode, total durasi serial dibatasi maksimal 1 jam (3600 detik) via `MAX_SERIES_DURATION_SEC`. Durasi per episode dibatasi rentang 30–180 detik via `MIN_EPISODE_DURATION_SEC` dan `MAX_EPISODE_DURATION_SEC`, dengan pilihan durasi di `EPISODE_DURATION_OPTIONS` (45, 60, 75, 90, 120, 150, dan 180 detik). Di Episode Hub, penghitungan total estimasi durasi (`targetEpisodeCount × durationSec`) ditampilkan secara real-time; tombol perencanaan dinonaktifkan dengan peringatan visual jika total melampaui 1 jam. Target "Otomatis" (`targetEpisodeCount = null`, juga nilai proyek lama) tidak membatasi planner; batas 1 jam lalu dicek pada jumlah `durationSec` hasil rencana. Target dibagi ke setiap potongan sumber sebanding panjangnya (`splitEpisodeTarget`, pembulatan sisa terbesar), dihitung sekali sebelum perulangan; selisih hasil terhadap target selalu dilaporkan ke kreator.

### Pembuatan draf naskah batch tanpa menimpa
Fitur "Buat semua naskah" di Episode Hub memproses episode yang belum memiliki naskah atau klip secara sekuensial. Proses ini hanya membuat draf rencana awal (`EpisodeScriptDraft`) dan tidak pernah mengonfirmasi rencana menjadi klip secara otomatis ataupun menimpa episode yang sudah dikerjakan/diedit oleh kreator. Kreator dapat membatalkan atau menghentikan antrean kapan saja; episode yang sudah selesai dibuat tetap tersimpan dengan aman.

### Bible Karakter (Visual & Narasi) dan Frasa Kunci Jangkar Kostum
Profil karakter di Lorebook diekspansi menjadi dua pilar: profil visual (usia, gender, bentuk wajah, rambut, postur tubuh, pakaian bawaan, dan ciri khas unik) serta profil narasi (peran cerita, hasrat utama, rahasia/konflik batin, busur karakter, dan pola bicara khas). Varian kostum (`CharacterDerivative`) dilengkapi `costumeKeyphrase`: frasa jangkar deskriptif singkat (misal *"jas wol hitam bergaris emas"*) yang disisipkan tegas ke prompt gambar dan prompt video AI untuk mengunci konsistensi pakaian lintas adegan tanpa drifting visual.

### Detail Sinematografi Shot & Aturan Batas Durasi Bicara
Setiap shot naskah dan timeline (`Clip`) kini menyimpan metadata sinematografi di `shot_detail_json`: pergerakan kamera, alasan dramatis sudut kamera, pencahayaan (lighting), blocking aktor, reaksi pemeran tanpa bicara (non-speaking reaction), atmosfer suara (SFX/ambience), serta gaya penyampaian bicara (speech delivery) dan tipe suara (`dialogue`, `os`, `vo`, `narration`). Untuk menjamin kewajaran ucapan manusia pada durasi adegan yang dipilih, fungsi `validateSpeechDuration` menghitung laju kata per detik (rata-rata 2,5 kata/detik, maksimal 3,5 kata/detik) dan memberi peringatan interaktif jika jumlah kata melebihi kapasitas durasi fisik adegan.

### Dokter Naskah (Script Doctor) & Indikator Ritme Adegan
Mesin pemeriksa naskah (`checkScriptDoctor`) berjalan lokal dan deterministik tanpa biaya token API tambahan. Aturan memeriksa formula drama pendek vertikal: kekuatan hook pembuka di shot 1, ketegangan cliffhanger di shot penutup, kejenuhan percakapan (talking-head monotony jika 4+ shot berurutan hanya berupa close-up dialog), pergantian kostum mendadak tanpa penjelasan pada lokasi yang sama, dan penyimpangan durasi total terhadap target episode. Indikator ritme (`computeEpisodeRhythm`) merender grafik sekuens adegan berwarna dengan segmen pacing (cepat/sedang/lambat) dan tipe shot yang dapat diklik untuk melompat langsung ke editor shot terkait.

### Penyambungan Frame Akhir Antar-Shot (`continue_from_previous`)
Untuk adegan yang merupakan kelanjutan aksi langsung dari adegan sebelumnya, opsi `continueFromPrevious` menginstruksikan proses utama mengekstrak frame dari 0,1 detik sebelum akhir video klip sebelumnya via FFmpeg. Frame ini diumpankan sebagai gambar awal (initial image) ke model video (Higgsfield / Flow2API), menghasilkan transisi gerak yang menyatu tanpa lompatan visual. Validasi pra-generasi otomatis memblokir pembuatan klip sambungan hingga video klip sebelumnya selesai, dan hash basis video membedakan shot mandiri dari shot tersambung.

### Pusat Tugas (Task Center), Arahan Serial, & Pipeline "Lanjutkan Semua"
Pusat Tugas (Task Center Modal) melacak seluruh antrean tugas produksi AI lintas episode (gambar, video, TTS, narasi, lembar Lorebook, dan render ekspor) dengan kapabilitas pembatalan tugas individu, pembatalan massal, eksekusi ulang tugas yang gagal, dan navigasi langsung ke shot asal. Arahan serial (`series_guidelines`) dan kustomisasi template prompt AI (`prompt_templates_json`) tersimpan per proyek dengan opsi pengembalian ke template bawaan. Pipeline "Lanjutkan Semua" menyatukan seluruh siklus produksi drama dari naskah, tinjauan, lembar Lorebook, gambar storyboard, hingga video gerak dalam satu alur terarah dengan transparansi estimasi biaya sebelum langkah berbayar dijalankan.

### Kontinuitas Lintas Episode (Continuity Items Tracker) & Aturan Hot/Cold Tiers
Untuk menjaga janji naratif serial multi-episode, `continuity_items` melacak janji plot, luka/status karakter, prop krusial, dan lore dunia cerita:
- **Tiers**: Item berprioritas `hot` harus diselesaikan (status `paid` atau `dropped`) dalam 3 episode sejak dimunculkan (`plantedEpisodeId`). Script Doctor memicu aturan `CONTINUITY_OPEN_TOO_LONG` jika item `hot` terabaikan selama 3 episode berturut-turut. Item `cold` diperuntukkan bagi misteri jangka panjang atau busur serial penuh.
- **Injeksi Konteks ke Planner**: Item kontinuitas yang masih aktif (`open`) otomatis dirangkum dan disuntikkan ke prompt penyusun draf naskah AI (`planEpisodeScript`), sehingga AI mengintegrasikan item-item tersebut ke dalam ketukan cerita episode berjalan.
- **Lorebook Dashboard**: Tab khusus Kontinuitas di Lorebook memungkinkan kreator memfilter berdasarkan kategori (`plot_thread`, `character_state`, `prop`, `lore`) dan tier, mencatat umur kemunculan item dalam episode, serta menyelesaikan item dengan tombol "Bayar Janji (Payoff)" satu klik.

### Kata Kunci Pengunci Kontinuitas (Lock Words) & Pemeriksaan Kepatuhan Prompt
Fitur lock words menyusun frasa kunci wajib yang tidak boleh diubah atau disimpangkan pada prompt visual dan prompt video AI:
- Frasa wajah dan rambut karakter diambil dari profil visual Lorebook (`c.profile.visual`).
- Frasa kostum diambil dari `costumeKeyphrase` varian kostum.
- Frasa lokasi dan prop diambil dari profil tetap masing-masing.
- Kreator dapat menambahkan kata kunci manual di tingkat serial (`seriesLock`) atau per episode (`lockWords`).
- `checkLockCompliance()` memvalidasi apakah prompt visual memuat frasa wajib (`compliant: true/false`, mengembalikan daftar `missing`). Peringatan visual ditampilkan jika ada frasa jangkar kontinuitas yang terhapus saat kreator mengedit prompt secara manual.

### Override Lembar Referensi per Shot & Aset Kustom
Secara bawaan, generator gambar mengumpulkan hingga 4 lembar referensi otomatis (karakter, varian kostum, lokasi, prop). Fitur override (`Clip.referenceAssetIds`):
- Memungkinkan kreator melepas lembar bawaan tertentu per shot atau mengunggah gambar referensi kustom melalui dialog pemilih file (`assets.pickReference`).
- Gambar kustom otomatis didaftarkan sebagai aset proyek bertag `customReference: true` dan diletakkan di slot prioritas terdepan pada `collectReferenceSheets()`.
- Hash basis gambar (`computeClipImageBasisHash`) sensitif terhadap perubahan `referenceAssetIds`, memastikan status generasi gambar otomatis beralih menjadi basi (stale) jika referensi visual diubah.

### Preset Platform Ekspor & Paket Pengiriman ZIP Mandiri (tar.exe)
- **Preset Platform**: Katalog `EXPORT_PRESETS` menyediakan setelan optimal untuk TikTok (9:16, 1080p, 8 Mbps, maks 600s), Instagram Reels (9:16, 1080p, 8 Mbps, maks 90s), YouTube Shorts (9:16, 1080p, 10 Mbps, maks 60s), YouTube Standard (16:9, 1080p, 12 Mbps), dan Facebook Reels. `validatePresetDuration` memberi peringatan langsung di dialog ekspor jika durasi proyek melampaui batas platform target.
- **Paket Pengiriman (.zip)**: Fungsi `exportDeliveryPackage` di `src/main/package.ts` mengemas video MP4 (jika tersedia), subtitle SRT yang diselaraskan per klip, gambar sampul & thumbnail JPG, aset visual lembar Lorebook, `manifest.json` (metadata serial, episode, statistik, daftar shot lengkap), serta `checksums.txt` (SHA-256 seluruh file) ke dalam satu arsip ZIP siap kirim menggunakan utilitas bawaan Windows `tar.exe -a -c -f` tanpa dependensi npm tambahan.

### Riwayat Versi & Snapshot Naskah (Script Versioning & Rollback)
- Draf naskah AI otomatis diarsipkan ke tabel `script_versions` saat pertama kali dibuat ("Rencana draft AI") dan saat dikonfirmasi menjadi shot storyboard ("Naskah dikonfirmasi").
- Kreator dapat membuat snapshot manual dengan catatan kustom sebelum melakukan perombakan besar cerita.
- Riwayat versi dapat ditinjau kapan saja di langkah Rencana; satu klik "Pulihkan" mengembalikan draf lengkap tanpa kehilangan entitas Lorebook.

### Katalog Model & Pengaturan Modular (resolveActive & Stale Warning)
- Modul `src/shared/providers.ts` menjadi *single source of truth* untuk seluruh resolusi model AI (LLM, TTS, visual image, visual video) via helper `resolveActive()`.
- Halaman Pengaturan dipecah menjadi 5 modul terpisah di `pages/settings/`: Model Aktif (`ActiveModelsSection`), Penyedia & Kunci API (`ProvidersSection`), Penyedia Custom (`CustomProviderModal`), Umum & Editor (`GeneralSection`), serta Whisper & Subtitle (`WhisperSection`).
- Saat kreator mengganti model visual aktif di Pengaturan, dialog peringatan interaktif memberitahukan bahwa pergantian model akan menandai aset gambar/video yang sudah ada sebagai basi (stale) sehingga kreator mengetahui adegan mana yang perlu diselaraskan ke model baru.
- Kredensial penyedia custom (kompatibel OpenAI Chat dan Flow2API) dapat diuji langsung dan disimpan secara terenkripsi di `secrets.ts` seperti penyedia bawaan.


### Perbaikan tinjauan fase 7–8 (2026-11-21)
- **Referensi per shot:** kolom `clips.reference_asset_ids_json` bernilai bawaan `'[]'`, jadi daftar kosong berarti
  **otomatis** (`referenceAssetIds = null`), bukan override kosong. Semua pemeriksaan memakai
  `hasReferenceOverride` di `shared/prompts.ts`; melepas chip terakhir mengembalikan shot ke mode otomatis.
- **Hash lembar Lorebook:** `generation.ts` mengambil hash basis dari fungsi status lembar di `shared/validation.ts`
  (dengan model gambar aktif), sehingga lembar baru tidak langsung basi. Profil kosong (`{}` atau kolom kosong)
  di-hash sama dengan tanpa profil.
- **Dialog video:** `isVideoDialogue` hanya benar untuk `dialogueType = 'dialogue'`. O.S., V.O., dan narasi selalu
  lewat TTS; narasi, batch TTS, generate video, dan Storyboard memakai aturan yang sama.
- **Model aktif:** jalur Higgsfield (gambar shot, lembar, estimasi) memakai model dari Pengaturan › Model aktif, bukan
  `project.imageModel`.
- **Paket kirim:** zip dibuat dengan `%SystemRoot%\System32\tar.exe` (bsdtar). `tar.exe` lewat PATH bisa
  mengenai tar GNU dari Git yang tidak bisa menulis zip dan membaca `C:` sebagai host jarak jauh.
- **Ekstraksi Lorebook:** membaca seluruh sumber per potongan (`planWindows`), menggabungkan kandidat berdasarkan
  nama dan alias, dan bisa dihentikan; hasil bagian yang sudah dibaca tetap bisa ditinjau.
- **Penyedia TTS global:** narasi dan TTS per klip memakai penyedia dari Pengaturan › Model aktif lewat
  `withActiveTts` (`shared/providers.ts`); `projects.tts_provider` hanya menandai penyedia milik suara narator.
  Bila penyedia global berbeda, suara narator proyek dan suara tokoh dari penyedia lain dilewati dan suara bawaan
  penyedia aktif dipakai (ElevenLabs tidak punya suara bawaan, jadi kreator diminta memilih suara).
- **Preset ekspor:** hanya preset dengan rasio yang sama dengan proyek (plus Kustom) yang ditawarkan, karena
  exporter selalu merender dalam rasio proyek; crop/pad ke rasio lain belum ada.
