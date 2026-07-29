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
    `SELECT COALESCE((SELECT pr.nombre FROM products pr WHERE pr.id = conversions.producto_contratado_id),
                    NULLIF(TRIM(regexp_replace(regexp_replace(regexp_replace(producto_contratado, '^[[:space:]]*Producto/servicio:[[:space:]]*servicio[[:space:]]+acad[eé]mico[,;]?[[:space:]]*', '', 'i'), '^[[:space:]]*pago[[:space:]]+(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|matr[ií]cula)[^,]*[,]?[[:space:]]*', '', 'i'), '^[[:space:]]*servicio[[:space:]]+acad[eé]mico[[:space:]]*$', '', 'i')), ''), '— sin producto —') as producto,
            COUNT(*)::int as ventas,
            COALESCE(SUM(importe_total), 0)::numeric as total,
            COALESCE(SUM(importe_pagado), 0)::numeric as cobrado
     FROM conversions
     WHERE 1=1 ${pFilter}
       AND (${fromParam}::date IS NULL OR fecha_conversion >= ${fromParam}::date)
       AND (${toParam}::date IS NULL OR fecha_conversion <= ${toParam}::date)
     GROUP BY COALESCE((SELECT pr.nombre FROM products pr WHERE pr.id = conversions.producto_contratado_id),
                       NULLIF(TRIM(regexp_replace(regexp_replace(regexp_replace(producto_contratado, '^[[:space:]]*Producto/servicio:[[:space:]]*servicio[[:space:]]+acad[eé]mico[,;]?[[:space:]]*', '', 'i'), '^[[:space:]]*pago[[:space:]]+(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|matr[ií]cula)[^,]*[,]?[[:space:]]*', '', 'i'), '^[[:space:]]*servicio[[:space:]]+acad[eé]mico[[:space:]]*$', '', 'i')), ''), '— sin producto —')
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

// El reporte general mezcla dos hechos con fechas distintas:
// - prospecto sin venta: fecha de entrada;
// - cliente con venta: fecha de conversión.
// Filtrar todo por la fecha de entrada hacía que una importación de ventas
// históricas pareciera generar cientos de ventas el día de la importación.
function buildGeneralFilter({ projectId, from, to }) {
  const params = [];
  const cond = [];
  let idx = 1;
  const reportDate = `(CASE
    WHEN conv.id IS NOT NULL THEN conv.fecha_conversion::date
    ELSE ${ENTRY}::date
  END)`;
  if (projectId) { cond.push(`l.project_id = $${idx++}`); params.push(projectId); }
  if (from) { cond.push(`${reportDate} >= $${idx++}::date`); params.push(from); }
  if (to) { cond.push(`${reportDate} <= $${idx++}::date`); params.push(to); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

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

// 3) VENTAS: una fila por conversión, filtrada por fecha de venta.
// Los pagos/abonos pertenecen al reporte de cobros y no deben inflar ventas.
export async function ventasReport({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const { rows } = await query(
    `SELECT c.id AS venta_id,
            c.fecha_conversion AS fecha_venta,
            l.nombre AS cliente,
            c.producto_contratado AS formacion,
            c.importe_total AS venta_total,
            c.importe_pagado AS cobrado,
            (c.importe_total - c.importe_pagado) AS pendiente,
            CASE
              WHEN c.importe_pagado >= c.importe_total THEN 'Pagada'
              WHEN c.importe_pagado > 0 THEN 'Pago parcial'
              ELSE 'Pendiente'
            END AS estado_pago,
            ${PAIS} AS pais,
            c.metodo_pago,
            l.status AS estado,
            u.nombre AS responsable,
            p.nombre AS proyecto
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     -- Se atribuye a la vendedora de la VENTA; si no la tiene, al responsable del lead.
     LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
     LEFT JOIN projects p ON p.id = c.project_id
     ${where}
     ORDER BY c.fecha_conversion DESC, c.id DESC`,
    params
  );
  return rows;
}

// 4) GENERAL (prospectos + estimado + real)
export async function generalReport({ projectId, from, to }) {
  const { where, params } = buildGeneralFilter({ projectId, from, to });
  const { rows } = await query(
    `SELECT p.nombre AS proyecto, l.nombre, l.telefono, l.email, l.status AS estado,
            ${PAIS} AS pais,
            prod.nombre AS producto_interes, prod.precio AS valor_estimado,
            conv.producto_contratado, conv.importe_total AS venta_total,
            conv.importe_pagado AS venta_cobrado,
            (conv.importe_total - conv.importe_pagado) AS venta_pendiente,
            conv.metodo_pago, conv.fecha_conversion AS fecha_venta,
            COALESCE(uv.nombre, u.nombre) AS responsable, ${ENTRY} AS fecha_entrada
     FROM leads l
     LEFT JOIN products prod ON prod.id = l.producto_interes_id
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN LATERAL (
       SELECT * FROM conversions c WHERE c.lead_id = l.id
       ORDER BY c.fecha_conversion DESC LIMIT 1
     ) conv ON TRUE
     -- Si la venta tiene vendedora propia, ella manda sobre el responsable del lead.
     LEFT JOIN users uv ON uv.id = conv.vendedora_id
     ${where}
     ORDER BY fecha_entrada DESC`,
    params
  );
  return rows;
}

// 5) GENERAL + FACTURACIÓN
export async function generalFacturacionReport({ projectId, from, to }) {
  const { where, params } = buildGeneralFilter({ projectId, from, to });
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
            COALESCE(uv.nombre, u.nombre) AS responsable, ${ENTRY} AS fecha_entrada
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
     -- Si la venta tiene vendedora propia, ella manda sobre el responsable del lead.
     LEFT JOIN users uv ON uv.id = conv.vendedora_id
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

// 7) VENTAS POR VENDEDORA. Ojo con las dos fechas: lo VENDIDO se cuenta por la
// fecha de la venta, pero lo COBRADO se cuenta por la fecha de cada pago. Antes
// se sumaba el importe_pagado de las ventas del rango, que mete en el periodo
// dinero cobrado en otros meses (y deja fuera lo que se cobra ahora de ventas
// antiguas). "Sin asignar" cuando la venta no tiene vendedora ni el lead gestora.
export async function ventasVendedora({ projectId, from, to }) {
  const v = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const pgo = buildFilter({ projectId, from, to }, 'cp.fecha', 'c.project_id');
  // El segundo bloque de parametros va detras del primero.
  const off = v.params.length;
  const wherePago = pgo.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + off));

  const { rows } = await query(
    `WITH ventas AS (
       SELECT COALESCE(c.vendedora_id, l.responsable_id) AS uid,
              COUNT(*)::int AS ventas,
              COUNT(DISTINCT c.lead_id)::int AS clientes,
              COALESCE(SUM(c.importe_total), 0)::numeric AS total,
              COALESCE(SUM(c.importe_total - c.importe_pagado), 0)::numeric AS pendiente
         FROM conversions c
         LEFT JOIN leads l ON l.id = c.lead_id
         ${v.where}
        GROUP BY 1
     ),
     cobros AS (
       SELECT COALESCE(c.vendedora_id, l.responsable_id) AS uid,
              COALESCE(SUM(cp.importe), 0)::numeric AS cobrado
         FROM conversion_payments cp
         JOIN conversions c ON c.id = cp.conversion_id
         LEFT JOIN leads l ON l.id = c.lead_id
         ${wherePago}
        GROUP BY 1
     )
     SELECT COALESCE(u.nombre, 'Sin asignar') AS vendedora,
            COALESCE(v.ventas, 0) AS ventas,
            COALESCE(v.clientes, 0) AS clientes,
            COALESCE(v.total, 0) AS total,
            COALESCE(cb.cobrado, 0) AS cobrado,
            COALESCE(v.pendiente, 0) AS pendiente
       FROM ventas v
       -- -1 hace de clave para las ventas sin vendedora: NULL nunca casa con NULL
       FULL OUTER JOIN cobros cb ON COALESCE(cb.uid, -1) = COALESCE(v.uid, -1)
       LEFT JOIN users u ON u.id = COALESCE(v.uid, cb.uid)
      ORDER BY cobrado DESC`,
    [...v.params, ...pgo.params]
  );
  return rows;
}

// La venta se atribuye a su vendedora; si no la tiene, al responsable del lead.
const ASESORA = 'COALESCE(c.vendedora_id, l.responsable_id)';

// DETALLE: una fila por venta, para descargar.
export async function ventasPorAsesoraReport({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const { rows } = await query(
    `SELECT COALESCE(u.nombre, '— sin asesora —') AS asesora,
            c.fecha_conversion AS fecha_venta,
            l.nombre AS cliente,
            l.email AS cliente_email,
            l.telefono AS cliente_telefono,
            ${PAIS} AS pais,
            c.producto_contratado AS formacion,
            c.importe_total AS venta_total,
            c.importe_pagado AS cobrado,
            (c.importe_total - c.importe_pagado) AS pendiente,
            CASE
              WHEN c.importe_pagado >= c.importe_total THEN 'Pagada'
              WHEN c.importe_pagado > 0 THEN 'Pago parcial'
              ELSE 'Pendiente'
            END AS estado_pago,
            c.metodo_pago,
            (SELECT COUNT(*) FROM conversion_payments cp WHERE cp.conversion_id = c.id)::int AS num_cobros,
            (SELECT COUNT(*) FROM conversion_installments ci
              WHERE ci.conversion_id = c.id AND ci.fecha_cobro IS NULL)::int AS cuotas_pendientes,
            (SELECT COUNT(*) FROM invoices i
              WHERE i.conversion_id = c.id AND i.estado NOT IN ('cancelada','borrador'))::int AS facturas,
            l.status AS estado_lead,
            ${ENTRY}::date AS fecha_entrada,
            p.nombre AS proyecto
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
       LEFT JOIN projects p ON p.id = c.project_id
       ${where}
      ORDER BY COALESCE(u.nombre, 'zzz') ASC, c.fecha_conversion DESC, c.id DESC`,
    params
  );
  return rows;
}

// AGREGADO: por asesora y mes. Es lo que se ve en el panel.
export async function asesorasPorMes({ projectId, from, to }) {
  // Tres cosas distintas con tres fechas distintas: los leads por su fecha de
  // entrada, las ventas por su fecha de venta y los cobros por su fecha de cobro.
  // Los leads van por su FECHA DE SOLICITUD, no por cuando se metieron en el CRM:
  // con created_at, enero-abril salian con 0 leads y mayo con 11.892 (la carga masiva).
  const fl = buildFilter({ projectId, from, to }, ENTRY, 'l.project_id');
  const fv = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const fc = buildFilter({ projectId, from, to }, 'cp.fecha', 'c.project_id');
  const off1 = fl.params.length;
  const off2 = off1 + fv.params.length;
  const wv = fv.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + off1));
  const wc = fc.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + off2));

  const { rows } = await query(
    `WITH leads_mes AS (
       SELECT to_char(date_trunc('month', ${ENTRY}), 'YYYY-MM') AS mes,
              -- Si el lead no tiene responsable pero acabo comprando, cuenta para
              -- la vendedora de su venta: si no, sale como '— sin asesora —' con
              -- ventas que si tienen dueña.
              COALESCE(l.responsable_id, (
                SELECT cv.vendedora_id FROM conversions cv
                 WHERE cv.lead_id = l.id AND cv.vendedora_id IS NOT NULL
                 ORDER BY cv.fecha_conversion LIMIT 1)) AS uid,
              COUNT(*)::int AS leads,
              -- Convertido = tiene una venta con fecha igual o posterior a su
              -- entrada. Con status='convertido' a secas se colaba la carga
              -- masiva: clientes viejos metidos con fecha de julio cuya venta
              -- es de enero. Un lead no compra antes de llegar.
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM conversions cvx
                 WHERE cvx.lead_id = l.id
                   AND cvx.fecha_conversion >= ${ENTRY}::date))::int AS leads_convertidos
         FROM leads l ${fl.where}
        GROUP BY 1, 2
     ),
     ventas_mes AS (
       SELECT to_char(date_trunc('month', c.fecha_conversion), 'YYYY-MM') AS mes,
              ${ASESORA} AS uid,
              COUNT(*)::int AS ventas,
              COUNT(DISTINCT c.lead_id)::int AS clientes,
              COALESCE(SUM(c.importe_total), 0) AS vendido
         FROM conversions c
         LEFT JOIN leads l ON l.id = c.lead_id
         ${wv}
        GROUP BY 1, 2
     ),
     cobros_mes AS (
       SELECT to_char(date_trunc('month', cp.fecha), 'YYYY-MM') AS mes,
              ${ASESORA} AS uid,
              COALESCE(SUM(cp.importe), 0) AS cobrado,
              -- Un cobro es cuota si salda alguna cuota del plan. Con EXISTS y no
              -- con JOIN: un mismo pago puede saldar varias y se contaria dos veces.
              COALESCE(SUM(cp.importe) FILTER (WHERE NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))), 0) AS cobrado_venta,
              COALESCE(SUM(cp.importe) FILTER (WHERE NOT NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))), 0) AS cobrado_cuotas,
              COUNT(*) FILTER (WHERE NOT NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id))))::int AS mensualidades
         FROM conversion_payments cp
         JOIN conversions c ON c.id = cp.conversion_id
         LEFT JOIN leads l ON l.id = c.lead_id
         ${wc}
        GROUP BY 1, 2
     ),
     todo AS (
       SELECT mes, uid FROM leads_mes
       UNION SELECT mes, uid FROM ventas_mes
       UNION SELECT mes, uid FROM cobros_mes
     )
     SELECT t.mes, t.uid AS asesora_id,
            COALESCE(u.nombre, '— sin asesora —') AS asesora,
            COALESCE(lm.leads, 0) AS leads,
            COALESCE(vm.ventas, 0) AS ventas,
            COALESCE(vm.clientes, 0) AS clientes,
            COALESCE(lm.leads_convertidos, 0) AS leads_convertidos,
            -- La tasa va sobre los leads: de los que entraron ese mes, cuantos
            -- acabaron convertidos. Antes se dividia por ventas del mes, y ahi
            -- se colaba quien solo pago una mensualidad.
            CASE WHEN COALESCE(lm.leads, 0) > 0
                 THEN ROUND(COALESCE(lm.leads_convertidos, 0)::numeric * 100 / lm.leads, 1)
                 ELSE 0 END AS tasa_conversion,
            ROUND(COALESCE(vm.vendido, 0), 2) AS vendido,
            ROUND(COALESCE(cm.cobrado, 0), 2) AS cobrado,
            ROUND(COALESCE(cm.cobrado_venta, 0), 2) AS cobrado_venta,
            ROUND(COALESCE(cm.cobrado_cuotas, 0), 2) AS cobrado_cuotas,
            COALESCE(cm.mensualidades, 0) AS mensualidades,
            ROUND(CASE WHEN COALESCE(vm.ventas, 0) > 0
                       THEN COALESCE(vm.vendido, 0) / vm.ventas ELSE 0 END, 2) AS ticket_medio
       FROM todo t
       LEFT JOIN leads_mes  lm ON lm.mes = t.mes AND lm.uid IS NOT DISTINCT FROM t.uid
       LEFT JOIN ventas_mes vm ON vm.mes = t.mes AND vm.uid IS NOT DISTINCT FROM t.uid
       LEFT JOIN cobros_mes cm ON cm.mes = t.mes AND cm.uid IS NOT DISTINCT FROM t.uid
       LEFT JOIN users u ON u.id = t.uid
      ORDER BY t.mes DESC, cobrado DESC`,
    [...fl.params, ...fv.params, ...fc.params]
  );
  return rows;
}

// Panel de Reportes: KPIs comparados con el periodo anterior + serie temporal.
export async function panelReportes({ projectId, from, to }) {
  const desde = from || '2026-01-01';
  const hasta = to || new Date().toISOString().slice(0, 10);
  const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
  // Periodo anterior de la misma longitud, justo antes.
  const finPrev = new Date(new Date(desde).getTime() - 86400000).toISOString().slice(0, 10);
  const iniPrev = new Date(new Date(desde).getTime() - dias * 86400000).toISOString().slice(0, 10);

  // Granularidad: en rangos cortos por dia, luego por semana y al final por mes.
  const grano = dias <= 45 ? 'day' : (dias <= 200 ? 'week' : 'month');

  const pl = projectId ? 'AND l.project_id = $3' : '';
  const pc = projectId ? 'AND c.project_id = $3' : '';
  const par = (a, b) => (projectId ? [a, b, projectId] : [a, b]);

  async function bloque(d, h) {
    const { rows: le } = await query(
      `SELECT COUNT(*)::int AS n FROM leads l
        WHERE ${ENTRY}::date BETWEEN $1 AND $2 ${pl}`, par(d, h));
    const { rows: ve } = await query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(c.importe_total), 0) AS vendido
         FROM conversions c WHERE c.fecha_conversion BETWEEN $1 AND $2 ${pc}`, par(d, h));
    const { rows: co } = await query(
      `SELECT COALESCE(SUM(cp.importe), 0) AS cobrado,
              COALESCE(SUM(cp.importe) FILTER (WHERE NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))), 0) AS de_venta,
              COALESCE(SUM(cp.importe) FILTER (WHERE NOT NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))), 0) AS de_cuotas,
              COUNT(*) FILTER (WHERE NOT NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id))))::int AS n_cuotas
         FROM conversion_payments cp JOIN conversions c ON c.id = cp.conversion_id
        WHERE cp.fecha BETWEEN $1 AND $2 ${pc}`, par(d, h));
    const prospectos = le[0].n;
    const ventas = ve[0].n;
    return {
      prospectos,
      ventas,
      vendido: Number(ve[0].vendido),
      ingresos: Number(co[0].cobrado),
      ingresos_venta: Number(co[0].de_venta),
      ingresos_cuotas: Number(co[0].de_cuotas),
      mensualidades: Number(co[0].n_cuotas || 0),
      tasa: prospectos > 0 ? Number((ventas * 100 / prospectos).toFixed(1)) : 0,
    };
  }

  const actual = await bloque(desde, hasta);
  const previo = await bloque(iniPrev, finPrev);
  // Si el periodo anterior cae antes de que empiecen los datos, la comparativa
  // no dice nada: salen porcentajes de 4000% contra cuatro registros sueltos.
  const comparable = iniPrev >= '2026-01-01';
  const variacion = (a, b) => (comparable && b > 0 ? Number((((a - b) / b) * 100).toFixed(1)) : null);

  // Serie temporal, con los huecos rellenos a cero para que la grafica no mienta.
  const { rows: serie } = await query(
    `WITH periodos AS (
       SELECT generate_series(
                date_trunc('${grano}', $1::date),
                date_trunc('${grano}', $2::date),
                ('1 ${grano}')::interval)::date AS p
     ),
     le AS (
       SELECT date_trunc('${grano}', ${ENTRY})::date AS p, COUNT(*)::int AS n
         FROM leads l WHERE ${ENTRY}::date BETWEEN $1 AND $2 ${pl} GROUP BY 1
     ),
     ve AS (
       SELECT date_trunc('${grano}', c.fecha_conversion)::date AS p, COUNT(*)::int AS n,
              COALESCE(SUM(c.importe_total), 0) AS vendido
         FROM conversions c WHERE c.fecha_conversion BETWEEN $1 AND $2 ${pc} GROUP BY 1
     ),
     co AS (
       SELECT date_trunc('${grano}', cp.fecha)::date AS p, COALESCE(SUM(cp.importe), 0) AS cobrado,
              COALESCE(SUM(cp.importe) FILTER (WHERE NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))), 0) AS de_venta,
              COALESCE(SUM(cp.importe) FILTER (WHERE NOT NOT EXISTS (SELECT 1 FROM conversion_payments p0 WHERE p0.conversion_id = cp.conversion_id AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))), 0) AS de_cuotas
         FROM conversion_payments cp JOIN conversions c ON c.id = cp.conversion_id
        WHERE cp.fecha BETWEEN $1 AND $2 ${pc} GROUP BY 1
     )
     SELECT periodos.p::text AS periodo,
            COALESCE(le.n, 0) AS prospectos,
            COALESCE(ve.n, 0) AS ventas,
            ROUND(COALESCE(ve.vendido, 0), 2) AS vendido,
            ROUND(COALESCE(co.cobrado, 0), 2) AS ingresos,
            ROUND(COALESCE(co.de_venta, 0), 2) AS ingresos_venta,
            ROUND(COALESCE(co.de_cuotas, 0), 2) AS ingresos_cuotas,
            CASE WHEN COALESCE(le.n, 0) > 0
                 THEN ROUND(COALESCE(ve.n, 0)::numeric * 100 / le.n, 1) ELSE 0 END AS tasa
       FROM periodos
       LEFT JOIN le ON le.p = periodos.p
       LEFT JOIN ve ON ve.p = periodos.p
       LEFT JOIN co ON co.p = periodos.p
      ORDER BY periodos.p`,
    par(desde, hasta)
  );

  return {
    rango: { from: desde, to: hasta, dias, grano, comparable },
    kpis: {
      prospectos: { value: actual.prospectos, prev: previo.prospectos, trend: variacion(actual.prospectos, previo.prospectos) },
      ventas:     { value: actual.ventas,     prev: previo.ventas,     trend: variacion(actual.ventas, previo.ventas) },
      vendido:    { value: actual.vendido,    prev: previo.vendido,    trend: variacion(actual.vendido, previo.vendido) },
      ingresos:   { value: actual.ingresos,   prev: previo.ingresos,   trend: variacion(actual.ingresos, previo.ingresos) },
      ingresos_venta:  { value: actual.ingresos_venta,  prev: previo.ingresos_venta,  trend: variacion(actual.ingresos_venta, previo.ingresos_venta) },
      ingresos_cuotas: { value: actual.ingresos_cuotas, prev: previo.ingresos_cuotas, trend: variacion(actual.ingresos_cuotas, previo.ingresos_cuotas) },
      mensualidades:   { value: actual.mensualidades,   prev: previo.mensualidades,   trend: variacion(actual.mensualidades, previo.mensualidades) },
      tasa:       { value: actual.tasa,       prev: previo.tasa,       trend: variacion(actual.tasa, previo.tasa) },
    },
    serie: serie.map((r) => ({
      periodo: r.periodo,
      prospectos: Number(r.prospectos),
      ventas: Number(r.ventas),
      vendido: Number(r.vendido),
      ingresos: Number(r.ingresos),
      ingresos_venta: Number(r.ingresos_venta),
      ingresos_cuotas: Number(r.ingresos_cuotas),
      tasa: Number(r.tasa),
    })),
  };
}

