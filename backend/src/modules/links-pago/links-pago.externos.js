import * as model from './links-pago.externos.model.js';
import * as stripe from './links-pago.stripe.js';
import { marcaDe } from './links-pago.cobro.js';
import { claveDeEscritura, entorno } from './links-pago.service.js';
import { linksPagoActivos } from '../../shared/config/soloEnPruebas.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  LOS LINKS DE PAGO CREADOS DIRECTAMENTE EN STRIPE (CRM-ISEIE#688, gemela de CRM#1019).

  Diego, 23/11/2026: «sí, crea la tarea para recoger los links de Stripe». Un
  link hecho a mano en el panel de Stripe no lleva la marca del CRM, y hasta hoy
  su cobro se descartaba («sin marca del CRM»): no iba a ninguna venta ni salía
  en Links de pago.

  1. RECOGERLOS. Con la clave de links del campus (`stripe_links`) se leen los
     Payment Links de su cuenta que no creó el CRM y se guardan en
     `stripe_links_externos`: cada 30 minutos, con «Traer de Stripe» y al llegar
     los avisos `payment_link.created` / `payment_link.updated`. En Links de
     pago salen como «Creado en Stripe». Solo se leen: el CRM no los cambia.
     En ISEIE cada campus tiene su cuenta de Stripe: un link de esa cuenta es
     de ese campus (en el 360, con cuentas compartidas, se mira además la marca
     de plataforma).

  2. SU COBRO. El aviso `checkout.session.completed` de una sesión de uno de
     esos links trae el cargo por el MISMO camino que todos (la reserva por
     cargo, #635): el cargo se ata al link (`stripe_link_externo_id`) y se busca
     a quién es, por el correo y, si no, por el móvil (como los webhooks de
     admisión):
       · una sola venta con algo pendiente → el cobro va a ella, con el mismo
         `addPayment` y la misma comprobación de duplicados que los demás: un
         cargo que ya tiene su cobro (Conciliación, «Sincronizar», el aviso del
         cargo) no se vuelve a crear;
       · si no hay nadie, o hay varias ventas posibles, o la persona no tiene
         venta pendiente → bandeja «Cobros de Stripe por vincular», con el motivo
         y las ventas candidatas. Nada se queda perdido.
     Por móvil, si el número está en más de una ficha no se elige ninguna (la
     misma regla que la admisión: no se adivina).

  3. A MANO. Desde la bandeja, quien tiene `links_pago.ver_todos` elige la venta
     (de SU campus, que es el del cargo) y el cobro se apunta con `manualLink`
     de Conciliación: si ya estaba apuntado a mano en esa venta, se engancha a
     ese cobro sin sumar otra vez.

  Si el aviso del cargo (`charge.succeeded`) llega antes que el de la sesión, el
  cargo entra como siempre: por el correo, si encaja. Cuando llega la sesión, si
  ya tiene su cobro no se toca (la reserva lo impide); si no, se mira aquí.
*/

/**
 * El móvil para compararlo, como en los webhooks de admisión: solo los dígitos y,
 * de ellos, los 9 últimos (el prefijo no importa). Con menos de 7, null.
 */
export function movilNormalizado(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : null;
}

export const METODO = 'auto_link_stripe'; // cabe en stripe_payments.link_method VARCHAR(20)

export const MOTIVOS = {
  sin_datos: 'El pago no trae ni correo ni móvil',
  sin_coincidencia: 'Nadie del campus tiene ese correo o ese móvil',
  varias_coincidencias: 'Hay varias ventas o fichas que podrían ser',
  sin_venta: 'La persona no tiene ninguna venta',
  sin_pendiente: 'Sus ventas ya están cobradas',
};

/** Lo que se guarda de un Payment Link de Stripe: lo que cobra, la moneda y si admite códigos. */
export function datosDelLink(pl) {
  const lineas = Array.isArray(pl?.line_items?.data) ? pl.line_items.data : [];
  const monedaDe = (li) => li?.currency || li?.price?.currency || null;
  const moneda = String(pl?.currency || monedaDe(lineas[0]) || '').toUpperCase() || null;
  // El importe solo si todas las líneas lo dicen en la misma moneda: un precio que
  // pone el cliente (`custom_unit_amount`) no tiene importe fijo.
  const fijas = lineas.length > 0 && lineas.every((li) => typeof li.amount_total === 'number' && li.amount_total > 0
    && String(monedaDe(li) || moneda || '').toUpperCase() === moneda);
  const importe = fijas
    ? stripe.desdeUnidadesMinimas(lineas.reduce((t, li) => t + li.amount_total, 0), moneda)
    : null;
  const nombres = lineas.map((li) => li.description || li.price?.product?.name || li.price?.nickname).filter(Boolean);
  return {
    stripe_payment_link_id: pl.id,
    url: pl.url || null,
    activo: pl.active !== false,
    nombre: nombres.length ? nombres.join(' + ').slice(0, 500) : null,
    importe,
    moneda: moneda && /^[A-Z]{3}$/.test(moneda) ? moneda : null,
    codigos_promocionales: pl.allow_promotion_codes === true,
    metadata: pl.metadata && typeof pl.metadata === 'object' ? pl.metadata : {},
  };
}

/** ¿Lo creó el CRM? Lleva su marca o está en `payment_links`. */
async function esDelCrm(pl) {
  if (marcaDe(pl?.metadata) || pl?.metadata?.crm_link_id) return true;
  return model.esLinkDelCrm(pl.id);
}

/**
 * ¿Es de este campus? En ISEIE cada campus tiene su propia cuenta de Stripe (no
 * hay cuentas compartidas ni `filtro_metadata`, que es del 360, #44): todos.
 */
async function esDeEsteCampus(_projectId, _metadata) {
  return true;
}

/** Guarda un link de Stripe si es de este campus y no del CRM. Devuelve la fila, o null. */
export async function guardarLink(projectId, pl) {
  if (!pl?.id || await esDelCrm(pl)) return null;
  if (!(await esDeEsteCampus(projectId, pl.metadata))) return null;
  return model.guardar(projectId, datosDelLink(pl));
}

/** La clave de links del campus si con ella se puede leer aquí; si no, null (y por qué). */
async function claveParaLeer(projectId) {
  const clave = await claveDeEscritura(projectId);
  if (!clave) return { clave: null, motivo: 'El campus no tiene la clave de links de pago (Integraciones › Links de pago).' };
  // Fuera de producción, solo claves de test: /testeo no recoge cobros de verdad.
  if (entorno() !== 'produccion' && /^(sk|rk)_live_/.test(clave)) {
    return { clave: null, motivo: 'En pruebas solo se leen links con una clave de test.' };
  }
  return { clave };
}

const DIAS_DE_SESIONES = 7;

/**
 * Recoger los links de Stripe del campus y, de paso, los cobros de esos links
 * de los últimos días cuyo aviso no llegó. `{ links, nuevos, cobros }`.
 * Errores con `code` para la pantalla.
 */
export async function sincronizar(projectId, { conCobros = true } = {}) {
  const { clave, motivo } = await claveParaLeer(projectId);
  if (!clave) throw new AppError(motivo, 409, 'SIN_CLAVE_DE_LINKS');
  let lista;
  try { lista = await stripe.listarLinks(clave); }
  catch (err) {
    const sinPermiso = err instanceof stripe.ErrorDeStripe && (err.status === 401 || err.status === 403);
    throw new AppError(sinPermiso
      ? `Stripe no deja leer los links de pago con la clave de este campus (${err.status}). Revisa sus permisos en Integraciones › Links de pago.`
      : `Stripe no ha podido dar los links de pago: ${err.message}`, 424, 'STRIPE_ERROR');
  }
  let links = 0;
  let nuevos = 0;
  for (const pl of lista) {
    const fila = await guardarLink(projectId, pl);
    if (!fila) continue;
    links += 1;
    if (fila.nuevo) nuevos += 1;
  }
  const cobros = conCobros ? await recogerCobros(projectId, clave) : 0;
  return { links, nuevos, cobros };
}

/**
 * Los cobros de links de Stripe de los últimos días que no se trataron (el aviso
 * no llegó, o llegó sin la clave de lectura): cada sesión pagada entra como si
 * llegara su aviso, por el mismo camino. Nunca lanza.
 */
async function recogerCobros(projectId, clave) {
  let sesiones = [];
  try {
    const desde = Math.floor(Date.now() / 1000) - DIAS_DE_SESIONES * 86400;
    sesiones = (await stripe.sesionesCompletadas(clave, { desde }))?.data || [];
  } catch (err) {
    logger.warn({ projectId, err: err.message }, 'links de Stripe: no se pudieron leer las sesiones de Checkout');
    return 0;
  }
  const { handleWebhookEvent } = await import('../stripe-payments/stripe-payments.service.js');
  let tratadas = 0;
  for (const s of sesiones) {
    if (!s?.payment_link || s.payment_status !== 'paid' || marcaDe(s.metadata)) continue;
    if (await model.sesionYaTratada(projectId, s.id)) continue;
    try {
      const r = await handleWebhookEvent(projectId, { id: null, type: 'checkout.session.completed', data: { object: s } });
      if (!r?.skipped) tratadas += 1;
    } catch (err) {
      logger.warn({ projectId, sessionId: s.id, err: err.message }, 'links de Stripe: no se pudo recoger el cobro de una sesión');
    }
  }
  return tratadas;
}

/** La vuelta de cada 30 minutos: todos los campus con la clave de links. Nunca lanza por un campus. */
export async function vuelta() {
  if (!linksPagoActivos()) return { campus: 0 };
  const campus = await model.campusConClaveDeLinks();
  let hechos = 0;
  for (const projectId of campus) {
    try {
      await sincronizar(projectId);
      hechos += 1;
    } catch (err) {
      logger.warn({ projectId, err: err.message, code: err.code }, 'links de Stripe: no se pudieron recoger en este campus');
    }
  }
  return { campus: hechos };
}

/** Completa en segundo plano un link que llegó por un aviso (sin sus líneas). */
function completarEnSegundoPlano(projectId, paymentLinkId) {
  setImmediate(async () => {
    try {
      const { clave } = await claveParaLeer(projectId);
      if (!clave) return;
      await guardarLink(projectId, await stripe.verLink(clave, paymentLinkId));
    } catch (err) {
      logger.warn({ projectId, paymentLinkId, err: err.message }, 'links de Stripe: no se pudo leer el link; lo completará la vuelta');
    }
  });
}

/** Aviso `payment_link.created` / `payment_link.updated`: el link, al día. */
export async function desdeElAvisoDelLink(projectId, event, { env = process.env } = {}) {
  if (!linksPagoActivos(env)) return { skipped: 'links de pago apagados' };
  const pl = event.data?.object || {};
  if (!pl.id) return { skipped: 'sin link' };
  if (await esDelCrm(pl)) return { skipped: 'link del CRM' };
  if (!(await esDeEsteCampus(projectId, pl.metadata))) return { skipped: 'link de Stripe de otro campus' };
  // El aviso no trae las líneas (lo que se cobra): se guarda lo que hay y se completa.
  const fila = await model.guardar(projectId, datosDelLink(pl));
  if (!pl.line_items) completarEnSegundoPlano(projectId, pl.id);
  return { externo: fila };
}

/**
 * Una sesión de Checkout SIN la marca del CRM (la llama `desdeLaSesion`). Si
 * viene de un Payment Link creado en Stripe, el link (guardado si aún no lo
 * estaba) y lo que dijo la sesión; si no (la web, una plataforma), se descarta
 * como siempre: `{ skipped: 'sin marca del CRM' }`.
 */
export async function desdeLaSesion(projectId, event) {
  const s = event.data?.object || {};
  const plId = typeof s.payment_link === 'string' ? s.payment_link : s.payment_link?.id || null;
  if (!plId) return { skipped: 'sin marca del CRM' };
  if (await model.esLinkDelCrm(plId)) return { skipped: 'link del CRM sin marca en la sesión' };
  let externo = await model.porStripeId(projectId, plId);
  if (!externo) {
    // Stripe copia la metadata del link a la sesión: con ella se sabe si es de este campus.
    if (!(await esDeEsteCampus(projectId, s.metadata))) return { skipped: 'link de Stripe de otro campus' };
    const moneda = s.currency ? String(s.currency).toUpperCase() : null;
    externo = await model.guardar(projectId, {
      stripe_payment_link_id: plId, activo: true, moneda,
      importe: stripe.desdeUnidadesMinimas(s.amount_subtotal, moneda), metadata: s.metadata || {},
    }, { soloSiNoEsta: true });
    completarEnSegundoPlano(projectId, plId);
  }
  const paymentIntent = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id || null;
  const cobrar = (event.type === 'checkout.session.completed' && s.payment_status === 'paid')
    || event.type === 'checkout.session.async_payment_succeeded';
  const cd = s.customer_details || {};
  const moneda = s.currency ? String(s.currency).toUpperCase() : null;
  const descuento = stripe.desdeUnidadesMinimas(s.total_details?.amount_discount, moneda);
  const promo = Array.isArray(s.discounts) ? s.discounts.find((d) => d?.promotion_code) : null;
  const checkout = {
    session_id: s.id || null,
    payment_intent: paymentIntent,
    email: cd.email ? String(cd.email).trim().toLowerCase() : null,
    nombre: cd.name || null,
    telefono: cd.phone || null,
    moneda,
    ...(descuento ? { descuento } : {}),
    ...(promo ? { codigo: typeof promo.promotion_code === 'string' ? promo.promotion_code : promo.promotion_code?.code || promo.promotion_code?.id || null } : {}),
  };
  return { externo, cobrar, paymentIntent, checkout };
}

/** El cargo, atado a su link de Stripe (antes de enlazarlo). */
export async function atarCargo(dbRow, externo, checkout) {
  await model.atarCargo(dbRow.id, externo.id, checkout);
  return { ...dbRow, stripe_link_externo_id: externo.id, checkout_externo: { ...(dbRow.checkout_externo || {}), ...checkout } };
}

/**
 * ¿De quién es? Por el correo y, si no, por el móvil. `{ venta }` si hay una
 * sola venta posible; si no, `{ motivo, candidatos }` para la bandeja.
 */
export async function quienEs(projectId, { email, telefono }) {
  const movil = movilNormalizado(telefono);
  if (!email && !movil) return { motivo: 'sin_datos', candidatos: [] };
  let fichas = email ? await model.fichasPorCorreo(projectId, email) : [];
  let porMovil = false;
  if (!fichas.length && movil) {
    fichas = await model.fichasPorMovil(projectId, movil);
    porMovil = true;
  }
  if (!fichas.length) return { motivo: 'sin_coincidencia', candidatos: [] };
  const ventas = await model.ventasDeFichas(projectId, fichas.map((f) => Number(f.id)));
  const candidatos = ventas.length
    ? ventas.slice(0, 10).map((v) => ({
      conversion_id: Number(v.conversion_id), lead_id: Number(v.lead_id), lead_nombre: v.lead_nombre,
      producto: v.producto, importe_total: Number(v.importe_total), pendiente: Number(v.pendiente),
    }))
    : fichas.slice(0, 10).map((f) => ({ lead_id: Number(f.id), lead_nombre: f.nombre }));
  // El mismo móvil en varias fichas: no se sabe quién es (regla de la admisión).
  if (porMovil && fichas.length > 1) return { motivo: 'varias_coincidencias', candidatos };
  const conPendiente = ventas.filter((v) => Number(v.pendiente) > 0.009);
  if (conPendiente.length === 1) return { venta: conPendiente[0] };
  if (conPendiente.length > 1) return { motivo: 'varias_coincidencias', candidatos };
  if (ventas.length) return { motivo: 'sin_pendiente', candidatos };
  return { motivo: 'sin_venta', candidatos };
}

/**
 * A qué venta va el cobro de un link de Stripe (lo llama `enlazarSiSePuede`,
 * con el cargo ya reservado). Lo mismo que las demás reglas
 * (`{ conv, ficha, metodoAuto, email }`) más `externo`; o `{ porVincular }` si
 * se ha dejado en la bandeja.
 */
export async function ventaDelCargo(projectId, payment, dbRow) {
  const datos = dbRow.checkout_externo || {};
  const email = String(payment.customer_email || dbRow.customer_email || datos.email || '').trim().toLowerCase() || null;
  const telefono = payment.customer_phone || datos.telefono || null;
  const r = await quienEs(projectId, { email, telefono });
  if (!r.venta) {
    await model.aLaBandeja(dbRow.id, r.motivo, r.candidatos);
    logger.info({ projectId, stripeId: payment.stripe_id, motivo: r.motivo, candidatos: r.candidatos.length },
      'links de Stripe: cobro sin venta clara; queda en «Cobros de Stripe por vincular»');
    return { porVincular: true, motivo: r.motivo };
  }
  const v = r.venta;
  return {
    conv: { id: Number(v.conversion_id) },
    ficha: { id: Number(v.lead_id), nombre: v.lead_nombre, responsable_id: v.responsable_id },
    metodoAuto: METODO,
    email,
    externo: { id: dbRow.stripe_link_externo_id, ...datos },
  };
}

/** La nota del cobro en la venta: de qué link vino y el descuento, si lo hubo. */
export function notaDelCobro(stripeId, externo) {
  const d = externo?.descuento ? ` · descuento ${Number(externo.descuento).toFixed(2)}${externo.codigo ? ` con el código ${externo.codigo}` : ''}` : '';
  return `Auto-Stripe ${stripeId} (link creado en Stripe${d})`;
}

/**
 * Vincular a mano un cobro de la bandeja con una venta de su campus. Con la
 * misma reserva por cargo que el aviso y el mismo `manualLink` que Conciliación:
 * si el cobro ya estaba apuntado en esa venta, se engancha a él sin sumar.
 */
export async function vincular(cargoId, { conversionId, userId }) {
  const c = await model.cargo(cargoId);
  if (!c || !c.stripe_link_externo_id) throw new AppError('Cobro no encontrado', 404, 'NOT_FOUND');
  if (c.status !== 'succeeded') throw new AppError('Ese cargo no se cobró en Stripe: no se vincula.', 409, 'CARGO_NO_COBRADO');
  if (c.conversion_payment_id) throw new AppError('Ese cobro ya está en una venta.', 409, 'YA_VINCULADO');
  const v = await model.venta(conversionId);
  if (!v || Number(v.project_id) !== Number(c.project_id)) throw new AppError('Venta no encontrada', 404, 'NOT_FOUND');
  const sp = await import('../stripe-payments/stripe-payments.service.js');
  const hecho = await sp.conElCargoReservado(c, async () => {
    await sp.manualLink(c.id, { leadId: v.lead_id, conversionId: v.id, userId });
    return true;
  }, { ocupado: false });
  if (!hecho) throw new AppError('Ese cobro se está vinculando ahora mismo o ya está en una venta.', 409, 'YA_VINCULADO');
  await model.fueraDeLaBandeja(c.id);
  const despues = await model.cargo(c.id);
  logger.info({ cargoId: c.id, conversionId: v.id, userId, conversionPaymentId: despues?.conversion_payment_id },
    'links de Stripe: cobro vinculado a mano desde la bandeja');
  return { conversion_id: Number(v.id), conversion_payment_id: despues?.conversion_payment_id ?? null };
}
