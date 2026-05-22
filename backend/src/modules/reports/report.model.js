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
