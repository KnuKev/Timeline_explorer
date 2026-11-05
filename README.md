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

## Development

Use `npm test`, `npm run lint`, and `npm run build` to check changes.

## Publish to GitHub Pages

1. In the repository's [Settings → Pages](https://github.com/KnuKev/Timeline_explorer/settings/pages), under **Build and deployment → Source**, select **GitHub Actions**.
2. Push the reviewed changes, including [the deployment workflow](.github/workflows/pages.yml), to `main`.
3. Under **Actions → Deploy to GitHub Pages**, wait for the **deploy** job to finish. Open the site link in the deployment summary.

Each subsequent push to `main` runs the checks and publishes only the built site (`dist/`). To redeploy the same commit, select **Run workflow** on `main`.

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Place names from [GeoNames](https://www.geonames.org/) (CC BY 4.0). Country outlines from Natural Earth via `world-atlas`. [Roboto font license](public/fonts/OFL.txt).
