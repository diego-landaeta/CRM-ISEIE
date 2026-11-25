import { query, getClient } from '../../shared/config/db.js';
import { DIAS_AVISO_DE_SERIE } from './apostillas.estados.js';

/*
  LAS CONSULTAS DE LAS APOSTILLAS (CRM#1130 / CRM-ISEIE#786).

  El recorte por campus y por persona llega ya hecho (`projectIds`, `ids`):
  este fichero no mira la sesión.

  DE DÓNDE SALE EL DINERO. No se copia nada en `apostillas`:
    · con línea de venta, el importe de la línea; lo cobrado, su parte de lo
      cobrado de la venta (una venta con máster y apostilla cobra a medias);
    · venta sin línea (las ventas a mano antiguas), el total de la venta y lo
      cobrado hasta ese total;
    · cargo de Stripe sin venta, el cargo (si se cobró);
    · a mano y sin venta, 0.
  «Pagada» = lo cobrado llega al importe. La fecha es la de la venta, la del
  cargo o, si no hay ninguna, la de alta.
*/

const ZONA = "'Europe/Madrid'";

/** La parte común: la apostilla con su persona, su venta, su dinero y sus días en el estado. */
const BASE = `
  SELECT a.id, a.project_id, pr.nombre AS campus, a.lead_id, l.nombre AS cliente, l.email AS cliente_email,
         a.conversion_id, a.conversion_item_id, a.stripe_payment_id, a.origen, a.estado, a.estado_desde,
         a.responsable_id, ur.nombre AS responsable, a.formacion, a.direccion_envio, a.numero_seguimiento,
         a.notas, a.creada_por, a.created_at, a.updated_at,
         c.vendedora_id, l.responsable_id AS lead_responsable_id,
         COALESCE(c.vendedora_id, l.responsable_id) AS gestora_id, ug.nombre AS gestora,
         c.producto_contratado AS venta_producto, sp.customer_email AS cobro_email,
         d.importe::float8 AS importe, d.cobrado::float8 AS cobrado, d.fecha,
         (d.importe > 0 AND d.cobrado >= d.importe - 0.01) AS pagada,
         FLOOR(EXTRACT(EPOCH FROM (NOW() - a.estado_desde)) / 86400)::int AS dias_en_estado,
         COALESCE(aj.dias_aviso, ${DIAS_AVISO_DE_SERIE})::int AS dias_aviso
    FROM apostillas a
    JOIN projects pr ON pr.id = a.project_id
    LEFT JOIN leads l ON l.id = a.lead_id
    LEFT JOIN conversions c ON c.id = a.conversion_id
    LEFT JOIN conversion_items ci ON ci.id = a.conversion_item_id
    LEFT JOIN stripe_payments sp ON sp.id = a.stripe_payment_id
    LEFT JOIN users ur ON ur.id = a.responsable_id
    LEFT JOIN users ug ON ug.id = COALESCE(c.vendedora_id, l.responsable_id)
    LEFT JOIN apostillas_ajustes aj ON aj.project_id = a.project_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(cp.importe), 0) AS cob FROM conversion_payments cp WHERE cp.conversion_id = c.id
    ) pg ON true
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN ci.id IS NOT NULL THEN ci.subtotal
             WHEN c.id IS NOT NULL THEN c.importe_total
             WHEN sp.id IS NOT NULL THEN sp.amount
             ELSE 0 END::numeric AS importe,
        CASE WHEN ci.id IS NOT NULL THEN ROUND(ci.subtotal * LEAST(1, pg.cob / NULLIF(c.importe_total, 0)), 2)
             WHEN c.id IS NOT NULL THEN LEAST(c.importe_total, pg.cob)
             WHEN sp.id IS NOT NULL AND sp.status = 'succeeded' THEN sp.amount
             ELSE 0 END::numeric AS cobrado,
        COALESCE(c.fecha_conversion, (sp.stripe_created_at AT TIME ZONE ${ZONA})::date,
                 (a.created_at AT TIME ZONE ${ZONA})::date) AS fecha
    ) d`;

/**
 * Las condiciones de la lista y de las cifras, en un solo sitio: si no, con un
 * filtro puesto la lista decía 2 y las cifras 6.
 */
