import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Una casilla de marcar (#423), con etiqueta y una frase debajo.
 *
 * Es la `<input type="checkbox">` del navegador —se marca con el espacio, la
 * lee el lector de pantalla, no hace falta reinventar nada— con el color del
 * CRM (`accent-primary`) y un estado más: `parcial`, el guion de «Seleccionar
 * todo» cuando una sección tiene unas sí y otras no.
 */
export default function Casilla({
  marcada, parcial = false, onCambiar, deshabilitada = false, etiqueta, descripcion, className, id,
}: {
  marcada: boolean;
  /** Ni todas ni ninguna: se pinta el guion. */
  parcial?: boolean;
  onCambiar?: (marcada: boolean) => void;
  deshabilitada?: boolean;
  etiqueta?: ReactNode;
  descripcion?: ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = parcial && !marcada; }, [parcial, marcada]);

  const casilla = (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={marcada}
      disabled={deshabilitada}
      aria-checked={parcial && !marcada ? 'mixed' : marcada}
      onChange={(e) => onCambiar?.(e.target.checked)}
      className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-border accent-primary disabled:cursor-not-allowed"
    />
  );
  if (!etiqueta) return casilla;
  return (
    <label className={cn('flex items-start gap-2 text-normal', deshabilitada ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', className)}>
      {casilla}
      <span className="min-w-0">
        <span className="block">{etiqueta}</span>
        {descripcion && <span className="block text-secundario text-muted-foreground">{descripcion}</span>}
      </span>
    </label>
  );
}
