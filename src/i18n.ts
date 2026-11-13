export type Language = 'nb' | 'en'

export const languageStorageKey = 'timeline-explorer-language'

export function getStoredLanguage(): Language {
  try {
    return localStorage.getItem(languageStorageKey) === 'nb' ? 'nb' : 'en'
  } catch {
    return 'en'
  }
}

const nb = {
  history: 'DIN HISTORIKK', explore: 'Utforsk steder', myTimeline: 'Min tidslinje', navigation: 'Hovedmeny',
  expandMapPanel: 'Åpne kartinformasjon', collapseMapPanel: 'Minimer kartinformasjon',
  map: 'Kart', trips: 'Reiser', places: 'Steder', statistics: 'Statistikk', comingSoon: 'Kommer senere',
  localFile: 'Lokal fil', language: 'Språk', lightTheme: 'Bytt til lyst tema', darkTheme: 'Bytt til mørkt tema',
  settings: 'Innstillinger', mapBackground: 'Kartbakgrunn', satellite: 'Satellitt', exportTimeline: 'Eksporter tidslinjen',
  distanceUnits: 'Måleenheter', metric: 'Metrisk (km og m)', imperial: 'Imperial (mi og ft)', allTime: 'Hele historikken',
  noPlacesForYear: 'Ingen steder registrert i dette året.',
  placesIntro: 'Land og byer sortert etter antall registrerte dager.',
  countriesRegistered: 'land registrert', citiesRegistered: 'byer registrert', placeType: 'Velg stedstype',
  countries: 'Land', country: 'Land', cities: 'Byer', days: 'dager', recentDates: 'Siste datoer', date: 'Dato',
  locationPoints: 'posisjonspunkter', analysing: 'Analyserer registreringene dine lokalt …',
  noPlaces: 'Ingen steder å vise ennå', importForPlaces: 'Importer Timeline-filen din fra Kart-fanen for å analysere flere steder.',
  goToMap: 'Gå til kartet', fewerPlaces: 'Steder med færre enn 10 punkter', fewerCountries: 'Land med færre enn 10 punkter',
  fewerPlacesHint: 'Disse stedene kan være korte overflygninger eller unøyaktige GPS-treff.',
  citySuggestions: 'Byforslag fra', geodataDetails: 'GeoNames-steder fra 2 500 innbyggere + Stabekk · nærmeste sted innen {distance}. All posisjonsanalyse skjer lokalt.',
  importTimeline: 'Importer Timeline', sampleHint: 'Fiktiv rundtur fra London', downloadSample: 'Last ned eksempelfilen', fileLoaded: 'JSON-filen er lastet inn',
  chooseFile: 'Velg fil', changeFile: 'Bytt fil', time: 'Tidspunkt', lastDay: 'Siste dag', selectPeriod: 'Velg tidsrom',
  reportPeriod: 'Periode', oneDay: 'En dag', period: 'Periode', previousDay: 'Forrige dag', nextDay: 'Neste dag', recordedDays: 'dager med registreringer',
  from: 'Fra', to: 'Til', pointsInCountry: 'punkter i landet', pointsInCity: 'punkter i byen', pointsInPeriod: 'punkter i valgt periode',
  summary: 'Oppsummering', wholeHistory: 'HELE HISTORIKKEN', selectedDay: 'VALGT DAG', selectedPeriod: 'VALGT PERIODE',
  selectedTrip: 'VALGT REISE', tripPoints: 'Punkter på reisen', backToTrips: 'Tilbake til reiser', showDateRange: 'Vis hele datoperioden',
  roadTrip: 'Biltur', multiStopTrip: 'Flere reisemål',
  points: 'punkter', estimatedRoute: 'estimert rute', pointsAt: 'Punkter i', dayPoints: 'Punkter denne dagen', periodPoints: 'Punkter i perioden',
  showing: 'Viser 80 av', dayPointsSuffix: 'punkter denne dagen.', noPoints: 'Ingen punkter i dette utvalget',
  chooseDatePlace: 'Velg en dato eller et sted med registreringer.', hidePoints: 'Skjul punkter', showPoints: 'Vis punkter',
  localHistory: 'Historikken leses lokalt', mapTiles: 'Kartfliser lastes fra OpenStreetMap.', mapLabel: 'Kart med posisjonshistorikk',
  startPoint: 'Startpunkt', endPoint: 'Sluttpunkt', exampleView: 'EKSEMPELVISNING', timeline: 'TIDSLINJE',
  showCalendar: 'Vis kalender', showAgain: 'Vis stedet igjen', exampleData: 'Eksempeldata', route: 'Rute', positionPoint: 'Posisjonspunkt',
  flightRoute: 'Flyreise', flightRouteHint: 'Flyreiser vises stiplet. Transporttypen hentes fra filen eller gjenkjennes ut fra avstand og hastighet.',
  zoomHint: 'Zoom inn for å se posisjonspunkter', zoomIn: 'Zoom inn', zoomOut: 'Zoom ut', closeDetails: 'Lukk punktdetaljer', selectedPoint: 'VALGT PUNKT',
  routePoint: 'Rutepunkt', visitedPlace: 'Besøkt sted', home: 'Hjem', work: 'Arbeid', searchedAddress: 'Søkt adresse',
  unknownCountry: 'Ukjent land',
  locationQuality: 'Posisjonskvalitet', suspectPoints: 'mistenkelige posisjonspunkter',
  dismissQualityNotice: 'Lukk meldingen', showLocationQuality: 'Vis posisjonskontroll',
  fitSelection: 'Tilpass kartet til utvalget',
  reading: 'Leser filen …', parsing: 'Leser posisjonene …', indexing: 'Klargjør historikken …', cancel: 'Avbryt', retry: 'Prøv igjen',
  importFailed: 'Importen kunne ikke fullføres. Prøv igjen. Den forrige historikken er fortsatt tilgjengelig.',
  suspectPointsHidden: 'Skjult fra kart og statistikk.', suspectPointsIncluded: 'Vises nå i kart og statistikk.',
  showSuspectPoints: 'Vis mistenkelige punkter', suspectPointLabel: 'Mistenkelig posisjonshopp',
  suspectPointsExplanation: 'Urealistiske hopp langt bort og raskt tilbake. Originalfilen endres ikke.',
  placesLoadError: 'Stedsdataene kunne ikke lastes. Prøv å laste siden på nytt.',
  placesAnalysisError: 'Punktene kunne ikke sorteres geografisk. Prøv å laste Timeline-filen på nytt.',
  noCoordinatesError: 'Fant ingen gjenkjennelige koordinater. Kontroller at dette er en Google Timeline JSON-fil.',
  invalidJsonError: 'Filen kunne ikke leses som gyldig JSON.',
  crashTitle: 'Visningen krasjet', crashBody: 'Appen klarte ikke å vise dette datasettet. Last siden på nytt og prøv igjen.', reload: 'Last inn siden på nytt',
}

