import { query } from '../config/db.js';
import { logger } from '../utils/logger.js';

// El registro de correos. Existe para tres cosas que antes no se podian hacer:
// saber si un correo ya salio, saber por que no salio, y poder mirarlo sin
// entrar por SSH a leer el log del servidor.
//
// Regla de oro de este fichero: NADA de aqui puede tumbar un envio. Si la base
// no responde, el correo se manda igual y se pierde la anotacion — al reves
// seria peor. Por eso todo va envuelto en try/catch y nunca relanza.

/** ¿Ya salio un correo con esta clave? Sin clave, no se controla nada. */
export async function yaSeEnvio(clave) {
  if (!clave) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM email_envios WHERE clave = $1 AND estado = 'enviado' LIMIT 1`,
      [clave]
    );
    return rows.length > 0;
  } catch (err) {
    // Si no se puede comprobar, se deja pasar: es mejor un correo repetido que
    // un recordatorio que no llega nunca porque la base tuvo un mal momento.
    logger.warn({ err: err.message, clave }, 'Registro de correo: no se pudo comprobar la clave');
    return false;
  }
}

/** Anota el intento, saliera o no. */
export async function registrar({ clave, destinatarios, asunto, etiquetas, projectId, estado, intentos, brevoMsgId, error }) {
  try {
    await query(
      `INSERT INTO email_envios
         (clave, destinatarios, asunto, etiquetas, project_id, estado, intentos, brevo_msg_id, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (clave) WHERE clave IS NOT NULL DO NOTHING`,
      [clave || null, destinatarios, (asunto || '').slice(0, 500),
       Array.isArray(etiquetas) && etiquetas.length ? etiquetas : null,
       projectId || null, estado,
         // `??` y no `||`: un correo bloqueado por el freno tiene CERO intentos,
         // y `0 || 1` lo convertia en uno. Anotar un intento que no se hizo
         // hace creer que Brevo lo rechazo cuando ni se le pregunto.
         intentos ?? 1,
         brevoMsgId || null,
       error ? String(error).slice(0, 2000) : null]
    );
  } catch (err) {
    logger.warn({ err: err.message, destinatarios, asunto }, 'Registro de correo: no se pudo anotar');
  }
}

/** Para la pantalla de «que se ha enviado». */
export async function ultimos({ limite = 100, estado = null, etiqueta = null } = {}) {
  const cond = [];
  const params = [];
  if (estado) { params.push(estado); cond.push(`estado = $${params.length}`); }
  // El GIN del array hace que esto no recorra la tabla entera.
  if (etiqueta) { params.push([etiqueta]); cond.push(`etiquetas @> $${params.length}`); }
  params.push(Math.min(500, limite));
  const { rows } = await query(
    `SELECT id, destinatarios, asunto, etiquetas, project_id, estado, intentos,
            brevo_msg_id, error, created_at
       FROM email_envios
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Los ultimos correos que el CRM intento mandar.
 *
 * Es la cuarta subfase de la tarea #27: «un sitio donde ver lo enviado — que
 * salio, a quien y cuando». Sin esto, comprobar que el freno o los reintentos
 * funcionan exige entrar a Postgres, y entonces no lo comprueba nadie.
 *
 * `estado` filtra por enviado / fallido / bloqueado, que es la pregunta que uno
 * se hace de verdad: «¿que NO salio?».
 */
export async function ultimosEnvios({ estado = null, limite = 50 } = {}) {
  try {
    const tope = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 200);
    const { rows } = await query(
      `SELECT id, clave, destinatarios, asunto, etiquetas, project_id,
              estado, intentos, error, created_at
         FROM email_envios
        WHERE ($1::text IS NULL OR estado = $1)
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [estado || null, tope]
    );
    return rows;
  } catch (err) {
    logger.error({ err: err.message }, 'Registro de correo: no se pudo leer');
    return [];
  }
}

/** Cuantos de cada estado en las ultimas 24 horas, para el resumen de arriba. */
export async function resumenEnvios() {
  try {
    const { rows } = await query(
      `SELECT estado, count(*)::int AS n
         FROM email_envios
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY estado`
    );
    const r = { enviado: 0, fallido: 0, bloqueado: 0 };
    for (const f of rows) r[f.estado] = f.n;
    return r;
  } catch (err) {
    logger.error({ err: err.message }, 'Registro de correo: no se pudo resumir');
    return { enviado: 0, fallido: 0, bloqueado: 0 };
  }
}
