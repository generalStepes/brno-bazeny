import * as cheerio from 'cheerio';
import { statusFromStarezColor } from '../lib/status.js';

const MONTHS = { 1: '01', 2: '02', 3: '03', 4: '04', 5: '05', 6: '06', 7: '07', 8: '08', 9: '09', 10: '10', 11: '11', 12: '12' };

// e.g. "neděle 5.7.2026" -> "2026-07-05"
function parseCzechDateHeading(text) {
  const m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${MONTHS[Number(mo)]}-${String(d).padStart(2, '0')}`;
}

// Shared scraper for the three STAREZ-run venues, which all use the same
// reservation grid template. All days (a full week) live inside a single
// .s-reservation__body wrapper as a flat, repeating sequence of
// h3 (date heading) -> h4 (pool/resource name) -> .s-reservation-table blocks.
export async function scrapeStarezVenue(browser, { venue, name, url }) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.s-reservation__body', { timeout: 15000 }).catch(() => {});
    const html = await page.content();
    const $ = cheerio.load(html);

    const dayMap = new Map(); // date -> resources[]
    let currentDate = null;
    let currentResourceName = null;

    $('.s-reservation__body')
      .find('h3, h4, .s-reservation-table')
      .each((_, el) => {
        const $el = $(el);

        if ($el.is('h3')) {
          currentDate = parseCzechDateHeading($el.text());
          return;
        }
        if ($el.is('h4')) {
          currentResourceName = $el.text().trim();
          return;
        }
        // .s-reservation-table
        if (!currentDate) return;

        const laneNames = $el
          .find('.s-reservation-table__title > div')
          .map((___, laneEl) => $(laneEl).text().replace(/\s+/g, ' ').trim())
          .get();

        const rows = $el.find('table.s-reservation-table__table').eq(1).find('tbody tr');
        const resources = dayMap.get(currentDate) || [];
        rows.each((laneIdx, rowEl) => {
          const laneName = laneNames[laneIdx] || `${currentResourceName || 'Bazén'} #${laneIdx + 1}`;
          const slots = [];
          $(rowEl)
            .find('td span[data-date]')
            .each((____, spanEl) => {
              const $span = $(spanEl);
              const style = $span.attr('style') || '';
              const colorMatch = style.match(/background-color:\s*(#[0-9a-fA-F]{6})/);
              const status = statusFromStarezColor(colorMatch ? colorMatch[1] : null);
              const timeText = $span.find('.table-time').text().trim(); // e.g. "8:00-9:00"
              const [start, end] = timeText.split('-').map((t) => t.trim());
              if (start && end) slots.push({ start, end, status });
            });
          const baseCategory = currentResourceName || 'Bazén';
          // "šířka" (width) lanes aren't extra capacity - they're a
          // substitute mode used only when length-lanes (délka) are blocked
          // (e.g. water polo), letting swimmers cross the pool's width
          // instead. They normally sit idle/closed, so counting them
          // alongside délka lanes as if they were additional lanes wrongly
          // drags down the "free" percentage. Tag them as their own
          // category so they're excluded from primary scoring like other
          // auxiliary categories, while still visible in the detail view.
          const category = /šířka/i.test(laneName) ? `${baseCategory} (šířka)` : baseCategory;
          // VIP zóna (Lužánky) isn't part of general swim availability at
          // all - it's a separately-booked private area, dropped entirely
          // rather than just excluded from scoring like the other auxiliary
          // categories (whirlpool, sauna, relaxation pool).
          if (slots.length && !/vip/i.test(category)) {
            // `category` is the pool/section as published by the venue itself
            // (e.g. "Dráhy v 50m bazénu" vs "Dráhy v 25m bazénu" at Lužánky) -
            // needed because lumping different pool sizes/types into one
            // "lanes free" number would be misleading.
            resources.push({ name: `${category} - ${laneName}`, category, slots });
          }
        });
        dayMap.set(currentDate, resources);
      });

    const days = Array.from(dayMap.entries())
      .filter(([, resources]) => resources.length)
      .map(([date, resources]) => ({ date, resources }));

    return { venue, name, url, ok: true, error: null, days };
  } catch (err) {
    return { venue, name, url, ok: false, error: err.message, days: [] };
  } finally {
    await page.close();
  }
}
