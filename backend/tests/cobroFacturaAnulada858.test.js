import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import * as conversionService from '../src/modules/conversions/conversion.service.js';
import * as invoicesModel from '../src/modules/invoices/invoices.model.js';

/**
 * CRM-ISEIE#858 (gemela CRM#1230) · El cobro de una factura ANULADA se puede
 * borrar.
 *
 * «Anular» (CRM#793) emite un abono por lo que quede y deja la factura con
 * `anulada_at`, sin pasarla a 'cancelada'. El borrado de cobros solo dejaba
 * pasar las canceladas, así que un cobro repetido al que se le facturó por
 * error se quedaba para siempre, inflando lo cobrado y la comisión.
 *
 * Se puede borrar cuando TODAS sus facturas están anuladas por abonos que las
 * dejan a cero. La factura y su abono se quedan como están (son documentos
 * emitidos): solo desaparece el cobro y se recalcula lo cobrado y la comisión.
 *
 *   npx vitest run tests/cobroFacturaAnulada858.test.js
 */

const MARCA = `C858${Date.now().toString(36)}`;
const SERIE = `A${Date.now().toString(36).slice(-6)}`;
const ANO = new Date().getFullYear();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const cobrado = async (id) => Number((await one('SELECT importe_pagado FROM conversions WHERE id = $1', [id])).importe_pagado);
const comision = async (id) => one('SELECT importe_base::float8 AS base, importe_comision::float8 AS importe FROM commissions WHERE conversion_id = $1', [id]);
// Lo que hace de una factura un documento fiscal: si algo de esto cambia, se ha tocado.
const DOC = `id, serie, ano, numero, codigo, tipo, estado, total::float8 AS total, base_imponible::float8 AS base,
             items, fecha_emision, rectifica_id, anulada_at, anulada_abono_id, motivo_anulacion`;
const documento = (id) => one(`SELECT ${DOC} FROM invoices WHERE id = $1`, [id]);

let P; let GESTORA; let lead; let EMISOR;
const HOY = new Date().toISOString().slice(0, 10);
let numero = 0;

async function venta(importe_total) {
  return conversionModel.create({
    lead_id: lead.id, project_id: P, producto_contratado: `${MARCA} curso`,
    importe_total, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: '2026-11-02',
    iva_incluido: true,
  });
}
const cobro = async (v, importe, fecha) => {
  const r = await conversionModel.addPayment(v.id, { importe, fecha, metodo: 'transferencia' }, { allowDuplicate: true });
  expect(r.error).toBeUndefined();
  return r.payment;
};
// Una factura emitida de ese cobro, como la que sale sola al registrarlo.
async function facturaDe(v, pago) {
  numero += 1;
  return (await one(
    `INSERT INTO invoices (project_id, conversion_id, lead_id, payment_id, ano, serie, numero, codigo, tipo, estado,
                           fecha_emision, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                           items, base_imponible, iva_pct, iva_importe, total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'normal', 'pagada', CURRENT_DATE, $9, 'X1234567L',
             'Calle 1', 'Madrid', '28001', 'España', $10::jsonb, $11, 0, 0, $11) RETURNING id`,
    [P, v.id, lead.id, pago.id, ANO, SERIE, numero, `${SERIE}-${ANO}/${String(numero).padStart(4, '0')}`,
     `${MARCA} Cliente`, JSON.stringify([{ descripcion: 'Curso', cantidad: 1, precio_unitario: Number(pago.importe) }]),
     Number(pago.importe)])).id;
}
const anular = (facturaId) => invoicesModel.anularEmitida(facturaId, { motivo: 'Cobro repetido', userId: GESTORA.id });

