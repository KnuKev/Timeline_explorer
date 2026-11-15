import { useEffect, useId, useRef, useState } from 'react'
import type { DistanceUnits } from './formatting'
import { translations, type Language } from './i18n'
import type { MapView } from './mapAppearance'
import { mergeTranslations } from './mergeI18n'
import Icon from './Icon'

type Props = {
  language: Language
  distanceUnits: DistanceUnits
  isDark: boolean
  mapView: MapView
  globeDisabled: boolean
  onMapViewChange: (background: MapView) => void
  onLanguageChange: (language: Language) => void
  onDistanceUnitsChange: (units: DistanceUnits) => void
  onToggleTheme: () => void
  onMerge: () => void
  onExport: () => void
}

export default function SettingsMenu({ language, distanceUnits, isDark, mapView, globeDisabled, onMapViewChange, onLanguageChange, onDistanceUnitsChange, onToggleTheme, onMerge, onExport }: Props) {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const cornerButton = useRef<HTMLButtonElement>(null)
  const controlsId = useId()
  const t = translations[language]
  const cornerLabel = open ? (isDark ? t.lightTheme : t.darkTheme) : t.settings
  const mergeLabel = mergeTranslations[language].title

  useEffect(() => {
    if (!open) return
    const closeFromOutside = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      cornerButton.current?.focus()
    }
    document.addEventListener('pointerdown', closeFromOutside, true)
    document.addEventListener('focusin', closeFromOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true)
      document.removeEventListener('focusin', closeFromOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function openDialog(action: () => void) {
    setOpen(false)
    cornerButton.current?.focus()
    action()
  }

  return <div className="settings-anchor">
    <div ref={panel} className="display-controls" data-open={open} role={open ? 'group' : undefined} aria-label={open ? t.settings : undefined}>
      <button ref={cornerButton} className="toolbar-button settings-corner" type="button" aria-label={cornerLabel} title={cornerLabel}
        aria-expanded={open ? undefined : false} aria-controls={open ? undefined : controlsId}
        onClick={open ? onToggleTheme : () => setOpen(true)}>
        <Icon name={open ? (isDark ? 'sun' : 'moon') : 'settings'} />
      </button>
      <div id={controlsId} className="settings-options" inert={!open}>
        <div className="toolbar-switch settings-units" role="group" aria-label={t.distanceUnits}>
          <button type="button" aria-label={t.metric} title={t.metric} aria-pressed={distanceUnits === 'metric'} onClick={() => onDistanceUnitsChange('metric')}>km</button>
          <button type="button" aria-label={t.imperial} title={t.imperial} aria-pressed={distanceUnits === 'imperial'} onClick={() => onDistanceUnitsChange('imperial')}>mi</button>
        </div>
        <div className="toolbar-switch settings-language" role="group" aria-label={t.language}>
          <button type="button" lang="nb" aria-label="Norsk bokmål" aria-pressed={language === 'nb'} onClick={() => onLanguageChange('nb')}>NO</button>
          <button type="button" lang="en" aria-label="English" aria-pressed={language === 'en'} onClick={() => onLanguageChange('en')}>EN</button>
        </div>
        <button className="toolbar-button settings-merge" type="button" title={mergeLabel} aria-label={mergeLabel} aria-haspopup="dialog" onClick={() => openDialog(onMerge)}><Icon name="merge" /></button>
        <div className="toolbar-switch settings-map" role="group" aria-label={t.mapView}>
          <button type="button" aria-label={t.map} title={t.map} aria-pressed={mapView === 'map'} onClick={() => onMapViewChange('map')}><Icon name="map" /></button>
          <button type="button" aria-label={t.globe} disabled={globeDisabled} title={globeDisabled ? t.globeCityHint : t.globe} aria-pressed={mapView === 'globe'} onClick={() => onMapViewChange('globe')}><Icon name="globe" /></button>
        </div>
        <button className="toolbar-button settings-export" type="button" title={t.exportTimeline} aria-label={t.exportTimeline} aria-haspopup="dialog" onClick={() => openDialog(onExport)}><Icon name="download" /></button>
      </div>
    </div>
  </div>
}
