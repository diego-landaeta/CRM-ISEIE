import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Del gasto a la venta, no al lead (#53), contra la base de verdad.
 *
 * La cadena: campaña de Meta → lead (utm_campaign) → venta → lo COBRADO de
 * verdad (`conversion_payments`). Lo que se defiende:
 *   · coste por venta y retorno salen de las ventas de ESA campaña, no de las
 *     de los productos que tiene asociados;
 *   · el cobrado sale de los apuntes y no de `importe_pagado`, que declara de más;
 *   · una venta es la que ya tiene un cobro y no es una mensualidad (la regla
 *     de «Ventas»), y un lead borrado no cuenta;
 *   · el desfase: lo captado en septiembre se sigue cobrando en octubre, y el
 *     rango de septiembre no puede dejarlo en pérdidas ni el de octubre
 *     inventarse ventas.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/metaRetornoPorCampana.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { getRoi, getProductsView } = await import('../src/modules/meta-ads/meta-ads.service.js');
const ctrl = await import('../src/modules/meta-ads/meta-ads.controller.js');

const MARCA = `ROI${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const C1 = `${MARCA}-C1`;
const C2 = `${MARCA}-C2`;
let P; let OTRO; let PRODUCTO;
const ids = { leads: [], conversions: [] };

async function lead(nombre, { campana = null, creado, proyecto = P, borrado = false }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, created_at, deleted_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, creado, borrado ? '2026-10-20' : null]
  );
  ids.leads.push(l.id);
  if (campana) await q(`INSERT INTO lead_utms (lead_id, utm_campaign) VALUES ($1, $2)`, [l.id, campana]);
  return l.id;
}

/** Una venta con sus apuntes de cobro: [[importe, fecha], ...]. `declarado`: lo que dice importe_pagado. */
async function venta(leadId, total, cobros, { declarado = 0, mensualidad = false, producto = null } = {}) {
  const [c] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion, es_mensualidad)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-09-15', $7) RETURNING id`,
    [leadId, P, `${MARCA} Master`, producto, total, declarado, mensualidad]
  );
  ids.conversions.push(c.id);
  for (const [importe, fecha] of cobros) {
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, $3)`, [c.id, importe, fecha]);
  }
  return c.id;
}

beforeAll(async () => {
  const proy = async (clave) => (await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]
  ))[0].id;
  P = await proy('a');
  OTRO = await proy('b');
  PRODUCTO = (await q(`INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id`, [P, `${MARCA} Master`]))[0].id;

  for (const [id, nombre] of [[C1, 'Campaña uno'], [C2, 'Campaña dos']]) {
    await q(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre) VALUES ($1, $2, 'act_1', $3)`, [id, P, `${MARCA} ${nombre}`]);
  }
  await q(
    `INSERT INTO meta_campaigns_daily (campaign_id, project_id, date, spend, leads) VALUES
       ($1, $3, '2026-09-10', 100, 5), ($1, $3, '2026-10-10', 50, 3), ($2, $3, '2026-10-05', 80, 4)`,
    [C1, C2, P]
  );
  await q(`INSERT INTO meta_campaign_products (campaign_id, product_id, project_id) VALUES ($1, $2, $3)`, [C1, PRODUCTO, P]);

  // L1: captado en septiembre; cobra 400 en septiembre y 300 en octubre. Su
  // importe_pagado declara 9.999: no puede contar.
  const l1 = await lead('L1', { campana: C1, creado: '2026-09-12' });
  await venta(l1, 1000, [[400, '2026-09-20'], [300, '2026-10-12']], { declarado: 9999, producto: PRODUCTO });
  // L2: captado en octubre, venta pagada entera en octubre.
  const l2 = await lead('L2', { campana: C1, creado: '2026-10-11' });
  await venta(l2, 500, [[500, '2026-10-15']]);
  // L3: captado en octubre, sin venta.
  await lead('L3', { campana: C1, creado: '2026-10-12' });
  // L4: de la campaña dos, con una venta SIN ningún cobro: no es una venta todavía.
  const l4 = await lead('L4', { campana: C2, creado: '2026-10-06' });
  await venta(l4, 800, []);
  // L5: sin campaña. Su venta es del CRM pero no de Meta.
  const l5 = await lead('L5', { creado: '2026-10-07' });
  await venta(l5, 700, [[700, '2026-10-08']]);
  // L6: borrado, con campaña y con cobro: no cuenta.
  const l6 = await lead('L6', { campana: C1, creado: '2026-10-13', borrado: true });
  await venta(l6, 123, [[123, '2026-10-14']]);
  // L7: su venta es una mensualidad: no es una venta nueva.
  const l7 = await lead('L7', { campana: C1, creado: '2026-10-14' });
  await venta(l7, 77, [[77, '2026-10-16']], { mensualidad: true });
  // L8: de OTRO proyecto, con el id de la campaña uno: no es de este proyecto.
  const l8 = await lead('L8', { campana: C1, creado: '2026-10-15', proyecto: OTRO });
  await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, fecha_conversion) VALUES ($1, $2, 'x', 999, '2026-10-15')`,
    [l8, OTRO]
  );
  const [{ id: c8 }] = await q(`SELECT id FROM conversions WHERE lead_id = $1`, [l8]);
  ids.conversions.push(c8);
  await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 999, '2026-10-15')`, [c8]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM lead_utms WHERE lead_id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM meta_campaign_products WHERE project_id = $1`, [P]);
  await q(`DELETE FROM meta_campaigns_daily WHERE project_id = $1`, [P]);
  await q(`DELETE FROM meta_campaigns WHERE project_id = $1`, [P]);
  await q(`DELETE FROM products WHERE project_id = $1`, [P]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [[P, OTRO]]);
  await pool.end();
}, 60000);

const fila = (filas, id) => filas.find((r) => r.campaign_id === id);


describe('del gasto a la venta (#53)', () => {
  it('toda la vida de la campaña: gasto, leads, ventas, cobrado, coste por venta y retorno', async () => {
    const c1 = fila(await getRoi({ projectId: P }), C1);
    expect(c1).toMatchObject({
      spend: 150,
      // L1, L2, L3 y L7 llegaron por ella; no el borrado (L6) ni el de otro proyecto (L8).
      leads_crm: 4,
      // Dos ventas con cobro (L1 y L2). La mensualidad (L7) no es una venta nueva.
      ventas: 2,
      vendido: 1500,
      facturado: 1500,
      // 700 + 500, de los apuntes: el importe_pagado de L1 declara 9.999 y no cuenta.
      cobrado: 1200,
      cobrado_en_periodo: 1200,
      coste_por_lead: 37.5,
      coste_por_venta: 75,
      retorno: 1050,
      ganancia: 1050,
      roi_pct: 700,
    });
  });

  it('una venta sin ningún cobro no es una venta, y la de un lead sin campaña no es de Meta', async () => {
    const filas = await getRoi({ projectId: P });
    const c2 = fila(filas, C2);
    expect(c2).toMatchObject({ spend: 80, leads_crm: 1, ventas: 0, vendido: 0, cobrado: 0, coste_por_venta: null, retorno: -80, roi_pct: -100 });
    // Lo cobrado por las campañas no incluye los 700 de L5: ese dinero no vino de Meta.
    expect(filas.reduce((suma, r) => suma + r.cobrado, 0)).toBe(1200);
  });

  it('octubre: el gasto de octubre frente a lo captado en octubre (cohorte) y a lo que entró en octubre (caja)', async () => {
    const c1 = fila(await getRoi({ projectId: P, dateFrom: '2026-10-01', dateTo: '2026-10-31' }), C1);
    expect(c1).toMatchObject({
      spend: 50,
      leads_crm: 3, // L2, L3 y L7: L1 es de septiembre
      ventas: 1,
      vendido: 500,
      cobrado: 500,
      coste_por_venta: 50,
      retorno: 450,
      roi_pct: 900,
      // En octubre ha entrado dinero de L1 (300, captada en septiembre) y de L2 (500).
      cobrado_en_periodo: 800,
      retorno_en_periodo: 750,
      roi_en_periodo_pct: 1500,
    });
  });

  it('EL DESFASE: lo captado en septiembre se mide con todo lo que ha cobrado hasta hoy', async () => {
    const c1 = fila(await getRoi({ projectId: P, dateFrom: '2026-09-01', dateTo: '2026-09-30' }), C1);
    expect(c1).toMatchObject({ spend: 100, leads_crm: 1, ventas: 1, vendido: 1000 });
    // 700 hasta hoy (400 en septiembre y 300 en octubre)…
    expect(c1.cobrado).toBe(700);
    expect(c1.roi_pct).toBe(600);
    // …y mirando solo la caja de septiembre parecería mucho peor.
    expect(c1.cobrado_en_periodo).toBe(400);
    expect(c1.roi_en_periodo_pct).toBe(300);
  });

  it('una campaña sin gasto, sin leads ni cobros en el rango no sale', async () => {
    const filas = await getRoi({ projectId: P, dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(fila(filas, C2)).toBeUndefined();
  });

  it('el dinero se atribuye una sola vez: lo cobrado por las campañas es lo cobrado por los leads que llegaron por ellas', async () => {
    const filas = await getRoi({ projectId: P });
    const [{ total }] = await q(
      `SELECT COALESCE(SUM(cp.importe), 0)::float AS total
         FROM conversion_payments cp
         JOIN conversions c ON c.id = cp.conversion_id
         JOIN lead_utms lu ON lu.lead_id = c.lead_id
         JOIN leads l ON l.id = c.lead_id
        WHERE c.project_id = $1 AND NOT c.es_mensualidad AND l.deleted_at IS NULL AND lu.utm_campaign = ANY($2)`,
      [P, [C1, C2]]
    );
    expect(filas.reduce((suma, r) => suma + r.cobrado, 0)).toBe(total);
  });
});

describe('los productos asociados a una campaña, con el cobrado de verdad', () => {
  it('cobrado sale de los apuntes, no de importe_pagado', async () => {
    const prod = (await getProductsView({ projectId: P })).find((r) => r.product_id === PRODUCTO);
    expect(prod.ventas).toBe(1);
    expect(prod.cobrado).toBe(700); // y no 9.999
  });
});

describe('las fechas del informe', () => {
  const llamarCon = async (query) => {
    let res = null; let err = null;
    await ctrl.getRoi({ query: { projectId: String(P), ...query } }, { json: (cuerpo) => { res = cuerpo; } }, (e) => { err = e; });
    return { res, err };
  };

  it('una fecha que no es AAAA-MM-DD es un 400, no un error de la base', async () => {
    for (const mala of ['ayer', '2026-13-45', '01/10/2026', "2026-10-01'; DROP TABLE x"]) {
      const { err } = await llamarCon({ dateFrom: mala });
      expect(err?.statusCode, mala).toBe(400);
    }
  });

  it('con fechas buenas, o sin ellas, responde', async () => {
    expect((await llamarCon({})).res.success).toBe(true);
    expect((await llamarCon({ dateFrom: '2026-10-01', dateTo: '2026-10-31' })).res.success).toBe(true);
  });
});
