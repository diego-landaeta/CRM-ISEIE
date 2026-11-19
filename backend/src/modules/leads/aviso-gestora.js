import { query } from '../../shared/config/db.js';
import { sendLeadAssignedEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';

/*
  AVISAR A LA GESTORA DE SU PROSPECTO NUEVO: la campana (#111) y el correo.

  Estaba escrito DENTRO del alta por webhook (`_createLeadCore`, Make y el
  webhook del campus), y los otros caminos que crean un lead repartido —el
  webhook de FORMULARIOS (Elementor, correo, el incrustado) y el webhook con
  token— no avisaban a nadie. La asignación por actividad (#513) da por hecho
  que sí («esos campus no tienen escenario: el CRM ya avisa a la gestora»), y
  no era verdad.

  Revisión del reparto, 18/11/2026: en ICTESS el formulario de la web entra por
  el webhook de formularios y además por Make. El de formularios llega antes,
  crea el lead y se lo da a quien toca; Make llega unos segundos después y se
  junta con ese lead (reenvío del mismo formulario). Resultado: en 14 días, 21
  prospectos de ICTESS sin campana y 18 sin correo para su gestora; también
  los de ISECD, ISSLOGG y Academia IA que entran por formulario.

  Ahora hay un solo sitio que avisa, y lo usan los tres caminos. Gemela de
  MultiCRM: en ISEIE, además, el alta por Make solo mandaba el correo y no la
  campana, aunque el tipo `lead_asignado` ya estaba en el catálogo de avisos.

  Nunca lanza ni hace esperar al alta: la campana y el correo van por detrás
  (el webhook tiene que contestar en menos de 500 ms).
*/

/**
 * @param {object} p
 * @param {object} p.lead       el lead recién creado: id, nombre, email, telefono, responsable_id (o responsableId), project_id
 * @param {object} [p.proyecto] { id, nombre, slug }; si no viene, se busca por `lead.project_id`
 * @param {string} [p.canal]    por dónde entró, para el texto de la campana
 * @returns {Promise<boolean>} si había a quién avisar
 */
export async function avisarGestoraDelLeadNuevo({ lead, proyecto = null, canal = null }) {
  const responsableId = lead?.responsable_id ?? lead?.responsableId ?? null;
  // Sin responsable no hay a quien avisar: pasa cuando el reparto esta apagado
  // o no hay gestoras en el proyecto, y de eso ya avisa el panel de la cola.
  if (!lead?.id || !responsableId) return false;
  const projectId = proyecto?.id ?? lead.project_id ?? null;

  notifyUsers({
    targetUserIds: [responsableId],
    type: 'lead_asignado',
    title: `Nuevo prospecto: ${lead.nombre || 'sin nombre'}`,
    message: canal ? `Entro por ${canal}.` : 'Te lo ha asignado el reparto automatico.',
    link_path: `/prospectos/${lead.id}`,
    metadata: { lead_id: lead.id, project_id: projectId },
  }).catch(() => {});

  (async () => {
    try {
      const { rows } = await query(`SELECT id, nombre, email FROM users WHERE id = $1`, [responsableId]);
      if (!rows[0]?.email) return;
      let p = proyecto;
      if (!p && projectId) {
        const r = await query(`SELECT id, nombre, slug FROM projects WHERE id = $1`, [projectId]);
        p = r.rows[0] || null;
      }
      const baseUrl = process.env.CRM_BASE_URL || 'http://localhost:5173/crm';
      await sendLeadAssignedEmail({
        gestor: rows[0],
        lead: { id: lead.id, nombre: lead.nombre, email: lead.email, telefono: lead.telefono },
        proyecto: p ? { id: p.id, nombre: p.nombre, slug: p.slug, logo_url: p.logo_url, emoji: p.emoji } : null,
        baseUrl,
      });
    } catch (err) {
      logger.warn({ err: err.message, leadId: lead.id }, 'Notificacion gestor fallo');
    }
  })();

  return true;
}

export default { avisarGestoraDelLeadNuevo };
