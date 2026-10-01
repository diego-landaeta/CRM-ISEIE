import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import bcrypt from 'bcrypt';
import { query } from '../src/shared/config/db.js';
import { tutoresConCursos, comisionesDeTutores } from '../src/modules/mcp/mcp.model.js';
import * as leadCtrl from '../src/modules/leads/lead.controller.js';
import * as authCtrl from '../src/modules/auth/auth.controller.js';

/**
 * Los arreglos del 01/10, contra la base de verdad.
 *
 * - Carlos: «la conexión crm-claude no exporta los datos de tutores». Las dos
 *   consultas nuevas del MCP tienen que funcionar en Postgres, no solo pasar la
 *   prueba con la base simulada, y no sacar nada del perfil bancario.
 * - Diego: «a Dayana y a Ana no les sale para eliminar leads» (#204). Una
 *   gestora con permiso elimina SU lead de prueba; no el de otra, no uno con
 *   venta, no por «otro».
 * - Carlos: en «Mi perfil» la contraseña no cambiaba aunque dijera que si.
 */

const marca = `t${Date.now()}`;
const ids = { usuarios: [], leads: [] };
let projectId = null;
let productId = null;
let hayBase = true;
let porQueNo = null;

async function usuario(clave, role, extra = '') {
  const hash = await bcrypt.hash('Vieja1234', 4);
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [`${clave} ${marca}${extra}`, `${clave}.${marca}@test.local`, hash, role]
  );
  ids.usuarios.push(rows[0].id);
  ids[clave] = rows[0].id;
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [rows[0].id, projectId]);
  return rows[0].id;
}

async function lead(clave, responsableId) {
  const { rows } = await query(
    `INSERT INTO leads (project_id, nombre, email, responsable_id, status)
     VALUES ($1, $2, $3, $4, 'nuevo') RETURNING id`,
    [projectId, `${clave} ${marca}`, `${clave}.${marca}@lead.local`, responsableId]
  );
  ids.leads.push(rows[0].id);
  ids[clave] = rows[0].id;
  return rows[0].id;
}

