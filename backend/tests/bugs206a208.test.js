import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import bcrypt from 'bcrypt';
import { query } from '../src/shared/config/db.js';
import { comisionesDeTutores, formacionesSinTutorDe } from '../src/modules/mcp/mcp.model.js';
import * as authCtrl from '../src/modules/auth/auth.controller.js';

/**
 * #207 y #208 de Carlos, contra la base de verdad.
 *
 * - #207: «formaciones_sin_tutor» y las comisiones por tramo de meses tienen que
 *   funcionar en Postgres, no solo con la base simulada.
 * - #208: «que funcione con cualquier rol: gestora, tutor, admin». El cambio de
 *   contraseña se probó con un admin; aquí, con una gestora y con un tutor.
 */

const marca = `t${Date.now()}`;
const ids = [];
let projectId = null;
let hayBase = true;
let porQueNo = null;

async function usuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [`${role} ${marca}`, `${role}.${marca}@test.local`, await bcrypt.hash('Vieja1234', 4), role]
  );
  ids.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  try {
    const p = await query(
      `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
      [`Bugs ${marca}`, `bugs-${marca}`, `k-${marca}`]
    );
    projectId = p.rows[0].id;
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids]],
    ['DELETE FROM projects WHERE id = $1', [projectId]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

async function cambiar(userId, role) {
  let error = null;
  const res = { status: () => res, json: () => res };
  await authCtrl.changePassword(
    { user: { userId, role }, body: { currentPassword: 'Vieja1234', newPassword: 'Nueva12345', confirmPassword: 'Nueva12345' }, headers: {}, ip: '127.0.0.1' },
    res, (e) => { error = e; }
  );
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return { error, cambiada: await bcrypt.compare('Nueva12345', rows[0].password_hash) };
}

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#207: Claude, contra la base', () => {
  it('formaciones sin tutor responde, desde el corte y sin él', async () => {
    if (!hayBase) return;
    const a = await formacionesSinTutorDe({ projectIds: [projectId] });
    const b = await formacionesSinTutorDe({ projectIds: [projectId], incluir_anteriores_al_corte: true });
    expect(a.total).toBe(0);
    expect(b.total).toBe(0);
  });

  it('comisiones por tramo de meses, con generado', async () => {
    if (!hayBase) return;
    const r = await comisionesDeTutores({ projectIds: [projectId], desde: '2026-08', hasta: '2026-09' });
    expect(r.periodo).toBe('2026-08 a 2026-09');
    expect(r.totales).toEqual({ generado: 0, por_pagar: 0, pagado: 0, revertido: 0 });
  });
});

describe('#208: la contraseña se cambia con cualquier rol', () => {
  it.each(['gestor', 'tutor'])('%s', async (role) => {
    if (!hayBase) return;
    const id = await usuario(role);
    const { error, cambiada } = await cambiar(id, role);
    expect(error).toBeNull();
    expect(cambiada).toBe(true);
  });
});
