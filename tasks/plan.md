# Rencana Perbaikan UI/UX, Dark Mode, Tombol & Layout (1180×720) — ReelStar

Dokumen ini merinci rencana pengerjaan untuk seluruh **80 temuan** hasil audit UI/UX di seluruh 55 file `.tsx` (`7 Kritis, 26 Tinggi, 32 Sedang, 15 Rendah`), dengan target:
- Seluruh elemen terlihat tajam dan kontras WCAG AA di **Light Mode** maupun **Dark Mode** (`html.dark`).
- Tata letak stabil, tidak terpotong, dan tidak meluber di ukuran jendela minimum **`1180×720`**.
- Seluruh tombol destruktif punya konfirmasi, seluruh kontrol punya status `loading`/`disabled`/aksesibilitas (`aria-label`, keyboard, `Switch disabled`), dan teks antarmuka konsisten dalam Bahasa Indonesia santai ("kamu").

---

## Fase 1 — Dark Mode, Kontras, & Komponen Inti (`styles.css` & `components/*`)

**Tujuan:** Memperbaiki seluruh ikon/teks tak terlihat di dark mode, konflik kelas Tailwind v4, token CSS mati, serta perilaku dasar komponen bersama (`ui.tsx`, `ModelPicker`, `Toasts`, `ProviderLogo`, `ModelLogo`, `StylePicker`).

### File & Perubahan
1. **`src/renderer/src/styles.css`**
   - Tambahkan token `--color-on-sun: #1f1d1a` (untuk teks/ikon di atas `bg-sun` di kedua tema) dan `--color-sand-2` (terang `#ebe4d8`, gelap `#322e29`) agar utility `bg-sand-2` / `hover:bg-sand-2` valid.
2. **`src/renderer/src/components/ProviderLogo.tsx`**
   - Ubah `LOOK.custom.bg` dari `'#F3EFE8'` ke `'var(--color-sand)'` agar ikon `<Server className="text-ink" />` pada provider Local LLM / Custom kontras penuh di dark mode.
3. **`src/renderer/src/components/ModelLogo.tsx`**
   - Ubah fallback `look?.bg ?? '#F3EFE8'` menjadi `look?.bg ?? 'var(--color-sand)'`.
4. **`src/renderer/src/components/ui.tsx`**
   - Tambah prop `disabled?: boolean` pada `Switch` (terapkan `disabled`, `aria-disabled`, dan styling non-interaktif).
   - Perbarui `ConfirmHost`: pindahkan tombol aksi ke sticky `footer` `<Modal>`, pakai gaya bahaya merah (`bg-bad text-white border-[1.5px] border-ink`) saat `req?.danger`, dan hapus `autoFocus` dari tombol destruktif.
   - Perbarui `Menu`: tambahkan `role="menu"`, `role="menuitem"`, `aria-haspopup="menu"`, `aria-expanded`, `e.stopPropagation()` pada klik item (mencegah bubbling ke kartu induk), navigasi panah atas/bawah, dukungan `disabled?: boolean` per item, dan kembalikan fokus ke tombol pemicu saat `Escape`.
5. **`src/renderer/src/components/Toasts.tsx`**
   - Pisahkan kelas latar menjadi ternary eksklusif (`t.kind === 'error' ? 'bg-bad-soft' : 'bg-surface'`) agar `bg-surface` tidak menimpa `bg-bad-soft`.
   - Perbesar tombol tutup `×` menjadi `size-7` (`28×28px`) dengan `title="Tutup"`.
6. **`src/renderer/src/components/ModelPicker.tsx`**
   - Perbaiki konflik kelas latar (`value || open ? 'bg-surface' : 'bg-accent-soft'`).
   - Pakai `useId()` untuk `listId` (hindari bentrok `id="model-list"`).
   - Pindahkan menu ke `<Popover>` portal agar tidak terpotong `overflow-hidden`, tambah `e.stopPropagation()` + refocus trigger saat `Escape`, perbesar tombol hapus pencarian (`size-7`, `title="Hapus pencarian"`), perbesar tombol `Muat ulang` (`px-2 py-1`), dan terima prop `ariaLabel`.
7. **`src/renderer/src/components/StylePicker.tsx`, `StyleMenu.tsx`, `Select.tsx`**
   - Ganti `hover:shadow-ink-sm` → `hover:shadow-ink` & `"Default"` → `"Bawaan"` di `StylePicker.tsx`.
   - Tambah `min-w-0` & `title` pada preview `StyleMenu.tsx` serta `title` pada label terpotong `Select.tsx`.

