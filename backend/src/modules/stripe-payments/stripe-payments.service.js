import crypto from 'crypto';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { activa as facturaAutomaticaActiva } from '../factura-automatica/factura-automatica.config.js';
import { decrypt } from '../../shared/utils/crypto.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import { query } from '../../shared/config/db.js';
import * as model from './stripe-payments.model.js';
import * as tutores from '../tutores/tutor.model.js';
// Ventas a plazos: al asociar un cargo, su suscripción se apunta y se cierra al completar el pago (#747).
import { trasAsociarCargo, claveDeStripe, suscripcionDelCargo } from './suscripciones.service.js';
// Cada pago a su venta y la compra directa crea la suya (puerta 6, #487; gemela de CRM#848).
import {
  pedidoDeLaWeb, formacionDelPedido, elegirVenta, crearVentaDeCompraDirecta, compraDirectaActiva, configCompraDirecta,
  PEDIDO_SIN_LEER,
} from './compra-directa.service.js';
// El interruptor de las reglas nuevas de asociación (apagado de serie).
import { asociacionV2Activa } from './asociacion.config.js';
// Links de pago, fase 3 (#407, gemela de CRM#680): la marca del CRM en el cargo ata el cobro a su link y su venta.
import * as cobroDelLink from '../links-pago/links-pago.cobro.js';

export { asociacionV2Activa };

export async function getStripeKey(projectId) {
  try {
    const row = await integrationsModel.get(projectId, 'stripe');
    if (row?.encrypted_value) return decrypt(row.encrypted_value, row.iv, row.auth_tag);
  } catch (e) { logger.warn({ e: e.message }, 'getStripeKey failed'); }
  return process.env.STRIPE_SECRET_KEY || null;
}

export async function getWebhookSecret(projectId) {
  try {
    const row = await integrationsModel.get(projectId, 'stripe');
    const pub = row?.config_public || {};
    // Las columnas row.webhook_iv y row.webhook_auth_tag NUNCA han existido en
    // project_integrations —son iv y auth_tag, y pertenecen a la clave de API—,
    // asi que esta rama estaba muerta y siempre se caia al texto plano. El
    // secreto guarda ahora su propio iv y su etiqueta dentro de config_public.
    if (pub.webhook_secret_encrypted && pub.webhook_secret_iv && pub.webhook_secret_auth_tag) {
      return decrypt(pub.webhook_secret_encrypted, pub.webhook_secret_iv, pub.webhook_secret_auth_tag);
    }
    return pub.webhook_secret || null;
  } catch (e) { return null; }
}

