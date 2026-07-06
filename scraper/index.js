import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scrapeStarezVenue } from './sites/starez.js';
import { scrapeDruzstevni } from './sites/druzstevni.js';
import { scrapeKravihora } from './sites/kravihora.js';
import { scrapeTesla } from './sites/tesla.js';
import { loadOccupancyHistory, updateHistoryWithResults, saveOccupancyHistory } from './lib/occupancyHistory.js';
import { applyLaneDisplayNames } from './lib/laneName.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'docs', 'data', 'latest.json');
const HISTORY_PATH = join(__dirname, '..', 'docs', 'data', 'occupancy-history.json');

const STAREZ_VENUES = [
  { venue: 'aquapark', name: 'Aquapark Kohoutovice', url: 'https://aquapark.starez.cz/vstupenky-rezervace' },
  { venue: 'ponavka', name: 'Bazén Ponávka', url: 'https://ponavka.starez.cz/vstupenky-rezervace' },
  {
    venue: 'luzanky',
    name: 'Bazény Lužánky',
    url: 'https://bazenyluzanky.starez.cz/vstupenky-rezervace',
    webcams: [
      { label: '25m bazén', url: 'https://bazenyluzanky.starez.cz/_files/kamery/mpsl_25.jpg', filename: 'luzanky-25m.jpg' },
      { label: '50m bazén', url: 'https://bazenyluzanky.starez.cz/_files/kamery/mpsl_50.jpg', filename: 'luzanky-50m.jpg' },
    ],
  },
];

async function main() {
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const cfg of STAREZ_VENUES) {
      console.log(`Scraping ${cfg.venue}...`);
      results.push(await scrapeStarezVenue(browser, cfg));
    }
    console.log('Scraping druzstevni...');
    results.push(await scrapeDruzstevni(browser));
    console.log('Scraping kravihora...');
    results.push(await scrapeKravihora(browser));
    console.log('Scraping tesla...');
    results.push(await scrapeTesla(browser));
  } finally {
    await browser.close();
  }

  // Whether a lane needs its category prefixed onto its display name
  // depends on whether *this venue* has more than one lane category to
  // disambiguate between - apply uniformly across all venues here rather
  // than duplicating that decision in each site scraper.
  for (const venue of results) {
    for (const day of venue.days) applyLaneDisplayNames(day.resources);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    venues: results,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  const history = await loadOccupancyHistory(HISTORY_PATH);
  updateHistoryWithResults(history, results);
  await saveOccupancyHistory(HISTORY_PATH, history);

  for (const r of results) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.venue}: ${r.days.length} day(s)${r.error ? ' - ' + r.error : ''}`);
  }
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Wrote ${HISTORY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
