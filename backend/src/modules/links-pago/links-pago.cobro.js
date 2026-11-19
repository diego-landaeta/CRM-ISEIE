import * as model from './links-pago.model.js';
import { entorno } from './links-pago.service.js';
import { linksPagoActivos } from '../../shared/config/soloEnPruebas.js';
import { logger } from '../../shared/utils/logger.js';

/*
  LINKS DE PAGO, FASE 3 (CRM#680): EL COBRO DEL LINK, A SU VENTA.

  El link lleva la marca del CRM (`crm_link_id`, `crm_project_id`, `crm_entorno`…)
  en el Payment Link, que Stripe copia a la sesión de Checkout, y en
  `payment_intent_data`, que llega al cargo. Con ella el cobro se ata sin mirar el
  correo, que es lo único que tenía el CRM hasta ahora:

    · el cargo apunta a su link (`stripe_payments.payment_link_id`);
    · link desde una venta: el cobro va a esa venta;
    · link desde un prospecto: la venta de ese curso que ya tenga la ficha (la
      asesora pudo registrarla a mano mientras) o, si no hay, se crea a nombre de
      quien creó el link (`vendedora_id`), con el curso y el importe del link;
    · el link pasa a «pagado», queda en su historial y se avisa a quien lo creó.

  No hay un camino aparte: esto lo llama `stripe-payments.service.js` dentro de
  la misma reserva por cargo (CRM#635) que el sondeo, el aviso y «Sincronizar», y el
  cobro se apunta con el mismo `addPayment` y la misma comprobación de duplicados.
  La marca va PRIMERO porque es la asociación más segura: si la hay y es buena,
  no se mira el correo.

  Solo con los links encendidos (`LINKS_PAGO_EN_PRODUCCION`, o fuera de
  producción). Apagados, un cargo con marca entra como cualquier otro.

  La marca se cree solo si es de ESTE campus y de ESTE entorno: /staging y local
  pueden compartir la cuenta de test de Stripe y el link n.º 5 de uno no es el del
  otro.

  En ISEIE (#407): `entorno()` mira /staging (links-pago.service.js); `createSale`
  guarda `vendedora_id` con la misma comprobación que en MultiCRM (que la persona
  esté activa y tenga el campus); y la venta se crea con `iva_incluido`, porque
  aquí, sin decirlo, el 21 % se sumaría encima del importe del link.
*/

export const METODO = 'auto_link_pago'; // cabe en stripe_payments.link_method VARCHAR(20)

/** La marca del CRM en una metadata de Stripe, o null si no la lleva (o no se entiende). */
export function marcaDe(metadata) {
  const m = metadata && typeof metadata === 'object' ? metadata : null;
  const id = String(m?.crm_link_id ?? '').trim();
  if (!/^\d{1,9}$/.test(id)) return null;
  const projectId = Number(m.crm_project_id);
  return {
    linkId: Number(id),
    projectId: Number.isInteger(projectId) && projectId > 0 ? projectId : null,
    entorno: m.crm_entorno ? String(m.crm_entorno) : null,
  };
}

/** ¿La marca es de este campus y de este entorno? Si no, el motivo. */
function motivoAjena(marca, projectId, env) {
  if (marca.projectId !== Number(projectId)) return 'la marca es de otro campus';
  if (marca.entorno !== entorno(env)) return `la marca es de otro entorno (${marca.entorno || 'sin entorno'})`;
  return null;
}

/**
 * El link de un cargo, si lleva la marca. Tres respuestas:
 *   · null: sin marca, o los links apagados → se asocia como siempre;
 *   · { ajeno, motivo }: marca de otro campus o entorno, o de un link que aquí
 *     no existe → no se asocia (ni por el correo: sería adivinar);
 *   · { link }: el cargo ya apunta a su link. Un intento fallido queda en el
 *     historial del link.
 */
export async function linkDelCargo(projectId, payment, dbRow, { env = process.env } = {}) {
  if (!linksPagoActivos(env)) return null;
  const marca = marcaDe(payment.metadata ?? dbRow.metadata);
  if (!marca) return null;
  const ajena = motivoAjena(marca, projectId, env);
  if (ajena) return { ajeno: true, motivo: ajena };
  const link = await model.paraCobro(marca.linkId);
  if (!link || Number(link.project_id) !== Number(projectId)) return { ajeno: true, motivo: 'el link no existe en este campus' };

  await model.atarCargo(dbRow.id, link.id);
  if (payment.status === 'failed') {
    await model.anotarEventoDelCargo(link.id, 'intento_fallido', {
      stripe_id: payment.stripe_id, importe: payment.amount, metodo: payment.payment_method || null,
    });
    await model.marcarAbierto(link.id);
  }
  return { link };
}

/**
 * La venta del link desde un prospecto, creada a nombre de quien creó el link.
 * Devuelve el id de la venta, o null si no se pudo (queda sin asociar y se dice).
 */
