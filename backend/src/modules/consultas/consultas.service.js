/*
  CONSULTAS DE ALUMNOS · FASE 2 (#188): reparto, entrada desde el campus, aviso
  al tutor y respuesta de vuelta al campus.

  ENTRADA (campus piloto). Hoy el alumno pregunta por la mensajería privada de
  Moodle: el «Chat» del curso le lleva a un mensaje privado con su tutor (estudio
  de la fase 0). Así que se leen las conversaciones de cada tutor MATRICULADO en
  el campus, cada pocos minutos (decisión 3 de la fase 0: «empezar leyendo cada
  5 minutos en el piloto, que no necesita instalar nada»). Solo los campus que
  tienen marcado «Leer las consultas» en Integraciones, y solo lo escrito desde
  que se marcó: no se trae el historial.

  REPARTO (decisión 2). El alumno ya le escribe a un tutor: si ese tutor puede
  recibir consultas (matriculado, activo y disponible), es suyo. Si no, va al
  tutor del campus (o de su empresa) con menos consultas abiertas. Desde #679,
  solo entre las tutoras que son profesoras de ESE curso en Moodle, y con cada
  mensaje del alumno (relevo): si la suya ya no puede, pasa a otra del curso. Lo
  que se pregunta a Moodle para eso se pregunta ANTES de la transacción del
  mensaje, nunca con sus bloqueos puestos.

  RESPUESTA (decisión 1 de la fase 0, sin decidir). Con un token común la
  respuesta no sale como el tutor, así que se usa EL TOKEN DEL TUTOR, guardado
  cifrado en su ficha (opción «a»): funciona con cualquier Moodle sin instalar
  nada.

  PLUGIN DEL CRM (#679). En el campus que lo tiene instalado, cada mensaje
  privado llega al momento (consultas.avisos.js) y la respuesta sale por el
  plugin, en nombre de la tutora, con el token del campus: no hace falta el token
  de cada una. La lectura cada 5 minutos sigue como red por si un aviso se pierde.
  Solo en pruebas mientras no se apruebe (PLUGIN_MOODLE_EN_PRODUCCION): apagado,
  la respuesta sale con el token de la tutora, como siempre.
*/
import crypto from 'node:crypto';
import { query } from '../../shared/config/db.js';
import { encrypt, decrypt, maskSecret } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import {
  correo, parrafo, boton, nota, enlace, esc,
} from '../../shared/services/email-plantilla.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../../shared/config/frenoTutores.js';
import {
  conversacionesDe, mensajesDeConversacion, usuarioPorId, enviarMensaje, enviarComoTutor, matriculadosDe, cursosDe, MoodleError,
} from '../../shared/services/moodle.client.js';
import { pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import { pluginActivo, campusConPluginAlDia } from './consultas.plugin.js';
import { tutoresQueRecibenConsultas, conexionDelCampus } from '../tutores/tutor.campus.js';
import * as model from './consultas.model.js';
import { marcarContactado } from './consultas.alumnos.js';

// ─── Reparto ─────────────────────────────────────────────────────────────────

/**
 * El tutor de una consulta de ese campus, con todo lo que haga falta (también Moodle).
 * Para fuera de una transacción: dentro, `elegirTutorEntre` con las candidatas ya leídas.
 */
export async function elegirTutor(projectId, {
  preferido = null, nueva = true, cursoId = null, alumnoMoodleId = null, soloEntre = null,
} = {}) {
  const delCurso = await candidatasDelCurso(projectId, { cursoId, alumnoMoodleId, soloEntre });
  return elegirTutorEntre(projectId, { preferido, nueva, soloEntre, delCurso });
}

/**
 * El tutor de una consulta de ese campus, SOLO con la base: no pregunta a Moodle. Es lo que
 * se llama con la transacción del mensaje abierta (y sus bloqueos puestos); las tutoras del
 * curso (`delCurso`) llegan ya calculadas de antes (`candidatasDelCurso`).
 *
 *   · solo tutoras de ese curso (`delCurso`, #679): si una no está, la cubre otra del mismo
 *     curso, nunca una de otro; `delCurso` null = no se sabe (sin curso ni alumno, o el
 *     campus no contesta) y no se filtra: mejor repartir que dejar la consulta sin nadie;
 *   · `preferido` (al que escribió el alumno, o el que ya la lleva) si puede recibir consultas;
 *   · si no, el que tenga menos consultas abiertas; a igualdad, el que lleva
 *     más tiempo sin recibir una, y luego el de id más bajo (para que sea fijo);
 *   · null si no hay nadie: la consulta queda «sin tutor» en el panel.
 */
export async function elegirTutorEntre(projectId, {
  preferido = null, nueva = true, soloEntre = null, delCurso = null,
} = {}) {
  let candidatos = await tutoresQueRecibenConsultas(projectId);
  // La conversación de un grupo del curso (#285): solo una tutora que esté DENTRO, o la
  // respuesta desde el CRM no podría salir (el plugin no añade a nadie a un grupo del curso).
  if (soloEntre) candidatos = candidatos.filter((t) => soloEntre.has(t.id));
  if (!candidatos.length) return null;
  if (delCurso) {
    candidatos = candidatos.filter((x) => delCurso.has(x.id));
    if (!candidatos.length) return null;
  }
  // Decisión 10 (#189): con la carga «completa» no recibe consultas NUEVAS si
  // hay otro tutor en el campus. Si es el único, sí (no se deja sin tutor). Una
  // que se reabre sigue con el tutor que ya la llevaba: no es nueva.
  const completos = nueva ? await tutoresConCargaCompleta(candidatos.map((t) => t.id)) : new Set();
  if (completos.size && candidatos.some((t) => !completos.has(t.id))) {
    candidatos = candidatos.filter((t) => !completos.has(t.id));
  }
  if (preferido && candidatos.some((t) => t.id === Number(preferido))) return Number(preferido);
  const carga = await model.abiertasPorTutor(candidatos.map((t) => t.id));
  const ordenados = [...candidatos].sort((a, b) => {
    const ca = carga.get(a.id) || { n: 0, ultima: null };
    const cb = carga.get(b.id) || { n: 0, ultima: null };
    if (ca.n !== cb.n) return ca.n - cb.n;
    const ua = ca.ultima ? new Date(ca.ultima).getTime() : 0;
    const ub = cb.ultima ? new Date(cb.ultima).getTime() : 0;
    if (ua !== ub) return ua - ub;
    return a.id - b.id;
  });
  return ordenados[0].id;
}

/**
 * Las tutoras del curso entre las que se puede repartir, preguntando a Moodle si hace falta.
 * Si ninguna de las que pueden recibir consultas está en la copia, se pregunta otra vez a
 * Moodle (`fresco`) antes de dejarla sin tutora: alguien pudo entrar en el curso hace un
 * momento. Null si no se sabe (ver `elegirTutorEntre`).
 *
 * Nunca con una transacción abierta: son llamadas HTTP de hasta 10 s cada una (punto 3 de
 * la revisión de Diego en #689).
 */
export async function candidatasDelCurso(projectId, { cursoId = null, alumnoMoodleId = null, soloEntre = null } = {}, opciones = {}) {
  let delCurso = await tutorasDelCurso(projectId, { cursoId, alumnoMoodleId }, opciones);
  if (!delCurso) return null;
  let candidatos = await tutoresQueRecibenConsultas(projectId);
  if (soloEntre) candidatos = candidatos.filter((t) => soloEntre.has(t.id));
  if (candidatos.length && !candidatos.some((x) => delCurso.has(x.id))) {
    delCurso = await tutorasDelCurso(projectId, { cursoId, alumnoMoodleId }, { ...opciones, fresco: true });
  }
  return delCurso;
}

/*
  La copia de lo que dice Moodle, por campus y curso (sus profesoras) o por campus y alumno
  (sus cursos), también cuando la respuesta es una lista vacía.

    · CACHE_MOODLE_MS (2 min): lo que dura una copia en el reparto normal.
    · REPREGUNTA_MIN_MS (1 min): el reintento `fresco` no vuelve a preguntar por una copia
      más nueva que esto. Sin este mínimo, un curso SIN tutora vinculada preguntaba a Moodle
      con cada mensaje del alumno (la copia valía, pero el reintento la saltaba siempre).
      Así, como mucho una pregunta por curso y minuto; y quien entra en un curso se ve en
      menos de un minuto cuando hace falta (la consulta se iba a quedar sin tutora).
*/
const CACHE_MOODLE_MS = 2 * 60 * 1000;
const REPREGUNTA_MIN_MS = 60 * 1000;
const MAX_COPIAS = 5000;
const copiasDeMoodle = new Map();

async function desdeLaCopia(clave, fresco, pedir) {
  const copia = copiasDeMoodle.get(clave);
  const edad = copia ? Date.now() - copia.at : Infinity;
  if (edad < (fresco ? REPREGUNTA_MIN_MS : CACHE_MOODLE_MS)) return copia.valor;
  const valor = await pedir();
  if (copiasDeMoodle.size >= MAX_COPIAS) {
    for (const [k, c] of copiasDeMoodle) if (Date.now() - c.at >= CACHE_MOODLE_MS) copiasDeMoodle.delete(k);
    if (copiasDeMoodle.size >= MAX_COPIAS) copiasDeMoodle.clear();
  }
  copiasDeMoodle.set(clave, { at: Date.now(), valor });
  return valor;
}

/**
 * Las tutoras del CRM que son profesoras de ese curso (o, sin curso, de alguno de los
 * cursos del alumno), por su cuenta de Moodle vinculada. Null si no se sabe (sin curso
 * ni alumno, o el campus no contesta). Con copia (ver arriba); `fresco`, sin ella si tiene
 * más de un minuto.
 */
export async function tutorasDelCurso(projectId, { cursoId = null, alumnoMoodleId = null } = {}, { fresco = false, ...opciones } = {}) {
  if (!cursoId && !alumnoMoodleId) return null;
  const conexion = await conexionDelCampus(projectId);
  if (!conexion || conexion.error) return null;
  try {
    const cursos = cursoId
      ? [Number(cursoId)]
      : await desdeLaCopia(`${projectId}:alumno:${alumnoMoodleId}`, fresco,
        async () => (await cursosDe(conexion, alumnoMoodleId, opciones)).map((k) => k.id).slice(0, 15));
    // Un alumno sin cursos (dado de baja, o que escribe por la mensajería general): no hay
    // curso por el que filtrar. Sin esto, la lista vacía dejaba la consulta sin nadie, ni
    // siquiera la tutora a la que escribió.
    if (!cursos.length) return null;
    const profesoras = new Set();
    for (const id of cursos) {
      const ids = await desdeLaCopia(`${projectId}:curso:${id}`, fresco, async () => (await matriculadosDe(conexion, id, opciones))
        .filter((g) => g.roles.some((r) => r === 'editingteacher' || r === 'teacher')).map((g) => g.id));
      ids.forEach((x) => profesoras.add(x));
    }
    const { rows } = await query(
      `SELECT tutor_id FROM tutor_campus WHERE project_id = $1 AND estado = 'activa' AND moodle_user_id = ANY($2::bigint[])`,
      [projectId, [...profesoras]]);
    return new Set(rows.map((r) => Number(r.tutor_id)));
  } catch (err) {
    logger.warn({ projectId, cursoId, err: err.message }, 'consultas: no se han podido leer las profesoras del curso');
    return null;
  }
}

/** Los tutores cuya carga de ahora (la última que pusieron) es «completa». */
async function tutoresConCargaCompleta(tutorIds) {
  if (!tutorIds.length) return new Set();
  const { rows } = await query(
    `SELECT DISTINCT ON (tutor_id) tutor_id, nivel FROM tutor_carga
      WHERE tutor_id = ANY($1::int[]) ORDER BY tutor_id, created_at DESC, id DESC`, [tutorIds]);
  return new Set(rows.filter((r) => r.nivel === 'completa').map((r) => Number(r.tutor_id)));
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Mete un mensaje del alumno y avisa a su tutor. Lo usa la lectura del campus
 * y lo usarían otras entradas (un webhook del campus) sin cambiar nada.
 */
export async function entraMensajeDelAlumno(datos, { tutorPreferido = null, avisar = true, soloEntre = null } = {}) {
  // Moodle, ANTES de la transacción: dentro están el bloqueo del alumno y el FOR UPDATE de su
  // consulta, y hasta 16 llamadas de 10 s ahí podían agotar el pool (punto 3 de Diego, #689).
  const antes = await candidatasAntesDeGuardar(datos, soloEntre);
  // Al reabrir (y con cada mensaje, el relevo), primero el tutor que ya la lleva (puede ser
  // otro que el de la conversación, si se reasignó); en una nueva, al que escribió el alumno.
  const r = await model.guardarMensajeDelAlumno(datos, (actual, cursoDeLaConsulta) => {
    const curso = cursoDeLaConsulta ?? datos.curso?.moodleId ?? null;
    // Si entre la lectura de antes y el bloqueo otra entrada cambió el curso de la consulta,
    // las candidatas no son de ese curso: no se filtra (como con el campus sin contestar).
    const delCurso = antes && mismoCurso(antes.cursoId, curso) ? antes.candidatas : null;
    return elegirTutorEntre(datos.projectId, { preferido: actual ?? tutorPreferido, nueva: actual == null, soloEntre, delCurso });
  });
  // `sinReabrir`: lo que escribe un alumno en un grupo del curso a una consulta cerrada se
  // queda dentro como contexto (consultas.avisos.js): no hay a quién avisar.
  if (r.duplicado || r.sinReabrir) return r;
  // #189: ya tiene conversación con su tutor, sale de «Alumnos sin mensajes».
  if (r.nueva && r.consulta.tutor_id) {
    await marcarContactado(datos.projectId, r.consulta.tutor_id, datos.alumno.moodleId, datos.escritoAt || new Date());
  }
  if (avisar && r.consulta.tutor_id) {
    await avisarAlTutor(r.consulta, datos.texto, { nueva: r.nueva || r.reabierta })
      .catch((err) => logger.warn({ consultaId: r.consulta.id, err: err.message }, 'consultas: el aviso al tutor ha fallado'));
  }
  return r;
}

const mismoCurso = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b));

