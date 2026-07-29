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
            l.created_at::date AS fecha_entrada,
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
  const fl = buildFilter({ projectId, from, to }, 'l.created_at', 'l.project_id');
  const fv = buildFilter({ projectId, from, to }, 'c.fecha_conversion', 'c.project_id');
  const fc = buildFilter({ projectId, from, to }, 'cp.fecha', 'c.project_id');
  const off1 = fl.params.length;
  const off2 = off1 + fv.params.length;
  const wv = fv.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + off1));
  const wc = fc.where.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + off2));

  const { rows } = await query(
    `WITH leads_mes AS (
       SELECT to_char(date_trunc('month', l.created_at), 'YYYY-MM') AS mes,
              l.responsable_id AS uid,
              COUNT(*)::int AS leads,
              COUNT(*) FILTER (WHERE l.status = 'convertido')::int AS leads_convertidos
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
              COALESCE(SUM(cp.importe), 0) AS cobrado
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
     SELECT t.mes,
            COALESCE(u.nombre, '— sin asesora —') AS asesora,
            COALESCE(lm.leads, 0) AS leads,
            COALESCE(vm.ventas, 0) AS ventas,
            COALESCE(vm.clientes, 0) AS clientes,
            CASE WHEN COALESCE(lm.leads, 0) > 0
                 THEN ROUND(COALESCE(vm.ventas, 0)::numeric * 100 / lm.leads, 1)
                 ELSE 0 END AS tasa_conversion,
            ROUND(COALESCE(vm.vendido, 0), 2) AS vendido,
            ROUND(COALESCE(cm.cobrado, 0), 2) AS cobrado,
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