---

## Fase 2 — Halaman Home & Pengaturan (`Home.tsx`, `Settings.tsx`, `pages/settings/*`, `AboutSection.tsx`, `WhisperSection.tsx`)

**Tujuan:** Memperbaiki tinggi input `<28px`, sticky footer modal, label model Gemini TTS yang salah, responsivitas `KeyForm`, empty/loading state, dan error handling.

### File & Perubahan
1. **`src/renderer/src/pages/Home.tsx`**
   - Pindahkan tombol aksi `NewSerialModal` ke sticky `footer` `<Modal>`, tambahkan `flex-wrap gap-x-3 gap-y-1` pada baris estimasi durasi, ganti tombol toggle `"Setel otomatis"` dari `primary` ke `ink`/`secondary`, ubah `'Auto'` → `'Otomatis'`, dan format angka dengan `toLocaleString('id-ID')`.
   - Tampilkan pemilih Bahasa & TTS di dalam `NewSerialModal` (terisi dari nilai hero) agar bisa dilihat dan diubah.
   - Tambah `aria-label` & `title` pada tombol stepper `-` / `+` Target Episode, reset `e.target.value = ''` pada `handleFileUpload`, tambah `try/catch` + toast pada `remove()`/`duplicate()`.
   - Tambah skeleton loading saat `projects === null`, empty state + tombol `"Reset filter"` saat pencarian/filter kosong, `w-full max-w-[360px] min-w-[180px]` pada input cari, `grid-cols-3 xl:grid-cols-4` pada grid kartu, serta `title` pada teks terpotong.
2. **`src/renderer/src/pages/Settings.tsx` & `AboutSection.tsx` & `WhisperSection.tsx`**
   - `Settings.tsx`: tampilkan `<Spinner />` saat `settings === null`, tangkap error `reload()` dengan toast + tombol coba lagi, tambah `aria-label="Kembali ke beranda"` pada tombol logo.
   - `AboutSection.tsx`: ganti `bg-ink` pada wrapper YouTube menjadi `bg-black`; beri gaya tautan + ikon `ExternalLink` pada tagline yang bisa diklik.
   - `WhisperSection.tsx`: tambah `try/catch` + toast error dan status pending/disabled pada `download`, `cancel`, `remove`, dan `Switch` `whisperAuto`.
3. **`src/renderer/src/pages/settings/ActiveModelsSection.tsx`**
   - Perbaiki label model Gemini TTS agar cocok dengan `value`-nya (`gemini-3.8-flash-tts`, `gemini-2.5-flash-tts`).
   - Pindahkan footer dialog konfirmasi ganti model ke sticky `footer`, pass `disabled={saving}` ke semua `<Select>`/`<ModelPicker>`, hormati model TTS tersimpan saat pindah penyedia, tambah `gap-2 min-w-0` di header kartu, dan bersihkan istilah Inggris `(Visual Image)`/`(Visual Video)`/`(stale)`.
4. **`src/renderer/src/pages/settings/ProvidersSection.tsx` & `CustomProviderModal.tsx`**
   - `CustomProviderModal.tsx`: tambahkan `h-11` pada semua `<input>` agar tidak gepeng, pindahkan tombol aksi ke sticky `footer`, seragamkan label `"Kustom"`/`"Ubah"`.
   - `ProvidersSection.tsx`: tambah `min-w-0` & tata ulang baris `KeyForm` untuk penyedia custom/Flow2API (grid 2 kolom URL + Key di atas tombol aksi agar tidak terjepit di `1180px`); tambah `catch` + busy disable pada `test()`/`clear()`, `title` pada `cp.name`/`cp.baseUrl`, dan jangan render spacer kosong saat `help=""`.
5. **`src/renderer/src/pages/settings/GeneralSection.tsx`**
   - Tambah `h-11` pada input, ganti `<input type="number">` konkurensi menjadi `<Segmented>` (`1|2|3|4` & `1|2|3`) agar tidak memblokir Backspace, tambah `title` pada path folder, dan ganti `"default"` → `"bawaan"`.

---

## Fase 3 — Studio Chrome, Episode Hub, Lorebook & Modal Proyek

**Tujuan:** Menghilangkan overflow header `1180px` dan grid Lorebook sempit, mengamankan tombol destruktif, melengkapi `aria-label`, dan merapikan istilah Indonesia.

