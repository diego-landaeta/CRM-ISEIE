import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import * as installmentsModel from '../src/modules/conversions/installments.model.js';
import { unpayInstallment } from '../src/modules/conversions/conversion.controller.js';

/**
 * CRM-ISEIE#856 (gemela CRM#1228) · «Deshacer el pago» de una cuota borraba el
 * cobro aunque tuviera factura.
 *
 * Las claves ajenas ponen a nulo el enlace de la factura (ON DELETE SET NULL):
 * la factura se quedaba huérfana y el CRM la volvía a enganchar sola al cobro
 * del mismo importe más cercano. Ahora dice que no, con el mismo criterio y
 * mensaje que «Eliminar pago»; sin factura (o con una cancelada, o una
 * proforma) sigue como siempre.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/deshacerPagoConFactura856.test.js
 */

const MARCA = `D856_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto;
let lead;
let numero = 0;

async function cuotaCobrada(importe = 200) {
  const v = await conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total: 600, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: '2026-11-01',
    iva_incluido: true,
  });
  const [cuota] = await q(
    `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
     VALUES ($1, 1, $2, '2026-11-01') RETURNING id`, [v.id, importe]);
  await installmentsModel.markPaid(cuota.id, { fecha_cobro: '2026-11-01', importe_cobrado: importe, metodo: 'transferencia' });
  const [{ payment_id }] = await q('SELECT payment_id FROM conversion_installments WHERE id = $1', [cuota.id]);
  return { venta: v, cuotaId: cuota.id, paymentId: payment_id };
}

async function factura({ venta, paymentId }, { tipo = 'normal', estado = 'emitida' } = {}) {
  numero += 1;
  const [f] = await q(
    `INSERT INTO invoices (project_id, conversion_id, payment_id, ano, numero, codigo, tipo, estado, cliente_nombre, cliente_nif,
                          cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, total, fecha_emision)
     VALUES ($1, $2, $3, 2026, $4, $5, $6, $7, $8, 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 200, 200, '2026-11-01')
     RETURNING id, codigo`,
    [proyecto.id, venta.id, paymentId, 91000 + numero, `${MARCA}-F${numero}`, tipo, estado, MARCA]);
  return f;
}

const cobros = async (ventaId) => q('SELECT id FROM conversion_payments WHERE conversion_id = $1', [ventaId]);
const cuota = async (id) => (await q('SELECT fecha_cobro, payment_id FROM conversion_installments WHERE id = $1', [id]))[0];
const pagado = async (id) => Number((await q('SELECT importe_pagado FROM conversions WHERE id = $1', [id]))[0].importe_pagado);

beforeAll(async () => {
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  [lead] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [MARCA, proyecto.id]);
});

afterAll(async () => {
  if (proyecto) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(proyecto.id)}`;
    await q('DELETE FROM invoices WHERE project_id = $1', [proyecto.id]);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
    await q('DELETE FROM conversions WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('#856 · «Deshacer el pago» no deja huérfana una factura', () => {
  it('con factura emitida dice que no (409) y no toca nada', async () => {
    const c = await cuotaCobrada();
    const f = await factura(c);

    await expect(installmentsModel.unpay(c.cuotaId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_HAS_INVOICE',
      message: `Ese cobro tiene la factura ${f.codigo}. Anúlala antes de borrar el cobro.`,
    });

    // El cobro sigue, la cuota sigue cobrada y la factura sigue enganchada a él.
    expect((await cobros(c.venta.id)).map((p) => p.id)).toContain(c.paymentId);
    expect(await cuota(c.cuotaId)).toMatchObject({ payment_id: c.paymentId });
    expect((await cuota(c.cuotaId)).fecha_cobro).not.toBeNull();
    const [enlace] = await q('SELECT payment_id FROM invoices WHERE id = $1', [f.id]);
    expect(enlace.payment_id).toBe(c.paymentId);
    expect(await pagado(c.venta.id)).toBe(200);
  });

  it('la API responde 409 PAYMENT_HAS_INVOICE, no un 500', async () => {
    const c = await cuotaCobrada();
    await factura(c);
    let error;
    const res = { json: () => { throw new Error('no debía responder bien'); } };
    await unpayInstallment({ params: { instId: String(c.cuotaId) } }, res, (e) => { error = e; });
    expect(error).toMatchObject({ statusCode: 409, code: 'PAYMENT_HAS_INVOICE' });
  });

  it('el mismo criterio y el mismo mensaje que «Eliminar pago»', async () => {
    const c = await cuotaCobrada();
    await factura(c);
    const deshacer = await installmentsModel.unpay(c.cuotaId).catch((e) => e);
    const eliminar = await conversionModel.deletePayment(c.paymentId).catch((e) => e);
    expect(deshacer.code).toBe('PAYMENT_HAS_INVOICE');
    expect(eliminar.code).toBe('PAYMENT_HAS_INVOICE');
    expect(deshacer.statusCode).toBe(eliminar.statusCode);
    expect(deshacer.message).toBe(eliminar.message);
  });

  it('con la factura cancelada se deshace como siempre', async () => {
    const c = await cuotaCobrada();
    await factura(c, { estado: 'cancelada' });
    await installmentsModel.unpay(c.cuotaId);
    expect(await cobros(c.venta.id)).toHaveLength(0);
    expect(await cuota(c.cuotaId)).toMatchObject({ fecha_cobro: null, payment_id: null });
  });

  it('una proforma no es una factura: se deshace como siempre', async () => {
    const c = await cuotaCobrada();
    await factura(c, { tipo: 'proforma' });
    await installmentsModel.unpay(c.cuotaId);
    expect(await cobros(c.venta.id)).toHaveLength(0);
  });

  it('sin factura, igual que hoy: borra el cobro y la cuota vuelve a pendiente', async () => {
    const c = await cuotaCobrada();
    await installmentsModel.unpay(c.cuotaId);
    expect(await cobros(c.venta.id)).toHaveLength(0);
    expect(await cuota(c.cuotaId)).toMatchObject({ fecha_cobro: null, payment_id: null });
    expect(await pagado(c.venta.id)).toBe(0);
  });
});
