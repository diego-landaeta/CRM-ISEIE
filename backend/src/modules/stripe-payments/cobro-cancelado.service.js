/**
 * COBRO AUTOMÁTICO CANCELADO EN STRIPE (CRM#1103 / CRM-ISEIE#759; migración 343).
 *
 * Carlos, 24/11/2026: «la persona cancela la suscripción en Stripe y no se hace
 * el pago: como no se cobra, no sale el aviso de impago». El CRM solo se
 * enteraba de un cobro FALLIDO (`invoice.payment_failed`). Si la suscripción se
 * cancelaba antes de intentar el cobro, no llegaba nada y la cuota seguía en el
 * CRM como si Stripe la fuera a cobrar sola.
 *
 * QUÉ SE ESCUCHA (el webhook de cada campus; `EVENTOS_DE_LOS_LINKS`):
 *   · customer.subscription.deleted: la suscripción se canceló (el alumno desde
 *     el portal, alguien desde el panel, o Stripe tras fallar los reintentos);
 *   · customer.subscription.updated: solo si pasa a `unpaid`, `canceled` o
 *     `incomplete_expired` (Stripe la da por perdida); y, en una venta a plazos,
 *     si vuelve de ahí a `active` (vuelve a cobrarse sola: se quitan las marcas);
 *   · subscription_schedule.canceled / .aborted: el calendario del cobro
 *     automático del CRM (309) se canceló o Stripe lo abortó por impago;
 *   · invoice.voided / invoice.marked_uncollectible: la factura de UNA cuota se
 *     anuló o Stripe la dio por incobrable.
 *
 * DE QUÉ VENTA ES: del cobro automático del CRM (309; el calendario o el precio
 * de la cuota) o de una venta a plazos con suscripción de Stripe (#747,
 * `conversions.stripe_subscription_id`). Lo demás (suscripciones de las
 * plataformas de IA, de otra cuenta…) no se toca.
 *
 * QUÉ SE HACE:
 *   · las cuotas que quedaban por cobrar SIGUEN PENDIENTES (no se toca
 *     `fecha_cobro`): si vencen sin cobrarse son impago, como cualquier otra;
 *   · quedan marcadas «cobro automático cancelado», con la fecha y el motivo de
 *     Stripe (y quién lo canceló, si Stripe lo dice);
 *   · el cobro automático de la venta se quita (sin persona del CRM). El CRM ya
 *     no vuelve a programarlo solo: el alumno lo canceló. Si la suscripción
 *     sigue viva («impagada»), la siguiente pasada del CRM cancela el calendario,
 *     para que no cobre después lo que ya se le mandó con un link;
 *   · aviso en la campana a la gestora de la venta y a los admins del campus (y
 *     super admins). Si el alumno está de baja, no se avisa (no es un impago);
 *   · en la ficha de la venta, cada cuota marcada lleva su botón «Mandar link de
 *     pago» (antes, el CRM anula en Stripe la factura de esa cuota si seguía
 *     pagable: nunca dos maneras de pagar lo mismo).
 *
 * LO QUE NO ES UNA CANCELACIÓN:
 *   · lo que cancela el propio CRM: quitar el cobro automático, borrar la
 *     venta, apagar el campus (el cobro automático ya no está activo, o el
 *     calendario ya no es el suyo); cerrar la suscripción de una venta pagada
 *     (#747: `cerrando`/`cancelada`/`ya_cerrada`);
 *   · el final normal del calendario: ya no queda ninguna cuota programada;
 *   · una venta a plazos ya pagada entera: se apunta como cerrada y ya.
 *
 * SIN DOBLES: la fila de `stripe_cobros_cancelados` (venta + calendario,
 * suscripción o factura) es la llave. Un aviso repetido de Stripe, o dos avisos
 * de la misma cancelación (`subscription.deleted` + `schedule.canceled`), marcan
 * y avisan una sola vez. Lo del cobro automático va con el mismo candado por
 * venta que `sincronizar`.
 */
import { getClient } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './cobro-cancelado.model.js';
import { quienesLaUsan, duenoDeLaCuenta } from './stripe-prestado.js';

/** Los eventos que trata (se añaden al webhook de cada cuenta). */
export const EVENTOS_DE_CANCELACION = Object.freeze([
  'customer.subscription.deleted',
  'customer.subscription.updated',
  'subscription_schedule.canceled',
  'subscription_schedule.aborted',
  'invoice.voided',
  'invoice.marked_uncollectible',
]);

