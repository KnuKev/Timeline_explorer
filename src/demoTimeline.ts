import demoTimeline from './data/fictional-timeline.json' with { type: 'json' }

// Invented journeys, recorded in the same semantic-segment format as a mobile
// Timeline export. Use the normal importer so the example exercises real logic.
export { demoTimeline }
export const demoHistoryStartDate = '2025-03-30'
// Keep the opening map focused on the journey; the home-history month remains
// available through the date picker and the normal statistics/trip analysis.
export const demoStartDate = '2025-04-29'
export const demoEndDate = '2025-05-03'
