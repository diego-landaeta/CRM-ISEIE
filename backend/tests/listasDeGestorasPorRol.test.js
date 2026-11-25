import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Las listas de gestoras, rol por rol (Diego, 25/11/2026, máxima prioridad):
 * «a Raquel no le funcionan los filtros de las gestoras al reasignar o filtrar,
 * arregla eso, y que todos los CRM funcionen bien en todos los roles».
 *
 * Lo de Raquel era del frontal (las pantallas solo pedían la lista a un admin);
 * aquí se fija el contrato del servidor del que depende cada pantalla:
 *
 *   · `GET /users?alcance=comercial` (filtro «Gestora» de Prospectos, Ventas,
 *     Clientes, la Cola, Wasapi y «Reasignar»): 200 a quien la pide con
 *     `users.view` o `equipos.su_equipo`, con lo que le toca; 403 al resto, que
 *     tampoco la pide (`veListaDeGestoras` en el frontal: la misma tabla).
 *   · Filtrar Prospectos por una gestora: la líder, dentro de su equipo.
 *   · Reasignar: la líder, a ella o a una de su equipo; fuera, 403.
 *   · La Cola y Reportes de soporte: el campus entero, no «lo suyo» (salían vacíos).
 *
 * Contra la base LOCAL (docker-compose.dev.yml), con las rutas de verdad.
 *
 *   npx vitest run tests/listasDeGestorasPorRol.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
