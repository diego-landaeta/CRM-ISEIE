/**
 * El pulso de las tareas programadas.
 *
 * Parte de la tarea #26: la pantalla de estado tiene que decir cuando dio su
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

const tareas = new Map();

/** Cuando arranco el proceso. Sirve para no dar por muerta a una tarea recien nacida. */
const ARRANQUE = Date.now();

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
    try {
      await tick();
      t.vueltas += 1;
    } catch (err) {
      t.fallos += 1;
      t.ultimoFallo = { cuando: Date.now(), mensaje: String(err?.message || err).slice(0, 300) };
    } finally {
      t.duracionMs = Date.now() - inicio;
      t.ultima = Date.now();   // se ficha aunque falle: la tarea SIGUE VIVA, que
      t.corriendo = false;     // es lo que este dato responde. El fallo va aparte.
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
