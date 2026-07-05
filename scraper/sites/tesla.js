import { nextNDates } from '../lib/dates.js';

const PAGE_URL = 'https://www.tjteslabrno.cz/sportovni-zarizeni/bazen-25m';
const REENIO_URL = 'https://tjteslabrno.reenio.cz/cs/#/term/P608631/';
const PERMALINK = '608631';
const DAYS_AHEAD = 14;

// TJ Tesla does not publish real-time public-lane occupancy anywhere online.
// The only dynamic system found is a Reenio booking widget used for renting
// out lanes/the pool to clubs - it is NOT a public "book a swim" or live
// occupancy display. We report TJ Tesla's fixed weekly opening hours (from
// the static page) and separately flag any Reenio rental bookings found for
// a date, since a rental booking can reduce/eliminate public lane access.
function standardHoursFor(dateISO) {
  const day = new Date(dateISO + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? { start: '08:00', end: '19:00' } : { start: '06:00', end: '22:00' };
}

async function fetchReenioEvents(page) {
  // One page load gives us an authenticated session (cookies + xsrf token) we
  // can reuse for direct API calls covering further weeks without reloading.
  await page.goto(REENIO_URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

  const dates = nextNDates(DAYS_AHEAD);
  const weekStarts = [...new Set(dates.map((_, i) => (i % 7 === 0 ? dates[i] : null)).filter(Boolean))];

  const allEvents = [];
  for (const weekStart of weekStarts) {
    const result = await page.evaluate(
      async ({ date, permalink }) => {
        function getCookie(name) {
          const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
          return m ? decodeURIComponent(m[2]) : null;
        }
        const token = getCookie('XSRF-TOKEN');
        const fd = new FormData();
        fd.append('date', date);
        fd.append('viewMode', '7-days');
        fd.append('page', '0');
        fd.append('filter.permalinkIdentifier', permalink);
        fd.append('includeColors', 'true');
        fd.append('findNearestAvailable', 'false');
        const res = await fetch('/cs/api/Term/List', {
          method: 'POST',
          headers: { 'x-xsrf-token': token, 'x-requested-with': 'XMLHttpRequest' },
          body: fd,
          credentials: 'include',
        });
        return res.ok ? res.json() : null;
      },
      { date: weekStart, permalink: PERMALINK }
    );
    const events = result?.data?.events;
    if (Array.isArray(events)) allEvents.push(...events);
  }
  return allEvents;
}

function describeEvent(ev) {
  const start = ev.start || ev.startDate || ev.dateFrom || ev.from || null;
  const end = ev.end || ev.endDate || ev.dateTo || ev.to || null;
  const title = ev.name || ev.title || ev.label || 'rezervace';
  return { start, end, title };
}

export async function scrapeTesla(browser) {
  const page = await browser.newPage();
  const days = nextNDates(DAYS_AHEAD).map((date) => {
    const hours = standardHoursFor(date);
    return {
      date,
      resources: [
        {
          name: 'Bazén 25m',
          category: 'Bazén 25m',
          slots: [{ start: hours.start, end: hours.end, status: 'available' }],
        },
      ],
    };
  });

  let bookingNote = 'TJ Tesla nezveřejňuje online obsazenost drah pro veřejnost; zobrazena jsou pouze standardní otevírací doba a případné pronájmy z rezervačního systému Reenio.';
  try {
    const events = await fetchReenioEvents(page);
    if (events.length) {
      const summaries = events.slice(0, 20).map(describeEvent);
      bookingNote += ` Nalezeno ${events.length} rezervací pronájmu v Reenio, které mohou omezit veřejné plavání: ${summaries
        .map((s) => `${s.title}${s.start ? ` (${s.start}${s.end ? '–' + s.end : ''})` : ''}`)
        .join('; ')}.`;
    }
    for (const day of days) day.note = bookingNote;
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, reenioUrl: REENIO_URL, ok: true, error: null, days };
  } catch (err) {
    for (const day of days) day.note = bookingNote + ' (Reenio rezervace se nepodařilo načíst.)';
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, reenioUrl: REENIO_URL, ok: true, error: err.message, days };
  } finally {
    await page.close();
  }
}
