import { query } from '../../shared/config/db.js';
import { getReceivable } from '../accounting/accounting.model.js';
import { RIGE_HOY, formacionesSinTutor } from '../tutores/tutor.model.js';

/**
 * Todo el SQL del MCP.
 *
 * DOS REGLAS QUE CUMPLEN TODAS LAS CONSULTAS DE DATOS
 *
 *  1. `project_id = ANY($1::int[])` va SIEMPRE, y la lista la calcula
 *     `acotarProyectos` a partir de la persona. No hay rama «sin proyecto =
 *     todos»: una lista vacia no llega aqui.
 *
 *  2. Las columnas se nombran una a una. Nada de `SELECT l.*` ni `i.*`: asi un
 *     campo nuevo en la tabla (un DNI, un IBAN, una clave) no se cuela solo en
 *     lo que lee Claude. Fuera quedan: datos fiscales, DNI, IBAN, documentos,
 *     claves de archivos, tokens y contraseñas.
 *
 * El dinero cobrado se suma de `conversion_payments`, nunca de
 * `conversions.importe_pagado`, que declara de mas (ver `ia-analisis/consultas.js`).
 */

const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';

// ─── Personas, ambito y tokens ────────────────────────────────────────────

export async function findUserById(id) {
  const { rows } = await query(
    `SELECT id, nombre, email, role, active, COALESCE(usa_mcp, false) AS usa_mcp
       FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Los campus de una persona. Super admin: todos los activos. El resto: los de
 * `user_projects` — igual que `getUserProjects` en auth, que es lo que ven en
 * el selector de proyecto. Los de prueba no entran: un curso inventado con
 * ventas falsas no es una respuesta.
 */
export async function proyectosDeLaPersona(user) {
  const cols = `p.id, p.nombre, p.sociedad_emisora_id AS sociedad_id, s.razon_social AS sociedad_nombre`;
  if (user.role === 'superadmin') {
    const { rows } = await query(
      `SELECT ${cols}
         FROM projects p
         LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
        WHERE p.active = true AND NOT COALESCE(p.es_prueba, false)
        ORDER BY s.razon_social NULLS LAST, p.nombre`
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT ${cols}
       FROM user_projects up
       JOIN projects p ON p.id = up.project_id
       LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
      WHERE up.user_id = $1 AND up.active = true AND p.active = true
        AND NOT COALESCE(p.es_prueba, false)
      ORDER BY s.razon_social NULLS LAST, p.nombre`,
    [user.id]
  );
  return rows;
}

/** El token vivo con su dueño. Caducado o revocado = no existe. */
export async function findTokenVivo(hash) {
  const { rows } = await query(
    `SELECT t.id AS token_id, t.user_id, t.connector_id
       FROM mcp_tokens t
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [hash]
  );
  return rows[0] || null;
}

export async function marcarUso(tokenId, { ip = null, cliente = null } = {}) {
  // Una vez por minuto basta: sin esto cada consulta de Claude es un UPDATE.
  // Desde dónde (#194): la IP y el cliente (User-Agent), para verlo en el panel.
  // Un cliente distinto se apunta al momento; una IP distinta NO, porque con
  // «Agregar conector» los servidores de Anthropic cambian de IP casi en cada
  // consulta y sería otra vez un UPDATE por consulta. La IP se pone al día en
  // el siguiente minuto (y la red nueva la avisa la #195).
  await query(
    `UPDATE mcp_tokens
        SET last_used_at = NOW(), last_used_ip = $2, last_used_cliente = $3
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute'
             OR last_used_cliente IS DISTINCT FROM $3)`,
    [tokenId, ip ? String(ip).slice(0, 64) : null, cliente ? String(cliente).slice(0, 200) : null]
  );
}

export async function listarTokens(userId) {
  const { rows } = await query(
    `SELECT id, nombre, prefijo, created_at, expires_at, last_used_at, revoked_at,
            last_used_ip, last_used_cliente, revocado_motivo,
            (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) AS vivo
       FROM mcp_tokens WHERE user_id = $1
        -- Los de un conector se ven y se renuevan en Conectores (migración 184).
        AND connector_id IS NULL
      ORDER BY (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) DESC, created_at DESC
      LIMIT 50`,
    [userId]
  );
  return rows;
}

export async function contarTokensVivos(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM mcp_tokens
      WHERE user_id = $1 AND connector_id IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );
  return rows[0].n;
}

export async function crearToken({ userId, nombre, hash, prefijo, dias, connectorId = null }) {
  const { rows } = await query(
    `INSERT INTO mcp_tokens (user_id, nombre, token_hash, prefijo, expires_at, connector_id)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() + make_interval(days => $5::int) END, $6)
     RETURNING id, nombre, prefijo, created_at, expires_at`,
    [userId, nombre, hash, prefijo, dias, connectorId]
  );
  return rows[0];
}

// ─── Tokens que nacen de un conector «Servidor MCP» (migración 184) ────────

/**
 * Lo que deja ver un conector: `null` si ya no existe o está apagado (la URL
 * deja de valer), `{ ids: null }` si es de todo el sistema, y si no sus campus.
 * Se lee en CADA consulta: cambiar su «Para quién» vale desde la siguiente.
 */
export async function campusDelConector(connectorId) {
  const { rows: [c] } = await query(
    'SELECT alcance, issuer_id, project_id, active FROM project_connectors WHERE id = $1', [connectorId]);
  if (!c || !c.active) return null;
  if (c.alcance === 'sistema') return { ids: null };
  if (c.alcance === 'empresa') {
    const { rows } = await query('SELECT id FROM projects WHERE sociedad_emisora_id = $1', [c.issuer_id]);
    return { ids: rows.map((r) => Number(r.id)) };
  }
  return { ids: [Number(c.project_id)] };
}

/** La URL viva de una persona en cada conector (sin el token: solo su inicio). */
export async function tokensDeConectores(userId, connectorIds) {
  const { rows } = await query(
    `SELECT DISTINCT ON (connector_id) id, connector_id, prefijo, created_at, last_used_at, expires_at,
            (expires_at IS NULL OR expires_at > NOW()) AS vivo
       FROM mcp_tokens
      WHERE user_id = $1 AND connector_id = ANY($2::int[]) AND revoked_at IS NULL
      ORDER BY connector_id, created_at DESC`,
    [userId, connectorIds]
  );
  return rows;
}

/**
 * Todas las URLs vivas de la persona (sueltas y de conexiones), para la línea
 * de estado de «Código para Claude» (#192).
 */
export async function urlsVivasDeLaPersona(userId) {
  const { rows } = await query(
    `SELECT t.id, COALESCE(c.label, t.nombre) AS nombre
       FROM mcp_tokens t
       LEFT JOIN project_connectors c ON c.id = t.connector_id
      WHERE t.user_id = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())
      ORDER BY t.created_at`,
    [userId]
  );
  return rows;
}

/** Una URL por persona y conector: pedir otra revoca la anterior. */
export async function revocarTokensDelConector(userId, connectorId) {
  await query(
    `UPDATE mcp_tokens SET revoked_at = NOW(), revocado_motivo = 'conector'
      WHERE user_id = $1 AND connector_id = $2 AND revoked_at IS NULL`,
    [userId, connectorId]
  );
}

/** Revoca un token SUYO. Devuelve false si no existe o es de otra persona. */
export async function revocarToken(id, userId) {
  const { rowCount } = await query(
    `UPDATE mcp_tokens SET revoked_at = NOW(), revocado_motivo = 'manual'
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, userId]
  );
  return rowCount > 0;
}

/**
 * Personas a las que se puede dar o quitar el acceso. Un admin solo ve a
 * quien comparte algun campus con el; el super admin, a todos.
 */
/**
 * Revoca TODAS las URLs vivas de una persona (#194: al desactivarla). Devuelve
 * cuántas. Quitar la casilla de acceso NO llama a esto: eso solo pausa.
 */
