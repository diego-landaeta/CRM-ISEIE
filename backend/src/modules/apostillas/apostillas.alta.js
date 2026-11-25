import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './apostillas.model.js';
import { avisarNueva } from './apostillas.avisos.js';

/*
  LA APOSTILLA SE CREA SOLA (CRM#1130 / CRM-ISEIE#786).

  Al registrar una venta con el producto «Apostilla de La Haya» (o un cobro de
  un link de Stripe marcado como apostilla) nace su ficha, pendiente de
  iniciar, y le llega el aviso a su gestora. Dos caminos, que hacen lo mismo:

    · `programarAlta(conversionId)`: lo llama `conversion.service.create` al
      crear CUALQUIER venta (formulario, Clientes, links de pago, compra
      directa, cobro de Stripe). Va después de responder y nunca tumba la venta.
    · `repasar()`: cada 10 minutos (jobs/apostillasScheduler.js), recoge lo que
      se escape: una línea añadida al editar la venta, un cargo de Stripe que
      quedó por vincular…

  Qué crea, por orden (cada paso, una sola consulta, sin repetir fichas):

    1. Un cargo de un link de apostilla que ya tenía su ficha «Sin asociar» y
       luego se vinculó a una venta: la ficha pasa a esa venta (no se crea otra).
    2. Una ficha de la venta sin línea y una línea de apostilla nueva: la ficha
       se queda con la línea.
    3. Cada línea de venta con el producto de apostilla → su ficha.
    4. Cada venta cuyo producto es la apostilla y no tiene líneas de apostilla
       (las ventas a mano antiguas) → su ficha.
    5. Cada cargo cobrado de un link de apostilla que no está en ninguna venta
       → su ficha, con la persona si el cargo ya la tiene, o «Sin asociar».

  Los índices únicos de la migración 344 (por línea, por cargo y por venta sin
  línea) impiden la ficha doble aunque dos vueltas coincidan.
*/

const APOSTILLA = "p.servicio = 'apostilla'";

/** El producto de la apostilla del campus (el activo), o null. */
export async function productoDeApostilla(projectId) {
  const { rows } = await query(
    `SELECT id, nombre, precio FROM products p
      WHERE p.project_id = $1 AND ${APOSTILLA}
      ORDER BY p.active DESC, p.id LIMIT 1`, [projectId]);
  return rows[0] || null;
}

/**
 * ¿Ese link creado en Stripe cobra la apostilla? Marcado en la columna o, si
 * aún no lo está (la vuelta lo marca), por su nombre. La columna se lee con
 * `to_jsonb` para que sin la migración conteste «no» en vez de fallar.
 */
export async function esLinkDeApostilla(externoId) {
  if (!externoId) return false;
  const { rows } = await query(
    `SELECT (COALESCE(to_jsonb(e)->>'servicio', '') = 'apostilla' OR COALESCE(e.nombre, '') ~* 'apostill') AS es
       FROM stripe_links_externos e WHERE e.id = $1`, [externoId]);
  return Boolean(rows[0]?.es);
}

