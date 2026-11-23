import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as servicio from '../src/modules/consultas/consultas.service.js';
import { sincronizarCampus, crearClave } from '../src/modules/consultas/consultas.plugin.js';
import { procesarAviso } from '../src/modules/consultas/consultas.avisos.js';
import { repasarTodos } from '../src/jobs/moodleSincronizacionScheduler.js';

/**
 * El plugin del CRM en cada Moodle (#679, PR #689 parte 1), contra la base de verdad y con
 * un Moodle de mentira que contesta como uno de verdad:
 *
 *   · una conversación nueva del mismo alumno y OTRO curso es otra consulta, y una cerrada
 *     no recoge conversaciones nuevas;
 *   · el repaso de cada 15 minutos recupera lo que no llegó y no duplica lo que sí.
 *
 * Sale de consultasEquipo679.test.js (rama grande): aquí solo lo que es de esta parte, sin
 * el reparto por curso, las notas internas ni las respuestas guardadas (migración 247).
 *
 *   npx vitest run tests/consultasPluginRepaso679.test.js
 */

const marca = `t679r${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let alumnoN = 75000;
let conversacionN = 85000;
let mensajeN = 9500000;

// ─── El Moodle de mentira ────────────────────────────────────────────────────

/** Lo que cada campus de mentira sabe, por su dirección. */
const campusFalsos = new Map();
const envios = [];

function campusFalso(url) {
  const c = {
    // curso → [{ id, rol }]
    cursos: new Map(),
    // Páginas que devuelve local_crm_mensajes_desde, en orden.
    paginas: [],
    pedidosDesde: [],
    disponibilidad: [],
    caido: false,
    pluginViejo: false,
    // Antes de contestar la lista de un curso (para cambiarla entre una pregunta y otra).
    alPedirCurso: null,
  };
  campusFalsos.set(url, c);
  return c;
}

const json = (d) => ({ ok: true, status: 200, json: async () => d });

vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const base = String(url).replace(/\/webservice\/rest\/server\.php$/, '');
  const c = campusFalsos.get(base);
  if (!c) return json([]);
  if (c.caido) throw new TypeError('fetch failed');
  const p = new URLSearchParams(body);
  const f = p.get('wsfunction');
  if (f === 'core_enrol_get_enrolled_users') {
    const curso = Number(p.get('courseid'));
    if (c.alPedirCurso) c.alPedirCurso(curso);
    return json((c.cursos.get(curso) || []).map((g) => ({
      id: g.id, fullname: `Persona ${g.id}`, roles: [{ shortname: g.rol }], groups: [],
    })));
  }
  if (f === 'core_enrol_get_users_courses') {
    const uid = Number(p.get('userid'));
    return json([...c.cursos.entries()].filter(([, gente]) => gente.some((g) => g.id === uid)).map(([id]) => ({ id, fullname: `Curso ${id}` })));
  }
  if (f === 'local_crm_mensajes_desde') {
    if (c.pluginViejo) return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'x' });
    c.pedidosDesde.push(p.get('desdeid') ? { desdeid: Number(p.get('desdeid')) } : { desdefecha: Number(p.get('desdefecha')) });
    return json(c.paginas.shift() || { avisos: '[]', hastaid: 0, mas: false, version: '1.8.0' });
  }
  if (f === 'local_crm_disponibilidad') {
    const lista = [];
    for (const [k, v] of p.entries()) if (k.startsWith('nodisponibles[')) lista.push(Number(v));
    c.disponibilidad.push(lista.sort((a, b) => a - b));
    return json({ ok: true });
  }
  if (f === 'core_message_send_instant_messages') {
    envios.push({ base, para: Number(p.get('messages[0][touserid]')), texto: p.get('messages[0][text]') });
    return json([{ msgid: 1, conversationid: 1 }]);
  }
  return json([]);
}));

// ─── Datos ───────────────────────────────────────────────────────────────────

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${ids.users.length} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

/** Un campus conectado a su Moodle de mentira, con «Leer las consultas» encendido. */
async function crearCampus(nombre, { plugin = false, consultas = true } = {}) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  const p = Number(rows[0].id);
  ids.projects.push(p);
  const url = `https://${marca}-${n}.campus.test`;
  const enc = encrypt('token-del-campus');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [p, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url, consultas, consultas_desde: '2026-01-01T00:00:00Z' })]);
  if (plugin) {
    const s = encrypt('secreto-del-plugin');
    await query(
      `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo) VALUES ($1, $2, $3, $4, true)`,
      [p, s.encrypted, s.iv, s.authTag]);
  }
  return { id: p, moodle: campusFalso(url) };
}