export async function stripeGet(apiKey, path, params = {}) {
  const url = new URL(`https://api.stripe.com${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Stripe ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function chargeToPayment(charge, projectId) {
  // Importe SIEMPRE en EUR: si el cargo entra en moneda extranjera, usamos el
  // importe liquidado por Stripe en EUR (balance_transaction.amount), no el
  // importe en la moneda del cargo. Así el CRM registra euros reales y no vuelve
  // a pasar lo de las facturas en $/CRC/COP.
  const bt = charge.balance_transaction; // objeto expandido (expand[]=data.balance_transaction)
  const chargeCur = (charge.currency || 'eur').toLowerCase();
  const foreign = chargeCur !== 'eur';
  const settledEur = bt && typeof bt.amount === 'number' ? bt.amount / 100 : null;
  const amountEur = foreign && settledEur != null ? settledEur : (charge.amount || 0) / 100;
  return {
    project_id: projectId,
    stripe_id: charge.id,
    type: 'charge',
    status: charge.status,
    amount: amountEur,
    currency: 'EUR',
    // Comisión de Stripe y neto realmente liquidado (para la copia de gestión).
    // La factura del alumno siempre va por el bruto (amount).
    fee_amount: bt && typeof bt.fee === 'number' ? bt.fee / 100 : null,
    net_amount: bt && typeof bt.net === 'number' ? bt.net / 100 : null,
    customer_email: charge.billing_details?.email || charge.receipt_email || null,
    customer_name: charge.billing_details?.name || null,
    customer_stripe_id: charge.customer || null,
    description: charge.description || null,
    metadata: {
      ...(charge.metadata || {}),
      ...(foreign ? { original_amount: (charge.amount || 0) / 100, original_currency: chargeCur.toUpperCase(), stripe_exchange_rate: bt?.exchange_rate ?? null } : {}),
    },
    payment_method: charge.payment_method_details?.type || null,
    disputed: !!charge.disputed,
    dispute_status: charge.dispute?.status || null,
    dispute_reason: charge.dispute?.reason || null,
    refunded: !!charge.refunded,
    refunded_amount: charge.amount_refunded ? charge.amount_refunded / 100 : null,
    stripe_created_at: charge.created,
  };
}

/*
  UN CARGO CON VENTA PERO SIN COBRO SE VUELVE A ENGANCHAR (19/10).

  Dayana, venta 595 de Psiko (Laura): apuntó a mano la cuota de 108,33 € (cobro 881),
  la sincronización vio el cargo de Stripe y lo enganchó a ese cobro (auto_dedup), y
  luego ella borró el 881 y lo volvió a apuntar (882). Al borrarse, el cargo se quedó
  con la venta pero SIN cobro, y como solo se intentaba enganchar lo que no tenía venta,
  ya nadie lo miraba: en Stripe salía como «asociado» a un cobro que no existe.

  Ahora, si el cargo tiene venta y no cobro, se busca el cobro equivalente que ya
  esté apuntado (findPagoDuplicado: el mismo cargo en las notas, o mismo importe con
  un euro de margen y fecha a menos de 4 días, sin otro cargo enganchado). Si lo hay,
  se engancha. NUNCA se crea un cobro aquí: si no lo hay, el dinero ya pudo contarse
  de otra forma y apuntarlo otra vez lo contaría dos veces.
*/
export async function reengancharCobro(payment, dbRow) {
  if (dbRow.conversion_payment_id || payment.status !== 'succeeded') return;
  const segundos = Number(payment.stripe_created_at ?? 0);
  const fecha = segundos > 0
    ? new Date(segundos * 1000).toISOString().slice(0, 10)
    : new Date(dbRow.stripe_created_at).toISOString().slice(0, 10);
  const dup = await model.findPagoDuplicado(dbRow.conversion_id, payment.amount ?? dbRow.amount, fecha, payment.stripe_id ?? dbRow.stripe_id);
  if (!dup) return;
  await model.linkPayment(dbRow.id, {
    leadId: dbRow.lead_id, conversionId: dbRow.conversion_id, conversionPaymentId: dup.id,
    userId: dbRow.linked_by ?? null, method: dbRow.link_method || 'auto_dedup',
  });
  logger.info({ stripeId: dbRow.stripe_id, conversionId: dbRow.conversion_id, conversionPaymentId: dup.id },
    'cargo de Stripe sin cobro: enganchado al cobro que ya estaba');
}

// Marca de «lo está enlazando alguien ahora» en link_method. Empieza por «auto» para que
// la pantalla de cargos, si la llega a ver, lo cuente como automático.
const ENLAZANDO = 'auto_enlazando';
// Si el proceso muere con la reserva puesta, pasado este tiempo otro la puede retomar.
const RESERVA_MINUTOS = 2;

/**
 * Enlaza un cargo con su venta, de UNO EN UNO por cargo (gemela de CRM#680 / CRM#635).
 *
 * El mismo cargo llega por varios caminos: el aviso de Stripe, el sondeo de cada 5 minutos
 * y el botón «Sincronizar». Si dos llegaban a la vez, los dos veían la fila aún sin venta,
 * los dos pasaban por la comprobación de duplicados antes de que el otro escribiera y los
 * dos sumaban el cobro: la venta acababa con el mismo pago dos veces.
 *
 * Ahora el cargo se RESERVA con una sola sentencia: quien recibe la fila lo enlaza y los
 * demás no hacen nada (ya lo está haciendo otro). Nadie se queda esperando con una conexión
 * cogida: un bloqueo de sesión retendría una conexión mientras el enlace pide otras al
 * mismo pool (max 20), y con ~20 cargos distintos a la vez se agotaría y se perderían
 * cobros sin aviso.
 *
 * La reserva pisa link_method y linked_at, así que la sentencia devuelve también los
 * valores de antes: son los que ve el enlace y los que vuelven a la fila si no se enlaza.
 */
async function autoLinkIfPossible(projectId, payment, dbRow, opciones = {}) {
  const { rows: [reservada] } = await query(
    `UPDATE stripe_payments sp
        SET link_method = $2, linked_at = NOW()
       FROM (SELECT id, link_method, linked_at FROM stripe_payments WHERE id = $1 FOR UPDATE) antes
      WHERE sp.id = antes.id
        AND sp.conversion_payment_id IS NULL
        AND (sp.link_method IS DISTINCT FROM $2 OR sp.linked_at < NOW() - make_interval(mins => $3))
      RETURNING sp.*, antes.link_method AS metodo_antes, antes.linked_at AS enlazado_antes`,
    [dbRow.id, ENLAZANDO, RESERVA_MINUTOS]
  );
  if (!reservada) return; // ya tiene su cobro, o lo está enlazando otro ahora mismo

  // Una reserva caducada no guarda lo de antes: se deja sin método, como un cargo nuevo.
  const metodo = reservada.metodo_antes === ENLAZANDO ? null : reservada.metodo_antes;
  const enlazado = reservada.metodo_antes === ENLAZANDO ? null : reservada.enlazado_antes;
  try {
    return await enlazarSiSePuede(projectId, payment, { ...reservada, link_method: metodo, linked_at: enlazado }, opciones);
  } finally {
    // Si se enlazó, linkPayment ya cambió link_method y esto no toca nada. Si no (sin lead,
    // otra moneda, un error…), la fila vuelve a como estaba para el siguiente intento.
    await query(
      `UPDATE stripe_payments SET link_method = $2, linked_at = $3 WHERE id = $1 AND link_method = $4`,
      [dbRow.id, metodo, enlazado, ENLAZANDO]
    ).catch((e) => logger.error({ err: e.message, projectId, stripeId: dbRow.stripe_id },
      'stripe: no se pudo soltar la reserva del cargo; caduca sola en 2 minutos'));
  }
}

/**
 * De qué suscripción de Stripe viene un cargo SIN venta (puerta 6, gemela de CRM#848).
 *
 * Una renovación pagada con otro correo no encaja por correo, pero su suscripción
 * es la de la venta (#747 la apunta en `conversions.stripe_subscription_id`). Se
 * pregunta a Stripe UNA vez por cargo y se apunta en él (`suscripcion_buscada`);
 * solo si el cargo tiene cliente de Stripe, que es lo que tienen los de
 * suscripción. Si Stripe falla no se marca nada: se reintenta en la siguiente.
 */
export async function suscripcionDelCargoSuelto(projectId, payment, dbRow, {
  clave = claveDeStripe, delCargo = suscripcionDelCargo,
} = {}) {
  if (dbRow.stripe_subscription_id) return dbRow.stripe_subscription_id;
  if (dbRow.suscripcion_buscada) return null;
  if (!(payment.customer_stripe_id || dbRow.customer_stripe_id)) return null;
  try {
    const apiKey = await clave(projectId);
    if (!apiKey) return null;
    const sub = await delCargo(apiKey, payment.stripe_id || dbRow.stripe_id);
    await model.guardarSuscripcionDelCargo(dbRow.id, sub);
    return sub;
  } catch (e) {
    logger.warn({ projectId, stripeId: payment.stripe_id || dbRow.stripe_id, err: e.message },
      'stripe: no se pudo saber de qué suscripción viene el cargo');
    return null;
  }
}

/**
 * A QUÉ VENTA VA, COMO SIEMPRE (con el interruptor apagado): la venta más
 * reciente de la ficha más nueva con ese correo, y solo si la ficha está
 * «convertida». Si hay ficha pero no venta, el cargo queda «pendiente» en ella.
 * Devuelve { conv, ficha, metodoAuto } o null si no se asocia.
 */
async function ventaComoSiempre(projectId, payment, dbRow) {
  const lead = await model.findLeadByEmail(projectId, payment.customer_email);
  if (!lead) return null;
  const conv = lead.status === 'convertido' ? await model.findConversionByLeadId(lead.id) : null;
  if (!conv) {
    await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: null, conversionPaymentId: null, userId: null, method: 'auto_pending' });
    return null;
  }
  return { conv, ficha: lead, metodoAuto: 'auto_email' };
}

/**
 * A QUÉ VENTA VA, CON LAS REGLAS NUEVAS (puerta 6, gemela de CRM#848; solo con el
 * interruptor STRIPE_ASOCIACION_V2_ACTIVA encendido). Por orden:
 *
 *   1. Por el correo, como siempre: la venta más reciente de la ficha más nueva.
 *      Ya no hace falta que la ficha esté «convertida»: si tiene venta, la
 *      venta manda.
 *   2. Si es una compra en la web (pedido de WooCommerce), su formación decide:
 *      la venta de ESA formación entre todas las fichas con ese correo; una
 *      compra de un curso nuevo no se cuelga de la venta de otro. Y si la ficha
 *      más nueva no tenía venta, se mira en las de antes (duplicados).
 *   3. Por la suscripción de Stripe: la venta que la tiene, aunque el correo no
 *      encaje.
 *   4. Compra directa sin venta (solo desde la pasada de compras directas, con
 *      su interruptor y su espera): se crea la venta, sin gestora.
 *
 * Lo que no encaje se queda «sin asociar», como antes.
 *
 * `sinEsperarALaTienda` (lo pide el aviso de Stripe): el pedido se lee solo si ya
 * está guardado en el CRM. Si hay que pedírselo a la tienda, no se decide nada
 * aquí —devuelve { aplazado: true }— y quien llama lo enlaza después, ya fuera de
 * la respuesta a Stripe.
 */
async function ventaConLasReglasNuevas(projectId, payment, dbRow, { compraDirecta = false, sinEsperarALaTienda = false } = {}) {
  const email = payment.customer_email || dbRow.customer_email || null;
  const pedido = pedidoDeLaWeb(payment.metadata ?? dbRow.metadata);
  let formacion = null;
  if (pedido) {
    formacion = await formacionDelPedido(projectId, pedido, { soloGuardado: sinEsperarALaTienda });
    if (formacion === PEDIDO_SIN_LEER) return { aplazado: true };
  }
  const lead = email ? await model.findLeadByEmail(projectId, email) : null;
  let conv = lead ? await model.findConversionByLeadId(lead.id) : null;
  let ficha = lead;
  let metodoAuto = 'auto_email';

  if (lead && (!conv || formacion)) {
    const elegida = elegirVenta(await model.ventasPorCorreo(projectId, email), formacion?.id);
    conv = elegida;
    if (elegida) ficha = { id: elegida.lead_id };
  }

  if (!conv) {
    const sub = await suscripcionDelCargoSuelto(projectId, payment, dbRow);
    const deLaSuscripcion = sub ? await model.ventaDeLaSuscripcion(projectId, sub) : null;
    if (deLaSuscripcion) {
      conv = deLaSuscripcion;
      ficha = { id: deLaSuscripcion.lead_id };
      metodoAuto = 'auto_suscripcion';
    }
  }

  // Solo la pide la pasada de compras directas, que ya mira el interruptor y la espera.
  if (!conv && compraDirecta && pedido) {
    try {
      const creada = await crearVentaDeCompraDirecta({ projectId, payment: { ...payment, customer_email: email }, lead, formacion, orderId: pedido });
      if (creada) {
        conv = { id: creada.id };
        ficha = { id: creada.lead_id };
        metodoAuto = 'auto_compra_directa';
      }
    } catch (e) {
      logger.warn({ projectId, stripeId: payment.stripe_id, err: e.message, code: e.code },
        'compra directa: no se pudo crear la venta; el cargo se queda sin asociar');
    }
  }

  if (!conv) {
    if (lead) await model.linkPayment(dbRow.id, { leadId: lead.id, conversionId: null, conversionPaymentId: null, userId: null, method: 'auto_pending' });
    return null;
  }
  return { conv, ficha, metodoAuto };
}

async function enlazarSiSePuede(projectId, payment, dbRow, { compraDirecta = false, sinEsperarALaTienda = false } = {}) {
  if (dbRow.conversion_id) {
    await reengancharCobro(payment, dbRow);
    return;
  }
  // LINKS DE PAGO (CRM#680, fase 3): la marca del CRM va PRIMERO, es la asociación
  // más segura. Con marca de este campus y entorno, el cobro va a la venta del
  // link (o se crea desde su prospecto) sin mirar el correo; con marca ajena no
  // se asocia. Sin marca, o con los links apagados, todo sigue como siempre.
  const delLink = await cobroDelLink.linkDelCargo(projectId, payment, dbRow);
  if (delLink?.ajeno) {
    logger.info({ projectId, stripeId: payment.stripe_id, motivo: delLink.motivo },
      'cargo con la marca de un link de pago que no es de aquí: no se asocia');
    return;
  }
  // Apagado el interruptor, como siempre: sin correo en el cargo no se hace nada.
  const v2 = asociacionV2Activa();
  if (payment.status !== 'succeeded' || (!delLink && !v2 && !payment.customer_email)) return;
  // Un cargo en otra moneda solo vale si su importe ya viene liquidado en euros.
  // Los importados sin el balance_transaction guardaron el importe en la moneda
  // del cargo: asociarlos meteria 270.000 pesos colombianos como 270.000 euros.
  const moneda = String(payment.currency || dbRow.currency || 'EUR').toUpperCase();
  if (moneda !== 'EUR') {
    logger.warn({ stripeId: payment.stripe_id, moneda, importe: payment.amount },
      'cargo en moneda extranjera sin convertir a euros: no se asocia');
    return;
  }

  const destino = delLink
    ? await cobroDelLink.ventaDelLink(projectId, payment, delLink.link)
    : v2
      ? await ventaConLasReglasNuevas(projectId, payment, dbRow, { compraDirecta, sinEsperarALaTienda })
      : await ventaComoSiempre(projectId, payment, dbRow);
  if (destino?.aplazado) return { aplazado: true };
  if (!destino) return;
  const { conv, ficha, metodoAuto } = destino;
  const fecha = new Date(payment.stripe_created_at * 1000).toISOString().slice(0, 10);
  // ¿Es realmente un duplicado? Lo es cuando la asesora ya registró ESE MISMO cobro a mano:
  // mismo importe y fecha muy próxima en la misma venta. No basta con que la venta esté
  // saldada — hay ventas cuyo importe_total quedó corto y siguen recibiendo mensualidades
  // legítimas, y bloquearlas dejaba el cobro sin factura.
  const dup = await model.findPagoDuplicado(conv.id, payment.amount, fecha, payment.stripe_id);
  if (dup) {
    // Se vincula al pago que ya existe (y a su factura, si la tiene) SIN volver a sumar.
    await model.linkPayment(dbRow.id, { leadId: ficha.id, conversionId: conv.id, conversionPaymentId: dup.id, userId: null, method: 'auto_dedup' });
    if (destino.link) await cobroDelLink.trasCobrar(destino.link, { payment, conversionId: conv.id, conversionPaymentId: dup.id });
    return;
  }
  // Registrar el cobro con la MISMA lógica que un pago manual (conversion.model.addPayment):
  // salda la cuota pendiente más antigua (FIFO). allowOverpay: un cobro real de Stripe se
  // registra aunque supere el total previsto de la venta (el total es lo que suele estar mal).
  const convModel = await import('../conversions/conversion.model.js');
  const res = await convModel.addPayment(conv.id, {
    importe: payment.amount, fecha, metodo: 'tarjeta',
    notas: destino.link ? `Auto-Stripe ${payment.stripe_id} (link de pago n.º ${destino.link.id})` : `Auto-Stripe ${payment.stripe_id}`,
  }, { allowOverpay: true, allowDuplicate: true });
  if (res?.error || !res?.payment) return;
  const cpId = res.payment.id;
  await model.linkPayment(dbRow.id, { leadId: ficha.id, conversionId: conv.id, conversionPaymentId: cpId, userId: null, method: metodoAuto });
  if (destino.link) await cobroDelLink.trasCobrar(destino.link, { payment, conversionId: conv.id, conversionPaymentId: cpId });
  // El cobro queda registrado en la venta y espera EN LA COLA de facturacion.
  // La factura NO sale sola: la emite una persona cuando comprueba que los datos
  // del cliente estan bien. Antes se emitia aqui mismo, y salian facturas
  // numeradas con lo que hubiera en la ficha en ese momento.
  logger.info({ conversionId: conv.id, paymentId: cpId, stripeId: payment.stripe_id },
    'cobro de Stripe registrado; queda en la cola de facturacion');
  // Factura automatica (#452), si esta encendida en este campus: pide los datos
  // fiscales al alumno o, si ya los dio, emite la de este cobro.
  facturaAutomatica(conv.id, cpId);

  // El cobro de un link de pago (CRM#680, fase 3) se avisa a quien creó el link: la
  // venta es suya. En MultiCRM va dentro del aviso de toda venta automática (#111),
  // que ISEIE no tiene; aquí solo el del link.
  if (destino.link && destino.avisarA) {
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    const euros = Number(payment.amount).toLocaleString('es-ES', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    await notifyUsers({
      targetUserIds: [destino.avisarA],
      type: 'venta_automatica',
      title: `Link de pago cobrado: ${euros} € de ${ficha.nombre || destino.email || 'tu cliente'}`,
      message: 'Se ha registrado solo en su venta, a tu nombre. Queda en la cola de facturacion.',
      link_path: `/leads/${ficha.id}`,
      metadata: { lead_id: ficha.id, conversion_id: conv.id, stripe_id: payment.stripe_id, payment_link_id: destino.link.id },
    }).catch(() => {});
  }
}

// Trae detalle completo de dispute desde Stripe API (incluye evidence_due_by)
async function fetchAndUpdateDispute(apiKey, projectId, charge) {
  if (!charge.disputed) return;
  try {
    const data = await stripeGet(apiKey, '/v1/disputes', { 'charge': charge.id, limit: 1 });
    const d = data.data?.[0];
    if (!d) return;
    // La misma puerta que el webhook y el sondeo de disputas (#396): se guarda en
    // `stripe_disputes`, se deja al dia el cargo y, si es nueva y abierta, se avisa.
    const { guardar } = await import('./disputas.service.js');
    await guardar(projectId, { ...d, charge }, { origen: 'sondeo' });
  } catch (e) {
    logger.warn({ chargeId: charge.id, err: e.message }, 'fetchDispute failed');
  }
}

export async function syncStripePayments(projectId, { fullHistory = false, retryPending = false } = {}) {
  const apiKey = await getStripeKey(projectId);
  if (!apiKey) throw new Error('Stripe API key no configurada para este proyecto');

  const state = await model.getSyncState(projectId);
  let createdGte = null;
  if (!fullHistory && state?.last_synced_until) {
    createdGte = Math.floor(new Date(state.last_synced_until).getTime() / 1000) - 3600;
  }

  let imported = 0;
  let disputesFound = 0;
  let lastCreated = state?.last_synced_until ? Math.floor(new Date(state.last_synced_until).getTime() / 1000) : 0;
  let startingAfter = null;
  let pages = 0;
  const MAX_PAGES = 200;

  while (pages < MAX_PAGES) {
    const params = { limit: 100, 'expand[]': 'data.balance_transaction' };
    if (createdGte) params['created[gte]'] = createdGte;
    if (startingAfter) params.starting_after = startingAfter;

    const data = await stripeGet(apiKey, '/v1/charges', params);
    if (!data.data?.length) break;

    for (const ch of data.data) {
      try {
        const payment = chargeToPayment(ch, projectId);
        const dbRow = await model.upsertPayment(payment);
        try { await autoLinkIfPossible(projectId, payment, dbRow); }
        catch (e) { logger.error({ err: e.message, projectId, stripeId: ch.id }, 'stripe: el cargo no se pudo enlazar con su venta (sondeo)'); }
        await trasAsociarCargo(dbRow.id);
        if (ch.disputed) {
          await fetchAndUpdateDispute(apiKey, projectId, ch);
          disputesFound++;
        }
        imported++;
        if (ch.created > lastCreated) lastCreated = ch.created;
      } catch (e) {
        logger.warn({ chargeId: ch.id, err: e.message }, 'Charge sync failed - continua');
      }
    }
    if (!data.has_more) break;
    startingAfter = data.data[data.data.length - 1].id;
    pages++;
  }


  // Segunda pasada: los cargos que ya estaban importados y siguen sin asociar.
  // Stripe solo devuelve los cargos nuevos, asi que sin esto un cobro cuya
  // asociacion se deshizo no se volveria a enganchar nunca por mucho que se
  // pulse Sincronizar.
  //
  // Solo se hace cuando alguien pulsa Sincronizar a mano (retryPending). El cron
  // de cada 5 min no lo dispara: reasociar en masa es una decision del usuario,
  // no algo que deba pasar solo de madrugada.
  let reasociados = 0;
  if (retryPending) try {
    const pendientes = await model.listPendientesDeAsociar(projectId, 5000);
    for (const row of pendientes) {
      try {
        const antes = row.conversion_payment_id;
        await autoLinkIfPossible(projectId, {
          status: row.status,
          amount: Number(row.amount),
          customer_email: row.customer_email,
          customer_name: row.customer_name,
          customer_stripe_id: row.customer_stripe_id,
          metadata: row.metadata,
          currency: row.currency,
          stripe_created_at: Number(row.stripe_created_at),
          stripe_id: row.stripe_id,
        }, row);
        const despues = await model.getById(row.id);
        if (!antes && despues?.conversion_payment_id) reasociados++;
      } catch (e) {
        logger.warn({ stripeId: row.stripe_id, err: e.message }, 'reintento de asociacion fallido');
      }
    }
    // Y los que tienen venta pero se quedaron sin cobro (ver reengancharCobro).
    for (const row of await model.listConVentaSinCobro(projectId, 500)) {
      try {
        await reengancharCobro({
          status: row.status, amount: Number(row.amount),
          stripe_created_at: Number(row.stripe_created_at), stripe_id: row.stripe_id,
        }, row);
        if ((await model.getById(row.id))?.conversion_payment_id) reasociados++;
      } catch (e) {
        logger.warn({ stripeId: row.stripe_id, err: e.message }, 'reenganche al cobro fallido');
      }
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'no se pudo reintentar la asociacion de pendientes');
  }

  // Las compras directas en la web que siguen sin venta (puerta 6). Con su
  // interruptor: apagado no hace nada. Va también en el sondeo porque una compra
  // en la web no la registra nadie: si esperara al botón, no saldría. Pero en el
  // sondeo, una vez por hora y campus como mucho: un pedido que la tienda no
  // encuentra se volvería a pedir cada 5 minutos.
  let ventasCreadas = 0;
  const ultima = ULTIMA_PASADA_COMPRAS.get(projectId) || 0;
  if (retryPending || Date.now() - ultima > PASADA_COMPRAS_CADA_MS) {
    ULTIMA_PASADA_COMPRAS.set(projectId, Date.now());
    try { ventasCreadas = (await comprasDirectasSinVenta(projectId)).creadas; }
    catch (e) { logger.warn({ projectId, err: e.message }, 'compra directa: la pasada falló; se reintenta en la siguiente'); }
  }

  await model.upsertSyncState(projectId, {
    last_sync_at: new Date().toISOString(),
    last_full_sync_at: fullHistory ? new Date().toISOString() : (state?.last_full_sync_at || null),
    last_synced_until: lastCreated ? new Date(lastCreated * 1000).toISOString() : (state?.last_synced_until || null),
    total_imported: (state?.total_imported || 0) + imported,
    last_error: null,
  });

  logger.info({ projectId, imported, disputesFound, pages, reasociados, ventasCreadas }, 'Stripe sync OK');
  return { imported, disputes: disputesFound, pages, reasociados, ventasCreadas };
}

// Cuándo pasó por última vez la pasada de compras directas en cada campus (en memoria).
const ULTIMA_PASADA_COMPRAS = new Map();
const PASADA_COMPRAS_CADA_MS = 60 * 60 * 1000;

/**
 * LA PASADA DE COMPRAS DIRECTAS (puerta 6, gemela de CRM#848).
 *
 * Los cargos de pedidos de la web que llevan más de COMPRA_DIRECTA_ESPERA_HORAS sin
 * venta: se vuelven a intentar asociar (la asesora pudo registrarla mientras) y, si
 * nada encaja, se crea la venta sin gestora con la formación del pedido. Pasa por la
 * misma reserva que todo enlace: aunque coincidan el sondeo y el botón, una venta
 * por cargo.
 */
export async function comprasDirectasSinVenta(projectId, { env = process.env, limite = 25 } = {}) {
  // Crear la venta es la regla 4 de las nuevas: sin ellas encendidas, tampoco.
  if (!compraDirectaActiva(env) || !asociacionV2Activa(env)) return { mirados: 0, creadas: 0 };
  const { esperaHoras, dias } = configCompraDirecta(env);
  const filas = await model.listComprasDirectasSinVenta(projectId, { esperaHoras, dias, limit: limite });
  let creadas = 0;
  for (const row of filas) {
    try {
      await autoLinkIfPossible(projectId, {
        stripe_id: row.stripe_id,
        status: row.status,
        amount: Number(row.amount),
        currency: row.currency,
        customer_email: row.customer_email,
        customer_name: row.customer_name,
        customer_stripe_id: row.customer_stripe_id,
        metadata: row.metadata,
        stripe_created_at: Number(row.stripe_created_at),
      }, row, { compraDirecta: true });
      const despues = await model.getById(row.id);
      if (despues?.link_method === 'auto_compra_directa') {
        creadas += 1;
        // Como cualquier cargo recién asociado: su suscripción, si la tiene (#747).
        await trasAsociarCargo(row.id);
      }
    } catch (e) {
      logger.warn({ projectId, stripeId: row.stripe_id, err: e.message }, 'compra directa: el cargo no se pudo procesar');
    }
  }
  if (filas.length) logger.info({ projectId, mirados: filas.length, creadas }, 'compras directas sin venta: pasada hecha');
  return { mirados: filas.length, creadas };
}

/**
 * ENLAZAR UN CARGO CON EL COBRO (O LA FACTURA) DE ESE MISMO PAGO (CRM#888).
 *
 * «Asociar» busca solo el cobro equivalente: mismo importe con un euro de
 * margen y a tres días o menos. Si la gestora lo apuntó con otro importe (la
 * cuota del plan y no lo que cobró Stripe) o con otra fecha, no lo encuentra y
 * crea OTRO cobro: el dinero contado dos veces y, después, otra factura.
 *
 * Aquí quien enlaza dice cuál es: el cargo queda en ese cobro, sin crear cobro
 * ni factura y sin tocar su importe (la factura ya emitida manda). El id del
 * cargo va a las notas del cobro, que es lo que mira `findPagoDuplicado` para
 * no volver a registrarlo. Errores con `code` para la pantalla.
 */
export async function enlazarConCobro(stripePaymentId, { conversionPaymentId = null, invoiceId = null, userId = null }) {
  const cargo = await model.getById(stripePaymentId);
  if (!cargo) throw new AppError('Cargo no encontrado', 404, 'NOT_FOUND');
  if (cargo.status !== 'succeeded') {
    throw new AppError('Ese cargo no se cobró en Stripe: no se enlaza con un cobro.', 409, 'CARGO_NO_COBRADO');
  }
  let pagoId = conversionPaymentId ? Number(conversionPaymentId) : null;
  if (!pagoId && invoiceId) {
    const { rows } = await query('SELECT payment_id FROM invoices WHERE id = $1', [invoiceId]);
    if (!rows[0]) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    if (!rows[0].payment_id) throw new AppError('Esa factura no tiene cobro al que enlazar el cargo.', 409, 'FACTURA_SIN_COBRO');
    pagoId = rows[0].payment_id;
  }
  if (!pagoId) throw new AppError('Di con qué cobro o factura se enlaza.', 400, 'BAD_REQUEST');
  const { rows: cobro } = await query(
    `SELECT cp.id, cp.conversion_id, cp.importe, c.lead_id, c.project_id
       FROM conversion_payments cp JOIN conversions c ON c.id = cp.conversion_id WHERE cp.id = $1`, [pagoId]);
  if (!cobro[0]) throw new AppError('Cobro no encontrado', 404, 'NOT_FOUND');
  if (Number(cobro[0].project_id) !== Number(cargo.project_id)) throw new AppError('Cobro no encontrado', 404, 'NOT_FOUND');
  if (cargo.conversion_payment_id && Number(cargo.conversion_payment_id) !== pagoId) {
    throw new AppError('Ese cargo ya está enlazado con otro cobro. Desasócialo antes.', 409, 'CARGO_YA_ENLAZADO');
  }
  const { rows: otro } = await query(
    `SELECT id FROM stripe_payments WHERE conversion_payment_id = $1 AND id <> $2 AND status = 'succeeded' LIMIT 1`,
    [pagoId, stripePaymentId]);
  if (otro[0]) throw new AppError('Ese cobro ya tiene otro cargo de Stripe enlazado.', 409, 'COBRO_YA_TIENE_CARGO');

  await model.linkPayment(stripePaymentId, {
    leadId: cobro[0].lead_id, conversionId: cobro[0].conversion_id, conversionPaymentId: pagoId,
    userId, method: 'manual_cobro',
  });
  if (/^[A-Za-z0-9_]+$/.test(String(cargo.stripe_id || ''))) {
    await query(
      `UPDATE conversion_payments SET notas = concat_ws(' · ', NULLIF(notas, ''), 'Stripe ' || $2::text)
        WHERE id = $1 AND COALESCE(notas, '') NOT LIKE '%' || $2::text || '%'`,
      [pagoId, cargo.stripe_id]);
  }
  if (Math.abs(Number(cargo.amount) - Number(cobro[0].importe)) > 0.01) {
    logger.info({ stripePaymentId, pagoId, cargo: Number(cargo.amount), cobro: Number(cobro[0].importe) },
      'cargo enlazado con un cobro de otro importe: manda el cobro (y su factura)');
  }
  await trasAsociarCargo(stripePaymentId);
  return { conversionPaymentId: pagoId, conversionId: cobro[0].conversion_id };
}

export async function manualLink(stripePaymentId, { leadId, conversionId, userId }) {
  let cpId = null;
  let importe = 0;
  let yaExistia = false;
  if (conversionId) {
    const { rows } = await query(
      `SELECT amount, stripe_id, stripe_created_at, status FROM stripe_payments WHERE id=$1`, [stripePaymentId]);
    // Un cargo que NO se cobro no registra pago. Nunca.
    //
    // Aqui no se miraba el estado: asociar un cargo fallido creaba un cobro por
    // su importe, o sea dinero que no entro figurando como cobrado, y de ahi a
    // una factura emitida por algo que nadie pago. Hoy hay 225 cargos fallidos
    // en MultiCRM y 401 en ISEIE: cualquiera estaba a un clic.
    //
    // El enlace SI se hace —queda dicho de quien es el intento fallido, que
    // sirve para perseguirlo— pero sin cobro detras.
    const cobrado = rows[0]?.status === 'succeeded';
    const amount = cobrado ? Number(rows[0]?.amount || 0) : 0;
    // Fecha REAL del cobro en Stripe (antes se guardaba la de hoy y la factura salía con
    // fecha equivocada). Si faltara, se cae a hoy.
    const fecha = rows[0]?.stripe_created_at
      ? new Date(rows[0].stripe_created_at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    if (amount > 0) {
      importe = amount;
      // Si la asesora ya registró ese mismo cobro a mano, se engancha al pago existente
      // (y a su factura) en vez de crear otro: se vincula pero NO vuelve a sumar.
      const dup = await model.findPagoDuplicado(conversionId, amount, fecha, rows[0]?.stripe_id);
      if (dup) {
        cpId = dup.id;
        yaExistia = true;
      } else {
        // Mismo camino que un pago manual: salda la cuota pendiente más antigua (FIFO)
        // para que el cobro aparezca en las mensualidades de la venta.
        const convModel = await import('../conversions/conversion.model.js');
        const res = await convModel.addPayment(conversionId, {
          importe: amount, fecha, notas: `Stripe ${rows[0]?.stripe_id || stripePaymentId}`, metodo: 'tarjeta',
        }, { allowOverpay: true, allowDuplicate: true });
        cpId = res?.payment?.id || null;
      }
    }
  }
  if (conversionId && !cpId) {
    logger.warn({ stripePaymentId, conversionId },
      'cargo asociado SIN registrar cobro: no consta como cobrado en Stripe');
  }
  await model.linkPayment(stripePaymentId, { leadId, conversionId, conversionPaymentId: cpId, userId, method: yaExistia ? 'manual_dedup' : 'manual' });
  // Asociado a mano también cuenta: si era la última cuota, la suscripción se cierra (#747).
  if (cpId) await trasAsociarCargo(stripePaymentId);
  // Asociar el cargo NO emite la factura: el cobro queda registrado en la venta y
  // espera en la cola. La emite una persona cuando comprueba que los datos del
  // cliente estan bien.
  if (cpId) {
    logger.info({ conversionId, paymentId: cpId, stripePaymentId },
      'cargo de Stripe asociado a mano; queda en la cola de facturacion');
    if (!yaExistia) facturaAutomatica(conversionId, cpId); // #452, si esta encendida
  }
}

/**
 * Factura automatica (#452). No bloquea: el cobro ya esta apuntado y, si esto
 * falla, sigue en la cola como siempre. Apagada, ni siquiera carga el modulo.
 */
function facturaAutomatica(conversionId, paymentId) {
  if (!facturaAutomaticaActiva() || !conversionId || !paymentId) return;
  import('../factura-automatica/factura-automatica.service.js')
    .then((fa) => fa.alCobrar({ conversionId, paymentId }))
    .catch((err) => logger.warn({ err: err.message, conversionId, paymentId }, 'factura automatica: fallo con un cobro de Stripe'));
}

export async function updateDisputeDecision(stripePaymentId, { decision, notes, userId }) {
  await query(
    `UPDATE stripe_payments SET
       dispute_my_decision = $1,
       dispute_notes = COALESCE($2, dispute_notes),
       dispute_decided_at = NOW(),
       dispute_decided_by = $3,
       updated_at = NOW()
     WHERE id = $4`,
    [decision, notes || null, userId || null, stripePaymentId]
  );
}

// ─── Webhook handler (Stripe → CRM en tiempo real) ───────────────────────────
export function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const p of sigHeader.split(',')) {
    const [k, v] = p.split('=');
    if (k && v) (parts[k] = parts[k] || []).push(v);
  }
  const t = parts.t?.[0];
  const v1List = parts.v1 || [];
  if (!t || !v1List.length) return false;
  // La firma incluye la marca de tiempo, pero de nada sirve si no se comprueba:
  // sin esto, quien capture una peticion valida puede reenviarla mañana y el
  // cobro se duplica. Cinco minutos, la misma ventana que recomienda Stripe.
  const edadSegundos = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(edadSegundos) || edadSegundos > 300) return false;
  const payload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  for (const v1 of v1List) {
    if (v1.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) return true;
  }
  return false;
}


// Un reembolso de Stripe, llevado hasta el final: devolucion en la venta y
// comision del tutor revertida.
//
// Stripe manda un evento por CADA reembolso, con su propio identificador
// (re_...). Ese identificador es lo que impide registrarlo dos veces si el
// evento se reintenta o si alguien resincroniza: la devolucion se guarda con el,
// y hay un indice unico detras.
//
// Si el cobro de Stripe no esta atado a ningun cobro del CRM no se inventa nada:
// se avisa en el registro y alguien lo mira. Adivinar aqui es adivinar sobre
// dinero devuelto.
async function propagarReembolso(charge, projectId) {
  const { rows } = await query(
    `SELECT sp.conversion_id, sp.conversion_payment_id
       FROM stripe_payments sp
      WHERE sp.project_id = $1 AND sp.stripe_id = $2`,
    [projectId, charge.id]);
  const enlace = rows[0];
  if (!enlace?.conversion_id) {
    logger.warn({ charge: charge.id }, 'reembolso de un cobro que no esta atado a ninguna venta');
    return;
  }

  // Stripe manda todos los reembolsos del cargo; se procesan uno a uno porque
  // un cargo puede devolverse en partes.
  const lista = charge.refunds?.data?.length
    ? charge.refunds.data
    : [{ id: `${charge.id}_ref`, amount: charge.amount_refunded, reason: null, created: charge.created }];

  for (const r of lista) {
    const importe = Number(r.amount || 0) / 100;
    if (!(importe > 0)) continue;
    const resultado = await tutores.registrarDevolucion({
      conversionId: enlace.conversion_id,
      paymentId: enlace.conversion_payment_id || null,
      importe,
      fecha: r.created ? new Date(r.created * 1000).toISOString().slice(0, 10) : null,
      motivo: r.reason || 'Reembolso de Stripe',
      stripeRefundId: r.id,
      origen: 'stripe',
      userId: null,
    });
    if (resultado.repetida) continue;
    logger.info({
      charge: charge.id, refund: r.id, importe,
      comisionesRevertidas: resultado.comisionesRevertidas,
      sinCobroConcreto: resultado.sinCobroConcreto,
    }, 'reembolso registrado');
  }
}

/**
 * El enlace de un cargo que llega por el AVISO de Stripe (puerta 6, gemela de CRM#848).
 *
 * Stripe espera la respuesta unos segundos y reintenta si no llega. Por eso aquí
 * el pedido de la web se lee solo si ya está guardado en el CRM; si hay que
 * pedírselo a la tienda (hasta 15 s), el cargo se enlaza DESPUÉS, fuera de la
 * respuesta. Pasa por la misma reserva que todo enlace: no se apunta dos veces.
 * Con el interruptor de las reglas nuevas apagado nunca se aplaza nada.
 */
async function enlazarDesdeElAviso(projectId, payment, dbRow) {
  const r = await autoLinkIfPossible(projectId, payment, dbRow, { sinEsperarALaTienda: true });
  if (!r?.aplazado) return;
  setImmediate(() => {
    autoLinkIfPossible(projectId, payment, dbRow)
      .then(async () => {
        // Como cualquier cargo recién asociado: su suscripción, si la tiene (#747).
        if ((await model.getById(dbRow.id))?.conversion_payment_id) await trasAsociarCargo(dbRow.id);
      })
      .catch((e) => logger.warn({ err: e.message, projectId, stripeId: payment.stripe_id },
        'stripe: el cargo de un pedido de la web no se pudo enlazar tras el aviso; queda sin asociar'));
  });
}

export async function handleWebhookEvent(projectId, event) {
  const apiKey = await getStripeKey(projectId);
  const obj = event.data?.object;
  if (!obj) return { skipped: 'no data' };

  switch (event.type) {
    case 'charge.succeeded':
    case 'charge.updated':
    case 'charge.refunded':
    case 'charge.failed': {
      const payment = chargeToPayment(obj, projectId);
      const dbRow = await model.upsertPayment(payment);
      try { await enlazarDesdeElAviso(projectId, payment, dbRow); }
      catch (e) { logger.error({ err: e.message, projectId, stripeId: payment.stripe_id }, 'stripe: el cargo no se pudo enlazar con su venta (aviso)'); }
      if (event.type === 'charge.succeeded') await trasAsociarCargo(dbRow.id);
      if (obj.disputed && apiKey) await fetchAndUpdateDispute(apiKey, projectId, obj);
      // Un reembolso no acaba en stripe_payments: si el alumno recupera su
      // dinero, hay que registrar la devolucion en su venta y deshacer la
      // comision del tutor. Antes se quedaba aqui y el tutor cobraba igual.
      if (event.type === 'charge.refunded') {
        try { await propagarReembolso(obj, projectId); }
        catch (e) { logger.error({ err: e.message, charge: obj.id }, 'reembolso: no se pudo propagar'); }
      }
      return { processed: event.type, stripeId: obj.id };
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      // `obj` es la disputa. Antes era un UPDATE sobre el cargo: si el CRM no lo
      // tenia (anterior al corte del alta, o que nunca entro), la disputa se
      // perdia sin aviso. Ahora se guarda siempre en `stripe_disputes`, se deja
      // al dia el cargo si existe y, si es nueva y abierta, se avisa (#396).
      const { desdeElWebhook } = await import('./disputas.service.js');
      const r = await desdeElWebhook(projectId, obj);
      if (r?.skipped) return { skipped: r.skipped, stripeId: obj.id };
      return { processed: event.type, stripeId: obj.id };
    }
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed': {
      // Fetch the charge via API for full info (PI no incluye billing_details completos)
      if (apiKey && obj.latest_charge) {
        try {
          const ch = await stripeGet(apiKey, `/v1/charges/${obj.latest_charge}`);
          const payment = chargeToPayment(ch, projectId);
          const dbRow = await model.upsertPayment(payment);
          try { await enlazarDesdeElAviso(projectId, payment, dbRow); }
          catch (e) { logger.error({ err: e.message, projectId, stripeId: payment.stripe_id }, 'stripe: el cargo no se pudo enlazar con su venta (payment_intent)'); }
          if (event.type === 'payment_intent.succeeded') await trasAsociarCargo(dbRow.id);
        } catch (e) { logger.warn({ err: e.message }, 'fetch charge from PI failed'); }
      }
      return { processed: event.type, stripeId: obj.id };
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      // Links de pago (CRM#680, fase 3). La sesión se apunta en su link y, si se ha
      // pagado, se trae su cargo y entra por el MISMO camino que charge.succeeded
      // (misma reserva por cargo): si el aviso del cargo llega también, no suma dos
      // veces. Sin clave de lectura no se trae: el sondeo lo encontrará con su marca.
      const r = await cobroDelLink.desdeLaSesion(projectId, event);
      if (r?.skipped) return { skipped: r.skipped, stripeId: obj.id };
      if (r.cobrar && r.paymentIntent && apiKey) {
        try {
          const cargos = await stripeGet(apiKey, '/v1/charges', {
            payment_intent: r.paymentIntent, 'expand[]': 'data.balance_transaction',
          });
          for (const ch of cargos.data || []) {
            const payment = chargeToPayment(ch, projectId);
            const dbRow = await model.upsertPayment(payment);
            try { await enlazarDesdeElAviso(projectId, payment, dbRow); }
            catch (e) { logger.error({ err: e.message, projectId, stripeId: payment.stripe_id }, 'stripe: el cargo de un link de pago no se pudo enlazar (checkout)'); }
            if (payment.status === 'succeeded') await trasAsociarCargo(dbRow.id);
          }
        } catch (e) { logger.warn({ err: e.message, projectId, linkId: r.link?.id }, 'links de pago: no se pudo traer el cargo de la sesión; lo traerá el sondeo'); }
      }
      return { processed: event.type, stripeId: obj.id };
    }
    default:
      return { skipped: event.type };
  }
}
