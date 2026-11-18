import * as model from './links-pago.model.js';
import * as stripe from './links-pago.stripe.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  LINKS DE PAGO, FASE 2 (CRM#680): crear, anular y caducar un link de pago único, y
  el webhook de la cuenta desde la tarjeta.

  Decisión de Diego (17/11): todo lo de Stripe se configura desde la web. La
  clave es la de ESCRITURA del campus (`stripe_links`), nunca la de lectura ni
  una del `.env`: si el campus no la tiene, no se crea nada.

  Atar el cobro a la venta por la marca (`crm_link_id`) es la fase 3, en
  `links-pago.cobro.js`; las cuotas, la 4.
*/

/**
 * Dónde corre el CRM, para la marca del link: produccion, staging o local.
 *
 * En ISEIE las pruebas viven en /staging (en MultiCRM, /staging): se miran las
 * dos, como `enPruebasOAprobado`. Si no, el servidor de pruebas diría
 * «produccion» y dejaría crear links con una clave live.
 */
export function entorno(env = process.env) {
  if (/\/(staging|testeo)(\/|$)/.test(env.CRM_BASE_URL || '')) return 'staging';
  return env.NODE_ENV === 'production' ? 'produccion' : 'local';
}

/** La clave de escritura del campus, o null. Solo `stripe_links`. */
export async function claveDeEscritura(projectId) {
  const row = await integrationsModel.get(projectId, 'stripe_links');
  if (!row?.encrypted_value) return null;
  try {
    return decrypt(row.encrypted_value, row.iv, row.auth_tag);
  } catch (err) {
    logger.error({ err: err.message, projectId }, 'Links de pago: la clave de escritura no se puede descifrar');
    return null;
  }
}

async function claveObligatoria(projectId) {
  const clave = await claveDeEscritura(projectId);
  if (!clave) {
    throw new AppError('Este campus no tiene la clave de links de pago. La pone un admin en Integraciones › Links de pago.',
      409, 'SIN_CLAVE_DE_LINKS');
  }
  // Fuera de producción, solo claves de test: en /staging o en local nadie debe
  // poder generar un cobro de verdad por error.
  if (entorno() !== 'produccion' && /^(sk|rk)_live_/.test(clave)) {
    throw new AppError('En pruebas solo se crean links con una clave de test (rk_test_…).', 409, 'CLAVE_LIVE_EN_PRUEBAS');
  }
  return clave;
}

function errorDeStripe(err, que) {
  if (err instanceof stripe.ErrorDeStripe) {
    const sinPermiso = err.status === 401 || err.status === 403;
    return new AppError(
      sinPermiso
        ? `Stripe no deja ${que} con la clave de este campus (${err.status}). Revisa sus permisos en Integraciones › Links de pago.`
        : `Stripe no ha podido ${que}: ${err.message}`,
      // 424 y no 502: un 5xx se le esconde a la gestora tras «Error del sistema», y
      // esto le dice qué hacer (o a quién avisar).
      424, 'STRIPE_ERROR');
  }
  return err;
}

const redondear2 = (n) => Math.round(n * 100) / 100;

/**
 * El descuento sobre el precio del catálogo, en %. Cobrar más que el catálogo
 * no es un descuento (0). Sin precio de catálogo, null: no se puede medir.
 */
export function descuentoSobre(precioCatalogo, importe) {
  const precio = Number(precioCatalogo);
  if (!(precio > 0)) return null;
  return Math.max(0, redondear2(((precio - Number(importe)) / precio) * 100));
}

/** El importe más bajo que admite el tope de descuento, redondeado hacia arriba al céntimo. */
export function importeMinimo(precioCatalogo, maxPct) {
  const precioC = Math.round(Number(precioCatalogo) * 100);
  const maxB = Math.round(Number(maxPct) * 100); // centésimas de punto
  // Techo de una división entera, sin coma flotante en medio.
  return Math.floor((precioC * (10000 - maxB) + 9999) / 10000) / 100;
}

