import * as cheerio from 'cheerio';
import { todayISO } from '../lib/dates.js';

const URL = 'https://www.kravihora-brno.cz/kryta-plavecka-hala';

// Kravihora only ever publishes *today's* rental grid - there is no date
// parameter or future schedule available on the site, only a "Týdenní rozpis"
// (weekly overview) meant for humans, and an email address for booking ahead.
// Slots here mean "free to rent a lane", not "open for public walk-in swim" -
// this venue works as a lane-rental system, not open-swim admission.
export async function scrapeKravihora(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('table.reservations-table, table thead th.equip-label', { timeout: 15000 }).catch(() => {});
    const html = await page.content();
    const $ = cheerio.load(html);

    // hour header: th[colspan] texts like "6:00", "7:00", ... in table order
    const hourLabels = $('thead th')
      .not('.equip-label')
      .map((_, th) => $(th).text().trim())
      .get();

    const resources = [];
    $('tbody tr').each((_, rowEl) => {
      const $row = $(rowEl);
      const laneName = $row.find('td.equip-label span').text().trim();
      if (!laneName) return;

      const slots = [];
      let hourIdx = 0; // index into hourLabels, advances by colspan/2 per cell
      $row.find('td').each((__, cellEl) => {
        const $cell = $(cellEl);
        if ($cell.hasClass('equip-label')) return;
        const classes = ($cell.attr('class') || '').split(/\s+/);
        const colMatch = classes.find((c) => /^col-\d{2}-\d{2}$/.test(c));
        const colspan = parseInt($cell.attr('colspan') || '1', 10);
        if (!colMatch) {
          hourIdx += colspan;
          return;
        }
        const [, hh, mm] = colMatch.match(/^col-(\d{2})-(\d{2})$/);
        const startMinutes = parseInt(hh, 10) * 60 + parseInt(mm, 10);
        const endMinutes = startMinutes + colspan * 30;
        const start = `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}`;
        const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

        const text = $cell.text().trim();
        let status;
        if (text) status = 'reserved';
        else if (classes.includes('closed')) status = 'closed';
        else if (classes.includes('reservable')) status = 'reservable';
        else status = 'unknown';

        slots.push({ start, end, status, label: text || undefined });
        hourIdx += colspan;
      });
      if (slots.length) resources.push({ name: laneName, slots });
    });

    const days = resources.length ? [{ date: todayISO(), resources, note: 'Kravihora publishes only today’s schedule; future days are not available online.' }] : [];
    return { venue: 'kravihora', name: 'Krytá plavecká hala Kraví hora', url: URL, ok: true, error: null, days };
  } catch (err) {
    return { venue: 'kravihora', name: 'Krytá plavecká hala Kraví hora', url: URL, ok: false, error: err.message, days: [] };
  } finally {
    await page.close();
  }
}
