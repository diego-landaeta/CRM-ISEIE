import {
  describe, it, expect, vi, beforeEach, afterAll,
} from 'vitest';

/**
 * «Mi campus» de administración (Diego, 25/11: «que los admin puedan verlo también y los
 * superadmin»). Bárbara (ISEIE, admin) revisa los 314 cursos y no es profesora en ninguno:
 * con `tutores.campus_administracion` ve TODO el campus, leído con el token del campus.
 *
 *   · sus campus: los de `user_projects` (super admin, todos) con el Moodle conectado;
 *   · entregas por corregir, la más antigua primero, solo de alumnos activos, con la profesora;
 *   · consultas abiertas del CRM y mensajes de Moodle sin responder de las tutoras enlazadas;
 *   · alumnos con su % hecho, solo al abrir un curso;
 *   · solo lee: nunca envía ni califica con la cuenta del token;
 *   · `puedoCorregir` solo donde es profesora con SU cuenta enlazada;
 *   · no tumba el Moodle: dos llamadas a la vez como mucho, una lectura por campus aunque
 *     lo abran dos personas, copia compartida y reintento con «dbconnectionfailed».
 *
 * Sin base ni Moodle: `query` y `fetch` son de mentira.
 */

const CAMPUS = [{ id: 7, nombre: 'Campus A' }, { id: 8, nombre: 'Campus B' }];
const misCampus = { 41: [7], 40: [7] };
const cuentas = { 40: { moodle_user_id: 6, admin_sitio_excepcion_at: null, admin_sitio_permitida: false } };

const query = vi.fn(async (sql, params = []) => {
  if (/FROM projects p\s+JOIN project_integrations/.test(sql)) {
    const recorte = params[0];
    return { rows: CAMPUS.filter((c) => !recorte || recorte.includes(c.id)) };
  }
  if (/FROM user_projects WHERE user_id/.test(sql)) return { rows: (misCampus[params[0]] || []).map((p) => ({ project_id: p })) };
  if (/FROM tutor_campus tc JOIN users u/.test(sql)) return { rows: [{ tutor_id: 30, moodle_user_id: 5, nombre: 'Tutora Uno' }] };
  if (/SELECT moodle_user_id, admin_sitio_excepcion_at/.test(sql)) return { rows: cuentas[params[0]] ? [cuentas[params[0]]] : [] };
  if (/SELECT 1 FROM tutor_campus WHERE tutor_id/.test(sql)) return { rows: cuentas[params[0]] ? [{ '?column?': 1 }] : [] };
  if (/FROM consultas c LEFT JOIN users u/.test(sql)) {
    return {
      rows: [{
        id: 1, alumno_moodle_id: 61, alumno_nombre: 'Alumno 61', curso_moodle_id: 501, curso_nombre: 'Curso B',
        desde: new Date('2026-11-20T10:00:00Z'), conversacion_externa_id: 333, conversacion_grupo_id: null, tutor_id: 31, tutora: 'Tutora Dos',
      }],
    };
  }
  if (/FROM consulta_mensajes WHERE project_id/.test(sql)) return { rows: [] };
  return { rows: [] };
});
vi.mock('../src/shared/config/db.js', () => ({
  query,
  getClient: vi.fn(async () => ({ query, release: () => {} })),
}));
vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus.test', token: 'token-del-campus' })),
}));

const admin = await import('../src/modules/tutores/tutor.campusAdministracion.js');
const { POR_CLAVE } = await import('../src/modules/permissions/catalogo.js');

const T = (iso) => String(Math.floor(new Date(iso).getTime() / 1000));
const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
const estado = { llamadas: [], aLaVez: 0, maxALaVez: 0, retraso: 0, fallaBD: 0 };

