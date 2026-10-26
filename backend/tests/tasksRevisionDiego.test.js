import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';
import { tareasActivas } from '../src/shared/config/soloEnPruebas.js';

/**
 * Tablero de tareas · la revisión de Diego del 08/10 en la #210, contra la base
 * de verdad. Cada caso falla con el código de staging:
 *
 *   A · un área archivada no bloquea editar; una gestora edita su tarea
 *       reasignada; `sort_order` enorme es 400; títulos largos en la campana.
 *   B · cambiar título, fecha o prioridad deja un comentario automático.
 *   C · Configuración › Roles cambia los permisos de Tareas de un rol (superadmin
 *       y admin), y el servidor cumple las 8 claves y la regla de edición.
 *   D · acotado por empresa: un admin solo ve y asigna gente de su empresa, más
 *       los colaboradores sin campus.
 *   E · la bandera que corta /api/tasks en producción.
 *
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/tasksRevisionDiego.test.js
 */

const request = supertest(app);
const MARCA = `TASKSREV_${Date.now().toString(36)}`;

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
const P = {};
const ids = { issuers: [], projects: [], areas: [], customRoles: [] };

async function persona(clave, role, campus = [], customRoleId = null) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role, custom_role_id)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id, email, role, custom_role_id`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role, customRoleId]
  );
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  U[clave] = u;
  T[clave] = jwt.sign(
    { userId: u.id, email: u.email, role, roles_extra: [], customRoleId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });

async function crear(clave, body) {
  const res = await request.post('/api/tasks').set(como(clave)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

const editar = (clave, id, body) => request.patch(`/api/tasks/${id}`).set(como(clave)).send(body);
const permisosDeRol = (clave, roleKey, permissions) => request
  .put(`/api/permissions/role-permissions/${roleKey}`).set(como(clave)).send({ permissions });

beforeAll(async () => {
  // Dos empresas: UNO con el campus A, DOS con el campus C.
  for (const [clave, nombre] of [['UNO', 'Empresa uno'], ['DOS', 'Empresa dos']]) {
    const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id',
      [`${MARCA} ${nombre}`, `${MARCA}-${clave}`]);
    ids.issuers.push(s.id);
    P[`S_${clave}`] = s.id;
  }
  for (const [c, s] of [['A', 'UNO'], ['C', 'DOS']]) {
    const p = await one(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, P[`S_${s}`]]
    );
    ids.projects.push(p.id);
    P[c] = p.id;
  }

  // Un rol a medida sobre «colaborador», para cambiarle Tareas desde Roles.
  const rol = await one(
    `INSERT INTO custom_roles (label, base_role, permissions) VALUES ($1, 'colaborador', $2) RETURNING id`,
    [`${MARCA} medida`, JSON.stringify({ 'leads.view': true })]
  );
  ids.customRoles.push(rol.id);
  P.rolMedida = rol.id;

  await persona('superadmin', 'superadmin');
  await persona('soporte', 'soporte');
  await persona('adminA', 'admin', ['A']);
  await persona('adminC', 'admin', ['C']);
  await persona('gestoraA', 'colaborador', ['A']);
  await persona('gestoraA2', 'colaborador', ['A']);
  await persona('gestoraC', 'colaborador', ['C']);
  await persona('colaborador', 'colaborador');
  await persona('pm', 'colaborador', ['A']);
  await persona('medida', 'colaborador', ['A'], rol.id);
  // Sin tablero (Diego, 09/10: las tareas son del equipo de desarrollo).
  await persona('gestoraVentas', 'gestor', ['A']);
  await persona('pmReal', 'project_manager', ['A']);
}, 60000);

afterAll(async () => {
  const usuarios = Object.values(U).map((u) => u.id);
  await q('DELETE FROM role_permission_overrides WHERE role = $1', ['colaborador']);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [usuarios]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM custom_roles WHERE id = ANY($1::int[])', [ids.customRoles]);
  await q('DELETE FROM task_areas WHERE id = ANY($1::int[])', [ids.areas]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('A · los fallos del QA', () => {
  it('A2 · un área archivada no bloquea editar sus tareas; ponerla nueva sí es 400', async () => {
    const area = await request.post('/api/tasks/areas').set(como('superadmin')).send({ name: `${MARCA} área` });
    expect(area.status).toBe(201);
    ids.areas.push(area.body.data.id);
    const t = await crear('adminA', { title: 'Con área', area_id: area.body.data.id, assigned_to: U.gestoraA.id });
    expect((await request.patch(`/api/tasks/areas/${area.body.data.id}`).set(como('superadmin'))
      .send({ is_active: false })).status).toBe(200);

    // Lo que manda la ficha al guardar: todos sus campos, también el área de siempre.
    const res = await editar('gestoraA', t.id, { title: 'Con área, retocada', area_id: area.body.data.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const otra = await crear('adminA', { title: 'Sin área' });
    expect((await editar('adminA', otra.id, { area_id: area.body.data.id })).status).toBe(400);
  });

  it('A3 · una gestora edita el título de una tarea que le reasignaron', async () => {
    const t = await crear('adminA', { title: 'Para Gestora', assigned_to: U.gestoraA2.id });
    // La ficha manda también el responsable que ya tiene: no es reasignar.
    const res = await editar('gestoraA2', t.id, { title: 'Para Gestora, retocada', assigned_to: U.gestoraA2.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Pero mandar `assigned_to` sin «Asignar» sigue siendo 403.
    expect((await editar('gestoraA2', t.id, { assigned_to: U.gestoraA.id })).status).toBe(403);
  });

  it('A4 · un sort_order enorme es 400, no 500', async () => {
    const res = await request.post('/api/tasks/areas').set(como('superadmin'))
      .send({ name: `${MARCA} enorme`, sort_order: 99999999999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('un título de 255 caracteres llega a la campana (antes se pasaba de 255 y se perdía)', async () => {
    const largo = 'L'.repeat(255);
    const t = await crear('adminA', { title: largo, assigned_to: U.gestoraA.id });
    const aviso = await one(
      `SELECT title FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND metadata->>'task_id' = $2
        ORDER BY id DESC LIMIT 1`,
      [U.gestoraA.id, String(t.id)]
    );
    expect(aviso, 'no hay aviso en la campana').toBeTruthy();
    expect(aviso.title.length).toBeLessThanOrEqual(255);
  });
});

describe('B · comentario automático por cualquier cambio (Diego 08/10 y WhatsApp 09/10)', () => {
  it('la persona asignada cambia la fecha que puso el admin: historial + comentario en hora de Madrid', async () => {
    const t = await crear('adminA', {
      title: 'Con fecha', assigned_to: U.gestoraA.id, due_date: '2026-10-10T10:00:00.000Z',
    });
    const res = await editar('gestoraA', t.id, { due_date: '2026-10-14T10:00:00.000Z', priority: 'alta' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const evento = await one(
      `SELECT details FROM task_events WHERE task_id = $1 AND event_type = 'updated' ORDER BY id DESC LIMIT 1`, [t.id]);
    expect(evento.details.due_date).toBeTruthy();
    const comentario = await one('SELECT user_id, content FROM task_comments WHERE task_id = $1 ORDER BY id DESC LIMIT 1', [t.id]);
    expect(comentario.user_id).toBe(U.gestoraA.id);
    expect(comentario.content).toContain('Cambió la fecha del 10/10 al 14/10.');
    expect(comentario.content).toContain('Cambió la prioridad de «media» a «alta».');
  });

  it('cualquier campo, por mínimo que sea: descripción, columna y persona asignada', async () => {
    const t = await crear('adminA', { title: 'Viejo', assigned_to: U.gestoraA.id });
    expect((await editar('gestoraA', t.id, { title: 'Nuevo' })).status).toBe(200);
    expect((await editar('gestoraA', t.id, { description: 'Con detalle' })).status).toBe(200);
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('gestoraA')).send({ status: 'en_curso' })).status).toBe(200);
    expect((await editar('adminA', t.id, { assigned_to: U.gestoraA2.id })).status).toBe(200);
    const comentarios = (await q('SELECT content FROM task_comments WHERE task_id = $1 ORDER BY id', [t.id])).map((c) => c.content);
    expect(comentarios).toEqual([
      'Cambió el título de «Viejo» a «Nuevo».',
      'Cambió la descripción.',
      'Movió la tarea de «Por hacer» a «En curso».',
      `Cambió la persona asignada de «${MARCA} gestoraA» a «${MARCA} gestoraA2».`,
    ]);
  });

  it('lo más mínimo también: pasos, etiquetas y enlaces quedan comentados', async () => {
    const t = await crear('adminA', { title: 'Mínimos', assigned_to: U.gestoraA.id });
    const paso = (await request.post(`/api/tasks/${t.id}/checklist`).set(como('gestoraA')).send({ title: 'Revisar' })).body.data;
    await request.patch(`/api/tasks/${t.id}/checklist/${paso.id}`).set(como('gestoraA')).send({ is_completed: true });
    await request.delete(`/api/tasks/${t.id}/checklist/${paso.id}`).set(como('gestoraA'));
    const tag = (await request.post(`/api/tasks/${t.id}/tags`).set(como('gestoraA')).send({ name: 'SEO' })).body.data;
    await request.delete(`/api/tasks/${t.id}/tags/${tag.id}`).set(como('gestoraA'));
    const link = (await request.post(`/api/tasks/${t.id}/links`).set(como('gestoraA')).send({ url: 'https://ejemplo.test', title: 'Maqueta' })).body.data;
    await request.delete(`/api/tasks/${t.id}/links/${link.id}`).set(como('gestoraA'));
    const comentarios = (await q('SELECT content FROM task_comments WHERE task_id = $1 ORDER BY id', [t.id])).map((c) => c.content);
    expect(comentarios).toEqual([
      'Añadió el paso «Revisar».',
      'Marcó como hecho el paso «Revisar».',
      'Quitó el paso «Revisar».',
      'Añadió la etiqueta «SEO».',
      'Quitó la etiqueta «SEO».',
      'Añadió el enlace «Maqueta».',
      'Quitó el enlace «Maqueta».',
    ]);
  });

  it('y notificado: aviso en la campana a la persona asignada y a quien la creó, nunca a quien cambia', async () => {
    const t = await crear('adminA', { title: 'Avisos', assigned_to: U.gestoraA.id });
    const avisos = (quien) => q(
      `SELECT title, message FROM admin_notifications WHERE type = 'task_cambio' AND metadata->>'task_id' = $1 AND $2 = ANY(target_user_ids)`,
      [String(t.id), quien]
    );
    // Cambia la persona asignada: avisa a quien la creó (el admin), no a ella.
    expect((await editar('gestoraA', t.id, { priority: 'alta' })).status).toBe(200);
    const alAdmin = await avisos(U.adminA.id);
    expect(alAdmin).toHaveLength(1);
    expect(alAdmin[0].title).toBe('Cambio en: Avisos');
    expect(alAdmin[0].message).toBe(`${MARCA} gestoraA: Cambió la prioridad de «media» a «alta».`);
    expect(await avisos(U.gestoraA.id)).toHaveLength(0);
    // Cambia el admin: avisa a la persona asignada.
    expect((await editar('adminA', t.id, { title: 'Avisos 2' })).status).toBe(200);
    expect(await avisos(U.gestoraA.id)).toHaveLength(1);
    // Reasignar: a la nueva le llega «Tarea reasignada», no además un «Cambio en».
    expect((await editar('adminA', t.id, { assigned_to: U.gestoraA2.id })).status).toBe(200);
    expect(await avisos(U.gestoraA2.id)).toHaveLength(0);
    expect(await avisos(U.gestoraA.id)).toHaveLength(2);
  });

  it('guardar la ficha sin cambiar nada (o la misma fecha a otra hora) no deja comentario', async () => {
    const t = await crear('adminA', { title: 'Quieta', assigned_to: U.gestoraA.id, due_date: '2026-10-14T21:59:00.000Z' });
    const todo = {
      title: 'Quieta', description: null, priority: 'media', due_date: '2026-10-14T10:00:00.000Z',
      area_id: null, project_id: null, external_project_id: null,
    };
    expect((await editar('gestoraA', t.id, todo)).status).toBe(200);
    expect(await q('SELECT 1 FROM task_comments WHERE task_id = $1', [t.id])).toEqual([]);
  });
});

describe('C · editan el admin y la persona asignada (Diego, 08/10 y WhatsApp 09/10), y las claves en el servidor', () => {
  it('quien solo la creó ya no la edita (la ve y la comenta); el admin y la persona asignada, sí', async () => {
    // La gestora crea y el admin se la pasa a otra: ella sigue viéndola.
    const t = await crear('gestoraA', { title: 'La creé yo' });
    expect((await editar('adminA', t.id, { assigned_to: U.gestoraA2.id })).status).toBe(200);
    expect((await editar('gestoraA', t.id, { title: 'Intento' })).status).toBe(403);
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('gestoraA')).send({ status: 'en_curso' })).status).toBe(403);
    expect((await request.post(`/api/tasks/${t.id}/checklist`).set(como('gestoraA')).send({ title: 'x' })).status).toBe(403);
    expect((await request.get(`/api/tasks/${t.id}`).set(como('gestoraA'))).status).toBe(200);
    expect((await request.post(`/api/tasks/${t.id}/comments`).set(como('gestoraA')).send({ content: 'ok' })).status).toBe(201);
    // Otra persona del equipo sin «Ver todo», tampoco.
    expect((await editar('gestoraA', t.id, { title: 'Otra vez' })).status).toBe(403);
    // El admin sí: la edita, la mueve y la reasigna.
    expect((await editar('adminA', t.id, { title: 'El admin sí' })).status).toBe(200);
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('adminA')).send({ status: 'en_curso' })).status).toBe(200);
    expect((await editar('adminA', t.id, { title: 'El admin sí', priority: 'media', assigned_to: U.gestoraA.id })).status).toBe(200);
    // Y la persona asignada, también.
    expect((await editar('gestoraA', t.id, { title: 'Ahora es mía' })).status).toBe(200);
  });

  it('cerrar o reabrir es de quien tiene «Aprobar y cerrar», aunque no la lleve', async () => {
    const t = await crear('adminA', { title: 'Para cerrar', assigned_to: U.gestoraA.id });
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('adminA')).send({ status: 'hecha' })).status).toBe(200);
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('adminA')).send({ status: 'en_curso' })).status).toBe(200);
  });

  it('sin tasks.create no se crea; sin tasks.view_own no se ve el tablero; sin tasks.edit no se edita', async () => {
    const t = await crear('adminA', { title: 'De la del rol a medida', assigned_to: U.medida.id });
    try {
      for (const [accion, valor] of [['create', false], ['view_own', false], ['edit', false]]) {
        await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'tasks', $2, $3)`,
          [U.medida.id, accion, valor]);
      }
      expect((await request.post('/api/tasks').set(como('medida')).send({ title: 'No' })).status).toBe(403);
      expect((await request.get('/api/tasks').set(como('medida'))).status).toBe(403);
      expect((await editar('medida', t.id, { title: 'No' })).status).toBe(403);
    } finally {
      await q('DELETE FROM user_permission_overrides WHERE user_id = $1', [U.medida.id]);
    }
    expect((await editar('medida', t.id, { title: 'Ahora sí' })).status).toBe(200);
  });
});