async function crearVentaDelLink(projectId, payment, link) {
  const fecha = new Date(Number(payment.stripe_created_at) * 1000).toISOString().slice(0, 10);
  // El importe del link es el precio pactado. En otra moneda, lo que entró en euros
  // (el CRM guarda euros).
  const importe = String(link.moneda).toUpperCase() === 'EUR' ? Number(link.importe) : Number(payment.amount);
  try {
    const { createSale } = await import('../sales/sales.service.js');
    const venta = await createSale({
      project_id: Number(projectId),
      lead_id: Number(link.lead_id),
      producto_interes_id: link.product_id ? Number(link.product_id) : undefined,
      importe_total: importe,
      importe_pagado: 0,
      // Lo cobrado por el link ya es el precio final, IVA dentro. En ISEIE, sin esto,
      // el 21 % se sumaría encima (como en la compra directa de la web).
      iva_incluido: true,
      metodo_pago: 'tarjeta',
      fecha_pago: fecha,
      vendedora_id: link.created_by ? Number(link.created_by) : undefined,
      notas: `Pagada con el link de pago n.º ${link.id} (Stripe ${payment.stripe_id}). Venta creada por el CRM al llegar el cobro.`,
    }, null, {
      // Sin nadie delante para decidir: no se para por «venta repetida» (CRM#898).
      // La de este curso en la misma ficha ya se buscó arriba; si repite otra,
      // sale en Ventas · «Posibles repetidas».
      comprobarRepetida: false,
    });
    logger.info({ projectId, linkId: link.id, conversionId: venta.conversion_id, vendedoraId: link.created_by, stripeId: payment.stripe_id },
      'links de pago: venta creada al pagarse el link');
    return venta.conversion_id;
  } catch (err) {
    logger.warn({ projectId, linkId: link.id, stripeId: payment.stripe_id, err: err.message, code: err.code },
      'links de pago: no se pudo crear la venta del link; el cargo queda sin asociar');
    return null;
  }
}

/**
 * A qué venta va el cobro de un link. Devuelve lo mismo que las reglas de
 * `stripe-payments.service.js` ({ conv, ficha, metodoAuto, email }) más a quién
 * se avisa (quien creó el link), o null si no hay venta posible.
 */
export async function ventaDelLink(projectId, payment, link) {
  let conversionId = link.conversion_id;
  if (!conversionId && link.lead_id) {
    const yaHay = await model.ventaDelCursoEnLaFicha(link.lead_id, link.product_id);
    conversionId = yaHay?.id || await crearVentaDelLink(projectId, payment, link);
    if (conversionId) await model.ponerVenta(link.id, conversionId);
  }
  if (!conversionId) return null;
  const v = await model.ventaConFicha(conversionId);
  if (!v) return null;
  return {
    conv: { id: v.id },
    ficha: { id: v.lead_id, nombre: v.lead_nombre, responsable_id: v.responsable_id },
    metodoAuto: METODO,
    email: payment.customer_email || null,
    avisarA: link.created_by || v.responsable_id || null,
    link,
  };
}

/** Tras apuntar (o encontrar) el cobro: el link, pagado, y su historial. */
export async function trasCobrar(link, { payment, conversionId, conversionPaymentId }) {
  const pagadoEl = new Date(Number(payment.stripe_created_at) * 1000).toISOString();
  const cambio = await model.marcarPagado(link.id, { pagadoEl, conversionId });
  if (!cambio) return;
  await model.anotarEventoDelCargo(link.id, 'pagado', {
    stripe_id: payment.stripe_id, importe: payment.amount, metodo: payment.payment_method || null,
    conversion_id: conversionId, conversion_payment_id: conversionPaymentId,
    ...(cambio.estado_antes !== 'creado' && cambio.estado_antes !== 'abierto' ? { estaba: cambio.estado_antes } : {}),
  });
  if (cambio.estado_antes === 'caducado' || cambio.estado_antes === 'anulado') {
    logger.warn({ linkId: link.id, estaba: cambio.estado_antes, stripeId: payment.stripe_id },
      'links de pago: se ha pagado un link que estaba caducado o anulado; se marca pagado porque el dinero entró');
  }
}

const TIPO_DE_SESION = {
  'checkout.session.completed': 'checkout_completado',
  'checkout.session.async_payment_succeeded': 'pago_confirmado',
  'checkout.session.async_payment_failed': 'intento_fallido',
  'checkout.session.expired': 'sesion_caducada',
};

/**
 * Un aviso `checkout.session.*` de Stripe. Apunta la sesión en el link y en su
 * historial (una vez por evento) y dice si hay que traer el cargo para cobrarlo:
 * `{ cobrar, paymentIntent }`. El cobro NO se apunta aquí: va por el mismo
 * camino que cualquier cargo.
 */
export async function desdeLaSesion(projectId, event, { env = process.env } = {}) {
  if (!linksPagoActivos(env)) return { skipped: 'links de pago apagados' };
  const s = event.data?.object || {};
  const marca = marcaDe(s.metadata);
  // Un checkout que no salió de un link del CRM (la web, una plataforma): no es nuestro.
  if (!marca) return { skipped: 'sin marca del CRM' };
  const ajena = motivoAjena(marca, projectId, env);
  if (ajena) return { skipped: ajena };
  const link = await model.paraCobro(marca.linkId);
  if (!link || Number(link.project_id) !== Number(projectId)
    || (link.stripe_payment_link_id && s.payment_link && s.payment_link !== link.stripe_payment_link_id)) {
    return { skipped: 'el link no existe en este campus' };
  }

  const tipo = TIPO_DE_SESION[event.type];
  const paymentIntent = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id || null;
  const cobrar = (event.type === 'checkout.session.completed' && s.payment_status === 'paid')
    || event.type === 'checkout.session.async_payment_succeeded';
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    await model.datosDeCheckout(link.id, {
      sessionId: s.id || null,
      paymentIntentId: paymentIntent,
      customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id || null,
    });
  }
  await model.anotarEventoDeStripe(link.id, tipo, {
    session_id: s.id || null, payment_status: s.payment_status || null,
    importe: typeof s.amount_total === 'number' ? s.amount_total / 100 : null,
    moneda: s.currency ? String(s.currency).toUpperCase() : null,
  }, event.id || null);
  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
    await model.marcarAbierto(link.id);
  }
  return { link, cobrar, paymentIntent };
}
