/*
  Lo que comparten todos los ficheros de recorridos (CRM-ISEIE#681, gemela de CRM#1012). Sin imports:
  cualquiera lo puede usar sin crear un ciclo con `recorridosCobros`.
*/

/** El selector de un paso: siempre un `data-recorrido`, nunca un texto ni una clase. */
export const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;

/**
 * El último paso de cada recorrido. Desde la #1012 ninguno se abre solo: se
 * abren con el botón «Recorrido» de arriba (y con «Ver recorrido» donde lo hay).
 */
export const FINAL_RECORRIDO = 'Ninguno sale solo. Para repasarlo, pulsa «Recorrido» arriba a la derecha cuando quieras.';
