import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Captions,
  Cpu,
  Info,
  KeyRound,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react'
import type { AppSettings, KeyStatus } from '@shared/types'
import { Logo } from '../components/Logo'
import { ThemeToggle } from '../components/ThemeToggle'
import { Button, Spinner, cx } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'
import { AboutSection } from './AboutSection'
import { WhisperSection } from './WhisperSection'
import { ActiveModelsSection } from './settings/ActiveModelsSection'
import { ProvidersSection } from './settings/ProvidersSection'
import { GeneralSection } from './settings/GeneralSection'

type Tab = 'models' | 'providers' | 'general' | 'whisper' | 'about'

export function Settings() {
  const { go, route, toast } = useApp()
  const back = route.name === 'settings' && route.back ? route.back : ({ name: 'home' } as const)
  const [tab, setTab] = useState<Tab>('models')
  const [keys, setKeys] = useState<KeyStatus[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [folder, setFolder] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = (): void => {
    setLoading(true)
    setLoadError(null)
    void Promise.all([window.api.settings.keys(), window.api.settings.get()])
      .then(([k, s]) => {
        setKeys(k)
        setSettings(s)
      })
      .catch((e) => {
        const msg = errorText(e)
        setLoadError(msg)
        toast('error', `Gagal memuat pengaturan: ${msg}`)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
    void window.api.exporter
      .defaultFolder()
      .then(setFolder)
      .catch((e) => toast('error', errorText(e)))
  }, [])

  const NAV: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'models', label: 'Model Aktif', icon: <Cpu className="size-[18px]" /> },
    { id: 'providers', label: 'Penyedia & Kunci', icon: <KeyRound className="size-[18px]" /> },
    { id: 'general', label: 'Umum & Editor', icon: <SlidersHorizontal className="size-[18px]" /> },
    { id: 'whisper', label: 'Whisper & Subtitle', icon: <Captions className="size-[18px]" /> },
    { id: 'about', label: 'Tentang Aplikasi', icon: <Info className="size-[18px]" /> }
  ]

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[68px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-8">
        <button type="button" aria-label="Kembali ke beranda" onClick={() => go({ name: 'home' })}>
          <Logo />
        </button>
        <span className="text-xl text-line-3">/</span>
        <span className="font-semibold">Pengaturan</span>
        <div className="flex-1" />
        <ThemeToggle />
        <Button icon={<ArrowLeft className="size-[18px]" />} onClick={() => go(back)}>
          {back.name === 'project' ? 'Kembali ke proyek' : 'Kembali ke beranda'}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Bagian pengaturan" className="flex flex-col gap-1 border-r border-line pl-6 pr-4 pt-7">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-current={tab === n.id ? 'page' : undefined}
              onClick={() => setTab(n.id)}
              className={cx(
                'flex h-11 items-center gap-3 rounded-xl px-3.5 text-left text-[14px]',
                tab === n.id ? 'bg-ink font-semibold text-paper' : 'font-medium text-ink hover:bg-sand'
              )}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>

        <main className="scroll-thin overflow-y-auto">
          <div className="flex max-w-[920px] flex-col gap-6 px-12 pb-24 pt-8">
            {tab !== 'about' && !settings && (
              loadError ? (
                <div className="flex flex-col items-start gap-3 rounded-2xl border border-bad/30 bg-bad-soft p-5 text-sm text-bad-ink">
                  <p className="font-semibold">Gagal memuat pengaturan</p>
                  <p className="text-xs opacity-90">{loadError}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RefreshCw className="size-3.5" />}
                    loading={loading}
                    onClick={reload}
                  >
                    Coba lagi
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-12 text-sm text-muted">
                  <Spinner className="size-5 text-accent" />
                  <span>Memuat pengaturan…</span>
                </div>
              )
            )}

            {tab === 'models' && settings && (
              <ActiveModelsSection settings={settings} keys={keys} onSettings={setSettings} />
            )}

            {tab === 'providers' && settings && (
              <ProvidersSection
                settings={settings}
                keys={keys}
                onChanged={reload}
                onSettings={setSettings}
              />
            )}

            {tab === 'general' && settings && (
              <GeneralSection
                settings={settings}
                folder={folder}
                onSettings={setSettings}
                onFolderChange={setFolder}
              />
            )}

            {tab === 'whisper' && settings && (
              <div className="flex flex-col gap-6">
                <div>
                  <h1 className="font-display text-[30px] font-bold tracking-tight">Whisper & Subtitle</h1>
                  <p className="mt-1 max-w-[720px] text-sm text-ink-2">
                    Sinkronisasi waktu kata demi kata caption dengan Whisper lokal tanpa koneksi internet.
                  </p>
                </div>
                <WhisperSection settings={settings} onSettings={setSettings} />
              </div>
            )}

            {tab === 'about' && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  )
}