const responder = (p) => {
  const f = p.wsfunction;
  if (f === 'core_course_get_courses_by_field') {
    return {
      courses: [
        { id: 1, format: 'site', fullname: 'Sitio' },
        { id: 500, fullname: 'Curso A', visible: 1, enablecompletion: 1 },
        { id: 501, fullname: 'Curso B', visible: 1, enablecompletion: 1 },
        { id: 502, fullname: 'Oculto', visible: 0 },
      ],
    };
  }
  if (f === 'mod_assign_get_assignments') {
    const ids = Object.entries(p).filter(([k]) => k.startsWith('courseids')).map(([, v]) => Number(v));
    return {
      courses: ids.filter((id) => id === 500 || id === 501).map((id) => ({
        id, assignments: [{ id: id === 500 ? 900 : 901, cmid: id === 500 ? 9000 : 9010, name: `Tarea ${id}`, grade: 10, teamsubmission: 0 }],
      })),
      warnings: [],
    };
  }
  if (f === 'mod_assign_get_submissions') {
    const ids = Object.entries(p).filter(([k]) => k.startsWith('assignmentids')).map(([, v]) => Number(v));
    const subs = {
      900: [{ userid: 60, status: 'submitted', gradingstatus: 'notgraded', timemodified: T('2026-11-22T10:00:00Z') }],
      901: [
        { userid: 61, status: 'submitted', gradingstatus: 'notgraded', timemodified: T('2026-11-10T10:00:00Z') },
        // Ya no está matriculado (o está suspendido): no sale.
        { userid: 99, status: 'submitted', gradingstatus: 'notgraded', timemodified: T('2026-11-01T10:00:00Z') },
      ],
    };
    return { assignments: ids.map((id) => ({ assignmentid: id, submissions: subs[id] || [] })) };
  }
  if (f === 'mod_assign_get_grades') return { assignments: [] };
  if (f === 'core_enrol_get_enrolled_users') {
    if (p.courseid === '501' && estado.fallaBD > 0) {
      estado.fallaBD -= 1;
      return { exception: 'dml_connection_exception', errorcode: 'dbconnectionfailed', message: '<p>Error: Database connection failed</p>' };
    }
    return {
      500: [
        { id: 5, fullname: 'Tutora Uno', roles: [{ shortname: 'editingteacher' }] },
        { id: 60, fullname: 'Alumno 60', roles: [{ shortname: 'student' }], lastaccess: T('2026-11-24T10:00:00Z') },
      ],
      501: [
        { id: 6, fullname: 'Admin que da clase', roles: [{ shortname: 'teacher' }] },
        { id: 61, fullname: 'Alumno 61', roles: [{ shortname: 'student' }] },
      ],
    }[p.courseid] || [];
  }
  if (f === 'core_message_get_conversations') {
    if (p.userid !== '5') return { conversations: [] };
    return {
      conversations: [
        { id: 70, members: [{ id: 60, fullname: 'Alumno 60' }], messages: [{ id: 700, useridfrom: 60, timecreated: T('2026-11-23T09:00:00Z') }] },
        // El alumno 61 ya tiene una consulta abierta en el CRM: sale como esa consulta.
        { id: 71, members: [{ id: 61, fullname: 'Alumno 61' }], messages: [{ id: 710, useridfrom: 61, timecreated: T('2026-11-21T09:00:00Z') }] },
        // Ya contestada por la tutora: no espera.
        { id: 72, members: [{ id: 62, fullname: 'Alumno 62' }], messages: [{ id: 720, useridfrom: 5, timecreated: T('2026-11-21T09:00:00Z') }] },
      ],
    };
  }
  if (f === 'core_enrol_get_users_courses') return p.userid === '60' ? [{ id: 500, enablecompletion: 1, progress: 40 }] : [{ id: 500, enablecompletion: 1, progress: 0 }];
  return { exception: 'moodle_exception', errorcode: 'accessexception', message: 'Access control exception' };
};

const moodleFalso = vi.fn(async (_url, { body }) => {
  const p = Object.fromEntries(new URLSearchParams(body));
  estado.llamadas.push(p);
  estado.aLaVez += 1;
  estado.maxALaVez = Math.max(estado.maxALaVez, estado.aLaVez);
  try {
    await new Promise((r) => { setTimeout(r, estado.retraso); });
    return json(responder(p));
  } finally {
    estado.aLaVez -= 1;
  }
});

const llamadasA = (f) => estado.llamadas.filter((p) => p.wsfunction === f);
const req = (userId, role) => ({ user: { userId, role } });
const ESCRITURAS = ['local_crm_calificar', 'core_message_send_instant_messages', 'local_crm_enviar', 'mod_assign_save_grade'];

process.env.MOODLE_REINTENTO_MS = '0';
vi.stubGlobal('fetch', moodleFalso);
afterAll(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  admin.olvidarCopias();
  estado.llamadas.length = 0;
  estado.maxALaVez = 0;
  estado.retraso = 0;
  estado.fallaBD = 0;
});

