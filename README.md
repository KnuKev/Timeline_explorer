Timeline Explorer

Explore your Google Timeline history on an interactive map. Load a Timeline JSON export to view recorded locations and routes by date, country, or city, with summaries and travel statistics.

## Run locally

1. Navigate to project folder.
2. Open the integrated terminal.
3. Install dependencies and start the development server:

   ```powershell
   npm.cmd install
   npm.cmd run dev
   ```

4. Open the URL printed by Vite, usually <http://localhost:5173>.

If `npm.cmd` is not on your PATH, use `C:\Program Files\nodejs\npm.cmd` in PowerShell.

## Features

- Reads newer `timelinePath` records with `durationMinutesOffsetFromStartTime`.
- Reads older `visit.topCandidate.placeLocation` records.
- Orders recorded positions chronologically.
- Filters history by a day or date range.
- Displays recorded points and their connecting route on a Leaflet map.
- Provides country and city views with summary statistics.

Your Timeline JSON is processed in the browser and is not uploaded by the app. Map tiles are loaded from OpenStreetMap and displayed with the required attribution.

The route connects recorded points in chronological order. It represents the recorded sequence and may not match the actual roads travelled between measurements.

## Local place reference data

Country outlines come from Natural Earth via `world-atlas` (ISC-licensed). City reference points and country codes come from [GeoNames](https://www.geonames.org/) and are included locally under CC BY 4.0. Place matching runs in a browser worker; Timeline coordinates are not sent to GeoNames or a geocoding service. City matches use the nearest GeoNames reference locality with a population of at least 2,500 within 30 km. The displayed day count means distinct calendar days containing one or more matching Timeline points, not time spent there.

To regenerate the reference files, place `cities1000.txt` from GeoNames in `.cache/geonames/`, then run:

```powershell
npm.cmd run build:geodata
```
