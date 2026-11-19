import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as servicio from '../src/modules/consultas/consultas.service.js';

/**
 * Reparto por curso y relevo (#679, parte 2 de #689), contra la base de verdad y con un
 * Moodle de mentira que contesta como uno de verdad:
 *
 *   · reparto por curso: una consulta va a una tutora DE ESE CURSO, nunca a una de otro,
 *     aunque esa otra esté más libre;
 *   · relevo: si la tutora no está («No disponible»), la cubre otra del mismo curso; si no
 *     hay ninguna, la consulta queda sin tutora (no se manda fuera del curso);
 *   · una conversación nueva del mismo alumno y curso entra en la consulta abierta;
 *   · punto 3 de Diego: con la transacción del mensaje abierta (bloqueo del alumno y
 *     FOR UPDATE de su consulta) no se pregunta NADA a Moodle, y un curso sin tutora
 *     vinculada no pregunta a Moodle con cada mensaje.
 *
 *   npx vitest run tests/consultasReparto679.test.js
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

// ─── Quién tiene una transacción abierta ─────────────────────────────────────
// Se envuelve `getClient` (lo único con lo que se abre una transacción): cada BEGIN suma
// y cada COMMIT/ROLLBACK resta. El Moodle de mentira apunta lo que le piden con alguna
// abierta. Todo lo demás de la base sigue igual.
const espia = vi.hoisted(() => ({ abiertas: 0, conTransaccion: [] }));

vi.mock('../src/shared/config/db.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    getClient: async () => {
      const client = await real.getClient();
      const consulta = (texto, ...resto) => {
        const sql = String(typeof texto === 'string' ? texto : texto?.text || '').trim().toUpperCase();
        if (sql === 'BEGIN') espia.abiertas += 1;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') espia.abiertas -= 1;
        return client.query(texto, ...resto);
      };
      return new Proxy(client, {
        get(t, k) {
          if (k === 'query') return consulta;
          const v = t[k];
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    },
  };
});

const marca = `t679r${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let alumnoN = 270000;
let conversacionN = 280000;
let mensajeN = 29000000;

// ─── El Moodle de mentira ────────────────────────────────────────────────────

const campusFalsos = new Map();

function campusFalso(url) {
  const c = {
    // curso → [{ id, rol }]
    cursos: new Map(),
    caido: false,
    // Antes de contestar la lista de un curso (para cambiarla entre una pregunta y otra).
    alPedirCurso: null,
    // Lo que se le ha preguntado: [{ f, curso, usuario }].
    preguntas: [],
  };
  campusFalsos.set(url, c);
  return c;
}

const json = (d) => ({ ok: true, status: 200, json: async () => d });

vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const base = String(url).replace(/\/webservice\/rest\/server\.php$/, '');
  const c = campusFalsos.get(base);
  if (!c) return json([]);
  const p = new URLSearchParams(body);
  const f = p.get('wsfunction');
  if (espia.abiertas > 0) espia.conTransaccion.push(f);
  if (c.caido) throw new TypeError('fetch failed');
  if (f === 'core_enrol_get_enrolled_users') {
    const curso = Number(p.get('courseid'));
    c.preguntas.push({ f, curso });
    if (c.alPedirCurso) c.alPedirCurso(curso);
    return json((c.cursos.get(curso) || []).map((g) => ({
      id: g.id, fullname: `Persona ${g.id}`, roles: [{ shortname: g.rol }], groups: [],
    })));
  }
  if (f === 'core_enrol_get_users_courses') {
    const uid = Number(p.get('userid'));
    c.preguntas.push({ f, usuario: uid });
    return json([...c.cursos.entries()].filter(([, gente]) => gente.some((g) => g.id === uid)).map(([id]) => ({ id, fullname: `Curso ${id}` })));
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
async function crearCampus(nombre) {
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
    [p, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url, consultas: true, consultas_desde: '2026-01-01T00:00:00Z' })]);
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

/** Otro mensaje del mismo alumno en la misma conversación. */
const otroMensaje = (m, texto = '¿Alguien?') => ({ ...m, externoId: (mensajeN += 1), texto, escritoAt: new Date() });

