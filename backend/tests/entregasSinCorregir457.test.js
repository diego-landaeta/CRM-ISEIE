import {
  describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';

/**
 * CRM-ISEIE#457, porte de la parte 7 de la #681 del CRM 360 (PR CRM#736; su test es
 * tutoresMiCampusPendientes681). Lo que necesita el aviso de entregas sin corregir:
 *
 *  1. El % hecho de cada alumno, curso a curso: el avance de Moodle (#532), con la misma
 *     llamada de `cursosDe`. Un curso sin seguimiento de finalización da «—» (null), no 0,
 *     y no se pregunta por sus alumnos; un alumno en dos cursos cuesta UNA llamada.
 *  2. El aviso a la tutora de las entregas sin corregir de más de 48 h: una vez por entrega,
 *     un correo por tutora con todas, respeta el freno de correos a tutores y el interruptor
 *     del plugin, y no avisa de lo corregido ni de lo que lleva menos de 48 h.
 *
 * Contra la base LOCAL (un campus de prueba, sus tutoras y la tabla de la migración 304) y con
 * un Moodle de mentira: un `fetch` que contesta y apunta lo que se le pide. En ISEIE no hay
 * «Mi campus» todavía (#406/#408): el correo no lleva enlace al CRM, solo a Moodle.
 */

vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  // El campus de prueba se crea en la base (su id cambia); su Moodle de mentira es siempre este.
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus1.test', token: 'token-1' })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { cursosDe, progresoDeMoodle } = await import('../src/shared/services/moodle.client.js');
const { leerSusCampus, progresoDeAlumnos } = await import('../src/modules/tutores/tutor.micampus.js');
const { avisarEntregasSinCorregir, entregasVencidas, HORAS_SIN_CORREGIR } = await import('../src/modules/tutores/tutor.entregasSinCorregir.js');

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const MARCA = `P7${Date.now().toString(36)}`;
const AHORA = new Date('2026-11-11T12:00:00Z');
const hace = (h) => Math.floor((AHORA.getTime() - h * 3600 * 1000) / 1000);
let CAMPUS;

// ─── Los Moodle de mentira ─────────────────────────────────────────────────────
// Tutora 1 = 701 (cursos 30 y 33 con seguimiento; 32 sin él). Tutora 2 = 702 (curso 31).
const CURSOS_DE = {
  701: [{ id: 30, fullname: 'Curso A', enablecompletion: true }, { id: 32, fullname: 'Curso sin seguimiento', enablecompletion: false }, { id: 33, fullname: 'Curso C', enablecompletion: 1 }],
  702: [{ id: 31, fullname: 'Curso B', enablecompletion: false }],
  900: [{ id: 30, enablecompletion: true, progress: 40.4 }, { id: 33, enablecompletion: true, progress: 0 }],
  901: [{ id: 30, enablecompletion: true, progress: null }],
  902: [{ id: 30, enablecompletion: true, progress: 100 }],
  903: [{ id: 32, enablecompletion: false, progress: 75 }],
};
const profe = (id) => ({ id, fullname: `Tutora ${id}`, roles: [{ shortname: 'editingteacher' }] });
const alumno = (id, n) => ({ id, fullname: n, roles: [{ shortname: 'student' }] });
const MATRICULADOS = {
  30: [profe(701), alumno(900, 'Ana'), alumno(901, 'Beto'), alumno(902, 'Carla')],
  31: [profe(702), alumno(950, 'Dani')],
  32: [profe(701), alumno(903, 'Eva')],
  33: [profe(701), alumno(900, 'Ana')],
};
const TAREAS = {
  30: [{ id: 77, cmid: 7, name: 'Tarea 1', grade: 10 }, { id: 78, cmid: 8, name: 'Tarea 2', grade: 10 }],
  31: [{ id: 88, cmid: 18, name: 'Tarea B', grade: 10 }],
};
let ENTREGAS;
let NOTAS;
function entregasDeSerie() {
  ENTREGAS = {
    77: [
      { userid: 900, status: 'submitted', gradingstatus: 'notgraded', timemodified: hace(50) }, // avisar
      { userid: 901, status: 'submitted', gradingstatus: 'notgraded', timemodified: hace(10) }, // menos de 48 h
      { userid: 902, status: 'submitted', gradingstatus: 'graded', timemodified: hace(60) }, // corregida
    ],
    78: [{ userid: 900, status: 'submitted', gradingstatus: 'notgraded', timemodified: hace(72) }], // avisar
    88: [{ userid: 950, status: 'submitted', gradingstatus: 'notgraded', timemodified: hace(49) }], // avisar (tutora 2)
  };
  NOTAS = { 77: [{ userid: 902, grade: '8.00', timemodified: hace(30) }] };
}

const alCampus = [];
const lista = (params, prefijo) => Object.entries(params).filter(([k]) => k.startsWith(prefijo)).map(([, v]) => Number(v));
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const params = Object.fromEntries(new URLSearchParams(body));
  const f = params.wsfunction;
  alCampus.push({ f, params });
  let r = {};
  if (f === 'core_enrol_get_users_courses') r = CURSOS_DE[Number(params.userid)] || [];
  if (f === 'core_enrol_get_enrolled_users') r = MATRICULADOS[Number(params.courseid)] || [];
  if (f === 'mod_assign_get_assignments') {
    r = { courses: lista(params, 'courseids').map((id) => ({ id, assignments: TAREAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_submissions') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, submissions: ENTREGAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_grades') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, grades: NOTAS[id] || [] })) };
  }
  return { ok: true, status: 200, json: async () => r };
}));
const llamadas = (f, userid) => alCampus.filter((x) => x.f === f && (userid === undefined || Number(x.params.userid) === userid)).length;

