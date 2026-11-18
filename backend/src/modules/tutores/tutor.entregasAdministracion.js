/*
  ENTREGAS SIN CORREGIR · SEGUNDO ESCALÓN: ADMINISTRACIÓN (#769, Manuel 13/11:
  «primero, recordatorio automático al tutor; si sigue sin resolverse, aviso a
  administración»).

  El primer escalón es el de la #681 (tutor.entregasSinCorregir.js): a la tutora, a las
  48 h de la entrega. Esto es lo de después, y va en la misma vuelta del job, detrás:

    · PLAZO: una entrega que ve una tutora y sigue sin nota a los ENTREGAS_AVISO_ADMIN_DIAS
      días naturales desde que se entregó (5 de serie). Si la tarea tiene «Recordarme
      calificar antes de» y esa fecha llega antes, se avisa en esa fecha. Nunca antes que
      a la tutora (48 h).
    · SIN TUTORA: una entrega que no ve NINGUNA tutora del CRM (el curso no tiene profesora
      vinculada en el CRM, o la que tiene no ve a ese alumno por los grupos). No hay a
      quién recordárselo: va directa a administración a las 48 h. Para saber qué cursos
      tiene el campus se usa `core_course_get_courses_by_field`: el servicio del token
      del campus (Integraciones › Moodle) tiene que tenerla; si no, ese campus se salta
      y se dice en el resultado.

  A quién: los super admin y los admin de ese campus (`administracionDelCampus`, como las
  consultas fuera de plazo). Una campana por campus y vuelta con todas las nuevas. Correo,
  solo con CONSULTAS_AVISO_ADMIN_CORREO=1 (el mismo interruptor de la #769 para consultas,
  apagado de serie), uno por persona y campus, y cada persona lo apaga en «Mis
  preferencias» («Entregas sin corregir fuera de plazo»).

  UNA vez por entrega: la tabla `entregas_avisos_administracion` (migración 305; la 292
  en el CRM 360) la recuerda por (campus, tarea, alumno, fecha de entrega). Si el alumno
  vuelve a entregar, es otra entrega.

  El freno de correos a tutores (NO_ESCRIBIR_A_TUTORES) no aplica aquí: no se escribe a
  ninguna tutora. Va detrás del mismo interruptor que el resto (PLUGIN_MOODLE_EN_PRODUCCION).

  GEMELA (CRM-ISEIE#457, porte de la PR CRM#834): igual que en el 360 salvo la
  migración (305) y que aquí no hay plugin del CRM en Moodle: lo que en el 360 da el
  plugin (la lista de cursos, las tareas, entregas y notas) lo tiene que dar el servicio
  del token del campus. `entregas_fuera_de_plazo` va en notifications/tipos.js y en la
  lista de avisos de users.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import {
  correo, parrafo, boton, nota, enlace, esc, seccion,
} from '../../shared/services/email-plantilla.service.js';
import { pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import {
  cursosDelCampus, matriculadosDe, esAlumno, urlDelCampus, MoodleError,
} from '../../shared/services/moodle.client.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { administracionDelCampus, correoAAdministracion } from '../consultas/consultas.plazos.js';
import { conexionDelCampus } from './tutor.campus.js';
import { tareasPorTandas } from './tutor.micampus.js';
import { avisarEntregasSinCorregir, HORAS_SIN_CORREGIR, claveDe } from './tutor.entregasSinCorregir.js';

/** El aviso, en la campana y en «Mis preferencias» (avisos_apagados). */
export const AVISO_ENTREGAS_FUERA_DE_PLAZO = 'entregas_fuera_de_plazo';

/** Días naturales desde la entrega hasta avisar a administración, de serie. */
export const DIAS_AVISO_ADMIN = 5;

/** Líneas como mucho en un correo: con más, «y N más» (están todas en Moodle). */
const MAX_LINEAS = 40;

const HORA = 3600 * 1000;
const DIA = 24 * HORA;

/** ENTREGAS_AVISO_ADMIN_DIAS si es un número positivo; si no, 5. */
export function diasAvisoAdmin(env = process.env) {
  const n = Number(env.ENTREGAS_AVISO_ADMIN_DIAS);
  return Number.isFinite(n) && n > 0 ? n : DIAS_AVISO_ADMIN;
}