describe('C · Configuración › Roles: permisos de Tareas por rol', () => {
  it('los cambian el superadmin y el admin; soporte, gestora y colaborador, 403', async () => {
    for (const clave of ['soporte', 'gestoraA', 'colaborador']) {
      expect((await permisosDeRol(clave, 'colaborador', { 'tasks.close': false })).status).toBe(403);
      expect((await request.get('/api/permissions/role-permissions/colaborador').set(como(clave))).status).toBe(403);
    }
    for (const clave of ['superadmin', 'adminA']) {
      const res = await request.get('/api/permissions/role-permissions/colaborador').set(como(clave));
      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data.permissions).sort()).toEqual(['tasks.close', 'tasks.manage']);
    }
  });

  it('solo «Aprobar y cerrar» y «Configurar»; otra clave, un valor que no es sí/no, o superadmin o tutor: 400', async () => {
    expect((await permisosDeRol('superadmin', 'colaborador', { 'tasks.view_all': true })).status).toBe(400);
    expect((await permisosDeRol('superadmin', 'colaborador', { 'leads.view': true })).status).toBe(400);
    expect((await permisosDeRol('superadmin', 'colaborador', { 'tasks.close': 'si' })).status).toBe(400);
    expect((await permisosDeRol('superadmin', 'colaborador', {})).status).toBe(400);
    expect((await permisosDeRol('superadmin', 'superadmin', { 'tasks.close': false })).status).toBe(400);
    expect((await permisosDeRol('superadmin', 'tutor', { 'tasks.close': true })).status).toBe(400);
  });

  it('un rol del sistema: darle «Aprobar y cerrar» hace que apruebe, y /auth/me lo refleja', async () => {
    const t = await crear('adminA', { title: 'A revisar por el PM', assigned_to: U.gestoraA.id });
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('gestoraA')).send({ status: 'en_revision' })).status).toBe(200);
    try {
      expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('pm'))).status).toBe(403);

      // Lo cambia el admin: Diego (26/10), «los admin siguen pudiendo», y él
      // tiene «Aprobar y cerrar» (nadie le pone a un rol lo que no tiene).
      const res = await permisosDeRol('adminA', 'colaborador', { 'tasks.close': true });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.permissions['tasks.close']).toBe(true);
      // Solo se guarda lo que se aparta del código.
      expect(await q(`SELECT action, allowed, updated_by FROM role_permission_overrides WHERE role = 'colaborador'`))
        .toEqual([{ action: 'close', allowed: true, updated_by: U.adminA.id }]);

      const me = await request.get('/api/auth/me').set(como('pm'));
      expect(me.body.data.permissions['tasks.close']).toBe(true);
      expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('pm'))).status).toBe(200);

      // Volver a dejarlo como el código borra la fila.
      expect((await permisosDeRol('superadmin', 'colaborador', { 'tasks.close': false })).status).toBe(200);
      expect(await q(`SELECT 1 FROM role_permission_overrides WHERE role = 'colaborador'`)).toEqual([]);
    } finally {
      await q(`DELETE FROM role_permission_overrides WHERE role = 'colaborador'`);
    }
  });

  it('un rol a medida: se fusiona en su JSON sin tocar sus otras claves', async () => {
    const roleKey = `custom:${P.rolMedida}`;
    const antes = await request.get(`/api/permissions/role-permissions/${roleKey}`).set(como('superadmin'));
    expect(antes.status).toBe(200);
    expect(antes.body.data.permissions['tasks.manage']).toBe(false);

    expect((await permisosDeRol('superadmin', roleKey, { 'tasks.manage': true })).status).toBe(200);
    const { permissions } = await one('SELECT permissions FROM custom_roles WHERE id = $1', [P.rolMedida]);
    expect(permissions).toEqual({ 'leads.view': true, 'tasks.manage': true });
    expect((await request.post('/api/tasks/columns').set(como('medida'))
      .send({ key: `col_${MARCA.toLowerCase()}`, name: 'Medida' })).status).toBe(201);
    await q('DELETE FROM task_columns WHERE key = $1', [`col_${MARCA.toLowerCase()}`]);
  });

  it('un rol a medida que no existe: 400', async () => {
    expect((await permisosDeRol('superadmin', 'custom:999999999', { 'tasks.close': true })).status).toBe(400);
  });
});

