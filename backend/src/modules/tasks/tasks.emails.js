// Los correos del tablero de tareas (#210, fase 3 y entrega final), con la plantilla común del
// CRM: la misma cabecera, el mismo botón y el pie para apagarlo en «Mis
// preferencias». Cada uno lleva su clave de idempotencia: un reintento o un
// reinicio no lo manda dos veces.
import { sendEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import {
  correo, parrafo, boton, nota, seccion, esc, enlace, T,
} from '../../shared/services/email-plantilla.service.js';

// Los nombres con los que se apagan en «Mis preferencias» (avisos_apagados).
export const AVISO_TAREA_ASIGNADA = 'tarea_asignada';
export const AVISO_TAREAS_DEL_DIA = 'tareas_del_dia';
export const AVISO_TAREA_DEVUELTA = 'tarea_devuelta';
export const AVISO_TAREA_CERRADA = 'tarea_cerrada';
export const AVISO_TAREA_COMENTARIO = 'tarea_comentario';
// El supervisor de una tarea (26/10/2026): al ponerlo y cuando está para revisar.
export const AVISO_TAREA_SUPERVISOR = 'tarea_supervisor';
// Diego, 26/10/2026: «uno para cuando cambian el status, y todos los días de lunes a
// viernes su resumen de lo que hizo y lo que falta».
export const AVISO_TAREA_ESTADO = 'tarea_estado';
export const AVISO_TAREAS_RESUMEN = 'tareas_resumen';

const ESTADOS = {
  por_hacer: 'Por hacer', en_curso: 'En curso', en_revision: 'En revisión', hecha: 'Hecha',
};
const PRIORIDADES = { baja: 'Baja', media: 'Media', alta: 'Alta' };

// La marca del CRM para lo que no tiene campus (una tarea de un proyecto propio,
// o el correo de cada mañana): la de ISEIE, como el resto de correos de este CRM
// (brevo.service.js, MARCA_CORREOS). En MultiCRM va sin marca y sale «CRM».
const MARCA_CRM = { nombre: 'ISEIE', slug: 'iseie' };

const tz = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

// El equipo en el asunto (26/10/2026): «Tarea asignada · Desarrollo y SEO: …».
const conEquipo = (prefijo, tarea) => (tarea.team_name ? `${prefijo} · ${tarea.team_name}` : prefijo);
const lineaEquipo = (tarea) => (tarea.team_name
  ? `Equipo: <strong>${esc(tarea.team_name)}</strong>${tarea.assigned_cargo ? ` · ${esc(tarea.assigned_cargo)}` : ''}` : null);
// El momento del último cambio de la tarea, para las claves de idempotencia.
const momento = (tarea) => new Date(tarea.updated_at || tarea.created_at || Date.now()).getTime();
const fechaCorta = (d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: tz() });

/**
 * El interruptor de los correos de tareas (TAREAS_CORREOS_ACTIVOS, en el .env).
 * Apagado por defecto: lo enciende Diego en producción cuando lo decida.
 */
export const correosActivos = () => {
  const v = String(process.env.TAREAS_CORREOS_ACTIVOS || '').toLowerCase();
  return v === 'true' || v === '1';
};

/**
 * Todos los correos de tareas salen por aquí. Apagado, el correo se arma
 * entero y se registra (para y asunto), pero no se llama a Brevo.
 */
export async function despacharCorreo({ to, subject, htmlContent, textContent, tags, clave, marca = null }) {
  if (!correosActivos()) {
    logger.info({ to: to[0]?.email, subject, clave }, 'Correo de tareas registrado sin enviar (TAREAS_CORREOS_ACTIVOS apagado)');
    return { sent: false, simulated: true };
  }
  return sendEmail({
    to,
    subject,
    htmlContent,
    textContent,
    tags,
    clave,
    // Con la marca del campus de la tarea (Diego, 12/10: «no responder ISEIH, desde el
    // branding»): sale por su cuenta de Brevo y su «no responder» si los tiene, y con su
    // nombre de remitente. Sin campus, el del CRM.
    projectId: marca?.id ?? null,
    fromName: marca?.nombre ?? undefined,
  });
}

/**
 * La marca del campus de una tarea: logo y nombre para la cabecera, y el proyecto por el
 * que sale el correo. Una tarea sin campus (o de un proyecto propio) va con la del CRM.
 */
