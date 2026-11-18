import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Control de subidas de contenido por curso (#771), contra la base de verdad.
 *
 * Lo que se defiende (los criterios de la issue y del encargo):
 *   · cada curso tiene su lista de control: vídeos en YouTube, módulos en Moodle
 *     y datos de directores para la web, con desde cuándo falta y fecha límite;
 *   · la responsable de las subidas (una gestora con «Gestionar colaboraciones»,
 *     por ejemplo) marca cada punto en SUS campus; una gestora sin ese permiso,
 *     una tutora o alguien de otro campus, no;
 *   · administración tiene una vista solo con lo atrasado;
 *   · el aviso de punto vencido va a la campana de la responsable, una sola vez,
 *     está apagado de serie y nunca es un correo;
 *   · la lista se abre sola al pasar a «entregado» (punto de unión con la #770).
 *
 *   npx vitest run tests/controlSubidas771.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/cursos-pendientes/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const subidas = await import('../src/modules/cursos-pendientes/cursos-pendientes.subidas.js');
const { TIPOS } = await import('../src/modules/notifications/tipos.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CSU${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
let P; let OTRO;
let ADMIN; let RESPONSABLE; let GESTORA; let TUTORA; let ADMIN_OTRO;
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const ZONA = process.env.APP_TIMEZONE || 'Europe/Madrid';
const dia = (n) => {
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: ZONA }).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

async function persona(nombre, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

async function curso(nombre, proyecto = P, estado = 'en_desarrollo') {
  const [c] = await q(
    `INSERT INTO cursos_pendientes (project_id, nombre, estado, tutor_id, fecha_comprometida)
     VALUES ($1, $2, $3, $4, CURRENT_DATE + 30) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, estado, TUTORA.id]
  );
  return c.id;
}

beforeAll(async () => {
  const proy = async (clave) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  // Responsable de las subidas: rol de gestora (lo único que la limita a lo suyo) con «Gestionar colaboraciones».
  RESPONSABLE = await persona('RESPONSABLE', 'gestor', [P]);
  await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'tutores', 'gestionar', true)`, [RESPONSABLE.id]);
  GESTORA = await persona('GESTORA', 'gestor', [P]);
  TUTORA = await persona('TUTORA', 'tutor', [P]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM admin_notifications WHERE title LIKE $1 OR message LIKE $1`, [`%${MARCA}%`]).catch(() => {});
  await q(`DELETE FROM cursos_pendientes_avisos WHERE curso_id IN (SELECT id FROM cursos_pendientes WHERE project_id = ANY($1::int[]))`, [ids.projects]);
  await q(`DELETE FROM cursos_pendientes WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

afterEach(() => { delete process.env.CONTROL_SUBIDAS_AVISOS; delete process.env.CONTROL_SUBIDAS_PLAZO_DIAS; });

const abrir = (u, id) => request.post(`/api/cursos-pendientes/${id}/subidas`).set(como(u));
const marcar = (u, id, punto, cuerpo) => request.patch(`/api/cursos-pendientes/${id}/subidas/${punto}`).set(como(u)).send(cuerpo);
const control = (u, query = '') => request.get(`/api/cursos-pendientes/subidas${query}`).set(como(u));
const avisos = (userId, curso = 'Curso con aviso de subidas') => q(
  `SELECT title, message FROM admin_notifications WHERE type = 'curso_pendiente_subida_vencida' AND $1 = ANY(target_user_ids) AND title LIKE $2`,
  [userId, `%${MARCA} ${curso}`]);

describe('la lista de control de cada curso', () => {
  let ID;
  beforeAll(async () => { ID = await curso('Diplomado de Neuroeducación'); });

  it('se abre con los tres puntos, sin hacer, con desde cuándo y la fecha límite del plazo', async () => {
    process.env.CONTROL_SUBIDAS_PLAZO_DIAS = '5';
    const r = await abrir(RESPONSABLE, ID);
    expect(r.status).toBe(201);
    expect(r.body.data.creados).toBe(3);
    expect(r.body.data.subidas.map((s) => s.punto)).toEqual(['videos_youtube', 'modulos_moodle', 'datos_directores_web']);
    for (const s of r.body.data.subidas) {
      expect(s).toMatchObject({ hecho: false, atrasado: false, fecha_limite: dia(5), dias_esperando: 0 });
      expect(s.desde).toBeTruthy();
    }
  });

  it('abrirla otra vez no duplica nada ni mueve las fechas', async () => {
    process.env.CONTROL_SUBIDAS_PLAZO_DIAS = '20';
    const r = await abrir(ADMIN, ID);
    expect(r.status).toBe(200);
    expect(r.body.data.creados).toBe(0);
    expect(r.body.data.subidas.every((s) => s.fecha_limite === dia(5))).toBe(true);
  });

  it('sale en la ficha del curso, también para la tutora (solo verla)', async () => {
    const d = (await request.get(`/api/cursos-pendientes/${ID}`).set(como(TUTORA))).body.data;
    expect(d.subidas).toHaveLength(3);
    expect(d.historial.map((h) => h.accion)).toContain('subidas_abiertas');
  });

  it('la responsable marca un punto, con enlace; queda quién y cuándo, y va al historial', async () => {
    const r = await marcar(RESPONSABLE, ID, 'videos_youtube', { hecho: true, enlace: 'https://www.youtube.com/watch?v=abc' });
    expect(r.status).toBe(200);
    const v = r.body.data.find((s) => s.punto === 'videos_youtube');
    expect(v).toMatchObject({ hecho: true, hecho_por: `${MARCA} RESPONSABLE`, enlace: 'https://www.youtube.com/watch?v=abc' });
    expect(v.hecho_at).toBeTruthy();
    const [h] = await q(`SELECT user_id, detalle FROM cursos_pendientes_historial WHERE curso_id = $1 AND accion = 'subida_marcada'`, [ID]);
    expect(h.user_id).toBe(RESPONSABLE.id);
    expect(h.detalle).toMatchObject({ punto: 'videos_youtube', hecho: true });
  });

  it('desmarcarlo borra quién y cuándo', async () => {
    const r = await marcar(RESPONSABLE, ID, 'videos_youtube', { hecho: false });
    expect(r.body.data.find((s) => s.punto === 'videos_youtube')).toMatchObject({ hecho: false, hecho_por: null, hecho_at: null });
  });

  it('rechaza un punto que no existe, un enlace que no es una dirección y una fecha mal escrita', async () => {
    expect((await marcar(RESPONSABLE, ID, 'fotos', { hecho: true })).status).toBe(400);
    expect((await marcar(RESPONSABLE, ID, 'modulos_moodle', { enlace: 'javascript:alert(1)' })).status).toBe(400);
    expect((await marcar(RESPONSABLE, ID, 'modulos_moodle', { fecha_limite: '31/12/2026' })).status).toBe(400);
  });

  it('marcar un curso sin la lista abierta dice que hay que abrirla', async () => {
    const otro = await curso('Sin lista');
    const r = await marcar(RESPONSABLE, otro, 'modulos_moodle', { hecho: true });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SUBIDAS_SIN_ABRIR');
  });
});

describe('quién puede marcar', () => {
  let ID;
  beforeAll(async () => { ID = await curso('Curso de Logopedia'); await subidas.abrirControl(ID); });

  it('una gestora sin «Gestionar colaboraciones», no', async () => {
    expect((await marcar(GESTORA, ID, 'modulos_moodle', { hecho: true })).status).toBe(403);
    expect((await abrir(GESTORA, ID)).status).toBe(403);
    expect((await control(GESTORA)).status).toBe(403);
  });

  it('una tutora, tampoco (aunque el curso sea suyo)', async () => {
    expect((await marcar(TUTORA, ID, 'modulos_moodle', { hecho: true })).status).toBe(403);
  });

  it('un admin de OTRO campus no lo ve: 404, sin confirmar que existe', async () => {
    expect((await marcar(ADMIN_OTRO, ID, 'modulos_moodle', { hecho: true })).status).toBe(404);
  });

  it('el admin del campus, sí', async () => {
    expect((await marcar(ADMIN, ID, 'modulos_moodle', { hecho: true })).status).toBe(200);
  });
});

describe('la vista de lo que falta y la de solo lo atrasado', () => {
  let TARDE; let A_TIEMPO; let EN_OTRO;
  beforeAll(async () => {
    TARDE = await curso('Máster con subidas atrasadas');
    A_TIEMPO = await curso('Curso con subidas a tiempo');
    EN_OTRO = await curso('Curso de otro campus', OTRO);
    for (const id of [TARDE, A_TIEMPO, EN_OTRO]) await subidas.abrirControl(id);
    await q(`UPDATE cursos_pendientes_subidas SET fecha_limite = $2, created_at = now() - interval '10 days' WHERE curso_id = $1`, [TARDE, dia(-3)]);
    await q(`UPDATE cursos_pendientes_subidas SET fecha_limite = $2 WHERE curso_id = $1`, [EN_OTRO, dia(-3)]);
    await q(`UPDATE cursos_pendientes_subidas SET hecho = true, hecho_at = now() WHERE curso_id = $1 AND punto = 'videos_youtube'`, [TARDE]);
  });

  it('lo que falta, por curso y desde cuándo; lo hecho no sale', async () => {
    const r = await control(RESPONSABLE);
    expect(r.status).toBe(200);
    expect(r.body.data.puntos).toHaveLength(3);
    const tarde = r.body.data.filas.filter((f) => f.curso_id === TARDE);
    expect(tarde.map((f) => f.punto).sort()).toEqual(['datos_directores_web', 'modulos_moodle']);
    expect(tarde[0]).toMatchObject({ atrasado: true, dias_de_retraso: 3, dias_esperando: 10, campus: `${MARCA} a` });
    expect(r.body.data.filas.some((f) => f.curso_id === A_TIEMPO && !f.atrasado)).toBe(true);
  });

  it('solo atrasadas: lo de A_TIEMPO no sale', async () => {
    const filas = (await control(ADMIN, '?soloAtrasadas=true')).body.data.filas;
    expect(filas.some((f) => f.curso_id === TARDE)).toBe(true);
    expect(filas.some((f) => f.curso_id === A_TIEMPO)).toBe(false);
    expect(filas.every((f) => f.atrasado)).toBe(true);
  });

  it('cada uno, sus campus: lo del otro campus no le sale ni a la responsable ni a su admin', async () => {
    for (const u of [RESPONSABLE, ADMIN]) {
      const filas = (await control(u, '?soloAtrasadas=true')).body.data.filas;
      expect(filas.some((f) => f.curso_id === EN_OTRO)).toBe(false);
    }
    expect((await control(ADMIN_OTRO, '?soloAtrasadas=true')).body.data.filas.some((f) => f.curso_id === EN_OTRO)).toBe(true);
  });

  it('un curso cancelado deja de contar', async () => {
    const id = await curso('Cancelado con subidas');
    await subidas.abrirControl(id);
    await q(`UPDATE cursos_pendientes SET estado = 'cancelado' WHERE id = $1`, [id]);
    expect((await control(ADMIN)).body.data.filas.some((f) => f.curso_id === id)).toBe(false);
  });
});

describe('el aviso de punto vencido', () => {
  let ID;
  beforeAll(async () => {
    ID = await curso('Curso con aviso de subidas');
    await subidas.abrirControl(ID);
    await q(`UPDATE cursos_pendientes_subidas SET fecha_limite = $2 WHERE curso_id = $1`, [ID, dia(-1)]);
  });

  it('está apagado de serie: no manda nada', async () => {
    expect(await subidas.avisarSubidasVencidas()).toMatchObject({ activo: false, enviados: 0 });
    expect(await avisos(RESPONSABLE.id)).toHaveLength(0);
  });

  it('encendido, UN aviso por curso en la campana de quien lleva las subidas, con lo que falta', async () => {
    process.env.CONTROL_SUBIDAS_AVISOS = '1';
    const r = await subidas.avisarSubidasVencidas();
    expect(r.activo).toBe(true);
    const [a] = await avisos(RESPONSABLE.id);
    expect(a.title).toBe(`Subidas atrasadas: ${MARCA} Curso con aviso de subidas`);
    expect(a.message).toContain('Vídeos de los directores en YouTube');
    expect(a.message).toContain('Módulos subidos al Moodle');
    // El admin del campus también tiene el permiso de serie; la gestora sin él y la tutora, no.
    expect(await avisos(ADMIN.id)).toHaveLength(1);
    expect(await avisos(GESTORA.id)).toHaveLength(0);
    expect(await avisos(TUTORA.id)).toHaveLength(0);
    expect(await avisos(ADMIN_OTRO.id)).toHaveLength(0);
  });

  it('repetir la vuelta del job no lo repite', async () => {
    process.env.CONTROL_SUBIDAS_AVISOS = '1';
    await subidas.avisarSubidasVencidas();
    expect(await avisos(RESPONSABLE.id)).toHaveLength(1);
  });

  it('es un aviso de campana registrado, que pide hacer algo', () => {
    expect(TIPOS.curso_pendiente_subida_vencida).toMatchObject({ clase: 'accion' });
  });
});

describe('punto de unión con la #770: se abre sola al pasar a «entregado»', () => {
  it('el estado que la abre es «entregado»', () => {
    expect(subidas.ESTADO_QUE_ABRE_EL_CONTROL).toBe('entregado');
  });

  it('dentro de una transacción (como la llama `modificar`), abre los tres puntos', async () => {
    const id = await curso('Entregado por la tutora');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await subidas.abrirControl(id, { client })).toBe(3);
      await client.query('COMMIT');
    } finally { client.release(); }
    expect(await subidas.puntosDe(id)).toHaveLength(3);
  });
});
