/**
 * El pulso de las tareas programadas.
 *
 * Llega aqui con el registro (#111), que necesita saber que paso y cuando. En
 * MultiCRM nacio antes, con la pantalla de estado (#26), que aqui todavia no
 * hay: el pulso en memoria se queda listo para cuando la haya, y lo que se usa
 * hoy es el diario.
 *
 * Venia de la tarea #26 de MultiCRM: la pantalla de estado tiene que decir cuando dio su
 * ultima vuelta cada tarea, y hoy ninguna deja rastro en ninguna parte.
 *
 * La gracia esta en DONDE se ficha. En vez de que cada tarea llame a un
 * `anota()` al terminar —que se olvida el dia que alguien añade la trece— se
 * ficha en el envoltorio: `vigilar()` sustituye al `setInterval` y mide la
 * vuelta desde fuera. Una tarea no puede dejar de reportar porque reportar no
 * es cosa suya.
 *
 * Y esto NO lleva tabla. Podria, pero serian tres migraciones sin aplicar en
 * vez de dos, y la pantalla no diria nada hasta que alguien las corriera. Vive
 * en memoria del proceso: se pierde al reiniciar, y por eso se guarda `desde`
 * —cuando arranco— para poder distinguir «esta tarea esta caida» de «este
 * proceso acaba de arrancar y aun no le toca». Confundir esas dos cosas es lo
 * que hace que una pantalla de estado se vuelva ruido y se deje de mirar.
 */

import { query } from '../shared/config/db.js';
import { logger } from '../shared/utils/logger.js';

const tareas = new Map();

/** Cuando arranco el proceso. Sirve para no dar por muerta a una tarea recien nacida. */
const ARRANQUE = Date.now();

/**
 * El diario de las tareas, en la base (#111).
 *
 * El latido de arriba contesta «¿esto va?», y para eso la memoria del proceso
 * basta. El registro contesta otra cosa: «¿que paso el martes a las tres?». Eso
 * no se puede contestar con algo que se vacia en cada despliegue, asi que la
 * vuelta tambien se apunta en `registro_tareas` (migracion 106 aqui, 142 en MultiCRM).
 *
 * Se ficha en el MISMO envoltorio, por lo mismo que el latido: una tarea no
 * puede dejar de aparecer en el registro porque aparecer no es cosa suya.
 *
 * Y se anotan TAMBIEN las vueltas que no hicieron nada. «La sincronizacion no
 * corrio en tres dias» y «corrio y no habia cobros» se leen igual si la vuelta
 * vacia no deja fila, y son dos averias distintas.
 */

/** Si la 142 no esta aplicada, esto no escribe y no se queja mas de una vez. */
let hayTabla = null;

