import { query } from '../../shared/config/db.js';

/*
  El apartado Certifex del CRM: las consultas que llegan desde la web de Certifex.

  Un centro que quiere inscribir su campus, o cualquier otra consulta. Certifex las
  guarda y las reenvia aqui; ver la migracion 173 para el porque de una tabla propia.
*/

export const ESTADOS = ['nueva', 'en_curso', 'resuelta', 'spam'];

function fila(r) {
  if (!r) return null;
  return {
    id: r.id,
    certifexId: Number(r.certifex_id),
    tipo: r.tipo,
    nombre: r.nombre,
    email: r.email,
    telefono: r.telefono,
    organizacion: r.organizacion,
    urlCampus: r.url_campus,
    mensaje: r.mensaje,
    idioma: r.idioma,
    estado: r.estado,
    notaInterna: r.nota_interna,
    atendidaPor: r.atendida_por_nombre || null,
    recibidaEn: r.recibida_en,
    creadaEnCertifex: r.creada_en_certifex,
    updatedAt: r.updated_at,
  };
}

/**
 * Guarda una consulta que llega de Certifex. Si ya estaba (un reintento de Certifex
 * tras un corte trae el mismo `certifex_id`), no la duplica: devuelve `nueva: false`
 * para que no vuelva a sonar la campana.
 */
export async function recibir(c) {
  const { rows } = await query(
    `INSERT INTO certifex_consultas
       (certifex_id, tipo, nombre, email, telefono, organizacion, url_campus, mensaje, idioma, creada_en_certifex)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (certifex_id) DO NOTHING
     RETURNING *`,
    [c.certifexId, c.tipo, c.nombre, c.email, c.telefono || null, c.organizacion || null,
      c.urlCampus || null, c.mensaje, c.idioma || null, c.creadoEn || null],
  );
  if (rows[0]) return { consulta: fila(rows[0]), nueva: true };
  const ya = await query(`SELECT * FROM certifex_consultas WHERE certifex_id = $1`, [c.certifexId]);
  return { consulta: fila(ya.rows[0]), nueva: false };
}

export async function listar({ estado = null, tipo = null, pagina = 1, limite = 30 } = {}) {
  const lim = Math.min(100, Math.max(1, parseInt(limite, 10) || 30));
  const pag = Math.max(1, parseInt(pagina, 10) || 1);
  const { rows } = await query(
    `SELECT c.*, u.nombre AS atendida_por_nombre, COUNT(*) OVER() AS total
       FROM certifex_consultas c
       LEFT JOIN users u ON u.id = c.atendida_por
      WHERE ($1::text IS NULL OR c.estado = $1) AND ($2::text IS NULL OR c.tipo = $2)
      ORDER BY (c.estado = 'nueva') DESC, c.recibida_en DESC, c.id DESC
      LIMIT $3 OFFSET $4`,
    [estado, tipo, lim, (pag - 1) * lim],
  );
  return { filas: rows.map(fila), total: rows[0] ? Number(rows[0].total) : 0, pagina: pag, limite: lim };
}

export async function recuentoNuevas() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM certifex_consultas WHERE estado = 'nueva'`);
  return rows[0]?.n ?? 0;
}

export async function actualizar(id, { estado, notaInterna }, userId) {
  const sets = ['atendida_por = $2', 'updated_at = NOW()'];
  const params = [id, userId];
  if (estado !== undefined) { params.push(estado); sets.push(`estado = $${params.length}`); }
  if (notaInterna !== undefined) { params.push(notaInterna); sets.push(`nota_interna = $${params.length}`); }
  const { rows } = await query(
    `UPDATE certifex_consultas SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  if (!rows[0]) return null;
  const u = await query(`SELECT nombre FROM users WHERE id = $1`, [userId]);
  return fila({ ...rows[0], atendida_por_nombre: u.rows[0]?.nombre || null });
}