/** Una tutora del campus, con su cuenta de Moodle vinculada. */
async function tutora(projectId, moodleId, { disponible = true } = {}) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`,
    [t, projectId, moodleId]);
  if (!disponible) await noDisponible(t);
  return t;
}

const noDisponible = (t) => query('UPDATE users SET consultas_disponible = false WHERE id = $1', [t]);

/** Lo que manda el alumno desde «Entrar al chat» de un curso. */
const delAlumno = (projectId, cursoId, extra = {}) => {
  alumnoN += 1;
  conversacionN += 1;
  return {
    projectId, conversacionId: conversacionN, alumno: { moodleId: alumnoN, nombre: `Alumno ${alumnoN}` },
    curso: cursoId ? { moodleId: cursoId, nombre: null } : null,
    texto: 'No me abre la tarea 2', externoId: (mensajeN += 1), escritoAt: new Date(), ...extra,
  };
};

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.consultas') AS a, to_regclass('public.moodle_plugin_campus') AS b`);
    if (!t.rows[0].a || !t.rows[0].b) throw new Error('Falta la migración 245.');
    const { rows: [r] } = await query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'consultas' AND column_name IN ('conversacion_grupo_id', 'participantes', 'grupo_tipo')`);
    if (r.n !== 3) throw new Error('Falta la migración 248.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterEach(() => { envios.length = 0; });

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
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
  vi.unstubAllGlobals();
});

describe('hay base', () => {
  it('con las migraciones 245 y 248', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#679 · una consulta por alumno y curso', () => {
  it('otro curso es otra consulta, y una consulta cerrada no recoge conversaciones nuevas', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Separadas');
    const laura = await tutora(campus.id, 501);
    campus.moodle.cursos.set(31, [{ id: 501, rol: 'editingteacher' }]);
    campus.moodle.cursos.set(32, [{ id: 501, rol: 'editingteacher' }]);
    const m = delAlumno(campus.id, 31);
    const r1 = await servicio.entraMensajeDelAlumno(m, { tutorPreferido: laura, avisar: false });
    const otroCurso = await servicio.entraMensajeDelAlumno(
      { ...m, curso: { moodleId: 32, nombre: null }, conversacionId: (conversacionN += 1), externoId: (mensajeN += 1) },
      { tutorPreferido: laura, avisar: false });
    expect(otroCurso.nueva).toBe(true);
    expect(otroCurso.consulta.id).not.toBe(r1.consulta.id);
    await query(`UPDATE consultas SET estado = 'cerrada', cerrada_at = NOW() WHERE id = $1`, [r1.consulta.id]);
    const trasCerrar = await servicio.entraMensajeDelAlumno(
      { ...m, conversacionId: (conversacionN += 1), externoId: (mensajeN += 1) }, { tutorPreferido: laura, avisar: false });
    expect(trasCerrar.nueva).toBe(true);
  });
});


// ─── El repaso de cada 15 minutos ────────────────────────────────────────────

/** Un aviso como los del plugin: el alumno escribe a su tutora. */
const avisoDelAlumno = (alumno, tutoraMoodle, { id = (mensajeN += 1), conversacion = 600001, curso = null, texto = 'Hola' } = {}) => ({
  evento: 'mensaje',
  mensaje: { id, conversacion_id: conversacion, html: `<p>${texto}</p>`, fecha: Math.floor(Date.now() / 1000), curso_id: curso },
  de: { id: alumno, nombre: `Alumno ${alumno}`, personal: false },
  para: [{ id: tutoraMoodle, personal: true }],
});
const pagina = (avisos, hastaid, mas = false) => ({ avisos: JSON.stringify(avisos), hastaid, mas, version: '1.8.0' });

describe('#679 · el repaso recupera lo que no llegó, sin duplicar', () => {
  it('lee página a página, guarda hasta dónde llegó y manda la lista de «No disponible»', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Repaso', { plugin: true });
    await tutora(campus.id, 801);
    await tutora(campus.id, 802, { disponible: false });
    // Este llegó por el aviso al momento; el repaso lo vuelve a traer y no debe duplicarlo.
    const yaLlego = avisoDelAlumno(8001, 801, { conversacion: 600101 });
    expect((await procesarAviso(campus.id, yaLlego)).resultado).toBe('consulta_nueva');
    campus.moodle.paginas.push(
      pagina([yaLlego, avisoDelAlumno(8002, 801, { conversacion: 600102 })], 500, true),
      pagina([avisoDelAlumno(8003, 801, { conversacion: 600103 })], 520, false));

    const r = await sincronizarCampus(campus.id, { procesar: procesarAviso, desdeFecha: '2026-01-01T00:00:00Z' });
    expect(r).toMatchObject({ mensajes: 3, nuevos: 2, paginas: 2, version: '1.8.0' });
    expect(r.error).toBeUndefined();
    // La primera página, desde la fecha; la segunda, desde el último id visto.
    expect(campus.moodle.pedidosDesde[0]).toHaveProperty('desdefecha');
    expect(campus.moodle.pedidosDesde[1]).toEqual({ desdeid: 500 });
    expect(campus.moodle.disponibilidad).toEqual([[802]]);

    const { rows: [estado] } = await query(
      'SELECT sincronizado_hasta_id, sincronizado_at, sincronizacion_error, version_plugin FROM moodle_plugin_campus WHERE project_id = $1', [campus.id]);
    expect(Number(estado.sincronizado_hasta_id)).toBe(520);
    expect(estado.sincronizado_at).not.toBeNull();
    expect(estado.sincronizacion_error).toBeNull();
    expect(estado.version_plugin).toBe('1.8.0');

    const { rows: [n] } = await query(
      `SELECT COUNT(DISTINCT c.id)::int AS consultas, COUNT(m.id)::int AS mensajes
         FROM consultas c JOIN consulta_mensajes m ON m.consulta_id = c.id WHERE c.project_id = $1`, [campus.id]);
    expect(n).toEqual({ consultas: 3, mensajes: 3 });

    // El siguiente repaso sigue desde 520 y, sin nada nuevo, no toca nada.
    const otra = await sincronizarCampus(campus.id, { procesar: procesarAviso });
    expect(otra).toMatchObject({ mensajes: 0, nuevos: 0 });
    expect(campus.moodle.pedidosDesde[2]).toEqual({ desdeid: 520 });
  });

  it('con el plugin anterior a la 1.8.0 dice qué hacer y no pierde por dónde iba', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Viejo', { plugin: true });
    await query('UPDATE moodle_plugin_campus SET sincronizado_hasta_id = 77 WHERE project_id = $1', [campus.id]);
    campus.moodle.pluginViejo = true;
    const r = await sincronizarCampus(campus.id, { procesar: procesarAviso });
    expect(r.error).toMatch(/1\.8\.0/);
    const { rows: [estado] } = await query(
      'SELECT sincronizado_hasta_id, sincronizacion_error FROM moodle_plugin_campus WHERE project_id = $1', [campus.id]);
    expect(Number(estado.sincronizado_hasta_id)).toBe(77);
    expect(estado.sincronizacion_error).toMatch(/1\.8\.0/);
  });

  it('un campus sin el plugin no se repasa, ni uno con «Leer las consultas» apagado', async () => {
    if (!hayBase) return;
    const sinPlugin = await crearCampus('SinPlugin');
    expect(await sincronizarCampus(sinPlugin.id, { procesar: procesarAviso })).toMatchObject({ omitido: 'sin plugin activo' });
    const apagado = await crearCampus('Apagado', { plugin: true, consultas: false });
    apagado.moodle.paginas.push(pagina([avisoDelAlumno(8101, 901)], 10));
    const todos = await repasarTodos();
    expect(todos.some((x) => x.projectId === apagado.id)).toBe(false);
    expect(apagado.moodle.pedidosDesde).toHaveLength(0);
  });
});

describe('#679 · volver a conectar un campus', () => {
  it('empieza el repaso de cero: el cursor del Moodle de antes no vale para el nuevo', async () => {
    if (!hayBase) return;
    // Prueba en Moodle 5.2 (10/11): al conectar el proyecto a otro Moodle, el cursor seguía en
    // el id del anterior y el repaso se saltaba los primeros mensajes del nuevo.
    const campus = await crearCampus('Reconectar', { plugin: true });
    await query(`UPDATE moodle_plugin_campus SET sincronizado_hasta_id = 16, sincronizacion_error = 'viejo' WHERE project_id = $1`, [campus.id]);
    await crearClave(campus.id);
    const { rows: [c] } = await query('SELECT sincronizado_hasta_id, sincronizacion_error, activo FROM moodle_plugin_campus WHERE project_id = $1', [campus.id]);
    expect(c).toMatchObject({ sincronizado_hasta_id: null, sincronizacion_error: null, activo: true });
  });
});
