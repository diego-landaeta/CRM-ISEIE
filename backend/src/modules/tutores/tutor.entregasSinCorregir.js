/*
  ENTREGAS SIN CORREGIR MÁS DE 48 H (#681, indicaciones de Carlos del 05/11):
  «Aviso por correo si una duda o una tarea lleva más de 48 h sin atender».

  Las dudas ya avisan (consultas.plazos.js). Esto es lo de las tareas: una entrega
  de un alumno de sus cursos que lleva más de 48 h (desde que la entregó) sin nota.

    · Lo que cuenta como «sin corregir» es lo mismo que enseña «Mi campus»: se lee
      con `leerSusCampus` (sin el % de cada alumno, que aquí no hace falta). Las
      entregas en grupo no cuentan, como allí.
    · UNA vez por entrega y tutora: la tabla `entregas_sin_corregir_avisos` (migración
      304; la 254 en el CRM 360) recuerda cada una por su fecha de entrega. Si el alumno
      vuelve a entregar, es otra entrega y se vuelve a avisar.
    · UN correo por tutora y pasada, con todas sus entregas nuevas y el enlace de cada
      una al calificador de Moodle. Y un aviso en la campana.
    · Respeta el freno de correos a tutores (NO_ESCRIBIR_A_TUTORES): con él no sale el
      correo (se apunta en el registro); la campana sí, como en los plazos de consultas.
    · Solo lee Moodle, pero escribe a las tutoras: apagado en producción mientras Diego
      no lo apruebe (PLUGIN_MOODLE_EN_PRODUCCION, soloEnPruebas.js).
    · El aviso de la campana SE RETIRA SOLO (26/11, una tutora: «estoy al día;
      actualizo, pero sigue apareciendo»). En cada vuelta, si ninguna de sus entregas
      sigue por corregir, se marca resuelto y deja de salir (`avisosYaAtendidos`).
      Cada aviso guarda en `metadata.claves` qué entregas eran; los de antes de esto no
      lo guardan y se retiran cuando ya no le queda ninguna de más de 48 h. Igual que en
      el CRM 360.

  GEMELA (CRM-ISEIE#457, porte de la parte 7 de la #681 del CRM 360, PR CRM#736): en
  el 360 el correo y la campana llevan a «Mi campus» (`mis-cursos/campus`), donde la
  tutora corrige desde el CRM. Aquí «Mi campus» llegó con la #408 y está en la misma
  dirección, pero se corrige en Moodle (corregir desde el CRM va con el plugin, #406):
  el botón lleva a «Mi campus» para verlas juntas y la nota del correo dice que se
  corrigen en Moodle, con el enlace de cada entrega.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import {
  correo, parrafo, boton, nota, enlace, esc, seccion,
} from '../../shared/services/email-plantilla.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../../shared/config/frenoTutores.js';
import { pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import {
  notifyUsers, avisosAbiertos, resolverAvisos, anotarAviso,
} from '../notifications/notifications.service.js';
import { marcaDelTutor } from '../consultas/consultas.plazos.js';
import { leerSusCampus } from './tutor.micampus.js';

/** Horas desde la entrega a partir de las cuales se avisa. */
export const HORAS_SIN_CORREGIR = 48;

/**
 * «Mi campus» (#408), donde la tutora ve sus entregas por corregir. Aquí no se corrige en
 * el CRM (ver la cabecera): el botón lleva a verlas y la nota dice que se corrigen en Moodle.
 */
const MI_CAMPUS = 'mis-cursos/campus';

