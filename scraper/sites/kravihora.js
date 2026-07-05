import * as cheerio from 'cheerio';

const MAIN_URL = 'https://www.kravihora-brno.cz/kryta-plavecka-hala';
const ROZPIS_URL = 'https://www.kravihora-brno.cz/kryta-plavecka-hala/rozpis';
const WEEKS_AHEAD = 2; // each page load returns ~7 days; follow the "next week" pager this many times

// Kravihora's main page only shows *today*, but the "Týdenní rozpis" (weekly
// schedule) sub-page renders ~7 days per load as a sequence of
// table.reservation-day-YYYYMMDD blocks, with a "next week" pager link
// (?from=YYYY-MM-DD) to keep going further out.
// A blank cell ("reservable" class, no text) means the lane is free for
// public walk-in use right now. A cell only becomes unavailable once it
// actually has a renter's name in it (a club/lesson booking).
function parseDayTable($, table) {
  const $table = $(table);
  const classAttr = $table.attr('class') || '';
  const m = classAttr.match(/reservation-day-(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;

  const resources = [];
  $table.find('tbody tr').each((_, rowEl) => {
    const $row = $(rowEl);
    const laneName = $row.find('td.equip-label span').text().trim();
    if (!laneName) return;

    const slots = [];
    $row.find('td').each((__, cellEl) => {
      const $cell = $(cellEl);
      if ($cell.hasClass('equip-label')) return;
      const classes = ($cell.attr('class') || '').split(/\s+/);
      const colMatch = classes.find((c) => /^col-\d{2}-\d{2}$/.test(c));
      if (!colMatch) return;
      const colspan = parseInt($cell.attr('colspan') || '1', 10);
      const [, hh, mm] = colMatch.match(/^col-(\d{2})-(\d{2})$/);
      const startMinutes = parseInt(hh, 10) * 60 + parseInt(mm, 10);
      const endMinutes = startMinutes + colspan * 30;
      const start = `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')}`;
      const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

      const text = $cell.text().trim();
      let status;
      if (text) status = 'reserved';
      else if (classes.includes('closed')) status = 'closed';
      else if (classes.includes('reservable')) status = 'available';
      else status = 'unknown';

      slots.push({ start, end, status, label: text || undefined });
    });
    // Categorize so lap lanes aren't lumped together with the whirlpool/play
    // pool when computing "lanes free" - those aren't swim lanes.
    const category = /^dráha/i.test(laneName) ? 'Dráhy' : laneName;
    if (slots.length) resources.push({ name: laneName, category, slots });
  });

  return resources.length ? { date, resources } : null;
}

// The main page buries live occupancy inside a free-text address block
// alongside water/air temperatures, e.g. "...obsazenost: 0 / 135...".
async function scrapeOccupancy(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(MAIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(/obsazenost:?\s*(\d+)\s*\/\s*(\d+)/i);
    return m ? [{ label: 'Bazén', current: parseInt(m[1], 10), max: parseInt(m[2], 10) }] : [];
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

export async function scrapeKravihora(browser) {
  const occupancy = await scrapeOccupancy(browser);
  const page = await browser.newPage();
  const days = [];
  try {
    let nextUrl = ROZPIS_URL;
    for (let week = 0; week < WEEKS_AHEAD && nextUrl; week++) {
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('table.reservation-day', { timeout: 15000 }).catch(() => {});
      const html = await page.content();
      const $ = cheerio.load(html);

      $('table.reservation-day').each((_, table) => {
        const day = parseDayTable($, table);
        if (day && !days.some((d) => d.date === day.date)) days.push(day);
      });

      const nextHref = $('.next-link a').attr('href');
      nextUrl = nextHref ? new URL(nextHref, ROZPIS_URL).toString() : null;
    }

    days.sort((a, b) => a.date.localeCompare(b.date));

    return { venue: 'kravihora', name: 'Krytá plavecká hala Kraví hora', url: MAIN_URL, ok: true, error: null, days, occupancy };
  } catch (err) {
    return { venue: 'kravihora', name: 'Krytá plavecká hala Kraví hora', url: MAIN_URL, ok: days.length > 0, error: err.message, days, occupancy };
  } finally {
    await page.close();
  }
}
