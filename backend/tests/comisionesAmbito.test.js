import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Las lecturas de comisiones, solo de los campus de quien pide.
 *
 * `GET /api/commissions/rules`, `GET /api/commissions` y
 * `GET /api/commissions/stats` piden `commissions.view`, que de serie trae el
 * admin de empresa. Solo filtraban por el `projectId` de la URL: sin él
 * devolvían las reglas y las comisiones de TODAS las empresas, y con el
 * `projectId` de otra empresa, las de esa. Ahora pasan por `proyectosDelAmbito`
 * como el resto de pantallas de cifras: «todos» son sus campus, una empresa son
 * sus campus de esa empresa y un campus ajeno es un 403. Superadmin y soporte
 * siguen viéndolo todo.
 *
 *   npx vitest run tests/comisionesAmbito.test.js --pool=forks --poolOptions.forks.singleFork=true
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: comisiones } = await import('../src/modules/commissions/index.js');

const app = express();
app.use(express.json());
app.use(comisiones.prefix, comisiones.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CAM${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = (sql, p) => q(sql, p).then((r) => r[0]);
const ids = { users: [], projects: [], leads: [], issuers: [], products: [], conversions: [] };

let MIO; let AJENO; let EMPRESA; let OTRA_EMPRESA;
let SUPER; let SOPORTE; let ADMIN; let GESTORA;
let REGLA_MIA; let REGLA_AJENA; let COM_MIA; let COM_AJENA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

async function comision(projectId, productId, importe) {
  const l = await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
    [projectId, `${MARCA} lead ${projectId}`, `l${projectId}@${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  const cv = await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, $3, 100) RETURNING id`,
    [l.id, projectId, `${MARCA} curso`]);
  ids.conversions.push(cv.id);
  const c = await one(
    `INSERT INTO commissions (conversion_id, user_id, product_id, importe_base, pct, importe_comision)
     VALUES ($1, $2, $3, 100, 10, $4) RETURNING id`,
    [cv.id, GESTORA.id, productId, importe]);
  return c.id;
}

beforeAll(async () => {
  EMPRESA = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} EMPRESA`, `${MARCA}-E`])).id;
  OTRA_EMPRESA = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} OTRA`, `${MARCA}-O`])).id;
  ids.issuers.push(EMPRESA, OTRA_EMPRESA);
  const proy = async (c, issuer) => {
    const p = await one(
      'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`, issuer]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await proy('mio', EMPRESA);
  AJENO = await proy('ajeno', OTRA_EMPRESA);

  SUPER = await persona('Super', 'superadmin');
  SOPORTE = await persona('Soporte', 'soporte');
  ADMIN = await persona('Admin', 'admin', [MIO]);
  GESTORA = await persona('Gestora', 'gestor', [MIO, AJENO]);

  const prod = async (p, n) => {
    const r = await one(`INSERT INTO products (project_id, nombre, precio, moneda, active) VALUES ($1, $2, 100, 'EUR', true) RETURNING id`, [p, `${MARCA} ${n}`]);
    ids.products.push(r.id);
    return r.id;
  };
  const PROD_MIO = await prod(MIO, 'P1');
  const PROD_AJENO = await prod(AJENO, 'P2');
  const regla = (p, prodId) => one(
    `INSERT INTO commission_rules (project_id, user_id, product_id, pct, base_calc) VALUES ($1, $2, $3, 5, 'cobrado') RETURNING id`,
    [p, GESTORA.id, prodId]).then((r) => r.id);
  REGLA_MIA = await regla(MIO, PROD_MIO);
  REGLA_AJENA = await regla(AJENO, PROD_AJENO);
  COM_MIA = await comision(MIO, PROD_MIO, 10);
  COM_AJENA = await comision(AJENO, PROD_AJENO, 1000);
}, 60000);

afterAll(async () => {
  const intenta = (sql, p) => q(sql, p).catch(() => {});
  await intenta('DELETE FROM commissions WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await intenta('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await intenta('DELETE FROM commission_rules WHERE project_id = ANY($1::int[])', [ids.projects]);
  await intenta('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await intenta('DELETE FROM products WHERE id = ANY($1::int[])', [ids.products]);
  await intenta('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await intenta('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

const idsDe = (r) => r.body.data.map((x) => x.id);

describe('GET /api/commissions/rules', () => {
  it('un admin de empresa ve solo las reglas de sus campus', async () => {
    const r = await request.get('/api/commissions/rules').set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(idsDe(r)).toContain(REGLA_MIA);
    expect(idsDe(r)).not.toContain(REGLA_AJENA);
  });

  it('pedir el campus de otra empresa es un 403', async () => {
    const r = await request.get(`/api/commissions/rules?projectId=${AJENO}`).set(como(ADMIN));
    expect(r.status).toBe(403);
  });

  it('pedir la otra empresa no le enseña nada', async () => {
    const r = await request.get(`/api/commissions/rules?issuerId=${OTRA_EMPRESA}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(idsDe(r)).not.toContain(REGLA_AJENA);
  });

  it('superadmin y soporte ven las de todas', async () => {
    for (const u of [SUPER, SOPORTE]) {
      const r = await request.get('/api/commissions/rules').set(como(u));
      expect(idsDe(r)).toEqual(expect.arrayContaining([REGLA_MIA, REGLA_AJENA]));
    }
  });
});

describe('GET /api/commissions y /api/commissions/stats', () => {
  it('la lista del admin de empresa, solo de sus campus', async () => {
    const r = await request.get('/api/commissions').set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(idsDe(r)).toContain(COM_MIA);
    expect(idsDe(r)).not.toContain(COM_AJENA);
    expect((await request.get(`/api/commissions?projectId=${AJENO}`).set(como(ADMIN))).status).toBe(403);
  });

  it('las cifras del admin de empresa no suman las de otra empresa', async () => {
    const r = await request.get(`/api/commissions/stats?userId=${GESTORA.id}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(Number(r.body.data.total)).toBe(10);
    expect(Number(r.body.data.cantidad)).toBe(1);
    expect((await request.get(`/api/commissions/stats?projectId=${AJENO}`).set(como(ADMIN))).status).toBe(403);
  });

  it('superadmin y soporte, todo', async () => {
    for (const u of [SUPER, SOPORTE]) {
      expect(idsDe(await request.get('/api/commissions').set(como(u)))).toEqual(expect.arrayContaining([COM_MIA, COM_AJENA]));
      const s = await request.get(`/api/commissions/stats?userId=${GESTORA.id}`).set(como(u));
      expect(Number(s.body.data.total)).toBe(1010);
    }
  });
});
