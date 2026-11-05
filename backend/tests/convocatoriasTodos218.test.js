import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #218, tanda 4 · Convocatorias con «Todos» o una empresa (Diego, 04/11/2026):
 * todos sus campus juntos, cada convocatoria y cada pendiente con su campus.
 *
 *   GET /api/convocatorias/ambito   las de los campus de quien pide
 *   GET /api/convocatorias/pendientes  (ya recortaba, #620) ahora con su campus
 *
 * Crear sigue siendo de UN campus (`/` y `POST /` con `projectAccess`).
 *
 *   npx vitest run tests/convocatoriasTodos218.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/convocatorias/index.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CNV${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], convocatorias: [], leads: [], ofrecimientos: [] };
let CEDIA; let PSIKO; let FONO; let ICT; let ADMIN; let SUPER;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));
const mias = (res) => res.body.data.filter((c) => String(c.nombre || c.convocatoria || '').startsWith(MARCA));
const campusDe = (filas) => [...new Set(filas.map((c) => c.project_id))].sort();

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
  // Una convocatoria en cada campus, y en cada uno alguien que espera respuesta hoy.
  for (const c of [PSIKO, FONO, ICT]) {
    const cv = await one(`INSERT INTO convocatorias (project_id, nombre, tope_nueva, tope_habilitada) VALUES ($1, $2, 40, 70) RETURNING id`, [c, `${MARCA} beca ${c}`]);
    ids.convocatorias.push(cv.id);
    const l = await one(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id`, [c, `${MARCA} alumna ${c}`, `al${c}@${MARCA.toLowerCase()}.test`]);
    ids.leads.push(l.id);
    const o = await one(`INSERT INTO convocatoria_ofrecimientos (convocatoria_id, lead_id, project_id, fecha_resultado) VALUES ($1, $2, $3, CURRENT_DATE) RETURNING id`, [cv.id, l.id, c]);
    ids.ofrecimientos.push(o.id);
  }
}, 60000);

afterAll(async () => {
  await q('DELETE FROM convocatoria_ofrecimientos WHERE id = ANY($1::int[])', [ids.ofrecimientos]);
  await q('DELETE FROM convocatorias WHERE id = ANY($1::int[])', [ids.convocatorias]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
});

describe('#218 · GET /convocatorias/ambito', () => {
  it('con «Todos», un admin ve las de sus campus, cada una con su campus', async () => {
    const res = await pedir(ADMIN, '/api/convocatorias/ambito');
    expect(res.status).toBe(200);
    expect(campusDe(mias(res))).toEqual([PSIKO, FONO].sort());
    expect(mias(res).find((c) => c.project_id === PSIKO).proyecto_nombre).toBe(`${MARCA} psiko`);
  });

  it('con una empresa, las de esa empresa que son suyas', async () => {
    const res = await pedir(ADMIN, `/api/convocatorias/ambito?issuerId=${CEDIA}`);
    expect(campusDe(mias(res))).toEqual([PSIKO, FONO].sort());
  });

  it('el campus de otra empresa no se cuela ni pidiéndolo', async () => {
    const res = await pedir(ADMIN, `/api/convocatorias/ambito?projectIds=${ICT}`);
    expect(mias(res).some((c) => c.project_id === ICT)).toBe(false);
  });

  it('el superadmin ve también las de otras empresas', async () => {
    const res = await pedir(SUPER, '/api/convocatorias/ambito');
    expect(campusDe(mias(res))).toEqual([PSIKO, FONO, ICT].sort());
  });

  it('la lista de un campus sigue pidiendo su campus', async () => {
    expect((await pedir(ADMIN, '/api/convocatorias')).status).toBe(400);
    const res = await pedir(ADMIN, `/api/convocatorias?projectId=${PSIKO}`);
    expect(campusDe(mias(res))).toEqual([PSIKO]);
  });
});

describe('#218 · los pendientes, con su campus', () => {
  it('cada pendiente dice de qué campus es, y solo los de quien mira', async () => {
    const res = await pedir(ADMIN, '/api/convocatorias/pendientes');
    expect(res.status).toBe(200);
    const suyos = res.body.data.filter((p) => String(p.lead_nombre || '').startsWith(MARCA));
    expect(campusDe(suyos)).toEqual([PSIKO, FONO].sort());
    expect(suyos.find((p) => p.project_id === FONO).proyecto_nombre).toBe(`${MARCA} fono`);
  });
});
