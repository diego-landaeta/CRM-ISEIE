import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';
import { ACCIONES, ROLES_FIJOS, dependencias, dependenciasRotas, roturasNuevas, explicarRoturas } from '../src/modules/permissions/catalogo.js';
import { permisosDelRol } from '../src/modules/permissions/resolver.js';
import * as editar from '../src/modules/permissions/permissions.editar.js';
import { olvidarPermisos } from '../src/modules/permissions/permissions.service.js';

/**
 * «Requiere» también en el servidor (Diego, 12/11, en la PR #752; Refs #694).
 *
 * Hasta ahora solo lo frenaba la pantalla: la API guardaba «Editar prospectos»
 * sin «Ver prospectos». Ahora, en los tres caminos —un rol fijo, un rol a
 * medida y lo de una persona—, se mira el resultado final
 * y se rechaza con 400 FALTA_REQUISITO si deja algo marcado sin lo que
 * necesita, en los dos sentidos: marcar sin lo que pide y quitar lo que otro
 * pide. Lo que ya venía roto no se cuenta.
 */

const request = supertest(app);
const MARCA = `REQ752_${Date.now().toString(36)}`;
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
/** Lo que trae `rol` de serie y necesita `clave`: lo que hay que quitar a la vez. */
const loQueNecesita = (rol, clave) => {
  const m = permisosDelRol(rol, []);
  return ACCIONES.filter((x) => m[x.clave] && dependencias(x.clave).includes(clave)).map((x) => x.clave);
};
const overridesDe = (rol) => q('SELECT resource, action, allowed FROM role_permission_overrides WHERE role = $1 ORDER BY 1, 2', [rol]);

let soporteAntes;

