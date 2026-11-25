import {
  describe, it, expect, vi, beforeAll, afterAll,
} from 'vitest';

/**
 * «Mi campus» cuenta lo mismo que Moodle (CRM#1062 / CRM-ISEIE#722, de la comprobación del 23/11 en la CRM#681).
 *
 *  1. CUÁNDO UNA ENTREGA ESTÁ POR CORREGIR. La regla de mod/assign (Moodle 4.5,
 *     `assign::count_submissions_need_grading` y el filtro «Necesita calificación» de
 *     gradingtable.php): enviada y, en la fila de nota de su último intento, sin fila, nota
 *     vacía, `s.timemodified >= g.timemodified` (la MISMA hora cuenta) o, con escala, -1.
 *  2. QUÉ ALUMNOS VE LA TUTORA. Los que pueden entregar (rol de alumno) y, solo si es
 *     profesora sin permiso de edición, está en algún grupo y el modo de grupo es SEPARADOS,
 *     los de sus grupos. El modo es el del curso para su lista y el de cada tarea para sus
 *     entregas (el del curso si lo fuerza). Si no se puede saber, se recorta como antes.
 *
 * Contra la base LOCAL (la tutora y su campus) y un Moodle de mentira (`fetch`).
 */

vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async (projectId) => ({ url: `https://campus${projectId}.test`, token: `token-${projectId}` })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { porCorregir, modoDeLaTarea } = await import('../src/shared/services/moodle.client.js');
const { leerSusCampus, alumnosDe } = await import('../src/modules/tutores/tutor.micampus.js');

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const MARCA = `M1062${Date.now().toString(36)}`;
let CAMPUS;
const T0 = 1_763_900_000; // un instante cualquiera, en segundos (como Moodle)

// ─── 1. La regla de «Necesita calificación» ─────────────────────────────────────
describe('#722 · cuándo una entrega está por corregir: la regla de Moodle', () => {
  const at = (s) => new Date((T0 + s) * 1000);
  const enviada = (s) => ({ estado: 'submitted', gradingstatus: 'graded', entregadaAt: at(s) });
  const nota = (s, bruta = 8) => ({ nota: bruta >= 0 ? bruta : null, bruta, at: at(s) });

  it('entregada en el MISMO segundo que la nota: por corregir (Moodle usa >=)', () => {
    expect(porCorregir(enviada(0), nota(0))).toBe(true);
  });
  it('un segundo antes de la nota: corregida; un segundo después: por corregir', () => {
    expect(porCorregir(enviada(-1), nota(0))).toBe(false);
    expect(porCorregir(enviada(1), nota(0))).toBe(true);
  });
  it('sin fila de nota, o con la nota vacía: por corregir; sin enviar, nunca', () => {
    expect(porCorregir({ estado: 'submitted', gradingstatus: 'notgraded', entregadaAt: at(0) }, undefined)).toBe(true);
    expect(porCorregir(enviada(-5), { nota: null, bruta: null, at: at(0) })).toBe(true);
    expect(porCorregir({ estado: 'new', entregadaAt: null }, undefined)).toBe(false);
    expect(porCorregir({ estado: 'draft', entregadaAt: at(5) }, nota(0))).toBe(false);
  });
  it('nota numérica en -1 («sin nota», un comentario solo) guardada después: Moodle ya no la pide', () => {
    expect(porCorregir(enviada(-5), nota(0, -1))).toBe(false);
    expect(porCorregir(enviada(0), nota(0, -1))).toBe(true);
  });
  it('con escala, -1 es «sin calificar»: por corregir aunque sea posterior', () => {
    expect(porCorregir(enviada(-5), nota(0, -1), { escala: true })).toBe(true);
    expect(porCorregir(enviada(-5), nota(0, 2), { escala: true })).toBe(false);
  });
});

// ─── 2. El modo de grupo que vale para una tarea ────────────────────────────────
describe('#722 · el modo de grupo de una tarea, como groups_get_activity_groupmode', () => {
  const tareas = new Map([[11, 0], [12, 1]]);
  it('el del curso si lo fuerza; si no, el de la tarea; sin el suyo, el del curso', () => {
    expect(modoDeLaTarea({ curso: 1, forzado: true, tareas }, 11)).toBe(1);
    expect(modoDeLaTarea({ curso: 1, forzado: false, tareas }, 11)).toBe(0);
    expect(modoDeLaTarea({ curso: 2, forzado: false, tareas }, 99)).toBe(2);
  });
  it('sin saber el del curso, no se sabe (aunque se sepa el de la tarea)', () => {
    expect(modoDeLaTarea({ curso: null, forzado: null, tareas }, 11)).toBe(null);
  });
  it('alumnosDe: sin saber el modo, recorta como antes; sin grupos o visibles, todos', () => {
    const gente = [
      { id: 1, roles: ['teacher'], grupos: [10] },
      { id: 2, roles: ['student'], grupos: [10] },
      { id: 3, roles: ['student'], grupos: [20] },
      { id: 4, roles: ['student'], grupos: [] },
      { id: 5, roles: ['student', 'teacher'], grupos: [20] },
    ];
    expect(alumnosDe(gente, gente[0]).map((a) => a.id)).toEqual([2]);
    expect(alumnosDe(gente, gente[0], { modo: 1 }).map((a) => a.id)).toEqual([2]);
    expect(alumnosDe(gente, gente[0], { modo: 0 }).map((a) => a.id)).toEqual([2, 3, 4, 5]);
    expect(alumnosDe(gente, gente[0], { modo: 2 }).map((a) => a.id)).toEqual([2, 3, 4, 5]);
  });
});