// Pais a partir del prefijo del telefono. leads.pais_fiscal no sirve: tiene
// 'España' por defecto en casi todos los registros, asi que daria 99,9% España
// mientras los telefonos son latinoamericanos.
const PAIS_TEL = `CASE
    WHEN tel = '' OR tel IS NULL THEN '— sin teléfono —'
    -- Norteamérica y Caribe comparten el +1: manda el código de área.
    WHEN tel ~ '^1(809|829|849)[0-9]{7}$' THEN 'República Dominicana'
    WHEN tel ~ '^1868[0-9]{7}$'           THEN 'Trinidad y Tobago'
    WHEN tel ~ '^1(787|939)[0-9]{7}$'     THEN 'Puerto Rico'
    WHEN tel ~ '^1[2-9][0-9]{9}$'         THEN 'EE.UU. / Canadá'
    -- Móviles que llevan un dígito extra tras el prefijo: México el 1, Argentina el 9.
    WHEN tel ~ '^521[0-9]{10}$'      THEN 'México'
    WHEN tel ~ '^52[0-9]{10,11}$'    THEN 'México'
    WHEN tel ~ '^549[0-9]{10,11}$'   THEN 'Argentina'
    WHEN tel ~ '^54[0-9]{10,11}$'    THEN 'Argentina'
    -- Con prefijo internacional y longitud correcta.
    WHEN tel ~ '^34[6-9][0-9]{8}$'   THEN 'España'
    WHEN tel ~ '^57[0-9]{10}$'       THEN 'Colombia'
    WHEN tel ~ '^593[0-9]{8,10}$'    THEN 'Ecuador'
    WHEN tel ~ '^51[0-9]{9}$'        THEN 'Perú'
    WHEN tel ~ '^506[0-9]{8}$'       THEN 'Costa Rica'
    WHEN tel ~ '^507[0-9]{7,11}$'    THEN 'Panamá'
    WHEN tel ~ '^56[0-9]{8,9}$'      THEN 'Chile'
    WHEN tel ~ '^58[0-9]{10}$'       THEN 'Venezuela'
    WHEN tel ~ '^502[0-9]{8}$'       THEN 'Guatemala'
    WHEN tel ~ '^503[0-9]{8}$'       THEN 'El Salvador'
    WHEN tel ~ '^504[0-9]{8}$'       THEN 'Honduras'
    WHEN tel ~ '^505[0-9]{8}$'       THEN 'Nicaragua'
    WHEN tel ~ '^509[0-9]{8}$'       THEN 'Haití'
    WHEN tel ~ '^55[0-9]{10,11}$'    THEN 'Brasil'
    WHEN tel ~ '^591[0-9]{8}$'       THEN 'Bolivia'
    WHEN tel ~ '^595[0-9]{8,9}$'     THEN 'Paraguay'
    WHEN tel ~ '^598[0-9]{8}$'       THEN 'Uruguay'
    WHEN tel ~ '^240[0-9]{9}$'       THEN 'Guinea Ecuatorial'
    WHEN tel ~ '^41[0-9]{9}$'        THEN 'Suiza'
    WHEN tel ~ '^31[0-9]{9}$'        THEN 'Países Bajos'
    WHEN tel ~ '^39[0-9]{9,10}$'     THEN 'Italia'
    WHEN tel ~ '^33[1-9][0-9]{8}$'   THEN 'Francia'
    WHEN tel ~ '^351[0-9]{9}$'       THEN 'Portugal'
    WHEN tel ~ '^44[0-9]{10}$'       THEN 'Reino Unido'
    WHEN tel ~ '^49[0-9]{10,11}$'    THEN 'Alemania'
    WHEN tel ~ '^212[0-9]{9}$'       THEN 'Marruecos'
    -- Guardados sin prefijo internacional. Aquí manda la longitud: un número
    -- nacional mexicano tiene 10 dígitos, uno peruano o chileno tiene 9.
    WHEN tel ~ '^[67][0-9]{8}$'      THEN 'España'    -- móvil español
    WHEN tel ~ '^9[0-9]{8}$'         THEN '— 9 dígitos sin prefijo (Perú o Chile) —'
    WHEN tel ~ '^9[89][0-9]{8}$'     THEN 'México'    -- LADA 98x/99x: Cancún, Playa, Mérida
    WHEN tel ~ '^33[0-9]{8}$'        THEN 'México'    -- LADA 33 Guadalajara
    WHEN tel ~ '^55[0-9]{8}$'        THEN 'México'    -- LADA 55 CDMX
    WHEN tel ~ '^81[0-9]{8}$'        THEN 'México'    -- LADA 81 Monterrey
    WHEN tel ~ '^11[0-9]{8}$'        THEN 'Argentina' -- Buenos Aires
    WHEN tel ~ '^3[0-2][0-9]{8}$'    THEN 'Colombia'  -- móvil 30x/31x/32x
    WHEN tel ~ '^41[24][0-9]{7}$'    THEN 'Venezuela' -- 0412 / 0414 sin el cero
    -- Lo que no se puede decidir se deja a la vista, no se reparte.
    ELSE '— sin prefijo — revisar'
  END`;

