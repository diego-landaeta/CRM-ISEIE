import { query, getClient } from '../../shared/config/db.js';

// Columnas y tablas pendientes de portar desde el CRM hermano (v1):
//   - leads.deleted_reason / leads.deleted_motivo / leads.deleted_by  (soft-delete con motivo)
//   - leads.custom_fields JSONB
//   - leads.reincidente, leads.es_propuesto, leads.propuesto_de
//   - products.sku, products.precio, products.moneda, products.url_info
//   - product_url_aliases (tabla)
//   - lead_spam_reports (tabla)
// Mientras no estén, las funciones afectadas son STUB (devuelven null/[]/no-op)
// y el código de service consume los flags como opcionales.

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
// STUB v1 (depende de deleted_reason / deleted_motivo).
export async function findSpamMatch(_email, _projectId) {
  return null;
}

// Soft delete (superadmin). No purga: deja en DB para auditoria.
// v1: solo registramos deleted_at; el motivo se pierde hasta extender el schema.
export async function softDeleteLead(leadId, { reason, motivo, userId }) {
  // reason / motivo / userId aceptados pero ignorados en v1 (sin columnas que guardarlos)
  void reason; void motivo; void userId;
  const { rows } = await query(
    `UPDATE leads
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, project_id, email`,
    [leadId]
  );
  return rows[0] || null;
}

