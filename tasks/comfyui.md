# Rencana: Provider Visual ComfyUI

Status: **draf, belum dikerjakan** (2026-11-21).

## Tujuan

Menambahkan ComfyUI sebagai penyedia visual ketiga di samping Higgsfield dan Flow2API. Gambar klip, thumbnail,
lembar karakter, varian, lokasi, prop, dan video dibuat oleh workflow ComfyUI milik pengguna, yang berjalan di
komputer sendiri atau di GPU sewaan (RunPod, Vast.ai, dan sejenisnya).

## Acuan

- API ComfyUI: `POST /upload/image`, `POST /prompt`, `GET /history/{id}`, `GET /view`, `GET /queue`,
  `POST /queue` (delete), `POST /interrupt`, `POST /api/jobs/{id}/cancel` (≥ 0.26), `GET /system_stats`,
  `GET /object_info`.
- Contoh alur yang sudah jadi: proyek ArcReel (`C:\Project\ArcReel`). Baca `docs/adr/0081-*.md`,
  `docs/adr/0082-*.md`, `lib/custom_provider/comfyui/` (terutama `comfyui_backend.py`, `comfyui_execution.py`,
  `request_builder.py`), dan `packages/arcreel-market-core/src/arcreel_market_core/comfyui/bindings.py`.
- **Lisensi:** ArcReel berlisensi **AGPL-3.0**. Konsepnya boleh ditiru, tapi kodenya **jangan disalin atau
  diterjemahkan baris per baris**. Tulis ulang dari pemahaman sendiri.

## Keputusan desain

1. **Satu workflow sama dengan satu "endpoint ComfyUI".** Workflow disimpan apa adanya dalam format API (hasil
   "Export (API)" di ComfyUI), ditambah `mediaType` (`image` | `video`) dan `bindings`. Pengguna memilih satu
   workflow gambar dan satu workflow video sebagai bawaan.
2. **Binding node adalah satu-satunya sumber kebenaran.** Binding memetakan kunci semantik ke target
   `{ nodeId, input, classType, title }`.
   - Kunci gambar: `prompt`, `negative_prompt`, `reference_images`, `width`, `height`, `seed`, `output`.
   - Kunci video: kunci gambar ditambah `start_image`, `end_image`, `frames`, `fps`.
   - `prompt` dan `output` wajib diisi. Binding yang belum lengkap tidak bisa disimpan.
   - Tebakan otomatis hanya dibuat saat impor. Saat generate, aplikasi hanya membaca binding dan tidak menebak
     lagi, supaya hasilnya bisa diulang.
3. **Kemampuan diturunkan dari binding** dan tidak disimpan terpisah:
   - Workflow video tanpa `start_image` berarti t2v. Jika ada, berarti i2v.
   - Batas jumlah referensi sama dengan jumlah target `reference_images`.
   - Durasi hanya bisa diatur kalau `frames` terikat. Kalau tidak, durasi ditentukan workflow, dan UI menampilkan
     keterangannya.
4. **Isi nilai** (fungsi murni `buildWorkflow`):
   - Ukuran dihitung dari rasio proyek dan resolusi, lalu dibulatkan ke kelipatan 8 (atau 16).
   - `frames = round(durasi × fps) + 1`, lalu disesuaikan ke pola 4n+1 atau 8n+1 bila workflow membutuhkannya.
   - Seed diacak bila tidak ditentukan. Seed yang benar-benar dipakai dicatat di `meta` aset.
   - Baris `Avoid:` dipindahkan dari prompt positif ke `negative_prompt`. Kalau `negative_prompt` tidak terikat,
     baris itu dibuang.
   - Jika referensinya lebih banyak dari slot, generate ditolak dengan pesan yang jelas. Jika lebih sedikit, versi
     pertama juga menolak. Memangkas node yang tidak terpakai bisa ditambahkan nanti.
5. **Hanya polling `/history`, tanpa WebSocket.** Cara ini lebih tahan terhadap proxy GPU sewaan yang memutus
   koneksi lama. Progres yang ditampilkan berupa status ("antre", "berjalan"), bukan persentase palsu.
