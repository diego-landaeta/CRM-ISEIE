import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * CRM-ISEIE#858 (gemela CRM#1230) · La factura automática nunca manda al
 * alumno una factura ANULADA.
 *
 * El caso del QA, en una venta de pago único: el cobro M sale con su factura F
 * (automática, con los datos del alumno); se anula F, se borra M y entra el
 * cobro real S. F seguía «cubriendo la venta entera» (`facTot` y el cuadre de
 * `emitirFacturaDePago` no miraban `anulada_at`), así que la emisión de S
 * devolvía F y, como F lleva los datos de esa misma petición, se le mandaba el
 * PDF de la anulada.
 *
 * Con base real. Lo de fuera, simulado como en facturaAutoEnvio764.test.js.
 */

vi.setConfig({ testTimeout: 90000, hookTimeout: 60000 });

const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));
vi.mock('../src/modules/invoices/invoices.service.js', async (original) => ({
  ...(await original()),
  puedeFacturarAhora: vi.fn(async () => true),
  generatePDF: vi.fn(async () => ({ bytes: Buffer.from('%PDF-1.4 prueba') })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');
const conversionService = await import('../src/modules/conversions/conversion.service.js');
const invoicesModel = await import('../src/modules/invoices/invoices.model.js');
const fa = await import('../src/modules/factura-automatica/factura-automatica.service.js');

const MARCA = `N858_${Date.now().toString(36)}`;
const SERIE = `N${crypto.randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 7);
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const hoy = new Date().toISOString().slice(0, 10);
let proyecto;
let emisor;
let usuario;

const enlaceDe = (c) => /datos-fiscales\/([A-Za-z0-9_.-]+)/.exec(c.htmlContent)?.[1];
const peticiones = () => correos.filter((c) => /datos-fiscales\//.test(c.htmlContent));
const pdfs = () => correos.filter((c) => c.attachment?.length).map((c) => c.attachment[0].name);
const nombrePdf = (codigo) => `${String(codigo).replace('/', '-')}.pdf`;

beforeAll(async () => {
  [emisor] = await q(
    'INSERT INTO invoice_issuers (razon_social, nif, serie, activo) VALUES ($1, \'B12345674\', $2, true) RETURNING id',
    [`${MARCA} S.L.`, SERIE]);
  [proyecto] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [MARCA, MARCA.toLowerCase(), MARCA, emisor.id]);
  [usuario] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${MARCA} admin`, `admin@${MARCA.toLowerCase()}.test`]);
});

beforeEach(() => {
  correos.length = 0;
  process.env.FACTURA_AUTOMATICA_ACTIVA = '1';
  process.env.FACTURA_AUTOMATICA_CAMPUS = String(proyecto.id);
  process.env.FACTURA_AUTOMATICA_ENVIAR_PDF = '1';
});

