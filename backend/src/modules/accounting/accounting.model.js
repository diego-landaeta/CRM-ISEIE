import { query } from '../../shared/config/db.js';
import { condicionDeAmbito } from '../expenses/expense.model.js';
import { comoLista } from '../../shared/utils/ambito.js';

// ============================================================
// DASHBOARD ACCOUNTING
// ============================================================

export async function getDashboardStats({ projectId, projectIds = null, from, to }) {
  // Un campus o los de una sociedad: aqui dentro son lo mismo, una lista.
  // Antes solo se sabia acotar a UNO, asi que con varios puestos la pantalla
  // pedia el proyecto -1 --el «todos» del navegador-- y el servidor contestaba
  // «Number must be greater than 0»: el panel salia en blanco.
  const ids = comoLista(projectId, projectIds);
  const projFilter = ids ? 'AND c.project_id = ANY($1::int[])' : '';
  const dateStart = from || '1970-01-01';
  const dateEnd = to || '2999-12-31';
  const params = ids ? [ids, dateStart, dateEnd] : [dateStart, dateEnd];
  const fromIdx = ids ? 2 : 1;
  const toIdx = ids ? 3 : 2;

  // Ingresos (via conversion_payments en rango)
  const paymentsProjFilter = projFilter;
  const { rows: ingresosRows } = await query(
    `SELECT
       COALESCE(SUM(cp.importe), 0) AS total_cobrado,
       COUNT(DISTINCT cp.id) AS num_pagos
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     WHERE cp.fecha BETWEEN $${fromIdx} AND $${toIdx} ${paymentsProjFilter}`,
    params
  );

  // Facturado (total conversions en rango)
  const convProjFilter = projFilter;
  const { rows: facturadoRows } = await query(
    `SELECT
       COALESCE(SUM(c.importe_total), 0) AS total_facturado,
       COALESCE(SUM(c.importe_total - c.importe_pagado), 0) AS total_pendiente,
       COUNT(*) AS num_conversiones
     FROM conversions c
     WHERE c.fecha_conversion BETWEEN $${fromIdx} AND $${toIdx} ${convProjFilter}`,
    params
  );

  // Facturado de verdad: lo que se ha emitido con numero fiscal en el rango.
  // (lo de arriba es lo CONTRATADO, que casi nunca coincide con lo facturado)
  const invProjFilter = ids ? 'AND i.project_id = ANY($1::int[])' : '';
  const { rows: emitidoRows } = await query(
    `SELECT
       COALESCE(SUM(i.total), 0) AS total_emitido,
       COUNT(*) AS num_facturas,
       COUNT(*) FILTER (WHERE i.tipo = 'proforma') AS num_proformas,
       COALESCE(SUM(i.total) FILTER (WHERE i.tipo = 'proforma'), 0) AS total_proformas
     FROM invoices i
     WHERE i.estado NOT IN ('borrador', 'cancelada')
       AND i.fecha_emision BETWEEN $${fromIdx} AND $${toIdx} ${invProjFilter}`,
    params
  );

  // Egresos. Que gasto entra en el ambito lo decide el modulo de egresos
  // (`condicionDeAmbito`): los del campus, los de su EMPRESA y los generales.
  // La misma regla que su listado, para que las dos pantallas den la misma cifra.
  const expProjFilter = ids ? `AND ${condicionDeAmbito('e', 1)}` : '';
  const { rows: egresosRows } = await query(
    `SELECT
       COALESCE(SUM(e.importe), 0) AS total_egresos,
       COUNT(*) AS num_egresos
     FROM expenses e
     WHERE e.fecha BETWEEN $${fromIdx} AND $${toIdx} ${expProjFilter}`,
    params
  );

  // Cuentas por cobrar (conversions con pendiente, ordenadas por vencimiento)
  const { rows: receivables } = await query(
    `SELECT c.id, c.lead_id, c.producto_contratado,
            c.importe_total, c.importe_pagado,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            c.fecha_compromiso_pago,
            c.fecha_conversion,
            l.nombre as lead_nombre, l.email as lead_email,
            p.nombre as proyecto_nombre,
            CASE
              WHEN c.fecha_compromiso_pago IS NOT NULL AND c.fecha_compromiso_pago < CURRENT_DATE THEN true
              ELSE false
            END AS vencido
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.importe_pagado < c.importe_total ${convProjFilter}
     ORDER BY c.fecha_compromiso_pago ASC NULLS LAST
     LIMIT 50`,
    ids ? [ids] : []
  );

  // Totales REALES de por cobrar: el listado de arriba va con LIMIT 50, asi que
  // contar sobre el sale mal en cuanto hay mas de 50 pendientes.
  const { rows: recTotals } = await query(
    `SELECT COUNT(*)::int AS num,
            COALESCE(SUM(c.importe_total - c.importe_pagado), 0) AS total,
            COALESCE(SUM(CASE WHEN c.fecha_compromiso_pago IS NOT NULL
                               AND c.fecha_compromiso_pago < CURRENT_DATE
                              THEN c.importe_total - c.importe_pagado ELSE 0 END), 0) AS total_vencido,
            COUNT(*) FILTER (WHERE c.fecha_compromiso_pago IS NOT NULL
                               AND c.fecha_compromiso_pago < CURRENT_DATE)::int AS num_vencido
     FROM conversions c
     WHERE c.importe_pagado < c.importe_total ${convProjFilter}`,
    ids ? [ids] : []
  );

  // Evolucion mensual ultimos 12 meses
  const trendProjFilter = ids ? 'AND project_id = ANY($1::int[])' : '';
  const trendParams = ids ? [ids] : [];
  const { rows: ingresosTrend } = await query(
    `SELECT to_char(date_trunc('month', cp.fecha), 'YYYY-MM') AS mes,
            COALESCE(SUM(cp.importe), 0) AS total
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     WHERE cp.fecha >= CURRENT_DATE - INTERVAL '12 months' ${trendProjFilter.replace('project_id', 'c.project_id')}
     GROUP BY 1
     ORDER BY 1`,
    trendParams
  );
  const { rows: egresosTrend } = await query(
    `SELECT to_char(date_trunc('month', e.fecha), 'YYYY-MM') AS mes,
            COALESCE(SUM(e.importe), 0) AS total
     FROM expenses e
     WHERE e.fecha >= CURRENT_DATE - INTERVAL '12 months' ${expProjFilter}
     GROUP BY 1
     ORDER BY 1`,
    trendParams
  );

  // Egresos por categoria
  const { rows: porCategoria } = await query(
    `SELECT categoria, COALESCE(SUM(importe), 0) AS total
     FROM expenses e
     WHERE e.fecha BETWEEN $${fromIdx} AND $${toIdx} ${expProjFilter}
     GROUP BY categoria
     ORDER BY total DESC`,
    params
  );

  return {
    ingresos: {
      total_cobrado: Number(ingresosRows[0].total_cobrado),
      total_facturado: Number(facturadoRows[0].total_facturado),
      total_pendiente: Number(facturadoRows[0].total_pendiente),
      num_pagos: parseInt(ingresosRows[0].num_pagos),
      num_conversiones: parseInt(facturadoRows[0].num_conversiones),
      total_emitido: Number(emitidoRows[0].total_emitido),
      num_facturas: parseInt(emitidoRows[0].num_facturas),
      num_proformas: parseInt(emitidoRows[0].num_proformas),
      total_proformas: Number(emitidoRows[0].total_proformas),
    },
    egresos: {
      total: Number(egresosRows[0].total_egresos),
      num_egresos: parseInt(egresosRows[0].num_egresos),
      por_categoria: porCategoria.map(r => ({ categoria: r.categoria, total: Number(r.total) })),
    },
    balance: Number(ingresosRows[0].total_cobrado) - Number(egresosRows[0].total_egresos),
    cuentas_por_cobrar: receivables.map(r => ({ ...r, importe_pendiente: Number(r.importe_pendiente) })),
    cuentas_por_cobrar_resumen: {
      num: recTotals[0].num,
      total: Number(recTotals[0].total),
      num_vencido: recTotals[0].num_vencido,
      total_vencido: Number(recTotals[0].total_vencido),
    },
    trend: {
      ingresos: ingresosTrend.map(r => ({ mes: r.mes, total: Number(r.total) })),
      egresos: egresosTrend.map(r => ({ mes: r.mes, total: Number(r.total) })),
    },
  };
}