const en: Record<keyof typeof nb, string> = {
  history: 'YOUR HISTORY', explore: 'Explore places', myTimeline: 'My timeline', navigation: 'Main navigation',
  expandMapPanel: 'Open map information', collapseMapPanel: 'Minimize map information',
  map: 'Map', trips: 'Trips', places: 'Places', statistics: 'Statistics', comingSoon: 'Coming soon',
  localFile: 'Local file', language: 'Language', lightTheme: 'Switch to light theme', darkTheme: 'Switch to dark theme',
  settings: 'Settings', mapBackground: 'Map background', satellite: 'Satellite', exportTimeline: 'Export timeline',
  distanceUnits: 'Measurement units', metric: 'Metric (km and m)', imperial: 'Imperial (mi and ft)', allTime: 'All time',
  noPlacesForYear: 'No places recorded in this year.',
  placesIntro: 'Countries and cities ranked by days recorded.',
  countriesRegistered: 'countries recorded', citiesRegistered: 'cities recorded', placeType: 'Choose place type',
  countries: 'Countries', country: 'Country', cities: 'Cities', days: 'days', recentDates: 'Latest dates', date: 'Date',
  locationPoints: 'location points', analysing: 'Analysing your records locally …',
  noPlaces: 'No places to show yet', importForPlaces: 'Import your Timeline file from the Map tab to analyse more places.',
  goToMap: 'Go to map', fewerPlaces: 'Places with fewer than 10 points', fewerCountries: 'Countries with fewer than 10 points',
  fewerPlacesHint: 'These places may represent brief flyovers or inaccurate GPS readings.',
  citySuggestions: 'City suggestions from', geodataDetails: 'GeoNames places with at least 2,500 residents + Stabekk · nearest place within {distance}. All location analysis runs locally.',
  importTimeline: 'Import Timeline', sampleHint: 'Fictional round trip from London', downloadSample: 'Download sample JSON', fileLoaded: 'JSON file loaded',
  chooseFile: 'Choose file', changeFile: 'Change file', time: 'Date', lastDay: 'Latest day', selectPeriod: 'Choose date range',
  reportPeriod: 'Period', oneDay: 'One day', period: 'Date range', previousDay: 'Previous day', nextDay: 'Next day', recordedDays: 'days with records',
  from: 'From', to: 'To', pointsInCountry: 'points in the country', pointsInCity: 'points in the city', pointsInPeriod: 'points in the selected range',
  summary: 'Summary', wholeHistory: 'ENTIRE HISTORY', selectedDay: 'SELECTED DAY', selectedPeriod: 'SELECTED RANGE',
  selectedTrip: 'SELECTED TRIP', tripPoints: 'Points on this trip', backToTrips: 'Back to trips', showDateRange: 'Show entire date range',
  roadTrip: 'Road trip', multiStopTrip: 'Multi-stop',
  points: 'points', estimatedRoute: 'estimated route', pointsAt: 'Points in', dayPoints: 'Points on this day', periodPoints: 'Points in this range',
  showing: 'Showing 80 of', dayPointsSuffix: 'points on this day.', noPoints: 'No points in this selection',
  chooseDatePlace: 'Choose a date or place with records.', hidePoints: 'Hide points', showPoints: 'Show points',
  localHistory: 'Your history is read locally', mapTiles: 'Map tiles are loaded from OpenStreetMap.', mapLabel: 'Map of location history',
  startPoint: 'Start point', endPoint: 'End point', exampleView: 'SAMPLE VIEW', timeline: 'TIMELINE',
  showCalendar: 'Show calendar', showAgain: 'Show this place again', exampleData: 'Sample data', route: 'Route', positionPoint: 'Location point',
  flightRoute: 'Flight', flightRouteHint: 'Flights are dashed. Transport type comes from the file or is inferred from distance and speed.',
  zoomHint: 'Zoom in to see location points', zoomIn: 'Zoom in', zoomOut: 'Zoom out', closeDetails: 'Close point details', selectedPoint: 'SELECTED POINT',
  routePoint: 'Route point', visitedPlace: 'Visited place', home: 'Home', work: 'Work', searchedAddress: 'Searched address',
  unknownCountry: 'Unknown country',
  locationQuality: 'Location quality', suspectPoints: 'suspected location errors',
  dismissQualityNotice: 'Dismiss message', showLocationQuality: 'Show location quality',
  fitSelection: 'Fit map to selection',
  reading: 'Reading file …', parsing: 'Reading locations …', indexing: 'Preparing history …', cancel: 'Cancel', retry: 'Try again',
  importFailed: 'The import could not be completed. Try again. Your previous history is still available.',
  suspectPointsHidden: 'Hidden from the map and statistics.', suspectPointsIncluded: 'Currently included in the map and statistics.',
  showSuspectPoints: 'Show suspected points', suspectPointLabel: 'Suspected location jump',
  suspectPointsExplanation: 'Implausible jumps far away and quickly back. Your original file is unchanged.',
  placesLoadError: 'Place reference data could not be loaded. Try reloading the page.',
  placesAnalysisError: 'The locations could not be analysed. Try importing the Timeline file again.',
  noCoordinatesError: 'No recognised coordinates found. Check that this is a Google Timeline JSON file.',
  invalidJsonError: 'The file could not be read as valid JSON.',
  crashTitle: 'The view crashed', crashBody: 'The app could not display this dataset. Reload the page and try again.', reload: 'Reload page',
}

export const translations = { nb, en }
export type TranslationKey = keyof typeof nb
export const locales: Record<Language, string> = { nb: 'nb-NO', en: 'en-GB' }

export function pointLabel(point: { kind: 'path' | 'visit'; label: string }, language: Language): string {
  const t = translations[language]
  if (point.kind === 'path') return t.routePoint
  switch (point.label.toUpperCase().replaceAll('_', '')) {
    case 'HOME': return t.home
    case 'WORK': return t.work
    case 'SEARCHEDADDRESS': return t.searchedAddress
    case 'UNKNOWN': case 'BESØKT STED': case 'VISITED PLACE': return t.visitedPlace
    default: return point.label
  }
}