/** Corre `fn` con el reloj de las copias adelantado `ms` (solo `Date`: la base y los temporizadores, de verdad). */
async function dentroDe(ms, fn) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + ms));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.consultas') AS a, to_regclass('public.tutor_campus') AS b`);
    if (!t.rows[0].a || !t.rows[0].b) throw new Error('Faltan las migraciones de consultas y tutores.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterEach(() => {
  espia.conTransaccion.length = 0;
  vi.useRealTimers();
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
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
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

// ─── Reparto por curso y relevo ──────────────────────────────────────────────

describe('#679 · cada consulta, a una tutora de ese curso', () => {
  /*
    Curso 7: Laura y Carmen. Curso 8: Sofía. Sofía está libre y Carmen cargada: sin el
    filtro por curso, el reparto mandaría las consultas del curso 7 a Sofía.
  */
  async function escenario() {
    const campus = await crearCampus('Curso');
    const laura = await tutora(campus.id, 101);
    const carmen = await tutora(campus.id, 102);
    const sofia = await tutora(campus.id, 103);
    campus.moodle.cursos.set(7, [{ id: 101, rol: 'editingteacher' }, { id: 102, rol: 'teacher' }, { id: 900, rol: 'student' }]);
    campus.moodle.cursos.set(8, [{ id: 103, rol: 'editingteacher' }]);
    // Carmen ya lleva dos abiertas; Sofía, ninguna.
    for (let i = 0; i < 2; i += 1) {
      await servicio.entraMensajeDelAlumno(delAlumno(campus.id, 7), { tutorPreferido: carmen, avisar: false });
    }
    return { campus, laura, carmen, sofia };
  }

  it('va a la tutora a la que escribió el alumno, si es de ese curso', async () => {
    if (!hayBase) return;
    const { campus, laura } = await escenario();
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, 7), { tutorPreferido: laura, avisar: false });
    expect(r.consulta.tutor_id).toBe(laura);
  });

  it('relevo: con Laura «No disponible» la cubre Carmen (del curso), nunca Sofía (de otro, y más libre)', async () => {
    if (!hayBase) return;
    const { campus, laura, carmen } = await escenario();
    await noDisponible(laura);
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, 7), { tutorPreferido: laura, avisar: false });
    expect(r.consulta.tutor_id).toBe(carmen);
  });

  it('sin nadie del curso que pueda, queda sin tutora en vez de ir a otro curso', async () => {
    if (!hayBase) return;
    const { campus, laura, carmen } = await escenario();
    await noDisponible(laura);
    await noDisponible(carmen);
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, 7), { tutorPreferido: laura, avisar: false });
    expect(r.consulta.tutor_id).toBeNull();
  });

  it('si su tutora se va («No disponible») a mitad, el siguiente mensaje del alumno pasa la consulta a otra del curso', async () => {
    if (!hayBase) return;
    const { campus, laura, carmen } = await escenario();
    const m = delAlumno(campus.id, 7);
    const r1 = await servicio.entraMensajeDelAlumno(m, { tutorPreferido: laura, avisar: false });
    expect(r1.consulta.tutor_id).toBe(laura);
    await noDisponible(laura);
    const r2 = await servicio.entraMensajeDelAlumno(otroMensaje(m), { tutorPreferido: laura, avisar: false });
    expect(r2.nueva).toBe(false);
    expect(r2.consulta.id).toBe(r1.consulta.id);
    expect(r2.consulta.tutor_id).toBe(carmen);
    const { rows } = await query(`SELECT tipo, detalle FROM consulta_eventos WHERE consulta_id = $1 AND tipo = 'reasignada'`, [r1.consulta.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].detalle).toMatchObject({ de: laura, a: carmen, automatica: true });
  });

  it('alguien que entró en el curso hace un momento cuenta: con la copia de más de un minuto, se pregunta otra vez a Moodle antes de dejarla sin tutora', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Fresco');
    const laura = await tutora(campus.id, 201, { disponible: false });
    const carmen = await tutora(campus.id, 202);
    // La primera vez que se pregunta por el curso 9, solo está Laura (que no puede).
    let preguntas = 0;
    campus.moodle.cursos.set(9, [{ id: 201, rol: 'editingteacher' }]);
    campus.moodle.alPedirCurso = (curso) => { if (curso === 9) preguntas += 1; };
    const r1 = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, 9), { tutorPreferido: laura, avisar: false });
    // La lista se acaba de pedir: volver a pedirla en el mismo instante no aporta nada.
    expect(preguntas).toBe(1);
    expect(r1.consulta.tutor_id).toBeNull();
    // Carmen entra en el curso. Pasado el minuto, la copia (aún dentro de sus 2 min) no la
    // tiene, nadie del curso puede: se pregunta otra vez y aparece.
    campus.moodle.cursos.set(9, [{ id: 201, rol: 'editingteacher' }, { id: 202, rol: 'teacher' }]);
    const r2 = await dentroDe(61 * 1000,
      () => servicio.entraMensajeDelAlumno(delAlumno(campus.id, 9), { tutorPreferido: laura, avisar: false }));
    expect(preguntas).toBe(2);
    expect(r2.consulta.tutor_id).toBe(carmen);
  });

  it('un alumno sin cursos (mensajería general) va a la tutora a la que escribió, no se queda sin nadie', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('SinCursos');
    await tutora(campus.id, 351);
    const laura = await tutora(campus.id, 352);
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, null), { tutorPreferido: laura, avisar: false });
    expect(r.consulta.tutor_id).toBe(laura);
  });

  it('con el Moodle caído no se deja la consulta sin nadie: se reparte entre las del campus', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Caido');
    const ana = await tutora(campus.id, 301);
    campus.moodle.caido = true;
    const r = await servicio.entraMensajeDelAlumno(delAlumno(campus.id, 11), { avisar: false });
    expect(r.consulta.tutor_id).toBe(ana);
  });
});