/**
 * Lo que se va a cobrar, comprobado contra las reglas del campus. No llama a
 * Stripe ni escribe nada: devuelve lo que hay que guardar o lanza un 400/403.
 *
 *   · moneda: una de las admitidas (por defecto, la del campus);
 *   · caducidad: de 1 al máximo del campus (por defecto, la del campus);
 *   · descuento: hasta el tope del campus, salvo quien configura (el admin);
 *   · sin precio comparable (curso sin precio, o en otra moneda): solo el admin.
 */
/*
 * DESDE UNA VENTA, EL TOPE SE MIDE CONTRA LO PENDIENTE (CRM#680, fase 3).
 *
 * En una venta ya hay un precio pactado y quizá pagos hechos: lo que se le puede
 * pedir al cliente es lo que falta. Si se midiera contra el catálogo, un link por
 * lo pendiente de una venta a medio pagar saldría como un «descuento» enorme, y
 * uno de una venta pactada por encima del catálogo dejaría rebajar más de la
 * cuenta. `pendiente` (en euros, como guarda el CRM) solo llega desde una venta;
 * sin nada pendiente, o en otra moneda, no hay con qué comparar: solo el admin.
 */
export function comprobarReglas({ cfg, prod, importe, moneda, caducidadDias, modalidad, esAdmin, pendiente }) {
  if (modalidad === 'cuotas') {
    throw new AppError('Los links en cuotas todavía no se pueden crear: de momento, pago único.', 400, 'CUOTAS_AUN_NO');
  }
  const mon = moneda || cfg.moneda_defecto;
  if (!cfg.monedas.includes(mon)) {
    throw new AppError(`Este campus no cobra en ${mon}. Monedas admitidas: ${cfg.monedas.join(', ')}.`, 400, 'MONEDA_NO_ADMITIDA');
  }
  const dias = caducidadDias ?? cfg.caducidad_dias;
  if (dias > cfg.caducidad_max_dias) {
    throw new AppError(`La caducidad no puede pasar de ${cfg.caducidad_max_dias} días en este campus.`, 400, 'CADUCIDAD_MAXIMA');
  }

  const mismaMoneda = !prod.moneda || String(prod.moneda).toUpperCase() === mon;
  const precio = prod.precio != null && Number(prod.precio) > 0 && mismaMoneda ? Number(prod.precio) : null;
  const desdeVenta = pendiente !== undefined && pendiente !== null;
  // Contra qué se mide el descuento: lo pendiente de la venta, o el catálogo.
  const referencia = desdeVenta
    ? (mon === 'EUR' && Number(pendiente) > 0 ? Number(pendiente) : null)
    : precio;
  const descuento = referencia == null ? null : descuentoSobre(referencia, importe);
  if (referencia == null && !esAdmin) {
    let motivo;
    if (desdeVenta) {
      motivo = mon !== 'EUR'
        ? `Lo pendiente de la venta está en EUR: un link en ${mon} lo tiene que crear un admin.`
        : 'Esta venta no tiene nada pendiente de cobro: el link lo tiene que crear un admin.';
    } else {
      motivo = mismaMoneda
        ? 'Este curso no tiene precio en el catálogo: el link lo tiene que crear un admin.'
        : `El precio del catálogo está en ${String(prod.moneda).toUpperCase()}: un link en ${mon} lo tiene que crear un admin.`;
    }
    throw new AppError(motivo, 403, 'SIN_PRECIO_COMPARABLE');
  }
  if (referencia != null && !esAdmin) {
    // En céntimos y con enteros: 899,99 sobre 1000 es un 10,001 % y, redondeado,
    // pasaría por un 10 % que sí cabe. Lo que manda es el importe mínimo.
    const minimo = importeMinimo(referencia, cfg.descuento_max_pct);
    if (Math.round(Number(importe) * 100) < Math.round(minimo * 100)) {
      const sobre = desdeVenta ? `lo pendiente de la venta (${referencia.toFixed(2)} ${mon})` : 'el precio del catálogo';
      throw new AppError(
        cfg.descuento_max_pct > 0
          ? `El descuento máximo en este campus es un ${cfg.descuento_max_pct} % sobre ${sobre}: el importe no puede bajar de ${minimo.toFixed(2)} ${mon}.`
          : `En este campus solo el admin puede hacer descuento sobre ${sobre}.`,
        403, 'DESCUENTO_MAXIMO');
    }
  }
  return {
    moneda: mon, caducidadDias: dias, precioCatalogo: precio, descuentoPct: descuento ?? 0,
    referencia: desdeVenta ? 'pendiente' : 'catalogo', ...(desdeVenta ? { pendiente: Number(pendiente) } : {}),
  };
}