export async function marcaDeTarea(tarea) {
  if (!tarea?.project_id) return null;
  try {
    const { rows: [p] } = await query(
      'SELECT id, nombre, slug, logo_url, emoji FROM projects WHERE id = $1', [tarea.project_id]);
    return p || null;
  } catch (err) {
    logger.warn({ err: err.message, taskId: tarea.id }, 'Correo de tareas: no se pudo leer la marca del campus');
    return null;
  }
}

/** El correo «te han asignado una tarea». */
export function armarCorreoAsignada({ persona, tarea, quien, marca = null, reasignada = false }) {
  const datos = [
    lineaEquipo(tarea),
    `Prioridad: <strong>${esc(PRIORIDADES[tarea.priority] || tarea.priority)}</strong>`,
    tarea.due_date ? `Fecha límite: <strong>${esc(fechaCorta(tarea.due_date))}</strong>` : null,
    tarea.project_name ? `Proyecto: <strong>${esc(tarea.project_name)}</strong>` : null,
    tarea.external_project_name ? `Proyecto propio: <strong>${esc(tarea.external_project_name)}</strong>` : null,
    tarea.area_name ? `Área: <strong>${esc(tarea.area_name)}</strong>` : null,
  ].filter(Boolean).join('<br>');

  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo: 'Tienes una tarea nueva',
    saludo: persona.nombre,
    resumen: `${quien?.nombre || 'Alguien'} te ha ${reasignada ? 'reasignado' : 'asignado'} «${tarea.title}»`,
    bloques: [
      parrafo(`${esc(quien?.nombre || 'Alguien del equipo')} te ha ${reasignada ? 'reasignado' : 'asignado'} esta tarea en el tablero:`),
      nota(`<strong>${esc(tarea.title)}</strong><br>${datos}`),
      boton({ texto: 'Abrir la tarea', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque te han asignado una tarea.' },
  });
  return { asunto: `${conEquipo('Tarea asignada', tarea)}: ${tarea.title}`, htmlContent, textContent };
}

export async function enviarCorreoAsignada({ persona, tarea, quien, reasignada = false }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoAsignada({ persona, tarea, quien, marca, reasignada });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-asignada'],
    // Con el momento del cambio (26/10/2026: «cada vez que te llegue una tarea»): si se
    // la quitan y se la vuelven a dar, vuelve a llegar. Un reintento del mismo cambio, no.
    clave: `${AVISO_TAREA_ASIGNADA}-${tarea.id}-${persona.id}-${momento(tarea)}`,
  });
}

/** Los datos de la tarea, en la nota del correo: quién la lleva, prioridad, fecha y proyecto. */
function datosDeLaTarea(tarea) {
  return [
    lineaEquipo(tarea),
    tarea.assigned_to_name ? `La lleva: <strong>${esc(tarea.assigned_to_name)}</strong>` : null,
    `Prioridad: <strong>${esc(PRIORIDADES[tarea.priority] || tarea.priority)}</strong>`,
    tarea.due_date ? `Fecha límite: <strong>${esc(fechaCorta(tarea.due_date))}</strong>` : null,
    tarea.project_name ? `Proyecto: <strong>${esc(tarea.project_name)}</strong>` : null,
    tarea.external_project_name ? `Proyecto propio: <strong>${esc(tarea.external_project_name)}</strong>` : null,
  ].filter(Boolean).join('<br>');
}

/**
 * El correo «te han puesto de supervisor» (Diego, 26/10/2026: «si Julián pone
 * una tarea a Diana y la supervisa Ángel, se puede, y eso debe llegar por correo»).
 */
export function armarCorreoSupervisor({ persona, tarea, quien, marca = null }) {
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo: 'Supervisas una tarea',
    saludo: persona.nombre,
    resumen: `${quien?.nombre || 'Alguien'} te ha puesto de supervisor de «${tarea.title}»`,
    bloques: [
      parrafo(`${esc(quien?.nombre || 'Alguien del equipo')} te ha puesto de <strong>supervisor</strong> de esta tarea. Te avisaremos cuando esté lista para revisar, y podrás aprobarla o devolverla:`),
      nota(`<strong>${esc(tarea.title)}</strong><br>${datosDeLaTarea(tarea)}`),
      boton({ texto: 'Abrir la tarea', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque te han puesto de supervisor de una tarea.' },
  });
  return { asunto: `${conEquipo('Supervisas', tarea)}: ${tarea.title}`, htmlContent, textContent };
}

export async function enviarCorreoSupervisor({ persona, tarea, quien }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoSupervisor({ persona, tarea, quien, marca });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-supervisor'],
    clave: `${AVISO_TAREA_SUPERVISOR}-${tarea.id}-${persona.id}-${momento(tarea)}`,
  });
}