/**
 * Cuándo toca avisar a administración de una entrega que ve una tutora: a los X días de
 * entregarla o en su «Recordarme calificar antes de», lo que llegue antes; nunca antes
 * del recordatorio a la tutora.
 */
export function limiteAdministracion(e, env = process.env) {
  const entregada = new Date(e.entregadaAt).getTime();
  let limite = entregada + diasAvisoAdmin(env) * DIA;
  const antes = e.calificarAntes ? new Date(e.calificarAntes).getTime() : null;
  if (antes && antes < limite) limite = antes;
  return new Date(Math.max(limite, entregada + HORAS_SIN_CORREGIR * HORA));
}

/** Sin tutora no hay recordatorio que esperar: a administración en cuanto pasan las 48 h. */
export const limiteSinTutora = (e) => new Date(new Date(e.entregadaAt).getTime() + HORAS_SIN_CORREGIR * HORA);

const fecha = (d) => new Intl.DateTimeFormat('es-ES', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
}).format(d);
const dias = (desde, ahora) => Math.floor((ahora - desde) / DIA);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const mensaje = (err, porDefecto) => (err instanceof MoodleError ? err.message : porDefecto);

/** Las que ven las tutoras, una por entrega (con todas las tutoras que la ven), ya en su plazo. */
export function deTutorasFueraDePlazo(entregas, ahora, env = process.env) {
  const porClave = new Map();
  for (const e of entregas) {
    const k = claveDe(e);
    const ya = porClave.get(k);
    if (ya) {
      if (e.tutora && !ya.tutoras.includes(e.tutora)) ya.tutoras.push(e.tutora);
    } else {
      porClave.set(k, { ...e, tutoras: e.tutora ? [e.tutora] : [] });
    }
  }
  return [...porClave.values()]
    .map((e) => ({ ...e, motivo: 'plazo', limite: limiteAdministracion(e, env) }))
    .filter((e) => e.limite.getTime() <= ahora.getTime());
}

/** Los campus con el Moodle conectado en Integraciones. `projectIds`: solo esos. */
async function campusConectados(projectIds) {
  const { rows } = await query(
    `SELECT p.id, p.nombre
       FROM projects p
       JOIN project_integrations pi ON pi.project_id = p.id AND pi.provider = 'moodle'
        AND pi.active AND pi.encrypted_value IS NOT NULL
      WHERE p.active AND ($1::int[] IS NULL OR p.id = ANY($1::int[]))
      ORDER BY p.id`, [projectIds]);
  return rows.map((r) => ({ projectId: Number(r.id), campus: r.nombre }));
}

/**
 * Las entregas de un campus de más de 48 h sin corregir que no ve ninguna tutora del CRM.
 * `vistas`: claves de las que sí ve alguna. Se salta lo que no se ha podido leer en la
 * vuelta de las tutoras (`fallos`): mejor avisar en la siguiente que avisar de más.
 */