// ─── La base: un campus de prueba y dos tutoras con su cuenta de Moodle en él ───
// (la base de ISEIE sale vacía de `db:preparar -- --datos`: no hay un campus 1 que usar).
let T1;
let T2;
const ids = [];
beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`Campus ${MARCA}`, `campus-${MARCA.toLowerCase()}`, `k-${MARCA}`]);
  CAMPUS = Number(p.id);
  for (const [n, moodle] of [['UNO', 701], ['DOS', 702]]) {
    const [u] = await q(
      `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', true) RETURNING id, nombre, email`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`]);
    await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`, [u.id, CAMPUS, moodle]);
    ids.push(u.id);
  }
  [T1, T2] = ids;
}, 60000);

beforeEach(async () => {
  alCampus.length = 0;
  entregasDeSerie();
  await q('DELETE FROM entregas_sin_corregir_avisos WHERE tutor_id = ANY($1::int[])', [ids]);
  await q(`DELETE FROM admin_notifications WHERE type = 'entregas_sin_corregir' AND target_user_ids && $1::int[]`, [ids]);
});
afterEach(() => { vi.unstubAllEnvs(); });

afterAll(async () => {
  await q('DELETE FROM entregas_sin_corregir_avisos WHERE tutor_id = ANY($1::int[])', [ids]);
  await q(`DELETE FROM admin_notifications WHERE type = 'entregas_sin_corregir' AND target_user_ids && $1::int[]`, [ids]);
  await q('DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = $1', [CAMPUS]);
  await pool.end();
}, 60000);

