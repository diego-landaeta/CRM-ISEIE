import { cn } from '@/shared/lib/utils';
import type { CampusMoodle, FiltroEstado } from '../api/moodle.api';

/**
 * Los cursos de un campus por su estado, como cinco tarjetas con la cifra grande:
 * «Activos 134 · Próximos 1 · Terminados 2 · Ocultos 3 · Todos 140». Se ve de un vistazo
 * cuántos hay de cada y, al pulsar una, la tabla de debajo se filtra.
 */
type Cursos = NonNullable<CampusMoodle['cursos']>;

const OPCIONES: { clave: FiltroEstado; etiqueta: string; punto: string; cuenta: (c: Cursos) => number }[] = [
  { clave: 'activos', etiqueta: 'Activos', punto: 'bg-success', cuenta: (c) => c.activos },
  { clave: 'proximos', etiqueta: 'Próximos', punto: 'bg-info', cuenta: (c) => c.proximos },
  { clave: 'terminados', etiqueta: 'Terminados', punto: 'bg-muted-foreground/50', cuenta: (c) => c.terminados },
  { clave: 'ocultos', etiqueta: 'Ocultos', punto: 'bg-warning', cuenta: (c) => c.ocultos },
  { clave: 'todos', etiqueta: 'Todos', punto: 'bg-foreground/70', cuenta: (c) => c.total },
];

export default function EstadoDeCursos({ valor, cursos, onChange }: {
  valor: FiltroEstado;
  cursos: CampusMoodle['cursos'];
  onChange: (estado: FiltroEstado) => void;
}) {
  return (
    <div role="tablist" aria-label="Estado de los cursos" className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-5" data-testid="estado-cursos">
      {OPCIONES.map((o) => {
        const activa = o.clave === valor;
        return (
          <button
            key={o.clave}
            type="button"
            role="tab"
            aria-selected={activa}
            onClick={() => onChange(o.clave)}
            className={cn(
              'rounded-lg border bg-card px-3 py-2.5 text-left sm:px-4 sm:py-3.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
              activa ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border hover:border-foreground/25 hover:bg-muted/40',
            )}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:gap-2 sm:text-xs">
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', o.punto)} />
              {o.etiqueta}
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums leading-none text-foreground">
              {cursos ? o.cuenta(cursos) : '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
