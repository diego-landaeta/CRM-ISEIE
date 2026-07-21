import { query } from '../../shared/config/db.js';

// Overview por proyecto + rango fechas
export async function overview({ projectId, from, to }) {
  const params = [];
  let idx = 1;
  const pFilter = projectId ? `AND project_id = $${idx++}` : '';
  if (projectId) params.push(projectId);
  const fromParam = from ? `$${idx++}` : 'NULL';
  if (from) params.push(from);
  const toParam = to ? `$${idx++}` : 'NULL';
  if (to) params.push(to);

  // Leads: total + por estado + por canal + por gestor
  const { rows: leadsKpi } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'nuevo') as nuevo,
       COUNT(*) FILTER (WHERE status = 'por_contactar') as por_contactar,
       COUNT(*) FILTER (WHERE status = 'contactado') as contactado,
       COUNT(*) FILTER (WHERE status = 'en_seguimiento') as en_seguimiento,
       COUNT(*) FILTER (WHERE status = 'convertido') as convertido,
       COUNT(*) FILTER (WHERE status = 'no_interesado') as no_interesado
     FROM leads
     WHERE 1=1 ${pFilter}
       AND (${fromParam}::date IS NULL OR created_at >= ${fromParam}::date)
       AND (${toParam}::date IS NULL OR created_at <= ${toParam}::date + INTERVAL '1 day')`,
    params
  );

  const { rows: byCanal } = await query(
    `SELECT COALESCE(lu.canal_detectado::text, 'sin_canal') as canal, COUNT(*)::int as total
     FROM leads l
     LEFT JOIN lead_utms lu ON lu.lead_id = l.id
     WHERE 1=1 ${pFilter.replace('project_id', 'l.project_id')}
       AND (${fromParam}::date IS NULL OR l.created_at >= ${fromParam}::date)
       AND (${toParam}::date IS NULL OR l.created_at <= ${toParam}::date + INTERVAL '1 day')
     GROUP BY lu.canal_detectado ORDER BY total DESC`,
    params
  );

  const { rows: byGestor } = await query(
    `SELECT COALESCE(u.nombre, 'Sin asignar') as gestor,
            COUNT(l.id)::int as total,
            COUNT(l.id) FILTER (WHERE l.status = 'convertido')::int as convertidos
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     WHERE 1=1 ${pFilter.replace('project_id', 'l.project_id')}
       AND (${fromParam}::date IS NULL OR l.created_at >= ${fromParam}::date)
       AND (${toParam}::date IS NULL OR l.created_at <= ${toParam}::date + INTERVAL '1 day')
     GROUP BY u.nombre ORDER BY total DESC`,
    params
  );

  // Conversiones: total + importes
  const { rows: convKpi } = await query(
    `SELECT
       COUNT(*)::int as total,
       COALESCE(SUM(importe_total), 0)::numeric as ventas_brutas,
       COALESCE(SUM(importe_pagado), 0)::numeric as cobrado,
       COALESCE(SUM(importe_total - importe_pagado), 0)::numeric as por_cobrar
     FROM conversions
     WHERE 1=1 ${pFilter}
       AND (${fromParam}::date IS NULL OR fecha_conversion >= ${fromParam}::date)
       AND (${toParam}::date IS NULL OR fecha_conversion <= ${toParam}::date)`,
    params
  );

  // Top productos por ingresos
  const { rows: topProductos } = await query(
    `SELECT producto_contratado as producto,
            COUNT(*)::int as ventas,
            COALESCE(SUM(importe_total), 0)::numeric as total,
            COALESCE(SUM(importe_pagado), 0)::numeric as cobrado
     FROM conversions
     WHERE 1=1 ${pFilter}
       AND (${fromParam}::date IS NULL OR fecha_conversion >= ${fromParam}::date)
       AND (${toParam}::date IS NULL OR fecha_conversion <= ${toParam}::date)
     GROUP BY producto_contratado
     ORDER BY total DESC LIMIT 10`,
    params
  );

  // Trend mensual de ingresos cobrados (12 meses) - usa solo projectId
  const trendParams = projectId ? [projectId] : [];
  const trendFilter = projectId ? `AND c.project_id = $1` : '';
  const { rows: trend } = await query(
    `SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') as mes,
            COALESCE(SUM(importe), 0)::numeric as ingresos
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     WHERE fecha >= CURRENT_DATE - INTERVAL '12 months'
       ${trendFilter}
     GROUP BY mes ORDER BY mes`,
    trendParams
  );

  // Tasa conversion = convertidos / total leads
  const tl = Number(leadsKpi[0].total || 0);
  const conv = Number(leadsKpi[0].convertido || 0);
  const tasa_conversion = tl > 0 ? Math.round((conv / tl) * 1000) / 10 : 0;

  return {
    leads: leadsKpi[0],
    leads_por_canal: byCanal,
    leads_por_gestor: byGestor,
    conversions: convKpi[0],
    top_productos: topProductos,
    ingresos_mensual: trend,
    tasa_conversion,
  };
}

// ── Helpers de filtro para los reportes descargables ─────────────────────
function buildFilter({ projectId, from, to }, dateCol, projectCol = 'project_id') {
  const params = [];
  const cond = [];
  let idx = 1;
  if (projectId) { cond.push(`${projectCol} = $${idx++}`); params.push(projectId); }
  if (from) { cond.push(`${dateCol}::date >= $${idx++}::date`); params.push(from); }
  if (to) { cond.push(`${dateCol}::date <= $${idx++}::date`); params.push(to); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

const ENTRY = 'COALESCE(l.fecha_solicitud, l.created_at)';

// País: leads no tiene columna 'pais'. pais_fiscal si existe, si no lo derivamos
// del prefijo internacional del teléfono.
const PAIS = `COALESCE(NULLIF(l.pais_fiscal, ''), CASE
    WHEN l.telefono LIKE '+34%' THEN 'España'
    WHEN l.telefono LIKE '+52%' THEN 'México'
    WHEN l.telefono LIKE '+57%' THEN 'Colombia'
    WHEN l.telefono LIKE '+593%' THEN 'Ecuador'
    WHEN l.telefono LIKE '+51%' THEN 'Perú'
    WHEN l.telefono LIKE '+54%' THEN 'Argentina'
    WHEN l.telefono LIKE '+56%' THEN 'Chile'
    WHEN l.telefono LIKE '+58%' THEN 'Venezuela'
    WHEN l.telefono LIKE '+591%' THEN 'Bolivia'
    WHEN l.telefono LIKE '+598%' THEN 'Uruguay'
    WHEN l.telefono LIKE '+595%' THEN 'Paraguay'
    WHEN l.telefono LIKE '+502%' THEN 'Guatemala'
    WHEN l.telefono LIKE '+503%' THEN 'El Salvador'
    WHEN l.telefono LIKE '+504%' THEN 'Honduras'
    WHEN l.telefono LIKE '+505%' THEN 'Nicaragua'
    WHEN l.telefono LIKE '+506%' THEN 'Costa Rica'
    WHEN l.telefono LIKE '+507%' THEN 'Panamá'
    WHEN l.telefono LIKE '+1%' THEN 'USA/Canadá'
    ELSE NULL END)`;

// 1) RESUMEN MENSUAL
export async function resumenMensual({ projectId, from, to }) {
  const e = buildFilter({ projectId, from, to }, ENTRY, 'l.project_id');
  const c = buildFilter({ projectId, from, to }, 'fecha_conversion', 'project_id');
  const cSql = c.where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + e.params.length}`);
  const { rows } = await query(
    `WITH entrados AS (
       SELECT to_char(date_trunc('month', ${ENTRY}), 'YYYY-MM') AS mes, COUNT(*)::int AS prospectos
       FROM leads l ${e.where} GROUP BY 1
     ), convertidos AS (
       SELECT to_char(date_trunc('month', fecha_conversion), 'YYYY-MM') AS mes,
              COUNT(*)::int AS convertidos,
              COALESCE(SUM(importe_total),0)::numeric AS ventas,
              COALESCE(SUM(importe_pagado),0)::numeric AS cobrado
       FROM conversions ${cSql} GROUP BY 1
     )
     SELECT COALESCE(e.mes, c.mes) AS mes,
            COALESCE(e.prospectos,0) AS prospectos,
            COALESCE(c.convertidos,0) AS convertidos,
            CASE WHEN COALESCE(e.prospectos,0) > 0
                 THEN ROUND(COALESCE(c.convertidos,0)::numeric / e.prospectos * 100, 1)
                 ELSE 0 END AS tasa_conversion,
            COALESCE(c.ventas,0) AS ventas,
            COALESCE(c.cobrado,0) AS cobrado
     FROM entrados e FULL OUTER JOIN convertidos c ON e.mes = c.mes
     ORDER BY mes`,
    [...e.params, ...c.params]
  );
  return rows;
}

