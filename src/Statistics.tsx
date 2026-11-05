import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { StatisticsAnalysis, StatisticsPeriod } from './statistics'
import { locales, type Language } from './i18n'
import { formatCalendarDate, formatDistance, formatPlaceDate } from './formatting'
import { statisticsTranslations } from './statisticsI18n'
import Icon from './Icon'
import './Statistics.css'

type Props = {
  data: StatisticsAnalysis | null
  loading: boolean
  error?: string
  language: Language
  isDemo?: boolean
  onRetry: () => void
  onOpenRange: (from: string, to: string) => void
}
type Copy = typeof statisticsTranslations.nb
type PeriodProps = { period: StatisticsPeriod; language: Language; t: Copy }

function monthRange(year: number, month: number): [string, string] {
  const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
  const cursor = new Date(first + 'T12:00:00Z')
  cursor.setUTCMonth(cursor.getUTCMonth() + 1, 0)
  return [first, cursor.toISOString().slice(0, 10)]
}

function minutesLabel(minutes: number, locale: string, t: Copy): string {
  if (minutes < 60) return `${Math.round(minutes).toLocaleString(locale)} ${t.minutes}`
  const hours = Math.floor(minutes / 60)
  const remainder = Math.round(minutes % 60)
  return `${(hours + (remainder === 60 ? 1 : 0)).toLocaleString(locale)} ${t.hours}${remainder > 0 && remainder < 60 ? ` ${remainder} ${t.minutes}` : ''}`
}

function CardHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <div className="statistics-card-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{children}</div>
}

const Overview = memo(function Overview({ period, language, t }: PeriodProps) {
  const locale = locales[language]
  const label = formatDistance(period.distanceKm, locale)
  const separator = label.lastIndexOf(' ')
  return <div className="statistics-overview" aria-label={t.overview}>
    <div className="statistics-distance"><span><Icon name="route" />{t.distance}</span><strong>{separator < 0 ? label : label.slice(0, separator)} <small>{separator < 0 ? '' : label.slice(separator + 1)}</small></strong></div>
    <div className="statistics-metric"><Icon name="globe" /><strong>{period.countryCount.toLocaleString(locale)}</strong><span>{t.countries}</span></div>
    <div className="statistics-metric"><Icon name="pin" /><strong>{period.cityCount.toLocaleString(locale)}</strong><span>{t.cities}</span></div>
    <div className="statistics-metric"><Icon name="chart" /><strong>{period.recordedDays.toLocaleString(locale)}</strong><span>{t.recordedDays}</span></div>
  </div>
})

