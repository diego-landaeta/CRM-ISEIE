import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * El baremo de la tasa de cierre (#39): qué significa «un 8,2 %».
 *
 * Lo que se defiende:
 *   · los tramos viven en la base y se cambian desde la API; sin ninguno, la tasa
 *     NO se etiqueta (nadie ha dicho cuánto es poco) y la gestora se compara con el equipo;
 *   · la lectura de una tasa es el último tramo que no la supera;
 *   · un tramo siempre empieza en 0, no se repiten puntos de partida y hay un tope;
 *   · un campus puede tener el suyo, que manda sobre el general; el general solo lo toca un super admin;
 *   · un admin solo cambia el baremo de SUS campus; leerlo, cualquiera.
 *
 *   npx vitest run tests/baremoTasaCierre.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: informes } = await import('../src/modules/reports/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { lecturaDe, validarTramos } = await import('../src/modules/reports/tasaBaremo.js');

const app = express();
app.use(express.json());
app.use(informes.prefix, informes.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `BAR${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [] };
let P; let OTRO; let SUPER; let ADMIN; let LAURA; let ANA;
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const como = (u) => ({ Authorization: `Bearer ${jwtDe(u)}` });
const TRAMOS = [
  { desde_pct: 0, etiqueta: 'Flojo', tono: 'flojo' },
  { desde_pct: 5, etiqueta: 'Normal', tono: 'normal' },
  { desde_pct: 10, etiqueta: 'Bueno', tono: 'bueno' },
];
const RANGO = 'from=2026-01-01&to=2026-12-31';

async function persona(nombre, role, campus) {
  const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
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
  SUPER = await persona('SUPER', 'superadmin', []);
  ADMIN = await persona('ADMIN', 'admin', [P]);
  LAURA = await persona('LAURA', 'gestor', [P]);
  ANA = await persona('ANA', 'gestor', [P]);

  // Laura: 4 prospectos, 1 compra (25 %). Ana: 4 prospectos, 0 compras. Equipo: 1 de 8 = 12,5 %.
  const lead = async (nombre, responsable) => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, responsable_id, created_at, fecha_solicitud) VALUES ($1, $2, $3, '2026-03-10', '2026-03-10') RETURNING id`,
      [P, `${MARCA} ${nombre}`, responsable]);
    ids.leads.push(l.id);
    return l.id;
  };
  const l1 = await lead('L1', LAURA.id);
  for (const n of ['L2', 'L3', 'L4']) await lead(n, LAURA.id);
  for (const n of ['A1', 'A2', 'A3', 'A4']) await lead(n, ANA.id);
  const [c] = await q(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion)
    VALUES ($1, $2, 'x', 500, 500, $3, '2026-03-15') RETURNING id`, [l1, P, LAURA.id]);
  ids.conversions.push(c.id);
  await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 500, '2026-03-15')`, [c.id]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM tasa_cierre_baremo WHERE project_id = ANY($1::int[]) OR updated_by = ANY($2::int[])`, [ids.projects, ids.users]);
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

// El baremo general es de todo el CRM: lo que haya antes y después se respeta.
let generalAntes = [];
beforeAll(async () => { generalAntes = await q(`SELECT project_id, desde_pct, etiqueta, tono, updated_by FROM tasa_cierre_baremo WHERE project_id IS NULL`); });
beforeEach(async () => { await q(`DELETE FROM tasa_cierre_baremo WHERE project_id = ANY($1::int[]) OR project_id IS NULL`, [ids.projects]); });
afterAll(async () => {
  for (const t of generalAntes) await q(`INSERT INTO tasa_cierre_baremo (project_id, desde_pct, etiqueta, tono, updated_by) VALUES (NULL, $1, $2, $3, $4) ON CONFLICT DO NOTHING`, [t.desde_pct, t.etiqueta, t.tono, t.updated_by]);
});

const tasa = (u, extra = '') => request.get(`/api/informes/tasa-cierre?projectId=${P}&${RANGO}${extra}`).set(como(u));
const guardar = (u, cuerpo) => request.put('/api/informes/tasa-cierre/baremo').set(como(u)).send(cuerpo);

describe('la lectura de una tasa', () => {
  it('es el último tramo que no la supera, con sus bordes', () => {
    expect(lecturaDe(0, TRAMOS)).toMatchObject({ etiqueta: 'Flojo', tono: 'flojo' });
    expect(lecturaDe(4.99, TRAMOS).etiqueta).toBe('Flojo');
    expect(lecturaDe(5, TRAMOS).etiqueta).toBe('Normal');
    expect(lecturaDe(9.99, TRAMOS).etiqueta).toBe('Normal');
    expect(lecturaDe(10, TRAMOS)).toMatchObject({ etiqueta: 'Bueno', tono: 'bueno', desde_pct: 10 });
    expect(lecturaDe(80, TRAMOS).etiqueta).toBe('Bueno');
  });

  it('sin baremo no etiqueta, y sin tasa tampoco', () => {
    expect(lecturaDe(8.2, [])).toBeNull();
    expect(lecturaDe(8.2, undefined)).toBeNull();
    expect(lecturaDe(null, TRAMOS)).toBeNull();
  });
});

describe('validar los tramos', () => {
  it('los ordena y redondea', () => {
    const r = validarTramos([{ desde_pct: 10.005, etiqueta: ' Bueno ', tono: 'bueno' }, { desde_pct: 0, etiqueta: 'Flojo', tono: 'flojo' }]);
    expect(r.map((t) => t.desde_pct)).toEqual([0, 10.01]);
    expect(r[1].etiqueta).toBe('Bueno');
  });

  it('rechaza lo que no vale, con su motivo', () => {
    const mal = (t) => { try { validarTramos(t); return null; } catch (e) { return e.message; } };
    expect(mal([])).toMatch(/al menos un tramo/);
    expect(mal(null)).toMatch(/al menos un tramo/);
    expect(mal([{ desde_pct: 5, etiqueta: 'x', tono: 'bueno' }])).toMatch(/empezar en 0/);
    expect(mal([{ desde_pct: 0, etiqueta: '', tono: 'bueno' }])).toMatch(/etiqueta/);
    expect(mal([{ desde_pct: 0, etiqueta: 'x'.repeat(31), tono: 'bueno' }])).toMatch(/etiqueta/);
    expect(mal([{ desde_pct: 0, etiqueta: 'x', tono: 'rojo' }])).toMatch(/tono/);
    expect(mal([{ desde_pct: 100, etiqueta: 'x', tono: 'bueno' }])).toMatch(/entre 0 y 100/);
    expect(mal([{ desde_pct: -1, etiqueta: 'x', tono: 'bueno' }])).toMatch(/entre 0 y 100/);
    expect(mal([{ desde_pct: 'a', etiqueta: 'x', tono: 'bueno' }])).toMatch(/entre 0 y 100/);
    expect(mal([{ desde_pct: 0, etiqueta: 'a', tono: 'flojo' }, { desde_pct: 0, etiqueta: 'b', tono: 'bueno' }])).toMatch(/mismo porcentaje/);
    expect(mal(Array.from({ length: 7 }, (_, i) => ({ desde_pct: i * 10, etiqueta: 'x', tono: 'normal' })))).toMatch(/Como mucho 6/);
  });
});

describe('sin baremo', () => {
  it('la tasa no se etiqueta; la gestora, contra el equipo', async () => {
    const r = await tasa(LAURA);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ tasa: 25, lectura: null, baremo: { ambito: 'ninguno', tramos: [] }, equipo: 12.5 });
  });

  it('quien ve todo el campus no recibe «equipo» (es su propia cifra)', async () => {
    const r = await tasa(ADMIN);
    expect(r.body.data).toMatchObject({ tasa: 12.5, lectura: null, equipo: null });
  });

  it('la otra gestora, también contra el mismo equipo', async () => {
    expect((await tasa(ANA)).body.data).toMatchObject({ tasa: 0, equipo: 12.5 });
  });
});

describe('con baremo', () => {
  it('un admin lo pone para su campus y la tasa se lee con él', async () => {
    const g = await guardar(ADMIN, { project_id: P, tramos: TRAMOS });
    expect(g.status).toBe(200);
    expect(g.body.data.tramos).toHaveLength(3);
    const r = await tasa(LAURA);
    expect(r.body.data.lectura).toMatchObject({ etiqueta: 'Bueno', tono: 'bueno' }); // 25 %
    expect(r.body.data.baremo.ambito).toBe('campus');
    expect((await tasa(ANA)).body.data.lectura).toMatchObject({ etiqueta: 'Flojo' }); // 0 %
    expect((await tasa(ADMIN)).body.data.lectura).toMatchObject({ etiqueta: 'Bueno' }); // 12,5 %
  });

  it('guardar otra vez SUSTITUYE los tramos, no los suma', async () => {
    await guardar(ADMIN, { project_id: P, tramos: TRAMOS });
    await guardar(ADMIN, { project_id: P, tramos: [{ desde_pct: 0, etiqueta: 'Todo igual', tono: 'normal' }] });
    const r = await request.get(`/api/informes/tasa-cierre/baremo?projectId=${P}`).set(como(LAURA));
    expect(r.body.data.tramos).toEqual([{ desde_pct: 0, etiqueta: 'Todo igual', tono: 'normal' }]);
  });

  it('el general lo cambia un super admin, y vale para todos los campus sin uno propio; el del campus manda', async () => {
    expect((await guardar(ADMIN, { general: true, tramos: TRAMOS })).status).toBe(403);
    expect((await guardar(SUPER, { general: true, tramos: TRAMOS })).status).toBe(200);
    expect((await tasa(LAURA)).body.data.baremo.ambito).toBe('general');
    await guardar(ADMIN, { project_id: P, tramos: [{ desde_pct: 0, etiqueta: 'El del campus', tono: 'normal' }] });
    const r = await tasa(LAURA);
    expect(r.body.data.baremo.ambito).toBe('campus');
    expect(r.body.data.lectura.etiqueta).toBe('El del campus');
  });

  it('quitarlo vuelve a no etiquetar', async () => {
    await guardar(ADMIN, { project_id: P, tramos: TRAMOS });
    expect((await request.delete(`/api/informes/tasa-cierre/baremo?projectId=${P}`).set(como(ADMIN))).status).toBe(200);
    expect((await tasa(LAURA)).body.data.lectura).toBeNull();
    expect((await request.delete('/api/informes/tasa-cierre/baremo?general=true').set(como(ADMIN))).status).toBe(403);
  });
});

describe('quién puede', () => {
  it('una gestora lee el baremo pero no lo cambia', async () => {
    await guardar(ADMIN, { project_id: P, tramos: TRAMOS });
    expect((await request.get(`/api/informes/tasa-cierre/baremo?projectId=${P}`).set(como(LAURA))).status).toBe(200);
    expect((await guardar(LAURA, { project_id: P, tramos: TRAMOS })).status).toBe(403);
    expect((await request.delete(`/api/informes/tasa-cierre/baremo?projectId=${P}`).set(como(LAURA))).status).toBe(403);
  });

  it('un admin no toca el de un campus que no es suyo', async () => {
    expect((await guardar(ADMIN, { project_id: OTRO, tramos: TRAMOS })).status).toBe(403);
    expect((await request.delete(`/api/informes/tasa-cierre/baremo?projectId=${OTRO}`).set(como(ADMIN))).status).toBe(403);
    expect(await q(`SELECT 1 FROM tasa_cierre_baremo WHERE project_id = $1`, [OTRO])).toHaveLength(0);
  });

  it('sin campus ni «general»: 400; con tramos mal: 400 y no se borra lo que había', async () => {
    expect((await guardar(ADMIN, { tramos: TRAMOS })).status).toBe(400);
    await guardar(ADMIN, { project_id: P, tramos: TRAMOS });
    expect((await guardar(ADMIN, { project_id: P, tramos: [{ desde_pct: 5, etiqueta: 'x', tono: 'bueno' }] })).status).toBe(400);
    expect((await q(`SELECT 1 FROM tasa_cierre_baremo WHERE project_id = $1`, [P])).length).toBe(3);
  });

  it('el mes sin madurar sigue sin puntuarse: la lectura es del periodo, no de ese mes', async () => {
    await guardar(ADMIN, { project_id: P, tramos: TRAMOS });
    const r = await tasa(ADMIN);
    expect(r.body.data.meses.every((m) => !('lectura' in m))).toBe(true);
  });
});