beforeAll(async () => {
  const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} A`, `${MARCA.toLowerCase()}-a`, `${MARCA}-A`]);
  P.A = p.id;
  await persona('superadmin', 'superadmin');
  await persona('adminA', 'admin', ['A']);
  // De soporte: el rol gestor lo cambian otras pruebas a la vez.
  await persona('soporteA', 'soporte', ['A']);
  // Lo que soporte tuviera ya cambiado en esta base: se deja como estaba.
  soporteAntes = await q('SELECT resource, action, allowed, updated_by FROM role_permission_overrides WHERE role = $1', ['soporte']);
}, 60000);

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id);
  await q('DELETE FROM role_permission_overrides WHERE role = $1', ['soporte']);
  for (const f of soporteAntes) {
    await q('INSERT INTO role_permission_overrides (role, resource, action, allowed, updated_by) VALUES ($1, $2, $3, $4, $5)',
      ['soporte', f.resource, f.action, f.allowed, f.updated_by]);
  }
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  if (roles.length) await q('DELETE FROM custom_roles WHERE id = ANY($1::int[])', [roles]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [Object.values(P)]);
  olvidarPermisos();
});

describe('la regla, sin base', () => {
  it('ningún rol fijo trae de serie algo sin lo que necesita', () => {
    for (const r of ROLES_FIJOS) expect(dependenciasRotas(permisosDelRol(r.clave, [])), r.clave).toEqual([]);
  });

  it('solo cuenta lo que rompe el cambio, y dice cómo', () => {
    expect(roturasNuevas({}, { 'leads.edit': true })).toEqual([{ clave: 'leads.edit', falta: 'leads.view', como: 'nueva' }]);
    expect(roturasNuevas({ 'leads.view': true, 'leads.edit': true }, { 'leads.edit': true }))
      .toEqual([{ clave: 'leads.edit', falta: 'leads.view', como: 'quitada' }]);
    // Ya estaba roto: no se le pide arreglarlo a quien cambia otra cosa.
    expect(roturasNuevas({ 'leads.edit': true }, { 'leads.edit': true, 'ventas.view': true })).toEqual([]);
  });

  it('la frase dice qué falta, o qué se queda sin lo que necesita', () => {
    expect(explicarRoturas(roturasNuevas({}, { 'leads.edit': true }))).toBe('«Editar prospectos» necesita «Ver prospectos»');
    expect(explicarRoturas(roturasNuevas({ 'leads.view': true, 'leads.edit': true }, { 'leads.edit': true })))
      .toBe('Sin «Ver prospectos» no sirve «Editar prospectos»: quítalo también o deja «Ver prospectos»');
  });
});

describe('un rol fijo', () => {
  it('todos los roles fijos se guardan tal como están: lo de serie no rompe nada', async () => {
    // Los que no tocan otras pruebas en paralelo (gestor, colaborador y
    // project_manager los cambian otras); de esos, la prueba sin base de arriba.
    for (const r of ROLES_FIJOS.filter((x) => ['admin', 'soporte', 'tutor', 'tutor_redactor'].includes(x.clave))) {
      const res = await request.put(`/api/permissions/roles/fijos/${r.clave}`).set(como('superadmin')).send({ permisos: {} });
      expect(res.status, `${r.clave}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it('marcar algo sin lo que pide: 400 y no se guarda nada', async () => {
    const antes = await overridesDe('soporte');
    const r = await request.put('/api/permissions/roles/fijos/soporte').set(como('superadmin'))
      .send({ permisos: { 'tutores.liquidar': true } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FALTA_REQUISITO');
    expect(r.body.error).toMatch(/«Liquidar comisiones» necesita «.+»/);
    expect(r.body.data.roturas).toContainEqual(expect.objectContaining({ clave: 'tutores.liquidar', falta: 'tutores.gestionar', como: 'nueva' }));
    expect(await overridesDe('soporte')).toEqual(antes);
  });

  it('quitar un «Ver» del que dependen otros: 400, y dice cuáles', async () => {
    const r = await request.put('/api/permissions/roles/fijos/soporte').set(como('superadmin'))
      .send({ permisos: { 'leads.view': false } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FALTA_REQUISITO');
    expect(r.body.error).toMatch(/^Sin «Ver prospectos» no sirve .*«Editar prospectos»/);
  });

  it('lo válido se sigue guardando: quitar el «Ver» con todo lo que lo necesita', async () => {
    const quitar = Object.fromEntries(['leads.view', ...loQueNecesita('soporte', 'leads.view')].map((k) => [k, false]));
    const r = await request.put('/api/permissions/roles/fijos/soporte').set(como('superadmin')).send({ permisos: quitar });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data['leads.view']).toBe(false);
    expect(r.body.data['leads.edit']).toBe(false);
    // Y vuelve a lo de serie.
    const back = Object.fromEntries(Object.keys(quitar).map((k) => [k, true]));
    expect((await request.put('/api/permissions/roles/fijos/soporte').set(como('superadmin')).send({ permisos: back })).status).toBe(200);
  });

  it('lo que ya venía roto no impide guardar otra cosa', async () => {
    // Guardado antes de esta comprobación: soporte sin «Ver prospectos» pero con «Editar».
    await q(`INSERT INTO role_permission_overrides (role, resource, action, allowed, updated_by) VALUES ('soporte', 'leads', 'view', false, $1)
             ON CONFLICT DO NOTHING`, [U.superadmin.id]);
    const r = await request.put('/api/permissions/roles/fijos/soporte').set(como('superadmin'))
      .send({ permisos: { 'leads.view': false, 'webhooks.view': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await request.put('/api/permissions/roles/fijos/soporte').set(como('superadmin')).send({ permisos: { 'leads.view': true, 'webhooks.view': false } });
  });
});

describe('un rol a medida', () => {
  it('crearlo con algo sin lo que pide: 400 y no se crea', async () => {
    const nombre = `${MARCA} cojo`;
    const r = await request.post('/api/permissions/roles/a-medida').set(como('superadmin'))
      .send({ nombre, base: 'gestor', permisos: { 'tutores.liquidar': true } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FALTA_REQUISITO');
    expect(await q('SELECT 1 FROM custom_roles WHERE label = $1', [nombre])).toEqual([]);
  });

  it('crearlo bien, sí; y cambiarlo dejando algo cojo, no', async () => {
    const r = await request.post('/api/permissions/roles/a-medida').set(como('superadmin'))
      .send({ nombre: `${MARCA} bien`, base: 'gestor', permisos: { 'tutores.gestionar': true, 'tutores.liquidar': true } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.data.id;
    roles.push(id);
    const x = await request.patch(`/api/permissions/roles/a-medida/${id}`).set(como('superadmin'))
      .send({ permisos: { 'tutores.gestionar': false } });
    expect(x.status).toBe(400);
    expect(x.body.code).toBe('FALTA_REQUISITO');
    expect(x.body.error).toMatch(/«Liquidar comisiones»/);
    const { permissions } = await one('SELECT permissions FROM custom_roles WHERE id = $1', [id]);
    expect(permissions['tutores.gestionar']).toBe(true);
    // Lo que no toca permisos (desactivarlo) y lo válido, sí.
    expect((await request.patch(`/api/permissions/roles/a-medida/${id}`).set(como('superadmin')).send({ activo: false })).status).toBe(200);
    const ok = await request.patch(`/api/permissions/roles/a-medida/${id}`).set(como('superadmin'))
      .send({ permisos: { 'tutores.gestionar': false, 'tutores.liquidar': false } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('lo de una persona', () => {
  it('quitarle «Ver prospectos» dejándole «Editar»: 400, sin excepción ni apunte', async () => {
    const r = await request.put(`/api/permissions/personas/${U.soporteA.id}/excepciones`).set(como('adminA'))
      .send({ cambios: { 'leads.view': false } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FALTA_REQUISITO');
    expect(r.body.error).toMatch(/Sin «Ver prospectos»/);
    expect(await q('SELECT 1 FROM user_permission_overrides WHERE user_id = $1', [U.soporteA.id])).toEqual([]);
    expect(await q('SELECT 1 FROM permisos_registro WHERE usuario_id = $1', [U.soporteA.id])).toEqual([]);
  });

  it('darle algo sin lo que pide: 400', async () => {
    const r = await request.put(`/api/permissions/personas/${U.soporteA.id}/excepciones`).set(como('superadmin'))
      .send({ cambios: { 'tutores.liquidar': true } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FALTA_REQUISITO');
  });

  it('lo válido se sigue guardando', async () => {
    const quitar = Object.fromEntries(['leads.view', ...loQueNecesita('soporte', 'leads.view')].map((k) => [k, false]));
    const r = await request.put(`/api/permissions/personas/${U.soporteA.id}/excepciones`).set(como('adminA')).send({ cambios: quitar });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data['leads.view']).toBe(false);
    const dar = await request.put(`/api/permissions/personas/${U.soporteA.id}/excepciones`).set(como('superadmin'))
      .send({ cambios: { 'tutores.gestionar': true, 'tutores.liquidar': true } });
    expect(dar.status, JSON.stringify(dar.body)).toBe(200);
    // Volver a lo de su rol (null) también deja todo en orden.
    const vuelta = Object.fromEntries([...Object.keys(quitar), 'tutores.gestionar', 'tutores.liquidar'].map((k) => [k, null]));
    expect((await request.put(`/api/permissions/personas/${U.soporteA.id}/excepciones`).set(como('superadmin')).send({ cambios: vuelta })).status).toBe(200);
  });

  // En ISEIE no hay alta con permisos (CRM#694): «exigirExcepcionesDeAlta» no existe, y su prueba no va.
});
