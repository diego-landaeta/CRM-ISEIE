import { logger } from '../shared/utils/logger.js';
import { vueltaDeEntregas } from '../modules/tutores/tutor.entregasAdministracion.js';
import { vigilar } from './latido.js';

/**
 * El aviso a la tutora de las entregas que llevan más de 48 h sin corregir (#457; #681 en el CRM 360).
 *
 * Cada dos horas: el plazo es de 48 h y no hace falta más precisión, y cada vuelta lee
 * de Moodle los cursos de todas las tutoras. Cada entrega se avisa UNA vez (la tabla
 * `entregas_sin_corregir_avisos` lo recuerda): repetir la vuelta o reiniciar no repite.
 *
 * En la misma vuelta, detrás, el segundo escalón (#457; #769 en el 360): a administración, las que siguen
 * sin corregir a los ENTREGAS_AVISO_ADMIN_DIAS días (5) o en su «Recordarme calificar antes
 * de», y las de cursos sin tutora en el CRM a las 48 h (tutor.entregasAdministracion.js).
 *
 * Solo arranca fuera de producción o aprobado con PLUGIN_MOODLE_EN_PRODUCCION=1 (lo mira app.js con
 * `pluginMoodleActivo`). Se apaga con ENTREGAS_SIN_CORREGIR_DISABLED=1.
 */

const TICK_MS = parseInt(process.env.ENTREGAS_SIN_CORREGIR_TICK_MS || String(2 * 60 * 60 * 1000), 10);

export function startEntregasSinCorregirScheduler() {
  if (process.env.ENTREGAS_SIN_CORREGIR_DISABLED === '1') {
    logger.info('Aviso de entregas sin corregir desactivado (ENTREGAS_SIN_CORREGIR_DISABLED=1)');
    return;
  }
  vigilar('entregas_sin_corregir', 'Entregas sin corregir: a la tutora a las 48 h y después a administración',
    () => vueltaDeEntregas(), TICK_MS, { alArrancarMs: 5 * 60 * 1000 });
}
