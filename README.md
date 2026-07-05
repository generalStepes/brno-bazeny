# Bazény v Brně – dostupnost

Aggregates swim-lane / pool availability across six Brno pools into one static site, so you can check "who has free lanes right now" instead of visiting six different websites.

Venues covered: Aquapark Kohoutovice, Bazén Ponávka, Bazény Lužánky (all STAREZ), Bazén Družstevní, Krytá plavecká hala Kraví hora, and TJ Tesla Brno – Bazén 25m.

## How it works

- `scraper/` – a Node + Playwright script (`npm run scrape`) that visits each venue's site, parses its reservation grid, and writes a normalized snapshot to `docs/data/latest.json`.
- `docs/` – a static site (vanilla HTML/CSS/JS, no build step) that reads `data/latest.json` and renders a per-venue timeline for the selected day. This folder is served directly by GitHub Pages.
- `.github/workflows/scrape.yml` – runs the scraper every hour on GitHub Actions and commits the refreshed `latest.json`, which redeploys the Pages site automatically.

## Known limitations (site-imposed, not scraper bugs)

- **Kraví hora** only ever publishes *today's* schedule online — there's no way to see future days from their site, so only a single day of data is available for that venue at any time.
- **TJ Tesla Brno** doesn't publish real-time public lane occupancy anywhere. Its only dynamic system (Reenio) is a lane/pool *rental* calendar for clubs, not a public occupancy display, so Tesla's row shows standard opening hours plus any rental bookings found, not live lane counts.
- Slot colors/labels are inferred from each site's own legend (e.g. STAREZ's green/grey/light-grey scheme). Always double check on the venue's own page before relying on it for anything important — this is a best-effort aggregator, not an official source.

## Local development

```bash
npm install
npx playwright install --with-deps chromium
npm run scrape          # writes docs/data/latest.json
npx serve docs          # serve the static site locally
```
