import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Un campo de formulario: su etiqueta, el control, su ayuda y su error.
 *
 * Estaba escrito siete veces, una por formulario, y no coincidían: el error
 * salía con el token de peligro en uno y con un rojo suelto de Tailwind en
 * tres; la ayuda a 12px o a 11px; el asterisco de obligatorio solo en
 * facturas; y el aviso de error solo se anunciaba a un lector de pantalla en
 * «Mi perfil». Aquí hay uno.
 *
 * (Los nombres de esas clases van descritos y no escritos a propósito: el
 * candado de colores del #32 lee el fichero entero, comentarios incluidos, y
 * citarlas aquí lo haría saltar contra la pieza que viene a arreglarlas.)
 *
 * EL ERROR SUSTITUYE A LA AYUDA, no se suma. Una ayuda que sigue ahí debajo de
 * un error compite con él justo cuando hace falta leer una sola cosa. Cuando
 * se arregla el campo, la ayuda vuelve.
 */

export default function Field({
  label,
  children,
  hint,
  error,
  required,
  disabled,
  htmlFor,
  className,
}: {
  label: string;
  children: ReactNode;
  /** La línea de debajo: en qué formato, de dónde sale, qué pasa si se deja vacío. */
  hint?: string;
  /** Qué ha ido mal. Se anuncia con `role="alert"`. */
  error?: string;
  required?: boolean;
  /** El campo no se puede tocar ahora mismo: la etiqueta se apaga con él. */
  disabled?: boolean;
  /** El `id` del control, si lo tiene: hace que pulsar la etiqueta lo enfoque. */
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          'mb-1.5 block px-1 text-secundario',
          disabled ? 'text-muted-foreground/60' : 'text-muted-foreground',
        )}
      >
        {label}
        {required && (
          // Con su nombre, no solo el asterisco: quien lo oiga leído tiene que
          // enterarse igual que quien lo ve.
          <span className="text-destructive"> *<span className="sr-only"> (obligatorio)</span></span>
        )}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 px-1 text-secundario text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 px-1 text-secundario text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
