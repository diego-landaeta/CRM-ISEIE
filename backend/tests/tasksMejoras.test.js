import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * Tablero de tareas · correcciones del QA y mejoras (Diego, 07/10), contra la
 * base de verdad: «Por revisar», permisos por clave, columnas propias, áreas y
 * proyectos propios. Cada caso falla sin el código que lo arregla.
 *
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/tasksMejoras.test.js
 */

const request = supertest(app);
const MARCA = `TASKSMEJ_${Date.now().toString(36)}`;

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
let rolSinCierre;
let campus;
const creados = { columnas: [], areas: [], proyectos: [] };

async function persona(clave, role, extra = {}) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role, custom_role_id)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id, email, role, custom_role_id`,
    [`${MARCA} ${clave}`, `${clave}_${MARCA.toLowerCase()}@test.local`, role, extra.customRoleId ?? null]
  );
  U[clave] = u;
  T[clave] = jwt.sign(
    { userId: u.id, email: u.email, role, roles_extra: [], customRoleId: u.custom_role_id },
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

const mover = (clave, id, body) => request.patch(`/api/tasks/${id}/move`).set(como(clave)).send(body);

beforeAll(async () => {
  // Un campus con toda la gente de la prueba, como en el CRM de verdad: un
  // admin solo asigna a gente de sus campus (09/10).
  campus = await one(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} Campus`, `${MARCA.toLowerCase()}-campus`, `${MARCA}-campus`]
  );
  // Un rol a medida sobre «admin» al que en Configuración › Roles se le quitó
  // tasks.close: así se guarda desde esa pantalla.
  rolSinCierre = await one(
    `INSERT INTO custom_roles (label, base_role, permissions)
     VALUES ($1, 'admin', $2) RETURNING id`,
    [`${MARCA} sin cierre`, JSON.stringify({ 'tasks.close': false })]
  );

  await persona('admin', 'admin');
  await persona('adminSinCierre', 'admin', { customRoleId: rolSinCierre.id });
  await persona('adminVetado', 'admin');
  await persona('gestora', 'colaborador');
  await persona('gestoraConCierre', 'colaborador');
  await persona('colaborador', 'colaborador');
  await persona('colaborador2', 'colaborador');

  for (const u of Object.values(U)) {
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, campus.id]);
  }

  // Excepciones personales, como las guarda Configuración › Roles › Usuario.
  await q(
    `INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES
       ($1, 'tasks', 'close', false), ($2, 'tasks', 'close', true)`,
    [U.adminVetado.id, U.gestoraConCierre.id]
  );
});

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [ids]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [ids]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = $1', [campus.id]);
  await q('DELETE FROM custom_roles WHERE id = $1', [rolSinCierre.id]);
  await q('DELETE FROM task_columns WHERE id = ANY($1::int[])', [creados.columnas]);
  await q('DELETE FROM task_areas WHERE id = ANY($1::int[])', [creados.areas]);
  await q('DELETE FROM task_external_projects WHERE id = ANY($1::int[])', [creados.proyectos]);
  await pool.end();
});

