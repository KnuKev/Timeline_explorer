# Timeline Explorer

**Explore your Google Timeline history on a desktop map, rediscover your trips, and understand how you travel.**

Timeline Explorer turns a Google Timeline JSON export into an interactive travel history. Browse recorded locations, explore countries and cities, find trips away from home, and compare your travel over time.

Your file is processed in your browser. No Google sign-in, backend, database, or API key is required. This is an independent project, not affiliated with Google.

**Status:** actively developed, with a desktop-focused interface. A dedicated mobile experience is not implemented yet.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Importing your history](#importing-your-history)
- [Using the app](#using-the-app)
- [How the results are calculated](#how-the-results-are-calculated)
- [Privacy and storage](#privacy-and-storage)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Credits and licensing](#credits-and-licensing)

## Features

| View | What you can explore |
| --- | --- |
| **Map** | Recorded routes and locations, single days or date ranges, individual point details, and dashed flight segments. |
| **Trips** | Domestic and international journeys, your five most visited destinations, recent trips, nights away, and country/city filters. |
| **Places** | Countries and cities in your history, recorded days, and their locations on the map. |
| **Statistics** | Travel summaries, monthly distance, a distance-coloured year calendar, an activity clock, recurring city-to-city routes, and newly recorded places. |

Across the app:

- Light and dark themes, locally bundled Roboto fonts, and consistent map controls.
- Norwegian Bokmål and English, switchable from the top bar.
- Automatic home detection that follows moves over time.
- A configurable home area: **25 km by default**, with 10 and 50 km alternatives.
- Conservative detection of implausible GPS jumps, with an option to show flagged points again.
- Background workers, cached analyses, spatial indexing, and paginated lists for larger histories.

## Getting started

### Requirements

- **Node.js 24** and npm. Node 24 is the tested runtime and supports the test runner's module hooks.
- A modern desktop browser with Web Worker support.
- A Google Timeline JSON export to explore your own history. A small example route is shown before import.
- Internet access for dependency installation and OpenStreetMap tiles. Geographic reference data and fonts are included in the project.

### Install and run

```bash
git clone https://github.com/KnuKev/Timeline_explorer.git
cd Timeline_explorer
npm ci
npm run dev
```

Open the address printed by Vite, usually <http://localhost:5173>. Keep the terminal running while using the app; press `Ctrl+C` to stop the server.

On Windows, use `npm.cmd ci` and `npm.cmd run dev` if PowerShell prevents the `npm` script from running. No environment variables or additional services need to be configured.

### Desktop launchers

**Linux / Chromium**

After installing dependencies:

```bash
./Start-TimelineKart.sh
```

The launcher starts or reuses the development server at `http://127.0.0.1:5173` and opens a new Chromium window. It requires `node`, `curl`, `flock`, and `chromium` or `chromium-browser` on your PATH. Logs are written to `node_modules/.cache/timeline-launcher/`.

Use the script's absolute path as the target of a desktop shortcut. The shortcut itself is machine-specific and is not installed by the script. Source edits appear through Vite without a production rebuild.

**Windows**

The existing `Start-TimelineKart.ps1` launcher starts the local server and opens Firefox when available, otherwise the default browser. Run it from PowerShell after installing dependencies:

```powershell
.\Start-TimelineKart.ps1
```

### Build and preview

```bash
npm run build
npm run preview
```

The production build is written to `dist/`. Preview serves that build locally; use the address printed in the terminal. To host the app, serve the **complete contents of `dist/`** over HTTP(S), including reference JSON files and fonts. Opening `dist/index.html` directly with a `file://` URL is not supported.

The current configuration assumes the app is served at the site's root. Hosting under a subdirectory requires setting Vite's base path before building and serving the generated assets at that path.

## Importing your history

1. Export your Timeline history from the device or archive that holds it, and make the JSON file available on your computer.
2. Open **Map** and choose the file in the left sidebar.
3. Wait for reading, parsing, and indexing to complete. Import can be cancelled.
4. Select a day or date range, or open Trips, Places, or Statistics to explore the history.

The app accepts **one JSON file at a time**. Importing another file replaces the current history; it does not merge files. Extract ZIP archives first. There is no automatic Google account synchronization, folder import, or GPX/CSV import.

### Supported data

| Source | Supported records |
| --- | --- |
| Mobile Timeline exports | `timelinePath` positions, visits and top-candidate locations with timing, and activity endpoints. |
| Older semantic Takeout exports | `placeVisit` and `activitySegment` records. |
| Raw location exports, such as `Records.json` | Timestamped latitude/longitude E7 positions. |

Coordinates may use `geo:` strings, degree-marked values, or supported numeric fields. Path timestamps can be absolute or expressed as minute offsets. Recognised positions are ordered chronologically, and transport metadata is retained when present.

Google export formats vary. A valid JSON file may still contain no supported, timed coordinates; untimed candidate locations are not assigned invented dates. An unsuccessful or cancelled replacement import leaves the previously loaded history available.

## Using the app

### Map

Choose **One day** or **Date range** in the sidebar. Use the point list to inspect recorded positions and visit arrival/departure times, or click a nearby point on the map.

- **Dashed routes represent flights; solid routes represent other travel.** Dashes do not indicate uncertain data.
- Regular point markers appear from zoom level 12. Start, end, and selected markers remain visible when zoomed out.
- The fit control brings the selected route back into view. Map position and zoom are retained when switching tabs.
- The point list is paginated, with access to every recorded day and point.

When suspicious positions are detected, a notice lets you show them again. You can dismiss it and reopen it through **Show location quality**. Dismissing the notice does not change filtering, and the original file is never modified.

### Trips

Switch between **Domestic** and **International**, and optionally select a departure year.

- **Domestic:** destinations represent specific stay areas, with local settlement and region names where available. Separate cabins or accommodations are not automatically merged into one nearby city.
- **International:** trips are grouped by country. Select a country to narrow the list further by city. A journey through several countries can appear under each, but counts only once in the overview's trip and night totals.
- The five most visited destinations appear as cards above a chronological list of recent trips. Select a card to filter the list.
- Expand a trip to see recorded places along the way, or choose **View on map** to see the complete journey.
- Trips with comparable stays at several destinations are labelled **Multi-stop** or, when supported by driving evidence, **Road trip**. Any detected flight, including the outbound or return leg, prevents road-trip classification.
- Journeys with insufficient geographic information remain accessible under **Unclassified**.

Trips shows completed journeys and nights away. Distance is available in Map and Statistics. The departure-year filter keeps a journey across New Year together.

### Places

Browse countries or cities and open their recorded points on the map. Day totals measure **recorded presence on distinct local calendar days**, not complete days spent there. Passing through a place can count, and the same day can count for several places.

### Statistics

Select a year or the entire history:

| Chart | Meaning |
| --- | --- |
| **Overview** | Summary of the selected period's recorded travel. |
| **Month by month** | Estimated distance travelled each month. Select a month to open its date range on the map. |
| **Year calendar** | One square per day, coloured by distance. A recorded day with zero distance is distinguished from a day without data. Select a day to inspect it. |
| **Activity clock** | Recorded movement minutes by local hour, showing when you tend to be on the move. |
| **Top 10 routes** | Repeated transitions between cities. Both directions share one entry: Oslo–Lillestrøm and Lillestrøm–Oslo count together. |
| **New places** | Places first recorded in this file during the selected period, which may differ from your first-ever visit. |

Country and city rankings are in Places. The year calendar displays one year at a time, including leap days.

## How the results are calculated

All analyses depend on what the export actually records. Missing history, inaccurate semantic visits, and GPS drift can affect the results.

### Homes and trip boundaries

A completed trip requires a recorded departure, a recorded return, and **at least two nights outside the current home area**.

1. Home recognition looks for at least **30 distinct recorded nights within 60 days**, with additional checks for continued residence and returns to the previous home. Repeated explicit Home labels provide a fallback for sparse exports.
2. Home periods follow the history over time. A move starts a new home period instead of becoming one long holiday. The latest recognised home and supporting evidence are shown in Trips.
3. A trip starts at the first recorded point outside the selected radius and ends at the first recorded point back inside it. **Even a brief recorded return ends the trip.**
4. Nights are counted across calendar boundaries in the home's time zone: Friday to Sunday counts as two nights without requiring 48 hours. Unobserved time before the first outside point adds no nights.

The radius is a straight-line distance from the detected home, not driving distance. Its default is **25 km**, and the selected preset is remembered locally. The departure and return points inside the home area remain as map anchors; interior trip points must stay outside it.

Incomplete journeys and long unsupported gaps are excluded. Nearby observations and recorded overnight stays can support continuity across a limited gap abroad. When there is insufficient evidence to identify a home, the app explains this rather than inventing one.

Domestic/international classification is relative to the home country at departure and uses recorded stays. Flying over a foreign country alone does not create an international destination. Specific stay names are approximate area labels, not guaranteed private addresses or cabin names.

### Routes and location quality

Routes connect recorded coordinates with straight segments. Distances are **estimates**, not road-routing distances, odometer readings, or exact flight paths.

Transport classification uses Google's activity metadata and, when needed, plausible movement speeds. Short, isolated out-and-back jumps that imply impossible travel are hidden by default when surrounding observations agree. This is a conservative heuristic, not a country blacklist; ambiguous observations and plausible flights remain.

<details>
<summary>Detailed route and gap rules</summary>

- Plausible long-distance movement of at least 100 km can remain connected over recording gaps of up to 24 hours. Local gaps over six hours, excluded/missing source observations, implausible movement, and antimeridian crossings break the line.
- When intervening inferred visit/activity positions imply impossible travel, a complete selected source interval can connect plausible measured endpoints. This requires at least 100 km and no more than 24 hours. It does not bridge hidden observations or rewrite original points, visit dates, or country statistics.
- Ordinary and semantic connections use a 1,300 km/h sanity limit. Consecutive timed path/raw observations at least 100 km apart allow a conservative 1,500 km/h limit to accommodate imperfect timestamps. These checks do not determine dashed styling.
- Trip grouping normally rejects blind gaps over 36 hours. An exception can join observations up to seven days apart when they are within 100 km of each other, both at least 100 km from home, in the same foreign country, and supported by recorded overnight evidence. This does not fill gaps on the map.

</details>

### Place matching and dates

Country matching uses Natural Earth's 1:10m outlines via `world-atlas`, including Spain's Canary and Balearic islands, Ceuta, and Melilla. Islands are indexed separately. Points just outside all outlines can match a boundary within 2 km to accommodate simplified coastlines and GPS drift; this never overrides a point inside another country.

Places uses the nearest GeoNames city/locality in the same country, within 30 km, from a reference table of places with at least 2,500 inhabitants plus Stabekk. Trips additionally uses smaller settlements and regional context. Stay grouping uses bounded spatial clusters and recurring overnight GPS evidence to tolerate drift while keeping distinct destinations separate. Original coordinates remain unchanged.

Dates use the time zone at the recorded location. Visits spanning several days contribute those recorded days; an interval ending exactly at midnight does not add the following day. Missing days between separate points are not filled in.

### Statistical measures

- Route distance is assigned to the arrival point's local date, so daily, monthly, and yearly distance totals agree.
- The activity clock uses recorded surface-travel intervals of up to 30 minutes, split across local hours. Flights, long gaps, and reconstructed intervals are excluded.
- Repeated routes use visits lasting at least ten minutes. Only transitions between different matched cities count, and a pair needs at least two occurrences to enter the top ten. Long gaps, implausible movement, filtered observations, and unmatched stops interrupt a sequence. These are recorded city transitions, not guaranteed complete door-to-door journeys.

## Privacy and storage

- **Your Timeline JSON is processed in browser memory.** The app does not upload it, modify it, or send coordinates to a geocoding service.
- **Refresh or close the page, and you must import the file again.** There is no persistent history database or cloud synchronization.
- Only the selected **language, theme, and home radius** are saved in browser `localStorage`.
- Geographic reference files and fonts are served with the app. There is no Google account connection or application analytics implementation.
- **OpenStreetMap tiles are external requests.** The tile service receives normal network information, including your IP address and requested tile coordinates, which identify the area being viewed. The app is therefore not a fully offline map viewer.

Personal exports should stay outside the repository. `.gitignore` covers common export filenames and folders, but cannot recognise every possible export name.

## Development

### Stack and structure

React, TypeScript, and Vite power the interface. Leaflet/React Leaflet render the map; `tz-lookup`, `world-atlas`, TopoJSON, and bundled GeoNames data support local analysis. Oxlint and Node's built-in test runner provide checks.

```text
src/
  App.tsx                  App state, navigation, filters, and preferences
  timeline.ts              Import formats and normalized timeline points
  import.worker.ts         File parsing and preparation in the background
  timelineIndex.ts         Calendar indexing and date selection
  pointQuality.ts          Suspicious-position detection
  routes.ts                Route segmentation, transport, and distance
  TimelineMap.tsx          Map rendering and interaction
  mapSpatial.ts            Spatial point lookup
  PointList.tsx            Paginated point and visit details
  places.ts                Country and city analysis
  places.worker.ts         Shared geographic/statistical analysis and caches
  usePlaces.ts             Analysis worker lifecycle and results
  statistics.ts / Statistics.tsx
                           Statistics calculations and interface
  trips.ts / Trips.tsx     Home/trip detection and interface
  tripsView.ts             Destination grouping and trip filters
  tripSettings.ts          Home-radius preferences
  tripLocalities.ts        Local settlement lookup for trip names
  *I18n.ts / i18n.ts       English and Norwegian interface text
public/
  geonames-cities.json      Main city reference table
  trip-localities.json     Supplemental settlement references
  country-codes.json       Country code lookup
  fonts/                   Bundled Roboto fonts and license
scripts/                   Reference-data build and TypeScript test loader
tests/                     Synthetic regression fixtures and UI tests
Start-TimelineKart.sh      Linux Chromium launcher
Start-TimelineKart.ps1     Windows launcher
```

### Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the versions in `package-lock.json`. |
| `npm run dev` | Start Vite with live updates. |
| `npm run build` | Run TypeScript checks and create the production bundle. |
| `npm run preview` | Serve the production build locally. |
| `npm test` | Run the regression suite. |
| `npm run lint` | Run Oxlint. |
| `npm run build:geodata` | Rebuild city and trip-locality reference files from local source downloads. |

Before submitting a change, run:

```bash
npm test
npm run lint
npm run build
```

Tests cover import formats, local dates, country matching, GPS quality, routes, spatial lookup, statistics, trip detection, home-radius settings, and rendered interface states. They do not require a personal Timeline export. UI tests inspect rendered markup; they do not replace a visual browser check.

### Performance approach

File reading, parsing, quality checks, and calendar indexing run in a dedicated import worker. A persistent analysis worker loads geographic references on demand and caches filtered/unfiltered results. Statistics and Trips are calculated only when requested; trip results are also cached by home radius. Their interface bundles load separately.

The map uses spatial indexing for selection and visible markers, skips offscreen route segments, and simplifies drawing at the current zoom. Distance still uses the full-resolution route. Lists mount bounded pages rather than every point in the history, and formatter caches are bounded.

### Rebuilding geographic references

**This is optional.** Generated reference JSON is already included for normal use.

Download and extract source files from the [GeoNames download directory](https://download.geonames.org/export/dump/) into `.cache/geonames/`:

- Required: `cities1000.txt`.
- Optional: `admin1CodesASCII.txt` for region names.
- Optional: ISO-country exports such as `NO.txt` for additional populated localities and municipality context. The included trip table uses Norwegian locality data as well as global cities.

Then run:

```bash
npm run build:geodata
```

To update only supplemental trip localities while preserving the existing Places city table:

```bash
npm run build:geodata -- --trips-only
```

Both modes require `cities1000.txt`. The script reads the existing `public/country-codes.json`; it does not regenerate that file. Source downloads remain in the ignored `.cache/` directory. No personal Timeline data is used by the build script.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| **The file cannot be read, or no coordinates are found** | Extract ZIP archives and select a supported JSON file containing timed positions. A valid Google export may use a structure the importer does not yet recognise. |
| **My history disappeared after refreshing** | Reimport the file. Only interface preferences are persisted. |
| **No trips appear** | Trips need a detectable home, recorded departure and return, and two nights outside the selected radius. Sparse history or a larger home area can exclude journeys. |
| **A place name or day count looks wrong** | Names use approximate locality references. Day counts follow recorded local-calendar presence; they cannot recover unrecorded days. |
| **A line or point seems missing** | Zoom in to see ordinary markers, inspect the date selection, and check the location-quality notice. Route gaps may be intentional when evidence is insufficient. |
| **The map background is blank** | Check internet access and whether your browser or network blocks OpenStreetMap tile requests. |
| **The launcher cannot start** | Install dependencies first and check the required browser/tools. Port 5173 must be free or already serving Timeline Explorer; inspect the Linux launcher log for details. |
| **Tests fail on an older Node version** | Use Node.js 24, then reinstall dependencies with `npm ci`. |
| **A static deployment cannot load Places or Trips** | Serve all of `dist/`, including the JSON files, and check the hosting path. |

Trip, transport, and place classifications are estimates based on the available records. The app does not currently provide manual correction of homes/destinations, multi-file merging, or a dedicated mobile layout.

## Contributing

Bug reports and focused improvements are welcome. Include reproduction steps, browser and Node versions, the export structure involved, and the expected result. For parsing or calculation issues, use a small **synthetic or anonymized JSON sample** rather than a full personal location history.

Keep new interface text available in both English and Norwegian. Add regression coverage for changes to parsing or calculations, and check relevant light/dark interface states. Keep personal history and machine-specific paths out of committed fixtures.

## Credits and licensing

| Component | Source and license information |
| --- | --- |
| Map tiles and map data | OpenStreetMap contributors; attribution remains visible on the map. See [OpenStreetMap copyright](https://www.openstreetmap.org/copyright). |
| City and locality references | [GeoNames](https://www.geonames.org/), included under CC BY 4.0. |
| Country outlines | Natural Earth data distributed through the ISC-licensed `world-atlas` package. |
| Roboto | SIL Open Font License 1.1; see [the bundled license](public/fonts/OFL.txt) and [font provenance](public/fonts/README.txt). |

**Project license:** no repository-level license has been selected yet. Third-party data, fonts, and dependencies retain their respective licenses.
