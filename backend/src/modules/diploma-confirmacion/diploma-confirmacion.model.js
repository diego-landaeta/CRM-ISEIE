import { query } from '../../shared/config/db.js';

/*
  Confirmación de datos del diploma (#768) · la base.

  Una fila viva de `diploma_confirmaciones` por matrícula de Certifex (migración
  308 en ISEIE, 291 en el 360). Pedirla otra vez anula la anterior.
*/

/** La confirmación viva de una matrícula (la que no está anulada). */
export async function deLaMatricula(matriculaId) {
  const { rows } = await query(
    `SELECT * FROM diploma_confirmaciones WHERE matricula_id = $1 AND estado <> 'anulado' LIMIT 1`,
    [matriculaId]);
  return rows[0] || null;
}

/** Las vivas de varias matrículas, por id de matrícula. */
export async function deLasMatriculas(matriculaIds = []) {
  if (!matriculaIds.length) return new Map();
  const { rows } = await query(
    `SELECT * FROM diploma_confirmaciones
      WHERE matricula_id = ANY($1::bigint[]) AND estado <> 'anulado'`,
    [matriculaIds]);
  return new Map(rows.map((r) => [Number(r.matricula_id), r]));
}

export async function porId(id) {
  const { rows } = await query('SELECT * FROM diploma_confirmaciones WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * La confirmación de un enlace. Solo si sigue pendiente y no ha caducado: un
 * enlace usado (token_hash a NULL), caducado o bloqueado por intentos no
 * encuentra nada, y quien lo abre ve «este enlace ya no vale».
 */
export async function porTokenHash(hash) {
  const { rows } = await query(
    `SELECT d.*, p.nombre AS campus, p.logo_url, p.theme_color,
            to_jsonb(p) ->> 'color_cabecera' AS color_cabecera
       FROM diploma_confirmaciones d
       LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.token_hash = $1 AND d.estado = 'pendiente' AND d.caduca_at > NOW()`,
    [hash]);
  return rows[0] || null;
}

/** Crea la confirmación. Si otra llamada se adelantó (índice único), devuelve null. */
export async function crear(d) {
  const { rows } = await query(
    `INSERT INTO diploma_confirmaciones
       (matricula_id, centro, project_id, lead_id, token_hash, caduca_at,
        nombre_propuesto, documento_propuesto, curso_nombre, horas, fecha_diploma, pedido_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [d.matriculaId, d.centro, d.projectId ?? null, d.leadId ?? null, d.tokenHash, d.caducaAt,
      d.nombre ?? null, d.documento ?? null, d.curso ?? null, d.horas ?? null, d.fecha ?? null, d.pedidoPor ?? null]);
  return rows[0] || null;
}

/** Anula la viva de una matrícula (para pedirla de nuevo). Solo si aún no se emitió. */
export async function anular(id) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET estado = 'anulado', token_hash = NULL, updated_at = NOW()
      WHERE id = $1 AND estado <> 'anulado' AND nexpediente IS NULL
      RETURNING *`,
    [id]);
  return rows[0] || null;
}

export async function marcarEnvio(id, { para = null, error = null, simulado = false }) {
  await query(
    `UPDATE diploma_confirmaciones
        SET enviado_a = COALESCE($2, enviado_a),
            enviado_at = CASE WHEN $3::text IS NULL THEN NOW() ELSE enviado_at END,
            envio_error = $3, envio_simulado = $4, updated_at = NOW()
      WHERE id = $1`,
    [id, para, error, simulado]);
}

/** Un envío con errores. Al llegar al tope, el enlace deja de valer. */
export async function sumarIntento(id, maximo) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET intentos = intentos + 1,
            token_hash = CASE WHEN intentos + 1 >= $2 THEN NULL ELSE token_hash END,
            updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING *`,
    [id, maximo]);
  return rows[0] || null;
}

/**
 * Guarda la respuesta y QUEMA el enlace en la misma sentencia: solo entra el
 * primero que llegue (dos envíos a la vez no guardan los dos).
 */
export async function guardarRespuesta(id, { estado, nombre, documento, comentario, ip }) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET estado = $2, nombre_confirmado = $3, documento_confirmado = $4, comentario = $5,
            respondido_at = NOW(), respondido_ip = $6, token_hash = NULL, updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente' AND token_hash IS NOT NULL
      RETURNING *`,
    [id, estado, nombre, documento, comentario, ip]);
  return rows[0] || null;
}

export async function marcarAplicado(id, error = null) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET aplicado_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE aplicado_at END,
            aplicar_error = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, error ? String(error).slice(0, 500) : null]);
  return rows[0] || null;
}

/** Día 7 sin respuesta: vale lo que hay. El enlace deja de servir. */
export async function vencer(id) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET estado = 'vencido', token_hash = NULL, updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente' AND caduca_at <= NOW()
      RETURNING *`,
    [id]);
  return rows[0] || null;
}

/** Enlace nuevo (reenvío): el anterior deja de valer y el plazo vuelve a contar. */
export async function renovarEnlace(id, { tokenHash, caducaAt }) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET token_hash = $2, caduca_at = $3, intentos = 0, updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING *`,
    [id, tokenHash, caducaAt]);
  return rows[0] || null;
}

/** Las que han pasado su plazo sin respuesta. */
export async function vencidas(limite = 100) {
  const { rows } = await query(
    `SELECT id FROM diploma_confirmaciones
      WHERE estado = 'pendiente' AND caduca_at <= NOW()
      ORDER BY caduca_at LIMIT $1`,
    [limite]);
  return rows;
}

/**
 * El diploma que salió: con qué datos y cuándo. Solo la primera vez. Parte de lo
 * confirmado y encima va lo que se mandó de verdad a Certifex al emitir (`datos`:
 * el documento que tenía entonces, las horas y la formación del programa).
 */
export async function registrarEmision(matriculaId, { nexpediente, datos }) {
  const { rows } = await query(
    `UPDATE diploma_confirmaciones
        SET nexpediente = $2, emitido_at = NOW(), updated_at = NOW(),
            datos_emision = jsonb_strip_nulls(jsonb_build_object(
              'nombre', COALESCE(nombre_confirmado, nombre_propuesto),
              'documento', COALESCE(documento_confirmado, documento_propuesto),
              'curso', curso_nombre, 'horas', horas, 'fecha', fecha_diploma,
              'origen', estado)) || jsonb_strip_nulls($3::jsonb)
      WHERE matricula_id = $1 AND estado IN ('confirmado', 'corregido', 'vencido') AND nexpediente IS NULL
      RETURNING id`,
    [matriculaId, nexpediente, JSON.stringify(datos)]);
  return rows[0] || null;
}

/** El correo con el diploma salió (aviso aprobado en el panel). */
export async function registrarEnvioDiploma(nexpedientes = []) {
  if (!nexpedientes.length) return 0;
  const { rowCount } = await query(
    `UPDATE diploma_confirmaciones
        SET diploma_enviado_at = NOW(), updated_at = NOW()
      WHERE nexpediente = ANY($1::text[]) AND estado <> 'anulado'`,
    [nexpedientes]);
  return rowCount;
}

/** Los proyectos del CRM con lo que hace falta para la marca del correo y la página. */
export async function proyectos() {
  const { rows } = await query(
    `SELECT id, nombre, slug, logo_url, emoji, theme_color FROM projects WHERE NOT COALESCE(es_prueba, false)`);
  return rows;
}
