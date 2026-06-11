import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import { notifyUsers } from '../modules/notifications/notifications.service.js';

const TICK_MS = parseInt(process.env.REMINDER_TICK_MS || String(15 * 60 * 1000)); // 15 min

let running = false;

async function processDueReminders() {
  // Buscar recordatorios vencidos no completados y no notificados aún.
  // OJO: ya NO exigimos u.email IS NOT NULL — el recordatorio se notifica en
  // campanita aunque el gestor no tenga email configurado (que lo tiene casi
  // siempre, pero por si acaso).
  const { rows } = await query(`
    SELECT r.id, r.lead_id, r.fecha_recordatorio, r.nota,
           l.nombre as lead_nombre, l.email as lead_email, l.responsable_id,
           u.nombre as gestor_nombre, u.email as gestor_email,
           p.nombre as proyecto_nombre
      FROM lead_reminders r
      JOIN leads l ON l.id = r.lead_id
      JOIN projects p ON p.id = l.project_id
      LEFT JOIN users u ON u.id = l.responsable_id
     WHERE r.completado = false
       AND r.fecha_recordatorio <= CURRENT_DATE
       AND r.notificado_at IS NULL
       AND l.responsable_id IS NOT NULL
     LIMIT 50
  `);

  for (const rem of rows) {
    // 1) Notificación in-app SIEMPRE para el gestor responsable (la campanita
    //    es el canal principal — no depende de Brevo).
    await notifyUsers({
      targetUserIds: [rem.responsable_id],
      type: 'lead_reminder',
      title: `Recordatorio: ${rem.lead_nombre}`,
      message: rem.nota || `Tienes un recordatorio vencido para ${rem.lead_nombre} (${rem.proyecto_nombre})`,
      link_path: `/leads/${rem.lead_id}`,
      metadata: { reminder_id: rem.id, lead_id: rem.lead_id, fecha: rem.fecha_recordatorio },
    });

    // 2) Email best-effort (si Brevo no está configurado o falla, no bloquea).
    if (rem.gestor_email) {
      try {
        const baseUrl = process.env.CRM_BASE_URL || 'http://localhost:5173/crm';
        await sendEmail({
          to: rem.gestor_email,
          subject: `Recordatorio vencido: ${rem.lead_nombre} (${rem.proyecto_nombre})`,
          htmlContent: `
            <p>Hola ${rem.gestor_nombre},</p>
            <p>Tienes un recordatorio vencido para el prospecto <strong>${rem.lead_nombre}</strong>.</p>
            ${rem.nota ? `<p><em>"${rem.nota}"</em></p>` : ''}
            <p>Fecha: ${rem.fecha_recordatorio}</p>
            <p><a href="${baseUrl}/leads/${rem.lead_id}">Ver prospecto →</a></p>
          `,
          tags: ['reminder', `lead-${rem.lead_id}`],
        });
      } catch (err) {
        // Email fallido NO debe impedir marcar el recordatorio como notificado —
        // la campanita ya cumplió.
        logger.warn({ err: err.message, reminderId: rem.id }, 'Reminder: email fallido (campanita ya disparada)');
      }
    }

    // 3) Marcar como notificado para no reenviar en el siguiente tick.
    try {
      await query(`UPDATE lead_reminders SET notificado_at = NOW() WHERE id = $1`, [rem.id]);
      logger.info({ reminderId: rem.id, leadId: rem.lead_id, gestorId: rem.responsable_id }, 'Recordatorio notificado (in-app + email)');
    } catch (err) {
      logger.error({ err: err.message, reminderId: rem.id }, 'Error marcando recordatorio notificado');
    }
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await processDueReminders();
  } catch (err) {
    logger.error({ err }, 'Reminder scheduler tick error');
  } finally {
    running = false;
  }
}

export function startReminderScheduler() {
  if (process.env.REMINDER_DISABLED === '1') {
    logger.info('Reminder scheduler desactivado (REMINDER_DISABLED=1)');
    return;
  }
  tick();
  setInterval(tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Reminder scheduler iniciado');
}
