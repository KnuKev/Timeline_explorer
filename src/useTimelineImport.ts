import { useCallback, useEffect, useRef, useState } from 'react'
import type { TimelineDataset } from './timelineIndex'
import type { TranslationKey } from './i18n'

export type ImportStage = 'reading' | 'parsing' | 'indexing'
type ImportResult = { type: 'stage'; stage: ImportStage } | { type: 'complete'; dataset: TimelineDataset } | { type: 'error'; error: TranslationKey }

export function useTimelineImport(onLoaded: (dataset: TimelineDataset, filename: string) => void) {
  const workerRef = useRef<Worker | null>(null)
  const [stage, setStage] = useState<ImportStage | null>(null)
  const [error, setError] = useState<TranslationKey | ''>('')
  const cancelImport = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setStage(null)
  }, [])
  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])
  const importFile = useCallback((file?: File) => {
    if (!file) return
    workerRef.current?.terminate()
    setError('')
    setStage('reading')
    try {
      const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      const finish = () => { worker.terminate(); workerRef.current = null; setStage(null) }
      worker.onmessage = (event: MessageEvent<ImportResult>) => {
        if (workerRef.current !== worker) return
        const result = event.data
        if (result.type === 'stage') setStage(result.stage)
        else {
          try {
            if (result.type === 'complete') onLoaded(result.dataset, file.name)
            else setError(result.error)
          } catch { setError('importFailed') }
          finally { finish() }
        }
      }
      worker.onerror = () => {
        if (workerRef.current !== worker) return
        setError('importFailed')
        finish()
      }
      worker.postMessage({ file })
    } catch {
      workerRef.current?.terminate()
      workerRef.current = null
      setError('importFailed')
      setStage(null)
    }
  }, [onLoaded])
  return { importFile, cancelImport, stage, error }
}
