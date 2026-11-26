// Local-time based (the scraper pins TZ to Europe/Prague in index.js), not
// UTC/toISOString - between local midnight and 01:00/02:00 the UTC date is
// still "yesterday", which made e.g. Družstevní scrape the wrong 7 days.
function isoFromDateParts(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO() {
  return isoFromDateParts(new Date());
}

export function addDaysISO(baseISO, days) {
  const [y, m, d] = baseISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return isoFromDateParts(date);
}

export function nextNDates(n, baseISO = todayISO()) {
  return Array.from({ length: n }, (_, i) => addDaysISO(baseISO, i));
}