describe('D · acotado por empresa', () => {
  let deC;
  let deColaborador;

  beforeAll(async () => {
    deC = await crear('adminC', { title: 'De la empresa DOS', assigned_to: U.gestoraC.id });
    deColaborador = await crear('colaborador', { title: 'Del colaborador sin campus' });
  });

  it('el admin de UNO no ve las tareas de la gente de DOS, y sí las del colaborador sin campus', async () => {
    const res = await request.get('/api/tasks').set(como('adminA'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const vistas = res.body.data.map((t) => t.id);
    expect(vistas).not.toContain(deC.id);
    expect(vistas).toContain(deColaborador.id);
  });

  it('abrir, editar o aprobar una tarea de DOS es 404 para el admin de UNO', async () => {
    expect((await request.get(`/api/tasks/${deC.id}`).set(como('adminA'))).status).toBe(404);
    expect((await editar('adminA', deC.id, { title: 'No' })).status).toBe(404);
    expect((await request.patch(`/api/tasks/${deC.id}/approve`).set(como('adminA'))).status).toBe(404);
  });

  it('la tarea del colaborador sin campus la ven todos; la editan el admin y él, nadie más', async () => {
    expect((await request.get(`/api/tasks/${deColaborador.id}`).set(como('adminC'))).status).toBe(200);
    expect((await request.get(`/api/tasks/${deColaborador.id}`).set(como('adminA'))).status).toBe(200);
    expect((await editar('adminA', deColaborador.id, { title: 'El admin sí' })).status).toBe(200);
    expect((await editar('colaborador', deColaborador.id, { title: 'Yo también' })).status).toBe(200);
  });

  it('el admin de UNO solo asigna a gente de sus campus; a un colaborador sin campus, solo el superadmin', async () => {
    expect((await request.post('/api/tasks').set(como('adminA')).send({ title: 'Para DOS', assigned_to: U.gestoraC.id })).status).toBe(403);
    expect((await request.post('/api/tasks').set(como('adminA')).send({ title: 'Para el colaborador', assigned_to: U.colaborador.id })).status).toBe(403);
    await crear('adminA', { title: 'Para la gestora de UNO', assigned_to: U.gestoraA.id });
    await crear('superadmin', { title: 'Del superadmin al colaborador', assigned_to: U.colaborador.id });
    // Reasignar tampoco: el admin no se la pasa al colaborador.
    const suya = await crear('adminA', { title: 'Del admin', assigned_to: U.gestoraA.id });
    expect((await editar('adminA', suya.id, { assigned_to: U.colaborador.id })).status).toBe(403);

    const personas = (await request.get('/api/tasks/assignees').set(como('adminA'))).body.data;
    const de = (id) => personas.find((u) => u.id === id);
    expect(de(U.gestoraA.id)?.asignable).toBe(true);
    // El colaborador sale (su tablero se ve), pero no se le puede asignar.
    expect(de(U.colaborador.id)?.asignable).toBe(false);
    expect(de(U.gestoraC.id)).toBeUndefined();
    const delSuper = (await request.get('/api/tasks/assignees').set(como('superadmin'))).body.data;
    expect(delSuper.find((u) => u.id === U.colaborador.id)?.asignable).toBe(true);
  });

  it('las métricas de «Todo el equipo» solo cuentan a gente de su empresa', async () => {
    const personas = (await request.get('/api/tasks/metrics').set(como('adminA'))).body.data.map((m) => m.user_id);
    expect(personas).toContain(U.gestoraA.id);
    expect(personas).not.toContain(U.gestoraC.id);
  });

  it('el superadmin lo ve todo, y con ?issuerId solo esa empresa (y los colaboradores)', async () => {
    const todo = (await request.get('/api/tasks').set(como('superadmin'))).body.data.map((t) => t.id);
    expect(todo).toContain(deC.id);
    const soloUno = await request.get(`/api/tasks?issuerId=${P.S_UNO}`).set(como('superadmin'));
    expect(soloUno.status).toBe(200);
    const ids1 = soloUno.body.data.map((t) => t.id);
    expect(ids1).not.toContain(deC.id);
    expect(ids1).toContain(deColaborador.id);
  });

  it('un admin que pide la empresa de otro no ve a su gente (como en el resto del CRM, #245)', async () => {
    const res = await request.get(`/api/tasks?issuerId=${P.S_DOS}`).set(como('adminA'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).not.toContain(deC.id);
    // Un campus suelto que no es suyo sí es 403.
    expect((await request.get(`/api/tasks?projectId=${P.C}`).set(como('adminA'))).status).toBe(403);
  });
});

describe('Fechas: los días son los de la oficina (Madrid), no los de la base (UTC)', () => {
  it('«desde / hasta el 14/10» coge lo que vence el 14/10 en Madrid, aunque en UTC sea otro día', async () => {
    // 14/10 a las 00:30 de Madrid = 13/10 22:30 UTC; 15/10 a las 00:30 de Madrid = 14/10 22:30 UTC.
    const primeraHora = await crear('gestoraA', { title: 'Vence el 14 a primera hora', due_date: '2026-10-13T22:30:00.000Z' });
    const ultimaHora = await crear('gestoraA', { title: 'Vence el 14 a las 23:59', due_date: '2026-10-14T21:59:00.000Z' });
    const delQuince = await crear('gestoraA', { title: 'Vence el 15 a primera hora', due_date: '2026-10-14T22:30:00.000Z' });
    const res = await request.get('/api/tasks?desde=2026-10-14&hasta=2026-10-14').set(como('gestoraA'));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((t) => t.id);
    expect(ids).toContain(primeraHora.id);
    expect(ids).toContain(ultimaHora.id);
    expect(ids).not.toContain(delQuince.id);
  });
});

describe('E · /api/tasks solo en pruebas', () => {
  // En ISEIE las pruebas viven en /staging (en MultiCRM, /testeo).
  it('en producción está apagado, salvo /staging o TAREAS_EN_PRODUCCION=1', () => {
    expect(tareasActivas({ NODE_ENV: 'test' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'development' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' })).toBe(false);
    expect(tareasActivas({ NODE_ENV: 'production' })).toBe(false);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging/' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/stagingx' })).toBe(false);
    expect(tareasActivas({ NODE_ENV: 'production', TAREAS_EN_PRODUCCION: '1' })).toBe(true);
  });
});

describe('F · el tablero es del equipo de desarrollo (Diego, 09/10)', () => {
  it('gestora, soporte y project manager no tienen tablero: 403', async () => {
    for (const clave of ['gestoraVentas', 'soporte', 'pmReal']) {
      expect((await request.get('/api/tasks').set(como(clave))).status, clave).toBe(403);
      expect((await request.post('/api/tasks').set(como(clave)).send({ title: 'No' })).status, clave).toBe(403);
    }
  });

  it('superadmin, admin y colaborador sí', async () => {
    for (const clave of ['superadmin', 'adminA', 'colaborador']) {
      expect((await request.get('/api/tasks').set(como(clave))).status, clave).toBe(200);
    }
  });

  it('gestora, soporte y project manager no reciben permisos de Tareas en su sesión (/auth/me)', async () => {
    for (const clave of ['gestoraVentas', 'soporte', 'pmReal']) {
      const { permissions } = (await request.get('/api/auth/me').set(como(clave))).body.data;
      const deTareas = Object.entries(permissions).filter(([k, v]) => k.startsWith('tasks.') && v === true);
      expect(deTareas, clave).toEqual([]);
    }
  });

  it('el correo de cada mañana no va a quien ya no tiene tablero, aunque tenga tareas de antes', async () => {
    const { findDailyDigest } = await import('../src/modules/tasks/tasks.model.js');
    // Una tarea vencida de antes de la decisión: de una gestora y de un colaborador.
    const ayer = new Date(Date.now() - 86400000).toISOString();
    const [deGestora, deColab] = await Promise.all([
      one(`INSERT INTO tasks (title, assigned_to, created_by, due_date) VALUES ($1, $2, $2, $3) RETURNING id`,
        ['Vieja de la gestora', U.gestoraVentas.id, ayer]),
      one(`INSERT INTO tasks (title, assigned_to, created_by, due_date) VALUES ($1, $2, $2, $3) RETURNING id`,
        ['Vieja del colaborador', U.colaborador.id, ayer]),
    ]);
    const hoy = new Date().toISOString().slice(0, 10);
    const gente = (await findDailyDigest('tareas_del_dia', hoy)).map((g) => g.user_id);
    expect(gente).not.toContain(U.gestoraVentas.id);
    expect(gente).toContain(U.colaborador.id);
    await q('DELETE FROM tasks WHERE id = ANY($1::int[])', [[deGestora.id, deColab.id]]);
  });

  it('en Roles solo se editan los permisos de Tareas del admin y del colaborador', async () => {
    for (const rol of ['admin', 'colaborador']) {
      expect((await request.get(`/api/permissions/role-permissions/${rol}`).set(como('superadmin'))).status, rol).toBe(200);
    }
    for (const rol of ['gestor', 'soporte', 'project_manager', 'tutor', 'superadmin']) {
      expect((await request.get(`/api/permissions/role-permissions/${rol}`).set(como('superadmin'))).status, rol).toBe(400);
    }
  });
});
