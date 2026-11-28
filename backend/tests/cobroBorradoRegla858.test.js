import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool, { getClient } from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import * as conversionService from '../src/modules/conversions/conversion.service.js';
import * as installmentsModel from '../src/modules/conversions/installments.model.js';
import * as invoicesModel from '../src/modules/invoices/invoices.model.js';
import { negarSiTieneFactura, motivoParaNoBorrar, MOTIVO_COMISION_TUTOR } from '../src/modules/conversions/cobro-facturado.js';

/**
 * CRM-ISEIE#858 + CRM-ISEIE#856 (gemelas CRM#1230 + #1228), unificadas · UNA regla
 * para borrar un cobro, la de `cobro-facturado.js`, en «Eliminar pago» y en
 * «Deshacer el pago», y lo que pidieron los dos QA:
 *
 *   · una factura vigente junto a una anulada → 409;
 *   · el cobro se bloquea antes de mirar sus facturas (carrera con una emisión);
 *   · la pantalla recibe el mismo criterio y el mismo texto;
 *   · «Deshacer el pago» recalcula la comisión igual que «Eliminar pago»;
 *   · el borrado deja rastro en user_activity_log, con quién lo hizo;
 *   · comisión de tutor pagada → 409; comisión de gestora pagada → no se rebaja.
 *
 *   npx vitest run tests/cobroBorradoRegla858.test.js
 */

const MARCA = `R858${Date.now().toString(36)}`;
const SERIE = `B${Date.now().toString(36).slice(-6)}`;
const ANO = new Date().getFullYear();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const comision = async (id) => one('SELECT importe_comision::float8 AS importe, estado FROM commissions WHERE conversion_id = $1', [id]);
const existe = async (paymentId) => !!(await one('SELECT 1 FROM conversion_payments WHERE id = $1', [paymentId]));

let P; let GESTORA; let TUTOR; let lead;
let numero = 0;

async function venta(importe_total = 300) {
  return conversionModel.create({
    lead_id: lead.id, project_id: P, producto_contratado: `${MARCA} curso`,
    importe_total, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: '2026-11-02',
    iva_incluido: true,
  });
}
const cobro = async (v, importe, fecha = '2026-11-03') => {
  const r = await conversionModel.addPayment(v.id, { importe, fecha, metodo: 'transferencia' }, { allowDuplicate: true });
  return r.payment;
};
async function cuotaCobrada(v, importe = 100) {
  const [c] = await q(
    `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
     VALUES ($1, 1, $2, '2026-11-03') RETURNING id`, [v.id, importe]);
  await installmentsModel.markPaid(c.id, { fecha_cobro: '2026-11-03', importe_cobrado: importe, metodo: 'transferencia' });
  const { payment_id: paymentId } = await one('SELECT payment_id FROM conversion_installments WHERE id = $1', [c.id]);
  return { cuotaId: c.id, paymentId };
}
async function facturaDe(v, paymentId, importe) {
  numero += 1;
  return one(
    `INSERT INTO invoices (project_id, conversion_id, lead_id, payment_id, ano, serie, numero, codigo, tipo, estado,
                           fecha_emision, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                           items, base_imponible, iva_pct, iva_importe, total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'normal', 'pagada', CURRENT_DATE, $9, 'X1234567L',
             'Calle 1', 'Madrid', '28001', 'España', $10::jsonb, $11, 0, 0, $11) RETURNING id, codigo`,
    [P, v.id, lead.id, paymentId, ANO, SERIE, numero, `${SERIE}-${ANO}/${String(numero).padStart(4, '0')}`,
     `${MARCA} Cliente`, JSON.stringify([{ descripcion: 'Curso', cantidad: 1, precio_unitario: importe }]), importe]);
}
const anular = (id) => invoicesModel.anularEmitida(id, { motivo: 'Cobro repetido', userId: GESTORA.id });
const recalcular = async (v) => (await import('../src/modules/commissions/commission.model.js')).recalculateCommission(v.id);
async function comisionTutor(paymentId, estado) {
  return one(
    `INSERT INTO tutor_commissions (payment_id, tutor_id, base_calculo, pct, importe, estado, periodo)
     VALUES ($1, $2, 100, 10, 10, $3, '2026-11') RETURNING id`, [paymentId, TUTOR.id, estado]);
}

