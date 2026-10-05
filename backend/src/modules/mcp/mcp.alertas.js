import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendMcpAlertasEmail } from '../../shared/services/brevo.service.js';
import { enteroEnv, siNoEnv } from './mcp.config.js';

/**
 * Alertas del MCP de Claude (#195): avisar a Diego de lo raro.
 *
 *   · ráfagas: más de N consultas de una persona en M minutos;
 *   · una red o un cliente NUEVOS para esa persona;
 *   · fallos del código de desbloqueo (#192);
 *   · consultas de madrugada.
 *
 * Se revisa lo nuevo de `mcp_auditoria` desde la última vuelta (`mcp_vigilancia`
 * guarda hasta qué fila), y todo lo que salga va en UN correo. Cada alerta se
 * guarda en `mcp_alertas`, que es también lo que evita repetirla.
 *
 * POR QUÉ «RED» Y NO IP. Con «Agregar conector personalizado», quien llama no
 * es el equipo de la persona sino los servidores de Anthropic, y cambian de IP
 * a cada rato dentro de su rango (visto el 03/10: 160.79.106.164, .167, .175…).
 * Avisar de cada IP sería un correo por consulta, y un aviso que es ruido se
 * deja de leer. Se compara la red (/24 en IPv4, /48 en IPv6).
 *
 * POR QUÉ «FAMILIA» DE CLIENTE. «claude-code/2.1.288» pasa a «/2.1.289» con
 * cada actualización. Lo que interesa es que aparezca otro programa, no otra
 * versión del mismo.
 */

/** Umbrales, del .env en cada vuelta. 0 o vacío apaga esa alerta. */
export function configAlertas() {
  const madrugada = String(process.env.MCP_ALERTA_MADRUGADA ?? '0-6').match(/^(\d{1,2})-(\d{1,2})$/);
  return {
    activas: siNoEnv('MCP_ALERTAS', true),
    rafagaConsultas: enteroEnv('MCP_ALERTA_RAFAGA_CONSULTAS', 100, { cero: true }),
    rafagaMinutos: enteroEnv('MCP_ALERTA_RAFAGA_MINUTOS', 10),
    origenNuevo: siNoEnv('MCP_ALERTA_ORIGEN_NUEVO', true),
    fallosDesbloqueo: enteroEnv('MCP_ALERTA_FALLOS_DESBLOQUEO', 3, { cero: true }),
    madrugada: madrugada ? { desde: Number(madrugada[1]), hasta: Number(madrugada[2]) } : null,
    mesesAuditoria: enteroEnv('MCP_AUDITORIA_MESES', 12, { cero: true }),
  };
}

const TZ = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

/** «160.79.106.175» → «160.79.106.*»; IPv6, los tres primeros grupos. */
export function red(ip) {
  if (!ip) return null;
  const limpia = String(ip).replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(limpia)) return limpia.replace(/\.\d+$/, '.*');
  if (limpia.includes(':')) return `${limpia.split(':').slice(0, 3).join(':')}::/48`;
  return limpia;
}

