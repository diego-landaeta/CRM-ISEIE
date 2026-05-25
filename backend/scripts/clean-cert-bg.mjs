// Toma cert-bg-p1.png (PDF de Iris renderizado, con datos bakeados) y borra
// las zonas de texto dinámico pintando rectángulos del color crema del fondo.
// El resultado es un fondo limpio reutilizable para cualquier alumno.
//
// Las zonas se definen en porcentajes (left, top, width, height) sobre A4 landscape.

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, '../src/modules/documents/assets');

const CERT_CREMA = '#F6EFDA';

// Zonas a borrar en p1 — porcentajes left/top/width/height del canvas
const ZONES_P1 = [
  { l: 14, t: 33, w: 72, h: 11, label: 'nombre cursivo' },         // Iris Cristina Alvarez acosta
  { l: 18, t: 45, w: 64, h: 4,  label: 'datos personales' },        // Nacida el ..., PASAPORTE: ..., Nacionalidad: ...
  { l: 18, t: 49, w: 64, h: 4,  label: 'intro curso' },             // por haber cursado en el año ...
  { l: 28, t: 54, w: 44, h: 6,  label: 'curso titulo' },            // Curso de Ventas
  { l: 9,  t: 60, w: 82, h: 4,  label: 'puntuacion' },              // Con una puntuación de 95,40 sobre 100. ...
  { l: 30, t: 64, w: 40, h: 4,  label: 'valencia espana fecha' },   // Valencia, España 21 de mayo de 2026.
  { l: 10, t: 77, w: 31, h: 7,  label: 'firma alumno' },            // IRIS ALVAREZ
];

// Zonas a borrar en p2 — solo curso, ECTS, y la lista de materias (sin tocar
// el header "Tipo de materia | Créditos ECTS* | Materia | Carácter")
const ZONES_P2 = [
  { l: 8,  t: 11, w: 40, h: 6,  label: 'curso titulo p2' },         // Curso de Ventas
  { l: 24, t: 27, w: 7,  h: 3,  label: 'ECTS valor' },              // 4
  { l: 35, t: 30, w: 43, h: 32, label: 'lista materias' },          // 10 materias (no el "OB" derecha)
];

async function cleanPng(inputPng, outputPng, zones) {
  const b64 = (await fs.readFile(inputPng)).toString('base64');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 2480, height: 1754, deviceScaleFactor: 1 });
    const zonesJson = JSON.stringify(zones);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;}canvas{display:block;}</style></head><body>
<canvas id="c"></canvas>
<script>
const img = new Image();
img.onload = () => {
  const c = document.getElementById('c');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = '${CERT_CREMA}';
  const zones = ${zonesJson};
  for (const z of zones) {
    const x = (z.l / 100) * img.width;
    const y = (z.t / 100) * img.height;
    const w = (z.w / 100) * img.width;
    const h = (z.h / 100) * img.height;
    ctx.fillRect(x, y, w, h);
  }
  window.__out = c.toDataURL('image/png');
  window.__done = true;
};
img.onerror = (e) => { window.__err = String(e); };
img.src = 'data:image/png;base64,${b64}';
</script>
</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__done || window.__err, { timeout: 30000 });
    const err = await page.evaluate(() => window.__err);
    if (err) throw new Error(err);
    const dataUrl = await page.evaluate(() => window.__out);
    const out64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    await fs.writeFile(outputPng, Buffer.from(out64, 'base64'));
    console.log(`OK ${outputPng}`);
  } finally {
    await browser.close();
  }
}

await cleanPng(
  path.join(ASSETS_DIR, 'cert-bg-p1.png'),
  path.join(ASSETS_DIR, 'cert-bg-p1.png'),
  ZONES_P1,
);
await cleanPng(
  path.join(ASSETS_DIR, 'cert-bg-p2.png'),
  path.join(ASSETS_DIR, 'cert-bg-p2.png'),
  ZONES_P2,
);
console.log('DONE');