// ─── 1. El % hecho ─────────────────────────────────────────────────────────────
describe('#681 · el % hecho de cada alumno en Mi campus', () => {
  it('lo que da Moodle, redondeado; sin seguimiento o sin dato, null (no 0); un 0 real es 0', () => {
    expect(progresoDeMoodle({ enablecompletion: true, progress: 40.4 })).toBe(40);
    expect(progresoDeMoodle({ enablecompletion: 1, progress: 0 })).toBe(0);
    expect(progresoDeMoodle({ enablecompletion: true, progress: null })).toBeNull();
    expect(progresoDeMoodle({ enablecompletion: true })).toBeNull();
    expect(progresoDeMoodle({ enablecompletion: false, progress: 75 })).toBeNull();
    expect(progresoDeMoodle({ enablecompletion: 0, progress: 75 })).toBeNull();
  });

  it('cursosDe trae el seguimiento y el % del usuario en cada curso (la misma llamada de la ficha)', async () => {
    const c = await cursosDe({ url: 'https://campus1.test', token: 't' }, 900);
    expect(c.map((k) => [k.id, k.seguimiento, k.progreso])).toEqual([[30, true, 40], [33, true, 0]]);
  });

  it('cada alumno con su % por curso; el curso sin seguimiento sale «—» y no se pregunta por sus alumnos', async () => {
    const [campus] = await leerSusCampus(T1);
    const curso = (id) => campus.cursos.find((k) => k.id === id);
    const pct = (id) => Object.fromEntries(curso(id).alumnos.map((a) => [a.nombre, a.progreso]));
    expect(pct(30)).toEqual({ Ana: 40, Beto: null, Carla: 100 });
    expect(pct(33)).toEqual({ Ana: 0 });
    expect(curso(32).seguimiento).toBe(false);
    expect(pct(32)).toEqual({ Eva: null });
    // Eva (903) solo está en el curso sin seguimiento: ni una llamada por ella.
    expect(llamadas('core_enrol_get_users_courses', 903)).toBe(0);
    // Ana (900) está en dos cursos con seguimiento: UNA llamada.
    expect(llamadas('core_enrol_get_users_courses', 900)).toBe(1);
  });

  it('con más alumnos que MI_CAMPUS_MAX_PROGRESO no se pregunta por ninguno, y se dice en el curso', async () => {
    vi.stubEnv('MI_CAMPUS_MAX_PROGRESO', '2');
    const [campus] = await leerSusCampus(T1);
    const curso = campus.cursos.find((k) => k.id === 30);
    expect(curso.avisoProgreso).toMatch(/más de 2 alumnos/);
    expect(curso.alumnos.every((a) => a.progreso === null)).toBe(true);
    expect(llamadas('core_enrol_get_users_courses', 900)).toBe(0);
  });

  it('sin el % (conProgreso: false, lo que usa el aviso) no hay ni una llamada por alumno', async () => {
    await leerSusCampus(T1, { conProgreso: false });
    expect(llamadas('core_enrol_get_users_courses')).toBe(1); // solo la de la tutora
  });

  it('progresoDeAlumnos sin cursos con seguimiento no llama a nadie', async () => {
    const r = await progresoDeAlumnos({ url: 'https://campus1.test', token: 't' }, [{ id: 32, seguimiento: false, alumnos: [{ id: 903 }] }]);
    expect(r.porAlumno.size).toBe(0);
    expect(alCampus.length).toBe(0);
  });
});

