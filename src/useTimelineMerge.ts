import { useEffect, useRef, useState } from 'react'
import type { MergeSummary } from './timelineMerge'
import type { MergeWorkerResult, MergeStage } from './merge.worker'
import type { MergeErrorCode } from './mergeI18n'

type MergeDownload = { url: string; filename: string; summary: MergeSummary }
type MergeError = { code: MergeErrorCode; fileIndex?: number }

export function useTimelineMerge() {
  const workerRef = useRef<Worker | null>(null)
  const downloadRef = useRef<string | null>(null)
  const [stage, setStage] = useState<MergeStage | null>(null)
  const [result, setResult] = useState<MergeDownload | null>(null)
  const [error, setError] = useState<MergeError | null>(null)

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
    if (downloadRef.current) URL.revokeObjectURL(downloadRef.current)
    downloadRef.current = null
  }, [])

  function reset() {
    workerRef.current?.terminate()
    workerRef.current = null
    if (downloadRef.current) URL.revokeObjectURL(downloadRef.current)
    downloadRef.current = null
    setStage(null)
    setResult(null)
    setError(null)
  }

  function merge(files: [File, File]) {
    reset()
    setStage('reading')
    try {
      const worker = new Worker(new URL('./merge.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      function finish() {
        worker.terminate()
        workerRef.current = null
        setStage(null)
      }
      worker.onmessage = (event: MessageEvent<MergeWorkerResult>) => {
        if (workerRef.current !== worker) return
        const message = event.data
        if (message.type === 'stage') {
          setStage(message.stage)
          return
        }
        try {
          if (message.type === 'error') {
            setError({ code: message.code, fileIndex: message.fileIndex })
          } else {
            const url = URL.createObjectURL(message.blob)
            downloadRef.current = url
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            setResult({ url, filename: `Timeline-merged-${stamp}.json`, summary: message.summary })
          }
        } catch {
          setError({ code: 'mergeFailed' })
        } finally {
          finish()
        }
      }
      worker.onerror = () => {
        if (workerRef.current !== worker) return
        setError({ code: 'mergeFailed' })
        finish()
      }
      worker.postMessage({ files })
    } catch {
      reset()
      setError({ code: 'mergeFailed' })
    }
  }

  return { stage, result, error, merge, reset }
}
