import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as servicio from '../src/modules/consultas/consultas.service.js';
import * as model from '../src/modules/consultas/consultas.model.js';
import { procesarAviso } from '../src/modules/consultas/consultas.avisos.js';

/**
 * El chat de GRUPO del alumno con las tutoras del curso (#679, plugin local_crm 1.9.0;
 * opción B de la #285), contra la base de verdad y con un Moodle de mentira:
 *
 *   · el mensaje del alumno en su chat de grupo abre la consulta (o entra en la suya), con
 *     el chat, el curso y quién está dentro;
 *   · la respuesta de una SEGUNDA tutora (no la de la consulta) desde Moodle cuenta como
 *     respuesta, y la de alguien del personal sin ficha en el CRM también, con su nombre;
 *   · la respuesta desde el CRM va al chat de grupo (`conversacionid`), como la tutora, y su
 *     aviso de vuelta no la duplica;
 *   · una consulta abierta del chat directo de antes sigue en el chat de grupo.
 *
 *   npx vitest run tests/consultasChatGrupo679.test.js
 */

// Cada prueba hace bastantes consultas a la base (reparto, eventos, limpieza): con la base en
// Docker de un portátil, los 15 s de serie se quedan cortos.
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const marca = `t679g${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let alumnoN = 170000;
let conversacionN = 180000;
let mensajeN = 19000000;

// ─── El Moodle de mentira ────────────────────────────────────────────────────

const campusFalsos = new Map();
/** Lo que el CRM ha pedido mandar por el plugin: { desde, para, conversacionid, texto }. */
const enviados = [];

function campusFalso(url) {
  const c = { cursos: new Map() };
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
  if (f === 'core_enrol_get_enrolled_users') {
    return json((c.cursos.get(Number(p.get('courseid'))) || []).map((g) => ({
      id: g.id, fullname: `Persona ${g.id}`, roles: [{ shortname: g.rol }], groups: [],
    })));
  }
  if (f === 'core_enrol_get_users_courses') {
    const uid = Number(p.get('userid'));
    return json([...c.cursos.entries()].filter(([, gente]) => gente.some((g) => g.id === uid)).map(([id]) => ({ id, fullname: `Curso ${id}` })));
  }
  if (f === 'local_crm_enviar_mensaje') {
    const conv = Number(p.get('conversacionid')) || null;
    enviados.push({ desde: Number(p.get('desde')), para: Number(p.get('para')), conversacionid: conv, texto: p.get('texto') });
    return json({ id: (mensajeN += 1), conversacion_id: conv || 555 });
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

/** Un campus con el plugin activo y «Leer las consultas» encendido. */
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
  const s = encrypt('secreto-del-plugin');
  await query(
    `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo) VALUES ($1, $2, $3, $4, true)`,
    [p, s.encrypted, s.iv, s.authTag]);
  return { id: p, moodle: campusFalso(url) };
}

async function tutora(projectId, moodleId) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`,
    [t, projectId, moodleId]);
  return t;
}

const noDisponible = (t) => query('UPDATE users SET consultas_disponible = false WHERE id = $1', [t]);

/**
 * El curso 7 con Laura (701) y Carmen (702), profesoras; el alumno escribe en su chat de
 * grupo con las dos. Laura lleva ya una consulta abierta: el reparto le da la nueva a Carmen
 * (a la que menos tiene), así que «la otra tutora» del chat es Laura.
 */
async function escenario(nombre) {
  const campus = await crearCampus(nombre);
  const laura = await tutora(campus.id, 701);
  const carmen = await tutora(campus.id, 702);
  campus.moodle.cursos.set(7, [{ id: 701, rol: 'editingteacher' }, { id: 702, rol: 'teacher' }]);
  alumnoN += 1;
  conversacionN += 1;
  return { campus, laura, carmen, alumno: alumnoN, conversacion: conversacionN };
}

