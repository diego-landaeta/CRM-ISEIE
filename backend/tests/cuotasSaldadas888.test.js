import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import * as conversionService from '../src/modules/conversions/conversion.service.js';
import * as installmentsModel from '../src/modules/conversions/installments.model.js';
import * as stripeService from '../src/modules/stripe-payments/stripe-payments.service.js';
import * as salesService from '../src/modules/sales/sales.service.js';

/**
 * CRM#888 (gemela CRM-ISEIE#559) · Cada cobro salda su cuota, en orden y con su
 * fecha; antes de apuntar una cuota ya pagada, aviso; y un cargo de Stripe se
 * enlaza con el cobro (o la factura) de ese pago sin crear otro.
 *
 * 18/11/2026: alumnos con los pagos hechos y facturados que salían con cuotas
 * pendientes (65 ventas en ISEIE y 75 en el 360 con un cobro sin cuota y alguna
 * cuota pendiente), y una cuota pagada por Stripe en septiembre que se volvió a
 * apuntar a mano y se facturó otra vez.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs --datos
 *   npx vitest run tests/cuotasSaldadas888.test.js
 */

const MARCA = `C888_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto;
let lead;

async function venta(importe_total, importe_pagado = 0, fecha = '2026-07-17') {
  return conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total, importe_pagado, metodo_pago: 'fraccionado', metodo_pago_inicial: 'tarjeta',
    fecha_conversion: fecha, iva_incluido: true,
  });
}

/** El plan tal cual lo dejaba el alta con el plan completo: todas pendientes. */
async function planCrudo(conversionId, importes, desde = '2026-07-17') {
  for (let i = 0; i < importes.length; i++) {
    await q(
      `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
       VALUES ($1, $2, $3, ($4::date + make_interval(months => $2 - 1))::date)`,
      [conversionId, i + 1, importes[i], desde]);
  }
}

const cuotas = (id) => q(
  `SELECT numero, importe_previsto::float8 AS previsto, fecha_cobro::text AS fecha_cobro,
          importe_cobrado::float8 AS cobrado, payment_id, metodo
     FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero`, [id]);
const cobros = (id) => q('SELECT id, importe::float8 AS importe, fecha::text AS fecha, notas FROM conversion_payments WHERE conversion_id = $1 ORDER BY fecha, id', [id]);

async function cargo(importe, fecha, extra = {}) {
  const [r] = await q(
    `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, stripe_created_at, lead_id, conversion_id)
     VALUES ($1, $2, 'charge', 'succeeded', $3, 'EUR', $4, $5, $6, $7) RETURNING id, stripe_id`,
    [proyecto.id, `ch_${MARCA}_${Math.random().toString(36).slice(2, 10)}`, importe,
     extra.email ?? null, fecha, extra.leadId ?? null, extra.conversionId ?? null]);
  return r;
}

beforeAll(async () => {
  [proyecto] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [MARCA, MARCA.toLowerCase(), MARCA]);
  [lead] = await q('INSERT INTO leads (nombre, email, project_id) VALUES ($1, $2, $3) RETURNING id',
    [MARCA, `${MARCA.toLowerCase()}@prueba.test`, proyecto.id]);
});

afterAll(async () => {
  if (proyecto) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(proyecto.id)}`;
    await q(`DELETE FROM stripe_payments WHERE project_id = $1`, [proyecto.id]);
    await q(`DELETE FROM invoices WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversions WHERE project_id = $1`, [proyecto.id]);
    await q('DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('#888 · cada cobro salda su cuota, en orden y con su fecha', () => {
  it('la venta del 18/11: el pago inicial salda la cuota 1 y el de septiembre la 2 (antes, la 1 y la 2 pendiente)', async () => {
    const v = await venta(465, 232.5, '2026-07-17');
    await planCrudo(v.id, [232.5, 232.5]);
    const r = await conversionModel.addPayment(v.id, { importe: 232.5, fecha: '2026-09-03', metodo: 'tarjeta' }, { allowOverpay: true, allowDuplicate: true });
    expect(r.error).toBeUndefined();
    const [c1, c2] = await cuotas(v.id);
    expect(c1).toMatchObject({ fecha_cobro: '2026-07-17', cobrado: 232.5, payment_id: v._initial_payment_id, metodo: 'tarjeta' });
    expect(c2).toMatchObject({ fecha_cobro: '2026-09-03', cobrado: 232.5, payment_id: r.payment.id });
  });

  it('al crear el plan, el pago inicial ya hecho salda su cuota si el plan lo incluye', async () => {
    const v = await venta(300, 150, '2026-08-31');
    await installmentsModel.generateInstallments(v.id, null, null, null, [
      { importe_previsto: 150, fecha_vencimiento: '2026-08-31' },
      { importe_previsto: 150, fecha_vencimiento: '2026-09-30' },
    ]);
    const [c1, c2] = await cuotas(v.id);
    expect(c1).toMatchObject({ fecha_cobro: '2026-08-31', cobrado: 150, payment_id: v._initial_payment_id });
    expect(c2.fecha_cobro).toBeNull();
  });

  it('con el plan de «lo que queda», el pago inicial no salda ninguna cuota', async () => {
    const v = await venta(1500, 500, '2026-09-01');
    await installmentsModel.generateInstallments(v.id, null, null, null, [
      { importe_previsto: 500, fecha_vencimiento: '2026-10-01' },
      { importe_previsto: 500, fecha_vencimiento: '2026-11-01' },
    ]);
    expect((await cuotas(v.id)).every((c) => c.fecha_cobro === null)).toBe(true);
    const r = await conversionModel.addPayment(v.id, { importe: 500, fecha: '2026-10-02' });
    const [c1, c2] = await cuotas(v.id);
    expect(c1).toMatchObject({ fecha_cobro: '2026-10-02', payment_id: r.payment.id });
    expect(c2.fecha_cobro).toBeNull();
  });

  it('unos céntimos menos (redondeo, divisa) también saldan la cuota, con lo que entró', async () => {
    const v = await venta(569.16, 0);
    await planCrudo(v.id, [284.58, 284.58]);
    await conversionModel.addPayment(v.id, { importe: 284.5, fecha: '2026-08-01', metodo: 'tarjeta' }, { allowOverpay: true });
    const [c1] = await cuotas(v.id);
    expect(c1).toMatchObject({ fecha_cobro: '2026-08-01', cobrado: 284.5, metodo: 'tarjeta' });
  });

  it('un pago que no llega salda la cuota en parte y el resto queda pendiente', async () => {
    const v = await venta(400, 0);
    await planCrudo(v.id, [200, 200]);
    const r = await conversionModel.addPayment(v.id, { importe: 120, fecha: '2026-08-05' });
    const lista = await cuotas(v.id);
    expect(lista.map((c) => [c.numero, c.previsto, c.fecha_cobro, c.payment_id])).toEqual([
      [1, 120, '2026-08-05', r.payment.id],
      [2, 80, null, null],
      [3, 200, null, null],
    ]);
    // La suma del plan no cambia: no se inventa ni se pierde nada.
    expect(lista.reduce((s, c) => s + c.previsto, 0)).toBe(400);
  });

  it('el pago inicial del formulario de Ventas salda la cuota 1', async () => {
    const [l] = await q(
      `INSERT INTO leads (project_id, nombre, email, status, created_at, fecha_solicitud)
       VALUES ($1, $2, $3, 'en_seguimiento', '2026-07-01', '2026-07-01') RETURNING id`,
      [proyecto.id, `${MARCA} ventas`, `${MARCA.toLowerCase()}-v@prueba.test`]);
    const r = await salesService.createSale({
      project_id: proyecto.id, lead_id: l.id, importe_total: 335, importe_pagado: 167.5, metodo_pago: 'fraccionado',
      fecha_pago: '2026-07-03',
      installments: [
        { importe_previsto: 167.5, fecha_vencimiento: '2026-07-03' },
        { importe_previsto: 167.5, fecha_vencimiento: '2026-07-20' },
      ],
    }, { userId: null, role: 'superadmin' });
    const [c1, c2] = await cuotas(r.conversion_id);
    expect(c1.fecha_cobro).toBe('2026-07-03');
    expect(c1.payment_id).not.toBeNull();
    expect(c2.fecha_cobro).toBeNull();
  });

  it('rehacer el plan con una cuota ya cobrada numera las nuevas detrás (antes chocaba con la 1)', async () => {
    const v = await venta(600, 0);
    await planCrudo(v.id, [200, 200, 200]);
    await conversionModel.addPayment(v.id, { importe: 200, fecha: '2026-08-01' });
    await installmentsModel.generateInstallments(v.id, null, null, null, [
      { importe_previsto: 400, fecha_vencimiento: '2026-09-01' },
    ]);
    expect((await cuotas(v.id)).map((c) => [c.numero, c.previsto, c.fecha_cobro !== null])).toEqual([
      [1, 200, true], [2, 400, false],
    ]);
  });

  it('un cobro que salda dos cuotas sale una vez en el detalle, con las dos', async () => {
    const v = await venta(300, 0);
    await planCrudo(v.id, [150, 150]);
    const r = await conversionModel.addPayment(v.id, { importe: 300, fecha: '2026-08-01' });
    const det = await conversionModel.findById(v.id);
    const filas = det.payments.filter((p) => p.id === r.payment.id);
    expect(filas).toHaveLength(1);
    expect(String(filas[0].cuota_numero)).toBe('1, 2');
  });
});

