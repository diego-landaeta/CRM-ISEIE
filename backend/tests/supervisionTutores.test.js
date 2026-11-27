import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Supervisión de tutores (la dirección, 26/11/2026, para ISEIE): `tutores.supervisar`.
 *
 * Un tutor con el permiso ve a los tutores de SUS campus —su carga, su «Mi campus»,
 * lo que tienen por desarrollar y sus tareas de tutora— y no los de otros campus.
 * No escribe nada. Una tutora sin el permiso no ve a las demás; un admin, tampoco
 * (de serie no lo trae nadie); el superadmin, a todos.
 *
 * Con base de verdad (la local de las pruebas), como buscarTutores591.
 *   npx vitest run tests/supervisionTutores.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/tutores/index.js');
const { default: consultas } = await import('../src/modules/consultas/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { POR_CLAVE } = await import('../src/modules/permissions/catalogo.js');
const { olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(consultas.prefix, consultas.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `SUP${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], issuers: [], teams: [] };
let P; let OTRO; let SUPER; let ADMIN; let ADMIN_B; let SUPERVISOR; let REDACTORA; let TUTOR; let AJENA; let DE_BAJA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const get = (u, ruta) => request.get(`/api/tutores${ruta}`).set(como(u));

async function persona(n, role, campus = [], extra = {}) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra, active) VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase().replace(/[^a-z]/g, '')}@${MARCA.toLowerCase()}.test`, role, extra.roles_extra || '{}', extra.active !== false]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

async function equipo(issuer, tipo, nombre) {
  const [t] = await q('INSERT INTO task_teams (issuer_id, name, tipo) VALUES ($1, $2, $3) RETURNING id', [issuer, `${MARCA} ${nombre}`, tipo]);
  ids.teams.push(t.id);
  return t.id;
}

async function tarea(titulo, persona_, { team = null, project = null, status = 'por_hacer', completada = null, creador = null } = {}) {
  const [t] = await q(
    `INSERT INTO tasks (title, status, assigned_to, created_by, team_id, project_id, completed_at)
     VALUES ($1, $2, $3, $7, $4, $5, $6) RETURNING id`,
    [`${MARCA} ${titulo}`, status, persona_.id, team, project, completada, (creador || persona_).id]);
  return t.id;
}

beforeAll(async () => {
  const empresa = async (c) => {
    const [i] = await q('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${c}`, `${MARCA}${c}`]);
    ids.issuers.push(i.id);
    return i.id;
  };
  const proy = async (c, issuer) => {
    const [p] = await q(
      'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`, issuer]);
    ids.projects.push(p.id);
    return p.id;
  };
  const A = await empresa('a'); const B = await empresa('b');
  P = await proy('a', A); OTRO = await proy('b', B);

  SUPER = await persona('Super', 'superadmin');
  ADMIN = await persona('Admin', 'admin', [P]);
  // El supervisor es un tutor más, con el permiso dado como excepción (así se le da en la realidad).
  SUPERVISOR = await persona('Supervisor', 'tutor', [P]);
  await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'tutores', 'supervisar', true)`, [SUPERVISOR.id]);
  // La redactora trabaja para las dos empresas (como pasa de verdad): lo de la otra no lo ve el supervisor.
  REDACTORA = await persona('Redactora', 'tutor_redactor', [P, OTRO]);
  ADMIN_B = await persona('Admin B', 'admin', [OTRO]);
  // Una tutora que ya no trabaja aquí: de ella no se abre nada, aunque se sepa su id.
  DE_BAJA = await persona('De baja', 'tutor_redactor', [P], { active: false });
  TUTOR = await persona('Tutor', 'tutor', [P]);
  AJENA = await persona('Ajena', 'tutor_redactor', [OTRO]);

  // Lo que la redactora tiene entre manos: una consulta abierta en cada campus…
  await q(`INSERT INTO consultas (project_id, tutor_id, estado, alumno_nombre) VALUES ($1, $2, 'abierta', 'Alumno P'), ($3, $2, 'abierta', 'Alumno otro')`,
    [P, REDACTORA.id, OTRO]);
  // …un curso por desarrollar en cada campus y una cuenta de Moodle sin conectar en cada uno.
  await q(`INSERT INTO cursos_pendientes (project_id, nombre, tutor_id, estado) VALUES ($1, $3, $2, 'asignado'), ($4, $5, $2, 'asignado')`,
    [P, REDACTORA.id, `${MARCA} curso P`, OTRO, `${MARCA} curso otro`]);
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado) VALUES ($1, $2, 'pendiente'), ($1, $3, 'pendiente')`, [REDACTORA.id, P, OTRO]);

  // Sus tareas: la del equipo de redactoras de su empresa, una suelta de su campus, una del
  // equipo de desarrollo (no es de tutora), una de la otra empresa y una hecha hace meses.
  const redactorasA = await equipo(A, 'redactoras', 'Redactoras');
  const desarrolloA = await equipo(A, 'colaboradores', 'Desarrollo');
  const redactorasB = await equipo(B, 'redactoras', 'Redactoras B');
  await tarea('redactar módulo 1', REDACTORA, { team: redactorasA, status: 'en_curso' });
  await tarea('suelta de su campus', REDACTORA, { project: P });
  await tarea('de desarrollo', REDACTORA, { team: desarrolloA });
  await tarea('de la otra empresa', REDACTORA, { team: redactorasB });
  await tarea('hecha hace meses', REDACTORA, { team: redactorasA, status: 'hecha', completada: '2026-06-01T10:00:00Z' });
  // Sin equipo ni campus, y se la pone un admin de la OTRA empresa: no se sabe de quién es.
  await tarea('sin equipo ni campus, de la otra empresa', REDACTORA, { creador: ADMIN_B });
  await tarea('suelta de la otra empresa', REDACTORA, { project: OTRO, creador: ADMIN_B });
  await tarea('de la que se fue', DE_BAJA, { team: redactorasA });
  const [t1] = await q('SELECT id FROM tasks WHERE title = $1', [`${MARCA} redactar módulo 1`]);
  await q('INSERT INTO task_comments (task_id, user_id, content) VALUES ($1, $2, $3)', [t1.id, REDACTORA.id, 'Subido el tema 2 al curso']);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE assigned_to = ANY($1::int[]))', [ids.users]);
  await q('DELETE FROM tasks WHERE assigned_to = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM task_teams WHERE id = ANY($1::int[])', [ids.teams]);
  await q('DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM cursos_pendientes WHERE tutor_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM consultas WHERE tutor_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

const idsDe = (r) => r.body.data.tutores.map((t) => t.id);

describe('el permiso', () => {
  it('está en el catálogo, solo de lectura y de serie no lo trae ningún rol', () => {
    const p = POR_CLAVE['tutores.supervisar'];
    expect(p).toBeTruthy();
    expect(p.roles).toEqual([]);
  });
});

describe('quién ve a quién', () => {
  it('el supervisor, a los tutores de su campus y no a los de otro (ni a sí mismo)', async () => {
    const r = await get(SUPERVISOR, '/supervision');
    expect(r.status).toBe(200);
    const vistos = idsDe(r);
    expect(vistos).toEqual(expect.arrayContaining([REDACTORA.id, TUTOR.id]));
    expect(vistos).not.toContain(AJENA.id);
    expect(vistos).not.toContain(SUPERVISOR.id);
    const redactora = r.body.data.tutores.find((t) => t.id === REDACTORA.id);
    // Lo de su campus y nada del otro: una consulta, un curso por desarrollar, dos tareas abiertas.
    expect(redactora).toMatchObject({ es_redactora: true, consultas_abiertas: 1, por_desarrollar: 1, tareas_abiertas: 2 });
    // Ni el IBAN ni el DNI de la ficha de Tutores.
    expect(redactora).not.toHaveProperty('iban');
    expect(redactora).not.toHaveProperty('dni_nif');
  });

  it('el superadmin, a todos (también los de la otra empresa)', async () => {
    const r = await get(SUPER, '/supervision');
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual(expect.arrayContaining([REDACTORA.id, TUTOR.id, AJENA.id, SUPERVISOR.id]));
  });

  it('una tutora sin el permiso no ve a las demás: 403 en todo', async () => {
    for (const ruta of ['/supervision', `/supervision/${REDACTORA.id}/mi-campus`, `/supervision/${REDACTORA.id}/tareas`]) {
      expect((await get(TUTOR, ruta)).status, ruta).toBe(403);
    }
  });

  it('un admin tampoco, de serie: el permiso se da a la persona', async () => {
    expect((await get(ADMIN, '/supervision')).status).toBe(403);
  });

  it('el «Mi campus» o las tareas de una tutora de otro campus: no existe (404)', async () => {
    expect((await get(SUPERVISOR, `/supervision/${AJENA.id}/mi-campus`)).status).toBe(404);
    expect((await get(SUPERVISOR, `/supervision/${AJENA.id}/tareas`)).status).toBe(404);
    // Ni alguien que no es tutor, aunque sea de su campus.
    expect((await get(SUPERVISOR, `/supervision/${ADMIN.id}/tareas`)).status).toBe(404);
  });

  it('de una tutora de baja no se abre nada (404) ni sale en la lista', async () => {
    for (const ruta of ['mi-campus', 'tareas', 'redaccion-moodle']) {
      expect((await get(SUPERVISOR, `/supervision/${DE_BAJA.id}/${ruta}`)).status, ruta).toBe(404);
    }
    expect(idsDe(await get(SUPERVISOR, '/supervision'))).not.toContain(DE_BAJA.id);
  });

  it('un id o un «refrescar» que no valen: 400 con el formato de siempre', async () => {
    for (const ruta of ['/supervision/abc/tareas', '/supervision/0/mi-campus', '/supervision/-3/redaccion-moodle', '/supervision/1.5/tareas']) {
      const r = await get(SUPERVISOR, ruta);
      expect(r.status, ruta).toBe(400);
      expect(r.body, ruta).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    }
    const r = await get(SUPERVISOR, `/supervision/${REDACTORA.id}/mi-campus?refrescar=si`);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR', error: 'refrescar es 0 o 1' });
    expect((await get(SUPERVISOR, `/supervision/${REDACTORA.id}/mi-campus?refrescar=1`)).status).toBe(200);
  });
});

describe('lo que ve de cada una', () => {
  it('su «Mi campus», solo en los campus que comparten', async () => {
    const r = await get(SUPERVISOR, `/supervision/${REDACTORA.id}/mi-campus`);
    expect(r.status).toBe(200);
    expect(r.body.data.pendientes.map((p) => p.nombre)).toEqual([`${MARCA} curso P`]);
    expect(r.body.data.sinConectar.map((s) => s.projectId)).toEqual([P]);
    // Pidiendo el otro campus en el selector, tampoco: no es un filtro que se salte.
    const otra = await request.get(`/api/tutores/supervision/${REDACTORA.id}/mi-campus?campus=${OTRO}`).set(como(SUPERVISOR));
    expect(otra.body.data.sinConectar.map((s) => s.projectId)).toEqual([P]);
  });

  it('sus tareas de tutora, con su último comentario; ni las de desarrollo ni las de otra empresa', async () => {
    const r = await get(SUPERVISOR, `/supervision/${REDACTORA.id}/tareas`);
    expect(r.status).toBe(200);
    const titulos = r.body.data.map((t) => t.titulo);
    expect(titulos).toEqual(expect.arrayContaining([`${MARCA} redactar módulo 1`, `${MARCA} suelta de su campus`]));
    expect(titulos).not.toContain(`${MARCA} de desarrollo`);
    expect(titulos).not.toContain(`${MARCA} de la otra empresa`);
    expect(titulos).not.toContain(`${MARCA} hecha hace meses`);
    // Ni la suelta sin equipo ni campus que le puso la otra empresa, ni la suelta de su campus de allí.
    expect(titulos).not.toContain(`${MARCA} sin equipo ni campus, de la otra empresa`);
    expect(titulos).not.toContain(`${MARCA} suelta de la otra empresa`);
    const conComentario = r.body.data.find((t) => t.titulo === `${MARCA} redactar módulo 1`);
    expect(conComentario).toMatchObject({ equipo: `${MARCA} Redactoras`, comentarios: 1 });
    expect(conComentario.ultimoComentario.texto).toBe('Subido el tema 2 al curso');
  });

  it('lo que redacta en Moodle, de sus campus (la redactora sin cursos: nada que mirar)', async () => {
    const r = await get(SUPERVISOR, `/supervision/${REDACTORA.id}/redaccion-moodle`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ es_redactora: true, campus: [], sin_curso: [] });
    expect((await get(SUPERVISOR, `/supervision/${AJENA.id}/redaccion-moodle`)).status).toBe(404);
    expect((await get(TUTOR, `/supervision/${REDACTORA.id}/redaccion-moodle`)).status).toBe(403);
  });

  it('el superadmin ve también la tarea de la otra empresa', async () => {
    const r = await get(SUPER, `/supervision/${REDACTORA.id}/tareas`);
    expect(r.body.data.map((t) => t.titulo)).toEqual(expect.arrayContaining([
      `${MARCA} de la otra empresa`, `${MARCA} sin equipo ni campus, de la otra empresa`, `${MARCA} suelta de la otra empresa`]));
  });
});

describe('no escribe nada', () => {
  it('no gestiona tutores: ni la lista de Tutores, ni la ficha ajena, ni alta, ni disponibilidad', async () => {
    expect((await get(SUPERVISOR, '/')).status).toBe(403);
    expect((await get(SUPERVISOR, `/${REDACTORA.id}`)).status).toBe(403);
    expect((await request.post('/api/tutores').set(como(SUPERVISOR)).send({ nombre: 'x', email: 'x@x.test' })).status).toBe(403);
    expect((await request.patch(`/api/tutores/${REDACTORA.id}/disponible`).set(como(SUPERVISOR)).send({ disponible: false })).status).toBe(403);
  });

  it('no abre, responde ni cierra las consultas de otra tutora', async () => {
    const [c] = await q('SELECT id FROM consultas WHERE tutor_id = $1 AND project_id = $2', [REDACTORA.id, P]);
    expect((await request.get(`/api/consultas/${c.id}`).set(como(SUPERVISOR))).status).toBe(404);
    expect((await request.post(`/api/consultas/${c.id}/cerrar`).set(como(SUPERVISOR))).status).toBe(404);
    expect((await request.get('/api/consultas').set(como(SUPERVISOR))).status).toBe(403);
    const [sigue] = await q('SELECT estado FROM consultas WHERE id = $1', [c.id]);
    expect(sigue.estado).toBe('abierta');
  });

  it('quitarle el permiso surte efecto ya', async () => {
    await q(`DELETE FROM user_permission_overrides WHERE user_id = $1 AND resource = 'tutores' AND action = 'supervisar'`, [SUPERVISOR.id]);
    olvidarPermisos?.(SUPERVISOR.id);
    expect((await get(SUPERVISOR, '/supervision')).status).toBe(403);
    await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'tutores', 'supervisar', true)`, [SUPERVISOR.id]);
    olvidarPermisos?.(SUPERVISOR.id);
  });
});
