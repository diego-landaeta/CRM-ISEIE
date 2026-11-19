import {
  describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';

/**
 * CRM-ISEIE#457 (alertas de tutores; #769 y PR CRM#834 en el 360, su test es
 * entregasAdministracion769), el segundo escalón de las entregas sin corregir:
 *
 *  1. PLAZO: lo que ve una tutora y sigue sin nota a los 5 días naturales (o a los
 *     ENTREGAS_AVISO_ADMIN_DIAS) va a administración; si la tarea tiene «Recordarme calificar
 *     antes de» y llega antes, en esa fecha; nunca antes de las 48 h de la tutora.
 *  2. SIN TUTORA: lo que no ve ninguna tutora del CRM va directo a administración a las 48 h.
 *     Ni lo de cursos ocultos, ni lo de alumnos sin matrícula activa, ni lo reciente.
 *  3. Campana a administración del campus, una vez por entrega; correo solo con
 *     CONSULTAS_AVISO_ADMIN_CORREO=1 y a quien no lo ha apagado.
 *  4. Si el token del campus no puede leer la lista de cursos, el campus se salta y
 *     lo de las tutoras sigue avisándose.
 *
 * Contra la base LOCAL (con la migración 305) y un Moodle de mentira.
 */

vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus769.test', token: 'token-769' })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const {
  vueltaDeEntregas, avisarAdministracionDeEntregas, limiteAdministracion, diasAvisoAdmin, DIAS_AVISO_ADMIN,
  AVISO_ENTREGAS_FUERA_DE_PLAZO,
} = await import('../src/modules/tutores/tutor.entregasAdministracion.js');
const { TIPOS } = await import('../src/modules/notifications/tipos.js');

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const MARCA = `e769${Date.now().toString(36)}`;
const AHORA = new Date('2026-11-17T12:00:00Z');
const H = 3600 * 1000;
const hace = (h) => Math.floor((AHORA.getTime() - h * H) / 1000);

// ─── El Moodle de mentira ──────────────────────────────────────────────────────
// La tutora (Moodle 801) da el curso 40. El 41 lo da una profesora que NO está en el CRM
// (990). El 42 está oculto.
const profe = (id) => ({ id, fullname: `Profe ${id}`, roles: [{ shortname: 'editingteacher' }] });
const alumno = (id) => ({ id, fullname: `Alumno ${id}`, roles: [{ shortname: 'student' }] });
const MATRICULADOS = {
  40: [profe(801), alumno(1001), alumno(1002), alumno(1003), alumno(1004)],
  41: [profe(990), alumno(2001), alumno(2002)], // 2003 ya no está matriculado
  42: [profe(990), alumno(3001)],
};
const CURSOS_DEL_CAMPUS = [
  { id: 1, fullname: 'Sitio', format: 'site' },
  { id: 40, fullname: 'Curso con tutora', visible: 1 },
  { id: 41, fullname: 'Curso sin tutora', visible: 1 },
  { id: 42, fullname: 'Curso oculto', visible: 0 },
];
let TAREAS;
let ENTREGAS;
let sinListaDeCursos = false;
function deSerie() {
  sinListaDeCursos = false;
  TAREAS = {
    40: [
      { id: 140, cmid: 14, name: 'Tarea sin fecha de calificar', grade: 10 },
      // «Recordarme calificar antes de» hace 1 h.
      { id: 141, cmid: 15, name: 'Tarea con fecha de calificar', grade: 10, gradingduedate: hace(1) },
    ],
    41: [{ id: 150, cmid: 20, name: 'Tarea del curso sin tutora', grade: 10 }],
    42: [{ id: 160, cmid: 30, name: 'Tarea del curso oculto', grade: 10 }],
  };
  const sub = (userid, horas) => ({ userid, status: 'submitted', gradingstatus: 'notgraded', timemodified: hace(horas) });
  ENTREGAS = {
    140: [sub(1001, 50), sub(1002, 6 * 24)], // 50 h: solo la tutora · 6 días: administración
    // 60 h con la fecha de calificar ya pasada: administración. 50 h con la fecha antes de
    // las 48 h: administración a las 48 h. 20 h: aún nada (tampoco a la tutora).
    141: [sub(1001, 60), sub(1003, 50), sub(1004, 20)],
    150: [sub(2001, 50), sub(2002, 10), sub(2003, 60)], // sin tutora: solo 2001
    160: [sub(3001, 100)], // curso oculto: nada
  };
}