// 2) PROSPECTOS (por entrada, con valor estimado)
export async function prospectosReport({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, ENTRY, 'l.project_id');
  const { rows } = await query(
    `SELECT p.nombre AS proyecto, l.nombre, l.telefono, l.email, l.status AS estado,
            prod.nombre AS producto, prod.precio AS valor_estimado, prod.moneda,
            u.nombre AS responsable, ${ENTRY} AS fecha_entrada
     FROM leads l
     LEFT JOIN products prod ON prod.id = l.producto_interes_id
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = l.project_id
     ${where}
     ORDER BY fecha_entrada DESC`,
    params
  );
  return rows;
}

// 3) VENTAS: por fecha de PAGO (cada cuota donde cae). Un lead de marzo que paga
// una cuota en julio aparece en el reporte de julio, con mes de origen = marzo.
export async function ventasReport({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, 'cp.fecha', 'c.project_id');
  const { rows } = await query(
    `SELECT cp.fecha AS fecha_pago,
            l.nombre AS cliente,
            c.producto_contratado AS formacion,
            cp.importe AS importe,
            CASE
              WHEN plan.total = 0 THEN 'Pago único'
              WHEN ci.numero IS NOT NULL THEN 'Cuota ' || ci.numero || ' de ' || plan.total || ' · faltan ' || GREATEST(plan.total - plan.pagadas, 0)
              ELSE 'Abono (plan de ' || plan.total || ' cuotas) · faltan ' || GREATEST(plan.total - plan.pagadas, 0)
            END AS plan_pago,
            to_char(date_trunc('month', c.fecha_conversion), 'YYYY-MM') AS mes_origen,
            ${PAIS} AS pais,
            (c.importe_total - c.importe_pagado) AS pendiente,
            c.metodo_pago, p.nombre AS proyecto
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN conversion_installments ci ON ci.payment_id = cp.id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE fecha_cobro IS NOT NULL OR payment_id IS NOT NULL)::int AS pagadas
       FROM conversion_installments cix WHERE cix.conversion_id = c.id
     ) plan ON TRUE
     LEFT JOIN projects p ON p.id = c.project_id
     ${where}
     ORDER BY cp.fecha DESC, cp.id DESC`,
    params
  );
  return rows;
}

