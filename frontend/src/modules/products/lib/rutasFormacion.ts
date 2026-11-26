/**
 * Dónde vive cada pantalla de Productos › Formaciones (CRM#1113). El campus va en
 * la dirección (`?campus=`): una formación se edita en SU campus, aunque arriba
 * esté elegida una empresa o «Todos».
 */
export const RUTA_FORMACIONES = '/products/formaciones';

export function rutaDeFormacion(id: number | 'nueva', campus: number) {
  return `${RUTA_FORMACIONES}/${id}?campus=${campus}`;
}
