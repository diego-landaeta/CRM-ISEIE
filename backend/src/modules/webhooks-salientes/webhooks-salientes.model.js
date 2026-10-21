import { query } from '../../shared/config/db.js';

/*
  SQL del webhook de transferencias (migración 206).

  El secreto cifrado (`secreto_cifrado`, `secreto_iv`, `secreto_tag`) solo sale
  de aquí por `conSecreto`, que es lo que usa el envío para firmar. Todo lo que
  va hacia la pantalla lo deja fuera.
*/

const COLUMNAS = `
  w.id, w.nombre, w.url, w.activo, w.ambito, w.issuer_id, w.project_id, w.metodos,
  w.secreto_cola, w.creado_por, w.actualizado_por, w.created_at, w.updated_at,
  p.nombre AS proyecto, s.razon_social AS empresa, u.nombre AS creado_por_nombre,
  (SELECT max(e.enviado_at) FROM webhooks_salientes_envios e
    WHERE e.webhook_id = w.id AND NOT e.prueba) AS ultimo_envio_at,
  (SELECT count(*)::int FROM webhooks_salientes_envios e
    WHERE e.webhook_id = w.id AND NOT e.prueba AND e.estado = 'fallido'
      AND e.created_at > NOW() - INTERVAL '30 days') AS fallidos_30_dias`;

const DESDE = `
  FROM webhooks_salientes w
  LEFT JOIN projects p ON p.id = w.project_id
  LEFT JOIN invoice_issuers s ON s.id = w.issuer_id
  LEFT JOIN users u ON u.id = w.creado_por`;

/**
 * Los webhooks que una persona puede gestionar, y de ellos los que tocan a lo
 * que tiene puesto arriba.
 *
 * `misCampus` null = super admin, todos. Un admin, los de sus campus y los de
 * una empresa en la que está ENTERA (todos sus campus): un webhook de empresa
 * manda los cobros de todos ellos, con los datos de sus clientes, y no puede
 * ver ni tocar uno que mande los de un campus que no es suyo. Los de «todas las
 * empresas», solo el super admin.
 *
 * `projectId` / `issuerId` (el selector de la cabecera): los que se disparan con
 * un cobro de ese campus o de esa empresa.
 */
export async function listar({ misCampus = null, projectId = null, issuerId = null } = {}) {
  const params = [];
  const conds = [];
  if (misCampus) {
    params.push(misCampus);
    const n = params.length;
    conds.push(`(
      (w.ambito = 'campus' AND w.project_id = ANY($${n}::int[]))
      OR (w.ambito = 'empresa'
          AND EXISTS (SELECT 1 FROM projects px WHERE px.sociedad_emisora_id = w.issuer_id)
          AND NOT EXISTS (SELECT 1 FROM projects px
                           WHERE px.sociedad_emisora_id = w.issuer_id AND NOT (px.id = ANY($${n}::int[])))))`);
  }
  if (projectId) {
    params.push(projectId);
    const n = params.length;
    // Un campus ve también los webhooks de los demás campus de SU empresa (Diego, 21/10: «los
    // hooks de empresas se pueden ver entre campus de la misma empresa»). Nunca los de otra.
    conds.push(`(w.ambito = 'todas'
      OR (w.ambito = 'campus' AND (w.project_id = $${n} OR w.project_id IN (
            SELECT pe.id FROM projects pe
             WHERE pe.sociedad_emisora_id = (SELECT sociedad_emisora_id FROM projects WHERE id = $${n}))))
      OR (w.ambito = 'empresa' AND w.issuer_id = (SELECT sociedad_emisora_id FROM projects WHERE id = $${n})))`);
  } else if (issuerId) {
    params.push(issuerId);
    const n = params.length;
    conds.push(`(w.ambito = 'todas'
      OR (w.ambito = 'empresa' AND w.issuer_id = $${n})
      OR (w.ambito = 'campus' AND w.project_id IN (SELECT id FROM projects WHERE sociedad_emisora_id = $${n})))`);
  }
  const { rows } = await query(
    `SELECT ${COLUMNAS} ${DESDE}
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY CASE w.ambito WHEN 'todas' THEN 0 WHEN 'empresa' THEN 1 ELSE 2 END, s.razon_social, p.nombre, w.id`,
    params
  );
  return rows;
}

