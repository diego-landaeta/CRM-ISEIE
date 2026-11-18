import crypto from 'node:crypto';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as cfg from './diploma-confirmacion.config.js';
import * as model from './diploma-confirmacion.model.js';
import { armarPeticion, diaTexto, documentoTapado, urlDeLaPagina } from './diploma-confirmacion.emails.js';
import { LISTOS } from './diploma-confirmacion.puerta.js';
import { certifex, recorrer } from '../certifex/certifex.cliente.js';
import { alcanceDe, exigirMatriculas } from '../certifex/certifex.alcance.js';
import { programasPara, datosDeCandidato, proyectosDeCentro } from '../certifex/certifex.programa.js';
import * as certifexModel from '../certifex/certifex.model.js';
import { normalizarNombreDiploma, dniDiploma } from '../certifex/certifex.validation.js';

/*
  CONFIRMACIÓN DE DATOS DEL DIPLOMA (#768, gemela CRM-ISEIE#456).

  Lo que pide la issue: antes de emitir, el alumno recibe los datos que saldrán
  en su diploma (nombre completo, documento, curso, horas y fecha) con un enlace
  para confirmarlos o corregirlos. Al confirmar, se emite; a los 7 días sin
  respuesta, también, con lo que hay. Y queda guardado con qué datos salió.

  LO QUE HACE ESTO (lo que no depende de decisiones pendientes):
    · Pedir la confirmación de una o varias matrículas (desde el CRM, con
      `diplomas.emit` y en sus campus) → fila + enlace + correo (simulado si
      DIPLOMA_CONFIRMACION_ENVIAR_CORREO no está encendido).
    · La página pública: confirmar o corregir nombre y documento. Lo corregido
      se pasa a Certifex, que es quien imprime.
    · El plazo: a los 7 días la confirmación vence y el diploma ya puede salir.
    · La puerta: con el interruptor encendido en un campus, `prepararEmision` no
      emite sin confirmación (diploma-confirmacion.puerta.js).
    · El registro: con qué datos salió cada diploma y cuándo se envió.

  LO QUE NO HACE TODAVÍA (espera decisión o material; ver `alConfirmar`):
    · Emitir solo al confirmar o al vencer. Hoy el diploma lo sigue emitiendo una
      persona en Diplomas; esto solo le dice que ya puede.
    · Pedir la confirmación sola cuando Moodle avisa de que el alumno terminó.

  EL ENLACE. Aleatorio (24 bytes) y firmado con la clave del servidor; en la
  base solo su sha256. Vale una vez (se quema al contestar), caduca a los 7 días
  y admite 5 envíos con errores. Enseña los datos del diploma —es para lo que
  sirve—, con el documento tapado salvo los últimos caracteres.
*/

// ── El enlace ────────────────────────────────────────────────────────────────

export const huella = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function firma(azar) {
  const clave = process.env.JWT_SECRET;
  if (!clave) throw new Error('Falta JWT_SECRET: no se pueden firmar los enlaces de confirmación del diploma');
  return crypto.createHmac('sha256', clave).update(`confirmacion-diploma:${azar}`).digest('base64url').slice(0, 22);
}

export function nuevoToken() {
  const azar = crypto.randomBytes(24).toString('base64url');
  const token = `${azar}.${firma(azar)}`;
  return { token, hash: huella(token) };
}

/** Forma y firma, antes de ir a la base: un enlace inventado ni la toca. */
export function tokenBienFirmado(token) {
  const m = /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{22})$/.exec(String(token || ''));
  if (!m) return false;
  const esperada = Buffer.from(firma(m[1]));
  const llega = Buffer.from(m[2]);
  return esperada.length === llega.length && crypto.timingSafeEqual(esperada, llega);
}

const caducidad = (desde = new Date()) => new Date(desde.getTime() + cfg.diasDePlazo() * 24 * 3600 * 1000);

const QUIEN_ALUMNO = 'El alumno (enlace de confirmación del CRM)';

// ── Pedir la confirmación (desde el CRM) ─────────────────────────────────────

/** Las solicitudes de Certifex de esas matrículas, por id. */
async function candidatosDe(ids) {
  const buscar = new Set(ids);
  const r = await recorrer('/candidatos', { estado: 'todas', solicitadas: '1' }, {
    filtro: (c) => buscar.has(c.matriculaId),
    completo: (hallados) => new Set(hallados.map((c) => c.matriculaId)).size >= buscar.size,
  });
  return new Map(r.filas.map((c) => [c.matriculaId, c]));
}

