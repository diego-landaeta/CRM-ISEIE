import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Sin relleno cuando dentro va una tabla, que trae el suyo. */
  padding?: 'none' | 'sm' | 'md';
  /** Recorta lo de dentro: para tablas que llegan al borde. */
  overflowHidden?: boolean;
  children?: ReactNode;
}

const RELLENO = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
} as const;

/**
 * La superficie sobre la que va todo: tarjeta, panel, bloque.
 *
 * Existe porque el patrón `bg-card border border-border rounded-*` está escrito
 * a mano **337 veces en 13 variantes**, con cuatro esquinas distintas para la
 * misma cosa —191 con `lg`, 30 con `xl`, 24 con `2xl`, 22 con `md`—. Eso es lo
 * que hace que dos pantallas del mismo CRM no parezcan del mismo CRM.
 *
 * Aquí la esquina se decide una vez. Si mañana cambia, cambia en todas.
 */
export default function Card({
  padding = 'md',
  overflowHidden = false,
  className,
  children,
  ...resto
}: CardProps) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground border border-border rounded-lg',
        RELLENO[padding],
        overflowHidden && 'overflow-hidden',
        className,
      )}
      {...resto}
    >
      {children}
    </div>
  );
}

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * Una franja dentro de la tarjeta, separada por una línea.
 *
 * Para barras de filtros, pies de tabla y cabeceras de bloque: lo que antes se
 * resolvía metiendo un `border-t` suelto donde tocara.
 */
export function CardSection({ className, children, ...resto }: CardSectionProps) {
  return (
    <div className={cn('px-4 py-3 border-b border-border last:border-b-0', className)} {...resto}>
      {children}
    </div>
  );
}
