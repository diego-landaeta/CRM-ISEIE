import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * «Mi campus» de una tutora redactora en Psiko e ISAEG (Diego, 24/11/2026):
 *
 *  1. «Le da error en ISAEG y en Psiko»: el servidor de esos campus tiene pocas conexiones a
 *     su base y, con 4 llamadas a la vez, Moodle contestaba «Database connection failed» (en
 *     HTML) en 14 a 40 de sus 96 cursos. Esos cursos salían con el error y SIN sus entregas
 *     por corregir. Ahora: de 2 en 2, la llamada se repite (no ha hecho nada en Moodle) y, si
 *     sigue, el mensaje se entiende y no lleva HTML.
 *  2. «Tienen que tener TODAS las pendientes, no solamente desde que se subió el campus»: las
 *     entregas sin corregir de cualquier fecha (nunca tuvieron corte) y los mensajes privados
 *     de Moodle cuyo último mensaje es del alumno, aunque sean de antes de «Leer las
 *     consultas». Solo se leen: no se crea ninguna consulta ni se escribe a nadie, y lo que ya
 *     está en el CRM no se repite.
 *  3. La cuenta vinculada que no es la de su correo (OTRA_CUENTA) se dice en el campus.
 *
 * Sin base ni Moodle: `query` de mentira y un `fetch` que hace de Moodle.
 *
 *   cd backend && npx vitest run tests/miCampusPendientesAntiguas.test.js
 */

const TUTORA_MOODLE = 701;
const estado = vi.hoisted(() => ({ avisoCampus: null, enElCrm: new Set(), dudas: [] }));
const query = vi.fn(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('FROM tutor_campus tc') && s.includes('tc.moodle_user_id IS NOT NULL')) {
    return { rows: [{ project_id: 6, moodle_user_id: TUTORA_MOODLE, campus: 'ISAEG', error: estado.avisoCampus }] };
  }
  if (s.includes('FROM tutor_campus tc')) return { rows: [] };
  if (s.includes('FROM cursos_pendientes')) return { rows: [] };
  if (s.includes('FROM consulta_mensajes')) {
    return { rows: params[1].filter((id) => estado.enElCrm.has(Number(id))).map((id) => ({ externo_id: String(id) })) };
  }
  if (s.includes('FROM consultas')) {
    return { rows: estado.dudas.map((d) => ({ id: d.id, project_id: 6, alumno_moodle_id: d.alumno, alumno_nombre: 'Alumno', desde: new Date('2026-11-20T10:00:00Z') })) };
  }
  throw new Error(`SQL sin preparar en el test: ${s.slice(0, 80)}`);
});
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));
vi.mock('../src/modules/tutores/tutor.campus.js', () => ({
  conexionDelCampus: vi.fn(async () => ({ url: 'https://isaeg.test/campus', token: 'token-del-campus' })),
}));

const { llamar, conversacionesSinResponder } = await import('../src/shared/services/moodle.client.js');
const { miCampus, leerSusCampus } = await import('../src/modules/tutores/tutor.micampus.js');

const s = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const BD_LLENA = {
  exception: 'dml_connection_exception', errorcode: 'dbconnectionfailed',
  message: '<p>Error: Database connection failed</p>\n<p>It is possible that the database is overloaded or otherwise not running properly.</p>',
};
const respuesta = (cuerpo) => ({ ok: true, status: 200, json: async () => cuerpo });

