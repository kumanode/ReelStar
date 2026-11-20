import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { STYLE_CATEGORIES, VISUAL_STYLES, getStyle, type StyleCategory } from '@shared/styles'
import { StyleSwatch } from './StyleArt'
import { Segmented, cx } from './ui'

export function StylePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const current = getStyle(value)
  const [cat, setCat] = useState<StyleCategory | 'all'>(() => {
    return current?.category ?? 'liveaction'
  })

  const list = VISUAL_STYLES.filter((s) => (cat === 'all' ? s.category !== 'custom' : s.category === cat))

  return (
    <div className="flex flex-col gap-3">
      {/* Category Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<StyleCategory | 'all'>
          value={cat}
          onChange={setCat}
          options={STYLE_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
          size="sm"
          className="self-start"
        />
        {current && (
          <span className="text-xs text-muted">
            Terpilih: <strong className="font-semibold text-ink">{current.name}</strong>
          </span>
        )}
      </div>

      {cat === 'custom' ? (
        <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles className="size-5" />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-ink">Gaya Visual Kustom</span>
              <span className="text-xs text-muted">
                Gunakan gaya kustom untuk menuliskan arahan visual bebas sesuai imajinasimu.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange('custom_style')}
            className={cx(
              'mt-1 flex items-center justify-between rounded-xl border-2 px-3.5 py-2.5 text-left text-sm transition-all',
              value === 'custom_style'
                ? 'border-accent bg-accent-soft/30 font-medium text-ink ring-2 ring-accent/20'
                : 'border-line hover:border-line-3 text-ink-2'
            )}
          >
            <span>Pilih Gaya Kustom</span>
            {value === 'custom_style' && (
              <span className="flex size-5 items-center justify-center rounded-full bg-accent text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>
        </div>
      ) : (
        /* Horizontal Cards Grid (Compact & doesn't eat up vertical modal space) */
        <div className="scroll-thin max-h-[340px] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {list.map((s) => {
              const on = s.id === value
              const isDefault = s.id === 'premium_drama'
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(s.id)}
                  title={`${s.name} — ${s.niche}`}
                  className={cx(
                    'group relative flex aspect-[16/10] w-full flex-col overflow-hidden rounded-[14px] text-left transition-all',
                    'border-2',
                    on
                      ? 'border-accent shadow-ink-md ring-2 ring-accent/30'
                      : 'border-line hover:border-line-3 hover:shadow-ink-sm'
                  )}
                >
                  {/* Style Background Artwork */}
                  <StyleSwatch
                    styleId={s.id}
                    className="size-full transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                    iconSize={26}
                  />

                  {/* Dark gradient overlay for text readability */}
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

                  {/* "Default" Badge on top-left */}
                  {isDefault && (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white shadow-xs backdrop-blur-xs">
                      Default
                    </span>
                  )}

                  {/* Selected Checkmark on top-right */}
                  {on && (
                    <span className="pointer-events-none absolute right-2 top-2 flex size-5.5 items-center justify-center rounded-full bg-accent text-white shadow-sm ring-1 ring-white/30">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  )}

                  {/* Text Overlay at bottom */}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2.5">
                    <span className="truncate text-[13px] font-semibold leading-tight text-white drop-shadow-sm">
                      {s.name}
                    </span>
                    <span className="truncate text-[11px] leading-tight text-white/75 drop-shadow-sm">
                      {s.niche}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