beforeAll(async () => {
  // Una sociedad con CIF válido: las pruebas que emiten de verdad la necesitan.
  EMISOR = (await one(
    `INSERT INTO invoice_issuers (razon_social, nif, serie, activo) VALUES ($1, 'B12345674', $2, true) RETURNING id`,
    [`${MARCA} S.L.`, `E${SERIE}`])).id;
  P = (await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} campus`, MARCA.toLowerCase(), `${MARCA}-k`, EMISOR])).id;
  GESTORA = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} gestora`, `gestora@${MARCA.toLowerCase()}.test`]);
  lead = await one(`INSERT INTO leads (nombre, project_id, responsable_id) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} alumno`, P, GESTORA.id]);
  // 10 % de lo cobrado: así se ve si la comisión sigue al cobro.
  await q(`INSERT INTO commission_rules (project_id, user_id, product_id, pct, base_calc) VALUES ($1, $2, NULL, 10, 'cobrado')`,
    [P, GESTORA.id]);
}, 60000);

afterAll(async () => {
  const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(P)}`;
  for (const sql of [
    `DELETE FROM commissions WHERE conversion_id IN (${ventas})`,
    `UPDATE invoices SET anulada_abono_id = NULL WHERE project_id = ${Number(P)}`,
    `DELETE FROM invoices WHERE project_id = ${Number(P)} AND rectifica_id IS NOT NULL`,
    `DELETE FROM invoices WHERE project_id = ${Number(P)}`,
    `DELETE FROM invoice_sequences WHERE project_id = ${Number(P)}`,
    `DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`,
    `DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`,
    `DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`,
    `DELETE FROM conversions WHERE project_id = ${Number(P)}`,
    `DELETE FROM commission_rules WHERE project_id = ${Number(P)}`,
    `DELETE FROM leads WHERE project_id = ${Number(P)}`,
    `DELETE FROM users WHERE id = ${Number(GESTORA?.id || 0)}`,
    `DELETE FROM projects WHERE id = ${Number(P)}`,
    `DELETE FROM invoice_sequences WHERE serie = 'E${SERIE}'`,
    `DELETE FROM invoice_issuers WHERE id = ${Number(EMISOR || 0)}`,
  ]) {
    try { await q(sql); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('#858 · el cobro de una factura anulada', () => {
  it('se borra; la factura y su abono se quedan como estaban; lo cobrado y la comisión bajan', async () => {
    // El caso de la issue: una venta de 200 € con su cobro de 100 y el mismo
    // cobro apuntado dos veces, las dos con factura.
    const v = await venta(200);
    const bueno = await cobro(v, 100, '2026-11-03');
    const repetido = await cobro(v, 100, '2026-11-03');
    const fBuena = await facturaDe(v, bueno);
    const fRepetida = await facturaDe(v, repetido);
    // Lo que hace el alta del cobro desde la pantalla (conversion.service createPayment).
    await (await import('../src/modules/commissions/commission.model.js')).recalculateCommission(v.id);
    expect(await cobrado(v.id)).toBe(200);
    expect((await comision(v.id)).importe).toBe(20);

    const { abono } = await anular(fRepetida);
    expect(Number(abono.total)).toBe(-100);
    const antesFactura = await documento(fRepetida);
    const antesAbono = await documento(abono.id);
    const antesBuena = await documento(fBuena);

    await conversionService.removePayment(repetido.id);

    expect(await one('SELECT id FROM conversion_payments WHERE id = $1', [repetido.id])).toBeUndefined();
    expect(await cobrado(v.id)).toBe(100);
    const c = await comision(v.id);
    expect(c.base).toBe(100);
    expect(c.importe).toBe(10);
    // Documentos fiscales intactos: mismo número, código, importe, estado y anulación.
    expect(await documento(fRepetida)).toEqual(antesFactura);
    expect(await documento(abono.id)).toEqual(antesAbono);
    expect(await documento(fBuena)).toEqual(antesBuena);
    // Solo se suelta el enlace al cobro, que ya no existe (la clave es ON DELETE SET NULL).
    expect((await one('SELECT payment_id FROM invoices WHERE id = $1', [fRepetida])).payment_id).toBeNull();
    expect((await one('SELECT payment_id FROM invoices WHERE id = $1', [fBuena])).payment_id).toBe(bueno.id);
  });

  it('venta de pago único: la anulada no cubre la venta; el cobro bueno sale en la cola y recibe factura NUEVA', async () => {
    // El caso del QA (repro.sql): venta de 100, cobro manual M de 100 con su
    // factura F por el total; se anula F, se borra M y entra el cobro real S.
    // F decía «cubro la venta entera» (VENTA_YA_FACTURADA_LO_CUBRE y `facTot`)
    // aunque estaba anulada: S desaparecía de la cola y «Generar factura» (o
    // la factura automática) devolvía F.
    const v = await venta(100);
    const m = await cobro(v, 100, HOY);
    const f = await facturaDe(v, m);
    await anular(f);
    await conversionService.removePayment(m.id);
    const antesF = await documento(f);

    const s = await cobro(v, 100, HOY);
    const cola = await invoicesModel.listPagosSinFactura(P);
    expect(cola.map((r) => r.payment_id)).toContain(s.id);

    const inv = await invoicesModel.emitirFacturaDePago(v.id, { paymentId: s.id, importe: 100 });
    expect(inv.id).not.toBe(f);
    expect(inv.payment_id).toBe(s.id);
    expect(inv.anulada_at).toBeNull();
    expect(Number(inv.total)).toBe(100);
    // La anulada sigue sola, sin cobro y sin tocar.
    expect((await one('SELECT payment_id FROM invoices WHERE id = $1', [f])).payment_id).toBeNull();
    expect(await documento(f)).toEqual(antesF);
    // Y ya facturado, S sale de la cola.
    expect((await invoicesModel.listPagosSinFactura(P)).map((r) => r.payment_id)).not.toContain(s.id);
  });

  it('venta a plazos: la anulada, ya sin cobro, no se engancha a la cuota siguiente del mismo importe', async () => {
    const v = await venta(200);
    const bueno = await cobro(v, 100, HOY);
    const repetido = await cobro(v, 100, HOY);
    await facturaDe(v, bueno);
    const fRepetida = await facturaDe(v, repetido);
    await anular(fRepetida);
    await conversionModel.deletePayment(repetido.id);

    // La segunda cuota, de verdad, por el mismo importe.
    const segunda = await cobro(v, 100, HOY);
    const cola = await invoicesModel.listPagosSinFactura(P);
    expect(cola.map((r) => r.payment_id)).toContain(segunda.id);

    // La buena de la primera cuota es del mismo importe y la misma semana: el
    // aviso de posible duplicada (CRM#819) salta con razón y quien emite confirma.
    const inv = await invoicesModel.emitirFacturaDePago(v.id, { paymentId: segunda.id, importe: 100, confirmarDuplicada: true });
    expect(inv.id).not.toBe(fRepetida);
    expect(inv.payment_id).toBe(segunda.id);
    expect((await one('SELECT payment_id FROM invoices WHERE id = $1', [fRepetida])).payment_id).toBeNull();
  });

  it('abono parcial y luego «Anular»: queda a cero y el cobro se borra', async () => {
    const v = await venta(300);
    const p = await cobro(v, 100, '2026-11-11');
    const f = await facturaDe(v, p);
    await invoicesModel.createRectificativa(f, { motivo: 'Descuento', userId: GESTORA.id, parcial: 40 });
    // Con el abono parcial sola, no: le quedan 60.
    await expect(conversionModel.deletePayment(p.id)).rejects.toMatchObject({
      statusCode: 409, code: 'PAYMENT_HAS_INVOICE',
    });
    const { abono } = await anular(f);
    expect(Number(abono.total)).toBe(-60);
    await conversionService.removePayment(p.id);
    expect(await one('SELECT id FROM conversion_payments WHERE id = $1', [p.id])).toBeUndefined();
  });

  it('en borrador: 409 con «Edítala o cancélala», no «Anúlala»', async () => {
    const v = await venta(300);
    const p = await cobro(v, 70, '2026-11-12');
    const f = await facturaDe(v, p);
    await q(`UPDATE invoices SET estado = 'borrador', numero = NULL, codigo = NULL WHERE id = $1`, [f]);
    const err = await conversionModel.deletePayment(p.id).then(() => null, (e) => e);
    expect(err).toMatchObject({ statusCode: 409, code: 'PAYMENT_HAS_INVOICE' });
    expect(err.message).toMatch(/Edítala o cancélala/);
    expect(err.message).not.toMatch(/Anúlala/);
  });

  it('con la factura vigente: 409 PAYMENT_HAS_INVOICE y el cobro sigue', async () => {
    const v = await venta(300);
    const p = await cobro(v, 150, '2026-11-04');
    const f = await facturaDe(v, p);
    await expect(conversionModel.deletePayment(p.id)).rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_HAS_INVOICE' });
    expect(await one('SELECT id FROM conversion_payments WHERE id = $1', [p.id])).toBeTruthy();
    expect(await cobrado(v.id)).toBe(150);
    expect((await one('SELECT payment_id FROM invoices WHERE id = $1', [f])).payment_id).toBe(p.id);
  });

  it('anulada pero sin un abono que la deje a cero: 409', async () => {
    const v = await venta(300);
    const p = await cobro(v, 90, '2026-11-06');
    const f = await facturaDe(v, p);
    // Marcada como anulada a mano, sin abono: no está a cero.
    await q(`UPDATE invoices SET anulada_at = NOW(), motivo_anulacion = 'a mano' WHERE id = $1`, [f]);
    await expect(conversionModel.deletePayment(p.id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await cobrado(v.id)).toBe(90);
  });

  it('con un abono total pero sin «Anular»: sigue siendo vigente, 409', async () => {
    const v = await venta(300);
    const p = await cobro(v, 80, '2026-11-07');
    const f = await facturaDe(v, p);
    await invoicesModel.createRectificativa(f, { motivo: 'Abono', userId: GESTORA.id });
    await expect(conversionModel.deletePayment(p.id)).rejects.toMatchObject({ code: 'PAYMENT_HAS_INVOICE' });
  });

  it('sin factura: se borra como hoy y la cuota vuelve a pendiente', async () => {
    const v = await venta(300);
    const [cuota] = await q(
      `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
       VALUES ($1, 1, 100, '2026-11-08') RETURNING id`, [v.id]);
    const p = await cobro(v, 100, '2026-11-08');
    await q(`UPDATE conversion_installments SET payment_id = $1, fecha_cobro = '2026-11-08', importe_cobrado = 100 WHERE id = $2`, [p.id, cuota.id]);
    await conversionService.removePayment(p.id);
    expect(await one('SELECT id FROM conversion_payments WHERE id = $1', [p.id])).toBeUndefined();
    expect(await cobrado(v.id)).toBe(0);
    const c = await one('SELECT payment_id, fecha_cobro, importe_cobrado FROM conversion_installments WHERE id = $1', [cuota.id]);
    expect(c).toEqual({ payment_id: null, fecha_cobro: null, importe_cobrado: null });
  });

  it('con solo una proforma: se borra como hoy', async () => {
    const v = await venta(300);
    const p = await cobro(v, 60, '2026-11-09');
    await q(`INSERT INTO invoices (project_id, conversion_id, payment_id, ano, serie, numero, codigo, tipo, estado, fecha_emision,
                                   cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                                   items, base_imponible, iva_pct, iva_importe, total)
             VALUES ($1, $2, $3, $4, $5, 1, $6, 'proforma', 'emitida', CURRENT_DATE, 'x', 'X1234567L',
                     'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 60, 0, 0, 60)`,
      [P, v.id, p.id, ANO, `P${SERIE.slice(1)}`, `PRO-${SERIE}-1`]);
    await conversionModel.deletePayment(p.id);
    expect(await cobrado(v.id)).toBe(0);
  });
});
