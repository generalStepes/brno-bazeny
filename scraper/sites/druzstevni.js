import * as cheerio from 'cheerio';
import { statusFromDruzstevniLabel } from '../lib/status.js';
import { nextNDates } from '../lib/dates.js';

const BASE_URL = 'https://www.druzstevni.cz/rozvrh-hodin-bazeny/';
const DAYS_AHEAD = 7;

export async function scrapeDruzstevni(browser) {
  const page = await browser.newPage();
  const days = [];
  try {
    for (const date of nextNDates(DAYS_AHEAD)) {
      const url = `${BASE_URL}?room=0&date=${date}#pool-timetable`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('.mobile .timeblock.mobile', { timeout: 15000 }).catch(() => {});
      const html = await page.content();
      const $ = cheerio.load(html);

      const resourceSlots = new Map(); // laneName -> slots[]
      let currentRange = null; // { start, end }
      $('.row.d-block.d-xl-none.mobile .col-12')
        .children()
        .each((_, el) => {
          const $el = $(el);
          if ($el.is('h3')) {
            const m = $el.text().match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
            currentRange = m ? { start: m[1], end: m[2] } : null;
            return;
          }
          if (!$el.hasClass('timeblock') || !currentRange) return;
          const laneName = $el.find('.lesson-time').first().text().trim();
          const label = $el.find('.lesson-name').first().text().trim();
          if (!laneName) return;
          const status = statusFromDruzstevniLabel(label);
          if (!resourceSlots.has(laneName)) resourceSlots.set(laneName, []);
          resourceSlots.get(laneName).push({ start: currentRange.start, end: currentRange.end, status, label: label || undefined });
        });

      const resources = Array.from(resourceSlots.entries())
        .filter(([, slots]) => slots.length)
        .map(([name, slots]) => ({ name, slots }));
      if (resources.length) days.push({ date, resources });
    }

    return { venue: 'druzstevni', name: 'Bazén Družstevní', url: BASE_URL, ok: true, error: null, days };
  } catch (err) {
    return { venue: 'druzstevni', name: 'Bazén Družstevní', url: BASE_URL, ok: false, error: err.message, days };
  } finally {
    await page.close();
  }
}