beforeAll(async () => {
  try {
    const p = await query(
      `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
      [`Parches ${marca}`, `parches-${marca}`, `k-${marca}`]
    );
    projectId = p.rows[0].id;
    const pr = await query(
      `INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 1000) RETURNING id`,
      [projectId, `Máster ${marca}`]
    );
    productId = pr.rows[0].id;

    await usuario('tutora', 'tutor');
    await query(
      `INSERT INTO tutor_profiles (user_id, iban, dni_nif, telefono) VALUES ($1, 'ES0000000000000000000000', '00000000T', '600000000')`,
      [ids.tutora]
    );
    await query(
      `INSERT INTO tutor_collaborations (tutor_id, product_id, pct, vigente_desde) VALUES ($1, $2, 12.5, '2026-09-01')`,
      [ids.tutora, productId]
    );
    await usuario('gestora', 'gestor');
    await usuario('otra', 'gestor');
    await usuario('admin', 'admin');
    await lead('suyo', ids.gestora);
    await lead('ajeno', ids.otra);
    await lead('vendido', ids.gestora);
    await query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, fecha_conversion) VALUES ($1, $2, 'Máster', 100, NOW())`,
      [ids.vendido, projectId]
    );
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  if (!projectId) return;
  for (const [sql, p] of [
    ['DELETE FROM conversions WHERE project_id = $1', [projectId]],
    ['DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM leads WHERE project_id = $1', [projectId]],
    ['DELETE FROM tutor_collaborations WHERE product_id = $1', [productId]],
    ['DELETE FROM tutor_profiles WHERE user_id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM user_projects WHERE project_id = $1', [projectId]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM products WHERE id = $1', [productId]],
    ['DELETE FROM projects WHERE id = $1', [projectId]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

/** Llama a un controlador como lo haria Express y devuelve el error o la respuesta. */
async function llamar(handler, req) {
  const res = { codigo: 200, cuerpo: null };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  let error = null;
  await handler({ headers: {}, ip: '127.0.0.1', query: {}, ...req }, res, (e) => { error = e; });
  return { res, error };
}

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('Claude: tutores', () => {
  it('lista a la tutora con su curso y su porcentaje, y nada del perfil bancario', async () => {
    if (!hayBase) return;
    const r = await tutoresConCursos({ projectIds: [projectId] });
    const t = r.tutores.find((x) => x.id === ids.tutora);
    expect(t).toBeTruthy();
    expect(t.cursos).toHaveLength(1);
    expect(Number(t.cursos[0].pct)).toBe(12.5);
    expect(t.cursos[0].rige_hoy).toBe(true);
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/ES0000|00000000T|600000000/);
  });

  it('busca por nombre de curso y no sale de los campus pedidos', async () => {
    if (!hayBase) return;
    expect((await tutoresConCursos({ projectIds: [projectId], texto: 'Máster' })).total).toBe(1);
    expect((await tutoresConCursos({ projectIds: [-1] })).total).toBe(0);
  });

  it('las comisiones responden aunque el mes esté vacío', async () => {
    if (!hayBase) return;
    const r = await comisionesDeTutores({ projectIds: [projectId], periodo: '2026-09' });
    expect(r.filas).toEqual([]);
    expect(r.totales.por_pagar).toBe(0);
  });
});

describe('#204: una gestora con permiso elimina sus leads de prueba', () => {
  const comoGestora = (leadId, reason) => ({
    user: { userId: ids.gestora, role: 'gestor' },
    params: { id: String(leadId) },
    body: { reason },
  });

  it('el suyo, por prueba: sí', async () => {
    if (!hayBase) return;
    const { error } = await llamar(leadCtrl.softDelete, comoGestora(ids.suyo, 'test'));
    expect(error).toBeNull();
    const { rows } = await query('SELECT deleted_at FROM leads WHERE id = $1', [ids.suyo]);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('el de otra: no', async () => {
    if (!hayBase) return;
    const { error } = await llamar(leadCtrl.softDelete, comoGestora(ids.ajeno, 'test'));
    expect(error?.code).toBe('NO_ES_TUYO');
  });

  it('uno con venta: no', async () => {
    if (!hayBase) return;
    const { error } = await llamar(leadCtrl.softDelete, comoGestora(ids.vendido, 'spam'));
    expect(error?.code).toBe('TIENE_VENTA');
  });

  it('por «otro»: no; eso es de administración', async () => {
    if (!hayBase) return;
    const { error } = await llamar(leadCtrl.softDelete, comoGestora(ids.ajeno, 'otro'));
    expect(['MOTIVO_SOLO_ADMIN', 'NO_ES_TUYO']).toContain(error?.code);
  });
});

describe('Mi perfil: la contraseña se cambia de verdad', () => {
  const req = (body) => ({ user: { userId: ids.admin, role: 'admin' }, body });

  it('con la actual mal, no cambia y no es un 401', async () => {
    if (!hayBase) return;
    const { error } = await llamar(authCtrl.changePassword,
      req({ currentPassword: 'NoEsEsta1', newPassword: 'Nueva12345', confirmPassword: 'Nueva12345' }));
    expect(error?.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(error?.statusCode).toBe(400);
  });

  it('con la actual bien, la cambia', async () => {
    if (!hayBase) return;
    const { error } = await llamar(authCtrl.changePassword,
      req({ currentPassword: 'Vieja1234', newPassword: 'Nueva12345', confirmPassword: 'Nueva12345' }));
    expect(error).toBeNull();
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [ids.admin]);
    expect(await bcrypt.compare('Nueva12345', rows[0].password_hash)).toBe(true);
  });

  it('el nombre también se guarda', async () => {
    if (!hayBase) return;
    const { error, res } = await llamar(authCtrl.updateMyProfile, req({ nombre: `Admin cambiada ${marca}` }));
    expect(error).toBeNull();
    expect(res.cuerpo.data.user.nombre).toBe(`Admin cambiada ${marca}`);
  });
});