describe('#888 · aviso antes de apuntar una cuota ya pagada', () => {
  it('la cuota que salda un cobro suelto no se apunta otra vez: se dice cuál la paga', async () => {
    // La otra venta del 18/11: el pago inicial suelto, la cuota 1 con el cobro
    // de septiembre y la 2 «pendiente». La gestora la apuntó y salió otra factura.
    const v = await venta(395.26, 197.63, '2026-07-17');
    await planCrudo(v.id, [197.63, 197.63]);
    const [sep] = await q(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, 197.63, '2026-09-14', 'tarjeta') RETURNING id`, [v.id]);
    await q(`UPDATE conversion_installments SET fecha_cobro = '2026-09-14', importe_cobrado = 197.63, payment_id = $2
              WHERE conversion_id = $1 AND numero = 1`, [v.id, sep.id]);
    const [, c2] = await q('SELECT id FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [v.id]);

    const r = await installmentsModel.markPaid(c2.id, { fecha_cobro: '2026-11-18', importe_cobrado: 197.63, metodo: 'tarjeta' });
    expect(r.ya_pagada).toBe(true);
    expect(r.cobro).toMatchObject({ id: v._initial_payment_id });
    expect(await cobros(v.id)).toHaveLength(2); // no se ha apuntado otro
  });

  it('con un cargo de Stripe sin enlazar de ese cliente por ese importe, pregunta; confirmado, apunta', async () => {
    const v = await venta(400, 0);
    await planCrudo(v.id, [200, 200]);
    await cargo(200, '2026-09-10', { leadId: lead.id });
    const [c1] = await q('SELECT id FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [v.id]);

    const r = await installmentsModel.markPaid(c1.id, { fecha_cobro: '2026-09-10', importe_cobrado: 200 });
    expect(r.aviso).toBe('CARGO_STRIPE_SUELTO');
    expect(await cobros(v.id)).toHaveLength(0);

    const ok = await installmentsModel.markPaid(c1.id, { fecha_cobro: '2026-09-10', importe_cobrado: 200 }, { confirmar: true });
    expect(ok.aviso).toBeUndefined();
    expect(ok.fecha_cobro).not.toBeNull();
  });

  it('si con esta cuota la venta se cobraría de más, pregunta antes', async () => {
    // 300 de total: 100 de matrícula fuera del plan y dos cuotas de 100. La
    // cuota 1 se apuntó por 150. Apuntar la 2 por 100 dejaría 350 cobrados.
    const v = await venta(300, 100, '2026-08-01');
    await planCrudo(v.id, [100, 100], '2026-09-01');
    const [p150] = await q(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 150, '2026-09-01') RETURNING id`, [v.id]);
    await q(`UPDATE conversion_installments SET fecha_cobro = '2026-09-01', importe_cobrado = 150, payment_id = $2
              WHERE conversion_id = $1 AND numero = 1`, [v.id, p150.id]);
    const [, c2] = await q('SELECT id FROM conversion_installments WHERE conversion_id = $1 ORDER BY numero', [v.id]);
    const r = await installmentsModel.markPaid(c2.id, { fecha_cobro: '2026-11-01', importe_cobrado: 100 });
    expect(r.aviso).toBe('PAGO_DE_MAS');
    expect(await cobros(v.id)).toHaveLength(2);
  });

  it('apuntar a mano un cobro que ya entró por Stripe (sin enlazar) avisa como un duplicado', async () => {
    const v = await venta(500, 0);
    await cargo(250, '2026-10-01', { email: `${MARCA.toLowerCase()}@prueba.test` });
    await expect(conversionService.addPayment(v.id, { importe: 250, fecha: '2026-11-18' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_PAYMENT' });
    const r = await conversionService.addPayment(v.id, { importe: 250, fecha: '2026-11-18', permitir_duplicado: true });
    expect(r.payment.id).toBeTruthy();
  });
});

describe('#888 · enlazar un cargo de Stripe con el cobro o la factura de ese pago', () => {
  it('con un cobro de otro importe y otra fecha: lo enlaza ahí y no crea otro', async () => {
    const v = await venta(395.26, 197.5, '2026-07-17');
    const sp = await cargo(197.63, '2026-07-26', { leadId: lead.id });
    const r = await stripeService.enlazarConCobro(sp.id, { conversionPaymentId: v._initial_payment_id });
    expect(r.conversionPaymentId).toBe(v._initial_payment_id);
    const lista = await cobros(v.id);
    expect(lista).toHaveLength(1);
    expect(lista[0].importe).toBe(197.5); // manda el cobro (y su factura)
    expect(lista[0].notas).toContain(sp.stripe_id);
    const [fila] = await q('SELECT conversion_payment_id, conversion_id, link_method FROM stripe_payments WHERE id = $1', [sp.id]);
    expect(fila).toMatchObject({ conversion_payment_id: v._initial_payment_id, conversion_id: v.id, link_method: 'manual_cobro' });
  });

  it('por la factura: el cargo va al cobro de esa factura', async () => {
    const v = await venta(100, 100, '2026-08-01');
    const [f] = await q(
      `INSERT INTO invoices (project_id, conversion_id, payment_id, ano, numero, codigo, cliente_nombre, cliente_nif,
                            cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, total, fecha_emision)
       VALUES ($1, $2, $3, 2026, 9888, $4, $5, 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, 100, 100, '2026-11-18')
       RETURNING id`,
      [proyecto.id, v.id, v._initial_payment_id, `${MARCA}-F1`, MARCA]);
    const sp = await cargo(100, '2026-08-01', { leadId: lead.id });
    await stripeService.enlazarConCobro(sp.id, { invoiceId: f.id });
    const [fila] = await q('SELECT conversion_payment_id FROM stripe_payments WHERE id = $1', [sp.id]);
    expect(fila.conversion_payment_id).toBe(v._initial_payment_id);
    expect(await cobros(v.id)).toHaveLength(1);
  });

  it('un cobro que ya tiene su cargo no recibe otro', async () => {
    const v = await venta(100, 100, '2026-08-01');
    const a = await cargo(100, '2026-08-01', { leadId: lead.id });
    const b = await cargo(100, '2026-08-02', { leadId: lead.id });
    await stripeService.enlazarConCobro(a.id, { conversionPaymentId: v._initial_payment_id });
    await expect(stripeService.enlazarConCobro(b.id, { conversionPaymentId: v._initial_payment_id }))
      .rejects.toMatchObject({ code: 'COBRO_YA_TIENE_CARGO' });
  });
});
