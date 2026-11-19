import { logger } from '../shared/utils/logger.js';
import { completarReversiones } from '../modules/certifex/certifex.revertir.js';
import { vigilar } from './latido.js';

/**
 * Diplomas revertidos (#351): lo que Certifex revirtió y el CRM no llegó a apuntar (se cortó la
 * respuesta, o la base del CRM falló justo después) se apunta aquí, con lo que dice Certifex.
 * Antes lo hacía la carga de «Diplomas»; un GET no escribe, así que va en su tarea. Cada 10
 * minutos. Sin Certifex conectado no hace nada. Se apaga con CERTIFEX_REVERSIONES_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.CERTIFEX_REVERSIONES_TICK_MS || String(10 * 60 * 1000), 10);

export function startCertifexReversionesScheduler() {
  if (process.env.CERTIFEX_REVERSIONES_DISABLED === '1') {
    logger.info('Repaso de diplomas revertidos desactivado (CERTIFEX_REVERSIONES_DISABLED=1)');
    return;
  }
  if (!process.env.CERTIFEX_API_URL || !process.env.CERTIFEX_CRM_CLAVE) return;
  vigilar('certifex_reversiones', 'Diplomas revertidos: apuntar en el CRM lo que falte', () => completarReversiones(), CADA_MS, { alArrancarMs: 2 * 60 * 1000 });
}