/** Al supervisor: la tarea que supervisa está «En revisión». */
export function armarCorreoParaRevisar({ persona, tarea, quien, marca = null }) {
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo: 'Una tarea que supervisas está para revisar',
    saludo: persona.nombre,
    resumen: `«${tarea.title}» está en «En revisión»`,
    bloques: [
      parrafo(`${esc(quien?.nombre || 'Alguien del equipo')} ha pasado a <strong>En revisión</strong> una tarea que supervisas. Ábrela para aprobarla o devolverla con lo que falte:`),
      nota(`<strong>${esc(tarea.title)}</strong><br>${datosDeLaTarea(tarea)}`),
      boton({ texto: 'Revisar la tarea', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque supervisas esta tarea.' },
  });
  return { asunto: `${conEquipo('Para revisar', tarea)}: ${tarea.title}`, htmlContent, textContent };
}

export async function enviarCorreoParaRevisar({ persona, tarea, quien }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoParaRevisar({ persona, tarea, quien, marca });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-para-revisar'],
    // Cada vez que vuelve a «En revisión», otro aviso.
    clave: `${AVISO_TAREA_SUPERVISOR}-revisar-${tarea.id}-${persona.id}-${Date.now()}`,
  });
}

/** El correo «tarea devuelta para corrección». */
export function armarCorreoDevuelta({ persona, tarea, quien, comentario, marca = null }) {
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo: 'Tarea devuelta para corrección',
    saludo: persona.nombre,
    resumen: `${quien?.nombre || 'Administración'} ha devuelto la tarea «${tarea.title}»`,
    bloques: [
      parrafo(`${esc(quien?.nombre || 'Administración')} ha revisado tu tarea y la ha devuelto a <strong>En curso</strong> con las siguientes indicaciones:`),
      nota(`<strong>Motivo / Qué falta:</strong><br>${esc(comentario)}`),
      boton({ texto: 'Abrir la tarea en el tablero', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque una de tus tareas en revisión fue devuelta.' },
  });
  return { asunto: `Tarea devuelta: ${tarea.title}`, htmlContent, textContent };
}

export async function enviarCorreoDevuelta({ persona, tarea, quien, comentario }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoDevuelta({ persona, tarea, quien, comentario, marca });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-devuelta'],
    clave: `${AVISO_TAREA_DEVUELTA}-${tarea.id}-${Date.now()}`,
  });
}

/** El correo «tarea aprobada / cerrada». */
export function armarCorreoCerrada({ persona, tarea, quien, marca = null }) {
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo: 'Tarea aprobada y cerrada',
    saludo: persona.nombre,
    resumen: `${quien?.nombre || 'Administración'} ha marcado «${tarea.title}» como Hecha`,
    bloques: [
      parrafo(`${esc(quien?.nombre || 'Administración')} ha revisado y aprobado tu tarea. Ya está en «Hecha»:`),
      nota(`<strong>${esc(tarea.title)}</strong>`),
      boton({ texto: 'Ver tarea', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque una de tus tareas fue aprobada.' },
  });
  return { asunto: `Tarea completada: ${tarea.title}`, htmlContent, textContent };
}

export async function enviarCorreoCerrada({ persona, tarea, quien }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoCerrada({ persona, tarea, quien, marca });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-cerrada'],
    // Con la fecha de cierre: si se reabre y se vuelve a cerrar, avisa otra vez.
    clave: `${AVISO_TAREA_CERRADA}-${tarea.id}-${persona.id}-${new Date(tarea.completed_at || Date.now()).getTime()}`,
  });
}

