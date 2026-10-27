import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * El tablero de tareas (#210) contra la base de verdad.
 *
 * Crea un proyecto y una persona de cada rol, prueba por HTTP lo que puede y
 * no puede hacer cada una, y lo borra todo al final. Cada `expect` se ejecuta
 * siempre: si el backend falla, la prueba falla.
 *
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/tasks.test.js
 */

const request = supertest(app);
const MARCA = `TASKSTEST_${Date.now().toString(36)}`;

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};      // personas de prueba, por rol
const T = {};      // tokens
let proyecto;
let otroProyecto;  // un proyecto en el que nadie de la prueba esta

function token(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      roles_extra: [],
      customRoleId: null,
      activeProjectId: proyecto.id,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function crearPersona(clave, role) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role)
     VALUES ($1, $2, 'x', $3) RETURNING id, nombre, email, role`,
    [`${MARCA} ${clave}`, `${clave}_${MARCA.toLowerCase()}@test.local`, role]
  );
  U[clave] = u;
  T[clave] = token(u);
}

const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });

/** Crea una tarea por la API y devuelve la tarjeta. */
async function crear(clave, body) {
  const res = await request.post('/api/tasks').set(como(clave)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  proyecto = await one(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} Proyecto`, `${MARCA.toLowerCase()}-a`, `${MARCA}-key-a`]
  );
  otroProyecto = await one(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} Otro`, `${MARCA.toLowerCase()}-b`, `${MARCA}-key-b`]
  );

  await crearPersona('admin', 'admin');
  await crearPersona('superadmin', 'superadmin');
  await crearPersona('gestora', 'colaborador');
  await crearPersona('otraGestora', 'colaborador');
  await crearPersona('colaborador', 'colaborador');
  await crearPersona('tutor', 'tutor');

  // Todos en un campus, como en el CRM de verdad: un admin solo asigna a gente
  // de sus campus (a un colaborador sin campus, solo el superadmin; 09/10).
  for (const clave of ['admin', 'gestora', 'otraGestora', 'colaborador']) {
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [U[clave].id, proyecto.id]);
  }
});

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [ids]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [ids]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [[proyecto.id, otroProyecto.id]]);
  await pool.end();
});

describe('quien entra al tablero', () => {
  it('sin sesion: 401', async () => {
    const res = await request.get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('el tutor no tiene tablero: 403', async () => {
    const res = await request.get('/api/tasks').set(como('tutor'));
    expect(res.status).toBe(403);
  });

  it('el colaborador si: 200', async () => {
    const res = await request.get('/api/tasks').set(como('colaborador'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('el colaborador no llega a prospectos, ventas ni usuarios aunque la ruta solo pida token', async () => {
    for (const ruta of ['/api/leads', '/api/conversions', '/api/users']) {
      const res = await request.get(ruta).set(como('colaborador'));
      expect(res.status, ruta).toBe(403);
    }
  });

  it('el colaborador si llega a sus avisos y a sus preferencias', async () => {
    const res = await request.get('/api/users/mis-avisos').set(como('colaborador'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.aviso)).toEqual(expect.arrayContaining(['tarea_asignada', 'tareas_del_dia']));
  });
});

describe('crear y asignar', () => {
  it('una gestora se crea una tarea: queda para ella, en «Por hacer»', async () => {
    const t = await crear('gestora', { title: 'Preparar informe', priority: 'alta', project_id: proyecto.id });
    expect(t.assigned_to).toBe(U.gestora.id);
    expect(t.created_by).toBe(U.gestora.id);
    expect(t.status).toBe('por_hacer');
    expect(t.project_name).toBe(`${MARCA} Proyecto`);
    expect(typeof t.position).toBe('number');
  });

  it('una gestora no puede asignar a otra persona: 403', async () => {
    const res = await request.post('/api/tasks').set(como('gestora'))
      .send({ title: 'Para otra', assigned_to: U.otraGestora.id });
    expect(res.status).toBe(403);
  });

  it('nadie salvo admin crea una tarea ya «Hecha»: 403', async () => {
    const res = await request.post('/api/tasks').set(como('gestora'))
      .send({ title: 'Ya cerrada', status: 'hecha' });
    expect(res.status).toBe(403);
  });

  it('el admin asigna a una gestora, y a ella le suena la campana', async () => {
    const t = await crear('admin', { title: 'Revisar la web', assigned_to: U.gestora.id });
    expect(t.assigned_to).toBe(U.gestora.id);
    const aviso = await one(
      `SELECT type FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND metadata->>'task_id' = $2`,
      [U.gestora.id, String(t.id)]
    );
    expect(aviso?.type).toBe('task_asignada');
  });

  it('no se asigna a quien no tiene tablero (un tutor): 400', async () => {
    const res = await request.post('/api/tasks').set(como('admin'))
      .send({ title: 'Para el tutor', assigned_to: U.tutor.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('una fecha que no es fecha: 400 VALIDATION_ERROR, no 500', async () => {
    const res = await request.post('/api/tasks').set(como('gestora'))
      .send({ title: 'Con fecha rara', due_date: 'mañana por la tarde' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('un id que no es numero: 400', async () => {
    const res = await request.get('/api/tasks/abc').set(como('gestora'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('un proyecto que no es de sus campus: 403', async () => {
    const res = await request.post('/api/tasks').set(como('gestora'))
      .send({ title: 'En otro campus', project_id: otroProyecto.id });
    expect(res.status).toBe(403);
  });
});

describe('cada uno ve su tablero', () => {
  let deLaOtra;

  beforeAll(async () => {
    deLaOtra = await crear('otraGestora', { title: 'Tarea de la otra gestora' });
  });

  it('la gestora no ve las de otra, aunque las pida por persona', async () => {
    const res = await request.get(`/api/tasks?assigned_to=${U.otraGestora.id}`).set(como('gestora'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).not.toContain(deLaOtra.id);
    expect(res.body.data.every((t) => t.assigned_to === U.gestora.id)).toBe(true);
  });

  it('ni la abre, ni la mueve, ni la archiva: 403', async () => {
    expect((await request.get(`/api/tasks/${deLaOtra.id}`).set(como('gestora'))).status).toBe(403);
    expect((await request.patch(`/api/tasks/${deLaOtra.id}/move`).set(como('gestora'))
      .send({ status: 'en_curso' })).status).toBe(403);
    expect((await request.delete(`/api/tasks/${deLaOtra.id}`).set(como('gestora'))).status).toBe(403);
  });

  it('el admin ve la de cualquiera eligiendo persona', async () => {
    const res = await request.get(`/api/tasks?assigned_to=${U.otraGestora.id}`).set(como('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.id)).toContain(deLaOtra.id);
  });
});

describe('mover: la regla de «Hecha» (decision 4)', () => {
  let t;

  beforeAll(async () => {
    // 26/10/2026: cerrar y reabrir es del supervisor de la tarea (o del superadmin).
    t = await crear('admin', { title: 'Tarea para cerrar', assigned_to: U.gestora.id, supervisor_id: U.admin.id });
  });

  it('la gestora la lleva hasta «En revisión», y a quien la creo le avisa', async () => {
    const res = await request.patch(`/api/tasks/${t.id}/move`).set(como('gestora')).send({ status: 'en_revision' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('en_revision');
    expect(res.body.data.completed_at).toBeNull();

    const aviso = await one(
      `SELECT type FROM admin_notifications
        WHERE $1 = ANY(target_user_ids) AND type = 'task_estado_cambiado' AND metadata->>'task_id' = $2`,
      [U.admin.id, String(t.id)]
    );
    expect(aviso?.type).toBe('task_estado_cambiado');
  });

  it('la gestora no puede pasarla a «Hecha»: 403', async () => {
    const res = await request.patch(`/api/tasks/${t.id}/move`).set(como('gestora')).send({ status: 'hecha' });
    expect(res.status).toBe(403);
  });

  it('el admin, que la supervisa, la cierra y se guarda la fecha de cierre', async () => {
    const res = await request.patch(`/api/tasks/${t.id}/move`).set(como('admin')).send({ status: 'hecha' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('hecha');
    expect(res.body.data.completed_at).not.toBeNull();
  });

  it('la gestora no puede reabrirla: 403', async () => {
    const res = await request.patch(`/api/tasks/${t.id}/move`).set(como('gestora')).send({ status: 'en_curso' });
    expect(res.status).toBe(403);
  });

  it('el admin, que la supervisa, la devuelve a «En curso» y la fecha de cierre se vacia', async () => {
    const res = await request.patch(`/api/tasks/${t.id}/move`).set(como('admin')).send({ status: 'en_curso' });
    expect(res.status).toBe(200);
    expect(res.body.data.completed_at).toBeNull();
  });

  it('el historial lo cuenta todo, con quien y cuando', async () => {
    const res = await request.get(`/api/tasks/${t.id}`).set(como('admin'));
    const tipos = res.body.data.events.map((e) => e.event_type);
    expect(tipos.filter((x) => x === 'status_changed')).toHaveLength(3);
    expect(tipos).toContain('created');
    expect(res.body.data.events.every((e) => e.user_name && e.created_at)).toBe(true);
  });
});

describe('ordenar dentro de una columna', () => {
  let a; let b; let c;

  const orden = async () => {
    const res = await request.get('/api/tasks?status=en_curso').set(como('colaborador'));
    expect(res.status).toBe(200);
    return res.body.data.map((t) => t.id);
  };

  beforeAll(async () => {
    a = await crear('colaborador', { title: 'A', status: 'en_curso' });
    b = await crear('colaborador', { title: 'B', status: 'en_curso' });
    c = await crear('colaborador', { title: 'C', status: 'en_curso' });
  });

  it('las nuevas van al final', async () => {
    expect(await orden()).toEqual([a.id, b.id, c.id]);
  });

  it('soltar C entre A y B la deja en medio sin tocar las demas', async () => {
    const antes = await q('SELECT id, position FROM tasks WHERE id = ANY($1::int[])', [[a.id, b.id]]);
    const res = await request.patch(`/api/tasks/${c.id}/move`).set(como('colaborador'))
      .send({ status: 'en_curso', prev_id: a.id, next_id: b.id });
    expect(res.status).toBe(200);
    expect(res.body.data.position).toBeGreaterThan(a.position);
    expect(res.body.data.position).toBeLessThan(b.position);
    expect(await orden()).toEqual([a.id, c.id, b.id]);
    const despues = await q('SELECT id, position FROM tasks WHERE id = ANY($1::int[])', [[a.id, b.id]]);
    expect(despues).toEqual(expect.arrayContaining(antes));
  });

  it('soltar muchas veces en el mismo hueco renumera y no rompe el orden', async () => {
    // Alterna C y B entre A y la otra: cada vez el hueco se parte por la mitad.
    let [x, y] = [b, c];
    for (let i = 0; i < 20; i++) {
      const res = await request.patch(`/api/tasks/${x.id}/move`).set(como('colaborador'))
        .send({ status: 'en_curso', prev_id: a.id, next_id: y.id });
      expect(res.status).toBe(200);
      [x, y] = [y, x];
    }
    const filas = await q('SELECT position FROM tasks WHERE id = ANY($1::int[]) ORDER BY position', [[a.id, b.id, c.id]]);
    const posiciones = filas.map((f) => Number(f.position));
    expect(new Set(posiciones).size).toBe(3);
    expect((await orden())[0]).toBe(a.id);
  });

  it('a la primera posicion de otra columna', async () => {
    const res = await request.patch(`/api/tasks/${b.id}/move`).set(como('colaborador'))
      .send({ status: 'en_revision' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('en_revision');
  });
});

describe('la tarjeta completa', () => {
  let mia;
  let ajena;

  beforeAll(async () => {
    mia = await crear('gestora', { title: 'Tarjeta completa' });
    ajena = await crear('otraGestora', { title: 'Tarjeta ajena' });
  });

  it('lista de comprobacion: añadir y marcar, con su avance', async () => {
    const add = await request.post(`/api/tasks/${mia.id}/checklist`).set(como('gestora')).send({ title: 'Paso 1' });
    expect(add.status).toBe(201);
    await request.post(`/api/tasks/${mia.id}/checklist`).set(como('gestora')).send({ title: 'Paso 2' });
    const tick = await request.patch(`/api/tasks/${mia.id}/checklist/${add.body.data.id}`)
      .set(como('gestora')).send({ is_completed: true });
    expect(tick.status).toBe(200);
    expect(tick.body.data.is_completed).toBe(true);

    const lista = await request.get('/api/tasks').set(como('gestora'));
    const tarjeta = lista.body.data.find((t) => t.id === mia.id);
    expect(tarjeta.checklist_total).toBe(2);
    expect(tarjeta.checklist_completed).toBe(1);
  });

  it('no se toca un elemento de otra tarea poniendo una tarea propia en la URL: 404', async () => {
    const suyo = await request.post(`/api/tasks/${ajena.id}/checklist`).set(como('otraGestora')).send({ title: 'De la otra' });
    expect(suyo.status).toBe(201);

    const edit = await request.patch(`/api/tasks/${mia.id}/checklist/${suyo.body.data.id}`)
      .set(como('gestora')).send({ title: 'Cambiado' });
    expect(edit.status).toBe(404);
    const del = await request.delete(`/api/tasks/${mia.id}/checklist/${suyo.body.data.id}`).set(como('gestora'));
    expect(del.status).toBe(404);

    const sigue = await one('SELECT title FROM task_checklist_items WHERE id = $1', [suyo.body.data.id]);
    expect(sigue.title).toBe('De la otra');
  });

  it('etiquetas: añadir, y no borrar la de otra tarea', async () => {
    const mine = await request.post(`/api/tasks/${mia.id}/tags`).set(como('gestora')).send({ name: 'Urgente', color: 'rose' });
    expect(mine.status).toBe(201);
    const suya = await request.post(`/api/tasks/${ajena.id}/tags`).set(como('otraGestora')).send({ name: 'Suya' });
    expect(suya.status).toBe(201);

    const del = await request.delete(`/api/tasks/${mia.id}/tags/${suya.body.data.id}`).set(como('gestora'));
    expect(del.status).toBe(404);
    expect(await one('SELECT id FROM task_tags WHERE id = $1', [suya.body.data.id])).toBeTruthy();
  });

  it('un color de etiqueta que no existe: 400', async () => {
    const res = await request.post(`/api/tasks/${mia.id}/tags`).set(como('gestora')).send({ name: 'X', color: 'url(evil)' });
    expect(res.status).toBe(400);
  });

  it('enlaces: http(s) si, «javascript:» no', async () => {
    const ok = await request.post(`/api/tasks/${mia.id}/links`).set(como('gestora'))
      .send({ url: 'https://github.com/diego-landaeta/CRM/issues/210', title: 'La issue' });
    expect(ok.status).toBe(201);
    const malo = await request.post(`/api/tasks/${mia.id}/links`).set(como('gestora'))
      .send({ url: 'javascript:alert(1)' });
    expect(malo.status).toBe(400);
  });

  it('comentarios: la otra persona no borra el tuyo, tu si', async () => {
    const admin = await crear('admin', { title: 'Con comentarios', assigned_to: U.gestora.id });
    const c = await request.post(`/api/tasks/${admin.id}/comments`).set(como('gestora')).send({ content: 'Hecho el primer paso' });
    expect(c.status).toBe(201);

    const aviso = await one(
      `SELECT type FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND type = 'task_comentario' AND metadata->>'task_id' = $2`,
      [U.admin.id, String(admin.id)]
    );
    expect(aviso?.type).toBe('task_comentario');

    const ajenoBorra = await request.delete(`/api/tasks/${ajena.id}/comments/${c.body.data.id}`).set(como('otraGestora'));
    expect(ajenoBorra.status).toBe(404);
    const borra = await request.delete(`/api/tasks/${admin.id}/comments/${c.body.data.id}`).set(como('gestora'));
    expect(borra.status).toBe(200);
  });

  it('al abrirla trae todo: lista, comentarios, etiquetas, enlaces e historial', async () => {
    const res = await request.get(`/api/tasks/${mia.id}`).set(como('gestora'));
    expect(res.status).toBe(200);
    expect(res.body.data.checklist).toHaveLength(2);
    expect(res.body.data.tags.map((t) => t.name)).toEqual(['Urgente']);
    expect(res.body.data.links).toHaveLength(1);
    expect(res.body.data.events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['created', 'checklist', 'tag', 'link'])
    );
  });
});

describe('filtros del tablero', () => {
  let vencida;
  let conFecha;

  beforeAll(async () => {
    vencida = await crear('gestora', { title: 'Vencida', due_date: '2020-01-15T10:00:00.000Z' });
    conFecha = await crear('gestora', { title: 'Del 31', due_date: '2099-10-31T18:00:00.000Z' });
  });

  it('solo vencidas', async () => {
    const res = await request.get('/api/tasks?vencidas=true').set(como('gestora'));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((t) => t.id);
    expect(ids).toContain(vencida.id);
    expect(ids).not.toContain(conFecha.id);
  });

  it('«vencidas=false» no filtra (no es «true» por ser texto)', async () => {
    const res = await request.get('/api/tasks?vencidas=false').set(como('gestora'));
    expect(res.body.data.map((t) => t.id)).toEqual(expect.arrayContaining([vencida.id, conFecha.id]));
  });

  it('rango de fechas, con el ultimo dia entero', async () => {
    const res = await request.get('/api/tasks?desde=2099-10-01&hasta=2099-10-31').set(como('gestora'));
    expect(res.body.data.map((t) => t.id)).toEqual([conFecha.id]);
  });

  it('un rango al reves: 400', async () => {
    const res = await request.get('/api/tasks?desde=2099-11-01&hasta=2099-10-01').set(como('gestora'));
    expect(res.status).toBe(400);
  });

  it('por etiqueta, sin distinguir mayusculas', async () => {
    const res = await request.get('/api/tasks?tag=urgente').set(como('gestora'));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((t) => t.tags.some((g) => g.name.toLowerCase() === 'urgente'))).toBe(true);
  });

  it('las etiquetas para el filtro son solo las de su tablero', async () => {
    const res = await request.get('/api/tasks/tags').set(como('gestora'));
    expect(res.status).toBe(200);
    const nombres = res.body.data.map((t) => t.name);
    expect(nombres).toContain('Urgente');
    expect(nombres).not.toContain('Suya');
  });
});

describe('todo el equipo', () => {
  it('el admin ve por persona abiertas, vencidas y cerradas', async () => {
    const res = await request.get(`/api/tasks/metrics?project_id=${proyecto.id}`).set(como('admin'));
    expect(res.status).toBe(200);
    const fila = (await request.get('/api/tasks/metrics').set(como('admin'))).body.data
      .find((m) => m.user_id === U.gestora.id);
    expect(fila.open_tasks).toBeGreaterThan(0);
    expect(fila.overdue_tasks).toBeGreaterThanOrEqual(1);
    expect(fila).toHaveProperty('completed_this_week');
    expect(fila).toHaveProperty('completed_this_month');
  });

  it('el colaborador sale en el equipo; el tutor no', async () => {
    const res = await request.get('/api/tasks/metrics').set(como('admin'));
    const ids = res.body.data.map((m) => m.user_id);
    expect(ids).toContain(U.colaborador.id);
    expect(ids).not.toContain(U.tutor.id);
  });

  it('una gestora no ve las metricas del equipo: 403', async () => {
    const res = await request.get('/api/tasks/metrics').set(como('gestora'));
    expect(res.status).toBe(403);
  });

  it('a quien se puede asignar: solo quien tiene tablero', async () => {
    const res = await request.get('/api/tasks/assignees').set(como('admin'));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([U.gestora.id, U.colaborador.id]));
    expect(ids).not.toContain(U.tutor.id);
  });

  it('el colaborador no pide la lista del equipo: 403', async () => {
    const res = await request.get('/api/tasks/assignees').set(como('colaborador'));
    expect(res.status).toBe(403);
  });
});

describe('archivar', () => {
  it('archivar no borra: la tarea sale del tablero y no se abre', async () => {
    const t = await crear('admin', { title: 'Para archivar', assigned_to: U.gestora.id });
    const res = await request.delete(`/api/tasks/${t.id}`).set(como('admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.archived_at).not.toBeNull();

    expect((await request.get(`/api/tasks/${t.id}`).set(como('admin'))).status).toBe(404);
    const lista = await request.get(`/api/tasks?assigned_to=${U.gestora.id}&incluir_archivadas=false`).set(como('admin'));
    expect(lista.body.data.map((x) => x.id)).not.toContain(t.id);
    expect(await one('SELECT id FROM tasks WHERE id = $1', [t.id])).toBeTruthy();
  });

  it('una tarea cerrada y luego archivada sigue contando como cerrada esta semana', async () => {
    const fila = async () => (await request.get('/api/tasks/metrics').set(como('admin'))).body.data
      .find((m) => m.user_id === U.colaborador.id);
    const t = await crear('superadmin', { title: 'Cerrar y archivar', assigned_to: U.colaborador.id });
    expect((await request.patch(`/api/tasks/${t.id}/move`).set(como('superadmin')).send({ status: 'hecha' })).status).toBe(200);
    const antes = await fila();
    expect((await request.delete(`/api/tasks/${t.id}`).set(como('admin'))).status).toBe(200);
    const despues = await fila();
    expect(despues.completed_this_week).toBe(antes.completed_this_week);
    expect(despues.completed_this_week).toBeGreaterThanOrEqual(1);
  });
});