function filtros({ projectIds = null, estado, sinAsociar, atascadas, ids = null, q, from, to }, params) {
  const conds = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (projectIds) conds.push(`a.project_id = ANY(${p(projectIds)}::int[])`);
  if (estado) conds.push(`a.estado = ${p(estado)}`);
  if (sinAsociar) conds.push('a.lead_id IS NULL');
  if (atascadas) {
    conds.push(`a.estado NOT IN ('entregada', 'cancelada')
      AND a.estado_desde <= NOW() - make_interval(days => COALESCE(aj.dias_aviso, ${DIAS_AVISO_DE_SERIE}))`);
  }
  if (ids) {
    const n = p(ids);
    conds.push(`(a.responsable_id = ANY(${n}::int[]) OR c.vendedora_id = ANY(${n}::int[]) OR l.responsable_id = ANY(${n}::int[]))`);
  }
  if (q) {
    const n = p(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    conds.push(`(l.nombre ILIKE ${n} OR l.email ILIKE ${n} OR a.formacion ILIKE ${n} OR sp.customer_email ILIKE ${n})`);
  }
  if (from) conds.push(`d.fecha >= ${p(from)}::date`);
  if (to) conds.push(`d.fecha <= ${p(to)}::date`);
  return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
}

export async function listar(f) {
  const params = [];
  const where = filtros(f, params);
  const { rows: [{ total }] } = await query(`SELECT COUNT(*)::int AS total FROM (${BASE} ${where}) x`, params);
  const limit = f.limit || 50;
  const page = f.page || 1;
  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `${BASE} ${where}
     ORDER BY (a.estado IN ('entregada', 'cancelada')), a.estado_desde ASC, a.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { apostillas: rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function porId(id) {
  const { rows } = await query(`${BASE} WHERE a.id = $1`, [id]);
  return rows[0] || null;
}

/** Las de una persona (el bloque de la ficha del cliente). */
export async function deLead(leadId, projectIds = null) {
  const { rows } = await query(
    `${BASE} WHERE a.lead_id = $1 AND ($2::int[] IS NULL OR a.project_id = ANY($2::int[])) ORDER BY a.id DESC`,
    [leadId, projectIds]);
  return rows;
}

/** Las de una venta (el bloque de la ficha de la venta). */
export async function deVenta(conversionId, projectIds = null) {
  const { rows } = await query(
    `${BASE} WHERE a.conversion_id = $1 AND ($2::int[] IS NULL OR a.project_id = ANY($2::int[])) ORDER BY a.id`,
    [conversionId, projectIds]);
  return rows;
}

/**
 * LAS CIFRAS (Diego, 25/11: «un producto propio que tiene que poder medirse»):
 * cuántas, cuánto dinero, por estado, por campus y por mes. Las canceladas o
 * reembolsadas se cuentan en su estado pero NO suman dinero: ese dinero se
 * devolvió o no llegó.
 */
export async function cifras(f) {
  const params = [];
  const where = filtros(f, params);
  const sql = (select, group = '', order = '') =>
    query(`WITH x AS (${BASE} ${where}) ${select} FROM x ${group} ${order}`, params).then((r) => r.rows);
  const VIVA = "estado <> 'cancelada'";
  const [[tot], porEstado, porCampus, porMes] = await Promise.all([
    sql(`SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${VIVA})::int AS vivas,
                COALESCE(SUM(importe) FILTER (WHERE ${VIVA}), 0)::float8 AS importe,
                COALESCE(SUM(cobrado) FILTER (WHERE ${VIVA}), 0)::float8 AS cobrado,
                COUNT(*) FILTER (WHERE ${VIVA} AND pagada)::int AS pagadas,
                COUNT(*) FILTER (WHERE lead_id IS NULL)::int AS sin_asociar,
                COUNT(*) FILTER (WHERE estado NOT IN ('entregada', 'cancelada') AND dias_en_estado >= dias_aviso)::int AS atascadas`),
    sql(`SELECT estado, COUNT(*)::int AS n, COALESCE(SUM(importe), 0)::float8 AS importe`, 'GROUP BY estado'),
    sql(`SELECT project_id, campus, COUNT(*)::int AS n,
                COALESCE(SUM(importe) FILTER (WHERE ${VIVA}), 0)::float8 AS importe,
                COALESCE(SUM(cobrado) FILTER (WHERE ${VIVA}), 0)::float8 AS cobrado`,
    'GROUP BY project_id, campus', 'ORDER BY COUNT(*) DESC, campus'),
    sql(`SELECT to_char(fecha, 'YYYY-MM') AS mes, COUNT(*)::int AS n,
                COALESCE(SUM(importe) FILTER (WHERE ${VIVA}), 0)::float8 AS importe,
                COALESCE(SUM(cobrado) FILTER (WHERE ${VIVA}), 0)::float8 AS cobrado`,
    "GROUP BY to_char(fecha, 'YYYY-MM')", 'ORDER BY mes'),
  ]);
  return { ...tot, por_estado: porEstado, por_campus: porCampus, por_mes: porMes };
}

export async function eventos(apostillaId) {
  const { rows } = await query(
    `SELECT e.id, e.tipo, e.de, e.a, e.nota, e.created_at, u.nombre AS usuario
       FROM apostilla_eventos e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.apostilla_id = $1 ORDER BY e.created_at DESC, e.id DESC`, [apostillaId]);
  return rows;
}

export async function documentos(apostillaId) {
  const { rows } = await query(
    `SELECT d.id, d.tipo, d.nombre, d.mime, d.bytes, d.created_at, u.nombre AS subido_por
       FROM apostilla_documentos d LEFT JOIN users u ON u.id = d.subido_por
      WHERE d.apostilla_id = $1 ORDER BY d.created_at DESC, d.id DESC`, [apostillaId]);
  return rows;
}

export async function documentoPorId(id) {
  const { rows } = await query('SELECT * FROM apostilla_documentos WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function guardarDocumento({ apostillaId, tipo, nombre, clave, mime, bytes, userId }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [doc] } = await db.query(
      `INSERT INTO apostilla_documentos (apostilla_id, tipo, nombre, clave, mime, bytes, subido_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, tipo, nombre, mime, bytes, created_at`,
      [apostillaId, tipo, nombre, clave, mime, bytes, userId]);
    await evento(db, apostillaId, { tipo: 'documento', a: nombre, nota: tipo, userId });
    await db.query('UPDATE apostillas SET updated_at = NOW() WHERE id = $1', [apostillaId]);
    await db.query('COMMIT');
    return doc;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/** Una línea del historial. `db` es la transacción en curso (o cualquier cosa con `.query`). */
export async function evento(db, apostillaId, { tipo, de = null, a = null, nota = null, userId = null }) {
  await db.query(
    `INSERT INTO apostilla_eventos (apostilla_id, tipo, de, a, nota, user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [apostillaId, tipo, de, a, nota, userId]);
}

/**
 * Guarda los cambios y apunta cada uno en el historial, todo en una
 * transacción. Con estado nuevo, `estado_desde` vuelve a contar desde ahora (y
 * con él, el aviso de atascada).
 */
export async function editar(id, cambios, userId, { textos = {} } = {}) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [antes] } = await db.query('SELECT * FROM apostillas WHERE id = $1 FOR UPDATE', [id]);
    if (!antes) { await db.query('ROLLBACK'); return null; }
    const sets = [];
    const params = [];
    const poner = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    const nota = cambios.nota ?? null;
    let notaUsada = false;

    if (cambios.estado !== undefined && cambios.estado !== antes.estado) {
      poner('estado', cambios.estado);
      sets.push('estado_desde = NOW()', 'aviso_atasco_at = NULL');
      await evento(db, id, { tipo: 'estado', de: antes.estado, a: cambios.estado, nota, userId });
      notaUsada = true;
    }
    if (cambios.responsableId !== undefined && Number(cambios.responsableId || 0) !== Number(antes.responsable_id || 0)) {
      poner('responsable_id', cambios.responsableId || null);
      await evento(db, id, { tipo: 'responsable', de: textos.responsableAntes ?? null, a: textos.responsableAhora ?? null, userId });
    }
    for (const [campo, col, tipo] of [
      ['formacion', 'formacion', 'datos'],
      ['direccionEnvio', 'direccion_envio', 'envio'],
      ['numeroSeguimiento', 'numero_seguimiento', 'envio'],
    ]) {
      if (cambios[campo] !== undefined && (cambios[campo] || null) !== (antes[col] || null)) {
        poner(col, cambios[campo] || null);
        await evento(db, id, { tipo, de: antes[col] || null, a: cambios[campo] || null, nota: col, userId });
      }
    }
    if (nota && !notaUsada) {
      poner('notas', nota);
      await evento(db, id, { tipo: 'nota', nota, userId });
    } else if (nota) {
      poner('notas', nota);
    }
    if (sets.length) {
      sets.push('updated_at = NOW()');
      params.push(id);
      await db.query(`UPDATE apostillas SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    await db.query('COMMIT');
    return true;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/** Una apostilla a mano (sin cobro, o de un cobro que el CRM no vio). */
export async function crearManual({ projectId, leadId = null, conversionId = null, formacion = null, nota = null, userId }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [a] } = await db.query(
      `INSERT INTO apostillas (project_id, lead_id, conversion_id, origen, formacion, notas, creada_por)
       VALUES ($1, $2, $3, 'manual', $4, $5, $6) RETURNING id`,
      [projectId, leadId, conversionId, formacion, nota, userId]);
    await evento(db, a.id, { tipo: 'creada', a: 'pendiente_inicio', nota: nota || 'Creada a mano', userId });
    await db.query('COMMIT');
    return a.id;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/** Enlaza una de «Sin asociar» con su persona (y su venta, si se dice). */
export async function enlazar(id, { leadId, conversionId = null, texto, userId }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rowCount } = await db.query(
      `UPDATE apostillas SET lead_id = $2, conversion_id = COALESCE($3, conversion_id), updated_at = NOW()
        WHERE id = $1`, [id, leadId, conversionId]);
    if (rowCount) await evento(db, id, { tipo: 'enlazada', a: texto, userId });
    await db.query('COMMIT');
    return rowCount > 0;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

export async function lead(leadId) {
  const { rows } = await query(
    'SELECT id, project_id, nombre FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
  return rows[0] || null;
}

export async function venta(conversionId) {
  const { rows } = await query(
    'SELECT id, project_id, lead_id, producto_contratado FROM conversions WHERE id = $1', [conversionId]);
  return rows[0] || null;
}

/** Una persona activa con el campus (para «quién la lleva»). */
export async function personaDelCampus(userId, projectId) {
  const { rows } = await query(
    `SELECT u.id, u.nombre FROM users u
      WHERE u.id = $1 AND u.active
        AND (u.role IN ('superadmin', 'soporte')
             OR EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = $2 AND up.active))`,
    [userId, projectId]);
  return rows[0] || null;
}

export async function nombreDe(userId) {
  if (!userId) return null;
  const { rows } = await query('SELECT nombre FROM users WHERE id = $1', [userId]);
  return rows[0]?.nombre || null;
}

/** Quién puede llevarlas en esos campus: admin y gestoras activas (para el desplegable). */
export async function personas(projectIds) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.nombre FROM users u
       JOIN user_projects up ON up.user_id = u.id AND up.active
      WHERE u.active AND u.role IN ('admin', 'gestor', 'lider_equipo')
        AND ($1::int[] IS NULL OR up.project_id = ANY($1::int[]))
      ORDER BY u.nombre LIMIT 300`, [projectIds]);
  return rows;
}

export async function ajustes(projectIds) {
  const { rows } = await query(
    `SELECT pr.id AS project_id, pr.nombre AS campus, COALESCE(aj.dias_aviso, ${DIAS_AVISO_DE_SERIE})::int AS dias_aviso
       FROM projects pr LEFT JOIN apostillas_ajustes aj ON aj.project_id = pr.id
      WHERE pr.active AND COALESCE(pr.type::text, 'crm') <> 'ia'
        AND ($1::int[] IS NULL OR pr.id = ANY($1::int[]))
      ORDER BY pr.nombre`, [projectIds]);
  return rows;
}

export async function guardarAjustes(projectId, diasAviso, userId) {
  await query(
    `INSERT INTO apostillas_ajustes (project_id, dias_aviso, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (project_id) DO UPDATE SET dias_aviso = EXCLUDED.dias_aviso, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [projectId, diasAviso, userId]);
}
