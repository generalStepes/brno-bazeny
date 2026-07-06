# Bazény v Brně – dostupnost

Aggregates swim-lane / pool availability across six Brno pools into one static site, so you can check "who has free lanes right now" instead of visiting six different websites.

Venues covered: Aquapark Kohoutovice, Bazén Ponávka, Bazény Lužánky (all STAREZ), Bazén Družstevní, Krytá plavecká hala Kraví hora, and TJ Tesla Brno – Bazén 25m.

## How it works

- `scraper/` – a Node + Playwright script (`npm run scrape`) that visits each venue's site, parses its reservation grid, and writes a normalized snapshot to `docs/data/latest.json`. It also scrapes live headcount ("X/Y people") where a venue publishes it (Aquapark, Lužánky, Kraví hora), and appends each reading to `docs/data/occupancy-history.json`, bucketed by weekday + hour (not raw timestamp) so the file stays a small, fixed size. After a few weeks of hourly runs this becomes a genuinely useful "typically X% full at this hour" figure — including for future dates a live snapshot can't say anything about. There's no official API for this kind of data (Google's "popular times" isn't exposed through any documented API either), so it's built entirely from these venues' own numbers.
- `docs/` – a static site (vanilla HTML/CSS/JS, no build step) that reads `data/latest.json` (and `data/occupancy-history.json`) and renders a per-venue timeline for the selected day. This folder is served directly by GitHub Pages.
- `.github/workflows/scrape.yml` – runs the scraper hourly (at :17, not :00 — GitHub Actions queues top-of-hour runs heavily) on GitHub Actions and commits the refreshed data files, which redeploys the Pages site automatically. GitHub's own `schedule` trigger is best-effort and prone to multi-hour delays/drops under load (confirmed - our own run history showed 5-6 hour gaps despite the hourly config), so an external cron (cron-job.org) also pings the `workflow_dispatch` API every 30 minutes as the reliable trigger; the native schedule stays on as a harmless backup.
- Lužánky also has two public webcam stills (25m/50m pool); the scraper re-downloads them each run into `docs/images/` and they're shown on today's card.

## Known limitations (site-imposed, not scraper bugs)

- **Kraví hora**'s main page only shows *today*, but its "Týdenní rozpis" sub-page paginates further out, so we pull ~2 weeks from there instead.
- **TJ Tesla Brno** doesn't publish availability as text/API at all — only as a monthly schedule image uploaded to their site. The scraper OCRs it (Playwright locates the current month's image, sharp crops each date/hour cell, tesseract.js reads the digit).
- Slot colors/labels are inferred from each site's own legend (e.g. STAREZ's green/grey/light-grey scheme). Always double check on the venue's own page before relying on it for anything important — this is a best-effort aggregator, not an official source.
- STAREZ venues' reservation grids can go stale during a long-term closure (Ponávka's did — some future days kept showing open slots during a closure running through 31 Dec 2026). The scraper also checks each venue's homepage alert banner for closure wording ("uzavřen"/"mimo provoz"/"odstávka") and forces every slot closed through the announced end date when found, regardless of what the grid itself says. Benign banners (e.g. holiday hours notices) are left alone.

## Local development

```bash
npm install
npx playwright install --with-deps chromium
npm run scrape          # writes docs/data/latest.json
npx serve docs          # serve the static site locally
```
