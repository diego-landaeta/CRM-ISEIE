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

  El freno es del proceso: la API de pruebas y la de producción son dos procesos y cada una
  lleva el suyo. Las dos del 360 llaman a los mismos campus, así que lo que llega al hosting
  es la suma de los dos (y de CRM-ISEIE, que tiene el suyo).
*/
import { AsyncLocalStorage } from 'node:async_hooks';

const plano = new AsyncLocalStorage();

/** Corre `fn` marcando como «de fondo» todo lo que llame a Moodle por debajo. */
export const enSegundoPlano = (fn) => plano.run(true, fn);
const esDeFondo = () => plano.getStore() === true;

const entero = (nombre, porDefecto) => {
  const n = Number.parseInt(process.env[nombre] ?? String(porDefecto), 10);
  return Number.isInteger(n) && n >= 0 ? n : porDefecto;
};

/** Lo que dice el .env ahora mismo. */
export const configDelLimitador = () => ({
  porSegundo: entero('MOODLE_LLAMADAS_POR_SEGUNDO', 4),
  aLaVez: entero('MOODLE_LLAMADAS_A_LA_VEZ', 2),
});

// Dos colas: delante, lo de las personas; detrás, lo de las tareas.
const colas = { delante: [], detras: [] };
let enCurso = 0;
let ultimaSalida = -Infinity;
let reloj = null;

const siguiente = () => colas.delante[0] || colas.detras[0] || null;
const quitar = (turno) => {
  for (const c of [colas.delante, colas.detras]) {
    const i = c.indexOf(turno);
    if (i >= 0) { c.splice(i, 1); return true; }
  }
  return false;
};

function dar(turno) {
  quitar(turno);
  enCurso += 1;
  ultimaSalida = Date.now();
  turno.signal?.removeEventListener('abort', turno.alAbortar);
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
      const falta = ultimaSalida + 1000 / porSegundo - Date.now();
      if (falta > 0) {
        reloj = setTimeout(() => { reloj = null; repartir(); }, Math.ceil(falta));
        return;
      }
    }
    dar(turno);
  }
}

function pedirTurno(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const turno = { resolve, signal, alAbortar: null };
    if (signal) {
      turno.alAbortar = () => { if (quitar(turno)) reject(signal.reason); };
      signal.addEventListener('abort', turno.alAbortar, { once: true });
    }
    (esDeFondo() ? colas.detras : colas.delante).push(turno);
    repartir();
  });
}

/**
 * Corre `fn` (la petición a Moodle, con su respuesta leída) cuando le toca.
 * `signal`: si se aborta mientras espera, sale de la cola sin llamar.
 */
export async function conTurno(fn, { signal } = {}) {
  const { porSegundo, aLaVez } = configDelLimitador();
  if (!porSegundo && !aLaVez) return fn();
  await pedirTurno(signal);
  try {
    return await fn();
  } finally {
    enCurso -= 1;
    repartir();
  }
}

/** Para la pantalla de estado y las pruebas. */
export const estadoDelLimitador = () => ({
  enCurso,
  esperando: colas.delante.length + colas.detras.length,
});

/** Para las pruebas: empezar de cero. */
export function _reiniciarLimitador() {
  if (reloj) clearTimeout(reloj);
  reloj = null;
  colas.delante.length = 0;
  colas.detras.length = 0;
  enCurso = 0;
  ultimaSalida = -Infinity;
}
