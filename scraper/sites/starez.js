import * as cheerio from 'cheerio';
import { statusFromStarezColor } from '../lib/status.js';
import { downloadWebcams } from '../lib/webcam.js';
import { unifyLaneName } from '../lib/laneName.js';

const MONTHS = { 1: '01', 2: '02', 3: '03', 4: '04', 5: '05', 6: '06', 7: '07', 8: '08', 9: '09', 10: '10', 11: '11', 12: '12' };

// e.g. "neděle 5.7.2026" -> "2026-07-05"
function parseCzechDateHeading(text) {
  const m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${MONTHS[Number(mo)]}-${String(d).padStart(2, '0')}`;
}

// The homepage carries two independent bits of live context the reservation
// grid itself doesn't reliably reflect:
//  - live headcount boxes, e.g. <div class="box"><div class="text">
//    <p>BAZÉNY A POSILOVNA</p><h5>11/220</h5> (Lužánky has two gates -
//    BAZÉNY, WELLNESS - Ponávka has none)
//  - a site-wide #alert-danger banner. This is used for both genuine
//    closures ("bude bazén zcela uzavřen ... 31. 12. 2026") *and* completely
//    benign notices (Aquapark: "otevřeno od 8:00 hod STÁTNÍ SVÁTEK" - open
//    early for a holiday) - so presence alone isn't a signal, only specific
//    closure wording is. Ponávka's reservation grid can keep showing normal
//    open slots during a long-term closure like this, so this is the only
//    reliable source of truth for "is the venue actually closed".
const CLOSURE_KEYWORDS = /uzavřen|mimo provoz|odstávka/i;

// The banner often bundles unrelated logistics onto the same line as the
// actual closure statement, e.g. Ponávka: "...bude bazén zcela uzavřen.
// Čipové hodinky uhrazené v rámci FKSP vyzvedávejte na pokladně Lázní
// Rašínova." - only the first sentence is about the closure itself. Keep
// everything up to and including the sentence containing the closure
// keyword, drop whatever comes after.
function extractClosureSummary(alertText) {
  const keywordMatch = alertText.match(CLOSURE_KEYWORDS);
  if (!keywordMatch) return alertText;
  const periodIdx = alertText.indexOf('.', keywordMatch.index + keywordMatch[0].length);
  return periodIdx === -1 ? alertText : alertText.slice(0, periodIdx + 1).trim();
}

function findClosureNotice($) {
  const rawAlertText = $('#alert-danger').first().text().replace(/\s+/g, ' ').trim();
  if (!rawAlertText || !CLOSURE_KEYWORDS.test(rawAlertText)) return null;
  const alertText = extractClosureSummary(rawAlertText);

  // These notices are phrased "closed from START to END", e.g.
  // "17. 8.-20. 9. 2026" or "14. 6. od 13:00 - 31. 12. 2026" - the start
  // date very often omits the year. Matching only full dd.mm.yyyy dates and
  // treating the last one as "closed until" (with no lower bound) silently
  // dropped the start date, which made a closure that hasn't started yet
  // (e.g. one beginning next month) look like it was already in effect.
  // So: match dates with or without a year, then backfill missing years
  // from the nearest later date that does have one.
  const rawMatches = [...alertText.matchAll(/(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/g)].map((m) => ({
    d: m[1],
    mo: m[2],
    y: m[3],
  }));
  let nextYear = null;
  for (let i = rawMatches.length - 1; i >= 0; i--) {
    if (rawMatches[i].y) nextYear = rawMatches[i].y;
    else rawMatches[i].y = nextYear;
  }
  const isoDates = rawMatches.filter((p) => p.y).map((p) => `${p.y}-${MONTHS[Number(p.mo)]}-${String(p.d).padStart(2, '0')}`);

  // No parseable date at all -> treat as an indefinite closure in effect
  // right now and close everything we scrape, rather than risk showing
  // available slots during a real closure.
  if (!isoDates.length) return { message: alertText, closedFrom: null, closedUntil: null };
  return { message: alertText, closedFrom: isoDates[0], closedUntil: isoDates[isoDates.length - 1] };
}

async function scrapeHomepageInfo(browser, homeUrl) {
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
    return { occupancy: [...seen.values()], closure: findClosureNotice($) };
  } catch {
    return { occupancy: [], closure: null };
  } finally {
    await page.close();
  }
}

// Shared scraper for the three STAREZ-run venues, which all use the same
// reservation grid template. All days (a full week) live inside a single
// .s-reservation__body wrapper as a flat, repeating sequence of
// h3 (date heading) -> h4 (pool/resource name) -> .s-reservation-table blocks.
export async function scrapeStarezVenue(browser, { venue, name, url, webcams }) {
  const { occupancy, closure } = await scrapeHomepageInfo(browser, new URL('/', url).toString());
  const webcamImages = webcams ? await downloadWebcams(webcams) : [];
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
          const isSirkaLane = /šířka/i.test(laneName);
          const slots = [];
          $(rowEl)
            .find('td span[data-date]')
            .each((____, spanEl) => {
              const $span = $(spanEl);
              const style = $span.attr('style') || '';
              const colorMatch = style.match(/background-color:\s*(#[0-9a-fA-F]{6})/);
              let status = statusFromStarezColor(colorMatch ? colorMatch[1] : null);
              // Width-swim mode (volná/rezervovaná šířka) means the opposite
              // of its literal color on a normal length lane (délka) vs. on
              // a dedicated width lane (šířka) - confirmed directly by a
              // regular swimmer there. When a délka lane gets painted with
              // either width-mode color, its length is no longer usable for
              // normal swimming (blocked), even though the color alone reads
              // "free". A šířka lane normally just sits closed and isn't
              // offered at all - either width-mode color appearing on it
              // means an organized width-swim session is actually open to
              // the public right now, regardless of which of the two colors.
              if (colorMatch && /^#(f9d993|e19e0d)$/i.test(colorMatch[1])) {
                status = isSirkaLane ? 'available' : 'reserved';
              }
              const timeText = $span.find('.table-time').text().trim(); // e.g. "8:00-9:00"
              const [start, end] = timeText.split('-').map((t) => t.trim());
              // The <small> text carries context that the color alone
              // doesn't, e.g. "volná šířka" / "rezervovaná šířka: KPSP 50".
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
            // "lanes free" number would be misleading. The category check
            // above uses the raw label (so "šířka" is still detected).
            // A numbered lane's display name is left bare here ("Dráha N") -
            // whether it needs a category prefix is decided later, once we
            // know if this venue actually has more than one lane category to
            // distinguish (see applyLaneDisplayNames in index.js). Non-lane
            // resources (e.g. "část", "celý bazén", "sauna") aren't
            // self-descriptive alone, so they always keep their category.
            const unifiedName = unifyLaneName(laneName);
            const isNumberedLane = /^Dráha \d+$/.test(unifiedName);
            resources.push({ name: isNumberedLane ? unifiedName : `${category} - ${laneName}`, category, slots });
          }
        });
        dayMap.set(currentDate, resources);
      });

    const days = Array.from(dayMap.entries())
      .filter(([, resources]) => resources.length)
      .map(([date, resources]) => ({ date, resources }));

    // The reservation grid can keep showing normal open slots during a
    // long-term closure (Ponávka does exactly this) - if the homepage says
    // otherwise, that overrides whatever the grid shows for the affected days.
    if (closure) {
      for (const day of days) {
        if (closure.closedFrom && day.date < closure.closedFrom) continue;
        if (closure.closedUntil && day.date > closure.closedUntil) continue;
        for (const resource of day.resources) {
          for (const slot of resource.slots) slot.status = 'closed';
        }
        day.note = closure.message;
      }
    }

    return { venue, name, url, ok: true, error: null, days, occupancy, webcams: webcamImages, closureNotice: closure };
  } catch (err) {
    return { venue, name, url, ok: false, error: err.message, days: [], occupancy, webcams: webcamImages, closureNotice: closure };
  } finally {
    await page.close();
  }
}
