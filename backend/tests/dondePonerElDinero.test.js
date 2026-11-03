import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «¿Dónde ponemos el dinero el mes que viene?» (#56), contra la base de verdad.
 *
 * Lo que se defiende:
 *   · una fila por canal con gasto, prospectos, ventas, cobrado, coste por venta
 *     y retorno, y contra el periodo anterior (misma duración, pegado antes);
 *   · los canales SIN gasto salen igual, con gasto `null` («sin dato», no cero);
 *   · lo cobrado sale de `conversion_payments` y una venta es la que ya tiene un
 *     cobro y no es una mensualidad: las cifras de Finanzas;
 *   · por campaña dentro de cada canal;
 *   · solo admin y super admin, y un admin solo ve SUS campus.
 *
 *   npx vitest run tests/dondePonerElDinero.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: informes } = await import('../src/modules/reports/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { dineroPorCanal, periodoAnterior } = await import('../src/modules/reports/dondePonerElDinero.js');

const app = express();
app.use(express.json());
app.use(informes.prefix, informes.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `DIN${Date.now().toString(36)}`;
const MC1 = `${MARCA}-MC1`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { leads: [], conversions: [], users: [] };
let P; let OTRO; let ADMIN; let GESTORA;
const RANGO = { from: '2026-10-01', to: '2026-10-30' };
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });

async function lead(nombre, { origen = null, dia, proyecto = P }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, created_at, fecha_solicitud) VALUES ($1, $2, $3, $3) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, dia]
  );
  ids.leads.push(l.id);
  if (origen) {
    await q(`INSERT INTO lead_utms (lead_id, canal_detectado, utm_campaign, utm_source) VALUES ($1, $2, $3, 'x')`, [l.id, origen.canal, origen.campana ?? null]);
  }
  return l.id;
}

async function venta(leadId, total, cobrado, { mensualidad = false } = {}) {
  const [c] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, es_mensualidad)
     VALUES ($1, $2, 'x', $3, 99999, '2026-10-20', $4) RETURNING id`,
    [leadId, P, total, mensualidad]
  );
  ids.conversions.push(c.id);
  if (cobrado > 0) await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, '2026-10-25')`, [c.id, cobrado]);
}

beforeAll(async () => {
  const proy = async (clave) => (await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]
  ))[0].id;
  P = await proy('a');
  OTRO = await proy('b');
  const persona = async (nombre, role) => {
    const [u] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
    );
    ids.users.push(u.id);
    await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, P]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin');
  GESTORA = await persona('GESTORA', 'gestor');

  await q(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre) VALUES ($1, $2, 'act_1', $3)`, [MC1, P, `${MARCA} Campaña Meta`]);
  await q(
    `INSERT INTO meta_campaigns_daily (campaign_id, project_id, date, spend) VALUES ($1, $2, '2026-10-05', 100), ($1, $2, '2026-09-10', 80)`,
    [MC1, P]
  );

  // Octubre
  const a1 = await lead('A1', { origen: { canal: 'meta_ads', campana: MC1 }, dia: '2026-10-05' });
  await venta(a1, 1000, 600);
  await lead('A2', { origen: { canal: 'meta_ads', campana: MC1 }, dia: '2026-10-06' });
  const b1 = await lead('B1', { origen: { canal: 'chatgpt_ia' }, dia: '2026-10-07' });
  await venta(b1, 500, 500);
  await lead('D1', { dia: '2026-10-08' }); // sin ninguna fila de origen
  await lead('O1', { origen: { canal: 'organico' }, dia: '2026-10-09' });
  await lead('G1', { origen: { canal: 'google_ads', campana: 'brand-x' }, dia: '2026-10-10' });
  const m1 = await lead('M1', { origen: { canal: 'meta_ads', campana: MC1 }, dia: '2026-10-11' });
  await venta(m1, 77, 77, { mensualidad: true }); // una mensualidad no es una venta
  const s1 = await lead('S1', { origen: { canal: 'meta_ads', campana: MC1 }, dia: '2026-10-12' });
  await venta(s1, 300, 0); // sin ningún cobro: tampoco
  // Septiembre (el periodo anterior de 01–30/10 es 01–30/09)
  const a3 = await lead('A3', { origen: { canal: 'meta_ads', campana: MC1 }, dia: '2026-09-15' });
  await venta(a3, 400, 400);
  await lead('B2', { origen: { canal: 'chatgpt_ia' }, dia: '2026-09-16' });
  // De otro proyecto: no cuenta en el panel de P.
  await lead('X1', { origen: { canal: 'meta_ads', campana: MC1 }, dia: '2026-10-10', proyecto: OTRO });
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM lead_utms WHERE lead_id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM meta_campaigns_daily WHERE project_id = $1`, [P]);
  await q(`DELETE FROM meta_campaigns WHERE project_id = $1`, [P]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [[P, OTRO]]);
  await pool.end();
}, 60000);

const canal = (r, c) => r.canales.find((x) => x.canal === c);

