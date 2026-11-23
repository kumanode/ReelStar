import { useState, useEffect } from 'react'
import { BookOpen, RotateCcw, Sparkles, Check, FileCode } from 'lucide-react'
import {
  DEFAULT_PROMPT_TEMPLATES,
  type PromptTemplateKey
} from '@shared/types'
import { AutoTextarea } from '../../components/AutoTextarea'
import { Badge, Button, Modal, Segmented, confirmDialog, cx } from '../../components/ui'
import { useApp } from '../../store/app'
import { useProject } from '../../store/project'

interface SeriesGuidelinesModalProps {
  open: boolean
  onClose: () => void
}

type ModalTab = 'guidelines' | 'templates'

// Script Doctor runs locally with deterministic rules and no LLM, so it has no customizable prompt.
const CUSTOMIZABLE_TEMPLATE_KEYS = (Object.keys(DEFAULT_PROMPT_TEMPLATES) as PromptTemplateKey[]).filter(
  (k) => k !== 'script_doctor'
)

export function SeriesGuidelinesModal({ open, onClose }: SeriesGuidelinesModalProps) {
  const { project, updateProject, flush } = useProject()
  const { toast } = useApp()

  const [activeTab, setActiveTab] = useState<ModalTab>('guidelines')
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<PromptTemplateKey>('episode_planner')

  // Local state for guidelines & templates
  const [guidelines, setGuidelines] = useState(project?.seriesGuidelines ?? '')
  const [templates, setTemplates] = useState<Record<string, string>>(
    () => project?.promptTemplates ?? {}
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && project) {
      setGuidelines(project.seriesGuidelines ?? '')
      setTemplates(project.promptTemplates ?? {})
    }
  }, [open, project?.id])

  if (!project) return null

  const handleResetTemplate = (key: PromptTemplateKey) => {
    const defaultDef = DEFAULT_PROMPT_TEMPLATES[key]
    if (!defaultDef) return
    setTemplates((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    toast('info', `Template "${defaultDef.name}" dikembalikan ke instruksi bawaan.`)
  }

  const handleResetAllTemplates = async () => {
    const ok = await confirmDialog({
      title: 'Kembalikan semua template?',
      body: 'Semua template prompt kustom akan dikembalikan ke instruksi bawaan. Perubahan baru tersimpan setelah kamu menekan Simpan.',
      confirm: 'Kembalikan semua',
      danger: true
    })
    if (!ok) return
    setTemplates({})
    toast('info', 'Semua template prompt dikembalikan ke bawaan.')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      updateProject({
        seriesGuidelines: guidelines.trim(),
        promptTemplates: templates
      })
      await flush()
      toast('success', 'Arahan serial dan template prompt berhasil disimpan.')
      onClose()
    } catch {
      toast('error', 'Gagal menyimpan arahan serial.')
    } finally {
      setSaving(false)
    }
  }

  const activeTemplateDef = DEFAULT_PROMPT_TEMPLATES[selectedTemplateKey]
  const currentPrompt = templates[selectedTemplateKey] ?? activeTemplateDef.template

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Arahan Serial & Kustomisasi Prompt AI"
      subtitle="Sesuaikan nada, aturan cerita, dan template prompt yang digunakan oleh AI untuk serial ini."
      width={780}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button variant="primary" size="sm" icon={<Check className="size-3.5" />} onClick={handleSave} loading={saving}>
            {saving ? 'Menyimpan…' : 'Simpan arahan & template'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <Segmented<ModalTab>
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                id: 'guidelines',
                label: (
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="size-3.5" />
                    Arahan serial
                  </span>
                )
              },
              {
                id: 'templates',
                label: (
                  <span className="flex items-center gap-1.5">
                    <FileCode className="size-3.5" />
                    Template Prompt AI ({CUSTOMIZABLE_TEMPLATE_KEYS.length})
                  </span>
                )
              }
            ]}
          />

          {activeTab === 'templates' && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => void handleResetAllTemplates()}
              disabled={Object.keys(templates).length === 0}
            >
              Reset Semua ke Bawaan
            </Button>
          )}
        </div>

        {/* Tab 1: Guidelines */}
        {activeTab === 'guidelines' && (
          <div className="flex flex-col gap-3 py-1">
            <div className="rounded-xl border border-line bg-sand/30 p-3 text-xs text-ink-2 space-y-1">
              <span className="font-semibold text-ink flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-accent" />
                Bagaimana Arahan Serial Digunakan?
              </span>
              <p>
                Teks arahan ini akan disematkan secara otomatis ke dalam prompt LLM saat AI memecah episode,
                merancang draf naskah shot-by-shot, dan memeriksa ritme cerita.
              </p>
              <p className="text-[11px] text-muted">
                Contoh: &ldquo;Serial drama vertikal misteri. Karakter utama selalu bersikap tenang dan sinis.
                Pantangan: jangan gunakan adegan darah berlebihan. Pertahankan dialog pendek dan tajam.&rdquo;
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="series-guidelines-input" className="text-xs font-semibold text-ink">Catatan Arahan Gaya &amp; Dunia Cerita</label>
              <AutoTextarea
                id="series-guidelines-input"
                value={guidelines}
                onChange={(e) => setGuidelines(e.target.value)}
                placeholder="Tuliskan aturan nada, gaya bahasa, pantangan adegan, atau karakteristik khusus serial ini..."
                minRows={8}
                maxHeight={260}
                className="w-full rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-ink outline-none transition-colors focus:border-ink"
              />
            </div>
          </div>
        )}

        {/* Tab 2: Prompt Templates */}
        {activeTab === 'templates' && (
          <div className="flex flex-col gap-3 py-1">
            {/* Template selector pills */}
            <div className="flex flex-wrap gap-1.5 border-b border-line pb-2.5">
              {CUSTOMIZABLE_TEMPLATE_KEYS.map((key) => {
                const def = DEFAULT_PROMPT_TEMPLATES[key]
                const isCustom = Boolean(templates[key] && templates[key] !== def.template)
                const isSelected = selectedTemplateKey === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedTemplateKey(key)}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                      isSelected
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line bg-surface text-ink hover:border-line-2'
                    )}
                  >
                    <span>{def.name}</span>
                    {isCustom && <span className="size-1.5 rounded-full bg-accent" />}
                  </button>
                )
              })}
            </div>

            {/* Template detail editor */}
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-bold text-ink flex items-center gap-2">
                    {activeTemplateDef.name}
                    <Badge tone="info" className="text-[11px]">
                      {selectedTemplateKey}
                    </Badge>
                  </h4>
                  <p className="text-xs text-muted mt-0.5">{activeTemplateDef.description}</p>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RotateCcw className="size-3" />}
                  onClick={() => handleResetTemplate(selectedTemplateKey)}
                >
                  Kembalikan ke Bawaan
                </Button>
              </div>

              {/* Supported Placeholders */}
              {activeTemplateDef.placeholders && activeTemplateDef.placeholders.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <span className="font-semibold">Placeholder:</span>
                  {activeTemplateDef.placeholders.map((ph: string) => (
                    <span
                      key={ph}
                      className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px] text-accent-dark font-medium border border-line"
                    >
                      {`{${ph}}`}
                    </span>
                  ))}
                </div>
              )}

              {/* System Prompt Textarea */}
              <div className="flex flex-col gap-1">
                <label htmlFor="series-prompt-template-input" className="text-[11px] font-semibold text-ink-2">Instruksi Prompt</label>
                <AutoTextarea
                  id="series-prompt-template-input"
                  value={currentPrompt}
                  onChange={(e) => {
                    const newPrompt = e.target.value
                    setTemplates((prev) => ({
                      ...prev,
                      [selectedTemplateKey]: newPrompt
                    }))
                  }}
                  minRows={10}
                  maxHeight={280}
                  className="w-full rounded-xl border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none transition-colors focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/35"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