describe('#679 · una sola consulta por alumno y curso', () => {
  it('si el alumno abre otra conversación del mismo curso (con la tutora que le cubre), entra en la consulta abierta', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Hilo');
    const laura = await tutora(campus.id, 401);
    const carmen = await tutora(campus.id, 402);
    campus.moodle.cursos.set(21, [{ id: 401, rol: 'editingteacher' }, { id: 402, rol: 'teacher' }]);
    const m = delAlumno(campus.id, 21);
    const r1 = await servicio.entraMensajeDelAlumno(m, { tutorPreferido: laura, avisar: false });
    // Laura deja de estar; el alumno vuelve a «Entrar al chat» y Moodle le abre la conversación con Carmen.
    await noDisponible(laura);
    const r2 = await servicio.entraMensajeDelAlumno(
      { ...m, conversacionId: (conversacionN += 1), externoId: (mensajeN += 1), texto: 'Sigo sin poder' },
      { tutorPreferido: carmen, avisar: false });
    expect(r2.nueva).toBe(false);
    expect(r2.consulta.id).toBe(r1.consulta.id);
    expect(r2.consulta.tutor_id).toBe(carmen);
    const { rows: [c] } = await query('SELECT conversaciones_extra FROM consultas WHERE id = $1', [r1.consulta.id]);
    expect((c.conversaciones_extra || []).map(Number)).toContain(conversacionN);
    const { rows: [n] } = await query(`SELECT COUNT(*)::int AS n FROM consulta_mensajes WHERE consulta_id = $1 AND autor = 'alumno'`, [r1.consulta.id]);
    expect(n.n).toBe(2);
  });
});

// ─── Punto 3 de Diego: Moodle, fuera de la transacción ───────────────────────

