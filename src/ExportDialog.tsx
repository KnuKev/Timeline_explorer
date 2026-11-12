import { useEffect, useId, useRef, useState } from 'react'
import type { ExportRequest, ExportResult } from './export.worker'
import { locales, translations, type Language } from './i18n'
import { mergeTranslations } from './mergeI18n'
import { exportFormats, type ExportFormat } from './timelineExport'
import type { TimelineDataset } from './timelineIndex'
import Icon from './Icon'
import './MergeDialog.css'
import './ExportDialog.css'

type Props = {
  dataset: TimelineDataset
  language: Language
  initialFrom: string
  initialTo: string
  onClose: () => void
}
type Download = { url: string; filename: string; count: number }

const copy = {
  nb: {
    description: 'Velg en periode og last ned ruter og posisjonspunkter fra tidslinjen.',
    format: 'Filformat', kml: 'KML · Google Earth', gpx: 'GPX · GPS- og turapper', geojson: 'GeoJSON · kartverktøy',
    all: 'Velg hele historikken', download: 'Last ned', preparing: 'Klargjør filen …',
    ready: 'Filen er klar. Posisjonspunkter i utvalget: {count}.', empty: 'Ingen posisjonspunkter i denne perioden.',
    failed: 'Kunne ikke lage eksportfilen. Prøv igjen.',
    includeSuspect: 'Ta med mistenkelige posisjonspunkter',
    privacy: 'Filen lages lokalt i nettleseren.',
  },
  en: {
    description: 'Choose a date range to download routes and location points from your timeline.',
    format: 'File format', kml: 'KML · Google Earth', gpx: 'GPX · GPS and outdoor apps', geojson: 'GeoJSON · mapping tools',
    all: 'Select all dates', download: 'Download', preparing: 'Preparing your file…',
    ready: 'Your file is ready. Location points in the selection: {count}.', empty: 'No location points in this date range.',
    failed: 'The export file could not be created. Try again.',
    includeSuspect: 'Include suspicious location points',
    privacy: 'The file is created locally in your browser.',
  },
}

export default function ExportDialog({ dataset, language, initialFrom, initialTo, onClose }: Props) {
  const t = translations[language]
  const labels = copy[language]
  const first = dataset.days[0]?.day ?? ''
  const last = dataset.days.at(-1)?.day ?? ''
  const clamp = (date: string, fallback: string) => date ? date < first ? first : date > last ? last : date : fallback
  const [from, setFrom] = useState(() => clamp(initialFrom, first))
  const [to, setTo] = useState(() => clamp(initialTo, last))
  const hasSuspectPointsInRange = Boolean(from && to) && dataset.days.some(
    ({ day, indices, cleanCount }) => day >= from && day <= to && indices.length > cleanCount,
  )
  const [format, setFormat] = useState<ExportFormat>('kml')
  const [includeSuspectPoints, setIncludeSuspectPoints] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'empty' | 'failed' | null>(null)
  const [download, setDownload] = useState<Download | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const worker = useRef<Worker | null>(null)
  const objectUrl = useRef<string | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => {
      worker.current?.terminate()
      worker.current = null
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
      element.close()
    }
  }, [])

  function clearDownload() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
    setDownload(null)
    setError(null)
  }

  function close() {
    dialog.current?.close()
    onClose()
  }

  function prepareDownload() {
    if (worker.current || !from || !to || from > to) return
    clearDownload()
    setBusy(true)
    try {
      const task = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
      worker.current = task
      const finish = () => {
        task.terminate()
        worker.current = null
        setBusy(false)
      }
      task.onmessage = ({ data }: MessageEvent<ExportResult>) => {
        if (worker.current !== task) return
        finish()
        if ('error' in data) {
          setError(data.error)
          return
        }
        try {
          const url = URL.createObjectURL(data.blob)
          objectUrl.current = url
          const dates = from === to ? from : `${from}_to_${to}`
          const filename = `Timeline-${dates}.${format}`
          setDownload({ url, filename, count: data.count })
          const link = document.createElement('a')
          link.href = url
          link.download = filename
          dialog.current?.append(link)
          link.click()
          link.remove()
        } catch {
          setError('failed')
        }
      }
      task.onerror = () => {
        if (worker.current !== task) return
        finish()
        setError('failed')
      }
      task.postMessage({ dataset, from, to, format, language, includeSuspect: hasSuspectPointsInRange && includeSuspectPoints } satisfies ExportRequest)
    } catch {
      worker.current?.terminate()
      worker.current = null
      setBusy(false)
      setError('failed')
    }
  }

  return <dialog ref={dialog} className="merge-dialog export-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); close() }}>
    <div className="merge-dialog-heading">
      <h2 id={titleId}>{t.exportTimeline}</h2>
      <button type="button" className="merge-close" aria-label={mergeTranslations[language].close} onClick={close}><Icon name="close" /></button>
    </div>
    <p id={descriptionId} className="merge-description">{labels.description}</p>
    <form onSubmit={event => { event.preventDefault(); prepareDownload() }}>
      <fieldset className="export-fields" disabled={busy}>
        <div className="export-dates">
          <label>{t.from}<input type="date" required value={from} min={first} max={last} onChange={event => {
            const value = event.target.value
            setFrom(value)
            if (value && value > to) setTo(value)
            clearDownload()
          }} /></label>
          <label>{t.to}<input type="date" required value={to} min={first} max={last} onChange={event => {
            const value = event.target.value
            setTo(value)
            if (value && value < from) setFrom(value)
            clearDownload()
          }} /></label>
        </div>
        <button type="button" className="merge-secondary export-all" disabled={!first} onClick={() => {
          setFrom(first)
          setTo(last)
          clearDownload()
        }}>{labels.all}</button>
        <label>{labels.format}<select value={format} onChange={event => {
          setFormat(event.target.value as ExportFormat)
          clearDownload()
        }}>
          {exportFormats.map(option => <option key={option} value={option}>{labels[option]}</option>)}
        </select></label>
        {hasSuspectPointsInRange && <label className="export-checkbox">
          <input type="checkbox" checked={includeSuspectPoints} onChange={event => {
            setIncludeSuspectPoints(event.target.checked)
            clearDownload()
          }} />{labels.includeSuspect}
        </label>}
      </fieldset>
      <p className="merge-privacy"><Icon name="shield" />{labels.privacy}</p>
      {busy && <p className="merge-progress" role="status"><span className="places-spinner" />{labels.preparing}</p>}
      {error && <p className="merge-error" role="alert">{labels[error]}</p>}
      {download && <p className="merge-progress" role="status">{labels.ready.replace('{count}', download.count.toLocaleString(locales[language]))}</p>}
      <div className="merge-actions">
        <button type="button" className="merge-secondary" onClick={close}>{busy ? t.cancel : mergeTranslations[language].close}</button>
        {download
          ? <a className="primary-button merge-download" href={download.url} download={download.filename}>{labels.download}</a>
          : <button type="submit" className="primary-button" disabled={busy || !from || !to}>{labels.download}</button>}
      </div>
    </form>
  </dialog>
}
