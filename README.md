# Timeline Explorer

A Google Maps Timeline viewer for exploring your Google Location History on an interactive map. Import Timeline or Google Takeout JSON exports, view travel statistics, and merge exports locally in your desktop browser.

[![Google Maps Timeline viewer showing some of my personal data across europe over the last 10 years](docs/images/timeline-map.png)](https://knukev.github.io/Timeline_explorer/)

<!-- To replace these screenshots, see docs/SCREENSHOTS.md. -->

## Get started

1. Open [Timeline Explorer](https://knukev.github.io/Timeline_explorer/) and try the fictional London–Paris–Amsterdam–Oslo–London journey. No installation or account is needed.
2. To explore your own history, open **Map → Choose file** and select a Google Timeline JSON export. Mobile Timeline exports and older Takeout files such as `Records.json` are supported. Unzip archived exports first.

Your file stays in browser memory and is never uploaded to GitHub. Refreshing the page clears it. OpenStreetMap receives map tile requests for the area you view.

## Combine Timeline files

Click the **Merge** icon to the left of the language selector, choose two Timeline JSON files, and download the combined file. The originals stay unchanged. Duplicate records are removed, missing data is filled from either file, and conflicting values are preserved. Open the downloaded JSON with **Map → Choose file**.

## Run locally

Install **Node.js 24 with npm**, clone this repository or extract the ZIP, then run `npm ci` and `npm run dev` in the project folder. Open the local address printed in the terminal.

## Explore your history

- **Map** shows routes for a day or date range. Dashed lines mark flights.
- **Trips** groups domestic and international journeys with at least two nights away. The default home radius is 25 km. A recorded return home ends the trip.
- **Places** ranks countries and cities by recorded days. Click tiles to show movement in the selected area. Places with fewer than 10 points are in a collapsible section at the bottom.
- **Statistics** shows monthly distance, a calendar coloured by distance, movement by time of day, recognised transport by distance or recorded travel time, and your most frequent routes between cities. **Under your own power** combines walking, running and cycling distance, compared with a lap around the Moon. These are estimates from recognised records; transport coverage is shown below the bars.


## Screenshots & Feature Highlights

Below are previews of the main views in Timeline Explorer:

### Interactive Map View

Filter travel history by custom date ranges, view location quality, and trace flight routes (dashed lines) alongside ground travel.
![Map view showing over 278,000 km of travel across the world in the last 10 years](docs/images/timeline-map1.png)

### Trip Detection

Automatically detects completed domestic and international trips with at least two nights away from home. Cards group journeys by country and display multi-stop itineraries.
![Trips overview showing international trips, countries and nights away](docs/images/trips.png)

### Places & Location Ranks

Rank and explore visited countries, regions, and cities sorted by total days spent. Filter or click any location tile to highlight recorded movements in that specific area.
![Places view showing visited countries and cities ranked by days spent](docs/images/places.png)

### Travel Statistics - Total Stats, Monthly Overview, Activity Calendar and Transport Stats

Visualize total recorded distance, monthly travel patterns, time-of-day activity levels, daily distance intensity across the calendar year, transport mode breakdowns with distance, human-powered travel distance compared against a lap around the Moon, and your most traveled routes.
![Statistics view showing total distance, monthly bar charts, and daily movement clock](docs/images/statistics1.png)
![Statistics breakdown with distance calendar, transport types, and human-powered distance comparison](docs/images/statistics2.png)

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0). Country outlines from Natural Earth via `world-atlas`. [Roboto font license](public/fonts/OFL.txt).
