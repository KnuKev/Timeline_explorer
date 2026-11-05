import { useCallback, useEffect, useRef, useState } from 'react'
import type { TimelineDataset } from './timelineIndex'
import type { PlaceAnalysis } from './places'
import type { TranslationKey } from './i18n'
import type { StatisticsAnalysis } from './statistics'
import type { TripsAnalysis } from './trips'
import { DEFAULT_HOME_RADIUS_KM } from './tripSettings'

type Response = { requestId: number; data: PlaceAnalysis; statistics?: StatisticsAnalysis; trips?: TripsAnalysis } | { requestId: number; error: TranslationKey }
type Result = { dataset: TimelineDataset; includeSuspect: boolean; homeRadiusKm: number; attempt: number; data?: PlaceAnalysis; statistics?: StatisticsAnalysis; trips?: TripsAnalysis; error?: TranslationKey }

export function usePlaces(dataset: TimelineDataset, includeSuspect: boolean, enabled: boolean, includeStatistics = false, includeTrips = false, homeRadiusKm = DEFAULT_HOME_RADIUS_KM) {
  const workerRef = useRef<Worker | null>(null)
  const sentDataset = useRef<TimelineDataset | null>(null)
  const requestId = useRef(0)
  const [result, setResult] = useState<Result | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const retry = useCallback(() => setRetryCount(value => value + 1), [])
  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
    sentDataset.current = null
    requestId.current++
  }, [])
  useEffect(() => {
    if (!enabled) return
    const id = ++requestId.current
    try {
      const worker = workerRef.current ?? new Worker(new URL('./places.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      const onMessage = (event: MessageEvent<Response>) => {
        if (event.data.requestId !== requestId.current) return
        setResult({ dataset, includeSuspect, homeRadiusKm, attempt: retryCount, ...('data' in event.data ? { data: event.data.data, statistics: event.data.statistics, trips: event.data.trips } : { error: event.data.error }) })
      }
      const onError = () => {
        if (requestId.current !== id) return
        worker.terminate()
        workerRef.current = null
        sentDataset.current = null
        setResult({ dataset, includeSuspect, homeRadiusKm, attempt: retryCount, error: 'placesAnalysisError' })
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      if (sentDataset.current !== dataset) {
        worker.postMessage({ type: 'dataset', points: dataset.points, days: dataset.days, excludedIds: dataset.excluded.map(entry => entry.point.id) })
        sentDataset.current = dataset
      }
      worker.postMessage({ type: 'analyse', requestId: id, includeSuspect, includeStatistics, includeTrips, homeRadiusKm })
      return () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
    } catch {
      workerRef.current?.terminate()
      workerRef.current = null
      sentDataset.current = null
      queueMicrotask(() => {
        if (requestId.current === id) setResult({ dataset, includeSuspect, homeRadiusKm, attempt: retryCount, error: 'placesAnalysisError' })
      })
    }
  }, [dataset, includeSuspect, enabled, includeStatistics, includeTrips, homeRadiusKm, retryCount])
  const matches = result?.dataset === dataset && result.includeSuspect === includeSuspect && result.attempt === retryCount
  const tripsMatch = matches && result.homeRadiusKm === homeRadiusKm
  const error: TranslationKey | '' = tripsMatch ? result.error ?? '' : ''
  return { data: matches ? result.data ?? null : null, statistics: matches ? result.statistics ?? null : null, trips: tripsMatch ? result.trips ?? null : null, error,
    loading: enabled && (!matches || (!result.data && !error)),
    statisticsLoading: enabled && includeStatistics && (!matches || (!result.statistics && !error)),
    tripsLoading: enabled && includeTrips && (!tripsMatch || (!result.trips && !error)), retry }
}
