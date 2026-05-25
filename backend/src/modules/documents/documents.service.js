import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// UPLOAD_DIR: en prod (Linux) se monta en /var/crm-uploads/documents via .env.
// En local (Windows/macOS) cae a backend/uploads/documents si no se setea.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../../uploads/documents');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Logo ISEIE (color) cargado una vez al iniciar el módulo.
// Proviene de frontend/public/iseie-logo-color.png.
const ISEIE_LOGO_DATAURL = `data:image/png;base64,${readFileSync(path.join(ASSETS_DIR, 'iseie-logo.png')).toString('base64')}`;
// Sello institucional ISEIE (circular, con NIF B67799247).
// Si el archivo no existe (no se ha subido), pasamos null al template y se omite.
const ISEIE_SELLO_DATAURL = (() => {
  try {
    return `data:image/png;base64,${readFileSync(path.join(ASSETS_DIR, 'iseie-sello.png')).toString('base64')}`;
  } catch {
    return null;
  }
})();
// Compat: legacy referencias a PSIKO_LOGO_DATAURL apuntan ahora al logo ISEIE.
const PSIKO_LOGO_DATAURL = ISEIE_LOGO_DATAURL;

// Fuentes embebidas como base64 (puppeteer bloquea fonts.googleapis.com para
// evitar timeouts; @font-face con data: funciona en el navegador del modal y
// en Chromium headless). Todas con licencia libre comercial (OFL):
// - Pinyon Script: nombre cursivo del alumno (Google Fonts)
// - Sanchez: titulo de cursos en certificado (Google Fonts)
// - Plus Jakarta Sans: cuerpo de certificado y factura — sustituto libre,
//   visualmente cercano a Garet (Latinotype, paid) y Now (Latinotype, paid)
const PINYON_SCRIPT_B64 = readFileSync(path.join(ASSETS_DIR, 'PinyonScript.ttf')).toString('base64');
const SANCHEZ_B64 = readFileSync(path.join(ASSETS_DIR, 'Sanchez-Regular.ttf')).toString('base64');
const PJS_REG_B64 = readFileSync(path.join(ASSETS_DIR, 'PlusJakartaSans-Regular.ttf')).toString('base64');
const PJS_MED_B64 = readFileSync(path.join(ASSETS_DIR, 'PlusJakartaSans-Medium.ttf')).toString('base64');
const PJS_BOLD_B64 = readFileSync(path.join(ASSETS_DIR, 'PlusJakartaSans-Bold.ttf')).toString('base64');
// Plus Jakarta Sans se reutiliza en certificado y factura como cuerpo.
const PJS_FACES = `
@font-face { font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 400; src: url(data:font/ttf;base64,${PJS_REG_B64}) format('truetype'); }
@font-face { font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 500; src: url(data:font/ttf;base64,${PJS_MED_B64}) format('truetype'); }
@font-face { font-family: 'Plus Jakarta Sans'; font-style: normal; font-weight: 700; src: url(data:font/ttf;base64,${PJS_BOLD_B64}) format('truetype'); }
`;
const CERT_FONTS_CSS = `
@font-face { font-family: 'Pinyon Script'; font-style: normal; font-weight: 400; src: url(data:font/ttf;base64,${PINYON_SCRIPT_B64}) format('truetype'); }
@font-face { font-family: 'Sanchez'; font-style: normal; font-weight: 400; src: url(data:font/ttf;base64,${SANCHEZ_B64}) format('truetype'); }
${PJS_FACES}
`;
const INVOICE_FONTS_CSS = PJS_FACES;

async function ensureDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

async function imgBase64(filename) {
  const buf = await fs.readFile(path.join(ASSETS_DIR, filename));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'];

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

async function htmlToPdf(html, filename, opts = {}) {
  await ensureDir();
  const filePath = path.join(UPLOAD_DIR, filename);
  // En prod (Linux) puede pasarse CHROME_PATH en env; en local Windows
  // puppeteer (full package) trae Chrome bundleado y lo auto-detecta.
  const launchOpts = { headless: 'new', args: CHROME_ARGS };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await newPage(browser);
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const pdfOpts = {
      path: filePath,
      printBackground: true,
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      ...opts,
    };
    await page.pdf(pdfOpts);
  } finally {
    await browser.close();
  }
  return filePath;
}


