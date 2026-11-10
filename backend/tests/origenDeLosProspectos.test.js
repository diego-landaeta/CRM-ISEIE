import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Ventas y dinero por canal, y el porcentaje «sin origen» (#48), contra la base.
 *
 * Lo que se defiende:
 *   · prospectos, ventas, vendido y cobrado salen por canal;
 *   · «sin origen» (sin fila de origen, o fila vacía en «directo») va APARTE y no
 *     se mezcla con «directo»: su porcentaje dice si la tubería funciona;
 *   · un «directo» con la dirección guardada y sin referrer sí es directo;
 *   · una mensualidad no es una venta, un prospecto borrado no cuenta, el de
 *     otro proyecto tampoco, y una gestora solo ve lo suyo.
 *
 *   npx vitest run tests/origenDeLosProspectos.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { origenDeLosProspectos } = await import('../src/modules/reports/report.model.js');

const MARCA = `ORG${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { leads: [], conversions: [] };
let P; let OTRO; let GESTORA;
const RANGO = { from: '2026-10-01', to: '2026-10-31' };

async function lead(nombre, { origen = null, proyecto = P, responsable = null, borrado = false, dia = '2026-10-10' }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, created_at, fecha_solicitud, responsable_id, deleted_at)
     VALUES ($1, $2, $3, $3, $4, $5) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, dia, responsable, borrado ? '2026-10-20' : null]
  );
  ids.leads.push(l.id);
  if (origen) {
    await q(
      `INSERT INTO lead_utms (lead_id, canal_detectado, utm_source, landing_url, referrer) VALUES ($1, $2, $3, $4, $5)`,
      [l.id, origen.canal ?? null, origen.utm_source ?? null, origen.landing_url ?? null, origen.referrer ?? null]
    );
  }
  return l.id;
}

async function venta(leadId, total, cobrado, { mensualidad = false, proyecto = P } = {}) {
  const [c] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, es_mensualidad)
     VALUES ($1, $2, 'x', $3, $3, '2026-10-12', $4) RETURNING id`,
    [leadId, proyecto, total, mensualidad]
  );
  ids.conversions.push(c.id);
  if (cobrado > 0) await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, '2026-10-12')`, [c.id, cobrado]);
}

beforeAll(async () => {
  const proy = async (clave) => (await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]
  ))[0].id;
  P = await proy('a');
  OTRO = await proy('b');
  GESTORA = (await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} Gestora`, `gestora@${MARCA.toLowerCase()}.test`]
  ))[0].id;

  const a1 = await lead('A1', { origen: { canal: 'meta_ads', utm_source: 'fb' }, responsable: GESTORA });
  await venta(a1, 1000, 600);
  await lead('A2', { origen: { canal: 'meta_ads', utm_source: 'fb' } });
  const b1 = await lead('B1', { origen: { canal: 'chatgpt_ia', referrer: 'https://chatgpt.com/' }, responsable: GESTORA });
  await venta(b1, 500, 500);
  await lead('C1', { origen: { canal: 'directo', landing_url: 'https://x.example/curso/' } });
  const d1 = await lead('D1', {}); // sin ninguna fila de origen
  await venta(d1, 400, 100);
  await lead('D2', { origen: { canal: 'directo' } }); // fila vacía: tampoco se sabe nada
  await lead('D3', { origen: { canal: null } }); // fila vacía y sin canal
  // No cuentan: borrado, de otro proyecto, fuera de fechas, y una mensualidad.
  await lead('X1', { origen: { canal: 'meta_ads' }, borrado: true });
  await lead('X2', { origen: { canal: 'meta_ads' }, proyecto: OTRO });
  await lead('X3', { origen: { canal: 'meta_ads' }, dia: '2026-09-02' });
  const m1 = await lead('M1', { origen: { canal: 'google_ads', utm_source: 'google' } });
  await venta(m1, 77, 77, { mensualidad: true });
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM lead_utms WHERE lead_id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM users WHERE id = $1`, [GESTORA]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [[P, OTRO]]);
  await pool.end();
}, 60000);

const canal = (filas, c) => filas.find((f) => f.canal === c);

describe('ventas y dinero por canal (#48)', () => {
  it('prospectos, conversión, ventas, vendido y cobrado de cada canal', async () => {
    const filas = await origenDeLosProspectos({ projectId: P, ...RANGO });
    expect(canal(filas, 'meta_ads')).toMatchObject({ leads: 2, leads_convertidos: 1, tasa_conversion: 50, ventas: 1, vendido: 1000, cobrado: 600 });
    expect(canal(filas, 'chatgpt_ia')).toMatchObject({ leads: 1, ventas: 1, vendido: 500, cobrado: 500 });
    // Una mensualidad no es una venta: google_ads tiene un prospecto y cero ventas.
    expect(canal(filas, 'google_ads')).toMatchObject({ leads: 1, ventas: 0, vendido: 0 });
  });

  it('«directo» de verdad (con su dirección) no se mezcla con «sin origen»', async () => {
    const filas = await origenDeLosProspectos({ projectId: P, ...RANGO });
    expect(canal(filas, 'directo')).toMatchObject({ leads: 1 }); // C1
    // D1 (sin fila), D2 (directo vacío) y D3 (fila vacía y sin canal).
    expect(canal(filas, 'sin_origen')).toMatchObject({ leads: 3, ventas: 1, vendido: 400, cobrado: 100 });
  });

  it('el porcentaje de cada canal y el de «sin origen», que es el que dice si la tubería funciona', async () => {
    const filas = await origenDeLosProspectos({ projectId: P, ...RANGO });
    const total = filas.reduce((s, f) => s + f.leads, 0);
    expect(total).toBe(8); // A1 A2 B1 C1 D1 D2 D3 M1
    expect(canal(filas, 'sin_origen').pct_prospectos).toBe(37.5);
    expect(canal(filas, 'meta_ads').pct_prospectos).toBe(25);
    expect(filas.reduce((s, f) => s + f.pct_prospectos, 0)).toBeCloseTo(100, 0);
  });

  it('no cuenta el borrado, ni el de otro proyecto, ni el de fuera de fechas', async () => {
    const filas = await origenDeLosProspectos({ projectId: P, ...RANGO });
    expect(canal(filas, 'meta_ads').leads).toBe(2); // sin X1, X2 y X3
    const otro = await origenDeLosProspectos({ projectId: OTRO, ...RANGO });
    expect(otro.map((f) => f.canal)).toEqual(['meta_ads']);
  });

  it('una gestora solo ve lo suyo', async () => {
    const filas = await origenDeLosProspectos({ projectId: P, ...RANGO, asesoraId: GESTORA });
    expect(filas.map((f) => f.canal).sort()).toEqual(['chatgpt_ia', 'meta_ads']);
    expect(canal(filas, 'meta_ads')).toMatchObject({ leads: 1, ventas: 1, vendido: 1000 });
    expect(canal(filas, 'sin_origen')).toBeUndefined();
  });

  it('sin prospectos en el rango, una lista vacía y no un error', async () => {
    expect(await origenDeLosProspectos({ projectId: P, from: '2020-01-01', to: '2020-01-31' })).toEqual([]);
  });
});
