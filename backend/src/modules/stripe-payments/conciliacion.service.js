import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import * as model from './stripe-payments.model.js';
import * as conciliacion from './conciliacion.model.js';
import { conElCargoReservado, enlazarConCobro, manualLink } from './stripe-payments.service.js';

/*
  CONCILIACIÓN › CARGOS DE STRIPE (CRM#906). Las acciones.

  Nada de esto asocia dinero a su manera: enlazar con un cobro es
  `enlazarConCobro` (CRM#888/#892) y apuntar el cobro en una venta es
  `manualLink`, lo mismo que «Asociar» en Pagos Stripe. Lo único nuevo es crear
  la venta desde el cargo, y lo hace `createSale` (Ventas), con su aviso de venta
  repetida (CRM#898).
*/

const OCUPADO = Symbol('ocupado');
const fechaDelCargo = (c) => new Date(c.stripe_created_at).toISOString().slice(0, 10);

/**
 * «Enlazar todos los seguros» de UN campus y UN mes. Los seguros se vuelven a
 * calcular aquí (no se fía de la lista que tenga la pantalla abierta) y cada uno
 * pasa por `enlazarConCobro`, con sus 409. Uno que falla no para a los demás:
 * se cuenta y se dice por qué.
 */
export async function enlazarSeguros(projectId, mes, userId) {
  const filas = await conciliacion.conciliar([projectId], mes);
  const seguros = filas.filter((f) => f.seguro);
  let enlazados = 0;
  let importe = 0;
  const fallos = [];
  for (const f of seguros) {
    try {
      await enlazarConCobro(f.id, { conversionPaymentId: f.cobros[0].id, userId });
      enlazados += 1;
      importe += Number(f.importe);
    } catch (e) {
      fallos.push({ cargo: f.id, stripe_id: f.stripe_id, code: e.code || 'ERROR', error: e.message });
    }
  }
  logger.info({ projectId, mes, seguros: seguros.length, enlazados, fallos: fallos.length, userId },
    'conciliación: cargos de Stripe seguros enlazados con su cobro');
  return { seguros: seguros.length, enlazados, importe: Math.round(importe * 100) / 100, fallos };
}

/**
 * «Crear la venta» desde un cargo que no tiene ni cobro ni venta.
 *
 * El alumno y el importe salen del cargo; quien lo hace elige el programa y la
 * vendedora. La venta se crea con `createSale` sin cobro, y el cobro lo apunta
 * `manualLink` con el cargo: salda su cuota, queda en la cola de facturación y el
 * cargo, enlazado. Todo con el cargo reservado, para que el sondeo de Stripe (o un
 * segundo clic) no lo enlace a la vez y el dinero entre dos veces.
 *
 * Si el alumno ya tiene una venta de ese programa, 409 VENTA_YA_EXISTE (CRM#898):
 * la pantalla ofrece apuntar el cobro en esa venta o crear otra con `forzar`.
 */
export async function crearVentaDelCargo(cargo, datos, user) {
  if (cargo.status !== 'succeeded') {
    throw new AppError('Ese cargo no se cobró en Stripe: no se crea una venta con él.', 409, 'CARGO_NO_COBRADO');
  }
  if (cargo.conversion_payment_id) {
    throw new AppError('Ese cargo ya está enlazado con un cobro.', 409, 'CARGO_YA_ENLAZADO');
  }
  if (String(cargo.currency || 'EUR').toUpperCase() !== 'EUR') {
    throw new AppError('Ese cargo no está en euros: enlázalo a mano desde Pagos Stripe.', 409, 'CARGO_EN_OTRA_MONEDA');
  }
  const importe = Number(cargo.amount);
  const importeTotal = datos.importeTotal ?? importe;
  if (importeTotal + 0.005 < importe) {
    throw new AppError('El total de la venta no puede ser menor que lo cobrado en Stripe.', 400, 'VALIDATION_ERROR');
  }

  // La ficha: la elegida, o la del correo del cargo en su campus. Sin ficha, se
  // crea con el nombre y el correo (los del cargo, o los que se hayan corregido).
  let ficha = null;
  if (datos.leadId) {
    if (await model.campusDelLead(datos.leadId) !== Number(cargo.project_id)) throw new AppError('Lead no encontrado', 404, 'NOT_FOUND');
    ficha = { id: Number(datos.leadId) };
  } else {
    ficha = await model.findLeadByEmail(cargo.project_id, datos.email || cargo.customer_email);
  }
  const nombre = String(datos.nombre || cargo.customer_name || cargo.customer_email || '').trim().slice(0, 200);
  const email = String(datos.email || cargo.customer_email || '').trim().toLowerCase();
  if (!ficha && !nombre) throw new AppError('Falta el nombre del alumno.', 400, 'VALIDATION_ERROR');

  const { createSaleSchema } = await import('../sales/sales.validation.js');
  const alta = createSaleSchema.safeParse({
    project_id: Number(cargo.project_id),
    ...(ficha ? { lead_id: ficha.id } : { nombre, email: email || null, sin_gestora: true }),
    producto_interes_id: datos.productoId,
    importe_total: importeTotal,
    importe_pagado: 0,
    metodo_pago: 'tarjeta',
    fecha_pago: fechaDelCargo(cargo),
    vendedora_id: datos.vendedoraId,
    ...(datos.forzar ? { forzar: true } : {}),
    notas: `Venta creada desde Conciliación con el cargo de Stripe ${cargo.stripe_id}.`,
  });
  if (!alta.success) throw new AppError(alta.error.errors[0].message, 400, 'VALIDATION_ERROR');

  const hecho = await conElCargoReservado(cargo, async () => {
    const { createSale } = await import('../sales/sales.service.js');
    // Lo cobrado en Stripe ya es el precio final: en ISEIE, sin decirlo, el 21 % se
    // sumaría ENCIMA del importe (sales.service.js) y la venta saldría por más de lo
    // cobrado. `iva_incluido` no está en createSaleSchema, así que se pone aquí.
    const venta = await createSale({ ...alta.data, iva_incluido: true }, user);
    // Ficha nueva: es de la vendedora, no del reparto. `createSale` la deja sin
    // gestora a propósito (`sin_gestora`) para que el round-robin no se la dé a
    // quien no ha vendido nada.
    if (!ficha && datos.vendedoraId) {
      await query('UPDATE leads SET responsable_id = $2, updated_at = NOW() WHERE id = $1 AND responsable_id IS NULL',
        [venta.lead_id, datos.vendedoraId]);
    }
    await manualLink(cargo.id, { leadId: venta.lead_id, conversionId: venta.conversion_id, userId: user?.userId ?? null });
    return { conversionId: venta.conversion_id, leadId: venta.lead_id };
  }, { ocupado: OCUPADO });
  if (hecho === OCUPADO) {
    throw new AppError('Ese cargo lo está enlazando otra persona o el sondeo de Stripe ahora mismo. Recarga la lista.', 409, 'CARGO_OCUPADO');
  }
  const despues = await model.getById(cargo.id);
  logger.info({ stripePaymentId: cargo.id, conversionId: hecho.conversionId, userId: user?.userId },
    'conciliación: venta creada desde un cargo de Stripe y cobro enlazado');
  return { ...hecho, conversionPaymentId: despues?.conversion_payment_id ?? null };
}