function MonthlyChart({ data, period, year, language, t, onOpenRange }: PeriodProps & { data: StatisticsAnalysis; year: number | null; onOpenRange: Props['onOpenRange'] }) {
  const [chosenMonth, setChosenMonth] = useState<number | null>(null)
  const locale = locales[language]
  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    return Array.from({ length: 12 }, (_, index) => formatter.format(new Date(Date.UTC(2024, index, 1))))
  }, [locale])
  const months = Array.from({ length: 12 }, (_, index) => period.monthly.find(entry => entry.month === index + 1) ?? { month: index + 1, distanceKm: 0, recordedDays: 0 })
  const maximum = Math.max(1, ...months.map(month => month.distanceKm))
  const axisFormat = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const valueLabel = (value: number) => formatDistance(value, locale)
  const open = (month: number) => {
    if (year !== null) onOpenRange(...monthRange(year, month))
    else setChosenMonth(current => current === month ? null : month)
  }
  return <article className="statistics-card statistics-monthly">
    <CardHeading title={t.monthly} subtitle={t.monthlyIntro}><span className="statistics-chart-unit" title={t.kilometers}>km</span></CardHeading>
    <div className="statistics-bar-chart">
      <div className="statistics-chart-axis" aria-hidden="true"><span>{axisFormat.format(maximum)}</span><span>{axisFormat.format(maximum / 2)}</span><span>0</span></div>
      <div className="statistics-month-bars">
        {months.map(month => <button type="button" key={month.month} className={'statistics-month-button' + (year === null && chosenMonth === month.month ? ' selected' : '')} disabled={month.recordedDays === 0 && month.distanceKm === 0}
          title={`${monthNames[month.month - 1]}${year === null ? '' : ` ${year}`}: ${valueLabel(month.distanceKm)}`}
          aria-label={`${monthNames[month.month - 1]}${year === null ? '' : ` ${year}`}: ${valueLabel(month.distanceKm)}. ${year === null ? t.chooseMonthYear : t.openMonth}`}
          onClick={() => open(month.month)}>
          <span className="statistics-bar-track"><span className="statistics-bar-value" style={{ height: `${month.distanceKm / maximum * 100}%` }} /></span>
          <span className="statistics-month-label">{monthNames[month.month - 1]}</span>
        </button>)}
      </div>
    </div>
    <p className="statistics-note">{year === null ? t.combinedMonths : t.openMonth}</p>
    {year === null && chosenMonth !== null && <div className="statistics-month-years">
      <div><strong>{monthNames[chosenMonth - 1]} · {t.chooseMonthYear}</strong><button type="button" className="statistics-close" aria-label={t.close} onClick={() => setChosenMonth(null)}><Icon name="close" /></button></div>
      <div className="statistics-month-year-options">{[...data.years].sort((a, b) => b - a).map(candidate => {
        const month = data.byYear[String(candidate)]?.monthly.find(entry => entry.month === chosenMonth)
        return month && (month.recordedDays > 0 || month.distanceKm > 0) ? <button key={candidate} type="button" onClick={() => onOpenRange(...monthRange(candidate, chosenMonth))}><strong>{candidate}</strong><span>{valueLabel(month.distanceKm)}</span><Icon name="arrow" /></button> : null
      })}</div>
    </div>}
  </article>
}

const MovementClock = memo(function MovementClock({ period, language, t }: PeriodProps) {
  const locale = locales[language]
  const hours = Array.from({ length: 24 }, (_, hour) => Math.max(0, period.hourlyMinutes[hour] ?? 0))
  const maximum = Math.max(0, ...hours)
  const peak = hours.indexOf(maximum)
  const total = hours.reduce((sum, value) => sum + value, 0)
  const range = (hour: number) => `${String(hour).padStart(2, '0')}–${String((hour + 1) % 24).padStart(2, '0')}`
  const position = (hour: number, radius: number) => {
    const angle = hour / 24 * Math.PI * 2 - Math.PI / 2
    return { x: 150 + Math.cos(angle) * radius, y: 150 + Math.sin(angle) * radius }
  }
  return <article className="statistics-card statistics-clock">
    <CardHeading title={t.clock} subtitle={t.clockIntro} />
    {maximum > 0 ? <>
      <svg className="statistics-clock-face" viewBox="0 0 300 300" role="img" aria-label={`${t.clock} ${t.mostActive}: ${range(peak)}. ${minutesLabel(hours[peak]!, locale, t)}, ${t.localTime.toLowerCase()}.`}>
        <circle cx="150" cy="150" r="74" className="statistics-clock-ring" />
        {hours.map((minutes, hour) => {
          const start = position(hour, 84)
          const end = position(hour, 84 + (maximum ? minutes / maximum : 0) * 40)
          return <line key={hour} x1={start.x} y1={start.y} x2={end.x} y2={end.y} className={'statistics-clock-bar' + (hour === peak ? ' peak' : '') + (minutes === 0 ? ' empty' : '')}><title>{`${range(hour)}: ${minutesLabel(minutes, locale, t)}`}</title></line>
        })}
        {[0, 6, 12, 18].map(hour => { const p = position(hour, 142); return <text key={hour} x={p.x} y={p.y} className="statistics-clock-hour" textAnchor="middle" dominantBaseline="middle">{String(hour).padStart(2, '0')}</text> })}
        <text x="150" y="132" textAnchor="middle" className="statistics-clock-kicker">{t.mostActive}</text>
        <text x="150" y="158" textAnchor="middle" className="statistics-clock-peak">{range(peak)}</text>
        <text x="150" y="180" textAnchor="middle" className="statistics-clock-total">{t.localTime}</text>
      </svg>
      <div className="statistics-clock-summary"><strong>{minutesLabel(total, locale, t)}</strong><span>{t.movement}</span></div>
      <details className="statistics-hour-details"><summary>{t.hourlyDetails}</summary><div>{hours.map((minutes, hour) => <span key={hour}><strong>{range(hour)}</strong>{minutesLabel(minutes, locale, t)}</span>)}</div></details>
    </> : <div className="statistics-empty small"><Icon name="chart" /><p>{t.clockEmpty}</p></div>}
    <p className="statistics-note">{t.clockHint}</p>
  </article>
})

