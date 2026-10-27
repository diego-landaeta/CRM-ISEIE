import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * #423, fase 3 · Configuración › Roles y la ficha de permisos de cada persona,
 * contra la base de verdad.
 *
 *   - Los roles (fijos y a medida) los cambian el superadmin y el admin (Diego,
 *     26/10), sin ponerles lo que no tienen; soporte, no.
 *   - Lo de una persona, el admin de su campus, nunca a otro admin, nunca más de
 *     lo que él tiene y nunca lo que su rol no puede tener.
 *   - Cada cambio queda en `permisos_registro`, en la misma transacción: si el
 *     cambio falla, no hay apunte, y al revés.
 *   - La ficha dice de dónde viene cada permiso.
 *   - Un rol a medida desactivado deja de aplicarse.
 */

const request = supertest(app);
const MARCA = `PERM423_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
const P = {};
const roles = [];

async function persona(clave, role, campus = []) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email, role`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });
const registroDe = (userId) => q('SELECT quien_id, clave, antes, despues, origen FROM permisos_registro WHERE usuario_id = $1 ORDER BY id', [userId]);

beforeAll(async () => {
  for (const c of ['A', 'B']) {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`]);
    P[c] = p.id;
  }
  await persona('superadmin', 'superadmin');
  await persona('soporte', 'soporte');
  await persona('adminA', 'admin', ['A']);
  await persona('adminA2', 'admin', ['A']);
  await persona('adminB', 'admin', ['B']);
  await persona('gestoraA', 'gestor', ['A']);
  await persona('gestoraB', 'gestor', ['B']);
  await persona('tutorA', 'tutor', ['A']);
}, 60000);

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id);
  await q('DELETE FROM role_permission_overrides WHERE role = $1 AND updated_by = ANY($2::int[])', ['gestor', ids]);
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  await q('UPDATE users SET custom_role_id = NULL WHERE id = ANY($1::int[])', [ids]);
  if (roles.length) await q('DELETE FROM custom_roles WHERE id = ANY($1::int[])', [roles]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [Object.values(P)]);
});

describe('Configuración › Roles (#423)', () => {
  it('ver los roles: superadmin y admin; gestora y soporte, 403', async () => {
    expect((await request.get('/api/permissions/roles').set(como('superadmin'))).status).toBe(200);
    const r = await request.get('/api/permissions/roles').set(como('adminA'));
    expect(r.status).toBe(200);
    expect(r.body.data.fijos.map((x) => x.clave)).toEqual(['superadmin', 'admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador']);
    expect((await request.get('/api/permissions/roles').set(como('gestoraA'))).status).toBe(403);
    expect((await request.get('/api/permissions/roles').set(como('soporte'))).status).toBe(403);
  });

  it('cambiar un rol fijo: el admin (Diego, 26/10) sin darle lo que no tiene; soporte y la gestora, no', async () => {
    for (const quien of ['soporte', 'gestoraA']) {
      expect((await request.put('/api/permissions/roles/fijos/gestor').set(como(quien)).send({ permisos: { 'leads.export': true } })).status).toBe(403);
    }
    // «Ver claves» es de soporte: el admin no lo tiene y no se lo pone a un rol.
    const sin = await request.put('/api/permissions/roles/fijos/gestor').set(como('adminA')).send({ permisos: { 'credentials.view': true } });
    expect(sin.status).toBe(403);
    expect(sin.body.code).toBe('NO_LO_TIENES');
    expect(await q(`SELECT 1 FROM role_permission_overrides WHERE role = 'gestor' AND resource = 'credentials'`)).toEqual([]);
    // Lo que sí tiene, sí: y vuelve a lo de serie.
    const con = await request.put('/api/permissions/roles/fijos/gestor').set(como('adminA')).send({ permisos: { 'leads.export': true } });
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    expect(con.body.data['leads.export']).toBe(true);
    await request.put('/api/permissions/roles/fijos/gestor').set(como('adminA')).send({ permisos: { 'leads.export': false } });
    expect(await q(`SELECT 1 FROM role_permission_overrides WHERE role = 'gestor' AND resource = 'leads'`)).toEqual([]);
  });

  it('cambiar un rol fijo: solo se guarda la diferencia y queda en el registro', async () => {
    const r = await request.put('/api/permissions/roles/fijos/gestor').set(como('superadmin')).send({ permisos: { 'leads.export': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data['leads.export']).toBe(true);
    expect(await q(`SELECT action, allowed FROM role_permission_overrides WHERE role = 'gestor' AND resource = 'leads'`))
      .toEqual([{ action: 'export', allowed: true }]);
    const apunte = await one(`SELECT quien_id, destino_tipo, rol, clave, antes, despues, origen FROM permisos_registro
                                WHERE rol = 'gestor' AND quien_id = $1 ORDER BY id DESC LIMIT 1`, [U.superadmin.id]);
    expect(apunte).toEqual({ quien_id: U.superadmin.id, destino_tipo: 'rol', rol: 'gestor', clave: 'leads.export', antes: 'false', despues: 'true', origen: 'pantalla_roles' });
    // Una gestora lo nota en su mapa al momento.
    const me = await request.get('/api/auth/me').set(como('gestoraA'));
    expect(me.body.data.permissions['leads.export']).toBe(true);
    // Volver a lo de serie borra la fila.
    await request.put('/api/permissions/roles/fijos/gestor').set(como('superadmin')).send({ permisos: { 'leads.export': false } });
    expect(await q(`SELECT 1 FROM role_permission_overrides WHERE role = 'gestor' AND resource = 'leads'`)).toEqual([]);
  });

  it('el superadmin no se cambia, y una clave que no existe es 400', async () => {
    expect((await request.put('/api/permissions/roles/fijos/superadmin').set(como('superadmin')).send({ permisos: { 'leads.view': false } })).status).toBe(400);
    expect((await request.put('/api/permissions/roles/fijos/gestor').set(como('superadmin')).send({ permisos: { 'leads.volar': true } })).status).toBe(400);
  });
});

describe('la ficha de cada persona (#423)', () => {
  it('dice de dónde viene cada permiso', async () => {
    const r = await request.get(`/api/permissions/personas/${U.gestoraA.id}`).set(como('adminA'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.mapa['leads.view']).toBe(true);
    expect(r.body.data.origenes['leads.view']).toEqual({ tipo: 'rol', rol: 'gestor' });
    expect(r.body.data.origenes['facturas.cola']).toEqual({ tipo: 'ninguno' });
    expect(r.body.data.puedeEditar).toBe(true);
  });

  it('quién la ve: la propia, cualquiera; de otro campus, 404; sin «ver usuarios», 403', async () => {
    expect((await request.get(`/api/permissions/personas/${U.gestoraA.id}`).set(como('gestoraA'))).status).toBe(200);
    expect((await request.get(`/api/permissions/personas/${U.gestoraA.id}`).set(como('adminB'))).status).toBe(404);
    expect((await request.get(`/api/permissions/personas/${U.gestoraA.id}`).set(como('gestoraB'))).status).toBe(403);
  });

  it('el admin da una excepción a alguien de su campus, y queda en el registro con quién', async () => {
    const r = await request.put(`/api/permissions/personas/${U.gestoraA.id}/excepciones`).set(como('adminA'))
      .send({ cambios: { 'diplomas.view': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data['diplomas.view']).toBe(true);
    const f = await request.get(`/api/permissions/personas/${U.gestoraA.id}`).set(como('adminA'));
    expect(f.body.data.origenes['diplomas.view']).toEqual({ tipo: 'excepcion' });
    expect(await registroDe(U.gestoraA.id)).toContainEqual(
      { quien_id: U.adminA.id, clave: 'diplomas.view', antes: 'como su rol (no)', despues: 'sí', origen: 'ficha_usuario' });
    // Y se la quita volviendo a «como su rol».
    await request.put(`/api/permissions/personas/${U.gestoraA.id}/excepciones`).set(como('adminA')).send({ cambios: { 'diplomas.view': null } });
    expect(await q(`SELECT 1 FROM user_permission_overrides WHERE user_id = $1`, [U.gestoraA.id])).toEqual([]);
  });

  it('de otro campus: 404, sin decir que existe', async () => {
    const r = await request.put(`/api/permissions/personas/${U.gestoraB.id}/excepciones`).set(como('adminA')).send({ cambios: { 'diplomas.view': true } });
    expect(r.status).toBe(404);
  });

  it('a otro admin, ni a sí mismo: 403', async () => {
    expect((await request.put(`/api/permissions/personas/${U.adminA2.id}/excepciones`).set(como('adminA')).send({ cambios: { 'diplomas.view': false } })).status).toBe(403);
  });

  it('soporte y la gestora no dan permisos: 403', async () => {
    for (const quien of ['soporte', 'gestoraB']) {
      expect((await request.put(`/api/permissions/personas/${U.gestoraB.id}/excepciones`).set(como(quien)).send({ cambios: { 'diplomas.view': true } })).status).toBe(403);
    }
  });

  it('nadie da lo que no tiene: un admin no da «Ver claves»', async () => {
    const r = await request.put(`/api/permissions/personas/${U.gestoraA.id}/excepciones`).set(como('adminA')).send({ cambios: { 'credentials.view': true } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NO_LO_TIENES');
  });

  it('lo que el rol no puede tener nunca no se da ni con excepción: el MCP a un tutor', async () => {
    const r = await request.put(`/api/permissions/personas/${U.tutorA.id}/excepciones`).set(como('superadmin')).send({ cambios: { 'mcp.usar': true } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NUNCA');
  });

  it('todo o nada: si una clave no se puede dar, no se guarda ninguna ni hay apunte', async () => {
    const antes = (await registroDe(U.gestoraA.id)).length;
    const r = await request.put(`/api/permissions/personas/${U.gestoraA.id}/excepciones`).set(como('adminA'))
      .send({ cambios: { 'leads.export': true, 'credentials.view': true } });
    expect(r.status).toBe(403);
    expect(await q(`SELECT 1 FROM user_permission_overrides WHERE user_id = $1 AND resource = 'leads'`, [U.gestoraA.id])).toEqual([]);
    expect((await registroDe(U.gestoraA.id)).length).toBe(antes);
  });
});

describe('roles a medida (#423)', () => {
  it('el superadmin lo crea a partir de un rol fijo; el admin también, sin darle lo que no tiene; soporte, no', async () => {
    expect((await request.post('/api/permissions/roles/a-medida').set(como('soporte')).send({ nombre: 'x', base: 'gestor' })).status).toBe(403);
    const sin = await request.post('/api/permissions/roles/a-medida').set(como('adminA'))
      .send({ nombre: `${MARCA} admin con claves`, base: 'gestor', permisos: { 'credentials.view': true } });
    expect(sin.status).toBe(403);
    expect(sin.body.code).toBe('NO_LO_TIENES');
    const delAdmin = await request.post('/api/permissions/roles/a-medida').set(como('adminA'))
      .send({ nombre: `${MARCA} del admin`, base: 'gestor', permisos: { 'leads.export': true } });
    expect(delAdmin.status, JSON.stringify(delAdmin.body)).toBe(201);
    const idDelAdmin = delAdmin.body.data.id;
    // Y al cambiarlo, lo mismo: no le pone lo que no tiene.
    const cambio = await request.patch(`/api/permissions/roles/a-medida/${idDelAdmin}`).set(como('adminA'))
      .send({ permisos: { 'projects.create': true } });
    expect(cambio.status).toBe(403);
    expect(cambio.body.code).toBe('NO_LO_TIENES');
    const r = await request.post('/api/permissions/roles/a-medida').set(como('superadmin'))
      .send({ nombre: `${MARCA} gestora con export`, base: 'gestor', permisos: { 'leads.export': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    roles.push(r.body.data.id, idDelAdmin);
    // Solo guarda lo que lo distingue de su rol base.
    expect(r.body.data.permissions).toEqual({ 'leads.export': true });
  });

  it('dárselo a una persona cambia su mapa y la ficha dice que viene del rol a medida', async () => {
    const id = roles[0];
    const r = await request.put(`/api/permissions/personas/${U.gestoraA.id}/rol-a-medida`).set(como('adminA')).send({ customRoleId: id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data['leads.export']).toBe(true);
    const f = await request.get(`/api/permissions/personas/${U.gestoraA.id}`).set(como('adminA'));
    expect(f.body.data.origenes['leads.export']).toMatchObject({ tipo: 'rol_a_medida', id });
    expect(await registroDe(U.gestoraA.id)).toContainEqual(expect.objectContaining({ clave: 'rol_a_medida', origen: 'ficha_usuario' }));
  });

  it('desactivado, deja de aplicarse', async () => {
    const id = roles[0];
    expect((await request.patch(`/api/permissions/roles/a-medida/${id}`).set(como('superadmin')).send({ activo: false })).status).toBe(200);
    const me = await request.get('/api/auth/me').set(como('gestoraA'));
    expect(me.body.data.permissions['leads.export']).toBe(false);
  });

  it('un admin no da un rol a medida que trae lo que él no tiene', async () => {
    const r = await request.post('/api/permissions/roles/a-medida').set(como('superadmin'))
      .send({ nombre: `${MARCA} con claves`, base: 'gestor', permisos: { 'credentials.view': true } });
    roles.push(r.body.data.id);
    const x = await request.put(`/api/permissions/personas/${U.gestoraA.id}/rol-a-medida`).set(como('adminA')).send({ customRoleId: r.body.data.id });
    expect(x.status).toBe(403);
    expect(x.body.code).toBe('NO_LO_TIENES');
  });
});
