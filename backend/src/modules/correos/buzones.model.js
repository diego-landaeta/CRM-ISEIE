import { query } from '../../shared/config/db.js';

/**
 * Los buzones de correo conectados desde el panel (CRM#1032).
 *
 * NADA de lo que sale de aquí lleva la conexión: ni servidor, ni usuario, ni
 * contraseña. Solo la dirección —pública, es a la que se escribe— y si hay
 * credenciales guardadas. La conexión cifrada se lee aparte, con `conexionCifrada`,
 * y solo la usa el servidor para hablar con el buzón.
 */

const CAMPOS = `
  b.id, b.nombre, b.direccion, b.project_id, p.nombre AS project_nombre,
  b.empresa_id, i.razon_social AS empresa_nombre,
  (COALESCE(TRIM(i.email), '') = '') AS empresa_sin_correo,
  (b.cifrado IS NOT NULL AND b.cifrado <> '') AS configurada,
  b.activo, b.ultima_lectura_at, b.ultimo_resultado, b.ultimo_error,
  b.created_at, b.updated_at,
  (SELECT COUNT(*)::int FROM email_envios e WHERE e.buzon_id = b.id) AS recibidos`;

const DESDE = `
  FROM correo_buzones b
  LEFT JOIN projects p ON p.id = b.project_id
  LEFT JOIN invoice_issuers i ON i.id = b.empresa_id`;

/**
 * Los activos que puede ver quien pregunta. `campus`: los suyos (y los que no
 * son de ningún campus); `null`, todos.
 */
export async function listar(campus = null) {
  const { rows } = await query(
    `SELECT ${CAMPOS} ${DESDE}
      WHERE b.activo
        AND ($1::int[] IS NULL OR b.project_id IS NULL OR b.project_id = ANY($1::int[]))
      ORDER BY b.nombre, b.id`, [campus]);
  return rows;
}

export async function uno(id) {
  const { rows } = await query(`SELECT ${CAMPOS} ${DESDE} WHERE b.id = $1 AND b.activo`, [Number(id)]);
  return rows[0] || null;
}

/** La fila con la conexión cifrada. Solo para el servidor: nunca va a una respuesta. */
export async function conexionCifrada(id) {
  const { rows } = await query(
    `SELECT id, direccion, project_id, cifrado, iv, auth_tag
       FROM correo_buzones WHERE id = $1 AND activo`, [Number(id)]);
  return rows[0] || null;
}

export async function crear({ nombre, direccion, projectId, empresaId, cifrado, userId }) {
  const { rows } = await query(
    `INSERT INTO correo_buzones
       (nombre, direccion, project_id, empresa_id, cifrado, iv, auth_tag, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING id`,
    [nombre, direccion, projectId ?? null, empresaId ?? null,
      cifrado.cifrado, cifrado.iv, cifrado.auth_tag, userId ?? null]);
  return uno(rows[0].id);
}

/** Cambio parcial: solo lo que viene. `cifrado`, si cambió la conexión. */
export async function cambiar(id, { nombre, direccion, projectId, empresaId, cifrado, userId }) {
  const sets = [];
  const par = [Number(id)];
  const pon = (col, v) => { par.push(v); sets.push(`${col} = $${par.length}`); };
  if (nombre !== undefined) pon('nombre', nombre);
  if (direccion !== undefined) pon('direccion', direccion);
  if (projectId !== undefined) pon('project_id', projectId);
  if (empresaId !== undefined) pon('empresa_id', empresaId);
  if (cifrado) {
    pon('cifrado', cifrado.cifrado);
    pon('iv', cifrado.iv);
    pon('auth_tag', cifrado.auth_tag);
    // Con credenciales nuevas, el resultado de la última lectura ya no vale.
    sets.push('ultimo_resultado = NULL', 'ultimo_error = NULL');
  }
  pon('updated_by', userId ?? null);
  sets.push('updated_at = NOW()');
  await query(`UPDATE correo_buzones SET ${sets.join(', ')} WHERE id = $1 AND activo`, par);
  return uno(id);
}

/**
 * Quitarlo. La fila se queda —los correos que entraron por él siguen en la
 * Bandeja con su etiqueta, y se puede volver a conectar la misma dirección—,
 * pero la conexión cifrada se BORRA: un buzón quitado no guarda su contraseña.
 */
export async function quitar(id, userId) {
  const { rowCount } = await query(
    `UPDATE correo_buzones
        SET activo = false, cifrado = '', iv = '', auth_tag = '',
            updated_by = $2, updated_at = NOW()
      WHERE id = $1 AND activo`, [Number(id), userId ?? null]);
  return rowCount > 0;
}

/** La empresa de facturación, para comprobar que existe y de qué campus es. */
export async function empresa(id) {
  const { rows } = await query(
    `SELECT id, razon_social, project_id, email, activo FROM invoice_issuers WHERE id = $1`, [Number(id)]);
  return rows[0] || null;
}

/**
 * Poner la dirección del buzón como correo de facturación de su empresa, SOLO
 * si la empresa no tiene ninguno. Si mientras tanto alguien puso otro, no se
 * pisa: devuelve `null` y la pantalla lo dice.
 */
export async function usarComoCorreoDeEmpresa(id) {
  const { rows } = await query(
    `UPDATE invoice_issuers i
        SET email = b.direccion, updated_at = NOW()
       FROM correo_buzones b
      WHERE b.id = $1 AND b.activo AND i.id = b.empresa_id
        AND COALESCE(TRIM(i.email), '') = ''
      RETURNING i.id, i.razon_social, i.email`, [Number(id)]);
  return rows[0] || null;
}
