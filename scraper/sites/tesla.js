import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { addDaysISO, todayISO } from '../lib/dates.js';

const PAGE_URL = 'https://www.tjteslabrno.cz/sportovni-zarizeni/bazen-25m';

// TJ Tesla publishes public-lane availability only as an image: a grid of
// date rows x hour columns, each cell holding the number of free public
// lanes. There's no text/API source, so we OCR it.
//
// Since ~August 2026 the image is a rolling "ROZVRH DRAH PRO VEŘEJNOST"
// table (~11 days starting today, file name e.g. "ROZPIS DRAH PRO VEŘEJNOST
// (23).jpg") instead of the old monthly "Bazén Červenec 2026.jpg" exports.
// The file name no longer says which dates it covers, so the first row's
// date is OCR'd from the image itself.
const HOUR_COLUMNS = [
  ['06:00', '07:00'], ['07:00', '08:00'], ['08:00', '09:00'], ['09:00', '10:00'],
  ['10:00', '11:00'], ['11:00', '12:00'], ['12:00', '13:00'], ['13:00', '14:00'],
  ['14:00', '15:00'], ['15:00', '16:00'], ['16:00', '17:00'], ['17:00', '18:00'],
  ['18:00', '19:00'], ['19:00', '20:00'], ['20:00', '21:00'], ['21:00', '21:45'],
];

// Calibrated against the 26.11.2026 export (2102x1118, 11 rows; the site
// also serves the same image scaled, e.g. 1600x851). Every value is a
// fraction of the image *width*, since the template scales uniformly and the
// height only varies with the number of rows.
const GRID = {
  rowTop0: 195 / 1600, // top edge of the first data row
  rowPitch: 53.33 / 1600,
  footer: 70 / 1600, // "Změna drah vyhrazena..." strip below the last row
  col0Center: 304 / 1600,
  colPitch: 81 / 1600,
  cellW: 52 / 1600,
  cellH: 42 / 1600,
  dateCenter: 185 / 1600,
  dateW: 140 / 1600,
};

function isScheduleImage(src) {
  const name = decodeURIComponent(src).toLowerCase();
  return /rozpis|rozvrh/.test(name) || /bazén.*\d{4}/.test(name);
}

async function findScheduleImageUrl(page) {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const srcs = await page.$$eval('img', (imgs) => imgs.map((img) => img.getAttribute('src') || ''));
  return srcs.find(isScheduleImage) || null;
}

async function crop(imageBuffer, W, { centerX, centerY, width, height }) {
  return sharp(imageBuffer)
    .extract({
      left: Math.round((centerX - width / 2) * W),
      top: Math.round((centerY - height / 2) * W),
      width: Math.round(width * W),
      height: Math.round(height * W),
    })
    .greyscale()
    .resize({ width: Math.round(width * W * 3) })
    .toBuffer();
}

function rowCenter(rowIdx) {
  return GRID.rowTop0 + (rowIdx + 0.5) * GRID.rowPitch;
}

// "26. 11. 2026" -> "2026-11-26"
function parseRowDate(text) {
  const m = text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBetween(aISO, bISO) {
  return Math.round((Date.parse(bISO + 'T00:00:00Z') - Date.parse(aISO + 'T00:00:00Z')) / 86400000);
}

const OCR_NOTE_CS =
  'Počet volných drah je získán automatickým rozpoznáním textu z rozpisu (obrázku) na webu TJ Tesla. Konkrétní čísla drah (Dráha 1, 2, ...) jsou orientační - důležitý je jen celkový počet volných drah.';

async function scrapeFromImage(imgUrl) {
  const imgResp = await fetch(imgUrl);
  if (!imgResp.ok) throw new Error(`failed to download schedule image: HTTP ${imgResp.status}`);
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  const { width: W, height: H } = await sharp(imgBuffer).metadata();
  const { data: pixels, info } = await sharp(imgBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Cells with no free lane have a red background. Sampled just inside the
  // cell's left edge (away from the digit) as a fallback when OCR reads
  // nothing at all - tesseract occasionally drops a lone "0".
  const isRedCell = (centerX, centerY) => {
    const x = Math.round((centerX - GRID.colPitch * 0.4) * W);
    const y = Math.round(centerY * W);
    const i = (y * info.width + x) * info.channels;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    return r > 180 && r - g > 30 && r - b > 30;
  };
  const rowCount = Math.round((H / W - GRID.rowTop0 - GRID.footer) / GRID.rowPitch);
  if (rowCount < 1 || rowCount > 40) throw new Error(`unexpected schedule image layout (${W}x${H}, ${rowCount} rows)`);

  const worker = await createWorker('eng');
  try {
    // Dates: OCR every row's date pill and take the first that parses (back-
    // dated by its row index), so one misread pill doesn't lose the table.
    await worker.setParameters({ tessedit_char_whitelist: '0123456789. ', tessedit_pageseg_mode: '7' });
    let startDate = null;
    for (let r = 0; r < rowCount && !startDate; r++) {
      const buf = await crop(imgBuffer, W, { centerX: GRID.dateCenter, centerY: rowCenter(r), width: GRID.dateW, height: GRID.cellH });
      const parsed = parseRowDate((await worker.recognize(buf)).data.text);
      if (parsed) startDate = addDaysISO(parsed, -r);
    }
    if (!startDate) throw new Error('could not read any date from the schedule image');
    // A rolling schedule should start within a few days of today - anything
    // further off means the OCR misread the date (or the layout changed).
    if (Math.abs(daysBetween(todayISO(), startDate)) > 40) throw new Error(`implausible schedule start date ${startDate}`);

    await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '10' });
    const rawGrid = [];
    for (let r = 0; r < rowCount; r++) {
      const row = [];
      for (let c = 0; c < HOUR_COLUMNS.length; c++) {
        const centerX = GRID.col0Center + c * GRID.colPitch;
        const buf = await crop(imgBuffer, W, { centerX, centerY: rowCenter(r), width: GRID.cellW, height: GRID.cellH });
        const digits = (await worker.recognize(buf)).data.text.replace(/\D/g, '');
        let value = digits ? parseInt(digits, 10) : null;
        if (value !== null && value > 20) value = null;
        if (value === null && isRedCell(centerX, rowCenter(r))) value = 0;
        row.push(value);
      }
      rawGrid.push(row);
    }

    const totalLanes = Math.max(6, ...rawGrid.flat().filter((v) => v !== null));
    return rawGrid
      .map((row, r) => {
        const date = addDaysISO(startDate, r);
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
      })
      .filter((day) => day.date >= todayISO());
  } finally {
    await worker.terminate();
  }
}

export async function scrapeTesla(browser) {
  // The Chromium page is only needed to locate the image URL - it must be
  // closed before OCR starts (keeping it open made scrapeTesla() hang).
  const page = await browser.newPage();
  let imgUrl;
  try {
    imgUrl = await findScheduleImageUrl(page);
  } finally {
    await page.close();
  }

  try {
    if (!imgUrl) throw new Error('schedule image not found on page');
    const days = await scrapeFromImage(new URL(imgUrl, PAGE_URL).toString());
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, ok: true, error: null, days, occupancy: [], webcams: [], closureNotice: null };
  } catch (err) {
    return { venue: 'tesla', name: 'TJ Tesla Brno - Bazén 25m', url: PAGE_URL, ok: false, error: err.message, days: [], occupancy: [], webcams: [], closureNotice: null };
  }
}
