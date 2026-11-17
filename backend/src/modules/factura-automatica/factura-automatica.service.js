import crypto from 'node:crypto';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './factura-automatica.model.js';
import * as cfg from './factura-automatica.config.js';
import { problemas, normalizar, deLaFicha } from './datos-fiscales.js';
import { armarPeticion, armarFactura } from './factura-automatica.emails.js';

/*
  FACTURA AUTOMÁTICA CON FORMULARIO DE DATOS FISCALES (#452, gemela de CRM#764).

  EN ISEIE no se paró: al apuntar un cobro a mano, `autoInvoice` emite con lo
  que haya en la ficha (los de Stripe van a la cola). Encendido esto, en los
  campus de la lista deja de hacerlo y pasa a pedir los datos al alumno.

  POR QUÉ SE PARÓ EN EL 360 (14/09, commit «nada sale solo»).
  `autoInvoice` emitía en el acto con lo que hubiera en la ficha: el nombre de
  relleno con el que se crea un prospecto desde WhatsApp, sin NIF ni dirección.
  Y la factura quedaba a nombre de quien registró el cobro, así que nadie veía
  que había salido sola: la 2026/0101 salió sola y 33 s después la gestora
  emitió la 0102 a mano para el mismo cobro.

  CÓMO NO VUELVE A PASAR.
    1. Los datos no salen de la ficha sin más: los da el alumno en un
       formulario. A los 7 días sin respuesta se usa la ficha SOLO si pasa la
       misma validación (NIF de verdad, dirección, nombre que no sea de
       relleno). Si no, el cobro se queda en la cola y se avisa a su gestora.
    2. Se emite por el mismo camino que «Generar factura» en la cola
       (`emitirFacturaDePago`), con su orden por fecha, su comprobación de
       huérfanas y el índice único de una factura por cobro.
    3. La factura lleva `datos_fiscales_id` y `created_by` vacío: en pantalla se
       sabe que salió sola, y la cola dice «esperando datos del alumno».
    4. Todo detrás de FACTURA_AUTOMATICA_ACTIVA (apagado de serie), por campus.

  EL ENLACE. Aleatorio (24 bytes) y firmado con la clave del servidor; en la
  base solo su sha256. Vale una vez (se quema al guardar), caduca a los 7 días y
  admite 5 envíos con errores. No enseña datos de nadie: solo el nombre del
  campus, el programa y el nombre de pila de quien lo recibe.
*/

// ── El enlace ────────────────────────────────────────────────────────────────