// ─── 2. El aviso de 48 h ───────────────────────────────────────────────────────
describe('#681 · aviso a la tutora de las entregas sin corregir de más de 48 h', () => {
  const enviados = [];
  const enviar = vi.fn(async (m) => { enviados.push(m); return { sent: true }; });
  const vuelta = (extra = {}) => avisarEntregasSinCorregir({
    ahora: AHORA, enviar, tutorIds: ids, freno: false, activo: true, ...extra,
  });
  beforeEach(() => { enviados.length = 0; enviar.mockClear(); });

  it('solo las de más de 48 h y sin corregir; ni la reciente ni la ya corregida', async () => {
    const campus = await leerSusCampus(T1, { conProgreso: false });
    const v = entregasVencidas(campus, AHORA);
    expect(v.map((e) => [e.tareaId, e.alumnoId])).toEqual([[77, 900], [78, 900]]);
    expect(HORAS_SIN_CORREGIR).toBe(48);
  });

  it('un correo por tutora con todas sus entregas, enlace a Mi campus y a cada entrega en Moodle', async () => {
    const r = await vuelta();
    expect(r).toMatchObject({ tutoras: 2, avisadas: 3, correos: 2, frenados: 0, errores: 0 });
    expect(enviados).toHaveLength(2);
    const uno = enviados.find((m) => m.to === `uno@${MARCA.toLowerCase()}.test`);
    expect(uno.subject).toMatch(/2 entregas sin corregir desde hace más de 48 h/);
    // Sin «Mi campus» en ISEIE (llega con la #408): ni botón ni enlace a una pantalla que no existe.
    expect(uno.htmlContent).not.toContain('mis-cursos');
    expect(uno.htmlContent).toContain('https://campus1.test/mod/assign/view.php?id=7&amp;action=grader&amp;userid=900');
    expect(uno.htmlContent).toContain('https://campus1.test/mod/assign/view.php?id=8&amp;action=grader&amp;userid=900');
    expect(uno.htmlContent).not.toContain('userid=901');
    expect(uno.htmlContent).not.toContain('userid=902');
    const dos = enviados.find((m) => m.to === `dos@${MARCA.toLowerCase()}.test`);
    expect(dos.htmlContent).toContain('id=18&amp;action=grader&amp;userid=950');
    // Apuntadas, con el correo hecho.
    const filas = await q('SELECT tutor_id, tarea_id, alumno_moodle_id, por_correo FROM entregas_sin_corregir_avisos WHERE tutor_id = ANY($1::int[]) ORDER BY tarea_id', [ids]);
    expect(filas.map((f) => [Number(f.tutor_id), f.tarea_id, f.alumno_moodle_id, f.por_correo]))
      .toEqual([[T1, 77, 900, true], [T1, 78, 900, true], [T2, 88, 950, true]]);
    // Y en la campana, un aviso por tutora.
    const avisos = await q(`SELECT target_user_ids FROM admin_notifications WHERE type = 'entregas_sin_corregir' AND target_user_ids && $1::int[]`, [ids]);
    expect(avisos).toHaveLength(2);
  });

  it('no repite: la segunda vuelta no avisa de nada', async () => {
    await vuelta();
    enviados.length = 0;
    const r = await vuelta({ ahora: new Date(AHORA.getTime() + 3 * 3600 * 1000) });
    expect(r.avisadas).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('si el alumno vuelve a entregar, es otra entrega: se avisa de esa, cuando pasen sus 48 h, y no de las ya avisadas', async () => {
    await vuelta();
    enviados.length = 0;
    ENTREGAS[77][0].timemodified = hace(1); // la vuelve a entregar ahora
    expect((await vuelta()).avisadas).toBe(0);
    const r = await vuelta({ ahora: new Date(AHORA.getTime() + 49 * 3600 * 1000) });
    // La nueva de Ana y, ya pasadas sus 48 h, la de Beto; la Tarea 2 de Ana ya estaba avisada.
    expect(r.avisadas).toBe(2);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].htmlContent).toContain('id=7&amp;action=grader&amp;userid=900');
    expect(enviados[0].htmlContent).toContain('id=7&amp;action=grader&amp;userid=901');
    expect(enviados[0].htmlContent).not.toContain('id=8&amp;action=grader');
    expect(enviados[0].subject).toMatch(/2 entregas sin corregir/);
  });

  it('una corregida antes de las 48 h no se avisa nunca', async () => {
    ENTREGAS[88][0].gradingstatus = 'graded';
    NOTAS[88] = [{ userid: 950, grade: '7.00', timemodified: hace(2) }];
    await vuelta();
    expect(enviados.map((m) => m.to)).toEqual([`uno@${MARCA.toLowerCase()}.test`]);
  });

  it('con el freno de correos a tutores: sin correo, con campana, y apuntadas (no se repite al quitarlo)', async () => {
    const r = await vuelta({ freno: true });
    expect(r).toMatchObject({ avisadas: 3, correos: 0, frenados: 2 });
    expect(enviar).not.toHaveBeenCalled();
    const avisos = await q(`SELECT 1 FROM admin_notifications WHERE type = 'entregas_sin_corregir' AND target_user_ids && $1::int[]`, [ids]);
    expect(avisos).toHaveLength(2);
    const filas = await q('SELECT por_correo FROM entregas_sin_corregir_avisos WHERE tutor_id = ANY($1::int[])', [ids]);
    expect(filas.map((f) => f.por_correo)).toEqual([false, false, false]);
    expect((await vuelta()).avisadas).toBe(0);
  });

  it('el freno de serie es el de frenoTutores.js', async () => {
    const { NO_ESCRIBIR_A_TUTORES } = await import('../src/shared/config/frenoTutores.js');
    const r = await avisarEntregasSinCorregir({ ahora: AHORA, enviar, tutorIds: ids, activo: true });
    expect(r.frenados > 0).toBe(NO_ESCRIBIR_A_TUTORES);
  });

  it('con el plugin sin aprobar en producción no hace nada: ni Moodle, ni base, ni correo', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_BASE_URL', 'https://crm.iseie.com');
    vi.stubEnv('PLUGIN_MOODLE_EN_PRODUCCION', '');
    const r = await avisarEntregasSinCorregir({ ahora: AHORA, enviar, tutorIds: ids, freno: false });
    expect(r.apagado).toBe(true);
    expect(alCampus).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
    expect(await q('SELECT 1 FROM entregas_sin_corregir_avisos WHERE tutor_id = ANY($1::int[])', [ids])).toHaveLength(0);
  });

  it('app.js solo arranca el job con el plugin aprobado, y el job se registra en el latido', async () => {
    const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    expect(app).toMatch(/if \(pluginMoodleActivo\(\)\) startEntregasSinCorregirScheduler\(\);/);
    const vigilar = vi.fn();
    vi.doMock('../src/jobs/latido.js', () => ({ vigilar }));
    const { startEntregasSinCorregirScheduler } = await import('../src/jobs/entregasSinCorregirScheduler.js');
    startEntregasSinCorregirScheduler();
    expect(vigilar.mock.calls.map((c) => c[0])).toEqual(['entregas_sin_corregir']);
    vi.doUnmock('../src/jobs/latido.js');
  });
});