/** El correo «nuevo comentario en tu tarea». */
export function armarCorreoComentario({ persona, tarea, quien, comentario, marca = null }) {
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo: 'Nuevo comentario en tu tarea',
    saludo: persona.nombre,
    resumen: `${quien?.nombre || 'Un compañero'} comentó en «${tarea.title}»`,
    bloques: [
      parrafo(`${esc(quien?.nombre || 'Alguien del equipo')} ha añadido un comentario en la tarea <strong>${esc(tarea.title)}</strong>:`),
      nota(esc(comentario)),
      boton({ texto: 'Responder en el CRM', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque alguien ha comentado en una tarea tuya.' },
  });
  return { asunto: `Comentario en: ${tarea.title}`, htmlContent, textContent };
}

export async function enviarCorreoComentario({ persona, tarea, quien, comentario, commentId }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoComentario({ persona, tarea, quien, comentario, marca });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-comentario'],
    clave: `${AVISO_TAREA_COMENTARIO}-${tarea.id}-${commentId}`,
  });
}

/** El correo de cada mañana: lo que vence hoy y lo vencido. */
export function armarCorreoDelDia({ persona, tareas, hoy = new Date() }) {
  // «Hoy» y «vencida» con el día de la oficina, no con el del servidor (UTC).
  const dia = (d) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(d));
  const hoyDia = dia(hoy);
  const vencidas = tareas.filter((t) => dia(t.due_date) < hoyDia);
  const deHoy = tareas.filter((t) => dia(t.due_date) >= hoyDia);

  const linea = (t) => `<li style="margin:0 0 6px"><a href="${esc(enlace(`tareas?id=${t.id}`))}">${esc(t.title)}</a>`
    + ` · ${esc(ESTADOS[t.status] || t.status)}`
    + ` · vence el ${esc(fechaCorta(t.due_date))}</li>`;
  const lista = (ts) => parrafo(`<ul style="padding-left:18px;margin:0">${ts.map(linea).join('')}</ul>`);

  const { htmlContent, textContent } = correo({
    proyecto: MARCA_CRM,
    titulo: 'Tus tareas de hoy',
    saludo: persona.nombre,
    resumen: `${deHoy.length} para hoy y ${vencidas.length} ${vencidas.length === 1 ? 'vencida' : 'vencidas'}`,
    bloques: [
      deHoy.length ? seccion(`Vencen hoy (${deHoy.length})`) : null,
      deHoy.length ? lista(deHoy) : null,
      vencidas.length ? seccion(`Vencidas (${vencidas.length})`) : null,
      vencidas.length ? lista(vencidas) : null,
      boton({ texto: 'Ir a mi tablero', url: enlace('tareas') }),
    ],
    apagar: { texto: 'Recibes este resumen porque tienes tareas para hoy o vencidas.' },
  });

  const n = (k, uno, varios) => `${k} ${k === 1 ? uno : varios}`;
  const asunto = vencidas.length
    ? `Tus tareas de hoy: ${deHoy.length} para hoy, ${n(vencidas.length, 'vencida', 'vencidas')}`
    : `Tus tareas de hoy: ${deHoy.length}`;
  return { asunto, htmlContent, textContent };
}

/* --- Cambio de estado y resumen del día (Diego, 26/10/2026) --- */

const ROL_EN_LA_TAREA = {
  responsable: 'una tarea que llevas',
  supervisor: 'una tarea que supervisas',
  creador: 'una tarea que creaste',
};

/**
 * El correo «tu tarea ha cambiado de estado». Va al responsable, al supervisor y a
 * quien la creó, nunca a quien hizo el cambio; si en un par de minutos se movió
 * varias veces, sale uno solo con el estado de antes de la ráfaga y el de ahora
 * (`tasks.avisos-estado.js`). `de` y `a` llegan ya con el nombre de la columna.
 */