// ─── El Moodle de mentira ─────────────────────────────────────────────────────
const yo = { id: TUTORA_MOODLE, fullname: 'Tutora', roles: [{ shortname: 'editingteacher' }] };
const alumno = (id) => ({ id, fullname: `Alumno ${id}`, roles: [{ shortname: 'student' }] });
const MATRICULADOS = { 30: [yo, alumno(900), alumno(901), alumno(904)], 31: [yo, alumno(902)] };
const conv = (id, otro, de, fecha, mensajeId) => ({
  id, members: [{ id: otro, fullname: `Persona ${otro}` }],
  messages: [{ id: mensajeId, useridfrom: de, text: 'hola', timecreated: s(fecha) }],
});
const CONVERSACIONES = [
  conv(1001, 900, 900, '2025-06-25T22:18:08Z', 5001), // espera desde 2025: sale en el curso 30
  conv(1002, 901, TUTORA_MOODLE, '2026-05-12T08:00:00Z', 5002), // ya contestada por ella
  conv(1003, 902, 902, '2026-11-24T16:00:00Z', 5003), // ese mensaje ya está en una consulta del CRM
  conv(1004, 999, 999, '2026-03-01T09:00:00Z', 5004), // de alguien que no está en sus cursos
  conv(1005, 904, 904, '2026-02-01T09:00:00Z', 5005), // el alumno tiene una duda abierta: sale como duda
];
let fallosBD;
let enVuelo;
let maxEnVuelo;
const llamadas = [];
vi.stubGlobal('fetch', vi.fn(async (_url, { body } = {}) => {
  const p = Object.fromEntries(new URLSearchParams(body));
  const f = p.wsfunction;
  llamadas.push(f);
  enVuelo += 1; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
  await new Promise((r) => { setTimeout(r, 2); });
  enVuelo -= 1;
  const ids = (prefijo) => Object.entries(p).filter(([k]) => k.startsWith(prefijo)).map(([, v]) => Number(v));
  if (f === 'core_enrol_get_users_courses') return respuesta([{ id: 30, fullname: 'Curso A' }, { id: 31, fullname: 'Curso B' }]);
  if (f === 'core_enrol_get_enrolled_users') {
    const curso = Number(p.courseid);
    if (fallosBD[curso] > 0) { fallosBD[curso] -= 1; return respuesta(BD_LLENA); }
    return respuesta(MATRICULADOS[curso] || []);
  }
  if (f === 'mod_assign_get_assignments') {
    const TAREAS = { 30: [{ id: 77, cmid: 7, name: 'Tarea A', grade: 10 }], 31: [{ id: 88, cmid: 8, name: 'Tarea B', grade: 10 }] };
    return respuesta({ courses: ids('courseids').map((id) => ({ id, assignments: TAREAS[id] || [] })) });
  }
  if (f === 'mod_assign_get_submissions') {
    // Una entrega de abril de 2025, mucho antes de conectar el campus: tiene que salir.
    const ENTREGAS = { 88: [{ userid: 902, status: 'submitted', gradingstatus: 'notgraded', timemodified: s('2025-04-15T09:27:56Z') }] };
    return respuesta({ assignments: ids('assignmentids').map((id) => ({ assignmentid: id, submissions: ENTREGAS[id] || [] })) });
  }
  if (f === 'mod_assign_get_grades') return respuesta({ assignments: [] });
  if (f === 'core_message_get_conversations') {
    return respuesta({ conversations: Number(p.limitfrom) === 0 ? CONVERSACIONES : [] });
  }
  return respuesta({});
}));