const fecha = (d) => new Intl.DateTimeFormat('es-ES', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
}).format(d);
const dias = (desde, ahora) => Math.floor((ahora - desde) / 86400000);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Las tutoras con alguna cuenta de Moodle vinculada y activa (las que tienen «Mi campus»). */
async function tutorasConCampus(tutorIds) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.nombre, u.email
       FROM users u
       JOIN tutor_campus tc ON tc.tutor_id = u.id AND tc.estado = 'activa' AND tc.moodle_user_id IS NOT NULL
       JOIN projects p ON p.id = tc.project_id AND p.active
      WHERE u.active AND ($1::int[] IS NULL OR u.id = ANY($1::int[]))
      ORDER BY u.id`, [tutorIds]);
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre, email: r.email }));
}

/** Todas las entregas por corregir de sus campus (con fecha), una por fila. */
export function entregasPorCorregir(campus) {
  return campus.flatMap((c) => c.cursos.flatMap((k) => k.tareas.flatMap((t) => t.sinCorregir
    .filter((e) => e.entregadaAt)
    .map((e) => ({
      projectId: c.projectId, campus: c.campus,
      cursoId: k.id, curso: k.nombre, tareaId: t.id, tarea: t.nombre,
      alumnoId: e.alumnoId, alumno: e.alumno, entregadaAt: new Date(e.entregadaAt),
      calificarAntes: t.calificarAntes ? new Date(t.calificarAntes) : null,
      corregirUrl: e.corregirUrl || t.corregirUrl,
    })))));
}

/** Las entregas por corregir de sus campus que ya pasan de las 48 h, una por fila. */
export function entregasVencidas(campus, ahora, horas = HORAS_SIN_CORREGIR) {
  const limite = ahora.getTime() - horas * 3600 * 1000;
  return entregasPorCorregir(campus).filter((e) => e.entregadaAt.getTime() <= limite);
}

/** Una entrega: campus, tarea, alumno y fecha de entrega (si vuelve a entregar, es otra). */
export const claveDe = (e) => `${e.projectId}-${e.tareaId}-${e.alumnoId}-${new Date(e.entregadaAt).getTime()}`;

/** El curso de una entrega, como se apunta en el aviso y en los fallos de lectura. */
const cursoDe = (e) => `${e.projectId}-${e.cursoId}`;

/**
 * La entrega SIN su fecha (campus, tarea, alumno): para decidir si sigue pendiente. Con la
 * fecha, que el alumno edite lo enviado antes de la nota cambiaba la clave y el aviso se
 * retiraba sin que nadie corrigiera nada (revisión de la PR).
 */
export const entregaDe = (e) => `${e.projectId}-${e.tareaId}-${e.alumnoId}`;
/** De una clave de `claveDe` (con fecha), la entrega sin fecha. */
const sinFecha = (clave) => String(clave).replace(/-\d+$/, '');

/**
 * De los avisos abiertos de la campana (`abiertos`: [{ id, metadata }]), los que ya no
 * piden nada con lo leído en esta vuelta (`campus`, de `leerSusCampus`). Devuelve sus ids.
 *
 *   · Con `metadata.claves` (los de ahora): ninguna de sus entregas (campus, tarea y alumno,
 *     sin mirar la fecha) sigue por corregir y sus cursos se han leído sin fallo. Así, si el
 *     alumno edita antes de la nota, o vuelve a entregar después, el aviso se queda hasta
 *     que se corrija lo último que envió. Si un curso no se ha podido
 *     leer, no se sabe: se queda.
 *   · Sin claves (los de antes de este cambio, que solo dicen cuántas): cuando ya no le
 *     queda ninguna entrega de más de `horas` por corregir y no ha fallado nada al leer.
 *
 * Un curso que ya no imparte no sale en lo leído: lo suyo deja de ser cosa suya y se retira.
 */
export function avisosYaAtendidos(abiertos, campus, ahora, horas = HORAS_SIN_CORREGIR) {
  const pendientes = new Set(entregasPorCorregir(campus).map(entregaDe));
  const fallos = new Set();
  for (const c of campus) {
    if (c.error) fallos.add(String(c.projectId));
    for (const k of c.cursos) if (k.error) fallos.add(`${c.projectId}-${k.id}`);
  }
  const vencidas = entregasVencidas(campus, ahora, horas).length;
  return abiertos.filter(({ metadata: m }) => {
    const claves = Array.isArray(m?.claves) ? m.claves : [];
    if (!claves.length) return fallos.size === 0 && vencidas === 0;
    const cursos = Array.isArray(m.cursos) ? m.cursos.map(String) : [];
    const sinLeer = cursos.some((k) => fallos.has(k) || fallos.has(k.split('-')[0]));
    return !sinLeer && !claves.some((k) => pendientes.has(sinFecha(k)));
  }).map((a) => a.id);
}

/**
 * La tutora acaba de poner la nota desde el CRM (`calificar`): no hace falta esperar a la
 * vuelta (2 h). Cada aviso abierto que incluye esa entrega la apunta en `metadata.corregidas`;
 * si ya están todas las suyas, se retira. Los avisos antiguos (sin claves) los retira la
 * vuelta. No falla nunca: la nota ya está puesta.
 */
export async function corregidaDesdeElCrm(tutorId, { projectId, tareaId, alumnoId }, ahora = new Date()) {
  const entrega = entregaDe({ projectId, tareaId, alumnoId });
  let retirados = 0;
  try {
    for (const a of await avisosAbiertos(tutorId, 'entregas_sin_corregir')) {
      const claves = (Array.isArray(a.metadata?.claves) ? a.metadata.claves : []).map(sinFecha);
      if (!claves.includes(entrega)) continue;
      const corregidas = new Set([...(Array.isArray(a.metadata.corregidas) ? a.metadata.corregidas : []), entrega]);
      if (claves.every((k) => corregidas.has(k))) retirados += await resolverAvisos([a.id], 'corregidas', ahora);
      else await anotarAviso(a.id, { corregidas: [...corregidas] });
    }
  } catch (err) {
    logger.warn({ tutorId, err: err.message }, 'tutores: no se ha podido retirar el aviso de la entrega corregida desde el CRM');
  }
  return retirados;
}

/** Retira de la campana de la tutora los avisos que ya no piden nada. No para la vuelta si falla. */
async function retirarAtendidos(tutora, campus, ahora) {
  try {
    const abiertos = await avisosAbiertos(tutora.id, 'entregas_sin_corregir');
    if (!abiertos.length) return 0;
    return await resolverAvisos(avisosYaAtendidos(abiertos, campus, ahora), 'corregidas', ahora);
  } catch (err) {
    logger.warn({ tutorId: tutora.id, err: err.message }, 'tutores: no se han podido retirar los avisos de entregas ya corregidas');
    return 0;
  }
}

/**
 * Apunta las que aún no se le habían avisado y devuelve SOLO esas (con el id de su fila).
 * Va antes del correo y en una sola sentencia: dos vueltas a la vez no avisan dos veces.
 */
async function apuntarNuevas(tutorId, entregas) {
  if (!entregas.length) return [];
  const { rows } = await query(
    `INSERT INTO entregas_sin_corregir_avisos (tutor_id, project_id, curso_id, tarea_id, alumno_moodle_id, entregada_at)
     SELECT $1::int, * FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::timestamptz[])
     ON CONFLICT (tutor_id, project_id, tarea_id, alumno_moodle_id, entregada_at) DO NOTHING
     RETURNING id, project_id, tarea_id, alumno_moodle_id, entregada_at`,
    [tutorId, entregas.map((e) => e.projectId), entregas.map((e) => e.cursoId), entregas.map((e) => e.tareaId),
      entregas.map((e) => e.alumnoId), entregas.map((e) => e.entregadaAt)]);
  const porClave = new Map(entregas.map((e) => [claveDe(e), e]));
  return rows.map((r) => {
    const e = porClave.get(claveDe({
      projectId: Number(r.project_id), tareaId: Number(r.tarea_id), alumnoId: Number(r.alumno_moodle_id), entregadaAt: r.entregada_at,
    }));
    return e ? { ...e, avisoId: Number(r.id) } : null;
  }).filter(Boolean);
}

/** La marca del correo: la del campus si todas son de uno; si no, la de la tutora (como los plazos). */
async function marcaDelAviso(tutorId, entregas) {
  const campus = [...new Set(entregas.map((e) => e.projectId))];
  if (campus.length === 1) {
    const { rows } = await query('SELECT id, nombre, slug, logo_url, emoji FROM projects WHERE id = $1', [campus[0]]);
    const p = rows[0];
    if (p) return { proyecto: { nombre: p.nombre, slug: p.slug, logo_url: p.logo_url, emoji: p.emoji }, projectId: Number(p.id), campus: p.nombre };
  }
  return marcaDelTutor(tutorId);
}

/** El correo: por campus y curso, cada entrega con su alumno, cuándo la entregó y su enlace a Moodle. */
export function cuerpoDelAviso({ tutora, entregas, marca, ahora = new Date() }) {
  const grupos = new Map();
  for (const e of [...entregas].sort((a, b) => a.entregadaAt - b.entregadaAt)) {
    const k = `${e.campus} · ${e.curso || `Curso ${e.cursoId}`}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(e);
  }
  const varios = new Set(entregas.map((e) => e.projectId)).size > 1;
  const bloques = [
    parrafo(`Tienes <strong>${plural(entregas.length, 'entrega', 'entregas')}</strong> de tus alumnos que ${entregas.length === 1 ? 'lleva' : 'llevan'} más de ${HORAS_SIN_CORREGIR} h sin corregir. Cuanto antes tengan la nota, antes siguen con el curso.`),
    boton({ texto: 'Verlas en Mi campus', url: enlace(MI_CAMPUS) }),
  ];
  for (const [titulo, lista] of grupos) {
    bloques.push(seccion(varios ? titulo : titulo.split(' · ').slice(1).join(' · ')));
    bloques.push(parrafo(lista.map((e) => `<strong>${esc(e.alumno || 'Un alumno')}</strong> · ${esc(e.tarea || 'Tarea')}<br>`
      + `Entregada el ${esc(fecha(e.entregadaAt))} (hace ${plural(dias(e.entregadaAt, ahora), 'día', 'días')}) · `
      + `<a href="${esc(e.corregirUrl)}">Abrir en Moodle</a>`).join('<br><br>')));
  }
  bloques.push(nota('Se corrigen en Moodle, desde el enlace de cada una. Cada entrega se avisa una sola vez; si el alumno la vuelve a entregar, cuenta como nueva.'));
  return correo({
    proyecto: marca.proyecto,
    titulo: 'Entregas sin corregir',
    saludo: tutora.nombre || null,
    resumen: `${plural(entregas.length, 'entrega lleva', 'entregas llevan')} más de ${HORAS_SIN_CORREGIR} h sin corregir`,
    bloques,
  });
}