/** Un aviso del chat de grupo, como lo manda el plugin 1.9.0. */
function avisoGrupo({ conversacion, alumno, de, texto = 'Hola', miembros = null, id = (mensajeN += 1) }) {
  const gente = miembros || [
    { id: alumno, nombre: `Alumno ${alumno}`, tutora: false, alumno: true },
    { id: 701, nombre: 'Laura Tutora', tutora: true, alumno: false },
    { id: 702, nombre: 'Carmen Coordinadora', tutora: true, alumno: false },
  ];
  const yo = gente.find((g) => g.id === de.id) || { id: de.id, nombre: de.nombre, tutora: !!de.tutora };
  return {
    evento: 'mensaje',
    sitio: 'https://campus.test',
    mensaje: { id, conversacion_id: conversacion, curso_id: 7, html: `<p>${texto}</p>`, fecha: Math.floor(Date.now() / 1000), tipo: 'grupo' },
    de: { id: de.id, nombre: yo.nombre, email: null, personal: de.personal ?? yo.tutora, tutora: yo.tutora },
    para: gente.filter((g) => g.id !== de.id).map((g) => ({ id: g.id, nombre: g.nombre, personal: g.tutora, tutora: g.tutora })),
    grupo: {
      alumno: { id: alumno, nombre: `Alumno ${alumno}`, email: `a${alumno}@test.local`, personal: false, tutora: false },
      curso: { id: 7, nombre: 'Curso de prueba CRM' },
      miembros: gente,
    },
  };
}

const estado = async (consultaId) => (await query(
  `SELECT tutor_id, estado, primera_respuesta_at, conversacion_externa_id, conversacion_grupo_id, conversaciones_extra,
          participantes, curso_moodle_id, curso_nombre FROM consultas WHERE id = $1`, [consultaId])).rows[0];