/** El proyecto del CRM de un campus de Certifex, si casa con uno solo. */
function proyectoDe(centro, proyectos) {
  const p = proyectosDeCentro(centro, proyectos);
  return p.length === 1 ? p[0] : null;
}

/**
 * Pide la confirmación de datos de esas matrículas: una fila, un enlace y el
 * correo. `user` es quien lo pide (alcance por campus, como en Diplomas).
 * Devuelve un resultado por matrícula; las que no se pueden pedir dicen por qué.
 *
 * Con el correo apagado (lo normal en pruebas) el resultado trae `enlace` para
 * poder probar la página: así se prueba de punta a punta sin mandar nada.
 */
export async function pedir(user, matriculaIds) {
  if (!cfg.activa()) throw new AppError('La confirmación de datos del diploma no está encendida.', 409, 'APAGADA');
  const alcance = await alcanceDe(user);
  const cands = await candidatosDe(matriculaIds);
  exigirMatriculas(alcance, matriculaIds, (id) => cands.get(id)?.centro);

  const proyectos = await model.proyectos();
  const programas = await programasPara([...cands.values()].map((c) => datosDeCandidato(c)));
  let completados = new Map();
  try { completados = await certifexModel.completadosDe(matriculaIds); } catch (err) {
    logger.warn({ err: err.message }, 'Confirmación de diploma: no se pudo leer la fecha de fin');
  }

  const resultados = [];
  for (const id of matriculaIds) {
    const c = cands.get(id);
    try {
      if (!c) throw new AppError('Esa solicitud no está en Certifex (o el alumno aún no ha pedido el diploma: pásalo antes a pendientes).', 404, 'NOT_FOUND');
      if (!cfg.activaEn(c.centro)) throw new AppError(`La confirmación no está encendida en ${c.centro}.`, 409, 'APAGADA');
      if (c.nexpediente) throw new AppError(`Ya tiene el diploma emitido (${c.nexpediente}).`, 409, 'YA_EMITIDO');
      const viva = await model.deLaMatricula(id);
      if (viva?.estado === 'pendiente') throw new AppError('Ya se le pidió y está esperando: usa «Reenviar» si no le llegó.', 409, 'YA_PEDIDA');
      if (viva && LISTOS.has(viva.estado)) throw new AppError('Ya confirmó sus datos (o venció el plazo): se puede emitir.', 409, 'YA_CONFIRMADA');

      const proyecto = proyectoDe(c.centro, proyectos);
      const fin = completados.get(id)?.en;
      const { token, hash } = nuevoToken();
      const fila = await model.crear({
        matriculaId: id,
        centro: String(c.centro).toUpperCase(),
        projectId: proyecto?.id ?? null,
        leadId: c.titular?.email ? await certifexModel.leadPorCorreo(c.titular.email) : null,
        tokenHash: hash,
        caducaAt: caducidad(),
        nombre: c.solicitud?.nombre ?? c.solicitud?.nombreAlumno ?? c.titular?.nombre ?? null,
        documento: String(c.titular?.dni ?? '').trim() || null,
        curso: programas.get(id)?.formacion?.nombre ?? c.curso?.nombre ?? null,
        horas: programas.get(id)?.programa?.horas ?? null,
        fecha: fin ? new Date(fin).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : null,
        pedidoPor: user.email,
      });
      if (!fila) throw new AppError('Otra petición se adelantó: vuelve a cargar la lista.', 409, 'YA_PEDIDA');
      const envio = await mandarPeticion(fila, proyecto, token, c.titular?.email);
      resultados.push({ matriculaId: id, ok: true, estado: fila.estado, caduca_at: fila.caduca_at, ...envio });
    } catch (err) {
      if (!(err instanceof AppError)) logger.warn({ err: err.message, matriculaId: id }, 'Confirmación de diploma: no se pudo pedir');
      resultados.push({ matriculaId: id, ok: false, codigo: err.code || 'ERROR', error: err.message });
    }
  }
  logger.info({ userId: user.userId, n: matriculaIds.length, ok: resultados.filter((r) => r.ok).length }, 'Confirmación de diploma: pedida');
  return resultados;
}

/**
 * El correo con el enlace. Sin DIPLOMA_CONFIRMACION_ENVIAR_CORREO no sale: se
 * apunta como simulado y se devuelve el enlace a quien lo pidió (para probar).
 */
