import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Copy, FolderOpen, MoreHorizontal, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { DURATIONS, LANGUAGES, clipCountFor, llmName } from '@shared/models'
import { getStyle } from '@shared/styles'
import type { ApiProvider, AppSettings, AspectRatio, DialogAudio, KeyStatus, ProjectStatus, ProjectSummary, TtsProvider } from '@shared/types'
import { Logo } from '../components/Logo'
import { Select, type SelectOption } from '../components/Select'
import { StyleSwatch } from '../components/StyleArt'
import { StyleMenu } from '../components/StyleMenu'
import { StylePicker } from '../components/StylePicker'
import { ThemeToggle } from '../components/ThemeToggle'
import { Badge, Button, Chip, Field, IconButton, Menu, Modal, Progress, Segmented, confirmDialog, cx, inputCls } from '../components/ui'
import { errorText, relativeTime } from '../lib/format'
import { TTS_NAMES, ttsReadiness, usableTts } from '../lib/keys'
import { useApp } from '../store/app'

const STATUS: Record<ProjectStatus, { label: string; tone: 'draft' | 'info' | 'warn' | 'ok' }> = {
  draft: { label: 'Draf', tone: 'draft' },
  script: { label: 'Naskah', tone: 'info' },
  storyboard: { label: 'Storyboard', tone: 'info' },
  editing: { label: 'Editing', tone: 'warn' },
  exported: { label: 'Diekspor', tone: 'ok' }
}

const FILTERS: { id: 'all' | 'draft' | 'progress' | 'exported'; label: string; match: (s: ProjectStatus) => boolean }[] = [
  { id: 'all', label: 'Semua', match: () => true },
  { id: 'draft', label: 'Draf', match: (s) => s === 'draft' },
  { id: 'progress', label: 'Dalam proses', match: (s) => s === 'script' || s === 'storyboard' || s === 'editing' },
  { id: 'exported', label: 'Diekspor', match: (s) => s === 'exported' }
]

const SUGGESTIONS = [
  'Asal-usul Sumpah Palapa dan bagaimana Gajah Mada menepatinya',
  'Misteri Segitiga Bermuda: fakta dan mitosnya',
  'Kenapa kucing suka masuk ke dalam kotak?'
]

