// Some venues offer a swimming instructor for free as part of the regular
// entry ticket. Only Lužánky does as of November 2026 ("bezplatný instruktor
// plavání v rámci vstupu na bazény"); checked: Aquapark only has a gym
// (posilovna) trainer, the other venues have nothing comparable.
//
// The schedule is re-read from the venue's own page every run, so a change
// there shows up on the site automatically. If the page can't be fetched or
// its wording no longer parses, we fall back to the last known schedule but
// mark it unverified, so the site can say "check with the venue".
const FREE_TRAINERS = [
  {
    venue: 'luzanky',
    sourceUrl: 'https://bazenyluzanky.starez.cz/detail-lekce/lekce-plavani-pro-dospele-284',
    // Page text: "KDY: Od 1. 9. 2026 každé úterý a čtvrtek od 6:00 do 10:00
    // a od 19:00 do 21:30."
    fallback: { weekdays: [2, 4], ranges: [['06:00', '10:00'], ['19:00', '21:30']], since: '2026-09-01' },
  },
];

const CZECH_WEEKDAYS = [
  [/neděl/i, 0],
  [/ponděl/i, 1],
  [/úter|úterý/i, 2],
  [/střed/i, 3],
  [/čtvrt/i, 4],
  [/pát(e|k)/i, 5],
  [/sobot/i, 6],
];

function pad(time) {
  const [h, m] = time.split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

// Parses the "KDY: ..." sentence of a STAREZ lesson page.
export function parseTrainerSchedule(pageText) {
  const text = pageText.replace(/\s+/g, ' ');
  if (!/bezplatn|zdarma/i.test(text)) return null;
  const when = text.match(/KDY:\s*([^]*?\d{1,2}:\d{2}[^.]*\.)/i)?.[1];
  if (!when) return null;
  const weekdays = CZECH_WEEKDAYS.filter(([re]) => re.test(when)).map(([, n]) => n);
  const ranges = [...when.matchAll(/(\d{1,2}:\d{2})\s*(?:do|-|–)\s*(\d{1,2}:\d{2})/g)].map((m) => [pad(m[1]), pad(m[2])]);
  const sinceMatch = when.match(/od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
  const since = sinceMatch ? `${sinceMatch[3]}-${sinceMatch[2].padStart(2, '0')}-${sinceMatch[1].padStart(2, '0')}` : null;
  if (!weekdays.length || !ranges.length) return null;
  return { weekdays, ranges, since };
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[^]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

export async function scrapeFreeTrainers() {
  const byVenue = {};
  for (const { venue, sourceUrl, fallback } of FREE_TRAINERS) {
    let parsed = null;
    try {
      const res = await fetch(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; brno-bazeny scraper)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      parsed = parseTrainerSchedule(htmlToText(await res.text()));
      if (!parsed) console.error(`Free trainer schedule for ${venue} no longer parses - using last known schedule`);
    } catch (err) {
      console.error(`Failed to fetch free trainer schedule for ${venue}: ${err.message}`);
    }
    byVenue[venue] = { ...(parsed || fallback), sourceUrl, verified: Boolean(parsed) };
  }
  return byVenue;
}
