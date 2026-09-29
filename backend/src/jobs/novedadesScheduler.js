import { logger } from '../shared/utils/logger.js';
import { autoEnvio } from '../modules/novedades/novedades.service.js';

/**
 * «Al subirlo se mandará» (Diego, 28/09): al arrancar en producción, si la
 * versión actual aún no se ha mandado al equipo, se manda. Una vez: lo asegura
 * el índice único de `novedades_envios`.
 *
 * Espera dos minutos: un despliegue reinicia varias veces seguidas, y así no
 * sale nada hasta que la API está de pie y estable. Solo con NOVEDADES_AUTO=1
 * en el .env (ver `autoEnvio`).
 */
const ESPERA_MS = parseInt(process.env.NOVEDADES_ESPERA_MS || String(2 * 60 * 1000), 10);

export function startNovedadesScheduler() {
  const t = setTimeout(async () => {
    try {
      const r = await autoEnvio();
      if (r) logger.info(r, 'Novedades: la versión nueva se mandó al equipo');
    } catch (err) {
      if (err.code === 'YA_ENVIADA') return;
      logger.error({ err: err.message }, 'Novedades: no se pudo mandar la versión nueva al equipo');
    }
  }, ESPERA_MS);
  t.unref?.();
}
