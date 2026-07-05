const TIMELINE_START_MIN = 6 * 60; // 06:00
const TIMELINE_END_MIN = 22 * 60; // 22:00
const TIMELINE_COLS = (TIMELINE_END_MIN - TIMELINE_START_MIN) / 30; // 32

const I18N = {
  cs: {
    'site.title': '🏊 Bazény v Brně – dostupnost',
    'site.subtitle': 'Souhrn otevřených drah napříč brněnskými bazény. Data se aktualizují automaticky několikrát denně.',
    'query.title': 'Chci jít plavat',
    'query.day': 'Kdy',
    'query.time': 'V kolik',
    'day.today': 'Dnes',
    'day.tomorrow': 'Zítra',
    'detail.title': 'Podrobný přehled',
    'venue.openPage': 'Otevřít stránku bazénu →',
    'venue.noDataForDate': 'Pro vybraný den nejsou k dispozici žádná data z tohoto bazénu.',
    'venue.loadError': 'Nepodařilo se načíst data',
    'venue.nowFree': 'teď volno',
    'recommend.badge': 'Doporučujeme',
    'tier.available': 'Volno',
    'tier.unavailable': 'Obsazeno / zavřeno',
    'tier.noData': 'Bez dat',
    'result.lanesFree': (free, total) => `${free} z ${total} volných`,
    'legend.available': 'volno',
    'legend.reserved': 'obsazeno',
    'legend.closed': 'zavřeno',
    'legend.unknown': 'neznámé',
    'status.available': 'volno',
    'status.reserved': 'obsazeno',
    'status.closed': 'zavřeno',
    'status.unknown': 'neznámé',
    'disclaimer': 'Data jsou stahována automaticky z veřejných stránek jednotlivých bazénů a nemusí být 100% přesná – pro rezervaci vždy použijte odkaz na daný bazén.',
    'updatedAt': (d) => `Naposledy aktualizováno: ${d}`,
    'noResults': 'Pro tento čas nemáme u žádného bazénu data.',
  },
  en: {
    'site.title': '🏊 Brno Pools – availability',
    'site.subtitle': 'A combined view of open swim lanes across Brno pools. Data refreshes automatically several times a day.',
    'query.title': "I'd like to go swimming",
    'query.day': 'When',
    'query.time': 'At what time',
    'day.today': 'Today',
    'day.tomorrow': 'Tomorrow',
    'detail.title': 'Detailed overview',
    'venue.openPage': 'Open pool website →',
    'venue.noDataForDate': 'No data available for this pool on the selected date.',
    'venue.loadError': 'Failed to load data',
    'venue.nowFree': 'free now',
    'recommend.badge': 'Recommended',
    'tier.available': 'Open',
    'tier.unavailable': 'Full / closed',
    'tier.noData': 'No data',
    'result.lanesFree': (free, total) => `${free} of ${total} free`,
    'legend.available': 'open',
    'legend.reserved': 'occupied',
    'legend.closed': 'closed',
    'legend.unknown': 'unknown',
    'status.available': 'open',
    'status.reserved': 'occupied',
    'status.closed': 'closed',
    'status.unknown': 'unknown',
    'disclaimer': 'Data is scraped automatically from each pool’s public website and may not be 100% accurate — always use the link to the venue itself before relying on it.',
    'updatedAt': (d) => `Last updated: ${d}`,
    'noResults': 'No data available for any pool at this time.',
  },
};

// Translate a handful of recurring Czech labels that come straight from the
// source venues (e.g. druzstevni's per-slot text), regardless of UI language.
const SOURCE_LABEL_TRANSLATIONS = {
  en: {
    'otevřeno pro veřejnost': 'open to public',
    zavřeno: 'closed',
    rezervováno: 'reserved',
    'není k dispozici': 'not available',
  },
};

let lang = 'cs';
function t(key, ...args) {
  const entry = I18N[lang][key] ?? I18N.cs[key];
  return typeof entry === 'function' ? entry(...args) : entry;
}
function translateSourceLabel(label) {
  if (!label || lang === 'cs') return label;
  const map = SOURCE_LABEL_TRANSLATIONS[lang] || {};
  return map[label.trim().toLowerCase()] || label;
}