export async function paisesMasVendidos({ projectId, from, to }) {
  // Dos fechas distintas otra vez: las ventas por fecha de venta y los leads por
  // fecha de entrada. Se juntan por pais con FULL OUTER JOIN porque hay paises
  // que mandan leads y no compran, y al reves (clientes cargados sin lead).
  const fv = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const fl = buildFilter({ projectId, from, to }, ENTRY, 'l.project_id');
  const off = fv.params.length;
  const wl = fl.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + off));

  const { rows } = await query(
    `WITH v AS (
       SELECT c.id, c.importe_total, c.lead_id,
              (CASE WHEN LENGTH(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '')) > 15 THEN LEFT(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', ''), 11) ELSE regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '') END) AS tel
         FROM conversions c
         LEFT JOIN leads l ON l.id = c.lead_id
         ${fv.where}
     ),
     ventas AS (
       SELECT ${PAIS_TEL} AS pais,
              COUNT(*)::int AS ventas,
              COUNT(DISTINCT v.lead_id)::int AS clientes,
              ROUND(COALESCE(SUM(v.importe_total), 0), 2) AS vendido,
              ROUND(COALESCE(SUM(
                (SELECT COALESCE(SUM(cp.importe), 0)
                   FROM conversion_payments cp WHERE cp.conversion_id = v.id)), 0), 2) AS cobrado
         FROM v GROUP BY 1
     ),
     le AS (
       SELECT (CASE WHEN LENGTH(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '')) > 15 THEN LEFT(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', ''), 11) ELSE regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '') END) AS tel,
              EXISTS (SELECT 1 FROM conversions cvx
                       WHERE cvx.lead_id = l.id
                         AND cvx.fecha_conversion >= ${ENTRY}::date) AS convirtio
         FROM leads l ${wl}
     ),
     lds AS (
       SELECT ${PAIS_TEL} AS pais,
              COUNT(*)::int AS leads,
              COUNT(*) FILTER (WHERE convirtio)::int AS leads_convertidos
         FROM le GROUP BY 1
     )
     SELECT COALESCE(ventas.pais, lds.pais) AS pais,
            COALESCE(lds.leads, 0) AS leads,
            COALESCE(lds.leads_convertidos, 0) AS leads_convertidos,
            CASE WHEN COALESCE(lds.leads, 0) > 0
                 THEN ROUND(COALESCE(lds.leads_convertidos, 0)::numeric * 100 / lds.leads, 1)
                 ELSE 0 END AS tasa_conversion,
            COALESCE(ventas.ventas, 0) AS ventas,
            COALESCE(ventas.clientes, 0) AS clientes,
            COALESCE(ventas.vendido, 0) AS vendido,
            COALESCE(ventas.cobrado, 0) AS cobrado
       FROM ventas
       FULL OUTER JOIN lds ON lds.pais = ventas.pais
      ORDER BY vendido DESC, leads DESC`,
    [...fv.params, ...fl.params]
  );
  return rows;
}