/** «claude-code/2.1.288 (claude-vscode…)» → «claude-code». */
export function familia(cliente) {
  if (!cliente) return null;
  return String(cliente).trim().split(/[\s/(]/)[0].toLowerCase() || null;
}

/** A quién avisar: MCP_AVISO_EMAIL (separados por comas) o los super admin activos. */
export async function destinatariosVigilancia() {
  const lista = String(process.env.MCP_AVISO_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.length) return lista;
  const { rows } = await query(`SELECT email FROM users WHERE role = 'superadmin' AND active = true`);
  return rows.map((r) => r.email);
}

// ─── Detección ────────────────────────────────────────────────────────────

async function rafagas(cfg, ultimo, max) {
  if (!cfg.rafagaConsultas || !cfg.rafagaMinutos) return [];
  const { rows } = await query(
    `SELECT a.user_id, COUNT(*)::int AS consultas, MIN(a.created_at) AS desde, MAX(a.created_at) AS hasta
       FROM mcp_auditoria a
      WHERE a.user_id IS NOT NULL
        AND a.created_at > NOW() - make_interval(mins => $1::int)
        AND a.user_id IN (SELECT user_id FROM mcp_auditoria WHERE id > $3 AND id <= $4)
      GROUP BY a.user_id
     HAVING COUNT(*) > $2
        AND NOT EXISTS (SELECT 1 FROM mcp_alertas al
                         WHERE al.tipo = 'rafaga' AND al.user_id = a.user_id
                           AND al.created_at > NOW() - make_interval(mins => $1::int))`,
    [cfg.rafagaMinutos, cfg.rafagaConsultas, ultimo, max]
  );
  return rows.map((r) => ({ tipo: 'rafaga', userId: r.user_id,
    detalle: { consultas: r.consultas, minutos: cfg.rafagaMinutos, desde: r.desde, hasta: r.hasta } }));
}

// La misma regla que `red()` y `familia()`, en SQL: así se calcula para todos
// de una vez en la base, en vez de traer el historial de cada persona a Node.
// String.raw: en un texto normal de JS, «\d» pierde la barra y llega a la
// base como «d», con lo que no reconocería ninguna IP.
const IPV4 = String.raw`'^\d+\.\d+\.\d+\.\d+$'`;
const ULTIMO_OCTETO = String.raw`'\.\d+$'`;
const RED_SQL = (c) => `CASE
    WHEN ${c} IS NULL THEN NULL
    WHEN regexp_replace(${c}, '^::ffff:', '') ~ ${IPV4}
      THEN regexp_replace(regexp_replace(${c}, '^::ffff:', ''), ${ULTIMO_OCTETO}, '.*')
    WHEN ${c} LIKE '%:%' THEN array_to_string((string_to_array(${c}, ':'))[1:3], ':') || '::/48'
    ELSE ${c} END`;
const FAMILIA_SQL = (c) => `NULLIF(lower(split_part(split_part(split_part(btrim(${c}), ' ', 1), '/', 1), '(', 1)), '')`;

async function origenesNuevos(cfg, ultimo, max) {
  if (!cfg.origenNuevo) return [];
  // UNA consulta para todos. Se compara con lo que esa persona ya había usado
  // ANTES de esta vuelta, y solo con filas que tienen IP o cliente: la auditoría
  // anterior a la migración 191 no los tiene, y compararla haría que TODO
  // pareciera nuevo el día del despliegue (y un aviso por cada persona).
  // Sin historial con IP no hay red «nueva», solo la primera; lo mismo con el
  // cliente.
  const { rows } = await query(
    `WITH nuevos AS (
       SELECT DISTINCT user_id, ip, ${RED_SQL('ip')} AS red, cliente, ${FAMILIA_SQL('cliente')} AS familia
         FROM mcp_auditoria
        WHERE id > $1 AND id <= $2 AND user_id IS NOT NULL
     ), conocidos AS (
       SELECT user_id,
              array_agg(DISTINCT ${RED_SQL('ip')}) FILTER (WHERE ip IS NOT NULL)            AS redes,
              array_agg(DISTINCT ${FAMILIA_SQL('cliente')}) FILTER (WHERE cliente IS NOT NULL) AS familias
         FROM mcp_auditoria
        WHERE id <= $1 AND user_id IN (SELECT user_id FROM nuevos)
        GROUP BY user_id
     )
     SELECT n.user_id, 'ip_nueva' AS tipo, n.red AS valor, array_agg(DISTINCT n.ip) AS ejemplos
       FROM nuevos n JOIN conocidos k USING (user_id)
      WHERE n.red IS NOT NULL AND k.redes IS NOT NULL AND NOT (n.red = ANY(k.redes))
      GROUP BY n.user_id, n.red
     UNION ALL
     SELECT n.user_id, 'cliente_nuevo', n.familia, array_agg(DISTINCT n.cliente)
       FROM nuevos n JOIN conocidos k USING (user_id)
      WHERE n.familia IS NOT NULL AND k.familias IS NOT NULL AND NOT (n.familia = ANY(k.familias))
      GROUP BY n.user_id, n.familia`,
    [ultimo, max]
  );
  return rows.map((r) => (r.tipo === 'ip_nueva'
    ? { tipo: 'ip_nueva', userId: r.user_id, detalle: { red: r.valor, ips: r.ejemplos } }
    : { tipo: 'cliente_nuevo', userId: r.user_id, detalle: { cliente: r.valor, completo: r.ejemplos[0] } }));
}

async function fallosDesbloqueo(cfg, ultimo, max) {
  if (!cfg.fallosDesbloqueo) return [];
  // En la última hora y con al menos un fallo NUEVO: así no se pierden los que
  // caen a caballo entre dos vueltas, y no se repite cada 5 minutos.
  const { rows } = await query(
    `SELECT a.user_id, COUNT(*)::int AS fallos, MAX(a.created_at) AS ultimo
       FROM mcp_auditoria a
      WHERE a.herramienta = 'desbloquear' AND NOT a.ok AND a.user_id IS NOT NULL
        AND a.created_at > NOW() - INTERVAL '1 hour'
      GROUP BY a.user_id
     HAVING COUNT(*) >= $1
        AND MAX(a.id) > $2
        AND NOT EXISTS (SELECT 1 FROM mcp_alertas al
                         WHERE al.tipo = 'fallos_desbloqueo' AND al.user_id = a.user_id
                           AND al.created_at > NOW() - INTERVAL '1 hour')`,
    [cfg.fallosDesbloqueo, ultimo]
  );
  void max;
  return rows.map((r) => ({ tipo: 'fallos_desbloqueo', userId: r.user_id, detalle: { fallos: r.fallos, ultimo: r.ultimo } }));
}

async function madrugada(cfg, ultimo, max) {
  if (!cfg.madrugada) return [];
  const { desde, hasta } = cfg.madrugada;
  // Una por persona y noche: la fecha local de la primera consulta.
  const { rows } = await query(
    `SELECT a.user_id, COUNT(*)::int AS consultas,
            MIN(a.created_at) AS primera, MAX(a.created_at) AS ultima,
            to_char(MIN(a.created_at AT TIME ZONE '${TZ()}'), 'YYYY-MM-DD') AS noche
       FROM mcp_auditoria a
      WHERE a.id > $1 AND a.id <= $2 AND a.user_id IS NOT NULL
        -- «0-6» es de 0 a 6; «22-6» cruza la medianoche: de 22 a 24 O de 0 a 6.
        AND (CASE WHEN $3::int < $4::int
                  THEN EXTRACT(HOUR FROM a.created_at AT TIME ZONE '${TZ()}') >= $3::int
                   AND EXTRACT(HOUR FROM a.created_at AT TIME ZONE '${TZ()}') < $4::int
                  ELSE EXTRACT(HOUR FROM a.created_at AT TIME ZONE '${TZ()}') >= $3::int
                    OR EXTRACT(HOUR FROM a.created_at AT TIME ZONE '${TZ()}') < $4::int END)
      GROUP BY a.user_id`,
    [ultimo, max, desde, hasta]
  );
  const alertas = [];
  for (const r of rows) {
    const { rows: ya } = await query(
      `SELECT 1 FROM mcp_alertas WHERE tipo = 'madrugada' AND user_id = $1 AND detalle->>'noche' = $2 LIMIT 1`,
      [r.user_id, r.noche]
    );
    if (!ya.length) {
      alertas.push({ tipo: 'madrugada', userId: r.user_id,
        detalle: { consultas: r.consultas, primera: r.primera, ultima: r.ultima, noche: r.noche, franja: `${desde}-${hasta} h` } });
    }
  }
  return alertas;
}

// ─── La vuelta ────────────────────────────────────────────────────────────

/**
 * Revisa lo nuevo, guarda y envía las alertas, y avanza la marca. Devuelve
 * cuántas de cada tipo, para el registro de tareas (latido).
 */
export async function revisar() {
  const cfg = configAlertas();
  const resumen = { revisadas: 0, alertas: 0, correo: false };

  const { rows: [marca] } = await query(`SELECT ultimo_auditoria_id FROM mcp_vigilancia WHERE id = 1`);
  const ultimo = Number(marca?.ultimo_auditoria_id || 0);
  const { rows: [{ max }] } = await query(`SELECT COALESCE(MAX(id), 0) AS max FROM mcp_auditoria`);
  const hasta = Number(max);
  if (hasta <= ultimo) return resumen;
  resumen.revisadas = hasta - ultimo;

  let alertas = [];
  if (cfg.activas) {
    alertas = [
      ...await rafagas(cfg, ultimo, hasta),
      ...await origenesNuevos(cfg, ultimo, hasta),
      ...await fallosDesbloqueo(cfg, ultimo, hasta),
      ...await madrugada(cfg, ultimo, hasta),
    ];
  }

  if (alertas.length) {
    const ids = [...new Set(alertas.map((a) => a.userId))];
    const { rows: personas } = await query(`SELECT id, nombre, email FROM users WHERE id = ANY($1::int[])`, [ids]);
    const nombre = new Map(personas.map((p) => [p.id, p]));
    for (const a of alertas) {
      await query(`INSERT INTO mcp_alertas (tipo, user_id, detalle) VALUES ($1, $2, $3)`, [a.tipo, a.userId, JSON.stringify(a.detalle)]);
      a.persona = nombre.get(a.userId) || { nombre: `usuario ${a.userId}`, email: '' };
    }
    resumen.alertas = alertas.length;
    try {
      const para = (await destinatariosVigilancia()).map((email) => ({ email }));
      if (para.length) {
        const r = await sendMcpAlertasEmail({ para, alertas, enlace: `${process.env.CRM_BASE_URL || 'http://localhost:5173/crm'}/conexion/mcp` });
        // `sendEmail` contesta { sent: true|false }. Si no sale, las alertas
        // siguen guardadas en mcp_alertas (y se ven en el registro).
        resumen.correo = r?.sent === true;
        if (!resumen.correo) logger.warn({ reason: r?.reason }, 'MCP: el correo de alertas no salió');
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'MCP: no se pudo enviar el correo de alertas');
    }
    logger.info({ alertas: alertas.map((a) => ({ tipo: a.tipo, userId: a.userId })) }, 'MCP: alertas');
  }

  // La marca avanza aunque el correo falle: las alertas ya están guardadas en
  // mcp_alertas, y repetirlas en la siguiente vuelta sería mandarlas dos veces.
  await query(`UPDATE mcp_vigilancia SET ultimo_auditoria_id = $1, actualizado_at = NOW() WHERE id = 1`, [hasta]);
  return resumen;
}

/**
 * Borra la auditoría y las alertas más viejas que MCP_AUDITORIA_MESES (12).
 * A tandas de 5.000 para no tener la tabla bloqueada en una sola sentencia.
 */
export async function limpiarAuditoria() {
  const { mesesAuditoria } = configAlertas();
  if (!mesesAuditoria) return { borradas: 0 };
  let borradas = 0;
  for (;;) {
    const { rowCount } = await query(
      `DELETE FROM mcp_auditoria WHERE id IN (
         SELECT id FROM mcp_auditoria WHERE created_at < NOW() - make_interval(months => $1::int) LIMIT 5000)`,
      [mesesAuditoria]
    );
    borradas += rowCount;
    if (rowCount < 5000) break;
  }
  await query(`DELETE FROM mcp_alertas WHERE created_at < NOW() - make_interval(months => $1::int)`, [mesesAuditoria]);
  return { borradas };
}
