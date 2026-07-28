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

  let leadId;
  let leadResult = { duplicado: false, duplicado_de: null };
  let leadNombre = data.nombre;

  if (data.lead_id) {
    // Modo "cliente existente": usar el lead seleccionado tal cual.
    const existing = await query(`SELECT id, nombre, project_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [data.lead_id]);
    if (!existing.rows[0]) throw new AppError('Cliente no encontrado', 404, 'LEAD_NOT_FOUND');
    if (existing.rows[0].project_id !== data.project_id) {
      throw new AppError('El cliente no pertenece al proyecto seleccionado', 400, 'WRONG_PROJECT');
    }
    leadId = existing.rows[0].id;
    leadNombre = existing.rows[0].nombre;
  } else {
    // Modo "cliente nuevo": crear lead manual con canal=directo.
    // createManualLead detecta duplicados: si existe lead con mismo email/tel, lo reusa.
    // Si quien registra es admin/superadmin → dejamos round-robin (no se auto-asignan ventas).
    // Si es gestor → se le asigna a sí mismo (es su venta).
    const passCreator = requestUser && requestUser.role === 'gestor' ? requestUser : null;
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
    leadId = leadResult.lead_id;
  }

  // 2) Cambiar status a convertido (si ya estaba convertido, no falla)
  try {
    await leadService.changeStatus(leadId, 'convertido', isRetroactive ? 'Venta histórica registrada' : 'Venta registrada', requestUser?.userId || null);
  } catch (err) {
    if (err.code !== 'SAME_STATUS') {
      logger.warn({ err: err.message, leadId }, 'createSale: changeStatus warn');
    }
  }

  // 2b) Guardar identificación fiscal y/o dirección fiscal en el lead si vinieron
  //     con la venta. Sirve para cliente nuevo y para actualizar uno existente.
  //     UPDATE conjunto para no hacer 2 queries.
  const hasNif = data.identificacion_fiscal && String(data.identificacion_fiscal).trim();
  const hasAddr = data.direccion_fiscal && String(data.direccion_fiscal).trim();
  if (hasNif || hasAddr) {
    try {
      const sets = [];
      const params = [];
      let idx = 1;
      if (hasNif) {
        sets.push(`identificacion_fiscal = $${idx++}`);
        params.push(String(data.identificacion_fiscal).trim().slice(0, 50));
      }
      if (hasAddr) {
        sets.push(`direccion_fiscal = $${idx++}`);
        params.push(String(data.direccion_fiscal).trim().slice(0, 500));
      }
      params.push(leadId);
      await query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    } catch (err) {
      logger.warn({ err: err.message, leadId }, 'createSale: no se pudieron guardar datos fiscales (no bloqueante)');
    }
  }

  // 3) Crear conversion
  // producto_contratado lo obtenemos pasando el id; conversion.service hace lookup del nombre.
  const conversion = await conversionService.create(
    {
      lead_id: leadId,
      project_id: data.project_id,
      producto_contratado: leadNombre || data.nombre || 'Cliente', // override por service si tiene lookup
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

  // 4) Si es pago fraccionado, generar las cuotas previstas.
  // El gestor envía un array `installments: [{importe_previsto, fecha_vencimiento}]`
  // que ya viene validado en el frontend (suman el total, importes>0).
  let installmentsCreated = 0;
  if (data.metodo_pago === 'fraccionado' && Array.isArray(data.installments) && data.installments.length >= 2) {
    try {
      const installmentsModule = await import('../conversions/installments.model.js');
      // installments.model.js expone createForConversion / generateFromList — usamos la lista provista.
      if (typeof installmentsModule.createFromList === 'function') {
        installmentsCreated = await installmentsModule.createFromList(conversion.id, data.installments);
      } else {
        // Fallback: INSERT directo. La lista ya viene validada del frontend.
        for (let i = 0; i < data.installments.length; i++) {
          const it = data.installments[i];
          await query(
            `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
             VALUES ($1, $2, $3, $4)`,
            [conversion.id, i + 1, it.importe_previsto, it.fecha_vencimiento]
          );
        }
        installmentsCreated = data.installments.length;
      }
      logger.info({ conversionId: conversion.id, installmentsCreated }, 'createSale: cuotas generadas');
    } catch (err) {
      // No rompemos la venta si fallan las cuotas — el gestor las puede crear luego.
      logger.error({ err: err.message, conversionId: conversion.id }, 'createSale: error generando cuotas (no bloqueante)');
    }
  }

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
    installments_created: installmentsCreated,
  };
}

/**
 * Top programas vendidos — agrupado por producto. Usado en dashboards (inicial + finanzas).
 * @param {{ projectId?: number|null, limit?: number, days?: number|null }} opts
 *   days=null → all-time. days=30 → últimos 30 días.
 */
export async function getTopProducts({ projectId, limit = 10, days = null, from = null, to = null, responsableId = null } = {}) {
  const params = [];
  const where = [];
  if (projectId) { params.push(projectId); where.push(`c.project_id = $${params.length}`); }
  if (responsableId) { params.push(responsableId); where.push(`l.responsable_id = $${params.length}`); }
  if (days) { params.push(days); where.push(`c.fecha_conversion >= (CURRENT_DATE - ($${params.length}::int))`); }
  // Rango de fechas explícito (tiene prioridad de uso desde el frontend: hoy/semana/mes/personalizado).
  if (from) { params.push(from); where.push(`c.fecha_conversion >= $${params.length}::date`); }
  if (to) { params.push(to); where.push(`c.fecha_conversion <= $${params.length}::date`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const needsLeadJoin = !!responsableId;
  params.push(limit);
  const { rows } = await query(
    `SELECT
       c.producto_contratado_id AS product_id,
       -- Manda el producto del CATALOGO. Si no lo tiene, se usa el texto libre LIMPIO:
       -- sin el prefijo "Producto/servicio: servicio academico," ni el "pago mensualidad N",
       -- que hacian que ese texto saliera como el producto mas vendido y fragmentaban
       -- un mismo curso en varias filas.
       COALESCE(p.nombre, NULLIF(TRIM(regexp_replace(regexp_replace(regexp_replace(c.producto_contratado, '^[[:space:]]*Producto/servicio:[[:space:]]*servicio[[:space:]]+acad[eé]mico[,;]?[[:space:]]*', '', 'i'), '^[[:space:]]*pago[[:space:]]+(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|matr[ií]cula)[^,]*[,]?[[:space:]]*', '', 'i'), '^[[:space:]]*servicio[[:space:]]+acad[eé]mico[[:space:]]*$', '', 'i')), ''), '— sin producto —') AS producto,
       COUNT(*)::int AS ventas,
       COALESCE(SUM(c.importe_total), 0)::numeric AS facturado,
       COALESCE(SUM(c.importe_pagado), 0)::numeric AS cobrado,
       MAX(c.fecha_conversion) AS ultima_venta
     FROM conversions c
     LEFT JOIN products p ON p.id = c.producto_contratado_id
     ${needsLeadJoin ? 'LEFT JOIN leads l ON l.id = c.lead_id' : ''}
     ${whereSql}
     GROUP BY COALESCE(p.nombre, NULLIF(TRIM(regexp_replace(regexp_replace(regexp_replace(c.producto_contratado, '^[[:space:]]*Producto/servicio:[[:space:]]*servicio[[:space:]]+acad[eé]mico[,;]?[[:space:]]*', '', 'i'), '^[[:space:]]*pago[[:space:]]+(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|matr[ií]cula)[^,]*[,]?[[:space:]]*', '', 'i'), '^[[:space:]]*servicio[[:space:]]+acad[eé]mico[[:space:]]*$', '', 'i')), ''), '— sin producto —'), c.producto_contratado_id, p.nombre
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
