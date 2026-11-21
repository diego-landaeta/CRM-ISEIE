import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowCounterClockwise, ArrowRight, CalendarBlank, Gear, ListChecks, Sun, Warning } from '@phosphor-icons/react';
import { traerCola, traerResumen, type PasoEnCola, type ResumenCola } from '@/modules/proceso/api/agenda.api';
import { PROCESO_EN_PRUEBAS } from '@/shared/lib/enPruebas';

/**
 * «LO QUE TOCA HOY Y MAÑANA», EN PROSPECTOS (#534, parte 4).
 *
 * Diego, 18/11, en la PR #883: «Lo que toca hoy y mañana» se queda en
 * Prospectos (puede ir debajo de la lista, que ahora abre primero), y tiene que
 * SEPARAR claramente lo que toca HOY de lo que toca MAÑANA: dos pestañas con su
 * título y el número de cada una, para que se vea de un vistazo qué es de cada
 * día. Es lo que pidió el 23/09: «la cola del día debe de estar en prospectos
 * también con atajos y todo».
 *
 * No cuenta nada por su cuenta: los números salen de `GET /proceso/cola/resumen`
 * y las personas de `GET /proceso/cola?tramo=…`, que ya recortan por rol (una
 * gestora ve lo suyo). Es la misma cola del Dashboard y de «La cola del día».
 *
 * En ISEIE las rutas son /leads/... (en MultiCRM, /prospectos/...). Y el
 * «Seguimiento de fin de mes» sigue detrás de PROCESO_EN_PRUEBAS, como en el
 * menú: fuera de producción hasta que Diego lo apruebe (28/09).
 */

type Dia = 'hoy' | 'manana';

const DIAS: Array<{ clave: Dia; titulo: string; icono: typeof Sun }> = [
  { clave: 'hoy', titulo: 'Hoy', icono: Sun },
  { clave: 'manana', titulo: 'Mañana', icono: CalendarBlank },
];

/** Cuántas personas se enseñan aquí; las demás, en la cola con el día puesto. */
const CUANTAS = 8;

export default function LoQueTocaHoyYManana({ projectId, projectIds = null, onAbrir }: {
  projectId?: number | null;
  /** Los campus, separados por comas, cuando arriba hay una empresa. */
  projectIds?: string | null;
  /** Abre el panel del prospecto (el mismo que la lista). */
  onAbrir: (leadId: number) => void;
}) {
  const [resumen, setResumen] = useState<ResumenCola | null>(null);
  const [dia, setDia] = useState<Dia>('hoy');
  const [filas, setFilas] = useState<Record<Dia, PasoEnCola[] | null>>({ hoy: null, manana: null });

  useEffect(() => {
    let vivo = true;
    setFilas({ hoy: null, manana: null });
    traerResumen({ projectId, projectIds })
      .then((r) => { if (vivo) setResumen(r); })
      .catch(() => { if (vivo) setResumen(null); });
    for (const d of ['hoy', 'manana'] as Dia[]) {
      traerCola({ projectId, projectIds, tramo: d, limite: CUANTAS })
        .then((r) => { if (vivo) setFilas((f) => ({ ...f, [d]: r.filas })); })
        .catch(() => { if (vivo) setFilas((f) => ({ ...f, [d]: [] })); });
    }
    return () => { vivo = false; };
  }, [projectId, projectIds]);

  const cuantos = (d: Dia) => Number(resumen?.[d] ?? 0);
  const atrasados = Number(resumen?.atrasados ?? 0);
  const lista = filas[dia];

  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-3" aria-labelledby="lo-que-toca-titulo"
      data-recorrido="prospectos-lo-que-toca">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="lo-que-toca-titulo" className="font-semibold text-base">Lo que toca</h2>
          <p className="text-xs text-muted-foreground">Del proceso comercial: a quién hay que escribir o llamar cada día.</p>
        </div>
        {atrasados > 0 && (
          <Link to="/leads/cola?tramo=atrasados"
            className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning-soft-foreground hover:bg-warning-soft/70">
            <Warning size={13} weight="bold" /> {atrasados} atrasados
          </Link>
        )}
      </div>

      {/* Dos pestañas, cada una con su número: lo de hoy y lo de mañana, separados. */}
      <div className="inline-flex rounded-md border border-border overflow-hidden" role="tablist" aria-label="Lo que toca, por día">
        {DIAS.map(({ clave, titulo, icono: Icono }) => (
          <button key={clave} type="button" role="tab" id={`toca-${clave}`} aria-selected={dia === clave}
            aria-controls="toca-panel" onClick={() => setDia(clave)}
            className={'inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors '
              + (dia === clave ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            <Icono size={14} weight="bold" aria-hidden="true" />
            {titulo}
            <span className={'ml-0.5 rounded-full px-1.5 text-xs tabular-nums '
              + (dia === clave ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground')}
              data-numero={clave}>
              {resumen ? cuantos(clave) : '…'}
            </span>
          </button>
        ))}
      </div>

      <div id="toca-panel" role="tabpanel" aria-labelledby={`toca-${dia}`}>
        {lista === null ? (
          <p className="text-sm text-muted-foreground py-2">Cargando…</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {dia === 'hoy' ? 'Hoy no toca nadie.' : 'Mañana no toca nadie.'}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {lista.map((p) => (
              <li key={`${p.lead_id}-${p.paso_id ?? p.clave}`}>
                <button type="button" onClick={() => onAbrir(p.lead_id)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-medium">{p.lead_nombre || 'Sin nombre'}</span>
                  <span className="text-xs text-muted-foreground">{p.paso_nombre || p.clave}</span>
                  {p.producto && <span className="text-xs text-muted-foreground truncate max-w-[22ch]">{p.producto}</span>}
                  {p.gestora && <span className="ml-auto text-xs text-muted-foreground">{p.gestora}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {resumen && cuantos(dia) > (lista?.length ?? 0) && (
          <Link to={`/leads/cola?tramo=${dia}`}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Ver los {cuantos(dia)} de {dia === 'hoy' ? 'hoy' : 'mañana'} en la cola <ArrowRight size={12} weight="bold" />
          </Link>
        )}
      </div>

      {/* Los atajos de siempre a las tres pantallas del proceso (23/09: «con atajos y todo»). */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Link to="/leads/cola"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-normal font-semibold hover:bg-muted">
          <ListChecks size={14} weight="bold" className="text-primary" /> La cola del día
        </Link>
        {PROCESO_EN_PRUEBAS && (
        <Link to="/leads/seguimiento"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-normal font-semibold hover:bg-muted">
          <ArrowCounterClockwise size={14} weight="bold" className="text-primary" /> Seguimiento de fin de mes
        </Link>
        )}
        <Link to="/leads/proceso"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-normal font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
          <Gear size={14} weight="bold" /> Proceso comercial
        </Link>
      </div>
    </section>
  );
}
