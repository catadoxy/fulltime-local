import { useCallback, useEffect, useMemo, useState } from 'react'

export function useApiList<T>(loader: (signal: AbortSignal) => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const ctrl = signal ? null : new AbortController()
      const sig = signal ?? ctrl!.signal
      setLoading(true)
      setError(null)
      try {
        const data = await loader(sig)
        if (!sig.aborted) setItems(data)
      } catch (err) {
        if (!sig.aborted) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!sig.aborted) setLoading(false)
      }
    },
    [loader],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  return { items, error, loading, reload: () => load() }
}

export function useSortable<T>(items: T[], initialKey: string) {
  const [key, setKey] = useState(initialKey)
  const [dir, setDir] = useState<1 | -1>(1)
  const toggle = useCallback(
    (k: string) => {
      if (k === key) {
        setDir((d) => (d === 1 ? -1 : 1))
      } else {
        setKey(k)
        setDir(1)
      }
    },
    [key],
  )
  const sorted = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => {
      const av = (a as Record<string, unknown>)[key]
      const bv = (b as Record<string, unknown>)[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return copy
  }, [items, key, dir])
  return { sorted, key, dir, toggle }
}

export async function confirmAction(message: string): Promise<boolean> {
  return window.confirm(message)
}
