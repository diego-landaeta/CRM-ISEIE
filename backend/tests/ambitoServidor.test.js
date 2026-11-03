import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Lo de cada uno, también en el servidor (repaso de la #218, 03/11).
 *
 * Antes de que «Todos los proyectos» abra más pantallas, el servidor tiene que
 * recortar a quien pide. Estas rutas aceptaban los campus de cualquiera —o,
 * sin campus, los de todas las empresas—:
 *
 *   · la cola y el seguimiento de fin de mes (`projectIds` sin recortar)
 *   · los informes (`projectId` / `issuerId` sin recortar)
 *   · el embudo y los pendientes de convocatorias
 *   · la cola de revisión de duplicados (y decidir sobre una ajena)
 *   · formularios, Make, secuencias, análisis IA, árbol de categorías,
 *     duplicados, facturación al día, corte de Stripe y WooCommerce entero
 *     (también cambiar sus credenciales): el id de un campus ajeno valía.
 *
 * Super admin y soporte siguen viéndolo todo.
 *
 *   npx vitest run tests/ambitoServidor.test.js
 */

// Los servicios que reciben el ámbito, simulados: se mira QUÉ campus les llega.
const llegan = vi.hoisted(() => ({}));
const apunta = (nombre, devuelve) => vi.fn(async (args) => { llegan[nombre] = args; return devuelve; });
vi.mock('../src/modules/proceso/proceso.service.js', () => ({
  baseDeSeguimiento: apunta('seguimiento', { filas: [], total: 0, formaciones: [] }),
  resumenDeSeguimiento: apunta('resumenSeguimiento', {}),
  resumenDeLaCola: apunta('resumenCola', {}),
}));
vi.mock('../src/modules/convocatorias/convocatoria.service.js', () => ({
  embudo: apunta('embudo', []),
  pendientesDeRespuesta: apunta('pendientes', []),
}));
vi.mock('../src/modules/reports/report.model.js', () => ({ overview: apunta('overview', {}) }));

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { listaDelAmbito } = await import('../src/shared/utils/ambito.js');
const modulos = await Promise.all(['proceso', 'convocatorias', 'reports', 'leads', 'forms', 'woocommerce']
  .map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `AMB${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], cola: [], leads: [] };
let CEDIA; let ICTESS; let PSIKO; let FONO; let ICT; let ADMIN; let SUPER;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));

beforeAll(async () => {
  const empresa = async (n) => { const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${n}`, `B${n}${Date.now().toString().slice(-6)}`]); ids.issuers.push(e.id); return e.id; };
  const campus = async (n, issuer) => { const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`, [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`, issuer]); ids.projects.push(p.id); return p.id; };
  CEDIA = await empresa('cedia'); ICTESS = await empresa('ictess');
  PSIKO = await campus('psiko', CEDIA); FONO = await campus('fono', CEDIA); ICT = await campus('ict', ICTESS);
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`, [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  ADMIN = await persona('admin', 'admin', [PSIKO, FONO]);
  SUPER = await persona('super', 'superadmin', []);
  // Una entrada de la cola de duplicados en cada empresa.
  for (const c of [PSIKO, ICT]) {
    const l = await one(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id`, [c, `${MARCA} dup ${c}`, `dup${c}@${MARCA.toLowerCase()}.test`]);
    ids.leads.push(l.id);
    const e = await one(`INSERT INTO lead_duplicate_review_queue (lead_id, original_lead_id, project_id, source) VALUES ($1, $1, $2, 'webhook') RETURNING id`, [l.id, c]);
    ids.cola.push({ id: e.id, campus: c });
  }
}, 60000);

