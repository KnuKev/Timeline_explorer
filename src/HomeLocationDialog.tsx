import { useEffect, useId, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import { locales, type Language } from './i18n'
import { mergeTranslations } from './mergeI18n'
import { isHomeStartDate, type DatedHomeLocation, type HomeLocation } from './tripSettings'
import { formatCalendarDate } from './formatting'
import Icon from './Icon'
import './MergeDialog.css'

const copy = {
  nb: {
    add: 'Legg til hjemsted', from: 'Gjelder fra', all: 'Hele historikken', remove: 'Fjern',
    duplicate: 'Det finnes allerede et hjemsted med denne startdatoen.',
    periods: 'Et hjemsted gjelder fram til neste startdato. Før første dato finner appen hjemsted automatisk.',

    select: 'Velg hjemsted', edit: 'Endre hjemsted', save: 'Lagre hjemsted',
    instructions: 'Klikk på kartet eller dra nåla dit du bor.',
    automatic: 'Bruk automatisk hjemsted',
    remember: 'Hjemstedene lagres i denne nettleseren.',
    sample: 'Hjemstedet for eksempeldata lagres separat i denne nettleseren.',
    useCenter: 'Velg midten av kartet',
  },
  en: {
    add: 'Add home location', from: 'Applies from', all: 'Entire history', remove: 'Remove',
    duplicate: 'A home location already uses this start date.',
    periods: 'Each location applies until the next start date. Earlier dates use automatic home detection.',

    select: 'Set home location', edit: 'Edit home location', save: 'Save home location',
    instructions: 'Click the map or drag the pin to your home.',
    automatic: 'Detect home automatically',
    remember: 'Your home locations are saved in this browser.',
    sample: 'The sample home location is saved separately in this browser.',
    useCenter: 'Use map centre',
  },
}

type Props = {
  language: Language
  saved: DatedHomeLocation[]
  suggested?: HomeLocation
  overview?: HomeLocation
  isDemo: boolean
  onSave: (homes: DatedHomeLocation[]) => void
  onClose: () => void
}

function HomePin({ location, onPick, useCenter }: { location: HomeLocation | null; onPick: (location: HomeLocation) => void; useCenter: string }) {
  const pick = (point: L.LatLng) => {
    const { lat, lng } = point.wrap()
    onPick({ lat: Math.max(-85.05112878, Math.min(85.05112878, lat)), lng })
  }
  const map = useMapEvents({ click: event => pick(event.latlng) })
  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])

  const icon = useMemo(() => L.divIcon({ className: 'home-location-pin', iconSize: [24, 24], iconAnchor: [12, 22] }), [])

  return <>
    {location && <Marker position={location} icon={icon} draggable keyboard={false}
      eventHandlers={{ dragend: event => pick(event.target.getLatLng()) }} />}
    <button className="merge-secondary home-location-center" type="button" onClick={event => { event.stopPropagation(); pick(map.getCenter()) }}>{useCenter}</button>
  </>
}

export default function HomeLocationDialog({ language, saved, suggested, overview, isDemo, onSave, onClose }: Props) {
  const t = copy[language]
  const titleId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<string | null>(() => saved.at(-1)?.from ?? null)
  const [location, setLocation] = useState<HomeLocation | null>(() => saved.at(-1) ?? suggested ?? null)
  const [from, setFrom] = useState(() => saved.at(-1)?.from ?? '')
  const [entireHistory, setEntireHistory] = useState(() => !saved.at(-1)?.from)
  const [mapVersion, setMapVersion] = useState(0)
  const startDate = entireHistory ? '' : from
  const duplicate = (entireHistory || isHomeStartDate(from)) && saved.some(home => home.from === startDate && home.from !== editing)
  const canSave = location && (entireHistory || isHomeStartDate(from)) && !duplicate

  function editHome(home?: DatedHomeLocation) {
    setEditing(home?.from ?? null)
    setLocation(home ?? suggested ?? null)
    setFrom(home?.from ?? '')
    setEntireHistory(home?.from === '' || (!home && saved.length === 0))
    setMapVersion(version => version + 1)
  }

  function saveHome(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave) return
    const updated = [...saved.filter(home => home.from !== editing), { lat: location.lat, lng: location.lng, from: startDate }]
    onSave(updated.sort((a, b) => a.from.localeCompare(b.from)))
  }

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  return <dialog ref={dialog} className="merge-dialog home-location-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="merge-dialog-heading">
      <h2 id={titleId}>{saved.length ? t.edit : t.select}</h2>
      <button type="button" className="merge-close" aria-label={mergeTranslations[language].close} onClick={onClose}><Icon name="close" /></button>
    </div>
    <p className="merge-description" id={descriptionId}>{t.instructions}</p>
    <MapContainer key={mapVersion} className="home-location-map" center={location ?? overview ?? [25, 0]} zoom={location ? 14 : overview ? 10 : 2} minZoom={1} maxZoom={19}
      maxBounds={[[-85.05112878, -180], [85.05112878, 180]]}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' />
      <HomePin location={location} onPick={setLocation} useCenter={t.useCenter} />
    </MapContainer>
    {saved.length > 0 && <div className="home-location-list">
      <ul>
        {saved.map(home => {
          const label = home.from ? formatCalendarDate(home.from, locales[language]) : t.all
          return <li key={home.from}>
            <button type="button" className="merge-secondary" aria-pressed={editing === home.from} onClick={() => editHome(home)}>{label}</button>
            <button type="button" className="merge-secondary" aria-label={`${t.remove} · ${label}`}
              onClick={() => onSave(saved.filter(entry => entry !== home))}>{t.remove}</button>
          </li>
        })}
      </ul>
      <button type="button" className="merge-secondary" onClick={() => editHome()}>{t.add}</button>
    </div>}
    <form onSubmit={saveHome}>
      <div className="home-location-dates">
        <label><input type="checkbox" checked={entireHistory} onChange={event => setEntireHistory(event.target.checked)} /> {t.all}</label>
        {!entireHistory && <label>{t.from} <input type="date" required value={from} onChange={event => setFrom(event.target.value)} /></label>}
      </div>
      {duplicate && <p className="merge-error" role="status">{t.duplicate}</p>}
      <p className="merge-privacy">{t.periods} {isDemo ? t.sample : t.remember}</p>
      <div className="merge-actions home-location-actions">
        {saved.length > 0 && <button type="button" className="merge-secondary" onClick={() => onSave([])}>{t.automatic}</button>}
        <button type="submit" className="primary-button" disabled={!canSave}>{t.save}</button>
      </div>
    </form>
  </dialog>
}
