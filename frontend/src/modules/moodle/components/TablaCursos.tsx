import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react';
import StatusDot from '@/shared/components/ui/StatusDot';
import { cn } from '@/shared/lib/utils';
import type { CursoMoodle, OrdenCursos, SentidoOrden } from '../api/moodle.api';
import { ESTADO_DEL_CURSO, fecha } from '../lib/formato';

/**
 * Los cursos de un campus. Pulsar uno abre su detalle (alumnos, contenido y recursos); pulsar
 * una cabecera (Curso, Categoría, Inicio, Fin) los ordena, y otra vez, al revés.
 * Solo la tabla: la paginación va fuera, para poder ponerla arriba y abajo.
 */
const TH = 'px-3 py-3 sm:px-5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';

function Cabecera({ campo, etiqueta, orden, sentido, onOrden, alineada = 'izquierda', soloAncha = false }: {
  campo: OrdenCursos;
  etiqueta: string;
  orden: OrdenCursos;
  sentido: SentidoOrden;
  onOrden: (campo: OrdenCursos) => void;
  alineada?: 'izquierda' | 'derecha';
  /** Se oculta en el móvil (la columna se ve desde tablet). */
  soloAncha?: boolean;
}) {
  const activa = orden === campo;
  const Icono = !activa ? CaretUpDown : sentido === 'asc' ? CaretUp : CaretDown;
  return (
    <th scope="col" className={cn(TH, alineada === 'derecha' && 'text-right', soloAncha && 'hidden md:table-cell')} aria-sort={activa ? (sentido === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onOrden(campo)}
        className={cn('inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground focus:outline-none focus-visible:underline', activa && 'text-foreground')}
      >
        {etiqueta}
        <Icono size={12} weight={activa ? 'bold' : 'regular'} aria-hidden="true" className={cn(!activa && 'opacity-50')} />
      </button>
    </th>
  );
}

export default function TablaCursos({ cursos, elegido, onElegir, orden, sentido, onOrden }: {
  cursos: CursoMoodle[];
  elegido: number | null;
  onElegir: (curso: CursoMoodle) => void;
  orden: OrdenCursos;
  sentido: SentidoOrden;
  onOrden: (campo: OrdenCursos) => void;
}) {
  const cab = { orden, sentido, onOrden };
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm" data-testid="tabla-cursos">
        <thead className="bg-muted/40">
          <tr className="border-b border-border">
            <Cabecera campo="nombre" etiqueta="Curso" {...cab} />
            <Cabecera campo="categoria" etiqueta="Categoría" soloAncha {...cab} />
            <th scope="col" className={TH}>Estado</th>
            <th scope="col" className={cn(TH, 'text-right')}>Alumnos</th>
            <Cabecera campo="inicio" etiqueta="Inicio" soloAncha {...cab} />
            <Cabecera campo="fin" etiqueta="Fin" soloAncha {...cab} />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {cursos.map((c) => {
            const e = ESTADO_DEL_CURSO[c.estado];
            return (
              <tr key={c.curso_id} className={cn('transition-colors', c.curso_id === elegido ? 'bg-primary/5' : 'hover:bg-muted/40')}>
                <td className="max-w-[28rem] px-3 py-3.5 sm:px-5">
                  <button
                    type="button"
                    onClick={() => onElegir(c)}
                    className="block text-left font-medium leading-snug text-foreground hover:text-primary focus:outline-none focus-visible:underline"
                  >
                    {c.nombre.trim()}
                  </button>
                  {c.nombre_corto && <span className="mt-0.5 block text-xs text-muted-foreground">{c.nombre_corto}</span>}
                  {c.categoria && <span className="mt-0.5 block text-xs text-muted-foreground md:hidden">{c.categoria}</span>}
                </td>
                <td className="hidden px-3 py-3.5 sm:px-5 text-muted-foreground md:table-cell">{c.categoria ?? '—'}</td>
                <td className="px-3 py-3.5 sm:px-5"><div className="flex items-center"><StatusDot tono={e.tono} title={e.ayuda}>{e.etiqueta}</StatusDot></div></td>
                <td className="px-3 py-3.5 sm:px-5 text-right tabular-nums" title={c.alumnos_error}>
                  {c.alumnos === null ? <span className="text-warning" aria-label="No se pudo leer">?</span> : c.alumnos}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3.5 sm:px-5 tabular-nums text-muted-foreground md:table-cell">{fecha(c.inicio)}</td>
                <td className="hidden whitespace-nowrap px-3 py-3.5 sm:px-5 tabular-nums text-muted-foreground md:table-cell">{fecha(c.fin)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