afterAll(async () => {
  await q('DELETE FROM lead_duplicate_review_queue WHERE id = ANY($1::int[])', [ids.cola.map((x) => x.id)]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('listaDelAmbito: la regla, en un sitio', () => {
  const req = (user, query) => ({ user: { userId: user.id, role: user.role }, query });
  it('sin pedir nada: sus campus (super admin, todo)', async () => {
    expect((await listaDelAmbito(req(ADMIN, {}))).sort()).toEqual([PSIKO, FONO].sort());
    expect(await listaDelAmbito(req(SUPER, {}))).toBeNull();
  });
  it('projectIds ajenos se caen; si no queda ninguno, nada (nunca «todos»)', async () => {
    expect(await listaDelAmbito(req(ADMIN, { projectIds: `${PSIKO},${ICT}` }))).toEqual([PSIKO]);
    expect(await listaDelAmbito(req(ADMIN, { projectIds: `${ICT}` }))).toEqual([-1]);
  });
  it('la empresa de otro: nada; un campus ajeno: 403', async () => {
    expect(await listaDelAmbito(req(ADMIN, { issuerId: ICTESS }))).toEqual([-1]);
    await expect(listaDelAmbito(req(ADMIN, { projectId: ICT }))).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('las fugas, cerradas', () => {
  it('seguimiento y cola: ni pidiendo los campus de ICTESS, ni sin pedir nada', async () => {
    expect((await pedir(ADMIN, `/api/proceso/seguimiento/resumen?projectIds=${ICT}`)).status).toBe(200);
    expect(llegan.resumenSeguimiento.projectIds).toEqual([-1]);
    await pedir(ADMIN, '/api/proceso/cola/resumen');
    expect(llegan.resumenCola.projectIds.sort()).toEqual([PSIKO, FONO].sort());
    await pedir(ADMIN, `/api/proceso/seguimiento?projectIds=${PSIKO},${ICT}`);
    expect(llegan.seguimiento.projectIds).toEqual([PSIKO]);
  });

  it('informes: la empresa de otro, nada; un campus ajeno, 403; sin pedir, los suyos', async () => {
    await pedir(ADMIN, `/api/informes/overview?issuerId=${ICTESS}`);
    expect(llegan.overview.projectIds).toEqual([-1]);
    expect((await pedir(ADMIN, `/api/informes/overview?projectId=${ICT}`)).status).toBe(403);
    await pedir(ADMIN, '/api/informes/overview');
    expect(llegan.overview.projectIds.sort()).toEqual([PSIKO, FONO].sort());
    await pedir(SUPER, '/api/informes/overview');
    expect(llegan.overview.projectIds).toBeNull();
  });

  it('convocatorias: embudo y pendientes, de sus campus', async () => {
    await pedir(ADMIN, '/api/convocatorias/embudo');
    expect(llegan.embudo.projectIds.sort()).toEqual([PSIKO, FONO].sort());
    await pedir(ADMIN, `/api/convocatorias/pendientes?projectId=${PSIKO}`);
    expect(llegan.pendientes.projectIds).toEqual([PSIKO]);
  });

  it('cola de duplicados: solo la suya, y la ajena no se puede decidir', async () => {
    const r = await pedir(ADMIN, '/api/leads/review-queue?status=pending');
    expect(r.status).toBe(200);
    const campus = r.body.data.map((x) => Number(x.project_id));
    expect(campus).toContain(PSIKO);
    expect(campus).not.toContain(ICT);
    const ajena = ids.cola.find((x) => x.campus === ICT).id;
    const d = await request.post(`/api/leads/review-queue/${ajena}/decide`).set(como(ADMIN)).send({ action: 'reject' });
    expect(d.status).toBe(404);
    expect((await one('SELECT status FROM lead_duplicate_review_queue WHERE id = $1', [ajena])).status).toBe('pending');
  });

  it('el id de un campus ajeno ya no vale: formularios y WooCommerce (también escribir)', async () => {
    expect((await pedir(ADMIN, `/api/forms?projectId=${ICT}&kind=form`)).status).toBe(403);
    expect((await pedir(ADMIN, `/api/forms?projectId=${PSIKO}&kind=form`)).status).toBe(200);
    expect((await pedir(ADMIN, `/api/woocommerce/credentials?projectId=${ICT}`)).status).toBe(403);
    const put = await request.put(`/api/woocommerce/credentials?projectId=${ICT}`).set(como(ADMIN)).send({ url: 'https://x.test' });
    expect(put.status).toBe(403);
  });
});
