import { readFile, writeFile } from 'node:fs/promises'

const rows = (await readFile('.cache/geonames/cities1000.txt', 'utf8')).trim().split(/\r?\n/)
const cities = rows.flatMap((line) => {
  const fields = line.split('\t')
  const population = Number(fields[14])
  if (!Number.isFinite(population) || population < 2_500) return []
  return [{ name: fields[1], lat: Number(fields[4]), lng: Number(fields[5]), countryCode: fields[8] }]
})
// Stabekk is a well-known populated locality, but GeoNames only lists its railway-station feature.
cities.push({ name: 'Stabekk', lat: 59.90841, lng: 10.60781, countryCode: 'NO' })
const countryCodes = JSON.parse(await readFile('public/country-codes.json', 'utf8'))
await writeFile('public/geonames-cities.json', JSON.stringify(cities))
console.log('Wrote ' + cities.length + ' GeoNames city/locality points and ' + Object.keys(countryCodes).length + ' country codes.')