export async function porId(id) {
  const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE w.id = $1`, [id]);
  return rows[0] || null;
}

/** El webhook con su secreto cifrado. Solo para firmar un envío. */
export async function conSecreto(id) {
  const { rows } = await query(
    `SELECT id, nombre, url, activo, metodos, secreto_cifrado, secreto_iv, secreto_tag
       FROM webhooks_salientes WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function crear(d) {
  const { rows } = await query(
    `INSERT INTO webhooks_salientes
       (nombre, url, secreto_cifrado, secreto_iv, secreto_tag, secreto_cola,
        activo, ambito, issuer_id, project_id, metodos, creado_por, actualizado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12, $12)
     RETURNING id`,
    [d.nombre, d.url, d.secreto.encrypted, d.secreto.iv, d.secreto.authTag, d.secreto.cola,
     d.activo, d.ambito, d.issuer_id ?? null, d.project_id ?? null, d.metodos, d.userId ?? null]
  );
  return porId(rows[0].id);
}

export async function cambiar(id, d) {
  const sets = [];
  const params = [];
  const poner = (col, valor, cast = '') => { params.push(valor); sets.push(`${col} = $${params.length}${cast}`); };
  for (const col of ['nombre', 'url', 'activo', 'ambito', 'issuer_id', 'project_id']) {
    if (d[col] !== undefined) poner(col, d[col]);
  }
  if (d.metodos !== undefined) poner('metodos', d.metodos, '::text[]');
  if (d.secreto) {
    poner('secreto_cifrado', d.secreto.encrypted);
    poner('secreto_iv', d.secreto.iv);
    poner('secreto_tag', d.secreto.authTag);
    poner('secreto_cola', d.secreto.cola);
  }
  poner('actualizado_por', d.userId ?? null);
  params.push(id);
  const { rowCount } = await query(
    `UPDATE webhooks_salientes SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params
  );
  return rowCount ? porId(id) : null;
}

export async function borrar(id) {
  await query('DELETE FROM webhooks_salientes WHERE id = $1', [id]);
}

/** Todos los campus de una empresa. */
export async function campusDeLaEmpresa(issuerId) {
  const { rows } = await query('SELECT id FROM projects WHERE sociedad_emisora_id = $1', [issuerId]);
  return rows.map((r) => Number(r.id));
}

export async function existeCampus(id) {
  const { rows } = await query('SELECT 1 FROM projects WHERE id = $1', [id]);
  return rows.length > 0;
}

export async function existeEmpresa(id) {
  const { rows } = await query('SELECT 1 FROM invoice_issuers WHERE id = $1', [id]);
  return rows.length > 0;
}

// ─── El cobro ───────────────────────────────────────────────────────────────

/**
 * Todo lo que va en el payload de un cobro, en una consulta.
 *
 * · La gestora es la de la venta y, si la venta no tiene, la de la ficha: el
 *   mismo COALESCE(vendedora_id, responsable_id) de todo el CRM (migración 150).
 * · La cuenta de destino es la de la empresa (la sociedad emisora del campus) y,
 *   si esa no tiene IBAN, la de un emisor propio del campus: es la misma que sale
 *   en la factura por transferencia (Carlos, 30/09: IBAN y debajo el BIC).
 * · La fecha va como texto: un DATE convertido a Date de JavaScript se puede
 *   correr un día con la zona horaria.
 */
export async function datosDelCobro(paymentId, userId = null) {
  const { rows } = await query(
    `SELECT cp.id, cp.importe, cp.fecha::text AS fecha, cp.metodo, cp.notas, cp.referencia,
            cp.moneda AS divisa_moneda, cp.importe_divisa,
            c.id AS venta_id, c.producto_contratado, c.producto_contratado_id, pr.nombre AS producto_catalogo,
            c.importe_total, c.importe_pagado,
            l.id AS cliente_id, l.nombre AS cliente_nombre, l.email AS cliente_email,
            l.telefono AS cliente_telefono, l.identificacion_fiscal AS cliente_dni,
            p.id AS campus_id, p.nombre AS campus_nombre, p.sociedad_emisora_id AS empresa_id,
            s.razon_social AS empresa_razon_social, s.nif AS empresa_nif,
            COALESCE(NULLIF(TRIM(s.iban), ''), ic.iban) AS iban,
            CASE WHEN NULLIF(TRIM(s.iban), '') IS NOT NULL THEN s.bic ELSE COALESCE(ic.bic, s.bic) END AS bic,
            g.id AS gestora_id, g.nombre AS gestora_nombre, g.email AS gestora_email,
            r.id AS registrado_id, r.nombre AS registrado_nombre, r.email AS registrado_email
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
       LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
       LEFT JOIN LATERAL (
         SELECT ii.iban, ii.bic FROM invoice_issuers ii
          WHERE ii.project_id = p.id AND ii.activo AND NULLIF(TRIM(ii.iban), '') IS NOT NULL
          ORDER BY ii.es_default DESC, ii.id LIMIT 1
       ) ic ON true
       LEFT JOIN users g ON g.id = COALESCE(c.vendedora_id, l.responsable_id)
       LEFT JOIN users r ON r.id = $2
      WHERE cp.id = $1`,
    [paymentId, userId]
  );
  return rows[0] || null;
}

/**
 * Para «Enviar prueba»: el campus, la empresa, la cuenta de destino y quien la lanza, de verdad.
 * Un webhook de empresa toma su primer campus; uno de «todas», nada (se queda de ejemplo). La
 * cuenta sale igual que en un cobro real (`datosDelCobro`).
 */
export async function datosParaPrueba({ projectId = null, issuerId = null, userId = null } = {}) {
  const { rows } = await query(
    `/* prueba del webhook */
     SELECT p.id AS campus_id, p.nombre AS campus_nombre,
            s.id AS empresa_id, s.razon_social AS empresa_razon_social, s.nif AS empresa_nif,
            COALESCE(NULLIF(TRIM(s.iban), ''), ic.iban) AS iban,
            CASE WHEN NULLIF(TRIM(s.iban), '') IS NOT NULL THEN s.bic ELSE COALESCE(ic.bic, s.bic) END AS bic,
            r.id AS registrado_id, r.nombre AS registrado_nombre, r.email AS registrado_email
       FROM (SELECT 1) AS uno
       LEFT JOIN projects p ON p.id = COALESCE($1::int,
            (SELECT pp.id FROM projects pp WHERE pp.sociedad_emisora_id = $2::int ORDER BY pp.id LIMIT 1))
       LEFT JOIN invoice_issuers s ON s.id = COALESCE($2::int, p.sociedad_emisora_id)
       LEFT JOIN LATERAL (
         SELECT ii.iban, ii.bic FROM invoice_issuers ii
          WHERE ii.project_id = p.id AND ii.activo AND NULLIF(TRIM(ii.iban), '') IS NOT NULL
          ORDER BY ii.es_default DESC, ii.id LIMIT 1
       ) ic ON true
       LEFT JOIN users r ON r.id = $3::int`,
    [projectId, issuerId, userId]
  );
  return rows[0] || {};
}

/** Los webhooks encendidos que se disparan con un cobro de esa forma, ese campus y esa empresa. */
export async function webhooksParaCobro({ metodo, projectId, issuerId }) {
  const { rows } = await query(
    `SELECT id FROM webhooks_salientes
      WHERE activo AND $1 = ANY(metodos)
        AND (ambito = 'todas'
             OR (ambito = 'empresa' AND issuer_id = $3)
             OR (ambito = 'campus' AND project_id = $2))
      ORDER BY id`,
    [metodo, projectId, issuerId ?? null]
  );
  return rows.map((r) => Number(r.id));
}

// ─── Los envíos ─────────────────────────────────────────────────────────────

/**
 * Apunta un envío. Si ya hay uno con esa clave —el mismo cobro al mismo
 * webhook—, no hace nada y devuelve null: así no se duplica aunque el cobro se
 * edite o se vuelva a disparar.
 */
export async function crearEnvio({ webhookId, paymentId = null, evento, idempotencyKey, prueba = false, payload }) {
  const { rows } = await query(
    `INSERT INTO webhooks_salientes_envios
       (webhook_id, payment_id, evento, idempotency_key, prueba, payload, estado, proximo_intento_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', NOW())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [webhookId, paymentId, evento, idempotencyKey, prueba, JSON.stringify(payload)]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Se queda con un envío para mandarlo, si está esperando y ya le toca. Dos
 * procesos no pueden coger el mismo: el que llega segundo no encuentra la fila
 * en «pendiente».
 */
export async function reclamarEnvio(id) {
  const { rows } = await query(
    `UPDATE webhooks_salientes_envios
        SET estado = 'enviando', intentos = intentos + 1, ultimo_intento_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
        AND (proximo_intento_at IS NULL OR proximo_intento_at <= NOW())
      RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function envioPorId(id) {
  const { rows } = await query('SELECT * FROM webhooks_salientes_envios WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function marcarEnviado(id, { httpStatus, respuesta }) {
  const { rows } = await query(
    `UPDATE webhooks_salientes_envios
        SET estado = 'enviado', http_status = $2, respuesta = $3, error = NULL,
            enviado_at = NOW(), proximo_intento_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, httpStatus, respuesta]
  );
  return rows[0] || null;
}

/** Un intento fallido: o vuelve a la cola para dentro de `reintentarEnMs`, o se da por fallido. */
export async function marcarFallo(id, { httpStatus = null, respuesta = null, error, reintentarEnMs = null }) {
  const { rows } = await query(
    `UPDATE webhooks_salientes_envios
        SET estado = CASE WHEN $5::int IS NULL THEN 'fallido' ELSE 'pendiente' END,
            http_status = $2, respuesta = $3, error = $4,
            proximo_intento_at = CASE WHEN $5::int IS NULL THEN NULL
                                      ELSE NOW() + ($5::int * INTERVAL '1 millisecond') END,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, httpStatus, respuesta, error, reintentarEnMs]
  );
  return rows[0] || null;
}

/** Un fallido vuelve a empezar: tres reintentos más, con la misma clave de idempotencia. */
export async function prepararReenvio(id, userId) {
  const { rows } = await query(
    `UPDATE webhooks_salientes_envios
        SET estado = 'pendiente', intentos = 0, error = NULL, proximo_intento_at = NOW(),
            reenviado_por = $2, reenviado_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND estado = 'fallido'
      RETURNING *`,
    [id, userId ?? null]
  );
  return rows[0] || null;
}

/** Los que esperan reintento y ya les toca. */
export async function pendientesQueTocan(limite = 20) {
  const { rows } = await query(
    `SELECT id FROM webhooks_salientes_envios
      WHERE estado = 'pendiente' AND proximo_intento_at <= NOW()
      ORDER BY proximo_intento_at, id
      LIMIT $1`,
    [limite]
  );
  return rows.map((r) => Number(r.id));
}

/**
 * Los que se quedaron «enviando» porque el proceso se reinició a mitad. Vuelven
 * a la cola si les quedan intentos; si no, fallidos.
 */
export async function rescatarAtascados(maxIntentos) {
  const { rowCount } = await query(
    `UPDATE webhooks_salientes_envios
        SET estado = CASE WHEN intentos >= $1 OR prueba THEN 'fallido' ELSE 'pendiente' END,
            proximo_intento_at = CASE WHEN intentos >= $1 OR prueba THEN NULL ELSE NOW() END,
            error = 'Se cortó a mitad del envío (reinicio del servidor)', updated_at = NOW()
      WHERE estado = 'enviando' AND ultimo_intento_at < NOW() - INTERVAL '5 minutes'`,
    [maxIntentos]
  );
  return rowCount;
}

/** Los últimos envíos, de los webhooks que la persona puede ver (`webhookIds` null = todos). */
/** Los campus del ámbito elegido arriba: los de una empresa, o los de la empresa del campus elegido. */
export async function campusDeContexto({ projectId = null, issuerId = null } = {}) {
  if (projectId) {
    const { rows: [p] } = await query('SELECT sociedad_emisora_id FROM projects WHERE id = $1', [projectId]);
    if (!p?.sociedad_emisora_id) return [Number(projectId)];
    issuerId = p.sociedad_emisora_id;
  }
  if (!issuerId) return null;
  const { rows } = await query('SELECT id FROM projects WHERE sociedad_emisora_id = $1', [issuerId]);
  return rows.map((r) => Number(r.id));
}

/**
 * Con `campusContexto` (una empresa o un campus elegidos arriba), un webhook «de todas las
 * empresas» solo enseña sus envíos de cobros de esos campus: sus pruebas y los cobros de otras
 * empresas no (Diego, 21/10: «los registros de Make de una empresa no se pueden ver en otra»).
 */
export async function listarEnvios({ webhookIds = null, webhookId = null, estado = null, limit = 50, campusContexto = null } = {}) {
  const params = [];
  const conds = [];
  if (webhookIds) { params.push(webhookIds); conds.push(`e.webhook_id = ANY($${params.length}::int[])`); }
  if (webhookId) { params.push(webhookId); conds.push(`e.webhook_id = $${params.length}`); }
  if (estado) { params.push(estado); conds.push(`e.estado = $${params.length}`); }
  if (campusContexto) {
    params.push(campusContexto);
    conds.push(`(w.ambito <> 'todas' OR e.payment_id IN (
      SELECT cp.id FROM conversion_payments cp JOIN conversions c ON c.id = cp.conversion_id
       WHERE c.project_id = ANY($${params.length}::int[])))`);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT e.id, e.webhook_id, w.nombre AS webhook_nombre, e.payment_id, e.evento, e.idempotency_key,
            e.prueba, e.payload, e.estado, e.http_status, e.respuesta, e.intentos, e.error,
            e.proximo_intento_at, e.ultimo_intento_at, e.enviado_at, e.reenviado_at,
            ru.nombre AS reenviado_por_nombre, e.created_at
       FROM webhooks_salientes_envios e
       JOIN webhooks_salientes w ON w.id = e.webhook_id
       LEFT JOIN users ru ON ru.id = e.reenviado_por
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}
