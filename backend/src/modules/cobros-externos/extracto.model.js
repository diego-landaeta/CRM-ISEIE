import { query } from '../../shared/config/db.js';
import { COBRADO_DE } from '../conversions/cobrado.js';

/** Apunta el fichero. null si ese mismo fichero ya se subió en el campus. */
export async function crearExtracto({ projectId, formato, nombre, huella, cuenta, desde, hasta, movimientos, abonos, userId }) {
  const { rows } = await query(
    `INSERT INTO extractos_banco (project_id, formato, nombre_fichero, huella_fichero, cuenta,
                                  fecha_desde, fecha_hasta, movimientos, abonos, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id, huella_fichero) DO NOTHING
     RETURNING *`,
    [projectId, formato, nombre ? String(nombre).slice(0, 255) : null, huella, cuenta, desde, hasta, movimientos, abonos, userId]
  );
  return rows[0] || null;
}

export async function cerrarExtracto(id, { abonosNuevos, enlazados, aRevisar }) {
  await query(
    'UPDATE extractos_banco SET abonos_nuevos = $2, enlazados = $3, a_revisar = $4 WHERE id = $1',
    [id, abonosNuevos, enlazados, aRevisar]
  );
}

/** Guarda un abono. null si ya estaba (otro extracto que se solapa con este). */
export async function crearMovimiento(m) {
  const { rows } = await query(
    `INSERT INTO movimientos_banco (extracto_id, project_id, cuenta, huella, fecha_operacion, fecha_valor,
                                    importe, moneda, concepto, referencia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (huella) DO NOTHING
     RETURNING *`,
    [m.extractoId, m.projectId, m.cuenta, m.huella, m.fechaOperacion, m.fechaValor, m.importe, m.moneda,
     m.concepto ? String(m.concepto).slice(0, 1000) : null, m.referencia ? String(m.referencia).slice(0, 120) : null]
  );
  return rows[0] || null;
}

export async function getMovimiento(id) {
  const { rows } = await query('SELECT * FROM movimientos_banco WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function proponer(id, { estado, candidatos, linkMethod = null }) {
  await query(
    `UPDATE movimientos_banco SET estado = $2, candidatos = $3::jsonb, link_method = COALESCE($4, link_method), updated_at = NOW()
      WHERE id = $1 AND conversion_payment_id IS NULL AND estado <> 'enlazando'`,
    [id, estado, JSON.stringify(candidatos || []), linkMethod]
  );
}

/**
 * Las ventas del campus con lo que hace falta para proponer: quién, cuánto
 * falta y la próxima cuota. Lo cobrado, de los pagos (#692).
 */
export async function ventasDelCampus(projectId) {
  const { rows } = await query(
    `SELECT c.id, c.lead_id, c.importe_total, ${COBRADO_DE('c')} AS cobrado,
            c.producto_contratado, c.fecha_conversion, l.nombre,
            (SELECT ci.importe_previsto FROM conversion_installments ci
              WHERE ci.conversion_id = c.id AND ci.fecha_cobro IS NULL
              ORDER BY ci.numero LIMIT 1) AS proxima_cuota
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
      WHERE c.project_id = $1 AND l.deleted_at IS NULL`,
    [projectId]
  );
  return rows;
}

const ESTADO_ENLAZANDO = 'enlazando';
const RESERVA_MINUTOS = 2;

/** Reserva el movimiento con una sola sentencia (la idea de la #699). */
export async function reservar(id) {
  const { rows: [r] } = await query(
    `UPDATE movimientos_banco mb
        SET estado = $2, reservado_at = NOW()
       FROM (SELECT id, estado FROM movimientos_banco WHERE id = $1 FOR UPDATE) antes
      WHERE mb.id = antes.id
        AND mb.conversion_payment_id IS NULL
        AND (mb.estado <> $2 OR mb.reservado_at < NOW() - make_interval(mins => $3))
      RETURNING mb.*, antes.estado AS estado_antes`,
    [id, ESTADO_ENLAZANDO, RESERVA_MINUTOS]
  );
  return r || null;
}

export async function soltar(id, estadoAntes) {
  await query(
    `UPDATE movimientos_banco SET estado = $2, reservado_at = NULL WHERE id = $1 AND estado = $3`,
    [id, estadoAntes === ESTADO_ENLAZANDO ? 'a_revisar' : estadoAntes, ESTADO_ENLAZANDO]
  );
}

export async function marcarEnlazado(id, { conversionId, paymentId, linkMethod, userId }) {
  await query(
    `UPDATE movimientos_banco SET estado = 'enlazado', conversion_id = $2, conversion_payment_id = $3,
            link_method = $4, decidido_por = $5, decidido_at = NOW(), reservado_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id, conversionId, paymentId, linkMethod, userId]
  );
}

export async function descartar(id, userId) {
  const { rowCount } = await query(
    `UPDATE movimientos_banco SET estado = 'descartado', link_method = 'manual', decidido_por = $2,
            decidido_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND conversion_payment_id IS NULL AND estado <> 'enlazando'`,
    [id, userId]
  );
  return rowCount > 0;
}

export async function listarMovimientos({ projectIds, estado, page = 1, limit = 50 }) {
  const conds = ['mb.project_id = ANY($1::int[])'];
  const params = [projectIds];
  if (estado) { conds.push('mb.estado = $2'); params.push(estado); }
  const where = conds.join(' AND ');
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const { rows } = await query(
    `SELECT mb.id, mb.project_id, mb.cuenta, mb.fecha_operacion, mb.fecha_valor, mb.importe, mb.moneda,
            mb.concepto, mb.referencia, mb.estado, mb.candidatos, mb.conversion_id, mb.conversion_payment_id,
            mb.link_method, mb.decidido_at, l.nombre AS lead_nombre, cv.producto_contratado
       FROM movimientos_banco mb
       LEFT JOIN conversions cv ON cv.id = mb.conversion_id
       LEFT JOIN leads l ON l.id = cv.lead_id
      WHERE ${where}
      ORDER BY mb.fecha_operacion DESC, mb.id DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const { rows: [c] } = await query(`SELECT COUNT(*)::int AS total FROM movimientos_banco mb WHERE ${where}`, params);
  const { rows: cuenta } = await query(
    `SELECT estado, COUNT(*)::int AS n FROM movimientos_banco WHERE project_id = ANY($1::int[]) GROUP BY estado`,
    [projectIds]
  );
  return { rows, total: c.total, page: off / lim + 1, limit: lim, porEstado: Object.fromEntries(cuenta.map((r) => [r.estado, r.n])) };
}

export async function listarExtractos(projectIds, limit = 30) {
  const { rows } = await query(
    `SELECT e.id, e.project_id, e.formato, e.nombre_fichero, e.cuenta, e.fecha_desde, e.fecha_hasta,
            e.movimientos, e.abonos, e.abonos_nuevos, e.enlazados, e.a_revisar, e.created_at,
            u.nombre AS subido_por_nombre
       FROM extractos_banco e
       LEFT JOIN users u ON u.id = e.subido_por
      WHERE e.project_id = ANY($1::int[])
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [projectIds, limit]
  );
  return rows;
}