describe('#689 · punto 3: con la transacción del mensaje abierta no se pregunta a Moodle', () => {
  it('ni al abrir la consulta, ni en el relevo, ni con un alumno sin curso: todo lo de Moodle va antes', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('SinBloqueo');
    const laura = await tutora(campus.id, 501);
    const carmen = await tutora(campus.id, 502);
    campus.moodle.cursos.set(31, [{ id: 501, rol: 'editingteacher' }, { id: 502, rol: 'teacher' }, { id: 990, rol: 'student' }]);
    // Abre la consulta (reparto por curso).
    const m = delAlumno(campus.id, 31);
    const r1 = await servicio.entraMensajeDelAlumno(m, { tutorPreferido: laura, avisar: false });
    expect(r1.consulta.tutor_id).toBe(laura);
    // Relevo: Laura se va y el siguiente mensaje pasa a Carmen, con la copia pasada de
    // tiempo para que tenga que volver a preguntar.
    await noDisponible(laura);
    const r2 = await dentroDe(3 * 60 * 1000,
      () => servicio.entraMensajeDelAlumno(otroMensaje(m), { tutorPreferido: laura, avisar: false }));
    expect(r2.consulta.tutor_id).toBe(carmen);
    // Sin curso: se pregunta por los cursos del alumno (y luego por los de cada curso).
    const sinCurso = { ...delAlumno(campus.id, null), alumno: { moodleId: 990, nombre: 'Alumno 990' } };
    const r3 = await servicio.entraMensajeDelAlumno(sinCurso, { tutorPreferido: carmen, avisar: false });
    expect(r3.consulta.tutor_id).toBe(carmen);

    // A Moodle sí se le ha preguntado (si no, la prueba no probaría nada)…
    const funciones = campus.moodle.preguntas.map((p) => p.f);
    expect(funciones).toContain('core_enrol_get_enrolled_users');
    expect(funciones).toContain('core_enrol_get_users_courses');
    expect(funciones.filter((f) => f === 'core_enrol_get_enrolled_users').length).toBeGreaterThanOrEqual(2);
    // …pero nunca con una transacción abierta.
    expect(espia.conTransaccion).toEqual([]);
    expect(espia.abiertas).toBe(0);
  });

  it('un curso SIN tutora vinculada: cinco mensajes seguidos, una sola pregunta a Moodle en el minuto', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('SinTutora');
    // Laura es del campus, pero no de este curso: su profesora (991) no tiene ficha en el CRM.
    await tutora(campus.id, 601);
    campus.moodle.cursos.set(41, [{ id: 991, rol: 'editingteacher' }]);
    const delCurso41 = () => campus.moodle.preguntas.filter((p) => p.curso === 41).length;
    const m = delAlumno(campus.id, 41);
    const primero = await servicio.entraMensajeDelAlumno(m, { avisar: false });
    expect(primero.consulta.tutor_id).toBeNull();
    for (let i = 0; i < 4; i += 1) {
      const r = await servicio.entraMensajeDelAlumno(otroMensaje(m), { avisar: false });
      expect(r.consulta.id).toBe(primero.consulta.id);
      expect(r.consulta.tutor_id).toBeNull();
    }
    expect(delCurso41()).toBe(1);
    // Pasado el minuto, el siguiente mensaje sí vuelve a preguntar (por si alguien entró), una vez.
    await dentroDe(61 * 1000, async () => {
      await servicio.entraMensajeDelAlumno(otroMensaje(m), { avisar: false });
      await servicio.entraMensajeDelAlumno(otroMensaje(m), { avisar: false });
    });
    expect(delCurso41()).toBe(2);
    expect(espia.conTransaccion).toEqual([]);
  });

  it('un mensaje repetido no le pregunta nada a Moodle', async () => {
    if (!hayBase) return;
    const campus = await crearCampus('Repetido');
    await tutora(campus.id, 701);
    campus.moodle.cursos.set(51, [{ id: 701, rol: 'editingteacher' }]);
    const m = delAlumno(campus.id, 51);
    await servicio.entraMensajeDelAlumno(m, { avisar: false });
    const antes = campus.moodle.preguntas.length;
    const r = await dentroDe(3 * 60 * 1000, () => servicio.entraMensajeDelAlumno(m, { avisar: false }));
    expect(r.duplicado).toBe(true);
    expect(campus.moodle.preguntas.length).toBe(antes);
  });
});
