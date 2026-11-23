# Daftar Tugas Perbaikan UI/UX, Dark Mode & Layout — ReelStar

Checklist pengerjaan berdasarkan [plan.md](plan.md) dan laporan audit seluruh 55 file `.tsx`.

---

## Fase 1 — Dark Mode, Kontras & Komponen Inti
- [x] `src/renderer/src/styles.css`: tambah token `--color-on-sun` (`#1f1d1a`) dan `--color-sand-2` (terang & gelap).
- [x] `src/renderer/src/components/ProviderLogo.tsx`: ganti `custom.bg` ke `'var(--color-sand)'` agar ikon Local LLM (`<Server />`) terlihat jelas di dark mode.
- [x] `src/renderer/src/components/ModelLogo.tsx`: ganti fallback `'#F3EFE8'` ke `'var(--color-sand)'`.
- [x] `src/renderer/src/components/ui.tsx`: tambah prop `disabled` pada `Switch`.
- [x] `src/renderer/src/components/ui.tsx`: pindahkan footer `ConfirmHost` ke sticky `footer`, gaya merah bahaya untuk `danger`, hapus `autoFocus` destruktif.
- [x] `src/renderer/src/components/ui.tsx`: tambah ARIA (`role="menu"`/`"menuitem"`, `aria-expanded`), `stopPropagation` klik item, navigasi panah, prop `disabled` item, & refocus trigger pada `Menu`.
- [x] `src/renderer/src/components/Toasts.tsx`: perbaiki konflik kelas `bg-surface` vs `bg-bad-soft` & perbesar tombol tutup ke `size-7` + `title`.
- [x] `src/renderer/src/components/ModelPicker.tsx`: perbaiki konflik `bg-surface` vs `bg-accent-soft`, pakai `useId()`, migrasi ke `<Popover>`, `stopPropagation` + refocus pada `Escape`, perbesar tombol clear & `Muat ulang`, tambah `ariaLabel`.
- [x] `src/renderer/src/components/StylePicker.tsx`, `StyleMenu.tsx`, `Select.tsx`: ganti `hover:shadow-ink-sm` → `hover:shadow-ink`, `"Default"` → `"Bawaan"`, tambah `min-w-0` & `title`.

## Fase 2 — Home & Pengaturan
- [x] `src/renderer/src/pages/Home.tsx`: sticky `footer` di `NewSerialModal`, `flex-wrap` baris durasi, ganti toggle `"Setel otomatis"` dari `primary`, tampilkan pemilih Bahasa & TTS di modal, tambah `aria-label` stepper `-`/`+`, reset input file, `try/catch` + toast pada hapus/duplikat, loading skeleton & empty state pencarian/filter, grid `grid-cols-3 xl:grid-cols-4`, format `'id-ID'`, `Auto` → `Otomatis`.
- [x] `src/renderer/src/pages/Settings.tsx`: tampilkan `<Spinner />` saat loading, tangkap error `reload()` dengan toast + coba lagi, tambah `aria-label` tombol logo.
- [x] `src/renderer/src/pages/AboutSection.tsx`: ganti `bg-ink` wrapper YouTube → `bg-black` & beri indikator tautan pada tagline YouTube.
- [x] `src/renderer/src/pages/WhisperSection.tsx`: tambah `try/catch` + toast error dan guard pending/`disabled` pada tombol & `Switch`.
- [x] `src/renderer/src/pages/settings/ActiveModelsSection.tsx`: samakan label & `value` model Gemini TTS, sticky `footer` modal konfirmasi, `disabled={saving}` pada picker, ingat model TTS lama saat ganti penyedia, tambah `gap-2 min-w-0`, rapikan istilah Inggris.
- [x] `src/renderer/src/pages/settings/CustomProviderModal.tsx`: tambah `h-11` pada `<input>`, sticky `footer`, seragamkan istilah `"Kustom"`/`"Ubah"`.
- [x] `src/renderer/src/pages/settings/ProvidersSection.tsx`: tata ulang baris `KeyForm` custom/Flow2API agar tidak terjepit di `1180px`, tambah `catch` + busy disable pada `test()`/`clear()`, `title` pada teks terpotong, hapus spacer `help=""`.
- [x] `src/renderer/src/pages/settings/GeneralSection.tsx`: tambah `h-11` input, ganti `<input type="number">` konkurensi ke `<Segmented>`, tambah `title` path folder, `"default"` → `"bawaan"`.

