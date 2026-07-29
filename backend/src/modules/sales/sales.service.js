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

// ---------------------------------------------------------------------------
// Vistas agregadas de Ventas (Finanzas). Las tres comparten el mismo criterio
// de vendedora: la de la venta si la tiene, si no la gestora del lead.
// ---------------------------------------------------------------------------
const VENDEDORA = 'COALESCE(cv.vendedora_id, l.responsable_id)';

// Quita tildes en SQL. Se usa en la busqueda para que "Barbara" encuentre a "Barbara".
const SIN_TILDES = (expr) =>
  `translate(${expr}, 'áàäâãéèëêíìïîóòöôõúùüûñÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑçÇ',
                      'aaaaaeeeeiiiiooooouuuunAAAAAEEEEIIIIOOOOOUUUUNcC')`;


function filtrosVentas({ projectId, from, to, responsableId, search }, startIdx = 1) {
  const cond = [];
  const params = [];
  let idx = startIdx;
  if (projectId) { cond.push(`cv.project_id = $${idx++}`); params.push(projectId); }
  if (from) { cond.push(`cv.fecha_conversion >= $${idx++}`); params.push(from); }
  if (to) { cond.push(`cv.fecha_conversion <= $${idx++}`); params.push(to); }
  if (responsableId) { cond.push(`${VENDEDORA} = $${idx++}`); params.push(responsableId); }
  if (search) {
    // Busqueda insensible a tildes sin depender de la extension unaccent,
    // que esta en un CRM pero no en el otro.
    cond.push(`(${SIN_TILDES('l.nombre')} ILIKE ${SIN_TILDES('$' + idx)}
                OR l.email ILIKE $${idx}
                OR ${SIN_TILDES('cv.producto_contratado')} ILIKE ${SIN_TILDES('$' + idx)})`);
    params.push(`%${search}%`); idx++;
  }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params, idx };
}

