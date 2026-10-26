// Buscar escribiendo trozos sueltos, y sin acentos.
//
// Nace en `BuscadorEnLista` con los 787 cursos de ISEIE: la gente recuerda
// «neuro logo», no el titulo entero ni el orden de las palabras.
//
// Se saca aqui porque el arbol de categorias del listado de productos filtraba
// con un `includes` pelado —sensible a los acentos y mirando solo el nombre—
// mientras el MISMO catalogo, en el formulario de producto, ya se buscaba de
// esta otra forma. Dos maneras de buscar lo mismo en dos pantallas es justo lo
// que pedia evitar el #2.

export const sinAcentos = (s: string | number | null | undefined): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * ¿Casan TODOS los trozos de lo escrito en alguno de los campos que se le pasan?
 *
 * Los campos se juntan en un solo texto antes de mirar, y es a proposito:
 * «prof adicc» tiene que llegar a la «Adicciones» que cuelga de «Para
 * Profesionales», y eso solo sale si el nombre y su ruta se leen como uno.
 * Hay dos «Adicciones» en el arbol y sin la ruta no hay forma de separarlas.
 *
 * Los campos que no son texto se ignoran: un importe no se busca. Nadie teclea
 * el precio de un curso, y colaria resultados que no tienen que ver con lo
 * escrito.
 *
 * Sin texto casa todo — un filtro vacio no esconde nada.
 */
export function casaPorTrozos(
  texto: string,
  ...campos: (string | number | null | undefined)[]
): boolean {
  const t = sinAcentos(texto).trim();
  if (!t) return true;
  const donde = sinAcentos(campos.filter((c) => typeof c === 'string' && c).join(' '));
  return t.split(/\s+/).every((trozo) => donde.includes(trozo));
}