/**
 * Las tutoras del curso de ESE mensaje, leídas sin bloquear nada: el curso de la consulta en
 * la que va a entrar (la misma búsqueda que hace el modelo, sin FOR UPDATE) o, si no hay, el
 * del mensaje. Null si no hace falta elegir (mensaje repetido, o uno que se queda en una
 * consulta cerrada sin reabrirla): así un repetido no le cuesta a Moodle ninguna llamada.
 */
async function candidatasAntesDeGuardar(datos, soloEntre) {
  const { projectId, alumno, conversacionId, externoId } = datos;
  if (externoId != null && await model.existeMensajeExterno(projectId, externoId)) return null;
  const previa = await model.consultaPrevia(projectId, alumno.moodleId, conversacionId);
  if (previa?.estado === 'cerrada' && datos.reabrir === false) return null;
  const cursoId = previa?.curso_moodle_id != null ? Number(previa.curso_moodle_id) : (datos.curso?.moodleId ?? null);
  const candidatas = await candidatasDelCurso(projectId, { cursoId, alumnoMoodleId: alumno.moodleId ?? null, soloEntre });
  return { cursoId, candidatas };
}

const MARGEN_LECTURA_MS = 10 * 60 * 1000;

/**
 * «Leer el campus ahora» y la vuelta programada pueden leer el mismo mensaje a
 * la vez: el segundo choca con el índice único del id de Moodle. Eso es un
 * repetido, no un fallo que corte la lectura del campus.
 */
