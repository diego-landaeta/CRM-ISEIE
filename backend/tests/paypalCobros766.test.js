import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * #766 · Cobros de PayPal registrados solos, contra la base de verdad y con
 * PayPal SIMULADO (sin red): se sustituye `fetch`.
 *
 *   · el sondeo trae un cobro nuevo y lo registra en su venta, con su origen;
 *   · volver a traerlo, o que llegue a la vez por el aviso, no lo duplica;
 *   · si ya estaba apuntado a mano, se engancha a ese y no suma otro;
 *   · después, apuntarlo a mano otra vez está prohibido;
 *   · el aviso con firma mala no entra;
 *   · con el interruptor apagado no se llama a PayPal ni entra nada.
 *
 *   npx vitest run tests/paypalCobros766.test.js
 */

// Con la base local compartida, algunas vueltas tardan: margen de sobra.
vi.setConfig({ testTimeout: 60000 });

const { query } = await import('../src/shared/config/db.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const servicio = await import('../src/modules/cobros-externos/paypal.service.js');
const cliente = await import('../src/modules/cobros-externos/paypal.client.js');
const conversiones = await import('../src/modules/conversions/conversion.service.js');
const { default: modulo } = await import('../src/modules/cobros-externos/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const MARCA = `PP766${Date.now().toString(36)}`;
const CORREO = `alumna.${MARCA.toLowerCase()}@prueba.test`;
const ids = { project: null, lead: null, venta: null, ventaRef: null, leadRef: null };
const ENCENDIDO = { PAYPAL_COBROS_ACTIVO: '1' };

// ─── PayPal de mentira ─────────────────────────────────────────────────────
const paypal = { transacciones: [], firmaOk: true, llamadas: [] };
const respuesta = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});
function fetchFalso(url, opts = {}) {
  const u = new URL(url);
  paypal.llamadas.push(`${opts.method || 'GET'} ${u.pathname}`);
  if (u.hostname !== 'api-m.sandbox.paypal.com') throw new Error(`fuera del sandbox: ${u.hostname}`);
  if (u.pathname === '/v1/oauth2/token') return respuesta({ access_token: 'tok-prueba', expires_in: 32400 });
  if (u.pathname === '/v1/reporting/transactions') {
    // Como el de verdad: solo lo de entre esas dos fechas.
    const fecha = (k) => new Date(u.searchParams.get(k).replace(/-0000$/, 'Z')).getTime();
    const [ini, fin] = [fecha('start_date'), fecha('end_date')];
    const dentro = paypal.transacciones.filter((t) => {
      const f = new Date(t.transaction_info.transaction_initiation_date).getTime();
      return f >= ini && f <= fin;
    });
    return respuesta({ transaction_details: dentro, total_pages: 1, page: 1 });
  }
  if (u.pathname === '/v1/notifications/verify-webhook-signature') {
    return respuesta({ verification_status: paypal.firmaOk ? 'SUCCESS' : 'FAILURE' });
  }
  if (u.pathname.startsWith('/v2/checkout/orders/')) {
    return respuesta({ payer: { email_address: CORREO, name: { given_name: 'Alumna', surname: MARCA }, payer_id: 'PAYERPRUEBA' } });
  }
  return respuesta({ error: 'no' }, 404);
}

const hoy = new Date();
const dia = (n) => new Date(hoy.getTime() - n * 86400000);
const tx = (id, euros, { correo = CORREO, codigo = 'T0006', estado = 'S', moneda = 'EUR', fecha = dia(1), custom = null } = {}) => ({
  transaction_info: {
    transaction_id: id, transaction_event_code: codigo, transaction_status: estado,
    transaction_initiation_date: fecha.toISOString(),
    transaction_amount: { currency_code: moneda, value: String(euros) },
    fee_amount: { currency_code: moneda, value: String(-(euros * 0.034).toFixed(2)) },
    custom_field: custom,
  },
  payer_info: { email_address: correo, payer_name: { alternate_full_name: `Alumna ${MARCA}` } },
});
const cobrosDe = (venta) => query(
  'SELECT id, importe, fecha, origen, origen_ref FROM conversion_payments WHERE conversion_id = $1 ORDER BY id', [venta])
  .then((r) => r.rows);
const fila = (id) => query('SELECT * FROM paypal_payments WHERE project_id = $1 AND paypal_id = $2', [ids.project, id])
  .then((r) => r.rows[0]);

const cabeceras = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-prueba',
  'paypal-transmission-id': 'trans-1',
  'paypal-transmission-sig': 'firma',
  'paypal-transmission-time': new Date().toISOString(),
};
const aviso = (captura, euros) => JSON.stringify({
  id: `WH-${captura}`, event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: captura, status: 'COMPLETED', amount: { currency_code: 'EUR', value: String(euros) },
    create_time: dia(0).toISOString(),
    supplementary_data: { related_ids: { order_id: `ORDER${captura}` } },
  },
});