## Fase 3 — Studio Chrome, Episode Hub, Lorebook & Modal Proyek
- [x] `src/renderer/src/pages/project/StudioHeader.tsx`: perbaiki overflow header di `1180px` (`grid-cols-[minmax(0,1fr)_auto_auto]`, lebar responsif judul/select, `min-w-0`), `whitespace-nowrap` di `SaveStatus`, hapus duplikasi menu Tugas, samakan toast `"Serial"`.
- [x] `src/renderer/src/pages/project/StudioSidebar.tsx`: tambah `aria-label` & `aria-current="page"`, guard `creating` + `try/catch` tambah episode, titik indikator lembar kurang saat ciut, pertahankan tab aktif saat ganti episode, samakan label `'Siap Naskah'`.
- [x] `src/renderer/src/pages/project/EpisodeHub.tsx`: ganti input `defaultValue` kartu episode ke input terkontrol/tersinkron + `aria-label` & `min-w-0`, `aria-label` stepper `-`/`+`, `try/catch` + disable guard aksi episode, reset input file, `Auto` → `Otomatis`, samakan `dtk`.
- [x] `src/renderer/src/pages/project/LorebookPage.tsx`: perbaiki grid sempit saat panel detail terbuka (`min-w-0`, kolom adaptif), ganti `text-good` → `text-ok-ink`, tambah `confirmDialog` + `aria-label` + `try/catch` pada hapus varian kostum, tambah `loading={charRunning}` pada `"Buat lembar AI"` karakter, tambah empty state tab Pemeran, hapus tombol duplikat `"Tambah Benang Cerita"`, lengkapi `aria-label` input/alias, `try/catch` tambah lokasi/prop/varian, await `switchEpisode`, dan terjemahkan enum/istilah Inggris.
- [x] `src/renderer/src/pages/project/CharacterModal.tsx`, `CandidateReviewModal.tsx`, `MergeAssetModal.tsx`, `SeriesGuidelinesModal.tsx`, `ModelSection.tsx`: sticky `footer` pada 4 modal, perbaikan kontras `text-accent-ink` & reset tab di `CandidateReviewModal`, ikon & truncating `MergeAssetModal`, konfirmasi `"Reset Semua ke Bawaan"` + perbaikan `useEffect` di `SeriesGuidelinesModal`, guard `starting` di `CharacterModal`, `try/catch` + `max-w` menu di `ModelSection`.

## Fase 4 — Produksi, ShotCard & Modal Batch/Ekspor
- [x] `src/renderer/src/pages/project/ProductionStep.tsx`: sembunyikan toolbar klip/filter/multi-select saat mode Draf aktif + bersihkan `selectedBatchIds`, hapus duplikasi `"Optimasi Prompt"` di Bar 2, perbaiki kontras badge `Cek Naskah`, empty state filter + tombol reset, guard `busyAi` di menu `...`, `aria-label` input draf, dan rapikan Multi-Select Batch Bar.
- [x] `src/renderer/src/pages/project/ShotCard.tsx`: ganti overlay thumbnail ke `bg-black/75 text-white` / `hover:bg-black/40`, rapikan kepadatan Zone 1 & Zone 3 di `1180px`, tambah scroll `max-h-56` pada popover Lokasi/Prop, disable `Unggah` saat `refCap === 0` & `Buat Video` saat gambar kosong, perbesar titik versi gambar + `aria-label`, lengkapi `aria-label` textarea & copy Indonesia.
- [x] `src/renderer/src/pages/project/ProductionDrawers.tsx` & `NewAssetsBanner.tsx`: scroll `max-h-40` + `break-words` di `LocksDrawer`, `aria-label`/`htmlFor`, `loading` tombol `Pulihkan` snapshot, petunjuk `blockingCount` & empty target pool di `NewAssetsBanner`.
- [x] `src/renderer/src/pages/project/AnimaticPreviewModal.tsx`: hapus hardcoded `muted` pada `<video>` (`muted={muted || Boolean(audio)}`), perbaiki badge suara, `gap-2`/`shrink-0`/`flex-wrap`, shortcut keyboard.
- [x] `src/renderer/src/pages/project/TaskCenterModal.tsx`: tab awal otomatis (`active` → `failed` → `all`), `min-w-0`/`shrink-0`/`break-words`/`scroll-thin`, ikon `export`, `text-accent-ink`, rapikan istilah Indonesia.
- [x] `src/renderer/src/pages/project/BatchEstimateModal.tsx` & `BatchEstimateSheetModal.tsx`: keluarkan footer `BatchEstimateSheetModal` dari `result ?`, tambah `loading`/`disabled`/reset `includeStale`; tambah `<Spinner />`, `scroll-thin`, `truncate`, dan rincian total kredit di `BatchEstimateModal`.
- [x] `src/renderer/src/pages/project/ExportDialog.tsx`: pakai `activeEditor = episode?.editor ?? project.editor`, `disabled` pada `Switch`, overlay `bg-black/75 text-white`, tooltip & peringatan 0 klip, update label `Buka Paket (.zip)` di footer awal, dan filter `noVoice` hanya untuk klip bernarasi.

