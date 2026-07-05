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

// Calibrated against the July 2026 export (1306x2231px), expressed as
// fractions of image size so it keeps working if a future month's image is
// rendered at a slightly different resolution from the same template.
const GRID = {
  row0Top: 237 / 2231,
  rowHeight: 62.0 / 2231,
  col0Left: 287 / 1306,
  colWidth: 57 / 1306,
  cellW: 40 / 1306,
  cellH: 40 / 2231,
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

function parseMonthYearFromUrl(url) {
  const decoded = decodeURIComponent(url);
  const m = decoded.match(/Bazén\s+(\S+)\s+(\d{4})/i);
  if (!m) return null;
  const monthKey = stripDiacritics(m[1].toLowerCase());
  const month = CZECH_MONTHS[monthKey];
  if (!month) return null;
  return { month, year: parseInt(m[2], 10) };
}

async function ocrCell(worker, imageBuffer, meta, rowIdx, colIdx) {
  const top = meta.height * GRID.row0Top + rowIdx * meta.height * GRID.rowHeight - meta.height * GRID.cellH * 0.3;
  const left = meta.width * GRID.col0Left + colIdx * meta.width * GRID.colWidth - meta.width * GRID.cellW * 0.25;
  const width = meta.width * GRID.cellW;
  const height = meta.height * GRID.cellH;
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
  const monthYear = parseMonthYearFromUrl(imgUrl);
  if (!monthYear) throw new Error(`could not parse month/year from image URL: ${imgUrl}`);

  const imgResp = await fetch(imgUrl);
  if (!imgResp.ok) throw new Error(`failed to download schedule image: HTTP ${imgResp.status}`);
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  const meta = await sharp(imgBuffer).metadata();

  const daysInMonth = new Date(monthYear.year, monthYear.month, 0).getDate();

  const worker = await createWorker('eng');
  await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '10' });

  const rawGrid = [];
  try {
    for (let d = 0; d < daysInMonth; d++) {
      const row = [];
      for (let c = 0; c < HOUR_COLUMNS.length; c++) {
        row.push(await ocrCell(worker, imgBuffer, meta, d, c));
      }
      rawGrid.push(row);
    }
  } finally {
    await worker.terminate();
  }

  const totalLanes = Math.max(6, ...rawGrid.flat().filter((v) => v !== null && v >= 0 && v <= 20));

  const days = rawGrid.map((row, d) => {
    const date = `${monthYear.year}-${String(monthYear.month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
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
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, ok: true, error: null, days, occupancy: [] };
  } catch (err) {
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, ok: false, error: err.message, days: [], occupancy: [] };
  } finally {
    await page.close();
  }
}