// Formacion de una venta, en tres niveles. El texto libre viene sucio: se le
// quitan los prefijos de 'servicio academico' y de 'pago de mensualidad'.
const FORMACION = `COALESCE(
    pcat.nombre,
    pnom.nombre,
    NULLIF(TRIM(regexp_replace(regexp_replace(regexp_replace(c.producto_contratado,
      '^[[:space:]]*Producto/servicio:[[:space:]]*servicio[[:space:]]+acad[eé]mico[,;]?[[:space:]]*', '', 'i'),
      '^[[:space:]]*pago[[:space:]]+(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|matr[ií]cula)[^,]*[,]?[[:space:]]*', '', 'i'),
      '^[[:space:]]*servicio[[:space:]]+acad[eé]mico[[:space:]]*$', '', 'i')), ''),
    '— sin formación —')`;

export async function formacionesMasVendidas({ projectId, from, to }) {
  const { where, params } = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const { rows } = await query(
    `SELECT ${FORMACION} AS formacion,
            CASE WHEN pcat.id IS NOT NULL THEN 'catálogo'
                 WHEN pnom.id IS NOT NULL THEN 'catálogo (por nombre)'
                 ELSE 'texto libre' END AS origen,
            COUNT(*)::int AS ventas,
            COUNT(DISTINCT c.lead_id)::int AS clientes,
            ROUND(COALESCE(SUM(c.importe_total), 0), 2) AS vendido,
            ROUND(COALESCE(AVG(c.importe_total), 0), 2) AS ticket_medio
       FROM conversions c
       LEFT JOIN products pcat ON pcat.id = c.producto_contratado_id
       LEFT JOIN products pnom ON pnom.project_id = c.project_id
            AND c.producto_contratado_id IS NULL
            AND LOWER(TRIM(pnom.nombre)) = LOWER(TRIM(c.producto_contratado))
       ${where}
      GROUP BY 1, 2
      ORDER BY vendido DESC`,
    params
  );
  return rows;
}