beforeAll(async () => {
  P = (await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} campus`, MARCA.toLowerCase(), `${MARCA}-k`])).id;
  GESTORA = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} gestora`, `gestora@${MARCA.toLowerCase()}.test`]);
  TUTOR = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} tutor`, `tutor@${MARCA.toLowerCase()}.test`]);
  lead = await one(`INSERT INTO leads (nombre, project_id, responsable_id) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} alumno`, P, GESTORA.id]);
  await q(`INSERT INTO commission_rules (project_id, user_id, product_id, pct, base_calc) VALUES ($1, $2, NULL, 10, 'cobrado')`,
    [P, GESTORA.id]);
}, 60000);

afterAll(async () => {
  const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(P)}`;
  for (const sql of [
    `DELETE FROM user_activity_log WHERE user_id IN (${Number(GESTORA?.id || 0)}, ${Number(TUTOR?.id || 0)})`,
    `DELETE FROM tutor_commissions WHERE tutor_id = ${Number(TUTOR?.id || 0)}`,
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
    `DELETE FROM users WHERE id IN (${Number(GESTORA?.id || 0)}, ${Number(TUTOR?.id || 0)})`,
    `DELETE FROM projects WHERE id = ${Number(P)}`,
  ]) {
    try { await q(sql); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('una sola regla para borrar un cobro', () => {
  it('una factura vigente junto a una anulada a cero: 409 por la vigente', async () => {
    // En la base no se puede montar: el índice único uq_invoices_payment_activo
    // no deja dos facturas vivas en el mismo cobro. Se prueba la función que
    // usan los dos borrados, con lo que le devolvería la consulta.
    const filas = [
      { codigo: 'F-ANULADA', tipo: 'normal', estado: 'pagada', numero: 1, anulada: true, saldo: 0 },
      { codigo: 'F-VIGENTE', tipo: 'normal', estado: 'pagada', numero: 2, anulada: false, saldo: 100 },
    ];
    const consultas = [];
    const cliente = {
      query: async (sql) => {
        consultas.push(sql);
        if (/FROM invoices i/.test(sql)) return { rows: filas };
        if (/tutor_commissions/.test(sql)) return { rows: [{ pagada: false }] };
        return { rows: [] };
      },
    };
    await expect(negarSiTieneFactura(cliente, 1)).rejects.toMatchObject({
      statusCode: 409, code: 'PAYMENT_HAS_INVOICE',
      message: 'Ese cobro tiene la factura F-VIGENTE. Anúlala antes de borrar el cobro.',
    });
    // Y lo primero que hace es bloquear el cobro.
    expect(consultas[0]).toMatch(/FROM conversion_payments WHERE id = \$1 FOR UPDATE/);
    expect(motivoParaNoBorrar([filas[0]])).toBeNull();
  });

  it('el cobro se bloquea antes de mirar facturas: una factura que se emite a la vez espera', async () => {
    const v = await venta();
    const p = await cobro(v, 100);
    const borra = await getClient();
    const emite = await getClient();
    try {
      await borra.query('BEGIN');
      expect(await negarSiTieneFactura(borra, p.id)).toEqual([]);
      // Mientras el borrado no acaba, la factura de ese cobro no puede entrar.
      await emite.query('BEGIN');
      await emite.query("SET LOCAL lock_timeout = '300ms'");
      numero += 1;
      await expect(emite.query(
        `INSERT INTO invoices (project_id, conversion_id, payment_id, ano, serie, numero, codigo, tipo, estado, fecha_emision,
                               cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                               items, base_imponible, iva_pct, iva_importe, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'normal', 'emitida', CURRENT_DATE, 'x', 'X1234567L',
                 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 100, 0, 0, 100)`,
        [P, v.id, p.id, ANO, SERIE, numero, `${SERIE}-L${numero}`])).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await emite.query('ROLLBACK').catch(() => {});
      await borra.query('ROLLBACK').catch(() => {});
      emite.release();
      borra.release();
    }
  });

  it('«Deshacer el pago» con la factura anulada y a cero: se deshace, igual que «Eliminar pago»', async () => {
    const v = await venta();
    const c = await cuotaCobrada(v);
    const f = await facturaDe(v, c.paymentId, 100);
    await anular(f.id);
    await conversionService.unpayInstallment(c.cuotaId, { userId: GESTORA.id });
    expect(await existe(c.paymentId)).toBe(false);
    expect(await one('SELECT fecha_cobro, payment_id FROM conversion_installments WHERE id = $1', [c.cuotaId]))
      .toEqual({ fecha_cobro: null, payment_id: null });
  });

  it('la pantalla recibe el mismo criterio y el mismo texto que el servidor', async () => {
    const v = await venta();
    const vigente = await cuotaCobrada(v);
    const fv = await facturaDe(v, vigente.paymentId, 100);
    const [cuotas] = [await installmentsModel.listByConversion(v.id)];
    const fila = cuotas.find((r) => r.id === vigente.cuotaId);
    expect(fila.factura_anulada).toBe(false);
    expect(fila.factura_anulada_a_cero).toBe(false);
    const err = await installmentsModel.unpay(vigente.cuotaId).then(() => null, (e) => e);
    expect(fila.cobro_bloqueo).toBe(err.message);
    expect(fila.cobro_facturas).toBeUndefined();

    await anular(fv.id);
    const anulada = (await installmentsModel.listByConversion(v.id)).find((r) => r.id === vigente.cuotaId);
    expect(anulada.factura_anulada).toBe(true);
    expect(anulada.factura_anulada_a_cero).toBe(true);
    expect(anulada.cobro_bloqueo).toBeNull();

    // Y en la lista de pagos de la venta («Eliminar pago»), lo mismo.
    const detalle = await conversionModel.findById(v.id);
    const pago = detalle.payments.find((x) => x.id === vigente.paymentId);
    expect(pago.factura_anulada_a_cero).toBe(true);
    expect(pago.cobro_bloqueo).toBeNull();
  });

  it('«Deshacer el pago» recalcula la comisión, como «Eliminar pago»', async () => {
    const v = await venta();
    const c = await cuotaCobrada(v, 100);
    await recalcular(v);
    expect((await comision(v.id)).importe).toBe(10);
    await conversionService.unpayInstallment(c.cuotaId, { userId: GESTORA.id });
    expect((await comision(v.id)).importe).toBe(0);
  });

  it('deja rastro en user_activity_log: importe, fecha, método, cargo de Stripe, facturas y quién', async () => {
    const v = await venta();
    const p = await cobro(v, 100, '2026-11-04');
    await q(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, conversion_id, conversion_payment_id, stripe_created_at)
             VALUES ($1, $2, 'charge', 'succeeded', 100, $3, $4, NOW())`, [P, `ch_${MARCA}`, v.id, p.id]);
    const f = await facturaDe(v, p.id, 100);
    await anular(f.id);
    await conversionService.removePayment(p.id, { userId: GESTORA.id, ip: '10.0.0.7' });

    const log = await one(
      `SELECT user_id, action, details, host(ip_address) AS ip FROM user_activity_log
        WHERE action = 'cobro_borrado' AND (details->>'payment_id')::int = $1`, [p.id]);
    expect(log).toBeTruthy();
    expect(log.user_id).toBe(GESTORA.id);
    expect(log.ip).toBe('10.0.0.7');
    expect(log.details).toMatchObject({
      accion: 'eliminar_pago', payment_id: p.id, conversion_id: v.id, importe: 100, fecha: '2026-11-04',
      metodo: 'transferencia', facturas: [f.codigo],
      stripe: [{ stripe_id: `ch_${MARCA}`, tipo: 'charge', estado: 'succeeded' }],
    });
    await q('DELETE FROM stripe_payments WHERE stripe_id = $1', [`ch_${MARCA}`]);
  });

  it('un 409 no deja rastro: el apunte va en la misma transacción', async () => {
    const v = await venta();
    const p = await cobro(v, 100);
    await facturaDe(v, p.id, 100);
    await expect(conversionService.removePayment(p.id, { userId: GESTORA.id })).rejects.toMatchObject({ statusCode: 409 });
    expect(await one(`SELECT 1 FROM user_activity_log WHERE action = 'cobro_borrado' AND (details->>'payment_id')::int = $1`, [p.id]))
      .toBeUndefined();
  });

  it('comisión de tutor PAGADA: 409 y no se borra nada (la clave es ON DELETE CASCADE)', async () => {
    const v = await venta();
    const p = await cobro(v, 100);
    const tc = await comisionTutor(p.id, 'pagada');
    await expect(conversionService.removePayment(p.id, { userId: GESTORA.id })).rejects.toMatchObject({
      statusCode: 409, code: 'PAYMENT_HAS_PAID_COMMISSION', message: MOTIVO_COMISION_TUTOR,
    });
    expect(await existe(p.id)).toBe(true);
    expect(await one('SELECT estado FROM tutor_commissions WHERE id = $1', [tc.id])).toEqual({ estado: 'pagada' });

    const c = await cuotaCobrada(await venta());
    await comisionTutor(c.paymentId, 'pagada');
    await expect(conversionService.unpayInstallment(c.cuotaId, { userId: GESTORA.id })).rejects.toMatchObject({
      statusCode: 409, code: 'PAYMENT_HAS_PAID_COMMISSION',
    });
    expect(await existe(c.paymentId)).toBe(true);
  });

  it('comisión de tutor sin pagar: el cobro se borra como siempre', async () => {
    const v = await venta();
    const p = await cobro(v, 100);
    await comisionTutor(p.id, 'pendiente');
    await conversionService.removePayment(p.id, { userId: GESTORA.id });
    expect(await existe(p.id)).toBe(false);
  });

  it('comisión de gestora PAGADA: el cobro se borra pero la comisión no se rebaja, y se avisa', async () => {
    const v = await venta();
    const p1 = await cobro(v, 100);
    const p2 = await cobro(v, 100);
    await recalcular(v);
    expect((await comision(v.id)).importe).toBe(20);
    await q(`UPDATE commissions SET estado = 'pagado', fecha_pago = '2026-11-20' WHERE conversion_id = $1`, [v.id]);

    const r = await conversionService.removePayment(p2.id, { userId: GESTORA.id });
    expect(await existe(p2.id)).toBe(false);
    expect(await comision(v.id)).toEqual({ importe: 20, estado: 'pagado' });
    expect(r.aviso).toMatch(/ya está pagada \(20\.00 €, el 2026-11-20\): no se ha rebajado/);

    const log = await one(`SELECT details FROM user_activity_log WHERE action = 'cobro_borrado' AND (details->>'payment_id')::int = $1`, [p2.id]);
    expect(log.details.comision_gestora_pagada).toMatchObject({ importe: 20 });

    // Sin pagar, sí se rebaja (lo de siempre).
    await q(`UPDATE commissions SET estado = 'pendiente', fecha_pago = NULL WHERE conversion_id = $1`, [v.id]);
    const r2 = await conversionService.removePayment(p1.id, { userId: GESTORA.id });
    expect(r2.aviso).toBeNull();
    expect((await comision(v.id)).importe).toBe(0);
  });
});
