import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import supertest from 'supertest';

/**
 * El aviso de Stripe entra por la app COMPLETA (CRM#680), contra la base de verdad.
 *
 *   · Un aviso firmado se acepta y se guarda, con el express.json general montado. Antes
 *     ese express.json convertía el cuerpo en objeto antes de llegar a la ruta, la firma se
 *     comprobaba contra «[object Object]» y se rechazaban TODOS los avisos.
 *   · Con la firma mala, sin firma o con el cuerpo tocado, se sigue rechazando.
 *
 * Que el mismo cargo quede una sola vez en la venta: tests/stripeCobroUnaVez680.test.js.
 *
 *   npx vitest run tests/stripeWebhook680.test.js
 */

const { default: app } = await import('../src/app.js');
const { query } = await import('../src/shared/config/db.js');

const MARCA = `SW680${Date.now().toString(36)}`;
const SECRETO = `whsec_prueba_${MARCA}`;
const CORREO = `alumna.${MARCA.toLowerCase()}@prueba.test`;
const ids = { project: null, lead: null, conversion: null };

const firmar = (cuerpo, secreto = SECRETO, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;

const cargo = (id, euros = 120) => ({
  id, object: 'charge', amount: euros * 100, currency: 'eur', status: 'succeeded', paid: true,
  created: Math.floor(Date.now() / 1000), billing_details: { email: CORREO }, receipt_email: CORREO,
});
const evento = (obj) => ({ id: `evt_${obj.id}`, type: 'charge.succeeded', data: { object: obj } });
const enviar = (cuerpo, firma) => {
  const r = supertest(app).post(`/api/stripe-webhook/${ids.project}`).set('Content-Type', 'application/json');
  return (firma ? r.set('Stripe-Signature', firma) : r).send(cuerpo);
};

beforeAll(async () => {
  const { rows: [p] } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  ids.project = p.id;
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, config_public) VALUES ($1, 'stripe', true, $2)`,
    [p.id, JSON.stringify({ webhook_secret: SECRETO })]);
  const { rows: [l] } = await query(
    `INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`,
    [p.id, `${MARCA} Alumna`, CORREO]);
  ids.lead = l.id;
  const { rows: [c] } = await query(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, 'Máster', 900, 0, CURRENT_DATE) RETURNING id`, [l.id, p.id]);
  ids.conversion = c.id;
}, 60000);

afterAll(async () => {
  for (const [sql, v] of [
    ['DELETE FROM conversion_payments WHERE conversion_id = $1', ids.conversion],
    ['DELETE FROM stripe_payments WHERE project_id = $1', ids.project],
    ['DELETE FROM conversions WHERE id = $1', ids.conversion],
    ['DELETE FROM leads WHERE id = $1', ids.lead],
    ['DELETE FROM project_integrations WHERE project_id = $1', ids.project],
    ['DELETE FROM projects WHERE id = $1', ids.project],
  ]) {
    try { await query(sql, [v]); } catch { /* sigue limpiando */ }
  }
});

describe('CRM#680 · el aviso de Stripe entra por la app completa', () => {
  it('firmado: se acepta, se guarda el cargo y el cobro va a la venta', async () => {
    const id = `ch_${MARCA}_ok`;
    const cuerpo = JSON.stringify(evento(cargo(id)));
    const r = await enviar(cuerpo, firmar(cuerpo));
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ received: true, processed: 'charge.succeeded' });
    const { rows } = await query('SELECT amount, conversion_id FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2',
      [ids.project, id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(120);
    expect(rows[0].conversion_id).toBe(ids.conversion);
    const { rows: cobros } = await query('SELECT 1 FROM conversion_payments WHERE conversion_id = $1 AND notas LIKE $2',
      [ids.conversion, `%${id}%`]);
    expect(cobros).toHaveLength(1);
  });

  it('con la firma de otro secreto, o sin firma, se rechaza y no guarda nada', async () => {
    const id = `ch_${MARCA}_mala`;
    const cuerpo = JSON.stringify(evento(cargo(id)));
    expect((await enviar(cuerpo, firmar(cuerpo, 'whsec_otro'))).status).toBe(400);
    expect((await enviar(cuerpo)).status).toBe(400);
    const { rows } = await query('SELECT 1 FROM stripe_payments WHERE stripe_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('la firma es del cuerpo tal cual llega: firmado y luego tocado, no pasa', async () => {
    const original = JSON.stringify(evento(cargo(`ch_${MARCA}_tocado`)));
    const tocado = original.replace('"amount":12000', '"amount":1');
    expect(tocado).not.toBe(original);
    expect((await enviar(tocado, firmar(original))).status).toBe(400);
  });
});