// ============================================================
// TEMPLATE: FACTURA
// ============================================================
/**
 * Detecta el tipo de documento fiscal espanol por su formato.
 * - CIF: empresa (letra + 7 digitos + digito/letra). Ej: A58432469
 * - NIE: extranjero (X|Y|Z + 7 digitos + letra). Ej: X1234567A
 * - DNI: persona fisica (8 digitos + letra). Ej: 12345678A
 * - NIF: alias generico para DNI cuando se usa fiscalmente
 * Default: NIF si no se reconoce el patron.
 */
function detectDocType(doc) {
  const v = String(doc || '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) return 'CIF';
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) return 'NIE';
  if (/^\d{8}[A-Z]$/.test(v)) return 'DNI';
  return 'NIF';
}

import { buildIseieInvoiceHtml, ISEIE_EMISOR } from './_iseie_invoice_template.js';

// ============================================================
// TEMPLATE: FACTURA ISEIE (single page, branding institucional)
// ============================================================
// Replica los 3 layouts oficiales que el cliente proporcionó:
//   tipo = 'persona_natural' | 'empresa' | 'contado'
//
// Reemplaza el template heredado pixel-perfect Canva del CRM hermano
// (legacy CRM hermano rosa-palo). El nuevo template es institucional: emisor a la
// izquierda, logo ISEIE arriba a la derecha, número/fecha, FACTURA A:
// (condicional por tipo), tabla descripción-importe, totales con IVA 0%
// exento, sello circular bottom-right y datos registrales al pie.
export function buildInvoiceHtml(data) {
  return buildIseieInvoiceHtml(data, {
    logoDataUrl: ISEIE_LOGO_DATAURL,
    selloDataUrl: ISEIE_SELLO_DATAURL,
    fontsCss: INVOICE_FONTS_CSS,
  });
}

// El multi-page del legacy CRM hermano ya no aplica: las facturas ISEIE
// son siempre 1 página (1-2 líneas de servicio académico). Si el HTML
// excede 297mm, el navegador parte naturalmente. Reutiliza el mismo render.
export function buildInvoiceHtmlMultiPage(data) {
  return buildInvoiceHtml(data);
}

void ISEIE_EMISOR; // re-export silencioso para evitar dead-code warning.


// Preview factura: lienzo A4 centrado sobre fondo gris (paridad con cert preview).
// La pagina A4 (210x297mm) puede no caber en iframes estrechos, asi que un
// script inline auto-ajusta el scale para que la pagina entera quepa siempre
// en el viewport del iframe (sin scroll interno). El sizing real lo hace
// `.page` del template original; aqui descartamos las reglas html/body
// (que reapuntarian el documento del iframe) y envolvemos en `.invoice-frame`.
export function buildInvoicePreviewHtml(data) {
  const fullHtml = buildInvoiceHtml(data);
  const styleMatch = fullHtml.match(/<style>([\s\S]*?)<\/style>/);
  const bodyMatch = fullHtml.match(/<body>([\s\S]*?)<\/body>/i);
  const originalStyles = styleMatch ? styleMatch[1] : '';
  const bodyContent = bodyMatch ? bodyMatch[1] : '';

  // Limpieza: quita las reglas `html, body { ... }` y `body { ... }` del
  // template porque el wrapper del preview impone sus propias reglas en el
  // body (display:flex, padding, etc.). Usamos lookbehind para NO consumir
  // la `}` del bloque anterior — antes era `(?:^|\n|\})` que se comía la
  // llave previa y dejaba el CSS desbalanceado, rompiendo todo el parseo.
  const stylesClean = originalStyles
    .replace(/(?<=^|\n|\})\s*html\s*,\s*body[^{}]*\{[^{}]*\}/g, '')
    .replace(/(?<=^|\n|\})\s*body[^{}]*\{[^{}]*\}/g, '');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --fit: 0.6; --zoom: 1; }
  html, body { min-width: 100%; min-height: 100%; }
  body {
    background: #e5e7eb;
    padding: 20px;
    display: flex;
    justify-content: safe center;
    align-items: safe center;
    min-width: min-content;
    font-family: 'Plus Jakarta Sans', 'Open Sans', 'Helvetica Neue', Arial, sans-serif;
    overflow: auto;
    touch-action: pan-x pan-y;
  }
  .invoice-frame {
    width: calc(210mm * var(--fit) * var(--zoom));
    height: calc(297mm * var(--fit) * var(--zoom));
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18);
    background: #fff;
  }
  .invoice-frame > .page {
    transform: scale(calc(var(--fit) * var(--zoom)));
    transform-origin: top left;
  }
  ${stylesClean}