/** "a, b dan c" */
function joinList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} dan ${items[items.length - 1]}`
}

const ASPECTS: SelectOption<AspectRatio>[] = [
  { value: '16:9', label: '16:9 · YouTube', icon: <span className="block h-[10px] w-[17px] rounded-[2px] border-[1.5px] border-ink" /> },
  { value: '9:16', label: '9:16 · Shorts', icon: <span className="mx-[3px] block h-[16px] w-[10px] rounded-[2px] border-[1.5px] border-ink" /> }
]

export function Home() {
  const { go, toast } = useApp()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [query, setQuery] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [durationSec, setDurationSec] = useState(60)
  const [longImageCredit, setLongImageCredit] = useState<number | null>(null)
  const [language, setLanguage] = useState('id')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16')
  const [styleId, setStyleId] = useState('premium_drama')
  const [tts, setTts] = useState<TtsProvider>('gemini')
  const [newModalOpen, setNewModalOpen] = useState(false)

  const refresh = (): void => {
    window.api.projects
      .list()
      .then(setProjects)
      .catch((e) => toast('error', errorText(e)))
  }

  useEffect(() => {
    refresh()
    void window.api.settings.keys().then(setKeys)
    void window.api.settings.get().then((s) => {
      setAppSettings(s)
      setTts(s.defaultTtsProvider)
      setLanguage(s.defaultLanguage)
    })
  }, [])

  useEffect(() => {
    if (durationSec < 900 || !appSettings || appSettings.defaultVisualProvider === 'flow2api') {
      setLongImageCredit(null)
      return
    }
    let live = true
    void window.api.generate.estimate('image', appSettings.imageModel, aspectRatio).then((estimate) => {
      if (live) setLongImageCredit(estimate?.credits ?? null)
    })
    return () => { live = false }
  }, [durationSec, aspectRatio, appSettings])

  // Start on a narrator service that has a working key.
  useEffect(() => {
    if (appSettings && keys.length) setTts(usableTts(appSettings.defaultTtsProvider, keys))
  }, [appSettings, keys])

  const ttsOptions = useMemo((): SelectOption<TtsProvider>[] => {
    const ready = ttsReadiness(keys)
    return (['gemini', 'elevenlabs'] as const).map((p) => {
      const blocked = keys.length > 0 && !ready[p].ok
      return { value: p, label: TTS_NAMES[p], disabled: blocked, note: blocked ? `${ready[p].reason}. Atur di Pengaturan.` : undefined }
    })
  }, [keys])

    const [testingFlow2Api, setTestingFlow2Api] = useState(false)
  const flow2Status = keys.find((k) => k.provider === 'flow2api')
  const flow2apiIssue = (appSettings?.defaultVisualProvider ?? 'higgsfield') === 'flow2api' && (!flow2Status?.configured || flow2Status?.lastOk === false)

  const recheckFlow2Api = async (): Promise<void> => {
    setTestingFlow2Api(true)
    try {
      const res = await window.api.settings.testKey('flow2api')
      const updatedKeys = await window.api.settings.keys()
      setKeys(updatedKeys)
      toast(res.ok ? 'success' : 'error', `Flow2API: ${res.message}`)
    } catch (e) {
      toast('error', `Gagal cek Flow2API: ${errorText(e)}`)
    } finally {
      setTestingFlow2Api(false)
    }
  }

  const setupIssues = useMemo(() => {
    if (!appSettings || !keys.length) return []
    // A key counts once it is saved and did not fail its last check.
    const ok = (p: ApiProvider): boolean => {
      const k = keys.find((x) => x.provider === p)
      return !!k?.configured && k.lastOk !== false
    }
    const issues: { what: string; blocks: string }[] = []
    const vp = appSettings.defaultVisualProvider ?? 'higgsfield'
    if (vp === 'higgsfield' && !ok('higgsfield')) issues.push({ what: 'kunci Higgsfield', blocks: 'gambar' })
    if (vp === 'flow2api' && !ok('flow2api')) issues.push({ what: 'koneksi Flow2API', blocks: 'gambar' })
    const llm = appSettings.llmProvider
    if (!ok(llm)) issues.push({ what: `kunci ${llmName(llm)}`, blocks: 'cerita' })
    else if (!appSettings.llmModels[llm]) issues.push({ what: `model ${llmName(llm)}`, blocks: 'cerita' })
    // Narration needs just one working voice service; every project can pick either one.
    const tts = ttsReadiness(keys)
    if (!tts.gemini.ok && !tts.elevenlabs.ok) issues.push({ what: 'kunci Gemini atau ElevenLabs', blocks: 'suara narator' })
    return issues
  }, [keys, appSettings])

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!
    const q = query.trim().toLowerCase()
    return (projects ?? []).filter((p) => f.match(p.status) && (!q || p.title.toLowerCase().includes(q)))
  }, [projects, filter, query])

  const start = (): void => {
    setNewModalOpen(true)
  }

  const remove = async (p: ProjectSummary): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Hapus proyek?',
      body: `“${p.title}” beserta semua gambar, video, dan suaranya akan dihapus dari komputer ini. Tindakan ini tidak bisa dibatalkan.`,
      confirm: 'Hapus proyek',
      danger: true
    })
    if (!ok) return
    await window.api.projects.remove(p.id)
    refresh()
  }

  const duplicate = async (p: ProjectSummary): Promise<void> => {
    try {
      await window.api.projects.duplicate(p.id)
      refresh()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[68px] shrink-0 items-center gap-6 border-b border-line bg-surface px-8">
        <Logo />
        <label className="flex h-10 w-[360px] items-center gap-2 rounded-full border border-line bg-sand px-3.5 text-muted">
          <Search className="size-[18px]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari proyek"
            aria-label="Cari proyek"
            className="flex-1 bg-transparent text-sm text-ink outline-none"
          />
        </label>
        <div className="flex-1" />
        <ThemeToggle />
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewModalOpen(true)}>
          Serial baru
        </Button>
        <Button icon={<SlidersHorizontal className="size-[18px]" />} onClick={() => go({ name: 'settings', back: { name: 'home' } })}>
          Pengaturan
          {setupIssues.length > 0 && <span className="size-2 rounded-full bg-accent" />}
        </Button>
      </header>

      <main className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-12 pt-11">
          {setupIssues.length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-sun bg-sun-soft px-4 py-3 text-sm text-sun-ink">
              <AlertTriangle className="size-[18px] shrink-0" />
              <span className="flex-1">
                Sebelum mulai, atur dulu {joinList(setupIssues.map((i) => i.what))} di Pengaturan. Tanpa itu,{' '}
                {joinList([...new Set(setupIssues.map((i) => i.blocks))])} belum bisa dibuat.
                {flow2apiIssue && flow2Status?.lastMessage && (
                  <span className="mt-0.5 block font-mono text-xs opacity-90">
                    Status Flow2API: {flow2Status.lastMessage}
                  </span>
                )}
              </span>
              {flow2apiIssue && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw className={cx('size-3.5', testingFlow2Api && 'animate-spin')} />}
                  loading={testingFlow2Api}
                  onClick={() => void recheckFlow2Api()}
                  title="Cek ulang koneksi server Flow2API"
                >
                  Cek Flow2API
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => go({ name: 'settings', back: { name: 'home' } })}>
                Atur sekarang
              </Button>
            </div>
          )}
          <div>
            <h1 className="font-display text-[46px] font-bold leading-[1.08] tracking-[-0.025em]">Mau bikin video apa hari ini?</h1>
            <p className="mt-3 text-[17px] text-ink-2">
              Tulis idenya. AI menyusun klip, naskah, dan suaranya, lalu kamu tinggal merapikan di editor.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-[18px] border-[1.5px] border-ink bg-surface py-5 pl-6 pr-5 shadow-ink-lg">
            <label htmlFor="ide" className="text-[13px] font-semibold text-ink-2">
              Ide cerita atau sinopsis
            </label>
            <textarea
              id="ide"
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Contoh: Gajah Mada bersumpah tidak akan menikmati palapa sebelum Nusantara bersatu. Para menteri menertawakannya, tapi dia membuktikannya…"
              className="resize-none bg-transparent text-lg leading-relaxed outline-none placeholder:text-muted/70"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-3.5">
              <Select
                variant="pill"
                label="Durasi"
                value={durationSec}
                onChange={setDurationSec}
                options={DURATIONS.map((d) => ({ value: d.sec, label: d.label }))}
              />
              {durationSec >= 900 && (
                <span className="text-xs text-muted">
                  ±{clipCountFor(durationSec)} adegan{longImageCredit != null ? ` · ≈${Math.round(longImageCredit * clipCountFor(durationSec))} kredit gambar` : ''}
                </span>
              )}
              <Select
                variant="pill"
                label="Bahasa"
                value={language}
                onChange={setLanguage}
                options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                menuWidth={200}
              />
              <Select variant="pill" label="Format" value={aspectRatio} onChange={setAspectRatio} options={ASPECTS} menuWidth={200} />
              <StyleMenu value={styleId} onChange={setStyleId} />
              <Select variant="pill" label="Suara narator" value={tts} onChange={setTts} options={ttsOptions} menuWidth={280} />
              <div className="flex-1" />
              <Button variant="primary" size="lg" onClick={start}>
                Mulai
                <ArrowRight className="size-[18px]" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <span>Coba ide ini:</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSynopsis(s)}
                className="h-9 rounded-full border border-dashed border-line-3 px-3.5 text-[13px] text-ink-2 hover:border-ink-2 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <section className="mx-auto flex max-w-[1280px] flex-col gap-[18px] px-12 pb-12 pt-11">
          <div className="flex items-center gap-4">
            <h2 className="font-display text-[27px] font-bold tracking-[-0.015em]">Proyek kamu</h2>
            <div className="ml-2 flex gap-1.5">
              {FILTERS.map((f) => {
                const count = (projects ?? []).filter((p) => f.match(p.status)).length
                return (
                  <Chip key={f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label}
                    <span className={cx('text-xs', filter === f.id ? 'text-line-2' : 'text-muted')}>{count}</span>
                  </Chip>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-5">
            <button
              type="button"
              onClick={() => setNewModalOpen(true)}
              className="flex min-h-[262px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line-3 text-ink-2 transition-all hover:border-ink-2 hover:bg-surface"
            >
              <span className="flex size-[54px] items-center justify-center rounded-full border-[1.5px] border-ink bg-accent text-white shadow-ink">
                <Plus className="size-6" strokeWidth={2.2} />
              </span>
              <span className="font-display text-base font-bold text-ink">Serial baru</span>
              <span className="text-[13px] text-muted">Mulai dari serial drama baru</span>
            </button>

            {visible.map((p) => {
              const st = STATUS[p.status]
              const epCount = p.episodeCount || 1
              const expCount = p.exportedCount || 0
              const progressVal = epCount > 0 ? expCount / epCount : 0

              return (
                <article
                  key={p.id}
                  className="flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface transition-all hover:border-ink-2 hover:shadow-ink"
                >
                  <button type="button" onClick={() => go({ name: 'project', id: p.id })} className="text-left">
                    <div className="relative aspect-video w-full overflow-hidden border-b border-line bg-sand/30">
                      {p.coverUrl ? (
                        <img src={p.coverUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <StyleSwatch styleId={p.styleId} className="size-full" iconSize={40} />
                      )}
                      <span className="absolute left-2.5 top-2.5 rounded-full border border-ink bg-surface px-2.5 py-[3px] text-xs font-semibold">
                        {getStyle(p.styleId).name}
                      </span>
                      <span className="absolute right-2.5 top-2.5 rounded-md bg-ink px-2 py-[2px] font-mono text-[11px] font-bold text-paper">
                        {p.aspectRatio || '9:16'}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5 p-4">
                      <div className="line-clamp-2 min-h-[44px] font-display text-base font-bold leading-snug text-ink">
                        {p.title}
                      </div>

                      {/* Episode count & Export progress bar */}
                      <div className="flex flex-col gap-1 pt-1">
                        <div className="flex items-center justify-between text-xs text-muted">
                          <span>{epCount} episode</span>
                          <span>
                            {expCount}/{epCount} terekspor
                          </span>
                        </div>
                        <Progress value={progressVal} className="h-1.5" />
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 border-t border-line/70 py-2.5 pl-4 pr-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="truncate text-xs text-muted">{relativeTime(p.updatedAt)}</span>
                    <div className="flex-1" />
                    <Menu
                      trigger={(open) => (
                        <IconButton label="Opsi serial" onClick={open} className="border-transparent" size={32}>
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      )}
                      items={[
                        { label: 'Buka serial', icon: <FolderOpen className="size-4" />, run: () => go({ name: 'project', id: p.id }) },
                        { label: 'Duplikat serial', icon: <Copy className="size-4" />, run: () => void duplicate(p) },
                        { label: 'Hapus serial', icon: <Trash2 className="size-4" />, danger: true, run: () => void remove(p) }
                      ]}
                    />
                  </div>
                </article>
              )
            })}
          </div>
          {projects && projects.length === 0 && (
            <p className="text-sm text-muted">Belum ada serial drama. Buat serial baru untuk memulai.</p>
          )}
        </section>
      </main>

      <NewSerialModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={(id) => go({ name: 'project', id })}
        initialSynopsis={synopsis}
        initialDurationSec={durationSec}
        initialAspectRatio={aspectRatio}
        initialStyleId={styleId}
      />
    </div>
  )
}

function NewSerialModal({
  open,
  onClose,
  onCreated,
  initialSynopsis = '',
  initialDurationSec = 60,
  initialAspectRatio = '9:16',
  initialStyleId = 'premium_drama'
}: {
  open: boolean
  onClose: () => void
  onCreated: (projectId: string) => void
  initialSynopsis?: string
  initialDurationSec?: number
  initialAspectRatio?: AspectRatio
  initialStyleId?: string
}) {
  const [title, setTitle] = useState('')
  const [synopsis, setSynopsis] = useState(initialSynopsis)
  const [durationSec, setDurationSec] = useState(initialDurationSec)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(initialAspectRatio)
  const [styleId, setStyleId] = useState(initialStyleId)
  const [dialogAudio, setDialogAudio] = useState<DialogAudio>('video')
  const [creating, setCreating] = useState(false)
  const { toast } = useApp()

  useEffect(() => {
    if (open) {
      setSynopsis(initialSynopsis)
      setDurationSec(initialDurationSec)
      setAspectRatio(initialAspectRatio)
      setStyleId(initialStyleId)
      setTitle('')
    }
  }, [open, initialSynopsis, initialDurationSec, initialAspectRatio, initialStyleId])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const bundle = await window.api.projects.create({
        title: title.trim() || synopsis.slice(0, 30).trim() || 'Serial Baru',
        synopsis: synopsis.trim(),
        durationSec,
        aspectRatio,
        styleId,
        dialogAudio
      })
      toast('success', `Serial "${bundle.project.title}" berhasil dibuat`)
      onCreated(bundle.project.id)
    } catch (err) {
      toast('error', `Gagal membuat serial: ${errorText(err)}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat Serial Baru"
      subtitle="Atur judul, naskah sumber, rasio aspek, gaya visual, dan sumber dialog untuk serial drama kamu."
      width={680}
    >
      <div className="flex flex-col gap-4 text-sm text-ink">
        <Field label="Judul Serial" hint="Opsional, akan otomatis dinamai dari sinopsis jika dikosongkan.">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Misal: Pembalasan Sang Pewaris, Misteri Ruang Rapat..."
            className={cx(inputCls, 'h-11')}
          />
        </Field>

        <Field label="Ide Cerita atau Sinopsis" hint="AI akan menggunakan ide ini untuk merencanakan alur dan adegan serial kamu.">
          <textarea
            rows={3}
            value={synopsis}
            onChange={(e) => setSynopsis(e.target.value)}
            placeholder="Contoh: Gajah Mada bersumpah tidak akan menikmati palapa sebelum Nusantara bersatu..."
            className={cx(inputCls, 'resize-none py-2.5 leading-relaxed')}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Rasio Aspek">
            <Segmented<AspectRatio>
              value={aspectRatio}
              onChange={setAspectRatio}
              options={[
                { id: '9:16', label: '9:16 (Shorts)' },
                { id: '16:9', label: '16:9' }
              ]}
              size="md"
            />
          </Field>

          <Field label="Target Durasi">
            <Select
              label="Target durasi"
              value={durationSec}
              onChange={(v) => setDurationSec(Number(v))}
              options={[
                { value: 45, label: '45 detik' },
                { value: 60, label: '60 detik' },
                { value: 75, label: '75 detik' },
                { value: 90, label: '90 detik' },
                { value: 120, label: '120 detik' }
              ]}
              size="md"
            />
          </Field>

          <Field
            label="Suara Dialog"
            hint={
              dialogAudio === 'video'
                ? 'Veo AI video'
                : 'TTS narator'
            }
          >
            <Segmented<DialogAudio>
              value={dialogAudio}
              onChange={setDialogAudio}
              options={[
                { id: 'video', label: 'Dari video' },
                { id: 'tts', label: 'TTS' }
              ]}
              size="md"
            />
          </Field>
        </div>

        <Field label="Gaya Visual Serial" hint="Gaya seni ilustrasi yang akan digunakan pada semua lembar karakter dan adegan.">
          <StylePicker value={styleId} onChange={setStyleId} />
        </Field>

        <div className="flex items-center justify-end gap-2.5 border-t border-line pt-4">
          <Button onClick={onClose} disabled={creating}>
            Batal
          </Button>
          <Button variant="primary" loading={creating} onClick={() => void handleCreate()}>
            Buat serial
          </Button>
        </div>
      </div>
    </Modal>
  )
}
