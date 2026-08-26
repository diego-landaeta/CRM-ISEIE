import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { getLocal } from '../../shared/services/localStorage.service.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import * as model from './invoices.model.js';
import { query } from '../../shared/config/db.js';

const PDF_DIR = process.env.INVOICES_PDF_DIR || path.join(process.cwd(), 'uploads', 'invoices');

// Carga el logo del emisor para el PDF. Soporta: (1) archivo subido al CRM
// (issuer.logo_key vía almacenamiento local) y (2) URL externa (issuer.logo_url
// http/https) — así el logo se puede poner "por URL o subiendo la imagen".
// Devuelve un PDFImage embebido o null si no hay/da error (no rompe el PDF).
async function loadIssuerLogoImage(pdfDoc, inv) {
  try {
    let buffer = null, ext = null;
    const iss = inv.issuer_id ? await model.getIssuer(inv.issuer_id) : null;
    if (iss?.logo_key) {
      try { ({ buffer } = await getLocal(iss.logo_key)); ext = String(iss.logo_key).split('.').pop(); } catch { /* sigue */ }
    }
    const urlCandidate = iss?.logo_url || inv.issuer_logo_url;
    if (!buffer && urlCandidate && /^https?:\/\//i.test(urlCandidate)) {
      // Timeout 6s: una URL lenta/caída nunca debe colgar la generación del PDF.
      const r = await fetch(urlCandidate, { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        buffer = Buffer.from(await r.arrayBuffer());
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        ext = ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : (urlCandidate.split('?')[0].split('.').pop() || 'png');
      }
    }
    if (!buffer) return null;
    const e = String(ext || '').toLowerCase().split('?')[0];
    if (e === 'jpg' || e === 'jpeg') return await pdfDoc.embedJpg(buffer);
    try { return await pdfDoc.embedPng(buffer); } catch { return await pdfDoc.embedJpg(buffer); }
  } catch { return null; }
}

// IVA por defecto segun pais cliente
export function getDefaultIvaPct(/* pais */) {
  // Servicios académicos: exentos de IVA (art. 20 LIVA). Todas las facturas nuevas
  // salen sin IVA por defecto; si algún caso puntual lo lleva, se ajusta desde el
  // botón de editar factura.
  return 0;
}

// Calcula importes con o sin IVA incluido
export function calcularImportes({ items, ivaPct, ivaIncluido }) {
  const subtotal = items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0);
  let baseImponible, ivaImporte, total;
  if (ivaIncluido) {
    // El total ya incluye IVA → desglosar
    total = subtotal;
    baseImponible = Number((subtotal / (1 + ivaPct / 100)).toFixed(2));
    ivaImporte = Number((total - baseImponible).toFixed(2));
  } else {
    baseImponible = Number(subtotal.toFixed(2));
    ivaImporte = Number((baseImponible * ivaPct / 100).toFixed(2));
    total = Number((baseImponible + ivaImporte).toFixed(2));
  }
  return { baseImponible, ivaImporte, total };
}

// Doble moneda: la gestora teclea a mano el total en EUROS de una factura emitida en
// otra divisa. Aquí se desglosa ese importe (base + IVA) para que la contabilidad en
// euros cuadre. No hay conversión automática: el euro que entra es el que manda.
export function repartirEnEuros({ totalEur, ivaPct, ivaIncluido }) {
  const total = Number(totalEur || 0);
  const pct = Number(ivaPct || 0);
  if (pct === 0) return { baseImponible: Number(total.toFixed(2)), ivaImporte: 0, total: Number(total.toFixed(2)) };
  if (ivaIncluido) {
    const baseImponible = Number((total / (1 + pct / 100)).toFixed(2));
    return { baseImponible, ivaImporte: Number((total - baseImponible).toFixed(2)), total: Number(total.toFixed(2)) };
  }
  // El importe tecleado se toma como TOTAL con IVA ya sumado (es lo que se cobró).
  const baseImponible = Number((total / (1 + pct / 100)).toFixed(2));
  return { baseImponible, ivaImporte: Number((total - baseImponible).toFixed(2)), total: Number(total.toFixed(2)) };
}

// La fuente estándar del PDF (WinAnsi) no sabe dibujar símbolos como ₡ (colón) o
// ₲ (guaraní). Si uno aparecía en un concepto, la generación reventaba y esa
// factura NO se podía descargar. Se cambian por su código ISO y se descarta
// cualquier otro carácter fuera de Latin-1 antes que romper el PDF.
const SIMBOLOS_NO_WINANSI = {
  '₡': 'CRC ', '₲': 'PYG ', '₴': 'UAH ', '₹': 'INR ',
  '₩': 'KRW ', '₦': 'NGN ', '₪': 'ILS ', '₫': 'VND ',
  '₱': 'PHP ', '฿': 'THB ', '₺': 'TRY ', '₽': 'RUB ',
  '₿': 'BTC ', '₵': 'GHS ', '₾': 'GEL ',
};
function winAnsi(t) {
  let out = String(t ?? '');
  for (const [sym, iso] of Object.entries(SIMBOLOS_NO_WINANSI)) out = out.split(sym).join(iso);
  // OJO: WinAnsi (CP1252) SI admite caracteres fuera de Latin-1 — el euro entre
  // ellos. Filtrar solo por Latin-1 se cargaba el simbolo de TODOS los importes.
  const EXTRAS = new Set([0x20AC,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,
    0x2030,0x0160,0x2039,0x0152,0x017D,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,
    0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0x017E,0x0178]);
  let res = '';
  for (const ch of out) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF || EXTRAS.has(cp)) res += ch;
  }
  return res;
}