afterAll(async () => {
  delete process.env.FACTURA_AUTOMATICA_ACTIVA;
  delete process.env.FACTURA_AUTOMATICA_CAMPUS;
  delete process.env.FACTURA_AUTOMATICA_ENVIAR_PDF;
  if (proyecto) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(proyecto.id)}`;
    for (const sql of [
      `UPDATE invoices SET anulada_abono_id = NULL WHERE project_id = ${Number(proyecto.id)}`,
      `DELETE FROM invoices WHERE project_id = ${Number(proyecto.id)} AND rectifica_id IS NOT NULL`,
      `DELETE FROM invoices WHERE project_id = ${Number(proyecto.id)}`,
      `DELETE FROM factura_datos_fiscales WHERE project_id = ${Number(proyecto.id)}`,
      `DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`,
      `DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`,
      `DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`,
      `DELETE FROM commissions WHERE conversion_id IN (${ventas})`,
      `DELETE FROM conversions WHERE project_id = ${Number(proyecto.id)}`,
      `DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ${Number(proyecto.id)})`,
      `DELETE FROM leads WHERE project_id = ${Number(proyecto.id)}`,
      `DELETE FROM invoice_sequences WHERE serie IN ('${SERIE}', 'R${SERIE}', 'R')
         AND project_id = ${Number(proyecto.id)}`,
      `DELETE FROM user_activity_log WHERE user_id = ${Number(usuario?.id || 0)}`,
      `DELETE FROM users WHERE id = ${Number(usuario?.id || 0)}`,
      `DELETE FROM projects WHERE id = ${Number(proyecto.id)}`,
      `DELETE FROM invoice_sequences WHERE serie = '${SERIE}'`,
    ]) {
      try { await q(sql); } catch { /* sigue limpiando */ }
    }
  }
  if (emisor) await q('DELETE FROM invoice_issuers WHERE id = $1', [emisor.id]).catch(() => {});
  await pool.end();
});

describe('#858 · la factura automática no manda una anulada', () => {
  it('pago único: anulada F y borrado su cobro, el cobro bueno recibe una factura NUEVA y solo esa sale por correo', async () => {
    const email = 'alumna.anulada.858@example.com';
    const [lead] = await q(
      'INSERT INTO leads (nombre, email, project_id, pais_fiscal) VALUES ($1, $2, $3, \'España\') RETURNING id',
      ['Alumna Anulada Pérez Gil', email, proyecto.id]);
    const v = await conversionModel.create({
      lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
      importe_total: 250, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: hoy, iva_incluido: true,
    });

    // M: el cobro apuntado a mano, con su factura automática F.
    const m = (await conversionModel.addPayment(v.id, { importe: 250, fecha: hoy, metodo: 'transferencia' }, { allowDuplicate: true })).payment;
    await fa.alCobrar({ conversionId: v.id, paymentId: m.id });
    expect(peticiones()).toHaveLength(1);
    await fa.responder(enlaceDe(peticiones()[0]), {
      tipo: 'particular', nombre: 'Alumna Anulada Pérez Gil', nif: '00000004G', direccion: 'Calle del Olmo 3',
      codigo_postal: '28005', ciudad: 'Madrid', pais: 'España', email,
    });
    const [f] = await q('SELECT * FROM invoices WHERE payment_id = $1 AND estado <> \'cancelada\'', [m.id]);
    expect(f).toBeTruthy();
    expect(f.datos_fiscales_id).not.toBeNull();
    expect(pdfs()).toEqual([nombrePdf(f.codigo)]);

    // Se anula F (abono a cero) y se borra M.
    await invoicesModel.anularEmitida(f.id, { motivo: 'Cobro manual repetido', userId: usuario.id });
    await conversionService.removePayment(m.id, { userId: usuario.id });
    correos.length = 0;

    // S: el cobro real, por el mismo importe.
    const s = (await conversionModel.addPayment(v.id, { importe: 250, fecha: hoy, metodo: 'tarjeta_stripe' }, { allowDuplicate: true })).payment;
    await fa.alCobrar({ conversionId: v.id, paymentId: s.id });

    // Lo primero: el PDF de la anulada no sale.
    expect(pdfs()).not.toContain(nombrePdf(f.codigo));
    const [nueva] = await q('SELECT * FROM invoices WHERE payment_id = $1 AND estado <> \'cancelada\'', [s.id]);
    expect(nueva).toBeTruthy();
    expect(nueva.id).not.toBe(f.id);
    expect(nueva.anulada_at).toBeNull();
    expect(Number(nueva.total)).toBe(250);
    // Sale el PDF de la nueva, y el de la anulada no.
    expect(pdfs()).toEqual([nombrePdf(nueva.codigo)]);
    expect(pdfs()).not.toContain(nombrePdf(f.codigo));
    // La anulada no se ha reenviado ni se ha tocado.
    const [fDespues] = await q('SELECT sent_at, sent_to_email, payment_id, anulada_at FROM invoices WHERE id = $1', [f.id]);
    expect(fDespues.payment_id).toBeNull();
    expect(fDespues.anulada_at).not.toBeNull();
    expect(fDespues.sent_at?.toISOString?.()).toBe(f.sent_at?.toISOString?.());
  });
});