### File & Perubahan
1. **`src/renderer/src/pages/project/StudioHeader.tsx`**
   - Ubah grid header menjadi `grid-cols-[minmax(0,1fr)_auto_auto]` (atau flex shrinkable), sesuaikan lebar judul (`max-w-[130px] xl:max-w-[220px]`) dan episode `Select` (`w-[140px] xl:w-[180px]`), tambah `min-w-0` di kolom tengah, `whitespace-nowrap` pada `SaveStatus`, hapus duplikasi tombol Tugas di menu `⋮`, dan samakan toast `"Serial"`.
2. **`src/renderer/src/pages/project/StudioSidebar.tsx`**
   - Tambah `aria-label` dan `aria-current="page"` pada tombol ciut, tombol `+` episode, dan item navigasi; tambah guard `creating` + `try/catch` pada `handleAddEpisode`; tambah titik indikator lembar kurang saat sidebar ciut; pertahankan tab aktif saat ganti episode; samakan label status `planned` (`'Siap Naskah'`).
3. **`src/renderer/src/pages/project/EpisodeHub.tsx`**
   - Ubah input kartu episode (`title`, `hook`, `cliffhanger`, `summary`) dari `defaultValue` tak terkontrol menjadi input tersinkronisasi/terkontrol dengan `aria-label` & `min-w-0`.
   - Tambah `aria-label` pada tombol stepper `-`/`+`, `try/catch` + disable guard pada buat/sisip/pindah episode, reset `e.target.value = ''` pada unggah file, `shrink-0` pada badge+menu, dan ganti `Auto` → `Otomatis` serta samakan satuan `dtk`.
4. **`src/renderer/src/pages/project/LorebookPage.tsx`**
   - Perbaiki layout grid saat panel detail terbuka (`min-w-0`, lebar panel `w-[360px] xl:w-[420px]`, kolom adaptif berdasarkan `hasSelection`).
   - Ganti `text-good` → `text-ok-ink`, tambah konfirmasi `confirmDialog` + `aria-label` + `try/catch` pada hapus varian kostum, tambah `loading={charRunning}` pada `"Buat lembar AI"` karakter (dan disable tombol unggah saat berjalan).
   - Tambah empty state pada tab Pemeran (`cast`), hapus tombol duplikat `"Tambah Benang Cerita"`, tambah `aria-label` pada tombol hapus alias & input/checkbox, tambah `try/catch` pada `handleAddLocation`/`Prop`/`Variant`, await `switchEpisode` saat loncat ke episode, tangani `episodes.length === 0` di modal kontinuitas, dan ubah enum/istilah Inggris (`{lock.source}`, `Lock Words`, `Character Bible`, `HOT`/`COLD`, dll.) ke Bahasa Indonesia.
5. **`src/renderer/src/pages/project/CharacterModal.tsx`, `CandidateReviewModal.tsx`, `MergeAssetModal.tsx`, `SeriesGuidelinesModal.tsx`, `ModelSection.tsx`**
   - Pindahkan footer aksi keempat modal ke sticky `footer` `<Modal>`, batasi tinggi preview `CharacterModal` (`max-h-[240px]`), tambah guard `starting` pada `generate()`, dan terjemahkan `LOOK_HINT`.
   - `CandidateReviewModal.tsx`: ganti `text-accent` → `text-accent-ink`, tambah `flex-wrap min-w-0` di baris badge, reset `activeTab` saat hasil baru tiba, gunakan `loading={submitting}` di tombol konfirmasi, dan map `interiorExterior` ke Bahasa Indonesia.
   - `MergeAssetModal.tsx`: tampilkan ikon `MapPin`/`Package`/`Users` sesuai jenis aset, tambah `min-w-0` & `w-full` pada nama kandidat.
   - `SeriesGuidelinesModal.tsx`: tambah `confirmDialog` + `disabled` pada `"Reset Semua ke Bawaan"`, ubah dependency `useEffect` ke `[open, project?.id]` agar edit tidak ter-reset, hubungkan `<label htmlFor>`, tambah `flex-wrap gap-2`, dan rapikan label.
   - `ModelSection.tsx`: tambah `try/catch` pada `settings.set`, batasi `menuClassName` dengan `max-w-[calc(100vw-2rem)]`, dan ubah `Draft` → `Draf`.

---

## Fase 4 — Produksi, ShotCard & Modal Batch/Ekspor

**Tujuan:** Memisahkan mode Draf vs klip terkonfirmasi secara tegas, memperbaiki audio Animatic & toggle `ExportDialog`, memperbaiki overlay dark mode, dan merapikan kepadatan `1180×720`.