function Calendar({ period, year, years, language, t, onOpenRange }: PeriodProps & { year: number | null; years: number[]; onOpenRange: Props['onOpenRange'] }) {
  const [ownYear, setOwnYear] = useState<number | null>(null)
  const calendarYear = year ?? (ownYear !== null && years.includes(ownYear) ? ownYear : Math.max(...years))
  const locale = locales[language]
  const calendar = useMemo(() => {
    const prefix = `${String(calendarYear).padStart(4, '0')}-`
    const first = `${prefix}01-01`
    const start = new Date(first + 'T12:00:00Z')
    const offset = (start.getUTCDay() + 6) % 7
    const records = new Map(period.daily.filter(day => day.date.startsWith(prefix)).map(day => [day.date, day.distanceKm]))
    const days = []
    const months = []
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    const cursor = new Date(start)
    for (let index = 0; cursor.getUTCFullYear() === calendarYear; index++, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10)
      const week = Math.floor((offset + index) / 7)
      const weekday = (offset + index) % 7
      days.push({ date, week, weekday, distance: records.get(date) })
      if (cursor.getUTCDate() === 1) months.push({ label: monthFormatter.format(cursor), week })
    }
    const longest = days.reduce<(typeof days)[number] | null>((best, day) => day.distance !== undefined && (best === null || day.distance > (best.distance ?? 0)) ? day : best, null)
    return { days, months, weeks: Math.ceil((offset + days.length) / 7), recorded: records.size, longest }
  }, [period.daily, calendarYear, locale])
  const weekdays = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2024, 0, 1 + index))))
  }, [locale])
  const level = (distance: number | undefined) => distance === undefined ? 'unknown' : distance === 0 ? '0' : distance < 1 ? '1' : distance < 10 ? '2' : distance < 50 ? '3' : distance < 200 ? '4' : '5'
  return <article className="statistics-card statistics-calendar">
    <CardHeading title={t.calendar} subtitle={t.calendarIntro}>{year === null ? <label className="statistics-select compact"><span>{t.calendarYear}</span><select aria-label={t.calendarYear} value={calendarYear} onChange={event => setOwnYear(Number(event.target.value))}>{[...years].sort((a, b) => b - a).map(value => <option key={value} value={value}>{value}</option>)}</select></label> : <span className="statistics-year-label">{year}</span>}</CardHeading>
    <div className="statistics-calendar-scroll">
      <div className="statistics-calendar-grid" style={{ '--calendar-weeks': calendar.weeks } as CSSProperties}>
        {calendar.months.map((month, index) => <span className="statistics-calendar-month" key={index} style={{ gridColumn: month.week + 2, gridRow: 1 }}>{month.label}</span>)}
        {[0, 2, 4].map(day => <span key={day} className="statistics-calendar-weekday" style={{ gridColumn: 1, gridRow: day + 2 }}>{weekdays[day]}</span>)}
        {calendar.days.map(day => {
          const label = `${formatCalendarDate(day.date, locale)} · ${day.distance === undefined ? t.noData : formatDistance(day.distance, locale)}`
          return <button type="button" key={day.date} data-date={day.date} className={`statistics-calendar-day level-${level(day.distance)}`} style={{ gridColumn: day.week + 2, gridRow: day.weekday + 2 }} disabled={day.distance === undefined} title={label} aria-label={`${label}${day.distance === undefined ? '' : `. ${t.openDay}`}`} onClick={() => onOpenRange(day.date, day.date)} />
        })}
      </div>
    </div>
    <div className="statistics-calendar-footer"><span><strong>{calendar.recorded.toLocaleString(locale)}</strong> {t.calendarRecorded}</span><div className="statistics-heat-legend" aria-label={t.distance}>{[
      ['unknown', t.noData], ['0', t.noMovement], ['1', '<1'], ['2', '1–10'], ['3', '10–50'], ['4', '50–200'], ['5', '200+ km'],
    ].map(([value, label]) => <span key={value}><i className={`level-${value}`} />{label}</span>)}</div></div>
    {calendar.longest && calendar.longest.distance! > 0 && <button type="button" className="statistics-longest" onClick={() => onOpenRange(calendar.longest!.date, calendar.longest!.date)}><span>{t.longestDay} <strong>{formatPlaceDate(calendar.longest.date, locale)}</strong></span><strong>{formatDistance(calendar.longest.distance!, locale)} <Icon name="arrow" /></strong></button>}
    <p className="statistics-note">{t.calendarHint}</p>
  </article>
}