6. **`prompt_id` disimpan ke `jobs.remote_id`** lewat `ctx.setRemote` begitu submit berhasil. Base URL saat
   submit ikut disimpan di `payload_json`. Saat aplikasi dibuka lagi, job dilanjutkan dengan polling ke base URL
   tersebut, **tanpa submit ulang**.
7. **Batal berarti job di server ikut dihentikan.** Untuk versi ≥ 0.26 pakai `POST /api/jobs/{id}/cancel`. Untuk
   versi lama pakai `POST /queue {"delete":[id]}` lalu `POST /interrupt` jika job sedang berjalan. Timeout
   permintaan ini pendek (15 detik). Kalau gagal, cukup dicatat di log.
8. **Auth opsional.** ComfyUI asli tidak punya login. Untuk pod sewaan di belakang reverse proxy, token disimpan
   lewat `secrets.ts` (kunci `comfyui`) dan dikirim sebagai `Authorization: Bearer`. Token tidak boleh masuk log
   atau pesan error (AGENTS.md no. 2).
9. **Tanpa estimasi kredit.** Estimasi mengembalikan "lokal / 0". Lama eksekusi dicatat di `meta` aset.
10. **Concurrency bawaan 1**, karena biasanya hanya ada satu GPU.

## Batasan yang harus disadari

- **Dialog dengan gerak bibir (Veo) tidak tersedia.** Model video open-source (Wan, LTX) tidak menghasilkan suara.
  Jadi saat provider ComfyUI aktif, shot dialog harus memakai `dialog_audio = 'tts'`. Syarat ini perlu ditambahkan
  di `src/shared/validation.ts`, dan UI perlu menampilkan alasannya.
- Video lokal butuh VRAM besar (realistisnya 12–24 GB) dan jauh lebih lambat. Batas waktu polling harus bisa
  diatur (bawaan 30 menit untuk video, 10 menit untuk gambar).
- Konsistensi karakter dari lembar referensi bergantung pada workflow (IP-Adapter, PuLID, Flux Kontext,
  Qwen-Image-Edit). Itu urusan workflow, bukan kode ReelStar.

## Pemakaian di GPU sewaan

| Cara | Base URL di ReelStar | Perubahan kode |
|---|---|---|
| Terowongan SSH `ssh -N -L 8188:localhost:8188 …` | `http://127.0.0.1:8188` | tidak ada |
| Tailscale / Cloudflare Tunnel | URL privat | tidak ada |
| Proxy publik (mis. `https://<pod>-8188.proxy.runpod.net`) | URL proxy + token | butuh auth (keputusan 8) |
| Serverless (RunPod `worker-comfyui`, Modal) | — | **di luar lingkup**, butuh adapter lain |

Dokumentasi pengguna perlu menyebut bahwa proxy publik tanpa auth membuat GPU bisa dipakai siapa saja yang tahu
URL-nya.

## Tugas

### Tugas 0 — Refactor `VisualBackend` (prasyarat)

Saat ini `if (isFlow2Api()) { … }` diulang di sekitar 7 fungsi di `src/main/generation.ts`: gambar klip,
thumbnail, lembar karakter, lembar turunan, lokasi, prop, dan video. Sebelum ComfyUI masuk:

- Tentukan interface `VisualBackend { id, generateImage(opts), generateVideo(opts), cancel?(remoteId) }` dengan
  opsi bersama: `prompt`, `referenceImages: Buffer[]`, `aspectRatio`, `durationSec`, `initialImage`, `signal`,
  `onProgress`, `setRemote`.
- Hasilnya berupa `{ bytes: Buffer, ext }` atau `{ url }`. ComfyUI butuh bentuk `bytes`, karena `/view` bisa
  memerlukan header auth sehingga `downloadTo(url)` biasa tidak cukup.
