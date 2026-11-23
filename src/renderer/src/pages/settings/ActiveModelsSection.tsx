import { useState } from 'react'
import { AlertTriangle, BookOpen, Film, Image as ImageIcon, Mic } from 'lucide-react'
import type { AppSettings, KeyStatus, ModelPurpose, VisualProvider } from '@shared/types'
import { FLOW2API_IMAGE_MODELS, FLOW2API_VIDEO_MODELS } from '@shared/flow2api-catalog'
import { HF_IMAGE_MODELS, HF_VIDEO_MODELS } from '@shared/higgsfield'
import { DEFAULT_PROVIDER_MODELS, providersFor, resolveActive } from '@shared/providers'
import { Button, Modal } from '../../components/ui'
import { ModelPicker } from '../../components/ModelPicker'
import { Select } from '../../components/Select'
import { StatusBadge } from './StatusBadge'
import { useModels } from '../../lib/useModels'
import { useApp } from '../../store/app'
import { errorText } from '../../lib/format'

interface Props {
  settings: AppSettings
  keys: KeyStatus[]
  onSettings: (s: AppSettings) => void
}

interface PendingVisualChange {
  purpose: 'image' | 'video'
  providerId: string
  modelId: string
  providerName: string
  modelName: string
}

const GEMINI_TTS_OPTIONS = [
  { value: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS (Cepat & Responsif)' },
  { value: 'gemini-2.5-flash-tts', label: 'Gemini 2.5 Flash TTS' }
]

const ELEVENLABS_TTS_OPTIONS = [
  { value: 'eleven_multilingual_v2', label: 'Eleven Multilingual v2 (Intonasi Terbaik)' },
  { value: 'eleven_turbo_v2_5', label: 'Eleven Turbo v2.5 (Lebih Cepat)' }
]

export function ActiveModelsSection({ settings, keys, onSettings }: Props) {
  const { toast } = useApp()
  const [pendingChange, setPendingChange] = useState<PendingVisualChange | null>(null)
  const [saving, setSaving] = useState(false)

  const activeLlm = resolveActive(settings, 'llm')
  const activeTts = resolveActive(settings, 'tts')
  const activeImage = resolveActive(settings, 'image')
  const activeVideo = resolveActive(settings, 'video')

  const llmModelsHook = useModels(activeLlm.provider.id, true)

  const statusOf = (providerId: string): KeyStatus | undefined => keys.find((k) => k.provider === providerId)

  const availableLlmProviders = providersFor('llm', settings.customProviders)
  const availableTtsProviders = providersFor('tts', settings.customProviders)
  const availableVisualProviders = providersFor('visual', settings.customProviders)

  const applyChange = async (
    purpose: ModelPurpose,
    newProviderId: string,
    newModelId: string
  ): Promise<void> => {
    setSaving(true)
    try {
      const role = purpose === 'llm' ? 'llm' : purpose === 'tts' ? 'tts' : 'visual'
      const currentRole = settings.providers?.[role] || { activeId: newProviderId, models: {} }
      const currentModelsForProvider = currentRole.models?.[newProviderId] || {}

      const nextRoleSettings = {
        ...currentRole,
        activeId: newProviderId,
        models: {
          ...currentRole.models,
          [newProviderId]: {
            ...currentModelsForProvider,
            [purpose]: newModelId
          }
        }
      }

      const patch: Partial<AppSettings> = {
        providers: {
          ...settings.providers,
          [role]: nextRoleSettings
        }
      }

      // Also sync legacy settings fields for compatibility
      if (purpose === 'llm') {
        patch.llmProvider = newProviderId as AppSettings['llmProvider']
        patch.llmModels = {
          ...settings.llmModels,
          [newProviderId]: newModelId
        }
      } else if (purpose === 'tts') {
        if (newProviderId === 'gemini') patch.geminiTtsModel = newModelId
        if (newProviderId === 'elevenlabs') patch.elevenModel = newModelId
      } else if (purpose === 'image') {
        if (newProviderId === 'higgsfield' || newProviderId === 'flow2api') {
          patch.defaultVisualProvider = newProviderId as VisualProvider
        }
        if (newProviderId === 'flow2api') patch.flow2apiImageModel = newModelId
        if (newProviderId === 'higgsfield') patch.imageModel = newModelId
      } else if (purpose === 'video') {
        if (newProviderId === 'higgsfield' || newProviderId === 'flow2api') {
          patch.defaultVisualProvider = newProviderId as VisualProvider
        }
        if (newProviderId === 'flow2api') patch.flow2apiVideoModel = newModelId
        if (newProviderId === 'higgsfield') patch.videoModel = newModelId
      }

      const updated = await window.api.settings.set(patch)
      onSettings(updated)
      toast('success', `Model aktif untuk ${purpose === 'llm' ? 'Naskah' : purpose === 'tts' ? 'Suara' : purpose === 'image' ? 'Gambar' : 'Video'} berhasil diperbarui.`)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const handleVisualChangeRequest = (
    purpose: 'image' | 'video',
    newProviderId: string,
    newModelId: string
  ): void => {
    const current = purpose === 'image' ? activeImage : activeVideo
    if (current.provider.id === newProviderId && current.model === newModelId) return

    const providerObj = availableVisualProviders.find((p) => p.id === newProviderId)
    const providerName = providerObj?.name ?? newProviderId

    let modelName = newModelId
    if (providerObj?.protocol === 'flow2api') {
      const list = purpose === 'image' ? FLOW2API_IMAGE_MODELS : FLOW2API_VIDEO_MODELS
      modelName = list.find((m) => m.id === newModelId)?.name ?? newModelId
    } else if (providerObj?.protocol === 'higgsfield') {
      const list = purpose === 'image' ? HF_IMAGE_MODELS : HF_VIDEO_MODELS
      modelName = list.find((m) => m.id === newModelId)?.name ?? newModelId
    }

    setPendingChange({
      purpose,
      providerId: newProviderId,
      modelId: newModelId,
      providerName,
      modelName
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-tight">Model Aktif</h1>
        <p className="mt-1 max-w-[720px] text-sm text-ink-2">
          Model-model yang digunakan ReelStar saat merencanakan naskah, merekam narasi/dialog, dan membuat visual shot.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Card 1: LLM (Naskah & Cerita) */}
        <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <BookOpen className="size-5 shrink-0 text-accent" />
              <h2 className="truncate text-base font-bold">Naskah & Cerita (LLM)</h2>
            </div>
            <StatusBadge status={statusOf(activeLlm.provider.id)} />
          </div>
          <p className="text-xs text-muted">
            Digunakan untuk perencanaan episode, naskah shot per adegan, prompt visual, dan meta YouTube.
          </p>

          <div className="space-y-3 pt-1">
            <Select
              label="Penyedia LLM"
              value={activeLlm.provider.id}
              disabled={saving}
              onChange={(newProviderId) => {
                const nextModel = settings.providers?.llm?.models?.[newProviderId]?.llm || ''
                void applyChange('llm', newProviderId, nextModel)
              }}
              options={availableLlmProviders.map((p) => ({
                value: p.id,
                label: p.name
              }))}
            />

            <div>
              <span className="mb-1 block text-xs font-semibold text-ink-2">Model Naskah</span>
              <ModelPicker
                value={activeLlm.model}
                models={llmModelsHook.models}
                loading={llmModelsHook.loading}
                error={llmModelsHook.error}
                fetchedAt={llmModelsHook.fetchedAt}
                disabled={saving}
                ariaLabel="Model naskah"
                onChange={(m) => void applyChange('llm', activeLlm.provider.id, m)}
                onRefresh={llmModelsHook.refresh}
                allowCustom
                placeholder="Pilih atau ketik nama model"
              />
            </div>
          </div>
        </section>

        {/* Card 2: TTS (Suara Narasi & Dialog) */}
        <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Mic className="size-5 shrink-0 text-ok-ink" />
              <h2 className="truncate text-base font-bold">Suara & Dialog (TTS)</h2>
            </div>
            <StatusBadge status={statusOf(activeTts.provider.id)} />
          </div>
          <p className="text-xs text-muted">
            Digunakan untuk menghasilkan suara narator dan dialog tokoh dalam adegan.
          </p>

          <div className="space-y-3 pt-1">
            <Select
              label="Penyedia Suara"
              value={activeTts.provider.id}
              disabled={saving}
              onChange={(newProviderId) => {
                const validIds =
                  newProviderId === 'gemini'
                    ? GEMINI_TTS_OPTIONS.map((o) => o.value)
                    : ELEVENLABS_TTS_OPTIONS.map((o) => o.value)
                const savedModel =
                  settings.providers?.tts?.models?.[newProviderId]?.tts ||
                  (newProviderId === 'gemini' ? settings.geminiTtsModel : settings.elevenModel)
                const fallbackModel = newProviderId === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_multilingual_v2'
                const nextModel = savedModel && validIds.includes(savedModel) ? savedModel : fallbackModel
                void applyChange('tts', newProviderId, nextModel)
              }}
              options={availableTtsProviders.map((p) => ({
                value: p.id,
                label: p.name
              }))}
            />

            <div>
              <span className="mb-1 block text-xs font-semibold text-ink-2">Model Suara Aktif</span>
              {activeTts.provider.id === 'gemini' ? (
                <Select
                  label="Model Gemini TTS"
                  value={activeTts.model || 'gemini-3.8-flash-tts'}
                  disabled={saving}
                  onChange={(v) => void applyChange('tts', 'gemini', v)}
                  options={GEMINI_TTS_OPTIONS}
                />
              ) : (
                <Select
                  label="Model ElevenLabs"
                  value={activeTts.model || 'eleven_multilingual_v2'}
                  disabled={saving}
                  onChange={(v) => void applyChange('tts', 'elevenlabs', v)}
                  options={ELEVENLABS_TTS_OPTIONS}
                />
              )}
            </div>
          </div>
        </section>

        {/* Card 3: Visual Image (Gambar AI) */}
        <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ImageIcon className="size-5 shrink-0 text-accent" />
              <h2 className="truncate text-base font-bold">Gambar AI</h2>
            </div>
            <StatusBadge status={statusOf(activeImage.provider.id)} />
          </div>
          <p className="text-xs text-muted">
            Digunakan untuk pembuatan frame gambar awal shot dan lembar tokoh / lokasi / prop.
          </p>

          <div className="space-y-3 pt-1">
            <Select
              label="Penyedia Gambar"
              value={activeImage.provider.id}
              disabled={saving}
              onChange={(newProviderId) => {
                const nextProvider = availableVisualProviders.find((p) => p.id === newProviderId)
                const savedModel = settings.providers?.visual?.models?.[newProviderId]?.image
                const defaultModel =
                  savedModel ||
                  (nextProvider?.protocol === 'flow2api'
                    ? DEFAULT_PROVIDER_MODELS.flow2api.image!
                    : DEFAULT_PROVIDER_MODELS.higgsfield.image!)
                handleVisualChangeRequest('image', newProviderId, defaultModel)
              }}
              options={availableVisualProviders.map((p) => ({
                value: p.id,
                label: p.name
              }))}
            />

            <div>
              <span className="mb-1 block text-xs font-semibold text-ink-2">Model Gambar</span>
              {activeImage.provider.protocol === 'flow2api' ? (
                <Select
                  label="Model Gambar Flow2API"
                  value={activeImage.model}
                  disabled={saving}
                  onChange={(v) => handleVisualChangeRequest('image', activeImage.provider.id, v)}
                  options={FLOW2API_IMAGE_MODELS.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.family})`
                  }))}
                />
              ) : (
                <Select
                  label="Model Gambar Higgsfield"
                  value={activeImage.model}
                  disabled={saving}
                  onChange={(v) => handleVisualChangeRequest('image', activeImage.provider.id, v)}
                  options={HF_IMAGE_MODELS.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.family})`
                  }))}
                />
              )}
            </div>
          </div>
        </section>

        {/* Card 4: Visual Video (Video AI) */}
        <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Film className="size-5 shrink-0 text-sun-ink" />
              <h2 className="truncate text-base font-bold">Video AI</h2>
            </div>
            <StatusBadge status={statusOf(activeVideo.provider.id)} />
          </div>
          <p className="text-xs text-muted">
            Digunakan saat mengubah shot gambar menjadi video teranimasi (Veo, Dopamine, dsb).
          </p>

          <div className="space-y-3 pt-1">
            <Select
              label="Penyedia Video"
              value={activeVideo.provider.id}
              disabled={saving}
              onChange={(newProviderId) => {
                const nextProvider = availableVisualProviders.find((p) => p.id === newProviderId)
                const savedModel = settings.providers?.visual?.models?.[newProviderId]?.video
                const defaultModel =
                  savedModel ||
                  (nextProvider?.protocol === 'flow2api'
                    ? DEFAULT_PROVIDER_MODELS.flow2api.video!
                    : DEFAULT_PROVIDER_MODELS.higgsfield.video!)
                handleVisualChangeRequest('video', newProviderId, defaultModel)
              }}
              options={availableVisualProviders.map((p) => ({
                value: p.id,
                label: p.name
              }))}
            />

            <div>
              <span className="mb-1 block text-xs font-semibold text-ink-2">Model Video</span>
              {activeVideo.provider.protocol === 'flow2api' ? (
                <Select
                  label="Model Video Flow2API"
                  value={activeVideo.model}
                  disabled={saving}
                  onChange={(v) => handleVisualChangeRequest('video', activeVideo.provider.id, v)}
                  options={FLOW2API_VIDEO_MODELS.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.family})`
                  }))}
                />
              ) : (
                <Select
                  label="Model Video Higgsfield"
                  value={activeVideo.model}
                  disabled={saving}
                  onChange={(v) => handleVisualChangeRequest('video', activeVideo.provider.id, v)}
                  options={HF_VIDEO_MODELS.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.family})`
                  }))}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Warning Modal for Visual Model Switch (Tugas 56) */}
      {pendingChange && (
        <Modal
          open={!!pendingChange}
          onClose={() => setPendingChange(null)}
          title="Konfirmasi Pergantian Model Visual Aktif"
          subtitle="Pemberitahuan perubahan model gambar / video"
          width={520}
          footer={
            <div className="flex items-center justify-end gap-2.5">
              <Button onClick={() => setPendingChange(null)} disabled={saving}>
                Batal
              </Button>
              <Button
                variant="accent"
                loading={saving}
                onClick={async () => {
                  await applyChange(pendingChange.purpose, pendingChange.providerId, pendingChange.modelId)
                  setPendingChange(null)
                }}
              >
                Ganti Model
              </Button>
            </div>
          }
        >
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-xl border border-sun bg-sun-soft p-3.5 text-xs text-sun-ink">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div className="space-y-1">
                <span className="block font-semibold">Dampak pergantian model visual:</span>
                <p>
                  Mengganti model {pendingChange.purpose === 'image' ? 'gambar' : 'video'} aktif menjadi{' '}
                  <strong className="underline">{pendingChange.modelName}</strong> ({pendingChange.providerName}) akan
                  menandai aset {pendingChange.purpose === 'image' ? 'gambar' : 'video'} yang sudah ada di proyek sebagai{' '}
                  <strong>&quot;basi&quot;</strong>.
                </p>
                <p>
                  Shot yang sudah selesai tetap dapat diputar dan diekspor, namun status basi akan mengingatkanmu bahwa
                  gambar/video tersebut belum memakai format model terbaru.
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
