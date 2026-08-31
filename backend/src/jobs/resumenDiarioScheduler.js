import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import { vigilar } from './latido.js';

/**
 * Los dos avisos de final y principio de jornada, de la tarea #28.
 *
 *   · **Resumen del dia** al cerrar — a la gestora y a administracion.
 *   · **Plan de mañana** por la noche — a la gestora.
 *
 * Van juntos porque comparten todo menos el texto: la misma consulta de a quien
 * avisar, el mismo respeto por quien lo apago y la misma clave de idempotencia.
 * Separarlos habria sido escribir dos veces lo mismo para que se separaran solos
 * el dia que alguien tocara uno.
 *
 * La clave lleva el DIA, al reves que el aviso de prospecto sin contactar. Ahi
 * el aviso es «este lead concreto» y repetirlo seria acosar; aqui es «lo de
 * hoy», y tiene que llegar cada dia. Un reinicio no lo repite, y eso es lo que
 * se quiere.
 */

const HORA_RESUMEN = parseInt(process.env.RESUMEN_HORA || '19', 10);
const HORA_PLAN = parseInt(process.env.PLAN_HORA || '21', 10);
const TICK_MS = parseInt(process.env.RESUMEN_TICK_MS || String(30 * 60 * 1000), 10);

let corriendo = false;

const hoy = () => new Date().toISOString().slice(0, 10);

/** A quien le toca este aviso: gestoras activas que no lo hayan apagado. */
async function destinatarios(aviso, roles) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email
       FROM users u
      WHERE u.active
        AND u.email IS NOT NULL
        AND u.role = ANY($1)
        AND NOT COALESCE(u.gestor_colaboraciones, false)
        AND NOT EXISTS (
          SELECT 1 FROM avisos_apagados a
           WHERE a.user_id = u.id AND a.aviso = $2
        )
      ORDER BY u.nombre`,
    [roles, aviso]
  );
  return rows;
}

/** Lo que ha pasado hoy con los prospectos de esa persona. */
async function loDeHoy(userId) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM leads
         WHERE responsable_id = $1 AND deleted_at IS NULL
           AND COALESCE(fecha_solicitud, created_at)::date = CURRENT_DATE) AS entraron,
       (SELECT count(*)::int FROM lead_interactions i
          JOIN leads l ON l.id = i.lead_id
         WHERE l.responsable_id = $1 AND i.fecha::date = CURRENT_DATE) AS contactos,
       (SELECT count(*)::int FROM leads
         WHERE responsable_id = $1 AND deleted_at IS NULL
           AND status = 'convertido' AND updated_at::date = CURRENT_DATE) AS convertidos,
       (SELECT count(*)::int FROM leads l
         WHERE l.responsable_id = $1 AND l.deleted_at IS NULL
           AND l.status IN ('nuevo','por_contactar')
           AND NOT EXISTS (SELECT 1 FROM lead_interactions i WHERE i.lead_id = l.id)) AS sin_tocar`,
    [userId]
  );
  return rows[0];
}

