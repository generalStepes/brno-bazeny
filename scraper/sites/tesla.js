import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const PAGE_URL = 'https://www.tjteslabrno.cz/sportovni-zarizeni/bazen-25m';

// TJ Tesla publishes real public-lane availability, but only as a monthly
// schedule image (e.g. "Bazén Červenec 2026.jpg") - a grid of date rows x
// hour columns, each cell holding the count of free public lanes. There's no
// text/API source for this data, so we OCR the image directly.
const CZECH_MONTHS = {
  leden: 1, unor: 2, brezen: 3, duben: 4, kveten: 5, cerven: 6,
  cervenec: 7, srpen: 8, zari: 9, rijen: 10, listopad: 11, prosinec: 12,
};

const HOUR_COLUMNS = [
  ['06:00', '07:00'], ['07:00', '08:00'], ['08:00', '09:00'], ['09:00', '10:00'],
  ['10:00', '11:00'], ['11:00', '12:00'], ['12:00', '13:00'], ['13:00', '14:00'],
  ['14:00', '15:00'], ['15:00', '16:00'], ['16:00', '17:00'], ['17:00', '18:00'],
  ['18:00', '19:00'], ['19:00', '20:00'], ['20:00', '21:00'], ['21:00', '21:45'],
];

// Calibrated against the July 2026 export (1306x2231px, 31 data rows).
// These are *absolute* pixel offsets, not fractions of image size - the
// header height and per-row height are fixed by the template regardless of
// row count, so a half-month export (e.g. 15 rows, 1306x1239px) has a
// shorter total image but the same header/row geometry. Using fractions of
// total height here previously broke on exactly that case (a half-month
// image reads as if every row were squeezed into a much shorter grid).
const GRID = {
  row0Top: 237,
  rowHeight: 62.0,
  col0Left: 287,
  colWidth: 57,
  cellW: 40,
  cellH: 40,
};

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function findScheduleImageUrl(page) {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const match = imgs.find((img) => decodeURIComponent(img.src).includes('Bazén'));
    return match ? match.src : null;
  });
}

// TJ Tesla normally uploads one image per whole month ("Bazén Červenec
// 2026.jpg" -> rows are day 1..daysInMonth), but sometimes splits a month
// mid-way into two half-month images instead ("Bazén 17.-31.. 2026.jpg" -
// rows are day 17..31, and the month name is dropped from the filename
// entirely). Returns { year, month, startDay, dayCount } either way.
function parseScheduleImageInfo(url, now = new Date()) {
  const decoded = decodeURIComponent(url);

  const monthMatch = decoded.match(/Bazén\s+(\D+?)\s+(\d{4})/i);
  if (monthMatch) {
    const monthKey = stripDiacritics(monthMatch[1].toLowerCase());
    const month = CZECH_MONTHS[monthKey];
    if (month) {
      const year = parseInt(monthMatch[2], 10);
      return { year, month, startDay: 1, dayCount: new Date(year, month, 0).getDate() };
    }
  }

  const rangeMatch = decoded.match(/Bazén\s+(\d{1,2})\.-(\d{1,2})\.+\s*(\d{4})/i);
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10);
    const endDay = parseInt(rangeMatch[2], 10);
    const year = parseInt(rangeMatch[3], 10);
    // No month name in this format at all - trust the month we're actually
    // scraping in, since these are always near-term schedules.
    const month = now.getMonth() + 1;
    return { year, month, startDay, dayCount: endDay - startDay + 1 };
  }

  return null;
}

async function ocrCell(worker, imageBuffer, rowIdx, colIdx) {
  const top = GRID.row0Top + rowIdx * GRID.rowHeight - GRID.cellH * 0.3;
  const left = GRID.col0Left + colIdx * GRID.colWidth - GRID.cellW * 0.25;
  const width = GRID.cellW;
  const height = GRID.cellH;
  const cropped = await sharp(imageBuffer)
    .extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) })
    .greyscale()
    .resize({ width: Math.round(width * 4) })
    .toBuffer();
  const { data } = await worker.recognize(cropped);
  const digits = data.text.replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : null;
}

const OCR_NOTE_CS =
  'Počet volných drah je získán automatickým rozpoznáním textu z měsíčního rozpisu (obrázku) na webu TJ Tesla. Konkrétní čísla drah (Dráha 1, 2, ...) jsou orientační - důležitý je jen celkový počet volných drah.';

async function scrapeFromImage(page) {
  const imgUrl = await findScheduleImageUrl(page);
  if (!imgUrl) throw new Error('schedule image not found on page');
  const scheduleInfo = parseScheduleImageInfo(imgUrl);
  if (!scheduleInfo) throw new Error(`could not parse schedule date range from image URL: ${imgUrl}`);
  const { year, month, startDay, dayCount } = scheduleInfo;

  const imgResp = await fetch(imgUrl);
  if (!imgResp.ok) throw new Error(`failed to download schedule image: HTTP ${imgResp.status}`);
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());

  const worker = await createWorker('eng');
  await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '10' });

  const rawGrid = [];
  try {
    for (let d = 0; d < dayCount; d++) {
      const row = [];
      for (let c = 0; c < HOUR_COLUMNS.length; c++) {
        row.push(await ocrCell(worker, imgBuffer, d, c));
      }
      rawGrid.push(row);
    }
  } finally {
    await worker.terminate();
  }

  const totalLanes = Math.max(6, ...rawGrid.flat().filter((v) => v !== null && v >= 0 && v <= 20));

  const days = rawGrid.map((row, d) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(startDay + d).padStart(2, '0')}`;
    const resources = [];
    for (let lane = 1; lane <= totalLanes; lane++) {
      const slots = HOUR_COLUMNS.map(([start, end], c) => {
        const free = row[c];
        const status = free === null ? 'unknown' : lane <= free ? 'available' : 'reserved';
        return { start, end, status };
      });
      resources.push({ name: `Dráha ${lane}`, category: 'Dráhy', slots });
    }
    return { date, resources, note: OCR_NOTE_CS };
  });

  return days;
}

export async function scrapeTesla(browser) {
  const page = await browser.newPage();
  try {
    const days = await scrapeFromImage(page);
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, ok: true, error: null, days, occupancy: [], webcams: [], closureNotice: null };
  } catch (err) {
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, ok: false, error: err.message, days: [], occupancy: [], webcams: [], closureNotice: null };
  } finally {
    await page.close();
  }
}
