import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * El mismo cargo de Stripe queda UNA vez en la venta (CRM#680, CRM#635), contra la base de verdad.
 *
 * Llega por varios caminos: el aviso de Stripe, el sondeo de cada 5 minutos y el botón
 * «Sincronizar». Si llegaban a la vez, todos veían la venta aún sin el cobro, todos pasaban
 * la comprobación de duplicados antes de que otro escribiera y todos lo sumaban. El 06/11, en
 * local y sin el arreglo, diez avisos a la vez dejaron el MISMO cobro diez veces en la venta.
 *
 * Va en su propio archivo, sin cargar la app entera: con ella los tiempos cambian y la
 * carrera deja de reproducirse sin el arreglo (la prueba no defendería nada).
 *
 *   npx vitest run tests/stripeCobroUnaVez680.test.js
 */

const { query } = await import('../src/shared/config/db.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');

const MARCA = `SU680${Date.now().toString(36)}`;
const CORREO = `alumna.${MARCA.toLowerCase()}@prueba.test`;
const ids = { project: null, lead: null, conversion: null };

const evento = (id, euros) => ({
  type: 'charge.succeeded',
  data: { object: { id, amount: euros * 100, currency: 'eur', status: 'succeeded',
    created: Math.floor(Date.now() / 1000), billing_details: { email: CORREO } } },
});
const cobros = (id) => query('SELECT id FROM conversion_payments WHERE conversion_id = $1 AND notas LIKE $2',
  [ids.conversion, `%${id}%`]).then((r) => r.rows);

beforeAll(async () => {
  ids.project = (await query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`])).rows[0].id;
  ids.lead = (await query(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`,
    [ids.project, `${MARCA} Alumna`, CORREO])).rows[0].id;
  ids.conversion = (await query(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, 'Máster', 5000, 0, CURRENT_DATE) RETURNING id`, [ids.lead, ids.project])).rows[0].id;
}, 60000);

afterAll(async () => {
  for (const [sql, v] of [
    ['DELETE FROM conversion_payments WHERE conversion_id = $1', ids.conversion],
    ['DELETE FROM stripe_payments WHERE project_id = $1', ids.project],
    ['DELETE FROM conversions WHERE id = $1', ids.conversion],
    ['DELETE FROM leads WHERE id = $1', ids.lead],
    ['DELETE FROM projects WHERE id = $1', ids.project],
  ]) {
    try { await query(sql, [v]); } catch { /* sigue limpiando */ }
  }
});

describe('CRM#680 / CRM#635 · el mismo cargo por varios caminos a la vez', () => {
  it('diez a la vez dejan UN cobro en la venta, y el cargo apunta a ese cobro', async () => {
    const id = `ch_${MARCA}_a`;
    await Promise.all(Array.from({ length: 10 }, () => servicio.handleWebhookEvent(ids.project, evento(id, 100))));
    const lista = await cobros(id);
    expect(lista).toHaveLength(1);
    const { rows: [sp] } = await query(
      'SELECT conversion_id, conversion_payment_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [ids.project, id]);
    expect(sp.conversion_id).toBe(ids.conversion);
    expect(sp.conversion_payment_id).toBe(lista[0].id);
  });

  it('otro cargo distinto también entra una sola vez, aunque llegue en ráfaga', async () => {
    const id = `ch_${MARCA}_b`;
    await Promise.all(Array.from({ length: 10 }, () => servicio.handleWebhookEvent(ids.project, evento(id, 250))));
    expect(await cobros(id)).toHaveLength(1);
  });

  it('y si vuelve a llegar más tarde (el sondeo, un reintento de Stripe), no suma otra vez', async () => {
    const id = `ch_${MARCA}_a`;
    await servicio.handleWebhookEvent(ids.project, evento(id, 100));
    expect(await cobros(id)).toHaveLength(1);
  });

  // Revisión de Diego (10/11): con el bloqueo de sesión, cada enlace retenía una conexión
  // mientras pedía otras al mismo pool (max 20). Con 30 cargos DISTINTOS a la vez entraron
  // 16, 0 y 6 de 30. Tienen que entrar todos, y cada uno una sola vez.
  it('30 cargos distintos a la vez (más que el pool) entran todos, cada uno con su cobro', async () => {
    const lote = Array.from({ length: 30 }, (_, i) => `ch_${MARCA}_r${i}`);
    await Promise.all(lote.map((id, i) => servicio.handleWebhookEvent(ids.project, evento(id, 10 + 7 * i))));
    const { rows } = await query(
      `SELECT stripe_id, conversion_payment_id, link_method FROM stripe_payments
        WHERE project_id = $1 AND stripe_id = ANY($2)`, [ids.project, lote]);
    expect(rows).toHaveLength(30);
    expect(rows.filter((r) => r.conversion_payment_id == null)).toEqual([]);
    expect(new Set(rows.map((r) => r.link_method))).toEqual(new Set(['auto_email']));
    const { rows: [{ n }] } = await query(
      `SELECT COUNT(*)::int AS n FROM conversion_payments WHERE conversion_id = $1 AND notas LIKE $2`,
      [ids.conversion, `%ch_${MARCA}_r%`]);
    expect(n).toBe(30);
  }, 60000);

  it('si no se puede enlazar (correo sin prospecto), la reserva se suelta y la fila queda como estaba', async () => {
    const id = `ch_${MARCA}_sinlead`;
    const ev = evento(id, 40);
    ev.data.object.billing_details.email = `nadie.${MARCA.toLowerCase()}@prueba.test`;
    await servicio.handleWebhookEvent(ids.project, ev);
    const { rows: [sp] } = await query(
      'SELECT link_method, linked_at, conversion_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2', [ids.project, id]);
    expect(sp).toMatchObject({ link_method: null, linked_at: null, conversion_id: null });
  });

  it('una reserva que se quedó colgada (el proceso murió) se retoma pasados 2 minutos', async () => {
    const id = `ch_${MARCA}_colgada`;
    await query(
      `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email,
                                    stripe_created_at, link_method, linked_at)
       VALUES ($1, $2, 'charge', 'succeeded', 70, 'EUR', $3, NOW(), 'auto_enlazando', NOW() - interval '5 minutes')`,
      [ids.project, id, CORREO]);
    await servicio.handleWebhookEvent(ids.project, evento(id, 70));
    expect(await cobros(id)).toHaveLength(1);
  });
});
