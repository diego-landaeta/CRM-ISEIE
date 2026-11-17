import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { leerConfig } from '../modules/informe-mensual/informe-mensual.config.js';
import { enviarMes, mesAnterior } from '../modules/informe-mensual/informe-mensual.service.js';

/**
 * El informe del mes y las facturas, a la gestoría (#772).
 *
 * El día INFORME_MENSUAL_DIA, desde INFORME_MENSUAL_HORA (de Madrid), sale el
 * del mes anterior. Y los tres días siguientes se vuelve a mirar: si ese día la
 * API estaba parada, sale al volver. Repetir no duplica nada: cada empresa y mes
 * lleva su clave de correo, y lo ya enviado ni se vuelve a armar.
 *
 * Con INFORME_MENSUAL_ACTIVO apagado no se hace nada (lo de serie). El informe y
 * el ZIP se bajan igual desde Reportes.
 */

const TICK_MS = 30 * 60 * 1000;
const DIAS_DE_MARGEN = 3;

/** Año, mes, día y minuto del día en la zona (el servidor está en UTC). */
export function relojEn(ahora = new Date(), zona = 'Europe/Madrid') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ahora).map((x) => [x.type, x.value]));
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), minuto: Number(p.hour) * 60 + Number(p.minute) };
}

/** ¿Toca hoy? El día elegido desde la hora, y los tres siguientes a cualquier hora. */
export function toca(reloj, cfg) {
  if (reloj.dia === cfg.dia) return reloj.minuto >= cfg.minuto;
  return reloj.dia > cfg.dia && reloj.dia <= cfg.dia + DIAS_DE_MARGEN;
}

export async function runInformeMensual({ ahora = new Date(), cfg = leerConfig(), ...deps } = {}) {
  if (!cfg.activo) return { omitido: 'apagado' };
  const reloj = relojEn(ahora, cfg.zona);
  if (!toca(reloj, cfg)) return { omitido: 'no toca hoy' };
  return enviarMes({ periodo: mesAnterior(reloj.anio, reloj.mes), cfg, ...deps });
}

export function startInformeMensualScheduler() {
  vigilar('informe_mensual', 'Informe mensual y facturas a la gestoría', () => runInformeMensual(), TICK_MS);
  logger.info({ activo: leerConfig().activo }, 'Informe mensual a la gestoría: tarea iniciada');
}
