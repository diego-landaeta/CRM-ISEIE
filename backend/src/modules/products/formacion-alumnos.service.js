import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { COBRADO_DE } from '../conversions/cobrado.js';
import {
  TIPOS, alumnosDeVentas, hoyEnMadrid, ordenarAlumnos, reglaDelCampus, resumenDeAlumnos,
} from './formacion-alumnos.reglas.js';

/**
 * Formaciones · alumnos activos (CRM-ISEIE#767, gemela de CRM#1113): lo que lee de la base.
 * Las reglas (quién es activo, hasta cuándo, cómo va de pagos) están en
 * `formacion-alumnos.reglas.js`; aquí solo se traen las ventas.
 *
 * Todo se cuenta con subconsultas y EXISTS, nunca con un JOIN a las cuotas, las
 * líneas o el reparto: cada venta sale UNA vez (ver feedback «JOIN multiplica»).
 *
 * El alcance por persona es el de Ventas (`alcanceComercial`): la gestora, solo
 * sus ventas (las que lleva en el reparto); quien lleva un equipo, las de su
 * equipo; admin y soporte, todas. `alcance` = null (todas) o la lista de ids.
 */

/** La regla de acceso del campus. Sin la migración 340 (329 en el 360), la de serie. */
export async function reglaDeAcceso(projectId) {
  try {
    const { rows: [p] } = await query('SELECT acceso_alumnos_meses FROM projects WHERE id = $1', [projectId]);
    return reglaDelCampus(p?.acceso_alumnos_meses);
  } catch (err) {
    if (err?.code === '42703') return reglaDelCampus(null);
    throw err;
  }
}

/** Guarda la regla de acceso del campus. `null` en un tipo = la de serie. */
export async function guardarReglaDeAcceso(projectId, regla, { userId = null, ip = null } = {}) {
  const guardar = {};
  for (const t of TIPOS) if (regla[t] != null) guardar[t] = regla[t];
  const valor = Object.keys(guardar).length ? JSON.stringify(guardar) : null;
  await query('UPDATE projects SET acceso_alumnos_meses = $1::jsonb, updated_at = NOW() WHERE id = $2', [valor, projectId]);
  if (userId) {
    await query(
      'INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)',
      [userId, 'products.acceso_alumnos', JSON.stringify({ project_id: projectId, regla: guardar }), ip || null]
    );
  }
  return reglaDeAcceso(projectId);
}

/*
  Las ventas que llevan alguno de los productos, con lo que hace falta para
  decidir. `$1` = ids de producto; `$2` = alcance (ids de gestora) o NULL.

  · anulada: tiene alguna factura anulada (con su abono) o cancelada y ninguna
    vigente. Una venta sin facturas no está anulada.
  · devuelto: lo apuntado en Devoluciones (`conversion_refunds`).
  · cuota_vencida / cuota_pendiente / con_cuotas: de `conversion_installments`.
  · gestora: las del reparto, como en Ventas.
*/
const VENTAS_SQL = `
  SELECT c.id, c.lead_id, c.fecha_conversion, c.fecha_inicio, c.importe_total,
         c.fecha_compromiso_pago, c.suscripcion_estado,
         ${COBRADO_DE('c')} AS cobrado,
         (SELECT COALESCE(SUM(r.importe), 0) FROM conversion_refunds r WHERE r.conversion_id = c.id) AS devuelto,
         EXISTS (SELECT 1 FROM conversion_installments i WHERE i.conversion_id = c.id) AS con_cuotas,
         EXISTS (SELECT 1 FROM conversion_installments i
                  WHERE i.conversion_id = c.id AND i.fecha_cobro IS NULL
                    AND i.fecha_vencimiento < $3::date) AS cuota_vencida,
         EXISTS (SELECT 1 FROM conversion_installments i
                  WHERE i.conversion_id = c.id AND i.fecha_cobro IS NULL) AS cuota_pendiente,
         (EXISTS (SELECT 1 FROM invoices f
                   WHERE f.conversion_id = c.id AND f.tipo <> 'rectificativa'
                     AND (f.anulada_at IS NOT NULL OR f.estado = 'cancelada'))
          AND NOT EXISTS (SELECT 1 FROM invoices f
                   WHERE f.conversion_id = c.id AND f.tipo <> 'rectificativa'
                     AND f.anulada_at IS NULL AND f.estado NOT IN ('cancelada', 'borrador'))) AS anulada,
         l.nombre AS alumno, l.email,
         (SELECT string_agg(DISTINCT u.nombre, ', ')
            FROM conversion_reparto r JOIN users u ON u.id = r.vendedora_id
           WHERE r.conversion_id = c.id) AS gestora,
         ARRAY(SELECT DISTINCT x.pid FROM (
                 SELECT c.producto_contratado_id AS pid
                 UNION SELECT ci.product_id FROM conversion_items ci WHERE ci.conversion_id = c.id
               ) x WHERE x.pid = ANY($1::int[])) AS productos
    FROM conversions c
    LEFT JOIN leads l ON l.id = c.lead_id
   WHERE (c.producto_contratado_id = ANY($1::int[])
          OR EXISTS (SELECT 1 FROM conversion_items ci
                      WHERE ci.conversion_id = c.id AND ci.product_id = ANY($1::int[])))
     AND ($2::int[] IS NULL OR EXISTS (SELECT 1 FROM conversion_reparto r
                                        WHERE r.conversion_id = c.id AND r.vendedora_id = ANY($2::int[])))
   ORDER BY c.fecha_conversion DESC, c.id DESC`;

