import * as model from './links-pago.cobro-auto.model.js';
import * as linksModel from './links-pago.model.js';
import * as linksService from './links-pago.service.js';
import * as stripe from './links-pago.stripe.js';
import { armarTarjetaGuardada, armarCobroFallido } from './links-pago.cobro-auto.emails.js';
import { cobroAutomaticoActivo } from '../../shared/config/soloEnPruebas.js';
import { getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  COBRO AUTOMÁTICO DE LAS CUOTAS CON STRIPE (#680; Diego, 19/11/2026).

  «Que cada cuota se cobre en la fecha que ellas digan.» La fecha la pacta la
  gestora con cada alumno: es la fecha de cada cuota en el plan de la venta. Y lo
  cobra STRIPE, no un cron del CRM:

    1. La gestora marca «Cobrar automáticamente con Stripe en las fechas de las
       cuotas» al generar el plan de pago (o lo activa en la venta).
    2. El link de la primera cuota pendiente GUARDA LA TARJETA: Payment Link con
       `setup_future_usage=off_session` y cliente de Stripe. Junto al botón de
       pagar, el alumno lee que autoriza los cobros siguientes (su consentimiento).
    3. Al pagarlo, se apunta la tarjeta en la venta (marca y cuatro cifras; nunca
       el número) y se programa en Stripe un SUBSCRIPTION SCHEDULE con una fase
       por cuota pendiente: empieza en la fecha de la cuota (a las 9:00 de
       Madrid), cobra su importe una vez y dura hasta la siguiente. Al acabar, se
       cancela solo.
    4. Cada cobro llega como factura de Stripe (`invoice.paid`): su línea lleva el
       precio de ESA cuota, que el CRM tiene apuntado, y entra por el camino de
       siempre (`addPayment(..., { cuotaId })`) saldando esa cuota.
    5. Si la gestora cambia en el CRM la fecha o el importe de una cuota, o la
       borra, o se cobra por otro lado, el CRM rehace las fases en Stripe
       (`sincronizar`). Lo que Stripe no admite (una fecha de hoy o pasada, más de
       un año entre cuotas, menos de 0,50 €) se queda fuera y la pantalla lo dice.

  POR QUÉ UN SCHEDULE Y NO UNA SUSCRIPCIÓN NORMAL: una suscripción cobra siempre
  lo mismo cada mes. Las cuotas del CRM tienen importes y fechas que pacta la
  gestora (irregulares). Un schedule admite una fase por cuota con su precio y su
  fecha. Cada precio es «cada N días», con N = lo que dura su fase: dentro de su
  fase Stripe cobra una sola vez. Si hay que alargar la fase en curso, el hueco se
  cubre con una fase de 0 € (no cobra nada).

  FALLOS: Stripe NO reintenta por su cuenta (se apaga `auto_advance` de la
  factura al primer fallo: sus reintentos son de la cuenta entera y pueden ser
  varios). Se avisa a la gestora, al alumno le llega el link de pago de ESA
  factura (pagarlo salda esa cuota y no hay dos cobros) y, si el fallo puede
  arreglarse solo (fondos…), el CRM pide UN reintento a los días del campus.

  NUNCA DOS VECES LA MISMA CUOTA: cada cuota es una fase de una sola factura; el
  cobro se ata por su precio, no por el correo; una cuota que se paga por otro
  lado sale del schedule; si tenía una factura fallida abierta, se anula; el
  importe programado nunca pasa de lo pendiente de la venta.

  Apagado en producción salvo COBRO_AUTOMATICO_EN_PRODUCCION=1, y por campus
  (Integraciones › Links de pago, apagado de serie).

  LA CLAVE: la de escritura del campus (`stripe_links`). Además de lo de los
  links necesita Subscription Schedules, Subscriptions e Invoices de escritura
  (y Customers de lectura). Se comprueba la lectura al activarlo.
*/

const ZONA = 'Europe/Madrid';
/** A qué hora (de Madrid, hora de invierno) empieza cada fase: Stripe cobra a esa hora. */
export const HORA_DE_COBRO = 9;
/** Stripe no admite un precio «cada más de 365 días». */
const MAX_DIAS = 365;
/** Stripe no cobra menos de 0,50 €. */
const MINIMO = 0.5;

/*
  Rechazos que no se arreglan esperando unos días: no se reintentan. El alumno
  paga con el link de la factura (confirmando, o con otra tarjeta).
*/
const NO_SE_REINTENTA = new Set([
  'authentication_required', 'expired_card', 'lost_card', 'stolen_card', 'pickup_card', 'fraudulent',
  'incorrect_number', 'incorrect_cvc', 'invalid_account', 'restricted_card', 'card_not_supported',
  'currency_not_supported', 'new_account_information_available', 'revocation_of_authorization',
  'revocation_of_all_authorizations', 'stop_payment_order', 'security_violation',
]);

// ─── Fechas ─────────────────────────────────────────────────────────────────

/** La fecha de hoy en Madrid, `AAAA-MM-DD`. */
export function hoyEnMadrid(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/**
 * El instante (segundos) en que Stripe cobra una cuota: su fecha a las 9:00 de
 * Madrid en hora de invierno (las 10:00 en verano). Siempre con el mismo desfase:
 * así entre dos fechas hay días justos y las fases encajan.
 */
export function instanteDe(fecha) {
  return Math.floor(Date.parse(`${String(fecha).slice(0, 10)}T${String(HORA_DE_COBRO).padStart(2, '0')}:00:00+01:00`) / 1000);
}

const DIA = 86400;
const diasEntre = (a, b) => Math.round((b - a) / DIA);
const sumarDias = (f, n) => {
  const d = new Date(`${f}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const redondear = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Lo que se puede programar en Stripe. No llama a nada.
 *   · por fecha: el importe de cada cuota, nunca más de lo que le queda a la venta;
 *   · solo fechas de mañana en adelante (Stripe no programa en el pasado);
 *   · al menos 0,50 €; y como mucho un año entre una cuota y la siguiente.
 * `{ fases: [{ installmentId, numero, fecha, importe, dias }], problemas: [{ installmentId, numero, motivo }] }`
 * `yaEnStripe`: las cuotas que ya tienen su factura (cobrada o fallida): no se vuelven a programar.
 */
export function planificar({ cuotas, pendiente, hoy, yaEnStripe = new Set() }) {
  let queda = redondear(pendiente);
  const fases = [];
  const problemas = [];
  for (const c of cuotas) {
    const importe = redondear(Math.min(Number(c.importe), Math.max(queda, 0)));
    queda = redondear(queda - importe);
    if (yaEnStripe.has(Number(c.id))) continue;
    const fecha = String(c.vence).slice(0, 10);
    const p = (motivo) => problemas.push({ installmentId: Number(c.id), numero: c.numero, motivo });
    if (fecha <= hoy) { p('Su fecha es hoy o ya pasó: Stripe no programa cobros en el pasado. Cóbrala con su link o cambia la fecha.'); continue; }
    if (importe <= 0) { p('Ya está cubierta por lo cobrado de la venta: no se programa.'); continue; }
    if (importe < MINIMO) { p('Stripe no cobra menos de 0,50 €.'); continue; }
    fases.push({ installmentId: Number(c.id), numero: c.numero, fecha, importe });
  }
  // Cuánto dura cada fase: hasta la siguiente cuota. La última, un día.
  const buenas = [];
  for (let i = 0; i < fases.length; i += 1) {
    const f = fases[i];
    const sig = fases[i + 1];
    const dias = sig ? diasEntre(instanteDe(f.fecha), instanteDe(sig.fecha)) : 1;
    if (dias > MAX_DIAS) {
      buenas.push({ ...f, dias: 1 });
      for (const r of fases.slice(i + 1)) {
        problemas.push({ installmentId: r.installmentId, numero: r.numero, motivo: 'Hay más de un año entre dos cuotas: Stripe no lo admite. Cóbrala con su link.' });
      }
      break;
    }
    buenas.push({ ...f, dias });
  }
  return { fases: buenas, problemas };
}

/** El texto que el alumno lee junto al botón de pagar: su consentimiento. */
export function textoConsentimiento({ campus, cuotas = [] }) {
  const n = cuotas.length;
  const total = cuotas.reduce((t, c) => t + Number(c.importe || 0), 0);
  const cuanto = n
    ? ` (${n} cuota${n === 1 ? '' : 's'}, ${total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € en total)`
    : '';
  return `Al pagar, guardas esta tarjeta y autorizas a ${campus || 'tu centro'} a cobrar en ella, en sus fechas, las siguientes cuotas `
    + `de tu plan de pago${cuanto}. Si un cobro no sale, te avisaremos con un link para pagarlo. `
    + 'Puedes pedir a tu asesor que dejemos de cobrarlas así cuando quieras.';
}

// ─── Disponibilidad y estado de una venta ───────────────────────────────────

/** ¿Se puede activar en este campus? `{ disponible, motivo, campus }`. Sin llamar a Stripe. */
export async function disponibilidad(projectId, { env = process.env } = {}) {
  if (!cobroAutomaticoActivo(env)) {
    return { disponible: false, motivo: 'El cobro automático de cuotas está apagado en este servidor.' };
  }
  const campus = await model.delCampus(projectId);
  if (!campus?.permitido) {
    return { disponible: false, motivo: 'Este campus no tiene permitido el cobro automático. Lo enciende un admin en Integraciones › Links de pago.', campus };
  }
  if (!(await linksService.claveDeEscritura(projectId))) {
    return { disponible: false, motivo: 'Este campus no tiene la clave de links de pago (Integraciones › Links de pago).', campus };
  }
  return { disponible: true, motivo: null, campus };
}

/*
  ¿SE PUEDE CREAR UN LINK EN CUOTAS EN ESTE CAMPUS? (link sencillo, 20/11)

  «Cuotas» en «Crear link de pago» es el cobro automático: el link cobra la
  primera y Stripe las demás. Antes de crear el link, no después, se dice si no
  se puede y por qué: el campus no admite cuotas o no tiene permitido el cobro
  automático, la persona no tiene su permiso, o la clave de Stripe no puede
  programar cobros (se pregunta a Stripe, sin cobrar nada).
  `{ disponible, motivo, cuotas_max }`. Nunca lanza.
*/
export async function paraUnLinkEnCuotas(projectId, { cfg, puedeCobroAuto }) {
  const no = (motivo) => ({ disponible: false, motivo, cuotas_max: cfg?.cuotas_max ?? null });
  if (!cfg) return no('Campus no encontrado.');
  if (!cfg.cuotas_admitidas) return no('Este campus no admite pagos en cuotas. Lo cambia un admin en Integraciones › Links de pago.');
  if (!cfg.monedas.includes('EUR')) return no('Las cuotas van en euros y este campus no cobra en EUR.');
  if (!puedeCobroAuto) return no('No tienes el permiso «Cobro automático de cuotas»: pídeselo a un admin.');
  const disp = await disponibilidad(projectId);
  if (!disp.disponible) return no(disp.motivo);
  let clave;
  try {
    clave = await linksService.claveObligatoria(projectId);
  } catch (err) {
    return no(err.message);
  }
  try {
    await stripe.comprobarPermisosDeCobro(clave);
  } catch (err) {
    if (err instanceof stripe.ErrorDeStripe && (err.status === 401 || err.status === 403)) {
      return no(`La clave de links de pago de este campus no puede programar cobros: en Stripe le faltan los permisos ${PERMISOS_QUE_FALTAN}. Los añade Diego en la clave del panel de Stripe.`);
    }
    return no(`Stripe no ha contestado al comprobar la clave: ${err.message}`);
  }
  return { disponible: true, motivo: null, cuotas_max: cfg.cuotas_max };
}

function tarjetaDe(ca) {
  if (!ca?.stripe_payment_method_id) return null;
  return {
    marca: ca.tarjeta_marca || null,
    ultimos4: ca.tarjeta_ultimos4 || null,
    caduca: ca.tarjeta_caduca_mes && ca.tarjeta_caduca_anio ? `${String(ca.tarjeta_caduca_mes).padStart(2, '0')}/${ca.tarjeta_caduca_anio}` : null,
    guardada_el: ca.tarjeta_guardada_el || null,
  };
}

const conFactura = (enStripe) => new Set(enStripe
  .filter((r) => r.stripe_invoice_id && ['cobrada', 'fallida'].includes(r.estado))
  .map((r) => Number(r.installment_id)));

/**
 * Lo que enseña la pantalla: si se puede, si está activo, la tarjeta y, cuota a
 * cuota, qué tiene Stripe y qué ha pasado. `problema`: por qué una cuota no se
 * cobrará sola. `desfasada`: la fecha o el importe del CRM aún no están en Stripe.
 */
export async function estadoDeLaVenta(conversionId, projectId, { hoy = hoyEnMadrid() } = {}) {
  const [disp, ca, enStripe, plan] = await Promise.all([
    disponibilidad(projectId), model.deLaVenta(conversionId), model.cuotasEnStripe(conversionId), model.planDeLaVenta(conversionId),
  ]);
  const { problemas, fases } = planificar({ cuotas: plan.cuotas, pendiente: plan.pendiente, hoy, yaEnStripe: conFactura(enStripe) });
  const porCuota = new Map(enStripe.map((r) => [Number(r.installment_id), r]));
  const problemaDe = new Map(problemas.map((p) => [p.installmentId, p.motivo]));
  const faseDe = new Map(fases.map((f) => [f.installmentId, f]));
  const conTarjeta = !!ca?.stripe_payment_method_id;
  return {
    disponible: disp.disponible,
    motivo_no_disponible: disp.motivo,
    reintento_dias: disp.campus?.reintento_dias ?? null,
    activo: ca?.activo === true,
    activado_el: ca?.activado_el ?? null,
    tarjeta: tarjetaDe(ca),
    stripe_schedule_id: ca?.stripe_schedule_id || null,
    sincronizado_el: ca?.sincronizado_el || null,
    sync_error: ca?.sync_error || null,
    hora_de_cobro: HORA_DE_COBRO,
    cuotas: plan.cuotas.map((c, i) => {
      const r = porCuota.get(Number(c.id));
      const f = faseDe.get(Number(c.id));
      const esLaPrimera = i === 0 && !conTarjeta;
      return {
        installment_id: Number(c.id), numero: c.numero, vence: c.vence, importe: Number(c.importe),
        estado: r?.estado ?? null,
        fecha_programada: r?.estado === 'programada' ? r.fecha_programada : null,
        importe_programado: r?.estado === 'programada' ? r.importe_programado : null,
        desfasada: !!(ca?.activo && conTarjeta && f && (!r || r.estado !== 'programada'
          || r.fecha_programada !== f.fecha || Number(r.importe_programado) !== f.importe)),
        intentos: r?.intentos ?? 0,
        error_codigo: r?.error_codigo ?? null,
        reintento_el: r?.reintento_el ?? null,
        url_pago: r?.estado === 'fallida' ? r.url_pago : null,
        historial: r?.historial ?? [],
        // La primera, sin tarjeta todavía, la paga el alumno con su link (y la guarda).
        guarda_tarjeta: esLaPrimera,
        problema: esLaPrimera ? null : (problemaDe.get(Number(c.id)) || null),
      };
    }),
  };
}

/**
 * Si los links de esta venta deben guardar la tarjeta: con el cobro automático
 * activo. Devuelve el `{ consentimiento }` para el link, o null.
 */
export async function guardaTarjetaPara(conversionId) {
  if (!cobroAutomaticoActivo()) return null;
  const ca = await model.deLaVenta(conversionId);
  if (!ca?.activo) return null;
  const v = await model.ventaParaCobrar(conversionId);
  const { cuotas } = await model.planDeLaVenta(conversionId);
  return { consentimiento: textoConsentimiento({ campus: v?.campus, cuotas: cuotas.slice(1) }) };
}

// ─── Activar y desactivar ───────────────────────────────────────────────────

async function crearLinkDeCuota({ venta, cuota, userId, guardaTarjeta }) {
  if (!venta.producto_contratado_id) {
    throw new AppError('La venta no tiene curso: ponle el curso antes de activar el cobro automático.', 400, 'VENTA_SIN_CURSO');
  }
  const prod = await linksModel.producto(venta.producto_contratado_id);
  if (!prod || Number(prod.project_id) !== Number(venta.project_id)) {
    throw new AppError('El curso de la venta no es del catálogo de este campus.', 400, 'VALIDATION_ERROR');
  }
  const cfg = await linksModel.config(venta.project_id);
  const reglas = linksService.reglasDeCuota({ cfg, prod, vence: cuota.vence });
  return linksService.crear({
    projectId: Number(venta.project_id), leadId: venta.lead_id, conversionId: venta.id, prod, reglas,
    importe: Number(cuota.importe), userId, cuota: { id: cuota.id, numero: cuota.numero, vence: cuota.vence }, guardaTarjeta,
  });
}

export const PERMISOS_QUE_FALTAN = 'Subscription Schedules, Subscriptions e Invoices (escritura) y Customers (lectura)';

/**
 * Activar el cobro automático de una venta.
 *   · comprueba el servidor, el campus y que la clave pueda leer schedules y
 *     facturas (no cobra nada);
 *   · si aún no hay tarjeta, deja la primera cuota pendiente con un link que la
 *     guarda (el que tenía sin guardarla se anula y se crea otro);
 *   · si ya hay tarjeta, programa las cuotas en Stripe ahora.
 */
export async function activar({ venta, userId }) {
  const projectId = Number(venta.project_id);
  const disp = await disponibilidad(projectId);
  if (!disp.disponible) throw new AppError(disp.motivo, 409, 'COBRO_AUTO_NO_DISPONIBLE');
  const clave = await linksService.claveObligatoria(projectId);
  try {
    await stripe.comprobarPermisosDeCobro(clave);
  } catch (err) {
    if (err instanceof stripe.ErrorDeStripe && (err.status === 401 || err.status === 403)) {
      throw new AppError(`La clave de links de pago de este campus no puede programar cobros: en Stripe le faltan los permisos ${PERMISOS_QUE_FALTAN}. `
        + 'Los añade Diego en la clave del panel de Stripe.', 424, 'CLAVE_SIN_PERMISO_DE_COBRO');
    }
    throw new AppError(`Stripe no ha contestado al comprobar la clave: ${err.message}`, 424, 'STRIPE_ERROR');
  }
  const { cuotas } = await model.planDeLaVenta(venta.id);
  if (!cuotas.length) throw new AppError('Esta venta no tiene cuotas pendientes: no hay nada que cobrar solo.', 400, 'SIN_CUOTAS');

  const antes = await model.deLaVenta(venta.id);
  await model.poner(venta.id, { projectId, activo: true, userId });
  logger.info({ conversionId: venta.id, projectId, userId }, 'Cobro automático: activado');

  // Las cuotas que cobrará Stripe (todas si ya hay tarjeta; si no, todas menos la
  // primera) no llevan link vivo: el alumno no debe pagar a mano una cuota el
  // mismo día que Stripe la cobra.
  const conTarjeta = !!antes?.stripe_payment_method_id;
  for (const c of conTarjeta ? cuotas : cuotas.slice(1)) {
    const vivoDeOtra = await model.linkVivoDeLaCuota(c.id);
    if (vivoDeOtra) {
      await linksService.anular(await linksModel.porId(vivoDeOtra.id),
        { userId, motivo: 'Esta cuota la cobra Stripe sola en su fecha (cobro automático).' });
    }
  }
  if (conTarjeta) {
    await sincronizar(venta.id);
    return { linkPrimera: null };
  }
  // Sin tarjeta: el link de la primera cuota pendiente tiene que guardarla.
  const primera = cuotas[0];
  const vivo = await model.linkVivoDeLaCuota(primera.id);
  if (vivo?.guarda_tarjeta) return { linkPrimera: vivo };
  const guardaTarjeta = await guardaTarjetaPara(venta.id);
  if (vivo) {
    const completo = await linksModel.porId(vivo.id);
    await linksService.anular(completo, { userId, motivo: 'Se sustituye por un link que guarda la tarjeta (cobro automático de las cuotas).' });
  }
  return { linkPrimera: await crearLinkDeCuota({ venta, cuota: primera, userId, guardaTarjeta }) };
}

/** Desactivarlo: se cancela el calendario en Stripe. La tarjeta se queda apuntada. */
export async function desactivar({ venta, userId }) {
  await model.poner(venta.id, { projectId: Number(venta.project_id), activo: false, userId });
  logger.info({ conversionId: venta.id, userId }, 'Cobro automático: desactivado');
  return sincronizar(venta.id);
}

// ─── La tarjeta, al pagarse un link que la guarda ───────────────────────────

/**
 * Lo llama `trasCobrar` (links-pago.cobro.js) la primera vez que se paga un link.
 * Si el link guardaba la tarjeta y se pagó con tarjeta, se apunta en la venta, se
 * programan las cuotas en Stripe y se le dice al alumno qué se le cobrará y
 * cuándo. Nunca lanza.
 */
export async function trasPagarseUnLink(link, payment, conversionId) {
  try {
    if (!link?.guarda_tarjeta || !conversionId || payment?.status !== 'succeeded') return false;
    if (!payment.stripe_payment_method_id || !payment.customer_stripe_id || !payment.tarjeta) {
      await linksModel.anotarEventoDelCargo(link.id, 'tarjeta_no_guardada', {
        stripe_id: payment?.stripe_id, metodo: payment?.payment_method || null,
        motivo: 'no se pagó con tarjeta o Stripe no la guardó en un cliente',
      });
      return false;
    }
    const nueva = await model.guardarTarjeta(conversionId, {
      projectId: Number(link.project_id), customerId: payment.customer_stripe_id,
      paymentMethodId: payment.stripe_payment_method_id, tarjeta: payment.tarjeta, linkId: link.id,
    });
    if (!nueva) return false;
    await linksModel.anotarEventoDelCargo(link.id, 'tarjeta_guardada', {
      stripe_id: payment.stripe_id, marca: payment.tarjeta.marca, ultimos4: payment.tarjeta.ultimos4,
    });
    logger.info({ conversionId, linkId: link.id }, 'Cobro automático: tarjeta guardada');

    const ca = await model.deLaVenta(conversionId);
    if (!ca?.activo) return true;
    const r = await sincronizar(conversionId);
    const v = await model.ventaParaCobrar(conversionId);
    if (v?.lead_email && r?.fases?.length) {
      const c = armarTarjetaGuardada({ v, ca, cuotas: r.fases.map((f) => ({ numero: f.numero, importe: f.importe, vence: f.fecha })) });
      const { sendEmail } = await import('../../shared/services/brevo.service.js');
      await sendEmail({
        to: [{ email: v.lead_email, name: v.lead_nombre || undefined }], subject: c.asunto,
        htmlContent: c.htmlContent, textContent: c.textContent, tags: ['cobro-automatico', 'tarjeta-guardada'],
        projectId: v.project_id, clave: `cobro-auto-tarjeta-${conversionId}-${payment.stripe_payment_method_id}`,
      }).catch((e) => logger.warn({ err: e.message, conversionId }, 'Cobro automático: no salió el correo de la tarjeta guardada'));
    }
    return true;
  } catch (err) {
    logger.error({ err: err.message, linkId: link?.id, conversionId }, 'Cobro automático: no se pudo apuntar la tarjeta');
    return false;
  }
}

// ─── Pasar el plan a Stripe ─────────────────────────────────────────────────

const idDe = (x) => (x && typeof x === 'object' ? x.id : x) || null;

async function conCandado(conversionId, fn) {
  const c = await getClient();
  try {
    await c.query('SELECT pg_advisory_lock(hashtext($1), $2)', ['cobro_auto', Number(conversionId)]);
    return await fn();
  } finally {
    await c.query('SELECT pg_advisory_unlock(hashtext($1), $2)', ['cobro_auto', Number(conversionId)]).catch(() => {});
    c.release();
  }
}

/**
 * Deja Stripe como dice el CRM: una fase por cada cuota que se pueda programar.
 * Si nada ha cambiado desde la última vez, no llama a Stripe. Nunca lanza:
 * devuelve `{ fases, problemas }` o `{ error }`, y el error queda en la venta
 * para que la pantalla lo enseñe.
 */
export async function sincronizar(conversionId, { ahora = new Date() } = {}) {
  if (!cobroAutomaticoActivo()) return { apagado: true };
  return conCandado(conversionId, async () => {
    const ca = await model.deLaVenta(conversionId);
    if (!ca) return { nada: true };
    let clave;
    try {
      clave = await linksService.claveObligatoria(ca.project_id);
    } catch (err) {
      await model.anotarSincronizacion(conversionId, { error: err.message });
      return { error: err.message };
    }
    try {
      // Desactivado, sin tarjeta o con el campus apagado: fuera el calendario.
      const campus = await model.delCampus(ca.project_id);
      if (!ca.activo || !ca.stripe_payment_method_id || !campus?.permitido) {
        if (ca.stripe_schedule_id) {
          const s = await stripe.verCalendario(clave, ca.stripe_schedule_id).catch(() => null);
          if (s && ['not_started', 'active'].includes(s.status)) await stripe.cancelarCalendario(clave, ca.stripe_schedule_id);
          await model.quitarLasDemas(conversionId, []);
          await model.anotarSincronizacion(conversionId, { scheduleId: '', firma: null });
        }
        return { fases: [], problemas: [] };
      }

      const hoy = hoyEnMadrid(ahora);
      const enStripe = await model.cuotasEnStripe(conversionId);
      // Una factura fallida que el alumno ya pagó por otro lado (su link) no se cobra: se anula.
      for (const f of await model.fallidasYaPagadas(conversionId)) {
        try {
          await stripe.anularFactura(clave, f.stripe_invoice_id);
          await model.anotar(f.installment_id, 'factura anulada en Stripe: se pagó por otro lado', { factura: f.stripe_invoice_id }, 'quitada');
        } catch (err) {
          logger.warn({ err: err.message, factura: f.stripe_invoice_id }, 'Cobro automático: no se pudo anular la factura fallida');
        }
      }
      const plan = await model.planDeLaVenta(conversionId);
      const { fases, problemas } = planificar({ cuotas: plan.cuotas, pendiente: plan.pendiente, hoy, yaEnStripe: conFactura(enStripe) });
      const firma = JSON.stringify({ pm: ca.stripe_payment_method_id, f: fases.map((f) => [f.installmentId, f.fecha, f.importe, f.dias]) });
      if (firma === ca.fases_firma && (ca.stripe_schedule_id || !fases.length)) return { fases, problemas, sinCambios: true };

      const v = await model.ventaParaCobrar(conversionId);
      // ISEIE: una cuenta de Stripe por campus, sin la marca de plataforma de las cuentas
      // compartidas del 360 (conMarcaDePlataforma / filtroDeMetadata no existen aquí).
      const ent = linksService.entorno();
      const marca = (extra) => ({
        crm_cobro_auto: '1', crm_project_id: String(ca.project_id), crm_conversion_id: String(conversionId),
        crm_entorno: ent, ...extra,
      });

      // Un precio por cuota (importe y duración de su fase). La misma clave devuelve el mismo.
      const conPrecio = [];
      for (const f of fases) {
        const precio = await stripe.crearPrecioDeCuota(clave, {
          importe: f.importe, moneda: 'EUR', dias: f.dias,
          nombre: `${v?.producto_nombre || `Venta ${conversionId}`} · cuota ${f.numero}`,
          metadata: marca({ crm_installment_id: String(f.installmentId), crm_cuota_numero: String(f.numero) }),
          idempotencia: `crm-${ent}-cuota-${f.installmentId}-${f.fecha}-${f.importe}-${f.dias}`,
        });
        conPrecio.push({ ...f, priceId: precio.id, inicio: instanteDe(f.fecha), fin: instanteDe(f.fecha) + f.dias * DIA,
          metadata: marca({ crm_installment_id: String(f.installmentId) }) });
      }

      let actual = ca.stripe_schedule_id ? await stripe.verCalendario(clave, ca.stripe_schedule_id).catch((e) => {
        if (e instanceof stripe.ErrorDeStripe && e.status === 404) return null;
        throw e;
      }) : null;
      if (actual && !['not_started', 'active'].includes(actual.status)) actual = null;

      let scheduleId = actual?.id || null;
      if (!conPrecio.length) {
        // Nada que programar. Uno sin empezar se cancela; uno en curso acaba solo con su fase.
        if (actual?.status === 'not_started') { await stripe.cancelarCalendario(clave, actual.id); scheduleId = ''; }
      } else if (!actual) {
        const s = await stripe.crearCalendario(clave, {
          customerId: ca.stripe_customer_id, paymentMethodId: ca.stripe_payment_method_id, fases: conPrecio,
          metadata: marca({}), idempotencia: `crm-${ent}-calendario-${conversionId}-${Buffer.from(firma).toString('base64').slice(-40)}`,
        });
        scheduleId = s.id;
      } else if (actual.status === 'not_started') {
        await stripe.cambiarCalendario(clave, actual.id, { fases: conPrecio, paymentMethodId: ca.stripe_payment_method_id });
      } else {
        // En curso: la fase de ahora va la primera, tal cual (su precio y su inicio).
        // Se acorta hasta la siguiente cuota; si hay que alargarla más allá de lo que
        // dura su precio, el hueco va en una fase de 0 € (no cobra nada).
        const ahoraS = Math.floor(ahora.getTime() / 1000);
        const enCurso = (actual.phases || []).find((p) => p.start_date <= ahoraS && ahoraS < p.end_date)
          || (actual.current_phase ? (actual.phases || []).find((p) => p.start_date === actual.current_phase.start_date) : null);
        if (!enCurso) throw new Error('Stripe no dice cuál es la fase en curso del calendario');
        const largo = enCurso.end_date - enCurso.start_date;
        const primeraNueva = conPrecio[0].inicio;
        const fasesNuevas = [{
          priceId: idDe(enCurso.items?.[0]?.price), inicio: enCurso.start_date,
          fin: Math.min(primeraNueva, enCurso.start_date + largo), metadata: enCurso.metadata || {},
        }];
        if (primeraNueva > enCurso.start_date + largo) {
          const hueco = diasEntre(enCurso.start_date + largo, primeraNueva);
          if (hueco > MAX_DIAS) throw new Error('Hay más de un año sin cuotas: Stripe no lo admite.');
          const cero = await stripe.crearPrecioDeCuota(clave, {
            importe: 0, moneda: 'EUR', dias: hueco, nombre: 'Sin cuota (espera hasta la siguiente)',
            metadata: marca({ crm_hueco: '1' }),
            idempotencia: `crm-${ent}-hueco-${conversionId}-${enCurso.start_date + largo}-${hueco}`,
          });
          fasesNuevas.push({ priceId: cero.id, inicio: enCurso.start_date + largo, fin: primeraNueva, metadata: marca({ crm_hueco: '1' }) });
        }
        await stripe.cambiarCalendario(clave, actual.id, { fases: [...fasesNuevas, ...conPrecio], paymentMethodId: ca.stripe_payment_method_id });
      }

      for (const f of conPrecio) {
        await model.programar({ installmentId: f.installmentId, conversionId, projectId: ca.project_id,
          priceId: f.priceId, fecha: f.fecha, importe: f.importe });
      }
      await model.quitarLasDemas(conversionId, conPrecio.map((f) => f.installmentId));
      await model.anotarSincronizacion(conversionId, { scheduleId, firma });
      logger.info({ conversionId, cuotas: conPrecio.length, problemas: problemas.length, scheduleId }, 'Cobro automático: plan pasado a Stripe');
      return { fases, problemas };
    } catch (err) {
      const msg = err instanceof stripe.ErrorDeStripe && (err.status === 401 || err.status === 403)
        ? `Stripe no deja programar los cobros con la clave de este campus: le faltan permisos (${PERMISOS_QUE_FALTAN}).`
        : `Stripe no ha aceptado el plan: ${err.message}`;
      logger.warn({ err: err.message, conversionId }, 'Cobro automático: no se pudo pasar el plan a Stripe');
      await model.anotarSincronizacion(conversionId, { error: msg }).catch(() => {});
      return { error: msg };
    }
  });
}

/**
 * Tras cualquier cambio en las cuotas o los cobros de una venta (fecha, importe,
 * borrar, rehacer el plan, un cobro a mano): se pasa a Stripe sin hacer esperar a
 * quien lo cambió. Si falla, queda en la venta y el cron lo reintenta.
 */
export function alCambiarElPlan(conversionId) {
  if (!cobroAutomaticoActivo() || !conversionId) return;
  model.tieneCobroAuto(conversionId)
    .then((si) => (si ? sincronizar(conversionId) : null))
    .catch((err) => logger.warn({ err: err.message, conversionId }, 'Cobro automático: no se pudo repasar el plan'));
}

/** El campus se ha apagado (o encendido): se repasan sus ventas (las que tengan calendario se cancelan). */
export function alCambiarElCampus(projectId) {
  model.ventasDelCampus(projectId)
    .then(async (ids) => { for (const id of ids) await sincronizar(id); })
    .catch((err) => logger.warn({ err: err.message, projectId }, 'Cobro automático: no se pudo repasar el campus'));
}

/**
 * Antes de borrar una venta: si tiene calendario en Stripe, se cancela. Si Stripe
 * no deja, NO se borra (lanza): borrada, nadie sabría que Stripe sigue cobrando.
 */
export async function antesDeBorrarLaVenta(conversionId) {
  const ca = await model.deLaVenta(conversionId);
  if (!ca?.stripe_schedule_id) return;
  const clave = await linksService.claveDeEscritura(ca.project_id);
  try {
    if (!clave) throw new Error('el campus no tiene la clave de links de pago');
    const s = await stripe.verCalendario(clave, ca.stripe_schedule_id);
    if (['not_started', 'active'].includes(s.status)) await stripe.cancelarCalendario(clave, ca.stripe_schedule_id);
  } catch (err) {
    if (err instanceof stripe.ErrorDeStripe && err.status === 404) return;
    throw new AppError(`Esta venta tiene cuotas programadas en Stripe y no se han podido cancelar (${err.message}). `
      + 'Desactiva antes su cobro automático o cancélalo en Stripe.', 409, 'COBRO_AUTO_SIN_CANCELAR');
  }
}

// ─── Lo que llega de Stripe: las facturas de las cuotas ─────────────────────

/** Los precios de las líneas de una factura (las versiones de la API los ponen en sitios distintos). */
export function preciosDeFactura(inv) {
  return (inv?.lines?.data || [])
    .map((l) => idDe(l.price) || idDe(l.pricing?.price_details?.price) || idDe(l.plan))
    .filter(Boolean);
}

/** El PaymentIntent de una factura: en la factura (API antigua) o en sus pagos (desde 2025). */
async function pagoDeFactura(apiKey, inv) {
  const directo = idDe(inv.payment_intent);
  if (directo) return directo;
  const pagos = inv.payments?.data?.length ? inv.payments : null;
  const dePagos = pagos?.data?.map((p) => idDe(p.payment?.payment_intent)).find(Boolean);
  if (dePagos) return dePagos;
  if (!apiKey) return null;
  const { stripeGet } = await import('../stripe-payments/stripe-payments.service.js');
  try {
    const r = await stripeGet(apiKey, '/v1/invoice_payments', { invoice: inv.id, limit: 3 });
    return (r.data || []).map((p) => idDe(p.payment?.payment_intent)).find(Boolean) || null;
  } catch {
    return null;
  }
}

/**
 * Un cargo de Stripe, ¿es una cuota programada por el CRM? Para el camino de
 * siempre (`enlazarSiSePuede`): si el cliente es el de una venta con cobro
 * automático y su factura lleva el precio de una cuota, devuelve el destino con
 * la cuota que salda. Si parece nuestro pero no se puede saber todavía, se aplaza
 * (lo traerá el aviso de la factura o el siguiente sondeo). Si no, null.
 */
export async function cuotaDelCargo(projectId, payment) {
  if (!payment?.customer_stripe_id) return null;
  const ventas = await model.deCliente(projectId, payment.customer_stripe_id);
  if (!ventas?.some((v) => v.stripe_schedule_id)) return null;
  const { getStripeKey, stripeGet } = await import('../stripe-payments/stripe-payments.service.js');
  const apiKey = await getStripeKey(projectId);
  if (!apiKey) return { aplazado: true };
  let inv = null;
  try {
    let factura = payment.stripe_invoice_id || null;
    if (!factura && payment.stripe_payment_intent_id) {
      const r = await stripeGet(apiKey, '/v1/invoice_payments', {
        'payment[type]': 'payment_intent', 'payment[payment_intent]': payment.stripe_payment_intent_id, limit: 1,
      }).catch(() => null);
      factura = idDe(r?.data?.[0]?.invoice);
    }
    if (!factura) return null; // un pago suelto del mismo alumno (su link, otro curso)
    inv = await stripeGet(apiKey, `/v1/invoices/${factura}`);
  } catch (err) {
    logger.warn({ err: err.message, stripeId: payment.stripe_id }, 'Cobro automático: no se pudo leer la factura del cargo; se aplaza');
    return { aplazado: true };
  }
  const cuota = await model.cuotaDelPrecio(projectId, preciosDeFactura(inv));
  if (!cuota) return null;
  const v = await model.ventaParaCobrar(cuota.conversion_id);
  if (!v) return null;
  return {
    conv: { id: v.id },
    ficha: { id: v.lead_id, nombre: v.lead_nombre, responsable_id: v.responsable_id },
    metodoAuto: 'auto_cobro_cuota',
    email: payment.customer_email || v.lead_email || null,
    avisarA: v.vendedora_id || v.responsable_id || null,
    cuotaId: Number(cuota.installment_id),
    cobroAuto: { invoiceId: inv.id, numero: null },
  };
}

/** El cobro de una cuota ya está en su venta: la cuota, cobrada; y Stripe, al día. */
export async function trasCobrarCuota({ cuotaId, invoiceId, conversionId }) {
  try {
    await model.marcarCobrada(cuotaId, { invoiceId });
    alCambiarElPlan(conversionId);
  } catch (err) {
    logger.warn({ err: err.message, cuotaId }, 'Cobro automático: no se pudo marcar la cuota cobrada');
  }
}

/**
 * Los avisos `invoice.*` de Stripe de una cuota programada.
 *   · `invoice.paid`: devuelve el PaymentIntent para que el cargo entre por el
 *     camino de siempre (quien llama lo trae y lo asocia).
 *   · `invoice.payment_failed`: Stripe deja de reintentar, se apunta el fallo
 *     (y el único reintento, si toca), se avisa a la gestora y al alumno le llega
 *     el link de pago de esa factura. Una vez por intento.
 */
export async function desdeLaFactura(projectId, event, { ahora = new Date() } = {}) {
  const inv = event?.data?.object || {};
  const cuota = await model.cuotaDelPrecio(projectId, preciosDeFactura(inv));
  if (!cuota) return { skipped: 'no es una cuota del CRM' };
  const { getStripeKey, stripeGet } = await import('../stripe-payments/stripe-payments.service.js');
  const lectura = await getStripeKey(projectId);

  if (event.type === 'invoice.paid') {
    if (!(Number(inv.amount_paid) > 0)) return { skipped: 'factura de 0 €' };
    return { cuota, paymentIntent: await pagoDeFactura(lectura, inv) };
  }
  if (event.type !== 'invoice.payment_failed') return { skipped: event.type };
  if (!cobroAutomaticoActivo()) return { skipped: 'cobro automático apagado' };

  let error = {};
  const pi = await pagoDeFactura(lectura, inv);
  if (pi && lectura) {
    try { error = (await stripeGet(lectura, `/v1/payment_intents/${pi}`)).last_payment_error || {}; } catch { error = {}; }
  }
  const codigo = error.decline_code || error.code || 'card_declined';
  const campus = await model.delCampus(projectId);
  const primero = Number(cuota.intentos || 0) === 0;
  const reintentable = primero && !NO_SE_REINTENTA.has(codigo) && campus?.reintento_dias > 0;
  const reintentoEl = reintentable ? sumarDias(hoyEnMadrid(ahora), campus.reintento_dias) : null;

  // Que Stripe no reintente por su cuenta: el reintento, si toca, lo pide el CRM.
  try {
    const clave = await linksService.claveObligatoria(projectId);
    if (inv.auto_advance !== false) await stripe.pararReintentosDeStripe(clave, inv.id);
  } catch (err) {
    logger.warn({ err: err.message, factura: inv.id }, 'Cobro automático: no se pudo parar los reintentos de Stripe');
  }
  const fila = await model.marcarFallida(cuota.installment_id, {
    invoiceId: inv.id, url: inv.hosted_invoice_url || null, codigo, mensaje: error.message || null,
    reintentoEl, intentoDeStripe: Number(inv.attempt_count) || 1,
  });
  if (!fila) return { repetido: true };
  await avisarDelFallo(fila, { codigo, reintentoEl });
  return { fallida: true, reintentoEl };
}

async function avisarDelFallo(fila, { codigo, reintentoEl }) {
  const venta = await model.ventaParaCobrar(fila.conversion_id);
  const ca = await model.deLaVenta(fila.conversion_id);
  const numero = (await model.numeroDeCuota(fila.installment_id)) ?? '';
  const importe = Number(fila.importe_programado || 0);
  const destino = venta?.vendedora_id || venta?.responsable_id;
  if (destino) {
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    await notifyUsers({
      targetUserIds: [destino], type: 'cobro_automatico_fallido',
      title: `Stripe no ha podido cobrar la cuota ${numero} de ${venta?.lead_nombre || 'tu alumno'}`,
      message: `${importe.toFixed(2)} € · ${codigo}. Le hemos mandado al alumno el link para pagarla. `
        + (reintentoEl ? `Se reintenta una vez el ${reintentoEl.split('-').reverse().join('/')}.` : 'No se reintenta sola.'),
      link_path: `/ventas/${fila.conversion_id}`,
      metadata: { conversion_id: fila.conversion_id, installment_id: fila.installment_id, lead_id: venta?.lead_id ?? null },
    }).catch(() => {});
  }
  if (fila.url_pago && venta?.lead_email) {
    try {
      const c = armarCobroFallido({
        v: venta, ca, intento: { cuota_numero: numero, importe, error_codigo: codigo }, url: fila.url_pago, reintentoEl,
      });
      const { sendEmail } = await import('../../shared/services/brevo.service.js');
      await sendEmail({
        to: [{ email: venta.lead_email, name: venta.lead_nombre || undefined }], subject: c.asunto,
        htmlContent: c.htmlContent, textContent: c.textContent, tags: ['cobro-automatico', 'cobro-fallido'],
        projectId: venta.project_id, clave: `cobro-auto-fallido-${fila.stripe_invoice_id}-${fila.intentos}`,
      });
    } catch (err) {
      logger.warn({ err: err.message, cuota: fila.installment_id }, 'Cobro automático: no salió el correo al alumno');
    }
  }
  await model.marcarAvisado(fila.installment_id);
}

// ─── El cron: el único reintento y lo que no se pudo pasar a Stripe ─────────

export async function vuelta({ ahora = new Date(), lote = 25 } = {}) {
  const res = { reintentos: 0, sincronizadas: 0 };
  if (!cobroAutomaticoActivo()) return { ...res, apagado: true };
  const hoy = hoyEnMadrid(ahora);
  for (const f of await model.porReintentar(hoy, lote)) {
    res.reintentos += 1;
    try {
      const clave = await linksService.claveObligatoria(f.project_id);
      const inv = await stripe.reintentarFactura(clave, f.stripe_invoice_id, { idempotencia: `crm-${linksService.entorno()}-reintento-${f.stripe_invoice_id}` });
      await model.anotar(f.installment_id, inv?.status === 'paid' ? 'reintento cobrado' : `reintento: ${inv?.status}`);
    } catch (err) {
      // El rechazo llega también por el aviso `invoice.payment_failed`, que avisa.
      // Si el aviso no llega, se apunta aquí (una vez: misma factura, 2.º intento).
      if (err instanceof stripe.ErrorDeStripe && err.status === 402) {
        const fila = await model.marcarFallida(f.installment_id, {
          invoiceId: f.stripe_invoice_id, codigo: err.motivo || err.codigo || 'card_declined', mensaje: err.message, intentoDeStripe: 2,
        });
        if (fila) await avisarDelFallo(fila, { codigo: fila.error_codigo, reintentoEl: null });
      } else {
        await model.anotar(f.installment_id, 'el reintento no se pudo pedir', { error: err.message });
      }
    }
  }
  for (const conversionId of await model.ventasPorRepasar(lote)) {
    const r = await sincronizar(conversionId, { ahora });
    if (!r?.error) res.sincronizadas += 1;
  }
  if (res.reintentos || res.sincronizadas) logger.info(res, 'Cobro automático: vuelta');
  return res;
}