/** La marca del CRM que va en el link y en el cargo (la lee la fase 3). */
export function marca({ linkId, projectId, leadId, conversionId, userId }) {
  return {
    crm_link_id: String(linkId),
    crm_project_id: String(projectId),
    crm_lead_id: leadId ? String(leadId) : null,
    crm_conversion_id: conversionId ? String(conversionId) : null,
    crm_user_id: String(userId),
    crm_entorno: entorno(),
  };
}

/*
  CUENTAS DE STRIPE COMPARTIDAS. En MultiCRM varios campus pueden compartir una
  cuenta y declaran `filtro_metadata`; allí el link y su cargo llevan además esa
  marca de plataforma (CRM#870) para que el sondeo no los deje «sin marcar». En
  ISEIE cada campus tiene su propia cuenta de Stripe (no hay `filtro_metadata`,
  como dice `disputas.service.js`), así que basta con la marca `crm_*`.
*/

/**
 * Crear el link: se apunta, se crea en Stripe y se completa. Si Stripe falla,
 * la fila se borra: no queda un link sin URL que la gestora pueda mandar.
 */
export async function crear({ projectId, leadId, conversionId, prod, reglas, importe, userId }) {
  const clave = await claveObligatoria(projectId);
  const fila = await model.insertar({
    projectId, leadId, conversionId, productId: prod.id, createdBy: userId,
    precioCatalogo: reglas.precioCatalogo, importe, descuentoPct: reglas.descuentoPct,
    moneda: reglas.moneda, caducidadDias: reglas.caducidadDias,
  });
  const meta = marca({ linkId: fila.id, projectId, leadId, conversionId, userId });
  // Única por link y por entorno: /staging y local pueden compartir cuenta de test.
  const base = `crm-${meta.crm_entorno}-link-${fila.id}-${new Date(fila.created_at).getTime()}`;
  let precio; let link;
  try {
    precio = await stripe.crearPrecio(clave, {
      importe, moneda: reglas.moneda, nombre: prod.nombre || `Curso ${prod.id}`, metadata: meta,
      idempotencia: `${base}-precio`,
    });
    link = await stripe.crearLink(clave, { priceId: precio.id, metadata: meta, idempotencia: `${base}-link` });
  } catch (err) {
    await model.borrar(fila.id).catch((e) => logger.error({ err: e.message, linkId: fila.id }, 'Links de pago: no se pudo borrar la fila de un link fallido'));
    logger.warn({ err: err.message, projectId, userId }, 'Links de pago: Stripe no creó el link');
    throw errorDeStripe(err, 'crear el link');
  }
  try {
    await model.completarConStripe(fila.id, { url: link.url, paymentLinkId: link.id, priceId: precio.id });
  } catch (err) {
    // El link existe en Stripe pero el CRM no lo ha podido guardar: se apaga allí
    // para que nadie pueda pagar un link que el CRM no conoce.
    logger.error({ err: err.message, linkId: fila.id, paymentLinkId: link.id }, 'Links de pago: no se pudo guardar el link creado; se desactiva en Stripe');
    await stripe.desactivarLink(clave, link.id).catch((e) => logger.error({ err: e.message, paymentLinkId: link.id }, 'Links de pago: TAMPOCO se pudo desactivar en Stripe; hay que hacerlo a mano'));
    await model.borrar(fila.id).catch(() => {});
    throw err;
  }
  await model.anotarEvento(fila.id, 'creado', {
    por: userId, importe, moneda: reglas.moneda, descuento_pct: reglas.descuentoPct,
    caduca_el: fila.caduca_el, stripe_payment_link_id: link.id,
    // Contra qué se midió el descuento (fase 3): el catálogo, o lo pendiente de la venta.
    descuento_sobre: reglas.referencia || 'catalogo',
    ...(reglas.pendiente !== undefined ? { pendiente: reglas.pendiente } : {}),
  });
  logger.info({ linkId: fila.id, projectId, userId, importe, moneda: reglas.moneda }, 'Links de pago: link creado');
  return model.porId(fila.id);
}

