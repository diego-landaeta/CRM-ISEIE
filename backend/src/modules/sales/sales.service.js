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
  // Las dos reglas que definen que es una venta, iguales que en los informes:
  // una ficha marcada como mensualidad no es una venta nueva, y una venta sin
  // ningun cobro es una proforma que el cliente no llego a pagar.
  cond.push('NOT cv.es_mensualidad');
  cond.push('EXISTS (SELECT 1 FROM conversion_payments cpx WHERE cpx.conversion_id = cv.id)');
  return { where: 'WHERE ' + cond.join(' AND '), params, idx };
}

// Lo cobrado de una venta, sumando sus apuntes. NO se usa cv.importe_pagado:
// ese campo declara 213.680 EUR de mas en ISEIE y hacia que la pantalla
// enseñara un cobrado que los cobros no respaldan.
const COBRADO_REAL = `(SELECT COALESCE(SUM(cp.importe), 0)
                         FROM conversion_payments cp WHERE cp.conversion_id = cv.id)`;

// Resumen consolidado que acompana a la vista general de Ventas.
export async function getResumenVentas(filtros = {}) {
  const { where, params } = filtrosVentas(filtros);
  const { rows } = await query(
    `SELECT COUNT(*)::int AS ventas,
            COUNT(DISTINCT cv.lead_id)::int AS clientes,
            COUNT(DISTINCT ${VENDEDORA})::int AS asesoras,
            COALESCE(SUM(cv.importe_total), 0) AS importe,
            COALESCE(SUM(${COBRADO_REAL}), 0) AS cobrado,
            COALESCE(SUM(cv.importe_total - ${COBRADO_REAL}), 0) AS pendiente,
            COUNT(*) FILTER (WHERE ${COBRADO_REAL} >= cv.importe_total)::int AS liquidadas,
            COUNT(*) FILTER (WHERE ${COBRADO_REAL} <  cv.importe_total)::int AS con_saldo,
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

// ── Desglose de lo vendido ────────────────────────────────────────────────
// Dos repartos del mismo periodo: por tipo de formacion (que se vende) y por
// tipo de cobro (matricula o cuota). Comparten el mismo filtro de fechas que
// el resto de la pantalla de Ventas.
const TIPO_FORMACION = `CASE
    WHEN c.producto_contratado IS NULL OR BTRIM(c.producto_contratado) = '' THEN 'Sin programa'
    WHEN c.producto_contratado ILIKE '%servicio%'                          THEN 'Servicio académico'
    WHEN c.producto_contratado ILIKE '%pendiente%'                         THEN 'Pendiente de registrar'
    WHEN c.producto_contratado ILIKE '%master%'
      OR c.producto_contratado ILIKE '%máster%'
      OR c.producto_contratado ILIKE '%maestr%'                            THEN 'Máster'
    WHEN c.producto_contratado ILIKE '%diplomado%'                         THEN 'Diplomado'
    WHEN c.producto_contratado ILIKE '%curso%'                             THEN 'Curso'
    ELSE 'Otros' END`;

// Un cobro es MATRICULA si es el que abre la venta; el resto son cuotas del
// plan. Es la misma regla que usan los informes, para que no digan cosas
// distintas.
const ES_MATRICULA = `(NOT c.es_mensualidad AND NOT EXISTS (
    SELECT 1 FROM conversion_payments p0
     WHERE p0.conversion_id = cp.conversion_id
       AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id))))`;

export async function getDesglose({ projectId = null, from = null, to = null } = {}) {
  const pv = [];
  const wv = [];
  if (projectId) { pv.push(projectId); wv.push(`c.project_id = $${pv.length}`); }
  if (from) { pv.push(from); wv.push(`c.fecha_conversion >= $${pv.length}::date`); }
  if (to) { pv.push(to); wv.push(`c.fecha_conversion <= $${pv.length}::date`); }
  wv.push('NOT c.es_mensualidad');
  // Una venta sin ningun cobro es una proforma que no se pago: no cuenta.
  wv.push('EXISTS (SELECT 1 FROM conversion_payments cpx WHERE cpx.conversion_id = c.id)');

  const { rows: porFormacion } = await query(
    `SELECT ${TIPO_FORMACION} AS tipo,
            COUNT(*)::int AS ventas,
            ROUND(COALESCE(SUM(c.importe_total), 0), 2)::float8 AS importe
       FROM conversions c
      WHERE ${wv.join(' AND ')}
      GROUP BY 1 ORDER BY 3 DESC`, pv);

  const pc = [];
  const wc = [];
  if (projectId) { pc.push(projectId); wc.push(`c.project_id = $${pc.length}`); }
  if (from) { pc.push(from); wc.push(`cp.fecha >= $${pc.length}::date`); }
  if (to) { pc.push(to); wc.push(`cp.fecha <= $${pc.length}::date`); }

  const { rows: porCobro } = await query(
    `SELECT CASE WHEN ${ES_MATRICULA} THEN 'Matrícula / primer pago' ELSE 'Cuota del plan' END AS tipo,
            COUNT(*)::int AS cobros,
            ROUND(COALESCE(SUM(cp.importe), 0), 2)::float8 AS importe
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
      ${wc.length ? 'WHERE ' + wc.join(' AND ') : ''}
      GROUP BY 1 ORDER BY 3 DESC`, pc);

  const totalVentas = porFormacion.reduce((a, r) => a + r.ventas, 0);
  const totalVendido = porFormacion.reduce((a, r) => a + r.importe, 0);
  const totalCobrado = porCobro.reduce((a, r) => a + r.importe, 0);

  return {
    porFormacion,
    porCobro,
    totales: {
      ventas: totalVentas,
      vendido: Math.round(totalVendido * 100) / 100,
      cobrado: Math.round(totalCobrado * 100) / 100,
      ticket: totalVentas ? Math.round((totalVendido / totalVentas) * 100) / 100 : 0,
    },
  };
}

// ── Serie de ventas, con comparación e historial ──────────────────────────
//
// Responde «cuánto y cuándo», y sobre todo «mejor o peor que antes». Devuelve
// tres cosas del mismo tiro:
//   · serie      — el periodo elegido, por dia o por mes segun su tamaño
//   · anterior   — el periodo justo anterior del MISMO tamaño, para comparar
//   · meses      — el historial mes a mes desde que hay datos
//
// La zona horaria es la de la aplicacion, igual que en los informes: sin esto
// un lead de las 22:50 cae en un dia distinto segun quien pregunte.
const TZ_VENTAS = process.env.APP_TIMEZONE || 'Europe/Madrid';
const ENTRADA_LEAD = `(COALESCE(l.fecha_solicitud, l.created_at) AT TIME ZONE '${TZ_VENTAS}')`;

function diasEntre(from, to) {
  return Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
}

function restarDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

// Un tramo: ventas, dinero y leads agrupados por dia o por mes.
async function tramo({ projectId, from, to, responsableId, porMes }) {
  const corte = porMes ? "to_char(date_trunc('month', %s), 'YYYY-MM')"
    : "to_char(%s, 'YYYY-MM-DD')";

  const pv = [];
  const wv = ['NOT c.es_mensualidad',
    // Una venta sin ningun cobro es una proforma que no se pago.
    'EXISTS (SELECT 1 FROM conversion_payments cpx WHERE cpx.conversion_id = c.id)'];
  if (projectId) { pv.push(projectId); wv.push(`c.project_id = $${pv.length}`); }
  if (responsableId) {
    pv.push(responsableId);
    wv.push(`COALESCE(c.vendedora_id, (SELECT responsable_id FROM leads WHERE id = c.lead_id)) = $${pv.length}`);
  }
  pv.push(from); const iFrom = pv.length;
  pv.push(to); const iTo = pv.length;

  const { rows: ventas } = await query(
    `SELECT ${corte.replace('%s', 'c.fecha_conversion')} AS punto,
            COUNT(*)::int AS ventas,
            ROUND(COALESCE(SUM(c.importe_total), 0), 2)::float8 AS vendido
       FROM conversions c
      WHERE ${wv.join(' AND ')}
        AND c.fecha_conversion >= $${iFrom}::date AND c.fecha_conversion <= $${iTo}::date
      GROUP BY 1 ORDER BY 1`, pv);

  const pc = [];
  const wc = [];
  if (projectId) { pc.push(projectId); wc.push(`c.project_id = $${pc.length}`); }
  if (responsableId) {
    pc.push(responsableId);
    wc.push(`COALESCE(c.vendedora_id, (SELECT responsable_id FROM leads WHERE id = c.lead_id)) = $${pc.length}`);
  }
  pc.push(from); const cFrom = pc.length;
  pc.push(to); const cTo = pc.length;
  const { rows: cobros } = await query(
    `SELECT ${corte.replace('%s', 'cp.fecha')} AS punto,
            ROUND(COALESCE(SUM(cp.importe), 0), 2)::float8 AS cobrado
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
      WHERE ${wc.length ? wc.join(' AND ') + ' AND ' : ''}
            cp.fecha >= $${cFrom}::date AND cp.fecha <= $${cTo}::date
      GROUP BY 1 ORDER BY 1`, pc);

  const pl = [];
  const wl = ['l.deleted_at IS NULL'];
  if (projectId) { pl.push(projectId); wl.push(`l.project_id = $${pl.length}`); }
  if (responsableId) { pl.push(responsableId); wl.push(`l.responsable_id = $${pl.length}`); }
  pl.push(from); const lFrom = pl.length;
  pl.push(to); const lTo = pl.length;
  const { rows: leads } = await query(
    `SELECT ${corte.replace('%s', ENTRADA_LEAD)} AS punto, COUNT(*)::int AS leads
       FROM leads l
      WHERE ${wl.join(' AND ')}
        AND ${ENTRADA_LEAD}::date >= $${lFrom}::date
        AND ${ENTRADA_LEAD}::date <= $${lTo}::date
      GROUP BY 1 ORDER BY 1`, pl);

  const por = new Map();
  const meter = (fila, campo) => {
    const p = por.get(fila.punto) || { punto: fila.punto, ventas: 0, vendido: 0, cobrado: 0, leads: 0 };
    p[campo] = fila[campo];
    if (campo === 'ventas') { p.ventas = fila.ventas; p.vendido = fila.vendido; }
    por.set(fila.punto, p);
  };
  ventas.forEach((f) => meter(f, 'ventas'));
  cobros.forEach((f) => meter(f, 'cobrado'));
  leads.forEach((f) => meter(f, 'leads'));

  const serie = [...por.values()].sort((a, b) => a.punto.localeCompare(b.punto));
  const tot = serie.reduce((a, p) => ({
    ventas: a.ventas + p.ventas,
    vendido: a.vendido + p.vendido,
    cobrado: a.cobrado + p.cobrado,
    leads: a.leads + p.leads,
  }), { ventas: 0, vendido: 0, cobrado: 0, leads: 0 });

  // La MISMA definicion de tasa que los informes: ventas del periodo sobre
  // leads recibidos en el periodo. Si aqui se calculara de otra forma,
  // tendriamos dos numeros para lo mismo, que es lo que veniamos arreglando.
  const conTasa = serie.map((p) => ({
    ...p,
    vendido: Math.round(p.vendido * 100) / 100,
    cobrado: Math.round(p.cobrado * 100) / 100,
    tasa: p.leads ? Math.round((p.ventas * 10000) / p.leads) / 100 : 0,
  }));

  return {
    serie: conTasa,
    totales: {
      ventas: tot.ventas,
      vendido: Math.round(tot.vendido * 100) / 100,
      cobrado: Math.round(tot.cobrado * 100) / 100,
      leads: tot.leads,
      tasa: tot.leads ? Math.round((tot.ventas * 10000) / tot.leads) / 100 : 0,
    },
  };
}

export async function getSerieVentas({ projectId = null, from = null, to = null, responsableId = null } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = from || `${new Date().getFullYear()}-01-01`;
  const hasta = to || hoy;
  const dias = diasEntre(desde, hasta);
  // Hasta dos meses se ve por dias; a partir de ahi, por meses.
  const porMes = dias > 62;

  const actual = await tramo({ projectId, from: desde, to: hasta, responsableId, porMes });

  // El periodo justo anterior, del mismo tamaño.
  const finAnterior = restarDias(desde, 1);
  const iniAnterior = restarDias(desde, dias);
  const previo = await tramo({ projectId, from: iniAnterior, to: finAnterior, responsableId, porMes });

  // Y el historial completo mes a mes, desde que hay datos.
  const historial = await tramo({ projectId, from: '2026-01-01', to: hoy, responsableId, porMes: true });

  const varia = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : (a ? 100 : 0));

  return {
    granularidad: porMes ? 'mes' : 'dia',
    rango: { from: desde, to: hasta },
    rangoAnterior: { from: iniAnterior, to: finAnterior },
    serie: actual.serie,
    anterior: previo.serie,
    meses: historial.serie,
    totales: actual.totales,
    totalesAnterior: previo.totales,
    variacion: {
      ventas: varia(actual.totales.ventas, previo.totales.ventas),
      vendido: varia(actual.totales.vendido, previo.totales.vendido),
      cobrado: varia(actual.totales.cobrado, previo.totales.cobrado),
      leads: varia(actual.totales.leads, previo.totales.leads),
      tasa: Math.round((actual.totales.tasa - previo.totales.tasa) * 100) / 100,
    },
  };
}
