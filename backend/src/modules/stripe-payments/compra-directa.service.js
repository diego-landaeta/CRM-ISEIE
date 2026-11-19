/**
 * CADA PAGO A SU VENTA, Y LA COMPRA DIRECTA EN LA WEB CREA LA SUYA
 * (puerta 6 del conector de Claude, #487; gemela de CRM#848, tarea n.º 363 del tablero del 360).
 *
 * Hasta ahora un cargo de Stripe se asociaba solo si el correo era el de la ficha
 * MÁS NUEVA del campus y esa ficha estaba «convertida» y tenía venta. Lo demás
 * se quedaba en «sin asociar»: las renovaciones de una suscripción pagadas con
 * otro correo, la alumna con una ficha duplicada posterior a la compra, y las
 * compras directas en la web, que no tienen asesora y por eso nadie les crea venta.
 *
 * Aquí viven las piezas que no son la asociación de siempre:
 *
 *   · pedidoDeLaWeb: si el cargo es de un pedido de WooCommerce (la pasarela de
 *     Stripe de la tienda deja `order_id` y `site_url` en metadata).
 *   · formacionDelPedido: la formación de ese pedido en el catálogo del campus, por
 *     el id de producto de WooCommerce (`products.wc_product_id`) o, si no, por el
 *     nombre exacto. Con dos formaciones distintas en el pedido, o ninguna, no se
 *     adivina: null.
 *   · elegirVenta: entre las ventas de ese correo, la de esa formación. Una compra
 *     de un curso NUEVO no se cuelga de la venta de otro curso.
 *   · crearVentaDeCompraDirecta: la venta sin gestora, con la formación como
 *     producto (nunca el nombre de la alumna, #160).
 *
 * La creación va con interruptor, como el cierre de suscripciones (#747):
 *   COMPRA_DIRECTA_ACTIVA=true       encendido (apagado por defecto)
 *   COMPRA_DIRECTA_ESPERA_HORAS=24   cuánto se espera antes de crearla, por si la
 *                                    asesora la registra a mano
 *   COMPRA_DIRECTA_DIAS=30           hasta cuántos días atrás se mira
 */
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { guardarPedido, mapearPedido } from '../woocommerce/wc.orders.js';

const numeroEntero = (v, siFalta) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : siFalta;
};

export function compraDirectaActiva(env = process.env) {
  const v = String(env.COMPRA_DIRECTA_ACTIVA || '').toLowerCase();
  return v === 'true' || v === '1';
}

export function configCompraDirecta(env = process.env) {
  return {
    esperaHoras: numeroEntero(env.COMPRA_DIRECTA_ESPERA_HORAS, 24),
    dias: Math.max(1, numeroEntero(env.COMPRA_DIRECTA_DIAS, 30)),
  };
}

/** El número de pedido de WooCommerce del cargo, o null si no viene de la tienda. */
export function pedidoDeLaWeb(metadata) {
  const m = metadata && typeof metadata === 'object' ? metadata : null;
  const id = m?.order_id != null ? String(m.order_id).trim() : '';
  return /^\d{1,18}$/.test(id) ? id : null;
}

/**
 * La venta de ese cargo entre las de su correo (la más reciente primero).
 *
 *   · sin formación conocida: la más reciente, como siempre;
 *   · con formación: la de esa formación; si no hay, una venta sin formación
 *     puesta (no se sabe si es la suya, y antes ya se asociaba ahí);
 *   · si todas son de OTRAS formaciones, ninguna: es una compra nueva.
 */
export function elegirVenta(ventas, productoId) {
  if (!Array.isArray(ventas) || !ventas.length) return null;
  if (!productoId) return ventas[0];
  const misma = ventas.find((v) => v.producto_contratado_id != null && Number(v.producto_contratado_id) === Number(productoId));
  if (misma) return misma;
  return ventas.find((v) => v.producto_contratado_id == null) || null;
}