</style>
</head>
<body>
  <div class="invoice-frame">${bodyContent}</div>
  <script>
    // Auto-fit: calcula --fit para que la pagina A4 entera quepa en el
    // viewport del iframe (con padding de 40px). El --zoom (controlado desde
    // el modal padre) multiplica el fit para zoom in/out manual.
    (function() {
      var NATIVE_W = 210 * 96 / 25.4;
      var NATIVE_H = 297 * 96 / 25.4;
      function fit() {
        var availW = window.innerWidth - 40;
        var availH = window.innerHeight - 40;
        var s = Math.min(availW / NATIVE_W, availH / NATIVE_H);
        document.documentElement.style.setProperty('--fit', s.toFixed(4));
      }
      fit();
      window.addEventListener('resize', fit);
    })();
  </script>
</body>
</html>`;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────
// SVG compartido de ondas doradas (igual en ambas páginas del certificado)
const CERT_WAVES_SVG = `
<svg class="bg-waves" viewBox="0 0 1122 794" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="gTop" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#F9EDA0" stop-opacity="0.5"/>
      <stop offset="35%"  stop-color="#D4AA50" stop-opacity="0.75"/>
      <stop offset="70%"  stop-color="#C9A84C" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#A07828" stop-opacity="0.6"/>
    </linearGradient>
    <linearGradient id="gBot" x1="100%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%"   stop-color="#F9EDA0" stop-opacity="0.5"/>
      <stop offset="35%"  stop-color="#D4AA50" stop-opacity="0.75"/>
      <stop offset="70%"  stop-color="#C9A84C" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#A07828" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <!-- Grupo superior-izquierda: cintas fluidas -->
  <path d="M-20 350 C80 200 280 60 560 -10 C800 -60 1050 20 1122 80
           L1122 20 C1040 -20 790 -90 540 -40 C270 20 60 170 -20 330 Z"
        fill="url(#gTop)" opacity="0.30"/>
  <path d="M-20 230 C60 120 220 30 450 -10 C650 -45 880 30 1050 120
           L1050 60 C870 -20 640 -90 430 -40 C200 20 50 110 -20 200 Z"
        fill="url(#gTop)" opacity="0.55"/>
  <path d="M-20 140 C50 60 170 0 360 -15 C520 -28 700 40 860 130
           L860 70 C700 -20 510 -70 350 -50 C160 -28 40 40 -20 110 Z"
        fill="url(#gTop)" opacity="0.75"/>
  <path d="M-20 75 C30 20 130 -20 280 -20 C420 -20 560 50 680 110
           L680 60 C560 0 415 -60 275 -55 C125 -48 25 10 -20 50 Z"
        fill="url(#gTop)" opacity="0.90"/>
  <!-- Grupo inferior-derecha: cintas fluidas (espejo) -->
  <path d="M1142 444 C1062 594 862 734 582 804 C322 860 72 774 0 714
           L0 774 C82 830 342 910 602 844 C882 774 1072 624 1142 474 Z"
        fill="url(#gBot)" opacity="0.30"/>
  <path d="M1142 564 C1082 674 922 764 692 804 C472 841 242 764 72 674
           L72 734 C252 820 482 894 712 844 C942 784 1092 684 1142 604 Z"
        fill="url(#gBot)" opacity="0.55"/>
  <path d="M1142 654 C1092 734 952 794 762 814 C602 830 422 754 262 664
           L262 724 C432 808 612 874 772 850 C962 820 1102 750 1142 684 Z"
        fill="url(#gBot)" opacity="0.75"/>
  <path d="M1142 719 C1112 774 992 814 842 814 C702 814 562 744 442 684
           L442 734 C565 790 705 860 845 854 C998 844 1118 794 1142 749 Z"
        fill="url(#gBot)" opacity="0.90"/>
