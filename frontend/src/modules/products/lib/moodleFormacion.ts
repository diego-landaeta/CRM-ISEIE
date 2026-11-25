import type { CategoriaMoodle, OrigenCategoria, TipoFormacion } from '../api/formaciones.api';

/**
 * Formaciones › Moodle (CRM#1113 / CRM-ISEIE#767, fase 2): cómo se enseñan las
 * categorías del Moodle y lo que se va a crear. Sin pantalla, para probarlo solo.
 */

export const TIPO_EN_PLURAL: Record<TipoFormacion, string> = { curso: 'cursos', diplomado: 'diplomados', master: 'másteres' };

/**
 * El nombre de una categoría en un desplegable. Con el árbol entero, su ruta
 * («Diplomados › Medicina»). Sin él (el token del plugin no lee las categorías, solo
 * los cursos), el nombre; y si hay otra con el mismo nombre (las facultades de ISEIE,
 * una por tipo), con su id para distinguirlas.
 */
export function etiquetaDeCategoria(c: CategoriaMoodle, todas: CategoriaMoodle[]): string {
  const nombre = c.ruta || c.nombre;
  const repetida = todas.some((x) => x.id !== c.id && (x.ruta || x.nombre) === nombre);
  const cursos = `${c.cursos} ${c.cursos === 1 ? 'curso' : 'cursos'}`;
  return repetida ? `${nombre} (id ${c.id}, ${cursos})` : `${nombre} (${cursos})`;
}

/** Las opciones de un desplegable de categoría: la de por defecto (0) y las del campus. */
export function opcionesDeCategoria(todas: CategoriaMoodle[]): Array<{ value: number; label: string }> {
  return [
    { value: 0, label: 'La de por defecto del Moodle' },
    ...todas.map((c) => ({ value: c.id, label: etiquetaDeCategoria(c, todas) })),
  ];
}

/** De dónde sale la categoría que se usará. */
export function textoDelOrigen(origen: OrigenCategoria): string {
  if (origen === 'campus') return 'la elegida en Integraciones › Moodle';
  if (origen === 'propuesta') return 'propuesta por su nombre (cámbiala en Integraciones › Moodle)';
  return 'no hay ninguna que se llame como el tipo: elígela en Integraciones › Moodle';
}

/** El nombre de la categoría elegida, sabiendo las del campus. */
export function nombreDeCategoria(id: number, todas: CategoriaMoodle[]): string {
  if (!id) return 'la de por defecto del Moodle';
  const c = todas.find((x) => x.id === id);
  return c ? (c.ruta || c.nombre) : `la categoría ${id}`;
}

/**
 * El nombre corto que se escribe: sin espacios de más. Vacío vale (se usa el propuesto).
 * Moodle lo admite hasta 255 letras; el CRM deja 250 para el sufijo -2, -3…
 */
export function problemaDelNombreCorto(valor: string): string | null {
  const v = valor.trim();
  if (v.length > 250) return 'El nombre corto no puede pasar de 250 letras.';
  return null;
}