/** Los pasos 1 a 4, solo para una venta (`conversionId`) o para todas (null). */
async function desdeVentas(conversionId = null) {
  // 1. Del cargo «Sin asociar» a su venta.
  await query(
    `UPDATE apostillas a
        SET conversion_id = sp.conversion_id, lead_id = COALESCE(a.lead_id, c.lead_id), updated_at = NOW()
       FROM stripe_payments sp JOIN conversions c ON c.id = sp.conversion_id
      WHERE a.stripe_payment_id = sp.id AND a.conversion_id IS NULL AND sp.conversion_id IS NOT NULL
        AND c.project_id = a.project_id
        AND ($1::int IS NULL OR c.id = $1)
        AND NOT EXISTS (SELECT 1 FROM apostillas o WHERE o.conversion_id = sp.conversion_id)`, [conversionId]);

  // 2. La ficha de la venta se queda con su línea de apostilla.
  await query(
    `UPDATE apostillas a SET conversion_item_id = x.item_id, updated_at = NOW()
       FROM (SELECT DISTINCT ON (ci.conversion_id) ci.conversion_id, ci.id AS item_id
               FROM conversion_items ci JOIN products p ON p.id = ci.product_id
              WHERE ${APOSTILLA} AND ($1::int IS NULL OR ci.conversion_id = $1)
                AND NOT EXISTS (SELECT 1 FROM apostillas o WHERE o.conversion_item_id = ci.id)
              ORDER BY ci.conversion_id, ci.id) x
      WHERE a.conversion_id = x.conversion_id AND a.conversion_item_id IS NULL`, [conversionId]);

  // 3. Una por línea.
  const { rows: porLinea } = await query(
    `INSERT INTO apostillas (project_id, lead_id, conversion_id, conversion_item_id, origen)
     SELECT c.project_id, c.lead_id, c.id, ci.id, 'venta'
       FROM conversion_items ci
       JOIN conversions c ON c.id = ci.conversion_id
       JOIN products p ON p.id = ci.product_id
      WHERE ${APOSTILLA} AND ($1::int IS NULL OR c.id = $1)
        AND NOT EXISTS (SELECT 1 FROM apostillas o WHERE o.conversion_item_id = ci.id)
        AND NOT EXISTS (SELECT 1 FROM apostillas o WHERE o.conversion_id = c.id AND o.conversion_item_id IS NULL)
     ON CONFLICT DO NOTHING
     RETURNING id`, [conversionId]);

  // 4. Una por venta sin líneas de apostilla.
  const { rows: porVenta } = await query(
    `INSERT INTO apostillas (project_id, lead_id, conversion_id, origen)
     SELECT c.project_id, c.lead_id, c.id, 'venta'
       FROM conversions c JOIN products p ON p.id = c.producto_contratado_id
      WHERE ${APOSTILLA} AND ($1::int IS NULL OR c.id = $1)
        AND NOT EXISTS (SELECT 1 FROM conversion_items ci JOIN products p2 ON p2.id = ci.product_id
                         WHERE ci.conversion_id = c.id AND p2.servicio = 'apostilla')
        AND NOT EXISTS (SELECT 1 FROM apostillas o WHERE o.conversion_id = c.id)
     ON CONFLICT DO NOTHING
     RETURNING id`, [conversionId]);

  return [...porLinea, ...porVenta].map((r) => Number(r.id));
}

/** El paso 5: los cargos de links de apostilla que no están en ninguna venta. */
async function desdeCargos() {
  // Los links con «apostilla» en el nombre quedan marcados (los nuevos que trae la vuelta de links).
  await query(
    `UPDATE stripe_links_externos SET servicio = 'apostilla'
      WHERE servicio IS NULL AND COALESCE(nombre, '') ~* 'apostill'`);
  const { rows } = await query(
    `INSERT INTO apostillas (project_id, lead_id, stripe_payment_id, origen)
     SELECT sp.project_id,
            (SELECT l.id FROM leads l WHERE l.id = sp.lead_id AND l.project_id = sp.project_id AND l.deleted_at IS NULL),
            sp.id, 'stripe'
       FROM stripe_payments sp
       JOIN stripe_links_externos e ON e.id = sp.stripe_link_externo_id
      WHERE e.servicio = 'apostilla' AND sp.status = 'succeeded'
        AND sp.conversion_id IS NULL
        -- Con margen: el cobro se vincula (o abre su venta) justo después de
        -- guardarse, y sin esperar saldría una ficha «Sin asociar» de más.
        AND sp.updated_at < NOW() - interval '15 minutes'
        AND NOT EXISTS (SELECT 1 FROM apostillas o WHERE o.stripe_payment_id = sp.id)
     ON CONFLICT DO NOTHING
     RETURNING id`);
  return rows.map((r) => Number(r.id));
}

/** La línea «creada» del historial y el aviso a su gestora, de cada una nueva. */
async function trasCrear(ids, nota) {
  if (!ids.length) return;
  await query(
    `INSERT INTO apostilla_eventos (apostilla_id, tipo, a, nota)
     SELECT x, 'creada', 'pendiente_inicio', $2 FROM unnest($1::int[]) AS x`, [ids, nota]);
  for (const id of ids) {
    const a = await model.porId(id);
    if (a) await avisarNueva(a).catch(() => {});
  }
}