export async function siYaEstaRepetido(guardar) {
  try {
    return await guardar();
  } catch (err) {
    if (err.code === '23505') return { duplicado: true };
    throw err;
  }
}

/** Los campus con «Leer las consultas» marcado en su conexión de Moodle. */
export async function campusConConsultas() {
  const { rows } = await query(
    `SELECT pi.project_id, pi.config_public
       FROM project_integrations pi
       JOIN projects p ON p.id = pi.project_id AND p.active
      WHERE pi.provider = 'moodle' AND pi.active AND pi.encrypted_value IS NOT NULL
        AND COALESCE((pi.config_public->>'consultas')::boolean, false)`);
  return rows.map((r) => ({
    projectId: Number(r.project_id),
    desde: r.config_public?.consultas_desde ? new Date(r.config_public.consultas_desde) : new Date(),
  }));
}

/** Los tutores matriculados en ese campus, con su id de Moodle. */
export async function tutoresDelCampus(projectId) {
  const { rows } = await query(
    `SELECT tc.tutor_id, tc.moodle_user_id
       FROM tutor_campus tc JOIN users u ON u.id = tc.tutor_id AND u.active
      WHERE tc.project_id = $1 AND tc.estado = 'activa' AND tc.moodle_user_id IS NOT NULL`, [projectId]);
  return rows.map((r) => ({ tutorId: Number(r.tutor_id), moodleId: Number(r.moodle_user_id) }));
}

