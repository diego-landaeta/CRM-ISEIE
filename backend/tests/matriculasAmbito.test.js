import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Una matrícula, solo para quien trabaja en su campus (IDOR de `/api/matriculas`).
 *
 * Antes, ver, editar, borrar, cambiar de estado o subir un documento de una
 * matrícula trabajaba con el id de la URL sin mirar el campus, y el listado
 * aceptaba cualquier `projectId`: la matrícula de otro campus, con su DNI,
 * estaba a un número de distancia.
 *
 *   npx vitest run tests/matriculasAmbito.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/matriculas/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MAM${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [], matriculas: [] };
let P; let OTRO; let SUPER; let ADMIN; let ADMIN_OTRO; let GESTORA; let GESTORA_OTRO; let MATRICULA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  GESTORA = await persona('GESTORA', 'gestor', [P]);
  GESTORA_OTRO = await persona('GESTORAOTRO', 'gestor', [OTRO]);
  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, $2, $3, '+34600111222') RETURNING id`,
    [P, `${MARCA} Ana`, `ana@lead.${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion) VALUES ($1, $2, 'x', 500, 0, CURRENT_DATE) RETURNING id`,
    [l.id, P]);
  ids.conversions.push(v.id);
  const [m] = await q(`INSERT INTO matriculas (project_id, conversion_id, lead_id, dni) VALUES ($1, $2, $3, '12345678Z') RETURNING id`, [P, v.id, l.id]);
  MATRICULA = m.id; ids.matriculas.push(m.id);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM matriculas WHERE id = ANY($1::int[])`, [ids.matriculas]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('quien sí', () => {
  it.each([['superadmin', () => SUPER], ['admin del campus', () => ADMIN], ['gestora del campus', () => GESTORA]])('%s la ve y la lista', async (_n, quien) => {
    expect((await request.get(`/api/matriculas/${MATRICULA}`).set(como(quien()))).status).toBe(200);
    const l = await request.get(`/api/matriculas?projectId=${P}`).set(como(quien()));
    expect(l.status).toBe(200);
    expect(l.body.data.map((m) => m.id)).toContain(MATRICULA);
  });
});

describe('quien no', () => {
  it.each([['un admin de otro campus', () => ADMIN_OTRO], ['una gestora de otro campus', () => GESTORA_OTRO]])('%s: 403 al leer, listar y escribir', async (_n, quien) => {
    const h = como(quien());
    const intentos = [
      request.get(`/api/matriculas/${MATRICULA}`).set(h),
      request.get(`/api/matriculas?projectId=${P}`).set(h),
      request.patch(`/api/matriculas/${MATRICULA}`).set(h).send({ dni: '00000000T' }),
      request.post(`/api/matriculas/${MATRICULA}/estado`).set(h).send({ estado: 'validada' }),
      request.delete(`/api/matriculas/${MATRICULA}`).set(h),
      request.post('/api/matriculas').set(h).send({ project_id: P, conversion_id: ids.conversions[0], lead_id: ids.leads[0] }),
    ];
    for (const r of await Promise.all(intentos)) expect(r.status).toBe(403);
    const [m] = await q(`SELECT dni, estado FROM matriculas WHERE id = $1`, [MATRICULA]);
    expect(m).toEqual({ dni: '12345678Z', estado: 'pendiente' });
  });

  it('una matrícula que no existe sigue siendo 404 y un id que no es número, no es 403', async () => {
    expect((await request.get('/api/matriculas/999999999').set(como(ADMIN))).status).toBe(404);
    expect((await request.get('/api/matriculas/abc').set(como(ADMIN))).status).not.toBe(403);
  });

  it('la descarga firmada sigue sin pedir sesión: sin firma, 403 por la firma y no por el campus', async () => {
    const r = await request.get(`/api/matriculas/${MATRICULA}/doc/dni`);
    expect(r.status).toBe(403);
    expect(r.body.code).not.toBe('UNAUTHORIZED');
  });
});

/**
 * Un id que NO es un entero limpio no puede colarse: la guarda hacía `next()` con todo lo que no
 * era un entero («ya responderá el controlador»), y el controlador usa `parseInt`.
 * `GET|PATCH /api/matriculas/7.5` devolvía (con el DNI) y cambiaba la matrícula 7 de otro campus
 * con un 200. Y `Number('7e1')` (70) frente a `parseInt('7e1')` (7) hacía que la guarda y el
 * controlador miraran matrículas distintas. Solo entran dígitos canónicos; lo demás es un 400.
 */
describe('un id que no es un entero limpio', () => {
  const sucios = (id) => [`${id}.5`, `${id}.0`, `${id}e0`, `+${id}`, `0${id}`, `${id}%20`];

  it('en lecturas: 400 para quien no tiene acceso (antes, 200 con el DNI de la matrícula ajena)', async () => {
    for (const quien of [ADMIN_OTRO, GESTORA_OTRO]) {
      for (const f of sucios(MATRICULA)) {
        const r = await request.get(`/api/matriculas/${f}`).set(como(quien));
        expect(r.status, `GET ${f}`).toBe(400);
        expect(JSON.stringify(r.body)).not.toContain('dni');
      }
    }
  });

  it('en escrituras: 400 y no se toca nada', async () => {
    const h = como(ADMIN_OTRO);
    const antes = (await q(`SELECT dni, estado FROM matriculas WHERE id = $1`, [MATRICULA]))[0];
    const intentos = [
      request.patch(`/api/matriculas/${MATRICULA}.5`).set(h).send({ dni: '00000000T' }),
      request.post(`/api/matriculas/${MATRICULA}.5/estado`).set(h).send({ estado: 'validada' }),
      request.delete(`/api/matriculas/${MATRICULA}.5`).set(h),
    ];
    for (const r of await Promise.all(intentos)) expect(r.status).toBe(400);
    expect((await q(`SELECT dni, estado FROM matriculas WHERE id = $1`, [MATRICULA]))[0]).toEqual(antes);
  });

  it('control: con el id limpio, el ajeno sigue en 403 y el dueño entra', async () => {
    expect((await request.get(`/api/matriculas/${MATRICULA}`).set(como(ADMIN_OTRO))).status).toBe(403);
    expect((await request.get(`/api/matriculas/${MATRICULA}`).set(como(ADMIN))).status).toBe(200);
  });

  it('la descarga firmada no se ve afectada: sin sesión, la protege su firma', async () => {
    const r = await request.get(`/api/matriculas/${MATRICULA}.5/doc/dni`);
    expect(r.status).not.toBe(200);
    expect(r.body.code).not.toBe('UNAUTHORIZED');
  });
});
