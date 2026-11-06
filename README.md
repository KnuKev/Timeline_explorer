# Timeline Explorer

Explore your Google Timeline history on an interactive map in a desktop browser.

## Get started

1. Open [Timeline Explorer](https://knukev.github.io/Timeline_explorer/) and try the fictional example route. No installation or account is needed.
2. To explore your own history, open **Map → Choose file** and select a Google Timeline JSON export. Mobile Timeline exports and older Takeout files such as `Records.json` are supported. Unzip archived exports first.

Your file stays in browser memory and is never uploaded to GitHub. Refreshing the page clears it. OpenStreetMap receives map tile requests for the area you view.

## Run locally

Install **Node.js 24 with npm**, clone this repository or extract the ZIP, then run `npm ci` and `npm run dev` in the project folder. Open the local address printed in the terminal.

## Explore your history

- **Map** shows routes for a day or date range. Dashed lines mark flights.
- **Trips** groups domestic and international journeys with at least two nights away. The default home radius is 25 km. A recorded return home ends the trip.
- **Places** ranks countries and cities by the number of days you were recorded there.
- **Statistics** shows monthly distance, a calendar coloured by distance, movement by time of day, and your most frequent routes between cities.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0). Country outlines from Natural Earth via `world-atlas`. [Roboto font license](public/fonts/OFL.txt).