const alCampus = [];
const lista = (params, prefijo) => Object.entries(params).filter(([k]) => k.startsWith(prefijo)).map(([, v]) => Number(v));
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const params = Object.fromEntries(new URLSearchParams(body));
  const f = params.wsfunction;
  alCampus.push(f);
  let r = {};
  if (f === 'core_enrol_get_users_courses') r = Number(params.userid) === 801 ? [{ id: 40, fullname: 'Curso con tutora' }] : [];
  if (f === 'core_enrol_get_enrolled_users') r = MATRICULADOS[Number(params.courseid)] || [];
  if (f === 'core_course_get_courses_by_field') {
    r = sinListaDeCursos
      ? { exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' }
      : { courses: CURSOS_DEL_CAMPUS };
  }
  if (f === 'mod_assign_get_assignments') {
    r = { courses: lista(params, 'courseids').map((id) => ({ id, assignments: TAREAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_submissions') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, submissions: ENTREGAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_grades') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, grades: [] })) };
  }
  return { ok: true, status: 200, json: async () => r };
}));

// ─── La base: un campus de prueba, su tutora y dos admin ───────────────────────
let P;
let TUTORA;
let ADMIN;
let ADMIN_SIN_CORREO;
const usuarios = [];
async function usuario(rol, n) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${MARCA} ${n}`, `${n}@${MARCA}.test`, rol]);
  usuarios.push(Number(u.id));
  return Number(u.id);
}

beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`Campus ${MARCA}`, `campus-${MARCA}`, `k-${MARCA}`]);
  P = Number(p.id);
  const enc = encrypt('token-769');
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [P, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: 'https://campus769.test' })]);
  TUTORA = await usuario('tutor', 'tutora');
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', 801)`, [TUTORA, P]);
  ADMIN = await usuario('admin', 'admin');
  ADMIN_SIN_CORREO = await usuario('admin', 'apagado');
  for (const a of [ADMIN, ADMIN_SIN_CORREO]) {
    await q('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [a, P]);
  }
  await q('INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, $2)', [ADMIN_SIN_CORREO, AVISO_ENTREGAS_FUERA_DE_PLAZO]);
}, 60000);

const limpiar = async () => {
  await q('DELETE FROM entregas_avisos_administracion WHERE project_id = $1', [P]);
  await q('DELETE FROM entregas_sin_corregir_avisos WHERE project_id = $1', [P]);
  await q(`DELETE FROM admin_notifications WHERE type = $1 AND (metadata->>'project_id')::int = $2`, [AVISO_ENTREGAS_FUERA_DE_PLAZO, P]);
  await q(`DELETE FROM admin_notifications WHERE type = 'entregas_sin_corregir' AND target_user_ids && $1::int[]`, [[TUTORA]]);
};

beforeEach(async () => {
  alCampus.length = 0;
  deSerie();
  await limpiar();
});
afterEach(() => { vi.unstubAllEnvs(); });

afterAll(async () => {
  await limpiar();
  await q('DELETE FROM avisos_apagados WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM project_integrations WHERE project_id = $1', [P]);
  await q('DELETE FROM projects WHERE id = $1', [P]);
  await pool.end();
}, 60000);

const enviados = [];
const enviar = vi.fn(async (m) => { enviados.push(m); return { sent: true }; });
const vuelta = (extra = {}) => vueltaDeEntregas({
  ahora: AHORA, enviar, tutorIds: [TUTORA], projectIds: [P], freno: false, activo: true, env: {}, ...extra,
});
const filas = () => q(
  'SELECT tarea_id, alumno_moodle_id, motivo FROM entregas_avisos_administracion WHERE project_id = $1 ORDER BY tarea_id, alumno_moodle_id', [P])
  .then((r) => r.map((f) => [f.tarea_id, f.alumno_moodle_id, f.motivo]));
const campanas = () => q(
  `SELECT target_user_ids, title, message, link_path FROM admin_notifications WHERE type = $1 AND (metadata->>'project_id')::int = $2`,
  [AVISO_ENTREGAS_FUERA_DE_PLAZO, P]);
