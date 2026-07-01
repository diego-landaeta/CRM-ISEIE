import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { getLocal } from '../../shared/services/localStorage.service.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import * as model from './invoices.model.js';

const PDF_DIR = process.env.INVOICES_PDF_DIR || path.join(process.cwd(), 'uploads', 'invoices');

// IVA por defecto segun pais cliente
export function getDefaultIvaPct(pais) {
  if (!pais) return 21;
  const normalized = pais.trim().toLowerCase();
  if (normalized === 'españa' || normalized === 'espana' || normalized === 'spain' || normalized === 'es') return 21;
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

function fmtEUR(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}

// Genera PDF de factura usando pdf-lib
export async function generatePDF(invoiceId) {
  const inv = await model.findById(invoiceId);
  if (!inv) throw new Error('Factura no encontrada');
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
  let y = 800;
  const left = 50;
  const right = 545;

  // Cabecera EMISOR: usa el snapshot del emisor (multi-empresa) si existe,
  // si no cae al datos_fiscales del proyecto (compat con facturas viejas).
  const datosFiscalesProyecto = project?.datos_fiscales || {};
  const emisorNombre = inv.issuer_razon_social || datosFiscalesProyecto.razon_social || project?.nombre || 'CRM';
  const emisorNif = inv.issuer_nif || datosFiscalesProyecto.nif;
  const emisorDir = inv.issuer_direccion || datosFiscalesProyecto.direccion;
  const emisorCiudad = [inv.issuer_cp, inv.issuer_ciudad].filter(Boolean).join(' ');
  const emisorEmail = inv.issuer_email;
  const emisorTel = inv.issuer_telefono;

  page.drawText(emisorNombre, { x: left, y, size: 16, font: bold, color: black });
  y -= 20;
  if (emisorNif) { page.drawText(`NIF/CIF: ${emisorNif}`, { x: left, y, size: 10, font, color: gray }); y -= 12; }
  if (emisorDir) { page.drawText(emisorDir, { x: left, y, size: 10, font, color: gray }); y -= 12; }
  if (emisorCiudad) { page.drawText(`${emisorCiudad}${inv.issuer_pais ? ', ' + inv.issuer_pais : ''}`, { x: left, y, size: 10, font, color: gray }); y -= 12; }
  if (emisorEmail) { page.drawText(emisorEmail, { x: left, y, size: 10, font, color: gray }); y -= 12; }
  if (emisorTel) { page.drawText(`Tel: ${emisorTel}`, { x: left, y, size: 10, font, color: gray }); y -= 12; }

  // Codigo de factura (derecha) — distinto si es rectificativa
  const esRect = inv.tipo === 'rectificativa';
  page.drawText(esRect ? 'F. RECTIFICATIVA' : 'FACTURA', { x: right - (esRect ? 150 : 100), y: 800, size: esRect ? 13 : 16, font: bold, color: esRect ? rgb(0.7, 0.1, 0.1) : black });
  page.drawText(`N.º ${inv.codigo}`, { x: right - 150, y: 780, size: 12, font: bold, color: black });
  page.drawText(`Fecha: ${new Date(inv.fecha_emision).toLocaleDateString('es-ES')}`, { x: right - 150, y: 765, size: 10, font, color: gray });
  if (esRect && inv.rectifica_codigo) {
    page.drawText(`Rectifica a: ${inv.rectifica_codigo}`, { x: right - 150, y: 750, size: 9, font, color: gray });
  }

  // Linea separadora
  y = 720;
  page.drawRectangle({ x: left, y, width: right - left, height: 1, color: gray });

  // Cliente
  y -= 25;
  page.drawText('Facturar a:', { x: left, y, size: 11, font: bold, color: black });
  y -= 16;
  page.drawText(inv.cliente_nombre, { x: left, y, size: 11, font: bold, color: black });
  y -= 13;
  page.drawText(`NIF/CIF: ${inv.cliente_nif}`, { x: left, y, size: 10, font, color: black });
  y -= 13;
  page.drawText(inv.cliente_direccion, { x: left, y, size: 10, font, color: black });
  y -= 13;
  page.drawText(`${inv.cliente_cp} ${inv.cliente_ciudad}, ${inv.cliente_pais}`, { x: left, y, size: 10, font, color: black });
  if (inv.cliente_email) { y -= 13; page.drawText(inv.cliente_email, { x: left, y, size: 10, font, color: black }); }
  if (inv.cliente_telefono) { y -= 13; page.drawText(`Tel: ${inv.cliente_telefono}`, { x: left, y, size: 10, font, color: black }); }

  // Tabla items
  y -= 30;
  page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 22, color: lightGray });
  page.drawText('Concepto', { x: left + 10, y, size: 10, font: bold, color: black });
  page.drawText('Cant.', { x: 360, y, size: 10, font: bold, color: black });
  page.drawText('Precio', { x: 410, y, size: 10, font: bold, color: black });
  page.drawText('Subtotal', { x: right - 70, y, size: 10, font: bold, color: black });

  y -= 22;
  const items = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
  for (const it of items) {
    const desc = String(it.descripcion || '').slice(0, 60);
    const cant = Number(it.cantidad || 1);
    const precio = Number(it.precio_unitario || 0);
    const subt = cant * precio;
    page.drawText(desc, { x: left + 10, y, size: 10, font, color: black });
    page.drawText(String(cant), { x: 365, y, size: 10, font, color: black });
    page.drawText(fmtEUR(precio), { x: 410, y, size: 10, font, color: black });
    page.drawText(fmtEUR(subt), { x: right - 70, y, size: 10, font, color: black });
    y -= 18;
  }

  // Totales
  y -= 20;
  page.drawRectangle({ x: right - 200, y: y - 4, width: 200, height: 1, color: gray });
  y -= 16;
  page.drawText('Base imponible:', { x: right - 200, y, size: 10, font, color: black });
  page.drawText(fmtEUR(inv.base_imponible), { x: right - 70, y, size: 10, font, color: black });
  y -= 16;
  page.drawText(`IVA (${inv.iva_pct}%):`, { x: right - 200, y, size: 10, font, color: black });
  page.drawText(fmtEUR(inv.iva_importe), { x: right - 70, y, size: 10, font, color: black });
  y -= 16;
  page.drawRectangle({ x: right - 200, y: y + 12, width: 200, height: 1, color: gray });
  page.drawText('TOTAL:', { x: right - 200, y, size: 12, font: bold, color: black });
  page.drawText(fmtEUR(inv.total), { x: right - 70, y, size: 12, font: bold, color: black });

  // Metodo de pago
  y -= 30;
  const metodoLabels = {
    transferencia: 'Transferencia bancaria',
    tarjeta: 'Tarjeta',
    tarjeta_stripe: 'Tarjeta (Stripe)',
    efectivo: 'Efectivo',
    bizum: 'Bizum',
    fraccionado: 'Pago fraccionado',
    otro: 'Otro',
  };
  page.drawText(`Forma de pago: ${metodoLabels[inv.metodo_pago] || inv.metodo_pago || '—'}`,
    { x: left, y, size: 10, font: bold, color: black });

  // Leyenda IVA
  if (inv.leyenda_iva) {
    y -= 18;
    page.drawText(inv.leyenda_iva, { x: left, y, size: 9, font, color: gray });
  }

  // Pie de pago (instrucciones/IBAN/etc)
  if (inv.pie_pago) {
    y -= 22;
    page.drawRectangle({ x: left, y: y - 4, width: right - left, height: 1, color: gray });
    y -= 14;
    const lines = String(inv.pie_pago).split('\n').slice(0, 8);
    for (const ln of lines) {
      page.drawText(ln.slice(0, 100), { x: left, y, size: 9, font, color: black });
      y -= 12;
    }
  }

  // Footer
  page.drawText(`Factura ${inv.codigo} generada el ${new Date().toLocaleDateString('es-ES')}`,
    { x: left, y: 30, size: 8, font, color: gray });
  } // fin fallback (layout fijo)

  const pdfBytes = await pdfDoc.save();

  // Persist
  const dir = path.join(PDF_DIR, String(inv.project_id), String(inv.ano));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${inv.codigo.replace('/', '-')}.pdf`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, pdfBytes);
  await model.setPdfPath(inv.id, fullPath);

  return { path: fullPath, bytes: pdfBytes, filename };
}

const METODO_LABELS = {
  transferencia: 'Transferencia bancaria', tarjeta: 'Tarjeta', tarjeta_stripe: 'Tarjeta (Stripe)',
  efectivo: 'Efectivo', bizum: 'Bizum', fraccionado: 'Pago fraccionado', otro: 'Otro',
};

// Dibuja la factura usando la plantilla del editor visual (bloques posicionados).
// Convierte coords del editor (A4 794x1123 px, origen arriba-izq) a pdf-lib (595x842 pt, origen abajo-izq).
async function renderFromTemplate({ pdfDoc, page, font, bold, inv, layout }) {
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
            { text: inv.cliente_nombre, bold: true },
            { text: inv.cliente_nif ? `NIF/CIF: ${inv.cliente_nif}` : '' },
            { text: inv.cliente_direccion },
            { text: [inv.cliente_cp, inv.cliente_ciudad].filter(Boolean).join(' ') + (inv.cliente_pais ? `, ${inv.cliente_pais}` : '') },
            { text: inv.cliente_email },
            { text: inv.cliente_telefono ? `Tel: ${inv.cliente_telefono}` : '' },
          ]);
          break;
        case 'meta':
          drawLines(b, [
            { text: esRect ? 'FACTURA RECTIFICATIVA' : 'FACTURA', bold: true, size: (b.fontSize || 12) + 2, color: esRect ? red : black },
            { text: `N.º ${inv.codigo}`, bold: true },
            { text: `Fecha: ${new Date(inv.fecha_emision).toLocaleDateString('es-ES')}` },
            { text: esRect && inv.rectifica_codigo ? `Rectifica a: ${inv.rectifica_codigo}` : '', color: gray, size: (b.fontSize || 12) - 2 },
          ]);
          break;
        case 'totales':
          drawLines(b, [
            { text: `Base imponible: ${fmtEUR(inv.base_imponible)}` },
            { text: `IVA (${inv.iva_pct}%): ${fmtEUR(inv.iva_importe)}` },
            { text: inv.leyenda_iva || '', size: (b.fontSize || 12) - 2, color: gray },
            { text: `TOTAL: ${fmtEUR(inv.total)}`, bold: true, size: (b.fontSize || 12) + 2 },
          ]);
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
            const precio = Number(it.precio_unitario || 0);
            const subt = cant * precio;
            const desc = String(it.descripcion || '').slice(0, 55);
            page.drawText(desc, { x: colDesc, y: yy, size, font, color: black });
            page.drawText(String(cant), { x: colCant, y: yy, size, font, color: black });
            page.drawText(fmtEUR(precio), { x: colPrec, y: yy, size, font, color: black });
            page.drawText(fmtEUR(subt), { x: colTot, y: yy, size, font, color: black });
            yy -= size * 1.5;
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
  page.drawText(`Factura ${inv.codigo} · ${new Date().toLocaleDateString('es-ES')}`,
    { x: 50, y: 25, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
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
  const subject = `Factura ${inv.codigo} - ${project?.nombre || 'CRM'}`;
  const html = `
    <p>Hola ${inv.cliente_nombre},</p>
    <p>Adjuntamos tu factura <strong>${inv.codigo}</strong> por importe de <strong>${fmtEUR(inv.total)}</strong>.</p>
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