export function armarCorreoCambioEstado({
  persona, tarea, de, a, quien, comentario = null, accion = null, rol = null, cambios = 1, marca = null,
}) {
  const quienNombre = quien?.nombre || 'Alguien del equipo';
  const queTarea = ROL_EN_LA_TAREA[rol] || 'una tarea';
  let queHizo = `ha cambiado de estado ${queTarea}`;
  let titulo = 'Cambio de estado';
  if (accion === 'devuelta') { queHizo = `ha <strong>devuelto</strong> ${queTarea}`; titulo = 'Tarea devuelta'; }
  if (accion === 'aprobada') { queHizo = `ha <strong>aprobado</strong> ${queTarea}`; titulo = 'Tarea aprobada'; }

  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_CRM,
    titulo,
    saludo: persona.nombre,
    resumen: `«${tarea.title}»: ${de} → ${a}, por ${quienNombre}`,
    bloques: [
      parrafo(`${esc(quienNombre)} ${queHizo}:`),
      nota([
        `<strong>${esc(tarea.title)}</strong>`,
        lineaEquipo(tarea),
        `Estado: <strong>${esc(de)}</strong> &rarr; <strong>${esc(a)}</strong>${accion ? ` (${esc(accion)})` : ''}`,
        `Lo cambió: <strong>${esc(quienNombre)}</strong>`,
        cambios > 1 ? `Se movió ${cambios} veces en un par de minutos: este es el último estado.` : null,
      ].filter(Boolean).join('<br>')),
      comentario ? seccion('Comentario') : null,
      comentario ? nota(esc(comentario)) : null,
      boton({ texto: 'Abrir la tarea', url: enlace(`tareas?id=${tarea.id}`) }),
    ],
    apagar: { texto: 'Recibes este aviso porque llevas, supervisas o creaste esta tarea.' },
  });
  return {
    asunto: `${conEquipo('Cambio de estado', tarea)}: ${tarea.title} (${de} → ${a})`,
    htmlContent,
    textContent,
  };
}

export async function enviarCorreoCambioEstado({ persona, tarea, clave, ...resto }) {
  const marca = await marcaDeTarea(tarea);
  const c = armarCorreoCambioEstado({ persona, tarea, marca, ...resto });
  return despacharCorreo({
    marca,
    to: [{ email: persona.email, name: persona.nombre }],
    subject: c.asunto,
    htmlContent: c.htmlContent,
    textContent: c.textContent,
    tags: ['tareas', 'tarea-estado'],
    clave: clave || `${AVISO_TAREA_ESTADO}-${tarea.id}-${persona.id}-${Date.now()}`,
  });
}

/**
 * El resumen de cada tarde, de lunes a viernes: lo que hizo hoy y lo que le
 * falta. `datos` sale de `findResumenDelDia` (tasks.model.js):
 *
 *   · hizo:  { cerradas[], movidas[] (con de y a), comentarios[] (con n), creadas[] }
 *   · falta: { vencidas[], hoy[], manana[], revisar[], porEstado[] ({ estado, tareas[] }), abiertas }
 *
 * Las vencidas, primero y en rojo. `columnas` traduce la clave del estado al
 * nombre de su columna en el tablero.
 */
