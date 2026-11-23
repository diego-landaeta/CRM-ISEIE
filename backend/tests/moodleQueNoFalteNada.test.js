import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as alumnos from '../src/modules/consultas/consultas.alumnos.js';
import * as model from '../src/modules/consultas/consultas.model.js';
import { esAlumno } from '../src/shared/services/moodle.client.js';
import { sincronizarCampus } from '../src/modules/consultas/consultas.plugin.js';
import { procesarAviso } from '../src/modules/consultas/consultas.avisos.js';
import { AppError } from '../src/shared/utils/AppError.js';

/**
 * Revisión de la integración con Moodle: que en el CRM aparezca todo lo que trae el campus.
 *
 *   · «Alumnos sin mensajes» cuenta como alumno a quien tiene un rol propio del campus
 *     (no solo «student»);
 *   · las listas de Consultas y de Alumnos sin mensajes dicen cuántas hay aunque se
 *     recorten, y lo recortado de Consultas ya no son las más recientes;
 *   · el repaso del plugin no se salta para siempre un mensaje que no se pudo guardar (#406).
 *
 * (En el CRM 360 la misma prueba cubre además «Mi campus», que aquí llega con ISEIE#408.)
 *
 *   npx vitest run tests/moodleQueNoFalteNada.test.js
 */

const marca = `tqnfn${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let alumnoN = 640000;

const json = (d) => ({ ok: true, status: 200, json: async () => d });

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${ids.users.length} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre, { plugin = false } = {}) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  const p = Number(rows[0].id);
  ids.projects.push(p);
  const enc = encrypt('campus');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [p, enc.encrypted, enc.iv, enc.authTag,
     JSON.stringify({ url: `https://${marca}-${n}.campus.test`, consultas: true, consultas_desde: '2026-01-01T00:00:00Z' })]);
  if (plugin) {
    const s = encrypt('secreto-del-plugin');
    await query(
      `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo) VALUES ($1, $2, $3, $4, true)`,
      [p, s.encrypted, s.iv, s.authTag]);
  }
  return p;
}

