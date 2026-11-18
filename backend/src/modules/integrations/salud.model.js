import { query } from '../../shared/config/db.js';

/*
  LO QUE LEE LA SALUD DE LAS CONEXIONES (CRM#533).

  Solo lectura y solo rastros que las integraciones ya dejaban: no se inventa
  ninguna consulta a fuera. Cada función devuelve las filas de los campus
  pedidos y nada más; el servicio decide el color.

  Algunas tablas no están en todas las bases (el plugin de Moodle, la 293 de
  esta misma tarea): se mira antes con `to_regclass` y, si no está, se contesta
  vacío. Así una base a medio migrar enseña la pantalla entera en vez de caerse.
*/

const cacheDeTablas = new Map();

/** ¿Existe la tabla? Se pregunta una vez por proceso y tabla presente. */
export async function existeTabla(tabla) {
  if (cacheDeTablas.get(tabla) === true) return true;
  const { rows } = await query('SELECT to_regclass($1) IS NOT NULL AS hay', [tabla]);
  const hay = rows[0]?.hay === true;
  // Solo se recuerda el «sí»: si falta, puede aparecer al pasar la migración.
  if (hay) cacheDeTablas.set(tabla, true);
  return hay;
}

export async function campus(ids) {
  const { rows } = await query(
    `SELECT id, nombre, type, sociedad_emisora_id
       FROM projects
      WHERE id = ANY($1::int[]) AND active
      ORDER BY nombre`,
    [ids]
  );
  return rows;
}

/**
 * Las claves de Stripe, Brevo y Moodle de cada campus. Trae lo cifrado porque
 * el servicio comprueba que se puede descifrar; de aquí no sale hacia la
 * pantalla nada más que un sí o un no.
 */
export async function integraciones(ids) {
  const { rows } = await query(
    `SELECT project_id, provider, active, encrypted_value, iv, auth_tag, config_public,
            last_test_status, last_test_message, last_test_at
       FROM project_integrations
      WHERE project_id = ANY($1::int[]) AND provider IN ('stripe', 'brevo', 'moodle')`,
    [ids]
  );
  return rows;
}

/**
 * Las claves de Configuración › Claves (`api_credentials`) que también son una
 * conexión del campus: la cuenta de Brevo de la MARCA (con la que salen sus
 * correos) y el Moodle del MCP (#335: ahí estaba el token de FONO que no valía).
 * Y la de Brevo del CRM (sin campus). Solo las de producción, como el MCP.
 *
 * `service::text`: si el enum aún no tiene «moodle» (sin la 220), compararlo
 * como enum rompería la consulta entera.
 */
export async function credenciales(ids) {
  const { rows } = await query(
    `SELECT id, project_id, service::text AS service, encrypted_value, iv, auth_tag
       FROM api_credentials
      WHERE active AND service::text IN ('brevo', 'moodle')
        AND (project_id = ANY($1::int[]) OR (project_id IS NULL AND service::text = 'brevo'))
        AND COALESCE(metadata->>'entorno', 'produccion') = 'produccion'`,
    [ids]
  );
  return rows;
}

export async function stripe(ids) {
  const { rows } = await query(
    `SELECT s.project_id, s.last_sync_at, s.last_error,
            (SELECT MAX(sp.stripe_created_at) FROM stripe_payments sp WHERE sp.project_id = s.project_id) AS ultimo_cobro
       FROM stripe_sync_state s
      WHERE s.project_id = ANY($1::int[])`,
    [ids]
  );
  return rows;
}

export async function recepciones(ids, fuente = 'stripe') {
  if (!(await existeTabla('webhook_recepciones'))) return [];
  const { rows } = await query(
    `SELECT project_id, ultimo_at, resultado, motivo, ultimo_aceptado_at, aceptados, rechazados
       FROM webhook_recepciones
      WHERE fuente = $2 AND project_id = ANY($1::int[])`,
    [ids, fuente]
  );
  return rows;
}

export async function comprobaciones(ids) {
  if (!(await existeTabla('conexiones_salud'))) return [];
  const { rows } = await query(
    `SELECT project_id, conexion, ok, mensaje, comprobado_at, ultimo_ok_at
       FROM conexiones_salud
      WHERE project_id = ANY($1::int[])`,
    [ids]
  );
  return rows;
}

/** Lo que contestó una conexión al comprobarla, con la última vez que fue bien. */
export async function guardarComprobacion({ projectId, conexion, ok, mensaje }) {
  if (!(await existeTabla('conexiones_salud'))) return;
  await query(
    `INSERT INTO conexiones_salud (project_id, conexion, ok, mensaje, comprobado_at, ultimo_ok_at)
     VALUES ($1::int, $2::varchar, $3::boolean, $4::text, NOW(), CASE WHEN $3::boolean THEN NOW() END)
     ON CONFLICT (project_id, conexion) DO UPDATE
       SET ok = EXCLUDED.ok,
           mensaje = EXCLUDED.mensaje,
           comprobado_at = NOW(),
           ultimo_ok_at = COALESCE(EXCLUDED.ultimo_ok_at, conexiones_salud.ultimo_ok_at)`,
    [projectId, conexion, ok, (mensaje || '').slice(0, 1000)]
  );
}

