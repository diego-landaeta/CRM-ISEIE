import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #591 · Facturas de colaboradores desde el buscador (Ctrl K):
 * `GET /api/facturas-colaborador/facturas?vista=historial&q=`.
 *
 * Por número de factura, de recepción, colaborador (sin acentos) o su correo; y
 * cada admin solo las de las empresas de sus campus, como la pantalla.
 *
 *   npx vitest run tests/buscarFacturasColaborador591.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/facturas-colaborador/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `BFC${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const E = {}; const P = {}; const U = {}; const F = {}; const C = [];

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const buscar = (u, texto) => request.get(`/api/facturas-colaborador/facturas?vista=historial&q=${encodeURIComponent(texto)}`).set(como(u));
const idsDe = (r) => r.body.data.facturas.map((f) => f.id);

async function persona(clave, role, campus = []) {
  U[clave] = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${clave}`, `${clave}@${MARCA.toLowerCase()}.test`, role]);
  for (const p of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [U[clave].id, p.id]);
}

async function factura(clave, nombre, empresa, numero) {
  const c = await one(`INSERT INTO colaboradores (nombre, email, area) VALUES ($1, $2, 'seo') RETURNING id`,
    [`${MARCA} ${nombre}`, `${clave}@${MARCA.toLowerCase()}.test`]);
  C.push(c.id);
  await q('INSERT INTO colaborador_empresas (colaborador_id, issuer_id) VALUES ($1, $2)', [c.id, empresa.id]);
  F[clave] = (await one(
    `INSERT INTO facturas_colaborador (colaborador_id, issuer_id, periodo, subida_at, numero_recepcion, importe, numero_factura)
     VALUES ($1, $2, '2026-04-01', NOW(), $3, 500, $4) RETURNING id`,
    [c.id, empresa.id, `REC-${MARCA}-${C.length}`, numero])).id;
}

beforeAll(async () => {
  await q('CREATE EXTENSION IF NOT EXISTS unaccent');
  for (const k of ['A', 'B']) {
    E[k] = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id',
      [`${MARCA}${k} Empresa`, `B${k}${Date.now().toString().slice(-7)}`]);
    P[k] = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} Campus ${k}`, `${MARCA.toLowerCase()}-${k.toLowerCase()}`, `${MARCA}-key-${k}`, E[k].id]);
  }
  await persona('super', 'superadmin');
  await persona('adminA', 'admin', [P.A]);
  await persona('gestora', 'gestor', [P.A]);
  await factura('ines', 'Inés Muñoz', E.A, `${MARCA}-0041`);
  await factura('raul', 'Raúl Peña', E.B, `${MARCA}-0042`);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM facturas_colaborador WHERE colaborador_id = ANY($1::int[])', [C]);
  await q('DELETE FROM colaborador_empresas WHERE colaborador_id = ANY($1::int[])', [C]);
  await q('DELETE FROM colaboradores WHERE id = ANY($1::int[])', [C]);
  const ids = Object.values(U).map((u) => u.id);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [Object.values(P).map((p) => p.id)]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [Object.values(E).map((e) => e.id)]);
  await pool.end();
}, 60000);

describe('buscar una factura de colaborador', () => {
  it('por el colaborador, sin acentos', async () => {
    const r = await buscar(U.super, `${MARCA} ines munoz`);
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual([F.ines]);
  });

  it('por su número de factura y por su correo', async () => {
    expect(idsDe(await buscar(U.super, `${MARCA}-0042`))).toEqual([F.raul]);
    expect(idsDe(await buscar(U.super, `raul@${MARCA.toLowerCase()}`))).toEqual([F.raul]);
  });

  it('un admin, solo las de las empresas de sus campus', async () => {
    expect(idsDe(await buscar(U.adminA, MARCA))).toEqual([F.ines]);
  });

  it('sin facturas_colaborador.ver_todas (una gestora): 403', async () => {
    expect((await buscar(U.gestora, MARCA)).status).toBe(403);
  });

  it('sin texto, la pestaña de siempre (no cambia nada)', async () => {
    const r = await request.get('/api/facturas-colaborador/facturas?vista=historial').set(como(U.adminA));
    expect(r.status).toBe(200);
    expect(idsDe(r)).toContain(F.ines);
  });
});
