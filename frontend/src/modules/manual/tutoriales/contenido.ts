/**
 * El texto y las capturas de cada tutorial, para la pantalla de un tutorial.
 * Van con ella (no con la lista): Vite los mete en el trozo de esa pantalla.
 */
const TEXTOS = import.meta.glob('./contenido/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const CAPTURAS = import.meta.glob('./img/*.webp', { import: 'default', eager: true }) as Record<string, string>;

/** El Markdown de un tutorial, o undefined si no hay. */
export const textoDe = (id: string): string | undefined => TEXTOS[`./contenido/${id}.md`];

/** Nombre del fichero (`g1-ficha-prospecto.webp`) → su dirección ya servida. */
export const CAPTURAS_POR_NOMBRE: Record<string, string> = Object.fromEntries(
  Object.entries(CAPTURAS).map(([ruta, url]) => [ruta.replace('./img/', ''), url]),
);