/**
 * Lee el campus: las conversaciones privadas de sus tutores y lo nuevo de cada
 * una. Un mensaje del alumno entra como consulta (o en la suya); uno del tutor
 * escrito en el campus cuenta como respuesta.
 */
export async function leerCampus(projectId, { desde = new Date(0), ...opciones } = {}) {
  const conexion = await conexionDelCampus(projectId);
  if (!conexion || conexion.error) return { projectId, sinConexion: true, error: conexion?.error || null };
  const resumen = { projectId, conversaciones: 0, nuevos: 0, respuestas: 0, consultasNuevas: 0, errores: [] };
  const alumnos = new Map();
  for (const tutor of await tutoresDelCampus(projectId)) {
    let conversaciones;
    try {
      conversaciones = await conversacionesDe(conexion, tutor.moodleId, {}, opciones);
    } catch (err) {
      resumen.errores.push(err instanceof MoodleError ? err.message : 'No se han podido leer sus conversaciones.');
      continue;
    }
    for (const conv of conversaciones) {
      // Individual: el otro miembro es el alumno (Moodle no lista al propio usuario).
      const alumno = conv.miembros.find((m) => m.id !== tutor.moodleId);
      if (!alumno) continue;
      resumen.conversaciones += 1;
      // #189: una conversación que empezó el tutor desde el CRM («Escribir al
      // alumno») aún no sabe cuál es en el campus: se le pone ahora, para que
      // la respuesta del alumno vaya a esa misma consulta.
      await query(
        `UPDATE consultas SET conversacion_externa_id = $4
          WHERE project_id = $1 AND alumno_moodle_id = $2 AND tutor_id = $3 AND conversacion_externa_id IS NULL`,
        [projectId, alumno.id, tutor.tutorId, conv.id]);
      // Desde el último mensaje guardado, con un margen: la hora de una
      // respuesta enviada desde el CRM es la del CRM, y el reloj del campus
      // puede ir unos segundos por detrás. Lo repetido lo descarta su id.
      const ultimo = await model.ultimoDeLaConversacion(projectId, conv.id);
      const desdeAqui = new Date(Math.max(desde.getTime(),
        ultimo ? new Date(ultimo).getTime() - MARGEN_LECTURA_MS : 0));
      let mensajes;
      try {
        mensajes = await mensajesDeConversacion(conexion, tutor.moodleId, conv.id, { desde: desdeAqui.getTime() / 1000 }, opciones);
      } catch (err) {
        resumen.errores.push(err instanceof MoodleError ? err.message : 'No se ha podido leer una conversación.');
        continue;
      }
      for (const m of mensajes) {
        if (m.fecha < desde) continue;
        if (await model.existeMensajeExterno(projectId, m.id)) continue;
        if (m.de === tutor.moodleId) {
          const r = await siYaEstaRepetido(() => model.guardarRespuestaDesdeElCampus({
            projectId, conversacionId: conv.id, alumnoMoodleId: alumno.id,
            tutorId: tutor.tutorId, texto: m.texto, externoId: m.id, escritoAt: m.fecha,
          }));
          if (!r.duplicado && !r.sinConsulta) resumen.respuestas += 1;
          continue;
        }
        if (m.de !== alumno.id) continue;
        if (!alumnos.has(alumno.id)) {
          alumnos.set(alumno.id, await usuarioPorId(conexion, alumno.id, opciones).catch(() => null));
        }
        const datos = alumnos.get(alumno.id);
        const r = await siYaEstaRepetido(() => entraMensajeDelAlumno({
          projectId, conversacionId: conv.id,
          alumno: { moodleId: alumno.id, nombre: datos?.nombre || alumno.nombre, email: datos?.email || null },
          texto: m.texto, externoId: m.id, escritoAt: m.fecha,
        }, { tutorPreferido: tutor.tutorId, avisar: opciones.avisar !== false }));
        if (!r.duplicado) {
          resumen.nuevos += 1;
          if (r.nueva) resumen.consultasNuevas += 1;
        }
      }
    }
  }
  return resumen;
}

