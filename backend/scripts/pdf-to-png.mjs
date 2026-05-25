// Convierte un PDF a PNGs (1 por pagina) en una carpeta de salida.
// Uso: node backend/scripts/pdf-to-png.mjs <pdf-path> <output-dir> [prefix]

import puppeteer from 'puppeteer';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs/promises';

const pdfPath = process.argv[2];
const outDir = process.argv[3];
const prefix = process.argv[4] || 'page';
if (!pdfPath || !outDir) {
  console.error('Usage: node pdf-to-png.mjs <pdf-path> <output-dir> [prefix]');
  process.exit(1);
}

await fs.mkdir(outDir, { recursive: true });
const pdfBuf = await fs.readFile(pdfPath);
const pdfB64 = pdfBuf.toString('base64');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 2480, height: 1754, deviceScaleFactor: 1 });
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;}canvas{display:block;}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head><body><canvas id="c"></canvas><script>
window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
async function render(n) {
  const raw = atob('${pdfB64}');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  const total = pdf.numPages;
  const p = await pdf.getPage(n);
  const v = p.getViewport({ scale: 3 });
  const canvas = document.getElementById('c');
  canvas.width = v.width; canvas.height = v.height;
  await p.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise;
  return { dataUrl: canvas.toDataURL('image/png'), total };
}
window.__r = render;
</script></body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof window.pdfjsLib !== 'undefined', { timeout: 15000 });
  const first = await page.evaluate(async () => await window.__r(1));
  const total = first.total;
  for (let n = 1; n <= total; n++) {
    const { dataUrl } = n === 1 ? first : await page.evaluate(async (i) => await window.__r(i), n);
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const out = path.join(outDir, `${prefix}-${n}.png`);
    await fs.writeFile(out, Buffer.from(b64, 'base64'));
    console.log(out);
  }
} finally {
  await browser.close();
}