async function avisarATutora(tutora, entregas, { enviar, freno, ahora }) {
  const nuevas = await apuntarNuevas(tutora.id, entregas);
  if (!nuevas.length) return { avisadas: 0, correo: false, frenado: false };
  await notifyUsers({
    targetUserIds: [tutora.id],
    type: 'entregas_sin_corregir',
    title: `${plural(nuevas.length, 'entrega lleva', 'entregas llevan')} más de ${HORAS_SIN_CORREGIR} h sin corregir`,
    message: [...new Set(nuevas.map((e) => e.curso || e.campus))].slice(0, 3).join(' · '),
    link_path: `/${MI_CAMPUS}`,
    // Qué entregas y cursos son: con eso se retira solo cuando ya están corregidas.
    metadata: {
      tutor_id: tutora.id, entregas: nuevas.length,
      claves: nuevas.map(claveDe), cursos: [...new Set(nuevas.map(cursoDe))],
    },
  });
  if (freno) {
    logger.info({ tutorId: tutora.id, entregas: nuevas.length }, 'tutores: aviso de entregas sin corregir sin enviar por correo (freno de correos a tutores)');
    return { avisadas: nuevas.length, correo: false, frenado: true };
  }
  if (!tutora.email) return { avisadas: nuevas.length, correo: false, frenado: false };
  const marca = await marcaDelAviso(tutora.id, nuevas);
  const { htmlContent, textContent } = cuerpoDelAviso({ tutora, entregas: nuevas, marca, ahora });
  const ids = nuevas.map((e) => e.avisoId);
  const r = await enviar({
    to: tutora.email,
    subject: `[${marca.campus || 'CRM'}] ${plural(nuevas.length, 'entrega', 'entregas')} sin corregir desde hace más de ${HORAS_SIN_CORREGIR} h`,
    htmlContent, textContent, tags: ['tutores', 'tutor', 'entregas-sin-corregir'], projectId: marca.projectId,
    clave: `entregas-sin-corregir-${tutora.id}-${Math.min(...ids)}-${Math.max(...ids)}`,
  }).catch((err) => ({ sent: false, error: err.message }));
  const enviado = Boolean(r?.sent);
  if (enviado) await query('UPDATE entregas_sin_corregir_avisos SET por_correo = true WHERE id = ANY($1::int[])', [ids]);
  return { avisadas: nuevas.length, correo: enviado, frenado: false };
}

