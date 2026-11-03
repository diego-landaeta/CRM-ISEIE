import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { correo, parrafo, boton, nota, esc, enlace } from '../../shared/services/email-plantilla.service.js';
import { notifyUsers } from '../notifications/notifications.service.js';

/**
 * Los correos de «Cursos pendientes» (#336): la tutora y el admin se enteran sin
 * tener que abrir el CRM. Salen DETRÁS de la notificación de campana, la misma
 * frase con el mismo enlace, para que las dos vías no se contradigan.
 *
 *   · Apagados por defecto (CURSOS_PENDIENTES_CORREOS_ACTIVOS=true los enciende),
 *     como los de tareas: con el interruptor apagado se arma el correo y se
 *     registra, pero no se llama a Brevo.
 *   · Cada persona los apaga con el aviso `cursos_pendientes` (avisos_apagados).
 *   · Cada correo lleva clave de idempotencia: un reintento o un reinicio no lo
 *     manda dos veces.
 *   · Un fallo de correo nunca rompe la notificación ni el aviso del job.
 */

export const AVISO_CURSOS_PENDIENTES = 'cursos_pendientes';

export const correosActivos = () => {
  const v = String(process.env.CURSOS_PENDIENTES_CORREOS_ACTIVOS || '').toLowerCase();
  return v === 'true' || v === '1';
};

/** A quién le llega: activos, con correo y sin el aviso apagado. */
async function conCorreo(userIds) {
  if (!userIds?.length) return [];
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email
       FROM users u
      WHERE u.id = ANY($1::int[]) AND u.active AND u.email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM avisos_apagados a WHERE a.user_id = u.id AND a.aviso = $2)`,
    [userIds, AVISO_CURSOS_PENDIENTES]
  );
  return rows;
}

/** El correo, armado. Separado del envío para poder probarlo sin Brevo. */
export function armarCorreo({ persona, titulo, mensaje, link_path, marca = null }) {
  const { htmlContent, textContent } = correo({
    proyecto: marca || {},
    titulo,
    saludo: persona.nombre,
    resumen: mensaje,
    bloques: [
      nota(`<strong>${esc(titulo)}</strong><br>${esc(mensaje)}`),
      link_path ? boton({ texto: 'Abrir Cursos pendientes', url: enlace(link_path) }) : null,
      parrafo('<span style="font-size:13px;color:#71717a">Puedes apagar estos avisos en «Mis preferencias».</span>'),
    ],
  });
  return { asunto: titulo, htmlContent, textContent };
}

/**
 * Notifica en la campana y, si toca, por correo. Mismo contrato que `notifyUsers`
 * más `clave` (prefijo de idempotencia del correo) y `project_id` (la marca).
 */
export async function notificar({ clave = null, project_id = null, ...notificacion }) {
  const fila = await notifyUsers(notificacion);
  try {
    const personas = await conCorreo(notificacion.targetUserIds);
    for (const persona of personas) {
      const c = armarCorreo({ persona, titulo: notificacion.title, mensaje: notificacion.message || '', link_path: notificacion.link_path });
      if (!correosActivos()) {
        logger.info({ to: persona.email, subject: c.asunto, clave }, 'Correo de cursos pendientes registrado sin enviar (CURSOS_PENDIENTES_CORREOS_ACTIVOS apagado)');
        continue;
      }
      await sendEmail({
        to: [{ email: persona.email, name: persona.nombre }],
        subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
        tags: ['cursos-pendientes', notificacion.type],
        clave: clave ? `${clave}-${persona.id}` : null,
        projectId: project_id,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message, type: notificacion.type }, 'Cursos pendientes: el correo falló (la notificación sí salió)');
  }
  return fila;
}
