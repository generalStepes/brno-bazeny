const TIMELINE_START_MIN = 6 * 60; // 06:00
const TIMELINE_END_MIN = 22 * 60; // 22:00
const TIMELINE_COLS = (TIMELINE_END_MIN - TIMELINE_START_MIN) / 30; // 32

const DOW = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

function parseTimeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmtDateLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return { dow: DOW[d.getDay()], md: `${d.getDate()}.${d.getMonth() + 1}.` };
}

function nowInPrague() {
  // Render "now" using the viewer's local clock; venues are all in Brno (CET/CEST)
  // so this is accurate for anyone actually checking from the area.
  return new Date();
}

function statusLabel(status) {
  return { available: 'volno', reservable: 'lze rezervovat', reserved: 'obsazeno', closed: 'zavřeno', unknown: 'neznámé' }[status] || status;
}

function renderTimeline(resources) {
  const wrap = document.createElement('div');
  wrap.className = 'timeline-wrap';

  const hoursRow = document.createElement('div');
  hoursRow.className = 'timeline-hours';
  const spacer = document.createElement('div');
  hoursRow.appendChild(spacer);
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

    // build a 32-slot grid, default 'unknown' (not covered by any scraped slot)
    const cellStatus = new Array(TIMELINE_COLS).fill(null);
    for (const slot of resource.slots) {
      let start = parseTimeToMinutes(slot.start);
      let end = parseTimeToMinutes(slot.end);
      start = Math.max(start, TIMELINE_START_MIN);
      end = Math.min(end, TIMELINE_END_MIN);
      const colStart = Math.round((start - TIMELINE_START_MIN) / 30);
      const colEnd = Math.round((end - TIMELINE_START_MIN) / 30);
      for (let c = colStart; c < colEnd && c < TIMELINE_COLS; c++) {
        if (c >= 0) cellStatus[c] = { status: slot.status, label: slot.label, start: slot.start, end: slot.end };
      }
    }

    for (let c = 0; c < TIMELINE_COLS; c++) {
      const cell = document.createElement('div');
      const info = cellStatus[c];
      // Venues simply don't render a column for hours they're not operating -
      // absence of scraped data outside a venue's published range means
      // "closed", not "unknown".
      const status = info ? info.status : 'closed';
      cell.className = `slot ${status}`;
      const t = TIMELINE_START_MIN + c * 30;
      const timeStr = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      cell.title = info ? `${timeStr} – ${statusLabel(info.status)}${info.label ? ' (' + info.label + ')' : ''}` : `${timeStr} – zavřeno`;
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  }
  return wrap;
}

function computeNowBadge(dayData, selectedDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (selectedDate !== today || !dayData) return null;
  const nowMin = nowInPrague().getHours() * 60 + nowInPrague().getMinutes();
  let free = 0;
  let total = 0;
  for (const resource of dayData.resources) {
    for (const slot of resource.slots) {
      const s = parseTimeToMinutes(slot.start);
      const e = parseTimeToMinutes(slot.end);
      if (nowMin >= s && nowMin < e) {
        total++;
        if (slot.status === 'available' || slot.status === 'reservable') free++;
      }
    }
  }
  if (total === 0) return null;
  return { free, total };
}

function badgeClass(free, total) {
  if (total === 0) return 'na';
  if (free === 0) return 'none';
  if (free === total) return 'free';
  return 'limited';
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
  const nowBadge = computeNowBadge(dayData, selectedDate);
  if (nowBadge) {
    const badge = document.createElement('span');
    badge.className = `venue-badge ${badgeClass(nowBadge.free, nowBadge.total)}`;
    badge.textContent = `teď volno: ${nowBadge.free}/${nowBadge.total}`;
    head.appendChild(badge);
  }

  const link = document.createElement('a');
  link.href = venue.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Otevřít stránku bazénu →';
  head.appendChild(link);

  card.appendChild(head);

  if (venue.ok === false) {
    const err = document.createElement('p');
    err.className = 'venue-note';
    err.textContent = `Nepodařilo se načíst data (${venue.error || 'neznámá chyba'}).`;
    card.appendChild(err);
  }

  if (!dayData) {
    const note = document.createElement('p');
    note.className = 'no-data';
    note.textContent = 'Pro vybraný den nejsou k dispozici žádná data z tohoto bazénu.';
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

function renderDateTabs(dates, selectedDate, onSelect) {
  const nav = document.getElementById('date-tabs');
  nav.innerHTML = '';
  for (const date of dates) {
    const { dow, md } = fmtDateLabel(date);
    const btn = document.createElement('button');
    btn.className = 'date-tab' + (date === selectedDate ? ' active' : '');
    btn.innerHTML = `<span class="dow">${dow}</span>${md}`;
    btn.addEventListener('click', () => onSelect(date));
    nav.appendChild(btn);
  }
}

async function main() {
  const res = await fetch('data/latest.json', { cache: 'no-store' });
  const data = await res.json();

  document.getElementById('updated-at').textContent = `Naposledy aktualizováno: ${new Date(data.generatedAt).toLocaleString('cs-CZ')}`;

  const allDates = new Set();
  for (const venue of data.venues) for (const day of venue.days) allDates.add(day.date);
  const dates = Array.from(allDates).sort();

  const today = new Date().toISOString().slice(0, 10);
  let selectedDate = dates.includes(today) ? today : dates[0];

  function render() {
    renderDateTabs(dates, selectedDate, (date) => {
      selectedDate = date;
      render();
    });
    const container = document.getElementById('venues');
    container.innerHTML = '';
    for (const venue of data.venues) {
      container.appendChild(renderVenue(venue, selectedDate));
    }
  }

  render();
}

main().catch((err) => {
  document.getElementById('venues').textContent = `Chyba při načítání dat: ${err.message}`;
  console.error(err);
});
