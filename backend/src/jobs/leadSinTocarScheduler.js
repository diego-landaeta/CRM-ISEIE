import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import * as P from '../shared/services/email-plantilla.service.js';
import { notifyUsers } from '../modules/notifications/notifications.service.js';
import { vigilar } from './latido.js';

/**
 * «Tienes un prospecto sin tocar desde hace media hora.»
 *
 * Primera subfase de la tarea #28, y la que define su criterio de terminado:
 * entra un lead, no se toca, y a la media hora llega el aviso a su gestora — UNA
 * sola vez.
 *
 * Un lead cuenta como sin tocar cuando se dan las DOS cosas:
 *
 *   · sigue en `nuevo` o `por_contactar`, y
 *   · no tiene ninguna interaccion apuntada.
 *
 * Las dos, no una. Alguien puede haberle escrito por WhatsApp sin cambiarle el
 * estado —pasa constantemente— y avisar ahi seria ruido. Y un aviso que es ruido
 * se deja de leer, con lo que tampoco se lee el que importa: es exactamente lo
 * que le paso al vigilante del catalogo con sus 382 avisos de los que 370
 * sobraban.
 */

const MINUTOS = parseInt(process.env.LEAD_SIN_TOCAR_MINUTOS || '30', 10);
const TICK_MS = parseInt(process.env.LEAD_SIN_TOCAR_TICK_MS || String(5 * 60 * 1000), 10);
const TOPE_POR_VUELTA = 50;

let corriendo = false;

/** Los que llevan mas de MINUTOS sin que nadie haga nada con ellos. */
async function sinTocar() {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.status, l.fecha_solicitud, l.created_at,
            l.responsable_id,
            u.nombre AS gestora, u.email AS gestora_email,
            p.nombre AS proyecto, p.id AS proyecto_id, p.slug AS proyecto_slug,
            p.logo_url AS proyecto_logo, p.emoji AS proyecto_emoji
       FROM leads l
       JOIN users u    ON u.id = l.responsable_id AND u.active
       LEFT JOIN projects p ON p.id = l.project_id
      WHERE l.deleted_at IS NULL
        AND l.status IN ('nuevo', 'por_contactar')
        AND COALESCE(l.fecha_solicitud, l.created_at) < NOW() - ($1 || ' minutes')::interval
        -- Y de los ultimos dos dias: si el CRM ha estado parado o el aviso se
        -- añade hoy, no se quiere una avalancha con todo el historico.
        AND COALESCE(l.fecha_solicitud, l.created_at) > NOW() - INTERVAL '2 days'
        AND NOT EXISTS (
          SELECT 1 FROM lead_interactions i WHERE i.lead_id = l.id
        )
        -- Quien lo haya apagado, no lo recibe.
        AND NOT EXISTS (
          SELECT 1 FROM avisos_apagados a
           WHERE a.user_id = u.id AND a.aviso = 'lead_sin_tocar'
        )
      ORDER BY COALESCE(l.fecha_solicitud, l.created_at)
      LIMIT ${TOPE_POR_VUELTA}`,
    [String(MINUTOS)]
  );
  return rows;
}

// Con la plantilla común y la marca del campus del prospecto (Diego, 10/10:
// «cada correo con un formato completo y lindo, y con el branding»).
function cuerpo(lead) {
  const entro = new Date(lead.fecha_solicitud || lead.created_at);
  const hace = Math.round((Date.now() - entro.getTime()) / 60000);
  const datos = [lead.telefono, lead.email].filter(Boolean).map((d) => P.esc(d)).join('<br>');
  return P.correo({
    proyecto: lead.proyecto_id
      ? { nombre: lead.proyecto, slug: lead.proyecto_slug, logo_url: lead.proyecto_logo, emoji: lead.proyecto_emoji }
      : { nombre: 'ISEIE', slug: 'iseie' },
    titulo: 'Un prospecto sin contactar',
    saludo: lead.gestora || null,
    resumen: `${lead.nombre} entró hace ${hace} minutos`,
    bloques: [
      P.parrafo(`<strong>${P.esc(lead.nombre)}</strong> entró hace ${hace} minutos y todavía no tiene ningún contacto apuntado.`),
      P.nota(`<strong>${P.esc(lead.nombre)}</strong>${datos ? `<br>${datos}` : ''}`),
      P.boton({ texto: 'Abrir el prospecto', url: P.enlace(`/prospectos/${lead.id}`) }),
    ],
    apagar: { texto: 'Este aviso se manda una sola vez por prospecto.' },
  });
}

async function vuelta() {
  if (corriendo) return;
  corriendo = true;
  try {
    const leads = await sinTocar();
    if (!leads.length) return;

    for (const lead of leads) {
      // La campanita SIEMPRE, aunque no haya correo configurado: es el canal
      // que no depende de que Brevo conteste.
      await notifyUsers({
        targetUserIds: [lead.responsable_id],
        type: 'lead_sin_tocar',
        title: `Sin contactar: ${lead.nombre}`,
        message: `Entro hace mas de ${MINUTOS} minutos y no tiene ningun contacto apuntado.`,
        link_path: `/prospectos/${lead.id}`,
      }).catch(() => {});

      if (!lead.gestora_email) continue;

      await sendEmail({
        to: lead.gestora_email,
        subject: `Sin contactar: ${lead.nombre}`,
        ...cuerpo(lead),
        projectId: lead.proyecto_id ?? null,
        tags: ['recordatorio', 'lead-sin-tocar'],
        // UNA sola vez por prospecto, y esto es el criterio de terminado del
        // ticket. La clave lleva el id del lead y no la fecha: el aviso es «este
        // lead lleva sin tocar», no «hoy tienes leads sin tocar». Repetirlo cada
        // dia seria acosar a la gestora por el mismo prospecto.
        clave: `lead-sin-tocar-${lead.id}`,
      });
    }

    logger.info({ cuantos: leads.length, minutos: MINUTOS }, 'Avisos de leads sin tocar');
  } catch (err) {
    logger.error({ err: err.message }, 'Fallo avisando de leads sin tocar');
  } finally {
    corriendo = false;
  }
}

export function startLeadSinTocarScheduler() {
  if (process.env.LEAD_SIN_TOCAR_DISABLED === '1') {
    logger.info('Aviso de leads sin tocar desactivado (LEAD_SIN_TOCAR_DISABLED=1)');
    return;
  }
  // No se llama en el arranque: el primer tick espera un ciclo. Al levantar la
  // aplicacion la base puede no estar lista todavia, y ademas un reinicio no
  // deberia disparar correos — que es de lo que iba la tarea #27.
  vigilar('prospecto_sin_tocar', 'Aviso de prospecto sin contactar', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS, minutos: MINUTOS }, 'Aviso de leads sin tocar iniciado');
}

// Para las pruebas, sin exponer nada que se use por accidente.
export const _internos = { sinTocar, vuelta, cuerpo };
