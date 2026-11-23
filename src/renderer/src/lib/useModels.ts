import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelList, ModelSource } from '@shared/types'
import { errorText } from './format'

const memory = new Map<string, ModelList>()

/** Live model list for a provider. Loads from the app's cache first; `refresh()` asks the provider again. */
export function useModels(source: ModelSource, enabled: boolean, scope = '') {
  const key = `${source}|${scope}`
  const [list, setList] = useState<ModelList | null>(memory.get(key) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqSeqRef = useRef(0)

  const load = useCallback(
    async (refresh: boolean): Promise<ModelList | null> => {
      if (!enabled) return null
      const seq = ++reqSeqRef.current
      setLoading(true)
      setError(null)
      try {
        const l = await window.api.models.list(source, refresh)
        memory.set(key, l)
        if (seq === reqSeqRef.current) setList(l)
        return l
      } catch (e) {
        if (seq === reqSeqRef.current) setError(errorText(e))
        return null
      } finally {
        if (seq === reqSeqRef.current) setLoading(false)
      }
    },
    [source, enabled, key]
  )

  useEffect(() => {
    let cancelled = false
    const seq = ++reqSeqRef.current
    setList(memory.get(key) ?? null)
    setError(null)
    if (!enabled) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)
    void window.api.models
      .list(source, false)
      .then((l) => {
        memory.set(key, l)
        if (!cancelled && seq === reqSeqRef.current) setList(l)
      })
      .catch((e) => {
        if (!cancelled && seq === reqSeqRef.current) setError(errorText(e))
      })
      .finally(() => {
        if (!cancelled && seq === reqSeqRef.current) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [source, key, enabled])

  return {
    models: list?.models ?? [],
    fetchedAt: list?.fetchedAt ?? null,
    loading,
    error,
    refresh: () => load(true)
  }
}