/**
 * Anular un link que no se ha pagado: primero se desactiva en Stripe (si no, el
 * cliente podría pagarlo igual) y luego se marca. Lo pagado no se anula: se
 * devuelve, y eso lo hace una persona en Stripe.
 */
export async function anular(link, { userId, motivo }) {
  if (!['creado', 'abierto'].includes(link.estado)) {
    throw new AppError(`Un link ${link.estado.replace('_', ' ')} no se puede anular.`, 409, 'NO_ANULABLE');
  }
  if (link.stripe_payment_link_id) {
    const clave = await claveObligatoria(link.project_id);
    try { await stripe.desactivarLink(clave, link.stripe_payment_link_id); }
    catch (err) { throw errorDeStripe(err, 'desactivar el link'); }
  }
  const hecho = await model.marcarAnulado(link.id, { userId, motivo });
  if (!hecho) throw new AppError('El link ha cambiado mientras tanto (pagado o caducado). Recarga.', 409, 'NO_ANULABLE');
  await model.anotarEvento(link.id, 'anulado', { por: userId, motivo });
  logger.info({ linkId: link.id, userId }, 'Links de pago: link anulado');
  return model.porId(link.id);
}

/**
 * El cron: los vivos con la fecha pasada se desactivan en Stripe y se marcan
 * caducados. Si Stripe falla o el campus ya no tiene clave, se deja como está y
 * se reintenta en la siguiente vuelta: marcarlo sin desactivarlo dejaría un link
 * que se puede pagar con el CRM diciendo «caducado».
 */
export async function caducarVencidos({ lote = 50 } = {}) {
  const vencidos = await model.porCaducar(lote);
  const res = { caducados: 0, pendientes: 0 };
  for (const l of vencidos) {
    try {
      if (l.stripe_payment_link_id) {
        const clave = await claveDeEscritura(l.project_id);
        if (!clave) {
          logger.warn({ linkId: l.id, projectId: l.project_id }, 'Links de pago: no se puede caducar, el campus no tiene la clave de links');
          res.pendientes += 1;
          continue;
        }
        await stripe.desactivarLink(clave, l.stripe_payment_link_id);
      }
      if (await model.marcarCaducado(l.id)) {
        await model.anotarEvento(l.id, 'caducado', { por: 'cron' });
        res.caducados += 1;
      }
    } catch (err) {
      logger.warn({ err: err.message, linkId: l.id }, 'Links de pago: no se pudo caducar; se reintenta en la siguiente vuelta');
      res.pendientes += 1;
    }
  }
  if (vencidos.length) logger.info(res, 'Links de pago: vuelta de caducidad');
  return res;
}

// ─── El webhook de la cuenta (Integraciones › Links de pago) ────────────────