async function ventasDe(productIds, alcance, hoy) {
  if (!productIds.length) return [];
  const { rows } = await query(VENTAS_SQL, [productIds, alcance && alcance.length ? alcance : (alcance ? [-1] : null), hoy]);
  return rows;
}

/** Los alumnos de una formación, con sus cifras. Solo de ese campus. */
export async function alumnosDeFormacion(productId, projectId, { alcance = null, hoy = hoyEnMadrid() } = {}) {
  const { rows: [p] } = await query(
    'SELECT id, project_id, nombre, tipo_formacion, duracion, fecha_fin FROM products WHERE id = $1',
    [productId]
  );
  if (!p) throw new AppError('Formación no encontrada', 404, 'PRODUCT_NOT_FOUND');
  if (Number(p.project_id) !== Number(projectId)) throw new AppError('No tienes acceso a esta formación', 403, 'FORBIDDEN');

  const [regla, ventas] = await Promise.all([reglaDeAcceso(projectId), ventasDe([Number(p.id)], alcance, hoy)]);
  const alumnos = ordenarAlumnos(alumnosDeVentas(ventas, p, regla, hoy));
  return {
    hoy,
    regla,
    solo_lo_suyo: Boolean(alcance),
    resumen: resumenDeAlumnos(alumnos),
    alumnos,
  };
}

/**
 * Las cifras de TODAS las formaciones de un campus, para la lista: `por_producto`
 * solo trae las que tienen algún alumno.
 */
export async function resumenDelCampus(projectId, { alcance = null, hoy = hoyEnMadrid() } = {}) {
  const [{ rows: productos }, regla] = await Promise.all([
    query('SELECT id, nombre, tipo_formacion, duracion, fecha_fin FROM products WHERE project_id = $1', [projectId]),
    reglaDeAcceso(projectId),
  ]);
  const porId = new Map(productos.map((p) => [Number(p.id), p]));
  const ventas = await ventasDe([...porId.keys()], alcance, hoy);

  const ventasPorProducto = new Map();
  for (const v of ventas) {
    for (const pid of v.productos || []) {
      const id = Number(pid);
      if (!ventasPorProducto.has(id)) ventasPorProducto.set(id, []);
      ventasPorProducto.get(id).push(v);
    }
  }
  const porProducto = {};
  for (const [id, suyas] of ventasPorProducto) {
    porProducto[id] = resumenDeAlumnos(alumnosDeVentas(suyas, porId.get(id), regla, hoy));
  }
  return { hoy, regla, solo_lo_suyo: Boolean(alcance), por_producto: porProducto };
}
