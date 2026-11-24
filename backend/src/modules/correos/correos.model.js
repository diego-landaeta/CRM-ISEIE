import { query } from '../../shared/config/db.js';

/**
 * La Bandeja de correos: lo que LLEGA a los buzones conectados (CRM-ISEIE#701).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Gemela de la del 360 (CRM#146 y CRM#1032), con una diferencia a propósito:
 * aquí solo se enseña lo recibido (`direccion = 'entrada'`). En ISEIE el envío
 * sigue por Brevo (Diego, CRM#1058: «por ahora solo leer») y lo que sale no
 * guarda su texto; para eso está Estado del sistema › Correos.
 *
 * Lo que entra vive en `email_envios` con `direccion = 'entrada'` (334): es un
 * correo como los demás, con su remitente, su asunto, su fecha y su cuerpo.
 *
 * SON DATOS DE PERSONAS: lo que entra no lo escribimos nosotros. El cuerpo solo
 * sale por `uno`, con permiso, y la lista no lo trae.
 */

/**
 * La lista. SIN el cuerpo, y a propósito: son cien correos por página y el
 * cuerpo de cada uno pesa más que todo lo demás junto. Se pide al abrir uno.
 *
 * `projectIds`: los campus de quien mira (null, todos). Lo que no es de ningún
 * campus —un buzón de todo el CRM o el del `.env`— lo ve quien ve la Bandeja.
 */
export async function listar({ busca = null, desde = null, hasta = null, projectIds = null,
  buzon = null, limite = 100, pagina = 1 } = {}) {
  const par = [];
  const cond = [`direccion = 'entrada'`];

  const termino = typeof busca === 'string' ? busca.trim() : '';
  if (termino) {
    par.push(`%${termino}%`);
    // Por REMITENTE sobre todo: en lo que entra, el destinatario somos nosotros.
    cond.push(`(remitente ILIKE $${par.length} OR asunto ILIKE $${par.length}`
      + ` OR destinatarios ILIKE $${par.length})`);
  }
  if (desde) { par.push(desde); cond.push(`created_at >= $${par.length}::date`); }
  // `+ 1 día` porque `hasta` es un día, no un instante.
  if (hasta) { par.push(hasta); cond.push(`created_at < $${par.length}::date + INTERVAL '1 day'`); }
  // UN BUZÓN: lo que entró por él. 'servidor' es el del .env, que no tiene fila.
  if (buzon === 'servidor') {
    cond.push('buzon_id IS NULL');
  } else if (Number.isInteger(buzon) && buzon > 0) {
    par.push(buzon); cond.push(`buzon_id = $${par.length}`);
  }
  if (Array.isArray(projectIds) && projectIds.length) {
    par.push(projectIds.map(Number));
    cond.push(`(project_id = ANY($${par.length}::int[]) OR project_id IS NULL)`);
  }

  const donde = cond.join(' AND ');
  const { rows: [{ total }] } = await query(
    `SELECT COUNT(*)::int AS total FROM email_envios WHERE ${donde}`, par);

  const lim = Math.min(Number(limite) || 100, 200);
  const desplaza = (Math.max(Number(pagina) || 1, 1) - 1) * lim;
  par.push(lim, desplaza);

  const { rows } = await query(
    `SELECT id, created_at AS cuando, direccion,
            remitente, destinatarios, asunto, estado, project_id,
            -- El buzón por el que entró, para la etiqueta de la Bandeja.
            buzon_id,
            (SELECT b.nombre FROM correo_buzones b WHERE b.id = email_envios.buzon_id) AS buzon_nombre,
            (SELECT b.direccion FROM correo_buzones b WHERE b.id = email_envios.buzon_id) AS buzon_direccion,
            (SELECT nombre FROM projects WHERE id = email_envios.project_id) AS campus,
            -- Si quien escribe es alguien del CRM, su nombre delante de la dirección.
            (SELECT u.nombre FROM users u
              WHERE COALESCE(u.email, '') <> '' AND lower(u.email) = lower(email_envios.remitente)
              ORDER BY u.active DESC LIMIT 1) AS de_quien,
            (COALESCE(cuerpo_html, '') <> '') AS tiene_cuerpo
       FROM email_envios
      WHERE ${donde}
      ORDER BY created_at DESC, id DESC
      LIMIT $${par.length - 1} OFFSET $${par.length}`, par);

  return { total, pagina: Math.max(Number(pagina) || 1, 1), limite: lim, filas: rows };
}

/** Uno recibido, con su cuerpo. Es la única consulta que lo trae. */
export async function uno(id) {
  const { rows } = await query(
    `SELECT id, created_at AS cuando, direccion,
            remitente, destinatarios, asunto, estado, project_id, cuerpo_html, buzon_id,
            (SELECT b.nombre FROM correo_buzones b WHERE b.id = email_envios.buzon_id) AS buzon_nombre,
            (SELECT b.direccion FROM correo_buzones b WHERE b.id = email_envios.buzon_id) AS buzon_direccion,
            (SELECT nombre FROM projects WHERE id = email_envios.project_id) AS campus,
            (SELECT u.nombre FROM users u
              WHERE COALESCE(u.email, '') <> '' AND lower(u.email) = lower(email_envios.remitente)
              ORDER BY u.active DESC LIMIT 1) AS de_quien
       FROM email_envios WHERE id = $1 AND direccion = 'entrada'`, [Number(id)]);
  return rows[0] || null;
}

/** Cuántos han llegado. `campus`: los de esos campus y los de ninguno (null, todos). */
export async function recuento(campus = null) {
  const { rows: [r] } = await query(
    `SELECT COUNT(*)::int AS recibido FROM email_envios
      WHERE direccion = 'entrada'
        AND ($1::int[] IS NULL OR project_id = ANY($1::int[]) OR project_id IS NULL)`, [campus]);
  return { recibido: r.recibido };
}