async function sinTutoraEnElCampus(c, { ahora, vistas, fallos, opciones }) {
  if (fallos.has('*') || fallos.has(String(c.projectId))) {
    return { entregas: [], omitido: 'no se han podido leer los cursos de alguna tutora del campus' };
  }
  const conexion = await conexionDelCampus(c.projectId);
  if (!conexion) return { entregas: [], omitido: 'el campus no está conectado' };
  if (conexion.error) return { entregas: [], omitido: conexion.error };
  const url = urlDelCampus(conexion.url);

  let cursos;
  try {
    // Los ocultos no se están dando: no se miran.
    cursos = (await cursosDelCampus(conexion, opciones)).filter((k) => k.visible);
  } catch (err) {
    // El token del campus no tiene la función (o el campus no contesta): se salta.
    return { entregas: [], omitido: mensaje(err, 'no se ha podido leer la lista de cursos del campus') };
  }
  const nombreDe = new Map(cursos.map((k) => [k.id, k.nombre]));
  const { tareas, entregas, errorDe } = await tareasPorTandas(conexion, cursos.map((k) => k.id), opciones);

  // Candidatas: individuales, de más de 48 h, que no ve ninguna tutora.
  const candidatas = new Map(); // cursoId → [entrega]
  for (const [cursoId, lista] of tareas) {
    if (errorDe.has(cursoId) || fallos.has(`${c.projectId}-${cursoId}`)) continue;
    for (const t of lista) {
      if (t.enGrupo) continue;
      for (const e of entregas.get(t.id) || []) {
        if (!e.entregadaAt) continue;
        const entrega = {
          projectId: c.projectId, campus: c.campus, cursoId, curso: nombreDe.get(cursoId) || null,
          tareaId: t.id, tarea: t.nombre, alumnoId: e.alumnoId, alumno: null,
          entregadaAt: new Date(e.entregadaAt), calificarAntes: t.calificarAntes || null,
          corregirUrl: `${url}/mod/assign/view.php?id=${t.cmid}&action=grader&userid=${e.alumnoId}`,
          motivo: 'sin_tutora', tutoras: [],
        };
        entrega.limite = limiteSinTutora(entrega);
        if (entrega.limite.getTime() > ahora.getTime() || vistas.has(claveDe(entrega))) continue;
        if (!candidatas.has(cursoId)) candidatas.set(cursoId, []);
        candidatas.get(cursoId).push(entrega);
      }
    }
  }

  // Solo alumnos con la matrícula activa (como «Mi campus»), y con su nombre.
  const salida = [];
  for (const [cursoId, lista] of candidatas) {
    try {
      const alumnos = new Map((await matriculadosDe(conexion, cursoId, opciones))
        .filter(esAlumno).map((a) => [a.id, a.nombre]));
      for (const e of lista) if (alumnos.has(e.alumnoId)) salida.push({ ...e, alumno: alumnos.get(e.alumnoId) });
    } catch (err) {
      logger.warn({ projectId: c.projectId, cursoId, err: err.message }, 'tutores: no se han podido leer los alumnos de un curso sin tutora');
    }
  }
  return { entregas: salida, omitido: null };
}

/** Apunta las que no se habían avisado y devuelve SOLO esas, con el id de su fila. */
async function apuntarNuevas(entregas) {
  if (!entregas.length) return [];
  const { rows } = await query(
    `INSERT INTO entregas_avisos_administracion
       (project_id, curso_id, tarea_id, alumno_moodle_id, entregada_at, motivo, limite_at)
     SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::timestamptz[], $6::text[], $7::timestamptz[])
     ON CONFLICT (project_id, tarea_id, alumno_moodle_id, entregada_at) DO NOTHING
     RETURNING id, project_id, tarea_id, alumno_moodle_id, entregada_at`,
    [entregas.map((e) => e.projectId), entregas.map((e) => e.cursoId), entregas.map((e) => e.tareaId),
      entregas.map((e) => e.alumnoId), entregas.map((e) => e.entregadaAt), entregas.map((e) => e.motivo),
      entregas.map((e) => e.limite)]);
  const porClave = new Map(entregas.map((e) => [claveDe(e), e]));
  return rows.map((r) => {
    const e = porClave.get(claveDe({
      projectId: Number(r.project_id), tareaId: Number(r.tarea_id), alumnoId: Number(r.alumno_moodle_id), entregadaAt: r.entregada_at,
    }));
    return e ? { ...e, avisoId: Number(r.id) } : null;
  }).filter(Boolean);
}