// ============================================================
// CUENTAS POR COBRAR (con filtros gestora / proyecto / periodo)
// Unifica: cuotas pendientes (conversion_installments) + ventas pendientes sin
// plan de cuotas (importe pendiente de la conversión). Cada fila trae su fecha de
// vencimiento, cliente, producto, proyecto y gestora responsable.
// ============================================================
export async function getReceivable({ projectId = null, responsableId = null, from = null, to = null } = {}) {
  const conds = [];
  const params = [];
  let i = 1;
  if (projectId)     { conds.push(`c.project_id = $${i++}`); params.push(projectId); }
  // Una o varias (el equipo de una administradora, 09/11/2026).
  if (responsableId) { conds.push(`l.responsable_id = ANY($${i++}::int[])`); params.push([].concat(responsableId).map(Number)); }
  const extra = conds.length ? ' AND ' + conds.join(' AND ') : '';
  // Rango de vencimiento (opcional). Se aplica a la fecha de cada fila (vence).
  const fromCond = from ? ` AND vence >= $${i++}` : '';
  if (from) params.push(from);
  const toCond = to ? ` AND vence <= $${i++}` : '';
  if (to) params.push(to);

  const sql = `
    WITH filas AS (
      -- Cuotas pendientes
      SELECT 'cuota'::text AS tipo, ci.id AS ref_id, c.id AS conversion_id, c.lead_id,
             l.nombre AS cliente, l.email AS cliente_email,
             c.producto_contratado AS producto,
             c.project_id, p.nombre AS proyecto_nombre,
             l.responsable_id, u.nombre AS gestora_nombre,
             ci.numero AS cuota_numero,
             ci.importe_previsto::numeric AS importe,
             ci.fecha_vencimiento AS vence
        FROM conversion_installments ci
        JOIN conversions c ON c.id = ci.conversion_id
        LEFT JOIN leads l ON l.id = c.lead_id
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN users u ON u.id = l.responsable_id
       WHERE ci.fecha_cobro IS NULL${extra}
      UNION ALL
      -- Ventas pendientes SIN cuotas pendientes (pago único / compromiso)
      SELECT 'venta'::text AS tipo, c.id AS ref_id, c.id AS conversion_id, c.lead_id,
             l.nombre AS cliente, l.email AS cliente_email,
             c.producto_contratado AS producto,
             c.project_id, p.nombre AS proyecto_nombre,
             l.responsable_id, u.nombre AS gestora_nombre,
             NULL::int AS cuota_numero,
             (c.importe_total - c.importe_pagado)::numeric AS importe,
             c.fecha_compromiso_pago AS vence
        FROM conversions c
        LEFT JOIN leads l ON l.id = c.lead_id
        LEFT JOIN projects p ON p.id = c.project_id
        LEFT JOIN users u ON u.id = l.responsable_id
       WHERE c.importe_pagado < c.importe_total
         AND NOT EXISTS (SELECT 1 FROM conversion_installments ci2 WHERE ci2.conversion_id = c.id AND ci2.fecha_cobro IS NULL)${extra}
    )
    SELECT *, (vence IS NOT NULL AND vence < CURRENT_DATE) AS vencido
      FROM filas
     WHERE importe > 0${fromCond}${toCond}
     ORDER BY vence ASC NULLS LAST, importe DESC`;

  const { rows } = await query(sql, params);

  // Gestoras presentes en el resultado (para el filtro del panel admin).
  const gestoras = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.responsable_id && !seen.has(r.responsable_id)) { seen.add(r.responsable_id); gestoras.push({ id: r.responsable_id, nombre: r.gestora_nombre || 'Sin asignar' }); }
  }
  const totalPendiente = rows.reduce((s, r) => s + Number(r.importe || 0), 0);
  const totalVencido = rows.filter(r => r.vencido).reduce((s, r) => s + Number(r.importe || 0), 0);

  return {
    items: rows.map(r => ({ ...r, importe: Number(r.importe) })),
    gestoras: gestoras.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
    resumen: {
      total_pendiente: totalPendiente,
      total_vencido: totalVencido,
      count: rows.length,
      count_vencidas: rows.filter(r => r.vencido).length,
    },
  };
}
