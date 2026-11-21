import * as model from './links-pago.model.js';
import { entorno, planDeCuotas } from './links-pago.service.js';
import { normalizePhone } from '../../shared/utils/normalizePhone.js';
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
async function crearVentaDelLink(projectId, payment, link, leadId) {
  const fecha = new Date(Number(payment.stripe_created_at) * 1000).toISOString().slice(0, 10);
  // El importe del link es el precio pactado. En otra moneda, lo que entró en euros
  // (el CRM guarda euros).
  const importe = String(link.moneda).toUpperCase() === 'EUR' ? Number(link.importe) : Number(payment.amount);
  // En cuotas (link sencillo, 20/11): la venta por el total con N cuotas mensuales desde el pago.
  const cuotas = link.modalidad === 'cuotas' && Number(link.num_cuotas) >= 2
    ? planDeCuotas({ total: Number(link.importe), n: Number(link.num_cuotas), desde: fecha })
    : null;
  try {
    const { createSale } = await import('../sales/sales.service.js');
    const venta = await createSale({
      project_id: Number(projectId),
      lead_id: Number(leadId),
      producto_interes_id: link.product_id ? Number(link.product_id) : undefined,
      importe_total: importe,
      importe_pagado: 0,
      // Lo cobrado por el link ya es el precio final, IVA dentro. En ISEIE, sin esto,
      // el 21 % se sumaría encima (como en la compra directa de la web).
      iva_incluido: true,
      metodo_pago: cuotas ? 'fraccionado' : 'tarjeta',
      ...(cuotas ? { installments: cuotas.map((c) => ({ importe_previsto: c.importe, fecha_vencimiento: c.vence })) } : {}),
      fecha_pago: fecha,
      vendedora_id: link.created_by ? Number(link.created_by) : undefined,
      notas: model.notasDeLaVenta(link.id, payment.stripe_id),
    }, null, {
      // Sin nadie delante para decidir: no se para por «venta repetida» (CRM#898).
      // La de este curso en la misma ficha ya se buscó arriba; si repite otra,
      // sale en Ventas · «Posibles repetidas».
      comprobarRepetida: false,
    });
    logger.info({ projectId, linkId: link.id, conversionId: venta.conversion_id, vendedoraId: link.created_by, stripeId: payment.stripe_id,
      cuotas: cuotas?.length || null }, 'links de pago: venta creada al pagarse el link');
    return venta.conversion_id;
  } catch (err) {
    logger.warn({ projectId, linkId: link.id, stripeId: payment.stripe_id, err: err.message, code: err.code },
      'links de pago: no se pudo crear la venta del link; el cargo queda sin asociar');
    return null;
  }
}

/** Quién pagó: lo que trae el cargo y, si falta algo, lo que dijo la sesión de Checkout. */
async function clienteDelPago(payment, link) {
  const delCheckout = (!payment.customer_email || !payment.customer_name || !payment.customer_phone)
    ? await model.clienteDelCheckout(link.id) : null;
  const limpio = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
  return {
    email: limpio(payment.customer_email || delCheckout?.email, 255)?.toLowerCase() || null,
    nombre: limpio(payment.customer_name || delCheckout?.nombre, 200),
    telefono: limpio(payment.customer_phone || delCheckout?.telefono, 40),
  };
}

/*
  EL PROSPECTO DE UN LINK SIN PROSPECTO (Carlos, 20/11: «sin nombre de la
  persona»). Con lo que el alumno escribe en Checkout:
    · si su correo es el de un prospecto del campus, ese (el más reciente, como
      las reglas de asociación de siempre);
    · si no, uno nuevo, asignado a quien creó el link, con su curso y con el
      origen «link de pago» (fuente `link_de_pago` en sus UTM).
  Un segundo aviso de Stripe no crea otro: va por la misma reserva por cargo y,
  si el primero llegó a crearlo, lo encuentra por el correo.
*/
async function prospectoDelPago(projectId, payment, link) {
  const cliente = await clienteDelPago(payment, link);
  if (!cliente.email && !cliente.telefono) {
    logger.warn({ projectId, linkId: link.id, stripeId: payment.stripe_id },
      'links de pago: el pago no trae ni correo ni teléfono; no se puede crear el prospecto y el cargo queda sin asociar');
    return null;
  }
  const { findLeadByEmail } = await import('../stripe-payments/stripe-payments.model.js');
  const existente = cliente.email ? await findLeadByEmail(projectId, cliente.email) : null;
  if (existente) return Number(existente.id);
  try {
    const { createManualLead } = await import('../leads/lead.service.js');
    const r = await createManualLead({
      project_id: Number(projectId),
      nombre: cliente.nombre || cliente.email || cliente.telefono,
      email: cliente.email,
      telefono: cliente.telefono,
      producto_interes_id: link.product_id ? Number(link.product_id) : null,
      canal: 'directo',
      notas: `Entró al pagar el link de pago n.º ${link.id} (Stripe ${payment.stripe_id}).`,
    }, {
      // Para quien creó el link, sin pasar por el reparto; si ya no está, sin nadie.
      creatorUser: link.created_by ? { userId: Number(link.created_by), role: 'gestor' } : null,
      sinResponsable: !link.created_by,
      utms: { utm_source: 'link_de_pago', utm_medium: 'crm', utm_campaign: `link-${link.id}` },
    });
    logger.info({ projectId, linkId: link.id, leadId: r.lead_id, duplicadoDe: r.duplicado_de, stripeId: payment.stripe_id },
      'links de pago: prospecto creado al pagarse un link sin prospecto');
    return Number(r.lead_id);
  } catch (err) {
    logger.warn({ projectId, linkId: link.id, stripeId: payment.stripe_id, err: err.message },
      'links de pago: no se pudo crear el prospecto del link; el cargo queda sin asociar');
    return null;
  }
}