beforeEach(() => { enviados.length = 0; enviar.mockClear(); });

// ─── 1. Cuándo toca ────────────────────────────────────────────────────────────
describe('#769 · cuándo se avisa a administración de una entrega', () => {
  const entregada = new Date('2026-11-01T10:00:00Z');
  const en = (h) => new Date(entregada.getTime() + h * H);

  it('a los 5 días naturales de serie; ENTREGAS_AVISO_ADMIN_DIAS lo cambia; un valor raro se ignora', () => {
    expect(DIAS_AVISO_ADMIN).toBe(5);
    expect(limiteAdministracion({ entregadaAt: entregada }, {})).toEqual(en(5 * 24));
    expect(limiteAdministracion({ entregadaAt: entregada }, { ENTREGAS_AVISO_ADMIN_DIAS: '3' })).toEqual(en(3 * 24));
    expect(diasAvisoAdmin({ ENTREGAS_AVISO_ADMIN_DIAS: 'x' })).toBe(5);
    expect(diasAvisoAdmin({ ENTREGAS_AVISO_ADMIN_DIAS: '-2' })).toBe(5);
  });

  it('con «Recordarme calificar antes de» anterior, esa fecha; si es posterior, los 5 días', () => {
    expect(limiteAdministracion({ entregadaAt: entregada, calificarAntes: en(72) }, {})).toEqual(en(72));
    expect(limiteAdministracion({ entregadaAt: entregada, calificarAntes: en(200) }, {})).toEqual(en(120));
  });

  it('nunca antes del recordatorio a la tutora (48 h)', () => {
    expect(limiteAdministracion({ entregadaAt: entregada, calificarAntes: en(10) }, {})).toEqual(en(48));
    expect(limiteAdministracion({ entregadaAt: entregada }, { ENTREGAS_AVISO_ADMIN_DIAS: '1' })).toEqual(en(48));
  });
});

