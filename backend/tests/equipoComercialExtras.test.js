import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Equipo comercial: los recortes que el 360 (CRM#712) hizo de más y aquí
 * faltaban (CRM-ISEIE#415, tras la #418).
 *
 *   · la factura por id (ficha, PDF, acciones): de su alcance, no solo de su
 *     campus; vale también para una gestora;
 *   · proceso y convocatorias de un prospecto por id (`/lead/:leadId`);
 *   · informes: overview y aviso de cobros sin factura;
 *   · ventas sin formación, pulsaciones del widget y decisiones de Make.
 *
 * Mismo montaje que `equipoComercialFugas.test.js` del 360, donde estos
 * casos están junto al resto.
 *
 * Contra la base LOCAL (tests/setup.js):
 *   npx vitest run tests/equipoComercialExtras.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');
const MODULOS = ['auth', 'users', 'projects', 'accounting', 'invoices', 'whatsapp', 'permissions',
  'reports', 'proceso', 'convocatorias', 'conversions', 'commissions', 'sales', 'widget', 'asignacion'];
const modulos = await Promise.all(MODULOS.map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `EQF${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [], ventas: [], gastos: [] };

let EMPRESA; let A; let B;
let SUPER; let LIDER; let ADMIN; let G1; let G2; let GF;
const L = {}; const V = {}; const PAGO = {}; const F = {};

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));
const ok = (r) => { expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data; };
const idsDe = (lista, campo = 'id') => (lista || []).map((x) => Number(x[campo]));

async function persona(n, role, campus = []) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

async function prospecto(clave, responsable, campus = A) {
  const l = await one(
    `INSERT INTO leads (project_id, nombre, email, telefono, responsable_id)
     VALUES ($1, $2, $3, '+34600111222', $4) RETURNING id`,
    [campus, `${MARCA} ${clave}`, `${clave.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`, responsable?.id ?? null]);
  L[clave] = l.id; ids.leads.push(l.id);
  return l.id;
}

// Un prospecto con su venta (500, de su gestora), un cobro de hoy (100) y, si
// se dice, una factura emitida (por un importe distinto de 100: si no, la cola
// daría el cobro por facturado).
async function venta(clave, gestora, { total = 500, factura = null, numero = null } = {}) {
  const leadId = await prospecto(clave, gestora);
  const v = await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado,
                              vendedora_id, fecha_conversion)
     VALUES ($1, $2, 'Curso', $3, 100, $4, CURRENT_DATE) RETURNING id`, [leadId, A, total, gestora?.id ?? null]);
  V[clave] = v.id; ids.ventas.push(v.id);
  const p = await one(
    'INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE) RETURNING id', [v.id]);
  PAGO[clave] = p.id;
  if (factura != null) {
    const f = await one(
      `INSERT INTO invoices (project_id, ano, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad,
                             cliente_cp, cliente_pais, items, base_imponible, total, conversion_id, lead_id,
                             estado, tipo, fecha_emision, serie, numero, codigo)
       VALUES ($1, EXTRACT(YEAR FROM CURRENT_DATE)::int, $2, 'X', 'X', 'X', 'X', 'ES', '[]', $3, $3, $4, $5,
               'emitida', 'normal', CURRENT_DATE, 'ZQ', $6, $7) RETURNING id`,
      [A, `${MARCA} ${clave}`, factura, v.id, leadId, numero, `${MARCA}-${numero}`]);
    F[clave] = f.id;
  }
}

beforeAll(async () => {
  const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id',
    [`${MARCA} empresa`, `B9${Date.now().toString().slice(-7)}`]);
  ids.issuers.push(e.id); EMPRESA = e.id;
  const campus = async (n) => {
    const p = await one(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-key-${n}`, EMPRESA]);
    ids.projects.push(p.id); return p.id;
  };
  A = await campus('a'); B = await campus('b');

  SUPER = await persona('super', 'superadmin');
  LIDER = await persona('lider', 'admin', [A, B]);    // lleva a G1 y G2
  ADMIN = await persona('admin', 'admin', [A, B]);    // sin equipo: todo
  G1 = await persona('guno', 'gestor', [A]);
  G2 = await persona('gdos', 'gestor', [B]);
  GF = await persona('gfuera', 'gestor', [A]);        // de fuera del equipo

  await venta('L1', G1, { factura: 120, numero: 1 });
  await venta('LF', GF, { factura: 300, numero: 2 });
  await prospecto('L0', null);                        // sin responsable
  const g = await one(
    `INSERT INTO expenses (project_id, concepto, importe, fecha, categoria)
     VALUES ($1, $2, 50, CURRENT_DATE, 'otros') RETURNING id`, [A, `${MARCA} gasto`]);
  ids.gastos.push(g.id);
  // Una comisión de cada venta para su gestora.
  await q(`INSERT INTO commissions (conversion_id, user_id, importe_base, pct, importe_comision)
           VALUES ($1, $2, 100, 10, 10), ($3, $4, 100, 10, 10)`, [V.L1, G1.id, V.LF, GF.id]);
  await q(`INSERT INTO user_activity_log (user_id, action, details) VALUES ($1, 'login', '{}'), ($2, 'login', '{}')`,
    [G1.id, GF.id]).catch(() => {});

  // El equipo lo pone el super admin, por la ruta de verdad.
  const r = await request.put(`/api/users/${LIDER.id}/equipo-comercial`).set(como(SUPER))
    .send({ gestoraIds: [G1.id, G2.id] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}, 60000);

afterAll(async () => {
  const quita = (sql, p) => q(sql, p).catch(() => {});
  await quita('DELETE FROM equipo_comercial WHERE lider_id = ANY($1::int[]) OR gestora_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM asignacion_decisiones WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM widget_pulsaciones WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM expenses WHERE id = ANY($1::int[])', [ids.gastos]);
  await quita('DELETE FROM commissions WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await quita('DELETE FROM conversion_vendedoras WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await quita('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await quita('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await quita('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await quita('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await quita('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('1 · Facturas: la factura por id, como la lista', () => {
  it('la factura de una gestora de fuera por id: 403 a la líder (ficha y PDF) y a otra gestora', async () => {
    expect((await pedir(LIDER, `/api/invoices/${F.LF}`)).status).toBe(403);
    expect((await pedir(LIDER, `/api/invoices/${F.LF}/pdf`)).status).toBe(403);
    expect((await pedir(G1, `/api/invoices/${F.LF}`)).status).toBe(403);
    expect((await pedir(G1, `/api/invoices/${F.LF}/pdf`)).status).toBe(403);
  });

  it('la de su equipo, sí; y la admin y la dueña, la suya', async () => {
    expect((await pedir(LIDER, `/api/invoices/${F.L1}`)).status).toBe(200);
    expect((await pedir(G1, `/api/invoices/${F.L1}`)).status).toBe(200);
    expect((await pedir(ADMIN, `/api/invoices/${F.LF}`)).status).toBe(200);
    expect((await pedir(GF, `/api/invoices/${F.LF}`)).status).toBe(200);
  });
});

describe('2 · Informes y ventas sin formación', () => {
  it('overview: el reparto por gestora, solo su equipo', async () => {
    const nombres = (d) => (d.leads_por_gestor || []).map((g) => g.gestor);
    const deLaLider = nombres(ok(await pedir(LIDER, `/api/informes/overview?projectId=${A}`)));
    expect(deLaLider).toContain(`${MARCA} guno`);
    expect(deLaLider).not.toContain(`${MARCA} gfuera`);
    expect(nombres(ok(await pedir(ADMIN, `/api/informes/overview?projectId=${A}`)))).toContain(`${MARCA} gfuera`);
  });

  it('ventas sin formación (GET /api/ventas/sin-formacion): la líder, las de su equipo', async () => {
    const ventas = async (u) => idsDe(ok(await pedir(u, `/api/ventas/sin-formacion?projectId=${A}`)).filas);
    const deLaLider = await ventas(LIDER);
    expect(deLaLider).toContain(V.L1);
    expect(deLaLider).not.toContain(V.LF);
    expect(await ventas(ADMIN)).toEqual(expect.arrayContaining([V.L1, V.LF]));
  });
});

describe('3 · Aviso de cobros sin factura, pulsaciones del widget y decisiones de Make', () => {
  const permitir = async (u, resource, action) => {
    await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, $2, $3, true)
             ON CONFLICT (user_id, resource, action) DO UPDATE SET allowed = true`, [u.id, resource, action]);
    olvidarPermisos();
  };

  it('informes/aviso-sin-factura: la líder, los cobros sin factura de su equipo; la admin, todos', async () => {
    await venta('LN1', G1);
    await venta('LNF', GF);
    const aviso = async (u) => idsDe(ok(await pedir(u,
      `/api/informes/aviso-sin-factura?projectId=${A}&from=2000-01-01&to=2999-12-31`)).detalle);
    const deLaLider = await aviso(LIDER);
    expect(deLaLider).toContain(V.LN1);
    expect(deLaLider).not.toContain(V.LNF);
    expect(await aviso(ADMIN)).toEqual(expect.arrayContaining([V.LN1, V.LNF]));
  });

  it('widget/pulsaciones: por gestora, la líder solo ve a su equipo', async () => {
    await q('INSERT INTO widget_pulsaciones (project_id, user_id, pagina) VALUES ($1, $2, $4), ($1, $3, $4)',
      [A, G1.id, GF.id, `${MARCA}-pagina`]);
    await permitir(LIDER, 'widget', 'view');
    await permitir(ADMIN, 'widget', 'view');
    const porGestora = async (u) => idsDe(ok(await pedir(u,
      `/api/widget/pulsaciones?projectId=${A}&from=2000-01-01&to=2999-12-31`)).porGestora);
    const deLaLider = await porGestora(LIDER);
    expect(deLaLider).toContain(G1.id);
    expect(deLaLider).not.toContain(GF.id);
    expect(await porGestora(ADMIN)).toEqual(expect.arrayContaining([G1.id, GF.id]));
  });

  it('asignacion/decisiones: la líder, las de su equipo; reenviar una de fuera, 403', async () => {
    const dec = async (uid, gestora) => (await one(
      `INSERT INTO asignacion_decisiones (project_id, uid, escenario, responsable_id, lead_id, datos, estado)
       VALUES ($1, $2, 1, $3, $4, '{}'::jsonb, 'fallido') RETURNING id`,
      [A, `${MARCA}-${uid}`, gestora.id, gestora === G1 ? L.L1 : L.LF])).id;
    await dec('d1', G1);
    const fuera = await dec('df', GF);
    for (const u of [LIDER, ADMIN]) {
      await permitir(u, 'webhooks_salientes', 'view');
      await permitir(u, 'webhooks_salientes', 'edit');
    }
    const deQuien = async (u) => idsDe(ok(await pedir(u, `/api/asignacion/decisiones?project_id=${A}`)), 'responsable_id');
    const deLaLider = await deQuien(LIDER);
    expect(deLaLider).toContain(G1.id);
    expect(deLaLider).not.toContain(GF.id);
    expect(await deQuien(ADMIN)).toEqual(expect.arrayContaining([G1.id, GF.id]));
    const r = await request.post(`/api/asignacion/decisiones/${fuera}/reenviar`).set(como(LIDER));
    expect(r.status, JSON.stringify(r.body)).toBe(403);
  });
});

describe('4 · Proceso y convocatorias de un prospecto por id', () => {
  it('uno de fuera: 403 a la líder y a otra gestora; el suyo y la admin, sí', async () => {
    expect((await pedir(LIDER, `/api/proceso/lead/${L.LF}`)).status).toBe(403);
    expect((await pedir(LIDER, `/api/convocatorias/lead/${L.LF}`)).status).toBe(403);
    expect((await pedir(G1, `/api/proceso/lead/${L.LF}`)).status).toBe(403);
    expect((await pedir(LIDER, `/api/proceso/lead/${L.L1}`)).status).not.toBe(403);
    expect((await pedir(ADMIN, `/api/proceso/lead/${L.LF}`)).status).not.toBe(403);
  });
});
