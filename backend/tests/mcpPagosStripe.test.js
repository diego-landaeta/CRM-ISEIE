import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { listarPagosStripe } from '../src/modules/mcp/mcp.model.js';
import { cobrosMensualesNetos, cobrosMensuales } from '../src/modules/reports/report.model.js';

/**
 * Puerta 3 del conector de Claude (gemela de CRM#806, ISEIE#487), contra la base de verdad (la local
 * de docker-compose.dev.yml): los cargos de Stripe uno a uno y los cobros del
 * mes netos de reembolsos.
 *
 * Crea un campus con sus cargos de la semana del 9 al 15/11 y otro campus con un
 * cargo que no debe salir. Todo lleva la marca P3TEST y se borra al final.
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/mcpPagosStripe.test.js
 */

const MARCA = 'P3TEST';
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const uno = async (sql, params) => (await q(sql, params))[0];
const ids = {};

async function limpiar() {
  await q(`DELETE FROM stripe_payments WHERE stripe_id LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM conversion_refunds WHERE motivo LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM conversion_installments WHERE notas LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions WHERE producto_contratado LIKE $1)`, [`${MARCA}%`]);
  await q(`DELETE FROM conversions WHERE producto_contratado LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM leads WHERE nombre LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM users WHERE email LIKE $1`, [`%@${MARCA.toLowerCase()}.test`]);
  await q(`DELETE FROM projects WHERE nombre LIKE $1`, [`${MARCA}%`]);
  await q(`DELETE FROM invoice_issuers WHERE razon_social LIKE $1`, [`${MARCA}%`]);
}

/** Un cargo de Stripe. `madrid` es la hora local de Madrid del cargo. */
async function cargo(clave, { proyecto = 'A', madrid, status = 'succeeded', amount, currency = 'EUR', refunded = false, refundedAmount = null, venta = null, pago = null, metadata = null }) {
  ids[clave] = (await uno(
    `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, refunded, refunded_amount,
                                  conversion_id, conversion_payment_id, metadata, customer_email, customer_name, stripe_created_at)
     VALUES ($1, $2, 'charge', $3, $4, $13, $5, $6, $7, $8, $9, $10, $11, ($12::timestamp AT TIME ZONE 'Europe/Madrid'))
     RETURNING id`,
    [ids[`P${proyecto}`], `${MARCA}-${clave}`, status, amount, refunded, refundedAmount,
      venta ? ids[venta] : null, pago ? ids[pago] : null, metadata,
      `${clave.toLowerCase()}@cliente.${MARCA.toLowerCase()}.test`, `${MARCA} Cliente ${clave}`, madrid, currency]
  )).id;
}