// 4) GENERAL (prospectos + estimado + real)
export async function generalReport({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, ENTRY, 'l.project_id');
  const { rows } = await query(
    `SELECT p.nombre AS proyecto, l.nombre, l.telefono, l.email, l.status AS estado,
            ${PAIS} AS pais,
            prod.nombre AS producto_interes, prod.precio AS valor_estimado,
            conv.producto_contratado, conv.importe_total AS venta_total,
            conv.importe_pagado AS venta_cobrado,
            (conv.importe_total - conv.importe_pagado) AS venta_pendiente,
            conv.metodo_pago, conv.fecha_conversion AS fecha_venta,
            u.nombre AS responsable, ${ENTRY} AS fecha_entrada
     FROM leads l
     LEFT JOIN products prod ON prod.id = l.producto_interes_id
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN LATERAL (
       SELECT * FROM conversions c WHERE c.lead_id = l.id
       ORDER BY c.fecha_conversion DESC LIMIT 1
     ) conv ON TRUE
     ${where}
     ORDER BY fecha_entrada DESC`,
    params
  );
  return rows;
}

// 5) GENERAL + FACTURACIÓN
export async function generalFacturacionReport({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, ENTRY, 'l.project_id');
  const { rows } = await query(
    `SELECT p.nombre AS proyecto, l.nombre, l.telefono, l.status AS estado,
            prod.nombre AS producto_interes, prod.precio AS valor_estimado,
            conv.producto_contratado, conv.importe_total AS venta_total,
            conv.importe_pagado AS venta_cobrado,
            (conv.importe_total - conv.importe_pagado) AS venta_pendiente,
            conv.fecha_conversion AS fecha_venta,
            COALESCE(fac.num_facturas, 0) AS num_facturas,
            COALESCE(fac.facturado, 0) AS facturado,
            fac.codigos AS facturas,
            u.nombre AS responsable, ${ENTRY} AS fecha_entrada
     FROM leads l
     LEFT JOIN products prod ON prod.id = l.producto_interes_id
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN LATERAL (
       SELECT * FROM conversions c WHERE c.lead_id = l.id
       ORDER BY c.fecha_conversion DESC LIMIT 1
     ) conv ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS num_facturas,
              COALESCE(SUM(i.total),0)::numeric AS facturado,
              string_agg(i.codigo, ', ' ORDER BY i.numero) AS codigos
       FROM invoices i
       WHERE i.conversion_id = conv.id AND i.estado <> 'cancelada' AND i.tipo = 'normal'
     ) fac ON TRUE
     ${where}
     ORDER BY fecha_entrada DESC`,
    params
  );
  return rows;
}

// 6) COBROS POR MES (cuotas)
export async function cobrosMensuales({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, 'cp.fecha', 'c.project_id');
  const { rows } = await query(
    `SELECT to_char(date_trunc('month', cp.fecha), 'YYYY-MM') AS mes,
            cp.fecha, l.nombre AS cliente, c.producto_contratado AS producto,
            cp.importe, c.metodo_pago, p.nombre AS proyecto
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN projects p ON p.id = c.project_id
     ${where}
     ORDER BY cp.fecha DESC, cp.id DESC`,
    params
  );
  return rows;
}

// 7) VENTAS POR VENDEDORA: agrupa ventas por el responsable del lead (por fecha
// de venta). "Sin asignar" cuando el lead no tiene responsable.
export async function ventasVendedora({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const { rows } = await query(
    `SELECT COALESCE(u.nombre, 'Sin asignar') AS vendedora,
            COUNT(*)::int AS ventas,
            COUNT(DISTINCT c.lead_id)::int AS clientes,
            COALESCE(SUM(c.importe_total), 0)::numeric AS total,
            COALESCE(SUM(c.importe_pagado), 0)::numeric AS cobrado,
            COALESCE(SUM(c.importe_total - c.importe_pagado), 0)::numeric AS pendiente
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = l.responsable_id
     ${where}
     GROUP BY 1
     ORDER BY cobrado DESC`,
    params
  );
  return rows;
}
