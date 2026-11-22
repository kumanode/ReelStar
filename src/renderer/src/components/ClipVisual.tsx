import { AlertCircle, Film, Image as ImageIcon, Sparkles } from 'lucide-react'
import type { Asset, Clip, Job } from '@shared/types'
import { isRunning } from '../store/project'
import { cx } from './ui'

function formatGeneratingStatus(job: Pick<Job, 'kind' | 'status' | 'message'>): { title: string; sub: string } {
  const isVideo = job.kind === 'video'
  const isSheet = job.kind === 'sheet'
  if (job.status === 'queued') {
    return {
      title: isVideo ? 'Antre Video' : isSheet ? 'Antre Lembar' : 'Antre Gambar',
      sub: 'Menunggu giliran…'
    }
  }
  const msg = (job.message ?? '').trim()
  const secMatch = /(\d+)\s*dtk/i.exec(msg)
  if (/unduh/i.test(msg)) {
    return { title: isVideo ? 'Video AI' : 'Gambar AI', sub: 'Mengunduh…' }
  }
  if (/menunggu video shot/i.test(msg)) {
    return { title: 'Video AI', sub: 'Tunggu shot lalu…' }
  }
  if (/siap|prompt/i.test(msg)) {
    return { title: isVideo ? 'Video AI' : isSheet ? 'Lembar AI' : 'Gambar AI', sub: 'Menyiapkan…' }
  }
  if (secMatch) {
    return {
      title: isVideo ? 'Merender Video' : isSheet ? 'Membuat Lembar' : 'Merender Gambar',
      sub: `${secMatch[1]} dtk`
    }
  }
  return {
    title: isVideo ? 'Merender Video' : isSheet ? 'Membuat Lembar' : 'Merender Gambar',
    sub: msg ? msg.slice(0, 24) : 'Memproses…'
  }
}

/**
 * Reusable studio-grade animated loading overlay for generating images, videos, and Lorebook sheets.
 * Uses subtle diagonal shimmer, a cinematic vertical scan beam, pulsing orb icon, and bottom progress bar.
 */
export function GeneratingOverlay({
  job,
  hasBackdrop,
  compact,
  large
}: {
  job: Pick<Job, 'kind' | 'status' | 'message'>
  hasBackdrop?: boolean
  compact?: boolean
  large?: boolean
}) {
  const isVideo = job.kind === 'video'
  const { title, sub } = formatGeneratingStatus(job)

  return (
    <div
      className={cx(
        'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden px-2 text-center',
        hasBackdrop ? 'bg-paper/82 backdrop-blur-[4px]' : 'bg-surface/95'
      )}
    >
      {/* Subtle diagonal luminous shimmer */}
      <div
        className={cx(
          'rs-gen-shimmer absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent to-transparent',
          isVideo ? 'via-info-ink/15' : 'via-accent/15'
        )}
      />

      {/* Cinematic scanline beam */}
      <div
        className={cx(
          'rs-gen-scanline absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent to-transparent',
          isVideo ? 'via-info-ink/20' : 'via-sun/25'
        )}
      />

      {/* Center icon & crisp 2-line phase label */}
      <div className="relative z-10 flex flex-col items-center gap-1.5">
        <div
          className={cx(
            'relative flex items-center justify-center rounded-full border shadow-sm',
            compact ? 'size-6' : large ? 'size-11' : 'size-8',
            isVideo
              ? 'border-info-ink/40 bg-info-soft text-info-ink'
              : 'border-accent/40 bg-accent-soft text-accent'
          )}
        >
          <span
            className={cx(
              'absolute inset-0 rounded-full border-2 border-transparent animate-spin',
              isVideo ? 'border-t-info-ink' : 'border-t-accent'
            )}
          />
          {isVideo ? (
            <Film className={compact ? 'size-3' : large ? 'size-5' : 'size-3.5'} />
          ) : (
            <Sparkles className={compact ? 'size-3' : large ? 'size-5' : 'size-3.5'} />
          )}
        </div>

        {!compact && (
          <div className="flex flex-col items-center leading-tight">
            <span
              className={cx(
                'font-display font-bold tracking-tight',
                large ? 'text-sm' : 'text-[11px]',
                isVideo ? 'text-info-ink' : 'text-ink'
              )}
            >
              {title}
            </span>
            <span
              className={cx(
                'mt-0.5 font-mono tabular-nums text-muted',
                large ? 'text-xs' : 'text-[10px]'
              )}
            >
              {sub}
            </span>
          </div>
        )}

        {large && (
          <span className="mt-1 text-xs text-ink-2">Boleh pindah klip, prosesnya tetap jalan</span>
        )}
      </div>

      {/* Bottom indeterminate progress bar */}
      <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-line/60">
        <div
          className={cx(
            'rs-gen-progress h-full w-2/5 rounded-full',
            isVideo ? 'bg-info-ink' : 'bg-accent'
          )}
        />
      </div>
    </div>
  )
}

/** A clip's picture: its video (if chosen), image, or a placeholder, with the state of any running job on top. */
export function ClipVisual({
  clip,
  image,
  video,
  job,
  large,
  playVideo
}: {
  clip: Clip
  image?: Asset | null
  video?: Asset | null
  job?: Job | null
  large?: boolean
  playVideo?: boolean
}) {
  const running = isRunning(job)
  const failed = job?.status === 'failed' && !image
  const showVideo = clip.motionType === 'video' && video && playVideo
  return (
    <div className="absolute inset-0 overflow-hidden">
      {showVideo ? (
        <video
          key={video.id}
          src={video.url}
          poster={image?.url}
          className="rs-media-reveal size-full object-cover"
          autoPlay
          loop
          muted
          playsInline
        />
      ) : image ? (
        <img
          key={image.id}
          src={image.url}
          alt=""
          loading="lazy"
          className="rs-media-reveal size-full object-cover"
          draggable={false}
        />
      ) : running ? null : (
        <div
          className={cx(
            'absolute inset-1.5 flex flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed px-2 text-center text-muted',
            failed ? 'border-bad-ink/40 bg-bad-soft text-bad-ink' : 'border-line-3/80 bg-paper/70'
          )}
        >
          {failed ? (
            <AlertCircle className={large ? 'size-7' : 'size-4'} />
          ) : (
            <ImageIcon className={large ? 'size-7' : 'size-4 opacity-70'} strokeWidth={1.6} />
          )}
          <span className={cx('leading-tight', large ? 'text-sm' : 'text-[10px] font-medium')}>
            {failed ? 'Gagal dibuat' : 'Belum ada gambar'}
          </span>
        </div>
      )}
      {running && job && (
        <GeneratingOverlay job={job} hasBackdrop={Boolean(image || showVideo)} large={large} />
      )}
    </div>
  )
}
