import { lazy, type ComponentType } from 'react';

/*
  PIEZA DEL FRONTAL QUE YA NO EXISTE TRAS UN DESPLIEGUE (errores de producción
  del 23/11).

  Cada pantalla es una pieza aparte (`assets/LeadsPage-xxxx.js`) que se pide al
  entrar en ella. Al desplegar, las piezas cambian de nombre y las viejas se
  borran. Quien tenía el CRM abierto desde antes sigue con el índice viejo y, al
  navegar, pide una pieza que ya no está: «Failed to fetch dynamically imported
  module …/assets/LeadsPage-xxxx.js» y la pantalla de «Algo se ha roto».

  Recargar trae el índice nuevo y lo arregla. Se recarga UNA vez sola: la marca
  va en sessionStorage, y si ya se recargó hace poco no se vuelve a recargar (si
  la pieza sigue sin estar, el problema es otro y recargar en bucle no lo
  arregla). Sin sessionStorage (navegación privada estricta, almacenamiento
  bloqueado) no se recarga: no habría forma de saber si ya se hizo.
*/

/** La misma clave que usaba main.jsx: una recarga de allí cuenta aquí. */
const CLAVE = 'chunk-error-reload-ts';
/** Tras recargar, en este rato no se vuelve a recargar. */
export const VENTANA_MS = 5 * 60 * 1000;

let recargar = (): void => { window.location.reload(); };
/** Para las pruebas: jsdom no deja sustituir `window.location.reload`. */
export function _cambiarRecarga(fn: () => void): void { recargar = fn; }

/** ¿Es el error de una pieza que no se ha podido cargar? (Chrome, Firefox, Safari). */
export function esErrorDePieza(error: unknown): boolean {
  const msg = String((error as { message?: string } | null)?.message ?? error ?? '');
  return msg.includes('Failed to fetch dynamically imported module')
    || msg.includes('Importing a module script failed')
    || msg.includes('error loading dynamically imported module')
    || /ChunkLoadError|Loading chunk \S+ failed/.test(msg);
}

/** Si es ese error y no se ha recargado hace poco, recarga. `true` si ha recargado. */
export function recargarUnaVez(error: unknown, ahora: number = Date.now()): boolean {
  if (!esErrorDePieza(error)) return false;
  try {
    const ultima = Number(window.sessionStorage.getItem(CLAVE) || 0);
    if (ultima && ahora - ultima < VENTANA_MS) return false;
    window.sessionStorage.setItem(CLAVE, String(ahora));
  } catch {
    return false;
  }
  // eslint-disable-next-line no-console
  console.warn('[pieza-nueva] el frontal es de antes del último despliegue: se recarga una vez');
  recargar();
  return true;
}

/**
 * `lazy()` de React, pero si la pieza ya no existe recarga una vez en vez de
 * romper la pantalla. Mientras recarga se queda en el `fallback` del Suspense
 * (la promesa no se resuelve nunca). Cualquier otro error sigue su camino.
 */
export function lazyConRecarga<T extends ComponentType<any>>(cargar: () => Promise<{ default: T }>) {
  return lazy(() => cargar().catch((error: unknown) => {
    if (recargarUnaVez(error)) return new Promise<{ default: T }>(() => {});
    throw error;
  }));
}
