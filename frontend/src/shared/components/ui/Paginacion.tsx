import { CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import Select from '@/shared/components/ui/Select';

/**
 * Paginación de una lista: el rango que se ve, la página en la que estás con las de al
 * lado, y cuántas filas por página.
 *
 *   Mostrando 1–25 de 134 cursos        Filas [25 ▾]   « ‹ 1 2 3 … 6 › »
 *
 * Dos formas, para poner una arriba y otra abajo de una tabla larga:
 *   · `completa`: la de siempre, con números y filas por página.
 *   · `compacta`: solo el rango y las flechas, para la barra de herramientas.
 *
 * Con una sola página y sin opción de cambiar las filas, no sale nada.
 */
interface Props {
  pagina: number;
  limite: number;
  total: number;
  onPagina: (pagina: number) => void;
  /** Si se pasa, se puede elegir cuántas filas por página. */
  onLimite?: (limite: number) => void;
  opcionesLimite?: number[];
  /** Lo que se cuenta: «cursos», «alumnos»… */
  unidad?: string;
  variante?: 'completa' | 'compacta';
  className?: string;
}

/** Las páginas que se enseñan: la primera, la última y las de al lado de la actual; el resto, «…». */
export function paginasVisibles(actual: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, actual - 1, actual, actual + 1]);
  if (actual <= 3) { set.add(2); set.add(3); set.add(4); }
  if (actual >= total - 2) { set.add(total - 1); set.add(total - 2); set.add(total - 3); }
  const orden = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const salida: (number | '…')[] = [];
  orden.forEach((n, i) => {
    const salto = i > 0 ? n - orden[i - 1] : 1;
    // Unos puntos que esconden UNA sola página no ahorran nada: se enseña la página.
    if (salto === 2) salida.push(n - 1);
    else if (salto > 2) salida.push('…');
    salida.push(n);
  });
  return salida;
}

const BOTON = 'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-sm transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:pointer-events-none disabled:opacity-40';

export default function Paginacion({
  pagina, limite, total, onPagina, onLimite, opcionesLimite = [10, 25, 50, 100], unidad = 'resultados', variante = 'completa', className,
}: Props) {
  const paginas = Math.max(1, Math.ceil(total / limite));
  const desde = total ? (pagina - 1) * limite + 1 : 0;
  const hasta = Math.min(total, pagina * limite);
  const rango = total ? `${desde}–${hasta} de ${total}` : 'Sin resultados';

  if (variante === 'compacta') {
    if (paginas <= 1) return total ? <span className={cn('text-xs text-muted-foreground', className)}>{total} {unidad}</span> : null;
    return (
      <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
        <span className="tabular-nums">{rango}</span>
        <button type="button" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)} className={BOTON}><CaretLeft size={13} weight="bold" /></button>
        <button type="button" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)} className={BOTON}><CaretRight size={13} weight="bold" /></button>
      </div>
    );
  }

  if (paginas <= 1 && !onLimite) return null;

  return (
    <nav aria-label="Paginación" className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3', className)}>
      <p className="text-sm text-muted-foreground tabular-nums">
        {total ? <>Mostrando <span className="font-medium text-foreground">{rango}</span> {unidad}</> : 'Sin resultados'}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onLimite && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Filas
            <Select<number>
              ariaLabel="Filas por página"
              size="sm"
              value={limite}
              onChange={(v) => onLimite(v)}
              options={opcionesLimite.map((n) => ({ value: n, label: String(n) }))}
            />
          </label>
        )}
        {paginas > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" aria-label="Primera página" disabled={pagina <= 1} onClick={() => onPagina(1)} className={cn(BOTON, 'hidden sm:inline-flex')}><CaretDoubleLeft size={13} weight="bold" /></button>
            <button type="button" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)} className={BOTON}><CaretLeft size={13} weight="bold" /></button>
            {paginasVisibles(pagina, paginas).map((n, i) => (n === '…' ? (
              <span key={`p${i}`} className="px-1 text-muted-foreground" aria-hidden="true">…</span>
            ) : (
              <button
                key={n}
                type="button"
                aria-label={`Página ${n}`}
                aria-current={n === pagina ? 'page' : undefined}
                onClick={() => onPagina(n)}
                className={cn(BOTON, 'tabular-nums', n === pagina && 'border-primary bg-primary text-primary-foreground hover:bg-primary')}
              >
                {n}
              </button>
            )))}
            <button type="button" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)} className={BOTON}><CaretRight size={13} weight="bold" /></button>
            <button type="button" aria-label="Última página" disabled={pagina >= paginas} onClick={() => onPagina(paginas)} className={cn(BOTON, 'hidden sm:inline-flex')}><CaretDoubleRight size={13} weight="bold" /></button>
          </div>
        )}
      </div>
    </nav>
  );
}