/** Pide un pedido a la tienda del campus. Nunca devuelve ni registra la URL: lleva las claves. */
async function pedirPedido(creds, orderId) {
  const base = `${String(creds.store_url).replace(/\/$/, '')}/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}`;
  const auth = `consumer_key=${encodeURIComponent(creds.consumer_key)}&consumer_secret=${encodeURIComponent(creds.consumer_secret)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${base}?${auth}`, { signal: ctl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`WooCommerce contestó ${res.status} al pedir el pedido`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lo que devuelve `formacionDelPedido` cuando se le pide no salir a la tienda
 * (`soloGuardado`) y el pedido todavía no está guardado en el CRM: no es «no
 * tiene formación», es «aún no se ha leído». Quien llama decide cuándo leerlo.
 */
export const PEDIDO_SIN_LEER = Object.freeze({ sinLeer: true });

/**
 * Las líneas del pedido: primero las que ya están guardadas (#14) y, si no está,
 * se pide a la tienda una vez y se guarda, para no volver a preguntar. Con
 * `soloGuardado` no se sale a la tienda: lo pide el aviso de Stripe, que no
 * puede esperarla.
 */
async function lineasDelPedido(projectId, orderId, { pedir = pedirPedido, soloGuardado = false } = {}) {
  const { rows: [guardado] } = await query(
    `SELECT line_items, customer_name FROM woocommerce_orders WHERE project_id = $1 AND wc_order_id = $2::bigint`,
    [projectId, orderId]
  );
  if (guardado) return { lineas: guardado.line_items || [], cliente: guardado.customer_name || null };
  // El aviso de Stripe no espera a la tienda: lo lee después quien lo enlace.
  if (soloGuardado) return PEDIDO_SIN_LEER;

  const { rows: [creds] } = await query(
    `SELECT project_id, store_url, consumer_key, consumer_secret FROM wc_credentials
      WHERE project_id = $1 AND active = true AND COALESCE(consumer_key, '') <> '' AND COALESCE(store_url, '') <> ''`,
    [projectId]
  );
  if (!creds) return null;
  const orden = await pedir(creds, orderId);
  if (!orden || orden.id == null) return null;
  await guardarPedido(projectId, orden);
  const p = mapearPedido(orden);
  return { lineas: p.line_items, cliente: p.customer_name };
}

const normalizar = `LOWER(TRANSLATE(TRIM(?), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'))`;

/**
 * La formación del pedido en el catálogo del campus: { id, nombre, cliente }, o null.
 * No lanza: un fallo de la tienda deja el cargo como estaba.
 */
export async function formacionDelPedido(projectId, orderId, opciones = {}) {
  if (!orderId) return null;
  let pedido;
  try {
    pedido = await lineasDelPedido(projectId, orderId, opciones);
  } catch (err) {
    logger.warn({ projectId, orderId, err: err.message }, 'compra directa: no se pudo leer el pedido de WooCommerce');
    return null;
  }
  if (pedido === PEDIDO_SIN_LEER) return PEDIDO_SIN_LEER;
  if (!pedido?.lineas?.length) return null;

  const idsWc = [...new Set(pedido.lineas.map((l) => Number(l.product_id)).filter((n) => Number.isFinite(n) && n > 0))];
  let candidatos = [];
  if (idsWc.length) {
    ({ rows: candidatos } = await query(
      `SELECT DISTINCT id, nombre FROM products WHERE project_id = $1 AND wc_product_id = ANY($2::int[])`,
      [projectId, idsWc]
    ));
  }
  if (!candidatos.length) {
    const nombres = [...new Set(pedido.lineas.map((l) => String(l.name || '').trim()).filter(Boolean))];
    if (nombres.length === 1) {
      ({ rows: candidatos } = await query(
        `SELECT id, nombre FROM products
          WHERE project_id = $1 AND ${normalizar.replace('?', 'nombre')} = ${normalizar.replace('?', '$2::text')}`,
        [projectId, nombres[0]]
      ));
    }
  }
  if (candidatos.length !== 1) {
    if (candidatos.length > 1) logger.info({ projectId, orderId, formaciones: candidatos.length }, 'compra directa: el pedido tiene varias formaciones; no se adivina');
    return null;
  }
  return { id: candidatos[0].id, nombre: candidatos[0].nombre, cliente: pedido.cliente };
}

/**
 * Crea la venta de una compra directa, sin gestora y con la formación como
 * producto. Si hay ficha con ese correo, la venta va en ella; si no, se crea
 * (como «Registrar venta» con «sin gestora»). Importe: lo cobrado, en euros.
 *
 * Devuelve { id, lead_id } de la venta, o null si no se crea. El cobro NO se
 * apunta aquí: lo apunta quien llama, por el mismo camino que cualquier cargo
 * (con el id del cargo en las notas, que es lo que impide contarlo dos veces).
 */
export async function crearVentaDeCompraDirecta({ projectId, payment, lead, formacion, orderId }) {
  if (!formacion?.id) return null;
  const fecha = new Date(Number(payment.stripe_created_at) * 1000).toISOString().slice(0, 10);
  const importe = Number(payment.amount);
  if (!(importe > 0)) return null;

  // La asesora pudo registrar esta venta con otro correo: si ya hay un cobro por
  // ese dinero en el campus, sin cargo de Stripe detrás, no se crea nada.
  const { hayCobroEquivalenteEnElCampus } = await import('./stripe-payments.model.js');
  if (await hayCobroEquivalenteEnElCampus(projectId, importe, fecha)) {
    logger.info({ projectId, stripeId: payment.stripe_id }, 'compra directa: ya hay un cobro por ese dinero en el campus; no se crea la venta');
    return null;
  }

  const { createSale } = await import('../sales/sales.service.js');
  const nombre = String(payment.customer_name || formacion.cliente || payment.customer_email || 'Compra en la web').trim().slice(0, 200);
  const venta = await createSale({
    project_id: Number(projectId),
    ...(lead?.id ? { lead_id: Number(lead.id) } : { nombre, email: payment.customer_email ? String(payment.customer_email).toLowerCase().trim() : null }),
    producto_interes_id: Number(formacion.id),
    importe_total: importe,
    importe_pagado: 0,
    // Lo cobrado por Stripe ya es el precio final, IVA dentro. En el 360 es lo que
    // pasa sin decirlo; en ISEIE, sin esto, el 21 % se sumaría encima y una compra
    // de 249,50 € crearía una venta de 301,89 €.
    iva_incluido: true,
    metodo_pago: 'tarjeta',
    fecha_pago: fecha,
    sin_gestora: true,
    notas: `Compra directa en la web (pedido n.º ${orderId}, Stripe ${payment.stripe_id}). Venta creada por el CRM al llegar el cobro.`,
  }, null, {
    // Sin nadie delante para decidir: no se para por «venta repetida» (CRM#898).
    // Si repite otra, sale en Ventas · «Posibles repetidas».
    comprobarRepetida: false,
  });
  logger.info({ projectId, conversionId: venta.conversion_id, leadId: venta.lead_id, productoId: formacion.id, stripeId: payment.stripe_id },
    'compra directa: venta creada sin gestora');
  return { id: venta.conversion_id, lead_id: venta.lead_id };
}
