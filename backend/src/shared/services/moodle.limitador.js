/*
  El freno de las llamadas a los Moodle de los campus, UNO para todo el proceso.

  Por qué existe (27/11): el hosting de los campus (la cuenta de CEDIA: nueve Moodle y
  sesenta webs) admite 20 conexiones nuevas a MySQL por segundo; las que pasan de ahí se
  rechazan y Moodle contesta «Database connection failed» (`dbconnectionfailed`), también
  a quien está usando el campus en ese momento. Cada llamada del CRM a la API de Moodle es
  una conexión nueva. En la vuelta de las 15:00 del 27/11 el CRM llamó a siete campus a la
  vez a 15-19 llamadas por segundo: cada tarea se frenaba a sí misma («de dos en dos»),
  pero nadie frenaba a TODAS juntas.

  Aquí pasan todas las llamadas, de todas las tareas y de todos los campus:

    · como mucho MOODLE_LLAMADAS_POR_SEGUNDO llamadas empiezan cada segundo (4): entre una
      salida y la siguiente hay al menos 1000/N ms, así que en ningún segundo entran más;
    · como mucho MOODLE_LLAMADAS_A_LA_VEZ están en curso (2).

  Con las dos a 0 no frena nada: el CRM se porta como antes de esto. Se leen en cada
  llamada, así que se pueden cambiar sin tocar código (y las pruebas, sin reiniciar).

  Lo que pide una persona (Mi campus, el MCP, «Probar conexión») va DELANTE de lo que piden
  las tareas programadas: `latido.js` corre cada vuelta dentro de `enSegundoPlano`, y esas
  llamadas esperan detrás. Sin esto, una tutora que pulsa «Actualizar» esperaría a que el
  repaso de las dos horas terminara de leer todos los cursos.

  Nadie espera para siempre (QA, 27/11):
    · una persona espera turno como mucho MOODLE_ESPERA_TURNO_MS (30 s); una tarea,
      MOODLE_ESPERA_TURNO_FONDO_MS (5 min). Pasado eso, «campus ocupado» (OCUPADO);
    · si la persona cierra la página, sus llamadas salen de la cola sin llegar al campus
      (CANCELADA): `senalDeLaPeticion` va en app.js y deja la señal de la petición a mano
      de todo lo que corre por debajo;
    · quien pasa su propia `signal` (el tope de tiempo de las herramientas del MCP) sale de
      la cola cuando se aborta, con el motivo de esa señal.

  No hay un «a la vez» por campus: los nueve campus comparten el mismo tope de MySQL de la
  cuenta, así que lo que cuenta es el total, y la cola ya es por orden de llegada.

  El freno es del proceso: la API de pruebas y la de producción son dos procesos y cada una
  lleva el suyo. Las dos del 360 llaman a los mismos campus, así que lo que llega al hosting
  es la suma de los dos (y de CRM-ISEIE, que tiene el suyo).
*/
import { AsyncLocalStorage } from 'node:async_hooks';

/** Lo que va pasando por debajo: `{ fondo, signal }`. */
const contexto = new AsyncLocalStorage();

/** Corre `fn` marcando como «de fondo» todo lo que llame a Moodle por debajo. */
export const enSegundoPlano = (fn) => contexto.run({ fondo: true, signal: null }, fn);

/** La señal de la petición HTTP en curso, si la hay. */
export const senalActual = () => contexto.getStore()?.signal || undefined;

/** Un turno que no llegó: el campus, ocupado; o la petición, cerrada. */
export class ErrorDeTurno extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDeTurno';
    this.codigo = codigo;
  }
}

/**
 * Middleware: si el navegador cierra la petición antes de la respuesta, las llamadas a
 * Moodle que aún esperan turno salen de la cola. Va DESPUÉS de express.json: el cuerpo se
 * lee con eventos del socket y ahí la señal no llegaría.
 */
export function senalDeLaPeticion(req, res, next) {
  const control = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) control.abort(new ErrorDeTurno('CANCELADA', 'La petición se cerró antes de llamar al campus.'));
  });
  contexto.run({ fondo: false, signal: control.signal }, next);
}

const entero = (nombre, porDefecto) => {
  const n = Number.parseInt(process.env[nombre] ?? String(porDefecto), 10);
  return Number.isInteger(n) && n >= 0 ? n : porDefecto;
};

