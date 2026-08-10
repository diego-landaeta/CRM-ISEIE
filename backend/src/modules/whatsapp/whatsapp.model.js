import { query } from '../../shared/config/db.js';

// ── Plantillas ───────────────────────────────────────────────────────────────
// Se ven las compartidas del proyecto mas las personales de quien pregunta.
// Nunca las personales de otra persona, ni siquiera siendo admin: son suyas.

export async function listTemplates({ projectId, userId }) {
  const { rows } = await query(
    `SELECT t.id, t.project_id, t.label, t.body, t.ambito, t.owner_id, t.orden,
            u.nombre AS creada_por
       FROM whatsapp_templates t
       LEFT JOIN users u ON u.id = t.created_by
      WHERE t.project_id = $1 AND t.active
        AND (t.ambito = 'compartida' OR t.owner_id = $2)
      ORDER BY t.ambito DESC, t.orden, t.id`,
    [projectId, userId]
  );
  return rows;
}

export async function getTemplate(id) {
  const { rows } = await query(
    `SELECT id, project_id, label, body, ambito, owner_id, orden, active
       FROM whatsapp_templates WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function createTemplate({ projectId, label, body, ambito, ownerId, createdBy }) {
  const { rows } = await query(
    `INSERT INTO whatsapp_templates (project_id, label, body, ambito, owner_id, created_by, orden)
     VALUES ($1, $2, $3, $4, $5, $6,
             COALESCE((SELECT MAX(orden) + 1 FROM whatsapp_templates WHERE project_id = $1), 1))
     RETURNING id, project_id, label, body, ambito, owner_id, orden`,
    [projectId, label, body, ambito, ambito === 'personal' ? ownerId : null, createdBy]
  );
  return rows[0];
}

export async function updateTemplate(id, { label, body, orden }) {
  const { rows } = await query(
    `UPDATE whatsapp_templates
        SET label      = COALESCE($2, label),
            body       = COALESCE($3, body),
            orden      = COALESCE($4, orden),
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, project_id, label, body, ambito, owner_id, orden`,
    [id, label ?? null, body ?? null, orden ?? null]
  );
  return rows[0] || null;
}

// Baja logica: si alguien la borra por error, el texto no se pierde.
export async function deleteTemplate(id) {
  await query(`UPDATE whatsapp_templates SET active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
}

// ── La cola de prospectos ────────────────────────────────────────────────────
// A quien toca escribir, y en que orden. Primero quien no ha recibido nunca un
// mensaje, y despues por antiguedad del ultimo contacto: el que lleva mas
// tiempo parado sube.
//
// La fecha de entrada es COALESCE(fecha_solicitud, created_at) AT TIME ZONE,
// igual que en los informes. created_at a secas no vale: los leads cargados a
// mano lo tienen del dia de la carga, no del dia en que la persona escribio.

const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';
const ENTRADA = `(COALESCE(l.fecha_solicitud, l.created_at) AT TIME ZONE '${TZ}')`;

export async function cola({ projectId, responsableId, estado, productoId, soloSinContactar, limite = 100 }) {
  const cond = ['l.deleted_at IS NULL', "l.status NOT IN ('convertido', 'no_interesado')"];
  const params = [];
  if (projectId) { params.push(projectId); cond.push(`l.project_id = $${params.length}`); }
  if (responsableId) { params.push(responsableId); cond.push(`l.responsable_id = $${params.length}`); }
  if (estado) { params.push(estado); cond.push(`l.status = $${params.length}`); }
  if (productoId) { params.push(productoId); cond.push(`l.producto_interes_id = $${params.length}`); }
  // Sin telefono no hay nada que hacer aqui.
  cond.push("COALESCE(l.telefono, '') <> ''");
  if (soloSinContactar) {
    cond.push(`NOT EXISTS (SELECT 1 FROM lead_interactions i
                            WHERE i.lead_id = l.id AND i.tipo <> 'nota')`);
  }
  params.push(limite);

  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status,
            ${ENTRADA}::date AS entrada,
            COALESCE(p.nombre, '—') AS producto,
            u.nombre AS gestora,
            (SELECT MAX(i.fecha) FROM lead_interactions i
              WHERE i.lead_id = l.id AND i.tipo <> 'nota') AS ultimo_contacto,
            (SELECT COUNT(*)::int FROM lead_interactions i
              WHERE i.lead_id = l.id AND i.tipo <> 'nota') AS contactos
       FROM leads l
       LEFT JOIN products p ON p.id = l.producto_interes_id
       LEFT JOIN users u ON u.id = l.responsable_id
      WHERE ${cond.join(' AND ')}
      ORDER BY (SELECT MAX(i.fecha) FROM lead_interactions i
                 WHERE i.lead_id = l.id AND i.tipo <> 'nota') ASC NULLS FIRST,
               ${ENTRADA} ASC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ── Sala ─────────────────────────────────────────────────────────────────────

// El nombre con el que se entra al navegador remoto. Importa porque es lo que
// ve el resto en la sala: si entra un admin a ayudar, la gestora tiene que
// saber quien es y no un «usuario-14».
export async function nombreDe(userId) {
  const { rows: [u] } = await query('SELECT nombre, email FROM users WHERE id = $1', [userId]);
  return u?.nombre || u?.email?.split('@')[0] || `usuario-${userId}`;
}

// Quien tiene sala propia. Las gestoras siempre; los admin solo si trabajan
// leads (recibe_leads), porque un admin que solo supervisa no necesita un
// numero propio: entra en el de otra. Es el mismo criterio del reparto de
// leads, para que las dos listas no se contradigan.
export async function equipo(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.nombre, u.email, u.role, u.last_login_at,
            COALESCE(u.is_available, TRUE) AS disponible
       FROM users u
       JOIN user_projects up ON up.user_id = u.id
      WHERE u.active = TRUE
        AND up.project_id = $1
        AND (u.role = 'gestor' OR (u.role IN ('admin','superadmin') AND up.recibe_leads = TRUE))
      ORDER BY u.nombre`,
    [projectId]
  );
  return rows;
}
