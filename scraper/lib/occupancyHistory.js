import { readFile, writeFile } from 'node:fs/promises';

// Google's "popular times" isn't available through any documented API, and
// scraping Maps' internal data means driving a browser to evade its bot
// detection - not something worth building. Instead we accumulate our own
// history from the live headcount numbers we already scrape hourly, keyed
// by weekday + hour of day rather than by raw timestamp, so the file stays a
// small fixed size (7 days x ~16 hours x a handful of venue/gate labels)
// forever instead of growing without bound. After a few weeks of runs each
// bucket has enough samples to show a genuinely useful "typically X% full"
// figure for that day-of-week/hour, including for future dates the live
// snapshot can't say anything about.
export async function loadOccupancyHistory(path) {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function recordOccupancySample(history, { venue, label, weekday, hour, percent }) {
  const venueBucket = (history[venue] ??= {});
  const labelBucket = (venueBucket[label] ??= {});
  const dayBucket = (labelBucket[weekday] ??= {});
  const cell = (dayBucket[hour] ??= { sum: 0, count: 0 });
  cell.sum += percent;
  cell.count += 1;
}

export function updateHistoryWithResults(history, results, now = new Date()) {
  const weekday = String(now.getDay());
  const hour = String(now.getHours());
  for (const venue of results) {
    for (const occ of venue.occupancy || []) {
      if (!occ.max) continue;
      const percent = (occ.current / occ.max) * 100;
      recordOccupancySample(history, { venue: venue.venue, label: occ.label, weekday, hour, percent });
    }
  }
  return history;
}

export async function saveOccupancyHistory(path, history) {
  await writeFile(path, JSON.stringify(history), 'utf-8');
}

// Average percent-full for a given weekday/hour, or null if we have no
// samples yet for that slot.
export function averageOccupancy(history, venue, label, weekday, hour) {
  const cell = history?.[venue]?.[label]?.[String(weekday)]?.[String(hour)];
  if (!cell || !cell.count) return null;
  return { percent: cell.sum / cell.count, samples: cell.count };
}
