/**
 * Una lista, o una vacía. Nunca otra cosa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * El patrón `setAlgo(r.data)` da por hecho que el servidor manda un array. Casi
 * siempre lo manda. Cuando no —una respuesta a medias, un error con forma rara,
 * un 200 de un proxy, un endpoint que cambió de forma— la pantalla no enseña un
 * aviso: revienta con
 *
 *     TypeError: algo.map is not a function
 *
 * y se queda EN BLANCO. No un mensaje: en blanco, porque el error sube hasta el
 * ErrorBoundary y se lleva la página entera.
 *
 * Paso de verdad el 04/09/2026 en la pantalla de registro (`fuentes.filter is
 * not a function`), y al buscarlo aparecieron once sitios más con la misma
 * forma. Ninguno es un descuido de nadie en particular: es que `r.data` no
 * promete nada y todos confiamos igual.
 *
 * La pantalla puede quedarse vacía, o puede enseñar «no hay nada». Lo que no
 * puede es morirse — y menos las de registro o estado, que se miran justo
 * cuando algo va mal.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No convierte ni adivina: si no es un array, devuelve uno vacío. Envolver un
 * objeto en `[objeto]` sería peor, porque entonces la pantalla pintaría basura
 * en vez de quedarse vacía y nadie se enteraría de que el servidor contestó mal.
 */
export function lista<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export default lista;
