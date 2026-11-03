import { query } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { notifyUsers } from '../../modules/notifications/notifications.service.js';

/**
 * Avisar al super admin cuando el gasto de IA se acerca al tope (#30, #22).
 *
 * «Control del gasto y aviso al acercarse al tope.» El tope (`gastoIA.service`)
 * ya CORTA al llegar a el, pero cortar sin avisar es descubrirlo cuando alguien
 * pregunta algo y le contesta «se alcanzo el tope». Esto avisa antes (80 %) y
 * cuando ya se ha parado (100 %), a quien puede subirlo: es una variable del
 * servidor, `IA_TOPE_MENSUAL_USD`.
 *
 * UNA SOLA VEZ POR UMBRAL Y MES, sin tabla nueva
 *
 * «Ya avisado» se deduce de las propias notificaciones: un aviso del tipo
 * `ia_tope_gasto` con `metadata.mes` y `metadata.umbral`. Si alguien borra el
 * aviso, se vuelve a dar — es lo que se espera de «ya lo viste». Una tabla
 * aparte diria lo mismo con otro nombre, y habria dos sitios que pueden
 * discrepar.
 *
 * SOLO EL UMBRAL MAS ALTO QUE SE HA CRUZADO. Si una llamada grande salta de 70 %
 * a 105 %, sale el aviso del 100 % y no dos a la vez; y una vez dado el del
 * 100 % no tiene sentido que aparezca el del 80 % despues, porque el gasto del
 * mes solo sube.
 *
 * QUIEN NO RECIBE NADA. Sin tope (`IA_TOPE_MENSUAL_USD=0`) no hay umbral que
 * cruzar. Y si no hay ningun super admin activo NO se avisa: `notifyUsers` con la
 * lista vacia es un broadcast a todos los admins, y un aviso de dinero no es
 * para todos.
 *
 * LA CARRERA. Dos llamadas a IA que terminan a la vez cruzan el mismo umbral y
 * las dos miran «¿ya avisado?» antes de que ninguna haya escrito. En produccion
 * hay UN proceso (`instances: 1` en el ecosistema de PM2), asi que basta
 * serializarlas aqui dentro. Si algun dia hay mas de uno, esto deja de bastar y
 * hace falta una restriccion unica en la base.
 */

export const TIPO_AVISO = 'ia_tope_gasto';
export const UMBRALES = [80, 100];

/** El mes en curso, como lo cuenta `gastoIA.service` (hora del servidor). */
export const claveDelMes = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * El umbral mas alto cruzado, o `null`. Se compara `gastado * 100 >= tope * u`
 * y no el porcentaje redondeado: 79,6 % redondea a 80 y todavia no es el 80.
 */
export function umbralCruzado(gastado, tope) {
  if (!(tope > 0) || !Number.isFinite(gastado)) return null;
  return [...UMBRALES].reverse().find((u) => gastado * 100 >= tope * u) ?? null;
}

const usd = (n) => `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 })} USD`;

/** Los super admin activos. Vacio = no se avisa (ver arriba). */
async function superAdminsActivos() {
  const { rows } = await query(
    `SELECT id FROM users WHERE active AND role = 'superadmin' ORDER BY id`
  );
  return rows.map((r) => r.id);
}

async function avisa({ gastado, tope, ahora, destinatarios }) {
  const umbral = umbralCruzado(gastado, tope);
  if (umbral === null) return { avisado: false, motivo: 'por_debajo' };

  const mes = claveDelMes(ahora);
  const { rows: previos } = await query(
    `SELECT 1 FROM admin_notifications
      WHERE type = $1 AND metadata->>'mes' = $2 AND metadata->>'umbral' = $3
      LIMIT 1`,
    [TIPO_AVISO, mes, String(umbral)]
  );
  if (previos.length) return { avisado: false, motivo: 'ya_avisado', umbral, mes };

  const para = destinatarios ?? await superAdminsActivos();
  if (!para.length) {
    logger.warn({ umbral, mes }, 'Gasto IA: hay que avisar del tope y no hay ningun super admin activo');
    return { avisado: false, motivo: 'sin_destinatarios', umbral, mes };
  }

  const porcentaje = Math.round((gastado / tope) * 100);
  const lleva = `Llevamos ${usd(gastado)} de ${usd(tope)} este mes (${porcentaje} %).`;
  const creado = await notifyUsers({
    targetUserIds: para,
    type: TIPO_AVISO,
    title: umbral >= 100
      ? 'Tope de gasto de IA alcanzado: la IA se ha parado hasta el día 1'
      : `El gasto de IA ha llegado al ${umbral} % del tope del mes`,
    message: umbral >= 100
      ? `${lleva} El asistente, el chat y los informes con IA no contestan hasta el día 1; `
        + 'para seguir antes, hay que subir IA_TOPE_MENSUAL_USD en el servidor.'
      : `${lleva} Al llegar al 100 % la IA se para hasta el día 1; `
        + 'si hace falta más, se sube IA_TOPE_MENSUAL_USD en el servidor.',
    link_path: '/informes/ia',
    metadata: { mes, umbral, gastado, tope },
  });
  // `notifyUsers` no lanza: si no pudo escribir devuelve null. Entonces no esta
  // avisado, y la siguiente llamada lo vuelve a intentar.
  return creado
    ? { avisado: true, umbral, mes, notificacion: creado.id }
    : { avisado: false, motivo: 'no_se_pudo_escribir', umbral, mes };
}

let cola = Promise.resolve();

/**
 * Avisa si el gasto del mes ha cruzado un umbral que aun no se ha avisado.
 * No lanza nunca: que falle un aviso no puede tumbar la respuesta de la IA.
 *
 * `ahora` y `destinatarios` existen para las pruebas; en produccion no se pasan.
 */
export function avisaSiCruzaUmbral({
  gastado, tope, ahora = new Date(), destinatarios = null,
}) {
  const esta = cola.then(() => avisa({ gastado: Number(gastado), tope: Number(tope), ahora, destinatarios }));
  cola = esta.catch(() => {});
  return esta.catch((err) => {
    logger.error({ err: err.message }, 'Gasto IA: no se pudo dar el aviso del tope');
    return { avisado: false, motivo: 'error' };
  });
}