const DOW = {
  cs: ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

let DATA = null;
let queryDate = null; // ISO
let queryTime = '17:00';
let timelineDate = null; // ISO, for the detailed section

// Deliberately local-time based throughout (not UTC/toISOString) since this
// site is about "today" for someone standing in Brno right now, and mixing
// local parsing with UTC formatting previously caused tomorrow's date to
// collide with today's under Brno's UTC+2 offset.
function isoFromDateParts(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayISO() {
  return isoFromDateParts(new Date());
}
function addDaysISO(baseISO, days) {
  const [y, m, d] = baseISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return isoFromDateParts(date);
}
function parseTimeToMinutes(tstr) {
  const [h, m] = tstr.split(':').map(Number);
  return h * 60 + m;
}
function fmtDateLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return { dow: DOW[lang][d.getDay()], md: `${d.getDate()}.${d.getMonth() + 1}.` };
}

// ---------- Recommendation / query logic ----------

// Whirlpools, saunas, VIP zones and relaxation pools aren't lap-swimming
// lanes - they shouldn't count toward (or dilute) a venue's "free to swim"
// score, even though the scraper reports them as resources too.
const AUXILIARY_CATEGORY_PATTERN = /vířiv|saun|\bvip\b|relaxa|šířka/i;
function isAuxiliaryCategory(category) {
  return AUXILIARY_CATEGORY_PATTERN.test(category || '');
}

function emptyCounts() {
  return { available: 0, reserved: 0, closed: 0, unknown: 0, total: 0 };
}
function addSlotToCounts(counts, status) {
  counts[status] = (counts[status] || 0) + 1;
  counts.total++;
}

// Groups a day's resources by their venue-published category (e.g. "Dráhy v
// 50m bazénu" vs "Dráhy v 25m bazénu" at Lužánky) so a single lumped number
// never hides that free lanes are only in one pool size/section.
function categoryCountsAt(day, timeStr) {
  const byCategory = new Map();
  if (!day) return byCategory;
  const t0 = parseTimeToMinutes(timeStr);
  for (const resource of day.resources) {
    const category = resource.category || day.name || 'Bazén';
    const slot = resource.slots.find((s) => t0 >= parseTimeToMinutes(s.start) && t0 < parseTimeToMinutes(s.end));
    if (!slot) continue;
    if (!byCategory.has(category)) byCategory.set(category, emptyCounts());
    addSlotToCounts(byCategory.get(category), slot.status);
  }
  return byCategory;
}

function sumCounts(countsList) {
  const sum = emptyCounts();
  for (const c of countsList) {
    for (const key of Object.keys(sum)) sum[key] += c[key] || 0;
  }
  return sum;
}

// Primary counts = only real swim-lane categories (excludes whirlpool/sauna/
// VIP/relaxation), used for ranking and headline numbers.
function primaryCountsAt(day, timeStr) {
  const byCategory = categoryCountsAt(day, timeStr);
  const primary = [...byCategory.entries()].filter(([cat]) => !isAuxiliaryCategory(cat)).map(([, c]) => c);
  const total = sumCounts(primary);
  return total.total ? total : null;
}

function tierFor(counts) {
  if (!counts) return 'noData';
  if (counts.available > 0) return 'available';
  return 'unavailable';
}

const TIER_RANK = { available: 0, unavailable: 1, noData: 2 };

function buildRanking(date, time) {
  return DATA.venues
    .map((venue) => {
      const day = venue.days.find((d) => d.date === date);
      const counts = primaryCountsAt(day, time);
      const categories = categoryCountsAt(day, time);
      const tier = tierFor(counts);
      // Relative occupancy, not raw lane count: a big venue like Lužánky
      // naturally has more free lanes in absolute terms, but that doesn't
      // mean it's less crowded - rank by the *share* of lanes that are free.
      const score = counts ? counts.available / counts.total : 0;
      return { venue, day, counts, categories, tier, score };
    })
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score);
}

function tierBadgeClass(tier) {
  return { available: 'free', unavailable: 'none', noData: 'na' }[tier];
}

function summaryText(counts, tier) {
  if (tier === 'available') return `${Math.round((counts.available / counts.total) * 100)} % ${t('legend.available')} (${t('result.lanesFree', counts.available, counts.total)})`;
  return t(`tier.${tier}`);
}

// Only worth listing per-category when a venue actually splits into more
// than one primary category (currently just Lužánky's 50m/25m/16m/kids pool).
function renderCategoryBreakdown(categories) {
  const primaryEntries = [...categories.entries()].filter(([cat]) => !isAuxiliaryCategory(cat));
  if (primaryEntries.length < 2) return null;
  const p = document.createElement('p');
  p.className = 'category-breakdown';
  p.textContent = primaryEntries.map(([cat, c]) => `${cat}: ${c.available}/${c.total}`).join(' · ');
  return p;
}

