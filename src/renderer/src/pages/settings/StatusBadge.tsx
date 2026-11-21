import { Check } from 'lucide-react'
import type { KeyStatus } from '@shared/types'
import { Badge } from '../../components/ui'

export function StatusBadge({ status }: { status?: KeyStatus }) {
  if (!status?.configured) return <Badge tone="draft">Belum diatur</Badge>
  if (status.lastOk === false)
    return (
      <Badge tone="bad" title={status.lastMessage ?? undefined}>
        Gagal terhubung
      </Badge>
    )
  if (status.lastOk)
    return (
      <Badge tone="ok">
        <Check className="size-3" strokeWidth={3} />
        Terhubung
      </Badge>
    )
  return <Badge tone="info">Tersimpan</Badge>
}