/**
 * Una vuelta por todos los campus con consultas. La llama el trabajo programado (cada 5 min).
 *
 * Se salta los campus que el plugin del CRM tiene al día (#689, 8b): ya entran por el aviso
 * al momento y por el repaso de cada 15 minutos (`campusConPluginAlDia`). Si el plugin deja
 * de estar al día, el campus vuelve a leerse aquí solo. «Leer ahora» (consultas.controller)
 * no pasa por aquí: lee siempre, también los campus con plugin.
 */
export async function leerTodosLosCampus({ env = process.env, ...opciones } = {}) {
  const resultados = [];
  const conPlugin = await campusConPluginAlDia(env);
  for (const c of await campusConConsultas()) {
    if (conPlugin.has(c.projectId)) {
      resultados.push({ projectId: c.projectId, omitido: 'plugin' });
      continue;
    }
    try {
      resultados.push(await leerCampus(c.projectId, { desde: c.desde, ...opciones }));
    } catch (err) {
      logger.warn({ projectId: c.projectId, err: err.message }, 'consultas: fallo al leer el campus');
      resultados.push({ projectId: c.projectId, errores: [err.message] });
    }
  }
  return resultados;
}

// ─── Aviso al tutor ──────────────────────────────────────────────────────────

/**
 * El correo al tutor: proyecto, curso, alumno, primeras líneas y «Responder en
 * el CRM». No se responde desde el correo (#188).
 *
 * Con el freno de correos a tutores puesto (Diego, 15/09) no sale: se apunta y
 * ya. La consulta está igual en su bandeja.
 */