## Fase 5 — Editor, Player, Timeline & Inspector
- [x] `src/renderer/src/pages/project/EditorStep.tsx` & `editor/Inspector.tsx`: perbaiki scroll vertikal `Inspector` (`h-full` + hapus border ganda), sesuaikan tinggi default & batas timeline untuk `1180×720`, hapus duplikasi `SmartSfxModal` (pastikan `addAsset` dipanggil tanpa toast ganda), disable `Auto-Trim Hening` saat 0 klip, `aria-label` separator, ganti switch custom ke `<Switch>`, `aria-label` 6 slider Ken Burns, `aria-pressed` durasi musik, CTA empty state `SfxTab`, perbaikan warna hardcoded & tab bar.
- [x] `src/renderer/src/pages/project/editor/Player.tsx`: ganti latar `bg-ink` → `bg-[#141311]`/hitam, teks kosong `text-white/75`, HUD `bg-black/75 text-white`, hentikan double-toggle `Space`, perbaiki lebar bar transport 9:16, `title` shortcut Spasi, dan `"Cinema mode"` → `"Mode layar penuh"`.
- [x] `src/renderer/src/pages/project/editor/TransitionButton.tsx`, `TransitionPanel.tsx`, `OverlayPanel.tsx`: kontras teks/ikon di atas `bg-sun` (`text-[var(--color-on-sun)]`), perbesar `TransitionButton` ke `size-6`, dukungan keyboard reset durasi, thumbnail overlay teks `bg-sand text-ink` + checkerboard adaptif, `text-accent-ink`.
- [x] `src/renderer/src/pages/project/editor/Timeline.tsx`, `CustomSfxModal.tsx`, `SmartSfxModal.tsx`, `Waveform.tsx`: migrasi dropdown `+` SFX ke `<Popover>`, rapikan item SFX (tanpa nested `<button>` / double `onPick`), `Row` subscribe reaktif ke `useTrackControls` + indikator track terkunci, kontras HUD/grip/hatch, padding `"Suara TTS"`, hubungkan `<label>` & guard commit di `CustomSfxModal`, seragamkan nama & istilah `"AI SFX Cerita (ElevenLabs)"` serta satuan `dtk`, dan baseline tipis di `Waveform`.

## Fase 6 — Verifikasi Akhir
- [x] Jalankan `npm run typecheck` (0 error).
- [x] Jalankan `npm run build` (0 error).
- [x] Verifikasi otomatis 0 `<select>` bawaan, 0 token CSS mati (`text-good`, `hover:shadow-ink-sm`), 0 `"Anda"`.
- [ ] Verifikasi visual Dark Mode & Light Mode di `1180×720` (ikon Local LLM, scroll Inspector, Player 9:16, Header Studio, dan modal).