/** Estados en que Stripe ya no cobrará la suscripción sola. */
const PERDIDA = new Set(['unpaid', 'canceled', 'incomplete_expired']);
/** Margen de un céntimo, como en #747. */
const MARGEN = 0.01;
/** A dónde lleva el aviso: la ficha de la venta. */
export const rutaDeLaVenta = (conversionId) => `/ventas/${conversionId}`;

const idDe = (x) => (x && typeof x === 'object' ? x.id : x) || null;
const enFecha = (s) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);

// ─── Lo puro ────────────────────────────────────────────────────────────────

/**
 * ¿Es este aviso una cancelación (o una vuelta a cobrar)? Sin tocar la base.
 * `{ clase: 'suscripcion'|'calendario'|'factura'|'reactivada' }` o null.
 */
export function queEs(event) {
  const tipo = String(event?.type || '');
  const obj = event?.data?.object || {};
  if (tipo === 'customer.subscription.deleted') return { clase: 'suscripcion' };
  if (tipo === 'customer.subscription.updated') {
    const antes = event?.data?.previous_attributes;
    // Si este cambio no toca el estado (una renovación, la tarjeta…), no es nada.
    if (!antes || !Object.prototype.hasOwnProperty.call(antes, 'status') || antes.status === obj.status) return null;
    if (PERDIDA.has(obj.status)) return { clase: 'suscripcion' };
    if (['active', 'trialing'].includes(obj.status) && PERDIDA.has(antes.status)) return { clase: 'reactivada' };
    return null;
  }
  if (tipo === 'subscription_schedule.canceled' || tipo === 'subscription_schedule.aborted') return { clase: 'calendario' };
  if (tipo === 'invoice.voided' || tipo === 'invoice.marked_uncollectible') return { clase: 'factura' };
  return null;
}

const MOTIVOS_DEL_ALUMNO = {
  customer_service: 'atención al cliente', low_quality: 'calidad', missing_features: 'le faltan cosas',
  switched_service: 'se cambia a otro servicio', too_complex: 'demasiado complicado', too_expensive: 'demasiado caro',
  unused: 'no lo usa', other: 'otro motivo',
};

/**
 * El motivo y la fecha, en castellano, como lo cuenta Stripe. Sin tocar la base.
 * `{ motivo, quien, cuando, detalle }`.
 */
export function motivoDe(event) {
  const tipo = String(event?.type || '');
  const obj = event?.data?.object || {};
  const peticion = event?.request && typeof event.request === 'object' ? event.request.id : event?.request;
  const cd = obj.cancellation_details || {};
  let motivo;
  let quien = null;
  let cuando = null;
  if (tipo.startsWith('customer.subscription.')) {
    if (obj.status === 'unpaid') motivo = 'Stripe ha dejado de intentar cobrar la suscripción: está impagada';
    else if (obj.status === 'incomplete_expired') motivo = 'La suscripción caducó en Stripe sin llegar a cobrarse';
    else if (cd.reason === 'payment_failed') motivo = 'Stripe canceló la suscripción porque no pudo cobrar';
    else if (cd.reason === 'payment_disputed') motivo = 'Stripe canceló la suscripción por una disputa';
    else motivo = 'La suscripción se canceló en Stripe';
    if (cd.reason === 'payment_failed' || cd.reason === 'payment_disputed' || obj.status === 'unpaid') quien = 'Stripe, automáticamente';
    else if (cd.feedback || cd.comment) quien = 'el alumno';
    else if (peticion) quien = 'alguien desde el panel o la API de Stripe';
    const delAlumno = [cd.feedback ? MOTIVOS_DEL_ALUMNO[cd.feedback] || cd.feedback : null, cd.comment].filter(Boolean).join(': ');
    if (delAlumno) motivo += ` (${String(delAlumno).slice(0, 300)})`;
    cuando = enFecha(obj.canceled_at) || enFecha(obj.ended_at);
  } else if (tipo === 'subscription_schedule.aborted') {
    motivo = 'Stripe canceló el calendario de cobros por impago';
    quien = 'Stripe, automáticamente';
    cuando = enFecha(obj.canceled_at);
  } else if (tipo === 'subscription_schedule.canceled') {
    motivo = 'El calendario de cobros se canceló en Stripe';
    if (peticion) quien = 'alguien desde el panel o la API de Stripe';
    cuando = enFecha(obj.canceled_at);
  } else if (tipo === 'invoice.voided') {
    motivo = 'La factura de la cuota se anuló en Stripe';
    if (peticion) quien = 'alguien desde el panel o la API de Stripe';
    cuando = enFecha(obj.status_transitions?.voided_at);
  } else if (tipo === 'invoice.marked_uncollectible') {
    motivo = 'Stripe dio por incobrable la factura de la cuota';
    quien = peticion ? 'alguien desde el panel o la API de Stripe' : 'Stripe, automáticamente';
    cuando = enFecha(obj.status_transitions?.marked_uncollectible_at);
  } else {
    motivo = 'Stripe dejó de cobrar la cuota';
  }
  cuando = cuando || enFecha(event?.created) || new Date().toISOString();
  return {
    motivo: quien ? `${motivo}. Lo hizo: ${quien}.` : `${motivo}.`,
    quien,
    cuando,
    detalle: {
      evento: event?.id || null, tipo, estado: obj.status ?? null, razon: cd.reason ?? null,
      comentario: cd.comment ?? null, opinion: cd.feedback ?? null, peticion: peticion || null,
    },
  };
}

