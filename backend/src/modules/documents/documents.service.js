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

// Logo Psikoaprende real (cerebro line-art) cargado una vez al iniciar el módulo.
// El archivo está en assets/psiko-logo.png y proviene de frontend/public/projects/psiko-aprende-light.png.
const PSIKO_LOGO_DATAURL = `data:image/png;base64,${readFileSync(path.join(ASSETS_DIR, 'psiko-logo.png')).toString('base64')}`;

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

// Footer template para puppeteer.pdf (multi-pagina). Reproduce la banda
// rosa-palo del Canva original con email + LOPD info en blanco. Caveats de
// puppeteer: font-size default es 0 (hay que setearlo explicito), y ciertos
// bg colors necesitan -webkit-print-color-adjust para imprimirse.
function buildInvoiceFooterTemplate() {
  return `
<style>
  .footer-tpl {
    width: 100%;
    height: 40.8mm;
    background: #DBC4C3 !important;
    color: #fff;
    padding: 2.5mm 6mm 2mm;
    box-sizing: border-box;
    text-align: center;
    font-family: 'Plus Jakarta Sans', Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .footer-tpl .email { font-weight: 700; font-size: 14pt; letter-spacing: 0.3pt; margin-bottom: 2.5mm; }
  .footer-tpl .lopd-title { font-weight: 700; font-size: 8.5pt; letter-spacing: 0.5pt; margin-bottom: 1mm; }
  .footer-tpl .lopd-text { font-size: 8pt; line-height: 1.4; padding: 0 2mm; }
  .footer-tpl .lopd-text p { margin: 0 0 1mm 0; }
  .footer-tpl .lopd-text p:last-child { margin-bottom: 0; }
</style>
<div class="footer-tpl">
  <div class="email">facturacion@psikoaprende.com</div>
  <div class="lopd-title">INFORMACIÓN SOBRE PROTECCIÓN DE DATOS</div>
  <div class="lopd-text">
    <p>Los datos personales tratados para gestionar la relación contractual y, en su caso, para enviar información comercial por medios electrónicos, se conservarán hasta la finalización de la relación, la baja comercial o durante los plazos de retención legalmente establecidos.</p>
    <p>Puede ejercer sus derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad enviando su solicitud a la dirección postal del responsable o al correo electrónico info@psikoaprende.com</p>
  </div>
</div>`;
}