beforeAll(async () => {
  ids.project = (await query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`])).rows[0].id;
  const s = encrypt('secreto-de-prueba-paypal');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'paypal', true, $2, $3, $4, $5)`,
    [ids.project, s.encrypted, s.iv, s.authTag,
     JSON.stringify({ client_id: 'ClientePruebaPaypal', modo: 'sandbox', webhook_id: 'WH-PRUEBA-1' })]);
  ids.lead = (await query(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`,
    [ids.project, `Alumna ${MARCA}`, CORREO])).rows[0].id;
  ids.venta = (await query(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, 'Máster', 3000, 0, CURRENT_DATE - 30) RETURNING id`, [ids.lead, ids.project])).rows[0].id;
  ids.leadRef = (await query(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`,
    [ids.project, `Otra ${MARCA}`, `otra.${MARCA.toLowerCase()}@prueba.test`])).rows[0].id;
  ids.ventaRef = (await query(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, 'Curso', 500, 0, CURRENT_DATE - 30) RETURNING id`, [ids.leadRef, ids.project])).rows[0].id;
  // Que la primera vuelta mire desde hace 40 días, no desde el alta del campus.
  await query(`INSERT INTO paypal_sync_state (project_id, last_synced_until) VALUES ($1, NOW() - interval '40 days')`, [ids.project]);
}, 60000);

beforeEach(() => {
  paypal.llamadas = [];
  paypal.firmaOk = true;
  cliente._olvidarTokens();
  vi.stubGlobal('fetch', vi.fn(fetchFalso));
  process.env.PAYPAL_COBROS_ACTIVO = '1';
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.PAYPAL_COBROS_ACTIVO;
  for (const [sql, v] of [
    ['DELETE FROM paypal_payments WHERE project_id = $1', ids.project],
    ['DELETE FROM paypal_sync_state WHERE project_id = $1', ids.project],
    ['DELETE FROM conversion_installments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', ids.project],
    ['DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', ids.project],
    ['DELETE FROM conversions WHERE project_id = $1', ids.project],
    ['DELETE FROM leads WHERE project_id = $1', ids.project],
    ['DELETE FROM project_integrations WHERE project_id = $1', ids.project],
    ['DELETE FROM projects WHERE id = $1', ids.project],
  ]) {
    try { await query(sql, [v]); } catch { /* sigue limpiando */ }
  }
});

describe('#766 · PayPal: el sondeo registra el cobro en su venta, una vez', () => {
  it('un cobro nuevo entra en la venta del cliente, marcado con su origen, y lo cobrado se recalcula', async () => {
    paypal.transacciones = [tx(`${MARCA}A`, 250)];
    const r = await servicio.sincronizar(ids.project);
    expect(r.importados).toBe(1);
    const lista = await cobrosDe(ids.venta);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ origen: 'paypal', origen_ref: `${MARCA}A` });
    expect(Number(lista[0].importe)).toBe(250);
    const p = await fila(`${MARCA}A`);
    expect(p).toMatchObject({ conversion_id: ids.venta, conversion_payment_id: lista[0].id, link_method: 'auto_email', status: 'completed' });
    const { rows: [v] } = await query('SELECT importe_pagado FROM conversions WHERE id = $1', [ids.venta]);
    expect(Number(v.importe_pagado)).toBe(250);
    // Solo lectura en PayPal: el token y el informe, nada más.
    expect(paypal.llamadas.every((l) => /^POST \/v1\/oauth2\/token$|^GET \/v1\/reporting\/transactions$/.test(l))).toBe(true);
  });

  it('volver a sincronizar el mismo cobro no lo suma otra vez', async () => {
    await servicio.sincronizar(ids.project);
    await servicio.sincronizar(ids.project, { reintentar: true });
    expect(await cobrosDe(ids.venta)).toHaveLength(1);
  });

  it('si la gestora ya lo había apuntado a mano, se engancha a ese cobro y no suma otro', async () => {
    const fecha = dia(3).toISOString().slice(0, 10);
    await conversiones.addPayment(ids.venta, { importe: 120, fecha, metodo: 'paypal' });
    const antes = await cobrosDe(ids.venta);
    paypal.transacciones = [tx(`${MARCA}B`, 120.4, { fecha: dia(2) })];
    await servicio.sincronizar(ids.project);
    const despues = await cobrosDe(ids.venta);
    expect(despues).toHaveLength(antes.length);
    const manual = despues.find((c) => Number(c.importe) === 120);
    expect(manual).toMatchObject({ origen: 'paypal', origen_ref: `${MARCA}B` });
    expect(await fila(`${MARCA}B`)).toMatchObject({ conversion_payment_id: manual.id, link_method: 'auto_dedup' });
  });

  it('apuntar a mano un cobro que ya entró por PayPal se rechaza, aunque se marque «duplicado permitido»', async () => {
    const [auto] = (await cobrosDe(ids.venta)).filter((c) => c.origen_ref === `${MARCA}A`);
    const fecha = new Date(auto.fecha).toISOString().slice(0, 10);
    await expect(conversiones.addPayment(ids.venta, { importe: 250, fecha, metodo: 'paypal', permitir_duplicado: true }))
      .rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_AUTOMATIC_PAYMENT' });
  });

  it('por la referencia «venta-N» se enlaza a esa venta aunque el correo no sea de nadie', async () => {
    paypal.transacciones = [tx(`${MARCA}C`, 99, { correo: `nadie.${MARCA.toLowerCase()}@prueba.test`, custom: `venta-${ids.ventaRef}` })];
    await servicio.sincronizar(ids.project);
    expect(await cobrosDe(ids.ventaRef)).toHaveLength(1);
    expect(await fila(`${MARCA}C`)).toMatchObject({ conversion_id: ids.ventaRef, link_method: 'auto_ref' });
  });

  it('un cobro de nadie, uno pendiente y uno en dólares se guardan pero no se registran', async () => {
    paypal.transacciones = [
      tx(`${MARCA}D`, 40, { correo: `nadie.${MARCA.toLowerCase()}@prueba.test` }),
      tx(`${MARCA}E`, 60, { estado: 'P' }),
      tx(`${MARCA}F`, 70, { moneda: 'USD' }),
      // Una transferencia de PayPal al banco no es un cobro: ni se guarda.
      tx(`${MARCA}G`, -500, { codigo: 'T0400' }),
    ];
    const antes = (await cobrosDe(ids.venta)).length;
    await servicio.sincronizar(ids.project);
    expect((await cobrosDe(ids.venta)).length).toBe(antes);
    expect(await fila(`${MARCA}D`)).toMatchObject({ conversion_payment_id: null, link_method: null });
    expect(await fila(`${MARCA}E`)).toMatchObject({ status: 'pending', conversion_payment_id: null });
    expect(await fila(`${MARCA}F`)).toMatchObject({ currency: 'USD', conversion_payment_id: null });
    expect(await fila(`${MARCA}G`)).toBeUndefined();
  });
});