export const huella = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function firma(azar) {
  const clave = process.env.JWT_SECRET;
  if (!clave) throw new Error('Falta JWT_SECRET: no se pueden firmar los enlaces de datos fiscales');
  return crypto.createHmac('sha256', clave).update(`datos-fiscales:${azar}`).digest('base64url').slice(0, 22);
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

// ── Una venta cada vez ───────────────────────────────────────────────────────
// El formulario, el vigilante y una cuota pueden querer facturar la misma venta
// a la vez. La base ya impide dos facturas por cobro; esto evita además que dos
// vueltas se pisen en el mismo proceso.
const enCurso = new Map();
function deUnoEnUno(conversionId, fn) {
  const antes = enCurso.get(conversionId) || Promise.resolve();
  const ahora = antes.catch(() => {}).then(fn);
  enCurso.set(conversionId, ahora);
  return ahora.finally(() => { if (enCurso.get(conversionId) === ahora) enCurso.delete(conversionId); });
}

// ── Al cobrar ────────────────────────────────────────────────────────────────

/**
 * Entra un cobro en una venta. Devuelve `true` si la factura automática se
 * hace cargo (y entonces el camino de siempre no hace nada) o `false` si no
 * aplica: interruptor apagado, campus fuera, venta que ya se facturaba a mano
 * o con una proforma esperando.
 *
 *   · Sin petición todavía → se crea y se le manda el formulario al alumno. El
 *     cobro espera en la cola hasta que conteste (o hasta el día 7).
 *   · Pendiente → espera con los demás; al contestar salen todas.
 *   · Con datos (formulario o ficha) → la factura de este cobro sale ya.
 *   · En revisión → en la cola, para una persona.
 */
export async function alCobrar({ conversionId, paymentId }) {
  if (!cfg.activa() || !conversionId) return false;
  try {
    const campus = await model.campusDeLaVenta(conversionId);
    if (!campus || !cfg.activaEn(campus)) return false;

    const fila = await model.deLaVenta(conversionId);
    if (!fila) {
      if (await model.tieneProforma(conversionId)) return false;
      if (await model.yaTieneFacturas(conversionId)) return false;
      await pedirDatos(conversionId, paymentId);
      return true;
    }
    if (fila.estado === 'respondido' || fila.estado === 'ficha') {
      await emitirPendientes(fila.id);
    }
    return true;
  } catch (err) {
    // No se cae el cobro por esto: si algo falla, el cobro está apuntado y
    // sigue en la cola, que es lo de siempre.
    logger.warn({ err: err.message, conversionId, paymentId }, 'factura automática: no se pudo tratar el cobro');
    return true;
  }
}

/** Crea la petición y manda el correo. Sin correo en la ficha, espera al día 7. */
export async function pedirDatos(conversionId, paymentId) {
  const v = await model.venta(conversionId);
  if (!v) return null;
  const { token, hash } = nuevoToken();
  const caducaAt = caducidad();
  const fila = await model.crear({
    conversionId, projectId: v.project_id, leadId: v.lead_id, paymentId, tokenHash: hash, caducaAt,
  });
  if (!fila) return model.deLaVenta(conversionId); // otra llamada se adelantó
  await mandarPeticion(fila, v, token);
  return fila;
}

async function mandarPeticion(fila, v, token, { reenvio = false } = {}) {
  const email = String(v.email || '').trim();
  if (!email) {
    await model.marcarEnvio(fila.id, { error: 'La ficha no tiene correo' });
    return { sent: false };
  }
  try {
    const c = armarPeticion({ v, token, caducaAt: fila.caduca_at, reenvio });
    const { sendEmail } = await import('../../shared/services/brevo.service.js');
    const r = await sendEmail({
      to: [{ email, name: v.nombre || undefined }],
      subject: c.asunto,
      htmlContent: c.htmlContent,
      textContent: c.textContent,
      tags: ['factura-automatica', 'datos-fiscales'],
      projectId: v.project_id,
      clave: `datos-fiscales-${fila.id}-${reenvio ? Date.now() : 'primero'}`,
    });
    if (r?.sent || r?.reason === 'YA_ENVIADO') await model.marcarEnvio(fila.id, { para: email });
    else await model.marcarEnvio(fila.id, { para: email, error: r?.reason || r?.error || 'no enviado' });
    await nota(v.lead_id, `🧾 Pedidos los datos fiscales para la factura (formulario enviado a ${email}).`);
    return r;
  } catch (err) {
    await model.marcarEnvio(fila.id, { error: err.message });
    logger.warn({ err: err.message, filaId: fila.id }, 'factura automática: no salió el correo del formulario');
    return { sent: false };
  }
}

// ── El formulario público ────────────────────────────────────────────────────

const ENLACE_NO_VALE = () => new AppError(
  'Este enlace ya no es válido: o ya se usó, o ha caducado. Si necesitas cambiar tus datos, escribe a tu asesor.',
  404, 'ENLACE_NO_VALE');

async function filaDelEnlace(token) {
  if (!tokenBienFirmado(token)) throw ENLACE_NO_VALE();
  const fila = await model.porTokenHash(huella(token));
  if (!fila) throw ENLACE_NO_VALE();
  // El interruptor manda también aquí: apagado, los enlaces que ya salieron no hacen nada.
  if (!cfg.activaEn({ id: fila.project_id, slug: fila.slug })) throw ENLACE_NO_VALE();
  return fila;
}

/** Lo que enseña la página: la marca y el nombre de pila. Nada más. */
export async function verFormulario(token) {
  const f = await filaDelEnlace(token);
  return {
    marca: f.campus,
    logo_url: f.logo_url,
    color: f.theme_color,
    fondo: f.color_cabecera,
    nombre: String(f.lead_nombre || '').trim().split(/\s+/)[0] || null,
    caduca_at: f.caduca_at,
    intentos_restantes: Math.max(0, cfg.intentosMaximos() - f.intentos),
  };
}

/**
 * Lo que manda el alumno. Si algo no vale se le dice qué, y cuenta como
 * intento. Si vale, se guarda, se quema el enlace, se copia a su ficha y
 * salen las facturas de los cobros que esperaban.
 */
export async function responder(token, datos, ip = null) {
  const f = await filaDelEnlace(token);
  const d = normalizar(datos);
  const fuera = problemas(d);
  if (fuera.length) {
    const queda = await model.sumarIntento(f.id, cfg.intentosMaximos());
    if (queda?.estado === 'revision') {
      await avisarGestora(f.conversion_id, 'El alumno no pudo completar sus datos fiscales: revisa su factura en la cola.');
      throw new AppError('Has agotado los intentos. Tu asesor revisará tus datos y te hará la factura.', 429, 'SIN_INTENTOS');
    }
    throw new AppError(`Revisa tus datos: ${fuera.join(', ')}.`, 400, 'DATOS_NO_VALIDOS');
  }
  const fila = await model.guardarDatos(f.id, d, { origen: 'formulario', estado: 'respondido', ip });
  if (!fila) throw ENLACE_NO_VALE(); // otro envío se adelantó
  try { await model.copiarAFicha(fila.lead_id, d); } catch (err) {
    logger.warn({ err: err.message, filaId: fila.id }, 'factura automática: no se copiaron los datos a la ficha');
  }
  await nota(fila.lead_id, `🧾 El alumno completó sus datos fiscales (${d.nombre} · ${d.nif}). La factura sale con ellos.`);
  const r = await emitirPendientes(fila.id);
  return { guardado: true, facturas: r.emitidas.length };
}

// ── El plazo ─────────────────────────────────────────────────────────────────

/**
 * Día 7 sin respuesta. Con la ficha completa y válida, se factura con ella; si
 * no, a revisión: el cobro se queda en la cola y su gestora recibe un aviso.
 */
export async function cerrarPlazo(filaId) {
  const f = await model.porId(filaId);
  if (!f || f.estado !== 'pendiente') return { estado: f?.estado || null };
  const v = await model.venta(f.conversion_id);
  const d = deLaFicha(v || {});
  const fuera = v ? problemas(d) : ['la venta ya no existe'];
  if (fuera.length) {
    const motivo = `Sin respuesta del alumno y la ficha no vale para facturar: ${fuera.join(', ')}.`;
    await model.aRevision(f.id, motivo);
    await nota(f.lead_id, `🧾 ${motivo} El cobro queda en la cola de facturación.`);
    await avisarGestora(f.conversion_id, motivo);
    return { estado: 'revision', motivo };
  }
  const fila = await model.guardarDatos(f.id, d, { origen: 'ficha', estado: 'ficha' });
  if (!fila) return { estado: null };
  await nota(f.lead_id, '🧾 Sin respuesta del alumno en el plazo: la factura sale con los datos de su ficha, que están completos.');
  const r = await emitirPendientes(fila.id);
  return { estado: 'ficha', emitidas: r.emitidas.length };
}

/** La vuelta del vigilante: plazos cumplidos y cobros que quedaron esperando. */
export async function vuelta({ limite = 50 } = {}) {
  if (!cfg.activa()) return { vencidas: 0, reintentos: 0 };
  let vencidas = 0;
  let reintentos = 0;
  for (const f of await model.vencidas(limite)) {
    try { await cerrarPlazo(f.id); vencidas += 1; } catch (err) {
      logger.warn({ err: err.message, filaId: f.id }, 'factura automática: no se pudo cerrar el plazo');
    }
  }
  for (const f of await model.conCobrosSinFactura(limite)) {
    try { await emitirPendientes(f.id); reintentos += 1; } catch (err) {
      logger.warn({ err: err.message, filaId: f.id }, 'factura automática: reintento fallido');
    }
  }
  return { vencidas, reintentos };
}

// ── La emisión ───────────────────────────────────────────────────────────────

/**
 * Emite, por orden de fecha, las facturas de los cobros de la venta que aún no
 * tienen. Para en el primero que no pueda salir (hay cobros anteriores de otro
 * alumno en la cola, el total de la venta no cuadra, el emisor no tiene CIF…):
 * ese y los siguientes se quedan en la cola, y se anota por qué.
 */
export function emitirPendientes(filaId) {
  return model.porId(filaId).then((f) => {
    if (!f) return { emitidas: [] };
    return deUnoEnUno(f.conversion_id, () => emitirDeLaFila(f.id));
  });
}

async function emitirDeLaFila(filaId) {
  const f = await model.porId(filaId);
  const emitidas = [];
  if (!f || !['respondido', 'ficha'].includes(f.estado)) return { emitidas };
  if (!cfg.activaEn(await model.campusDeLaVenta(f.conversion_id))) return { emitidas };

  const v = await model.venta(f.conversion_id);
  if (!v) return { emitidas };
  if (!String(v.emisor_nif || '').trim() || /^PENDIENTE-CIF-/i.test(String(v.emisor_nif))) {
    await model.anotarError(f.id, 'La sociedad emisora del campus no tiene el CIF puesto');
    return { emitidas };
  }

  const invModel = await import('../invoices/invoices.model.js');
  const invService = await import('../invoices/invoices.service.js');
  let error = null;
  for (const cp of await model.cobrosSinFactura(f.conversion_id)) {
    // El orden de la cola: si hay cobros anteriores sin facturar, este espera.
    if (!(await invService.puedeFacturarAhora(v.project_id, cp.fecha, cp.id))) {
      error = 'Espera su turno en la cola: hay cobros anteriores sin facturar';
      break;
    }
    try {
      const inv = await invModel.emitirFacturaDePago(
        f.conversion_id, { paymentId: cp.id, importe: Number(cp.importe), datosFiscales: f }, null);
      if (!inv?.id) { error = 'El cobro es anterior a la primera factura de la sociedad'; break; }
      if (Number(inv.datos_fiscales_id) === Number(f.id)) {
        emitidas.push(inv);
        logger.info({ conversionId: f.conversion_id, paymentId: cp.id, codigo: inv.codigo },
          'factura automática emitida');
        await mandarFactura(inv, v, f);
      }
    } catch (err) {
      error = err.message;
      logger.warn({ err: err.message, conversionId: f.conversion_id, paymentId: cp.id },
        'factura automática: el cobro se queda en la cola');
      break;
    }
  }
  await model.anotarError(f.id, error);
  if (emitidas.length) {
    await nota(f.lead_id, `🧾 Factura${emitidas.length > 1 ? 's' : ''} emitida${emitidas.length > 1 ? 's' : ''} sola${emitidas.length > 1 ? 's' : ''}: ${emitidas.map((i) => i.codigo).join(', ')}.`);
  }
  return { emitidas, error };
}

/** La factura en PDF al correo que dio el alumno (o al de su ficha). */
async function mandarFactura(inv, v, f) {
  if (!cfg.enviarPdf()) return;
  const email = f.email || v.email;
  if (!email) return;
  try {
    const invService = await import('../invoices/invoices.service.js');
    const invModel = await import('../invoices/invoices.model.js');
    const { bytes } = await invService.generatePDF(inv.id);
    const c = armarFactura({ v, inv });
    const { sendEmail } = await import('../../shared/services/brevo.service.js');
    const r = await sendEmail({
      to: [{ email, name: inv.cliente_nombre || undefined }],
      subject: c.asunto,
      htmlContent: c.htmlContent,
      textContent: c.textContent,
      attachment: [{ name: `${String(inv.codigo).replace('/', '-')}.pdf`, content: Buffer.from(bytes).toString('base64') }],
      tags: ['factura-automatica', 'factura'],
      projectId: v.project_id,
      clave: `factura-automatica-${inv.id}`,
    });
    if (r?.sent) await invModel.markSent(inv.id, email);
  } catch (err) {
    logger.warn({ err: err.message, invoiceId: inv.id }, 'factura automática: emitida pero no se pudo mandar el PDF');
  }
}

// ── Desde el CRM ─────────────────────────────────────────────────────────────

/** Estado de la petición de una venta (para la ficha o la cola). */
export async function estadoDeLaVenta(conversionId) {
  const f = await model.deLaVenta(conversionId);
  if (!f) return null;
  const { token_hash: _t, respondido_ip: _ip, ...resto } = f;
  return resto;
}

/** Un enlace nuevo: el anterior deja de valer y el plazo vuelve a empezar. */
export async function reenviar(conversionId) {
  const campus = await model.campusDeLaVenta(conversionId);
  if (!campus || !cfg.activaEn(campus)) {
    throw new AppError('La factura automática no está encendida en este campus.', 409, 'APAGADA');
  }
  const f = await model.deLaVenta(conversionId);
  if (!f) throw new AppError('A esta venta no se le han pedido datos fiscales.', 404, 'NOT_FOUND');
  if (!['pendiente', 'revision'].includes(f.estado)) {
    throw new AppError('Esta venta ya tiene sus datos fiscales.', 409, 'YA_RESPONDIDO');
  }
  const { token, hash } = nuevoToken();
  const fila = await model.renovarEnlace(f.id, { tokenHash: hash, caducaAt: caducidad() });
  if (!fila) throw new AppError('No se pudo renovar el enlace.', 409, 'NO_RENOVADO');
  const v = await model.venta(conversionId);
  const r = await mandarPeticion(fila, v, token, { reenvio: true });
  return { enviado: !!r?.sent, caduca_at: fila.caduca_at };
}

/** Para la cola: qué pasa con los datos fiscales de cada venta. */
export async function estadosParaCola(conversionIds) {
  if (!cfg.activa()) return new Map();
  try { return await model.estadosDe(conversionIds); } catch { return new Map(); }
}

// ── Avisos ───────────────────────────────────────────────────────────────────

async function nota(leadId, texto) {
  if (!leadId) return;
  try {
    const leadModel = await import('../leads/lead.model.js');
    await leadModel.createInteraction(leadId, 'nota', texto, null, null);
  } catch (err) {
    logger.warn({ err: err.message, leadId }, 'factura automática: no se pudo anotar en la ficha');
  }
}

async function avisarGestora(conversionId, mensaje) {
  try {
    const v = await model.venta(conversionId);
    if (!v?.responsable_id) return;
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    await notifyUsers({
      targetUserIds: [v.responsable_id],
      type: 'factura_automatica',
      title: 'Una factura espera revisión en la cola',
      message: mensaje,
      link_path: v.lead_id ? `/clientes/${v.lead_id}` : null,
      metadata: { conversion_id: conversionId },
    });
  } catch (err) {
    logger.warn({ err: err.message, conversionId }, 'factura automática: no se pudo avisar a la gestora');
  }
}
