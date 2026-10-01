import { query } from '../../shared/config/db.js';
import { getReceivable } from '../accounting/accounting.model.js';
import { RIGE_HOY } from '../tutores/tutor.model.js';

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

export async function marcarUso(tokenId) {
  // Una vez por minuto basta: sin esto cada consulta de Claude es un UPDATE.
  await query(
    `UPDATE mcp_tokens SET last_used_at = NOW()
      WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '1 minute')`,
    [tokenId]
  );
}

export async function listarTokens(userId) {
  const { rows } = await query(
    `SELECT id, nombre, prefijo, created_at, expires_at, last_used_at, revoked_at,
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
    `SELECT DISTINCT ON (connector_id) connector_id, prefijo, created_at, last_used_at
       FROM mcp_tokens
      WHERE user_id = $1 AND connector_id = ANY($2::int[]) AND revoked_at IS NULL
      ORDER BY connector_id, created_at DESC`,
    [userId, connectorIds]
  );
  return rows;
}

/** Una URL por persona y conector: pedir otra revoca la anterior. */
export async function revocarTokensDelConector(userId, connectorId) {
  await query(
    `UPDATE mcp_tokens SET revoked_at = NOW()
      WHERE user_id = $1 AND connector_id = $2 AND revoked_at IS NULL`,
    [userId, connectorId]
  );
}

/** Revoca un token SUYO. Devuelve false si no existe o es de otra persona. */
export async function revocarToken(id, userId) {
  const { rowCount } = await query(
    `UPDATE mcp_tokens SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, userId]
  );
  return rowCount > 0;
}

/**
 * Personas a las que se puede dar o quitar el acceso. Un admin solo ve a
 * quien comparte algun campus con el; el super admin, a todos.
 */
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

export async function registrarAuditoria({ userId, tokenId, herramienta, parametros, ok, error, duracionMs }) {
  await query(
    `INSERT INTO mcp_auditoria (user_id, token_id, herramienta, parametros, ok, error, duracion_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, tokenId, herramienta, parametros ? JSON.stringify(parametros) : null, ok, error || null, duracionMs]
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

/** Los tutores de unos campus, cada uno con sus cursos y su porcentaje. */
export async function tutoresConCursos({ projectIds, incluir_retirados = false, texto = null }) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.active AS activo,
            (SELECT string_agg(DISTINCT pr.nombre, ' · ' ORDER BY pr.nombre)
               FROM user_projects up JOIN projects pr ON pr.id = up.project_id
              WHERE up.user_id = u.id AND up.project_id = ANY($1::int[])) AS campus,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'curso', p.nombre, 'campus', pr.nombre, 'pct', c.pct,
                       'desde', c.vigente_desde, 'hasta', c.vigente_hasta,
                       'activa', c.activa, 'rige_hoy', ${RIGE_HOY('c')})
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
  return { total: rows.length, tutores: rows };
}

/**
 * Lo que se le debe y lo pagado a cada tutor, por mes. El mismo calculo que la
 * pantalla Comisiones (`resumenComisiones`): por pagar es todo lo que no esta
 * pagado ni revertido.
 */
export async function comisionesDeTutores({ projectIds, periodo = null, tutor_id = null }) {
  const { rows } = await query(
    `SELECT tc.periodo, tc.tutor_id, u.nombre AS tutor,
            COUNT(*)::int AS lineas,
            COALESCE(SUM(tc.base_calculo), 0)::float AS base,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado NOT IN ('pagada', 'revertida')), 0)::float AS por_pagar,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'pagada'), 0)::float AS pagado,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'revertida'), 0)::float AS revertido,
            MAX(tc.fecha_liquidacion) AS ultima_liquidacion
       FROM tutor_commissions tc
       JOIN users u ON u.id = tc.tutor_id
       JOIN products p ON p.id = tc.product_id
      WHERE p.project_id = ANY($1::int[])
        AND ($2::text IS NULL OR tc.periodo = $2)
        AND ($3::int IS NULL OR tc.tutor_id = $3)
      GROUP BY tc.periodo, tc.tutor_id, u.nombre
      ORDER BY tc.periodo DESC, u.nombre`,
    [projectIds, periodo || null, tutor_id || null]
  );
  const suma = (k) => Math.round(rows.reduce((t, r) => t + Number(r[k] || 0), 0) * 100) / 100;
  return {
    periodo: periodo || 'todos los meses',
    totales: { por_pagar: suma('por_pagar'), pagado: suma('pagado'), revertido: suma('revertido') },
    filas: rows,
  };
}
