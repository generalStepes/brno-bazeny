import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(__dirname, '..', '..', 'docs', 'images');

// Downloads each webcam still image and saves it under docs/images, so the
// site can show it directly without hot-linking the venue's own server (and
// without needing a browser - these are plain static JPEGs the camera
// system overwrites periodically).
export async function downloadWebcams(webcams) {
  await mkdir(IMAGES_DIR, { recursive: true });
  const results = [];
  for (const { label, url, filename } of webcams) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(join(IMAGES_DIR, filename), buffer);
      results.push({ label, path: `images/${filename}` });
    } catch (err) {
      console.error(`Failed to download webcam "${label}": ${err.message}`);
    }
  }
  return results;
}
