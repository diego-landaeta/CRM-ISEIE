import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendMcpAlertasEmail } from '../../shared/services/brevo.service.js';

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

const entero = (v, def) => {
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : def;
};

/** Umbrales, del .env en cada vuelta. 0 o vacío apaga esa alerta. */
export function configAlertas() {
  const madrugada = String(process.env.MCP_ALERTA_MADRUGADA ?? '0-6').match(/^(\d{1,2})-(\d{1,2})$/);
  return {
    activas: !['0', 'false', 'no'].includes(String(process.env.MCP_ALERTAS ?? 'true').toLowerCase()),
    rafagaConsultas: entero(process.env.MCP_ALERTA_RAFAGA_CONSULTAS, 100),
    rafagaMinutos: entero(process.env.MCP_ALERTA_RAFAGA_MINUTOS, 10),
    origenNuevo: !['0', 'false', 'no'].includes(String(process.env.MCP_ALERTA_ORIGEN_NUEVO ?? 'true').toLowerCase()),
    fallosDesbloqueo: entero(process.env.MCP_ALERTA_FALLOS_DESBLOQUEO, 3),
    madrugada: madrugada ? { desde: Number(madrugada[1]), hasta: Number(madrugada[2]) } : null,
    mesesAuditoria: entero(process.env.MCP_AUDITORIA_MESES, 12),
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

async function origenesNuevos(cfg, ultimo, max) {
  if (!cfg.origenNuevo) return [];
  const { rows: nuevos } = await query(
    `SELECT DISTINCT user_id, ip, cliente FROM mcp_auditoria
      WHERE id > $1 AND id <= $2 AND user_id IS NOT NULL`,
    [ultimo, max]
  );
  const alertas = [];
  const porPersona = new Map();
  for (const n of nuevos) porPersona.set(n.user_id, [...(porPersona.get(n.user_id) || []), n]);

  for (const [userId, filas] of porPersona) {
    const { rows: antes } = await query(
      `SELECT DISTINCT ip, cliente FROM mcp_auditoria WHERE user_id = $1 AND id <= $2`,
      [userId, ultimo]
    );
    // Sin historial no hay nada con qué comparar: la primera vez no es «nuevo»,
    // es estrenar. Eso ya se ve en el panel (#194).
    if (!antes.length) continue;
    const redesViejas = new Set(antes.map((a) => red(a.ip)).filter(Boolean));
    const familiasViejas = new Set(antes.map((a) => familia(a.cliente)).filter(Boolean));
    const redesNuevas = [...new Set(filas.map((f) => red(f.ip)).filter((r) => r && !redesViejas.has(r)))];
    const familiasNuevas = [...new Set(filas.map((f) => familia(f.cliente)).filter((c) => c && !familiasViejas.has(c)))];
    for (const r of redesNuevas) {
      alertas.push({ tipo: 'ip_nueva', userId, detalle: { red: r, ips: filas.filter((f) => red(f.ip) === r).map((f) => f.ip) } });
    }
    for (const c of familiasNuevas) {
      alertas.push({ tipo: 'cliente_nuevo', userId, detalle: { cliente: c, completo: filas.find((f) => familia(f.cliente) === c).cliente } });
    }
  }
  return alertas;
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
        AND EXTRACT(HOUR FROM a.created_at AT TIME ZONE '${TZ()}') >= $3
        AND EXTRACT(HOUR FROM a.created_at AT TIME ZONE '${TZ()}') < $4
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
        const r = await sendMcpAlertasEmail({ para, alertas, enlace: `${process.env.CRM_BASE_URL || 'http://localhost:5173'}/conexion/mcp` });
        resumen.correo = r?.ok !== false;
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