</svg>`;

// ============================================================
// TEMPLATE: CERTIFICADO página 1
// ============================================================
// Los fondos `cert-bg-p1.png` y `cert-bg-p2.png` heredados del CRM hermano
// traen elementos visuales bakeados (logo + firmas) que NO aplican a ISEIE.
// Hay que sustituirlos por los fondos de certificado ISEIE cuando lleguen.
// Mientras tanto, este template overlaya el texto dinámico (nombre, DNI,
// curso, fechas) y omite la línea de aval que mencionaba entidades hermanas.

export async function buildCertP1Html(data) {
  const bgUrl = await imgBase64('cert-bg-p1.png');
  const {
    alumno_nombre, alumno_dni,
    curso_nombre,
    horas_total, fecha_inicio, fecha_fin,
    ciudad = 'Valencia', pais = 'España', fecha_expedicion,
  } = data;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  ${CERT_FONTS_CSS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width:297mm; height:210mm; overflow:hidden; }
  .page {
    width: 297mm; height: 210mm; position: relative;
    background-image: url('${bgUrl}');
    background-size: 100% 100%;
    background-repeat: no-repeat;
    font-family: 'Plus Jakarta Sans', 'Open Sans', 'Helvetica Neue', Arial, sans-serif;
    color: #1a1a1a;
  }
  /* Texto dinámico posicionado absolutamente sobre el fondo Canva */
  .t { position: absolute; left: 0; right: 0; text-align: center; }
  .alumno-name {
    top: 36%;
    font-family: 'Pinyon Script', 'Brush Script MT', cursive;
    font-size: 38pt; color: #C9A84C; line-height: 1;
    font-weight: 400;
  }
  .subtitle {
    top: 47%;
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt; color: #1a1a1a; letter-spacing: 0.2pt;
  }
  .curso-nombre {
    top: 52%;
    font-family: 'Sanchez', Georgia, 'Times New Roman', serif;
    font-size: 22pt; font-weight: 400; color: #1a1a1a; line-height: 1.2;
    padding: 0 22mm;
  }
  .cuerpo {
    top: 62%;
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt; color: #1a1a1a; line-height: 1.5;
    padding: 0 26mm;
  }
  .aval {
    top: 71%;
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt; font-weight: 700; color: #1a1a1a; padding: 0 22mm;
  }
</style>
</head>
<body>
<div class="page">

  <div class="t alumno-name">${alumno_nombre || ''}</div>

  <div class="t subtitle">
    con DNI: ${alumno_dni || ''}, ha superado con éxito los objetivos establecidos para el:
  </div>

  <div class="t curso-nombre">${curso_nombre || ''}</div>

  <div class="t cuerpo">
    Por un total de ${horas_total || ''} horas teórico prácticas. Inicio el ${fecha_inicio || ''} y finalizado el ${fecha_fin || ''}.<br/>
    ${ciudad}, ${pais} ${fecha_expedicion || ''}.
  </div>

  <div class="t aval">
    Este certificado ha sido expedido por ISEIE Innovation School S.L.
  </div>

</div>
</body>
</html>`;
}

