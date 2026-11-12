import { query, getClient } from '../../shared/config/db.js';

/** El tipo de la campanita cuando la copia falla. */
export const TIPO_FALLO = 'copia_diaria_fallo';

/**
 * Tablas y filas, para el correo. Las filas son las que estima Postgres
 * (`reltuples`): contar de verdad cada tabla a las tres de la mañana es leer la
 * base dos veces, y para saber «¿esta copia es normal?» basta con el orden de
 * magnitud. Una tabla aún sin analizar da -1: cuenta como 0.
 */
export async function estadisticas() {
  const { rows } = await query(
    `SELECT count(*)::int AS tablas,
            COALESCE(sum(GREATEST(c.reltuples, 0)), 0)::bigint AS filas
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'`
  );
  return { tablas: Number(rows[0]?.tablas || 0), filas: Number(rows[0]?.filas || 0) };
}

/**
 * El cerrojo: que no la hagan dos procesos a la vez.
 *
 * Hoy la API corre en un solo proceso (`instances: 1`), pero un reinicio a
 * destiempo o un segundo proceso no pueden acabar en dos volcados ni en dos
 * correos. Un bloqueo de sesión de Postgres —por base, así que producción y
 * /testeo no se estorban— que se suelta al terminar o, si el proceso muere,
 * al cerrarse su conexión.
 *
 * @returns {Promise<null | (() => Promise<void>)>} con qué soltarlo, o null si lo tiene otro.
 */
export async function tomarCerrojo() {
  const cliente = await getClient();
  try {
    const { rows } = await cliente.query(
      `SELECT pg_try_advisory_lock(hashtext('copia_diaria')) AS ok`
    );
    if (!rows[0]?.ok) {
      cliente.release();
      return null;
    }
  } catch (err) {
    cliente.release();
    throw err;
  }
  return async () => {
    try {
      await cliente.query(`SELECT pg_advisory_unlock(hashtext('copia_diaria'))`);
      cliente.release();
    } catch {
      // Si no se pudo soltar, se tira la conexión: con ella se va el bloqueo.
      cliente.release(true);
    }
  };
}

export async function superAdminsActivos() {
  const { rows } = await query(
    `SELECT id FROM users WHERE active AND role = 'superadmin' ORDER BY id`
  );
  return rows.map((r) => r.id);
}

/** ¿Ya se avisó hoy de que falló? Un aviso por día, no uno por intento. */
export async function yaAvisadoDelFallo(dia) {
  const { rows } = await query(
    `SELECT 1 FROM admin_notifications
      WHERE type = $1 AND metadata->>'dia' = $2
      LIMIT 1`,
    [TIPO_FALLO, dia]
  );
  return rows.length > 0;
}
