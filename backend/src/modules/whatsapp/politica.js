/**
 * Las dos decisiones que el CRM NO puede delegar en Evolution: si entran los
 * grupos y cuanto historial se acepta.
 *
 * Las dos vivian en el cuerpo de `/instance/create` —`groupsIgnore: true`,
 * `syncFullHistory: false`— confiando en que el servicio de WhatsApp las
 * cumpliera. Ninguna de las dos se cumplia:
 *
 *   · Los GRUPOS entraban igual. En la base de pruebas, 2 de 5 conversaciones
 *     eran grupos, con mensajes de ese mismo dia: entraban EN VIVO, no
 *     arrastrados de un historial viejo. Tres motivos a la vez —el puente de
 *     Baileys no implementa `groupsIgnore`, `guardarAjustes` lo apagaba solo, y
 *     el propio CRM los aceptaba a proposito en `recibir()`—. Es la tarea #74.
 *
 *   · El MODO de historial se mandaba en un campo `modo` que solo entiende el
 *     puente. El Evolution de produccion lo ignora y lee `syncFullHistory`, que
 *     iba a `false` fijo. O sea que en el VPS, elegir «el ultimo mes» o «todo el
 *     historial» al enlazar hacia exactamente lo mismo que «empezar de cero».
 *     Es el fondo de la tarea #73.
 *
 * La leccion es la misma de la #63: lo que hay detras no siempre es lo que
 * crees, y una regla que solo vive en el otro lado no es una regla. Si el CRM
 * decide algo, el CRM lo aplica — y ademas se lo pide al proveedor, para no
 * gastar red en traer lo que va a tirar.
 */

import { logger } from '../../shared/utils/logger.js';

// ─── Grupos ──────────────────────────────────────────────────────────────────

/**
 * ¿Entran los grupos?
 *
 * Por defecto SI, y no es un descuido: es lo que ya pasa hoy en los dos
 * entornos. Ponerlo en «no» habria sido un cambio de comportamiento colado en
 * un arreglo, y ademas justo el contrario de lo que pide la #74 —una gestora
 * echa en falta el grupo de Psiko—.
 *
 * Lo que cambia es que ahora la decision es UNA, esta escrita, y se cumple:
 * quien quiera el comportamiento estricto pone `WHATSAPP_GRUPOS=no` y los
 * grupos dejan de entrar de verdad, sin depender de que el otro lado colabore.
 */
export const seAceptanGrupos = () =>
  String(process.env.WHATSAPP_GRUPOS ?? 'si').toLowerCase() !== 'no';

/**
 * Lo que se le pide a Evolution, derivado de lo anterior y nunca al reves.
 *
 * Se le sigue pidiendo aunque el CRM ya filtre: si el proveedor colabora, esos
 * mensajes no viajan siquiera. Pero la garantia esta aqui.
 */
export const groupsIgnoreParaEvolution = () => !seAceptanGrupos();

/** ¿Hay que descartar este destino por ser un grupo? */
export const sobraPorSerGrupo = (jid) =>
  String(jid).endsWith('@g.us') && !seAceptanGrupos();

// ─── Cuanto historial ────────────────────────────────────────────────────────

/** Los tres modos que ofrece la pantalla al enlazar. */
export const MODOS = ['cero', 'rapido', 'todo'];

/** Lo que dura «el ultimo mes». */
export const RECIENTE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Lo que se le pide al socket. En «cero» no se quiere nada del pasado; en los
 * otros dos hace falta que WhatsApp mande algo, porque el recorte es nuestro.
 *
 * Antes iba `false` fijo, con lo que en «el ultimo mes» no habia nada QUE
 * recortar: el recorte estaba escrito y no se ejecutaba nunca.
 */
export const syncFullHistoryPara = (modo) => modo !== 'cero';

/**
 * Que modo eligio cada sesion al enlazar.
 *
 * En memoria y no en tabla, y esto es una limitacion consciente: las
 * migraciones estan bloqueadas por la #71 y esto no merece esperar a que se
 * desbloqueen. El dato solo vale mientras dura la sincronizacion.
 *
 * Si el proceso se reinicia a mitad, el modo se pierde y NO se recorta nada.
 * Se elige asi a proposito: de las dos formas de equivocarse —guardar de mas o
 * tirar mensajes de una gestora— solo una tiene arreglo despues.
 */
const modoPorInstancia = new Map();

export function apuntarModo(instancia, modo) {
  if (!instancia || !MODOS.includes(modo)) return;
  modoPorInstancia.set(instancia, modo);
}

export const modoDe = (instancia) => modoPorInstancia.get(instancia) || null;

/**
 * ¿Este mensaje se sale del mes que se pidio?
 *
 * Solo dice que si con el modo «rapido» apuntado y una fecha de hace mas de 30
 * dias. Un mensaje EN VIVO nunca cumple lo segundo, asi que esta regla no puede
 * tirar una conversacion de hoy por error.
 */
export function sobraDelHistorial(instancia, ts) {
  if (modoDe(instancia) !== 'rapido') return false;
  const cuando = ts instanceof Date ? ts.getTime() : Number(ts);
  if (!Number.isFinite(cuando) || cuando <= 0) return false;
  return Date.now() - cuando > RECIENTE_MS;
}

/** Para las pruebas: empezar sin nada apuntado. */
export const _olvidarModos = () => modoPorInstancia.clear();

// Se dice en el arranque, una vez. Un comportamiento que sorprende y no aparece
// en ningun registro es el que cuesta media tarde encontrar.
if (!seAceptanGrupos()) {
  logger.info('WhatsApp: los grupos NO entran (WHATSAPP_GRUPOS=no)');
}