/**
 * Una vuelta: a cada tutora, sus entregas sin corregir de más de 48 h que aún no se le
 * habían avisado. `tutorIds`: solo esas (null = todas). `freno` y `activo` se pueden
 * pasar para probar; de serie, el freno de correos a tutores y el interruptor del plugin.
 *
 * `recogida` (#769, el aviso a administración): si se pasa `{ entregas: [], fallos: Set }`,
 * se le apuntan TODAS las entregas por corregir que ve cada tutora (con su nombre) y lo que
 * no se ha podido leer (`<campus>` o `<campus>-<curso>`; `*` si no se sabe qué). Así,
 * administración sabe cuáles tienen tutora y no toma por «sin tutora» lo que no se leyó.
 */
export async function avisarEntregasSinCorregir({
  ahora = new Date(), enviar = sendEmail, tutorIds = null,
  freno = NO_ESCRIBIR_A_TUTORES, activo = pluginMoodleActivo(), opciones = {}, recogida = null,
} = {}) {
  const r = { apagado: !activo, tutoras: 0, avisadas: 0, correos: 0, frenados: 0, errores: 0, retirados: 0 };
  if (!activo) return r;
  for (const tutora of await tutorasConCampus(tutorIds)) {
    r.tutoras += 1;
    try {
      let campus;
      try {
        campus = await leerSusCampus(tutora.id, { ...opciones, conProgreso: false, conMensajes: false });
      } catch (err) {
        recogida?.fallos.add('*');
        throw err;
      }
      if (recogida) {
        for (const c of campus) {
          if (c.error) recogida.fallos.add(String(c.projectId));
          for (const k of c.cursos) if (k.error) recogida.fallos.add(`${c.projectId}-${k.id}`);
        }
        recogida.entregas.push(...entregasPorCorregir(campus).map((e) => ({ ...e, tutora: tutora.nombre })));
      }
      // Antes de avisar de lo nuevo, se retira lo que ya está corregido.
      r.retirados += await retirarAtendidos(tutora, campus, ahora);
      const vencidas = entregasVencidas(campus, ahora);
      const hecho = await avisarATutora(tutora, vencidas, { enviar, freno, ahora });
      r.avisadas += hecho.avisadas;
      if (hecho.correo) r.correos += 1;
      if (hecho.frenado) r.frenados += 1;
    } catch (err) {
      r.errores += 1;
      logger.warn({ tutorId: tutora.id, err: err.message }, 'tutores: el aviso de entregas sin corregir ha fallado');
    }
  }
  return r;
}