async function mandarPeticion(fila, proyecto, token, email, { reenvio = false } = {}) {
  const para = String(email || '').trim();
  if (!para) {
    await model.marcarEnvio(fila.id, { error: 'Certifex no tiene el correo del alumno' });
    return { enviado: false, error: 'Certifex no tiene el correo del alumno' };
  }
  const c = armarPeticion({ fila, proyecto, token, reenvio });
  if (!cfg.enviarCorreo()) {
    await model.marcarEnvio(fila.id, { para, simulado: true });
    logger.info({ filaId: fila.id }, 'Confirmación de diploma: correo SIMULADO (DIPLOMA_CONFIRMACION_ENVIAR_CORREO apagado)');
    return { enviado: false, simulado: true, enlace: urlDeLaPagina(token) };
  }
  try {
    const { sendEmail } = await import('../../shared/services/brevo.service.js');
    const r = await sendEmail({
      to: [{ email: para, name: fila.nombre_propuesto || undefined }],
      subject: c.asunto,
      htmlContent: c.htmlContent,
      textContent: c.textContent,
      tags: ['diploma', 'confirmacion-datos'],
      projectId: proyecto?.id ?? undefined,
      clave: `confirmacion-diploma-${fila.id}-${reenvio ? Date.now() : 'primero'}`,
    });
    const ok = !!(r?.sent || r?.reason === 'YA_ENVIADO');
    await model.marcarEnvio(fila.id, { para, error: ok ? null : (r?.reason || r?.error || 'no enviado') });
    return { enviado: ok };
  } catch (err) {
    await model.marcarEnvio(fila.id, { para, error: err.message });
    logger.warn({ err: err.message, filaId: fila.id }, 'Confirmación de diploma: no salió el correo');
    return { enviado: false, error: err.message };
  }
}

/** Un enlace nuevo para una pendiente: el anterior deja de valer y el plazo vuelve a empezar. */
export async function reenviar(user, matriculaId) {
  if (!cfg.activa()) throw new AppError('La confirmación de datos del diploma no está encendida.', 409, 'APAGADA');
  const alcance = await alcanceDe(user);
  const f = await model.deLaMatricula(matriculaId);
  exigirMatriculas(alcance, [matriculaId], () => f?.centro);
  if (!f) throw new AppError('A esta matrícula no se le han pedido los datos.', 404, 'NOT_FOUND');
  if (f.estado !== 'pendiente') throw new AppError('El alumno ya contestó (o venció el plazo).', 409, 'YA_RESPONDIDA');
  const { token, hash } = nuevoToken();
  const fila = await model.renovarEnlace(f.id, { tokenHash: hash, caducaAt: caducidad() });
  if (!fila) throw new AppError('No se pudo renovar el enlace.', 409, 'NO_RENOVADO');
  const cands = await candidatosDe([matriculaId]);
  const proyecto = proyectoDe(f.centro, await model.proyectos());
  const envio = await mandarPeticion(fila, proyecto, token, cands.get(matriculaId)?.titular?.email ?? f.enviado_a, { reenvio: true });
  return { matriculaId, caduca_at: fila.caduca_at, ...envio };
}

/** En qué está la confirmación de varias matrículas (para el panel). Sin el hash ni la IP. */
export async function estados(user, matriculaIds) {
  if (!cfg.activa()) return [];
  const alcance = await alcanceDe(user);
  const filas = await model.deLasMatriculas(matriculaIds);
  return [...filas.values()]
    .filter((f) => !alcance || alcance.has(String(f.centro).toUpperCase()))
    .map(({ token_hash: _t, respondido_ip: _ip, ...resto }) => resto);
}

/** Vuelve a pasar a Certifex lo que corrigió el alumno (si falló la primera vez). */
export async function reaplicar(user, matriculaId) {
  const alcance = await alcanceDe(user);
  const f = await model.deLaMatricula(matriculaId);
  exigirMatriculas(alcance, [matriculaId], () => f?.centro);
  if (!f) throw new AppError('A esta matrícula no se le han pedido los datos.', 404, 'NOT_FOUND');
  if (f.estado !== 'corregido') throw new AppError('No hay datos corregidos que pasar.', 409, 'SIN_CORRECCION');
  const fila = await aplicarEnCertifex(f);
  if (fila?.aplicar_error) throw new AppError(`Certifex no los aceptó: ${fila.aplicar_error}`, 502, 'CERTIFEX_ERROR');
  return { matriculaId, aplicado_at: fila?.aplicado_at ?? null };
}