export async function revocarTodasDeLaPersona(userId, motivo) {
  const { rowCount } = await query(
    `UPDATE mcp_tokens SET revoked_at = NOW(), revocado_motivo = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, motivo]
  );
  return rowCount;
}

// ─── Rotación (#194): lo que hace la vuelta diaria ────────────────────────

/**
 * Revoca las URLs que lleven `dias` sin usarse (o sin estrenar desde que se
 * crearon). Devuelve las revocadas, para el registro.
 */
export async function revocarSinUso(dias) {
  const { rows } = await query(
    `UPDATE mcp_tokens SET revoked_at = NOW(), revocado_motivo = 'sin_uso'
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
        -- Cuenta desde el último uso, desde que se creó o desde el despliegue de
        -- la #194 (rotacion_desde), lo que sea más reciente.
        AND GREATEST(COALESCE(last_used_at, created_at), rotacion_desde) < NOW() - make_interval(days => $1::int)
      RETURNING id, user_id, prefijo`,
    [dias]
  );
  return rows;
}

/**
 * Las URLs vivas que caducan dentro de `dias` y de las que aún no se ha avisado,
 * agrupadas por persona activa (un correo por persona, no uno por URL).
 */
export async function porCaducarSinAviso(dias) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.nombre, u.email,
            json_agg(json_build_object('id', t.id, 'nombre', t.nombre, 'prefijo', t.prefijo,
                                       'expires_at', t.expires_at,
                                       -- La de una conexión se renueva en esa conexión (#196 revisión).
                                       'conexion', c.label) ORDER BY t.expires_at) AS urls
       FROM mcp_tokens t JOIN users u ON u.id = t.user_id AND u.active
       LEFT JOIN project_connectors c ON c.id = t.connector_id
      WHERE t.revoked_at IS NULL AND t.aviso_caducidad_at IS NULL
        AND t.expires_at > NOW()
        AND t.expires_at <= NOW() + make_interval(days => $1::int)
      GROUP BY u.id, u.nombre, u.email`,
    [dias]
  );
  return rows;
}

export async function marcarAvisoCaducidad(ids) {
  await query(`UPDATE mcp_tokens SET aviso_caducidad_at = NOW() WHERE id = ANY($1::int[])`, [ids]);
}

export async function listarPersonas(quien) {
  const params = [];
  let filtro = '';
  if (quien.role !== 'superadmin') {
    params.push(quien.id);
    filtro = `AND EXISTS (
                SELECT 1 FROM user_projects a
                  JOIN user_projects b ON b.project_id = a.project_id
                 WHERE a.user_id = $1 AND a.active AND b.user_id = u.id AND b.active)`;
  }
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, COALESCE(u.usa_mcp, false) AS usa_mcp,
            (SELECT COUNT(*)::int FROM mcp_tokens t
              WHERE t.user_id = u.id AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW())) AS tokens_vivos,
            (SELECT MAX(t.last_used_at) FROM mcp_tokens t WHERE t.user_id = u.id) AS ultimo_uso
       FROM users u
      WHERE u.active = true AND u.role::text <> 'tutor' ${filtro}
      ORDER BY u.nombre`,
    params
  );
  return rows;
}

export async function comparteProyecto(userA, userB) {
  const { rows } = await query(
    `SELECT 1 FROM user_projects a
       JOIN user_projects b ON b.project_id = a.project_id
      WHERE a.user_id = $1 AND a.active AND b.user_id = $2 AND b.active
      LIMIT 1`,
    [userA, userB]
  );
  return rows.length > 0;
}

export async function setUsaMcp(userId, valor) {
  await query(`UPDATE users SET usa_mcp = $2, updated_at = NOW() WHERE id = $1`, [userId, !!valor]);
}

export async function registrarAuditoria({ userId, tokenId, herramienta, parametros, ok, error, duracionMs, origen = {} }) {
  // `origen` (#195): IP y cliente de la consulta, para la pantalla de Actividad
  // y para avisar de una IP o un cliente nuevos.
  await query(
    `INSERT INTO mcp_auditoria (user_id, token_id, herramienta, parametros, ok, error, duracion_ms, ip, cliente)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, tokenId, herramienta, parametros ? JSON.stringify(parametros) : null, ok, error || null, duracionMs,
      origen.ip ? String(origen.ip).slice(0, 64) : null, origen.cliente ? String(origen.cliente).slice(0, 200) : null]
  );
}

// ─── Utilidades de las consultas de datos ─────────────────────────────────

/**
 * Arranca un WHERE con el ambito ya puesto. Devuelve `add(sql, valor)`, que
 * sustituye `?` por el siguiente `$n`: asi ningun valor va pegado al SQL.
 */
function condiciones(colProyecto, projectIds) {
  const cond = [`${colProyecto} = ANY($1::int[])`];
  const params = [projectIds];
  const add = (sql, ...valores) => {
    let s = sql;
    for (const v of valores) {
      params.push(v);
      s = s.replace('?', `$${params.length}`);
    }
    cond.push(s);
  };
  return { cond, params, add, where: () => 'WHERE ' + cond.join(' AND ') };
}

const paginado = (pagina = 1, limite = 25) => ({ limit: limite, offset: (pagina - 1) * limite });

const fechaLocal = (col) => `(${col} AT TIME ZONE '${TZ}')::date`;

// ─── Prospectos ───────────────────────────────────────────────────────────

function filtrosProspectos({ projectIds, responsableId, estado, texto, desde, hasta, canal }) {
  const f = condiciones('l.project_id', projectIds);
  f.cond.push('l.deleted_at IS NULL');
  if (responsableId) f.add('l.responsable_id = ?', responsableId);
  if (estado) f.add('l.status::text = ?', estado);
  if (canal) f.add('EXISTS (SELECT 1 FROM lead_utms cu WHERE cu.lead_id = l.id AND cu.canal_detectado::text = ?)', canal);
  if (texto) f.add(`(l.nombre ILIKE ? OR l.email ILIKE ? OR l.telefono ILIKE ?)`, `%${texto}%`, `%${texto}%`, `%${texto}%`);
  if (desde) f.add(`${fechaLocal('COALESCE(l.fecha_solicitud, l.created_at)')} >= ?::date`, desde);
  if (hasta) f.add(`${fechaLocal('COALESCE(l.fecha_solicitud, l.created_at)')} <= ?::date`, hasta);
  return f;
}

export async function buscarProspectos(filtros) {
  const f = filtrosProspectos(filtros);
  const { limit, offset } = paginado(filtros.pagina, filtros.limite);
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status AS estado,
            l.fecha_solicitud, l.project_id AS proyecto_id, p.nombre AS proyecto,
            pr.nombre AS producto_interes, u.nombre AS responsable,
            lu.canal_detectado AS canal,
            EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = l.id) AS es_cliente
       FROM leads l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
       LEFT JOIN users u ON u.id = l.responsable_id
       LEFT JOIN lead_utms lu ON lu.lead_id = l.id
      ${f.where()}
      ORDER BY COALESCE(l.fecha_solicitud, l.created_at) DESC, l.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    f.params
  );
  const { rows: c } = await query(`SELECT COUNT(*)::int AS total FROM leads l ${f.where()}`, f.params);
  return { total: c[0].total, pagina: filtros.pagina || 1, prospectos: rows };
}

