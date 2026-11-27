import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import {
  getResumenVentas, getTopProducts, getDesglose, getSerieVentas, getVentasPorAsesora,
} from '../src/modules/sales/sales.service.js';
import { paisesMasVendidos, paisesDeEntrada } from '../src/modules/reports/report.model.js';

/**
 * «Solo compartidas» con una gestora (QA de CRM#1182 y CRM-ISEIE#820).
 *
 * «Cursos vendidos» le daba la mitad de la venta compartida, pero «Evolución»,
 * «De qué se compone» y «Ventas por país» miraban una sola vendedora por venta
 * (`COALESCE(vendedora_id, responsable)`): a la que no figura como vendedora le
 * salía 0 €, y a la otra la venta entera. «Por asesora» agrupaba igual, y la
 * segunda gestora ni aparecía. La regla es `conversion_reparto`: la compartida
 * le cuenta a cada una su parte, en todas las tarjetas.
 *
 * Contra la base real: el reparto es SQL, y un mock del SQL no prueba el SQL.
 */

const MARCA = `CPG${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], leads: [], ventas: [] };
let PROYECTO; let ANA; let BERTA;
const DESDE = '2026-04-01'; const HASTA = '2026-04-30';

async function venta(nombre, gestora, importe, dia, reparto = null) {
  const l = await one(`INSERT INTO leads (project_id, nombre, email, telefono, responsable_id, status, fecha_solicitud)
                       VALUES ($1, $2, $3, '+34600000000', $4, 'convertido', '2026-04-01') RETURNING id`,
    [PROYECTO, `${MARCA} ${nombre}`, `${nombre}@${MARCA.toLowerCase()}.test`, gestora]);
  ids.leads.push(l.id);
  const c = await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, vendedora_id)
                       VALUES ($1, $2, 'Curso', $3, $3, $4, $5) RETURNING id`, [l.id, PROYECTO, importe, dia, gestora]);
  ids.ventas.push(c.id);
  await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, $2, $3, 'tarjeta')`, [c.id, importe, dia]);
  if (reparto) {
    await q(`INSERT INTO conversion_vendedoras (conversion_id, user_id, porcentaje) VALUES ($1, $2, 50), ($1, $3, 50)`,
      [c.id, reparto[0], reparto[1]]);
  }
  return c.id;
}

beforeAll(async () => {
  PROYECTO = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} campus`, `${MARCA.toLowerCase()}`, `${MARCA}-k`])).id;
  const gestora = async (n) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`]);
    ids.users.push(u.id);
    return u.id;
  };
  ANA = await gestora('ana'); BERTA = await gestora('berta');
  // Dos enteras (una de cada) y dos a medias. Las dos compartidas figuran con
  // Ana como vendedora: es lo que hacía que a Berta le salieran a 0.
  await venta('uno', ANA, 1000, '2026-04-10');
  await venta('dos', BERTA, 450.5, '2026-04-11');
  await venta('tres', ANA, 1200, '2026-04-12', [ANA, BERTA]);
  // 333,33 a medias son 166,665: medio céntimo que no debe salir por la API.
  await venta('cuatro', ANA, 333.33, '2026-04-13', [ANA, BERTA]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM conversion_vendedoras WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM invoices WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM matriculas WHERE conversion_id = ANY($1::int[])', [ids.ventas]).catch(() => {});
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = $1', [PROYECTO]);
  await pool.end();
});

const base = (extra = {}) => ({ projectId: PROYECTO, from: DESDE, to: HASTA, ...extra });
const vendidoPorPais = async (f) => (await paisesMasVendidos({ ...f, asesoraId: f.responsableId }))
  .reduce((t, p) => t + Number(p.vendido || 0), 0);
const cobradoPorPais = async (f) => (await paisesMasVendidos({ ...f, asesoraId: f.responsableId }))
  .reduce((t, p) => t + Number(p.cobrado || 0), 0);

describe('una gestora con «Solo compartidas»: la mitad en todas las tarjetas', () => {
  for (const [nombre, gestora] of [['la que figura como vendedora', () => ANA], ['la otra', () => BERTA]]) {
    it(nombre, async () => {
      const f = base({ responsableId: gestora(), compartidas: 'solo' });
      expect((await getTopProducts(f)).totales.facturado).toBe(766.67);
      expect((await getResumenVentas(f)).importe).toBe(766.67);
      expect((await getSerieVentas(f)).totales).toMatchObject({ ventas: 2, vendido: 766.67, cobrado: 766.67 });
      expect((await getDesglose(f)).totales).toMatchObject({ ventas: 2, vendido: 766.67, cobrado: 766.67 });
      expect(await vendidoPorPais(f)).toBeCloseTo(766.67, 2);
      expect(await cobradoPorPais(f)).toBeCloseTo(766.67, 2);
    });
  }

  it('y con «Todas», su entera más la mitad de las compartidas', async () => {
    const f = base({ responsableId: BERTA });
    expect((await getTopProducts(f)).totales.facturado).toBe(1217.17);
    expect((await getSerieVentas(f)).totales.vendido).toBe(1217.17);
    expect((await getDesglose(f)).totales.vendido).toBe(1217.17);
    expect(await vendidoPorPais(f)).toBeCloseTo(1217.17, 2);
  });
});

describe('Análisis › Por asesora, con «Solo compartidas»', () => {
  it('salen las dos, cada una con su mitad', async () => {
    const filas = await getVentasPorAsesora(base({ compartidas: 'solo' }));
    const de = (id) => filas.find((a) => a.user_id === id);
    expect(de(ANA)).toMatchObject({ ventas: 1, importe: 766.67, cobrado: 766.67 });
    expect(de(BERTA)).toMatchObject({ ventas: 1, importe: 766.67, cobrado: 766.67 });
    // Cada una, la mitad de las dos ventas: la tabla suma las ventas del resumen.
    expect(filas.reduce((t, a) => t + a.ventas, 0)).toBe((await getResumenVentas(base({ compartidas: 'solo' }))).ventas);
  });
  it('con una gestora elegida, solo su fila', async () => {
    const filas = await getVentasPorAsesora(base({ compartidas: 'solo', responsableId: BERTA }));
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ user_id: BERTA, importe: 766.67 });
  });
});

describe('el resumen cuenta a las asesoras por el reparto', () => {
  it('dos compartidas entre dos gestoras son dos asesoras, no una', async () => {
    expect((await getResumenVentas(base({ compartidas: 'solo' }))).asesoras).toBe(2);
    expect((await getResumenVentas(base())).asesoras).toBe(2);
    expect((await getResumenVentas(base({ responsableId: BERTA }))).asesoras).toBe(1);
  });
});

describe('Reportes › Campus y país de entrada, con una gestora', () => {
  // Iba aparte de `paisesMasVendidos` y sumaba la compartida entera a las dos.
  const suma = async (asesoraId, campo) => (await paisesDeEntrada({ ...base(), asesoraId }))
    .reduce((t, p) => t + Number(p[campo] || 0), 0);

  it('a cada una, su entera y la mitad de las compartidas', async () => {
    expect(await suma(BERTA, 'vendido')).toBeCloseTo(1217.17, 2);
    expect(await suma(BERTA, 'cobrado')).toBeCloseTo(1217.17, 2);
    expect(await suma(ANA, 'vendido')).toBeCloseTo(1766.67, 2);
    expect(await suma(ANA, 'cobrado')).toBeCloseTo(1766.67, 2);
  });
  it('sin gestora, cada venta entera una vez', async () => {
    expect(await suma(undefined, 'vendido')).toBeCloseTo(2983.83, 2);
    expect(await suma(undefined, 'ventas')).toBe(4);
  });
});
