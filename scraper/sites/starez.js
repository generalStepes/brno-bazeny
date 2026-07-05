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

// The homepage (not the reservation page) shows live headcount boxes like
// <div class="box"><div class="text"><p>BAZÉNY A POSILOVNA</p><h5>11/220</h5>
// Lužánky has two separate gates (BAZÉNY, WELLNESS); Ponávka has none.
async function scrapeOccupancy(browser, homeUrl) {
  const page = await browser.newPage();
  try {
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = await page.content();
    const $ = cheerio.load(html);

    const seen = new Map(); // label -> {current, max} (page repeats the same boxes for mobile/desktop)
    $('.box').each((_, el) => {
      const $el = $(el);
      const label = $el.find('.text > p').first().text().trim();
      const value = $el.find('.text > h5').first().text().trim();
      const m = value.match(/(\d+)\s*\/\s*(\d+)/);
      if (label && m && !seen.has(label)) {
        seen.set(label, { label, current: parseInt(m[1], 10), max: parseInt(m[2], 10) });
      }
    });
    return [...seen.values()];
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

// Shared scraper for the three STAREZ-run venues, which all use the same
// reservation grid template. All days (a full week) live inside a single
// .s-reservation__body wrapper as a flat, repeating sequence of
// h3 (date heading) -> h4 (pool/resource name) -> .s-reservation-table blocks.
export async function scrapeStarezVenue(browser, { venue, name, url }) {
  const occupancy = await scrapeOccupancy(browser, new URL('/', url).toString());
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
              // The <small> text carries context that the color alone
              // doesn't, e.g. "volná šířka" / "rezervovaná šířka: KPSP 50" -
              // important because *any* lane (délka or šířka-numbered) can
              // switch into width-swim mode when something else (water polo,
              // diving practice) blocks normal length-swimming that day.
              const label = $span.find('small').text().replace(/\s+/g, ' ').trim();
              if (start && end) slots.push({ start, end, status, label: label || undefined });
            });
          const baseCategory = currentResourceName || 'Bazén';
          // A "šířka" (width)-numbered lane isn't extra capacity on a normal
          // day - it sits idle/closed while length-swimming (délka) is
          // offered as usual. But on days when length-lanes are blocked
          // (e.g. a water polo/diving event), *either* délka- or
          // šířka-numbered lanes can switch into active width-swim mode
          // (color-coded volná/rezervovaná šířka) and become real, usable
          // slots. So šířka-numbered lanes are tagged their own category and
          // only excluded from primary scoring while idle (closed) - see
          // isAuxiliaryCategory/primaryCountsAt in docs/app.js.
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

    return { venue, name, url, ok: true, error: null, days, occupancy };
  } catch (err) {
    return { venue, name, url, ok: false, error: err.message, days: [], occupancy };
  } finally {
    await page.close();
  }
}