/** Lo que dice el .env ahora mismo. */
export const configDelLimitador = () => ({
  porSegundo: entero('MOODLE_LLAMADAS_POR_SEGUNDO', 4),
  aLaVez: entero('MOODLE_LLAMADAS_A_LA_VEZ', 2),
  esperaMs: entero('MOODLE_ESPERA_TURNO_MS', 30_000),
  esperaFondoMs: entero('MOODLE_ESPERA_TURNO_FONDO_MS', 5 * 60_000),
});

// El ritmo se mide con el reloj monótono: un ajuste de la hora del sistema no abre ni cierra
// la puerta.
const ahora = () => performance.now();

// Dos colas: delante, lo de las personas; detrás, lo de las tareas.
const colas = { delante: [], detras: [] };
let enCurso = 0;
let ultimaSalida = -Infinity;
let reloj = null;

// UN oyente por señal, aunque haya cien llamadas esperando con ella (la del MCP es la misma
// para toda la herramienta): señal → { turnos, oyente }.
const porSenal = new WeakMap();

const siguiente = () => colas.delante[0] || colas.detras[0] || null;
const quitar = (turno) => {
  for (const c of [colas.delante, colas.detras]) {
    const i = c.indexOf(turno);
    if (i >= 0) { c.splice(i, 1); return true; }
  }
  return false;
};

function vigilarSenal(signal, turno) {
  let v = porSenal.get(signal);
  if (!v) {
    v = { turnos: new Set(), oyente: null };
    v.oyente = () => { for (const t of [...v.turnos]) salir(t, signal.reason); };
    porSenal.set(signal, v);
    signal.addEventListener('abort', v.oyente, { once: true });
  }
  v.turnos.add(turno);
}

/** El turno deja de esperar (le toca, caduca o se cancela): fuera su reloj y sus oyentes. */
function soltar(turno) {
  if (turno.caduca) clearTimeout(turno.caduca);
  for (const s of turno.senales) {
    const v = porSenal.get(s);
    if (!v) continue;
    v.turnos.delete(turno);
    if (!v.turnos.size) {
      s.removeEventListener('abort', v.oyente);
      porSenal.delete(s);
    }
  }
}

/** Sale de la cola sin llamar. */
function salir(turno, motivo) {
  if (!quitar(turno)) return;
  soltar(turno);
  turno.reject(motivo);
}

function dar(turno) {
  quitar(turno);
  soltar(turno);
  enCurso += 1;
  ultimaSalida = ahora();
  turno.resolve();
}

/** Deja salir a quien le toque, o programa el momento en que le tocará. */
function repartir() {
  if (reloj) return;
  for (;;) {
    const turno = siguiente();
    if (!turno) return;
    const { porSegundo, aLaVez } = configDelLimitador();
    if (!porSegundo && !aLaVez) { dar(turno); continue; } // se apagó con gente esperando
    if (aLaVez && enCurso >= aLaVez) return;               // sigue al soltar una
    if (porSegundo) {
      const falta = ultimaSalida + 1000 / porSegundo - ahora();
      if (falta > 0) {
        reloj = setTimeout(() => { reloj = null; repartir(); }, Math.ceil(falta));
        return;
      }
    }
    dar(turno);
  }
}

function pedirTurno(signal, { esperaMs, esperaFondoMs }) {
  const store = contexto.getStore();
  const fondo = store?.fondo === true;
  const senales = [signal, store?.signal].filter(Boolean);
  return new Promise((resolve, reject) => {
    const abortada = senales.find((s) => s.aborted);
    if (abortada) { reject(abortada.reason); return; }
    const turno = { resolve, reject, senales, caduca: null };
    const tope = fondo ? esperaFondoMs : esperaMs;
    if (tope) {
      turno.caduca = setTimeout(() => salir(turno, new ErrorDeTurno('OCUPADO',
        'El campus está ocupado ahora mismo (hay muchas llamadas en cola). Inténtalo en un momento.')), tope);
    }
    for (const s of senales) vigilarSenal(s, turno);
    (fondo ? colas.detras : colas.delante).push(turno);
    repartir();
  });
}

/**
 * Corre `fn` (la petición a Moodle, con su respuesta leída) cuando le toca.
 * `signal`: si se aborta mientras espera, sale de la cola sin llamar (con su motivo).
 * Si el turno caduca o la petición HTTP se cierra, lanza ErrorDeTurno.
 */
export async function conTurno(fn, { signal } = {}) {
  const config = configDelLimitador();
  if (!config.porSegundo && !config.aLaVez) return fn();
  await pedirTurno(signal, config);
  try {
    return await fn();
  } finally {
    enCurso -= 1;
    repartir();
  }
}