// Detras de cada numero del panel, las filas que lo componen. Es lo que abre el
// popup al pulsar un importe o un contador.
export async function detalleMetrica({ projectId, from, to, tipo, asesoraId, mes, pais, formacion, limite }) {
  // El popup se conforma con 500; una descarga quiere todas las filas.
  const TOPE = Math.min(Math.max(Number(limite) || 500, 1), 20000);
  const cond = [];
  const params = [];
  let idx = 1;
  const add = (sql, val) => { cond.push(sql.replace('?', `$${idx++}`)); params.push(val); };

  // El mes acota por encima del rango: es el que se pulsa en la tabla.
  const desde = mes ? `${mes}-01` : (from || '2026-01-01');
  const hasta = mes ? `${mes}-01` : (to || new Date().toISOString().slice(0, 10));
  const finMes = mes ? `(DATE '${mes}-01' + INTERVAL '1 month' - INTERVAL '1 day')::date` : null;

  if (tipo === 'leads' || tipo === 'leads-convertidos') {
    if (projectId) add('l.project_id = ?', projectId);
    // 'convertidos' son los leads DE ESE PERIODO que acabaron comprando; no la
    // gente que ese mes pago una mensualidad de algo que compro antes.
    if (tipo === 'leads-convertidos') {
      cond.push(`EXISTS (SELECT 1 FROM conversions cvx WHERE cvx.lead_id = l.id
                          AND cvx.fecha_conversion >= ${ENTRY}::date)`);
    }
    add(`${ENTRY}::date >= ?`, desde);
    cond.push(finMes ? `${ENTRY}::date <= ${finMes}` : `${ENTRY}::date <= $${idx++}`);
    if (!finMes) params.push(hasta);
    if (asesoraId === 'sin') cond.push('l.responsable_id IS NULL');
    else if (asesoraId) add('COALESCE(l.responsable_id, (SELECT cv.vendedora_id FROM conversions cv WHERE cv.lead_id = l.id AND cv.vendedora_id IS NOT NULL ORDER BY cv.fecha_conversion LIMIT 1)) = ?', Number(asesoraId));
    const { rows } = await query(
      `SELECT l.id, l.nombre AS cliente, l.email, l.telefono, l.status AS estado,
              ${ENTRY}::date AS fecha,
              COALESCE(u.nombre, '— sin asesora —') AS asesora,
              (SELECT ${PAIS_TEL} FROM (SELECT (CASE WHEN LENGTH(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '')) > 15 THEN LEFT(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', ''), 11) ELSE regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '') END) AS tel) _t) AS pais,
              EXISTS (SELECT 1 FROM conversions cvx WHERE cvx.lead_id = l.id
                       AND cvx.fecha_conversion >= ${ENTRY}::date) AS convirtio,
              (SELECT COUNT(*) FROM conversions cv WHERE cv.lead_id = l.id)::int AS ventas
         FROM leads l
         LEFT JOIN users u ON u.id = l.responsable_id
        WHERE ${cond.join(' AND ')}
        ORDER BY fecha DESC, l.id DESC
        LIMIT ${TOPE}`, params);
    return rows;
  }

  if (tipo === 'ventas') {
    if (projectId) add('c.project_id = ?', projectId);
    add('c.fecha_conversion >= ?', desde);
    cond.push(finMes ? `c.fecha_conversion <= ${finMes}` : `c.fecha_conversion <= $${idx++}`);
    if (!finMes) params.push(hasta);
    if (asesoraId === 'sin') cond.push('COALESCE(c.vendedora_id, l.responsable_id) IS NULL');
    else if (asesoraId) add('COALESCE(c.vendedora_id, l.responsable_id) = ?', Number(asesoraId));
    // Placeholder explicito: FORMACION lleva '?' dentro de sus regex y add()
    // sustituiria el primero, que no es el nuestro.
    if (formacion) { cond.push(`${FORMACION} = $${idx++}`); params.push(formacion); }
    // El pais sale del prefijo del telefono, igual que en el ranking. PAIS_TEL
    // espera una columna 'tel', asi que se la damos con una subconsulta en vez
    // de reescribir el SQL a mano.
    if (pais) {
      cond.push(`(SELECT ${PAIS_TEL} FROM (SELECT (CASE WHEN LENGTH(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '')) > 15 THEN LEFT(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', ''), 11) ELSE regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '') END) AS tel) _t) = $${idx++}`);
      params.push(pais);
    }
    const { rows } = await query(
      `SELECT c.id, l.nombre AS cliente, l.email, l.telefono,
              c.fecha_conversion AS fecha,
              ${FORMACION_CON_FACTURA} AS formacion,
              ${ES_MENSUALIDAD} AS es_mensualidad,
              ROUND(c.importe_total, 2) AS importe,
              -- De los cobros reales, NO de c.importe_pagado: ese campo declara
              -- 240.502,95 EUR de mas en 2026 y enseñaba cobros donde no los hay.
              ROUND(COALESCE((SELECT SUM(cp2.importe) FROM conversion_payments cp2
                               WHERE cp2.conversion_id = c.id), 0), 2) AS cobrado,
              COALESCE(u.nombre, '— sin asesora —') AS asesora,
              (SELECT ${PAIS_TEL} FROM (SELECT (CASE WHEN LENGTH(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '')) > 15 THEN LEFT(regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', ''), 11) ELSE regexp_replace(regexp_replace(COALESCE(l.telefono, ''), '[^0-9]', '', 'g'), '^00', '') END) AS tel) _t) AS pais,
              (SELECT COUNT(*) FROM conversion_payments cp WHERE cp.conversion_id = c.id)::int AS cobros,
              (SELECT COUNT(*) FROM conversions c0 WHERE c0.lead_id = c.lead_id
                 AND c0.fecha_conversion < c.fecha_conversion)::int AS ventas_previas,
              (SELECT string_agg(i.codigo, ', ' ORDER BY i.numero) FROM invoices i
                WHERE i.conversion_id = c.id AND i.estado <> 'cancelada') AS facturas
         FROM conversions c
         LEFT JOIN leads l ON l.id = c.lead_id
         LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
         LEFT JOIN products pcat ON pcat.id = c.producto_contratado_id
         LEFT JOIN products pnom ON pnom.project_id = c.project_id
              AND c.producto_contratado_id IS NULL
              AND LOWER(TRIM(pnom.nombre)) = LOWER(TRIM(c.producto_contratado))
        WHERE ${cond.join(' AND ')}
        ORDER BY c.fecha_conversion DESC, c.id DESC
        LIMIT ${TOPE}`, params);
    return rows;
  }

  // cobros y mensualidades comparten consulta; cambia el filtro.
  if (projectId) add('c.project_id = ?', projectId);
  add('cp.fecha >= ?', desde);
  cond.push(finMes ? `cp.fecha <= ${finMes}` : `cp.fecha <= $${idx++}`);
  if (!finMes) params.push(hasta);
  if (asesoraId === 'sin') cond.push('COALESCE(c.vendedora_id, l.responsable_id) IS NULL');
  else if (asesoraId) add('COALESCE(c.vendedora_id, l.responsable_id) = ?', Number(asesoraId));
  const ES_PRIMERO = `NOT EXISTS (SELECT 1 FROM conversion_payments p0
      WHERE p0.conversion_id = cp.conversion_id
        AND (p0.fecha < cp.fecha OR (p0.fecha = cp.fecha AND p0.id < cp.id)))`;
  if (tipo === 'mensualidades') cond.push(`NOT (${ES_PRIMERO})`);
  if (tipo === 'cobros-venta') cond.push(ES_PRIMERO);

  const { rows } = await query(
    `SELECT cp.id, l.nombre AS cliente, l.email, cp.fecha,
            ROUND(cp.importe, 2) AS importe,
            COALESCE(cp.metodo, '—') AS metodo,
            LEFT(COALESCE(cp.notas, ''), 60) AS notas,
            COALESCE(u.nombre, '— sin asesora —') AS asesora,
            c.id AS venta, c.fecha_conversion AS fecha_venta,
            LEFT(COALESCE(c.producto_contratado, ''), 46) AS formacion,
            (SELECT ci.numero FROM conversion_installments ci WHERE ci.payment_id = cp.id LIMIT 1) AS cuota,
            (SELECT i.codigo FROM invoices i WHERE i.payment_id = cp.id AND i.estado <> 'cancelada' LIMIT 1) AS factura,
            (${ES_PRIMERO}) AS es_primer_cobro
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
      WHERE ${cond.join(' AND ')}
      ORDER BY cp.fecha DESC, cp.id DESC
      LIMIT ${TOPE}`, params);
  return rows;
}

