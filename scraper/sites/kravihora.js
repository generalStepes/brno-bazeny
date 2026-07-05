import * as cheerio from 'cheerio';

const MAIN_URL = 'https://www.kravihora-brno.cz/kryta-plavecka-hala';
const ROZPIS_URL = 'https://www.kravihora-brno.cz/kryta-plavecka-hala/rozpis';
const WEEKS_AHEAD = 2; // each page load returns ~7 days; follow the "next week" pager this many times

// Kravihora's main page only shows *today*, but the "Týdenní rozpis" (weekly
// schedule) sub-page renders ~7 days per load as a sequence of
// table.reservation-day-YYYYMMDD blocks, with a "next week" pager link
// (?from=YYYY-MM-DD) to keep going further out.
// Slots here mean "free to rent a lane", not "open for public walk-in swim" -
// this venue works as a lane-rental system, not open-swim admission.
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
      else if (classes.includes('reservable')) status = 'reservable';
      else status = 'unknown';

      slots.push({ start, end, status, label: text || undefined });
    });
    if (slots.length) resources.push({ name: laneName, slots });
  });

  return resources.length ? { date, resources } : null;
}

export async function scrapeKravihora(browser) {
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
    const note = 'Kravihora provozuje dráhy formou pronájmu, nikoli volného vstupu pro veřejnost – "volno" zde znamená volnou dráhu k pronájmu.';
    for (const day of days) day.note = note;

    return { venue: 'kravihora', name: 'Krytá plavecká hala Kraví hora', url: MAIN_URL, ok: true, error: null, days };
  } catch (err) {
    return { venue: 'kravihora', name: 'Krytá plavecká hala Kraví hora', url: MAIN_URL, ok: days.length > 0, error: err.message, days };
  } finally {
    await page.close();
  }
}