const Patterns = memo(function Patterns({ period, language, t, onOpenRange }: PeriodProps & { onOpenRange: Props['onOpenRange'] }) {
  const locale = locales[language]
  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale])
  const visiblePatterns = period.patterns.slice(0, 10)
  const countryName = (code?: string) => code ? regionNames.of(code) ?? code : ''
  return <article className="statistics-card statistics-patterns">
    <CardHeading title={t.patterns} subtitle={t.patternsIntro} />
    <div className="statistics-pattern-list">{visiblePatterns.length ? visiblePatterns.map((pattern, index) => {
      const countries = [...new Set([countryName(pattern.from.countryCode), countryName(pattern.to.countryCode)].filter(Boolean))].join(' ↔ ')
      return <button className="statistics-pattern-row" type="button" key={pattern.key} onClick={() => onOpenRange(pattern.lastDate, pattern.lastDate)}>
        <span className="statistics-rank">{String(index + 1).padStart(2, '0')}</span><span className="statistics-pattern-copy"><strong title={`${pattern.from.name} ↔ ${pattern.to.name}${countries ? ` · ${countries}` : ''}`}>{pattern.from.name} <span className="statistics-bidirectional" aria-hidden="true">↔</span> {pattern.to.name}</strong><small>{countries && <span>{countries} · </span>}{t.lastRecorded} {formatPlaceDate(pattern.lastDate, locale)}</small></span><span className="statistics-pattern-count"><strong>{pattern.count.toLocaleString(locale)}</strong><small>{t.occurrences}</small></span>
      </button>
    }) : <div className="statistics-empty small"><Icon name="route" /><p>{t.patternEmpty}</p></div>}</div>
    <p className="statistics-note">{t.patternHint}</p>
  </article>
})

