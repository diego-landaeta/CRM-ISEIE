import crypto from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import * as leadModel from '../leads/lead.model.js';
import * as model from './feedback.model.js';
import { versionDe } from './cabecera.js';
import { DISPARADORES } from './motivos.js';
import {
  ESCALA, PREGUNTAS, preguntasPara, limpiarRespuestas, textoDeRespuesta, lineaDe, diasHastaVolver,
} from './preguntas.js';

/**
 * «¿Por qué has desistido?» (#169).
 *
 * Sale en DOS casos, y en ninguno más:
 *   · descarte : cuando alguien pasa a «no interesado» a mano o al descartarlo
 *                del repaso de fin de mes.
 *   · dia7     : al 7.º día sin comprar, que es cuando acaba el proceso
 *                comercial (el paso 4 cae entre el día 7 y el 8).
 *
 * UNA VEZ POR PERSONA: lo garantiza la base (feedback_envios.lead_id es único) y
 * además el correo lleva una clave de idempotencia, así que ni un reintento ni
 * un doble clic mandan dos.
 *
 * Fuera de producción el FRENO de correos (email-freno.service) solo deja salir
 * los que van a la lista blanca: en /testeo no se le escribe a nadie real. Esos
 * quedan como «bloqueado», con el motivo, y se cuentan aparte en el panel.
 */

/** A dónde lleva el enlace del correo. /testeo tiene su propia dirección. */
function baseDeLaEncuesta() {
  return (process.env.FEEDBACK_BASE_URL || process.env.CRM_BASE_URL || 'http://localhost:5173/crm')
    .replace(/\/+$/, '');
}

export function enlaceDe(token, { vista = false } = {}) {
  return `${baseDeLaEncuesta()}/feedback/${token}${vista ? '?vista=1' : ''}`;
}

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function primerNombre(nombre) {
  const limpio = String(nombre || '').replace(/\(.*?\)/g, '').trim();
  const uno = limpio.split(/\s+/)[0] || '';
  // «Anónimo» y parecidos: mejor un saludo sin nombre que «Hola Anónimo».
  return /^an[oó]nim/i.test(uno) ? '' : uno;
}

/**
 * El correo. Con la marca de SU campus —logo y color— porque preguntó en esa
 * web y es lo que reconoce. El texto va al grano: una pregunta, un botón, un
 * minuto.
 */
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : null);

/**
 * Texto blanco u oscuro: el que más se lea sobre ese fondo (contraste WCAG).
 * Hace falta porque cada marca trae su color: el rosa de Psiko con letra
 * blanca no se lee, y el azul de ISECD con letra oscura tampoco.
 */
export function tintaSobre(fondo) {
  const m = /^#([0-9a-f]{6})$/i.exec(fondo || '');
  if (!m) return '#1d2530';
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 0,0178 es la luz de #1d2530, el oscuro de la casa.
  return 1.05 / (luz + 0.05) >= (luz + 0.05) / (0.0178 + 0.05) ? '#ffffff' : '#1d2530';
}

