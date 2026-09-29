/**
 * Cuándo toca un paso, dicho a partir de sus números.
 *
 * Diego, cerrando el #87: «la etiqueta debería salir de los números, no
 * escribirse aparte. Un texto que repite lo que dice otro campo acaba
 * contradiciéndolo — es justo lo que pasó aquí.»
 *
 * Lo que pasó: la tabla guardaba `dia_desde`/`dia_hasta` —días desde que entra
 * el prospecto— y además un `cuando` de texto copiado del documento, que decía
 * «Lunes o martes». Los números estaban bien desde el principio; mentía la
 * frase. La pantalla llegó a avisar de que no son días de la semana y a poner
 * uno justo debajo.
 *
 * Así que la frase se dice aquí, en un solo sitio, y `cuando` queda SOLO para
 * lo que no se cuenta en días: el paso 5 es «Final de mes», que es de
 * calendario y no de lo que lleva esperando la persona.
 *
 * Vive en `lib/` y no dentro de la página porque la usan las dos: la lista para
 * pintarla y el diálogo para enseñar lo que se va a leer mientras se teclean
 * los días.
 */

/** «El mismo día», «A los 2 o 3 días», o `null` si no hay ventana. */
export function textoDeDias(desde: number | null, hasta: number | null): string | null {
  // Sin ventana no hay nada que decir aquí: manda lo que ponga `cuando` —el
  // seguimiento mensual es «Final de mes», que no se cuenta en días.
  if (desde === null && hasta === null) return null;
  const a = desde ?? hasta!;
  const b = hasta ?? desde!;
  if (a === 0 && b === 0) return 'El mismo día';
  if (a === 0 && b === 1) return 'El mismo día o al siguiente';
  if (a === 1 && b === 1) return 'Al día siguiente';
  if (a === b) return `A los ${a} días`;
  // «7 u 8», no «7 o 8»: delante de una palabra que empieza por o- la
  // conjunción es «u», y ocho y once empiezan por o.
  const conjuncion = b === 8 || b === 11 ? 'u' : 'o';
  return `A los ${a} ${conjuncion} ${b} días`;
}

/**
 * Lo mismo, leyendo lo que hay escrito en el formulario.
 *
 * Los campos de un formulario son cadenas, y una vacía no es un cero: con
 * `Number('')` saldría 0 y el paso diría «El mismo día» por no haber escrito
 * nada todavía.
 */
export function textoDeDiasEscritos(desde: string, hasta: string): string | null {
  const n = (v: string) => (v.trim() === '' ? null : Number(v));
  const a = n(desde);
  const b = n(hasta);
  if ((a !== null && !Number.isFinite(a)) || (b !== null && !Number.isFinite(b))) return null;
  if (a !== null && b !== null && b < a) return null; // rango imposible: ya lo dice el error del campo
  return textoDeDias(a, b);
}

/** ¿Este paso se cuenta en días? Si sí, la frase la escribe la pantalla. */
export function tieneVentanaDeDias(desde: string, hasta: string): boolean {
  return desde.trim() !== '' || hasta.trim() !== '';
}
