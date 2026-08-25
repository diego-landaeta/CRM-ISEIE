import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';

// Postgres: «relation does not exist». Es lo que contesta mientras la migracion
// 122 no este aplicada, y esa la aprueba Diego (tarea #21), no yo.
const TABLA_QUE_NO_ESTA = '42P01';

// ── Plantillas ───────────────────────────────────────────────────────────────
// Se ven las compartidas del proyecto mas las personales de quien pregunta.
// Nunca las personales de otra persona, ni siquiera siendo admin: son suyas.

/**
 * Sin la 122 aplicada devuelve la lista vacia, no un error.
 *
 * Esto se pide en CADA carga del listado de prospectos, para llenar el
 * desplegable de plantillas. Si la tabla no esta y se deja subir el error, cada
 * una de esas cargas contesta 500 — y el manejador de errores escribe todos los
 * 5xx en la tabla de errores. O sea: una migracion sin aplicar llenaria el panel
 * de soporte de ruido, en vez de que simplemente no haya plantillas todavia.
 *
 * Se avisa al registro del servidor UNA vez, que es donde sirve.
 */
let avisadoSinTabla = false;
export async function listTemplates({ projectId, userId }) {
  try {
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
  } catch (err) {
    if (err.code !== TABLA_QUE_NO_ESTA) throw err;
    if (!avisadoSinTabla) {
      avisadoSinTabla = true;
      logger.warn('WhatsApp: falta la migracion 122, no hay plantillas todavia');
    }
    return [];
  }
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
              WHERE i.lead_id = l.id AND i.tipo <> 'nota') AS contactos,
            -- Cuantos hay en total, no cuantos caben. La ventana se calcula
            -- sobre el resultado filtrado y ANTES del LIMIT, asi que da el
            -- total de verdad sin una segunda consulta. Viene en cada fila
            -- —es el precio de no cambiar la forma de la respuesta— y el
            -- frontal solo mira la primera.
            (COUNT(*) OVER())::int AS total
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

// Aqui vivia la seccion Sala: nombreDe, tieneSalaPropia y equipo.
//
// Se van con las funciones del controlador que las llamaban. Nadie mas las
// usaba: el reparto de leads tiene su propio criterio, y el chat nuevo no
// necesita saber quien tiene navegador remoto porque ya no hay ninguno.
