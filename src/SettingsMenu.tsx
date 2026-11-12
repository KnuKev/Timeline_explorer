import { useEffect, useId, useRef, useState } from 'react'
import type { DistanceUnits } from './formatting'
import { translations, type Language } from './i18n'
import { mergeTranslations } from './mergeI18n'
import Icon from './Icon'

type Props = {
  language: Language
  distanceUnits: DistanceUnits
  isDark: boolean
  onLanguageChange: (language: Language) => void
  onDistanceUnitsChange: (units: DistanceUnits) => void
  onToggleTheme: () => void
  onMerge: () => void
}

export default function SettingsMenu({ language, distanceUnits, isDark, onLanguageChange, onDistanceUnitsChange, onToggleTheme, onMerge }: Props) {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const cornerButton = useRef<HTMLButtonElement>(null)
  const controlsId = useId()
  const t = translations[language]
  const cornerLabel = open ? (isDark ? t.lightTheme : t.darkTheme) : t.settings
  const mergeLabel = mergeTranslations[language].title

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      cornerButton.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return <div className="settings-anchor">
    <div ref={panel} className="display-controls" data-open={open} role={open ? 'group' : undefined} aria-label={open ? t.settings : undefined}>
      <button ref={cornerButton} className="toolbar-button settings-corner" type="button" aria-label={cornerLabel} title={cornerLabel}
        aria-expanded={open ? undefined : false} aria-controls={open ? undefined : controlsId}
        onClick={open ? onToggleTheme : () => setOpen(true)}>
        <Icon name={open ? (isDark ? 'sun' : 'moon') : 'settings'} />
      </button>
      <div id={controlsId} className="settings-options" hidden={!open}>
        <div className="toolbar-switch settings-units" role="group" aria-label={t.distanceUnits}>
          <button type="button" aria-label={t.metric} title={t.metric} aria-pressed={distanceUnits === 'metric'} onClick={() => onDistanceUnitsChange('metric')}>km</button>
          <button type="button" aria-label={t.imperial} title={t.imperial} aria-pressed={distanceUnits === 'imperial'} onClick={() => onDistanceUnitsChange('imperial')}>mi</button>
        </div>
        <div className="toolbar-switch settings-language" role="group" aria-label={t.language}>
          <button type="button" lang="nb" aria-label="Norsk bokmål" aria-pressed={language === 'nb'} onClick={() => onLanguageChange('nb')}>NO</button>
          <button type="button" lang="en" aria-label="English" aria-pressed={language === 'en'} onClick={() => onLanguageChange('en')}>EN</button>
        </div>
        <button className="toolbar-button settings-merge" type="button" title={mergeLabel} aria-label={mergeLabel} aria-haspopup="dialog" onClick={() => {
          setOpen(false)
          cornerButton.current?.focus()
          onMerge()
        }}><Icon name="merge" /></button>
        <div className="toolbar-switch settings-map" role="group" aria-label={t.mapBackground}>
          <button type="button" aria-label={t.map} title={t.map} aria-pressed="true"><Icon name="map" /></button>
          <button type="button" aria-label={t.satellite} title={`${t.satellite} · ${t.comingSoon}`} disabled><Icon name="satellite" /></button>
        </div>
        <button className="toolbar-button settings-export" type="button" title={`${t.exportKml} · ${t.comingSoon}`} aria-label={t.exportKml} disabled><Icon name="download" /></button>
      </div>
    </div>
  </div>
}
