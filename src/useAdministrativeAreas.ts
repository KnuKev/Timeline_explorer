import { useEffect, useState } from 'react'
import { hasAreaDataset } from './administrativeAreas'
import type { AreaRequest, AreaResult } from './administrativeAreas.worker'
import type { PlaceEntry } from './places'
import type { TimelinePoint } from './timeline'

export function useAdministrativeAreas(entries: readonly PlaceEntry[] | undefined, pointsById: ReadonlyMap<string, TimelinePoint>) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ entries: readonly PlaceEntry[]; attempt: number; data: AreaResult }>()
  useEffect(() => {
    if (!entries?.length) return
    let worker: Worker | undefined
    let active = true
    const finish = (data: AreaResult) => {
      worker?.terminate()
      if (active) setResult({ entries, attempt, data })
    }
    try {
      worker = new Worker(new URL('./administrativeAreas.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<AreaResult>) => finish(event.data)
      worker.onerror = () => finish({ error: true })
      const groups = entries.flatMap(entry => {
        const country = entry.countryCode
        if (!country || !hasAreaDataset(country)) return []
        const points = entry.pointIds.map(id => pointsById.get(id)).filter((point): point is TimelinePoint => Boolean(point))
        return [{ country, points }]
      })
      worker.postMessage({ groups } satisfies AreaRequest)
    } catch {
      queueMicrotask(() => finish({ error: true }))
    }
    return () => {
      active = false
      worker?.terminate()
    }
  }, [entries, pointsById, attempt])
  const data = entries?.length && result && result.entries === entries && result.attempt === attempt ? result.data : undefined
  return {
    entries: data && 'entries' in data ? data.entries : undefined,
    loading: Boolean(entries?.length && !data),
    error: Boolean(data && ('error' in data || (data.failedCountries.length > 0 && data.entries.length === 0))),
    partial: Boolean(data && 'entries' in data && data.failedCountries.length > 0 && data.entries.length > 0),
    retry: () => setAttempt(value => value + 1),
  }
}
