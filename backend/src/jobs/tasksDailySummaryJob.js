import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { findDailyDigest } from '../modules/tasks/tasks.model.js';
import {
  armarCorreoDelDia,
  despacharCorreo,
  AVISO_TAREAS_DEL_DIA,
} from '../modules/tasks/tasks.emails.js';
import { marcaDeLaPersona } from '../shared/services/marca.service.js';

/**
 * El correo de cada mañana del tablero de tareas (#210, fase 3): a cada persona,
 * lo que le vence hoy y lo que ya tiene vencido. Quien no tiene nada de eso no
 * recibe nada — un correo diario que dice «nada» enseña a no abrirlo.
 *
 * La hora es la de la oficina (APP_TIMEZONE, o Europe/Madrid), como
 * feedbackDia7Scheduler: el servidor está en UTC, y «a las 8» salía a las 10 en
 * Madrid. «Hoy», tanto para la consulta como para la clave de idempotencia,
 * también es el día de la oficina.
 *
 * Sale por `despacharCorreo`: con TAREAS_CORREOS_ACTIVOS apagado se arma y se
 * registra, pero no llega a Brevo. Se apaga por persona en «Mis preferencias»
 * («tareas_del_dia») o, para todo un entorno, con TAREAS_DIARIO_DISABLED=1.
 */

const HORA = parseInt(process.env.TAREAS_DIARIO_HORA || '8', 10);
const TICK_MS = parseInt(process.env.TAREAS_DIARIO_TICK_MS || String(30 * 60 * 1000), 10);

const zona = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

export function horaLocal(d = new Date()) {
  return Number(new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hourCycle: 'h23', timeZone: zona() }).format(d));
}

export function hoyLocal(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function runTasksDailySummary({ ahora = new Date(), forzar = false } = {}) {
  if (!forzar && horaLocal(ahora) !== HORA) return { omitido: 'fuera de hora' };

  const hoy = hoyLocal(ahora);
  const gente = await findDailyDigest(AVISO_TAREAS_DEL_DIA, hoy, zona());
  let mandados = 0;
  for (const persona of gente) {
    try {
      // La marca de la persona: la de su empresa, no la de un campus suyo (11/11).
      const marca = await marcaDeLaPersona({ userId: persona.user_id }).catch(() => null);
      const c = armarCorreoDelDia({ persona, tareas: persona.tareas, hoy: ahora, marca });
      const r = await despacharCorreo({
        marca,
        to: [{ email: persona.email, name: persona.nombre }],
        subject: c.asunto,
        htmlContent: c.htmlContent,
        textContent: c.textContent,
        tags: ['tareas', 'tareas-del-dia'],
        clave: `${AVISO_TAREAS_DEL_DIA}-${persona.user_id}-${hoy}`,
      });
      if (r?.sent) mandados++;
    } catch (err) {
      // Que falle el de una persona no deja sin aviso a las demas.
      logger.error({ err: err.message, userId: persona.user_id }, 'Fallo mandando el correo diario de tareas');
    }
  }
  if (gente.length) logger.info({ destinatarios: gente.length, mandados }, 'Correo diario de tareas');
  return { destinatarios: gente.length, mandados };
}

export function startTasksDailySummaryScheduler() {
  if (process.env.TAREAS_DIARIO_DISABLED === '1') {
    logger.info('Correo diario de tareas desactivado (TAREAS_DIARIO_DISABLED=1)');
    return;
  }
  vigilar('tareas_del_dia', 'Tareas: correo de cada mañana', () => runTasksDailySummary(), TICK_MS);
}
