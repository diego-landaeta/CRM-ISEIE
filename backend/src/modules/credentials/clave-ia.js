import { getDecryptedValue } from './credentials.model.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * LA CLAVE DE IA (Claude), en un solo sitio (CRM#893).
 *
 * Hasta el 19/11 había cuatro copias de esto (chat, informes, «Preguntar» y la
 * lectura semanal) y las cuatro buscaban la credencial como `anthropic`. Pero la
 * pantalla la guarda como `claude`, y `anthropic` ni siquiera existe en el enum
 * `api_service` de la base (migración 001): la consulta fallaba, el `catch` se
 * lo tragaba y solo funcionaba ANTHROPIC_API_KEY del servidor. Lo que se pegaba
 * en «APIs globales» no lo usaba nadie, y nadie se enteraba.
 *
 * El orden: la del campus, la global de la web y, por último, la del servidor.
 * Devuelve también DE DÓNDE sale, para que la pantalla diga cuál se está usando
 * (sin enseñarla).
 */

/** El tipo con el que la guarda la pantalla (y el único que admite la base). */
export const SERVICIO_IA = 'claude';

/**
 * Para los avisos: dónde se pone, en vez de nombrar la variable del servidor.
 * En ISEIE no hay «Claves y variables» (la de un campus, en MultiCRM): solo la
 * global de «APIs globales».
 */
export const DONDE_SE_CONFIGURA = 'Configuración › APIs globales';

export const ORIGENES = {
  campus: 'la del campus',
  global: 'la global de la web',
  servidor: 'la del servidor (ANTHROPIC_API_KEY)',
};

async function leerGuardada(projectId, leer, marcar) {
  try {
    // Solo la de producción: la de «pruebas» es para la paridad (#80), no se usa.
    return (await leer(SERVICIO_IA, projectId, { marcar, soloProduccion: true })) || null;
  } catch (err) {
    // Ya no se calla: una clave que no se puede leer es algo que hay que ver.
    logger.warn({ err: err.message, projectId }, 'Clave de IA: no se pudo leer la guardada');
    return null;
  }
}

/**
 * `{ clave, origen }`, con `origen` = 'campus' | 'global' | 'servidor', o
 * `{ clave: null, origen: null }` si no hay ninguna. Sin campus, se empieza por
 * la global.
 *
 * `soloMirar: true` para quien solo quiere saber cuál hay (estado, pantallas):
 * no sella el «último uso» de la credencial, que es lo que en «Claves» delata la
 * que ya no usa nadie. `leer` y `env` solo los cambian las pruebas.
 */
export async function claveDeIA(projectId = null, { leer = getDecryptedValue, env = process.env, soloMirar = false } = {}) {
  const marcar = !soloMirar;
  if (projectId) {
    const delCampus = await leerGuardada(projectId, leer, marcar);
    if (delCampus) return { clave: delCampus, origen: 'campus' };
  }
  const global = await leerGuardada(null, leer, marcar);
  if (global) return { clave: global, origen: 'global' };
  if (env.ANTHROPIC_API_KEY) return { clave: env.ANTHROPIC_API_KEY, origen: 'servidor' };
  return { clave: null, origen: null };
}

/** Solo la clave (o null), para quien no necesita saber de dónde sale. */
export async function soloLaClave(projectId = null, opciones) {
  return (await claveDeIA(projectId, opciones)).clave;
}

/**
 * «Probar» de verdad una clave de Claude (CRM#893). Antes «Probar» decía «ok» a
 * cualquier cosa que se pegara: ni la descifraba. Pide la lista de modelos, que
 * comprueba la clave sin gastar tokens.
 *
 * Devuelve `{ result: 'ok' | 'failed', message }`. `fetch` solo lo cambian las
 * pruebas.
 */
export async function probarClaveDeIA(clave, { fetch: pedir = fetch } = {}) {
  let res;
  try {
    res = await pedir('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { result: 'failed', message: `No se pudo hablar con Anthropic: ${err.message}` };
  }
  if (res.ok) return { result: 'ok', message: 'Anthropic acepta la clave.' };
  if (res.status === 401) return { result: 'failed', message: 'Anthropic rechaza la clave: no es válida o está revocada.' };
  if (res.status === 403) return { result: 'failed', message: 'Anthropic acepta la clave, pero no le deja usar la API.' };
  return { result: 'failed', message: `Anthropic contestó ${res.status}: inténtalo de nuevo en un rato.` };
}
