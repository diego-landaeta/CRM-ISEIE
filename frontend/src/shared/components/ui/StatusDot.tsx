import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export type TonoEstado = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface Props {
  tono?: TonoEstado;
  children: ReactNode;
  /** Explicación al pasar el ratón: el punto es una señal, no un dato. */
  title?: string;
  className?: string;
}

/**
 * Estado: punto de color y palabra.
 *
 * Dos razones para que no sea una píldora de color como hasta ahora:
 *
 *  · **El color solo no vale.** Quien no distingue rojo de verde ve dos
 *    pastillas iguales. La palabra va siempre y en color de texto normal; el
 *    punto acompaña, no sustituye.
 *  · **Densidad.** Una tabla de administración con quince pastillas de colores
 *    es un semáforo. Con punto y palabra la vista sigue las filas, que es lo
 *    que se viene a leer. Es como lo resuelven Zoho y SuiteDash.
 *
 * Los colores salen de los tokens de estado, así que valen en claro y en oscuro
 * sin escribir la variante `dark:` en cada sitio.
 */
const PUNTO: Record<TonoEstado, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-muted-foreground/50',
};

export default function StatusDot({ tono = 'neutral', children, title, className }: Props) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap', className)}
    >
      <span
        aria-hidden="true"
        className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', PUNTO[tono])}
      />
      <span className={tono === 'neutral' ? 'text-muted-foreground' : 'text-foreground'}>
        {children}
      </span>
    </span>
  );
}
