# Timeline Explorer

Explore your Google Timeline history in a desktop browser. Your Timeline file stays in browser memory. OpenStreetMap receives tile requests for the area you view.

## Get started

Install **Node.js 24 with npm**, then clone this repository or download and extract the ZIP. In the project folder, run:

```sh
npm ci
npm run dev
```

Open the local address printed in the terminal. On Windows, use `npm.cmd` if PowerShell blocks `npm`.

In **Map**, click **Choose file** and select one Google Timeline JSON export. Both mobile Timeline exports and older Takeout files such as `Records.json` are supported. Unzip archived exports first. After a page refresh, choose your file again.

## Explore your history

- **Map** shows routes for a day or date range. Dashed lines mark flights.
- **Trips** groups domestic and international journeys with at least two nights away. The default home radius is 25 km. A recorded return home ends the trip.
- **Places** ranks countries and cities by the number of days you were recorded there.
- **Statistics** shows monthly distance, a calendar coloured by distance, movement by time of day, and your most frequent routes between cities.

## Development

Use `npm test`, `npm run lint`, and `npm run build` to check changes.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0). Country outlines from Natural Earth via `world-atlas`. [Roboto font license](public/fonts/OFL.txt).