// ─── De qué venta es ────────────────────────────────────────────────────────

/** Los campus que comparten la cuenta de Stripe de este (el dueño y quienes la usan). */
async function campusDeLaCuenta(projectId) {
  const dueno = await duenoDeLaCuenta(Number(projectId));
  return [...new Set([Number(projectId), dueno, ...(await quienesLaUsan(dueno))])];
}

async function enTransaccion(fn) {
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query(r?.deshacer ? 'ROLLBACK' : 'COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * El aviso de Stripe, si es una cancelación de una venta nuestra. Lo llama el
 * webhook (`handleWebhookEvent`). Nunca lanza por un aviso que no es nuestro:
 * devuelve `{ skipped }`.
 */
export async function desdeElAviso(projectId, event) {
  const que = queEs(event);
  if (!que) return { skipped: `${event?.type}: no es una cancelación` };
  const obj = event.data.object;
  const campus = await campusDeLaCuenta(projectId);
  const m = motivoDe(event);

  if (que.clase === 'factura') {
    const cobroAuto = await import('../links-pago/links-pago.cobro-auto.js');
    const cuota = await cobroAuto.cuotaDeLaFactura(projectId, obj);
    if (cuota) return facturaDeCuota({ cuota, inv: obj, event, m });
    const { suscripcionDeFactura } = await import('./suscripciones.service.js');
    const sub = suscripcionDeFactura(obj);
    if (sub) return suscripcion({ subId: sub, campus, event, m, referencia: obj.id, soloUnaCuota: true });
    return { skipped: 'la factura no es de una cuota del CRM ni de una venta a plazos' };
  }

  if (que.clase === 'calendario') {
    const ca = await model.ventaDelCalendario(obj.id, campus);
    if (!ca) return { skipped: 'el calendario no es de ninguna venta (o ya no es el suyo)' };
    return calendario({ conversionId: ca.conversion_id, scheduleId: obj.id, event, m });
  }

  // Una suscripción: del calendario del CRM (309) o de una venta a plazos (#747).
  const scheduleId = idDe(obj.schedule);
  let ca = scheduleId ? await model.ventaDelCalendario(scheduleId, campus) : null;
  if (!ca && obj.metadata?.crm_cobro_auto === '1' && Number(obj.metadata?.crm_conversion_id) > 0) {
    ca = await model.ventaConCobroAuto(Number(obj.metadata.crm_conversion_id), campus);
  }
  if (ca) {
    if (que.clase === 'reactivada') return { skipped: 'el cobro automático del CRM no se reactiva solo' };
    return calendario({ conversionId: ca.conversion_id, scheduleId: scheduleId || ca.stripe_schedule_id, event, m });
  }
  // Marcada por el cobro automático del CRM pero de una venta que ya no la tiene: nada.
  if (obj.metadata?.crm_cobro_auto === '1') return { skipped: 'cobro automático del CRM que ya no es de la venta' };
  if (que.clase === 'reactivada') return reactivada({ subId: obj.id, campus, event });
  return suscripcion({ subId: obj.id, campus, event, m, referencia: obj.id, cerrada: obj.status !== 'unpaid' });
}

// ─── El cobro automático del CRM (309) ──────────────────────────────────────

async function calendario({ conversionId, scheduleId, event, m }) {
  const cobroAuto = await import('../links-pago/links-pago.cobro-auto.js');
  const r = await cobroAuto.conCandado(conversionId, () => enTransaccion(async (db) => {
    const { rows: [ca] } = await db.query('SELECT * FROM conversion_cobro_auto WHERE conversion_id = $1 FOR UPDATE', [conversionId]);
    if (!ca?.activo) return { skipped: 'el cobro automático ya estaba quitado (lo quitó el CRM o ya se apuntó)', deshacer: true };
    if (!ca.stripe_schedule_id || (scheduleId && ca.stripe_schedule_id !== scheduleId)) {
      return { skipped: 'ese calendario ya no es el de la venta', deshacer: true };
    }
    const cuotas = await model.programadasSinCobrar(db, conversionId);
    // El final normal del calendario: Stripe ya cobró (o intentó) todas.
    if (!cuotas.length) return { skipped: 'no quedaba ninguna cuota programada (fin del calendario)', deshacer: true };
    const id = await model.registrar(db, {
      projectId: ca.project_id, conversionId, origen: 'cobro_automatico', referencia: ca.stripe_schedule_id,
      eventoTipo: event.type, eventId: event.id, motivo: m.motivo, detalle: m.detalle, cuando: m.cuando,
    });
    if (!id) return { repetido: true, deshacer: true };
    await model.cuotasCanceladas(db, cuotas, 'cobro automático cancelado en Stripe', { motivo: m.motivo, evento: event.id || null });
    const marcadas = await model.marcarCuotas(db, cuotas, m);
    await model.apuntarCuotas(db, id, marcadas);
    await model.quitarPorStripe(db, conversionId, m);
    return { cancelado: true, id, conversionId, cuotas: marcadas, origen: 'cobro_automatico' };
  }));
  if (!r.cancelado) return r;
  logger.info({ conversionId, cuotas: r.cuotas.length, tipo: event.type }, 'Cobro automático cancelado en Stripe: cuotas marcadas');
  // Si el calendario sigue vivo en Stripe (suscripción impagada), se cancela; y se borra de la venta.
  cobroAuto.alCambiarElPlan(conversionId);
  await avisar(r, m);
  return r;
}

async function facturaDeCuota({ cuota, inv, event, m }) {
  const cobroAuto = await import('../links-pago/links-pago.cobro-auto.js');
  const conversionId = Number(cuota.conversion_id);
  const r = await cobroAuto.conCandado(conversionId, () => enTransaccion(async (db) => {
    const c = await model.cuotaParaCancelar(db, cuota.installment_id);
    // Cobrada (lo anuló el CRM porque se pagó por otro lado), quitada o ya cancelada: nada.
    if (!c || c.fecha_cobro) return { skipped: 'la cuota ya está cobrada en la venta', deshacer: true };
    if (!['programada', 'fallida'].includes(c.estado)) return { skipped: `la cuota está ${c.estado}`, deshacer: true };
    if (c.stripe_invoice_id && c.stripe_invoice_id !== inv.id) return { skipped: 'es otra factura de esa cuota', deshacer: true };
    const id = await model.registrar(db, {
      projectId: c.project_id, conversionId, origen: 'cobro_automatico', referencia: inv.id,
      eventoTipo: event.type, eventId: event.id, motivo: m.motivo, detalle: m.detalle, cuando: m.cuando,
    });
    if (!id) return { repetido: true, deshacer: true };
    await model.cuotasCanceladas(db, [Number(c.installment_id)], 'factura de Stripe anulada o incobrable', { motivo: m.motivo, factura: inv.id });
    const marcadas = await model.marcarCuotas(db, [Number(c.installment_id)], m);
    await model.apuntarCuotas(db, id, marcadas);
    return { cancelado: true, id, conversionId, cuotas: marcadas, origen: 'cobro_automatico' };
  }));
  if (!r.cancelado) return r;
  logger.info({ conversionId, cuota: cuota.installment_id, tipo: event.type }, 'Cobro automático: Stripe ya no cobrará esta cuota');
  await avisar(r, m);
  return r;
}

// ─── Las ventas a plazos con suscripción (#747) ─────────────────────────────

const CERRADA_POR_EL_CRM = new Set(['cerrando', 'cancelada', 'ya_cerrada', 'cancelada_en_stripe']);

async function suscripcion({ subId, campus, event, m, referencia, cerrada = true, soloUnaCuota = false }) {
  const r = await enTransaccion(async (db) => {
    const v = await model.ventaDeLaSuscripcion(db, subId, campus);
    if (!v) return { skipped: 'la suscripción no es de ninguna venta', deshacer: true };
    // La cerró el CRM al cobrarse entera (o ya se apuntó): nada.
    if (v.suscripcion_cerrada_at || CERRADA_POR_EL_CRM.has(v.suscripcion_estado)) {
      return { skipped: `la suscripción de la venta ya estaba ${v.suscripcion_estado || 'cerrada'}`, deshacer: true };
    }
    // Pagada entera: no hay nada que cobrar; solo se apunta cerrada.
    if (Number(v.importe_total) > 0 && Number(v.cobrado) + MARGEN >= Number(v.importe_total)) {
      if (!soloUnaCuota) await model.suscripcionCancelada(db, v.id, { estado: 'ya_cerrada', cerradaEl: m.cuando });
      return { pagada: true, conversionId: v.id };
    }
    const id = await model.registrar(db, {
      projectId: v.project_id, conversionId: v.id, origen: 'suscripcion', referencia,
      eventoTipo: event.type, eventId: event.id, motivo: m.motivo, detalle: m.detalle, cuando: m.cuando,
    });
    if (!id) return { repetido: true, deshacer: true };
    const cuotas = await model.cuotasSinCobrar(db, v.id, { soloLaPrimera: soloUnaCuota });
    const marcadas = await model.marcarCuotas(db, cuotas, m);
    await model.apuntarCuotas(db, id, marcadas);
    // Una factura suelta no cancela la suscripción: sigue cobrando las demás.
    if (!soloUnaCuota) {
      await model.suscripcionCancelada(db, v.id, { estado: 'cancelada_en_stripe', cerradaEl: cerrada ? m.cuando : null });
    }
    return { cancelado: true, id, conversionId: v.id, cuotas: marcadas, origen: 'suscripcion' };
  });
  if (r.cancelado) {
    logger.info({ conversionId: r.conversionId, cuotas: r.cuotas.length, tipo: event.type }, 'Venta a plazos: Stripe ha dejado de cobrar la suscripción');
    await avisar(r, m);
  }
  return r;
}

async function reactivada({ subId, campus, event }) {
  const r = await enTransaccion(async (db) => {
    const v = await model.ventaDeLaSuscripcion(db, subId, campus);
    if (!v || v.suscripcion_estado !== 'cancelada_en_stripe' || v.suscripcion_cerrada_at) {
      return { skipped: 'nada que reactivar', deshacer: true };
    }
    const filas = await model.reactivarSuscripcion(db, v.id, subId);
    return { reactivada: true, conversionId: v.id, filas: filas.length };
  });
  if (r.reactivada) {
    logger.info({ conversionId: r.conversionId, tipo: event.type }, 'Venta a plazos: la suscripción vuelve a cobrarse sola');
    await avisar({ ...r, cuotas: [] }, { motivo: 'La suscripción de Stripe vuelve a cobrarse sola.' }, { reactivada: true });
  }
  return r;
}

// ─── El aviso ───────────────────────────────────────────────────────────────

/**
 * A la gestora de la venta (la vendedora o, si no, la responsable de la ficha)
 * y a los admins del campus. Una vez por cancelación. Nunca lanza.
 */
export async function avisar(r, m, { reactivada = false } = {}) {
  try {
    if (!reactivada && !(await model.reservarAviso(r.id))) return { avisado: false, motivo: 'YA_AVISADO' };
    const v = await model.ventaParaAvisar(r.conversionId);
    if (!v) return { avisado: false, motivo: 'SIN_VENTA' };
    if (v.baja_fecha && !reactivada) {
      logger.info({ conversionId: v.id }, 'Cobro cancelado en Stripe: el alumno está de baja; sin aviso');
      return { avisado: false, motivo: 'DE_BAJA' };
    }
    const gestora = v.vendedora_id || v.responsable_id || null;
    const para = [...new Set([gestora, ...(await model.adminsDelCampus(v.project_id))].filter(Boolean).map(Number))];
    if (!para.length) {
      if (!reactivada) await model.soltarAviso(r.id);
      return { avisado: false, motivo: 'SIN_DESTINATARIOS' };
    }
    const n = r.cuotas.length;
    const alumno = v.lead_nombre || 'un alumno';
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    const hecho = await notifyUsers({
      targetUserIds: para,
      type: 'stripe_cobro_cancelado',
      title: reactivada
        ? `La suscripción de ${alumno} vuelve a cobrarse sola en Stripe`
        : `Cobro automático cancelado en Stripe: ${n ? `${n} cuota${n === 1 ? '' : 's'} de ` : ''}${alumno}`,
      message: reactivada
        ? `${m.motivo} No le mandes link de las cuotas que cobra Stripe.`
        : `${m.motivo} ${n === 1 ? 'La cuota sigue pendiente' : n ? `Las ${n} cuotas siguen pendientes` : 'Lo que falta sigue pendiente'}: `
          + 'mándale un link de pago desde la venta o habla con el alumno.',
      link_path: rutaDeLaVenta(v.id),
      metadata: { conversion_id: v.id, lead_id: v.lead_id, project_id: v.project_id, installment_ids: r.cuotas, origen: r.origen ?? 'suscripcion' },
    });
    if (!hecho) {
      if (!reactivada) await model.soltarAviso(r.id);
      return { avisado: false, motivo: 'CAMPANA_FALLO' };
    }
    return { avisado: true, destinatarios: para.length };
  } catch (err) {
    logger.warn({ err: err.message, conversionId: r?.conversionId }, 'Cobro cancelado en Stripe: no salió el aviso');
    return { avisado: false, motivo: 'ERROR' };
  }
}

// ─── Lo que pasó antes de escuchar estos avisos ─────────────────────────────

/*
  REPASO (al desplegar; `scripts/cobros-cancelados-en-stripe.mjs`). Lo que Stripe
  canceló antes de que el CRM escuchara estos avisos no va a llegar nunca. Esto
  pregunta a Stripe (solo lectura) por cada suscripción abierta de una venta a
  plazos y por cada calendario del cobro automático, y lo que esté cancelado o
  impagado lo trata como si acabara de llegar su aviso. Sin `aplicar`, solo dice
  lo que haría. Las mismas llaves: pasarlo dos veces no marca ni avisa dos veces.
*/
export async function repasar({ aplicar = false, llamar = null, clave = null } = {}) {
  const { query } = await import('../../shared/config/db.js');
  const sus = await import('./suscripciones.service.js');
  const leerClave = clave || ((pid) => sus.claveDeStripe(pid, { escritura: true }));
  const pedir = llamar || (async (apiKey, ruta) => {
    const { stripeGet } = await import('./stripe-payments.service.js');
    return stripeGet(apiKey, ruta);
  });
  const ahora = Math.floor(Date.now() / 1000);
  const salida = [];

  const { rows: plazos } = await query(
    `SELECT id, project_id, stripe_subscription_id FROM conversions
      WHERE stripe_subscription_id IS NOT NULL AND suscripcion_cerrada_at IS NULL
        AND suscripcion_estado IS DISTINCT FROM 'cancelada_en_stripe'
      ORDER BY id`);
  const { rows: calendarios } = await query(
    `SELECT conversion_id AS id, project_id, stripe_schedule_id FROM conversion_cobro_auto
      WHERE activo AND stripe_schedule_id IS NOT NULL ORDER BY conversion_id`);

  const filas = [
    ...plazos.map((v) => ({ ...v, origen: 'suscripcion', ruta: `/v1/subscriptions/${v.stripe_subscription_id}` })),
    ...calendarios.map((v) => ({ ...v, origen: 'cobro_automatico', ruta: `/v1/subscription_schedules/${v.stripe_schedule_id}` })),
  ];
  for (const v of filas) {
    const fila = { conversionId: Number(v.id), projectId: Number(v.project_id), origen: v.origen, estadoStripe: null, resultado: null };
    salida.push(fila);
    try {
      const apiKey = await leerClave(Number(v.project_id));
      if (!apiKey) { fila.resultado = 'sin clave de Stripe'; continue; }
      const obj = await pedir(apiKey, v.ruta);
      fila.estadoStripe = obj?.status || null;
      let event = null;
      if (v.origen === 'suscripcion') {
        if (obj?.status === 'canceled') event = { type: 'customer.subscription.deleted', data: { object: obj } };
        else if (PERDIDA.has(obj?.status)) event = { type: 'customer.subscription.updated', data: { object: obj, previous_attributes: { status: 'active' } } };
      } else if (obj?.status === 'canceled') {
        event = { type: 'subscription_schedule.canceled', data: { object: obj } };
      }
      if (!event) { fila.resultado = 'sigue cobrándose'; continue; }
      if (!aplicar) { fila.resultado = 'se marcaría'; continue; }
      const r = await desdeElAviso(Number(v.project_id), { id: null, created: ahora, ...event });
      fila.resultado = r?.skipped || (r?.cancelado ? `marcada (${r.cuotas.length} cuotas)` : r?.pagada ? 'pagada: cerrada sin aviso' : r?.repetido ? 'ya estaba' : 'nada');
    } catch (err) {
      fila.resultado = `error: ${err.message}`;
    }
  }
  return salida;
}
