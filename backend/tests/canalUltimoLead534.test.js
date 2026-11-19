import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { getUltimoLead } from '../src/modules/projects/shortcuts.controller.js';

/**
 * CRM#534, parte 6 · «Último lead de cada gestora»: la columna Canal.
 *
 * Salía «—» en todas: la consulta calculaba `canal` y no lo devolvía, y la
 * pantalla lee `lead_canal`. Ahora va el canal que deduce el CRM (#48,
 * `lead_utms.canal_detectado`) en `lead_canal_codigo`, y en `lead_canal` el
 * texto: si no hay canal deducido, lo que trajo el formulario → «Formulario
 * web» → «Sin origen».
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/canalUltimoLead534.test.js
 */

const MARCA = `C534_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const uno = (sql, params) => q(sql, params).then((r) => r[0]);
let proyecto;
const G = {};

async function gestora(clave) {
  const u = await uno(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} ${clave}`, `${clave}@${MARCA.toLowerCase()}.test`]
  );
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, proyecto.id]);
  G[clave] = u.id;
}

async function lead(clave, { canal = null, custom = null, landing = null } = {}) {
  const l = await uno(
    `INSERT INTO leads (project_id, nombre, responsable_id, custom_fields, landing_url)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [proyecto.id, `${MARCA} lead ${clave}`, G[clave], JSON.stringify(custom || {}), landing]
  );
  if (canal) await q('INSERT INTO lead_utms (lead_id, canal_detectado) VALUES ($1, $2)', [l.id, canal]);
}

async function pedir() {
  let cuerpo;
  const res = { json: (b) => { cuerpo = b; return res; }, status: () => res };
  let fallo;
  await getUltimoLead(
    { params: { id: String(proyecto.id) }, query: {}, user: { id: 0, role: 'superadmin' } },
    res,
    (e) => { fallo = e; }
  );
  if (fallo) throw fallo;
  return cuerpo.data.gestoras;
}

beforeAll(async () => {
  proyecto = await uno(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  for (const c of ['meta', 'chatgpt', 'origen', 'web', 'nada', 'sinlead']) await gestora(c);
  await lead('meta', { canal: 'meta_ads', custom: { origen: 'Facebook' } });   // manda el deducido
  await lead('chatgpt', { canal: 'chatgpt_ia' });
  await lead('origen', { custom: { origen: 'Feria de octubre' } });
  await lead('web', { landing: 'https://psikoaprende.com/curso' });
  await lead('nada');
});

afterAll(async () => {
  if (proyecto) {
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM user_projects WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM users WHERE id = ANY($1::int[])', [Object.values(G)]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('#534 parte 6 · la columna Canal del último lead de cada gestora', () => {
  it('devuelve el canal deducido y, sin él, el texto de respaldo', async () => {
    const filas = await pedir();
    const de = (c) => filas.find((f) => f.id === G[c]);

    expect(de('meta')).toMatchObject({ lead_canal_codigo: 'meta_ads' });
    expect(de('chatgpt')).toMatchObject({ lead_canal_codigo: 'chatgpt_ia' });
    expect(de('origen')).toMatchObject({ lead_canal_codigo: null, lead_canal: 'Feria de octubre' });
    expect(de('web')).toMatchObject({ lead_canal_codigo: null, lead_canal: 'Formulario web' });
    expect(de('nada')).toMatchObject({ lead_canal_codigo: null, lead_canal: 'Sin origen' });
    // En el reparto pero sin ningún lead: sale con todo vacío, no desaparece.
    expect(de('sinlead')).toMatchObject({ lead_id: null, lead_canal: null, lead_canal_codigo: null });
  });

  it('ninguna gestora con lead sale sin canal (antes, «—» en todas)', async () => {
    const filas = await pedir();
    const conLead = filas.filter((f) => f.lead_id);
    expect(conLead).toHaveLength(5);
    for (const f of conLead) expect(f.lead_canal_codigo || f.lead_canal).toBeTruthy();
  });
});