// ============================================================
// TEMPLATE: CERTIFICADO página 2 — Plan de estudios
// ============================================================
export async function buildCertP2Html(data) {
  const bgUrl = await imgBase64('cert-bg-p2.png');
  const {
    curso_nombre,
    modalidad = 'Online',
    horas_total,
    modulos = [],
  } = data;

  const modulosHtml = modulos.map((m, i) =>
    `<li><strong>Módulo ${i + 1}:</strong> ${m}</li>`
  ).join('');

  // Densidad de la lista segun la cantidad de modulos. La columna disponible
  // tiene aprox 138mm de alto. A 9pt × 1.6 line-height = ~5mm por linea, caben
  // ~25 modulos antes de overflow. Comprimimos progresivamente.
  const moduloCount = modulos.length;
  const listDensityClass = moduloCount > 18 ? 'dense' : moduloCount > 12 ? 'compact' : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  ${CERT_FONTS_CSS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width:297mm; height:210mm; overflow:hidden; font-family: 'Plus Jakarta Sans', 'Open Sans', 'Helvetica Neue', Arial, sans-serif; }
  .page {
    width:297mm; height:210mm; position:relative;
    background-image: url('${bgUrl}');
    background-size: 100% 100%;
    background-repeat: no-repeat;
  }
  .content {
    position: absolute;
    top: 22mm; left: 30mm; right: 30mm;
    bottom: 50mm;
  }
  .curso-title {
    font-family: 'Sanchez', Georgia, 'Times New Roman', serif;
    font-size: 22pt; font-weight: 400;
    text-align: center; color: #1a1a1a;
    margin-bottom: 10mm;
  }
  .plan-title {
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt; font-weight: 700;
    color: #1a1a1a; margin-bottom: 4mm;
  }
  .plan-grid {
    display: grid;
    grid-template-columns: 32mm 36mm 1fr;
    gap: 0 8mm; align-items: start;
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
  }
  .col-label {
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9pt; font-weight: 700; color: #1a1a1a; margin-bottom: 1.5mm;
  }
  .col-value {
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    font-size: 9pt; color: #333;
  }
  .modulos-list {
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    list-style: disc inside; padding-left: 0;
    font-size: 9pt; line-height: 1.6; color: #222;
  }
  .modulos-list li { margin-bottom: 0.5mm; }
  .modulos-list li strong { color: #1a1a1a; font-weight: 700; }
  .modulos-list.compact { font-size: 8pt; line-height: 1.4; }
  .modulos-list.compact li { margin-bottom: 0.3mm; }
  .modulos-list.dense { font-size: 7pt; line-height: 1.3; }
  .modulos-list.dense li { margin-bottom: 0.2mm; }
</style>
</head>
<body>
<div class="page">
  <div class="content">
    <div class="curso-title">${curso_nombre || ''}</div>
    <div class="plan-title">Distribución General del Plan de Estudios</div>
    <div class="plan-grid">
      <div>
        <div class="col-label">Modalidad:</div>
        <div class="col-value">${modalidad}</div>
      </div>
      <div>
        <div class="col-label">Horas de formación:</div>
        <div class="col-value">${horas_total || ''}</div>
      </div>
      <div>
        <div class="col-label">Programa formativo</div>
        <ul class="modulos-list ${listDensityClass}">${modulosHtml}</ul>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ============================================================
// Generar PDF factura — single page (template ISEIE)
// ============================================================
// El template ISEIE incluye datos registrales en el propio HTML, sin
// necesidad de footerTemplate de puppeteer. Las facturas son siempre 1
// página (1-2 líneas de servicio académico).
export async function generateInvoicePdf(data, filename) {
  return htmlToPdf(buildInvoiceHtml(data), filename);
}

export async function generateCertificatePdf(data, filename) {
  await ensureDir();
  const filePath = path.join(UPLOAD_DIR, filename);
  // En prod (Linux) puede pasarse CHROME_PATH en env; en local Windows
  // puppeteer (full package) trae Chrome bundleado y lo auto-detecta.
  const launchOpts = { headless: 'new', args: CHROME_ARGS };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await newPage(browser);
    // Página 1
    await page.setContent(await buildCertP1Html(data), { waitUntil: 'domcontentloaded', timeout: 15000 });
    const p1 = await page.pdf({ printBackground: true, format: 'A4', landscape: true });
    // Página 2
    await page.setContent(await buildCertP2Html(data), { waitUntil: 'domcontentloaded', timeout: 15000 });
    const p2 = await page.pdf({ printBackground: true, format: 'A4', landscape: true });

    // Merge PDFs con pdf-lib
    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();
    for (const pdfBytes of [p1, p2]) {
      const doc = await PDFDocument.load(pdfBytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const mergedBytes = await merged.save();
    await fs.writeFile(filePath, mergedBytes);
  } finally {
    await browser.close();
  }
  return filePath;
}

// Preview combinado certificado: cada página se aisla via prefijo CSS
// (.cert-page-1 / .cert-page-2). Los iframes anidados rompian el sizing en mm
// dentro del iframe del modal porque el width:100%/height:100% del iframe
// hijo no se computaba contra los 297mm/210mm declarados del padre. Aqui
// inlineamos los dos cuerpos en el mismo documento y cada selector del CSS
// original se prefija con su clase de scope para evitar colisiones.
export async function buildCertPreviewHtml(data) {
  const p1Html = await buildCertP1Html(data);
  const p2Html = await buildCertP2Html(data);

  function extract(html) {
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/i);
    return {
      css: styleMatch ? styleMatch[1] : '',
      body: bodyMatch ? bodyMatch[1] : '',
    };
  }

  // Prefija cada selector top-level con `scope ` (combinador descendiente).
  // Reglas que solo seleccionan html/body se descartan (la pagina ya tiene
  // sus dimensiones via .page). El strip se hace dentro de la misma pasada
  // para no comerse la `}` de la regla anterior.
  function scopeCss(css, scope) {
    return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_m, sels, props) => {
      const parts = sels.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.every(s => /^(?:html|body)\b/.test(s))) return '';
      const scoped = parts.map(s => {
        if (s.startsWith('@')) return s;
        if (/^(?:html|body)\b/.test(s)) return scope;
        return `${scope} ${s}`;
      }).join(', ');
      return `${scoped} { ${props} }`;
    });
  }

  const p1 = extract(p1Html);
  const p2 = extract(p2Html);
  const cssP1 = scopeCss(p1.css, '.cert-page-1');
  const cssP2 = scopeCss(p2.css, '.cert-page-2');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --fit: 0.6; --zoom: 1; }
  html, body { min-width: 100%; min-height: 100%; }
  body {
    background: #e5e7eb;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: safe center;
    justify-content: safe center;
    min-width: min-content;
    font-family: Arial, Helvetica, sans-serif;
    overflow: auto;
    touch-action: pan-x pan-y;
  }
  .cert-frame {
    width: calc(297mm * var(--fit) * var(--zoom));
    height: calc(210mm * var(--fit) * var(--zoom));
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18);
    background: #fff;
  }
  .cert-page-1, .cert-page-2 {
    width: 297mm; height: 210mm;
    transform: scale(calc(var(--fit) * var(--zoom)));
    transform-origin: top left;
  }
  ${cssP1}
  ${cssP2}
</style>
</head>
<body>
  <div class="cert-frame"><div class="cert-page-1">${p1.body}</div></div>
  <div class="cert-frame"><div class="cert-page-2">${p2.body}</div></div>
  <script>
    (function() {
      var NATIVE_W = 297 * 96 / 25.4;
      var NATIVE_H = 210 * 96 / 25.4 * 2 + 12;
      function fit() {
        var availW = window.innerWidth - 32;
        var availH = window.innerHeight - 32;
        var s = Math.min(availW / NATIVE_W, availH / NATIVE_H);
        document.documentElement.style.setProperty('--fit', s.toFixed(4));
      }
      fit();
      window.addEventListener('resize', fit);
    })();
  </script>
</body>
</html>`;
}
