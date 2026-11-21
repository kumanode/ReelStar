import { FolderOpen, Laptop, Moon, Sun } from 'lucide-react'
import type { AppSettings, ThemePreference } from '@shared/types'
import { LANGUAGES } from '@shared/models'
import { Button, Field, Segmented, inputCls } from '../../components/ui'
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

        <Field label="Bahasa default naskah dan suara">
          <Select
            label="Bahasa default naskah dan suara"
            value={settings.defaultLanguage}
            onChange={async (v) => onSettings(await window.api.settings.set({ defaultLanguage: v }))}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
            className="max-w-[320px]"
          />
        </Field>

        <Field label="Folder ekspor video default">
          <div className="flex gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-sand px-3.5 font-mono text-[13px]">
              <FolderOpen className="size-[17px] shrink-0 text-ink-2" />
              <span className="truncate">{folder}</span>
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
          <h2 className="text-base font-bold text-ink">Batas Pekerjaan Bersamaan (Concurrency)</h2>
          <p className="text-xs text-muted">
            Atur berapa banyak pembuatan gambar atau video yang dapat berjalan paralel.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Pekerjaan Higgsfield bersamaan (1–4)
            <input
              className={inputCls}
              type="number"
              min={1}
              max={4}
              step={1}
              value={settings.higgsfieldConcurrency}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value >= 1 && value <= 4) {
                  void window.api.settings.set({ higgsfieldConcurrency: value }).then(onSettings)
                }
              }}
            />
            <span className="font-normal text-muted text-xs">
              Jumlah gambar/video Higgsfield aktif sekaligus.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Pekerjaan Flow2API bersamaan (1–3)
            <input
              className={inputCls}
              type="number"
              min={1}
              max={3}
              step={1}
              value={settings.flow2apiConcurrency}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value >= 1 && value <= 3) {
                  void window.api.settings.set({ flow2apiConcurrency: value }).then(onSettings)
                }
              }}
            />
            <span className="font-normal text-muted text-xs">
              Jumlah gambar/video Flow2API aktif sekaligus. Server lokal biasanya lebih stabil di angka 1–2.
            </span>
          </label>
        </div>
      </section>
    </div>
  )
}
