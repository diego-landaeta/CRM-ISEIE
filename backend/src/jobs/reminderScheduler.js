import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';

const TICK_MS = parseInt(process.env.REMINDER_TICK_MS || String(15 * 60 * 1000)); // 15 min

let running = false;

async function processDueReminders() {
  // Buscar recordatorios vencidos no completados y no notificados aún
  const { rows } = await query(`
    SELECT r.id, r.lead_id, r.fecha_recordatorio, r.nota,
           l.nombre as lead_nombre, l.email as lead_email,
           u.nombre as gestor_nombre, u.email as gestor_email,
           p.nombre as proyecto_nombre
      FROM lead_reminders r
      JOIN leads l ON l.id = r.lead_id
      JOIN projects p ON p.id = l.project_id
      LEFT JOIN users u ON u.id = l.responsable_id
     WHERE r.completado = false
       AND r.fecha_recordatorio <= CURRENT_DATE
       AND r.notificado_at IS NULL
       AND u.email IS NOT NULL
     LIMIT 50
  `);

  for (const rem of rows) {
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

      await query(
        `UPDATE lead_reminders SET notificado_at = NOW() WHERE id = $1`,
        [rem.id]
      );
      logger.info({ reminderId: rem.id, leadId: rem.lead_id, gestor: rem.gestor_email }, 'Recordatorio notificado');
    } catch (err) {
      logger.error({ err: err.message, reminderId: rem.id }, 'Error notificando recordatorio');
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