async function htmlToPdfLandscape(html, filename) {
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
    await page.pdf({ path: filePath, printBackground: true, format: 'A4', landscape: true });
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

export function buildInvoiceHtml(data) {
  const {
    numero, fecha,
    emisor_nombre, emisor_nif, emisor_direccion, emisor_telefono,
    cliente_nombre, cliente_dni, cliente_direccion,
    lineas = [],
    notas = '',
    iva_pct = 21,
    iva_exento = false,
  } = data;

  const subtotal = lineas.reduce((s, l) => s + (parseFloat(l.precio) * parseInt(l.cantidad || 1)), 0);
  const iva = iva_exento ? 0 : subtotal * (iva_pct / 100);
  const total = subtotal + iva;
  const clienteDocLabel = detectDocType(cliente_dni);

  // Formato fecha DD-MM-YYYY (matching el diseño Canva del usuario).
  // fecha viene del form como ISO YYYY-MM-DD.
  function formatFecha(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso);
  }
  const fechaFmt = formatFecha(fecha);

  const fmtEur = n => n.toFixed(2).replace('.', ',') + ' €';

  // Renderizado pixel-perfect del pptx Canva. Coordenadas tomadas del archivo
  // (EMU/36000 = mm) — slide A4 portrait 210x297mm. Capas top-to-bottom:
  // 1) Banda rosa-palo full-width (#DBC4C3) en y=0-20mm.
  // 2) Pentagon-house dropdown (#F2E6E5) colgando desde el top, x=125.8-184.5mm,
  //    y=0-75mm, con clip-path. Contiene el logo + label "FACTURA NÚMERO" +
  //    pill blanco con el número.
  // 3) FACTURA + emisor (lado izquierdo, y=32-79mm).
  // 4) DATOS DEL CLIENTE (y=87-130mm) + FECHA (top-right).
  // 5) Tabla items con header rosa-palo (y=130.7-188.5mm).
  // 6) Sello/Firma + Totals boxes (y=194-256mm), ambos con fondo #F2E6E5.
  // 7) Banda rosa-palo footer full-width con email + LOPD info en blanco.
  // Densidad de la tabla segun la cantidad de lineas — evita que la tabla
  // empuje el sello/totales fuera del area disponible (130-256mm = 126mm).
  // Espacio para items: 126mm - 12mm header - 65mm sello/totales = ~49mm.
  // 9mm/fila => 5 lineas. Mas que eso entra modo compacto/denso.
  const lineCount = lineas.length;
  const tableDensityClass = lineCount > 12 ? 'dense' : lineCount > 6 ? 'compact' : '';

  // La tabla crece con el numero real de lineas. Si no hay ninguna se muestra
  // una fila placeholder vacia para que la tabla siga siendo visible.
  const lineasHtml = (lineas.length > 0 ? lineas : [{ descripcion: '', cantidad: '', precio: '' }]).map((l) => {
    const precio = parseFloat(l.precio || 0);
    const cantidad = parseInt(l.cantidad || 0) || (l.descripcion ? 1 : '');
    const totalLinea = precio && cantidad ? fmtEur(precio * cantidad) : '';
    return `<tr>
      <td class="col-desc">${l.descripcion || ''}</td>
      <td class="col-num">${cantidad || ''}</td>
      <td class="col-num">${precio ? fmtEur(precio) : ''}</td>
      <td class="col-num">${totalLinea}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  ${INVOICE_FONTS_CSS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 210mm; min-height: 297mm;
    font-family: 'Plus Jakarta Sans', 'Open Sans', 'Helvetica Neue', Arial, sans-serif;
    color: #000;
    background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    width: 210mm; height: 297mm; position: relative;
    overflow: hidden;
    background: #fff;
  }

  /* ── Top: banda rosa-palo full-width + pentagon dropdown con logo ── */
  .top-band {
    position: absolute; top: 0; left: 0; right: 0;
    height: 20mm;
    background: #DBC4C3;
    z-index: 0;
  }
  .logo-drop {
    position: absolute; top: 0; left: 125.8mm;
    width: 58.7mm; height: 75.2mm;
    background: #F2E6E5;
    /* Pentagon: top-left, top-right, mid-right (86%), bottom-center (100%), mid-left (86%) */
    clip-path: polygon(0 0, 100% 0, 100% 86%, 50% 100%, 0 86%);
    z-index: 1;
    text-align: center;
  }
  .logo-drop img {
    width: 36mm; height: auto;
    margin: 6mm auto 0;
    display: block;
    object-fit: contain;
  }
  .numero-label {
    position: absolute; top: 40.2mm; left: 125.8mm;
    width: 58.7mm;
    text-align: center;
    font-size: 13pt; font-weight: 700;
    letter-spacing: 1.27pt;
    color: #1a1a1a;
    z-index: 2;
  }
  .numero-pill {
    position: absolute; top: 49.1mm; left: 132.2mm;
    width: 45.9mm; height: 10.9mm;
    background: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 10.4pt; color: #000;
    z-index: 2;
  }

  /* ── Left side: FACTURA title + emisor ── */
  .factura-title {
    position: absolute; top: 32mm; left: 14.3mm;
    font-size: 23.9pt; font-weight: 700;
    letter-spacing: 2.34pt;
    color: #000;
    z-index: 2;
  }
  .emisor-name {
    position: absolute; top: 50.7mm; left: 15.5mm;
    font-size: 11pt; letter-spacing: 1.07pt;
    color: #000;
    z-index: 2;
    text-transform: uppercase;
  }
  .emisor-info {
    position: absolute; top: 57.1mm; left: 14.3mm;
    width: 90mm;
    font-size: 10.4pt; line-height: 1.45;
    letter-spacing: 1pt;
    color: #000;
    z-index: 2;
  }
  .emisor-info > div { margin-bottom: 0.6mm; }

  /* ── FECHA (top-right) ── */
  .fecha-line {
    position: absolute; top: 82.7mm; left: 134mm;
    font-size: 10.4pt; letter-spacing: 1pt;
    color: #000;
    z-index: 2;
  }

  /* ── DATOS DEL CLIENTE ── */
  .cliente-label {
    position: absolute; top: 87mm; left: 15.5mm;
    font-size: 10.4pt; font-weight: 700;
    letter-spacing: 1pt;
    color: #000;
    z-index: 2;
  }
  .cliente-info {
    position: absolute; top: 93.8mm; left: 17.9mm;
    width: 130mm;
    font-size: 10.4pt; line-height: 1.45;
    letter-spacing: 1pt;
    color: #000;
    z-index: 2;
  }
  .cliente-info > div { margin-bottom: 0.6mm; }

  /* Area dinamica: tabla items + sello/totales. Position absolute en el page
     pero por dentro usa flex column con margin-top auto para empujar el
     bottom-row al pie. Asi N items crecen hacia abajo sin solapar el sello. */
  .content-area {
    position: absolute;
    top: 130mm;
    bottom: 41mm;
    left: 14.5mm; right: 14.3mm;
    display: flex;
    flex-direction: column;
    z-index: 2;
  }
  .items-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    flex-shrink: 0;
  }
  .items-table thead th {
    background: #DBC4C3;
    padding: 3mm 0;
    font-size: 10pt; font-weight: 700;
    text-align: center;
    color: #000;
    letter-spacing: 0.3pt;
    border: none;
  }
  .items-table tbody td {
    border: 1px solid #737373;
    border-top: none;
    padding: 2.5mm 4mm;
    font-size: 10.4pt;
    color: #6B6B6B;
    font-weight: 400;
    vertical-align: middle;
    height: 9mm;
  }
  .items-table tbody tr:first-child td { border-top: 1px solid #737373; }
  .items-table .col-desc { text-align: left; }
  .items-table .col-num { text-align: center; }
  .items-table colgroup col:nth-child(1) { width: 72.4mm; }
  .items-table colgroup col:nth-child(2) { width: 21.2mm; }
  .items-table colgroup col:nth-child(3) { width: 44.2mm; }
  .items-table colgroup col:nth-child(4) { width: 43.9mm; }

  /* Modo compacto cuando hay muchas lineas — se aplica via clase para evitar
     que la tabla empuje el sello/totales fuera del area disponible. */
  .items-table.compact tbody td { padding: 1.5mm 4mm; font-size: 9pt; height: 6.5mm; }
  .items-table.dense tbody td { padding: 1mm 3mm; font-size: 8.2pt; height: 5.5mm; }

  /* ── Bottom: Sello/Firma + Totals (push to bottom of content-area) ── */
  .bottom-row {
    margin-top: auto;
    padding-top: 6mm;
    display: flex;
    gap: 7mm;
    align-items: flex-start;
    flex-shrink: 0;
  }
  .sello-box {
    flex: 1;
    height: 55mm;
    background: #F2E6E5;
    border: 1px solid #686868;
    position: relative;
  }
  .sello-box::after {
    content: "Sello / Firma";
    position: absolute; bottom: 3mm; right: 4mm;
    font-size: 8pt; color: #b4969a;
    font-style: italic;
  }
  .totals-wrapper {
    width: 88mm;
    flex-shrink: 0;
  }
  .totals-box {
    width: 100%;
    background: #F2E6E5;
    border: 1px solid #686868;
    padding: 2mm 3mm;
    font-size: 12pt;
    color: #000;
  }
  .totals-row {
    display: flex; justify-content: space-between;
    padding: 0.4mm 1mm;
  }
  .totals-row.total { font-weight: 700; }
  .iva-exento-note {
    margin-top: 2mm;
    font-size: 7.5pt; font-style: italic;
    color: #555;
    line-height: 1.3;
  }

  /* ── Footer rosa-palo (email + LOPD blanco dentro) ── */
  /* Altura 40.8mm del pptx. Email + LOPD calibrados para llenar la banda
     respetando proporciones del Canva original (15pt email, 9pt LOPD). */
  .footer-band {
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 40.8mm;
    background: #DBC4C3;
    color: #fff;
    padding: 2.5mm 6mm 2mm;
    text-align: center;
    z-index: 1;
  }
  .footer-email {
    font-weight: 700;
    font-size: 14pt;
    letter-spacing: 0.3pt;
    margin-bottom: 2.5mm;
  }
  .lopd-title {
    font-weight: 700;
    font-size: 8.5pt;
    letter-spacing: 0.5pt;
    margin-bottom: 1mm;
  }
  .lopd-text {
    font-size: 8pt;
    line-height: 1.4;
    padding: 0 2mm;
  }
  .lopd-text p { margin-bottom: 1mm; }
  .lopd-text p:last-child { margin-bottom: 0; }
</style>
</head>
<body>
  <div class="page">

    <div class="top-band"></div>
    <div class="logo-drop">
      <img src="${PSIKO_LOGO_DATAURL}" alt="Psikoaprende"/>
    </div>
    <div class="numero-label">FACTURA NÚMERO</div>
    <div class="numero-pill">${numero || ''}</div>

    <div class="factura-title">FACTURA</div>
    <div class="emisor-name">${emisor_nombre || ''}</div>
    <div class="emisor-info">
      ${emisor_nif ? `<div>${emisor_nif}</div>` : ''}
      ${(emisor_direccion || '').split('\n').filter(Boolean).map(l => `<div>${l}</div>`).join('')}
      ${emisor_telefono ? `<div>Tel: ${emisor_telefono}</div>` : ''}
    </div>

    <div class="fecha-line">FECHA: ${fechaFmt}</div>

    <div class="cliente-label">DATOS DEL CLIENTE</div>
    <div class="cliente-info">
      ${cliente_nombre ? `<div>Nombre o Razón Social: ${cliente_nombre}</div>` : ''}
      ${cliente_dni ? `<div>${clienteDocLabel}: ${cliente_dni}</div>` : ''}
      ${cliente_direccion ? `<div>Dirección: ${cliente_direccion}</div>` : ''}
    </div>

    <div class="content-area">
      <table class="items-table ${tableDensityClass}">
        <colgroup><col/><col/><col/><col/></colgroup>
        <thead>
          <tr>
            <th>DESCRIPCIÓN</th>
            <th>CANTIDAD</th>
            <th>PRECIO</th>
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${lineasHtml}
        </tbody>
      </table>

      <div class="bottom-row">
        <div class="sello-box"></div>
        <div class="totals-wrapper">
          <div class="totals-box">
            <div class="totals-row"><span>Sub Total</span><span>${fmtEur(subtotal)}</span></div>
            <div class="totals-row"><span>${iva_exento ? 'IVA (exento)' : `IVA (${iva_pct}%)`}</span><span>${fmtEur(iva)}</span></div>
            <div class="totals-row total"><span>Total</span><span>${fmtEur(total)}</span></div>
          </div>
          ${iva_exento ? `<div class="iva-exento-note">Operación exenta de IVA conforme al Art. 20.1.9° de la Ley 37/1992 del IVA (servicios educativos).</div>` : ''}
        </div>
      </div>
    </div>

    <div class="footer-band">
      <div class="footer-email">facturacion@psikoaprende.com</div>
      <div class="lopd-title">INFORMACIÓN SOBRE PROTECCIÓN DE DATOS</div>
      <div class="lopd-text">
        <p>Los datos personales tratados para gestionar la relación contractual y, en su caso, para enviar información comercial por medios electrónicos, se conservarán hasta la finalización de la relación, la baja comercial o durante los plazos de retención legalmente establecidos.</p>
        <p>Puede ejercer sus derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad enviando su solicitud a la dirección postal del responsable o al correo electrónico info@psikoaprende.com</p>
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ============================================================
// TEMPLATE: FACTURA MULTI-PAGINA (F4-005)
// ============================================================
// Variante para facturas con >22 lineas. Reescribe el layout para que el
// flujo natural pagine en N paginas:
//  - Pagina 1: header completo (logo, factura, emisor, fecha, cliente) +
//    inicio de tabla.
//  - Paginas 2..N-1: solo continuacion de tabla con thead repetido.
//  - Pagina N: ultimo bloque de tabla + sello/firma + totales.
//  - Footer rosa-palo + LOPD: en cada pagina via puppeteer footerTemplate.
//
// Comparte estilos con buildInvoiceHtml en lo posible. Diferencias clave:
//  - .page no tiene height fijo ni overflow:hidden.
//  - .content-area usa margin (no absolute) y deja al flujo paginar.
//  - .items-table thead { display: table-header-group } + tr/td con
//    page-break-inside: avoid.
//  - .bottom-row con page-break-inside: avoid + break-before: avoid para
//    no separarse de la ultima fila si cabe junto.
//  - No hay .footer-band inline; lo inyecta puppeteer.
export function buildInvoiceHtmlMultiPage(data) {
  const {
    numero, fecha,
    emisor_nombre, emisor_nif, emisor_direccion, emisor_telefono,
    cliente_nombre, cliente_dni, cliente_direccion,
    lineas = [],
    iva_pct = 21,
    iva_exento = false,
  } = data;

  const subtotal = lineas.reduce((s, l) => s + (parseFloat(l.precio) * parseInt(l.cantidad || 1)), 0);
  const iva = iva_exento ? 0 : subtotal * (iva_pct / 100);
  const total = subtotal + iva;
  const clienteDocLabel = detectDocType(cliente_dni);

  function formatFecha(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso);
  }
  const fechaFmt = formatFecha(fecha);
  const fmtEur = n => n.toFixed(2).replace('.', ',') + ' €';

  const lineasHtml = lineas.map((l) => {
    const precio = parseFloat(l.precio || 0);
    const cantidad = parseInt(l.cantidad || 0) || (l.descripcion ? 1 : '');
    const totalLinea = precio && cantidad ? fmtEur(precio * cantidad) : '';
    return `<tr>
      <td class="col-desc">${l.descripcion || ''}</td>
      <td class="col-num">${cantidad || ''}</td>
      <td class="col-num">${precio ? fmtEur(precio) : ''}</td>
      <td class="col-num">${totalLinea}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  ${INVOICE_FONTS_CSS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4; margin: 0; }
  html, body {
    width: 210mm;
    font-family: 'Plus Jakarta Sans', 'Open Sans', 'Helvetica Neue', Arial, sans-serif;
    color: #000;
    background: #fff;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { width: 210mm; position: relative; background: #fff; }

  /* Cabecera de la factura — visible solo en pagina 1 (flujo natural).
     Conserva el bloque absolute del template single-page para mantener el
     pixel-perfect del Canva, pero envuelta en un wrapper de altura fija
     que ocupa los primeros 130mm del flujo de la pagina 1. */
  .header-zone { position: relative; height: 130mm; flex-shrink: 0; }
  .top-band {
    position: absolute; top: 0; left: 0; right: 0;
    height: 20mm; background: #DBC4C3;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .logo-drop {
    position: absolute; top: 0; left: 125.8mm;
    width: 58.7mm; height: 75.2mm;
    background: #F2E6E5;
    clip-path: polygon(0 0, 100% 0, 100% 86%, 50% 100%, 0 86%);
    text-align: center;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .logo-drop img { width: 36mm; height: auto; margin: 6mm auto 0; display: block; object-fit: contain; }
  .numero-label {
    position: absolute; top: 40.2mm; left: 125.8mm; width: 58.7mm;
    text-align: center; font-size: 13pt; font-weight: 700;
    letter-spacing: 1.27pt; color: #1a1a1a;
  }
  .numero-pill {
    position: absolute; top: 49.1mm; left: 132.2mm;
    width: 45.9mm; height: 10.9mm;
    background: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 10.4pt;
  }
  .factura-title {
    position: absolute; top: 32mm; left: 14.3mm;
    font-size: 23.9pt; font-weight: 700; letter-spacing: 2.34pt; color: #000;
  }
  .emisor-name {
    position: absolute; top: 50.7mm; left: 15.5mm;
    font-size: 11pt; letter-spacing: 1.07pt; text-transform: uppercase;
  }
  .emisor-info {
    position: absolute; top: 57.1mm; left: 14.3mm;
    width: 90mm; font-size: 10.4pt; line-height: 1.45; letter-spacing: 1pt;
  }
  .emisor-info > div { margin-bottom: 0.6mm; }
  .fecha-line {
    position: absolute; top: 82.7mm; left: 134mm;
    font-size: 10.4pt; letter-spacing: 1pt;
  }
  .cliente-label {
    position: absolute; top: 87mm; left: 15.5mm;
    font-size: 10.4pt; font-weight: 700; letter-spacing: 1pt;
  }
  .cliente-info {
    position: absolute; top: 93.8mm; left: 17.9mm;
    width: 130mm; font-size: 10.4pt; line-height: 1.45; letter-spacing: 1pt;
  }
  .cliente-info > div { margin-bottom: 0.6mm; }

  /* Zona de contenido (tabla + sello/totales). Flujo natural — pagina sola. */
  .content-zone { padding: 0 14.3mm 0 14.5mm; }
  .items-table {
    width: 100%; border-collapse: collapse; table-layout: fixed;
  }
  .items-table colgroup col:nth-child(1) { width: 72.4mm; }
  .items-table colgroup col:nth-child(2) { width: 21.2mm; }
  .items-table colgroup col:nth-child(3) { width: 44.2mm; }
  .items-table colgroup col:nth-child(4) { width: 43.9mm; }
  /* table-header-group hace que el thead se repita en cada pagina nueva. */
  .items-table thead { display: table-header-group; }
  .items-table thead th {
    background: #DBC4C3;
    padding: 3mm 0;
    font-size: 10pt; font-weight: 700; text-align: center;
    color: #000; letter-spacing: 0.3pt; border: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .items-table tbody td {
    border: 1px solid #737373; border-top: none;
    padding: 2.5mm 4mm; font-size: 10.4pt; color: #6B6B6B;
    font-weight: 400; vertical-align: middle; height: 9mm;
  }
  .items-table tbody tr:first-child td { border-top: 1px solid #737373; }
  .items-table tbody tr { page-break-inside: avoid; }
  .items-table .col-desc { text-align: left; }
  .items-table .col-num { text-align: center; }

  /* Sello + totales — pagina dedicada al final, anclados al pie. Asi la
     posicion es la misma siempre (matching el Canva original) en lugar de
     flotar donde acabe la tabla. La altura del wrapper = A4 (297mm) menos
     el footer-band del puppeteer footerTemplate (40.8mm) = 256.2mm. */
  .last-page {
    page-break-before: always;
    break-before: page;
    height: 256.2mm;
    padding: 0 14.3mm 0 14.5mm;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .bottom-row {
    display: flex;
    gap: 7mm;
    align-items: flex-start;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .sello-box {
    flex: 1; height: 55mm;
    background: #F2E6E5; border: 1px solid #686868;
    position: relative;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sello-box::after {
    content: "Sello / Firma";
    position: absolute; bottom: 3mm; right: 4mm;
    font-size: 8pt; color: #b4969a; font-style: italic;
  }
  .totals-wrapper { width: 88mm; flex-shrink: 0; }
  .totals-box {
    width: 100%;
    background: #F2E6E5; border: 1px solid #686868;
    padding: 2mm 3mm; font-size: 12pt; color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .totals-row { display: flex; justify-content: space-between; padding: 0.4mm 1mm; }
  .totals-row.total { font-weight: 700; }
  .iva-exento-note {
    margin-top: 2mm; font-size: 7.5pt; font-style: italic;
    color: #555; line-height: 1.3;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="header-zone">
      <div class="top-band"></div>
      <div class="logo-drop">
        <img src="${PSIKO_LOGO_DATAURL}" alt="Psikoaprende"/>
      </div>
      <div class="numero-label">FACTURA NÚMERO</div>
      <div class="numero-pill">${numero || ''}</div>

      <div class="factura-title">FACTURA</div>
      <div class="emisor-name">${emisor_nombre || ''}</div>
      <div class="emisor-info">
        ${emisor_nif ? `<div>${emisor_nif}</div>` : ''}
        ${(emisor_direccion || '').split('\n').filter(Boolean).map(l => `<div>${l}</div>`).join('')}
        ${emisor_telefono ? `<div>Tel: ${emisor_telefono}</div>` : ''}
      </div>

      <div class="fecha-line">FECHA: ${fechaFmt}</div>

      <div class="cliente-label">DATOS DEL CLIENTE</div>
      <div class="cliente-info">
        ${cliente_nombre ? `<div>Nombre o Razón Social: ${cliente_nombre}</div>` : ''}
        ${cliente_dni ? `<div>${clienteDocLabel}: ${cliente_dni}</div>` : ''}
        ${cliente_direccion ? `<div>Dirección: ${cliente_direccion}</div>` : ''}
      </div>
    </div>

    <div class="content-zone">
      <table class="items-table">
        <colgroup><col/><col/><col/><col/></colgroup>
        <thead>
          <tr>
            <th>DESCRIPCIÓN</th>
            <th>CANTIDAD</th>
            <th>PRECIO</th>
            <th>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${lineasHtml}
        </tbody>
      </table>
    </div>

    <div class="last-page">
      <div class="bottom-row">
        <div class="sello-box"></div>
        <div class="totals-wrapper">
          <div class="totals-box">
            <div class="totals-row"><span>Sub Total</span><span>${fmtEur(subtotal)}</span></div>
            <div class="totals-row"><span>${iva_exento ? 'IVA (exento)' : `IVA (${iva_pct}%)`}</span><span>${fmtEur(iva)}</span></div>
            <div class="totals-row total"><span>Total</span><span>${fmtEur(total)}</span></div>
          </div>
          ${iva_exento ? `<div class="iva-exento-note">Operación exenta de IVA conforme al Art. 20.1.9° de la Ley 37/1992 del IVA (servicios educativos).</div>` : ''}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

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

  const stylesClean = originalStyles
    .replace(/(?:^|\n|\})\s*html\s*,\s*body[^{}]*\{[^{}]*\}/g, '')
    .replace(/(?:^|\n|\})\s*body[^{}]*\{[^{}]*\}/g, '');

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
// El fondo `cert-bg-p1.png` (extraído del Canva original) ya trae bakeados:
// el logo PSIKOAPRENDE en la cabecera, las firmas + nombres de Carlos Saiz
// (Director) y Mireia Jareño (Responsable de Formación), y la línea de
// firma del alumno (vacía — el alumno firma a mano). Aquí solo overlayeamos
// el texto dinámico (nombre, DNI, curso, fechas, aval).

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
    Este certificado ha sido expedido por Psiko Aprende y avalado por ISEIE Innovation School, e Hispamedic
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
// Generar PDF factura — single-page o multi-page segun cantidad de lineas
// ============================================================
// F4-005: cuando lineas <= MAX_SINGLE_PAGE (22) seguimos con el layout
// absolute pixel-perfect del Canva. Cuando hay mas items, el HTML se
// reestructura a flujo natural: la tabla pagina sola con `thead` repetido,
// el footer rosa-palo se inyecta via `puppeteer.pdf({ footerTemplate })`
// para aparecer en cada pagina, y el sello+totales caen en la ultima pagina
// con `page-break-inside: avoid`.
const MAX_SINGLE_PAGE = 22;

export async function generateInvoicePdf(data, filename) {
  const lineCount = (data?.lineas || []).length;
  const multiPage = lineCount > MAX_SINGLE_PAGE;

  if (!multiPage) {
    return htmlToPdf(buildInvoiceHtml(data), filename);
  }

  return htmlToPdf(buildInvoiceHtmlMultiPage(data), filename, {
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: buildInvoiceFooterTemplate(),
    margin: { top: '0', right: '0', bottom: '40.8mm', left: '0' },
  });
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
