import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Equipo comercial: las fugas que encontró el QA en /testeo (09/11/2026).
 *
 * Una administradora que lleva equipo (Raquel) tiene que ver lo suyo y lo de
 * sus gestoras, no lo del campus entero. Una administradora sin equipo
 * (Daniela) lo sigue viendo todo. Una prueba por fuga, con las dos.
 *
 * Contra la base LOCAL (docker-compose.dev.yml):
 *   npx vitest run tests/equipoComercialFugas.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const modulos = await Promise.all([
  import('../src/modules/projects/index.js'),
  import('../src/modules/accounting/index.js'),
  import('../src/modules/invoices/index.js'),
  import('../src/modules/whatsapp/index.js'),
  import('../src/modules/users/index.js'),
  import('../src/modules/auth/index.js'),
  import('../src/modules/permissions/index.js'),
  import('../src/modules/conversions/index.js'),
  import('../src/modules/commissions/index.js'),
]);
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { usuarioObjetivo } = await import('../src/modules/whatsapp/chat.controller.js');
const { alcanceDeLider } = await import('../src/shared/utils/roles.js');

const app = express();
app.use(express.json());
for (const { default: m } of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `EQF${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [], invoices: [], expenses: [] };
let P;
let SUPER; let RAQUEL; let DANIELA; let G1; let G2; let G3;
const L = {}; const V = {}; const PAGO = {};

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

// Un prospecto de esa gestora, con su venta (500), un cobro (100) y una
// factura emitida por el importe que se diga (distinto de 100: si no, la cola
// da el cobro por facturado, FACTURA_HUERFANA_LO_CUBRE).
async function venta(clave, responsable, facturado) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, email, telefono, responsable_id)
     VALUES ($1, $2, $3, '+34600111222', $4) RETURNING id`,
    [P, `${MARCA} ${clave}`, `${clave.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`, responsable.id]);
  L[clave] = l.id; ids.leads.push(l.id);
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, 'Curso', 500, 0, CURRENT_DATE) RETURNING id`, [l.id, P]);
  V[clave] = v.id; ids.conversions.push(v.id);
  const [pg] = await q(
    'INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE) RETURNING id', [v.id]);
  PAGO[clave] = pg.id;
  const [inv] = await q(
    `INSERT INTO invoices (project_id, ano, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad,
                           cliente_cp, cliente_pais, items, base_imponible, total, conversion_id, lead_id,
                           estado, tipo, fecha_emision, serie, numero, codigo)
     VALUES ($1, EXTRACT(YEAR FROM CURRENT_DATE)::int, $2, 'X', 'X', 'X', 'X', 'ES', '[]', $3, $3, $4, $5,
             'emitida', 'normal', CURRENT_DATE, 'ZQ', $6, $2) RETURNING id`,
    [P, `${MARCA} ${clave}`, facturado, v.id, l.id, 900000000 + Math.floor(Math.random() * 99999999)]);
  ids.invoices.push(inv.id);
}

beforeAll(async () => {
  const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} a`, `${MARCA.toLowerCase()}-a`, `${MARCA}-key-a`]);
  ids.projects.push(p.id); P = p.id;
  SUPER = await persona('SUPER', 'superadmin');
  RAQUEL = await persona('RAQUEL', 'admin', [P]);
  DANIELA = await persona('DANIELA', 'admin', [P]);
  G1 = await persona('GUNO', 'gestor', [P]);
  G2 = await persona('GDOS', 'gestor', [P]);
  G3 = await persona('GTRES', 'gestor', [P]);
  await venta('L1', G1, 120);
  await venta('L3', G3, 300);
  const [e] = await q(
    `INSERT INTO expenses (project_id, concepto, importe, fecha, categoria)
     VALUES ($1, $2, 50, CURRENT_DATE, 'otros') RETURNING id`, [P, `${MARCA} gasto`]);
  ids.expenses.push(e.id);
  // Comisión de cada venta para su gestora, y un apunte de actividad de cada una.
  await q(`INSERT INTO commissions (conversion_id, user_id, importe_base, pct, importe_comision)
           VALUES ($1, $2, 100, 10, 10), ($3, $4, 100, 10, 10)`, [V.L1, G1.id, V.L3, G3.id]);
  await q(`INSERT INTO user_activity_log (user_id, action, details) VALUES ($1, 'login', '{}'), ($2, 'login', '{}')`,
    [G1.id, G3.id]);
  // Raquel lleva a G1 y G2; G3 es de fuera. Lo pone el super admin.
  const r = await request.put(`/api/users/${RAQUEL.id}/equipo-comercial`).set(como(SUPER))
    .send({ gestoraIds: [G1.id, G2.id] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM equipo_comercial WHERE lider_id = ANY($1::int[]) OR gestora_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]).catch(() => {});
  await q('DELETE FROM invoices WHERE id = ANY($1::int[])', [ids.invoices]);
  await q('DELETE FROM expenses WHERE id = ANY($1::int[])', [ids.expenses]);
  await q('DELETE FROM commissions WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM conversion_vendedoras WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

const ok = (r) => { expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data; };

describe('alcanceDeLider', () => {
  it('Raquel (con equipo): ella y sus gestoras; Daniela, una gestora y el super admin: null', async () => {
    const yo = (u) => ({ userId: u.id, role: u.role });
    expect(await alcanceDeLider(yo(RAQUEL))).toEqual([RAQUEL.id, ...[G1.id, G2.id].sort((a, b) => a - b)]);
    expect(await alcanceDeLider(yo(DANIELA))).toBeNull();
    expect(await alcanceDeLider(yo(G1))).toBeNull();
    expect(await alcanceDeLider(yo(SUPER))).toBeNull();
  });
});

describe('1. «Último lead de cada gestora» (GET /api/projects/:id/ultimo-lead)', () => {
  const gestorasDe = async (u) => ok(await request.get(`/api/projects/${P}/ultimo-lead`).set(como(u)))
    .gestoras.map((g) => Number(g.id));

  it('Raquel ve a G1 y G2, y no a G3', async () => {
    const vistas = await gestorasDe(RAQUEL);
    expect(vistas).toEqual(expect.arrayContaining([G1.id, G2.id]));
    expect(vistas).not.toContain(G3.id);
  });

  it('Daniela (sin equipo) y una gestora, como siempre: las tres', async () => {
    expect(await gestorasDe(DANIELA)).toEqual(expect.arrayContaining([G1.id, G2.id, G3.id]));
    expect(await gestorasDe(G1)).toEqual(expect.arrayContaining([G1.id, G2.id, G3.id]));
  });
});

describe('2. Finanzas › Dashboard (GET /api/accounting/dashboard)', () => {
  const dash = async (u) => ok(await request.get(`/api/accounting/dashboard?projectId=${P}`).set(como(u)));

  it('Raquel: cobrado, facturado y por cobrar solo de su equipo; sin egresos ni balance', async () => {
    const d = await dash(RAQUEL);
    expect(d.ingresos.total_cobrado).toBe(100);
    expect(d.ingresos.total_facturado).toBe(500);
    expect(d.ingresos.total_emitido).toBe(120);
    expect(d.cuentas_por_cobrar.map((c) => Number(c.id))).toEqual([V.L1]);
    expect(d.cuentas_por_cobrar_resumen).toMatchObject({ num: 1, total: 500 });
    expect(d.egresos).toMatchObject({ total: 0, num_egresos: 0, por_categoria: [] });
    expect(d.balance).toBeNull();
    expect(d.solo_administracion).toEqual(['egresos', 'balance']);
    expect(d.trend.egresos).toEqual([]);
  });

  it('Daniela: todo el campus, con egresos y balance', async () => {
    const d = await dash(DANIELA);
    expect(d.ingresos.total_cobrado).toBe(200);
    expect(d.ingresos.total_emitido).toBe(420);
    expect(d.cuentas_por_cobrar.map((c) => Number(c.id)).sort()).toEqual([V.L1, V.L3].sort());
    // Los egresos generales (sin campus) también entran en su ámbito: al menos
    // el de este campus, y el balance cuadra con lo que salga.
    expect(d.egresos.total).toBeGreaterThanOrEqual(50);
    expect(d.balance).toBeCloseTo(200 - d.egresos.total, 2);
    expect(d.solo_administracion).toEqual([]);
  });
});

describe('3. Cola de facturación (GET /api/invoices/facturacion-al-dia) y totales de Facturas', () => {
  const cola = async (u) => ok(await request.get(`/api/invoices/facturacion-al-dia?projectId=${P}`).set(como(u)));

  it('Raquel: solo los cobros de su equipo', async () => {
    const d = await cola(RAQUEL);
    expect(d.cola.map((c) => c.payment_id)).toEqual([PAGO.L1]);
    expect(d.pagos_sin_factura).toBe(1);
    expect(d.importe_sin_factura).toBe(100);
  });

  it('Daniela: los de todas', async () => {
    const d = await cola(DANIELA);
    expect(d.cola.map((c) => c.payment_id).sort()).toEqual([PAGO.L1, PAGO.L3].sort());
  });

  it('Raquel, con «Emitir desde la cola»: un cobro de fuera, 403; «emitir hasta», 403', async () => {
    await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'facturas', 'cola', true)
             ON CONFLICT (user_id, resource, action) DO UPDATE SET allowed = true`, [RAQUEL.id]);
    const { olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');
    olvidarPermisos();
    const g = await request.post('/api/invoices/cola/generar').set(como(RAQUEL)).send({ projectId: P, paymentId: PAGO.L3 });
    expect(g.status, JSON.stringify(g.body)).toBe(403);
    expect(g.body.code).toBe('FUERA_DE_TU_EQUIPO');
    const h = await request.post('/api/invoices/cola/emitir-hasta').set(como(RAQUEL)).send({ projectId: P, hasta: '2999-12-31' });
    expect(h.status, JSON.stringify(h.body)).toBe(403);
    expect(h.body.code).toBe('FUERA_DE_TU_EQUIPO');
    const sinFactura = await q('SELECT 1 FROM invoices WHERE payment_id = ANY($1::int[])', [[PAGO.L1, PAGO.L3]]);
    expect(sinFactura).toHaveLength(0);
  });

  it('totales de Facturas (GET /api/invoices/stats): Raquel, los de su equipo; Daniela, todos', async () => {
    const s = async (u) => ok(await request.get(`/api/invoices/stats?projectId=${P}`).set(como(u)));
    expect(Number((await s(RAQUEL)).total_facturado)).toBe(120);
    expect(Number((await s(DANIELA)).total_facturado)).toBe(420);
  });
});

describe('4. WhatsApp', () => {
  const usuarios = async (u) => ok(await request.get('/api/whatsapp/usuarios').set(como(u))).map((x) => Number(x.id));
  const objetivo = (u, usuarioId) => usuarioObjetivo({ user: { userId: u.id, role: u.role }, query: { usuarioId: String(usuarioId) }, body: {}, ip: null });

  it('el selector de Raquel: ella y su equipo; el de Daniela, todo el campus', async () => {
    const deRaquel = await usuarios(RAQUEL);
    expect(deRaquel).toEqual(expect.arrayContaining([RAQUEL.id, G1.id, G2.id]));
    expect(deRaquel).not.toContain(G3.id);
    expect(deRaquel).not.toContain(DANIELA.id);
    expect(await usuarios(DANIELA)).toEqual(expect.arrayContaining([G1.id, G2.id, G3.id, RAQUEL.id]));
  });

  it('Raquel abre el chat de G1; el de G3, 403 FUERA_DE_TU_EQUIPO. Daniela, el de G3 sí', async () => {
    expect(await objetivo(RAQUEL, G1.id)).toBe(G1.id);
    await expect(objetivo(RAQUEL, G3.id)).rejects.toMatchObject({ statusCode: 403, code: 'FUERA_DE_TU_EQUIPO' });
    expect(await objetivo(DANIELA, G3.id)).toBe(G3.id);
  });
});

describe('5. La pantalla: /auth/me y los desplegables de gestora', () => {
  const me = async (u) => ok(await request.get('/api/auth/me').set(como(u)));
  const lista = async (u, extra = '') => ok(await request.get(`/api/users?limit=100&projectId=${P}${extra}`).set(como(u)))
    .map((x) => Number(x.id));

  it('/auth/me: Raquel lleva equipo y dice su alcance; Daniela y una gestora, no', async () => {
    const r = await me(RAQUEL);
    expect(r.user.lleva_equipo).toBe(true);
    expect([...r.alcance_comercial].sort()).toEqual([RAQUEL.id, G1.id, G2.id].sort());
    for (const u of [DANIELA, G1]) {
      const d = await me(u);
      expect(d.user.lleva_equipo).toBe(false);
      expect(d.alcance_comercial).toBeNull();
    }
  });

  it('GET /api/users?alcance=comercial: Raquel, ella y su equipo; Daniela, todo; sin el parámetro, como siempre', async () => {
    const deRaquel = await lista(RAQUEL, '&alcance=comercial');
    expect(deRaquel.sort()).toEqual([RAQUEL.id, G1.id, G2.id].sort());
    expect(await lista(DANIELA, '&alcance=comercial')).toEqual(expect.arrayContaining([G3.id, RAQUEL.id]));
    expect(await lista(RAQUEL)).toEqual(expect.arrayContaining([G3.id, DANIELA.id]));
  });

  it('un valor desconocido de alcance, 400', async () => {
    const r = await request.get('/api/users?alcance=todo').set(como(RAQUEL));
    expect(r.status).toBe(400);
  });
});

describe('extra: repartir una venta (GET/PUT /api/conversions/:id/reparto)', () => {
  const candidatas = async (u) => ok(await request.get(`/api/conversions/${V.L1}/reparto`).set(como(u)))
    .candidatas.map((c) => Number(c.id));

  it('Raquel: las candidatas son ella y su equipo; Daniela, todo el campus', async () => {
    const deRaquel = await candidatas(RAQUEL);
    expect(deRaquel).toEqual(expect.arrayContaining([RAQUEL.id, G1.id, G2.id]));
    expect(deRaquel).not.toContain(G3.id);
    expect(await candidatas(DANIELA)).toEqual(expect.arrayContaining([G3.id]));
  });

  it('Raquel no le da a G3 (de fuera) parte de una venta de su equipo: 403 y no se guarda', async () => {
    const r = await request.put(`/api/conversions/${V.L1}/reparto`).set(como(RAQUEL))
      .send({ partes: [{ user_id: G1.id, porcentaje: 50 }, { user_id: G3.id, porcentaje: 50 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('FUERA_DE_TU_EQUIPO');
    expect(await q('SELECT 1 FROM conversion_vendedoras WHERE conversion_id = $1', [V.L1])).toHaveLength(0);
  });
});

describe('extra: comisiones del equipo y registro de actividad', () => {
  const comisiones = async (u, extra = '') => ok(await request.get(`/api/commissions?projectId=${P}${extra}`).set(como(u)))
    .map((c) => Number(c.user_id));
  const actividad = async (u) => ok(await request.get(`/api/users/activity-log?search=${MARCA}&limit=500`).set(como(u)))
    .map((a) => Number(a.user_id));

  it('comisiones: Raquel, las de su equipo (pedir a G3 no ensancha); Daniela, todas', async () => {
    expect(await comisiones(RAQUEL)).toEqual([G1.id]);
    expect(await comisiones(RAQUEL, `&userId=${G3.id}`)).toEqual([G1.id]);
    expect((await comisiones(DANIELA)).sort()).toEqual([G1.id, G3.id].sort());
  });

  it('totales de comisiones: Raquel, los de su equipo; Daniela, los de todas', async () => {
    const t = async (u) => ok(await request.get(`/api/commissions/stats?projectId=${P}`).set(como(u)));
    expect(Number((await t(RAQUEL)).total)).toBe(10);
    expect(Number((await t(DANIELA)).total)).toBe(20);
  });

  it('actividad: Raquel no ve la de G3; Daniela sí', async () => {
    const deRaquel = await actividad(RAQUEL);
    expect(deRaquel).toContain(G1.id);
    expect(deRaquel).not.toContain(G3.id);
    expect(await actividad(DANIELA)).toEqual(expect.arrayContaining([G1.id, G3.id]));
  });
});

describe('6. Sin escalada: la líder no se da equipos.gestionar ni toca su equipo', () => {
  const equipoDeRaquel = async () => (await q(
    'SELECT gestora_id FROM equipo_comercial WHERE lider_id = $1 ORDER BY gestora_id', [RAQUEL.id])).map((f) => f.gestora_id);
  const excepcionDe = (u) => q(
    `SELECT 1 FROM user_permission_overrides WHERE user_id = $1 AND resource = 'equipos' AND action = 'gestionar'`, [u.id]);

  it('a sí misma, por excepción: 403', async () => {
    const r = await request.put(`/api/permissions/personas/${RAQUEL.id}/excepciones`).set(como(RAQUEL))
      .send({ cambios: { 'equipos.gestionar': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(await excepcionDe(RAQUEL)).toHaveLength(0);
  });

  it('a una gestora suya, por excepción o por la clave: 403 / 400 (no da lo que no tiene)', async () => {
    const r = await request.put(`/api/permissions/personas/${G1.id}/excepciones`).set(como(RAQUEL))
      .send({ cambios: { 'equipos.gestionar': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('NO_LO_TIENES');
    const c = await request.put(`/api/permissions/claves/equipos.gestionar/personas/${G1.id}`).set(como(RAQUEL))
      .send({ permitido: true });
    expect([400, 403]).toContain(c.status);
    expect(await excepcionDe(G1)).toHaveLength(0);
  });

  it('cambiar su propio equipo: 403 y el equipo sigue igual', async () => {
    const antes = await equipoDeRaquel();
    const r = await request.put(`/api/users/${RAQUEL.id}/equipo-comercial`).set(como(RAQUEL))
      .send({ gestoraIds: [G1.id, G2.id, G3.id] });
    expect(r.status).toBe(403);
    expect(await equipoDeRaquel()).toEqual(antes);
  });

  it('subirse el rol a super admin o a soporte: rechazado y sigue siendo admin', async () => {
    // superadmin ni siquiera pasa la validación (400); soporte lo da el super admin (403).
    const r = await request.patch(`/api/users/${RAQUEL.id}`).set(como(RAQUEL)).send({ role: 'superadmin' });
    expect([400, 403], JSON.stringify(r.body)).toContain(r.status);
    const s = await request.patch(`/api/users/${RAQUEL.id}`).set(como(RAQUEL)).send({ roles_extra: ['soporte'] });
    expect(s.status, JSON.stringify(s.body)).toBe(403);
    const [u] = await q('SELECT role::text AS role FROM users WHERE id = $1', [RAQUEL.id]);
    expect(u.role).toBe('admin');
  });
});
