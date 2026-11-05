import { readFile, readdir, writeFile } from 'node:fs/promises'

const rows = (await readFile('.cache/geonames/cities1000.txt', 'utf8')).trim().split(/\r?\n/)
let cities = rows.flatMap((line) => {
  const fields = line.split('\t')
  const population = Number(fields[14])
  if (!Number.isFinite(population) || population < 2_500) return []
  return [{ name: fields[1], lat: Number(fields[4]), lng: Number(fields[5]), countryCode: fields[8] }]
})
// Stabekk is a well-known populated locality, but GeoNames only lists its railway-station feature.
cities.push({ name: 'Stabekk', lat: 59.90841, lng: 10.60781, countryCode: 'NO' })
const countryCodes = JSON.parse(await readFile('public/country-codes.json', 'utf8'))
// --trips-only preserves the existing Places reference table when adding finer
// settlement context to Trips. A normal rebuild regenerates both tables.
if (process.argv.includes('--trips-only')) cities = JSON.parse(await readFile('public/geonames-cities.json', 'utf8'))
else {
  await writeFile('public/geonames-cities.json', JSON.stringify(cities))
  console.log('Wrote ' + cities.length + ' GeoNames city/locality points and ' + Object.keys(countryCodes).length + ' country codes.')
}

// Public source data, CC BY 4.0: https://download.geonames.org/export/dump/
// Required: cities1000.txt. Optional: admin1CodesASCII.txt and any ISO-country
// export (e.g. NO.txt), extracted into .cache/geonames/. Country exports add
// populated hamlets/localities, not farms, buildings, peaks or private addresses.
// No Timeline data is read by this build script or sent to a geocoding service.
const files = await readdir('.cache/geonames')
const regions = new Map()
if (files.includes('admin1CodesASCII.txt')) {
  for (const line of (await readFile('.cache/geonames/admin1CodesASCII.txt', 'utf8')).trim().split(/\r?\n/)) {
    const fields = line.split('\t')
    regions.set(fields[0], fields[1])
  }
}
const municipalities = new Map()
const countryRows = []
for (const file of files.filter(file => /^[A-Z]{2}\.txt$/.test(file)).sort()) {
  const records = (await readFile(`.cache/geonames/${file}`, 'utf8')).trim().split(/\r?\n/).map(line => line.split('\t'))
  for (const fields of records) if (fields[6] === 'A' && fields[7] === 'ADM2') municipalities.set(`${fields[8]}.${fields[10]}.${fields[11]}`, fields[1])
  for (const fields of records) if (fields[6] === 'P' && !['PPLH', 'PPLCH', 'PPLQ', 'PPLW'].includes(fields[7])) countryRows.push(fields)
}
const identity = locality => JSON.stringify([locality.countryCode, locality.name, locality.lat, locality.lng])
const present = new Set(cities.map(identity))
const localities = new Map()
for (const fields of [...rows.map(line => line.split('\t')), ...countryRows]) {
  const id = Number(fields[0])
  const lat = Number(fields[4])
  const lng = Number(fields[5])
  const countryCode = fields[8]
  if (!Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !/^[A-Z]{2}$/.test(countryCode) || !fields[1]) continue
  const locality = { id, name: fields[1], lat, lng, countryCode }
  if (present.has(identity(locality))) continue
  const region = regions.get(`${countryCode}.${fields[10]}`)
  const municipality = municipalities.get(`${countryCode}.${fields[10]}.${fields[11]}`)
  const context = [...new Set([municipality, region].filter(Boolean))].join(', ')
  if (context) locality.region = context
  localities.set(id, locality)
}
const supplemental = [...localities.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.id - b.id)
await writeFile('public/trip-localities.json', JSON.stringify(supplemental))
console.log('Wrote ' + supplemental.length + ' supplemental trip localities; merge with the existing city table at runtime.')