export function armarCorreoResumen({ persona, datos, dia, zona = 'America/Caracas', columnas = {} }) {
  const nombreEstado = (k) => columnas[k] || ESTADOS[k] || k;
  const fecha = (d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: zona });
  const rojo = T.destructivo;
  const li = (html, enRojo = false) => `<li style="margin:0 0 6px${enRojo ? `;color:${rojo}` : ''}">${html}</li>`;
  const ul = (items) => parrafo(`<ul style="padding-left:18px;margin:0">${items.join('')}</ul>`);
  const tit = (t, enRojo = false) => `<a href="${esc(enlace(`tareas?id=${t.id}`))}"${enRojo ? ` style="color:${rojo}"` : ''}>${esc(t.title)}</a>`;
  const vence = (t) => (t.due_date ? ` · vence el ${esc(fecha(t.due_date))}` : '');
  const fuerte = (texto, enRojo = false) => parrafo(`<strong${enRojo ? ` style="color:${rojo}"` : ''}>${esc(texto)}</strong>`);
  const { hizo, falta } = datos;

  const nHizo = hizo.cerradas.length + hizo.movidas.length + hizo.comentarios.length + hizo.creadas.length;
  const hoyLista = falta.hoy || [];
  const nAbiertas = falta.abiertas ?? (falta.vencidas.length + hoyLista.length + falta.manana.length
    + falta.porEstado.reduce((s, g) => s + g.tareas.length, 0));

  const bloquesHizo = [seccion('Lo que hiciste hoy')];
  if (!nHizo) bloquesHizo.push(parrafo('Hoy no hay movimientos tuyos en el tablero.'));
  if (hizo.cerradas.length) {
    bloquesHizo.push(fuerte(`Cerraste (${hizo.cerradas.length})`), ul(hizo.cerradas.map((t) => li(tit(t)))));
  }
  if (hizo.movidas.length) {
    bloquesHizo.push(fuerte(`Cambiaste de estado (${hizo.movidas.length})`),
      ul(hizo.movidas.map((t) => li(`${tit(t)} · ${esc(nombreEstado(t.de))} &rarr; ${esc(nombreEstado(t.a))}`))));
  }
  if (hizo.comentarios.length) {
    bloquesHizo.push(fuerte(`Comentaste en (${hizo.comentarios.length})`),
      ul(hizo.comentarios.map((t) => li(`${tit(t)}${t.n > 1 ? ` · ${t.n} comentarios` : ''}`))));
  }
  if (hizo.creadas.length) {
    bloquesHizo.push(fuerte(`Creaste (${hizo.creadas.length})`),
      ul(hizo.creadas.map((t) => li(`${tit(t)}${t.assigned_to_name ? ` · para ${esc(t.assigned_to_name)}` : ''}`))));
  }

  const bloquesFalta = [seccion('Lo que falta')];
  if (falta.vencidas.length) {
    bloquesFalta.push(fuerte(`Vencidas (${falta.vencidas.length})`, true),
      ul(falta.vencidas.map((t) => li(`${tit(t, true)} · ${esc(nombreEstado(t.status))} · venció el ${esc(fecha(t.due_date))}`, true))));
  }
  if (hoyLista.length) {
    bloquesFalta.push(fuerte(`Vencen hoy (${hoyLista.length})`),
      ul(hoyLista.map((t) => li(`${tit(t)} · ${esc(nombreEstado(t.status))}`))));
  }
  if (falta.manana.length) {
    bloquesFalta.push(fuerte(`Vencen mañana (${falta.manana.length})`),
      ul(falta.manana.map((t) => li(`${tit(t)} · ${esc(nombreEstado(t.status))}`))));
  }
  if (falta.revisar.length) {
    bloquesFalta.push(fuerte(`Esperan tu revisión (${falta.revisar.length})`),
      ul(falta.revisar.map((t) => li(`${tit(t)}${t.assigned_to_name ? ` · la lleva ${esc(t.assigned_to_name)}` : ''}${vence(t)}`))));
  }
  // El resto de sus abiertas, por estado (las de arriba ya salieron con su plazo).
  const conPlazo = falta.vencidas.length + hoyLista.length + falta.manana.length;
  for (const g of falta.porEstado) {
    bloquesFalta.push(fuerte(`${conPlazo ? 'Resto en ' : ''}${nombreEstado(g.estado)} (${g.tareas.length})`),
      ul(g.tareas.map((t) => li(`${tit(t)}${vence(t)}`))));
  }
  if (!nAbiertas && !falta.revisar.length) bloquesFalta.push(parrafo('No tienes tareas abiertas.'));

  const partes = [`${nAbiertas} ${nAbiertas === 1 ? 'abierta' : 'abiertas'}`];
  if (falta.vencidas.length) partes.push(`${falta.vencidas.length} ${falta.vencidas.length === 1 ? 'vencida' : 'vencidas'}`);
  if (falta.revisar.length) partes.push(`${falta.revisar.length} por revisar`);

  const { htmlContent, textContent } = correo({
    proyecto: MARCA_CRM,
    titulo: 'Tu resumen del día en el tablero',
    saludo: persona.nombre,
    resumen: `Hoy: ${nHizo} ${nHizo === 1 ? 'movimiento' : 'movimientos'} · Te quedan ${partes.join(', ')}`,
    bloques: [...bloquesHizo, ...bloquesFalta, boton({ texto: 'Ir a mi tablero', url: enlace('tareas') })],
    apagar: { texto: 'Recibes este resumen de lunes a viernes porque tienes tareas en el tablero.' },
  });

  const [y, m, d] = String(dia).split('-').map(Number);
  const diaTexto = new Date(Date.UTC(y, m - 1, d, 12))
    .toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return { asunto: `Tu resumen de tareas del ${diaTexto}: ${partes.join(', ')}`, htmlContent, textContent };
}
