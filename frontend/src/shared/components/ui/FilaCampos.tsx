import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Varios campos en la misma fila, midiendo lo mismo.
 *
 * Los formularios los ponían con `flex` y anchos a ojo, así que dos campos de
 * la misma fila acababan con tamaños distintos según lo que llevaran dentro, y
 * en el móvil se encogían hasta no poder escribir en ellos en vez de ponerse
 * uno debajo de otro.
 *
 * Aquí es una rejilla: las columnas miden igual por definición, y por debajo de
 * `sm` hay una sola columna.
 *
 * LAS CLASES VAN ESCRITAS, no construidas. Tailwind lee el código fuente tal
 * cual, así que un `sm:grid-cols-${n}` no llega nunca a compilarse y la fila
 * sale a partes iguales sin que nadie lo note hasta verlo en pantalla. Ya pasó
 * dos veces en este proyecto.
 */

const REJILLA = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const;

export default function FilaCampos({
  columnas = 2,
  children,
  className,
}: {
  columnas?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  // `gap-tarjeta` son los 16px con nombre del #32, los mismos que separan lo
  // de dentro de una tarjeta. Un formulario no es otra cosa.
  return (
    <div className={cn('grid gap-tarjeta', REJILLA[columnas], className)}>
      {children}
    </div>
  );
}