export async function avisarAlTutor(consulta, texto, { nueva = true } = {}) {
  const { rows } = await query(
    `SELECT u.nombre, u.email, p.nombre AS campus, p.slug, p.logo_url, p.emoji
       FROM users u, projects p WHERE u.id = $1 AND p.id = $2`, [consulta.tutor_id, consulta.project_id]);
  const d = rows[0];
  if (!d?.email) return { sent: false, motivo: 'sin correo' };
  const asunto = nueva
    ? `[${d.campus}] Consulta nueva de ${consulta.alumno_nombre || 'un alumno'}`
    : `[${d.campus}] ${consulta.alumno_nombre || 'El alumno'} ha vuelto a escribir`;
  if (NO_ESCRIBIR_A_TUTORES) {
    logger.info({ consultaId: consulta.id, tutorId: consulta.tutor_id, asunto }, 'consultas: aviso al tutor sin enviar (freno de correos a tutores)');
    return { sent: false, frenado: true };
  }
  const primeras = String(texto || '').slice(0, 280);
  const { htmlContent, textContent } = correo({
    proyecto: { nombre: d.campus, logo_url: d.logo_url, emoji: d.emoji },
    titulo: nueva ? 'Tienes una consulta nueva' : 'El alumno ha vuelto a escribir',
    saludo: d.nombre || null,
    resumen: primeras,
    bloques: [
      parrafo(`<strong>${esc(consulta.alumno_nombre || 'Un alumno')}</strong>${consulta.curso_nombre ? `, de <strong>${esc(consulta.curso_nombre)}</strong>,` : ''} ha escrito en el campus de <strong>${esc(d.campus)}</strong>:`),
      parrafo(`«${esc(primeras)}${String(texto || '').length > 280 ? '…' : ''}»`),
      boton({ texto: 'Responder en el CRM', url: enlace(`consultas/${consulta.id}`) }),
      nota('Responde desde el CRM, no desde este correo: así el alumno recibe la respuesta en el campus y queda medido.'),
    ],
  });
  return sendEmail({
    to: d.email, subject: asunto, htmlContent, textContent,
    tags: ['consultas', 'tutor'], projectId: consulta.project_id,
    clave: `consulta-${consulta.id}-${Date.now()}`,
  });
}

// ─── Respuesta de vuelta al campus ───────────────────────────────────────────

const DIAS_ENLACE_ADJUNTO = Number(process.env.CONSULTAS_ADJUNTO_DIAS || 90);

/** El token del tutor en ese campus (descifrado), o null. */
export async function tokenDelTutor(tutorId, projectId) {
  const { rows } = await query(
    `SELECT token_cifrado, token_iv, token_tag, moodle_user_id FROM tutor_campus
      WHERE tutor_id = $1 AND project_id = $2`, [tutorId, projectId]);
  const r = rows[0];
  if (!r?.token_cifrado) return null;
  try { return decrypt(r.token_cifrado, r.token_iv, r.token_tag); } catch { return null; }
}