// ── La página pública ────────────────────────────────────────────────────────

const ENLACE_NO_VALE = () => new AppError(
  'Este enlace ya no es válido: o ya se usó, o ha caducado. Si necesitas cambiar tus datos, escribe a tu centro.',
  404, 'ENLACE_NO_VALE');

async function filaDelEnlace(token) {
  if (!cfg.activa() || !tokenBienFirmado(token)) throw ENLACE_NO_VALE();
  const fila = await model.porTokenHash(huella(token));
  if (!fila) throw ENLACE_NO_VALE();
  // El interruptor manda también aquí: apagado en el campus, los enlaces que salieron no abren.
  if (!cfg.activaEn(fila.centro)) throw ENLACE_NO_VALE();
  return fila;
}

/** Lo que enseña la página: la marca y los datos del diploma (el documento, tapado). */
export async function verFormulario(token) {
  const f = await filaDelEnlace(token);
  return {
    marca: f.campus || f.centro,
    logo_url: f.logo_url,
    color: f.theme_color,
    fondo: f.color_cabecera,
    nombre: f.nombre_propuesto,
    documento: documentoTapado(f.documento_propuesto),
    tiene_documento: !!f.documento_propuesto,
    curso: f.curso_nombre,
    horas: f.horas,
    fecha: diaTexto(f.fecha_diploma),
    caduca_at: f.caduca_at,
    intentos_restantes: Math.max(0, cfg.intentosMaximos() - f.intentos),
  };
}

const MSG_NOMBRE = 'escribe tu nombre completo (nombre y apellidos), solo con letras';
const MSG_DOC = 'el documento lleva entre 5 y 20 letras o números';

/**
 * Lo que contesta el alumno: `{ accion: 'confirmar' }` o `{ accion: 'corregir',
 * nombre?, documento? }`, con un `comentario` opcional (para lo que no puede
 * cambiar él: curso, horas o fecha). Si algo no vale se le dice qué, y cuenta
 * como intento. Si vale, se guarda, se quema el enlace y lo corregido se pasa
 * a Certifex.
 */
export async function responder(token, datos, ip = null) {
  const f = await filaDelEnlace(token);
  const comentario = String(datos.comentario || '').trim().slice(0, 1000) || null;
  let nombre = f.nombre_propuesto;
  let documento = f.documento_propuesto;
  const fuera = [];

  if (datos.accion === 'corregir') {
    if (datos.nombre != null && String(datos.nombre).trim()) {
      nombre = normalizarNombreDiploma(String(datos.nombre));
      if (!nombre) fuera.push(MSG_NOMBRE);
    }
    if (datos.documento != null && String(datos.documento).trim()) {
      const r = dniDiploma.safeParse(String(datos.documento));
      if (r.success && r.data) documento = r.data; else fuera.push(MSG_DOC);
    }
  }
  if (!fuera.length && !nombre) fuera.push(MSG_NOMBRE);
  if (!fuera.length && !documento) fuera.push('falta tu documento de identidad: escríbelo');

  if (fuera.length) {
    const queda = await model.sumarIntento(f.id, cfg.intentosMaximos());
    if (queda && !queda.token_hash) {
      await avisarAdministracion(f.centro, 'Un alumno no pudo confirmar los datos de su diploma',
        `${f.centro} · matrícula ${f.matricula_id}. Agotó los intentos del enlace: revisa sus datos en Diplomas.`, f.matricula_id);
      throw new AppError('Has agotado los intentos. Tu centro revisará tus datos.', 429, 'SIN_INTENTOS');
    }
    throw new AppError(`Revisa tus datos: ${fuera.join('; ')}.`, 400, 'DATOS_NO_VALIDOS');
  }

  const cambia = nombre !== f.nombre_propuesto || documento !== f.documento_propuesto;
  const fila = await model.guardarRespuesta(f.id, {
    estado: cambia ? 'corregido' : 'confirmado', nombre, documento, comentario, ip,
  });
  if (!fila) throw ENLACE_NO_VALE(); // otro envío se adelantó
  const final = cambia ? await aplicarEnCertifex(fila) : await model.marcarAplicado(fila.id);
  await alConfirmar(final || fila);
  return { guardado: true, estado: fila.estado };
}

