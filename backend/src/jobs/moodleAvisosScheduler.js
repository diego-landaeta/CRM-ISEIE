import { query } from '../shared/config/db.js';
import { logger } from '../shared/utils/logger.js';
import { notifyUsers } from '../modules/notifications/notifications.service.js';
import { credencialesMoodle, llamarMoodle, ErrorMoodle } from '../modules/mcp/mcp.moodle.cliente.js';
import { FALLOS_DEL_CAMPUS } from '../modules/mcp/mcp.moodle.js';
import { vigilar } from './latido.js';

/**
 * Avisa cuando el Moodle de un campus deja de responder o su token deja de valer (#335).
 *
 * Sin esto, el fallo solo se descubre al abrir la pantalla de Moodle (o cuando Claude contesta
 * «no puedo consultar»). Cada 3 horas se hace una lectura mínima al Moodle de cada campus
 * conectado; si falla, se avisa por la campana a los super admin, que son quienes lo arreglan.
 *
 * Para no avisar por un tropiezo, hacen falta DOS vueltas seguidas con fallo. Y para no
 * repetirse, no se avisa otra vez del mismo campus en 24 horas: se mira en las propias
 * notificaciones, así que no hace falta tabla ni migración. Un reinicio del servidor empieza
 * la cuenta de cero, que es lo prudente.
 */

const TICK_MS = parseInt(process.env.MOODLE_AVISOS_TICK_MS || String(3 * 60 * 60 * 1000), 10);
const VUELTAS_SEGUIDAS = 2;
const HORAS_SIN_REPETIR = 24;
export const TIPO = 'moodle_campus_caido';

/** Cuántas vueltas seguidas lleva fallando cada campus. En memoria: un reinicio la vacía. */
const racha = new Map();
export const _reiniciar = () => racha.clear();

/** Lo que se le dice a quien lo lee, por motivo. Siempre con lo que hay que hacer. */
const QUE_HACER = {
  token_no_valido: 'El token es inválido o ha caducado. Cámbialo en Conexión → Moodle.',
  sin_respuesta: 'Su Moodle no contesta (caído o sin conexión desde el servidor del CRM). Si dura, revisa el servidor del campus.',
  servicios_web_apagados: 'Los servicios web están desactivados en ese Moodle. Actívalos en Administración del sitio → Servidor → Servicios web.',
  redireccion: 'La dirección guardada redirige a otra: seguramente falta el https o ha cambiado. Vuelve a conectarlo en Conexión → Moodle.',
  http: 'Su Moodle contesta con un error del servidor. Si dura, revisa el servidor del campus.',
  credencial_ilegible: 'La clave guardada no se puede leer. Vuelve a conectarlo en Conexión → Moodle.',
  credencial_mal_formada: 'La clave guardada está mal formada. Vuelve a conectarlo en Conexión → Moodle.',
};

async function campusConectados() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT c.project_id AS id, p.nombre
         FROM api_credentials c JOIN projects p ON p.id = c.project_id
        WHERE c.service = 'moodle' AND c.active = true
          AND COALESCE(c.metadata->>'entorno', 'produccion') = 'produccion'
          AND p.active = true AND NOT COALESCE(p.es_prueba, false)
        ORDER BY p.nombre`
    );
    return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre }));
  } catch (err) {
    // 22P02: el enum aún no tiene «moodle» (falta la migración 220): ningún campus.
    if (err?.code === '22P02') return [];
    throw err;
  }
}

/** null si el Moodle responde bien; el código del fallo si no. */
async function comprobar(cred) {
  if (cred instanceof ErrorMoodle) return cred.codigo;
  try {
    await llamarMoodle(cred, 'core_course_get_categories', {}, {});
    return null;
  } catch (err) {
    if (!(err instanceof ErrorMoodle)) return 'inesperado';
    // Que a ESTE token le falte esa función no es que la conexión esté caída.
    return FALLOS_DEL_CAMPUS.includes(err.codigo) ? err.codigo : null;
  }
}

async function yaAvisado(campusId) {
  const { rows } = await query(
    `SELECT 1 FROM admin_notifications
      WHERE type = $1 AND (metadata->>'campus_id')::int = $2
        AND created_at > NOW() - make_interval(hours => $3::int) LIMIT 1`,
    [TIPO, campusId, HORAS_SIN_REPETIR]
  );
  return rows.length > 0;
}

async function superAdmins() {
  const { rows } = await query(`SELECT id FROM users WHERE role = 'superadmin' AND active = true`);
  return rows.map((r) => r.id);
}

/**
 * Una vuelta: comprueba cada campus conectado y avisa de los que lleven VUELTAS_SEGUIDAS fallando.
 * `destinatarios` solo lo usan las pruebas; en producción son los super admin.
 */
export async function vuelta({ destinatarios = null } = {}) {
  const campus = await campusConectados();
  const resumen = { comprobados: campus.length, fallando: 0, avisos: 0 };
  if (!campus.length) return resumen;

  const creds = await credencialesMoodle(campus.map((c) => c.id));
  for (const c of campus) {
    const fallo = await comprobar(creds.get(c.id) ?? new ErrorMoodle('credencial_ilegible', 'sin credencial'));
    if (!fallo) { racha.delete(c.id); continue; }

    resumen.fallando += 1;
    const seguidas = (racha.get(c.id)?.seguidas ?? 0) + 1;
    racha.set(c.id, { seguidas, fallo });
    if (seguidas < VUELTAS_SEGUIDAS || await yaAvisado(c.id)) continue;

    const para = destinatarios ?? await superAdmins();
    if (!para.length) continue;
    await notifyUsers({
      targetUserIds: para,
      type: TIPO,
      title: `El Moodle de ${c.nombre} no responde`,
      message: QUE_HACER[fallo] || 'Su Moodle no responde. Mira Conexión → Moodle.',
      link_path: `/conexion/moodle/${c.id}`,
      metadata: { campus_id: c.id, motivo: fallo },
    });
    resumen.avisos += 1;
    logger.warn({ campusId: c.id, motivo: fallo }, 'Moodle: campus sin respuesta, se avisa a los super admin');
  }
  return resumen;
}

export function startMoodleAvisosScheduler() {
  if (process.env.MOODLE_AVISOS_DISABLED === '1') {
    logger.info('Avisos del Moodle de los campus desactivados (MOODLE_AVISOS_DISABLED=1)');
    return;
  }
  // Como el resto: la primera vuelta espera un ciclo, para que un reinicio no dispare avisos.
  vigilar('moodle_avisos', 'Moodle de los campus: ¿responde y vale el token?', () => vuelta(), TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Avisos del Moodle de los campus iniciados');
}