/** El id de Moodle de la tutora en ese campus (lo pone «Comprobar»), o null. */
export async function moodleIdDelTutor(tutorId, projectId) {
  const { rows } = await query(
    'SELECT moodle_user_id FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2', [tutorId, projectId]);
  return rows[0]?.moodle_user_id ? Number(rows[0].moodle_user_id) : null;
}

/** Guarda (o quita, con null) el token del tutor en ese campus. */
export async function guardarTokenDelTutor(tutorId, projectId, token) {
  if (!token) {
    await query(
      `UPDATE tutor_campus SET token_cifrado = NULL, token_iv = NULL, token_tag = NULL
        WHERE tutor_id = $1 AND project_id = $2`, [tutorId, projectId]);
    return null;
  }
  const enc = encrypt(token.trim());
  const { rowCount } = await query(
    `UPDATE tutor_campus SET token_cifrado = $3, token_iv = $4, token_tag = $5
      WHERE tutor_id = $1 AND project_id = $2`, [tutorId, projectId, enc.encrypted, enc.iv, enc.authTag]);
  return rowCount ? maskSecret(token.trim()) : false;
}

/**
 * Las direcciones que escribe el tutor (el curso, una tarea…), como enlaces que
 * el alumno puede pulsar: en HTML Moodle no las enlaza solo. Sobre el texto YA
 * escapado; la puntuación del final («…la tarea: https://…/view.php?id=2.») no
 * entra en el enlace.
 */
export function enlazar(escapado) {
  return escapado.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const cola = url.match(/[.,;:!?)»]+$/)?.[0] || '';
    const limpia = cola ? url.slice(0, -cola.length) : url;
    return `<a href="${limpia}" target="_blank" rel="noopener">${limpia}</a>${cola}`;
  });
}

/**
 * Lo que llega al alumno, en HTML: la respuesta y un enlace de verdad a cada
 * adjunto. En texto plano Moodle no convierte las direcciones en enlaces y el
 * alumno tenía que copiarlas a mano (prueba a mano de Diana, 19/10).
 *
 * Lo que escribe el tutor va escapado: sale tal cual, sin que un «<» suyo se
 * lea como HTML. Los saltos de línea se respetan.
 */
export function textoParaElCampus(texto, adjuntos = []) {
  const partes = String(texto || '').trim().split(/\n{2,}/)
    .map((p) => `<p>${enlazar(esc(p)).replace(/\n/g, '<br>')}</p>`);
  if (adjuntos.length) {
    const enlaces = adjuntos.map((a) => {
      const url = esc(enlace(`api/adjunto-consulta/${a.token_descarga}`));
      return `📎 <a href="${url}" target="_blank" rel="noopener">${esc(a.nombre)}</a>`;
    });
    partes.push(`<p>${adjuntos.length === 1 ? 'Archivo adjunto:' : 'Archivos adjuntos:'}<br>${enlaces.join('<br>')}</p>`);
  }
  return partes.join('');
}

/**
 * Manda al campus una respuesta ya guardada. Si no puede (sin token del tutor,
 * campus caído…), se queda guardada con el motivo y se puede reintentar.
 */