/** Sin la migración todavía (tabla o columna que no existe): no hay nada que hacer. */
const faltaLaMigracion = (err) => ['42P01', '42703'].includes(err?.code);

/** La ficha de UNA venta, si es de apostilla. Devuelve los ids creados. */
export async function desdeVenta(conversionId) {
  try {
    const ids = await desdeVentas(Number(conversionId));
    await trasCrear(ids, 'Creada sola al registrar la venta');
    return ids;
  } catch (err) {
    if (faltaLaMigracion(err)) return [];
    throw err;
  }
}

/**
 * Después de crear una venta, sin esperar y sin poder tumbarla: la venta ya
 * está guardada y la vuelta de cada 10 minutos recogería lo que falle aquí.
 */
export function programarAlta(conversionId) {
  if (!conversionId || process.env.NODE_ENV === 'test') return;
  setImmediate(() => {
    desdeVenta(conversionId).catch((err) =>
      logger.warn({ err: err.message, conversionId }, 'apostillas: no se pudo crear la ficha al registrar la venta'));
  });
}

/** La vuelta de cada 10 minutos. Devuelve cuántas fichas ha creado. */
export async function repasar() {
  try {
    const deVentas = await desdeVentas(null);
    await trasCrear(deVentas, 'Creada sola desde la venta');
    const deCargos = await desdeCargos();
    await trasCrear(deCargos, 'Creada sola desde el cobro del link de Stripe');
    return deVentas.length + deCargos.length;
  } catch (err) {
    if (faltaLaMigracion(err)) return 0;
    throw err;
  }
}

/**
 * EL COBRO DE UN LINK DE APOSTILLA CREADO EN STRIPE (lo llama
 * `links-pago.externos.js · ventaDelCargo`).
 *
 * Lo que pasó el 23/11 en ISEIE: el cobro del link «Plan de pago - Apostilla
 * HAYA» se enganchó por el correo a la venta de un máster de enero como si
 * fuera una cuota. Un cobro de apostilla NO es una cuota de otra venta: abre
 * su propia venta de apostilla, del cliente con ese correo (o ese móvil), con
 * el producto del campus y por lo que se pagó; su gestora, la del cliente.
 *
 * Devuelve la venta nueva `{ conversionId, ficha }`, o `{ motivo }` si no se
 * sabe de quién es o el campus no tiene el producto (el cargo se queda por
 * vincular y su apostilla, en «Sin asociar»).
 */
export async function ventaDeApostillaDelCargo({ projectId, payment, fichas, porMovil = false }) {
  if (!fichas.length) return { motivo: 'sin_coincidencia' };
  // Por correo, varias fichas son la misma persona repetida: la más reciente.
  // Por móvil, varias pueden ser personas distintas: no se adivina.
  if (porMovil && fichas.length > 1) return { motivo: 'varias_coincidencias' };
  const ficha = fichas[0];
  const producto = await productoDeApostilla(projectId);
  if (!producto) return { motivo: 'sin_producto_apostilla' };
  const importe = Number(payment.amount);
  if (!(importe > 0)) return { motivo: 'sin_importe' };
  const fecha = new Date(Number(payment.stripe_created_at) * 1000).toISOString().slice(0, 10);
  const { createSale } = await import('../sales/sales.service.js');
  const venta = await createSale({
    project_id: Number(projectId),
    lead_id: Number(ficha.id),
    producto_interes_id: Number(producto.id),
    importe_total: importe,
    // Lo cobrado es el precio final: el IVA va dentro (como en la compra directa).
    iva_incluido: true,
    importe_pagado: 0,
    metodo_pago: 'tarjeta',
    fecha_pago: fecha,
    sin_gestora: true,
    ...(ficha.responsable_id ? { vendedora_id: Number(ficha.responsable_id) } : {}),
    notas: `Apostilla de La Haya pagada con un link creado en Stripe (cargo ${payment.stripe_id}). Venta creada por el CRM al llegar el cobro.`,
  }, null, { comprobarRepetida: false });
  logger.info({ projectId, conversionId: venta.conversion_id, leadId: ficha.id, stripeId: payment.stripe_id },
    'apostillas: venta de apostilla creada desde el cobro de un link de Stripe');
  return { conversionId: Number(venta.conversion_id), ficha };
}