### File & Perubahan
1. **`src/renderer/src/pages/project/ProductionStep.tsx`**
   - Sembunyikan/nonaktifkan toolbar generasi klip Bar 1, filter status Bar 2, dan Multi-Select Batch Bar saat `draft` aktif (tampilkan lencana `"Mode Draf"`), serta bersihkan `selectedBatchIds` saat masuk mode Draf.
   - Hapus duplikasi `"Optimasi Prompt"` di Bar 2 agar muat 1 baris di `1180px`, perbaiki kontras badge `Cek Naskah` saat aktif, tambah empty state filter dengan tombol `"Tampilkan semua shot"`, guard menu `...` terhadap `busyAi`, lengkapi `aria-label` input draf, dan rapikan Multi-Select Batch Bar (`Pilih semua`, hitungan `TTS`, `"Batal pilih"`).
2. **`src/renderer/src/pages/project/ShotCard.tsx`**
   - Ganti overlay thumbnail `bg-ink/85 text-paper` / `hover:bg-ink/35` menjadi `bg-black/75 text-white` / `hover:bg-black/40`.
   - Rapikan kepadatan Zone 1 & Zone 3 di `1180px`, tambah `max-h-56 overflow-y-auto scroll-thin` pada popover Lokasi & Prop, nonaktifkan tombol `Unggah` saat `refCap === 0` dan `Buat Video` saat `!image && !clip.continueFromPrevious`.
   - Perbesar hit area titik versi gambar + tambah `aria-label`/`aria-current`, tambah `aria-label` pada seluruh `AutoTextarea`, dan rapikan copy Indonesia (`kunci kontinuitas`, `sebagai referensi`).
3. **`src/renderer/src/pages/project/ProductionDrawers.tsx` & `NewAssetsBanner.tsx`**
   - `ProductionDrawers.tsx`: tambah `max-h-40 overflow-y-auto scroll-thin` + `break-words` di `LocksDrawer`, tambah `aria-label` & `htmlFor`/`id` di input, tambah `loading` state pada tombol `Pulihkan` snapshot, rapikan teks `verbatim`.
   - `NewAssetsBanner.tsx`: tambah petunjuk saat `blockingCount > 0`, pesan saat daftar target kosong, dan `flex-wrap`.
4. **`src/renderer/src/pages/project/AnimaticPreviewModal.tsx`**
   - Hapus hardcoded `muted` pada `<video>` → sinkronkan `muted={muted || Boolean(audio)}` dan perbarui badge `"Tanpa suara"` untuk dialog video; tambah `gap-2`/`shrink-0`/`flex-wrap` dan shortcut `Space`/`ArrowLeft`/`ArrowRight`.
5. **`src/renderer/src/pages/project/TaskCenterModal.tsx`**
   - Pilih tab awal otomatis (`active` → `failed` → `all`), tambah `min-w-0 flex-1`, `shrink-0`, `break-words`, `scroll-thin`, ikon `export`, ganti `text-accent` → `text-accent-ink`, dan rapikan istilah `"Pusat Tugas"` / `"Buat ..."`.
6. **`src/renderer/src/pages/project/BatchEstimateModal.tsx` & `BatchEstimateSheetModal.tsx`**
   - `BatchEstimateSheetModal.tsx`: keluarkan footer dari `result ?`, tambah `loading={starting}`, `disabled={loading || !result?.canRun || result.totalItems === 0}`, `disabled={starting}` pada `Batal`, reset `includeStale` saat dibuka, dan rapikan judul/istilah.
   - `BatchEstimateModal.tsx`: tambah `<Spinner />`, `gap-2 min-w-0 truncate shrink-0`, `scroll-thin`, dan perjelas rincian total kredit + jumlah lembar di CTA.
7. **`src/renderer/src/pages/project/ExportDialog.tsx`**
   - Pakai `activeEditor = episode?.editor ?? project.editor` untuk status disabled toggle, pass `disabled` ke `<Switch>`, ganti `bg-ink/80` → `bg-black/75 text-white`, tambah `title` penjelasan & peringatan saat 0 klip, perbarui label tombol footer `{packagePath ? 'Buka Paket (.zip)' : 'Paket (.zip)'}` + disable saat 0 klip, dan filter `noVoice` hanya untuk klip bernarasi (`c.narration.trim()`).

---

## Fase 5 — Editor, Player, Timeline & Inspector (`EditorStep.tsx` & `pages/project/editor/*`)