/*
  Los eventos que necesitan los links: el pago (fase 3), los intentos fallidos y
  la caducidad de la sesión, y las cuotas (fase 4). Se AÑADEN a los que ya
  escucha el webhook (cargos, disputas, payment_intent): no se quita ninguno.
  Stripe no acepta comodines parciales por la API («checkout.session.*»), así
  que van uno a uno.
*/
export const EVENTOS_DE_LOS_LINKS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.deleted',
];

/**
 * El webhook que se creó el 16/11 para la cuenta del campus: su id está en la
 * integración «Stripe» (`config_public.webhook_endpoint_id`), junto a su
 * secreto cifrado. Se reutiliza ese: el CRM nunca crea otro, porque el secreto
 * de uno nuevo no se podría guardar sin pasar por el panel de Stripe.
 */
export async function idDelWebhook(projectId) {
  const row = await integrationsModel.get(projectId, 'stripe');
  const id = row?.config_public?.webhook_endpoint_id;
  return typeof id === 'string' && /^we_[A-Za-z0-9]{6,}$/.test(id) ? id : null;
}

function resumenWebhook(we, endpointId, comparten) {
  const eventos = Array.isArray(we.enabled_events) ? we.enabled_events : [];
  const todos = eventos.includes('*');
  return {
    vinculado: true,
    endpoint_id: endpointId,
    activo: we.status === 'enabled',
    url: we.url || null,
    eventos,
    faltan: todos ? [] : EVENTOS_DE_LOS_LINKS.filter((e) => !eventos.includes(e)),
    comparten,
  };
}

export async function verWebhook(projectId, { campusVisibles = null } = {}) {
  const endpointId = await idDelWebhook(projectId);
  if (!endpointId) return { vinculado: false, faltan: EVENTOS_DE_LOS_LINKS };
  const clave = await claveObligatoria(projectId);
  let we;
  try { we = await stripe.verWebhook(clave, endpointId); }
  catch (err) {
    if (err instanceof stripe.ErrorDeStripe && err.status === 404) {
      return { vinculado: true, endpoint_id: endpointId, existe: false, faltan: EVENTOS_DE_LOS_LINKS };
    }
    throw errorDeStripe(err, 'leer el webhook');
  }
  const comparten = await model.campusDelWebhook(endpointId, campusVisibles);
  return { existe: true, ...resumenWebhook(we, endpointId, comparten) };
}

/**
 * Añadir los eventos que faltan, activar o desactivar. Es de la CUENTA: si
 * varios campus la comparten, les afecta a todos (la tarjeta lo dice).
 */
export async function cambiarWebhook(projectId, accion, { campusVisibles = null } = {}) {
  const endpointId = await idDelWebhook(projectId);
  if (!endpointId) {
    throw new AppError('Este campus no tiene webhook de Stripe vinculado (falta su id en la tarjeta «Stripe»). No se crea uno nuevo.',
      409, 'SIN_WEBHOOK');
  }
  const clave = await claveObligatoria(projectId);
  try {
    let cambios;
    if (accion === 'anadir_eventos') {
      const we = await stripe.verWebhook(clave, endpointId);
      const actuales = Array.isArray(we.enabled_events) ? we.enabled_events : [];
      if (actuales.includes('*') || EVENTOS_DE_LOS_LINKS.every((e) => actuales.includes(e))) {
        return { cambiado: false, ...(await verWebhook(projectId, { campusVisibles })) };
      }
      // Stripe sustituye la lista: van los que había más los nuevos.
      cambios = { eventos: [...new Set([...actuales, ...EVENTOS_DE_LOS_LINKS])] };
    } else {
      cambios = { desactivado: accion === 'desactivar' };
    }
    const we = await stripe.actualizarWebhook(clave, endpointId, cambios);
    const comparten = await model.campusDelWebhook(endpointId, campusVisibles);
    return { cambiado: true, existe: true, ...resumenWebhook(we, endpointId, comparten) };
  } catch (err) {
    throw errorDeStripe(err, 'cambiar el webhook');
  }
}
