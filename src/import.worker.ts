import { parseTimeline } from './timeline'
import { prepareTimeline } from './timelineIndex'

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    self.postMessage({ type: 'stage', stage: 'reading' })
    const text = await event.data.file.text()
    self.postMessage({ type: 'stage', stage: 'parsing' })
    let input: unknown
    try { input = JSON.parse(text) } catch {
      self.postMessage({ type: 'error', error: 'invalidJsonError' })
      return
    }
    const points = parseTimeline(input)
    if (!points.length) {
      self.postMessage({ type: 'error', error: 'noCoordinatesError' })
      return
    }
    self.postMessage({ type: 'stage', stage: 'indexing' })
    const dataset = prepareTimeline(points)
    if (!dataset.days.some(day => day.cleanCount > 0)) {
      self.postMessage({ type: 'error', error: 'noCoordinatesError' })
      return
    }
    self.postMessage({ type: 'complete', dataset }, { transfer: dataset.days.map(day => day.indices.buffer as ArrayBuffer) })
  } catch {
    self.postMessage({ type: 'error', error: 'importFailed' })
  }
}