// Formatea un importe en la moneda de la factura (por defecto EUR). Los importes
// son manuales en esa divisa (sin conversión). Si el código ISO no lo soporta
// Intl, cae a "1.234,56 XXX".
function fmtMoney(n, moneda = 'EUR') {
  const cur = String(moneda || 'EUR').toUpperCase();
  try {
    return winAnsi(new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(Number(n || 0)));
  } catch {
    return winAnsi(`${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))} ${cur}`);
  }
}
function fmtEUR(n) { return fmtMoney(n, 'EUR'); }

// Factor para pasar un precio de línea BRUTO a NETO cuando la factura es
// "IVA incluido". Así las líneas suman la base imponible en vez del total.
function netFactor(inv) {
  const pct = Number(inv?.iva_pct || 0);
  return (inv?.iva_incluido && pct > 0) ? 1 / (1 + pct / 100) : 1;
}

// Parte una descripción larga en varias líneas que caben en maxWidth, para que
// el nombre completo del programa NO se corte en el PDF (antes se hacía slice).
function wrapToLines(font, text, size, maxWidth) {
  const clean = winAnsi(text).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) { cur = test; continue; }
    if (cur) lines.push(cur);
    if (font.widthOfTextAtSize(w, size) > maxWidth) {
      let chunk = '';
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) chunk += ch;
        else { if (chunk) lines.push(chunk); chunk = ch; }
      }
      cur = chunk;
    } else { cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// Genera PDF de factura usando pdf-lib
export async function generatePDF(invoiceId, { preliminar = false, vistaGestor = false } = {}) {
  const inv = await model.findById(invoiceId);
  if (!inv) throw new Error('Factura no encontrada');
  // COPIA DE GESTIÓN de un cobro por Stripe: el alumno recibe la factura por el
  // BRUTO (lo que pagó) y gestión necesita el NETO liquidado (bruto − comisión).
  // Se sustituyen los importes solo para este PDF; en la base de datos no se toca
  // nada. Si el cobro no es de Stripe o no consta la comisión, no se altera.
  let neto = null;
  if (vistaGestor && inv.payment_id) {
    const { rows } = await query(
      `SELECT net_amount, fee_amount FROM stripe_payments
        WHERE conversion_payment_id = $1 AND net_amount IS NOT NULL LIMIT 1`, [inv.payment_id]);
    if (rows[0]) {
      neto = { net: Number(rows[0].net_amount), fee: Number(rows[0].fee_amount || 0) };
      const factor = Number(inv.total) > 0 ? neto.net / Number(inv.total) : 1;
      inv.total = neto.net;
      inv.base_imponible = Number((Number(inv.base_imponible || 0) * factor).toFixed(2));
      inv.iva_importe = Number((Number(inv.iva_importe || 0) * factor).toFixed(2));
      if (inv.total_divisa != null) inv.total_divisa = null; // el neto siempre en euros
    }
  }
  // Formateo en la moneda de la factura (fallback local que sombrea el fmtEUR de
  // módulo dentro del layout fijo). El editor visual usa fmtMoney directamente.
  const fmtEUR = (n) => fmtMoney(n, inv.moneda);
  const project = await model.getProjectInvoicerData(inv.project_id);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const lightGray = rgb(0.92, 0.92, 0.92);

  // Plantilla del editor visual (Canva). Si la factura tiene una, se dibuja por
  // posiciones libres; si no, se usa el layout fijo (fallback). Vale igual para
  // factura normal y rectificativa (de abono).
  let template = null;
  try {
    template = inv.template_id
      ? await model.getTemplate(inv.template_id)
      : await model.getTemplateForInvoice(inv.issuer_id, inv.project_id, inv.cliente_pais);
  } catch { template = null; }
  const tplLayout = Array.isArray(template?.layout) ? template.layout : [];

  if (tplLayout.length) {
    await renderFromTemplate({ pdfDoc, page, font, bold, inv, layout: tplLayout });
  } else {
  const left = 50;
  const right = 545;
  const esRect = inv.tipo === 'rectificativa';
  const esProforma = inv.tipo === 'proforma';
  const esBorrador = inv.estado === 'borrador';

  // Texto alineado a la derecha terminando en xr.
  const drawRight = (rawText, xr, yy, size, f, color) => {
    // Se limpia antes de medir y dibujar: un símbolo que la fuente no soporte
    // (₡, ₲…) rompía la generación entera del PDF.
    const text = winAnsi(rawText);
    page.drawText(text, { x: xr - f.widthOfTextAtSize(text, size), y: yy, size, font: f, color });
  };
  const noVal = (v) => !v || String(v).trim() === '' || String(v).trim() === '—';
  // Colapsa saltos de línea / espacios múltiples a UNA sola línea. pdf-lib pinta
  // los '\n' como varias líneas dentro del hueco de un campo → el texto se
  // "montaba" sobre la línea siguiente. Con esto cada campo ocupa una fila.
  const oneLine = (v, max = 95) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

  // Emisor (snapshot multi-empresa; fallback a datos del proyecto).
  const datosFiscalesProyecto = project?.datos_fiscales || {};
  const emisorNombre = inv.issuer_razon_social || datosFiscalesProyecto.razon_social || project?.nombre || 'CRM';
  const emisorNif = inv.issuer_nif || datosFiscalesProyecto.nif;
  const emisorDir = inv.issuer_direccion || datosFiscalesProyecto.direccion;
  const emisorCiudad = [inv.issuer_cp, inv.issuer_ciudad].filter(Boolean).join(' ');

  // ── LOGO del emisor ──
  // logo_en_pie=true (p.ej. ISEIE): el logo es un SELLO que va SOLO al pie
  // (abajo-derecha), no arriba. Si es false: membrete arriba-izquierda (default).
  const issuerData = inv.issuer_id ? await model.getIssuer(inv.issuer_id) : null;
  const logoEnPie = !!issuerData?.logo_en_pie;
  const logoImg = await loadIssuerLogoImage(pdfDoc, inv);
  let ey = 812;
  if (logoImg && !logoEnPie) {
    const maxW = 120, maxH = 66;
    const sc = Math.min(maxW / logoImg.width, maxH / logoImg.height);
    const lw = logoImg.width * sc, lh = logoImg.height * sc;
    page.drawImage(logoImg, { x: left, y: 812 - lh, width: lw, height: lh });
    ey = 812 - lh - 12;
  }

  // ── Datos EMISOR ──
  page.drawText(oneLine(emisorNombre, 70), { x: left, y: ey, size: 11, font: bold, color: black }); ey -= 13;
  if (emisorNif)          { page.drawText(oneLine(`NIF: ${emisorNif}`, 50), { x: left, y: ey, size: 9, font, color: gray }); ey -= 11; }
  if (emisorDir)          { page.drawText(oneLine(emisorDir, 80), { x: left, y: ey, size: 9, font, color: gray }); ey -= 11; }
  if (emisorCiudad)       { page.drawText(oneLine(`${emisorCiudad}${inv.issuer_pais ? ', ' + inv.issuer_pais : ''}`, 80), { x: left, y: ey, size: 9, font, color: gray }); ey -= 11; }
  if (inv.issuer_email)   { page.drawText(oneLine(inv.issuer_email, 70), { x: left, y: ey, size: 9, font, color: gray }); ey -= 11; }
  if (inv.issuer_telefono){ page.drawText(oneLine(inv.issuer_telefono, 40), { x: left, y: ey, size: 9, font, color: gray }); ey -= 11; }

  // ── TÍTULO + Nº + Fecha (derecha) ──
  const tituloDoc = esRect ? 'FACTURA RECTIFICATIVA' : 'FACTURA';
  const tituloColor = esRect ? rgb(0.7, 0.1, 0.1) : esProforma ? rgb(0.35, 0.35, 0.45) : black;
  drawRight(`${tituloDoc}${inv.codigo ? '  Nº ' + inv.codigo : ''}`, right, 806, 14, bold, tituloColor);
  drawRight(`Fecha: ${new Date(inv.fecha_emision).toLocaleDateString('es-ES')}`, right, 790, 10, font, gray);
  if (esRect && inv.rectifica_codigo) drawRight(`Rectifica a: ${inv.rectifica_codigo}`, right, 776, 9, font, gray);
  if (esProforma) drawRight('PROFORMA — documento sin validez fiscal', right, 776, 8, bold, rgb(0.35, 0.35, 0.45));
  if (esBorrador) drawRight('BORRADOR — sin validez fiscal', right, 776, 8, bold, rgb(0.7, 0.45, 0.05));

  // ── CLIENTE (bajo la cabecera, ancho completo) ──
  let y = Math.min(ey, 772) - 20;
  page.drawRectangle({ x: left, y: y + 10, width: right - left, height: 0.8, color: gray });
  page.drawText('DATOS CLIENTE', { x: left, y, size: 9, font: bold, color: gray }); y -= 15;
  // Delante del nombre va su rótulo: una empresa tiene razón social, una persona
  // nombre y apellidos. El ancho útil son 495 pt, así que el valor se recorta
  // contando ya lo que ocupa el rótulo.
  page.drawText(oneLine(`${rotuloNombreCliente(inv)}: ${inv.cliente_nombre}`, 74), { x: left, y, size: 11, font: bold, color: black }); y -= 13;
  if (!noVal(inv.cliente_direccion)) { page.drawText(oneLine(`DIRECCIÓN: ${inv.cliente_direccion}`, 88), { x: left, y, size: 10, font, color: black }); y -= 13; }
  const cliLoc = [inv.cliente_cp, inv.cliente_ciudad].filter((x) => !noVal(x)).join(' ');
  if (cliLoc || !noVal(inv.cliente_pais)) { page.drawText(oneLine(`${cliLoc}${!noVal(inv.cliente_pais) ? (cliLoc ? ', ' : '') + inv.cliente_pais : ''}`, 88), { x: left, y, size: 10, font, color: black }); y -= 13; }
  if (!noVal(inv.cliente_telefono)) { page.drawText(oneLine(`NÚMERO TELEFÓNICO: ${inv.cliente_telefono}`, 58), { x: left, y, size: 10, font, color: black }); y -= 13; }
  if (!noVal(inv.cliente_nif))       { page.drawText(oneLine(`NIF: ${inv.cliente_nif}`, 60), { x: left, y, size: 10, font, color: black }); y -= 13; }
  if (!noVal(inv.cliente_email))    { page.drawText(oneLine(`CORREO: ${inv.cliente_email}`, 78), { x: left, y, size: 10, font, color: black }); y -= 13; }

  // Tabla items
  y -= 30;
  page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 22, color: lightGray });
  page.drawText('Concepto', { x: left + 10, y, size: 10, font: bold, color: black });
  page.drawText('Cant.', { x: 360, y, size: 10, font: bold, color: black });
  page.drawText('Precio', { x: 410, y, size: 10, font: bold, color: black });
  page.drawText('Subtotal', { x: right - 70, y, size: 10, font: bold, color: black });

  y -= 22;
  const items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  // Con IVA INCLUIDO los precios de línea vienen en BRUTO. En la factura las líneas
  // se muestran NETAS para que su suma cuadre con la base imponible.
  const netF = netFactor(inv);
  for (const it of items) {
    const cant = Number(it.cantidad || 1);
    // Tolerante a distintas claves de precio (precio_unitario | precio) para no
    // pintar 0,00 cuando el ítem viene de importaciones/otros orígenes.
    const precioBruto = Number(it.precio_unitario ?? it.precio ?? 0);
    const precio = precioBruto * netF;
    const subt = (it.total != null ? Number(it.total) : cant * precioBruto) * netF;
    // El concepto se envuelve en varias líneas para no cortar el nombre completo.
    const descLines = wrapToLines(font, it.descripcion, 10, 340 - (left + 10));
    page.drawText(descLines[0], { x: left + 10, y, size: 10, font, color: black });
    page.drawText(String(cant), { x: 365, y, size: 10, font, color: black });
    page.drawText(fmtEUR(precio), { x: 410, y, size: 10, font, color: black });
    page.drawText(fmtEUR(subt), { x: right - 70, y, size: 10, font, color: black });
    y -= 15;
    for (let li = 1; li < descLines.length; li++) {
      page.drawText(descLines[li], { x: left + 10, y, size: 10, font, color: black });
      y -= 15;
    }
    y -= 3;
  }

  // Totales
  y -= 20;
  page.drawRectangle({ x: right - 200, y: y - 4, width: 200, height: 1, color: gray });
  y -= 16;
  // Doble moneda: base/IVA/total se guardan SIEMPRE en euros; total_divisa es el
  // importe en la divisa internacional (manual). Si existe, manda él en el TOTAL y
  // el euro va detrás entre paréntesis. Las facturas antiguas en divisa (sin
  // total_divisa) conservan su comportamiento: todo formateado en esa divisa.
  const enDivisa = String(inv.moneda || 'EUR').toUpperCase() !== 'EUR' && inv.total_divisa != null;
  // Base e IVA se guardan en euros, pero el documento va en la divisa: se
  // muestran en ella, con el mismo cambio que el total. El euro aparece una
  // sola vez, entre parentesis debajo del TOTAL.
  const cambio = enDivisa && Number(inv.total)
    ? Number(inv.total_divisa) / Number(inv.total)
    : 1;
  const fmtBase = (n) => (enDivisa
    ? fmtMoney(Number(n || 0) * cambio, inv.moneda)
    : fmtEUR(n));
  page.drawText('Base imponible:', { x: right - 200, y, size: 10, font, color: black });
  page.drawText(fmtBase(inv.base_imponible), { x: right - 70, y, size: 10, font, color: black });
  y -= 16;
  page.drawText(`IVA (${inv.iva_pct}%):`, { x: right - 200, y, size: 10, font, color: black });
  page.drawText(fmtBase(inv.iva_importe), { x: right - 70, y, size: 10, font, color: black });
  y -= 16;
  page.drawRectangle({ x: right - 200, y: y + 12, width: 200, height: 1, color: gray });
  page.drawText('TOTAL:', { x: right - 200, y, size: 12, font: bold, color: black });
  page.drawText(enDivisa ? fmtMoney(inv.total_divisa, inv.moneda) : fmtEUR(inv.total),
    { x: right - 70, y, size: 12, font: bold, color: black });
  if (enDivisa) {
    y -= 13;
    drawRight(`(${fmtMoney(inv.total, 'EUR')})`, right, y, 9, bold, black);
  }
  // Copia de gestión: deja claro que este documento NO es el del alumno.
  if (neto) {
    y -= 13;
    drawRight(`COPIA DE GESTIÓN · neto Stripe (comisión ${fmtMoney(neto.fee, 'EUR')})`, right, y, 8, font, gray);
  }

  // La factura no lleva coletillas de IVA: ni "incluido en el precio" ni
  // "añadido a la base". Van la base, el IVA cuando corresponde y el total.

  // Metodo de pago
  y -= 30;
  const metodoLabels = {
    transferencia: 'Transferencia bancaria',
    tarjeta: 'Tarjeta',
    tarjeta_stripe: 'Tarjeta',   // forma de pago = Tarjeta; Stripe es el ORIGEN, no el método
    efectivo: 'Efectivo',
    bizum: 'Bizum',
    paypal: 'PayPal',
    fraccionado: 'Pago fraccionado',
    otro: 'Otro',
  };
  page.drawText(`Forma de pago: ${metodoLabels[inv.metodo_pago] || inv.metodo_pago || '—'}`,
    { x: left, y, size: 10, font: bold, color: black });

  // Sello del emisor al pie (abajo-derecha) — SOLO si logo_en_pie (p.ej. ISEIE).
  if (logoImg && logoEnPie) {
    const sc = Math.min(90 / logoImg.width, 90 / logoImg.height);
    const w = logoImg.width * sc, h = logoImg.height * sc;
    page.drawImage(logoImg, { x: right - w, y: 70, width: w, height: h });
  }

  // Sin linea de referencia al pie: el numero y la fecha del documento ya van en
  // la cabecera. Abajo solo queda el pie legal del emisor.
  } // fin fallback (layout fijo)

  // ── COLETILLA / PIE LEGAL (issuer.pie_default → pie_pago) ──
  // Va SIEMPRE al pie de página (todas las páginas), ajustada a varias líneas y
  // sin recortar. Es el texto obligatorio que configura el gestor por emisor.
  if (inv.pie_pago) {
    const fsize = 8, fLeft = 50, fRight = 545, maxW = fRight - fLeft;
    const wrap = (text) => {
      const out = [];
      for (const para of String(text).split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
          const t = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(t, fsize) > maxW && line) { out.push(line); line = word; }
          else line = t;
        }
        if (line) out.push(line);
      }
      return out.slice(0, 5);
    };
    const lines = wrap(inv.pie_pago);
    for (const p of pdfDoc.getPages()) {
      let fy = 44 + (lines.length - 1) * 10;
      p.drawLine({ start: { x: fLeft, y: fy + 12 }, end: { x: fRight, y: fy + 12 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
      for (const ln of lines) {
        p.drawText(ln, { x: fLeft, y: fy, size: fsize, font, color: rgb(0.35, 0.35, 0.35) });
        fy -= 10;
      }
    }
  }

  // Marca de agua diagonal (todas las páginas). Dos casos sin validez fiscal:
  //  · BORRADOR: aún no emitida.
  //  · PRELIMINAR: emitida (tiene número) pero con datos del cliente pendientes;
  //    permite VERLA sin exigir rellenar NIF/dirección — sin descargarla como
  //    definitiva.
  const esBorradorWm = inv.estado === 'borrador';
  if (esBorradorWm || preliminar) {
    const etiqueta = esBorradorWm ? 'BORRADOR' : 'PRELIMINAR';
    for (const p of pdfDoc.getPages()) {
      p.drawText(etiqueta, {
        x: 90, y: 260, size: 90, font: bold,
        color: rgb(0.85, 0.55, 0.1), opacity: 0.16, rotate: degrees(45),
      });
      p.drawText('SIN VALIDEZ FISCAL', {
        x: 150, y: 235, size: 30, font: bold,
        color: rgb(0.85, 0.55, 0.1), opacity: 0.16, rotate: degrees(45),
      });
    }
  }

  const pdfBytes = await pdfDoc.save();

  // Persist — ni el borrador ni el preliminar se cachean en disco: su contenido
  // cambia al completar datos/emitir y no debe quedar un PDF viejo con marca de
  // agua ocupando el sitio de la factura definitiva.
  if (esBorradorWm || preliminar) {
    const pref = esBorradorWm ? 'BORRADOR' : 'PRELIMINAR';
    return { path: null, bytes: pdfBytes, filename: `${pref}-${inv.id}.pdf` };
  }
  const dir = path.join(PDF_DIR, String(inv.project_id), String(inv.ano));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${inv.codigo.replace('/', '-')}.pdf`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, pdfBytes);
  await model.setPdfPath(inv.id, fullPath);

  return { path: fullPath, bytes: pdfBytes, filename };
}

// Rótulo que va delante del nombre del cliente en la factura. Una empresa se
// identifica por su razón social; una persona, por su nombre y apellidos.
// invoices.cliente_tipo es una copia de leads.cliente_tipo hecha al emitir; si
// no está puesto se asume persona, que es el caso normal.
export function rotuloNombreCliente(inv) {
  return inv?.cliente_tipo === 'empresa' ? 'RAZÓN SOCIAL' : 'NOMBRE Y APELLIDO';
}

const METODO_LABELS = {
  transferencia: 'Transferencia bancaria', tarjeta: 'Tarjeta', tarjeta_stripe: 'Tarjeta',
  efectivo: 'Efectivo', bizum: 'Bizum', paypal: 'PayPal', fraccionado: 'Pago fraccionado', otro: 'Otro',
};

// Dibuja la factura usando la plantilla del editor visual (bloques posicionados).
// Convierte coords del editor (A4 794x1123 px, origen arriba-izq) a pdf-lib (595x842 pt, origen abajo-izq).
async function renderFromTemplate({ pdfDoc, page, font, bold, inv, layout }) {
  const fmtEUR = (n) => fmtMoney(n, inv.moneda); // formatea en la moneda de la factura
  const SX = 595 / 794, SY = 842 / 1123;
  const X = (px) => px * SX;
  const TOP = (py) => 842 - py * SY; // borde superior del bloque en coords pdf
  const black = rgb(0, 0, 0), gray = rgb(0.4, 0.4, 0.4), red = rgb(0.7, 0.1, 0.1);
  const hexColor = (c) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const esRect = inv.tipo === 'rectificativa';
  const esProforma = inv.tipo === 'proforma';
  const items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? (() => { try { return JSON.parse(inv.items); } catch { return []; } })() : []);

  // Dibuja un conjunto de líneas dentro del bloque, respetando alineación/color/negrita.
  function drawLines(b, lines) {
    const baseSize = (b.fontSize || 12) * SY;
    const bx = X(b.x), bw = X(b.w);
    const blockColor = hexColor(b.color) || black;
    let baseline = TOP(b.y) - baseSize;
    const bottom = TOP(b.y + b.h);
    for (const ln of lines) {
      if (!ln || ln.text == null || ln.text === '') continue;
      if (baseline < bottom - 2) break; // no desbordar el bloque
      const f = (ln.bold ?? b.bold) ? bold : font;
      const s = (ln.size ? ln.size : (b.fontSize || 12)) * SY;
      const col = ln.color || blockColor;
      const align = ln.align || b.align || 'left';
      const text = String(ln.text);
      const w = f.widthOfTextAtSize(text, s);
      const x = align === 'right' ? bx + bw - w : align === 'center' ? bx + (bw - w) / 2 : bx;
      page.drawText(text, { x, y: baseline, size: s, font: f, color: col });
      baseline -= s * 1.35;
    }
  }

  for (const b of layout) {
    try {
      switch (b.type) {
        case 'logo': {
          if (!inv.issuer_id) break;
          const iss = await model.getIssuer(inv.issuer_id);
          if (!iss?.logo_key) break;
          const { buffer } = await getLocal(iss.logo_key);
          const ext = String(iss.logo_key).split('.').pop().toLowerCase();
          let img = null;
          if (ext === 'png') img = await pdfDoc.embedPng(buffer);
          else if (ext === 'jpg' || ext === 'jpeg') img = await pdfDoc.embedJpg(buffer);
          if (!img) break;
          const bw = X(b.w), bh = b.h * SY;
          const sc = Math.min(bw / img.width, bh / img.height);
          const w = img.width * sc, h = img.height * sc;
          page.drawImage(img, { x: X(b.x), y: TOP(b.y) - h, width: w, height: h });
          break;
        }
        case 'emisor':
          drawLines(b, [
            { text: inv.issuer_razon_social, bold: true, size: (b.fontSize || 12) + 3 },
            { text: inv.issuer_nif ? `NIF/CIF: ${inv.issuer_nif}` : '' },
            { text: inv.issuer_direccion },
            { text: [inv.issuer_cp, inv.issuer_ciudad].filter(Boolean).join(' ') + (inv.issuer_pais ? `, ${inv.issuer_pais}` : '') },
            { text: inv.issuer_email },
            { text: inv.issuer_telefono ? `Tel: ${inv.issuer_telefono}` : '' },
            { text: inv.issuer_iban ? `IBAN: ${inv.issuer_iban}` : '' },
          ]);
          break;
        case 'cliente':
          drawLines(b, [
            { text: 'Facturar a:', bold: true, color: gray, size: (b.fontSize || 11) - 1 },
            { text: `${rotuloNombreCliente(inv)}: ${inv.cliente_nombre}`, bold: true },
            { text: inv.cliente_direccion ? `DIRECCIÓN: ${inv.cliente_direccion}` : '' },
            { text: [inv.cliente_cp, inv.cliente_ciudad].filter(Boolean).join(' ') + (inv.cliente_pais ? `, ${inv.cliente_pais}` : '') },
            { text: inv.cliente_telefono ? `NÚMERO TELEFÓNICO: ${inv.cliente_telefono}` : '' },
            { text: inv.cliente_nif ? `NIF: ${inv.cliente_nif}` : '' },
            { text: inv.cliente_email ? `CORREO: ${inv.cliente_email}` : '' },
          ]);
          break;
        case 'meta':
          drawLines(b, [
            { text: esRect ? 'FACTURA RECTIFICATIVA' : 'FACTURA', bold: true, size: (b.fontSize || 12) + 2, color: esRect ? red : black },
            { text: `N.º ${inv.codigo || '(sin numerar)'}`, bold: true },
            { text: `Fecha: ${new Date(inv.fecha_emision).toLocaleDateString('es-ES')}` },
            { text: esRect && inv.rectifica_codigo ? `Rectifica a: ${inv.rectifica_codigo}` : '', color: gray, size: (b.fontSize || 12) - 2 },
            { text: esProforma ? 'PROFORMA — documento sin validez fiscal' : '', color: gray, size: (b.fontSize || 12) - 2 },
          ]);
          break;
        case 'totales': {
          // Ver nota en generatePDF: con divisa, el TOTAL va en ella y el euro detrás.
          const enDiv = String(inv.moneda || 'EUR').toUpperCase() !== 'EUR' && inv.total_divisa != null;
          // Igual que en generatePDF: base e IVA en la divisa del documento.
          const camb = enDiv && Number(inv.total) ? Number(inv.total_divisa) / Number(inv.total) : 1;
          const fBase = (n) => (enDiv ? fmtMoney(Number(n || 0) * camb, inv.moneda) : fmtEUR(n));
          drawLines(b, [
            { text: `Base imponible: ${fBase(inv.base_imponible)}` },
            { text: `IVA (${inv.iva_pct}%): ${fBase(inv.iva_importe)}` },
            { text: enDiv
                ? `TOTAL: ${fmtMoney(inv.total_divisa, inv.moneda)} (${fmtMoney(inv.total, 'EUR')})`
                : `TOTAL: ${fmtEUR(inv.total)}`, bold: true, size: (b.fontSize || 12) + 2 },
          ]);
          break;
        }
        case 'coletilla':
          // Las plantillas antiguas pueden seguir teniendo este bloque, pero ya
          // no imprime nada: las facturas no llevan coletilla de IVA.
          break;
        case 'pie':
          drawLines(b, [
            { text: `Forma de pago: ${METODO_LABELS[inv.metodo_pago] || inv.metodo_pago || '—'}`, bold: true },
            ...String(inv.pie_pago || '').split('\n').map((t) => ({ text: t })),
          ]);
          break;
        case 'texto':
          drawLines(b, String(b.text || '').split('\n').map((t) => ({ text: t })));
          break;
        case 'items': {
          const size = (b.fontSize || 11) * SY;
          const bx = X(b.x), bw = X(b.w);
          const colDesc = bx, colCant = bx + bw * 0.60, colPrec = bx + bw * 0.74, colTot = bx + bw - font.widthOfTextAtSize('0000,00 €', size);
          let yy = TOP(b.y) - size;
          const bottom = TOP(b.y + b.h);
          // Cabecera (encabezados personalizables desde el editor)
          const hDesc = (b.cols?.desc && b.cols.desc.trim()) || 'Descripción';
          const hCant = (b.cols?.cant && b.cols.cant.trim()) || 'Cant.';
          const hPrec = (b.cols?.precio && b.cols.precio.trim()) || 'Precio';
          const hTot = (b.cols?.total && b.cols.total.trim()) || 'Total';
          page.drawText(hDesc, { x: colDesc, y: yy, size, font: bold, color: black });
          page.drawText(hCant, { x: colCant, y: yy, size, font: bold, color: black });
          page.drawText(hPrec, { x: colPrec, y: yy, size, font: bold, color: black });
          page.drawText(hTot, { x: colTot, y: yy, size, font: bold, color: black });
          yy -= size * 0.6;
          page.drawRectangle({ x: bx, y: yy, width: bw, height: 0.8, color: gray });
          yy -= size * 1.4;
          for (const it of items) {
            if (yy < bottom) break;
            const cant = Number(it.cantidad || 1);
            // Igual que en el layout fijo: con IVA incluido, líneas en NETO.
            const nf = netFactor(inv);
            const precioBruto = Number(it.precio_unitario ?? it.precio ?? 0);
            const precio = precioBruto * nf;
            const subt = (it.total != null ? Number(it.total) : cant * precioBruto) * nf;
            // Concepto envuelto (no cortar el nombre completo del programa).
            const descLines = wrapToLines(font, it.descripcion, size, (colCant - colDesc) - size * 0.5);
            page.drawText(descLines[0], { x: colDesc, y: yy, size, font, color: black });
            page.drawText(String(cant), { x: colCant, y: yy, size, font, color: black });
            page.drawText(fmtEUR(precio), { x: colPrec, y: yy, size, font, color: black });
            page.drawText(fmtEUR(subt), { x: colTot, y: yy, size, font, color: black });
            yy -= size * 1.3;
            for (let li = 1; li < descLines.length && yy >= bottom; li++) {
              page.drawText(descLines[li], { x: colDesc, y: yy, size, font, color: black });
              yy -= size * 1.3;
            }
          }
          break;
        }
        default: break;
      }
    } catch (e) {
      logger.warn({ err: e.message, block: b.type }, 'Fallo dibujando bloque de plantilla');
    }
  }

  // Pie fijo de trazabilidad
}

// Envío Brevo
export async function sendByEmail(invoiceId, customEmail = null) {
  const inv = await model.findById(invoiceId);
  if (!inv) throw new Error('Factura no encontrada');

  const email = customEmail || inv.cliente_email;
  if (!email) throw new Error('Factura sin email - no se puede enviar');

  // Obtener key Brevo del proyecto
  const brevoRow = await integrationsModel.get(inv.project_id, 'brevo');
  if (!brevoRow?.encrypted_value) throw new Error('Brevo no configurado para este proyecto');
  const brevoKey = decrypt(brevoRow.encrypted_value, brevoRow.iv, brevoRow.auth_tag);
  const cfg = brevoRow.config_public || {};

  // PDF en base64
  let pdfBytes;
  try {
    pdfBytes = await fs.readFile(inv.pdf_path);
  } catch {
    const gen = await generatePDF(invoiceId);
    pdfBytes = gen.bytes;
  }
  const pdfB64 = Buffer.from(pdfBytes).toString('base64');

  const project = await model.getProjectInvoicerData(inv.project_id);
  const docLabel = inv.tipo === 'proforma' ? 'Presupuesto' : 'Factura';
  const docLabelLc = inv.tipo === 'proforma' ? 'presupuesto' : 'factura';
  const subject = `${docLabel} ${inv.codigo} - ${project?.nombre || 'CRM'}`;
  const html = `
    <p>Hola ${inv.cliente_nombre},</p>
    <p>Adjuntamos tu ${docLabelLc} <strong>${inv.codigo}</strong> por importe de <strong>${fmtMoney(inv.total, inv.moneda)}</strong>.</p>
    <p>Si tienes cualquier duda, responde a este correo.</p>
    <p>Saludos,<br/>${project?.nombre || 'CRM'}</p>
  `;

  const body = {
    sender: { email: cfg.from_email, name: cfg.from_name || project?.nombre || 'CRM' },
    to: [{ email, name: inv.cliente_nombre }],
    subject, htmlContent: html,
    attachment: [{ name: `${inv.codigo.replace('/', '-')}.pdf`, content: pdfB64 }],
  };

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    logger.error({ invoiceId, status: r.status, body: t }, 'Brevo send failed');
    throw new Error(`Brevo HTTP ${r.status}: ${t.slice(0, 200)}`);
  }
  await model.markSent(inv.id, email);
  return { sent: true, to: email };
}

// ---------------------------------------------------------------------------
// Corte de facturacion
// ---------------------------------------------------------------------------
export async function getFacturacionAlDia(projectId) {
  const estado = await model.getFacturacionAlDia(projectId);
  // La cola: todo cobro posterior a lo ya hecho que aun no tiene factura.
  const cola = await model.listPagosSinFactura(projectId);
  return {
    ...estado,
    pagos_sin_factura: cola.length,
    importe_sin_factura: cola.reduce((s, p) => s + Number(p.importe || 0), 0),
    // El primero de la cola es el unico que puede emitirse sin saltarse a nadie.
    listos_para_emitir: cola.length ? 1 : 0,
    proformas_pendientes: await model.listProformasPendientes(projectId),
    cola: cola.slice(0, 200).map((p, i) => ({
      payment_id: p.payment_id,
      conversion_id: p.conversion_id,
      fecha: p.fecha,
      importe: Number(p.importe || 0),
      cliente: p.cliente,
      producto: p.producto_contratado,
      gestora: p.gestora,
      origen: p.de_stripe ? 'stripe' : 'manual',
      // El primero es el que toca; los demas esperan a que salgan los anteriores.
      es_el_siguiente: i === 0,
    })),
    por_dia: Object.values(cola.reduce((acc, p) => {
      const d = String(p.fecha).slice(0, 10);
      acc[d] = acc[d] || { dia: d, cobros: 0, importe: 0 };
      acc[d].cobros += 1;
      acc[d].importe += Number(p.importe || 0);
      return acc;
    }, {})).sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}

// Mueve la marca de "ya facturado hasta". Lo anterior desaparece de la cola.
export async function setFacturacionAlDia(projectId, alDiaHasta, userId, stripeOkHasta) {
  const guardado = await model.setFacturacionAlDia(projectId, alDiaHasta, userId, stripeOkHasta);
  return { ...guardado, emitidas: 0, detalle: [], fallidas: [] };
}

// Genera la factura de UN cobro concreto de la cola. Solo si no queda nada mas
// antiguo pendiente, para que la numeracion salga en orden. forzar lo salta.
export async function generarFacturaDePago(projectId, paymentId, userId, { forzar = false } = {}) {
  const cola = await model.listPagosSinFactura(projectId);
  const pg = cola.find((x) => Number(x.payment_id) === Number(paymentId));
  if (!pg) {
    throw new AppError('Ese cobro ya no está en la cola: o ya tiene factura, o queda fuera del periodo.',
      404, 'NOT_IN_QUEUE');
  }
  if (!forzar && await model.hayPendientesAnteriores(projectId, pg.fecha, pg.payment_id)) {
    throw new AppError(
      'Hay cobros anteriores sin facturar. Se emiten por orden de fecha para que la numeración no se descoloque.',
      409, 'HAY_ANTERIORES');
  }
  const inv = await model.emitirFacturaDePago(
    pg.conversion_id, { paymentId: pg.payment_id, importe: Number(pg.importe), saltarTotal: forzar }, userId
  );
  // Que no diga "generada" si no se genero nada.
  //
  // El modelo devuelve la factura que ya existia en varios casos legitimos (el
  // cobro ya la tenia, o se engancha a una huerfana): ahi el pago coincide. Si
  // vuelve otra distinta, o no vuelve nada, lo que hubo fue un choque, y quien
  // factura tiene que enterarse en vez de ver un aviso de exito falso.
  if (!inv) {
    throw new AppError(
      'No se emitio ninguna factura: el cobro es anterior a la primera factura de la sociedad.',
      409, 'ANTES_DEL_ARRANQUE');
  }
  if (inv.payment_id != null && Number(inv.payment_id) !== Number(pg.payment_id)) {
    throw new AppError(
      `Ese cobro sigue sin factura: el CRM devolvio la nº ${inv.numero}, que es de otro pago de la misma venta.`,
      409, 'NO_EMITIDA');
  }
  return inv;
}

// Emite de golpe, en orden de fecha, todo lo que quede en la cola hasta esa fecha.
export async function emitirColaHasta(projectId, hasta, userId) {
  const pendientes = await model.listPagosSinFactura(projectId, hasta);
  const emitidas = [];
  const fallidas = [];
  for (const pg of pendientes) {
    try {
      const inv = await model.emitirFacturaDePago(
        pg.conversion_id, { paymentId: pg.payment_id, importe: Number(pg.importe) }, userId
      );
      if (inv?.codigo) emitidas.push({ payment_id: pg.payment_id, codigo: inv.codigo, cliente: pg.cliente });
    } catch (err) {
      fallidas.push({ payment_id: pg.payment_id, cliente: pg.cliente, error: err.message });
      logger.warn({ paymentId: pg.payment_id, err: err.message }, 'no se pudo emitir la factura de la cola');
    }
  }
  return { emitidas: emitidas.length, detalle: emitidas, fallidas };
}

// Se llama antes de emitir una factura automatica. Solo sale sola si es la
// primera de la cola: si hay algo anterior esperando, esta espera tambien.
export async function puedeFacturarAhora(projectId, fechaPago, paymentId = null) {
  if (!projectId || !fechaPago) return true;
  try {
    const { al_dia_hasta } = await model.getFacturacionAlDia(projectId);
    // Sin marca de "al dia", se comporta como siempre: factura al momento.
    if (!al_dia_hasta) return true;
    if (String(fechaPago).slice(0, 10) <= String(al_dia_hasta).slice(0, 10)) return false;
    return !(await model.hayPendientesAnteriores(projectId, fechaPago, paymentId));
  } catch {
    return true;   // ante la duda, no bloquear la facturacion
  }
}