**Tujuan:** Memperbaiki scroll Inspector yang mati, seluruh bug kontras dark mode editor, ukuran Player 9:16 di `1180×720`, double-toggle `Space`, dropdown SFX, dan konsistensi istilah.

### File & Perubahan
1. **`src/renderer/src/pages/project/EditorStep.tsx` & `editor/Inspector.tsx`**
   - Perbaiki scroll vertikal Inspector (`h-full` pada `<aside>` + hapus duplikasi `border-l border-line`).
   - Sesuaikan tinggi default & maksimum timeline terhadap viewport agar Player 9:16 selalu punya ruang ≥ `240px` dan bar transport tidak terpotong di `1180×720`.
   - Hapus duplikasi `SmartSfxModal` di `EditorStep` (pakai satu handler bersama yang memanggil `addAsset` tanpa toast ganda), nonaktifkan `Auto-Trim Hening` saat 0 klip, dan tambah `aria-label` pada `role="separator"`.
   - Di `Inspector.tsx`: ganti switch custom dengan `<Switch>`, tambah `aria-label` pada 6 slider Ken Burns, tambah `aria-pressed` pada `30s`/`60s`/`120s`, tambah CTA tambah SFX di empty state `SfxTab`, ganti `border-[#9CC596]` → `border-ok/40` & latar swatch caption ke warna netral gelap, serta tambah `truncate px-0.5` pada 6 tab bar.
2. **`src/renderer/src/pages/project/editor/Player.tsx`**
   - Ganti latar video `bg-ink` → `bg-[#141311]` / `bg-black`, teks kosong `text-white/75`, HUD badge `bg-ink/80 text-paper` → `bg-black/75 text-white`, hover overlay `hover:outline-white/80`.
   - Hentikan double-toggle `Space` (`e.stopPropagation()` atau tangani hanya `Enter` di stage div), sesuaikan lebar/padding bar transport di `9:16` agar tidak meluber, tambah `title` dengan `(Spasi)` pada tombol Putar/Jeda, dan ubah `"Cinema mode"` → `"Mode layar penuh"`.
3. **`src/renderer/src/pages/project/editor/TransitionButton.tsx`, `TransitionPanel.tsx`, `OverlayPanel.tsx`**
   - Ganti teks/ikon di atas `bg-sun` menjadi `text-[var(--color-on-sun)]` (`#1f1d1a`), perbesar `TransitionButton` ke `size-6` (`24×24px`), tambah dukungan keyboard pada reset durasi `TransitionPanel`, dan ganti `text-accent` → `text-accent-ink` di `OverlayPanel`.
   - Perbaiki thumbnail overlay teks di `OverlayPanel.tsx` (`bg-sand text-ink` untuk teks; checkerboard adaptif gelap/terang untuk gambar).
4. **`src/renderer/src/pages/project/editor/Timeline.tsx`, `CustomSfxModal.tsx`, `SmartSfxModal.tsx`, `Waveform.tsx`**
   - `Timeline.tsx`: ganti `bg-sand-2` (atau pakai token baru), pindahkan menu `+` SFX ke `<Popover>`, perbaiki item SFX (hapus nested `<button>` & double `onPick`, tambah keyboard/`aria-pressed`/`aria-label`), buat `Row` subscribe reaktif ke `useTrackControls` + indikator track terkunci + `aria-pressed`, perbaiki kontras HUD badge (`bg-black/75 text-white`), grip trim, hatch, padding label `"Suara TTS"`, dan ringkas hint bawah.
   - `CustomSfxModal.tsx` & `SmartSfxModal.tsx`: hubungkan `<label htmlFor>`, disable commit saat `generating`, ganti `text-accent` → `text-accent-ink`, seragamkan nama modal (`"AI SFX Cerita (ElevenLabs)"`), dan bersihkan istilah Inggris & satuan `dtk`.
   - `Waveform.tsx`: tampilkan garis dasar tipis saat `data.length === 0`.

---

## Fase 6 — Verifikasi Akhir

1. Jalankan `npm run typecheck` (wajib 0 error pada `tsconfig.node.json` & `tsconfig.web.json`).
2. Jalankan `npm run build` (wajib sukses tanpa error).
3. Verifikasi otomatis konvensi: 0 `<select>` bawaan, 0 token CSS tak terdefinisi (`text-good`, `hover:shadow-ink-sm`), 0 `"Anda"`.
4. Uji visual/dev harness di `1180×720` (Light Mode & Dark Mode) untuk memastikan ikon Local LLM, Inspector scroll, Player 9:16, Header Studio, dan modal tampil rapi.
