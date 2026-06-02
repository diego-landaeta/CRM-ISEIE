import * as leadService from '../leads/lead.service.js';
import * as conversionService from '../conversions/conversion.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';

/**
 * Registra una venta — flujo orquestado:
 *   1. Crea lead manual (round-robin asigna gestor, o se autoasigna al creador si es gestor/admin).
 *   2. Cambia status a 'convertido'.
 *   3. Crea conversion con fecha_conversion = fecha_pago indicada.
 *   4. Si importe_pagado > 0 → registra el pago (la conversion ya admite importe_pagado en create).
 *
 * Por la fecha el sistema marca internamente si es retroactiva (informativo).
 */
export async function createSale(data, requestUser) {
  const today = new Date().toISOString().slice(0, 10);
  const isRetroactive = data.fecha_pago < today;
  const importePagado = data.importe_pagado ?? data.importe_total;
  if (importePagado > data.importe_total) {
    throw new AppError('importe_pagado no puede ser mayor que importe_total', 400, 'INVALID_AMOUNT');
  }

  // 1) Crear lead manual con canal=directo. createManualLead detecta duplicados:
  // si existe lead con mismo email/tel, lo reusa (rama esPropuesto/duplicadoDe del servicio).
  // Si quien registra es admin/superadmin → dejamos round-robin (no se auto-asignan ventas).
  // Si es gestor → se le asigna a sí mismo (es su venta).
  const passCreator = requestUser && requestUser.role === 'gestor' ? requestUser : null;
  let leadResult;
  try {
    leadResult = await leadService.createManualLead(
      {
        project_id: data.project_id,
        nombre: data.nombre,
        email: data.email || null,
        telefono: data.telefono || null,
        producto_interes_id: data.producto_interes_id,
        canal: 'directo',
        notas: isRetroactive
          ? `[Venta histórica registrada el ${today} con fecha de pago ${data.fecha_pago}]${data.notas ? '\n' + data.notas : ''}`
          : (data.notas || null),
        custom_fields: undefined,
      },
      { creatorUser: passCreator }
    );
  } catch (err) {
    logger.error({ err: err.message, data }, 'createSale: createManualLead failed');
    throw err;
  }
  const leadId = leadResult.lead_id;

  // 2) Cambiar status a convertido (si ya estaba convertido, no falla)
  try {
    await leadService.changeStatus(leadId, 'convertido', isRetroactive ? 'Venta histórica registrada' : 'Venta registrada', requestUser?.userId || null);
  } catch (err) {
    if (err.code !== 'SAME_STATUS') {
      logger.warn({ err: err.message, leadId }, 'createSale: changeStatus warn');
    }
  }

  // 3) Crear conversion
  // producto_contratado lo obtenemos pasando el id; conversion.service hace lookup del nombre.
  const conversion = await conversionService.create(
    {
      lead_id: leadId,
      project_id: data.project_id,
      producto_contratado: data.nombre, // será overrideado por el service si tiene lookup; pasamos algo no vacío
      producto_contratado_id: data.producto_interes_id,
      importe_total: data.importe_total,
      importe_pagado: importePagado,
      metodo_pago: data.metodo_pago || null,
      fecha_conversion: data.fecha_pago,
      fecha_compromiso_pago: importePagado < data.importe_total ? data.fecha_pago : null,
      notas_pago: data.notas || null,
    },
    requestUser?.userId || null
  );

  return {
    sale_id: conversion.id,
    lead_id: leadId,
    conversion_id: conversion.id,
    retroactiva: isRetroactive,
    duplicado: !!leadResult.duplicado,
    duplicado_de: leadResult.duplicado_de || null,
    fecha_pago: data.fecha_pago,
    importe_total: data.importe_total,
    importe_pagado: importePagado,
  };
}

/**
 * Top programas vendidos — agrupado por producto. Usado en dashboards (inicial + finanzas).
 * @param {{ projectId?: number|null, limit?: number, days?: number|null }} opts
 *   days=null → all-time. days=30 → últimos 30 días.
 */
export async function getTopProducts({ projectId, limit = 10, days = null } = {}) {
  const params = [];
  const where = [];
  if (projectId) { params.push(projectId); where.push(`c.project_id = $${params.length}`); }
  if (days) { params.push(days); where.push(`c.fecha_conversion >= (CURRENT_DATE - ($${params.length}::int))`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await query(
    `SELECT
       c.producto_contratado_id AS product_id,
       COALESCE(p.nombre, c.producto_contratado, '— sin producto —') AS producto,
       COUNT(*)::int AS ventas,
       COALESCE(SUM(c.importe_total), 0)::numeric AS facturado,
       COALESCE(SUM(c.importe_pagado), 0)::numeric AS cobrado,
       MAX(c.fecha_conversion) AS ultima_venta
     FROM conversions c
     LEFT JOIN products p ON p.id = c.producto_contratado_id
     ${whereSql}
     GROUP BY c.producto_contratado_id, p.nombre, c.producto_contratado
     ORDER BY ventas DESC, facturado DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    product_id: r.product_id,
    producto: r.producto,
    ventas: r.ventas,
    facturado: Number(r.facturado),
    cobrado: Number(r.cobrado),
    ultima_venta: r.ultima_venta,
  }));
}
