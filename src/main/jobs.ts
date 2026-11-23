import type { Job } from '@shared/types'
import { getDb } from './db'
import { emit } from './events'
import { getJobRaw, updateJob } from './repo'
import { cancelRequest } from './services/higgsfield'
import { getSettings } from './settings'

export type QueueName = 'higgsfield' | 'flow2api' | 'tts' | 'whisper' | 'export'

export interface TaskCtx {
  jobId: string
  signal: AbortSignal
  progress(p: number, message?: string): void
  setRemote(id: string): void
}

/** A task returns the id of the asset it produced, or a message to keep on the finished job (e.g. an output path). */
export type Task = (ctx: TaskCtx) => Promise<string | void | { message: string }>

// Whisper uses most CPU cores by itself, so it runs one file at a time.
const FIXED_LIMITS: Record<Exclude<QueueName, 'higgsfield' | 'flow2api'>, number> = { tts: 2, whisper: 1, export: 1 }
const running: Record<QueueName, number> = { higgsfield: 0, flow2api: 0, tts: 0, whisper: 0, export: 0 }
const waiting: Record<QueueName, (() => void)[]> = { higgsfield: [], flow2api: [], tts: [], whisper: [], export: [] }
const controllers = new Map<string, AbortController>()

function acquire(q: QueueName, signal?: AbortSignal): Promise<void> {
  const limit = q === 'higgsfield' ? getSettings().higgsfieldConcurrency : q === 'flow2api' ? getSettings().flow2apiConcurrency : FIXED_LIMITS[q]
  if (signal?.aborted) return Promise.reject(new Error('Dibatalkan'))
  if (running[q] < limit) {
    running[q]++
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | undefined
    const runNext = () => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      running[q]++
      resolve()
    }
    if (signal) {
      onAbort = () => {
        const idx = waiting[q].indexOf(runNext)
        if (idx !== -1) waiting[q].splice(idx, 1)
        reject(new Error('Dibatalkan'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    waiting[q].push(runNext)
  })
}

function release(q: QueueName): void {
  running[q]--
  const limit = q === 'higgsfield' ? getSettings().higgsfieldConcurrency : q === 'flow2api' ? getSettings().flow2apiConcurrency : FIXED_LIMITS[q]
  if (running[q] < limit) waiting[q].shift()?.()
}

/** updateJob finds no row once "Hapus semua episode" removed it; such a job is not reported any more. */
function emitIfKept(job: Job | null | undefined): void {
  if (job) emit.job(job)
}

/**
 * Runs a job in its queue. `beforeQueue` runs first, without holding a queue slot, for waits on other
 * work (such as a voice-over the job needs) that should not block unrelated jobs in the same queue.
 */
export function runJob(job: Job, queue: QueueName, task: Task, beforeQueue?: (ctx: TaskCtx) => Promise<void>): Job {
  const ctrl = new AbortController()
  const queuedAt = Date.now()
  controllers.set(job.id, ctrl)
  let lastEmit = 0
  const ctx: TaskCtx = {
    jobId: job.id,
    signal: ctrl.signal,
    progress: (p, message) => {
      const now = Date.now()
      const j = updateJob(job.id, { progress: Math.min(0.99, Math.max(0, p)), ...(message !== undefined ? { message } : {}) })
      // The row is gone when its episode was deleted mid-run; there is nothing left to report.
      if (!j) return
      if (now - lastEmit > 250 || p >= 0.99) {
        lastEmit = now
        emit.job(j)
      }
    },
    setRemote: (id) => {
      updateJob(job.id, { remoteId: id })
    }
  }
  void (async () => {
    let acquired = false
    try {
      if (beforeQueue) await beforeQueue(ctx)
      await acquire(queue, ctrl.signal)
      acquired = true
      if (ctrl.signal.aborted) {
        throw new Error('Dibatalkan')
      }
      console.info('[job] queue wait completed', { kind: job.kind, provider: job.provider, elapsedMs: Date.now() - queuedAt })
      emitIfKept(updateJob(job.id, { status: 'running', progress: 0.02 }))
      const result = await task(ctx)
      const extra =
        typeof result === 'string' ? { resultAssetId: result, message: null } : { message: result?.message ?? null }
      emitIfKept(updateJob(job.id, { status: 'done', progress: 1, ...extra }))
    } catch (e) {
      const canceled = ctrl.signal.aborted || (e as Error)?.message === 'Dibatalkan'
      emitIfKept(
        updateJob(job.id, {
          status: canceled ? 'canceled' : 'failed',
          error: canceled ? null : ((e as Error)?.message ?? String(e)),
          message: null
        })
      )
      if (!canceled) console.error(`[job ${job.kind}]`, e)
    } finally {
      if (acquired) release(queue)
      controllers.delete(job.id)
    }
  })()
  return job
}

export async function cancelJob(id: string): Promise<void> {
  const raw = getJobRaw(id)
  if (!raw) return
  const ctrl = controllers.get(id)
  // A live job reports 'canceled' itself once its task stops; marking it here first could be overwritten by
  // 'done' if the task was already finishing, leaving a canceled job with a saved result.
  if (ctrl) ctrl.abort()
  else if (raw.status === 'queued' || raw.status === 'running') emit.job(updateJob(id, { status: 'canceled', message: null }))
  if (raw.remote_id && raw.provider === 'higgsfield') {
    void cancelRequest(raw.remote_id).catch(() => {})
  }
}

export async function cancelProjectJobs(projectId: string, kind?: string): Promise<void> {
  const rows = (
    kind
      ? getDb().prepare(`SELECT id FROM jobs WHERE project_id = ? AND kind = ? AND status IN ('queued', 'running')`).all(projectId, kind)
      : getDb().prepare(`SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued', 'running')`).all(projectId)
  ) as { id: string }[]
  await Promise.all(rows.map((r) => cancelJob(r.id)))
  if (!kind) {
    const deadline = Date.now() + 15000
    while (rows.some((r) => controllers.has(r.id)) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 100))
    }
  }
}

export function isActive(id: string): boolean {
  return controllers.has(id)
}

/** Cancels running work tied to episodes or clips (all episodes, or one specific episode), leaving Lorebook sheet jobs alone. */
export async function cancelEpisodeJobs(projectId: string, episodeId?: string): Promise<void> {
  const rows = (
    episodeId
      ? getDb()
          .prepare(
            `SELECT id FROM jobs WHERE project_id = ? AND (episode_id = ? OR clip_id IN (SELECT id FROM clips WHERE project_id = ? AND episode_id = ?)) AND status IN ('queued', 'running')`
          )
          .all(projectId, episodeId, projectId, episodeId)
      : getDb()
          .prepare(
            `SELECT id FROM jobs WHERE project_id = ? AND (episode_id IS NOT NULL OR clip_id IS NOT NULL) AND status IN ('queued', 'running')`
          )
          .all(projectId)
  ) as { id: string }[]
  await Promise.all(rows.map((r) => cancelJob(r.id)))
  // Their rows are about to be deleted, so wait until each task has stopped writing to them (bounded: a task
  // stuck in a download still gets its abort, it just is not waited for).
  const deadline = Date.now() + 15000
  while (rows.some((r) => controllers.has(r.id)) && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 100))
  }
}
