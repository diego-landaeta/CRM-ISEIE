import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge no conoce los tamaños ni los espacios con nombre de
// tailwind.config.js (#32). Sin decírselo, toma `text-secundario` por un COLOR
// de texto y lo borra en cuanto llega otro color: la etiqueta de Field
// (`text-secundario` + `text-muted-foreground`) perdía sus 12 px y heredaba el
// tamaño de lo que la rodeaba (#106). Los nombres, los mismos que en el config.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { spacing: ['bloque', 'tarjeta', 'fila'] },
    classGroups: { 'font-size': [{ text: ['titulo', 'seccion', 'normal', 'secundario', 'tabla', 'cifra'] }] },
  },
});

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
