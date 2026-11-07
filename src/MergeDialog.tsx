import { useEffect, useId, useRef, useState } from 'react'
import type { Language } from './i18n'
import { locales } from './i18n'
import { mergeTranslations } from './mergeI18n'
import { useTimelineMerge } from './useTimelineMerge'
import Icon from './Icon'
import './MergeDialog.css'

type Props = { language: Language; onClose: () => void }

function formatFileSize(bytes: number, locale: string) {
  const megabytes = bytes >= 1_000_000
  const size = bytes / (megabytes ? 1_000_000 : 1_000)
  return new Intl.NumberFormat(locale, {
    style: 'unit', unit: megabytes ? 'megabyte' : 'kilobyte', maximumFractionDigits: 1,
  }).format(size)
}

export default function MergeDialog({ language, onClose }: Props) {
  const t = mergeTranslations[language]
  const locale = locales[language]
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [files, setFiles] = useState<[File | null, File | null]>([null, null])
  const { stage, result, error, merge, reset } = useTimelineMerge()

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  function selectFile(index: number, file: File | undefined) {
    if (!file) return
    reset()
    setFiles(current => index === 0 ? [file, current[1]] : [current[0], file])
  }

  function closeDialog() {
    dialogRef.current?.close()
    onClose()
  }

  return (
    <dialog ref={dialogRef} className="merge-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); closeDialog() }}>
      <div className="merge-dialog-heading">
        <h2 id={titleId}>{t.title}</h2>
        <button type="button" className="merge-close" aria-label={t.close} onClick={closeDialog}><Icon name="close" /></button>
      </div>
      <p id={descriptionId} className="merge-description">{t.description}</p>
      <form onSubmit={event => {
        event.preventDefault()
        if (files[0] && files[1] && !stage) merge([files[0], files[1]])
      }}>
        <div className="merge-files">
          {files.map((file, index) => (
            <label key={index} className="merge-file">
              <span className="merge-file-label">{index === 0 ? t.firstFile : t.secondFile}</span>
              <span className="merge-file-value"><Icon name="upload" /><span title={file?.name}>{file?.name || t.chooseFile}</span></span>
              {file && <small>{formatFileSize(file.size, locale)}</small>}
              <input type="file" accept=".json,application/json" aria-label={index === 0 ? t.firstFile : t.secondFile}
                onChange={event => { selectFile(index, event.target.files?.[0]); event.target.value = '' }} />
            </label>
          ))}
        </div>
        <p className="merge-privacy"><Icon name="shield" />{t.privacy}</p>
        {stage && <p className="merge-progress" role="status"><span className="places-spinner" />{t[stage]}</p>}
        {error && <p className="merge-error" role="alert">
          {error.fileIndex !== undefined && <strong>{files[error.fileIndex]?.name} — </strong>}{t[error.code]}
        </p>}
        {result && <section className="merge-result" aria-live="polite">
          <h3>{t.ready}</h3>
          <div className="merge-result-counts">
            <p><strong>{result.summary.outputRecords.toLocaleString(locale)}</strong><span>{t.records}</span></p>
            <p><strong>{result.summary.duplicatesRemoved.toLocaleString(locale)}</strong><span>{t.duplicates}</span></p>
          </div>
          {result.summary.conflicts > 0 && <p className="merge-conflicts">{t.conflicts}</p>}
          <p className="merge-open-hint">{t.openHint}</p>
        </section>}
        <div className="merge-actions">
          <button className="merge-secondary" type="button" onClick={stage ? reset : closeDialog}>{stage ? t.cancel : t.close}</button>
          {result
            ? <a className="primary-button merge-download" href={result.url} download={result.filename}>{t.download}</a>
            : <button className="primary-button" type="submit" disabled={!files[0] || !files[1] || stage !== null}>{t.combine}</button>}
        </div>
      </form>
    </dialog>
  )
}
