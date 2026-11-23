import * as model from './links-pago.model.js';
import * as codigosModel from './links-pago.codigos.model.js';
import * as stripe from './links-pago.stripe.js';
import { claveObligatoria, claveDeEscritura, entorno, errorDeStripe, hoyEnMadrid, restaCentimos } from './links-pago.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  CÓDIGOS PROMOCIONALES EN LOS LINKS (CRM#986, Diego 21/11/2026).

  «Códigos promocionales de Stripe en el link (`allow_promotion_codes`), con
  fecha límite, para campañas. El descuento aplicado se guarda en la venta.»

  · El admin enciende los códigos en el campus (Integraciones › Links de pago) y
    crea los de cada campaña desde el CRM: un cupón y un código de Stripe con
    FECHA LÍMITE (obligatoria) y, si quiere, un máximo de usos. Como todo lo de
    Stripe, con la clave de escritura del campus (`stripe_links`), que necesita
    además Coupons y Promotion Codes de escritura.
  · Un link de pago único admite códigos si el campus los admite (la gestora
    puede quitarlo en ese link). En cuotas no: el link solo cobra la inicial y
    el código la rebajaría a ella sola, con el plan de la venta sin cuadrar. Desde
    una venta tampoco: el link va por lo pendiente y la venta ya tiene su precio.
  · Al pagarse, el CRM mira en la sesión de Checkout qué código usó el alumno y
    cuánto le descontó: la venta se crea por lo que pagó, con el precio de antes y
    el descuento (el del link, CRM#982, más el del código), y el código va a sus
    notas y al historial del link.

  Los códigos de Stripe son de la CUENTA: con una cuenta compartida entre campus
  (#44), un código vale en los links de todos los campus de esa cuenta que
  admitan códigos.
*/

/** Como mucho, un año entre hoy y la fecha límite de un código. */
export const MAX_DIAS_DE_UN_CODIGO = 366;

/** El último segundo de ese día en Madrid, en segundos Unix (lo que pide Stripe). */
export function finDelDiaEnMadrid(fecha) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const supuesto = Date.UTC(a, m - 1, d, 23, 59, 59);
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(supuesto)).map((p) => [p.type, p.value]));
  const comoEnMadrid = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return Math.floor((supuesto - (comoEnMadrid - supuesto)) / 1000);
}

