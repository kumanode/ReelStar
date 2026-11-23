import { useState, useEffect } from 'react'
import { Server, Sparkles, TestTube2 } from 'lucide-react'
import type { AppSettings, ProviderDef } from '@shared/types'
import { RESERVED_PROVIDER_IDS } from '@shared/providers'
import { Button, Field, Modal, cx, inputCls } from '../../components/ui'
import { Select } from '../../components/Select'
import { useApp } from '../../store/app'
import { errorText } from '../../lib/format'

interface Props {
  open: boolean
  onClose: () => void
  settings: AppSettings
  editingProvider?: ProviderDef | null
  onSaved: (updatedSettings: AppSettings) => void
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'custom'
  )
}

export function CustomProviderModal({ open, onClose, settings, editingProvider, onSaved }: Props) {
  const { toast } = useApp()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [protocol, setProtocol] = useState<'openai-chat' | 'flow2api'>('openai-chat')
  const [keyOptional, setKeyOptional] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editingProvider) {
      setName(editingProvider.name)
      setBaseUrl(editingProvider.baseUrl ?? '')
      setProtocol(editingProvider.protocol === 'flow2api' ? 'flow2api' : 'openai-chat')
      setKeyOptional(Boolean(editingProvider.keyOptional))
      setApiKey('')
    } else {
      setName('')
      setBaseUrl('')
      setProtocol('openai-chat')
      setKeyOptional(false)
      setApiKey('')
    }
  }, [editingProvider, open])

  const handleSave = async (testFirst = false): Promise<void> => {
    const trimmedName = name.trim()
    const trimmedUrl = baseUrl.trim().replace(/\/+$/, '')

    if (!trimmedName) {
      toast('error', 'Nama penyedia tidak boleh kosong.')
      return
    }
    if (!trimmedUrl) {
      toast('error', 'Alamat URL endpoint tidak boleh kosong.')
      return
    }

    let id = editingProvider ? editingProvider.id : slugify(trimmedName)
    if (!editingProvider) {
      if (RESERVED_PROVIDER_IDS.has(id)) {
        id = `${id}-${Math.random().toString(36).slice(2, 6)}`
      }
      // Check collision with existing custom providers
      if (settings.customProviders?.some((p) => p.id === id)) {
        id = `${id}-${Math.random().toString(36).slice(2, 6)}`
      }
    }

    const newDef: ProviderDef = {
      id,
      name: trimmedName,
      roles: protocol === 'flow2api' ? ['visual'] : ['llm'],
      kind: 'custom',
      protocol,
      logo: protocol === 'flow2api' ? 'flow2api' : 'custom',
      baseUrl: trimmedUrl,
      keyOptional: keyOptional || trimmedUrl.includes('localhost') || trimmedUrl.includes('127.0.0.1'),
      note: protocol === 'flow2api' ? 'Server Flow2API kustom.' : 'Endpoint kompatibel OpenAI kustom.'
    }

    setSaving(true)
    try {
      const trimmedKey = apiKey.trim()
      if (testFirst) {
        setTesting(true)
        const testRes = await window.api.settings.testKey(id, {
          key: trimmedKey || undefined,
          baseUrl: trimmedUrl,
          protocol
        })
        if (!testRes.ok) {
          toast('error', `Gagal terhubung: ${testRes.message}`)
          return
        }
        toast('success', `Koneksi berhasil: ${testRes.message}`)
      }

      const existing = settings.customProviders || []
      const nextCustom = editingProvider
        ? existing.map((p) => (p.id === editingProvider.id ? newDef : p))
        : [...existing, newDef]

      // Persist provider definition first so setKey's internal connection test sees the new URL and protocol.
      const updated = await window.api.settings.set({ customProviders: nextCustom })

      if (trimmedKey) {
        await window.api.settings.setKey(id, trimmedKey)
      }

      toast('success', `Penyedia "${trimmedName}" berhasil disimpan.`)
      onSaved(updated)
      onClose()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setSaving(false)
      setTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingProvider ? 'Ubah Penyedia Kustom' : 'Tambah Penyedia Kustom'}
      subtitle="Sambungkan server lokal atau penyedia pihak ketiga yang kompatibel dengan OpenAI atau Flow2API."
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2.5">
          <Button onClick={onClose} disabled={saving || testing}>
            Batal
          </Button>
          <Button
            variant="secondary"
            icon={<TestTube2 className="size-4" />}
            loading={testing}
            disabled={saving || !name.trim() || !baseUrl.trim()}
            onClick={() => void handleSave(true)}
          >
            Uji & Simpan
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles className="size-4" />}
            loading={saving && !testing}
            disabled={testing || !name.trim() || !baseUrl.trim()}
            onClick={() => void handleSave(false)}
          >
            Simpan
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        <Field label="Nama Penyedia" hint="Nama yang akan ditampilkan di daftar penyedia.">
          <input
            className={cx(inputCls, 'h-11')}
            placeholder="Contoh: Ollama Lokal, DeepSeek, Local AI"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label="Protokol Layanan" hint="Pilih standar antarmuka API yang digunakan endpoint ini.">
          <Select
            label="Protokol Layanan"
            value={protocol}
            onChange={(v) => setProtocol(v as 'openai-chat' | 'flow2api')}
            options={[
              { value: 'openai-chat', label: 'OpenAI Chat Compatible (/v1/chat/completions) - untuk Naskah & Cerita' },
              { value: 'flow2api', label: 'Flow2API Compatible - untuk Gambar & Video AI' }
            ]}
          />
        </Field>

        <Field
          label="URL Endpoint Basis"
          hint={
            protocol === 'openai-chat'
              ? 'Alamat dasar API termasuk /v1 (contoh: http://localhost:11434/v1 atau https://api.deepseek.com/v1)'
              : 'Alamat server Flow2API (contoh: http://localhost:8000/v1)'
          }
        >
          <div className="flex items-center gap-2">
            <Server className="size-4 shrink-0 text-muted" />
            <input
              className={cx(inputCls, 'h-11 font-mono text-xs')}
              placeholder={protocol === 'openai-chat' ? 'http://localhost:11434/v1' : 'http://localhost:8000/v1'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        </Field>

        <Field
          label="Kunci API"
          hint={editingProvider ? 'Biarkan kosong jika tidak ingin mengubah kunci tersimpan.' : 'Dibutuhkan untuk cloud API; opsional untuk Ollama/vLLM lokal.'}
        >
          <input
            type="password"
            className={cx(inputCls, 'h-11 font-mono text-xs')}
            placeholder={keyOptional ? 'Opsional untuk server lokal' : 'sk-...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={keyOptional}
            onChange={(e) => setKeyOptional(e.target.checked)}
            className="size-4 rounded border-line"
          />
          <span>Server lokal tanpa autentikasi (kunci API tidak diwajibkan)</span>
        </label>
      </div>
    </Modal>
  )
}
