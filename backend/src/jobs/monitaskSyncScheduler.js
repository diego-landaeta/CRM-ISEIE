import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { monitaskActivo } from '../modules/monitask/interruptor.js';
import * as model from '../modules/monitask/monitask.model.js';
import { sincronizar, ultimosDias, diasNocturnos, sincronizando } from '../modules/monitask/monitask.service.js';
import { diaEn, zona } from '../modules/monitask/monitask.datos.js';
import { enMadrid } from './facturasColaboradorJob.js';

/**
 * Monitask (#236): la vuelta de cada noche.
 *
 * Cada hora se mira si ya toca: desde las MONITASK_HORA (3 de Madrid de serie) y
 * si hoy no se ha hecho. Trae los últimos MONITASK_SYNC_DIAS días (3), que cubren
 * las entradas que alguien corrige a mano al día siguiente. Al usar el token cada
 * noche, el refresh token no caduca por falta de uso.
 *
 * Solo arranca con MONITASK_ACTIVO=1; sin la cuenta conectada no hace nada.
 */
const TICK_MS = 60 * 60 * 1000;

export async function vueltaNocturna({ ahora = new Date(), env = process.env } = {}) {
  if (!monitaskActivo(env)) return { omitido: 'apagado' };
  const hora = Number.parseInt(env.MONITASK_HORA, 10);
  if (enMadrid(ahora).hora < (Number.isFinite(hora) ? hora : 3)) return { omitido: 'fuera de hora' };
  const c = await model.conexion();
  if (!c?.refresh_cifrado && !c?.access_cifrado) return { omitido: 'sin conectar' };
  const hoy = diaEn(ahora, zona(env));
  if (c.ultima_nocturna_txt === hoy) return { omitido: 'ya hecha hoy' };
  if (sincronizando()) return { omitido: 'ya hay una en marcha' };
  const r = await sincronizar({ ...ultimosDias(diasNocturnos(env), ahora, env), nocturna: hoy }, env);
  logger.info({ personas: r.personas, dias: r.dias, avisos: r.avisos, errores: r.errores?.length || 0 }, 'Monitask: vuelta nocturna');
  return { personas: r.personas, dias: r.dias, avisos: r.avisos };
}

export function startMonitaskSyncScheduler() {
  if (!monitaskActivo()) {
    logger.info('Monitask: sincronización nocturna APAGADA (MONITASK_ACTIVO)');
    return;
  }
  vigilar('monitask', 'Monitask: horas y actividad de cada noche', () => vueltaNocturna(), TICK_MS);
  logger.info('Monitask: sincronización nocturna iniciada');
}