export async function pluginMoodle(ids) {
  if (!(await existeTabla('moodle_plugin_campus'))) return [];
  const { rows } = await query(
    `SELECT project_id, activo, ultimo_aviso_at, sincronizado_at, sincronizacion_error, version_plugin
       FROM moodle_plugin_campus
      WHERE project_id = ANY($1::int[])`,
    [ids]
  );
  return rows;
}

/**
 * La tienda de cada campus, SIN sus claves: si tiene, sí o no. Las columnas que
 * no están en todas las bases (pedidos, estrategia) se leen por `to_jsonb`, que
 * da null si faltan en vez de romper la consulta.
 */
export async function wooCommerce(ids) {
  const { rows } = await query(
    `SELECT c.project_id, c.active, c.last_sync_at,
            (to_jsonb(c)->>'orders_last_sync_at')::timestamptz           AS pedidos_at,
            COALESCE((to_jsonb(c)->>'sync_orders')::boolean, false)      AS sync_pedidos,
            COALESCE(c.consumer_key, '') <> ''                           AS tiene_clave,
            r.status AS run_estado, r.error_message AS run_error,
            r.started_at AS run_inicio, r.finished_at AS run_fin,
            ok.fin AS ultimo_run_ok
       FROM wc_credentials c
       LEFT JOIN LATERAL (
         SELECT status, error_message, started_at, finished_at
           FROM wc_import_runs WHERE project_id = c.project_id
          ORDER BY started_at DESC LIMIT 1
       ) r ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(finished_at) AS fin
           FROM wc_import_runs WHERE project_id = c.project_id AND status = 'success'
       ) ok ON TRUE
      WHERE c.project_id = ANY($1::int[])`,
    [ids]
  );
  return rows;
}

/** Para «Comprobar ahora»: la dirección y las claves de la tienda. Nunca salen de aquí. */
export async function credencialesWoo(projectId) {
  const { rows } = await query(
    'SELECT store_url, consumer_key, consumer_secret, active FROM wc_credentials WHERE project_id = $1',
    [projectId]
  );
  return rows[0] || null;
}

export async function meta(ids) {
  const { rows } = await query(
    `SELECT project_id,
            COUNT(*)                                                       AS cuentas,
            MAX(last_synced_at)                                            AS ultimo,
            COUNT(*) FILTER (WHERE last_sync_status = 'error')             AS con_error,
            MAX(last_sync_error) FILTER (WHERE last_sync_status = 'error') AS motivo
       FROM meta_ad_accounts
      WHERE project_id = ANY($1::int[])
      GROUP BY project_id`,
    [ids]
  );
  return rows;
}

/** Los correos del CRM entero en 24 h: la cuenta de Brevo del CRM es una para todos. */
export async function correosDelCrm() {
  const { rows } = await query(
    `SELECT MAX(created_at) FILTER (WHERE estado = 'enviado')                                       AS ultimo_ok,
            COUNT(*) FILTER (WHERE estado = 'enviado' AND created_at > NOW() - INTERVAL '24 hours') AS ok_24h,
            COUNT(*) FILTER (WHERE estado = 'fallido' AND created_at > NOW() - INTERVAL '24 hours') AS fallos_24h
       FROM email_envios`
  );
  return rows[0] || {};
}

/** Los webhooks de admisión (los de Matrículas) de cada campus. */
export async function admision(ids) {
  const { rows } = await query(
    `SELECT project_id,
            COUNT(*) FILTER (WHERE active)       AS activos,
            MAX(last_used_at)                    AS ultimo,
            COALESCE(SUM(uses_count), 0)         AS usos
       FROM project_webhook_tokens
      WHERE kind = 'matriculas' AND project_id = ANY($1::int[])
      GROUP BY project_id`,
    [ids]
  );
  return rows;
}

/**
 * Los webhooks de transferencias activos, con su último envío y el último bueno.
 * Valen para un campus, para su empresa o para todas: el servicio los reparte.
 */
export async function transferencias() {
  if (!(await existeTabla('webhooks_salientes'))) return [];
  const { rows } = await query(
    `SELECT w.id, w.ambito, w.issuer_id, w.project_id,
            u.estado, u.error, u.http_status, COALESCE(u.ultimo_intento_at, u.created_at) AS cuando,
            ok.enviado_at AS ultimo_ok
       FROM webhooks_salientes w
       LEFT JOIN LATERAL (
         SELECT estado, error, http_status, ultimo_intento_at, created_at
           FROM webhooks_salientes_envios WHERE webhook_id = w.id
          ORDER BY created_at DESC LIMIT 1
       ) u ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(enviado_at) AS enviado_at
           FROM webhooks_salientes_envios WHERE webhook_id = w.id AND estado = 'enviado'
       ) ok ON TRUE
      WHERE w.activo`
  );
  return rows;
}
