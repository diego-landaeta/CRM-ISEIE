/**
 * Moverse por el árbol de categorías (#2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA APARTE DE LA PANTALLA
 *
 * Todo lo que puede salir mal aquí es de cuentas, no de pintar: una categoría
 * que apunta a un padre que ya no está, un padre que apunta a su propio nieto,
 * un producto que señala una categoría que la lista no trae. Metido dentro del
 * componente eso sólo se prueba montando React; aquí se prueba con una lista y
 * un número.
 *
 * EL ARBOL LLEGA PLANO
 *
 * `GET /product-categories/project/:id` devuelve filas sueltas con `parent_id`.
 * No hay `children` anidados: el árbol se arma andando los `parent_id`, y eso
 * es lo que hacen estas funciones.
 *
 * LOS CICLOS
 *
 * `pathOf` en el formulario paraba a los 10 saltos «por si acaso». Eso tapa dos
 * cosas distintas con el mismo número: un árbol legítimamente hondo (ISEIE tiene
 * ramas de cinco niveles y podría tener más) y un ciclo de verdad. Aquí se
 * lleva un visto de por dónde se ha pasado: sin límite artificial de
 * profundidad, y un ciclo se corta en la primera repetición en vez de dar
 * diez vueltas y devolver una ruta inventada.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { casaPorTrozos } from '@/shared/lib/buscarPorTrozos';

export interface CatPlana {
  id: number;
  /**
   * Opcional a proposito: hay endpoints que no devuelven la columna cuando es
   * nula. Sin `undefined` aqui, cada sitio que la use tendria que rellenarla
   * a mano antes de pasarla —y el que se olvide se lo encuentra en pantalla,
   * no en el compilador—. Dentro se compara con `== null`, asi que `undefined`
   * y `null` significan lo mismo: es de primer nivel.
   */
  parent_id?: number | null;
  nombre: string;
}

/** Índice por id. Las listas son de cientos y se recorren por nivel. */
function porId<T extends CatPlana>(cats: T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const c of cats) m.set(Number(c.id), c);
  return m;
}

/**
 * De la raíz hasta la categoría, incluida.
 *
 * Vacío si la categoría no está en la lista — que NO es lo mismo que estar en
 * la raíz, y hay que poder distinguirlo: un producto que apunta a una categoría
 * desactivada (que `listByProject` no devuelve) daría una ruta de un elemento y
 * la pantalla enseñaría la cascada vacía como si no tuviera categoría. Al
 * guardar se perdería el dato sin que nadie lo viera.
 */
export function caminoHasta<T extends CatPlana>(cats: T[], id: number | null): T[] {
  if (id == null) return [];
  const idx = porId(cats);
  const destino = idx.get(Number(id));
  if (!destino) return [];

  const camino: T[] = [];
  const vistos = new Set<number>();
  let actual: T | undefined = destino;
  while (actual && !vistos.has(Number(actual.id))) {
    vistos.add(Number(actual.id));
    camino.unshift(actual);
    actual = actual.parent_id == null ? undefined : idx.get(Number(actual.parent_id));
  }
  return camino;
}

/** Los hijos directos, por orden alfabético. `null` = las de primer nivel. */
export function hijosDe<T extends CatPlana>(cats: T[], padreId: number | null): T[] {
  return cats
    .filter((c) => (padreId == null
      ? c.parent_id == null
      : Number(c.parent_id) === Number(padreId)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Qué hay elegido en cada nivel de la cascada, y cuántos selectores pintar.
 *
 * Devuelve un valor por nivel del camino, más UNO al final vacío mientras la
 * categoría elegida tenga hijos — ese último es el «puedes bajar más», y
 * desaparece solo cuando ya no hay dónde bajar.
 */
export function nivelesDe<T extends CatPlana>(
  cats: T[], id: number | null
): Array<number | null> {
  const camino = caminoHasta(cats, id);
  const niveles: Array<number | null> = camino.map((c) => Number(c.id));
  const ultimo = camino.length ? Number(camino[camino.length - 1].id) : null;
  if (hijosDe(cats, ultimo).length) niveles.push(null);
  // Sin nada elegido queda un solo selector: el de primer nivel.
  return niveles.length ? niveles : [null];
}

/** «Cursos › Para Profesionales › Adicciones». Vacío si no se encuentra. */
export function rutaEnTexto<T extends CatPlana>(
  cats: T[], id: number | null, separador = ' › '
): string {
  return caminoHasta(cats, id).map((c) => c.nombre).join(separador);
}

/** Lo hondo que llega el árbol. Para saber cuántos selectores caben, como mucho. */
export function profundidad<T extends CatPlana>(cats: T[]): number {
  let max = 0;
  for (const c of cats) {
    const n = caminoHasta(cats, Number(c.id)).length;
    if (n > max) max = n;
  }
  return max;
}

/** Un nodo del arbol tal y como lo devuelve `/tree`: anidado, con sus hijas. */
export interface NodoConHijas {
  nombre: string;
  children: NodoConHijas[];
}

/**
 * ¿Casa esta rama con lo que se ha escrito en el filtro?
 *
 * Casa si casan el nombre del nodo Y SU RUTA leidos juntos, o si casa alguna de
 * sus hijas — a los padres se les deja a la vista para poder bajar por ellos.
 *
 * Se busca por la rama entera porque hay dos «Adicciones» en el catalogo, una
 * bajo «Para Profesionales» y otra bajo «Para Familias». Mirando solo el nombre
 * salen las dos y no hay forma de saber cual es cual; con la ruta, «prof adicc»
 * da una sola. Es la misma regla que el buscador del formulario, y a proposito:
 * el mismo catalogo no puede buscarse de dos maneras en dos pantallas.
 */
export function casaLaRama<T extends NodoConHijas>(nodo: T, texto: string, ruta = ''): boolean {
  if (!texto.trim()) return true;
  if (casaPorTrozos(texto, nodo.nombre, ruta)) return true;
  const rutaHija = ruta ? `${ruta} ${nodo.nombre}` : nodo.nombre;
  return nodo.children.some((h) => casaLaRama(h as T, texto, rutaHija));
}
