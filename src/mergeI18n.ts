import type { Language } from './i18n'

const nb = {
  title: 'Kombiner Timeline-filer',
  description: 'Velg to JSON-filer for å lage en samlet historikk. Overlapp slås sammen, og tomme felt fylles fra filen som har data.',
  firstFile: 'Første fil',
  secondFile: 'Andre fil',
  chooseFile: 'Velg JSON-fil',
  privacy: 'Filene behandles lokalt. Resultatet lastes ned som en ny fil.',
  combine: 'Kombiner filer',
  reading: 'Leser filene …',
  merging: 'Kombinerer historikken …',
  preparing: 'Klargjør nedlastingen …',
  cancel: 'Avbryt',
  close: 'Lukk',
  download: 'Last ned JSON',
  ready: 'Den kombinerte filen er klar',
  records: 'registreringer i den nye filen',
  duplicates: 'overlapp slått sammen',
  conflicts: 'Der filene har motstridende verdier, er begge variantene beholdt.',
  openHint: 'Åpne den nedlastede filen med «Velg fil» på Kart-fanen.',
  invalidJson: 'Filen inneholder ugyldig JSON. Velg en utpakket JSON-fil.',
  readError: 'Filen kunne ikke leses. Velg den på nytt.',
  unsupportedFormat: 'Fant ingen støttet Timeline-struktur. Velg en Google Timeline-eksport.',
  mergeFailed: 'Filene kunne ikke kombineres. Prøv igjen.',
}

const en: Record<keyof typeof nb, string> = {
  title: 'Merge Timeline files',
  description: 'Choose two JSON files to create a combined history. Overlapping records are merged, and empty fields are filled from the file with data.',
  firstFile: 'First file',
  secondFile: 'Second file',
  chooseFile: 'Choose JSON file',
  privacy: 'Files are processed locally. The result downloads as a new file.',
  combine: 'Merge files',
  reading: 'Reading files …',
  merging: 'Merging history …',
  preparing: 'Preparing download …',
  cancel: 'Cancel',
  close: 'Close',
  download: 'Download JSON',
  ready: 'Your merged file is ready',
  records: 'records in the new file',
  duplicates: 'overlaps combined',
  conflicts: 'Where the files contain conflicting values, both variants have been kept.',
  openHint: 'Open the downloaded file using “Choose file” on the Map tab.',
  invalidJson: 'The file contains invalid JSON. Choose an extracted JSON file.',
  readError: 'The file could not be read. Select it again.',
  unsupportedFormat: 'No supported Timeline structure found. Choose a Google Timeline export.',
  mergeFailed: 'The files could not be merged. Please try again.',
}

export const mergeTranslations: Record<Language, typeof nb> = { nb, en }
export type MergeErrorCode = 'invalidJson' | 'readError' | 'unsupportedFormat' | 'mergeFailed'
