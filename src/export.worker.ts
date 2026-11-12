import type { Language } from './i18n'
import { exportTimeline, type ExportFormat } from './timelineExport'
import { selectTimelineRange, type TimelineDataset } from './timelineIndex'

export type ExportRequest = {
  dataset: TimelineDataset
  from: string
  to: string
  includeSuspect: boolean
  format: ExportFormat
  language: Language
}

export type ExportResult = { blob: Blob; count: number } | { error: 'empty' | 'failed' }

self.onmessage = ({ data }: MessageEvent<ExportRequest>) => {
  try {
    const points = selectTimelineRange(data.dataset, data.from, data.to, data.includeSuspect)
    const result: ExportResult = points.length
      ? { blob: exportTimeline(data.format, points, data.dataset.points, data.language), count: points.length }
      : { error: 'empty' }
    self.postMessage(result)
  } catch {
    self.postMessage({ error: 'failed' } satisfies ExportResult)
  }
}