const { asesoraDelInforme } = await import('../src/modules/reports/report.controller.js');
const { deQuienEsLaCola } = await import('../src/modules/proceso/proceso.controller.js');
const modulos = await Promise.all(['users', 'leads', 'sales']
  .map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `LGR${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));
const idsDe = (res) => (res.body.data || []).map((x) => Number(x.id)).sort((a, b) => a - b);

const ROLES = ['superadmin', 'admin', 'lider_equipo', 'gestor', 'soporte', 'project_manager', 'tutor', 'tutor_redactor', 'colaborador'];
// Quién puede PEDIR la lista (el servidor). El frontal además se la calla a quien
// solo ve lo suyo (project manager sin equipo): `veListaDeGestoras`.
const PIDE_LA_LISTA = { superadmin: true, admin: true, lider_equipo: true, soporte: true, project_manager: true };

let A; const P = {}; let G1; let FUERA; let L_G1; let L_FUERA;

beforeAll(async () => {
  A = (await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} a`, `${MARCA.toLowerCase()}-a`, `${MARCA}-k-a`])).id;
  ids.projects.push(A);
  const persona = async (n, role) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role, is_available) VALUES ($1, $2, 'x', $3, true) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, A]);
    return u;
  };
  for (const r of ROLES) P[r] = await persona(r.replace(/_/g, ''), r);
  G1 = await persona('g1', 'gestor');
  FUERA = P.gestor; // otra gestora del campus, de fuera del equipo
  await q('INSERT INTO equipo_comercial (lider_id, gestora_id) VALUES ($1, $2)', [P.lider_equipo.id, G1.id]);
  const lead = async (n, responsable) => {
    const l = await one('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [A, `${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, responsable]);
    ids.leads.push(l.id); return l.id;
  };
  L_G1 = await lead('lg1', G1.id);
  L_FUERA = await lead('lfuera', FUERA.id);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM equipo_comercial WHERE lider_id = ANY($1::int[]) OR gestora_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM lead_assignments_log WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM notifications WHERE target_user_ids && $1::int[]', [ids.users]).catch(() => {});
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('GET /users?alcance=comercial: la lista de los desplegables, rol por rol', () => {
  for (const role of ROLES) {
    it(`${role}: ${PIDE_LA_LISTA[role] ? '200 con lo que le toca' : '403 (y el frontal no la pide)'}`, async () => {
      const r = await pedir(P[role], `/api/users?limit=100&alcance=comercial&projectId=${A}`);
      const mapa = resolverPermisos({ role, roles_extra: [] }).mapa;
      // La misma regla que la ruta: `users.view` o `equipos.su_equipo`.
      const conPermiso = role === 'superadmin' || mapa['users.view'] === true || mapa['equipos.su_equipo'] === true;
      expect(conPermiso).toBe(Boolean(PIDE_LA_LISTA[role]));
      expect(r.status).toBe(PIDE_LA_LISTA[role] ? 200 : 403);
      if (role === 'lider_equipo') {
        // Raquel: ella y su equipo; ni la gestora de fuera ni administración.
        expect(idsDe(r)).toEqual([P.lider_equipo.id, G1.id].sort((a, b) => a - b));
      } else if (PIDE_LA_LISTA[role]) {
        // Quien ve el campus: todas, también la líder (que vende) y la de fuera.
        expect(idsDe(r)).toEqual(expect.arrayContaining([G1.id, FUERA.id, P.lider_equipo.id]));
      }
    });
  }
});

describe('Lo de Raquel: filtrar y reasignar dentro de su equipo', () => {
  it('Prospectos filtrados por una de su equipo: los de ella; por una de fuera, no los de fuera', async () => {
    const lider = P.lider_equipo;
    const suya = await pedir(lider, `/api/leads?projectId=${A}&includeConverted=true&limit=100&responsableId=${G1.id}`);
    expect(suya.status).toBe(200);
    expect(idsDe(suya)).toEqual([L_G1]);
    const fuera = await pedir(lider, `/api/leads?projectId=${A}&includeConverted=true&limit=100&responsableId=${FUERA.id}`);
    expect(fuera.status).toBe(200);
    expect(idsDe(fuera)).not.toContain(L_FUERA);
    // Un admin, cualquiera del campus.
    expect(idsDe(await pedir(P.admin, `/api/leads?projectId=${A}&includeConverted=true&limit=100&responsableId=${FUERA.id}`))).toEqual([L_FUERA]);
  });

  it('Reasignar: a ella o a una de su equipo, sí; a una de fuera, 403', async () => {
    const lider = P.lider_equipo;
    const aElla = await request.patch(`/api/leads/${L_G1}/reassign`).set(como(lider)).send({ responsable_id: lider.id });
    expect(aElla.status).toBe(200);
    const deVuelta = await request.patch(`/api/leads/${L_G1}/reassign`).set(como(lider)).send({ responsable_id: G1.id });
    expect(deVuelta.status).toBe(200);
    const aFuera = await request.patch(`/api/leads/${L_G1}/reassign`).set(como(lider)).send({ responsable_id: FUERA.id });
    expect(aFuera.status).toBe(403);
    expect(aFuera.body.code).toBe('FUERA_DE_TU_EQUIPO');
  });

  it('Ventas por asesora: la líder ve la tabla de su equipo, sin las de fuera', async () => {
    const r = await pedir(P.lider_equipo, `/api/ventas/gestores-stats?projectId=${A}&periodo=all`);
    expect(r.status).toBe(200);
    const personas = (r.body.data?.gestores || []).map((g) => Number(g.user_id));
    expect(personas).not.toContain(FUERA.id);
  });
});

describe('De quién son la Cola y los Reportes, rol por rol', () => {
  const req = (u, query = {}) => ({ user: { userId: u.id, role: u.role, roles_extra: [] }, query });

  it('superadmin, admin y soporte: el campus entero, o la que pidan (soporte salía vacío)', async () => {
    for (const r of ['superadmin', 'admin', 'soporte']) {
      expect(await deQuienEsLaCola(req(P[r])), r).toBeNull();
      expect(await asesoraDelInforme(req(P[r])), r).toBeNull();
      expect(await deQuienEsLaCola(req(P[r], { gestoraId: String(G1.id) })), r).toBe(G1.id);
    }
  });

  it('la líder: ella y su equipo, o una de su equipo; nunca una de fuera', async () => {
    const lider = P.lider_equipo;
    expect(await deQuienEsLaCola(req(lider))).toEqual([lider.id, G1.id]);
    expect(await deQuienEsLaCola(req(lider, { gestoraId: String(G1.id) }))).toEqual([G1.id]);
    expect(await deQuienEsLaCola(req(lider, { gestoraId: String(FUERA.id) }))).toEqual([lider.id, G1.id]);
    expect(await asesoraDelInforme(req(lider, { asesoraId: String(FUERA.id) }))).toEqual([lider.id, G1.id]);
  });

  it('gestora y project manager: solo lo suyo, pidan lo que pidan', async () => {
    for (const r of ['gestor', 'project_manager']) {
      expect(await deQuienEsLaCola(req(P[r], { gestoraId: String(G1.id) })), r).toBe(P[r].id);
      expect(await asesoraDelInforme(req(P[r], { asesoraId: String(G1.id) })), r).toBe(P[r].id);
    }
  });
});
