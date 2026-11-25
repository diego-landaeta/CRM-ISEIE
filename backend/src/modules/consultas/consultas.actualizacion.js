/*
  UN CAMPUS CON UNA ACTUALIZACIÓN PENDIENTE (Campus-Moodle#24).

  El 25/11/2026 el Moodle de ISEIE recibió los ficheros de local_crm 1.11.4 pero no el paso de
  base de datos, y se quedó en «Comprobación de plugins»: la administradora no podía avanzar y
  nadie se enteró hasta que lo vio a mano. Los nueve campus se actualizan solos de madrugada.

  Desde la 1.12.0 el plugin lo cuenta de dos maneras, y las dos llegan aquí:
    · al momento, tras instalar (o no) una versión: un aviso firmado con
      `evento: 'plugin_estado'` (classes/actualizar.php, `avisar_crm`), por consultas.avisos.js;
    · en el repaso de cada 15 minutos: `local_crm_mensajes_desde` trae
      `actualizacion_pendiente`, `version_disco`, `version_bd` y `pendientes`
      (consultas.plugin.js, `sincronizarCampus`). Responde aunque el sitio esté pendiente.
  Un plugin anterior a la 1.12.0 no manda nada de esto: entonces no se toca el estado.

  Se guarda en `moodle_plugin_campus.actualizacion_pendiente` (NULL = al día; si no, el detalle)
  y se enseña en Integraciones › Moodle. Cuando un campus PASA a pendiente, campana a los super
  admin, una vez (el paso de NULL a algo es atómico: el aviso y el repaso no avisan dos veces).
  Sin la migración, se avisa igual, como mucho una vez al día por campus.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';

export const TIPO = 'moodle_actualizacion_pendiente';

/** Donde se ve: Integraciones, con el campus elegido y bajando a su tarjeta Moodle. */
export const enlaceDelCampus = (projectId) => `/accounting/integrations?campus=${projectId}&seccion=moodle`;

const texto = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');

/**
 * Lo que dice el plugin, del aviso (`pendiente`) o del repaso (`actualizacion_pendiente`).
 * `pendiente: null` = el plugin no lo dice (anterior a la 1.12.0).
 */
export function leerEstado(datos) {
  const v = datos?.actualizacion_pendiente ?? datos?.pendiente;
  return {
    pendiente: typeof v === 'boolean' ? v : null,
    version_disco: texto(datos?.version_disco, 60),
    version_bd: texto(datos?.version_bd, 30),
    pendientes: texto(datos?.pendientes ?? datos?.componentes, 500),
    mensaje: texto(datos?.mensaje, 500),
  };
}

/** Qué le pasa al campus y qué hacer, dicho para quien lo lee en la campana o en Integraciones. */
export function explicar(d) {
  const otros = String(d.pendientes || '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'local_crm');
  const versiones = d.version_disco
    ? `Tiene el plugin del CRM ${d.version_disco} en los ficheros y ${d.version_bd || 'otra versión'} en la base. `
    : '';
  return `${versiones}Moodle está en «Comprobación de plugins»: los administradores no pueden usar el sitio y el cron está parado. `
    + 'Un administrador del campus tiene que entrar en Administración del sitio › Notificaciones y pulsar '
    + '«Actualizar base de datos Moodle ahora».'
    + (otros.length ? ` También están pendientes: ${otros.join(', ')}.` : '');
}

async function superAdmins() {
  const { rows } = await query(
    `SELECT id FROM users WHERE active AND (role = 'superadmin' OR roles_extra && ARRAY['superadmin']::user_role[])`);
  return rows.map((r) => r.id);
}

async function avisadoHoy(projectId) {
  const { rows } = await query(
    `SELECT 1 FROM admin_notifications
      WHERE type = $1 AND (metadata->>'campus_id')::int = $2 AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
    [TIPO, projectId]);
  return rows.length > 0;
}

async function avisar(projectId, detalle, destinatarios) {
  const para = destinatarios ?? await superAdmins();
  if (!para.length) return false;
  const { rows: [p] } = await query('SELECT nombre FROM projects WHERE id = $1', [projectId]);
  await notifyUsers({
    targetUserIds: para,
    type: TIPO,
    title: `El Moodle de ${p?.nombre || `el campus ${projectId}`} tiene una actualización pendiente`,
    message: explicar(detalle),
    link_path: enlaceDelCampus(projectId),
    metadata: { campus_id: projectId, version_disco: detalle.version_disco, version_bd: detalle.version_bd },
  });
  logger.warn({ projectId, ...detalle }, 'Moodle: campus con una actualización pendiente, se avisa a los super admin');
  return true;
}

/**
 * Guarda lo que dice el plugin y avisa si el campus acaba de quedar pendiente. Nunca falla:
 * es un aviso, no puede tumbar el repaso ni el aviso de un mensaje.
 *
 * @param {number} projectId
 * @param {ReturnType<typeof leerEstado>} estado
 * @param {{ destinatarios?: number[] }} [opciones] solo para las pruebas
 * @returns {Promise<{ pendiente: boolean|null, avisado?: boolean, resuelta?: boolean }>}
 */
export async function anotarActualizacion(projectId, estado, { destinatarios = null } = {}) {
  if (estado?.pendiente == null) return { pendiente: null };
  try {
    if (!estado.pendiente) {
      const { rowCount } = await query(
        `UPDATE moodle_plugin_campus SET actualizacion_pendiente = NULL
          WHERE project_id = $1 AND actualizacion_pendiente IS NOT NULL`, [projectId]);
      return { pendiente: false, resuelta: rowCount > 0 };
    }
    const detalle = {
      version_disco: estado.version_disco, version_bd: estado.version_bd,
      pendientes: estado.pendientes, mensaje: estado.mensaje, desde: new Date().toISOString(),
    };
    let nueva;
    try {
      // Solo la primera vez: de NULL a pendiente. Si ya lo estaba, se pone al día el detalle
      // sin perder desde cuándo.
      const { rowCount } = await query(
        `UPDATE moodle_plugin_campus SET actualizacion_pendiente = $2::jsonb
          WHERE project_id = $1 AND actualizacion_pendiente IS NULL`, [projectId, JSON.stringify(detalle)]);
      nueva = rowCount > 0;
      if (!nueva) {
        await query(
          `UPDATE moodle_plugin_campus
              SET actualizacion_pendiente = $2::jsonb || jsonb_build_object('desde', actualizacion_pendiente->'desde')
            WHERE project_id = $1 AND actualizacion_pendiente IS NOT NULL`, [projectId, JSON.stringify(detalle)]);
      }
    } catch (err) {
      // 42703: falta la columna (la migración de esta tarea). Se avisa igual, una vez al día.
      if (err?.code !== '42703') throw err;
      nueva = !(await avisadoHoy(projectId));
    }
    const avisado = nueva ? await avisar(projectId, detalle, destinatarios) : false;
    return { pendiente: true, avisado };
  } catch (err) {
    logger.warn({ projectId, err: err.message }, 'consultas/actualizacion: no se ha podido anotar el estado de la actualización');
    return { pendiente: estado.pendiente, error: err.message };
  }
}
