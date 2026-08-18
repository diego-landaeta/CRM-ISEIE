import { query, getClient } from '../../shared/config/db.js';

// ============================================================
// WEBHOOK + ROUND-ROBIN
// ============================================================

export async function findProjectBySlug(slug) {
  const { rows } = await query(
    `SELECT id, nombre, slug, webhook_api_key FROM projects WHERE slug = $1 AND active = true`,
    [slug]
  );
  return rows[0] || null;
}

export async function findDuplicateByEmail(email, projectId) {
  // Solo considera leads NO eliminados como duplicados normales.
  // Los eliminados por spam los detectamos aparte (findSpamMatch).
  const { rows } = await query(
    `SELECT id, nombre, email, status, producto_interes_id, responsable_id, created_at, fecha_solicitud
     FROM leads
     WHERE email = $1 AND project_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [email, projectId]
  );
  return rows[0] || null;
}

// Detecta duplicado por email O por telefono (E.164). Cualquiera que matchee
// se considera duplicado. Útil cuando el lead llega solo con tel (WhatsApp).
export async function findDuplicateByEmailOrPhone(email, telefono, projectId) {
  const cleanEmail = (email && email.trim()) || null;
  const cleanTel = (telefono && telefono.trim()) || null;
  if (!cleanEmail && !cleanTel) return null;

  // Comparación canónica MX/AR: dos formas del mismo número (con/sin "1"/"9"
  // de móvil) deben colapsar como duplicado. Generamos la forma canónica del
  // teléfono entrante y de cada candidato con CASE inline en SQL.
  const canonExpr = `
    CASE
      WHEN substring(replace(replace($3, '+', ''), ' ', '') from 1 for 3) = '521'
           AND length(replace(replace($3, '+', ''), ' ', '')) = 13
        THEN '+52' || substring(replace(replace($3, '+', ''), ' ', '') from 4)
      WHEN substring(replace(replace($3, '+', ''), ' ', '') from 1 for 3) = '549'
           AND length(replace(replace($3, '+', ''), ' ', '')) = 13
        THEN '+54' || substring(replace(replace($3, '+', ''), ' ', '') from 4)
      ELSE $3::text
    END
  `;
  const candidateCanonExpr = `
    CASE
      WHEN substring(replace(l.telefono, '+', '') from 1 for 3) = '521'
           AND length(replace(l.telefono, '+', '')) = 13
        THEN '+52' || substring(replace(l.telefono, '+', '') from 4)
      WHEN substring(replace(l.telefono, '+', '') from 1 for 3) = '549'
           AND length(replace(l.telefono, '+', '')) = 13
        THEN '+54' || substring(replace(l.telefono, '+', '') from 4)
      ELSE l.telefono
    END
  `;

  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.producto_interes_id,
            l.responsable_id, l.created_at, l.fecha_solicitud,
            u.nombre AS responsable_nombre,
            ($2::text IS NOT NULL AND l.email = $2) AS match_by_email,
            ($3::text IS NOT NULL AND ${candidateCanonExpr} = ${canonExpr}) AS match_by_phone
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     WHERE l.project_id = $1 AND l.deleted_at IS NULL
       AND (
         ($2::text IS NOT NULL AND l.email = $2)
         OR ($3::text IS NOT NULL AND ${candidateCanonExpr} = ${canonExpr})
       )
     ORDER BY ($2::text IS NOT NULL AND l.email = $2) DESC, l.created_at DESC
     LIMIT 1`,
    [projectId, cleanEmail, cleanTel]
  );
  return rows[0] || null;
}

