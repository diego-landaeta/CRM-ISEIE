// Extrae las 2 paginas del PDF de referencia del certificado ISEIE como PNG
// de alta resolucion para usarlas como background-image del template HTML.
//
// Resultado: backend/src/modules/documents/assets/cert-bg-p1.png y cert-bg-p2.png
//
// Uso: node backend/scripts/extract-cert-bg.mjs "C:/path/al/Iris Alvarez-Certificado ISEIE.pdf"

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../src/modules/documents/assets');

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node extract-cert-bg.mjs <pdf-path>');
  process.exit(1);
}

const pdfUrl = pathToFileURL(path.resolve(pdfPath)).href;
console.log('PDF:', pdfPath);
console.log('Output dir:', ASSETS_DIR);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  // Cargar el PDF con pdf.js (via mozilla viewer integrado en Chrome via plugin nativo).
  // Estrategia mas robusta: usar pdf.js cdn via CSP-friendly assets.
  // Mas simple aun: ejecutar pdf.js inline cargando el ArrayBuffer del PDF.
  const pdfBuf = await fs.readFile(pdfPath);
  const pdfB64 = pdfBuf.toString('base64');

  const page = await browser.newPage();
  await page.setViewport({ width: 2480, height: 1754, deviceScaleFactor: 1 }); // A4 landscape @ 300dpi

  // HTML que usa pdf.js para renderizar cada pagina del PDF a un canvas grande
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff;}canvas{display:block;}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
<canvas id="c"></canvas>
<script>
window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
async function render(pageNum) {
  const raw = atob('${pdfB64}');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 3 }); // alta resolucion
  const canvas = document.getElementById('c');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}
window.__renderPage = render;
</script>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'networkidle0' });
  // Esperar a que pdfjsLib este cargado
  await page.waitForFunction(() => typeof window.pdfjsLib !== 'undefined', { timeout: 15000 });

  for (let p = 1; p <= 2; p++) {
    console.log(`Renderizando pagina ${p}...`);
    const dataUrl = await page.evaluate(async (n) => await window.__renderPage(n), p);
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const outPath = path.join(ASSETS_DIR, `cert-bg-p${p}.png`);
    await fs.writeFile(outPath, Buffer.from(base64, 'base64'));
    const stat = await fs.stat(outPath);
    console.log(`  -> ${outPath} (${(stat.size / 1024).toFixed(0)} KB)`);
  }

  console.log('OK');
} finally {
  await browser.close();
}
