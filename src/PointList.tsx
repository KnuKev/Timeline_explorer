import { memo, useState } from 'react'
import { locales, pointLabel, translations, type Language } from './i18n'
import { formatCalendarDate, formatPointInterval } from './formatting'
import type { TimelinePoint } from './timeline'
import './PointList.css'

export type PointGroup = { day: string; points: TimelinePoint[] }
type PointListProps = {
  groups: PointGroup[]
  selectedPointId: string | null
  onSelect: (id: string) => void
  language: Language
  expanded?: boolean
}

const DAYS_PER_PAGE = 30
const POINTS_PER_PAGE = 80
const labels = {
  nb: { previous: 'Forrige', next: 'Neste', dayPages: 'Bla mellom dager', pointPages: 'Bla mellom punkter', days: 'dager', points: 'punkter', of: 'av' },
  en: { previous: 'Previous', next: 'Next', dayPages: 'Browse days', pointPages: 'Browse points', days: 'days', points: 'points', of: 'of' },
}

type Navigation = { scope: string; dayPage: number; openDay: string | null; pointPage: number }

function Chevron({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>
}

const PointRow = memo(function PointRow({ point, ordinal, selected, language, onSelect }: {
  point: TimelinePoint
  ordinal: number
  selected: boolean
  language: Language
  onSelect: (id: string) => void
}) {
  const interval = formatPointInterval(point, locales[language])
  return (
    <button type="button" className={'point-row' + (selected ? ' active' : '')} aria-pressed={selected} onClick={() => onSelect(point.id)}>
      <span className={'point-symbol ' + (point.kind === 'visit' ? 'visit' : '')} aria-hidden="true">{point.kind === 'visit' ? <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8c0 4-6 9-6 9S4 12 4 8a6 6 0 1 1 12 0Z" /><circle cx="10" cy="8" r="2" /></svg> : ordinal}</span>
      <span className="point-copy"><strong>{pointLabel(point, language)}</strong><small className="point-interval" title={interval}>{interval}</small><small className="point-coordinates">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</small></span>
      <Chevron className="point-arrow" />
    </button>
  )
})

/** Only one day's rows and at most 30 day headings are mounted at a time. */
function PointList({ groups, selectedPointId, onSelect, language, expanded = true }: PointListProps) {
  const t = translations[language]
  const copy = labels[language]
  const locale = locales[language]
  const scope = `${groups.length}:${groups[0]?.day ?? ''}:${groups[groups.length - 1]?.day ?? ''}`
  const [navigation, setNavigation] = useState<Navigation>({ scope: '', dayPage: 0, openDay: null, pointPage: 0 })
  const current = navigation.scope === scope ? navigation : { scope, dayPage: 0, openDay: groups.length === 1 ? groups[0]!.day : null, pointPage: 0 }
  const page = Math.min(current.dayPage, Math.max(0, Math.ceil(groups.length / DAYS_PER_PAGE) - 1))
  const dayStart = page * DAYS_PER_PAGE
  const dayEnd = Math.min(dayStart + DAYS_PER_PAGE, groups.length)
  const range = (start: number, end: number, count: number, noun: string) => `${(start + 1).toLocaleString(locale)}–${end.toLocaleString(locale)} ${copy.of} ${count.toLocaleString(locale)} ${noun}`

  return (
    <div className="point-list" id="point-list" hidden={!expanded}>
      {expanded && groups.length > DAYS_PER_PAGE && <nav className="point-list-pagination" aria-label={copy.dayPages}>
        <button type="button" disabled={page === 0} onClick={() => setNavigation({ ...current, dayPage: page - 1, openDay: null, pointPage: 0 })}>{copy.previous}</button>
        <span>{range(dayStart, dayEnd, groups.length, copy.days)}</span>
        <button type="button" disabled={dayEnd === groups.length} onClick={() => setNavigation({ ...current, dayPage: page + 1, openDay: null, pointPage: 0 })}>{copy.next}</button>
      </nav>}
      {expanded && groups.slice(dayStart, dayEnd).map(group => {
        const isOpen = current.openDay === group.day
        const pointPage = Math.min(current.pointPage, Math.max(0, Math.ceil(group.points.length / POINTS_PER_PAGE) - 1))
        const pointStart = pointPage * POINTS_PER_PAGE
        const pointEnd = Math.min(pointStart + POINTS_PER_PAGE, group.points.length)
        return (
          <details className="point-day-group" key={group.day} open={isOpen}>
            <summary onClick={event => {
              event.preventDefault()
              setNavigation({ ...current, openDay: isOpen ? null : group.day, pointPage: 0 })
            }}>
              <strong>{formatCalendarDate(group.day, locale)}</strong>
              <span className="count-badge">{group.points.length.toLocaleString(locale)}</span>
              <Chevron className="point-day-chevron" />
            </summary>
            {isOpen && <div className="point-day-rows">
              {group.points.slice(pointStart, pointEnd).map((point, index) => (
                <PointRow key={point.id} point={point} ordinal={pointStart + index + 1} selected={point.id === selectedPointId} language={language} onSelect={onSelect} />
              ))}
              {group.points.length > POINTS_PER_PAGE && <nav className="point-list-pagination" aria-label={copy.pointPages}>
                <button type="button" disabled={pointPage === 0} onClick={() => setNavigation({ ...current, pointPage: pointPage - 1 })}>{copy.previous}</button>
                <span>{range(pointStart, pointEnd, group.points.length, copy.points)}</span>
                <button type="button" disabled={pointEnd === group.points.length} onClick={() => setNavigation({ ...current, pointPage: pointPage + 1 })}>{copy.next}</button>
              </nav>}
            </div>}
          </details>
        )
      })}
      {expanded && groups.length === 0 && <div className="empty-list"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg><strong>{t.noPoints}</strong><small>{t.chooseDatePlace}</small></div>}
    </div>
  )
}

export default memo(PointList)