// Resumen consolidado que acompana a la vista general de Ventas.
export async function getResumenVentas(filtros = {}) {
  const { where, params } = filtrosVentas(filtros);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS ventas,
            COUNT(DISTINCT cv.lead_id)::int AS clientes,
            COUNT(DISTINCT ${VENDEDORA})::int AS asesoras,
            COALESCE(SUM(cv.importe_total), 0) AS importe,
            COALESCE(SUM(cv.importe_pagado), 0) AS cobrado,
            COALESCE(SUM(cv.importe_total - cv.importe_pagado), 0) AS pendiente,
            COUNT(*) FILTER (WHERE cv.importe_pagado >= cv.importe_total)::int AS liquidadas,
            COUNT(*) FILTER (WHERE cv.importe_pagado < cv.importe_total)::int AS con_saldo,
            COALESCE(AVG(cv.importe_total), 0) AS ticket_medio
       FROM conversions cv
       LEFT JOIN leads l ON l.id = cv.lead_id
       ${where}`,
    params
  );
  const r = rows[0];

  // Cuotas: cuantas ventas van fraccionadas y como va el cobro de ese plan.
  const { rows: cuotas } = await query(
    `SELECT COUNT(DISTINCT ci.conversion_id)::int AS ventas_con_plan,
            COUNT(*)::int AS cuotas,
            COUNT(*) FILTER (WHERE ci.fecha_cobro IS NOT NULL)::int AS cuotas_cobradas,
            COUNT(*) FILTER (WHERE ci.fecha_cobro IS NULL)::int AS cuotas_pendientes,
            COUNT(*) FILTER (WHERE ci.fecha_cobro IS NULL AND ci.fecha_vencimiento < CURRENT_DATE)::int AS cuotas_vencidas,
            COALESCE(SUM(ci.importe_previsto) FILTER (WHERE ci.fecha_cobro IS NULL), 0) AS importe_pendiente,
            COALESCE(SUM(ci.importe_previsto) FILTER (WHERE ci.fecha_cobro IS NULL AND ci.fecha_vencimiento < CURRENT_DATE), 0) AS importe_vencido
       FROM conversion_installments ci
       JOIN conversions cv ON cv.id = ci.conversion_id
       LEFT JOIN leads l ON l.id = cv.lead_id
       ${where}`,
    params
  );

  return {
    ventas: r.ventas,
    clientes: r.clientes,
    asesoras: r.asesoras,
    importe: Number(r.importe),
    cobrado: Number(r.cobrado),
    pendiente: Number(r.pendiente),
    liquidadas: r.liquidadas,
    con_saldo: r.con_saldo,
    ticket_medio: Number(r.ticket_medio),
    cuotas: {
      ventas_con_plan: cuotas[0].ventas_con_plan,
      total: cuotas[0].cuotas,
      cobradas: cuotas[0].cuotas_cobradas,
      pendientes: cuotas[0].cuotas_pendientes,
      vencidas: cuotas[0].cuotas_vencidas,
      importe_pendiente: Number(cuotas[0].importe_pendiente),
      importe_vencido: Number(cuotas[0].importe_vencido),
    },
  };
}

// Ventas agrupadas por asesora.
export async function getVentasPorAsesora(filtros = {}) {
  const { where, params } = filtrosVentas(filtros);
  const { rows } = await query(
    `SELECT ${VENDEDORA} AS user_id,
            COALESCE(u.nombre, '— sin asignar —') AS nombre,
            u.email, u.role,
            COUNT(*)::int AS ventas,
            COUNT(DISTINCT cv.lead_id)::int AS clientes,
            COALESCE(SUM(cv.importe_total), 0) AS importe,
            COALESCE(SUM(cv.importe_pagado), 0) AS cobrado,
            COALESCE(SUM(cv.importe_total - cv.importe_pagado), 0) AS pendiente,
            COALESCE(AVG(cv.importe_total), 0) AS ticket_medio,
            MAX(cv.fecha_conversion) AS ultima_venta
       FROM conversions cv
       LEFT JOIN leads l ON l.id = cv.lead_id
       LEFT JOIN users u ON u.id = COALESCE(cv.vendedora_id, l.responsable_id)
       ${where}
      GROUP BY 1, u.nombre, u.email, u.role
      ORDER BY importe DESC`,
    params
  );
  return rows.map((r) => ({
    ...r,
    importe: Number(r.importe),
    cobrado: Number(r.cobrado),
    pendiente: Number(r.pendiente),
    ticket_medio: Number(r.ticket_medio),
  }));
}

// Ventas agrupadas por cliente. Paginado: hay muchos mas clientes que asesoras.
export async function getVentasPorCliente(filtros = {}) {
  const page = Math.max(1, parseInt(filtros.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(filtros.limit) || 50));
  const { where, params, idx } = filtrosVentas(filtros);

  // Las ventas del filtro se aislan en una CTE para poder contar sus cuotas
  // por cliente sin meter agregados dentro de subconsultas.
  const CTE = `WITH v AS (
      SELECT cv.id, cv.lead_id, cv.importe_total, cv.importe_pagado, cv.fecha_conversion,
             l.nombre AS cliente, l.email, l.telefono,
             u.nombre AS asesora
        FROM conversions cv
        LEFT JOIN leads l ON l.id = cv.lead_id
        LEFT JOIN users u ON u.id = COALESCE(cv.vendedora_id, l.responsable_id)
        ${where}
    ),
    cu AS (
      SELECT v.lead_id,
             COUNT(*) FILTER (WHERE ci.fecha_cobro IS NULL)::int AS cuotas_pendientes,
             COUNT(*) FILTER (WHERE ci.fecha_cobro IS NULL AND ci.fecha_vencimiento < CURRENT_DATE)::int AS cuotas_vencidas,
             COALESCE(SUM(ci.importe_previsto) FILTER (WHERE ci.fecha_cobro IS NULL), 0) AS cuotas_importe_pendiente
        FROM conversion_installments ci
        JOIN v ON v.id = ci.conversion_id
       GROUP BY v.lead_id
    )`;

  const { rows: countRows } = await query(
    `${CTE} SELECT COUNT(DISTINCT v.lead_id)::int AS total FROM v`,
    params
  );
  const { rows } = await query(
    `${CTE}
     SELECT v.lead_id,
            MAX(v.cliente) AS cliente,
            MAX(v.email) AS email,
            MAX(v.telefono) AS telefono,
            COUNT(*)::int AS ventas,
            COALESCE(SUM(v.importe_total), 0) AS importe,
            COALESCE(SUM(v.importe_pagado), 0) AS cobrado,
            COALESCE(SUM(v.importe_total - v.importe_pagado), 0) AS pendiente,
            MIN(v.fecha_conversion) AS primera_venta,
            MAX(v.fecha_conversion) AS ultima_venta,
            COALESCE(MAX(cu.cuotas_pendientes), 0) AS cuotas_pendientes,
            COALESCE(MAX(cu.cuotas_vencidas), 0) AS cuotas_vencidas,
            COALESCE(MAX(cu.cuotas_importe_pendiente), 0) AS cuotas_importe_pendiente,
            STRING_AGG(DISTINCT v.asesora, ', ') AS asesoras
       FROM v
       LEFT JOIN cu ON cu.lead_id = v.lead_id
      GROUP BY v.lead_id
      ORDER BY importe DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, (page - 1) * limit]
  );
  return {
    clientes: rows.map((r) => ({
      ...r,
      importe: Number(r.importe),
      cobrado: Number(r.cobrado),
      pendiente: Number(r.pendiente),
      cuotas_importe_pendiente: Number(r.cuotas_importe_pendiente),
    })),
    total: countRows[0].total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(countRows[0].total / limit)),
  };
}