export async function verProspecto({ id, projectIds, responsableId }) {
  const f = condiciones('l.project_id', projectIds);
  f.cond.push('l.deleted_at IS NULL');
  f.add('l.id = ?', id);
  if (responsableId) f.add('l.responsable_id = ?', responsableId);

  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status AS estado, l.notas,
            l.fecha_solicitud, l.created_at, l.project_id AS proyecto_id, p.nombre AS proyecto,
            pr.nombre AS producto_interes, u.nombre AS responsable,
            l.reincidente, l.lead_duplicado_de AS duplicado_de,
            lu.canal_detectado AS canal, lu.utm_source, lu.utm_medium, lu.utm_campaign
       FROM leads l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
       LEFT JOIN users u ON u.id = l.responsable_id
       LEFT JOIN lead_utms lu ON lu.lead_id = l.id
      ${f.where()}`,
    f.params
  );
  const prospecto = rows[0];
  if (!prospecto) return null;

  const [{ rows: interacciones }, { rows: ventas }] = await Promise.all([
    query(
      `SELECT li.tipo, li.nota, li.fecha, u.nombre AS por
         FROM lead_interactions li
         LEFT JOIN users u ON u.id = li.created_by
        WHERE li.lead_id = $1
        ORDER BY li.fecha DESC LIMIT 20`,
      [id]
    ),
    query(
      `SELECT c.id, c.fecha_conversion, c.producto_contratado AS producto, c.importe_total,
              COALESCE((SELECT SUM(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = c.id), 0) AS cobrado
         FROM conversions c
        WHERE c.lead_id = $1 AND c.project_id = ANY($2::int[])
        ORDER BY c.fecha_conversion DESC`,
      [id, projectIds]
    ),
  ]);
  return { ...prospecto, ultimas_interacciones: interacciones, ventas };
}

export async function resumenProspectos(filtros) {
  const f = filtrosProspectos(filtros);
  const [{ rows: porEstado }, { rows: porCanal }, { rows: porProyecto }] = await Promise.all([
    query(`SELECT l.status AS estado, COUNT(*)::int AS total FROM leads l ${f.where()} GROUP BY 1 ORDER BY 2 DESC`, f.params),
    query(
      `SELECT COALESCE(lu.canal_detectado::text, 'sin_canal') AS canal, COUNT(*)::int AS total
         FROM leads l LEFT JOIN lead_utms lu ON lu.lead_id = l.id
        ${f.where()} GROUP BY 1 ORDER BY 2 DESC`,
      f.params
    ),
    query(
      `SELECT p.nombre AS proyecto, COUNT(*)::int AS total
         FROM leads l JOIN projects p ON p.id = l.project_id
        ${f.where()} GROUP BY 1 ORDER BY 2 DESC`,
      f.params
    ),
  ]);
  const total = porEstado.reduce((s, r) => s + r.total, 0);
  return { total, por_estado: porEstado, por_canal: porCanal, por_proyecto: porProyecto };
}

// ─── Ventas ───────────────────────────────────────────────────────────────

const COBRADO = `COALESCE((SELECT SUM(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = c.id), 0)`;

function filtrosVentas({ projectIds, responsableId, desde, hasta, texto, pendiente }) {
  const f = condiciones('c.project_id', projectIds);
  // Las mensualidades son cuotas de una venta, no ventas: la pantalla de
  // Ventas tampoco las cuenta.
  f.cond.push('NOT COALESCE(c.es_mensualidad, false)');
  if (responsableId) {
    f.add('EXISTS (SELECT 1 FROM conversion_reparto r WHERE r.conversion_id = c.id AND r.vendedora_id = ?)', responsableId);
  }
  if (desde) f.add('c.fecha_conversion >= ?::date', desde);
  if (hasta) f.add('c.fecha_conversion <= ?::date', hasta);
  if (texto) f.add('(c.producto_contratado ILIKE ? OR l.nombre ILIKE ?)', `%${texto}%`, `%${texto}%`);
  if (pendiente === true) f.cond.push(`${COBRADO} < c.importe_total`);
  if (pendiente === false) f.cond.push(`${COBRADO} >= c.importe_total`);
  return f;
}

export async function listarVentas(filtros) {
  const f = filtrosVentas(filtros);
  const { limit, offset } = paginado(filtros.pagina, filtros.limite);
  const { rows } = await query(
    `SELECT c.id, c.fecha_conversion, c.producto_contratado AS producto,
            c.importe_total, ${COBRADO} AS cobrado,
            c.importe_total - ${COBRADO} AS pendiente,
            c.fecha_compromiso_pago, c.metodo_pago,
            c.lead_id AS prospecto_id, l.nombre AS cliente,
            c.project_id AS proyecto_id, p.nombre AS proyecto,
            v.nombre AS vendedora
       FROM conversions c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users v ON v.id = COALESCE(c.vendedora_id, l.responsable_id)
      ${f.where()}
      ORDER BY c.fecha_conversion DESC, c.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    f.params
  );
  const { rows: c } = await query(
    `SELECT COUNT(*)::int AS total FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id ${f.where()}`,
    f.params
  );
  return { total: c[0].total, pagina: filtros.pagina || 1, ventas: rows };
}

export async function resumenVentas(filtros) {
  const f = filtrosVentas(filtros);
  const { rows } = await query(
    `SELECT p.nombre AS proyecto,
            COUNT(*)::int AS ventas,
            COALESCE(SUM(c.importe_total), 0) AS importe_vendido,
            COALESCE(SUM(${COBRADO}), 0) AS cobrado
       FROM conversions c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
      ${f.where()}
      GROUP BY p.nombre ORDER BY importe_vendido DESC`,
    f.params
  );
  const n = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return {
    ventas: n('ventas'),
    importe_vendido: n('importe_vendido'),
    cobrado: n('cobrado'),
    pendiente: n('importe_vendido') - n('cobrado'),
    por_proyecto: rows,
  };
}

// ─── Facturas ─────────────────────────────────────────────────────────────

function filtrosFacturas({ projectIds, responsableId, estado, tipo, texto, desde, hasta }) {
  const f = condiciones('i.project_id', projectIds);
  // Igual que el listado de Facturas: la gestora ve las de lo que vendio ella.
  if (responsableId) f.add('COALESCE(cv.vendedora_id, l.responsable_id) = ?', responsableId);
  if (estado) f.add('i.estado::text = ?', estado);
  if (tipo) f.add('i.tipo::text = ?', tipo);
  if (texto) f.add('(i.cliente_nombre ILIKE ? OR i.codigo ILIKE ?)', `%${texto}%`, `%${texto}%`);
  if (desde) f.add('i.fecha_emision >= ?::date', desde);
  if (hasta) f.add('i.fecha_emision <= ?::date', hasta);
  return f;
}

const JOINS_FACTURA = `
  LEFT JOIN conversions cv ON cv.id = i.conversion_id
  LEFT JOIN leads l ON l.id = COALESCE(i.lead_id, cv.lead_id)`;

export async function listarFacturas(filtros) {
  const f = filtrosFacturas(filtros);
  const { limit, offset } = paginado(filtros.pagina, filtros.limite);
  const { rows } = await query(
    `SELECT i.id, i.codigo, i.tipo, i.estado, i.fecha_emision, i.fecha_pago,
            i.cliente_nombre, i.total, i.moneda,
            i.conversion_id AS venta_id, i.project_id AS proyecto_id, p.nombre AS proyecto,
            i.issuer_razon_social AS empresa, u.nombre AS gestora
       FROM invoices i
       JOIN projects p ON p.id = i.project_id
       ${JOINS_FACTURA}
       LEFT JOIN users u ON u.id = COALESCE(cv.vendedora_id, l.responsable_id, i.created_by)
      ${f.where()}
      ORDER BY i.fecha_emision DESC NULLS LAST, i.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    f.params
  );
  const { rows: c } = await query(`SELECT COUNT(*)::int AS total FROM invoices i ${JOINS_FACTURA} ${f.where()}`, f.params);
  return { total: c[0].total, pagina: filtros.pagina || 1, facturas: rows };
}

export async function resumenFacturas(filtros) {
  const f = filtrosFacturas(filtros);
  // Las proformas son presupuestos: no suman como facturado (igual que getStats).
  f.cond.push(`i.tipo::text <> 'proforma'`);
  const { rows } = await query(
    `SELECT i.estado, COUNT(*)::int AS facturas, COALESCE(SUM(i.total), 0) AS importe
       FROM invoices i ${JOINS_FACTURA}
      ${f.where()}
      GROUP BY i.estado ORDER BY 2 DESC`,
    f.params
  );
  const facturado = rows.filter((r) => !['borrador', 'cancelada'].includes(r.estado))
    .reduce((s, r) => s + Number(r.importe), 0);
  const cobrado = rows.filter((r) => r.estado === 'pagada').reduce((s, r) => s + Number(r.importe), 0);
  return { total_facturado: facturado, total_cobrado: cobrado, por_estado: rows };
}

// ─── Cobros pendientes ────────────────────────────────────────────────────

/**
 * Reutiliza «Cuentas por cobrar» tal cual, para dar el mismo numero que la
 * pantalla. Esa funcion es de UN proyecto, asi que se llama una vez por campus
 * y se juntan; son pocos campus por persona.
 *
 * OJO: esa pantalla se fia de `conversions.importe_pagado`, y `listarVentas`
 * suma `conversion_payments`. Una venta marcada como pagada sin pagos
 * registrados sale pendiente en una y no en la otra (visto con Claude el 28/09
 * en local: 2.300 € aqui frente a 6.340 € en ventas). No se arregla aqui porque
 * es la logica de dinero de la pantalla; la descripcion de la herramienta se lo
 * explica a Claude.
 */
export async function cobrosPendientes({ projectIds, responsableId, desde, hasta, limite = 50 }) {
  const partes = await Promise.all(
    projectIds.map((projectId) => getReceivable({ projectId, responsableId, from: desde || null, to: hasta || null }))
  );
  const items = partes.flatMap((p) => p.items)
    .sort((a, b) => String(a.vence || '9999').localeCompare(String(b.vence || '9999')));
  const suma = (lista) => lista.reduce((s, r) => s + Number(r.importe || 0), 0);
  const vencidos = items.filter((r) => r.vencido);
  return {
    total_pendiente: suma(items),
    total_vencido: suma(vencidos),
    cobros: items.length,
    cobros_vencidos: vencidos.length,
    detalle: items.slice(0, limite).map((r) => ({
      tipo: r.tipo, venta_id: r.conversion_id, prospecto_id: r.lead_id, cliente: r.cliente,
      producto: r.producto, proyecto: r.proyecto_nombre, gestora: r.gestora_nombre,
      cuota: r.cuota_numero, importe: r.importe, vence: r.vence, vencido: r.vencido,
    })),
  };
}

// ── Tutores ─────────────────────────────────────────────────────────────────
//
// Carlos, 01/10: «la conexión crm-claude no exporta los datos de tutores». No
// habia ninguna herramienta: Claude solo veia prospectos, ventas y facturas.
//
// Lo que NO sale, a proposito: DNI, IBAN, banco, telefono y notas del perfil.
// Para contestar quien da que curso, a que porcentaje y cuanto se le debe no
// hacen falta, y por una conversacion con Claude no tienen por que viajar.

/**
 * Lo entregado de una colaboracion, con el MISMO texto que la columna Entregado
 * de Comisiones (`Entregables` en solo lectura): «Foto y Vídeo · 50% módulos» o
 * «sin entregar». Y lo que falta, para contestar «¿a quien se le puede pagar ya?»
 * (#207, Manuel 02/10). Completo es foto, video y los modulos al 100 %.
 */
export function entregadoDe(c) {
  const foto = Boolean(c?.entrego_foto);
  const video = Boolean(c?.entrego_video);
  const pct = Number(c?.modulos_pct || 0);
  const puestas = [];
  if (foto && video) puestas.push('Foto y Vídeo');
  else if (foto) puestas.push('Foto corporativa');
  else if (video) puestas.push('Vídeo');
  if (pct) puestas.push(pct === 100 ? '100% completo' : `${pct}% módulos`);
  const falta = [];
  if (!foto) falta.push('foto corporativa');
  if (!video) falta.push('vídeo');
  if (pct < 100) falta.push(pct ? `módulos (va por el ${pct} %)` : 'módulos');
  return {
    entrego_foto: foto,
    entrego_video: video,
    modulos_pct: pct,
    entregado: puestas.length ? puestas.join(' · ') : 'sin entregar',
    falta,
    todo_entregado: falta.length === 0,
  };
}

/**
 * Los tutores de unos campus, cada uno con sus cursos, su porcentaje y lo que ha
 * entregado de cada uno. Con `solo_entregas_pendientes`, solo los tutores a los
 * que les falta algo en un curso que siguen dando, y de ellos solo esos cursos.
 */
export async function tutoresConCursos({ projectIds, incluir_retirados = false, texto = null, solo_entregas_pendientes = false }) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.active AS activo,
            (SELECT string_agg(DISTINCT pr.nombre, ' · ' ORDER BY pr.nombre)
               FROM user_projects up JOIN projects pr ON pr.id = up.project_id
              WHERE up.user_id = u.id AND up.project_id = ANY($1::int[])) AS campus,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'curso', p.nombre, 'campus', pr.nombre, 'pct', c.pct,
                       'desde', c.vigente_desde, 'hasta', c.vigente_hasta,
                       'activa', c.activa, 'rige_hoy', ${RIGE_HOY('c')},
                       'entrego_foto', c.entrego_foto, 'entrego_video', c.entrego_video,
                       'modulos_pct', c.modulos_pct)
                     ORDER BY pr.nombre, p.nombre, c.vigente_desde DESC)
                FROM tutor_collaborations c
                JOIN products p ON p.id = c.product_id
                JOIN projects pr ON pr.id = p.project_id
               WHERE c.tutor_id = u.id AND p.project_id = ANY($1::int[])), '[]'::json) AS cursos
       FROM users u
      WHERE u.role = 'tutor'
        AND ($2::boolean OR u.active)
        AND EXISTS (SELECT 1 FROM user_projects up2
                     WHERE up2.user_id = u.id AND up2.project_id = ANY($1::int[]))
        AND ($3::text IS NULL
             OR u.nombre ILIKE '%' || $3 || '%'
             OR u.email ILIKE '%' || $3 || '%'
             OR EXISTS (SELECT 1 FROM tutor_collaborations c2
                          JOIN products p2 ON p2.id = c2.product_id
                         WHERE c2.tutor_id = u.id AND p2.project_id = ANY($1::int[])
                           AND p2.nombre ILIKE '%' || $3 || '%'))
      ORDER BY u.nombre`,
    [projectIds, Boolean(incluir_retirados), texto || null]
  );
  // Pendiente cuenta solo en los cursos que no se le han retirado: a quien ya no
  // da un curso no hay que pedirle la foto de ese curso.
  const pendiente = (c) => c.activa && !c.todo_entregado;
  let tutores = rows.map((t) => {
    const cursos = (t.cursos || []).map((c) => ({ ...c, ...entregadoDe(c) }));
    return { ...t, cursos, cursos_con_entregas_pendientes: cursos.filter(pendiente).length };
  });
  if (solo_entregas_pendientes) {
    tutores = tutores
      .filter((t) => t.cursos_con_entregas_pendientes > 0)
      .map((t) => ({ ...t, cursos: t.cursos.filter(pendiente) }));
  }
  return { total: tutores.length, tutores };
}

/**
 * Lo que se le debe y lo pagado a cada tutor, por mes. El mismo calculo que la
 * pantalla Comisiones (`resumenComisiones`): por pagar es todo lo que no esta
 * pagado ni revertido. Un mes (`periodo`) o un tramo (`desde`–`hasta`, AAAA-MM).
 *
 * «generado» es todo lo que le corresponde menos lo revertido (#207). En ISEIE
 * no hay «Avisar tutor», asi que tampoco la fecha del aviso.
 *
 * «cursos» es lo entregado de cada curso de esas lineas, leido de la misma
 * colaboracion que pinta la columna Entregado de la pantalla. «se_puede_pagar»:
 * queda algo por pagar y esta todo entregado (#207, Manuel 02/10).
 */
export async function comisionesDeTutores({ projectIds, periodo = null, desde = null, hasta = null, tutor_id = null, solo_entregas_pendientes = false }) {
  const de = periodo || desde || null;
  const a = periodo || hasta || null;
  const { rows } = await query(
    `SELECT tc.periodo, tc.tutor_id, u.nombre AS tutor,
            COUNT(*)::int AS lineas,
            COALESCE(SUM(tc.base_calculo), 0)::float AS base,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado <> 'revertida'), 0)::float AS generado,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado NOT IN ('pagada', 'revertida')), 0)::float AS por_pagar,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'pagada'), 0)::float AS pagado,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'revertida'), 0)::float AS revertido,
            MAX(tc.fecha_liquidacion) AS ultima_liquidacion,
            jsonb_agg(DISTINCT jsonb_build_object(
              'curso', p.nombre, 'campus', pr.nombre,
              'entrego_foto', col.entrego_foto, 'entrego_video', col.entrego_video,
              'modulos_pct', col.modulos_pct)) AS cursos
       FROM tutor_commissions tc
       JOIN users u ON u.id = tc.tutor_id
       JOIN products p ON p.id = tc.product_id
       JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN tutor_collaborations col ON col.id = tc.collaboration_id
      WHERE p.project_id = ANY($1::int[])
        AND ($2::text IS NULL OR tc.periodo >= $2)
        AND ($3::text IS NULL OR tc.periodo <= $3)
        AND ($4::int IS NULL OR tc.tutor_id = $4)
      GROUP BY tc.periodo, tc.tutor_id, u.nombre
      ORDER BY tc.periodo DESC, u.nombre`,
    [projectIds, de, a, tutor_id || null]
  );
  let filas = rows.map((r) => {
    const cursos = (r.cursos || [])
      .map((c) => ({ curso: c.curso, campus: c.campus, ...entregadoDe(c) }))
      .sort((x, y) => `${x.campus} ${x.curso}`.localeCompare(`${y.campus} ${y.curso}`, 'es'));
    const pendientes = cursos.filter((c) => !c.todo_entregado).length;
    return {
      ...r,
      cursos,
      cursos_con_entregas_pendientes: pendientes,
      se_puede_pagar: Number(r.por_pagar) > 0 && pendientes === 0,
    };
  });
  if (solo_entregas_pendientes) filas = filas.filter((r) => r.cursos_con_entregas_pendientes > 0);
  const suma = (k) => Math.round(filas.reduce((t, r) => t + Number(r[k] || 0), 0) * 100) / 100;
  return {
    periodo: periodo || (de || a ? `${de || 'el principio'} a ${a || 'hoy'}` : 'todos los meses'),
    totales: { generado: suma('generado'), por_pagar: suma('por_pagar'), pagado: suma('pagado'), revertido: suma('revertido') },
    filas,
  };
}

/**
 * Las formaciones que se venden y no tienen tutor: la MISMA consulta que la
 * pantalla «Cursos sin tutor» (#207). Por defecto, desde el corte, como allí.
 * Se devuelve lo que sirve para contestar; lo de los anuncios de Meta, no.
 */
export async function formacionesSinTutorDe({ projectIds, incluir_anteriores_al_corte = false }) {
  const filas = await formacionesSinTutor({ projectIds, desdeElCorte: !incluir_anteriores_al_corte });
  return {
    total: filas.length,
    formaciones: filas.map((f) => ({
      id: f.id, curso: f.nombre, campus: f.proyecto, precio: f.precio,
      ventas: f.ventas, alumnos: f.alumnos, cobrado: Number(f.cobrado || 0),
      ultima_venta: f.ultima_venta, antes_del_corte: f.antes_del_corte,
      buscando_tutor: f.buscando, nota_de_la_busqueda: f.busqueda_nota,
    })),
  };
}

// ─── El catálogo de cada campus (#215) ────────────────────────────────────
//
// Carlos (05/10): «¿cuánto cuesta el Máster X en Psiko?» o «dame los precios de
// los cursos de CEDIA», con los mismos datos que la pantalla de Productos. Solo
// las formaciones activas, como la pantalla. Nada de ventas ni de `stripe_link`.
//
// ESTA CONSULTA ES LA DE ISEIE. La de MultiCRM devuelve además `modalidad`: la
// ficha de Diego (05/10) la pide solo allí. (Comprobado el 06/10: aquí la crea
// la migración 002 y la usa la pantalla de Productos, pero se sigue la ficha.)
// `brochure_url`, que solo tiene ISEIE, no se pide.

// Sin tildes ni mayúsculas, a mano con translate() como en MultiCRM: `unaccent`
// no está en todas las bases (la local de ISEIE no la tiene; ver sales.service).
const SIN_TILDES = (col) => `translate(lower(${col}), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc')`;
const sinTildes = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Lo que escriba Claude se busca tal cual: un «%» o un «_» no son comodines.
// Se escapan con la barra, que es el escape por defecto de LIKE (#262): antes
// la plantilla dejaba el texto literal «${c}» y buscar «100%» no encontraba nada.
export const comoTexto = (s) => sinTildes(s).replace(/[\\%_]/g, (c) => '\\' + c);
const numero = (v) => (v == null ? null : Number(v));
// «Sin precio» es que no lo tiene o que es 0: ninguna formación cuesta 0 €.
const CON_PRECIO = (col) => `(${col} IS NOT NULL AND ${col} > 0)`;

/** Por encima de esto, sin texto, se pide acotar: el catálogo entero no cabe en una respuesta. */
export const AVISO_FORMACIONES = 100;

export async function listarFormaciones({ projectIds, texto, pagina = 1, limite = 25 }) {
  const f = condiciones('p.project_id', projectIds);
  f.cond.push('p.active = true');
  if (texto) f.add(`${SIN_TILDES('p.nombre')} LIKE ?`, `%${comoTexto(texto)}%`);
  const { limit, offset } = paginado(pagina, limite);
  const { rows } = await query(
    `SELECT p.id, p.nombre AS curso, pr.nombre AS campus, p.project_id AS campus_id,
            p.precio, p.moneda, p.url_info AS enlace
       FROM products p
       JOIN projects pr ON pr.id = p.project_id
      ${f.where()}
      ORDER BY pr.nombre, p.nombre, p.id
      LIMIT ${limit} OFFSET ${offset}`,
    f.params
  );
  const { rows: porCampus } = await query(
    `SELECT pr.nombre AS campus, COUNT(*)::int AS formaciones
       FROM products p JOIN projects pr ON pr.id = p.project_id
      ${f.where()}
      GROUP BY pr.nombre ORDER BY COUNT(*) DESC, pr.nombre`,
    f.params
  );
  const total = porCampus.reduce((s, c) => s + c.formaciones, 0);
  return {
    total,
    pagina,
    paginas: Math.max(1, Math.ceil(total / limite)),
    ...(porCampus.length > 1 ? { por_campus: porCampus } : {}),
    // Sin texto y con muchas, Claude tiene que saber que esto es solo un trozo.
    ...(!texto && total > AVISO_FORMACIONES ? {
      aviso: `Hay ${total} formaciones${porCampus.length === 1 ? ` en ${porCampus[0].campus}` : ` (${porCampus.map((c) => `${c.campus} ${c.formaciones}`).join(', ')})`}: `
        + 'pide un nombre (texto) o usa «resumen_catalogo».',
    } : {}),
    formaciones: rows.map((r) => ({ ...r, precio: numero(r.precio) })),
  };
}

export async function resumenCatalogo({ projectIds }) {
  const { rows } = await query(
    `SELECT pr.id AS campus_id, pr.nombre AS campus,
            COUNT(p.id)::int AS formaciones,
            MIN(p.precio) FILTER (WHERE ${CON_PRECIO('p.precio')}) AS precio_minimo,
            MAX(p.precio) FILTER (WHERE ${CON_PRECIO('p.precio')}) AS precio_maximo,
            -- El más habitual, solo si alguno SE REPITE. Con todos distintos no hay
            -- uno «más habitual», y MODE() devolvía el más bajo (prueba con Claude,
            -- 06/10: con 385, 490 y 560 decía «el más habitual: 385»).
            (SELECT x.precio FROM (
               SELECT p2.precio, COUNT(*) AS veces FROM products p2
                WHERE p2.project_id = pr.id AND p2.active = true AND ${CON_PRECIO('p2.precio')}
                GROUP BY p2.precio HAVING COUNT(*) > 1
                ORDER BY COUNT(*) DESC, p2.precio LIMIT 1) x) AS precio_mas_habitual,
            COALESCE(ARRAY_AGG(DISTINCT p.moneda) FILTER (WHERE p.moneda IS NOT NULL), '{}') AS monedas,
            COUNT(p.id) FILTER (WHERE NOT ${CON_PRECIO('p.precio')})::int AS sin_precio,
            COUNT(p.id) FILTER (WHERE p.url_info IS NULL OR btrim(p.url_info) = '')::int AS sin_enlace
       FROM projects pr
       LEFT JOIN products p ON p.project_id = pr.id AND p.active = true
      WHERE pr.id = ANY($1::int[])
      GROUP BY pr.id, pr.nombre
      ORDER BY pr.nombre`,
    [projectIds]
  );
  return {
    total_formaciones: rows.reduce((s, r) => s + r.formaciones, 0),
    campus: rows.map((r) => ({
      ...r,
      precio_minimo: numero(r.precio_minimo),
      precio_maximo: numero(r.precio_maximo),
      precio_mas_habitual: numero(r.precio_mas_habitual),
    })),
  };
}

/** La ficha de una formación, o null si no existe. El ámbito lo mira quien llama. */
export async function verFormacion(id) {
  const { rows: [r] } = await query(
    `SELECT p.id, p.nombre AS curso, pr.nombre AS campus, p.project_id AS campus_id, p.active AS activa,
            p.precio, p.moneda, p.url_info AS enlace, p.duracion, p.horas,
            cat.nombre AS categoria, sub.nombre AS subcategoria,
            p.plazas_totales,
            -- Las libres, solo si hay totales: sin totales no se sabe (Diego, 05/10).
            CASE WHEN p.plazas_totales IS NOT NULL
                 THEN GREATEST(p.plazas_totales - COALESCE(p.plazas_ocupadas_previas, 0), 0) END AS plazas_libres,
            p.fecha_cierre_convocatoria AS cierre_convocatoria,
            d.version AS dossier_version, d.created_at AS dossier_fecha,
            -- Del tutor, solo el NOMBRE: nunca su porcentaje ni lo que cobra.
            (SELECT string_agg(DISTINCT u.nombre, ', ')
               FROM tutor_collaborations c JOIN users u ON u.id = c.tutor_id
              WHERE c.product_id = p.id AND ${RIGE_HOY('c')}) AS tutor
       FROM products p
       JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN product_categories cat ON cat.id = p.categoria_id
       LEFT JOIN product_categories sub ON sub.id = p.subcategoria_id
       LEFT JOIN LATERAL (
         SELECT version, created_at FROM dossiers
          WHERE product_id = p.id AND active = true
          ORDER BY version DESC LIMIT 1
       ) d ON true
      WHERE p.id = $1`,
    [id]
  );
  if (!r) return null;
  return { ...r, precio: numero(r.precio), tiene_dossier: r.dossier_version != null };
}

// ─── Publicidad (#235) ────────────────────────────────────────────────────
//
// Lo que ya guarda el CRM en Publicidad (Meta, sincronizado cada 3 horas). El
// gasto se suma de `meta_campaigns_daily` igual que la pantalla (`getDashboard`
// y `listCampaignsForUI`), para que Claude dé la misma cifra.
//
// «Lo que venden» (Diego, 07/10): un prospecto cuenta para una campaña cuando
// trae esa campaña (`lead_utms.utm_campaign` = `meta_campaigns.campaign_id`).
// No se usan las asociaciones campaña ↔ formación (`getRoi`): están vacías. Los
// prospectos se cuentan por el día en que entraron, como la columna «Leads
// CRM» de la pantalla (`l.created_at::date`), y «compró» es que tiene alguna
// venta (sin contar las mensualidades, que son cuotas de una venta).

export const AVISO_LEADS_META = 'Los «leads» que da Meta no son fiables: en casi todas las cuentas salen a 0 aunque entran prospectos (#48). '
  + 'Los prospectos que el CRM puede atribuir a una campaña son «prospectos_atribuidos», y son un mínimo: solo los que traen la campaña.';

/** Las cuentas de Meta conectadas a esos campus. Nunca el token ni el error que devolvió Meta. */
export async function cuentasPublicitarias({ projectIds }) {
  const { rows } = await query(
    `SELECT a.id, a.project_id AS campus_id, pr.nombre AS campus,
            a.ad_account_id AS cuenta_meta, a.ad_account_nombre AS nombre, a.currency AS moneda,
            a.last_sync_status AS estado_sincronizacion, a.last_synced_at AS ultima_sincronizacion,
            a.backfill_done AS historico_cargado,
            (SELECT COUNT(*) FROM meta_campaigns mc
              WHERE mc.project_id = a.project_id AND mc.ad_account_id = a.ad_account_id)::int AS campanas
       FROM meta_ad_accounts a
       JOIN projects pr ON pr.id = a.project_id
      WHERE a.project_id = ANY($1::int[])
      ORDER BY pr.nombre, a.ad_account_nombre, a.id`,
    [projectIds]
  );
  return { total: rows.length, cuentas: rows };
}

/**
 * Lo que se puede decir de las ventas de cada campus, sin fechas: depende de lo
 * que traen sus prospectos, no del periodo (un mes sin prospectos no cambia que
 * el campus se pueda atribuir por campaña).
 *
 *   por_campaña            algún prospecto trae el id de una campaña suya;
 *   no_disponible          sus prospectos traen otra cosa en la campaña (el
 *                          código del webhook, «whk_…»), o no tiene Meta;
 *   solo_total_del_campus  sus prospectos no traen campaña: solo se puede
 *                          comparar el gasto con las ventas del campus entero.
 */
async function atribucionDeLosCampus(projectIds) {
  const { rows } = await query(
    `SELECT pr.id AS campus_id, pr.nombre AS campus,
            EXISTS (SELECT 1 FROM meta_ad_accounts a WHERE a.project_id = pr.id)
              OR EXISTS (SELECT 1 FROM meta_campaigns mc WHERE mc.project_id = pr.id) AS tiene_meta,
            EXISTS (SELECT 1 FROM meta_campaigns mc
                      JOIN lead_utms lu ON lu.utm_campaign = mc.campaign_id
                      JOIN leads l ON l.id = lu.lead_id AND l.project_id = pr.id AND l.deleted_at IS NULL
                     WHERE mc.project_id = pr.id) AS cruza,
            EXISTS (SELECT 1 FROM leads l
                      JOIN lead_utms lu ON lu.lead_id = l.id
                     WHERE l.project_id = pr.id AND l.deleted_at IS NULL
                       AND NULLIF(btrim(lu.utm_campaign), '') IS NOT NULL) AS traen_campana
       FROM projects pr
      WHERE pr.id = ANY($1::int[])
      ORDER BY pr.nombre`,
    [projectIds]
  );
  return rows.map((r) => {
    const base = { campus_id: r.campus_id, campus: r.campus, tiene_meta: r.tiene_meta };
    if (!r.tiene_meta) return { ...base, atribucion: 'no_disponible' };
    if (r.cruza) return { ...base, atribucion: 'por_campaña' };
    if (r.traen_campana) {
      return {
        ...base, atribucion: 'no_disponible',
        motivo: `Los prospectos de ${r.campus} no traen la campaña de Meta (traen otro código, como el del formulario «whk_…»): `
          + 'no se puede saber qué campaña vende. No es que no venda.',
      };
    }
    return {
      ...base, atribucion: 'solo_total_del_campus',
      motivo: `Los prospectos de ${r.campus} no traen la campaña: solo se puede comparar el gasto con las ventas de todo el campus, `
        + 'que no son todas de la publicidad.',
    };
  });
}

/** Desde/hasta sobre una columna de fecha, a partir de `$2`. */
function periodo(col, { desde, hasta }, params) {
  const cond = [];
  if (desde) { params.push(desde); cond.push(`${col} >= $${params.length}::date`); }
  if (hasta) { params.push(hasta); cond.push(`${col} <= $${params.length}::date`); }
  return cond.length ? ' AND ' + cond.join(' AND ') : '';
}

/**
 * Gasto y atribución de cada campaña de esos campus en el periodo. Las
 * campañas sin gasto ni prospectos en el periodo no salen.
 */
async function metricasDeCampanas({ projectIds, desde, hasta }) {
  const params = [projectIds];
  const enGasto = periodo('d.date', { desde, hasta }, params);
  const enProspectos = periodo('l.created_at::date', { desde, hasta }, params);
  const { rows } = await query(
    `WITH camp AS (
       SELECT mc.campaign_id, mc.project_id, mc.nombre, mc.objective, mc.status, mc.effective_status, mc.daily_budget,
              (SELECT a.currency FROM meta_ad_accounts a
                WHERE a.project_id = mc.project_id AND a.ad_account_id = mc.ad_account_id LIMIT 1) AS moneda
         FROM meta_campaigns mc
        WHERE mc.project_id = ANY($1::int[])
     ),
     gasto AS (
       SELECT d.campaign_id, SUM(d.spend) AS gasto, SUM(d.impressions) AS impresiones,
              SUM(d.clicks) AS clics, SUM(d.leads) AS leads_segun_meta
         FROM meta_campaigns_daily d
         JOIN camp ON camp.campaign_id = d.campaign_id
        WHERE TRUE${enGasto}
        GROUP BY d.campaign_id
     ),
     -- Una fila de UTM por prospecto (lead_utms.lead_id es UNIQUE) y sus ventas
     -- sumadas aparte: ningún JOIN multiplica nada. Solo los prospectos del
     -- campus de la campaña: uno de otro campus que trajera ese id contaría
     -- datos ajenos al ámbito de quien pregunta (revisión del 15/10).
     atrib AS (
       SELECT camp.campaign_id,
              COUNT(l.id) AS prospectos,
              COUNT(l.id) FILTER (WHERE v.ventas > 0) AS compraron,
              COALESCE(SUM(v.facturado), 0) AS facturado
         FROM camp
         JOIN lead_utms lu ON lu.utm_campaign = camp.campaign_id
         JOIN leads l ON l.id = lu.lead_id AND l.project_id = camp.project_id AND l.deleted_at IS NULL${enProspectos}
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS ventas, SUM(c.importe_total) AS facturado
             FROM conversions c
            WHERE c.lead_id = l.id AND NOT COALESCE(c.es_mensualidad, false)
         ) v ON TRUE
        GROUP BY camp.campaign_id
     )
     SELECT camp.campaign_id, camp.project_id, camp.nombre, camp.objective, camp.status, camp.effective_status,
            camp.daily_budget, camp.moneda, pr.nombre AS campus,
            COALESCE(g.gasto, 0) AS gasto, COALESCE(g.impresiones, 0) AS impresiones,
            COALESCE(g.clics, 0) AS clics, COALESCE(g.leads_segun_meta, 0) AS leads_segun_meta,
            COALESCE(a.prospectos, 0) AS prospectos, COALESCE(a.compraron, 0) AS compraron,
            COALESCE(a.facturado, 0) AS facturado
       FROM camp
       JOIN projects pr ON pr.id = camp.project_id
       LEFT JOIN gasto g ON g.campaign_id = camp.campaign_id
       LEFT JOIN atrib a ON a.campaign_id = camp.campaign_id
      WHERE COALESCE(g.gasto, 0) > 0 OR COALESCE(a.prospectos, 0) > 0
      ORDER BY COALESCE(g.gasto, 0) DESC, camp.nombre`,
    params
  );
  return rows.map((r) => ({
    ...r,
    daily_budget: numero(r.daily_budget),
    gasto: Number(r.gasto),
    impresiones: Number(r.impresiones),
    clics: Number(r.clics),
    leads_segun_meta: Number(r.leads_segun_meta),
    prospectos: Number(r.prospectos),
    compraron: Number(r.compraron),
    facturado: Number(r.facturado),
  }));
}

const redondeo = (n) => (n == null ? null : Math.round(n * 100) / 100);
const costePorVenta = (gasto, ventas) => (ventas > 0 ? redondeo(gasto / ventas) : null);

/** Los campos de la atribución: con números solo si se puede atribuir por campaña; si no, null y el motivo. */
function conAtribucion(a, { prospectos, compraron, facturado, gasto }) {
  if (a.atribucion !== 'por_campaña') {
    return {
      atribucion: a.atribucion,
      motivo: a.motivo,
      prospectos_atribuidos: null,
      ventas_atribuidas: null,
      ...(facturado !== undefined ? { facturado_atribuido: null } : {}),
      coste_por_venta: null,
    };
  }
  return {
    atribucion: a.atribucion,
    prospectos_atribuidos: prospectos,
    ventas_atribuidas: compraron,
    ...(facturado !== undefined ? { facturado_atribuido: redondeo(facturado) } : {}),
    coste_por_venta: costePorVenta(gasto, compraron),
  };
}

export async function resumenPublicidad({ projectIds, desde, hasta }) {
  const [atribuciones, campanas] = await Promise.all([
    atribucionDeLosCampus(projectIds),
    metricasDeCampanas({ projectIds, desde, hasta }),
  ]);
  // Las ventas del campus entero, para los que no se pueden atribuir por
  // campaña: por fecha de la venta, como «resumen_ventas».
  const params = [projectIds];
  const enVentas = periodo('c.fecha_conversion', { desde, hasta }, params);
  const { rows: ventasDelCampus } = await query(
    `SELECT c.project_id AS campus_id, COUNT(*)::int AS ventas, COALESCE(SUM(c.importe_total), 0) AS facturado
       FROM conversions c
      WHERE c.project_id = ANY($1::int[]) AND NOT COALESCE(c.es_mensualidad, false)${enVentas}
      GROUP BY c.project_id`,
    params
  );

  // Los campus sin Meta van juntos en una línea: con «Todos», a un super admin
  // le saldrían veinte bloques vacíos.
  const sinMeta = atribuciones.filter((a) => !a.tiene_meta);
  const campus = atribuciones.filter((a) => a.tiene_meta).map((a) => {
    const suyas = campanas.filter((c) => c.project_id === a.campus_id);
    const suma = (k) => suyas.reduce((s, c) => s + c[k], 0);
    const gasto = redondeo(suma('gasto'));
    const monedas = [...new Set(suyas.map((c) => c.moneda).filter(Boolean))];
    const fila = {
      campus_id: a.campus_id,
      campus: a.campus,
      monedas,
      gasto,
      impresiones: suma('impresiones'),
      clics: suma('clics'),
      leads_segun_meta: suma('leads_segun_meta'),
      ...conAtribucion(a, { prospectos: suma('prospectos'), compraron: suma('compraron'), facturado: suma('facturado'), gasto }),
    };
    // Con cuentas en monedas distintas, el gasto mezcla monedas: el coste por
    // venta no tendría sentido.
    if (monedas.length > 1) {
      fila.aviso_monedas = `Las cuentas de ${a.campus} tienen monedas distintas (${monedas.join(', ')}): el gasto suma cifras de monedas distintas.`;
      fila.coste_por_venta = null;
    }
    if (a.atribucion === 'solo_total_del_campus') {
      const v = ventasDelCampus.find((x) => x.campus_id === a.campus_id);
      fila.ventas_de_todo_el_campus = v ? v.ventas : 0;
      fila.facturado_de_todo_el_campus = v ? redondeo(Number(v.facturado)) : 0;
      fila.nota = 'Son TODAS las ventas del campus en el periodo, vengan o no de la publicidad.';
    }
    return fila;
  });

  const monedas = [...new Set(campus.flatMap((c) => c.monedas))];
  const atribuibles = campus.filter((c) => c.atribucion === 'por_campaña');
  // Sin ningún campus atribuible no hay total que dar: null, no un 0.
  const total = (k) => (atribuibles.length ? atribuibles.reduce((s, c) => s + c[k], 0) : null);
  const gastoAtribuible = redondeo(total('gasto'));
  return {
    desde: desde || null,
    hasta: hasta || null,
    aviso_leads_meta: AVISO_LEADS_META,
    ...(monedas.length > 1 ? { aviso_monedas: `Las cuentas tienen monedas distintas (${monedas.join(', ')}): el gasto total suma cifras de monedas distintas.` } : {}),
    totales: {
      gasto: redondeo(campus.reduce((s, c) => s + c.gasto, 0)),
      leads_segun_meta: campus.reduce((s, c) => s + c.leads_segun_meta, 0),
      // Solo de los campus que se pueden atribuir por campaña.
      campus_atribuibles: atribuibles.map((c) => c.campus),
      gasto_de_los_atribuibles: gastoAtribuible,
      prospectos_atribuidos: total('prospectos_atribuidos'),
      ventas_atribuidas: total('ventas_atribuidas'),
      facturado_atribuido: redondeo(total('facturado_atribuido')),
      coste_por_venta: monedas.length > 1 ? null : costePorVenta(gastoAtribuible, total('ventas_atribuidas')),
    },
    campus,
    ...(sinMeta.length ? {
      sin_cuenta_de_meta: {
        atribucion: 'no_disponible',
        motivo: 'No tienen ninguna cuenta de Meta conectada en el CRM: no hay gasto ni nada que atribuir.',
        campus: sinMeta.map((a) => a.campus),
      },
    } : {}),
  };
}

export async function campanasPublicitarias({ projectIds, desde, hasta, limite = 50 }) {
  const [atribuciones, campanas] = await Promise.all([
    atribucionDeLosCampus(projectIds),
    metricasDeCampanas({ projectIds, desde, hasta }),
  ]);
  const deCampus = new Map(atribuciones.map((a) => [a.campus_id, a]));
  const filas = campanas.slice(0, limite).map((c) => ({
    campaign_id: c.campaign_id,
    nombre: c.nombre,
    campus: c.campus,
    estado: c.effective_status || c.status,
    objetivo: c.objective,
    presupuesto_diario: c.daily_budget,
    moneda: c.moneda,
    gasto: redondeo(c.gasto),
    leads_segun_meta: c.leads_segun_meta,
    ...conAtribucion(deCampus.get(c.project_id), { prospectos: c.prospectos, compraron: c.compraron, gasto: c.gasto }),
  }));
  return {
    desde: desde || null,
    hasta: hasta || null,
    aviso_leads_meta: AVISO_LEADS_META,
    total: campanas.length,
    ...(campanas.length > limite ? { aviso: `Hay ${campanas.length} campañas con gasto o prospectos: estas son las ${limite} que más han gastado.` } : {}),
    campanas: filas,
  };
}

// ─── Actividad por comercial (#203, parte A) ──────────────────────────────
//
// Ficha de Diego del 07/10. Cada contacto cuenta para QUIÉN LO HIZO
// (`lead_interactions.created_by`), no para la dueña de la ficha: una llamada
// de Ana a un prospecto de Dayana es actividad de Ana. El día se corta a
// medianoche de Madrid. Las notas no son contactos: se dan aparte y no entran
// en «toques» ni en «personas» (contarlas inflaba «Trabajo hecho»: 729
// contactos cuando eran 312). Sin fichas borradas; los campus de pruebas ya no
// están en el ámbito.

/** «Hoy» en Madrid, AAAA-MM-DD. */
export const hoyEnMadrid = (ahora = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(ahora);

/** «Ayer» en Madrid, AAAA-MM-DD. */
export function ayerEnMadrid(ahora = new Date()) {
  const d = new Date(`${hoyEnMadrid(ahora)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function actividadPorComercial({ projectIds, responsableId = null, desde, hasta }) {
  const f = condiciones('l.project_id', projectIds);
  f.cond.push('l.deleted_at IS NULL');
  // Quien solo ve lo suyo se ve a sí misma: sus contactos, en la ficha que sea.
  if (responsableId) f.add('li.created_by = ?', responsableId);
  f.add(`${fechaLocal('li.fecha')} >= ?::date`, desde);
  f.add(`${fechaLocal('li.fecha')} <= ?::date`, hasta);
  const { rows: contactos } = await query(
    `SELECT u.id AS user_id, u.nombre AS comercial,
            COUNT(*) FILTER (WHERE li.tipo = 'llamada')::int  AS llamadas,
            COUNT(*) FILTER (WHERE li.tipo = 'whatsapp')::int AS whatsapp,
            COUNT(*) FILTER (WHERE li.tipo = 'email')::int    AS correos,
            COUNT(*) FILTER (WHERE li.tipo = 'nota')::int     AS notas,
            COUNT(DISTINCT li.lead_id) FILTER (WHERE li.tipo <> 'nota')::int AS personas,
            COUNT(*) FILTER (WHERE li.tipo <> 'nota')::int    AS toques
       FROM lead_interactions li
       JOIN leads l ON l.id = li.lead_id
       JOIN users u ON u.id = li.created_by
      ${f.where()}
      GROUP BY u.id, u.nombre`,
    f.params
  );
  // «Personas» del equipo no es la suma: dos comerciales pueden haber tocado a
  // la misma persona.
  const { rows: [eq] } = await query(
    `SELECT COUNT(DISTINCT li.lead_id) FILTER (WHERE li.tipo <> 'nota')::int AS personas
       FROM lead_interactions li
       JOIN leads l ON l.id = li.lead_id
      ${f.where()}`,
    f.params
  );

  // WhatsApp escrito y por voz (la issue: «sacados de `wa_mensajes`, que ya se
  // calcula para el equipo (#128)»). Las mismas reglas que `seguimientoYTiempos`:
  // solo lo SALIENTE (lo que hace la gestora, no lo que le mandan), «texto» es
  // escrito y «audio» es voz. Cuenta para quien lo mandó (`enviado_por`); lo que
  // no tiene autora va a «Sin asignar», para que el total cuadre (#128).
  const w = condiciones('l.project_id', projectIds);
  w.cond.push('l.deleted_at IS NULL', `m.direccion = 'saliente'`);
  if (responsableId) w.add('m.enviado_por = ?', responsableId);
  w.add(`${fechaLocal('m.ts')} >= ?::date`, desde);
  w.add(`${fechaLocal('m.ts')} <= ?::date`, hasta);
  const { rows: mensajes } = await query(
    `SELECT m.enviado_por AS user_id, u.nombre AS comercial,
            COUNT(*) FILTER (WHERE m.tipo = 'texto')::int AS whatsapp_texto,
            COUNT(*) FILTER (WHERE m.tipo = 'audio')::int AS whatsapp_voz
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
       JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = m.enviado_por
      ${w.where()}
      GROUP BY m.enviado_por, u.nombre`,
    w.params
  ).catch((err) => {
    // Sin las tablas de WhatsApp (un CRM donde no se ha instalado), sin desglose.
    if (err.code !== '42P01') throw err;
    return { rows: [] };
  });

  const CERO = { llamadas: 0, whatsapp: 0, whatsapp_texto: 0, whatsapp_voz: 0, correos: 0, notas: 0, personas: 0, toques: 0 };
  const porPersona = new Map();
  const de = (id, comercial) => {
    if (!porPersona.has(id)) porPersona.set(id, { comercial: comercial || 'Sin asignar', ...CERO });
    return porPersona.get(id);
  };
  for (const { user_id: id, comercial, ...n } of contactos) Object.assign(de(id, comercial), n);
  for (const m of mensajes) {
    const fila = de(m.user_id, m.comercial);
    fila.whatsapp_texto = m.whatsapp_texto;
    fila.whatsapp_voz = m.whatsapp_voz;
  }
  const filas = [...porPersona.values()].filter((r) => r.toques + r.notas + r.whatsapp_texto + r.whatsapp_voz > 0)
    .sort((a, b) => b.llamadas - a.llamadas || b.toques - a.toques || a.comercial.localeCompare(b.comercial, 'es'));
  const suma = (k) => filas.reduce((s, r) => s + r[k], 0);
  return {
    desde,
    hasta,
    filas,
    equipo: {
      llamadas: suma('llamadas'),
      whatsapp: suma('whatsapp'),
      whatsapp_texto: suma('whatsapp_texto'),
      whatsapp_voz: suma('whatsapp_voz'),
      correos: suma('correos'),
      notas: suma('notas'),
      personas: eq ? eq.personas : 0,
      toques: suma('toques'),
    },
  };
}