/** Lo que le espera mañana: lo pendiente de hoy mas sus recordatorios. */
async function loDeManana(userId) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM leads l
         WHERE l.responsable_id = $1 AND l.deleted_at IS NULL
           AND l.status IN ('nuevo','por_contactar')
           AND NOT EXISTS (SELECT 1 FROM lead_interactions i WHERE i.lead_id = l.id)) AS sin_tocar,
       (SELECT count(*)::int FROM leads
         WHERE responsable_id = $1 AND deleted_at IS NULL
           AND status = 'en_seguimiento') AS en_seguimiento,
       (SELECT count(*)::int FROM lead_reminders r
          JOIN leads l ON l.id = r.lead_id
         WHERE l.responsable_id = $1 AND r.completado = false
           AND r.fecha_recordatorio <= CURRENT_DATE + 1) AS recordatorios`,
    [userId]
  );
  return rows[0];
}

const fila = (etiqueta, valor) =>
  `<li><strong>${valor}</strong> ${etiqueta}</li>`;

function textoResumen(nombre, d) {
  // Si no ha pasado NADA, se dice y punto. Un resumen de ceros disfrazado de
  // informe es la forma mas rapida de que se deje de leer.
  const nada = !d.entraron && !d.contactos && !d.convertidos;
  return `
    <p>Hola ${nombre},</p>
    ${nada
      ? '<p>Hoy no ha entrado ningun prospecto nuevo ni se ha registrado actividad.</p>'
      : `<p>Como ha ido el dia:</p>
         <ul>
           ${d.entraron ? fila('prospectos nuevos', d.entraron) : ''}
           ${d.contactos ? fila('contactos apuntados', d.contactos) : ''}
           ${d.convertidos ? fila('convertidos', d.convertidos) : ''}
         </ul>`}
    ${d.sin_tocar
      ? `<p><strong>Te quedan ${d.sin_tocar} sin contactar.</strong></p>`
      : '<p>No te queda ninguno sin contactar. Bien.</p>'}
    <p style="font-size:12px;color:#666">Puedes apagar este aviso en <em>Mis preferencias</em>.</p>
  `;
}

function textoPlan(nombre, d) {
  const nada = !d.sin_tocar && !d.en_seguimiento && !d.recordatorios;
  return `
    <p>Hola ${nombre},</p>
    ${nada
      ? '<p>Mañana no tienes nada pendiente. Descansa.</p>'
      : `<p>Lo que te espera mañana:</p>
         <ul>
           ${d.sin_tocar ? fila('sin contactar todavia', d.sin_tocar) : ''}
           ${d.en_seguimiento ? fila('en seguimiento', d.en_seguimiento) : ''}
           ${d.recordatorios ? fila('recordatorios que vencen', d.recordatorios) : ''}
         </ul>`}
    <p style="font-size:12px;color:#666">Puedes apagar este aviso en <em>Mis preferencias</em>.</p>
  `;
}

async function mandar(aviso, roles, asunto, arma) {
  const gente = await destinatarios(aviso, roles);
  let mandados = 0;
  for (const persona of gente) {
    try {
      const datos = await arma(persona.id);
      const r = await sendEmail({
        to: persona.email,
        subject: asunto,
        htmlContent: aviso === 'resumen_del_dia'
          ? textoResumen(persona.nombre, datos)
          : textoPlan(persona.nombre, datos),
        tags: ['recordatorio', aviso.replace(/_/g, '-')],
        // Con el DIA: este aviso tiene que llegar cada dia, pero una sola vez.
        clave: `${aviso}-${persona.id}-${hoy()}`,
      });
      if (r?.sent) mandados++;
    } catch (err) {
      // Que falle el de una persona no puede dejar sin aviso a las demas.
      logger.error({ err: err.message, userId: persona.id, aviso }, 'Fallo mandando el aviso diario');
    }
  }
  return { destinatarios: gente.length, mandados };
}

async function vuelta() {
  if (corriendo) return;
  corriendo = true;
  try {
    const hora = new Date().getHours();

    // Se comprueba la hora en cada vuelta en vez de programar a una hora exacta:
    // asi un reinicio a las 19:05 no se salta el aviso del dia. La clave impide
    // que se mande dos veces.
    if (hora === HORA_RESUMEN) {
      const r = await mandar(
        'resumen_del_dia',
        ['gestor', 'admin', 'superadmin'],
        '[CRM] Resumen del dia',
        loDeHoy
      );
      logger.info({ ...r, aviso: 'resumen_del_dia' }, 'Resumen del dia');
    }

    if (hora === HORA_PLAN) {
      const r = await mandar(
        'plan_de_manana',
        ['gestor'],
        '[CRM] Lo que te espera mañana',
        loDeManana
      );
      logger.info({ ...r, aviso: 'plan_de_manana' }, 'Plan de mañana');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Fallo en los avisos diarios');
  } finally {
    corriendo = false;
  }
}

export function startResumenDiarioScheduler() {
  if (process.env.RESUMEN_DISABLED === '1') {
    logger.info('Avisos diarios desactivados (RESUMEN_DISABLED=1)');
    return;
  }
  vigilar('resumen_diario', 'Resumen del día y plan de mañana', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS, horaResumen: HORA_RESUMEN, horaPlan: HORA_PLAN },
    'Avisos diarios iniciados');
}

export const _internos = { destinatarios, loDeHoy, loDeManana, textoResumen, textoPlan, mandar, vuelta };