function renderResultLine(entry) {
  const { venue, counts, categories, tier } = entry;
  const li = document.createElement('li');
  li.className = 'result-row';

  const info = document.createElement('div');
  info.className = 'result-info';
  const name = document.createElement('span');
  name.className = 'result-name';
  name.textContent = venue.name;
  info.appendChild(name);
  const breakdown = counts ? renderCategoryBreakdown(categories) : null;
  if (breakdown) info.appendChild(breakdown);
  li.appendChild(info);

  const badge = document.createElement('span');
  badge.className = `venue-badge ${tierBadgeClass(tier)}`;
  badge.textContent = counts ? summaryText(counts, tier) : t('tier.noData');
  li.appendChild(badge);

  const link = document.createElement('a');
  link.href = venue.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = t('venue.openPage');
  li.appendChild(link);

  return li;
}

function renderRecommendationCard(entry, index) {
  const card = document.createElement('div');
  card.className = 'recommend-card';

  const badge = document.createElement('div');
  badge.className = 'recommend-flag';
  badge.textContent = `${t('recommend.badge')} #${index + 1}`;
  card.appendChild(badge);

  const name = document.createElement('h3');
  name.textContent = entry.venue.name;
  card.appendChild(name);

  const detail = document.createElement('p');
  detail.className = 'recommend-detail';
  detail.textContent = summaryText(entry.counts, entry.tier);
  card.appendChild(detail);

  const breakdown = renderCategoryBreakdown(entry.categories);
  if (breakdown) card.appendChild(breakdown);

  const link = document.createElement('a');
  link.href = entry.venue.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'recommend-link';
  link.textContent = t('venue.openPage');
  card.appendChild(link);

  return card;
}

function renderQueryResults() {
  const ranking = buildRanking(queryDate, queryTime);
  const recoContainer = document.getElementById('recommendations');
  const listContainer = document.getElementById('results-list');
  recoContainer.innerHTML = '';
  listContainer.innerHTML = '';

  const usable = ranking.filter((e) => e.tier === 'available');
  if (!usable.length) {
    const p = document.createElement('p');
    p.className = 'no-data';
    p.textContent = t('noResults');
    recoContainer.appendChild(p);
  } else {
    usable.slice(0, 2).forEach((entry, i) => recoContainer.appendChild(renderRecommendationCard(entry, i)));
  }

  for (const entry of ranking) listContainer.appendChild(renderResultLine(entry));
}

function populateQueryControls() {
  const daySelect = document.getElementById('query-day');
  const timeSelect = document.getElementById('query-time');

  daySelect.innerHTML = '';
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  if (!queryDate) queryDate = today;
  for (const [value, labelKey] of [[today, 'day.today'], [tomorrow, 'day.tomorrow']]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = t(labelKey);
    if (value === queryDate) opt.selected = true;
    daySelect.appendChild(opt);
  }
  daySelect.onchange = () => {
    queryDate = daySelect.value;
    renderQueryResults();
  };

  timeSelect.innerHTML = '';
  for (let m = TIMELINE_START_MIN; m < TIMELINE_END_MIN; m += 30) {
    const val = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    if (val === queryTime) opt.selected = true;
    timeSelect.appendChild(opt);
  }
  timeSelect.onchange = () => {
    queryTime = timeSelect.value;
    renderQueryResults();
  };
}

// ---------- Detailed timeline section (existing behaviour) ----------