async function tablaLista() {
  if (hayTabla !== null) return hayTabla;
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'registro_tareas'`
    );
    hayTabla = rows.length > 0;
    if (!hayTabla) {
      logger.warn('Registro de tareas: falta la migracion 142, las vueltas no se guardan');
    }
  } catch {
    hayTabla = false;
  }
  return hayTabla;
}

/**
 * Cuanto se guarda cada cosa.
 *
 * Lo que fallo dura mas que lo que salio bien: una vuelta correcta de hace un
 * mes no dice nada, y un fallo de hace un mes explica por que falta un dato.
 */
const DIAS_QUE_SE_GUARDAN = { ok: 30, fallo: 180 };

/**
 * La limpieza va aqui y no en otro trabajo programado.
 *
 * Un trabajo mas es un sitio mas del que olvidarse; enganchada a la propia
 * vuelta no puede dejar de correr mientras corra la tarea. Una de cada cien
 * para que no pese: con trece tareas eso es varias veces al dia.
 */
let vueltasApuntadas = 0;

async function limpiarDeVezEnCuando() {
  vueltasApuntadas += 1;
  if (vueltasApuntadas % 100 !== 0) return;
  try {
    await query(
      `DELETE FROM registro_tareas
        WHERE (ok AND termino < NOW() - ($1 || ' days')::interval)
           OR (NOT ok AND termino < NOW() - ($2 || ' days')::interval)`,
      [String(DIAS_QUE_SE_GUARDAN.ok), String(DIAS_QUE_SE_GUARDAN.fallo)]
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'Registro de tareas: no se pudo limpiar');
  }
}

/**
 * Apunta una vuelta. Nunca lanza.
 *
 * Que falle el registro no puede tumbar la tarea que registra — seria cambiar
 * «no se que paso» por «ademas dejo de pasar».
 */
async function apuntarVuelta({ nombre, titulo, empezo, duracionMs, ok, mensaje, detalle }) {
  if (!(await tablaLista())) return;
  try {
    await query(
      `INSERT INTO registro_tareas
         (nombre, titulo, empezo, termino, duracion_ms, ok, mensaje, detalle)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)`,
      [
        nombre, titulo || null, new Date(empezo).toISOString(),
        duracionMs, ok, mensaje ? String(mensaje).slice(0, 2000) : null,
        detalle ? JSON.stringify(detalle) : null,
      ]
    );
    await limpiarDeVezEnCuando();
  } catch (err) {
    logger.warn({ err: err.message, tarea: nombre }, 'Registro de tareas: no se pudo apuntar la vuelta');
  }
}

/** Para las pruebas: olvidar lo que se averiguo de la tabla. */
export const _olvidarTabla = () => { hayTabla = null; vueltasApuntadas = 0; };
export { DIAS_QUE_SE_GUARDAN };

/**
 * Programa una tarea y le toma el pulso.
 *
 * @param {string} nombre   identificador estable, para la pantalla
 * @param {string} titulo   como se llama en cristiano
 * @param {Function} tick   la vuelta
 * @param {number} cadaMs   cada cuanto
 */
export function vigilar(nombre, titulo, tick, cadaMs) {
  tareas.set(nombre, {
    nombre, titulo, cadaMs,
    desde: ARRANQUE,
    ultima: null,        // cuando termino de dar la ultima vuelta
    duracionMs: null,
    vueltas: 0,
    fallos: 0,
    ultimoFallo: null,   // { cuando, mensaje }
    corriendo: false,
  });

  const envuelto = async () => {
    const t = tareas.get(nombre);
    // Si la vuelta anterior sigue viva no se solapa. Las tareas ya se protegen
    // por dentro, pero asi el dato de «corriendo» es de verdad y no de fe.
    if (t.corriendo) return;
    t.corriendo = true;
    const inicio = Date.now();
    // Lo que la vuelta cuente de si misma, si cuenta algo. Ninguna esta obligada
    // —la mayoria no devuelve nada— y las que no, dejan igual su fila.
    let resultado = null;
    let fallo = null;
    try {
      const r = await tick();
      resultado = (r && typeof r === 'object' && !Array.isArray(r)) ? r : null;
      t.vueltas += 1;
    } catch (err) {
      fallo = String(err?.message || err).slice(0, 300);
      t.fallos += 1;
      t.ultimoFallo = { cuando: Date.now(), mensaje: fallo };
    } finally {
      t.duracionMs = Date.now() - inicio;
      t.ultima = Date.now();   // se ficha aunque falle: la tarea SIGUE VIVA, que
      t.corriendo = false;     // es lo que este dato responde. El fallo va aparte.
      // Y en el diario, para poder mirar hacia atras (#111). Sin `await`: el
      // pulso no espera a la base, que si esta lenta retrasaria la siguiente
      // vuelta de la tarea por culpa de apuntarla.
      apuntarVuelta({
        nombre, titulo, empezo: inicio, duracionMs: t.duracionMs,
        ok: !fallo, mensaje: fallo, detalle: resultado,
      });
    }
  };

  return setInterval(envuelto, cadaMs);
}

/**
 * Como esta cada tarea, para la pantalla.
 *
 * `retraso` solo se acusa cuando lleva mas de DOS intervalos sin dar señales:
 * con uno, cualquier vuelta que tarde un poco pintaria de rojo una tarea sana.
 */
/**
 * Nunca se da por muerta a una tarea antes de un minuto, pase lo que pase.
 *
 * «Dos intervalos» solo vale cuando el intervalo es grande. La tarea mas rapida
 * del CRM tarda dos minutos, asi que este suelo no cambia nada para ninguna de
 * las doce — pero evita que un servidor ocupado un par de segundos pinte de rojo
 * una tarea perfectamente viva.
 *
 * Y lo hace determinista: sin el suelo, la prueba de este fichero pasaba en
 * solitario y fallaba en la suite completa, porque con la maquina cargada
 * caben veinte milisegundos entre una vuelta y la comprobacion. Una prueba que
 * va y viene es peor que una roja: se acaba ignorando.
 */
const SUELO_MS = 60_000;
const margenDe = (cadaMs) => Math.max(cadaMs * 2, SUELO_MS);

export function tareasProgramadas(ahora = Date.now()) {
  return [...tareas.values()]
    .map((t) => {
      const desdeArranque = ahora - t.desde;
      const margen = margenDe(t.cadaMs);
      let estado;
      if (t.ultima === null) {
        // Nunca ha dado una vuelta. Solo es un problema si ya deberia haberla
        // dado: una tarea diaria a los diez minutos de arrancar esta bien.
        estado = desdeArranque > margen ? 'caida' : 'esperando';
      } else if (ahora - t.ultima > margen) {
        estado = 'caida';
      } else if (t.ultimoFallo && t.ultimoFallo.cuando > (t.ultima - t.cadaMs)) {
        estado = 'fallando';
      } else {
        estado = 'bien';
      }
      return {
        nombre: t.nombre,
        titulo: t.titulo,
        estado,
        cadaMs: t.cadaMs,
        ultima: t.ultima ? new Date(t.ultima).toISOString() : null,
        duracionMs: t.duracionMs,
        vueltas: t.vueltas,
        fallos: t.fallos,
        corriendo: t.corriendo,
        // Unico campo con texto de dentro. Si esta pantalla llega a enseñarse
        // fuera, es lo que hay que quitar — ver #26.
        detalle: t.ultimoFallo?.mensaje || null,
      };
    })
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
}

/** Para las pruebas. */
export const _internos = { tareas, ARRANQUE };