/**
 * La venta de un link que aún no la tiene: la de su prospecto (o la de quien
 * pagó, si el link no tenía) o una nueva. `{ conversionId, cuotaId }` o null.
 */
async function ventaNueva(projectId, payment, link) {
  // ¿Ya la creó este link en un intento que se cortó antes de apuntarla?
  const ya = await model.ventaCreadaPorElLink(projectId, link.id);
  if (ya) {
    await model.ponerVenta(link.id, ya.id, ya.lead_id);
    return { conversionId: ya.id, cuotaId: link.modalidad === 'cuotas' ? await model.primeraCuotaPendiente(ya.id) : null };
  }
  const sinProspecto = !link.lead_id;
  const leadId = link.lead_id || await prospectoDelPago(projectId, payment, link);
  if (!leadId) return null;
  // Link desde un prospecto, de pago único: la venta de ese curso que ya tenga
  // la ficha (la asesora pudo registrarla a mano mientras). En cuotas, o sin
  // prospecto de partida, siempre la suya: lleva su plan y su cobro automático.
  if (!sinProspecto && link.modalidad !== 'cuotas') {
    const yaHay = await model.ventaDelCursoEnLaFicha(leadId, link.product_id);
    if (yaHay) {
      await model.ponerVenta(link.id, yaHay.id, leadId);
      return { conversionId: yaHay.id, cuotaId: null };
    }
  }
  const conversionId = await crearVentaDelLink(projectId, payment, link, leadId);
  if (!conversionId) return null;
  await model.ponerVenta(link.id, conversionId, leadId);
  if (link.modalidad !== 'cuotas') return { conversionId, cuotaId: null };
  // El cobro automático, activo en la venta ANTES de apuntar el cobro: al pagarse
  // el link (`trasCobrar`) se guarda la tarjeta y Stripe programa las demás cuotas.
  const cobroAutoModel = await import('./links-pago.cobro-auto.model.js');
  await cobroAutoModel.poner(conversionId, { projectId: Number(projectId), activo: true, userId: link.created_by ?? null });
  return { conversionId, cuotaId: await model.primeraCuotaPendiente(conversionId) };
}

/**
 * A qué venta va el cobro de un link. Devuelve lo mismo que las reglas de
 * `stripe-payments.service.js` ({ conv, ficha, metodoAuto, email }) más a quién
 * se avisa (quien creó el link), o null si no hay venta posible. Si el link
 * creó la venta en cuotas, `cuotaId`: la cuota 1, que salda este cobro.
 */
export async function ventaDelLink(projectId, payment, link) {
  let conversionId = link.conversion_id;
  let cuotaId = null;
  if (!conversionId) {
    const nueva = await ventaNueva(projectId, payment, link);
    conversionId = nueva?.conversionId || null;
    cuotaId = nueva?.cuotaId || null;
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
    ...(cuotaId ? { cuotaId } : {}),
  };
}

/** Tras apuntar (o encontrar) el cobro: el link, pagado, y su historial. */
export async function trasCobrar(link, { payment, conversionId, conversionPaymentId }) {
  const pagadoEl = new Date(Number(payment.stripe_created_at) * 1000).toISOString();
  const cambio = await model.marcarPagado(link.id, { pagadoEl, conversionId });
  if (!cambio) return;
  // Cobro automático de las cuotas (309): si el link guardaba la tarjeta, se
  // apunta en la venta y se programan en Stripe las cuotas siguientes.
  if (link.guarda_tarjeta) {
    const { trasPagarseUnLink } = await import('./links-pago.cobro-auto.js');
    await trasPagarseUnLink(link, payment, conversionId);
  }
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
  // Quién pagó (correo, nombre y teléfono que escribió en Checkout): con eso se
  // busca o se crea el prospecto de un link sin prospecto, si el cargo no lo trae.
  const cd = s.customer_details || null;
  const cliente = cd && (cd.email || cd.name || cd.phone)
    ? { email: cd.email || null, nombre: cd.name || null, telefono: cd.phone || null }
    : null;
  await model.anotarEventoDeStripe(link.id, tipo, {
    session_id: s.id || null, payment_status: s.payment_status || null,
    importe: typeof s.amount_total === 'number' ? s.amount_total / 100 : null,
    moneda: s.currency ? String(s.currency).toUpperCase() : null,
    ...(cliente ? { cliente } : {}),
  }, event.id || null);
  // Si el cargo llegó antes y creó el prospecto sin teléfono, se completa.
  if (cliente?.telefono) await model.completarTelefono(link.id, normalizePhone(cliente.telefono) || cliente.telefono);
  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
    await model.marcarAbierto(link.id);
  }
  return { link, cobrar, paymentIntent };
}
