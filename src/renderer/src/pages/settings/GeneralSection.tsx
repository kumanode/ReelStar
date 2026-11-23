import { FolderOpen, Laptop, Moon, Sun } from 'lucide-react'
import type { AppSettings, ThemePreference } from '@shared/types'
import { LANGUAGES } from '@shared/models'
import { Button, Field, Segmented } from '../../components/ui'
import { Select } from '../../components/Select'
import { useTheme } from '../../lib/theme'

interface Props {
  settings: AppSettings
  folder: string
  onSettings: (s: AppSettings) => void
  onFolderChange: (f: string) => void
}

export function GeneralSection({ settings, folder, onSettings, onFolderChange }: Props) {
  const { theme, setTheme } = useTheme()
  const hfValue = String(Math.min(4, Math.max(1, Math.round(settings.higgsfieldConcurrency || 1)))) as '1' | '2' | '3' | '4'
  const flowValue = String(Math.min(3, Math.max(1, Math.round(settings.flow2apiConcurrency || 1)))) as '1' | '2' | '3'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-tight">Umum & Editor</h1>
        <p className="mt-1 max-w-[720px] text-sm text-ink-2">
          Preferensi tampilan aplikasi, bahasa bawaan untuk proyek baru, dan folder hasil ekspor.
        </p>
      </div>

      <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <Field label="Tema tampilan" hint="Pilih nuansa warna terang, gelap, atau ikuti pengaturan tema sistem operasi kamu.">
          <Segmented<ThemePreference>
            value={theme}
            onChange={(v) => {
              setTheme(v)
              void window.api.settings.set({ theme: v }).then(onSettings)
            }}
            options={[
              { id: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-4" />Terang</span> },
              { id: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-4" />Gelap</span> },
              { id: 'system', label: <span className="flex items-center gap-1.5"><Laptop className="size-4" />Ikuti sistem</span> }
            ]}
            className="max-w-[360px]"
          />
        </Field>

        <Field label="Bahasa bawaan naskah dan suara">
          <Select
            label="Bahasa bawaan naskah dan suara"
            value={settings.defaultLanguage}
            onChange={async (v) => onSettings(await window.api.settings.set({ defaultLanguage: v }))}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            className="max-w-[320px]"
          />
        </Field>

        <Field label="Folder ekspor video bawaan">
          <div className="flex gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-sand px-3.5 font-mono text-[13px]">
              <FolderOpen className="size-[17px] shrink-0 text-ink-2" />
              <span title={folder} className="truncate">{folder}</span>
            </div>
            <Button
              className="h-11"
              onClick={async () => {
                const f = await window.api.exporter.pickFolder()
                if (f) onFolderChange(f)
              }}
            >
              Ganti folder
            </Button>
          </div>
        </Field>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-ink">Batas Pekerjaan Bersamaan</h2>
          <p className="text-xs text-muted">
            Atur berapa banyak pembuatan gambar atau video yang dapat berjalan paralel.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Pekerjaan Higgsfield bersamaan (1–4)"
            hint="Jumlah gambar/video Higgsfield aktif sekaligus."
          >
            <Segmented<'1' | '2' | '3' | '4'>
              value={hfValue}
              onChange={(v) => {
                void window.api.settings.set({ higgsfieldConcurrency: Number(v) }).then(onSettings)
              }}
              options={[
                { id: '1', label: '1' },
                { id: '2', label: '2' },
                { id: '3', label: '3' },
                { id: '4', label: '4' }
              ]}
              className="w-full max-w-[240px]"
            />
          </Field>

          <Field
            label="Pekerjaan Flow2API bersamaan (1–3)"
            hint="Jumlah gambar/video Flow2API aktif sekaligus. Server lokal biasanya lebih stabil di angka 1–2."
          >
            <Segmented<'1' | '2' | '3'>
              value={flowValue}
              onChange={(v) => {
                void window.api.settings.set({ flow2apiConcurrency: Number(v) }).then(onSettings)
              }}
              options={[
                { id: '1', label: '1' },
                { id: '2', label: '2' },
                { id: '3', label: '3' }
              ]}
              className="w-full max-w-[200px]"
            />
          </Field>
        </div>
      </section>
    </div>
  )
}