export function correoDe(d, token, { vista = false } = {}) {
  // El color de la marca (botón y filete) y el fondo sobre el que va su logo
  // (blanco si no se dijo): los dos se cambian en «Configurar esta marca».
  const color = hex(d.theme_color) || '#1f4e79';
  const fondo = hex(d.color_cabecera) || '#ffffff';
  const nombre = primerNombre(d.nombre || d.lead_nombre);
  const saludo = nombre ? `Hola, ${escapar(nombre)}:` : 'Hola:';
  const programa = d.producto ? `sobre <strong>${escapar(d.producto)}</strong>` : 'sobre nuestro programa';
  const marca = escapar(d.proyecto || '');
  // La cabecera: el LOGO de la marca sobre SU fondo —el de la mayoría es para
  // fondo claro; el de ACADEMIA IA o ISAEG es blanco y va sobre oscuro— con un
  // filete de su color. Va como UNA imagen opaca que dibuja el CRM
  // (`cabecera.js`): en HTML, Gmail le pintaba de negro el fondo transparente
  // al logo de Fono, y el modo oscuro invierte los colores del HTML.
  const cabecera = d.project_id
    ? `<img src="${escapar(`${baseDeLaEncuesta()}/api/f/cabecera/${d.project_id}?v=${versionDe(d)}`)}" width="560" alt="${marca}"
         style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:10px 10px 0 0;background:${fondo}">`
    : `<div style="background:${fondo};border-radius:10px 10px 0 0;padding:18px 24px;border-bottom:4px solid ${color};font-size:18px;font-weight:bold;color:${tintaSobre(fondo)}">${marca}</div>`;
  const aviso = vista
    ? `<div style="background:#fff4d6;border:1px solid #f0c75e;border-radius:6px;padding:10px 12px;margin:0 0 18px;font-size:13px;color:#6b4e00">
         Vista previa: esto es lo que recibirá la persona. Todavía no se le ha enviado.</div>`
    : '';
  const asunto = '¿Por qué has desistido de saber más sobre nuestro programa?';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2530">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    ${cabecera}
    <div style="background:#ffffff;border-radius:0 0 10px 10px;padding:24px 24px 28px">
      ${aviso}
      <p style="font-size:16px;margin:0 0 14px">${saludo}</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px">
        Hace unos días nos pediste información ${programa} y no seguiste adelante.
        Nos ayudaría mucho saber por qué: son dos clics y nos sirve para mejorar.</p>
      <p style="margin:24px 0">
        <a href="${escapar(enlaceDe(token, { vista }))}"
           style="background:${color};color:${tintaSobre(color)};text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">
          Contestar</a></p>
      <p style="font-size:13px;color:#5b6572;margin:0">Gracias por tu tiempo,<br>el equipo de ${marca}</p>
      <p style="font-size:12px;line-height:1.5;color:#8a939e;margin:22px 0 0;border-top:1px solid #e6e9ee;padding-top:14px">
        Este correo es automático: no lo contestes, nadie lo leería. Si el botón no funciona,
        copia este enlace en tu navegador:<br>
        <a href="${escapar(enlaceDe(token, { vista }))}" style="color:#5b6572;word-break:break-all">${escapar(enlaceDe(token, { vista }))}</a></p>
    </div>
  </div></body></html>`;
  return { asunto, html };
}

async function avisarAGestora(envio, { titulo, mensaje }) {
  if (!envio?.gestora_id) return;
  try {
    await notifyUsers({
      targetUserIds: [envio.gestora_id],
      type: 'feedback',
      title: titulo,
      message: mensaje,
      link_path: `/leads/${envio.lead_id}`,
      metadata: { lead_id: envio.lead_id, feedback_id: envio.id },
    });
  } catch (err) {
    logger.warn({ err: err.message, leadId: envio.lead_id }, 'feedback: no se pudo avisar a la gestora');
  }
}

async function apuntarEnSuHistorial(leadId, nota, userId = null) {
  try {
    await leadModel.createInteraction(leadId, 'nota', nota, userId, null);
  } catch (err) {
    logger.warn({ err: err.message, leadId }, 'feedback: no se pudo apuntar en el historial');
  }
}

/**
 * Quién firma el correo: el «no contestar» DEL CAMPUS, por Brevo.
 *
 * La dirección sale de `projects.remitente_no_contestar` (migración 168), que
 * solo sirve si su dominio está autenticado en Brevo. Sin ella, el remitente del
 * CRM, pero con el NOMBRE del campus: lo que la persona ve en su bandeja es
 * «ISEIH · No contestar», que es lo que reconoce.
 */
function remitenteDe(datos) {
  const email = String(datos.remitente_no_contestar || '').trim();
  return {
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
    nombre: `${datos.proyecto || 'Equipo'} · No contestar`,
  };
}

/** Manda el correo de una fila ya creada y deja anotado cómo fue. */
async function mandar(envio, datos) {
  const { asunto, html } = correoDe(datos, envio.token);
  const remitente = remitenteDe(datos);
  const correo = {
    to: { email: envio.email, name: datos.nombre || undefined },
    subject: asunto,
    htmlContent: html,
    tags: ['feedback', envio.disparador],
    projectId: envio.project_id,
    fromEmail: remitente.email,
    fromName: remitente.nombre,
    // Una sola vez por persona, también para Brevo.
    clave: `feedback:${envio.lead_id}`,
  };
  // Por la cuenta de Brevo de la marca si la tiene; si no sale con su
  // remitente, `sendEmail` lo reintenta solo por la del CRM.
  const r = await sendEmail(correo);

  let fila;
  if (r?.sent || r?.reason === 'YA_ENVIADO') {
    fila = await model.marcarEnvio(envio.id, { estado: 'enviado', enviado: true });
    await apuntarEnSuHistorial(envio.lead_id,
      `📨 Correo de feedback enviado («¿por qué has desistido?») · ${DISPARADORES[envio.disparador]}`);
    await avisarAGestora(fila, {
      titulo: 'Correo de feedback enviado',
      mensaje: `A ${datos.nombre || 'un prospecto'}: le preguntamos por qué no siguió (${DISPARADORES[envio.disparador].toLowerCase()}).`,
    });
  } else if (r?.reason === 'FRENO_DE_PRUEBAS') {
    fila = await model.marcarEnvio(envio.id, { estado: 'bloqueado', nota: r.detalle || 'Freno de correos de pruebas' });
  } else {
    fila = await model.marcarEnvio(envio.id, {
      estado: 'fallido', nota: r?.message || r?.reason || 'Brevo no lo aceptó' });
    logger.warn({ leadId: envio.lead_id, r }, 'feedback: el correo no salió');
  }
  return fila;
}

/**
 * Pide el feedback de una persona.
 *
 *   revisar = true  -> «quiero verlo»: NO sale. Se manda una copia de vista
 *                      previa a quien lo pidió y queda esperando en su ficha.
 *
 * Devuelve la fila, o null si ya se le había preguntado (una vez por persona).
 * Nunca lanza por un fallo del correo: lo deja anotado en la fila.
 */
export async function pedirFeedback(leadId, disparador, { userId = null, revisar = false } = {}) {
  if (!DISPARADORES[disparador]) throw new Error(`disparador desconocido: ${disparador}`);
  const datos = await model.datosDelLead(leadId);
  if (!datos || datos.deleted_at || datos.es_prueba) return null;
  if (await model.porLead(leadId)) return null;

  const email = String(datos.email || '').trim() || null;
  const envio = await model.crearEnvio({
    leadId,
    projectId: datos.project_id,
    gestoraId: datos.responsable_id,
    disparador,
    estado: !email ? 'sin_correo' : (revisar ? 'revision' : 'pendiente'),
    token: crypto.randomBytes(24).toString('base64url'),
    email,
    pedidoPor: userId,
  });
  if (!envio) return null; // otro proceso llegó antes: ya tiene la suya
  if (!email) return envio;

  if (revisar) {
    await mandarVistaPrevia(envio, datos, userId);
    return envio;
  }
  return mandar(envio, datos);
}

/** «Quiero verlo»: la copia va a quien lo pidió, con aviso de que es una vista previa. */
async function mandarVistaPrevia(envio, datos, userId) {
  const { rows } = await query('SELECT email, nombre FROM users WHERE id = $1', [userId]);
  const quien = rows[0];
  if (!quien?.email) return;
  const { asunto, html } = correoDe(datos, envio.token, { vista: true });
  await sendEmail({
    to: { email: quien.email, name: quien.nombre },
    subject: `[Vista previa] ${asunto}`,
    htmlContent: html,
    fromName: remitenteDe(datos).nombre,
    tags: ['feedback', 'vista-previa'],
    projectId: envio.project_id,
  }).catch((err) => logger.warn({ err: err.message }, 'feedback: no salió la vista previa'));
  await apuntarEnSuHistorial(envio.lead_id,
    `👀 Correo de feedback preparado, sin enviar: ${quien.nombre || 'alguien'} pidió verlo antes`, userId);
}

/** El que estaba esperando revisión: ahora sí sale. */
export async function enviarLoRevisado(leadId, userId) {
  const envio = await model.porLead(leadId);
  if (!envio) throw new AppError('Este prospecto no tiene correo de feedback preparado', 404, 'NOT_FOUND');
  if (envio.estado !== 'revision') {
    throw new AppError('Este correo ya no está pendiente de revisar', 409, 'NO_PENDIENTE');
  }
  const datos = await model.datosDelLead(leadId);
  return mandar(envio, datos);
}

/** El que estaba esperando revisión: se decide no mandarlo. Queda anotado. */
export async function noEnviar(leadId, userId) {
  const envio = await model.porLead(leadId);
  if (!envio || envio.estado !== 'revision') {
    throw new AppError('Este correo ya no está pendiente de revisar', 409, 'NO_PENDIENTE');
  }
  const fila = await model.marcarEnvio(envio.id, { estado: 'cancelado', nota: `Descartado por el usuario ${userId}` });
  await apuntarEnSuHistorial(leadId, '🚫 Correo de feedback preparado y NO enviado', userId);
  return fila;
}

export async function deUnLead(leadId) {
  return model.porLead(leadId);
}

/** La encuesta pública: lo justo para pintarla, sin datos de nadie más. */
export async function encuesta(token) {
  const f = await model.porToken(token);
  if (!f) throw new AppError('Este enlace no es válido', 404, 'NOT_FOUND');
  return {
    marca: f.proyecto,
    logo_url: f.logo_url,
    color: f.theme_color,
    // Sobre qué va su logo (vacío = blanco), como en el correo.
    fondo: f.color_cabecera,
    nombre: primerNombre(f.lead_nombre),
    programa: f.producto,
    // Con SU formacion y SU asesor: «¿Cómo te atendió el asesor?» / «El asesor: Ana».
    // «El asesor: …» con su nombre PÚBLICO, el del widget de WhatsApp: el que conoce la persona.
    preguntas: preguntasPara({ programa: f.producto, asesor: f.asesor_publico || null }),
    respondida: Boolean(f.respondido_at),
  };
}

/**
 * Lo que contesta. Queda en SU ficha —la gestora que le llame mañana tiene que
 * ver «me pareció caro» sin ir a buscarlo— y a la gestora le llega un aviso.
 */
export async function responder(token, { motivo, comentario, respuestas = {} } = {}) {
  // La encuesta de antes mandaba solo motivo y comentario: se aceptan igual
  // (el comentario es lo que escribió en «Otro motivo»).
  const r = limpiarRespuestas({
    ...respuestas,
    motivo: respuestas.motivo ?? motivo,
    motivo_otro: respuestas.motivo_otro ?? comentario,
  });
  if (!r.motivo) throw new AppError('Dinos por qué no seguiste: es la única obligatoria', 400, 'VALIDATION_ERROR');
  const f = await model.porToken(token);
  if (!f) throw new AppError('Este enlace no es válido', 404, 'NOT_FOUND');
  if (f.respondido_at) return { ya: true };
  const fila = await model.guardarRespuesta(f.id, { motivo: r.motivo, comentario: r.motivo_otro || null, respuestas: r });
  if (!fila) return { ya: true };
  // En su historial, TODO lo que contestó, pregunta a pregunta y tal como se
  // lo preguntamos: la gestora que le llame mañana lo tiene que ver sin ir a buscarlo.
  const textos = preguntasPara({ programa: f.producto });
  const lineas = textos
    .filter((p) => r[p.clave] !== undefined)
    .map((p) => `· ${p.texto} ${lineaDe(p, r)}`);
  await apuntarEnSuHistorial(f.lead_id, `💬 Contestó al feedback:\n${lineas.join('\n')}`);
  const nota = r.nota_atencion ? ` · te puso un ${r.nota_atencion}/5` : '';
  // «Que me contacte más adelante»: a la agenda de su gestora, el día que eligió.
  let volver = '';
  if (r.avisar === 'si') {
    const avisar = PREGUNTAS.find((p) => p.clave === 'avisar');
    const cuando = avisar.sub.opciones.find((o) => o.clave === r.avisar_cuando)?.texto.toLowerCase() || 'sin decir cuándo';
    const rec = await model.agendarVuelta(f.lead_id, {
      dias: diasHastaVolver(r),
      nota: `📅 Volver a contactar: lo pidió en la encuesta de feedback (${cuando}). No siguió por: ${textoDeRespuesta('motivo', r.motivo, r.motivo_otro)}`,
      gestoraDelEnvio: f.gestora_id,
    }).catch((err) => {
      logger.warn({ err: err.message, leadId: f.lead_id }, 'feedback: no se pudo agendar la vuelta');
      return null;
    });
    await apuntarEnSuHistorial(f.lead_id, rec
      ? `📅 Pidió que le volvamos a contactar (${cuando}): recordatorio puesto para el ${rec.dia}.`
      : `📅 Pidió que le volvamos a contactar (${cuando}), pero no tiene gestora: no se ha podido agendar.`);
    volver = rec
      ? ` · quiere que le vuelvas a contactar: lo tienes en recordatorios para el ${rec.dia}`
      : ' · quiere que le vuelvan a contactar';
  }
  await avisarAGestora(fila, {
    titulo: 'Te han contestado al feedback',
    mensaje: `${f.lead_nombre || 'Un prospecto'}: ${textoDeRespuesta('motivo', r.motivo, r.motivo_otro)}${nota}${volver}`,
  });
  return { ya: false };
}

/**
 * El resumen de cada pregunta para el panel: cuántos eligieron cada opción, la
 * nota media de la escala y lo que escribieron en «Otro» (lo último primero).
 */
export function resumenDePreguntas(contestadas) {
  const textos = preguntasPara();
  return PREGUNTAS.map((p, i) => {
    const valores = contestadas
      .map((c) => ({ v: (c.respuestas || {})[p.clave], c }))
      .filter((x) => x.v !== undefined);
    const base = { clave: p.clave, tipo: p.tipo, texto: textos[i].texto, respondieron: valores.length };
    const escritos = p.escribir
      ? contestadas
        .filter((c) => (c.respuestas || {})[`${p.clave}_otro`])
        .slice(0, 40)
        .map((c) => ({
          texto: c.respuestas[`${p.clave}_otro`], lead_id: c.lead_id, lead_nombre: c.lead_nombre,
          gestora: c.gestora, fecha: c.respondido_at,
        }))
      : undefined;
    if (p.tipo === 'escala') {
      const opciones = ESCALA.map((o) => ({
        clave: o.clave, texto: o.texto, n: valores.filter((x) => String(x.v) === o.clave).length,
      }));
      const media = valores.length
        ? Math.round((valores.reduce((s, x) => s + Number(x.v), 0) / valores.length) * 10) / 10
        : null;
      return { ...base, opciones, media };
    }
    const opciones = p.opciones.map((o) => ({
      clave: o.clave,
      texto: o.texto,
      n: valores.filter((x) => (Array.isArray(x.v) ? x.v.includes(o.clave) : x.v === o.clave)).length,
    }));
    const resumen = { ...base, opciones, ...(escritos ? { escritos } : {}) };
    if (!p.sub) return [resumen];
    // La de después («¿cuándo?»), justo detrás, contada sobre los que dijeron que sí.
    const deLaSub = contestadas.map((c) => (c.respuestas || {})[p.sub.clave]).filter(Boolean);
    return [resumen, {
      clave: p.sub.clave, tipo: 'unica', texto: `${p.sub.texto} (los que dijeron que sí)`, respondieron: deLaSub.length,
      opciones: p.sub.opciones.map((o) => ({ clave: o.clave, texto: o.texto, n: deLaSub.filter((v) => v === o.clave).length })),
    }];
  }).flat();
}

/** El proceso del 7.º día: una vuelta. Devuelve cuántos se pidieron. */
/**
 * El 7.º día, en TANDAS (Diego, 28/09: «máximo 200 correos diarios, así que
 * irán en pilas para que se vayan enviando»). Cada vuelta manda como mucho
 * `pila`, y entre todas no se pasa de `tope` al día —contando también los de
 * descarte, que salen por la misma cuenta de Brevo—.
 */
export async function vueltaDelDia7({ pila = 25, tope = 200, maxDias = 30 } = {}) {
  const hoy = await model.correosDeHoy();
  const hueco = Math.max(0, Math.min(pila, tope - hoy));
  if (!hueco) return { candidatos: 0, pedidos: 0, hoy, tope };
  const ids = await model.candidatosDelDia7({ tope: hueco, maxDias });
  let pedidos = 0;
  for (const id of ids) {
    try {
      if (await pedirFeedback(id, 'dia7')) pedidos += 1;
    } catch (err) {
      logger.warn({ err: err.message, leadId: id }, 'feedback: fallo pidiéndolo al 7.º día');
    }
  }
  return { candidatos: ids.length, pedidos, hoy: hoy + pedidos, tope };
}

export { model };
