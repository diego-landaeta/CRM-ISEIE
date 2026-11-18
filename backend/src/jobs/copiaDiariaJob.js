import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { leerConfig } from '../modules/copia-diaria/copia-diaria.config.js';
import { enVentana, hacerCopiaDelDia } from '../modules/copia-diaria/copia-diaria.service.js';

/**
 * La copia diaria de la base, por correo (Diego, 11/11/2026).
 *
 *   · Cada día a las 03:30 de Madrid (COPIA_DIARIA_HORA, COPIA_DIARIA_ZONA): un
 *     pg_dump de la base de la app, cifrado en un zip AES-256 y mandado a
 *     COPIA_DIARIA_PARA. Si pesa más de lo que cabe en un correo, va un enlace
 *     de descarga firmado que caduca a las 48 h.
 *   · Se guardan las 7 últimas en el servidor, en una carpeta 700.
 *   · Apagada de serie: COPIA_DIARIA_ACTIVA=true para encenderla. Sin
 *     COPIA_DIARIA_CLAVE no hace ni manda nada, y lo dice en el registro.
 *
 * Como los demás avisos, se mira la hora en cada vuelta y no se programa una
 * hora exacta: si el proceso se reinicia a las 03:40, la siguiente vuelta la
 * hace igual (hasta seis horas después). Repetir una vuelta no repite nada; ver
 * `copia-diaria.service.js`.
 */

const TICK_MS = 10 * 60 * 1000;
const AL_ARRANCAR_MS = 2 * 60 * 1000;

export async function runCopiaDiaria({ ahora = new Date(), forzar = false, cfg = leerConfig() } = {}) {
  if (!forzar && !cfg.activa) return { omitido: 'apagada' };
  if (!forzar && !enVentana(ahora, cfg)) return { omitido: 'fuera de hora' };
  return hacerCopiaDelDia({ ahora, cfg });
}

export function startCopiaDiariaScheduler() {
  if (!leerConfig().activa) {
    logger.info('Copia diaria de la base: apagada (COPIA_DIARIA_ACTIVA)');
    return null;
  }
  logger.info('Copia diaria de la base: en marcha');
  return vigilar('copia_diaria', 'Copia diaria de la base, cifrada y por correo',
    () => runCopiaDiaria(), TICK_MS, { alArrancarMs: AL_ARRANCAR_MS });
}