// Lo que dice la factura, limpio. Se le quitan los prefijos de relleno
// ("Producto/servicio:", "servicio academico", "pago mensualidad 6,") hasta
// dejar el nombre del curso, si es que hay uno debajo.
const DESC_FACTURA = `(
    SELECT NULLIF(TRIM(BOTH ' .,;-' FROM regexp_replace(regexp_replace(regexp_replace(
             string_agg(DISTINCT it->>'descripcion', ' '),
             'Producto/servicio:', '', 'gi'),
             'servicio[[:space:]]*acad[eé]mico', '', 'gi'),
             '^[[:space:].,;]*pago[[:space:]]*(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|plazo|matr[ií]cula)?[[:space:]]*[0-9]*', '', 'i')), '')
      FROM invoices i_f, jsonb_array_elements(i_f.items) it
     WHERE i_f.conversion_id = c.id AND i_f.estado <> 'cancelada')`;

// Formacion con la factura como ultimo recurso antes de rendirse.
const FORMACION_CON_FACTURA = `COALESCE(
    pcat.nombre,
    pnom.nombre,
    NULLIF(TRIM(regexp_replace(regexp_replace(regexp_replace(c.producto_contratado,
      '^[[:space:]]*Producto/servicio:[[:space:]]*servicio[[:space:]]+acad[eé]mico[,;]?[[:space:]]*', '', 'i'),
      '^[[:space:]]*pago[[:space:]]+(de[[:space:]]+)?(la[[:space:]]+)?(mensualidad|cuota|matr[ií]cula)[^,]*[,]?[[:space:]]*', '', 'i'),
      '^[[:space:]]*servicio[[:space:]]+acad[eé]mico[[:space:]]*$', '', 'i')), ''),
    ${DESC_FACTURA},
    '— sin formación —')`;

// Si el registro es en realidad el cobro de una mensualidad y no una venta nueva.
// No basta con que la factura diga "mensualidad": una venta con plan de pago tiene
// facturas que lo dicen y sigue siendo una venta. Tiene que ademas NO tener plan
// de cuotas y como mucho un cobro.
const ES_MENSUALIDAD = `(
    COALESCE(c.producto_contratado, '') ~* '(mensualidad|cuota)[[:space:]]*[0-9]'
    OR (
      ${DESC_FACTURA} IS NOT NULL
      AND (SELECT string_agg(it2->>'descripcion', ' ') FROM invoices i_m,
            jsonb_array_elements(i_m.items) it2
           WHERE i_m.conversion_id = c.id AND i_m.estado <> 'cancelada')
          ~* '(mensualidad|cuota|plazo)[[:space:]]*[0-9]'
      AND NOT EXISTS (SELECT 1 FROM conversion_installments ci WHERE ci.conversion_id = c.id)
      AND (SELECT COUNT(*) FROM conversion_payments cpm WHERE cpm.conversion_id = c.id) <= 1
    ))`;
