import { useEffect, useState, type ReactNode } from 'react'
import {
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Server,
  TestTube2,
  Trash2
} from 'lucide-react'
import type { ApiProvider, AppSettings, KeyStatus, KeyTestResult, ProviderDef } from '@shared/types'
import { PRESET_PROVIDERS } from '@shared/providers'
import { Button, Field, IconButton, confirmDialog, cx, inputCls } from '../../components/ui'
import { ProviderLogo } from '../../components/ProviderLogo'
import { StatusBadge } from './StatusBadge'
import { CustomProviderModal } from './CustomProviderModal'
import { useApp } from '../../store/app'
import { errorText, relativeTime } from '../../lib/format'

interface Props {
  settings: AppSettings
  keys: KeyStatus[]
  onChanged: () => void
  onSettings: (s: AppSettings) => void
}

function KeyForm({
  provider,
  name,
  status,
  label = 'API key',
  placeholder = 'Tempel API key',
  hint,
  help,
  link,
  linkLabel,
  customUrl,
  onChanged,
  onSaved
}: {
  provider: ApiProvider
  name: string
  status?: KeyStatus
  label?: string
  placeholder?: string
  hint?: ReactNode
  help: string
  link: string | null
  linkLabel: string
  customUrl?: string
  onChanged: () => void
  onSaved?: (r: KeyTestResult) => void
}) {
  const { toast } = useApp()
  const configured = !!status?.configured
  const isCustom = provider === 'custom' || provider === 'flow2api'
  const preview = status?.preview ?? null
  const [editing, setEditing] = useState(!preview)
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(customUrl ?? '')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [showTyped, setShowTyped] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null)

  useEffect(() => {
    // Async key status load transitions preview from null to masked key; exit edit mode unless user already typed.
    if (preview && !key) setEditing(false)
  }, [preview])

  const showStored = !isCustom && !editing && !!preview
  const urlChanged = isCustom && url.trim() !== (customUrl ?? '').trim()
  const canSave = isCustom ? !!url.trim() && (urlChanged || !!key.trim() || !configured) : !showStored && !!key.trim()
  const unsaved = !isCustom && !showStored && !!key.trim() && busy !== 'save'

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || !canSave || busy) return
    e.preventDefault()
    void save()
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    try {
      const r =
        provider === 'custom'
          ? await window.api.settings.setCustom(url, key)
          : provider === 'flow2api'
            ? await window.api.settings.setFlow2Api(url, key)
            : await window.api.settings.setKey(provider, key)
      toast(r.ok ? 'success' : 'error', `${name}: ${r.message}`)
      setKey('')
      setRevealed(null)
      setEditing(false)
      onChanged()
      onSaved?.(r)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const toggleEye = async (): Promise<void> => {
    if (!showStored) {
      setShowTyped(!showTyped)
      return
    }
    setRevealed(revealed ? null : await window.api.settings.revealKey(provider))
  }
  const visible = showStored ? !!revealed : showTyped

  const test = async (): Promise<void> => {
    setBusy('test')
    try {
      const r = await window.api.settings.testKey(provider)
      toast(r.ok ? 'success' : 'error', `${name}: ${r.message}`)
      onChanged()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const clear = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `Hapus ${isCustom ? 'endpoint' : 'kunci'} ${name}?`,
      body: 'Data ini akan dihapus dari komputer ini. Kamu bisa menambahkannya lagi kapan saja.',
      confirm: 'Hapus',
      danger: true
    })
    if (!ok) return
    setBusy('clear')
    try {
      await window.api.settings.clearKey(provider)
      setRevealed(null)
      setUrl(provider === 'flow2api' ? 'http://localhost:8000/v1' : '')
      onChanged()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const keyField = (
    <Field label={isCustom ? 'API key (opsional)' : label} className="min-w-0 flex-1">
      <div className="relative">
        {showStored ? (
          <input
            readOnly
            value={revealed ?? preview ?? ''}
            aria-label={`${label} tersimpan`}
            className={cx(inputCls, 'h-11 cursor-default bg-paper pr-11 font-mono text-sm')}
          />
        ) : (
          <input
            type={showTyped ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={onEnter}
            placeholder={
              isCustom ? (preview ? `Tersimpan (${preview}) · isi untuk mengganti` : 'Kosongkan untuk server lokal') : placeholder
            }
            className={cx(inputCls, 'h-11 pr-11')}
          />
        )}
        {(showStored || key.length > 0) && (
          <button
            type="button"
            aria-label={visible ? 'Sembunyikan kunci' : 'Tampilkan kunci'}
            title={visible ? 'Sembunyikan kunci' : 'Tampilkan kunci'}
            onClick={() => void toggleEye()}
            className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-sand hover:text-ink"
          >
            {visible ? <EyeOff className="size-[17px]" /> : <Eye className="size-[17px]" />}
          </button>
        )}
      </div>
    </Field>
  )

  const actionButtons = (
    <>
      {showStored ? (
        <Button
          className="h-11"
          disabled={busy !== null}
          onClick={() => {
            setEditing(true)
            setRevealed(null)
          }}
        >
          Ganti
        </Button>
      ) : (
        <Button
          variant="accent"
          className="h-11"
          disabled={!canSave || (busy !== null && busy !== 'save')}
          loading={busy === 'save'}
          onClick={() => void save()}
        >
          Simpan dan tes
        </Button>
      )}
      {!isCustom && editing && !!preview && (
        <Button
          variant="ghost"
          className="h-11"
          disabled={busy !== null}
          onClick={() => {
            setEditing(false)
            setKey('')
          }}
        >
          Batal
        </Button>
      )}
      {configured && (
        <>
          <Button
            className="h-11"
            loading={busy === 'test'}
            disabled={busy !== null && busy !== 'test'}
            onClick={() => void test()}
          >
            Tes
          </Button>
          <IconButton
            label={`Hapus ${name}`}
            size={44}
            className="text-bad-ink"
            disabled={busy !== null}
            onClick={() => void clear()}
          >
            <Trash2 className="size-[18px]" />
          </IconButton>
        </>
      )}
    </>
  )

  const statusText =
    configured && status?.lastMessage
      ? `${status.lastMessage}${status.checkedAt && !status.unreadable ? ` · dicek ${relativeTime(status.checkedAt)}` : ''}`
      : help

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {isCustom ? (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Alamat endpoint (base URL)" className="min-w-0">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={onEnter}
                placeholder={provider === 'flow2api' ? 'http://localhost:8000/v1' : 'http://localhost:11434/v1'}
                spellCheck={false}
                className={cx(inputCls, 'h-11 font-mono text-sm')}
              />
            </Field>
            {keyField}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">{actionButtons}</div>
        </div>
      ) : (
        <div className="flex min-w-0 items-end gap-2">
          {keyField}
          {actionButtons}
        </div>
      )}
      {unsaved && <p className="-mt-1 text-[13px] font-semibold text-accent-dark">Kunci belum tersimpan. Tekan Enter atau klik Simpan dan tes.</p>}
      {hint && <p className="-mt-1 text-[13px] text-ink-2">{hint}</p>}
      {(statusText || link) && (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          {statusText && (
            <span className={cx('min-w-0 flex-1', configured && status?.lastOk === false && 'text-bad-ink')}>
              {statusText}
            </span>
          )}
          {!statusText && <div className="flex-1" />}
          {link && (
            <button
              type="button"
              onClick={() => void window.api.app.openExternal(link)}
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent-dark hover:underline"
            >
              <span>{linkLabel}</span>
              <ExternalLink className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProvidersSection({ settings, keys, onChanged, onSettings }: Props) {
  const { toast } = useApp()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderDef | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const statusOf = (p: ApiProvider): KeyStatus | undefined => keys.find((k) => k.provider === p)

  const handleTestCustom = async (provider: ProviderDef): Promise<void> => {
    setTestingId(provider.id)
    try {
      const res = await window.api.settings.testKey(provider.id)
      toast(res.ok ? 'success' : 'error', `${provider.name}: ${res.message}`)
      onChanged()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setTestingId(null)
    }
  }

  const handleDeleteCustom = async (provider: ProviderDef): Promise<void> => {
    const ok = await confirmDialog({
      title: `Hapus penyedia ${provider.name}?`,
      body: 'Endpoint dan kunci API untuk penyedia ini akan dihapus dari komputer ini.',
      confirm: 'Hapus Penyedia',
      danger: true
    })
    if (!ok) return

    try {
      await window.api.settings.clearKey(provider.id)
      const nextCustom = (settings.customProviders || []).filter((p) => p.id !== provider.id)
      const updated = await window.api.settings.set({ customProviders: nextCustom })
      onSettings(updated)
      onChanged()
      toast('info', `Penyedia "${provider.name}" berhasil dihapus.`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-tight">Penyedia & Kunci API</h1>
        <p className="mt-1 max-w-[720px] text-sm text-ink-2">
          Kelola kredensial penyedia model AI. Kunci disimpan terenkripsi di komputer ini dan hanya dikirim langsung ke penyedia terkait.
        </p>
      </div>

      {/* Preset Providers */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Penyedia Bawaan</h2>
        <div className="flex flex-col gap-4">
          {PRESET_PROVIDERS.map((p) => {
            const status = statusOf(p.id)
            return (
              <div key={p.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ProviderLogo id={p.logo ?? 'custom'} size={40} />
                    <div>
                      <h3 className="text-base font-bold text-ink">{p.name}</h3>
                      <p className="text-xs text-muted">{p.note}</p>
                    </div>
                  </div>
                  <StatusBadge status={status} />
                </div>

                <div className="border-t border-line/60 pt-3">
                  <KeyForm
                    provider={p.id}
                    name={p.name}
                    status={status}
                    customUrl={p.id === 'flow2api' ? settings.flow2apiBaseUrl : undefined}
                    help=""
                    link={p.docs?.link ?? null}
                    linkLabel={p.docs?.label ?? 'Dokumentasi'}
                    onChanged={onChanged}
                    onSaved={() => onChanged()}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Custom Providers (Tugas 55) */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Penyedia Kustom (OpenAI / Flow2API)</h2>
            <p className="text-xs text-muted">
              Sambungkan model lokal (Ollama, vLLM, LM Studio) atau API pihak ketiga lainnya.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditingProvider(null)
              setModalOpen(true)
            }}
          >
            Tambah Penyedia Kustom
          </Button>
        </div>

        {(!settings.customProviders || settings.customProviders.length === 0) ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-sand/30 py-8 text-center">
            <Server className="size-8 text-muted" />
            <span className="text-sm font-semibold text-ink">Belum ada penyedia kustom</span>
            <p className="max-w-sm text-xs text-muted">
              Kamu bisa menambahkan server lokal seperti Ollama atau proxy API kustom yang kompatibel dengan protokol OpenAI Chat atau Flow2API.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditingProvider(null)
                setModalOpen(true)
              }}
            >
              Tambah Penyedia Sekarang
            </Button>
          </div>
        ) : (
          <div className="grid gap-3.5 md:grid-cols-2">
            {settings.customProviders.map((cp) => {
              const status = statusOf(cp.id)
              return (
                <div key={cp.id} className="flex min-w-0 flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-sm">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ProviderLogo id={cp.logo ?? 'custom'} size={32} />
                        <div className="min-w-0">
                          <h4 title={cp.name} className="truncate text-sm font-bold text-ink">{cp.name}</h4>
                          <span title={cp.baseUrl} className="block truncate font-mono text-[11px] text-muted">{cp.baseUrl}</span>
                        </div>
                      </div>
                      <StatusBadge status={status} />
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                        {cp.protocol}
                      </span>
                      {cp.keyOptional && (
                        <span className="rounded bg-sand px-1.5 py-0.5 text-[11px] text-ink-2">
                          Tanpa Kunci
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/50 pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<TestTube2 className="size-3.5" />}
                      loading={testingId === cp.id}
                      onClick={() => void handleTestCustom(cp)}
                    >
                      Uji
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingProvider(cp)
                        setModalOpen(true)
                      }}
                    >
                      Ubah
                    </Button>
                    <IconButton
                      label={`Hapus ${cp.name}`}
                      size={32}
                      className="text-bad-ink"
                      onClick={() => void handleDeleteCustom(cp)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CustomProviderModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setEditingProvider(null)
        }}
        settings={settings}
        editingProvider={editingProvider}
        onSaved={(updated) => {
          onSettings(updated)
          onChanged()
        }}
      />
    </div>
  )
}