/** Los días de calendario de `desde` a `hasta` (AAAA-MM-DD). */
function diasEntre(desde, hasta) {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * Lo que se va a crear, comprobado contra el campus. No llama a Stripe: devuelve
 * el código listo para guardar o lanza un 400.
 */
export function comprobarCodigo({ cfg, codigo, tipo, valor, moneda, caducaEl, hoy = hoyEnMadrid() }) {
  if (!cfg.codigos_promo) {
    throw new AppError('Este campus no admite códigos promocionales: actívalos antes en las reglas de los links.', 400, 'CODIGOS_NO_ADMITIDOS');
  }
  if (!(caducaEl >= hoy)) {
    throw new AppError('La fecha límite no puede ser anterior a hoy.', 400, 'FECHA_NO_VALIDA');
  }
  if (diasEntre(hoy, caducaEl) > MAX_DIAS_DE_UN_CODIGO) {
    throw new AppError('La fecha límite no puede pasar de un año.', 400, 'FECHA_NO_VALIDA');
  }
  let mon = null;
  if (tipo === 'monto') {
    mon = (moneda || cfg.moneda_defecto || 'EUR').toUpperCase();
    if (!cfg.monedas.includes(mon)) {
      throw new AppError(`Este campus no cobra en ${mon}. Monedas admitidas: ${cfg.monedas.join(', ')}.`, 400, 'MONEDA_NO_ADMITIDA');
    }
    if (stripe.esSinDecimales(mon) && !Number.isInteger(Number(valor))) {
      throw new AppError(`En ${mon} el descuento va sin decimales.`, 400, 'IMPORTE_SIN_DECIMALES');
    }
  }
  return { codigo: String(codigo).trim().toUpperCase(), tipo, valor: Number(valor), moneda: mon, caducaEl };
}

/*
  ¿El link admite códigos promocionales de Stripe? (CRM#986). Solo si el campus
  los admite, en pago único y sin venta: en cuotas el código rebajaría solo la
  inicial y el plan no cuadraría; desde una venta, el link va por lo pendiente.
  Sin decirlo, lo que diga el campus; pedirlos donde no caben, un 400 que lo dice.
*/
export function codigosDelLink({ pedido, cfg, enCuotas, desdeVenta }) {
  if (pedido === false) return false;
  const caben = cfg.codigos_promo === true && !enCuotas && !desdeVenta;
  if (pedido === true && !caben) {
    const motivo = !cfg.codigos_promo
      ? 'Este campus no admite códigos promocionales (Integraciones › Links de pago).'
      : enCuotas
        ? 'Los códigos promocionales van solo en pago único: en cuotas rebajarían solo la inicial.'
        : 'Desde una venta, sin códigos promocionales: el link va por lo pendiente de la venta.';
    throw new AppError(motivo, 400, 'CODIGOS_NO_ADMITIDOS');
  }
  return caben;
}


/** Crear un código de campaña: se apunta, se crea en Stripe (cupón y código) y se completa. */
export async function crearCodigo({ projectId, userId, cfg, codigo, campana, tipo, valor, moneda, caducaEl, maxUsos }) {
  const c = comprobarCodigo({ cfg, codigo, tipo, valor, moneda, caducaEl });
  const clave = await claveObligatoria(projectId);
  let fila;
  try {
    fila = await codigosModel.insertar({ projectId, ...c, campana, maxUsos, userId });
  } catch (err) {
    if (err?.code === '23505') {
      throw new AppError(`El código ${c.codigo} ya está vivo en este campus.`, 409, 'CODIGO_REPETIDO');
    }
    throw err;
  }
  const meta = {
    crm_codigo_id: String(fila.id), crm_project_id: String(projectId), crm_entorno: entorno(), crm_user_id: String(userId),
  };
  const base = `crm-${meta.crm_entorno}-codigo-${fila.id}-${new Date(fila.created_at).getTime()}`;
  const hasta = finDelDiaEnMadrid(c.caducaEl);
  let cupon = null;
  try {
    cupon = await stripe.crearCupon(clave, {
      tipo: c.tipo, valor: c.valor, moneda: c.moneda, nombre: campana || c.codigo, hasta, metadata: meta,
      idempotencia: `${base}-cupon`,
    });
    const promo = await stripe.crearCodigoPromocional(clave, {
      cuponId: cupon.id, codigo: c.codigo, hasta, maxUsos, metadata: meta, idempotencia: `${base}-codigo`,
    });
    await codigosModel.completarConStripe(fila.id, { couponId: cupon.id, promotionCodeId: promo.id });
  } catch (err) {
    if (cupon?.id) {
      await stripe.borrarCupon(clave, cupon.id).catch((e) => logger.error({ err: e.message, couponId: cupon.id },
        'Links de pago: no se pudo borrar el cupón de un código fallido; hay que borrarlo a mano en Stripe'));
    }
    await codigosModel.borrar(fila.id).catch(() => {});
    logger.warn({ err: err.message, projectId, userId }, 'Links de pago: Stripe no creó el código promocional');
    throw errorDeStripe(err, 'crear el código promocional');
  }
  logger.info({ codigoId: fila.id, projectId, userId, tipo: c.tipo, caducaEl: c.caducaEl }, 'Links de pago: código promocional creado');
  return codigosModel.porId(fila.id);
}

/** Apagar un código: primero en Stripe (si no, se podría seguir usando) y luego aquí. */
export async function desactivarCodigo({ projectId, id, userId }) {
  const c = await codigosModel.porId(id);
  if (!c || Number(c.project_id) !== Number(projectId)) throw new AppError('Código no encontrado', 404, 'NOT_FOUND');
  if (!c.activo) throw new AppError('Ese código ya está desactivado.', 409, 'YA_DESACTIVADO');
  if (c.stripe_promotion_code_id) {
    const clave = await claveObligatoria(projectId);
    try { await stripe.desactivarCodigoPromocional(clave, c.stripe_promotion_code_id); }
    catch (err) { throw errorDeStripe(err, 'desactivar el código'); }
  }
  await codigosModel.marcarDesactivado(id, userId);
  logger.info({ codigoId: id, projectId, userId }, 'Links de pago: código promocional desactivado');
  return codigosModel.porId(id);
}

// ─── Al pagarse un link con un código ───────────────────────────────────────

/** ¿Este link pudo pagarse con un código? Solo los de pago único que los admitían. */
export const admiteCodigos = (link) => link?.codigos_promo === true && link.modalidad !== 'cuotas' && !link.installment_id;

/**
 * El código que usó el alumno y lo que le descontó, en la moneda del link:
 * `{ codigo, descuento }`, o null si no usó ninguno.
 *
 * Lo dice la sesión de Checkout del pago. Si Stripe no contesta y el link es en
 * euros, lo que falta entre el link y lo cobrado (sin el texto del código). En
 * otra moneda no se adivina: el cargo llega ya en euros.
 */
export async function promoDelPago(link, payment) {
  if (!admiteCodigos(link)) return null;
  const pi = payment?.stripe_payment_intent_id || null;
  const clave = pi ? await claveDeEscritura(link.project_id) : null;
  if (clave) {
    try {
      const r = await stripe.sesionDelPago(clave, pi);
      const s = Array.isArray(r?.data) ? r.data[0] : null;
      if (s) {
        const descuento = stripe.deUnidadesMinimas(s.total_details?.amount_discount || 0, s.currency || link.moneda);
        if (!(descuento > 0)) return null;
        const p = (s.discounts || []).map((d) => d?.promotion_code).find(Boolean) || null;
        let codigo = null;
        if (p && typeof p === 'object') codigo = p.code || p.id || null;
        else if (typeof p === 'string') codigo = await codigosModel.codigoPorIdDeStripe(link.project_id, p) || p;
        return { codigo, descuento: Math.round(descuento * 100) / 100 };
      }
    } catch (err) {
      logger.warn({ err: err.message, linkId: link.id }, 'Links de pago: no se pudo leer la sesión de Checkout para el código promocional');
    }
  }
  if (String(link.moneda || 'EUR').toUpperCase() !== 'EUR') return null;
  const falta = restaCentimos(link.importe, payment?.amount ?? link.importe);
  return falta > 0 ? { codigo: null, descuento: falta } : null;
}

/**
 * EL LINK, CON SU CÓDIGO, ANTES DE CREAR SU VENTA. Lo llama el cobro de Stripe
 * (`stripe-payments.service.js`) con el cargo de un link, antes de buscar o crear
 * su venta. Si el alumno usó un código:
 *   · se apunta en el link (qué código y cuánto descontó) y en su historial, una
 *     sola vez aunque el cargo vuelva a llegar;
 *   · el link que sigue el camino lleva `promo` y, si es en euros, `importe` es lo
 *     que pagó (el link menos el código): la venta se crea por eso y no queda
 *     «pendiente» el descuento. En otra moneda la venta ya se crea por lo que
 *     entró en euros.
 * Sin código, el link tal cual. Nunca lanza: el cobro sigue como siempre.
 */
export async function conElCodigo(link, payment) {
  if (!admiteCodigos(link) || payment?.status !== 'succeeded') return link;
  try {
    const promo = await promoDelPago(link, payment);
    if (!promo) return link;
    const mon = String(link.moneda || 'EUR').toUpperCase();
    if (await codigosModel.apuntarEnElLink(link.id, promo)) {
      await model.anotarEvento(link.id, 'codigo_promocional', {
        codigo: promo.codigo, descuento: promo.descuento, moneda: mon, stripe_id: payment.stripe_id || null,
      });
    }
    return {
      ...link, promo, importe_del_link: Number(link.importe),
      ...(mon === 'EUR' ? { importe: restaCentimos(link.importe, promo.descuento) } : {}),
    };
  } catch (err) {
    logger.warn({ err: err.message, linkId: link.id }, 'links de pago: no se pudo mirar el código promocional del pago');
    return link;
  }
}

const r2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * El descuento que va a la venta, en euros, o null si no hay: el del link
 * (CRM#982) más el del código (CRM#986). `link.importe_del_link` es lo que pedía
 * el link antes del código; `importeVenta`, el total de la venta (en euros).
 *
 *   · en euros y sin código, el del link tal cual (en € o en %), como hasta ahora;
 *   · con código, o en otra moneda, en € («monto»): en otra moneda se pasa a
 *     euros con el cambio del propio cobro (lo que entró en euros entre lo que se
 *     pagó en su moneda), así el precio de antes menos el descuento es el total
 *     de la venta al céntimo.
 */
export function descuentoParaLaVenta(link, { importeVenta }) {
  const delLink = link.descuento_tipo ? Number(link.descuento_importe || 0) : 0;
  const delCodigo = Number(link.promo?.descuento || 0);
  if (!(delLink + delCodigo > 0)) return null;
  const enEuros = String(link.moneda || 'EUR').toUpperCase() === 'EUR';
  if (enEuros && !(delCodigo > 0)) {
    if (link.precio_original == null) return null;
    return {
      subtotal: Number(link.precio_original), tipo: link.descuento_tipo,
      valor: Number(link.descuento_valor), importe: delLink,
    };
  }
  let total = r2(delLink + delCodigo);
  if (!enEuros) {
    const pagado = restaCentimos(link.importe_del_link ?? link.importe, delCodigo);
    if (!(pagado > 0) || !(Number(importeVenta) > 0)) return null;
    total = r2(total * (Number(importeVenta) / pagado));
  }
  if (!(total > 0)) return null;
  return { subtotal: r2(Number(importeVenta) + total), tipo: 'monto', valor: total, importe: total };
}

/**
 * El descuento en la venta que acaba de crear el link (lo llama
 * `model.descuentoEnLaVenta`): el del link y el del código, y si hubo código, una
 * nota en la venta. true si se apuntó el descuento.
 */
export async function descuentoEnLaVenta(conversionId, link) {
  const importeVenta = await codigosModel.totalDeLaVenta(conversionId);
  if (importeVenta == null) return false;
  const d = descuentoParaLaVenta(link, { importeVenta });
  const puesto = d ? await codigosModel.ponerDescuentoEnLaVenta(conversionId, d) : false;
  if (link.promo) {
    const mon = String(link.moneda || 'EUR').toUpperCase();
    await codigosModel.anadirNotaALaVenta(conversionId,
      `Código promocional ${link.promo.codigo || '(sin nombre)'}: ${Number(link.promo.descuento).toFixed(2)} ${mon} de descuento al pagar el link n.º ${link.id}.`);
  }
  return puesto;
}
