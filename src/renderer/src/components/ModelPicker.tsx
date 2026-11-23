import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDownNarrowWide, ChevronDown, RefreshCw, Search, X } from 'lucide-react'
import type { ModelOption } from '@shared/types'
import { creditLabel, relativeTime, usdLabel } from '../lib/format'
import { Popover } from './Popover'
import { Spinner, cx } from './ui'

function ctxLabel(n?: number | null): string | null {
  if (!n) return null
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
  return `${Math.round(n / 1000)}K`
}

function priceLabel(m: ModelOption): string | null {
  if (m.priceIn == null || m.priceOut == null) return null
  if (m.priceIn === 0 && m.priceOut === 0) return 'Gratis'
  const f = (v: number): string => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3).replace(/0+$/, ''))
  return `$${f(m.priceIn)} / $${f(m.priceOut)}`
}

/** Every search word must appear in the model id, name or description. */
function matches(m: ModelOption, words: string[]): boolean {
  const hay = `${m.id} ${m.name} ${m.description ?? ''}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function ModelPicker({
  value,
  models,
  loading,
  error,
  fetchedAt,
  onChange,
  onRefresh,
  allowCustom,
  placeholder = 'Pilih model',
  defaultOpen,
  disabled,
  detail = 'id',
  tagFilters,
  align = 'left',
  menuClassName,
  footerNote,
  renderIcon,
  ariaLabel
}: {
  value: string
  models: ModelOption[]
  loading?: boolean
  error?: string | null
  fetchedAt?: number | null
  onChange: (id: string) => void
  onRefresh?: () => void
  allowCustom?: boolean
  placeholder?: string
  defaultOpen?: boolean
  disabled?: boolean
  /** Second line under each model name: its id, or its description. */
  detail?: 'id' | 'description'
  /** Filter chips to offer instead of the most common tags. */
  tagFilters?: string[]
  /** Which edge a menu wider than the button lines up with. */
  align?: 'left' | 'right'
  menuClassName?: string
  /** Extra text in the list footer, e.g. what the listed credits pay for. */
  footerNote?: string
  /** A mark shown before each model name, e.g. its brand logo. */
  renderIcon?: (m: ModelOption) => ReactNode
  /** Accessible name for the trigger button. */
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [cheapFirst, setCheapFirst] = useState(false)
  const listId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const popoverWidth = useMemo(() => {
    const match = menuClassName?.match(/(?:min-)?w-\[(\d+)px\]/)
    return match ? Number(match[1]) : undefined
  }, [menuClassName])

  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const allTags = useMemo(() => {
    if (tagFilters) return tagFilters.filter((t) => models.some((m) => m.tags.includes(t)))
    const count = new Map<string, number>()
    for (const m of models) for (const t of m.tags) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()]
      .filter(([, n]) => n < models.length)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t)
  }, [models, tagFilters])

  // Higgsfield lists carry credit estimates (creditUnit marks them); known prices can be sorted cheapest first.
  const priced = models.some((m) => m.credits != null)

  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const list = models.filter((m) => matches(m, words) && tags.every((t) => m.tags.includes(t)))
    if (!cheapFirst) return list
    return [...list].sort((a, b) => (a.credits ?? Infinity) - (b.credits ?? Infinity))
  }, [models, query, tags, cheapFirst])

  const customId = query.trim()
  const showCustom = allowCustom && customId && !models.some((m) => m.id === customId)
  const rows = filtered.length + (showCustom ? 1 : 0)

  useEffect(() => setActive(0), [query, tags, cheapFirst])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (id: string): void => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(rows - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < filtered.length) pick(filtered[active].id)
      else if (showCustom) pick(customId)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
  }

  const current = models.find((m) => m.id === value)

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
        className={cx(
          'flex h-12 w-full items-center gap-3 rounded-xl border px-3.5 text-left transition-colors disabled:opacity-50',
          open || value ? 'bg-surface' : 'bg-accent-soft',
          open ? 'border-ink' : value ? 'border-line-2 hover:border-ink-2' : 'border-[1.5px] border-accent'
        )}
      >
        {renderIcon && current && renderIcon(current)}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          {value ? (
            <>
              <span className="truncate text-[15px] font-semibold" title={current?.name ?? value}>
                {current?.name ?? value}
              </span>
              {detail === 'description'
                ? current?.description && <span className="truncate text-xs text-muted">{current.description}</span>
                : current && current.name !== value && <span className="truncate font-mono text-xs text-muted">{value}</span>}
            </>
          ) : (
            <span className="text-[15px] font-semibold text-accent-dark">{loading ? 'Memuat daftar model…' : placeholder}</span>
          )}
        </span>
        {current && ctxLabel(current.contextLength) && (
          <span className="shrink-0 rounded-md bg-sand px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{ctxLabel(current.contextLength)}</span>
        )}
        {loading ? <Spinner className="size-4 text-muted" /> : <ChevronDown className={cx('size-4 shrink-0 transition-transform', open && 'rotate-180')} />}
      </button>

      <Popover
        anchor={trigger}
        open={open}
        onClose={(why) => {
          setOpen(false)
          if (why === 'escape') trigger.current?.focus()
        }}
        width={popoverWidth}
        align={align}
        maxHeight={440}
        label={ariaLabel ?? placeholder}
        className={menuClassName}
      >
          <div className="flex flex-col gap-2 border-b border-line p-2.5">
            <label className="flex h-10 items-center gap-2 rounded-xl border border-line-2 bg-paper px-3 transition-all focus-within:border-ink focus-within:ring-2 focus-within:ring-accent/35">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder={models.length ? `Cari dari ${models.length.toLocaleString('id-ID')} model…` : allowCustom ? 'Ketik ID model…' : 'Cari model…'}
                aria-label="Cari model"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  title="Hapus pencarian"
                  onClick={() => setQuery('')}
                  className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sand hover:text-ink"
                >
                  <X className="size-4" />
                </button>
              )}
            </label>
            {(allTags.length > 0 || priced) && (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                      className={cx(
                        'h-7 rounded-full border px-2.5 text-xs font-medium',
                        on ? 'border-ink bg-ink text-paper' : 'border-line-2 text-ink-2 hover:border-ink-2'
                      )}
                    >
                      {t}
                    </button>
                  )
                })}
                {priced && (
                  <button
                    type="button"
                    aria-pressed={cheapFirst}
                    onClick={() => setCheapFirst(!cheapFirst)}
                    className={cx(
                      'ml-auto inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
                      cheapFirst ? 'border-ink bg-ink text-paper' : 'border-line-2 text-ink-2 hover:border-ink-2'
                    )}
                  >
                    <ArrowDownNarrowWide className="size-3.5" />
                    Termurah dulu
                  </button>
                )}
              </div>
            )}
          </div>

          <div ref={list} id={listId} role="listbox" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {error && <p className="m-1 rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] text-bad-ink">{error}</p>}
            {!error && loading && !models.length && (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-ink-2">
                <Spinner />
                Mengambil daftar model dari penyedia…
              </p>
            )}
            {filtered.map((m, i) => {
              const selected = m.id === value
              const price = priceLabel(m)
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-row={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m.id)}
                  title={detail === 'description' ? m.id : undefined}
                  // The chosen model is marked by its background, which keeps the list narrow.
                  className={cx(
                    'flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left',
                    selected ? 'bg-sun-soft' : i === active ? 'bg-sand' : 'hover:bg-sand/60'
                  )}
                >
                  {renderIcon?.(m)}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{m.name}</span>
                      {m.tags
                        .filter((t) => !m.name.toLowerCase().includes(t.toLowerCase()))
                        // Description rows already say what the tags say; one keeps names readable.
                        .slice(0, detail === 'description' ? 1 : 3)
                        .map((t) => (
                          <span key={t} className="shrink-0 rounded-full bg-draft px-1.5 py-px text-[10.5px] font-semibold text-ink-2">
                            {t}
                          </span>
                        ))}
                    </span>
                    {detail === 'description'
                      ? m.description && <span className="truncate text-[12px] text-ink-2">{m.description}</span>
                      : m.name !== m.id && <span className="truncate font-mono text-[11.5px] text-muted">{m.id}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11.5px] text-ink-2">
                    {ctxLabel(m.contextLength) && <span className="font-mono">{ctxLabel(m.contextLength)} konteks</span>}
                    {price && <span className={cx('font-mono', price === 'Gratis' && 'font-semibold text-ok-ink')}>{price}</span>}
                    {m.creditUnit !== undefined &&
                      (m.credits === undefined ? (
                        <Spinner className="mt-1 size-3.5 text-muted" />
                      ) : m.credits === null ? (
                        <span className="text-muted" title="Higgsfield tidak memberi perkiraan untuk model ini">
                          —
                        </span>
                      ) : (
                        <>
                          <span className="font-mono text-[12.5px] font-semibold text-ink">{creditLabel(m.credits)} kr</span>
                          <span className="font-mono text-muted">{[m.creditUnit, m.usd != null && usdLabel(m.usd)].filter(Boolean).join(' · ')}</span>
                        </>
                      ))}
                  </span>
                </button>
              )
            })}
            {showCustom && (
              <button
                type="button"
                data-row={filtered.length}
                onMouseEnter={() => setActive(filtered.length)}
                onClick={() => pick(customId)}
                className={cx('flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm', active === filtered.length ? 'bg-sand' : 'hover:bg-sand/60')}
              >
                <span className="size-4" />
                Pakai model <span className="font-mono font-semibold">{customId}</span>
              </button>
            )}
            {!loading && !error && rows === 0 && (
              <p className="px-3 py-4 text-sm text-muted">{models.length ? 'Tidak ada model yang cocok.' : 'Daftar model kosong.'}</p>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-line bg-paper px-3 py-2 text-xs text-muted">
            <span className="flex-1">
              {filtered.length.toLocaleString('id-ID')} dari {models.length.toLocaleString('id-ID')} model
              {models.some((m) => m.priceIn != null) && ' · harga per 1 juta token (masuk / keluar)'}
              {footerNote && ` · ${footerNote}`}
              {fetchedAt ? ` · diperbarui ${relativeTime(fetchedAt)}` : ''}
            </span>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-ink-2 transition-colors hover:bg-sand hover:text-ink disabled:opacity-50"
              >
                <RefreshCw className={cx('size-3.5', loading && 'animate-[spin_0.8s_linear_infinite]')} />
                Muat ulang
              </button>
            )}
          </div>
      </Popover>
    </div>
  )
}