function NewPlaces({ period, language, t, onOpenRange }: PeriodProps & { onOpenRange: Props['onOpenRange'] }) {
  const [kind, setKind] = useState<'country' | 'city'>('country')
  const [navigation, setNavigation] = useState({ scope: '', page: 0 })
  const locale = locales[language]
  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale])
  const entries = period.newPlaces.filter(place => place.kind === kind)
  const scope = `${kind}:${entries.length}:${entries[0]?.date ?? ''}:${entries.at(-1)?.date ?? ''}`
  const page = navigation.scope === scope ? Math.min(navigation.page, Math.max(0, Math.ceil(entries.length / 8) - 1)) : 0
  return <article className="statistics-card statistics-new-places">
    <CardHeading title={t.newPlaces} subtitle={t.newPlacesIntro}><div className="statistics-switch" role="group" aria-label={t.newPlaces}><button type="button" aria-pressed={kind === 'country'} onClick={() => setKind('country')}>{t.countryChoice}</button><button type="button" aria-pressed={kind === 'city'} onClick={() => setKind('city')}>{t.cityChoice}</button></div></CardHeading>
    <div className="statistics-new-grid">{entries.length ? entries.slice(page * 8, page * 8 + 8).map(place => <button type="button" className="statistics-new-place" key={place.key} onClick={() => onOpenRange(place.date, place.date)}><span className="statistics-new-icon"><Icon name={kind === 'country' ? 'globe' : 'pin'} /></span><span><strong>{kind === 'country' && place.countryCode ? regionNames.of(place.countryCode) ?? place.name : place.name}</strong><small>{formatPlaceDate(place.date, locale)}</small></span><Icon name="right" /></button>) : <p className="statistics-empty-text">{t.noNewPlaces}</p>}</div>
    <div className="statistics-new-footer"><p className="statistics-note">{t.newPlacesHint}</p>{entries.length > 8 && <nav className="statistics-pagination" aria-label={t.newPlaces}><button type="button" disabled={page === 0} onClick={() => setNavigation({ scope, page: page - 1 })} aria-label={t.previous}><Icon name="left" /></button><span>{page + 1} {t.of} {Math.ceil(entries.length / 8)}</span><button type="button" disabled={(page + 1) * 8 >= entries.length} onClick={() => setNavigation({ scope, page: page + 1 })} aria-label={t.next}><Icon name="right" /></button></nav>}</div>
  </article>
}

function StatisticsContent({ data, language, isDemo, onOpenRange }: Omit<Props, 'data' | 'loading' | 'error' | 'onRetry'> & { data: StatisticsAnalysis }) {
  const t = statisticsTranslations[language]
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const year = selectedYear !== null && data.years.includes(selectedYear) ? selectedYear : null
  const period = year === null ? data.all : data.byYear[String(year)] ?? data.all
  const years = useMemo(() => [...data.years].sort((a, b) => b - a), [data.years])
  return <>
    <header className="statistics-heading"><div><span className="eyebrow">{t.eyebrow}</span><h1>{t.title}{isDemo && <span className="statistics-sample">{t.sample}</span>}</h1><p>{t.intro}</p></div><label className="statistics-select"><span>{t.range}</span><select value={year ?? 'all'} onChange={event => setSelectedYear(event.target.value === 'all' ? null : Number(event.target.value))}><option value="all">{t.all}</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</select></label></header>
    <Overview period={period} language={language} t={t} />
    <div className="statistics-layout">
      <MonthlyChart data={data} period={period} year={year} language={language} t={t} onOpenRange={onOpenRange} />
      <MovementClock period={period} language={language} t={t} />
      {years.length > 0 && <Calendar period={period} year={year} years={years} language={language} t={t} onOpenRange={onOpenRange} />}
      <Patterns period={period} language={language} t={t} onOpenRange={onOpenRange} />
      <NewPlaces period={period} language={language} t={t} onOpenRange={onOpenRange} />
    </div>
    <footer className="statistics-footnote"><Icon name="shield" /><span>{t.note}</span></footer>
  </>
}

export default function Statistics(props: Props) {
  const t = statisticsTranslations[props.language]
  return <section className="statistics-page" aria-label={t.title}>
    <div className="statistics-container">
      {props.loading ? <div className="statistics-state" role="status"><span className="places-spinner" /><h1>{t.loading}</h1><p>{t.loadingHint}</p></div>
        : props.error ? <div className="statistics-state" role="alert"><Icon name="chart" /><h1>{t.error}</h1><p>{props.error}</p><button className="primary-button" type="button" onClick={props.onRetry}>{t.retry}</button></div>
          : props.data ? <StatisticsContent {...props} data={props.data} />
            : <div className="statistics-state"><Icon name="chart" /><h1>{t.noStatistics}</h1><p>{t.noStatisticsHint}</p></div>}
    </div>
  </section>
}
