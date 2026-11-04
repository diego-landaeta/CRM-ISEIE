import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { enMadrid } from './facturasColaboradorJob.js';
import { avisarLlegadas, resumenPorPagar } from '../modules/facturas-colaborador/avisos.service.js';

/**
 * Facturas de colaboradores (#202): los avisos a la empresa (Diego, 04/11).
 *
 *   - Cada minuto: «Han llegado N facturas» al correo de facturación de cada
 *     empresa. Se avisa cuando lleva 5 minutos sin llegar otra (o la primera
 *     lleva 30 esperando): si suben varias seguidas, va un solo correo.
 *     Se apaga con FACTURAS_COLABORADOR_LLEGADAS_DISABLED=1.
 *   - Desde las 09:00 de Madrid, una vez al día: «Faltan N facturas por pagar»,
 *     por empresa. Sin pendientes no sale nada. Se mira cada 15 minutos (como
 *     los demás avisos, por si el proceso se reinicia); la tabla de resúmenes
 *     impide mandar dos el mismo día. Se apaga con FACTURAS_COLABORADOR_POR_PAGAR_DISABLED=1.
 *
 * Los correos salen solo con FACTURAS_COLABORADOR_CORREOS_ACTIVOS encendido.
 */

export const HORA_RESUMEN = 9;
const TICK_LLEGADAS_MS = 60 * 1000;
const TICK_RESUMEN_MS = 15 * 60 * 1000;

export async function runLlegadas() {
  const r = await avisarLlegadas();
  if (r.avisos) logger.info(r, 'Facturas de colaboradores: aviso de llegada a la empresa');
  return r;
}

export async function runPorPagar({ ahora = new Date() } = {}) {
  if (enMadrid(ahora).hora < HORA_RESUMEN) return { omitido: 'fuera de hora' };
  const r = await resumenPorPagar({ ahora });
  if (r.enviados) logger.info(r, 'Facturas de colaboradores: resumen «Faltan facturas por pagar»');
  return r;
}

export function startFacturasColaboradorAvisosScheduler() {
  if (process.env.FACTURAS_COLABORADOR_LLEGADAS_DISABLED === '1') {
    logger.info('Aviso de facturas de colaboradores recibidas desactivado (FACTURAS_COLABORADOR_LLEGADAS_DISABLED=1)');
  } else {
    vigilar('facturas_colaborador_llegadas', 'Facturas de colaboradores: aviso de llegada a la empresa',
      () => runLlegadas(), TICK_LLEGADAS_MS);
  }
  if (process.env.FACTURAS_COLABORADOR_POR_PAGAR_DISABLED === '1') {
    logger.info('Resumen de facturas de colaboradores por pagar desactivado (FACTURAS_COLABORADOR_POR_PAGAR_DISABLED=1)');
  } else {
    vigilar('facturas_colaborador_por_pagar', 'Facturas de colaboradores: resumen diario «Faltan por pagar»',
      () => runPorPagar(), TICK_RESUMEN_MS);
  }
}