let tutora = 9000;
beforeEach(() => {
  tutora += 1; // la copia es por tutora: cada prueba, una sin copia
  fallosBD = {};
  enVuelo = 0; maxEnVuelo = 0;
  llamadas.length = 0;
  estado.avisoCampus = null;
  estado.enElCrm = new Set([5003]);
  estado.dudas = [{ id: 40, alumno: 904 }];
  vi.stubEnv('MOODLE_REINTENTO_MS', '0');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('la base del campus llena («Database connection failed»)', () => {
  const conexion = { url: 'https://isaeg.test/campus', token: 't' };
  const sinEsperar = { esperarImpl: async () => {} };

  it('la llamada se repite y sale bien: Moodle no llegó a hacer nada', async () => {
    let n = 0;
    const fetchImpl = async () => { n += 1; return respuesta(n < 3 ? BD_LLENA : { sitename: 'ISAEG' }); };
    await expect(llamar(conexion, 'core_webservice_get_site_info', {}, { fetchImpl, ...sinEsperar })).resolves.toEqual({ sitename: 'ISAEG' });
    expect(n).toBe(3);
  });

  it('si sigue llena, un mensaje que se entiende, sin el HTML de Moodle', async () => {
    let n = 0;
    const fetchImpl = async () => { n += 1; return respuesta(BD_LLENA); };
    const err = await llamar(conexion, 'core_enrol_get_enrolled_users', {}, { fetchImpl, ...sinEsperar }).catch((e) => e);
    expect(err.codigo).toBe('BD_CAMPUS');
    expect(err.errorcode).toBe('dbconnectionfailed');
    expect(err.message).toMatch(/base de datos del campus/);
    expect(err.message).not.toMatch(/<p>/);
    expect(n).toBe(4); // la primera y 3 repeticiones (MOODLE_REINTENTOS_BD)
  });

  it('otros errores no se repiten', async () => {
    let n = 0;
    const fetchImpl = async () => { n += 1; return respuesta({ exception: 'x', errorcode: 'invalidtoken', message: 'Invalid token' }); };
    await expect(llamar(conexion, 'core_webservice_get_site_info', {}, { fetchImpl, ...sinEsperar })).rejects.toMatchObject({ codigo: 'TOKEN' });
    expect(n).toBe(1);
  });

  it('un error de Moodle en HTML se enseña como texto', async () => {
    const fetchImpl = async () => respuesta({ exception: 'x', errorcode: 'algo', message: '<p>Error: <b>algo</b> raro</p>' });
    await expect(llamar(conexion, 'f', {}, { fetchImpl })).rejects.toThrow('El campus ha dicho: Error: algo raro.');
  });

  it('Mi campus: el curso que falló a la primera sale entero, con su entrega de 2025', async () => {
    fallosBD = { 31: 2 };
    const d = await miCampus(tutora);
    const curso31 = d.campus[0].cursos.find((k) => k.id === 31);
    expect(curso31.error).toBeNull();
    expect(curso31.tareas[0].sinCorregir.map((e) => [e.alumnoId, e.entregadaAt.toISOString()]))
      .toEqual([[902, '2025-04-15T09:27:56.000Z']]);
    // Nunca más de 2 llamadas a la vez al campus (MI_CAMPUS_PARALELO).
    expect(maxEnVuelo).toBeLessThanOrEqual(2);
  });

  it('si no se recupera, el curso lo dice sin HTML y la copia dura poco', async () => {
    fallosBD = { 31: 99 };
    const d = await miCampus(tutora);
    expect(d.campus[0].cursos.find((k) => k.id === 31).error).toMatch(/base de datos del campus/);
    const antes = llamadas.length;
    fallosBD = {};
    // Dentro de los 2 minutos, pero la copia con fallos no vale tanto: se adelanta el reloj.
    const ahora = Date.now();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora + 20 * 1000);
    try {
      const otra = await miCampus(tutora);
      expect(llamadas.length).toBeGreaterThan(antes);
      expect(otra.campus[0].cursos.find((k) => k.id === 31).error).toBeNull();
    } finally {
      reloj.mockRestore();
    }
  });
});

describe('todas las pendientes: los mensajes de Moodle sin responder, de cualquier fecha', () => {
  it('conversacionesSinResponder: solo las que acaban en un mensaje del otro, página a página', async () => {
    const paginas = [];
    const muchas = Array.from({ length: 50 }, (_, i) => conv(2000 + i, 3000 + i, i % 2 ? 3000 + i : TUTORA_MOODLE, '2026-01-01T00:00:00Z', 6000 + i));
    const fetchImpl = async (_u, { body }) => {
      const p = Object.fromEntries(new URLSearchParams(body));
      paginas.push(Number(p.limitfrom));
      return respuesta({ conversations: Number(p.limitfrom) === 0 ? muchas : [conv(2999, 4000, 4000, '2024-09-01T00:00:00Z', 6999)] });
    };
    const lista = await conversacionesSinResponder({ url: 'https://x.test', token: 't' }, TUTORA_MOODLE, { fetchImpl });
    expect(paginas).toEqual([0, 50]);
    expect(lista).toHaveLength(26); // 25 de la primera página + la de 2024
    expect(lista.at(-1)).toMatchObject({ conversacionId: 2999, alumnoId: 4000, mensajeId: 6999 });
    expect(lista.at(-1).desde.toISOString()).toBe('2024-09-01T00:00:00.000Z');
  });

  it('salen en su curso; lo contestado, lo que ya está en el CRM y lo que es una duda abierta, no', async () => {
    const d = await miCampus(tutora);
    const c = d.campus[0];
    const curso30 = c.cursos.find((k) => k.id === 30);
    expect(curso30.sinResponder).toEqual([{
      conversacionId: 1001, alumnoId: 900, alumno: 'Alumno 900', desde: new Date('2025-06-25T22:18:08Z'),
      responderUrl: 'https://isaeg.test/campus/message/index.php?convid=1001',
    }]);
    // 1002 contestada por ella, 1003 ya en una consulta, 1005 sale como su duda (#40).
    expect(c.cursos.flatMap((k) => k.sinResponder.map((m) => m.conversacionId))).toEqual([1001]);
    expect(curso30.dudas.map((x) => x.consultaId)).toEqual([40]);
    // La de alguien que no está en sus cursos, aparte.
    expect(c.sinResponderSinCurso.map((m) => [m.conversacionId, m.alumno])).toEqual([[1004, 'Persona 999']]);
  });

  it('solo lee: a Moodle no se le pide nada que escriba, y en la base solo SELECT', async () => {
    await miCampus(tutora);
    expect(llamadas.filter((f) => /send|enviar|calificar|create|update|delete/i.test(f))).toEqual([]);
    expect(query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0].toUpperCase()).filter((v) => v !== 'SELECT')).toEqual([]);
  });

  it('si una de ellas entra como consulta, deja de salir como mensaje aunque se lea de la copia', async () => {
    await miCampus(tutora);
    estado.dudas.push({ id: 41, alumno: 900 });
    const d = await miCampus(tutora);
    expect(d.campus[0].cursos.flatMap((k) => k.sinResponder)).toEqual([]);
  });

  it('el aviso de entregas sin corregir no lee los mensajes (conMensajes: false)', async () => {
    await leerSusCampus(tutora, { conProgreso: false, conMensajes: false });
    expect(llamadas).not.toContain('core_message_get_conversations');
  });
});

describe('la cuenta vinculada no es la de su correo', () => {
  it('el campus lo dice (antes salía vacío sin explicación)', async () => {
    estado.avisoCampus = 'El correo apunta a otra cuenta del campus distinta de la vinculada. Si es correcto, pulsa «Vincular de nuevo».';
    const d = await miCampus(tutora);
    expect(d.campus[0].aviso).toMatch(/otra cuenta del campus/);
  });
});