// ─── 3. «Mi campus» entero, contra un Moodle de mentira ─────────────────────────
// La tutora es 801: profesora SIN edición en el grupo 10 de los cursos 40-80, y CON
// edición (también en el grupo 10) en el 90.
const TUTORA = 801;
const CURSOS_DE = {
  [TUTORA]: [40, 50, 60, 70, 80, 90].map((id) => ({ id, fullname: `Curso ${id}`, enablecompletion: false })),
};
const persona = (id, rol, grupos = []) => ({
  id, fullname: `Persona ${id}`, roles: [{ shortname: rol }], groups: grupos.map((g) => ({ id: g })),
});
const tutora = (rol = 'teacher') => persona(TUTORA, rol, [10]);
const MATRICULADOS = {
  40: [tutora(), persona(910, 'student', [10]), persona(911, 'student', [20]), persona(912, 'student')],
  50: [tutora(), persona(920, 'student', [10]), persona(921, 'student', [20]), persona(922, 'student')],
  60: [tutora(), persona(930, 'student', [10]), persona(931, 'student', [20])],
  70: [tutora(), persona(940, 'student', [10]), persona(941, 'student', [20])],
  80: [tutora(), persona(950, 'student', [10]), persona(951, 'student', [20])],
  90: [tutora('editingteacher'), persona(960, 'student', [10]), persona(961, 'student', [20]), persona(962, 'student', [20])],
};
// Modo de grupo de cada curso (0 sin grupos, 1 separados, 2 visibles); 'falla' = Moodle no lo da.
const CURSO_INFO = {
  40: { groupmode: 0, groupmodeforce: 0 },
  50: { groupmode: 1, groupmodeforce: 1 },
  60: { groupmode: 1, groupmodeforce: 0 },
  70: { groupmode: 2, groupmodeforce: 0 },
  80: 'falla',
  90: { groupmode: 1, groupmodeforce: 1 },
};
// El modo propio de cada tarea (cmid → modo), por curso.
const MODOS_TAREA = { 40: { 41: 0 }, 60: { 61: 0, 62: 1 }, 70: { 71: 2 } };
const TAREAS = {
  40: [{ id: 400, cmid: 41, name: 'T40', grade: 10 }],
  50: [{ id: 500, cmid: 51, name: 'T50', grade: 10 }],
  60: [{ id: 600, cmid: 61, name: 'T60 sin grupos', grade: 10 }, { id: 601, cmid: 62, name: 'T60 separados', grade: 10 }],
  70: [{ id: 700, cmid: 71, name: 'T70', grade: 10 }],
  80: [{ id: 800, cmid: 81, name: 'T80', grade: 10 }],
  90: [{ id: 900, cmid: 91, name: 'T90 numérica', grade: 10 }, { id: 901, cmid: 92, name: 'T90 escala', grade: -3 }],
};
const sub = (userid, timemodified = T0) => ({ userid, status: 'submitted', gradingstatus: 'notgraded', timemodified });
const ENTREGAS = {
  400: [sub(911), sub(912)],
  500: [sub(920), sub(921), sub(922)],
  600: [sub(930), sub(931)],
  601: [sub(930), sub(931)],
  700: [sub(941)],
  800: [sub(950), sub(951)],
  // 960: entregada en el mismo segundo que la nota; 961: un segundo antes; 962: después de un -1.
  900: [{ ...sub(960, T0), gradingstatus: 'graded' }, { ...sub(961, T0 - 1), gradingstatus: 'graded' }, sub(962, T0 - 10)],
  901: [sub(960, T0 - 10)],
};
const NOTAS = {
  900: [
    { userid: 960, grade: '7.00000', timemodified: T0 },
    { userid: 961, grade: '7.00000', timemodified: T0 },
    { userid: 962, grade: '-1.00000', timemodified: T0 },
  ],
  901: [{ userid: 960, grade: '-1.00000', timemodified: T0 }],
};