describe('#766 · PayPal: el aviso firmado', () => {
  it('diez avisos a la vez del mismo cobro dejan UN cobro, y luego el sondeo tampoco lo repite', async () => {
    const id = `${MARCA}W`;
    const antes = (await cobrosDe(ids.venta)).length;
    const rs = await Promise.all(Array.from({ length: 10 }, () =>
      servicio.procesarWebhook(ids.project, { cabeceras, cuerpo: aviso(id, 310) }, { env: ENCENDIDO })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    paypal.transacciones = [tx(id, 310, { fecha: dia(0) })];
    await servicio.sincronizar(ids.project);
    const lista = (await cobrosDe(ids.venta)).filter((c) => c.origen_ref === id);
    expect(lista).toHaveLength(1);
    expect((await cobrosDe(ids.venta)).length).toBe(antes + 1);
    expect(await fila(id)).toMatchObject({ customer_email: CORREO, conversion_payment_id: lista[0].id });
  });

  it('con la firma mala no entra nada (400)', async () => {
    paypal.firmaOk = false;
    const r = await servicio.procesarWebhook(ids.project, { cabeceras, cuerpo: aviso(`${MARCA}X`, 10) }, { env: ENCENDIDO });
    expect(r.status).toBe(400);
    expect(await fila(`${MARCA}X`)).toBeUndefined();
  });

  it('un certificado que no es de PayPal se rechaza sin preguntar', async () => {
    const r = await servicio.procesarWebhook(ids.project,
      { cabeceras: { ...cabeceras, 'paypal-cert-url': 'https://ejemplo.test/cert' }, cuerpo: aviso(`${MARCA}Y`, 10) }, { env: ENCENDIDO });
    expect(r.status).toBe(400);
    expect(paypal.llamadas.some((l) => l.includes('verify-webhook-signature'))).toBe(false);
  });
});

describe('#766 · PayPal: con el interruptor apagado no pasa nada', () => {
  it('el sondeo no llama a PayPal ni guarda nada', async () => {
    paypal.transacciones = [tx(`${MARCA}Z`, 500)];
    const r = await servicio.sincronizar(ids.project, { env: {} });
    expect(r).toEqual({ apagado: true });
    expect(paypal.llamadas).toEqual([]);
    expect(await fila(`${MARCA}Z`)).toBeUndefined();
  });

  it('el aviso contesta 404 y no llama a PayPal', async () => {
    delete process.env.PAYPAL_COBROS_ACTIVO;
    const app = express();
    app.use(modulo.publicMount.prefix, modulo.publicMount.router);
    app.use(errorHandler);
    const r = await supertest(app).post(`/api/paypal-webhook/${ids.project}`)
      .set('Content-Type', 'application/json').set(cabeceras).send(aviso(`${MARCA}Z`, 500));
    expect(r.status).toBe(404);
    expect(paypal.llamadas).toEqual([]);
    expect(await fila(`${MARCA}Z`)).toBeUndefined();
  });

  it('sin credenciales, con el interruptor puesto, tampoco', async () => {
    const r = await servicio.sincronizar(999999999);
    expect(r).toEqual({ sinCredenciales: true });
    expect(paypal.llamadas).toEqual([]);
  });
});