// ─── 2. La vuelta ──────────────────────────────────────────────────────────────
describe('#769 · la vuelta: primero la tutora, después administración', () => {
  it('administración: las de la tutora pasado su plazo y las del curso sin tutora a las 48 h', async () => {
    const r = await vuelta();
    // La tutora: todo lo de su curso de más de 48 h (4), como en la #681.
    expect(r.avisadas).toBe(4);
    expect(r.administracion).toBe(4);
    expect(await filas()).toEqual([
      [140, 1002, 'plazo'], // 6 días
      [141, 1001, 'plazo'], // la fecha de calificar ya pasó
      [141, 1003, 'plazo'], // fecha de calificar antes de las 48 h: a las 48 h
      [150, 2001, 'sin_tutora'], // curso sin tutora en el CRM, 50 h
    ]);
    // Una campana para administración del campus, con las dos clases.
    const [c, ...mas] = await campanas();
    expect(mas).toHaveLength(0);
    expect(c.target_user_ids.map(Number)).toEqual(expect.arrayContaining([ADMIN, ADMIN_SIN_CORREO]));
    expect(c.target_user_ids.map(Number)).not.toContain(TUTORA);
    expect(c.title).toMatch(/4 entregas siguen sin corregir/);
    expect(c.message).toMatch(/3 de tutoras, pasado el plazo · 1 de cursos sin tutora en el CRM/);
    expect(c.link_path).toBe('/tutores');
  });

  it('sin el correo encendido, a administración no le llega ningún correo', async () => {
    await vuelta();
    const aAdministracion = enviados.filter((m) => m.tags?.includes('administracion'));
    expect(aAdministracion).toHaveLength(0);
    expect(enviados.some((m) => m.to === `tutora@${MARCA}.test`)).toBe(true); // la tutora, sí
  });

  it('cada entrega una vez: la segunda vuelta no avisa de nada', async () => {
    await vuelta();
    const r = await vuelta({ ahora: new Date(AHORA.getTime() + 2 * H) });
    expect(r.administracion).toBe(0);
    expect(await campanas()).toHaveLength(1);
  });

  it('con CONSULTAS_AVISO_ADMIN_CORREO=1, un correo por persona con los enlaces; no a quien lo apagó', async () => {
    const r = await vuelta({ env: { CONSULTAS_AVISO_ADMIN_CORREO: '1' } });
    expect(r.administracionCorreos).toBeGreaterThanOrEqual(1);
    const suyo = enviados.filter((m) => m.to === `admin@${MARCA}.test`);
    expect(suyo).toHaveLength(1);
    expect(suyo[0].subject).toMatch(/4 entregas sin corregir fuera de plazo/);
    expect(suyo[0].htmlContent).toContain('Cursos sin tutora en el CRM');
    expect(suyo[0].htmlContent).toContain('https://campus769.test/mod/assign/view.php?id=20&amp;action=grader&amp;userid=2001');
    expect(suyo[0].htmlContent).toContain('https://campus769.test/mod/assign/view.php?id=14&amp;action=grader&amp;userid=1002');
    expect(suyo[0].htmlContent).toContain(`Tutora: ${MARCA} tutora`);
    expect(suyo[0].htmlContent).not.toContain('userid=2002'); // reciente
    expect(suyo[0].htmlContent).not.toContain('userid=2003'); // sin matrícula activa
    expect(suyo[0].htmlContent).not.toContain('userid=3001'); // curso oculto
    expect(enviados.some((m) => m.to === `apagado@${MARCA}.test`)).toBe(false);
  });

  it('el recordatorio a la tutora sigue respetando el freno de correos a tutores; administración no lo usa', async () => {
    const r = await vuelta({ freno: true });
    expect(r.frenados).toBe(1);
    expect(enviados.some((m) => m.to === `tutora@${MARCA}.test`)).toBe(false);
    expect(r.administracion).toBe(4);
  });

  it('si el token no puede leer la lista de cursos, el campus se salta, y lo de la tutora sigue avisándose', async () => {
    sinListaDeCursos = true;
    const r = await vuelta();
    expect(r.campusSaltados).toBe(1);
    expect((await filas()).map((f) => f[2])).toEqual(['plazo', 'plazo', 'plazo']);
  });

  it('si no se han podido leer los cursos de una tutora del campus, no se toma nada por «sin tutora»', async () => {
    const r = await avisarAdministracionDeEntregas({
      ahora: AHORA, enviar, env: {}, projectIds: [P], activo: true,
      recogida: { entregas: [], fallos: new Set([String(P)]) },
    });
    expect(r.sinTutora).toBe(0);
    expect(r.campusSaltados).toEqual([expect.objectContaining({ projectId: P })]);
    expect(alCampus).not.toContain('core_course_get_courses_by_field');
  });

  it('con el plugin sin aprobar en producción no hace nada', async () => {
    const r = await avisarAdministracionDeEntregas({ ahora: AHORA, enviar, projectIds: [P], activo: false });
    expect(r.apagado).toBe(true);
    expect(alCampus).toHaveLength(0);
    expect(await filas()).toEqual([]);
  });
});

// ─── 3. Dónde se engancha ──────────────────────────────────────────────────────
describe('#769 · piezas', () => {
  it('el job da la vuelta entera (tutora y administración)', () => {
    const job = fs.readFileSync(new URL('../src/jobs/entregasSinCorregirScheduler.js', import.meta.url), 'utf8');
    expect(job).toMatch(/\(\) => vueltaDeEntregas\(\)/);
  });

  it('el aviso existe en la campana y en «Mis preferencias»', () => {
    expect(TIPOS[AVISO_ENTREGAS_FUERA_DE_PLAZO]).toBeTruthy();
    const usuarios = fs.readFileSync(new URL('../src/modules/users/user.controller.js', import.meta.url), 'utf8');
    expect(usuarios).toContain(`aviso: '${AVISO_ENTREGAS_FUERA_DE_PLAZO}'`);
  });

  // En el 360 aquí se comprueba que el plugin 1.10.8 añade la lista de cursos al servicio.
  // En ISEIE no hay plugin: la da el token del campus, y sin ella el campus se salta
  // (lo prueba «si el token no puede leer la lista de cursos…», arriba).
  it('app.js arranca el job solo con el interruptor encendido', () => {
    const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    expect(app).toMatch(/if \(pluginMoodleActivo\(\)\) startEntregasSinCorregirScheduler\(\);/);
  });
});
