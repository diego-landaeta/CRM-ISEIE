import { query } from '../../shared/config/db.js';

/*
  EL EMBUDO DE LOS LINKS DE PAGO (CRM#987; Diego, 21/11/2026).

  «En "Links de pago", un resumen por gestora y por campus para el periodo
  elegido: links creados, abiertos y pagados, con el % de conversión y el importe
  cobrado; en las cuotas, cuántas se cobraron solas, cuántas fallaron y cuántas
  siguen pendientes.»

  Qué cuenta cada cifra:
    · creados: los links creados en el periodo (por su `created_at`, hora de Madrid);
    · abiertos: de esos, los que el alumno llegó a abrir (con `abierto_el`, 311) o
      que ya se pagaron, que también se abrieron;
    · pagados: de esos, los pagados (o pagados en parte);
    · % abiertos y % pagados, sobre los creados;
    · cobrado: lo que entró por esos links (cargos de Stripe `succeeded` atados al
      link), en euros, que es como guarda el CRM cada cobro, menos lo devuelto;
    · cuotas: las del cobro automático (309) que vencen en el periodo —cobradas
      solas, fallidas y pendientes (programadas)—, de la venta de cada gestora
      (`vendedora_id`; sin ella, la responsable de la ficha, como en el resto de
      informes) y de cada campus. Las quitadas no cuentan.

  El recorte llega hecho del controlador: `projectIds` (los campus de quien pide,
  con `campusParaRecortar`) y `creadores` (null = cualquiera; una lista = solo
  los links y las ventas de esas personas).
*/

const ZONA = 'Europe/Madrid';

export async function embudo({ projectIds, creadores = null, desde, hasta }) {
  const params = [projectIds, desde, hasta, creadores];
  const links = await query(
    `WITH l AS (
       SELECT pl.id, pl.project_id, pl.created_by,
              (pl.abierto_el IS NOT NULL OR pl.estado IN ('abierto', 'pagado', 'pagado_parcial')) AS abierto,
              (pl.estado IN ('pagado', 'pagado_parcial')) AS pagado
         FROM payment_links pl
        WHERE pl.project_id = ANY($1::int[])
          AND (pl.created_at AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date
          AND ($4::int[] IS NULL OR pl.created_by = ANY($4::int[]))
     ), cobrado AS (
       -- Lo devuelto no es cobrado: sin importe apuntado, una devolución es entera.
       SELECT sp.payment_link_id AS id,
              SUM(sp.amount - COALESCE(sp.refunded_amount, CASE WHEN sp.refunded THEN sp.amount ELSE 0 END)) AS importe
         FROM stripe_payments sp
        WHERE sp.payment_link_id IN (SELECT id FROM l) AND sp.status = 'succeeded'
        GROUP BY sp.payment_link_id
     )
     SELECT l.project_id, p.nombre AS campus, l.created_by, u.nombre AS gestora,
            COUNT(*)::int AS creados,
            COUNT(*) FILTER (WHERE l.abierto)::int AS abiertos,
            COUNT(*) FILTER (WHERE l.pagado)::int AS pagados,
            COALESCE(SUM(c.importe), 0)::float8 AS cobrado
       FROM l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.created_by
       LEFT JOIN cobrado c ON c.id = l.id
      GROUP BY l.project_id, p.nombre, l.created_by, u.nombre`,
    params);

  const cuotas = await query(
    `SELECT ca.project_id, p.nombre AS campus, COALESCE(cv.vendedora_id, ld.responsable_id) AS created_by, u.nombre AS gestora,
            COUNT(*) FILTER (WHERE ca.estado = 'cobrada')::int AS cobradas,
            COUNT(*) FILTER (WHERE ca.estado = 'fallida')::int AS fallidas,
            COUNT(*) FILTER (WHERE ca.estado = 'programada')::int AS pendientes
       FROM cobro_auto_cuotas ca
       JOIN conversion_installments ci ON ci.id = ca.installment_id
       JOIN conversions cv ON cv.id = ca.conversion_id
       LEFT JOIN leads ld ON ld.id = cv.lead_id
       JOIN projects p ON p.id = ca.project_id
       LEFT JOIN users u ON u.id = COALESCE(cv.vendedora_id, ld.responsable_id)
      WHERE ca.project_id = ANY($1::int[])
        AND ca.estado <> 'quitada'
        AND COALESCE(ca.fecha_programada, ci.fecha_vencimiento) BETWEEN $2::date AND $3::date
        AND ($4::int[] IS NULL OR COALESCE(cv.vendedora_id, ld.responsable_id) = ANY($4::int[]))
      GROUP BY ca.project_id, p.nombre, COALESCE(cv.vendedora_id, ld.responsable_id), u.nombre`,
    params);

  return agrupar(links.rows, cuotas.rows);
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const redondear = (n) => Math.round(Number(n || 0) * 100) / 100;
const vacio = () => ({ creados: 0, abiertos: 0, pagados: 0, cobrado: 0, cuotas_cobradas: 0, cuotas_fallidas: 0, cuotas_pendientes: 0 });

function sumar(fila, r) {
  fila.creados += r.creados || 0;
  fila.abiertos += r.abiertos || 0;
  fila.pagados += r.pagados || 0;
  fila.cobrado += Number(r.cobrado || 0);
  fila.cuotas_cobradas += r.cobradas || 0;
  fila.cuotas_fallidas += r.fallidas || 0;
  fila.cuotas_pendientes += r.pendientes || 0;
}

function acabar(fila) {
  return {
    ...fila,
    cobrado: redondear(fila.cobrado),
    pct_abiertos: pct(fila.abiertos, fila.creados),
    pct_pagados: pct(fila.pagados, fila.creados),
  };
}

/** Las filas de la base, por gestora, por campus y el total. Exportada para las pruebas. */
export function agrupar(links, cuotas) {
  const porGestora = new Map();
  const porCampus = new Map();
  const total = vacio();
  const meter = (r) => {
    const g = r.created_by == null ? 'sin' : String(r.created_by);
    if (!porGestora.has(g)) porGestora.set(g, { user_id: r.created_by ?? null, nombre: r.gestora || 'Sin gestora', ...vacio() });
    sumar(porGestora.get(g), r);
    const c = String(r.project_id);
    if (!porCampus.has(c)) porCampus.set(c, { project_id: Number(r.project_id), nombre: r.campus, ...vacio() });
    sumar(porCampus.get(c), r);
    sumar(total, r);
  };
  links.forEach(meter);
  cuotas.forEach(meter);
  const orden = (a, b) => b.creados - a.creados || b.cobrado - a.cobrado || String(a.nombre).localeCompare(String(b.nombre), 'es');
  return {
    total: acabar(total),
    por_gestora: [...porGestora.values()].map(acabar).sort(orden),
    por_campus: [...porCampus.values()].map(acabar).sort(orden),
  };
}
