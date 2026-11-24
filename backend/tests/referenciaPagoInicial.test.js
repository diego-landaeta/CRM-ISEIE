import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Venta fraccionada cuya inicial YA se pagó con otro link de pago o por
 * transferencia (Diego, 24/11/2026): el primer cobro lleva su método real y su
 * referencia (el nº de operación, o el link/cobro de Stripe), para encontrarlo
 * luego en el banco o en Stripe.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/referenciaPagoInicial.test.js
 */
const { create } = await import('../src/modules/conversions/conversion.model.js');
const { createConversionSchema } = await import('../src/modules/conversions/conversion.validation.js');
const { default: pool } = await import('../src/shared/config/db.js');

const MARCA = `RPI_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto;
let lead;

beforeAll(async () => {
  [proyecto] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`, [MARCA, MARCA.toLowerCase(), MARCA]);
  [lead] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [MARCA, proyecto.id]);
});

afterAll(async () => {
  if (proyecto) {
    await q('DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', [proyecto.id]);
    await q('DELETE FROM conversions WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

const venta = (extra) => ({
  lead_id: lead.id, project_id: proyecto.id, producto_contratado: 'Máster X',
  importe_total: 900, importe_pagado: 300, metodo_pago: 'fraccionado', ...extra,
});

describe('la referencia del pago inicial', () => {
  it('se acepta, y con más de 120 caracteres no', () => {
    expect(createConversionSchema.safeParse(venta({ referencia_pago_inicial: 'TRF-9' })).success).toBe(true);
    expect(createConversionSchema.safeParse(venta({ referencia_pago_inicial: 'x'.repeat(121) })).success).toBe(false);
  });

  it('va al primer cobro, con su método real (transferencia)', async () => {
    const c = await create(venta({ metodo_pago_inicial: 'transferencia', referencia_pago_inicial: 'TRF-9' }));
    const [p] = await q('SELECT importe, metodo, referencia FROM conversion_payments WHERE conversion_id = $1', [c.id]);
    expect(Number(p.importe)).toBe(300);
    expect(p.metodo).toBe('transferencia');
    expect(p.referencia).toBe('TRF-9');
  });

  it('pagada con otro link: método Stripe y el link como referencia', async () => {
    const c = await create(venta({ metodo_pago_inicial: 'tarjeta_stripe', referencia_pago_inicial: 'https://buy.stripe.com/abc' }));
    const [p] = await q('SELECT metodo, referencia FROM conversion_payments WHERE conversion_id = $1', [c.id]);
    expect(p.metodo).toBe('tarjeta_stripe');
    expect(p.referencia).toBe('https://buy.stripe.com/abc');
  });

  it('sin referencia, como siempre: el cobro sin ella', async () => {
    const c = await create(venta({ metodo_pago_inicial: 'tarjeta' }));
    const [p] = await q('SELECT referencia FROM conversion_payments WHERE conversion_id = $1', [c.id]);
    expect(p.referencia).toBeNull();
  });
});