async function tutora(projectId, moodleId) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`,
    [t, projectId, moodleId]);
  return t;
}

/** Una consulta en ese estado, que entró hace `horas` horas. */
async function consulta(projectId, tutorId, estado, horas) {
  alumnoN += 1;
  const { rows } = await query(
    `INSERT INTO consultas (project_id, alumno_moodle_id, alumno_nombre, tutor_id, estado, origen, entrada_at, espera_desde)
     VALUES ($1, $2, $3, $4, $5, 'moodle', NOW() - ($6 || ' hours')::interval,
             CASE WHEN $7::boolean THEN NOW() - ($6 || ' hours')::interval END)
     RETURNING id`,
    [projectId, alumnoN, `Alumno ${alumnoN}`, tutorId, estado, String(horas), estado === 'abierta']);
  return Number(rows[0].id);
}

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.tutor_alumnos') AS a, to_regclass('public.moodle_plugin_campus') AS b`);
    if (!t.rows[0].a || !t.rows[0].b) throw new Error('Faltan las migraciones de Consultas de alumnos y la 313.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_alumnos WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM moodle_plugin_campus WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

describe('hay base', () => {
  it('con las tablas de Consultas de alumnos y del plugin', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('Alumnos sin mensajes: alumno es cualquier rol que no sea del equipo', () => {
  it('esAlumno: cualquier rol que no sea del equipo; sin rol, no', () => {
    expect(esAlumno({ roles: ['student'] })).toBe(true);
    expect(esAlumno({ roles: ['alumno'] })).toBe(true);
    expect(esAlumno({ roles: ['teacher'] })).toBe(false);
    expect(esAlumno({ roles: ['student', 'manager'] })).toBe(false);
    expect(esAlumno({ roles: [] })).toBe(false);
  });

  it('el alumno con un rol propio del campus entra en la lista; el gestor del curso, no', async () => {
    if (!hayBase) return;
    const p = await crearCampus('RolPropio');
    const t = await tutora(p, 100);
    const gente = [
      { id: 100, fullname: 'Tutora', roles: [{ shortname: 'editingteacher' }] },
      { id: 201, fullname: 'Ana', roles: [{ shortname: 'student' }] },
      { id: 202, fullname: 'Luis', roles: [{ shortname: 'alumno' }] },
      { id: 300, fullname: 'Gestora', roles: [{ shortname: 'manager' }] },
    ];
    const fetchImpl = async (_url, { body }) => {
      const f = new URLSearchParams(body).get('wsfunction');
      if (f === 'core_enrol_get_users_courses') return json([{ id: 1, fullname: 'Psicología' }]);
      if (f === 'core_enrol_get_enrolled_users') return json(gente);
      if (f === 'core_message_get_conversations') return json({ conversations: [] });
      return json([]);
    };
    const r = await alumnos.sincronizarAlumnos(p, { fetchImpl });
    expect(r).toMatchObject({ tutores: 1, alumnos: 2, errores: [] });
    const lista = await alumnos.sinMensajes({ tutorId: t });
    expect(lista.map((a) => a.alumno_nombre).sort()).toEqual(['Ana', 'Luis']);
    // Cada fila dice cuántos hay en total, aunque la lista se recorte.
    expect(lista.every((a) => a.total === 2)).toBe(true);
  });
});

describe('Consultas: lo que no cabe se dice, y no son las más recientes', () => {
  it('abiertas primero, la más antigua arriba; después respondidas y cerradas, la más reciente arriba; con su total', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Orden');
    const t = await tutora(p, 110);
    const abiertaVieja = await consulta(p, t, 'abierta', 50);
    const abiertaNueva = await consulta(p, t, 'abierta', 2);
    const cerradaVieja = await consulta(p, t, 'cerrada', 400);
    const cerradaNueva = await consulta(p, t, 'cerrada', 3);
    const respondida = await consulta(p, t, 'respondida', 10);

    const todas = await model.listar({ projectIds: [p] });
    expect(todas.map((c) => Number(c.id))).toEqual([abiertaVieja, abiertaNueva, respondida, cerradaNueva, cerradaVieja]);
    expect(todas.every((c) => c.total === 5)).toBe(true);

    // Con tope: lo que sale de las cerradas es la más reciente, y el total sigue siendo el de verdad.
    const cerradas = await model.listar({ projectIds: [p], estado: 'cerrada', limite: 1 });
    expect(cerradas.map((c) => Number(c.id))).toEqual([cerradaNueva]);
    expect(cerradas[0].total).toBe(2);
  });
});

describe('El repaso del plugin no se salta un mensaje que no pudo guardar', () => {
  /** Un Moodle con el plugin que devuelve una página con esos avisos. */
  const conPagina = (avisos, hastaid) => async (_url, { body }) => {
    const f = new URLSearchParams(body).get('wsfunction');
    if (f === 'local_crm_mensajes_desde') return json({ avisos: JSON.stringify(avisos), hastaid, mas: false, version: '1.10.6' });
    if (f === 'local_crm_disponibilidad') return json({ ok: true });
    return json([]);
  };
  const aviso = (id) => ({ evento: 'mensaje', mensaje: { id }, de: { id: 1 }, para: [{ id: 2 }] });
  const cursor = async (p) => Number((await query(
    'SELECT sincronizado_hasta_id FROM moodle_plugin_campus WHERE project_id = $1', [p])).rows[0].sincronizado_hasta_id);

  it('si falla la base con un mensaje, el cursor se queda justo antes y el siguiente repaso lo vuelve a pedir', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Repaso', { plugin: true });
    await query('UPDATE moodle_plugin_campus SET sincronizado_hasta_id = 100 WHERE project_id = $1', [p]);
    const vistos = [];
    const procesar = async (_p, a) => {
      vistos.push(a.mensaje.id);
      if (a.mensaje.id === 102) throw new Error('la base ha tropezado');
      return { resultado: 'consulta_nueva' };
    };
    const r = await sincronizarCampus(p, { procesar, fetchImpl: conPagina([aviso(101), aviso(102), aviso(103)], 103) });
    expect(vistos).toEqual([101, 102]);
    expect(r.error).toMatch(/102/);
    expect(await cursor(p)).toBe(101);
    const { rows: [e] } = await query('SELECT sincronizacion_error FROM moodle_plugin_campus WHERE project_id = $1', [p]);
    expect(e.sincronizacion_error).toMatch(/102/);

    // El siguiente repaso: empieza por el 102 y, si sale bien, sigue hasta el final y limpia el error.
    const pedidos = [];
    const fetchImpl = async (url, opciones) => {
      pedidos.push(Object.fromEntries(new URLSearchParams(opciones.body)));
      return conPagina([aviso(102), aviso(103)], 103)(url, opciones);
    };
    const otra = await sincronizarCampus(p, { procesar: async () => ({ resultado: 'mensaje' }), fetchImpl });
    expect(pedidos.find((x) => x.wsfunction === 'local_crm_mensajes_desde').desdeid).toBe('101');
    expect(otra.error).toBeUndefined();
    expect(await cursor(p)).toBe(103);
  });

  it('un aviso que no vale (400) no atasca el repaso: se descarta y se sigue', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Descarta', { plugin: true });
    const procesar = async (_p, a) => {
      if (a.mensaje.id === 201) throw new AppError('Aviso incompleto', 400, 'VALIDATION_ERROR');
      return { resultado: 'mensaje' };
    };
    const r = await sincronizarCampus(p, { procesar, fetchImpl: conPagina([aviso(200), aviso(201), aviso(202)], 202) });
    expect(r.error).toBeUndefined();
    expect(r.descartados).toBe(1);
    expect(await cursor(p)).toBe(202);
  });

  it('con el procesado de verdad: un aviso mal formado se descarta y los demás entran', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Real', { plugin: true });
    await tutora(p, 801);
    const bueno = {
      evento: 'mensaje',
      mensaje: { id: 9900001, conversacion_id: 77001, html: '<p>Hola</p>', fecha: Math.floor(Date.now() / 1000) },
      de: { id: 9001, nombre: 'Alumno', personal: false },
      para: [{ id: 801, personal: true }],
    };
    const malo = { evento: 'mensaje', mensaje: { id: 9900002 }, de: { id: 9002 } };
    const r = await sincronizarCampus(p, { procesar: procesarAviso, fetchImpl: conPagina([malo, bueno], 9900002) });
    expect(r).toMatchObject({ mensajes: 2, nuevos: 1, descartados: 1 });
    expect(r.error).toBeUndefined();
  });
});