/**
 * Pasa a Certifex el nombre y el documento corregidos (Certifex es quien
 * imprime). Primero el documento: si Certifex lo rechaza (otro alumno ya lo
 * tiene), no se toca el nombre. Lo que falle queda en `aplicar_error` y la
 * puerta no deja emitir hasta que se arregle.
 */
async function aplicarEnCertifex(fila) {
  try {
    if (fila.documento_confirmado && fila.documento_confirmado !== fila.documento_propuesto) {
      await certifex('POST', '/solicitudes/dni', { matriculaId: Number(fila.matricula_id), dni: fila.documento_confirmado, editadoPor: QUIEN_ALUMNO });
    }
    if (fila.nombre_confirmado && fila.nombre_confirmado !== fila.nombre_propuesto) {
      await certifex('POST', '/solicitudes/nombre', { matriculaId: Number(fila.matricula_id), nombre: fila.nombre_confirmado, editadoPor: QUIEN_ALUMNO });
    }
    return await model.marcarAplicado(fila.id);
  } catch (err) {
    logger.warn({ err: err.message, filaId: fila.id }, 'Confirmación de diploma: Certifex no aceptó lo corregido');
    await avisarAdministracion(fila.centro, 'Datos de diploma corregidos sin pasar a Certifex',
      `${fila.centro} · matrícula ${fila.matricula_id}: ${err.message}`.slice(0, 300), fila.matricula_id);
    return model.marcarAplicado(fila.id, err.message || 'error');
  }
}

/**
 * EL PUNTO DE ENGANCHE. El alumno contestó (o venció el plazo) y el diploma ya
 * puede salir. Hoy solo se avisa a administración del campus para que lo emita
 * en Diplomas, como siempre.
 *
 * Aquí irá la emisión sola (paso 3 y 4 de la issue) cuando:
 *   1. Manuel/Diego decidan quién aprueba antes (hoy, ningún diploma sale sin
 *      que una persona lo apruebe; propuesta: aprobar al pedir la confirmación);
 *   2. existan las plantillas de diploma de los campus que aún no las tienen
 *      (ICTESS): sin plantilla, emitir solo sacaría un diploma con un diseño que
 *      nadie ha aprobado.
 * El camino sería `emitirMatriculas` de certifex.emision.js (pasa por la misma
 * puerta y deja el registro de con qué datos salió).
 */
async function alConfirmar(fila) {
  if (!fila) return;
  const por = fila.estado === 'vencido' ? 'Pasaron 7 días sin respuesta' : 'El alumno confirmó sus datos';
  const corregidos = fila.estado === 'corregido' ? ' (los corrigió)' : '';
  await avisarAdministracion(fila.centro, `${por}${corregidos}: diploma listo para emitir`,
    `${fila.centro} · matrícula ${fila.matricula_id}${fila.curso_nombre ? ` · ${fila.curso_nombre}` : ''}.`
    + (fila.comentario ? ` Comentario del alumno: «${fila.comentario}»` : ''), fila.matricula_id);
}

// ── El plazo ─────────────────────────────────────────────────────────────────

/** La vuelta del vigilante: las pendientes que han cumplido sus 7 días vencen. */
export async function vuelta({ limite = 100 } = {}) {
  if (!cfg.activa()) return { vencidas: 0 };
  let vencidas = 0;
  for (const { id } of await model.vencidas(limite)) {
    try {
      const f = await model.vencer(id);
      if (f) { vencidas += 1; await alConfirmar(f); }
    } catch (err) {
      logger.warn({ err: err.message, filaId: id }, 'Confirmación de diploma: no se pudo cerrar el plazo');
    }
  }
  return { vencidas };
}

// ── Avisos ───────────────────────────────────────────────────────────────────

async function avisarAdministracion(centro, title, message, matriculaId) {
  try {
    const ids = await certifexModel.idsAdministracionDeCentro(centro);
    if (!ids.length) return;
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    await notifyUsers({
      targetUserIds: ids,
      type: 'diploma_confirmacion',
      title: String(title).slice(0, 200),
      message: String(message).slice(0, 300),
      link_path: '/clientes/matriculas/diplomas',
      metadata: { matriculaId: Number(matriculaId), centro },
    });
  } catch (err) {
    logger.warn({ err: err.message, matriculaId }, 'Confirmación de diploma: no se pudo avisar a administración');
  }
}