beforeAll(async () => {
  await limpiar();
  const sociedad = (await uno(
    `INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id`, [`${MARCA} Empresa`, `${MARCA}-NIF`])).id;
  for (const p of ['A', 'B']) {
    ids[`P${p}`] = (await uno(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} Campus ${p}`, `${MARCA.toLowerCase()}-${p.toLowerCase()}`, `${MARCA}-key-${p}`, sociedad])).id;
  }
  for (const g of ['Gema', 'Gus']) {
    ids[g] = (await uno(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
      [`${MARCA} ${g}`, `${g.toLowerCase()}@${MARCA.toLowerCase()}.test`])).id;
  }
  ids.L1 = (await uno(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id`,
    [ids.PA, `${MARCA} Ana García`, `ana@lead.${MARCA.toLowerCase()}.test`])).id;
  // V1: en dos cuotas, de Gema. V2: un solo pago, de Gus.
  ids.V1 = (await uno(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion)
     VALUES ($1, $2, $3, 275, 275, $4, '2026-11-09') RETURNING id`, [ids.L1, ids.PA, `${MARCA} Curso de Dramaterapia`, ids.Gema])).id;
  ids.V2 = (await uno(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion)
     VALUES ($1, $2, $3, 50, 50, $4, '2026-11-10') RETURNING id`, [ids.L1, ids.PA, `${MARCA} Taller corto`, ids.Gus])).id;
  ids.cp1 = (await uno(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, '2026-11-09') RETURNING id`, [ids.V1])).id;
  ids.cp2 = (await uno(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 175, '2026-11-11') RETURNING id`, [ids.V1])).id;
  ids.cp3 = (await uno(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 50, '2026-11-12') RETURNING id`, [ids.V2])).id;
  await q(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento, payment_id, notas)
           VALUES ($1, 1, 100, '2026-11-09', $2, $4), ($1, 2, 175, '2026-11-11', $3, $4)`, [ids.V1, ids.cp1, ids.cp2, `${MARCA} cuota`]);
  // El reembolso de 175 € del día 11 (el ejemplo de la tarea), apuntado en la venta.
  await q(`INSERT INTO conversion_refunds (conversion_id, importe, fecha, motivo, payment_id, origen) VALUES ($1, 175, '2026-11-11', $2, $3, 'stripe')`,
    [ids.V1, `${MARCA} reembolso`, ids.cp2]);

  await cargo('s1', { madrid: '2026-11-09 10:00', amount: 100, venta: 'V1', pago: 'cp1' });
  await cargo('s2', { madrid: '2026-11-11 12:00', amount: 175, refunded: true, refundedAmount: 175, venta: 'V1', pago: 'cp2' });
  await cargo('s3', { madrid: '2026-11-12 09:00', amount: 50, refundedAmount: 20, venta: 'V2', pago: 'cp3' });
  // En dólares: 100 USD liquidados en 92 €; se reembolsan 50 USD, que son 46 €.
  await cargo('s4', { madrid: '2026-11-13 18:00', amount: 92, refundedAmount: 50, metadata: { original_amount: 100, original_currency: 'USD' } });
  await cargo('s5', { madrid: '2026-11-14 11:00', status: 'failed', amount: 30 });
  await cargo('s6', { madrid: '2026-11-15 23:30', amount: 40 });              // sin asociar; aún es día 15 en Madrid
  await cargo('s7', { madrid: '2026-11-16 00:30', amount: 60 });              // ya es día 16 en Madrid (15 en UTC)
  await cargo('s8', { proyecto: 'B', madrid: '2026-11-12 10:00', amount: 999 }); // otro campus

  // Fuera de la semana: casos de monedas y topes (revisión de la PR, 16/11).
  // V3: cobrado en dólares (100 USD = 92 €) y reembolsado en parte por Stripe (50 USD = 46 €).
  ids.V3 = (await uno(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion)
     VALUES ($1, $2, $3, 92, 92, $4, '2026-11-05') RETURNING id`, [ids.L1, ids.PA, `${MARCA} Curso en dólares`, ids.Gus])).id;
  ids.cp4 = (await uno(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 92, '2026-11-05') RETURNING id`, [ids.V3])).id;
  await cargo('s9', { madrid: '2026-11-05 10:00', amount: 92, refundedAmount: 50, venta: 'V3', pago: 'cp4', metadata: { original_amount: 100, original_currency: 'USD' } });
  await q(`INSERT INTO conversion_refunds (conversion_id, importe, fecha, motivo, payment_id, origen) VALUES ($1, 50, '2026-11-06', $2, $3, 'stripe')`,
    [ids.V3, `${MARCA} reembolso USD`, ids.cp4]);
  // Cargo antiguo guardado sin convertir (antes del 21/07): 500.000 COP.
  await cargo('s10', { madrid: '2026-11-20 10:00', amount: 500000, currency: 'COP' });
  // Reembolso total sin importe apuntado, y un importe reembolsado mayor que el cargo.
  await cargo('s11', { madrid: '2026-11-21 10:00', amount: 80, refunded: true });
  await cargo('s12', { madrid: '2026-11-21 11:00', amount: 60, refundedAmount: 75 });
});

afterAll(async () => {
  await limpiar();
  await pool.end();
});

const SEMANA = { desde: '2026-11-09', hasta: '2026-11-15' };
const porStripe = (r) => Object.fromEntries(r.pagos.map((p) => [p.stripe_id.replace(`${MARCA}-`, ''), p]));

