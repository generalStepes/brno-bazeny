export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(baseISO, days) {
  const d = new Date(baseISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextNDates(n, baseISO = todayISO()) {
  return Array.from({ length: n }, (_, i) => addDaysISO(baseISO, i));
}