export async function enviarAlCampus(mensaje, consulta, adjuntos = [], { db = null, ...opciones } = {}) {
  const conexion = await conexionDelCampus(consulta.project_id);
  let error = null;
  let externoId = null;
  let conversacionId = null;
  if (!conexion || conexion.error) {
    error = conexion?.error || 'El campus no está conectado en Integraciones.';
  } else if (!consulta.alumno_moodle_id) {
    error = 'No se sabe quién es el alumno en el campus.';
  } else if (pluginMoodleActivo() && await pluginActivo(consulta.project_id)) {
    // #679: por el plugin, en nombre de la tutora, con el token del campus. Solo con el
    // interruptor encendido (PLUGIN_MOODLE_EN_PRODUCCION); apagado, como siempre (abajo).
    const desde = await moodleIdDelTutor(consulta.tutor_id, consulta.project_id);
    if (!desde) {
      error = 'La tutora no tiene su usuario del campus en el CRM: compruébala en Tutores → Campus.';
    } else {
      try {
        // Plugin 1.9.0: si la consulta es de un chat de grupo, la respuesta va a ese chat (la
        // ven el alumno y todas las tutoras del curso), no a una conversación privada.
        const r = await enviarComoTutor(conexion, desde, consulta.alumno_moodle_id,
          textoParaElCampus(mensaje.texto, adjuntos),
          { ...opciones, conversacionId: consulta.conversacion_grupo_id ? Number(consulta.conversacion_grupo_id) : null });
        externoId = r.id;
        conversacionId = r.conversacionId;
      } catch (err) {
        error = err instanceof MoodleError ? err.message : 'No se ha podido enviar al campus.';
      }
    }
  } else {
    const token = await tokenDelTutor(consulta.tutor_id, consulta.project_id);
    if (!token) {
      error = 'Falta el token del tutor en este campus: ponlo en su ficha (Tutores → Consultas de alumnos).';
    } else {
      try {
        const r = await enviarMensaje({ url: conexion.url, token }, consulta.alumno_moodle_id,
          textoParaElCampus(mensaje.texto, adjuntos), opciones);
        externoId = r.id;
        conversacionId = r.conversacionId;
      } catch (err) {
        error = err instanceof MoodleError ? err.message : 'No se ha podido enviar al campus.';
      }
    }
  }
  await model.apuntarEnvio(mensaje.id, { externoId, error, conversacionId }, db);
  return { enviado: Boolean(externoId), error };
}

/**
 * Responder desde el CRM: se guarda, se suben los adjuntos y se manda al campus.
 * Aunque el campus falle, la respuesta queda guardada (y cuenta como respondida:
 * el tutor ha contestado; lo que falta es que llegue).
 */
export async function responder(consultaId, tutorId, texto, archivos = [], { guardarArchivo, ...opciones } = {}) {
  const c = await model.cabecera(consultaId);
  if (!c) return null;
  // Primero los archivos: si alguno no se puede guardar, no queda una respuesta
  // a medias (guardada y «respondida», pero sin sus adjuntos).
  const subidos = [];
  for (const f of archivos) {
    const token = crypto.randomBytes(24).toString('hex');
    const nombreSeguro = f.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const key = `consultas/${c.project_id}/${c.id}/${token.slice(0, 12)}-${nombreSeguro}`;
    await guardarArchivo(key, f.buffer);
    subidos.push({ f, key, token });
  }
  const r = await model.guardarRespuestaDelCrm(consultaId, tutorId, texto);
  if (!r) return null;
  const adjuntos = [];
  for (const { f, key, token } of subidos) {
    adjuntos.push(await model.guardarAdjunto(r.mensaje.id, {
      nombre: f.originalname, tipo: f.mimetype, tamano: f.size, storageKey: key, token,
      expiraAt: new Date(Date.now() + DIAS_ENLACE_ADJUNTO * 86400000),
    }));
  }
  const envio = await enviarAlCampus(r.mensaje, r.consulta, adjuntos, opciones);
  return { mensajeId: r.mensaje.id, ...envio };
}

/**
 * Reintentar una respuesta que no llegó al campus.
 *
 * Con la fila bloqueada mientras se envía: un doble clic (o dos personas a la
 * vez) no la manda dos veces; el segundo ve que ya está en marcha.
 * Sale con el token de quien la escribió, no del tutor de ahora: si la consulta
 * se reasignó, el texto de A no puede llegar firmado por B.
 */
export async function reintentar(mensajeId, opciones = {}) {
  return model.enTransaccion(async (db) => {
    const { rows } = await db.query(
      `SELECT m.*, c.project_id AS c_project, c.tutor_id AS c_tutor, c.alumno_moodle_id AS c_alumno,
              c.conversacion_grupo_id AS c_grupo
         FROM consulta_mensajes m JOIN consultas c ON c.id = m.consulta_id
        WHERE m.id = $1 AND m.autor = 'tutor' AND m.enviado_campus_at IS NULL
        FOR UPDATE OF m SKIP LOCKED`, [mensajeId]);
    const m = rows[0];
    if (!m) return null;
    const adj = await db.query(
      'SELECT nombre, token_descarga FROM consulta_adjuntos WHERE mensaje_id = $1 ORDER BY id', [mensajeId]);
    return enviarAlCampus(m, {
      project_id: m.c_project, tutor_id: m.autor_user_id || m.c_tutor, alumno_moodle_id: m.c_alumno,
      conversacion_grupo_id: m.c_grupo,
    }, adj.rows, { ...opciones, db });
  });
}