// Busca cualquier lead CONVERTIDO previo de este email en el proyecto.
// Sirve para detectar cross-sell: cliente que ya compró y ahora pregunta otro programa.
export async function findConvertedByEmail(email, projectId) {
  if (!email) return null;
  const { rows } = await query(
    `SELECT id, nombre, producto_interes_id
     FROM leads
     WHERE email = $1 AND project_id = $2 AND status = 'convertido' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [email, projectId]
  );
  return rows[0] || null;
}

// Devuelve todas las conversiones de un email en el proyecto (historial de compra).
export async function findPurchaseHistory(email, projectId) {
  if (!email) return [];
  const { rows } = await query(
    `SELECT c.id, c.producto_contratado, c.importe_total, c.importe_pagado,
            c.metodo_pago, c.fecha_conversion AS fecha_compra, c.created_at, c.lead_id
     FROM conversions c
     JOIN leads l ON l.id = c.lead_id
     WHERE l.email = $1 AND l.project_id = $2 AND l.deleted_at IS NULL
     ORDER BY c.fecha_conversion DESC NULLS LAST, c.created_at DESC`,
    [email, projectId]
  );
  return rows;
}

// Devuelve true si este email ya fue marcado como SPAM en este proyecto.
// Si lo es, el webhook crea el nuevo lead pero lo deja ya marcado como spam
// (no avanza round-robin, no notifica, ya queda fuera de listas).
export async function findSpamMatch(email, projectId) {
  if (!email) return null;
  const { rows } = await query(
    `SELECT id, deleted_at, deleted_motivo
     FROM leads
     WHERE email = $1 AND project_id = $2
       AND deleted_at IS NOT NULL AND deleted_reason = 'spam'
     ORDER BY deleted_at DESC LIMIT 1`,
    [email, projectId]
  );
  return rows[0] || null;
}

// Soft delete (superadmin). No purga: deja en DB para auditoria.
export async function softDeleteLead(leadId, { reason, motivo, userId }) {
  const { rows } = await query(
    `UPDATE leads
     SET deleted_at = NOW(),
         deleted_reason = $1,
         deleted_motivo = $2,
         deleted_by = $3,
         updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL
     RETURNING id, project_id, email, deleted_reason`,
    [reason, motivo || null, userId, leadId]
  );
  return rows[0] || null;
}

// Fusiona dos leads: mueve TODO el historial del loser al winner,
// marca al loser como duplicado_de y lo soft-deletea con motivo=comentario.
// Devuelve resumen { moved: {...counts}, winner_id, loser_id }.
export async function mergeLeads({ winnerId, loserId, comment, userId }) {
  const { getClient } = await import('../../shared/config/db.js');
  const c = await getClient();
  try {
    await c.query('BEGIN');

    // Verificar que ambos existen, mismo proyecto, y ninguno borrado
    const lw = await c.query(`SELECT id, project_id, deleted_at, nombre FROM leads WHERE id = $1`, [winnerId]);
    const ll = await c.query(`SELECT id, project_id, deleted_at, nombre FROM leads WHERE id = $1`, [loserId]);
    if (!lw.rows[0] || !ll.rows[0]) throw new Error('Lead no encontrado');
    if (lw.rows[0].project_id !== ll.rows[0].project_id) throw new Error('Los leads pertenecen a proyectos distintos');
    if (lw.rows[0].deleted_at || ll.rows[0].deleted_at) throw new Error('No se pueden fusionar leads eliminados');
    if (winnerId === loserId) throw new Error('No se puede fusionar un lead consigo mismo');

    // Mover hijos. Cada UPDATE devuelve count.
    const counts = {};
    const moveTables = [
      'lead_interactions', 'lead_reminders', 'lead_utms',
      'lead_status_history', 'lead_audit_log',
      'conversions', 'matriculas',
      'email_sequence_runs', 'lead_emails',
    ];
    // Tablas 1-1 con UNIQUE(lead_id): si el winner ya tiene fila, el UPDATE
    // del loser viola la constraint. Política: el del winner gana, el del loser
    // se descarta (típicamente UTMs del primer toque del original son los buenos).
    const oneToOneTables = new Set(['lead_utms']);
    for (const t of moveTables) {
      try {
        if (oneToOneTables.has(t)) {
          const w = await c.query(`SELECT 1 FROM ${t} WHERE lead_id = $1 LIMIT 1`, [winnerId]);
          if (w.rowCount > 0) {
            const d = await c.query(`DELETE FROM ${t} WHERE lead_id = $1`, [loserId]);
            counts[t] = `discarded ${d.rowCount}`;
            continue;
          }
        }
        const r = await c.query(`UPDATE ${t} SET lead_id = $1 WHERE lead_id = $2`, [winnerId, loserId]);
        counts[t] = r.rowCount;
      } catch (err) {
        // Tabla puede no existir en este entorno — ignoramos
        if (err.code !== '42P01') throw err;
        counts[t] = 'skipped';
      }
    }

    // Apuntar lead_duplicado_de del loser al winner (auditoría)
    await c.query(`UPDATE leads SET lead_duplicado_de = $1 WHERE id = $2`, [winnerId, loserId]);

    // Nota en el winner explicando la fusión
    await c.query(
      `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
       VALUES ($1, 'nota', $2, $3, NOW())`,
      [winnerId, `🔗 Fusionado con lead #${loserId} (${ll.rows[0].nombre || '—'}). Comentario: ${comment}`, userId]
    );
    // Nota en el loser (queda si se restaura desde papelera)
    await c.query(
      `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
       VALUES ($1, 'nota', $2, $3, NOW())`,
      [loserId, `❌ Fusionado en el lead #${winnerId} (${lw.rows[0].nombre || '—'}). Lead cerrado por fusión. Comentario: ${comment}`, userId]
    );
    // Audit log de la operación en ambos
    await c.query(
      `INSERT INTO lead_audit_log (lead_id, field_name, old_value, new_value, changed_by_user_id)
       VALUES ($1, 'fusion_winner', NULL, $2, $3), ($4, 'fusion_loser', NULL, $5, $3)`,
      [winnerId, String(loserId), userId, loserId, String(winnerId)]
    );

    // Soft-delete del loser
    await c.query(
      `UPDATE leads
       SET deleted_at = NOW(),
           deleted_reason = 'duplicado_manual',
           deleted_motivo = $1,
           deleted_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [`Fusionado en lead #${winnerId}. ${comment}`, userId, loserId]
    );

    await c.query('COMMIT');
    return { winner_id: winnerId, loser_id: loserId, moved: counts };
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

export async function restoreLead(leadId) {
  const { rows } = await query(
    `UPDATE leads
     SET deleted_at = NULL, deleted_reason = NULL, deleted_motivo = NULL, deleted_by = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [leadId]
  );
  return rows[0] || null;
}

export async function findProductByName(name, projectId) {
  const { rows } = await query(
    `SELECT id FROM products WHERE nombre ILIKE $1 AND project_id = $2 AND active = true LIMIT 1`,
    [name, projectId]
  );
  return rows[0] || null;
}

// Busca por SKU exacto (case-insensitive, trim). Útil para multi-sitio donde
// los nombres difieren por idioma pero el SKU es el mismo.
export async function findProductBySku(sku, projectId) {
  if (!sku) return null;
  const { rows } = await query(
    `SELECT id FROM products
     WHERE LOWER(TRIM(sku)) = LOWER(TRIM($1)) AND project_id = $2 AND active = true
     LIMIT 1`,
    [sku, projectId]
  );
  return rows[0] || null;
}

// Extrae el último segmento de una URL (slug del producto).
function urlSlug(landingUrl) {
  if (!landingUrl) return null;
  try {
    const u = new URL(landingUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  } catch { return null; }
}
function urlHost(landingUrl) {
  if (!landingUrl) return null;
  try { return new URL(landingUrl).hostname; } catch { return null; }
}

// Busca por SLUG final de la landing_url. Útil cuando hay multi-sitio
// (subdominios o dominios distintos) que comparten estructura de URL:
// https://es.foo.com/curso-x/  y  https://mx.foo.com/curso-x/
// Mapea ambos al mismo producto del catálogo CRM por el último segmento.
// También consulta la tabla product_url_aliases para slugs aprendidos.
export async function findProductByLandingSlug(landingUrl, projectId) {
  const slug = urlSlug(landingUrl);
  if (!slug) return null;

  // 1) Slug aprendido (tabla product_url_aliases)
  const aliasRes = await query(
    `SELECT product_id FROM product_url_aliases WHERE project_id = $1 AND url_slug = $2 LIMIT 1`,
    [projectId, slug]
  );
  if (aliasRes.rows[0]) return { id: aliasRes.rows[0].product_id, _via: 'alias' };

  // 2) Slug nativo de algún producto (url_info termina con ese slug)
  const { rows } = await query(
    `SELECT id FROM products
     WHERE project_id = $1 AND active = true
       AND (
         url_info ILIKE '%/' || $2 || '/' OR
         url_info ILIKE '%/' || $2 OR
         url_info = $2
       )
     LIMIT 1`,
    [projectId, slug]
  );
  return rows[0] || null;
}

// Aprende: cuando un gestor vincula un lead a un producto, guardamos
// el slug de la landing_url como alias. Los futuros leads desde esa
// URL se vincularán automáticamente.
export async function learnUrlAlias({ projectId, productId, landingUrl, userId }) {
  const slug = urlSlug(landingUrl);
  if (!slug) return null;
  const host = urlHost(landingUrl);
  // Si el slug coincide con el url_info nativo del producto, no creamos alias
  // (ya se resolverá vía findProductByLandingSlug paso 2).
  const own = await query(
    `SELECT id FROM products WHERE id = $1 AND (url_info ILIKE '%/' || $2 || '/' OR url_info ILIKE '%/' || $2)`,
    [productId, slug]
  );
  if (own.rows.length > 0) return { skipped: true, reason: 'native_match' };
  // Upsert por (project_id, url_slug)
  const { rows } = await query(
    `INSERT INTO product_url_aliases (project_id, product_id, url_slug, source_host, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, url_slug) DO UPDATE
       SET product_id = EXCLUDED.product_id, source_host = EXCLUDED.source_host, created_at = NOW()
     RETURNING id, product_id, url_slug, source_host`,
    [projectId, productId, slug, host, userId]
  );
  return rows[0];
}

// Lista aliases por producto
export async function listProductAliases(projectId, productId) {
  const { rows } = await query(
    `SELECT id, url_slug, source_host, created_at FROM product_url_aliases
     WHERE project_id = $1 AND product_id = $2 ORDER BY created_at DESC`,
    [projectId, productId]
  );
  return rows;
}

export async function deleteProductAlias(aliasId, projectId) {
  await query(`DELETE FROM product_url_aliases WHERE id = $1 AND project_id = $2`, [aliasId, projectId]);
}

// Si forcedResponsableId viene, valida que el user tenga acceso al proyecto
// y está disponible; si todo OK, salta el round-robin y le asigna directo.
// Si no viene, ejecuta round-robin tradicional.
export async function createLeadWithRoundRobin({ projectId, nombre, email, telefono, productoInteresId, notas, landingUrl, duplicadoDe, reincidente = false, esPropuesto = false, propuestoDe = null, utms, customFields, forcedResponsableId = null, skipRoundRobin = false, advanceRoundRobinAnyway = false, idempotencyKey = null }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Round-robin: lock queue state. Si no existe, lo creamos en este
    // mismo lock (no perdemos asignación al primer lead del proyecto).
    let queueRows;
    {
      const r = await client.query(
        `SELECT id, last_assigned_index FROM project_queue_state WHERE project_id = $1 FOR UPDATE`,
        [projectId]
      );
      queueRows = r.rows;
      if (queueRows.length === 0) {
        const ins = await client.query(
          `INSERT INTO project_queue_state (project_id, last_assigned_index)
           VALUES ($1, -1) RETURNING id, last_assigned_index`,
          [projectId]
        );
        queueRows = ins.rows;
      }
    }

    // Obtener gestores activos del proyecto.
    // Filtros: usuario activo + rol admin/gestor + disponible (is_available)
    //          + sin bloque de ausencia activo para hoy.
    const { rows: gestorRows } = await client.query(
      `SELECT up.user_id FROM user_projects up
       JOIN users u ON u.id = up.user_id
        AND u.active = true
        AND u.is_available = true
        AND (u.role = 'gestor' OR (u.role IN ('admin','superadmin') AND up.recibe_leads = TRUE))
        -- Quien lleva las colaboraciones de los profesores NO vende: da de alta
        -- tutores y les toca el porcentaje. Estaba entrando en el reparto solo
        -- por tener rol de gestora, y un lead que le cae a ella es un lead que
        -- nadie llama — no es su trabajo ni mira esa bandeja.
        AND NOT COALESCE(u.gestor_colaboraciones, false)
       WHERE up.project_id = $1 AND up.active = true
         AND NOT EXISTS (
           SELECT 1 FROM user_availability_blocks ab
           WHERE ab.user_id = u.id
             AND CURRENT_DATE BETWEEN ab.fecha_inicio AND ab.fecha_fin
         )
       ORDER BY up.orden_cola`,
      [projectId]
    );

    let responsableId = null;
    let assignmentSource = 'round_robin';

    // Asignación forzada (Make ya decidió quién lo recibe).
    // Validamos que el user tenga acceso ACTIVO al proyecto. No exigimos
    // disponibilidad porque Make decidió a propósito y a veces se quiere
    // asignar a alguien aunque esté de baja (queda en su cola pendiente).
    if (forcedResponsableId) {
      const { rows: access } = await client.query(
        `SELECT u.id FROM users u
         JOIN user_projects up ON up.user_id = u.id AND up.project_id = $1 AND up.active = true
         WHERE u.id = $2 AND u.active = true AND u.role IN ('admin', 'gestor', 'superadmin')`,
        [projectId, forcedResponsableId]
      );
      if (access.length > 0) {
        responsableId = access[0].id;
        assignmentSource = 'webhook';
      }
      // Si no tiene acceso, caemos a round-robin (no fallar el webhook).
    }

    if (!responsableId && !skipRoundRobin && gestorRows.length > 0) {
      const gestores = gestorRows.map(r => r.user_id);
      const lastIndex = queueRows[0].last_assigned_index;
      const nextIndex = (lastIndex + 1) % gestores.length;
      responsableId = gestores[nextIndex];

      await client.query(
        `UPDATE project_queue_state SET last_assigned_index = $1, last_assigned_user_id = $2, updated_at = NOW() WHERE project_id = $3`,
        [nextIndex, responsableId, projectId]
      );
    } else if (advanceRoundRobinAnyway && gestorRows.length > 0) {
      // Lead manual creado por gestor: se queda con quien lo creó (forcedResponsableId)
      // pero avanzamos la cola igual para que el siguiente lead automatico no le toque otra vez.
      const gestores = gestorRows.map(r => r.user_id);
      const lastIndex = queueRows[0].last_assigned_index;
      const nextIndex = (lastIndex + 1) % gestores.length;
      await client.query(
        `UPDATE project_queue_state SET last_assigned_index = $1, last_assigned_user_id = $2, updated_at = NOW() WHERE project_id = $3`,
        [nextIndex, gestores[nextIndex], projectId]
      );
    }

    // Crear lead
    const { rows: leadRows } = await client.query(
      `INSERT INTO leads (project_id, nombre, email, telefono, producto_interes_id, responsable_id, notas, landing_url, lead_duplicado_de, reincidente, es_propuesto, propuesto_de, custom_fields, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, project_id, nombre, email, telefono, status, responsable_id, lead_duplicado_de, reincidente, es_propuesto, propuesto_de, fecha_solicitud, created_at`,
      [projectId, nombre, email, telefono, productoInteresId, responsableId, notas, landingUrl, duplicadoDe, reincidente, esPropuesto, propuestoDe,
       customFields ? JSON.stringify(customFields) : '{}', idempotencyKey]
    );
    const lead = leadRows[0];

    // Guardar UTMs si hay datos relevantes. Antes esto SOLO insertaba si había
    // utm_source/medium/campaign, ignorando canal_detectado. Resultado: al crear
    // manualmente con "WhatsApp" el canal no se guardaba. Ahora también dispara
    // si viene canal o landing_url.
    if (
      utms && (
        utms.utm_source || utms.utm_medium || utms.utm_campaign ||
        utms.canal_detectado || utms.landing_url
      )
    ) {
      await client.query(
        `INSERT INTO lead_utms (lead_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_url, canal_detectado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [lead.id, utms.utm_source, utms.utm_medium, utms.utm_campaign, utms.utm_content, utms.utm_term, utms.landing_url, utms.canal_detectado]
      );
    }

    await client.query('COMMIT');
    return { ...lead, responsableId, assignmentSource };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Buscar user por email (case-insensitive). Devuelve null si no existe.
export async function findUserByEmail(email) {
  if (!email) return null;
  const { rows } = await query(
    `SELECT id, email, nombre, role, active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

// Buscar user por NOMBRE dentro de un proyecto. Útil para que Make pase
// "Dayana" o "Ana" y el CRM resuelva al gestor correcto.
// Match: el primer "token" del nombre del user empieza por la entrada
// (Dayana → "Dayana Comercial", Ana → "Ana Comercial", Samantha → "Samantha Ictess").
// Restringido a users activos asignados al proyecto.
export async function findProjectUserByName(name, projectId) {
  if (!name || !projectId) return null;
  const cleaned = String(name).trim();
  if (!cleaned) return null;
  const { rows } = await query(
    `SELECT u.id, u.email, u.nombre, u.role, u.active
     FROM users u
     JOIN user_projects up ON up.user_id = u.id AND up.active = true
     WHERE up.project_id = $1
       AND u.active = true
       AND (u.nombre ILIKE $2 || ' %' OR u.nombre ILIKE $2 OR SPLIT_PART(u.nombre, ' ', 1) ILIKE $2)
     ORDER BY (CASE WHEN SPLIT_PART(u.nombre, ' ', 1) ILIKE $2 THEN 0 ELSE 1 END)
     LIMIT 1`,
    [projectId, cleaned]
  );
  return rows[0] || null;
}

// Idempotency: si Make reintenta con el mismo idempotency_key dentro de 24h,
// devolvemos el lead que ya creamos en lugar de duplicar.
export async function findLeadByIdempotencyKey(projectId, key) {
  if (!key) return null;
  const { rows } = await query(
    `SELECT id, responsable_id FROM leads
     WHERE project_id = $1 AND idempotency_key = $2 AND created_at > NOW() - INTERVAL '24 hours'
     LIMIT 1`,
    [projectId, key]
  );
  return rows[0] || null;
}

// ============================================================
// LISTADO + DETALLE
// ============================================================

// Calcula el ORDER BY segun la preferencia del usuario.
// - 'recent_value': agrupa por DIA mas reciente y dentro de cada día por precio DESC (DEFAULT)
// - 'value':    precio DESC, fecha DESC (siempre los caros arriba aunque sean viejos)
// - 'recent':   fecha DESC sin importar precio
// - 'urgency':  score combinado: vencidos primero, luego valor*frescura exp
// Calcula el ORDER BY segun la preferencia del usuario.
// DEFAULT = 'recent': orden CRONOLOGICO puro (fecha), mas reciente primero.
// `dir` ('asc'|'desc', def 'desc') invierte el orden cronologico en todos los modos.
function buildOrderBy(sort, dir = 'desc') {
  const D = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const FECHA = `COALESCE(l.fecha_solicitud, l.created_at)`;
  if (sort === 'value') {
    return `COALESCE(prod.precio, 0) DESC NULLS LAST, ${FECHA} ${D}`;
  }
  if (sort === 'urgency') {
    // Score: precio * exp(-edad_dias / 7). Asi un lead de 100 hoy supera a uno
    // de 300 de hace 14 dias. Tambien empuja los que tienen recordatorio vencido.
    return `
      (CASE WHEN EXISTS (SELECT 1 FROM lead_reminders r WHERE r.lead_id = l.id AND r.completado = false AND r.fecha_recordatorio < CURRENT_DATE) THEN 1 ELSE 0 END) DESC,
      (COALESCE(prod.precio, 0) * EXP(-EXTRACT(EPOCH FROM (NOW() - ${FECHA})) / 604800)) DESC NULLS LAST,
      ${FECHA} ${D}
    `;
  }
  if (sort === 'recent_value') {
    return `
      DATE(${FECHA}) ${D},
      COALESCE(prod.precio, 0) DESC NULLS LAST,
      ${FECHA} ${D}
    `;
  }
  // default 'recent' — CRONOLOGICO puro. l.id como desempate estable.
  return `${FECHA} ${D} NULLS LAST, l.id ${D}`;
}

export async function findAll({ projectId, projectIds, status, responsableId, unassigned, canal, productId, search, page, limit, includeConverted, dateFrom, dateTo, sort, dir, duplicated, reincidente, conConversion, installmentStatus }) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  // Vista multi-proyecto: si llega projectIds (array) filtra por IN, sino por projectId único
  if (Array.isArray(projectIds) && projectIds.length > 0) {
    conditions.push(`l.project_id = ANY($${paramIdx++}::int[])`);
    params.push(projectIds);
  } else if (projectId) {
    conditions.push(`l.project_id = $${paramIdx++}`);
    params.push(projectId);
  } else {
    // Sin filtro de proyecto no devolvemos nada (seguridad)
    return { leads: [], total: 0, page, limit, totalPages: 0 };
  }

  // Excluir leads eliminados (soft delete)
  conditions.push(`l.deleted_at IS NULL`);

  // Filtro duplicados (solo admin/superadmin a nivel ruta).
  if (duplicated) {
    conditions.push(`l.lead_duplicado_de IS NOT NULL`);
  }

  // Filtro reincidentes — lead que repite consulta del mismo producto.
  if (reincidente) {
    conditions.push(`l.reincidente = TRUE`);
  }

  // "Clientes" incluye tanto los leads marcados como convertidos como aquellos
  // que conservan una venta. Así, eliminar una conversión no oculta al cliente.
  if (conConversion) {
    conditions.push(`(
      l.status = 'convertido'
      OR EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = l.id)
    )`);
  }
  if (conConversion && installmentStatus) {
    const hasInstallments = `EXISTS (
      SELECT 1
      FROM conversion_installments ci_filter
      JOIN conversions c_filter ON c_filter.id = ci_filter.conversion_id
      WHERE c_filter.lead_id = l.id
    )`;
    const hasPendingInstallments = `EXISTS (
      SELECT 1
      FROM conversion_installments ci_filter
      JOIN conversions c_filter ON c_filter.id = ci_filter.conversion_id
      WHERE c_filter.lead_id = l.id
        AND ci_filter.fecha_cobro IS NULL
    )`;

    if (installmentStatus === 'pending') {
      conditions.push(hasPendingInstallments);
    } else if (installmentStatus === 'completed') {
      conditions.push(`${hasInstallments} AND NOT ${hasPendingInstallments}`);
    } else if (installmentStatus === 'no_plan') {
      conditions.push(`NOT ${hasInstallments}`);
    }
  }
  if (status) {
    conditions.push(`l.status = $${paramIdx++}`);
    params.push(status);
  } else if (!includeConverted && !conConversion) {
    conditions.push(`l.status <> 'convertido'`);
  }
  if (unassigned) {
    conditions.push(`l.responsable_id IS NULL`);
  } else if (responsableId) {
    conditions.push(`l.responsable_id = $${paramIdx++}`);
    params.push(responsableId);
  }
  if (canal) {
    conditions.push(`EXISTS (SELECT 1 FROM lead_utms lu WHERE lu.lead_id = l.id AND lu.canal_detectado = $${paramIdx++})`);
    params.push(canal);
  }
  if (productId) {
    conditions.push(conConversion
      ? `(
          EXISTS (
            SELECT 1 FROM conversions cprod
            WHERE cprod.lead_id = l.id
              AND (
                cprod.producto_contratado_id = $${paramIdx}
                OR (cprod.producto_contratado_id IS NULL AND l.producto_interes_id = $${paramIdx})
              )
          )
          OR (
            l.status = 'convertido'
            AND NOT EXISTS (SELECT 1 FROM conversions cprod_any WHERE cprod_any.lead_id = l.id)
            AND l.producto_interes_id = $${paramIdx}
          )
        )`
      : `l.producto_interes_id = $${paramIdx}`);
    paramIdx++;
    params.push(productId);
  }
  if (search) {
    conditions.push(`(l.nombre ILIKE $${paramIdx} OR l.email ILIKE $${paramIdx} OR l.telefono ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  // Filtro por rango de fechas (sobre fecha_solicitud, fallback created_at).
  // IMPORTANTE: fecha_solicitud/created_at son timestamptz. Si comparamos contra
  // un date string 'YYYY-MM-DD' sin TZ, Postgres usa la TZ de sesión (UTC) y
  // descuadra ±2h en Madrid (verano). Resultado: "Hoy" muestra leads de "Ayer"
  // y viceversa. Forzamos interpretación en la TZ de la app.
  const APP_TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';
  if (conConversion) {
    // En Clientes, el rango corresponde a la última compra, no a la fecha en
    // que se creó/importó el lead.
    const lastPurchase = `(SELECT MAX(cdate.fecha_conversion) FROM conversions cdate WHERE cdate.lead_id = l.id)`;
    if (dateFrom) {
      conditions.push(`${lastPurchase} >= $${paramIdx++}::date`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`${lastPurchase} < ($${paramIdx++}::date + INTERVAL '1 day')`);
      params.push(dateTo);
    }
  } else {
    if (dateFrom) {
      conditions.push(`COALESCE(l.fecha_solicitud, l.created_at) >= ($${paramIdx++}::text || ' 00:00:00')::timestamp AT TIME ZONE '${APP_TZ}'`);
      params.push(dateFrom);
    }
    if (dateTo) {
      // dateTo inclusivo: hasta el final del día (en la TZ del usuario).
      conditions.push(`COALESCE(l.fecha_solicitud, l.created_at) < (($${paramIdx++}::text || ' 00:00:00')::timestamp AT TIME ZONE '${APP_TZ}' + INTERVAL '1 day')`);
      params.push(dateTo);
    }
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const countResult = await query(`SELECT COUNT(*) FROM leads l ${where}`, params);
  const total = parseInt(countResult.rows[0].count);

  const clientStatsSelect = conConversion ? `,
            client_stats.programas,
            client_stats.total_cuotas,
            client_stats.cuotas_pagadas,
            client_stats.cuotas_pendientes,
            client_stats.total_pagos,
            client_stats.proximo_vencimiento` : '';
  const clientStatsJoin = conConversion ? `
     LEFT JOIN LATERAL (
       SELECT ARRAY(
                SELECT program_name
                FROM (
                  SELECT DISTINCT COALESCE(
                    NULLIF(BTRIM(ccourse.producto_contratado), ''),
                    pcourse.nombre,
                    pcontact.nombre
                  ) AS program_name
                  FROM conversions ccourse
                  LEFT JOIN products pcourse ON pcourse.id = ccourse.producto_contratado_id
                  LEFT JOIN products pcontact ON pcontact.id = l.producto_interes_id
                  WHERE ccourse.lead_id = l.id
                  UNION ALL
                  SELECT pcontact.nombre AS program_name
                  FROM products pcontact
                  WHERE pcontact.id = l.producto_interes_id
                    AND NOT EXISTS (
                      SELECT 1 FROM conversions ccourse_any WHERE ccourse_any.lead_id = l.id
                    )
                ) client_programs
                WHERE program_name IS NOT NULL
                ORDER BY program_name
              ) AS programas,
              (
                SELECT COUNT(*)::int
                FROM conversion_installments ci
                JOIN conversions ci_conv ON ci_conv.id = ci.conversion_id
                WHERE ci_conv.lead_id = l.id
              ) AS total_cuotas,
              (
                SELECT COUNT(*)::int
                FROM conversion_installments ci
                JOIN conversions ci_conv ON ci_conv.id = ci.conversion_id
                WHERE ci_conv.lead_id = l.id
                  AND ci.fecha_cobro IS NOT NULL
              ) AS cuotas_pagadas,
              (
                SELECT COUNT(*)::int
                FROM conversion_installments ci
                JOIN conversions ci_conv ON ci_conv.id = ci.conversion_id
                WHERE ci_conv.lead_id = l.id
                  AND ci.fecha_cobro IS NULL
              ) AS cuotas_pendientes,
              (
                SELECT COUNT(*)::int
                FROM conversion_payments cp
                JOIN conversions cp_conv ON cp_conv.id = cp.conversion_id
                WHERE cp_conv.lead_id = l.id
                  AND COALESCE(cp.notas, '') NOT ILIKE 'Backfill%'
              ) AS total_pagos,
              (
                SELECT MIN(ci.fecha_vencimiento)
                FROM conversion_installments ci
                JOIN conversions ci_conv ON ci_conv.id = ci.conversion_id
                WHERE ci_conv.lead_id = l.id
                  AND ci.fecha_cobro IS NULL
              ) AS proximo_vencimiento
     ) client_stats ON TRUE` : '';

  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.fecha_solicitud, l.dossier_enviado, l.lead_duplicado_de,
            l.reincidente, l.es_propuesto, l.propuesto_de, l.updated_at, l.created_at,
            l.landing_url,
            l.project_id,
            l.responsable_id,
            proj.nombre AS proyecto_nombre,
            proj.slug AS proyecto_slug,
            u.nombre as responsable_nombre,
            lu.canal_detectado, lu.utm_source, lu.utm_campaign,
            prod.nombre as producto_interes,
            l.producto_interes_id,
            prod.precio as producto_precio,
            prod.moneda as producto_moneda,
            (SELECT MAX(fecha) FROM lead_interactions WHERE lead_id = l.id) AS last_interaction_at,
            (SELECT MIN(fecha_recordatorio) FROM lead_reminders WHERE lead_id = l.id AND completado = false) AS next_reminder_at,
            p.dias_alerta_inactividad,
            EXTRACT(DAY FROM NOW() - GREATEST(l.updated_at, COALESCE((SELECT MAX(fecha) FROM lead_interactions WHERE lead_id = l.id), l.created_at)))::int AS dias_inactivo,
            EXISTS(SELECT 1 FROM lead_spam_reports sr WHERE sr.lead_id = l.id AND sr.status = 'pending') AS has_pending_spam_report
            ${clientStatsSelect}
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN lead_utms lu ON lu.lead_id = l.id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN projects proj ON proj.id = l.project_id
     LEFT JOIN products prod ON prod.id = l.producto_interes_id
     ${clientStatsJoin}
     ${where}
     ORDER BY ${buildOrderBy(sort, dir)}
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  return { leads: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

// Lookup mínimo para validar existencia + obtener campos clave (status,
// project_id, responsable_id, nombre, email, telefono). Más barato que findById
// (no hace los joins de producto/responsable/proyecto). Lo usan changeStatus,
// addInteraction, addReminder, reassign, softDelete, etc.
export async function findByIdLight(id) {
  const { rows } = await query(
    `SELECT id, status, project_id, responsable_id, nombre, email, telefono, deleted_at
     FROM leads WHERE id = $1`,
    [id]
  );
  const r = rows[0];
  if (!r || r.deleted_at) return null;
  return r;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT l.*,
            u.nombre as responsable_nombre, u.email as responsable_email,
            p.nombre as proyecto_nombre, p.slug as proyecto_slug,
            pr.nombre as producto_nombre,
            pr.nombre as producto_interes,
            pr.precio as producto_precio,
            pr.moneda as producto_moneda
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN products pr ON pr.id = l.producto_interes_id
     WHERE l.id = $1`,
    [id]
  );
  if (!rows[0]) return null;

  const lead = rows[0];

  // UTMs
  const { rows: utmRows } = await query(`SELECT * FROM lead_utms WHERE lead_id = $1`, [id]);
  lead.utms = utmRows[0] || null;

  // Status history
  const { rows: historyRows } = await query(
    `SELECT lsh.*, u.nombre as changed_by_nombre
     FROM lead_status_history lsh
     LEFT JOIN users u ON u.id = lsh.changed_by
     WHERE lsh.lead_id = $1 ORDER BY lsh.changed_at DESC`,
    [id]
  );
  lead.statusHistory = historyRows;

  // Interactions
  const { rows: interactionRows } = await query(
    `SELECT li.*, u.nombre as created_by_nombre
     FROM lead_interactions li
     LEFT JOIN users u ON u.id = li.created_by
     WHERE li.lead_id = $1 ORDER BY li.fecha DESC`,
    [id]
  );
  lead.interactions = interactionRows;

  // Reminders
  const { rows: reminderRows } = await query(
    `SELECT lr.*, u.nombre as created_by_nombre
     FROM lead_reminders lr
     LEFT JOIN users u ON u.id = lr.created_by
     WHERE lr.lead_id = $1 ORDER BY lr.fecha_recordatorio ASC`,
    [id]
  );
  lead.reminders = reminderRows;

  // Audit log (cambios de campos editables)
  const { rows: auditRows } = await query(
    `SELECT la.id, la.field_name, la.old_value, la.new_value, la.changed_at,
            la.changed_by_user_id, u.nombre as changed_by_nombre
     FROM lead_audit_log la
     LEFT JOIN users u ON u.id = la.changed_by_user_id
     WHERE la.lead_id = $1 ORDER BY la.changed_at DESC`,
    [id]
  );
  lead.auditLog = auditRows;

  // Programas secundarios (#18 multi-cursos)
  const { rows: spRows } = await query(
    `SELECT lp.id, lp.product_id, p.nombre AS product_nombre,
            lp.responsable_id, u.nombre AS responsable_nombre,
            lp.status, lp.notas, lp.added_at, lp.added_via,
            lp.added_by_user_id, au.nombre AS added_by_nombre
     FROM lead_products lp
     LEFT JOIN products p ON p.id = lp.product_id
     LEFT JOIN users u ON u.id = lp.responsable_id
     LEFT JOIN users au ON au.id = lp.added_by_user_id
     WHERE lp.lead_id = $1 ORDER BY lp.added_at DESC`,
    [id]
  );
  lead.secondaryProducts = spRows;

  return lead;
}

// ============================================================
// OPERACIONES
// ============================================================

export async function updateStatus(leadId, statusNuevo, statusAnterior, changedBy) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2`, [statusNuevo, leadId]);
    await client.query(
      `INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by) VALUES ($1, $2, $3, $4)`,
      [leadId, statusAnterior, statusNuevo, changedBy]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createInteraction(leadId, tipo, nota, createdBy, fecha) {
  const { rows } = await query(
    `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
     RETURNING id, lead_id, tipo, nota, fecha, created_by`,
    [leadId, tipo, nota, createdBy, fecha || null]
  );
  return rows[0];
}

// Devuelve la interacción si pertenece al lead indicado. Usado para checks de
// autoría/pertenencia antes de update/delete.
export async function findInteractionById(interactionId) {
  const { rows } = await query(
    `SELECT id, lead_id, tipo, nota, fecha, created_by
     FROM lead_interactions WHERE id = $1`,
    [interactionId]
  );
  return rows[0] || null;
}

export async function updateInteraction(interactionId, fields) {
  const sets = [];
  const params = [];
  let idx = 1;
  if (fields.tipo !== undefined) { sets.push(`tipo = $${idx++}`); params.push(fields.tipo); }
  if (fields.nota !== undefined) { sets.push(`nota = $${idx++}`); params.push(fields.nota); }
  if (fields.fecha !== undefined) { sets.push(`fecha = $${idx++}::timestamptz`); params.push(fields.fecha); }
  if (!sets.length) return null;
  params.push(interactionId);
  const { rows } = await query(
    `UPDATE lead_interactions SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, lead_id, tipo, nota, fecha, created_by`,
    params
  );
  return rows[0] || null;
}

export async function deleteInteraction(interactionId) {
  await query(`DELETE FROM lead_interactions WHERE id = $1`, [interactionId]);
}

export async function createReminder(leadId, fechaRecordatorio, nota, createdBy) {
  const { rows } = await query(
    `INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, created_by) VALUES ($1, $2, $3, $4)
     RETURNING id, lead_id, fecha_recordatorio, nota, completado, created_by`,
    [leadId, fechaRecordatorio, nota, createdBy]
  );
  return rows[0];
}

export async function completeReminder(reminderId) {
  await query(`UPDATE lead_reminders SET completado = true WHERE id = $1`, [reminderId]);
}

export async function reassignLead(leadId, newResponsableId) {
  await query(`UPDATE leads SET responsable_id = $1, updated_at = NOW() WHERE id = $2`, [newResponsableId, leadId]);
}

// Re-aplica round-robin a los leads con responsable_id IS NULL del proyecto.
// Avanza el cursor (last_assigned_index) y devuelve resumen.
export async function reassignPendingRoundRobin(projectId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows: gestores } = await client.query(
      `SELECT up.user_id FROM user_projects up
       JOIN users u ON u.id = up.user_id
        AND u.active = true
        AND u.is_available = true
        AND (u.role = 'gestor' OR (u.role IN ('admin','superadmin') AND up.recibe_leads = TRUE))
        -- Quien lleva las colaboraciones de los profesores NO vende: da de alta
        -- tutores y les toca el porcentaje. Estaba entrando en el reparto solo
        -- por tener rol de gestora, y un lead que le cae a ella es un lead que
        -- nadie llama — no es su trabajo ni mira esa bandeja.
        AND NOT COALESCE(u.gestor_colaboraciones, false)
       WHERE up.project_id = $1 AND up.active = true
         AND NOT EXISTS (
           SELECT 1 FROM user_availability_blocks ab
           WHERE ab.user_id = u.id
             AND CURRENT_DATE BETWEEN ab.fecha_inicio AND ab.fecha_fin
         )
       ORDER BY up.orden_cola`,
      [projectId]
    );

    if (gestores.length === 0) {
      await client.query('ROLLBACK');
      return { reassigned: 0, total_pending: 0, reason: 'NO_ACTIVE_GESTORES' };
    }
    const gestorIds = gestores.map((g) => g.user_id);

    const { rows: pending } = await client.query(
      `SELECT id FROM leads
       WHERE project_id = $1 AND responsable_id IS NULL
       ORDER BY created_at ASC`,
      [projectId]
    );

    if (pending.length === 0) {
      await client.query('ROLLBACK');
      return { reassigned: 0, total_pending: 0 };
    }

    const { rows: queueRows } = await client.query(
      `SELECT id, last_assigned_index FROM project_queue_state WHERE project_id = $1 FOR UPDATE`,
      [projectId]
    );

    let cursor = queueRows.length > 0 ? queueRows[0].last_assigned_index : -1;
    let lastUserId = null;

    for (const lead of pending) {
      cursor = (cursor + 1) % gestorIds.length;
      const userId = gestorIds[cursor];
      lastUserId = userId;
      await client.query(
        `UPDATE leads SET responsable_id = $1, updated_at = NOW() WHERE id = $2`,
        [userId, lead.id]
      );
    }

    if (queueRows.length > 0) {
      await client.query(
        `UPDATE project_queue_state SET last_assigned_index = $1, last_assigned_user_id = $2, updated_at = NOW() WHERE project_id = $3`,
        [cursor, lastUserId, projectId]
      );
    } else {
      await client.query(
        `INSERT INTO project_queue_state (project_id, last_assigned_index, last_assigned_user_id) VALUES ($1, $2, $3)`,
        [projectId, cursor, lastUserId]
      );
    }

    await client.query('COMMIT');
    return { reassigned: pending.length, total_pending: pending.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateLead(id, fields) {
  const sets = [];
  const params = [];
  let idx = 1;

  const allowed = ['nombre', 'email', 'telefono', 'notas', 'producto_interes_id', 'custom_fields'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${key} = $${idx++}`);
      params.push(key === 'custom_fields' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await query(
    `UPDATE leads SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, nombre, email, telefono, notas, producto_interes_id, custom_fields, status, responsable_id, updated_at`,
    params
  );
  return rows[0] || null;
}

export async function getLeadProjectId(leadId) {
  const { rows } = await query(`SELECT project_id FROM leads WHERE id = $1`, [leadId]);
  return rows[0]?.project_id || null;
}

// ============================================================
// DASHBOARD STATS
// ============================================================

// Panel "Hoy" - actividad del dia, reminders pendientes, alertas
export async function getTodaySummary({ userId, role, projectId }) {
  // Usamos parametros para evitar SQL injection
  const userIdParam = role === 'gestor' ? userId : null;
  const pidParam = projectId || null;

  const { rows: remRows } = await query(
    `SELECT lr.id, lr.lead_id, lr.fecha_recordatorio, lr.nota,
            l.nombre as lead_nombre, l.email as lead_email, l.status as lead_status,
            CASE WHEN lr.fecha_recordatorio < CURRENT_DATE THEN true ELSE false END as vencido
     FROM lead_reminders lr
     JOIN leads l ON l.id = lr.lead_id
     WHERE lr.completado = false
       AND lr.fecha_recordatorio <= CURRENT_DATE
       AND ($1::int IS NULL OR lr.created_by = $1)
       AND ($2::int IS NULL OR l.project_id = $2)
     ORDER BY lr.fecha_recordatorio ASC, lr.id DESC
     LIMIT 20`,
    [userIdParam, pidParam]
  );

  const { rows: nuevosHoy } = await query(
    `SELECT COUNT(*) FROM leads l
     WHERE l.fecha_solicitud::date = CURRENT_DATE
       AND ($1::int IS NULL OR l.responsable_id = $1)
       AND ($2::int IS NULL OR l.project_id = $2)`,
    [userIdParam, pidParam]
  );

  const { rows: nuevosSemana } = await query(
    `SELECT COUNT(*) FROM leads l
     WHERE l.fecha_solicitud >= CURRENT_DATE - INTERVAL '7 days'
       AND ($1::int IS NULL OR l.responsable_id = $1)
       AND ($2::int IS NULL OR l.project_id = $2)`,
    [userIdParam, pidParam]
  );

  const { rows: inactivos } = await query(
    `SELECT COUNT(*)
     FROM leads l
     LEFT JOIN projects p ON p.id = l.project_id
     WHERE l.status NOT IN ('convertido', 'no_interesado')
       AND EXTRACT(DAY FROM NOW() - GREATEST(l.updated_at, COALESCE((SELECT MAX(fecha) FROM lead_interactions WHERE lead_id = l.id), l.created_at))) > p.dias_alerta_inactividad
       AND ($1::int IS NULL OR l.responsable_id = $1)
       AND ($2::int IS NULL OR l.project_id = $2)`,
    [userIdParam, pidParam]
  );

  const { rows: cobrosVencidos } = await query(
    `SELECT COUNT(*)
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     WHERE c.importe_pagado < c.importe_total
       AND c.fecha_compromiso_pago IS NOT NULL
       AND c.fecha_compromiso_pago < CURRENT_DATE
       AND ($1::int IS NULL OR l.responsable_id = $1)
       AND ($2::int IS NULL OR c.project_id = $2)`,
    [userIdParam, pidParam]
  );

  const { rows: ingresosHoy } = await query(
    `SELECT COALESCE(SUM(cp.importe), 0) as total
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     LEFT JOIN leads l ON l.id = c.lead_id
     WHERE cp.fecha = CURRENT_DATE
       AND ($1::int IS NULL OR l.responsable_id = $1)
       AND ($2::int IS NULL OR c.project_id = $2)`,
    [userIdParam, pidParam]
  );

  return {
    reminders_pendientes: remRows,
    nuevos_hoy: parseInt(nuevosHoy[0].count),
    nuevos_semana: parseInt(nuevosSemana[0].count),
    inactivos: parseInt(inactivos[0].count),
    cobros_vencidos: parseInt(cobrosVencidos[0].count),
    ingresos_hoy: Number(ingresosHoy[0].total),
  };
}

export async function getStats(projectId, { responsableId = null, dateFrom = null, dateTo = null, productId = null, canal = null, search = null } = {}) {
  // Los chips de stats deben reflejar los mismos filtros que el listado, no el
  // total global del proyecto. WHERE incremental igual que findAll.
  const params = [projectId];
  let idx = 2;
  const extra = [];
  if (responsableId) { extra.push(`responsable_id = $${idx++}`); params.push(responsableId); }
  if (productId)     { extra.push(`producto_interes_id = $${idx++}`); params.push(productId); }
  const APP_TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';
  if (dateFrom) {
    extra.push(`COALESCE(fecha_solicitud, created_at) >= ($${idx++}::text || ' 00:00:00')::timestamp AT TIME ZONE '${APP_TZ}'`);
    params.push(dateFrom);
  }
  if (dateTo) {
    extra.push(`COALESCE(fecha_solicitud, created_at) < (($${idx++}::text || ' 00:00:00')::timestamp AT TIME ZONE '${APP_TZ}' + INTERVAL '1 day')`);
    params.push(dateTo);
  }
  if (canal) {
    extra.push(`EXISTS (SELECT 1 FROM lead_utms lu WHERE lu.lead_id = leads.id AND lu.canal_detectado = $${idx++})`);
    params.push(canal);
  }
  if (search) {
    extra.push(`(nombre ILIKE $${idx} OR email ILIKE $${idx} OR telefono ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }
  const where = extra.length ? ` AND ${extra.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'nuevo') as nuevos,
       COUNT(*) FILTER (WHERE status = 'por_contactar') as por_contactar,
       COUNT(*) FILTER (WHERE status = 'contactado') as contactados,
       COUNT(*) FILTER (WHERE status = 'en_seguimiento') as en_seguimiento,
       COUNT(*) FILTER (WHERE status = 'convertido') as convertidos,
       COUNT(*) FILTER (WHERE status = 'no_interesado') as no_interesados,
       COUNT(*) FILTER (WHERE status = 'proxima_convocatoria') as proxima_convocatoria,
       COUNT(*) FILTER (WHERE responsable_id IS NULL AND status NOT IN ('convertido','no_interesado')) as sin_asignar
     FROM leads WHERE project_id = $1 AND deleted_at IS NULL${where}`,
    params
  );
  return rows[0];
}

// Dashboard summary: igual que getStats pero ventana de N días + breakdown
// de leads recientes. Usado por GET /api/leads/dashboard-summary.
export async function getDashboardSummary(projectId, { days = 30, responsableId = null } = {}) {
  const params = [projectId, days];
  let respFilter = '';
  if (responsableId) {
    params.push(responsableId);
    respFilter = ` AND responsable_id = $3`;
  }
  const { rows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE created_at >= NOW() - ($2 || ' days')::interval) as leads_periodo,
       COUNT(*) FILTER (WHERE status = 'nuevo') as nuevos,
       COUNT(*) FILTER (WHERE status = 'por_contactar') as por_contactar,
       COUNT(*) FILTER (WHERE status = 'contactado') as contactados,
       COUNT(*) FILTER (WHERE status = 'en_seguimiento') as en_seguimiento,
       COUNT(*) FILTER (WHERE status = 'convertido') as convertidos,
       COUNT(*) FILTER (WHERE status = 'no_interesado') as no_interesados,
       COUNT(*) FILTER (WHERE status = 'proxima_convocatoria') as proxima_convocatoria,
       COUNT(*) FILTER (WHERE responsable_id IS NULL AND status NOT IN ('convertido','no_interesado')) as sin_asignar
     FROM leads WHERE project_id = $1 AND deleted_at IS NULL${respFilter}`,
    params
  );
  return { ...rows[0], days };
}