describe('el periodo anterior', () => {
  it('de la misma duración y pegado antes', () => {
    expect(periodoAnterior('2026-10-01', '2026-10-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodoAnterior('2026-10-15', '2026-10-15')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(periodoAnterior('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });
});

describe('dónde poner el dinero (#56)', () => {
  it('el canal con gasto: gasto, prospectos, ventas, cobrado, coste por venta y retorno', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    expect(canal(r, 'meta_ads')).toMatchObject({
      tiene_gasto: true, gasto: 100, leads: 4, ventas: 1, vendido: 1000, cobrado: 600,
      coste_por_lead: 25, coste_por_venta: 100, retorno: 500,
    });
  });

  it('contra el periodo anterior', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    expect(r.anterior).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(canal(r, 'meta_ads').anterior).toMatchObject({ gasto: 80, leads: 1, ventas: 1, cobrado: 400, coste_por_venta: 80 });
    expect(canal(r, 'chatgpt_ia').anterior).toMatchObject({ leads: 1, ventas: 0, cobrado: 0 });
  });

  it('los canales SIN gasto salen igual, y con gasto null (sin dato), no cero', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    // Google Ads cuesta dinero aunque el CRM no lo sepa: es «de pago», no «sin gasto».
    expect(canal(r, 'google_ads')).toMatchObject({ tiene_gasto: false, es_de_pago: true });
    expect(canal(r, 'organico')).toMatchObject({ es_de_pago: false });
    expect(canal(r, 'chatgpt_ia')).toMatchObject({ tiene_gasto: false, es_de_pago: false, gasto: null, leads: 1, ventas: 1, cobrado: 500, coste_por_venta: null, retorno: null });
    expect(canal(r, 'organico')).toMatchObject({ gasto: null, leads: 1, ventas: 0 });
    expect(canal(r, 'google_ads')).toMatchObject({ gasto: null, leads: 1 });
  });

  it('«sin origen» sale aparte', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    expect(canal(r, 'sin_origen')).toMatchObject({ leads: 1, ventas: 0 });
  });

  it('una mensualidad y una venta sin cobro no son ventas; el importe_pagado declarado no cuenta', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    // M1 (mensualidad) y S1 (sin cobro) son prospectos de Meta pero no ventas; y las ventas
    // declaran 99.999 en importe_pagado, que no aparece en ninguna cifra.
    expect(canal(r, 'meta_ads').ventas).toBe(1);
    expect(r.canales.every((c) => c.cobrado < 99999)).toBe(true);
  });

  it('por campaña dentro de cada canal', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    expect(canal(r, 'meta_ads').campanas).toEqual([
      expect.objectContaining({ campana: MC1, nombre: `${MARCA} Campaña Meta`, gasto: 100, leads: 4, ventas: 1, cobrado: 600, coste_por_venta: 100 }),
    ]);
    // Sin gasto conocido: la campaña sale por su nombre de UTM y sin coste.
    expect(canal(r, 'google_ads').campanas).toEqual([
      expect.objectContaining({ campana: 'brand-x', nombre: 'brand-x', gasto: null, coste_por_venta: null, leads: 1 }),
    ]);
  });

  it('el total suma solo el gasto conocido, y avisa de que falta el de Google Ads', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    // El coste por venta del total divide el gasto entre las ventas de los canales CON gasto (1, la de Meta),
    // no entre las de ChatGPT, que no costaron nada. El «mezclado» las usa todas.
    expect(r.total).toMatchObject({ leads: 8, ventas: 2, cobrado: 1100, gasto: 100, coste_por_venta: 100, coste_mezclado: 50 });
    expect(r.total_anterior).toMatchObject({ leads: 2, ventas: 1, cobrado: 400, gasto: 80 });
    expect(r.gasto_completo).toBe(false);
    expect(r.canales_con_gasto).toEqual(['meta_ads']);
  });

  it('un prospecto de otro proyecto no cuenta', async () => {
    const r = await dineroPorCanal({ projectId: OTRO, ...RANGO });
    expect(r.canales.map((c) => c.canal)).toEqual(['meta_ads']);
    expect(canal(r, 'meta_ads')).toMatchObject({ leads: 1, gasto: 0 });
  });

  it('las filas vienen de más cobrado a menos', async () => {
    const r = await dineroPorCanal({ projectId: P, ...RANGO });
    const cobrados = r.canales.map((c) => c.cobrado);
    expect([...cobrados].sort((a, b) => b - a)).toEqual(cobrados);
  });
});

describe('quién puede verlo', () => {
  const pide = (u, query = '') => request.get(`/api/informes/canales/dinero?from=2026-10-01&to=2026-10-30${query}`).set('Authorization', `Bearer ${jwtDe(u)}`);

  it('una gestora no: 403', async () => {
    expect((await pide(GESTORA)).status).toBe(403);
  });

  it('un admin sí, y solo de SUS campus: «todos» no incluye el de otra persona', async () => {
    const r = await pide(ADMIN);
    expect(r.status).toBe(200);
    // Sus campus son solo P: los prospectos de OTRO (X1) no entran.
    expect(canal(r.body.data, 'meta_ads').leads).toBe(4);
  });

  it('y un campus que no es suyo es un 403', async () => {
    expect((await pide(ADMIN, `&projectId=${OTRO}`)).status).toBe(403);
  });

  it('fechas mal escritas o al revés: 400', async () => {
    const mal = (qs) => request.get(`/api/informes/canales/dinero?${qs}`).set('Authorization', `Bearer ${jwtDe(ADMIN)}`);
    expect((await mal('from=ayer&to=2026-10-30')).status).toBe(400);
    expect((await mal('from=2026-10-30&to=2026-10-01')).status).toBe(400);
    expect((await mal('from=2020-01-01&to=2026-10-30')).status).toBe(400);
  });
});
