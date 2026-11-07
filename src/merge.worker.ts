import { mergeTimelineFiles, TimelineMergeError } from './timelineMerge'
import type { MergeSummary } from './timelineMerge'
import type { MergeErrorCode } from './mergeI18n'

export type MergeStage = 'reading' | 'merging' | 'preparing'
export type MergeWorkerResult =
  | { type: 'stage'; stage: MergeStage }
  | { type: 'complete'; blob: Blob; summary: MergeSummary }
  | { type: 'error'; code: MergeErrorCode; fileIndex?: number }

self.onmessage = async (event: MessageEvent<{ files: [File, File] }>) => {
  try {
    self.postMessage({ type: 'stage', stage: 'reading' } satisfies MergeWorkerResult)
    const inputs: unknown[] = []
    for (let index = 0; index < event.data.files.length; index++) {
      let text: string
      try {
        text = await event.data.files[index]!.text()
      } catch {
        self.postMessage({ type: 'error', code: 'readError', fileIndex: index } satisfies MergeWorkerResult)
        return
      }
      try {
        inputs.push(JSON.parse(text.replace(/^\uFEFF/, '')))
      } catch {
        self.postMessage({ type: 'error', code: 'invalidJson', fileIndex: index } satisfies MergeWorkerResult)
        return
      }
    }
    self.postMessage({ type: 'stage', stage: 'merging' } satisfies MergeWorkerResult)
    const { data, summary } = mergeTimelineFiles(inputs[0], inputs[1])
    self.postMessage({ type: 'stage', stage: 'preparing' } satisfies MergeWorkerResult)
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    self.postMessage({ type: 'complete', blob, summary } satisfies MergeWorkerResult)
  } catch (error) {
    const code = error instanceof TimelineMergeError ? error.code : 'mergeFailed'
    self.postMessage({ type: 'error', code } satisfies MergeWorkerResult)
  }
}
