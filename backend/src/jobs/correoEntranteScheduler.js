import { logger } from '../shared/utils/logger.js';
import { leerBuzon } from '../shared/services/correo-entrante.service.js';
import { vigilar } from './latido.js';

/**
 * Leer los buzones cada media hora (CRM-ISEIE#701, gemela de CRM#146 y CRM#1032).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN PASE Y NO TIEMPO REAL
 *
 * IMAP sabe avisar cuando llega algo (IDLE), pero eso obliga a mantener una
 * conexión abierta contra Hostinger por cada buzón para siempre y a reabrirla
 * cada vez que se caiga. Media hora sobra, y quien no quiera esperar tiene el
 * botón «Traer del buzón» en la Bandeja.
 *
 * NO PASA NADA SI SE SALTA UN PASE. La clave de cada correo es su `Message-ID`,
 * así que el siguiente recoge lo que el anterior no llegó a leer.
 *
 * Arranca SIEMPRE: los buzones se conectan desde el panel y pueden aparecer sin
 * reiniciar. Sin ninguno —ni en la base ni en el `.env`— cada pase es una
 * consulta que no encuentra nada, y no se anota. Se apaga con
 * `CORREO_ENTRANTE_DISABLED=1`.
 */

const TICK_MS = parseInt(process.env.CORREO_ENTRANTE_TICK_MS || String(30 * 60 * 1000), 10);

async function traer() {
  const r = await leerBuzon();
  // Solo se anota cuando hay algo: un «0 nuevos» cada media hora es ruido.
  if (r.nuevos > 0) logger.info({ leidos: r.leidos, nuevos: r.nuevos }, 'Correo entrante: guardados');
  // Lo que queda en el diario de la tarea: cifras y qué buzón falló, nada más.
  return {
    leidos: r.leidos,
    nuevos: r.nuevos,
    ...(r.motivo ? { motivo: r.motivo } : {}),
    fallidos: (r.buzones || []).filter((b) => b.motivo === 'ERROR').map((b) => b.nombre),
  };
}

export function startCorreoEntranteScheduler() {
  if (process.env.CORREO_ENTRANTE_DISABLED === '1') {
    logger.info('Correo entrante desactivado (CORREO_ENTRANTE_DISABLED=1)');
    return;
  }
  // La primera, un minuto después de arrancar: leer un buzón tarda unos segundos
  // y no tiene por qué competir con las primeras peticiones.
  vigilar('correo_entrante', 'Correo entrante: leer los buzones conectados', traer, TICK_MS,
    { alArrancarMs: 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Correo entrante iniciado');
}