beforeAll(async () => {
  try {
    const { rows: [r] } = await query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE (table_name = 'consultas' AND column_name IN ('conversacion_grupo_id', 'participantes'))
           OR (table_name = 'consulta_mensajes' AND column_name IN ('autor_moodle_id', 'autor_nombre_campus'))`);
    if (r.n !== 4) throw new Error('Falta la migración 248.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterEach(() => { enviados.length = 0; });

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
  it('con la migración 248', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#679 · el chat de grupo del alumno con las tutoras del curso', () => {
  it('el mensaje del alumno abre UNA consulta del curso, con su chat de grupo y quién está dentro; el siguiente entra en la misma', async () => {
    if (!hayBase) return;
    const { campus, laura, carmen, alumno, conversacion } = await escenario('Abre');
    const r1 = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno }, texto: 'No me abre la tarea 2' }));
    expect(r1.resultado).toBe('consulta_nueva');
    const c = await estado(r1.consultaId);
    expect(Number(c.conversacion_grupo_id)).toBe(conversacion);
    expect(Number(c.conversacion_externa_id)).toBe(conversacion);
    expect(Number(c.curso_moodle_id)).toBe(7);
    expect(c.curso_nombre).toBe('Curso de prueba CRM');
    expect([laura, carmen]).toContain(Number(c.tutor_id));
    expect(c.participantes.map((x) => x.id).sort()).toEqual([701, 702, alumno].sort());
    expect(c.participantes.find((x) => x.alumno)).toMatchObject({ id: alumno, tutora: false });

    const r2 = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno }, texto: '¿Alguien?' }));
    expect(r2).toMatchObject({ resultado: 'mensaje', consultaId: r1.consultaId });
  });

  it('la respuesta de la SEGUNDA tutora desde Moodle (no la de la consulta) cuenta como respuesta, con su nombre', async () => {
    if (!hayBase) return;
    const { campus, laura, carmen, alumno, conversacion } = await escenario('Segunda');
    const r = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno } }));
    const asignada = Number((await estado(r.consultaId)).tutor_id);
    const otra = asignada === laura ? { tutorId: carmen, moodle: 702 } : { tutorId: laura, moodle: 701 };

    const resp = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: otra.moodle }, texto: 'Te lo miro yo' }));
    expect(resp).toMatchObject({ resultado: 'respuesta', consultaId: r.consultaId });
    const c = await estado(r.consultaId);
    expect(c.estado).toBe('respondida');
    expect(c.primera_respuesta_at).not.toBeNull();
    // La consulta sigue con su tutora (métricas, «Mi campus»): responder no la reasigna.
    expect(Number(c.tutor_id)).toBe(asignada);
    const ficha = await model.detalle(r.consultaId);
    const m = ficha.mensajes.find((x) => x.texto === 'Te lo miro yo');
    expect(m).toMatchObject({ autor: 'tutor', autor_user_id: otra.tutorId, en_el_campus: true });
    expect(ficha.participantes.length).toBe(3);
    expect(Number(ficha.conversacion_grupo_id)).toBe(conversacion);
  });

  it('alguien del personal sin ficha en el CRM que responde en el chat también cuenta, con su nombre del campus', async () => {
    if (!hayBase) return;
    const { campus, alumno, conversacion } = await escenario('SinFicha');
    const r = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno } }));
    const gente = [
      { id: alumno, nombre: `Alumno ${alumno}`, tutora: false, alumno: true },
      { id: 799, nombre: 'Rosa Profesora', tutora: true, alumno: false },
    ];
    const resp = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: 799 }, texto: 'Ya está abierta', miembros: gente }));
    expect(resp.resultado).toBe('respuesta');
    const ficha = await model.detalle(r.consultaId);
    expect(ficha.estado).toBe('respondida');
    expect(ficha.mensajes.find((x) => x.texto === 'Ya está abierta')).toMatchObject({ autor: 'tutor', autor_user_id: null, autor_nombre: 'Rosa Profesora' });
    // Quién está dentro, al último mensaje.
    expect(ficha.participantes.map((x) => x.id).sort()).toEqual([799, alumno].sort());
  });

  it('la respuesta desde el CRM va al chat de grupo (conversacionid) como la tutora, y su aviso de vuelta no la duplica', async () => {
    if (!hayBase) return;
    const { campus, laura, alumno, conversacion } = await escenario('DesdeCrm');
    const r = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno } }));
    const c = await estado(r.consultaId);
    const tutoraId = Number(c.tutor_id);
    const moodleDeLa = tutoraId === laura ? 701 : 702;

    const envio = await servicio.responder(r.consultaId, tutoraId, 'La tarea está en el tema 2.', [], { guardarArchivo: async () => {} });
    expect(envio.enviado).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ desde: moodleDeLa, para: alumno, conversacionid: conversacion });

    // Moodle avisa del mensaje que acaba de salir: es el mismo, no otro.
    const { rows: [m] } = await query(
      `SELECT externo_id FROM consulta_mensajes WHERE consulta_id = $1 AND autor = 'tutor'`, [r.consultaId]);
    const vuelta = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: moodleDeLa }, texto: 'La tarea está en el tema 2.', id: Number(m.externo_id) }));
    expect(vuelta.resultado).toBe('repetido');
    const { rows: [n] } = await query(`SELECT COUNT(*)::int AS n FROM consulta_mensajes WHERE consulta_id = $1 AND autor = 'tutor'`, [r.consultaId]);
    expect(n.n).toBe(1);
    expect((await estado(r.consultaId)).estado).toBe('respondida');
  });

  it('el relevo cambia la tutora de la consulta, no la conversación: todas siguen en el mismo chat', async () => {
    if (!hayBase) return;
    const { campus, laura, carmen, alumno, conversacion } = await escenario('Relevo');
    const r = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno } }));
    const antes = Number((await estado(r.consultaId)).tutor_id);
    await noDisponible(antes);
    // La que no está ya no sale en el chat (el plugin la ha sacado).
    const quedan = [{ id: alumno, nombre: 'Alumno', tutora: false, alumno: true },
      antes === laura ? { id: 702, nombre: 'Carmen', tutora: true, alumno: false } : { id: 701, nombre: 'Laura', tutora: true, alumno: false }];
    const r2 = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno }, texto: 'Sigo esperando', miembros: quedan }));
    expect(r2).toMatchObject({ resultado: 'mensaje', consultaId: r.consultaId });
    const c = await estado(r.consultaId);
    expect(Number(c.tutor_id)).toBe(antes === laura ? carmen : laura);
    expect(Number(c.conversacion_grupo_id)).toBe(conversacion);
    expect(c.conversaciones_extra || []).toHaveLength(0);
    expect(c.participantes).toHaveLength(2);
  });

  it('una consulta abierta del chat directo de antes (mismo alumno y curso) sigue en el chat de grupo, y la respuesta va a ese chat', async () => {
    if (!hayBase) return;
    const { campus, laura, alumno, conversacion } = await escenario('Antes');
    // 1.8.0: el alumno escribió a Laura en privado desde «Entrar al chat» del curso 7.
    const privada = conversacion + 500000;
    const viejo = await procesarAviso(campus.id, {
      evento: 'mensaje',
      mensaje: { id: (mensajeN += 1), conversacion_id: privada, curso_id: 7, html: '<p>Hola Laura</p>', fecha: Math.floor(Date.now() / 1000) },
      de: { id: alumno, nombre: `Alumno ${alumno}`, personal: false },
      para: [{ id: 701, personal: true }],
    });
    expect(viejo.resultado).toBe('consulta_nueva');
    // 1.9.0: vuelve a «Entrar al chat» y escribe en su chat de grupo.
    const nuevo = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno }, texto: 'Ahora por aquí' }));
    expect(nuevo).toMatchObject({ resultado: 'mensaje', consultaId: viejo.consultaId });
    const c = await estado(viejo.consultaId);
    expect(Number(c.conversacion_externa_id)).toBe(privada);
    expect(Number(c.conversacion_grupo_id)).toBe(conversacion);
    await servicio.responder(viejo.consultaId, Number(c.tutor_id) || laura, 'Te leo', [], { guardarArchivo: async () => {} });
    expect(enviados[0]).toMatchObject({ conversacionid: conversacion, para: alumno });
  });

  it('la conversación de un GRUPO del curso con una tutora dentro (#285): el alumno abre su consulta aparte; la tutora que contesta ahí responde a la que espera', async () => {
    if (!hayBase) return;
    const { campus, laura, alumno, conversacion } = await escenario('GrupoCurso');
    // Su chat con las tutoras (local_crm), abierto.
    const suChat = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno } }));
    // La conversación del «Grupo A» del curso: Laura dentro y varios alumnos.
    const delGrupo = conversacion + 900000;
    const avisoCurso = (de, texto, conAlumno) => ({
      evento: 'mensaje',
      mensaje: { id: (mensajeN += 1), conversacion_id: delGrupo, curso_id: 7, html: `<p>${texto}</p>`, fecha: Math.floor(Date.now() / 1000), tipo: 'grupo_curso' },
      de, para: [],
      grupo: {
        tipo: 'curso', nombre: 'Grupo A',
        alumno: conAlumno ? de : null,
        curso: { id: 7, nombre: 'Curso de prueba CRM' },
        miembros: [{ id: 701, nombre: 'Laura Tutora', tutora: true, alumno: false }, { id: de.id, nombre: de.nombre, tutora: !conAlumno, alumno: false }],
      },
    });
    const r = await procesarAviso(campus.id, avisoCurso({ id: alumno, nombre: `Alumno ${alumno}`, personal: false, tutora: false }, 'Pregunta en el grupo', true));
    expect(r.resultado).toBe('consulta_nueva');
    expect(r.consultaId).not.toBe(suChat.consultaId);
    expect(Number((await estado(r.consultaId)).conversacion_grupo_id)).toBe(delGrupo);
    // Su chat con las tutoras no se ha mudado a la conversación del grupo.
    expect(Number((await estado(suChat.consultaId)).conversacion_grupo_id)).toBe(conversacion);

    const resp = await procesarAviso(campus.id, avisoCurso({ id: 701, nombre: 'Laura Tutora', personal: true, tutora: true }, 'Os respondo a todos', false));
    expect(resp).toMatchObject({ resultado: 'respuesta', consultaId: r.consultaId });
    expect((await estado(r.consultaId)).estado).toBe('respondida');

    await servicio.responder(r.consultaId, Number((await estado(r.consultaId)).tutor_id) || laura, 'Y desde el CRM', [], { guardarArchivo: async () => {} });
    expect(enviados.at(-1)).toMatchObject({ conversacionid: delGrupo, para: alumno });
  });

  it('un aviso de grupo sin el alumno no vale', async () => {
    if (!hayBase) return;
    const { campus, alumno, conversacion } = await escenario('Roto');
    const a = avisoGrupo({ conversacion, alumno, de: { id: alumno } });
    delete a.grupo.alumno;
    await expect(procesarAviso(campus.id, a)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ─── Revisión de código (#679, 09/11): grupos del curso y privacidad ────────────────────

/** Un aviso de la conversación de un grupo del curso (tipo 'curso'), como lo manda el plugin. */
function avisoDelGrupoDelCurso({ conversacion, de, texto = 'Hola', tutorasDentro = [701] }) {
  const tutoras = tutorasDentro.map((id) => ({ id, nombre: `Tutora ${id}`, tutora: true, alumno: false }));
  const yo = tutorasDentro.includes(de.id) ? [] : [{ id: de.id, nombre: de.nombre || `Persona ${de.id}`, tutora: Boolean(de.tutora), alumno: !de.tutora }];
  return {
    evento: 'mensaje',
    mensaje: { id: (mensajeN += 1), conversacion_id: conversacion, curso_id: 7, html: `<p>${texto}</p>`, fecha: Math.floor(Date.now() / 1000), tipo: 'grupo_curso' },
    de: { id: de.id, nombre: de.nombre || `Persona ${de.id}`, email: null, personal: Boolean(de.personal), tutora: Boolean(de.tutora) },
    para: [],
    grupo: {
      tipo: 'curso', nombre: 'Grupo A',
      alumno: de.tutora ? null : { id: de.id, nombre: de.nombre || `Persona ${de.id}`, personal: Boolean(de.personal), tutora: false },
      curso: { id: 7, nombre: 'Curso de prueba CRM' },
      miembros: [...tutoras, ...yo],
    },
  };
}

describe('#679 · revisión: grupos del curso sin fugas ni mezclas', () => {
  it('privacidad: una consulta nacida en un grupo del curso (G2) no recoge el chat del plugin (G): la respuesta va a G, nunca a G2', async () => {
    if (!hayBase) return;
    const { campus, alumno, conversacion } = await escenario('Fuga');
    const g2 = conversacion + 700000;
    const enG2 = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g2, de: { id: alumno } }));
    expect(enG2.resultado).toBe('consulta_nueva');
    // Ahora escribe en su chat con las tutoras (G), del mismo curso.
    const enG = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno }, texto: 'Esto es solo mío' }));
    expect(enG.resultado).toBe('consulta_nueva');
    expect(enG.consultaId).not.toBe(enG2.consultaId);
    const c = await estado(enG.consultaId);
    await servicio.responder(enG.consultaId, Number(c.tutor_id), 'Respuesta privada', [], { guardarArchivo: async () => {} });
    expect(enviados.at(-1).conversacionid).toBe(conversacion);
    expect(enviados.some((e) => e.conversacionid === g2)).toBe(false);
    expect(Number((await estado(enG2.consultaId)).conversacion_grupo_id)).toBe(g2);
  });

  it('en un grupo del curso, alguien del «personal» que NO es profesora de ese curso no responde: su mensaje es el de un alumno', async () => {
    if (!hayBase) return;
    const { campus, alumno, conversacion } = await escenario('Personal');
    const g = conversacion + 710000;
    await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: alumno } }));
    const otro = alumno + 5000;
    const r = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: otro, personal: true, tutora: false }, texto: 'Soy gestor de otro curso' }));
    expect(r.resultado).toBe('consulta_nueva');
    const { rows } = await query(`SELECT estado FROM consultas WHERE project_id = $1 AND alumno_moodle_id = $2`, [campus.id, alumno]);
    expect(rows[0].estado).toBe('abierta');
  });

  it('el aviso guarda de qué chat es: «plugin» o «curso», y en el grupo del curso las tutoras de dentro', async () => {
    if (!hayBase) return;
    const { campus, alumno, conversacion } = await escenario('Tipo');
    const p = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: alumno } }));
    const g = conversacion + 720000;
    const k = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: alumno + 1 } }));
    expect((await model.detalle(p.consultaId)).grupo_tipo).toBe('plugin');
    const ficha = await model.detalle(k.consultaId);
    expect(ficha.grupo_tipo).toBe('curso');
    expect(ficha.participantes.filter((x) => x.tutora).map((x) => x.id)).toEqual([701]);
    expect(ficha.participantes.find((x) => x.id === alumno + 1)).toMatchObject({ alumno: true, tutora: false });
  });

  it('en el chat de grupo del PLUGIN, la consulta va a una tutora que está dentro, no a otra del campus que no lo está', async () => {
    if (!hayBase) return;
    // Lo que pasó en un Moodle 5.2 de verdad (10/11): Sofía, tutora del campus pero de otro
    // curso y sin consultas, se llevaba la consulta del chat de grupo de Laura y Carmen; su
    // respuesta la rechazaba el plugin («solo responde una profesora de ese curso»).
    const { campus, laura, carmen, alumno, conversacion } = await escenario('PluginDentro');
    const sofia = await tutora(campus.id, 799);
    // Laura y Carmen llevan ya consultas abiertas: sin el filtro, la menos cargada es Sofía.
    for (const t of [laura, carmen]) {
      await query(`INSERT INTO consultas (project_id, tutor_id, alumno_moodle_id, estado) VALUES ($1, $2, $3, 'abierta')`,
        [campus.id, t, 900000 + t]);
    }
    const r = await procesarAviso(campus.id, avisoGrupo({ conversacion: conversacion + 740000, alumno, de: { id: alumno } }));
    const t = Number((await estado(r.consultaId)).tutor_id);
    expect(t).not.toBe(sofia);
    expect([laura, carmen]).toContain(t);
  });

  it('en un grupo del curso, la consulta va a una tutora que está DENTRO (aunque otra del curso esté más libre)', async () => {
    if (!hayBase) return;
    const { campus, carmen, alumno, conversacion } = await escenario('Dentro');
    // Solo Carmen (702) está en la conversación del grupo; sin el filtro, el empate de carga se
    // lo daría a Laura (id más bajo), que no podría responder desde el CRM.
    const r = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: conversacion + 730000, de: { id: alumno }, tutorasDentro: [702] }));
    expect(Number((await estado(r.consultaId)).tutor_id)).toBe(carmen);
  });

  it('en un grupo del curso con VARIAS consultas esperando, lo de la tutora es contexto, no respuesta; y una cerrada no se reabre por una charla', async () => {
    if (!hayBase) return;
    const { campus, alumno, conversacion } = await escenario('Varias');
    const g = conversacion + 740000;
    const a = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: alumno } }));
    const b = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: alumno + 1 } }));
    const t = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: 701, tutora: true, personal: true }, texto: 'Hola a todos' }));
    expect(t.resultado).toBe('contexto');
    expect((await estado(a.consultaId)).estado).toBe('abierta');
    expect((await estado(b.consultaId)).estado).toBe('abierta');
    // Cerrada la de A, lo que escribe A en el grupo queda dentro y no la reabre.
    await model.cerrar(a.consultaId, null);
    const otra = await procesarAviso(campus.id, avisoDelGrupoDelCurso({ conversacion: g, de: { id: alumno }, texto: 'jaja gracias' }));
    expect(otra).toMatchObject({ resultado: 'contexto', consultaId: a.consultaId });
    expect((await estado(a.consultaId)).estado).toBe('cerrada');
  });

  it('la respuesta de una tutora en un chat de grupo sin consulta propia no cae en la consulta de OTRO curso', async () => {
    if (!hayBase) return;
    const { campus, laura, alumno, conversacion } = await escenario('OtroCurso');
    campus.moodle.cursos.set(8, [{ id: 701, rol: 'editingteacher' }]);
    // Consulta abierta del alumno con Laura en el curso 8 (conversación privada).
    const deOtro = await servicio.entraMensajeDelAlumno({
      projectId: campus.id, conversacionId: conversacion + 750000, alumno: { moodleId: alumno, nombre: 'A' },
      curso: { moodleId: 8, nombre: null }, texto: 'Duda del curso 8', externoId: (mensajeN += 1), escritoAt: new Date(),
    }, { tutorPreferido: laura, avisar: false });
    expect(Number(deOtro.consulta.tutor_id)).toBe(laura);
    // Laura escribe en el chat de grupo del curso 7 de ese alumno, que aún no tiene consulta.
    const r = await procesarAviso(campus.id, avisoGrupo({ conversacion, alumno, de: { id: 701 }, texto: 'Hola, te escribo yo' }));
    expect(r).toMatchObject({ resultado: 'ignorado' });
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM consulta_mensajes WHERE consulta_id = $1', [deOtro.consulta.id]);
    expect(rows[0].n).toBe(1);
  });
});