describe('A · fechas: un texto que no es una fecha real es un 400, no un 500', () => {
  for (const malo of ['1', 'hola 2026', '2026-02-31']) {
    it(`due_date «${malo}»`, async () => {
      const res = await request.post('/api/tasks').set(como('gestora')).send({ title: 'Fecha', due_date: malo });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  }

  it('?desde=2026-02-31', async () => {
    const res = await request.get('/api/tasks?desde=2026-02-31').set(como('gestora'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('una fecha real sí vale', async () => {
    const t = await crear('gestora', { title: 'Fecha buena', due_date: '2026-02-28' });
    expect(t.due_date).not.toBeNull();
  });
});

describe('A · mover con una vecina que ya no está', () => {
  it('se coloca justo después de la que de verdad está antes de next_id', async () => {
    const a = await crear('colaborador', { title: 'A', status: 'en_curso' });
    const b = await crear('colaborador', { title: 'B', status: 'en_curso' });
    const c = await crear('colaborador', { title: 'C', status: 'en_curso' });
    const d = await crear('colaborador', { title: 'D', status: 'en_curso' });
    // La pantalla cree que D va entre A y C, pero A ya se fue a otra columna:
    // antes de C está B. Con next/2 saltaría por encima de B.
    expect((await mover('colaborador', a.id, { status: 'por_hacer' })).status).toBe(200);
    const res = await mover('colaborador', d.id, { status: 'en_curso', prev_id: a.id, next_id: c.id });
    expect(res.status).toBe(200);
    const orden = (await request.get('/api/tasks?status=en_curso').set(como('colaborador'))).body.data.map((t) => t.id);
    expect(orden).toEqual([b.id, d.id, c.id]);
  });
});

describe('A · etiquetas repetidas', () => {
  it('«Web» y «web» en la misma tarea son una sola etiqueta, y no cambia de color', async () => {
    const t = await crear('gestora', { title: 'Etiquetas' });
    const uno = await request.post(`/api/tasks/${t.id}/tags`).set(como('gestora')).send({ name: 'Web', color: 'sky' });
    const dos = await request.post(`/api/tasks/${t.id}/tags`).set(como('gestora')).send({ name: 'web', color: 'rose' });
    expect(uno.status).toBe(201);
    expect(dos.status).toBe(201);
    expect(dos.body.data.id).toBe(uno.body.data.id);
    const filas = await q('SELECT name, color FROM task_tags WHERE task_id = $1', [t.id]);
    expect(filas).toEqual([{ name: 'Web', color: 'sky' }]);
  });

  it('la base lo impide aunque se salte la API', async () => {
    const t = await crear('gestora', { title: 'Etiquetas en la base' });
    await q("INSERT INTO task_tags (task_id, name) VALUES ($1, 'SEO')", [t.id]);
    await expect(q("INSERT INTO task_tags (task_id, name) VALUES ($1, 'seo')", [t.id]))
      .rejects.toMatchObject({ code: '23505' });
  });
});

describe('A · el historial no se llena de reordenaciones', () => {
  it('reordenar dentro de la columna no guarda nada; cambiar de columna sí', async () => {
    const x = await crear('colaborador', { title: 'X' });
    const y = await crear('colaborador', { title: 'Y' });
    for (let i = 0; i < 5; i++) {
      expect((await mover('colaborador', y.id, { status: 'por_hacer', next_id: x.id })).status).toBe(200);
      expect((await mover('colaborador', x.id, { status: 'por_hacer', next_id: y.id })).status).toBe(200);
    }
    const contar = async () => (await one(
      "SELECT COUNT(*)::int n FROM task_events WHERE task_id = $1 AND event_type IN ('reordered', 'status_changed')", [x.id]
    )).n;
    expect(await contar()).toBe(0);
    await mover('colaborador', x.id, { status: 'en_curso' });
    expect(await contar()).toBe(1);
  });
});

describe('1 · Por revisar', () => {
  let paraAprobar;
  let paraDevolver;

  beforeAll(async () => {
    // 26/10/2026: «Por revisar» es de quien las supervisa (o del superadmin).
    paraAprobar = await crear('admin', { title: 'Revisar la home', assigned_to: U.colaborador.id, due_date: '2030-01-10', supervisor_id: U.admin.id });
    paraDevolver = await crear('admin', { title: 'Revisar el SEO', assigned_to: U.colaborador2.id, due_date: '2030-01-05', supervisor_id: U.admin.id });
    for (const t of [paraAprobar, paraDevolver]) {
      const quien = t.assigned_to === U.colaborador.id ? 'colaborador' : 'colaborador2';
      expect((await mover(quien, t.id, { status: 'en_revision' })).status).toBe(200);
    }
  });

  it('la lista trae las que supervisa, por fecha límite, con lo que hace falta para revisar', async () => {
    const res = await request.get('/api/tasks/review').set(como('admin'));
    expect(res.status).toBe(200);
    const mias = res.body.data.filter((t) => [paraAprobar.id, paraDevolver.id].includes(t.id));
    expect(mias.map((t) => t.id)).toEqual([paraDevolver.id, paraAprobar.id]);
    for (const k of ['assigned_to_name', 'area_name', 'project_name', 'external_project_name', 'due_date',
      'checklist_total', 'checklist_completed', 'last_comment']) {
      expect(mias[0]).toHaveProperty(k);
    }
  });

  it('el número para el selector y el menú', async () => {
    const res = await request.get('/api/tasks/review/count').set(como('admin'));
    expect(res.body.data.count).toBeGreaterThanOrEqual(2);
    const sinPermiso = await request.get('/api/tasks/review/count').set(como('gestora'));
    expect(sinPermiso.body.data.count).toBe(0);
  });

  it('aprobar la pasa a «Hecha» con su fecha de cierre y avisa a la persona', async () => {
    const res = await request.patch(`/api/tasks/${paraAprobar.id}/approve`).set(como('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('hecha');
    expect(res.body.data.completed_at).not.toBeNull();
    const aviso = await one(
      `SELECT type FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND type = 'task_aprobada' AND metadata->>'task_id' = $2`,
      [U.colaborador.id, String(paraAprobar.id)]
    );
    expect(aviso?.type).toBe('task_aprobada');
  });

  it('no se aprueba lo que no está en revisión', async () => {
    const res = await request.patch(`/api/tasks/${paraAprobar.id}/approve`).set(como('admin'));
    expect(res.status).toBe(409);
  });

  it('devolver sin comentario: 400', async () => {
    const res = await request.patch(`/api/tasks/${paraDevolver.id}/return`).set(como('admin')).send({ comment: '  ' });
    expect(res.status).toBe(400);
    expect((await one('SELECT status FROM tasks WHERE id = $1', [paraDevolver.id])).status).toBe('en_revision');
  });

  it('devolver la vuelve a «En curso», guarda el comentario y le llega a la persona con él', async () => {
    const motivo = 'Faltan los textos alternativos de las imágenes';
    const res = await request.patch(`/api/tasks/${paraDevolver.id}/return`).set(como('admin')).send({ comment: motivo });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('en_curso');
    const comentario = await one('SELECT content FROM task_comments WHERE task_id = $1 ORDER BY id DESC LIMIT 1', [paraDevolver.id]);
    expect(comentario.content).toBe(motivo);
    const aviso = await one(
      `SELECT type, message FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND type = 'task_devuelta' AND metadata->>'task_id' = $2`,
      [U.colaborador2.id, String(paraDevolver.id)]
    );
    expect(aviso).toMatchObject({ type: 'task_devuelta', message: motivo });
  });
});

describe('3 · permisos: aprobar es del supervisor (26/10/2026), no de la clave', () => {
  let t;
  beforeEach(async () => {
    t = await crear('admin', { title: `Permisos ${Math.random()}`, assigned_to: U.colaborador.id, supervisor_id: U.colaborador2.id });
    expect((await mover('colaborador', t.id, { status: 'en_revision' })).status).toBe(200);
  });

  it('quien no la supervisa no la aprueba ni la devuelve, tenga o no «Aprobar y cerrar»', async () => {
    for (const quien of ['gestora', 'gestoraConCierre', 'admin', 'adminSinCierre']) {
      expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como(quien))).status, quien).toBe(403);
      expect((await request.patch(`/api/tasks/${t.id}/return`).set(como(quien)).send({ comment: 'x' })).status, quien).toBe(403);
    }
    expect((await mover('gestora', t.id, { status: 'hecha' })).status).toBe(403);
    // «Por revisar» le sale vacío: no supervisa ninguna.
    const lista = await request.get('/api/tasks/review').set(como('gestora'));
    expect(lista.status).toBe(200);
    expect(lista.body.data.map((x) => x.id)).not.toContain(t.id);
  });

  it('el supervisor la aprueba aunque no tenga «Aprobar y cerrar»', async () => {
    expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('colaborador2'))).status).toBe(200);
  });

  it('quien la lleva, con «Aprobar y cerrar», la cierra arrastrando; sin ella, no', async () => {
    const suya = await crear('gestoraConCierre', { title: `Mía ${Math.random()}` });
    expect((await mover('gestoraConCierre', suya.id, { status: 'hecha' })).status).toBe(200);
    const otra = await crear('gestora', { title: `Mía ${Math.random()}` });
    expect((await mover('gestora', otra.id, { status: 'hecha' })).status).toBe(403);
  });

  it('sin tasks.manage no se configura el tablero', async () => {
    expect((await request.post('/api/tasks/columns').set(como('gestora'))
      .send({ key: 'nope', name: 'Nope' })).status).toBe(403);
    expect((await request.post('/api/tasks/areas').set(como('colaborador'))
      .send({ name: 'Nope' })).status).toBe(403);
  });
});

describe('2a · columnas propias', () => {
  let bloqueada;
  let tarea;

  it('se crea «Bloqueada» y una tarea se mueve a ella', async () => {
    const res = await request.post('/api/tasks/columns').set(como('admin'))
      .send({ key: `bloq_${MARCA.toLowerCase().slice(-6)}`, name: 'Bloqueada', color: 'rose' });
    expect(res.status).toBe(201);
    bloqueada = res.body.data;
    creados.columnas.push(bloqueada.id);
    tarea = await crear('colaborador', { title: 'Esperando al cliente' });
    const mov = await mover('colaborador', tarea.id, { status: bloqueada.key });
    expect(mov.status).toBe(200);
    expect(mov.body.data.status).toBe(bloqueada.key);
  });

  it('se renombra', async () => {
    const res = await request.patch(`/api/tasks/columns/${bloqueada.id}`).set(como('admin')).send({ name: 'Bloqueada (cliente)' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Bloqueada (cliente)');
  });

  it('no se archiva con tareas, ni por DELETE ni por PATCH', async () => {
    expect((await request.delete(`/api/tasks/columns/${bloqueada.id}`).set(como('admin'))).status).toBe(409);
    expect((await request.patch(`/api/tasks/columns/${bloqueada.id}`).set(como('admin')).send({ is_active: false })).status).toBe(409);
    expect((await one('SELECT is_active FROM task_columns WHERE id = $1', [bloqueada.id])).is_active).toBe(true);
  });

  it('vacía, sí se archiva, y ya no se puede mover nada a ella', async () => {
    await mover('colaborador', tarea.id, { status: 'por_hacer' });
    expect((await request.delete(`/api/tasks/columns/${bloqueada.id}`).set(como('admin'))).status).toBe(200);
    const res = await mover('colaborador', tarea.id, { status: bloqueada.key });
    expect(res.status).toBe(400);
  });

  it('las 4 fijas no se archivan', async () => {
    const hecha = await one("SELECT id FROM task_columns WHERE key = 'hecha'");
    expect((await request.delete(`/api/tasks/columns/${hecha.id}`).set(como('admin'))).status).toBe(400);
  });

  it('una columna que no existe es un 400, no un 500', async () => {
    const t = await crear('colaborador', { title: 'A ningún sitio' });
    expect((await mover('colaborador', t.id, { status: 'no_existe' })).status).toBe(400);
  });

  it('las tareas que ya había siguen en su columna: todas apuntan a una que existe', async () => {
    const huerfanas = await one(
      'SELECT COUNT(*)::int n FROM tasks t LEFT JOIN task_columns c ON c.key = t.status WHERE c.id IS NULL'
    );
    expect(huerfanas.n).toBe(0);
    const check = await one(
      "SELECT COUNT(*)::int n FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~* '\\mstatus\\M'"
    );
    expect(check.n).toBe(0);
  });
});

describe('2b · áreas', () => {
  let seo;

  it('se crea «SEO» y se ponen dos personas, sin tocar sus otras áreas', async () => {
    const res = await request.post('/api/tasks/areas').set(como('admin')).send({ name: `SEO ${MARCA}`, color: 'green' });
    expect(res.status).toBe(201);
    seo = res.body.data;
    creados.areas.push(seo.id);
    const meta = await one("SELECT id FROM task_areas WHERE name = 'Meta'");
    await q('INSERT INTO user_task_areas (user_id, area_id) VALUES ($1, $2)', [U.colaborador.id, meta.id]);

    const miembros = await request.put(`/api/tasks/areas/${seo.id}/members`).set(como('admin'))
      .send({ user_ids: [U.colaborador.id, U.colaborador2.id] });
    expect(miembros.status).toBe(200);
    expect(miembros.body.data.sort()).toEqual([U.colaborador.id, U.colaborador2.id].sort());
    const deLaPrimera = await q('SELECT area_id FROM user_task_areas WHERE user_id = $1 ORDER BY area_id', [U.colaborador.id]);
    expect(deLaPrimera.map((r) => r.area_id)).toEqual([meta.id, seo.id].sort((a, b) => a - b));
  });

  it('un nombre repetido es un 409', async () => {
    const res = await request.post('/api/tasks/areas').set(como('admin')).send({ name: `SEO ${MARCA}` });
    expect(res.status).toBe(409);
  });

  it('un área nueva va al final de la lista, no delante de Meta', async () => {
    const lista = (await request.get('/api/tasks/areas').set(como('admin'))).body.data;
    expect(lista[lista.length - 1].id).toBe(seo.id);
    const meta = lista.find((a) => a.name === 'Meta');
    expect(seo.sort_order).toBeGreaterThan(meta.sort_order);
  });

  it('se filtra el tablero por área y se agrupan las métricas por área', async () => {
    const t = await crear('admin', { title: 'Del área SEO', assigned_to: U.colaborador.id, area_id: seo.id });
    const lista = await request.get(`/api/tasks?area_id=${seo.id}`).set(como('admin'));
    expect(lista.body.data.map((x) => x.id)).toEqual([t.id]);
    const metricas = await request.get('/api/tasks/metrics/areas').set(como('admin'));
    expect(metricas.status).toBe(200);
    expect(metricas.body.data.find((m) => m.area_id === seo.id)).toMatchObject({ open_tasks: 1, people: 2 });
  });

  it('se renombra y se archiva; archivada no se puede usar en una tarea', async () => {
    expect((await request.patch(`/api/tasks/areas/${seo.id}`).set(como('admin')).send({ name: `SEO+ ${MARCA}` })).status).toBe(200);
    expect((await request.patch(`/api/tasks/areas/${seo.id}`).set(como('admin')).send({ is_active: false })).status).toBe(200);
    const res = await request.post('/api/tasks').set(como('admin')).send({ title: 'x', area_id: seo.id });
    expect(res.status).toBe(400);
  });
});

describe('2c · proyectos propios', () => {
  let opynio;

  it('se crea «Opynio», con su URL, y una tarea se filtra por él', async () => {
    const res = await request.post('/api/tasks/external-projects').set(como('admin'))
      .send({ name: `Opynio ${MARCA}`, url: 'https://opynio.com', color: 'purple' });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toBe('https://opynio.com');
    opynio = res.body.data;
    creados.proyectos.push(opynio.id);
    const t = await crear('colaborador', { title: 'Landing de Opynio', external_project_id: opynio.id });
    const lista = await request.get(`/api/tasks?external_project_id=${opynio.id}`).set(como('colaborador'));
    expect(lista.body.data.map((x) => x.id)).toEqual([t.id]);
  });

  it('campus y proyecto propio a la vez: 400 por la API y CHECK en la base', async () => {
    const campus = await one('SELECT id FROM projects ORDER BY id LIMIT 1');
    const res = await request.post('/api/tasks').set(como('admin'))
      .send({ title: 'Los dos', project_id: campus.id, external_project_id: opynio.id });
    expect(res.status).toBe(400);
    await expect(q(
      `INSERT INTO tasks (title, created_by, project_id, external_project_id) VALUES ('Los dos', $1, $2, $3)`,
      [U.admin.id, campus.id, opynio.id]
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('elegir un proyecto propio en una tarea con campus le quita el campus, sin chocar', async () => {
    const campus = await one('SELECT id FROM projects ORDER BY id LIMIT 1');
    const t = await crear('admin', { title: 'Cambia de proyecto' });
    await q('UPDATE tasks SET project_id = $1 WHERE id = $2', [campus.id, t.id]);
    const res = await request.patch(`/api/tasks/${t.id}`).set(como('admin')).send({ external_project_id: opynio.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ project_id: null, external_project_id: opynio.id });
  });

  it('se reordena: el orden decide cómo salen en la lista', async () => {
    const otro = await request.post('/api/tasks/external-projects').set(como('admin')).send({ name: `Web nueva ${MARCA}` });
    expect(otro.status).toBe(201);
    creados.proyectos.push(otro.body.data.id);
    expect(otro.body.data.sort_order).toBeGreaterThan(opynio.sort_order ?? 0);
    expect((await request.patch(`/api/tasks/external-projects/${otro.body.data.id}`).set(como('admin'))
      .send({ sort_order: 0 })).status).toBe(200);
    const ids = (await request.get('/api/tasks/external-projects').set(como('admin'))).body.data.map((p) => p.id);
    expect(ids.indexOf(otro.body.data.id)).toBeLessThan(ids.indexOf(opynio.id));
  });

  it('una URL que no es http(s): 400', async () => {
    const res = await request.post('/api/tasks/external-projects').set(como('admin'))
      .send({ name: `Malo ${MARCA}`, url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });
});