/** El correo a una persona de administración: las de tutoras y las de cursos sin tutora, por curso. */
export function cuerpoParaAdministracion({ persona, campus, proyecto, entregas, ahora = new Date(), env = process.env }) {
  const linea = (e) => `<strong>${esc(e.alumno || 'Un alumno')}</strong> · ${esc(e.tarea || 'Tarea')}<br>`
    + `Entregada el ${esc(fecha(e.entregadaAt))} (hace ${plural(dias(e.entregadaAt, ahora), 'día', 'días')})`
    + `${e.tutoras?.length ? ` · Tutora: ${esc(e.tutoras.join(', '))}` : ''} · <a href="${esc(e.corregirUrl)}">Abrir en Moodle</a>`;
  const porCurso = (lista) => {
    const grupos = new Map();
    for (const e of [...lista].sort((a, b) => a.entregadaAt - b.entregadaAt)) {
      const k = e.curso || `Curso ${e.cursoId}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(e);
    }
    return grupos;
  };
  const deTutoras = entregas.filter((e) => e.motivo === 'plazo');
  const sinTutora = entregas.filter((e) => e.motivo === 'sin_tutora');
  const bloques = [
    parrafo(`En ${esc(campus)} hay <strong>${plural(entregas.length, 'entrega', 'entregas')}</strong> de alumnos que ${entregas.length === 1 ? 'sigue' : 'siguen'} sin corregir.`),
  ];
  let quedan = MAX_LINEAS;
  const pintar = (titulo, explicacion, lista) => {
    if (!lista.length) return;
    bloques.push(seccion(titulo), parrafo(explicacion));
    for (const [curso, suyas] of porCurso(lista)) {
      if (quedan <= 0) break;
      const cabe = suyas.slice(0, quedan);
      quedan -= cabe.length;
      bloques.push(parrafo(`<strong>${esc(curso)}</strong><br><br>${cabe.map(linea).join('<br><br>')}`));
    }
  };
  pintar('Fuera de plazo',
    `La tutora ya tuvo el recordatorio a las ${HORAS_SIN_CORREGIR} h y siguen sin nota pasados ${plural(diasAvisoAdmin(env), 'día', 'días')} (o la fecha de «Recordarme calificar antes de» de la tarea).`,
    deTutoras);
  pintar('Cursos sin tutora en el CRM',
    `Ninguna tutora del CRM ve estas entregas: el curso no tiene profesora vinculada en el CRM (o la que tiene no ve a ese alumno por los grupos). Llevan más de ${HORAS_SIN_CORREGIR} h.`,
    sinTutora);
  if (quedan <= 0 && entregas.length > MAX_LINEAS) {
    bloques.push(parrafo(`Y ${plural(entregas.length - MAX_LINEAS, 'entrega más', 'entregas más')}: están todas en el calificador de cada tarea en Moodle.`));
  }
  bloques.push(boton({ texto: 'Ver las tutoras en el CRM', url: enlace('tutores') }));
  bloques.push(nota('Cada entrega se avisa una sola vez. Puedes apagar estos correos en «Mis preferencias» («Entregas sin corregir fuera de plazo»).'));
  return correo({
    proyecto,
    titulo: 'Entregas sin corregir fuera de plazo',
    saludo: persona.nombre || null,
    resumen: `${plural(entregas.length, 'entrega sigue', 'entregas siguen')} sin corregir en ${campus}`,
    bloques,
  });
}

/** Correo a quien está activo, tiene correo y no lo ha apagado. Un fallo de Brevo no rompe el aviso. */
async function correosDelCampus(projectId, destinatarios, nuevas, { enviar, ahora, env }) {
  const [{ rows: personas }, { rows: [p] }] = await Promise.all([
    query(
      `SELECT u.id, u.nombre, u.email FROM users u
        WHERE u.id = ANY($1::int[]) AND u.active AND u.email IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM avisos_apagados a WHERE a.user_id = u.id AND a.aviso = $2)`,
      [destinatarios, AVISO_ENTREGAS_FUERA_DE_PLAZO]),
    query('SELECT nombre, slug, logo_url, emoji FROM projects WHERE id = $1', [projectId]),
  ]);
  const proyecto = p ? { nombre: p.nombre, slug: p.slug, logo_url: p.logo_url, emoji: p.emoji } : {};
  const campus = p?.nombre || nuevas[0]?.campus || 'el campus';
  const ids = nuevas.map((e) => e.avisoId);
  let enviados = 0;
  for (const persona of personas) {
    const { htmlContent, textContent } = cuerpoParaAdministracion({ persona, campus, proyecto, entregas: nuevas, ahora, env });
    const r = await enviar({
      to: persona.email,
      subject: `[${campus}] ${plural(nuevas.length, 'entrega', 'entregas')} sin corregir fuera de plazo`,
      htmlContent, textContent, tags: ['tutores', 'administracion', 'entregas-sin-corregir'], projectId,
      clave: `entregas-fuera-plazo-${projectId}-${Math.min(...ids)}-${Math.max(...ids)}-${persona.id}`,
    }).catch((err) => ({ sent: false, error: err.message }));
    if (r?.sent) enviados += 1;
  }
  return enviados;
}

/** Las nuevas de un campus: campana a administración y, si está encendido, correo. */
async function avisarDelCampus(projectId, entregas, { enviar, ahora, env }) {
  const nuevas = await apuntarNuevas(entregas);
  if (!nuevas.length) return { avisadas: 0, sinTutora: 0, correos: 0 };
  const destinatarios = await administracionDelCampus(projectId);
  const sinTutora = nuevas.filter((e) => e.motivo === 'sin_tutora').length;
  let correos = 0;
  // Sin nadie, nada: una lista vacía en la campana se entendería como «para todos».
  if (destinatarios.length) {
    const partes = [
      nuevas.length - sinTutora ? `${nuevas.length - sinTutora} de tutoras, pasado el plazo` : null,
      sinTutora ? `${sinTutora} de cursos sin tutora en el CRM` : null,
    ].filter(Boolean);
    await notifyUsers({
      targetUserIds: destinatarios,
      type: AVISO_ENTREGAS_FUERA_DE_PLAZO,
      title: `${plural(nuevas.length, 'entrega sigue', 'entregas siguen')} sin corregir`,
      message: `${nuevas[0].campus} · ${partes.join(' · ')}`,
      link_path: '/tutores',
      metadata: { project_id: projectId, entregas: nuevas.length, sin_tutora: sinTutora },
    });
    if (correoAAdministracion(env)) {
      try { correos = await correosDelCampus(projectId, destinatarios, nuevas, { enviar, ahora, env }); } catch (err) {
        logger.warn({ projectId, err: err.message }, 'tutores: el correo de entregas fuera de plazo ha fallado');
      }
    }
  }
  await query('UPDATE entregas_avisos_administracion SET avisados = $2, correos = $3 WHERE id = ANY($1::int[])',
    [nuevas.map((e) => e.avisoId), destinatarios.length, correos]);
  return { avisadas: nuevas.length, sinTutora, correos };
}

/**
 * El segundo escalón, con lo que ha recogido la vuelta de las tutoras (`recogida`).
 * `projectIds`: solo esos campus (null = todos los conectados).
 */
export async function avisarAdministracionDeEntregas({
  ahora = new Date(), enviar = sendEmail, env = process.env, projectIds = null,
  activo = pluginMoodleActivo(), opciones = {}, recogida = { entregas: [], fallos: new Set() },
} = {}) {
  const r = {
    apagado: !activo, avisadas: 0, deTutoras: 0, sinTutora: 0, correos: 0, campusSaltados: [], errores: 0,
  };
  if (!activo) return r;
  const vistas = new Set(recogida.entregas.map(claveDe));
  const porCampus = new Map();
  for (const e of deTutorasFueraDePlazo(recogida.entregas, ahora, env)) {
    if (projectIds && !projectIds.includes(e.projectId)) continue;
    if (!porCampus.has(e.projectId)) porCampus.set(e.projectId, []);
    porCampus.get(e.projectId).push(e);
  }
  for (const c of await campusConectados(projectIds)) {
    try {
      const { entregas, omitido } = await sinTutoraEnElCampus(c, { ahora, vistas, fallos: recogida.fallos, opciones });
      if (omitido) r.campusSaltados.push({ projectId: c.projectId, motivo: omitido });
      if (entregas.length) porCampus.set(c.projectId, [...(porCampus.get(c.projectId) || []), ...entregas]);
    } catch (err) {
      r.errores += 1;
      logger.warn({ projectId: c.projectId, err: err.message }, 'tutores: no se han podido buscar las entregas sin tutora del campus');
    }
  }
  for (const [projectId, entregas] of porCampus) {
    try {
      const hecho = await avisarDelCampus(projectId, entregas, { enviar, ahora, env });
      r.avisadas += hecho.avisadas;
      r.deTutoras += hecho.avisadas - hecho.sinTutora;
      r.sinTutora += hecho.sinTutora;
      r.correos += hecho.correos;
    } catch (err) {
      r.errores += 1;
      logger.warn({ projectId, err: err.message }, 'tutores: el aviso a administración de entregas sin corregir ha fallado');
    }
  }
  return r;
}

/**
 * La vuelta entera del job: primero las tutoras (48 h) y, con lo que ellas ven, administración.
 * Devuelve solo cifras (las ve el latido).
 */
export async function vueltaDeEntregas(opts = {}) {
  const recogida = { entregas: [], fallos: new Set() };
  const tutoras = await avisarEntregasSinCorregir({ ...opts, recogida });
  const administracion = await avisarAdministracionDeEntregas({ ...opts, recogida });
  return {
    ...tutoras,
    administracion: administracion.avisadas,
    administracionCorreos: administracion.correos,
    campusSaltados: administracion.campusSaltados.length,
  };
}