function renderTimeline(resources) {
  const wrap = document.createElement('div');
  wrap.className = 'timeline-wrap';

  const hoursRow = document.createElement('div');
  hoursRow.className = 'timeline-hours';
  hoursRow.appendChild(document.createElement('div'));
  for (let m = TIMELINE_START_MIN; m < TIMELINE_END_MIN; m += 60) {
    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:00`;
    hoursRow.appendChild(label);
  }
  wrap.appendChild(hoursRow);

  for (const resource of resources) {
    const row = document.createElement('div');
    row.className = 'resource-row';
    const name = document.createElement('div');
    name.className = 'resource-name';
    name.textContent = resource.name;
    name.title = resource.name;
    row.appendChild(name);

    const cellStatus = new Array(TIMELINE_COLS).fill(null);
    for (const slot of resource.slots) {
      let start = Math.max(parseTimeToMinutes(slot.start), TIMELINE_START_MIN);
      let end = Math.min(parseTimeToMinutes(slot.end), TIMELINE_END_MIN);
      const colStart = Math.round((start - TIMELINE_START_MIN) / 30);
      const colEnd = Math.round((end - TIMELINE_START_MIN) / 30);
      for (let c = colStart; c < colEnd && c < TIMELINE_COLS; c++) {
        if (c >= 0) cellStatus[c] = slot;
      }
    }

    for (let c = 0; c < TIMELINE_COLS; c++) {
      const cell = document.createElement('div');
      const info = cellStatus[c];
      const status = info ? info.status : 'closed';
      cell.className = `slot ${status}`;
      const tmin = TIMELINE_START_MIN + c * 30;
      const timeStr = `${String(Math.floor(tmin / 60)).padStart(2, '0')}:${String(tmin % 60).padStart(2, '0')}`;
      const label = info ? translateSourceLabel(info.label) : null;
      cell.title = info ? `${timeStr} – ${t('status.' + info.status)}${label ? ' (' + label + ')' : ''}` : `${timeStr} – ${t('status.closed')}`;
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  }
  return wrap;
}

function renderVenue(venue, selectedDate) {
  const card = document.createElement('section');
  card.className = 'venue-card' + (venue.ok === false ? ' errored' : '');

  const head = document.createElement('div');
  head.className = 'venue-head';
  const h2 = document.createElement('h2');
  h2.textContent = venue.name;
  head.appendChild(h2);

  const dayData = venue.days.find((d) => d.date === selectedDate);
  const counts = primaryCountsAt(dayData, new Date().toTimeString().slice(0, 5));
  if (counts && selectedDate === todayISO()) {
    const badge = document.createElement('span');
    const tier = tierFor(counts);
    badge.className = `venue-badge ${tierBadgeClass(tier)}`;
    badge.textContent = `${t('venue.nowFree')}: ${counts.available}/${counts.total}`;
    head.appendChild(badge);
  }

  const link = document.createElement('a');
  link.href = venue.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = t('venue.openPage');
  head.appendChild(link);

  card.appendChild(head);

  if (venue.ok === false) {
    const err = document.createElement('p');
    err.className = 'venue-note';
    err.textContent = `${t('venue.loadError')} (${venue.error || '?'}).`;
    card.appendChild(err);
  }

  if (!dayData) {
    const note = document.createElement('p');
    note.className = 'no-data';
    note.textContent = t('venue.noDataForDate');
    card.appendChild(note);
  } else {
    if (dayData.note) {
      const note = document.createElement('p');
      note.className = 'venue-note';
      note.textContent = dayData.note;
      card.appendChild(note);
    }
    card.appendChild(renderTimeline(dayData.resources));
  }

  return card;
}

function renderDateTabs(dates) {
  const nav = document.getElementById('date-tabs');
  nav.innerHTML = '';
  for (const date of dates) {
    const { dow, md } = fmtDateLabel(date);
    const btn = document.createElement('button');
    btn.className = 'date-tab' + (date === timelineDate ? ' active' : '');
    btn.innerHTML = `<span class="dow">${dow}</span>${md}`;
    btn.addEventListener('click', () => {
      timelineDate = date;
      renderAll();
    });
    nav.appendChild(btn);
  }
}

function renderStaticText() {
  document.getElementById('site-title').textContent = t('site.title');
  document.getElementById('site-subtitle').textContent = t('site.subtitle');
  document.getElementById('query-title').textContent = t('query.title');
  document.getElementById('label-day').textContent = t('query.day');
  document.getElementById('label-time').textContent = t('query.time');
  document.getElementById('detail-title').textContent = t('detail.title');
  document.getElementById('disclaimer').textContent = t('disclaimer');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  if (DATA) {
    document.getElementById('updated-at').textContent = t('updatedAt', new Date(DATA.generatedAt).toLocaleString(lang === 'cs' ? 'cs-CZ' : 'en-GB'));
  }
}

function renderAll() {
  renderStaticText();
  populateQueryControls();
  renderQueryResults();

  const allDates = new Set();
  for (const venue of DATA.venues) for (const day of venue.days) allDates.add(day.date);
  const dates = Array.from(allDates).sort();
  if (!timelineDate || !dates.includes(timelineDate)) timelineDate = dates.includes(todayISO()) ? todayISO() : dates[0];

  renderDateTabs(dates);
  const container = document.getElementById('venues');
  container.innerHTML = '';
  for (const venue of DATA.venues) container.appendChild(renderVenue(venue, timelineDate));
}

function setupLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      lang = btn.getAttribute('data-lang');
      document.documentElement.lang = lang;
      document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderAll();
    });
  });
}

async function main() {
  setupLangSwitch();
  const res = await fetch('data/latest.json', { cache: 'no-store' });
  DATA = await res.json();
  renderAll();
}

main().catch((err) => {
  document.getElementById('venues').textContent = `Error: ${err.message}`;
  console.error(err);
});