describe('el permiso', () => {
  it('está en el catálogo, lo trae el admin de serie y no el tutor', async () => {
    const a = POR_CLAVE['tutores.campus_administracion'];
    expect(a, 'tutores.campus_administracion en el catálogo').toBeTruthy();
    expect(a.roles).toContain('admin');
    expect(a.roles).not.toContain('tutor');
    expect(a.roles).not.toContain('tutor_redactor');
  });
});

describe('qué campus ve', () => {
  it('el super admin, todos los conectados; el admin, solo los suyos (user_projects)', async () => {
    expect((await admin.campusDeAdministracion(req(1, 'superadmin'))).map((c) => c.projectId)).toEqual([7, 8]);
    expect((await admin.campusDeAdministracion(req(41, 'admin'))).map((c) => c.projectId)).toEqual([7]);
  });

  it('pedir un campus que no es suyo: se le enseña el suyo, y un curso de ese campus es un 404', async () => {
    const r = await admin.campusAdministracion(req(41, 'admin'), { campus: 8 });
    expect(r.elegido).toBe(7);
    await expect(admin.cursoDeAdministracion(req(41, 'admin'), 8, 500)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('todo el campus, con el token del campus', () => {
  it('entregas por corregir, la más antigua primero, solo de alumnos activos y con su profesora', async () => {
    const r = await admin.campusAdministracion(req(41, 'admin'), { campus: 7 });
    expect(r.leyendo).toBe(false);
    expect(r.campus.entregas.map((e) => [e.cursoId, e.alumno])).toEqual([[501, 'Alumno 61'], [500, 'Alumno 60']]);
    expect(r.campus.entregas[0].profesoras).toEqual([{ id: 6, nombre: 'Admin que da clase' }]);
    expect(r.campus.entregas[0].corregirUrl).toBe('https://campus.test/mod/assign/view.php?id=9010&action=grader&userid=61');
    // Los cursos ocultos no se leen; salen en la lista.
    expect(llamadasA('mod_assign_get_assignments').some((p) => Object.values(p).includes('502'))).toBe(false);
    expect(r.campus.cursos.map((k) => k.id).sort()).toEqual([500, 501, 502]);
    expect(r.campus.cursos.find((k) => k.id === 501).porCorregir).toBe(1);
  });

  it('consultas abiertas del CRM y mensajes de Moodle sin responder, sin repetir lo que ya es consulta', async () => {
    const r = await admin.campusAdministracion(req(41, 'admin'), { campus: 7 });
    expect(r.campus.consultas).toEqual([expect.objectContaining({
      consultaId: 1, alumno: 'Alumno 61', tutora: 'Tutora Dos', moodleUrl: 'https://campus.test/message/index.php?convid=333',
    })]);
    expect(r.campus.mensajes.map((m) => [m.conversacionId, m.tutora])).toEqual([[70, 'Tutora Uno']]);
    expect(r.campus.mensajes[0].responderUrl).toBe('https://campus.test/message/index.php?convid=70');
  });

  it('solo lee: no envía ni califica nada', async () => {
    await admin.campusAdministracion(req(41, 'admin'), { campus: 7 });
    await admin.cursoDeAdministracion(req(41, 'admin'), 7, 500);
    expect(estado.llamadas.filter((p) => ESCRITURAS.includes(p.wsfunction))).toEqual([]);
    expect(estado.llamadas.every((p) => p.wstoken === 'token-del-campus')).toBe(true);
  });

  it('«puedoCorregir» solo donde es profesora con su cuenta enlazada', async () => {
    const solo = await admin.campusAdministracion(req(41, 'admin'), { campus: 7 });
    expect(solo.tengoCuentaEnlazada).toBe(false);
    expect(solo.campus.entregas.every((e) => e.puedoCorregir === false)).toBe(true);
    const da = await admin.campusAdministracion(req(40, 'admin'), { campus: 7 });
    expect(da.tengoCuentaEnlazada).toBe(true);
    expect(da.campus.entregas.map((e) => [e.cursoId, e.puedoCorregir])).toEqual([[501, true], [500, false]]);
  });
});

describe('sin tumbar el Moodle', () => {
  it('dos llamadas a la vez como mucho', async () => {
    estado.retraso = 5;
    await admin.campusAdministracion(req(1, 'superadmin'), { campus: 7 });
    await admin.cursoDeAdministracion(req(1, 'superadmin'), 7, 500);
    expect(estado.maxALaVez).toBeLessThanOrEqual(2);
  });

  it('dos personas a la vez: una sola lectura; después, la copia (también con «Actualizar» seguido)', async () => {
    estado.retraso = 5;
    await Promise.all([
      admin.campusAdministracion(req(41, 'admin'), { campus: 7 }),
      admin.campusAdministracion(req(1, 'superadmin'), { campus: 7 }),
    ]);
    expect(llamadasA('core_course_get_courses_by_field')).toHaveLength(1);
    await admin.campusAdministracion(req(41, 'admin'), { campus: 7, refrescar: true });
    expect(llamadasA('core_course_get_courses_by_field')).toHaveLength(1);
  });

  it('si tarda más de lo que espera la petición, contesta «leyendo» y la lectura sigue', async () => {
    estado.retraso = 20;
    const r = await admin.campusAdministracion(req(41, 'admin'), { campus: 7, esperaMs: 1 });
    expect(r).toMatchObject({ leyendo: true, campus: null });
    await vi.waitFor(async () => {
      const otra = await admin.campusAdministracion(req(41, 'admin'), { campus: 7, esperaMs: 1 });
      expect(otra.leyendo).toBe(false);
      expect(otra.campus.entregas).toHaveLength(2);
    }, { timeout: 3000, interval: 30 });
    expect(llamadasA('core_course_get_courses_by_field')).toHaveLength(1);
  });

  it('«Database connection failed»: se repite y el curso sale entero', async () => {
    estado.fallaBD = 1;
    const r = await admin.campusAdministracion(req(41, 'admin'), { campus: 7, esperarImpl: async () => {} });
    expect(r.campus.cursos.find((k) => k.id === 501).error).toBeNull();
    expect(r.campus.entregas.find((e) => e.cursoId === 501).alumno).toBe('Alumno 61');
  });
});

describe('un curso, al abrirlo', () => {
  it('profesoras, alumnos con su % hecho, tareas y sus consultas', async () => {
    const k = await admin.cursoDeAdministracion(req(41, 'admin'), 7, 500);
    expect(k.profesoras).toEqual([{ id: 5, nombre: 'Tutora Uno' }]);
    expect(k.alumnos).toEqual([expect.objectContaining({ id: 60, nombre: 'Alumno 60', progreso: 40 })]);
    expect(k.tareas[0].sinCorregir.map((e) => e.alumno)).toEqual(['Alumno 60']);
    expect(k.soyProfesora).toBe(false);
    expect(k.consultas).toEqual([]);
    const b = await admin.cursoDeAdministracion(req(40, 'admin'), 7, 501);
    expect(b.soyProfesora).toBe(true);
    expect(b.consultas.map((q) => q.consultaId)).toEqual([1]);
  });

  it('un curso que no es del campus: 404', async () => {
    await expect(admin.cursoDeAdministracion(req(41, 'admin'), 7, 999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('la lectura compartida no hereda la señal de quien la lanzó (QA del freno de Moodle, 27/11)', () => {
  it('si la primera pestaña se cierra, la lectura sigue para la segunda y la copia sale sin fallos', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    try {
      estado.retraso = 10;
      const { senalDeLaPeticion } = await import('../src/shared/services/moodle.limitador.js');
      const { EventEmitter } = await import('node:events');
      const peticion = (fn) => {
        const res = Object.assign(new EventEmitter(), { writableFinished: false });
        let p;
        senalDeLaPeticion({}, res, () => { p = fn(); });
        return { res, p };
      };
      const una = peticion(() => admin.campusAdministracion(req(41, 'admin'), { campus: 7, esperaMs: 5000 }));
      await new Promise((r) => { setTimeout(r, 25); });
      una.res.emit('close'); // la primera pestaña se cierra a media lectura
      const otra = peticion(() => admin.campusAdministracion(req(1, 'superadmin'), { campus: 7, esperaMs: 5000 }));
      const r = await otra.p;
      await una.p.catch(() => {});
      expect(r.leyendo).toBe(false);
      expect(r.campus.cursos.filter((k) => k.error)).toEqual([]);
      expect(r.campus.entregas).toHaveLength(2);
      expect(llamadasA('core_course_get_courses_by_field')).toHaveLength(1); // la misma lectura
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
