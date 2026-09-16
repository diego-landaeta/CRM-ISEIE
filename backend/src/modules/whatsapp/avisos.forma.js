/**
 * Que FORMA tienen los avisos que manda Evolution de verdad.
 *
 * Llevamos una semana arreglando el mismo fallo: el CRM leia un campo con la
 * forma que manda el puente de Baileys, y en produccion —donde habla con
 * Evolution— ese campo no venia. El autor de un mensaje de grupo, la cita de
 * una respuesta, el aviso de una llamada. Tres veces, y las tres se veian
 * perfectas en local.
 *
 * La causa de fondo no es ninguno de esos tres: es que NADIE ha mirado nunca lo
 * que Evolution manda. No se registra en ningun sitio, asi que la unica forma
 * de saberlo era desplegar y esperar a que alguien se quejara.
 *
 * Esto lo arregla sin desplegar nada a ciegas: se enciende, entra trafico real
 * unos minutos, se lee y se apaga.
 *
 * ── Que NO guarda ────────────────────────────────────────────────────────────
 *
 * Ni un solo dato de nadie. No guarda textos, ni telefonos, ni nombres, ni
 * identificadores. Guarda la ESTRUCTURA: que claves vienen, de que tipo es cada
 * una, y si `data` llega como objeto o como lista. Eso es lo unico que hace
 * falta para saber donde mirar, y se puede pegar en un issue sin pensarlo.
 *
 * Vive en memoria y se apaga solo al reiniciar. No toca disco ni base.
 */

import { logger } from '../../shared/utils/logger.js';

/** Encendido solo si se pide expresamente. Apagado es lo normal. */
export const encendido = () => process.env.WHATSAPP_VOLCAR_FORMA === '1';

/** Cuantos ejemplares se guardan de cada tipo de evento. */
const POR_EVENTO = 3;

/** evento -> [forma, forma, forma] */
const visto = new Map();

/**
 * La forma de un valor, sin su contenido.
 *
 * De un texto dice «texto(23)» y no lo que pone. De una lista, de que es la
 * lista y cuantos elementos tiene. De un objeto, sus claves — recursivamente,
 * hasta donde sirva para orientarse.
 */
function formaDe(v, hondura = 0) {
  if (v === null) return 'nulo';
  if (v === undefined) return 'nada';
  if (Array.isArray(v)) {
    if (!v.length) return 'lista(0)';
    // Una lista de mensajes o de llamadas: interesa el primero y cuantos hay.
    return { _lista: v.length, _primero: hondura < 4 ? formaDe(v[0], hondura + 1) : '…' };
  }
  const t = typeof v;
  if (t === 'string') return `texto(${v.length})`;
  if (t === 'number') return 'numero';
  if (t === 'boolean') return 'si/no';
  if (t !== 'object') return t;
  if (hondura >= 4) return '{…}';
  const salida = {};
  for (const k of Object.keys(v)) salida[k] = formaDe(v[k], hondura + 1);
  return salida;
}

/**
 * Apunta la forma de un aviso, si esta encendido.
 *
 * No lanza nunca y no espera: esto va dentro del webhook, y un fallo aqui no
 * puede impedir que entre un mensaje.
 */
export function apuntar(cuerpo) {
  if (!encendido()) return;
  try {
    const evento = String(cuerpo?.event || cuerpo?.type || 'sin-evento');
    const ya = visto.get(evento) || [];
    if (ya.length >= POR_EVENTO) return;

    ya.push({
      cuando: new Date().toISOString(),
      // Lo mas util de todo, y lo que ya nos ha mordido dos veces.
      dataEsLista: Array.isArray(cuerpo?.data),
      forma: formaDe(cuerpo),
    });
    visto.set(evento, ya);
    logger.info({ evento, ejemplares: ya.length }, 'WhatsApp: forma de aviso apuntada');
  } catch { /* nunca puede tumbar el webhook */ }
}

/** Lo apuntado hasta ahora, para leerlo y pegarlo en un issue. */
export function loApuntado() {
  return {
    encendido: encendido(),
    porEvento: POR_EVENTO,
    eventos: Object.fromEntries(visto),
  };
}

/** Borra lo apuntado. Para empezar de cero sin reiniciar. */
export function olvidar() {
  const n = visto.size;
  visto.clear();
  return n;
}