- Pindahkan cabang Flow2API ke implementasi interface ini. Perilakunya harus **tetap identik**.
- Higgsfield boleh tetap memakai jalurnya sendiri (submit/estimate/resume) bila terlalu berbeda. Yang penting,
  cabang provider tidak bertambah dari 2×7 menjadi 3×7.
- Cek: typecheck dan build bersih, generate Flow2API lewat dev harness masih berjalan.

### Tugas 1 — Tipe, setting, dan penyimpanan workflow

- `src/shared/types.ts`: `VisualProvider` ditambah `'comfyui'`, `ApiProvider` ditambah `'comfyui'` (untuk token).
  Tambahkan tipe `ComfyWorkflow { id, name, mediaType, workflow, bindings, importedAt }` dan `ComfyBindingTarget`.
- Setting: `comfyuiBaseUrl` (bawaan `http://127.0.0.1:8188`), `comfyuiImageWorkflowId`, `comfyuiVideoWorkflowId`,
  `comfyuiConcurrency` (1), `comfyuiImageTimeoutMin` (10), `comfyuiVideoTimeoutMin` (30).
- Penyimpanan: tabel baru `comfy_workflows` lewat migrasi **di akhir** `MIGRATIONS`. Pilihan lain adalah file JSON
  di folder data. Pilih tabel kalau workflow perlu ikut ekspor atau duplikasi proyek. Kalau tidak, cukup file.
  Catat keputusannya di `docs/keputusan-teknis.md`.
- Antrean job `comfyui` di `jobs.ts` memakai `comfyuiConcurrency`.

### Tugas 2 — Klien `src/main/services/comfyui.ts`

- `testConnection()` lewat `GET /system_stats`, mengembalikan versi ComfyUI dan info GPU.
- `uploadImage(buf, name)` lewat multipart ke `/upload/image`, mengembalikan nama file di server.
- `submit(workflow, clientId)` lewat `POST /prompt`, mengembalikan `prompt_id`. `node_errors` diterjemahkan
  menjadi pesan berbahasa Indonesia yang menyebut judul node.
- `waitForResult(promptId, { signal, timeoutMs, onProgress })`: polling `/history/{id}` dengan jeda bertahap.
  `/queue` dipakai untuk membedakan "antre" dari "berjalan". Kalau `prompt_id` tidak ada di history maupun di
  queue, job dianggap hilang.
- `download(outputRef)` lewat `GET /view` dengan auth, mengembalikan `Buffer`. Validasi ekstensi dan jenis file
  (gambar: png/jpg/webp; video: mp4/webm), dan batasi ukuran.
- `cancel(promptId)` sesuai versi server (keputusan 7).
- `checkNodes(workflow)` lewat `GET /object_info`: memastikan semua `class_type` ada di server sebelum submit.
- `friendlyError`: pesan untuk ECONNREFUSED, 401/403, dan timeout. Ikuti pola di `flow2api.ts`.
- `clientId` diberi awalan `reelstar-<jobId>` supaya mudah dikenali di antrean ComfyUI.

### Tugas 3 — Binding dan `buildWorkflow` (fungsi murni)

- `src/main/comfyui/bindings.ts` (atau `src/shared/` bila renderer juga membutuhkannya untuk editor binding):
  - `inferBindings(workflow, mediaType)`: tebakan dari judul `REELSTAR:<kunci>` (sinyal terkuat), ditambah aturan
    nama field × `class_type`. Contoh: `CLIPTextEncode.text` → `prompt`, `LoadImage.image` → gambar,
    `KSampler.seed`, `EmptyLatentImage.width/height`, `length`/`num_frames` → `frames`, `SaveImage`/`VHS_VideoCombine`
    → `output`. Hasilnya berupa kandidat dan tanda ambigu kalau ada dua kandidat dengan skor sama.
  - `validateBindings(workflow, bindings, mediaType)`: target ada, input ada, kunci wajib terisi.
  - `capabilitiesOf(bindings)` (keputusan 3).
- `buildWorkflow(def, input)` → `{ workflow, seed, width, height, frames }` (keputusan 4). Fungsi ini tidak boleh
  mengubah objek workflow aslinya.
