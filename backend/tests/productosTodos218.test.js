import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #218, tanda 4 · Productos, WooCommerce y el Árbol de categorías con «Todos» o
 * una empresa (Diego, 04/11/2026): todos sus campus juntos, con su «Campus».
 *
 *   GET /api/products/ambito            el catálogo de los campus de quien pide
 *   GET /api/product-categories/ambito  el árbol de cada uno
 *   GET /api/woocommerce/estado         la tienda de cada uno, solo para ver
 *
 * Cada uno ve SUS campus; nunca una clave de WooCommerce.
 *
 *   npx vitest run tests/productosTodos218.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const modulos = await Promise.all(['products', 'product-categories', 'woocommerce']
  .map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `PRO${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], productos: [], categorias: [] };
let CEDIA; let PSIKO; let FONO; let ICT; let ADMIN; let SUPER; let GESTORA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));
const campusDe = (res) => [...new Set(res.body.data.map((c) => c.project_id ?? c.id))];

beforeAll(async () => {
  const empresa = async (n) => { const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${n}`, `B${n}${Date.now().toString().slice(-6)}`]); ids.issuers.push(e.id); return e.id; };
  const campus = async (n, issuer) => { const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`, [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`, issuer]); ids.projects.push(p.id); return p.id; };
  CEDIA = await empresa('cedia');
  const ictess = await empresa('ictess');
  PSIKO = await campus('psiko', CEDIA); FONO = await campus('fono', CEDIA); ICT = await campus('ict', ictess);
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`, [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  ADMIN = await persona('admin', 'admin', [PSIKO, FONO]);
  SUPER = await persona('super', 'superadmin', []);
  GESTORA = await persona('gestora', 'gestor', [PSIKO]);
  // Un producto y una categoría en cada campus; WooCommerce solo en PSIKO.
  for (const c of [PSIKO, FONO, ICT]) {
    const cat = await one(`INSERT INTO product_categories (project_id, nombre) VALUES ($1, $2) RETURNING id`, [c, `${MARCA} cat ${c}`]);
    ids.categorias.push(cat.id);
    const p = await one(`INSERT INTO products (project_id, nombre, categoria_id, active) VALUES ($1, $2, $3, true) RETURNING id`, [c, `${MARCA} curso ${c}`, cat.id]);
    ids.productos.push(p.id);
  }
  await q(`INSERT INTO wc_credentials (project_id, store_url, consumer_key, consumer_secret) VALUES ($1, 'https://tienda.secreta', 'ck_secreto', 'cs_secreto')`, [PSIKO]);
  await q(`INSERT INTO wc_import_runs (project_id, status, total_fetched, finished_at) VALUES ($1, 'success', 12, NOW())`, [PSIKO]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM wc_import_runs WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM wc_credentials WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM products WHERE id = ANY($1::int[])', [ids.productos]);
  await q('DELETE FROM product_categories WHERE id = ANY($1::int[])', [ids.categorias]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
});

describe('#218 · el catálogo de todos sus campus', () => {
  it('un admin ve los productos de sus campus, cada uno con su campus', async () => {
    const res = await pedir(ADMIN, '/api/products/ambito');
    expect(res.status).toBe(200);
    const mios = res.body.data.filter((p) => p.nombre.startsWith(MARCA));
    expect(campusDe({ body: { data: mios } }).sort()).toEqual([PSIKO, FONO].sort());
    expect(mios.find((p) => p.project_id === PSIKO).proyecto_nombre).toBe(`${MARCA} psiko`);
  });

  it('el campus de otra empresa no se cuela ni pidiéndolo', async () => {
    const res = await pedir(ADMIN, `/api/products/ambito?projectIds=${ICT}`);
    expect(res.body.data.some((p) => p.project_id === ICT)).toBe(false);
  });

  it('con una empresa, los de esa empresa; el superadmin, también los de otras', async () => {
    const conEmpresa = await pedir(ADMIN, `/api/products/ambito?issuerId=${CEDIA}`);
    expect(campusDe(conEmpresa).every((c) => [PSIKO, FONO].includes(c))).toBe(true);
    const todo = await pedir(SUPER, '/api/products/ambito');
    expect(campusDe(todo)).toEqual(expect.arrayContaining([PSIKO, FONO, ICT]));
  });

  it('`/:id` sigue siendo un producto: «ambito» no se confunde con un id', async () => {
    const res = await pedir(ADMIN, `/api/products/${ids.productos[0]}?projectId=${PSIKO}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ids.productos[0]);
  });

  it('la lista de un campus sigue igual, ahora con el nombre del campus', async () => {
    const res = await pedir(ADMIN, `/api/products?projectId=${PSIKO}`);
    expect(res.body.data.every((p) => p.project_id === PSIKO)).toBe(true);
  });
});

describe('#218 · el árbol de categorías de cada campus', () => {
  it('uno por campus, con su nombre y sus categorías', async () => {
    const res = await pedir(ADMIN, '/api/product-categories/ambito');
    expect(res.status).toBe(200);
    expect(campusDe(res).sort()).toEqual([PSIKO, FONO].sort());
    const psiko = res.body.data.find((c) => c.id === PSIKO);
    expect(psiko.nombre).toBe(`${MARCA} psiko`);
    expect(psiko.arbol.map((n) => n.nombre)).toContain(`${MARCA} cat ${PSIKO}`);
  });
});

describe('#218 · WooCommerce de cada campus, solo para ver', () => {
  it('dice si hay tienda y cómo fue la última importación', async () => {
    const res = await pedir(ADMIN, '/api/woocommerce/estado');
    expect(res.status).toBe(200);
    expect(campusDe(res).sort()).toEqual([PSIKO, FONO].sort());
    expect(res.body.data.find((c) => c.id === PSIKO)).toMatchObject({ conectado: true, ultima_estado: 'success', total_fetched: 12 });
    expect(res.body.data.find((c) => c.id === FONO)).toMatchObject({ conectado: false, ultima_estado: null });
  });

  it('nunca saca las claves ni la tienda', async () => {
    const texto = JSON.stringify((await pedir(SUPER, '/api/woocommerce/estado')).body);
    for (const secreto of ['ck_secreto', 'cs_secreto', 'tienda.secreta']) expect(texto).not.toContain(secreto);
  });

  it('sin «Ver WooCommerce», 403', async () => {
    const res = await pedir(GESTORA, '/api/woocommerce/estado');
    expect(res.status).toBe(403);
  });
});