// Fusiona dos leads: mueve TODO el historial del loser al winner,
// marca al loser como duplicado_de y lo soft-deletea con motivo=comentario.
// Devuelve resumen { moved: {...counts}, winner_id, loser_id }.
export async function mergeLeads({ winnerId, loserId, comment, userId }) {
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
    // En v1 solo movemos tablas existentes en 001. Las que no existen se ignoran
    // gracias al catch de 42P01, así que el codigo sigue siendo identico al CRM hermano
    // cuando se añadan matriculas / email_sequence_runs / lead_emails en futuras migraciones.
    const counts = {};
    const moveTables = [
      'lead_interactions', 'lead_reminders', 'lead_utms',
      'lead_status_history', 'conversions', 'matriculas',
      'email_sequence_runs', 'lead_emails',
    ];
    for (const t of moveTables) {
      try {
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

    // Insertar nota en el winner con el comentario
    await c.query(
      `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
       VALUES ($1, 'nota', $2, $3, NOW())`,
      [winnerId, `Fusión con lead #${loserId} (${ll.rows[0].nombre}). Comentario: ${comment}`, userId]
    );

    // Soft-delete del loser. v1: solo deleted_at; el motivo queda en la nota del winner.
    await c.query(
      `UPDATE leads
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [loserId]
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
     SET deleted_at = NULL, updated_at = NOW()
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
// los nombres difieren por idioma pero el SKU es el mismo. STUB v1.
export async function findProductBySku(_sku, _projectId) {
  return null;
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
// STUB v1.
export async function findProductByLandingSlug(_landingUrl, _projectId) {
  return null;
}

// Aprende: cuando un gestor vincula un lead a un producto, guardamos
// el slug de la landing_url como alias. STUB v1.
export async function learnUrlAlias(_args) {
  return { skipped: true, reason: 'product_url_aliases_not_migrated' };
}

// Lista aliases por producto. STUB v1.
export async function listProductAliases(_projectId, _productId) {
  return [];
}

export async function deleteProductAlias(_aliasId, _projectId) {
  // STUB v1.
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
        AND u.role = 'gestor'
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

    const { rows: leadRows } = await client.query(
      `INSERT INTO leads (project_id, nombre, email, telefono, producto_interes_id, responsable_id, notas, landing_url, lead_duplicado_de, es_propuesto, propuesto_de, reincidente, custom_fields, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, project_id, nombre, email, telefono, status, responsable_id, lead_duplicado_de, es_propuesto, propuesto_de, reincidente, fecha_solicitud, created_at`,
      [projectId, nombre, email, telefono, productoInteresId, responsableId, notas, landingUrl, duplicadoDe, !!esPropuesto, propuestoDe || null, !!reincidente, customFields || {}, idempotencyKey]
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
// v1: products no tiene precio, asi que todos los modos degradan a 'recent'.
function buildOrderBy(_sort) {
  return `COALESCE(l.fecha_solicitud, l.created_at) DESC`;
}

export async function findAll({ projectId, projectIds, status, responsableId, unassigned, canal, productId, search, page, limit, includeConverted, dateFrom, dateTo, sort, archived }) {
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

  // Soft-delete: por defecto excluir; con archived=true invertir el filtro.
  conditions.push(archived ? `l.deleted_at IS NOT NULL` : `l.deleted_at IS NULL`);

  if (status) {
    conditions.push(`l.status = $${paramIdx++}`);
    params.push(status);
  } else if (!includeConverted) {
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
    conditions.push(`l.producto_interes_id = $${paramIdx++}`);
    params.push(productId);
  }
  if (search) {
    conditions.push(`(l.nombre ILIKE $${paramIdx} OR l.email ILIKE $${paramIdx} OR l.telefono ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  // Filtro por rango de fechas (sobre fecha_solicitud, fallback created_at)
  if (dateFrom) {
    conditions.push(`COALESCE(l.fecha_solicitud, l.created_at) >= $${paramIdx++}`);
    params.push(dateFrom);
  }
  if (dateTo) {
    // dateTo inclusivo: hasta el final del día
    conditions.push(`COALESCE(l.fecha_solicitud, l.created_at) < ($${paramIdx++}::date + INTERVAL '1 day')`);
    params.push(dateTo);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const countResult = await query(`SELECT COUNT(*) FROM leads l ${where}`, params);
  const total = parseInt(countResult.rows[0].count);

  // precio/moneda y has_pending_spam_report siguen NULL hasta portar esos joins.
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.fecha_solicitud, l.dossier_enviado, l.lead_duplicado_de,
            l.reincidente,
            l.es_propuesto,
            l.propuesto_de,
            l.updated_at, l.created_at,
            l.landing_url,
            l.project_id,
            proj.nombre AS proyecto_nombre,
            proj.slug AS proyecto_slug,
            u.nombre as responsable_nombre,
            lu.canal_detectado, lu.utm_source, lu.utm_campaign,
            prod.nombre as producto_interes,
            l.producto_interes_id,
            NULL::numeric AS producto_precio,
            NULL::text AS producto_moneda,
            (SELECT MAX(fecha) FROM lead_interactions WHERE lead_id = l.id) AS last_interaction_at,
            (SELECT MIN(fecha_recordatorio) FROM lead_reminders WHERE lead_id = l.id AND completado = false) AS next_reminder_at,
            p.dias_alerta_inactividad,
            EXTRACT(DAY FROM NOW() - GREATEST(l.updated_at, COALESCE((SELECT MAX(fecha) FROM lead_interactions WHERE lead_id = l.id), l.created_at)))::int AS dias_inactivo,
            false AS has_pending_spam_report
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN lead_utms lu ON lu.lead_id = l.id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN projects proj ON proj.id = l.project_id
     LEFT JOIN products prod ON prod.id = l.producto_interes_id
     ${where}
     ORDER BY ${buildOrderBy(sort)}
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  return { leads: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function findById(id) {
  // v1: products minimal (sin precio/moneda) — devolvemos NULL.
  const { rows } = await query(
    `SELECT l.*,
            u.nombre as responsable_nombre, u.email as responsable_email,
            p.nombre as proyecto_nombre, p.slug as proyecto_slug,
            pr.nombre as producto_nombre,
            pr.nombre as producto_interes,
            NULL::numeric as producto_precio,
            NULL::text as producto_moneda
     FROM leads l
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN projects p ON p.id = l.project_id
     LEFT JOIN products pr ON pr.id = l.producto_interes_id
     WHERE l.id = $1`,
    [id]
  );
  if (!rows[0]) return null;

  const lead = rows[0];

  const [utm, history, interactions, reminders] = await Promise.all([
    query(`SELECT * FROM lead_utms WHERE lead_id = $1`, [id]),
    query(
      `SELECT lsh.*, u.nombre as changed_by_nombre
       FROM lead_status_history lsh
       LEFT JOIN users u ON u.id = lsh.changed_by
       WHERE lsh.lead_id = $1 ORDER BY lsh.changed_at DESC`,
      [id]
    ),
    query(
      `SELECT li.*, u.nombre as created_by_nombre
       FROM lead_interactions li
       LEFT JOIN users u ON u.id = li.created_by
       WHERE li.lead_id = $1 ORDER BY li.fecha DESC`,
      [id]
    ),
    query(
      `SELECT lr.*, u.nombre as created_by_nombre
       FROM lead_reminders lr
       LEFT JOIN users u ON u.id = lr.created_by
       WHERE lr.lead_id = $1 ORDER BY lr.fecha_recordatorio ASC`,
      [id]
    ),
  ]);

  lead.utms = utm.rows[0] || null;
  lead.statusHistory = history.rows;
  lead.interactions = interactions.rows;
  lead.reminders = reminders.rows;

  return lead;
}

// Versión ligera para validaciones rápidas en operaciones (changeStatus,
// addInteraction, addReminder, reassign) — evita las 5 queries del findById
// completo cuando solo necesitamos validar existencia + leer status/project.
export async function findByIdLight(id) {
  const { rows } = await query(
    `SELECT id, status, project_id, responsable_id FROM leads WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
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
        AND u.role = 'gestor'
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

  const allowed = ['nombre', 'telefono', 'notas', 'producto_interes_id'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${key} = $${idx++}`);
      params.push(fields[key]);
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await query(
    `UPDATE leads SET ${sets.join(', ')} WHERE id = $${idx}
     RETURNING id, nombre, email, telefono, notas, producto_interes_id, status, responsable_id, updated_at`,
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

export async function getStats(projectId, { responsableId = null } = {}) {
  // SEGURIDAD: si viene responsableId, las stats se calculan SOLO sobre
  // los leads asignados a ese usuario (caso gestor).
  const params = [projectId];
  let respFilter = '';
  if (responsableId) {
    params.push(responsableId);
    respFilter = ` AND responsable_id = $2`;
  }
  const { rows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'nuevo') as nuevos,
       COUNT(*) FILTER (WHERE status = 'por_contactar') as por_contactar,
       COUNT(*) FILTER (WHERE status = 'contactado') as contactados,
       COUNT(*) FILTER (WHERE status = 'en_seguimiento') as en_seguimiento,
       COUNT(*) FILTER (WHERE status = 'convertido') as convertidos,
       COUNT(*) FILTER (WHERE status = 'no_interesado') as no_interesados,
       COUNT(*) FILTER (WHERE responsable_id IS NULL AND status NOT IN ('convertido','no_interesado')) as sin_asignar
     FROM leads WHERE project_id = $1 AND deleted_at IS NULL${respFilter}`,
    params
  );
  return rows[0];
}

// Dashboard agregado: KPIs del periodo + comparacion vs periodo anterior + sparklines semanales.
// Cubre 4 metricas: leads nuevos, conversiones cerradas, ingresos (sum payments), tasa conversion.
export async function getDashboardSummary(projectId, { days = 30, responsableId = null } = {}) {
  const isGestor = !!responsableId;
  const respParam = isGestor ? ', $4::int' : '';
  const respFilterLeads = isGestor ? 'AND l.responsable_id = $4' : '';
  const respFilterConv  = isGestor ? `AND l.responsable_id = $4` : '';

  // Periodo actual (ultimos N dias) y previo (N dias anteriores a esos).
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(now.getTime() - days * 86400000).toISOString();
  const prevStart   = new Date(now.getTime() - 2 * days * 86400000).toISOString();
  const params = isGestor
    ? [projectId, periodStart, periodEnd, responsableId, prevStart]
    : [projectId, periodStart, periodEnd, prevStart];
  const prevParamIdx = isGestor ? '$5' : '$4';

  // KPIs del periodo actual vs previo.
  const kpisSql = `
    WITH cur_leads AS (
      SELECT COUNT(*)::int AS n FROM leads l
       WHERE l.project_id = $1 AND l.deleted_at IS NULL
         AND l.created_at >= $2 AND l.created_at < $3 ${respFilterLeads}
    ), prev_leads AS (
      SELECT COUNT(*)::int AS n FROM leads l
       WHERE l.project_id = $1 AND l.deleted_at IS NULL
         AND l.created_at >= ${prevParamIdx} AND l.created_at < $2 ${respFilterLeads}
    ), cur_conv AS (
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(c.importe_total), 0)::numeric AS ingresos
        FROM conversions c
        LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.project_id = $1
         AND c.created_at >= $2 AND c.created_at < $3 ${respFilterConv}
    ), prev_conv AS (
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(c.importe_total), 0)::numeric AS ingresos
        FROM conversions c
        LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.project_id = $1
         AND c.created_at >= ${prevParamIdx} AND c.created_at < $2 ${respFilterConv}
    )
    SELECT
      (SELECT n FROM cur_leads) AS leads_cur,
      (SELECT n FROM prev_leads) AS leads_prev,
      (SELECT n FROM cur_conv) AS conv_cur,
      (SELECT n FROM prev_conv) AS conv_prev,
      (SELECT ingresos FROM cur_conv) AS ingresos_cur,
      (SELECT ingresos FROM prev_conv) AS ingresos_prev
  `;
  const { rows: kpisRows } = await query(kpisSql, params);
  const k = kpisRows[0] || {};

  // Sparkline semanal (8 semanas) — leads creados y conversiones.
  const sparkSql = `
    WITH weeks AS (
      SELECT generate_series(0, 7) AS w
    )
    SELECT
      w.w,
      (SELECT COUNT(*)::int FROM leads l
        WHERE l.project_id = $1 AND l.deleted_at IS NULL
          AND l.created_at >= NOW() - ((w.w + 1) * INTERVAL '7 days')
          AND l.created_at <  NOW() - (w.w * INTERVAL '7 days')
          ${respFilterLeads}
      ) AS leads,
      (SELECT COUNT(*)::int FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.project_id = $1
          AND c.created_at >= NOW() - ((w.w + 1) * INTERVAL '7 days')
          AND c.created_at <  NOW() - (w.w * INTERVAL '7 days')
          ${respFilterConv}
      ) AS conversiones,
      (SELECT COALESCE(SUM(c.importe_total), 0)::numeric FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.project_id = $1
          AND c.created_at >= NOW() - ((w.w + 1) * INTERVAL '7 days')
          AND c.created_at <  NOW() - (w.w * INTERVAL '7 days')
          ${respFilterConv}
      ) AS ingresos
    FROM weeks w
    ORDER BY w.w DESC
  `;
  const sparkParams = isGestor ? [projectId, responsableId] : [projectId];
  const sparkParamsActual = isGestor
    ? [projectId, periodStart, periodEnd, responsableId]
    : [projectId, periodStart, periodEnd];
  void sparkParams;
  const { rows: weeksRows } = await query(sparkSql, sparkParamsActual);

  const leadsSpark = weeksRows.map((r) => Number(r.leads || 0));
  const convSpark = weeksRows.map((r) => Number(r.conversiones || 0));
  const ingresosSpark = weeksRows.map((r) => Number(r.ingresos || 0));
  const convRateSpark = weeksRows.map((r) => {
    const l = Number(r.leads || 0);
    const c = Number(r.conversiones || 0);
    return l > 0 ? Math.round((c / l) * 100) : 0;
  });

  const pct = (cur, prev) => {
    const c = Number(cur || 0);
    const p = Number(prev || 0);
    if (p === 0) return c > 0 ? 100 : null;
    return Math.round(((c - p) / p) * 1000) / 10;
  };

  const leadsCur = Number(k.leads_cur || 0);
  const convCur = Number(k.conv_cur || 0);
  const ingresosCur = Number(k.ingresos_cur || 0);
  const ingresosPrev = Number(k.ingresos_prev || 0);
  const rateCur = leadsCur > 0 ? Math.round((convCur / leadsCur) * 1000) / 10 : 0;
  const leadsPrev = Number(k.leads_prev || 0);
  const convPrev = Number(k.conv_prev || 0);
  const ratePrev = leadsPrev > 0 ? Math.round((convPrev / leadsPrev) * 1000) / 10 : 0;

  return {
    days,
    leads:       { value: leadsCur,    trend: pct(leadsCur, leadsPrev),     spark: leadsSpark },
    conversiones:{ value: convCur,     trend: pct(convCur, convPrev),       spark: convSpark },
    ingresos:    { value: ingresosCur, trend: pct(ingresosCur, ingresosPrev), spark: ingresosSpark },
    tasa:        { value: rateCur,     trend: rateCur - ratePrev,           spark: convRateSpark },
  };
}
