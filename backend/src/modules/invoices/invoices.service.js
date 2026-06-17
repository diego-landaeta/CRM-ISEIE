import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
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

  let y = 800;
  const left = 50;
  const right = 545;

  // Cabecera proyecto
  page.drawText(project?.nombre || 'CRM', { x: left, y, size: 18, font: bold, color: black });
  y -= 24;
  const datosFiscalesProyecto = project?.datos_fiscales || {};
  if (datosFiscalesProyecto.razon_social) {
    page.drawText(datosFiscalesProyecto.razon_social, { x: left, y, size: 10, font, color: gray });
    y -= 12;
  }
  if (datosFiscalesProyecto.nif) {
    page.drawText(`NIF: ${datosFiscalesProyecto.nif}`, { x: left, y, size: 10, font, color: gray });
    y -= 12;
  }
  if (datosFiscalesProyecto.direccion) {
    page.drawText(datosFiscalesProyecto.direccion, { x: left, y, size: 10, font, color: gray });
    y -= 12;
  }

  // Codigo de factura (derecha)
  page.drawText('FACTURA', { x: right - 100, y: 800, size: 16, font: bold, color: black });
  page.drawText(`N.º ${inv.codigo}`, { x: right - 100, y: 780, size: 12, font: bold, color: black });
  page.drawText(`Fecha: ${new Date(inv.fecha_emision).toLocaleDateString('es-ES')}`, { x: right - 100, y: 765, size: 10, font, color: gray });

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