describe('listar_pagos_stripe: los cargos uno a uno', () => {
  it('la semana del 9 al 15 en días de Madrid, solo del campus pedido', async () => {
    const r = await listarPagosStripe({ projectIds: [ids.PA], ...SEMANA, pagina: 1, limite: 25 });
    expect(Object.keys(porStripe(r)).sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(r.total).toBe(6);
  });

  it('estado, lo reembolsado (en euros) y el neto de cada cargo', async () => {
    const p = porStripe(await listarPagosStripe({ projectIds: [ids.PA], ...SEMANA, pagina: 1, limite: 25 }));
    expect(p.s1).toMatchObject({ estado: 'cobrado' });
    expect(Number(p.s1.neto)).toBe(100);
    expect(p.s2.estado).toBe('reembolsado');
    expect(Number(p.s2.importe_reembolsado)).toBe(175);
    expect(Number(p.s2.neto)).toBe(0);
    expect(p.s3.estado).toBe('reembolsado_en_parte');
    expect(Number(p.s3.neto)).toBe(30);
    // El reembolso en dólares se pasa a euros con la proporción del cargo.
    expect(p.s4.estado).toBe('reembolsado_en_parte');
    expect(Number(p.s4.importe_reembolsado)).toBe(46);
    expect(p.s4.moneda_original).toBe('USD');
    expect(p.s5.estado).toBe('fallido');
    expect(Number(p.s5.neto)).toBe(0);
  });

  it('venta, formación y si es primer pago o cuota', async () => {
    const p = porStripe(await listarPagosStripe({ projectIds: [ids.PA], ...SEMANA, pagina: 1, limite: 25 }));
    expect(p.s1).toMatchObject({ venta_id: ids.V1, formacion: `${MARCA} Curso de Dramaterapia`, tipo_de_pago: 'cuota 1 de 2' });
    expect(p.s2.tipo_de_pago).toBe('cuota 2 de 2');
    expect(p.s3).toMatchObject({ venta_id: ids.V2, tipo_de_pago: 'primer pago' });
    expect(p.s6).toMatchObject({ venta_id: null, formacion: null, tipo_de_pago: null });
    // Sin prospecto apuntado en el cargo, el cliente es el de su venta; suelto, el de Stripe.
    expect(p.s1.cliente).toBe(`${MARCA} Ana García`);
    expect(p.s6.cliente).toBe(`${MARCA} Cliente s6`);
  });

  it('las cifras son del periodo entero, no de la página', async () => {
    const r = await listarPagosStripe({ projectIds: [ids.PA], ...SEMANA, pagina: 1, limite: 2 });
    expect(r.pagos).toHaveLength(2);
    expect(r.paginas).toBe(3);
    // Sin asociar: s4 (el de dólares) y s6.
    expect(r.cifras).toEqual({ cobrado: 457, reembolsado: 241, neto: 216, fallidos: 1, sin_asociar: 2, sin_convertir: 0 });
  });

  it('los filtros de estado y sin asociar', async () => {
    const f = async (extra) => Object.keys(porStripe(await listarPagosStripe({ projectIds: [ids.PA], ...SEMANA, pagina: 1, limite: 25, ...extra }))).sort();
    expect(await f({ estado: 'reembolsado' })).toEqual(['s2', 's3', 's4']);
    expect(await f({ estado: 'cobrado' })).toEqual(['s1', 's6']);
    expect(await f({ estado: 'fallido' })).toEqual(['s5']);
    expect(await f({ sinAsociar: true })).toEqual(['s4', 's6']);
    expect(await f({ sinAsociar: false })).toEqual(['s1', 's2', 's3']);
  });

  it('a quien ve solo lo suyo: los cargos de sus ventas, sin los sueltos', async () => {
    const r = await listarPagosStripe({ projectIds: [ids.PA], responsableId: [ids.Gema], ...SEMANA, pagina: 1, limite: 25 });
    expect(Object.keys(porStripe(r)).sort()).toEqual(['s1', 's2']);
  });
});

describe('cobros_mensuales en el conector: neto de reembolsos', () => {
  it('los mismos cobros que la pantalla y el reembolso en negativo por su fecha', async () => {
    const filtros = { projectIds: [ids.PA], from: '2026-11-01', to: '2026-11-30' };
    const pantalla = await cobrosMensuales(filtros);
    const neto = await cobrosMensualesNetos(filtros);
    const cobros = neto.filter((r) => r.tipo === 'cobro');
    const reembolsos = neto.filter((r) => r.tipo === 'reembolso');
    expect(cobros).toHaveLength(pantalla.length);
    expect(reembolsos).toHaveLength(2);
    const suma = (fs) => fs.reduce((s, r) => s + Number(r.importe), 0);
    // Cobros: 100 + 175 + 50 de la semana y 92 de V3. Reembolsos: 175 € y 50 USD = 46 €.
    expect(suma(pantalla)).toBe(417);
    expect(reembolsos.map((r) => Number(r.importe)).sort((a, b) => a - b)).toEqual([-175, -46]);
    expect(suma(neto)).toBe(196);
  });
});

describe('monedas y topes (revisión de la PR)', () => {
  it('un cargo antiguo sin convertir sale con su moneda y fuera de las cifras en euros', async () => {
    const r = await listarPagosStripe({ projectIds: [ids.PA], desde: '2026-11-20', hasta: '2026-11-20', pagina: 1, limite: 25 });
    expect(r.pagos).toHaveLength(1);
    expect(r.pagos[0].moneda).toBe('COP');
    expect(r.cifras).toMatchObject({ cobrado: 0, sin_convertir: 1 });
  });

  it('lo reembolsado nunca pasa del cargo: neto 0, nunca negativo', async () => {
    const p = porStripe(await listarPagosStripe({ projectIds: [ids.PA], desde: '2026-11-21', hasta: '2026-11-21', pagina: 1, limite: 25 }));
    expect(p.s11.estado).toBe('reembolsado');
    expect(Number(p.s11.importe_reembolsado)).toBe(80);
    expect(Number(p.s11.neto)).toBe(0);
    expect(p.s12.estado).toBe('reembolsado');
    expect(Number(p.s12.importe_reembolsado)).toBe(60);
    expect(Number(p.s12.neto)).toBe(0);
  });
});