- Uji dengan dev harness memakai 2–3 contoh workflow (SDXL/Flux t2i, Flux Kontext/Qwen-Edit i2i, Wan i2v).
  Simpan contohnya di `resources/comfyui/examples/`.

### Tugas 4 — Backend ComfyUI dan integrasi `generation.ts`

- Implementasi `VisualBackend` untuk ComfyUI: cek node, upload gambar, `buildWorkflow`, submit, `setRemote`,
  tunggu, download, lalu simpan aset dengan `provider: 'comfyui'` dan `meta: { seed, workflowId, durationMs }`.
- Melanjutkan job saat startup: di loop pemulihan job (`generation.ts` dekat pemulihan Higgsfield), job
  `provider = 'comfyui'` yang punya `remote_id` dilanjutkan dengan polling ke base URL di payload, tanpa submit
  ulang.
- `cancelJob` di `jobs.ts`: untuk `provider === 'comfyui'`, panggil `comfyui.cancel(remote_id)`.
- Estimasi kredit menampilkan "lokal".
- `src/shared/validation.ts`: kalau provider ComfyUI, shot dialog wajib `dialog_audio = 'tts'`, dan durasi
  dikunci kalau `frames` tidak terikat.

### Tugas 5 — IPC dan UI Settings

- IPC (tiga tempat, AGENTS.md no. 5): `comfyui:test`, `comfyui:importWorkflow` (dialog pilih file JSON, lalu
  inferensi), `comfyui:saveWorkflow`, `comfyui:listWorkflows`, `comfyui:deleteWorkflow`.
- Tolak file yang bukan format API, misalnya file workflow UI yang punya `nodes`/`links`. Pesannya: "Ekspor dulu
  lewat menu Export (API) di ComfyUI".
- Halaman Settings, bagian ComfyUI: base URL, token opsional, tombol "Tes koneksi", daftar workflow, serta pilihan
  workflow gambar dan video bawaan (komponen `Select`, bukan `<select>`), dan batas waktu.
- **Editor binding:** tabel kunci semantik → pilihan node/input dari kandidat. Kandidat yang ambigu wajib dipilih
  sebelum disimpan. Tampilkan juga ringkasan kemampuan (t2v/i2v, jumlah slot referensi, durasi bisa diatur atau
  tidak).
- Pilihan penyedia visual bawaan ditambah ComfyUI.
- Semua teks UI dalam bahasa Indonesia santai dengan "kamu".

### Tugas 6 — Dokumentasi dan checkpoint

- `docs/layanan-ai.md`: bagian ComfyUI (setup lokal, GPU sewaan, peringatan auth, cara menandai node dengan
  `REELSTAR:<kunci>`).
- `docs/keputusan-teknis.md`: alasan memakai polling dan bukan WebSocket, binding sebagai sumber kebenaran, dan
  batal yang ikut menghentikan job di server.
- `AGENTS.md`: peta kode ditambah `services/comfyui.ts` dan modul binding.
- **Checkpoint:**
  - typecheck dan build bersih.
  - Lewat dev harness dengan `STUDIO_USER_DATA` sementara dan ComfyUI lokal atau pod:
    - (a) gambar klip t2i;
    - (b) lembar karakter dengan referensi;
    - (c) video i2v;
    - (d) batal di tengah jalan, dan job hilang dari antrean ComfyUI;
    - (e) tutup aplikasi saat video sedang berjalan, buka lagi, dan hasilnya tetap masuk tanpa submit ulang;
    - (f) server mati, dan pesan error-nya jelas.

## Di luar lingkup (versi pertama)

- Adapter serverless (RunPod Serverless, Modal, ComfyDeploy, Comfy Cloud).
- Progres lewat WebSocket.
- Pencocokan ulang binding otomatis saat workflow diimpor ulang. Untuk sekarang, impor ulang selalu membuka editor
  binding.
- Memangkas node referensi yang tidak terpakai.
- Workflow audio/TTS di ComfyUI.