const alCampus = [];
const lista = (params, prefijo) => Object.entries(params).filter(([k]) => k.startsWith(prefijo)).map(([, v]) => Number(v));
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const params = Object.fromEntries(new URLSearchParams(body));
  const f = params.wsfunction;
  alCampus.push({ f, params });
  let r = {};
  if (f === 'core_enrol_get_users_courses') r = CURSOS_DE[Number(params.userid)] || [];
  if (f === 'core_enrol_get_enrolled_users') r = MATRICULADOS[Number(params.courseid)] || [];
  if (f === 'core_course_get_courses_by_field') {
    const info = CURSO_INFO[Number(params.value)];
    r = info === 'falla'
      ? { exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' }
      : { courses: info ? [{ id: Number(params.value), ...info }] : [] };
  }
  if (f === 'core_course_get_contents') {
    const modos = MODOS_TAREA[Number(params.courseid)] || {};
    r = [{ id: 1, section: 0, modules: Object.entries(modos).map(([cmid, groupmode]) => ({ id: Number(cmid), modname: 'assign', groupmode })) }];
  }
  if (f === 'mod_assign_get_assignments') {
    r = { courses: lista(params, 'courseids').map((id) => ({ id, assignments: TAREAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_submissions') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, submissions: ENTREGAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_grades') {
    r = { assignments: lista(params, 'assignmentids').filter((id) => NOTAS[id]).map((id) => ({ assignmentid: id, grades: NOTAS[id] })) };
  }
  return { ok: true, status: 200, json: async () => r };
}));
const pedidas = (f, campo, valor) => alCampus.filter((x) => x.f === f && Number(x.params[campo]) === valor).length;

let T;
beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`Campus ${MARCA}`, `campus-${MARCA.toLowerCase()}`, `k-${MARCA}`]);
  CAMPUS = Number(p.id);
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', true) RETURNING id`,
    [`${MARCA} tutora`, `tutora@${MARCA.toLowerCase()}.test`]);
  T = u.id;
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`, [T, CAMPUS, TUTORA]);
}, 60000);
afterAll(async () => {
  await q('DELETE FROM tutor_campus WHERE tutor_id = $1', [T]);
  await q('DELETE FROM users WHERE id = $1', [T]);
  await q('DELETE FROM projects WHERE id = $1', [CAMPUS]);
  await pool.end();
}, 60000);

describe('#722 · Mi campus: qué alumnos y qué entregas ve la tutora', () => {
  let cursos;
  beforeAll(async () => {
    const [campus] = await leerSusCampus(T, { conProgreso: false });
    expect(campus.error).toBe(null);
    cursos = new Map(campus.cursos.map((k) => [k.id, k]));
  });
  const alumnos = (id) => cursos.get(id).alumnos.map((a) => a.id).sort();
  const sinCorregir = (cursoId, tareaId) => cursos.get(cursoId).tareas.find((t) => t.id === tareaId).sinCorregir.map((e) => e.alumnoId).sort();

  it('curso SIN grupos (aunque haya grupos creados): todos, también la alumna de otro grupo y la que no tiene', () => {
    expect(alumnos(40)).toEqual([910, 911, 912]);
    expect(sinCorregir(40, 400)).toEqual([911, 912]);
  });

  it('grupos SEPARADOS forzados: solo los de su grupo; la de otro grupo y la que no tiene, no', () => {
    expect(alumnos(50)).toEqual([920]);
    expect(sinCorregir(50, 500)).toEqual([920]);
  });

  it('curso separado con una tarea sin grupos: su lista recortada, pero esa tarea enseña a todos', () => {
    expect(alumnos(60)).toEqual([930]);
    expect(sinCorregir(60, 600)).toEqual([930, 931]);
    expect(sinCorregir(60, 601)).toEqual([930]);
  });

  it('grupos VISIBLES: todos', () => {
    expect(alumnos(70)).toEqual([940, 941]);
    expect(sinCorregir(70, 700)).toEqual([941]);
  });

  it('si Moodle no dice el modo (plugin antiguo o sin permiso): se recorta como antes, sin error', () => {
    expect(alumnos(80)).toEqual([950]);
    expect(sinCorregir(80, 800)).toEqual([950]);
    expect(cursos.get(80).error).toBe(null);
  });

  it('con permiso de edición ve todos los grupos, y no se pregunta el modo', () => {
    expect(alumnos(90)).toEqual([960, 961, 962]);
    expect(pedidas('core_course_get_courses_by_field', 'value', 90)).toBe(0);
    expect(pedidas('core_course_get_contents', 'courseid', 90)).toBe(0);
  });

  it('el modo de cada tarea solo se pide si el curso no lo fuerza', () => {
    expect(pedidas('core_course_get_contents', 'courseid', 50)).toBe(0);
    expect(pedidas('core_course_get_contents', 'courseid', 60)).toBe(1);
  });

  it('entrega en el mismo segundo que la nota: por corregir; un segundo antes, no; -1 posterior, no; escala en -1, sí', () => {
    expect(sinCorregir(90, 900)).toEqual([960]);
    expect(sinCorregir(90, 901)).toEqual([960]);
  });
});

