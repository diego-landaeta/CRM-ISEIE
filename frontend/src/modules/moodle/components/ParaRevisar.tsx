import { useEffect, useState } from 'react';
import { CaretDown, CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import { moodleApi, type CursoMoodle, type CursoParaRevisar, type RevisionCampus } from '../api/moodle.api';

/**
 * «Para revisar»: los cursos activos de un campus que conviene mirar, sin abrirlos uno a uno.
 *
 *   · sin alumnos: nadie matriculado;
 *   · dormidos: tienen alumnos y ninguno ha entrado en 30 días;
 *   · con alumnos que nunca han entrado: hay actividad, pero a algunos no se les ha visto nunca.
 *
 * Es una sola línea. Mientras se revisa dice cuántos lleva; si no hay nada que mirar, lo dice
 * en pequeño; y si hay algo, son tres cifras que se abren para ver qué cursos son.
 * Revisar un campus es una lectura por curso, así que se hace por tandas: se vuelve a pedir
 * mientras queden cursos pendientes (el servidor guarda lo ya leído).
 */

type Caso = 'sin_alumnos' | 'dormidos' | 'con_nunca_entraron';

const CASOS: { clave: Caso; etiqueta: (n: number) => string; ayuda: string; punto: string; detalle: (c: CursoParaRevisar) => string }[] = [
  {
    clave: 'sin_alumnos',
    etiqueta: (n) => `${n} sin alumnos`,
    ayuda: 'Cursos activos en los que no hay nadie matriculado',
    punto: 'bg-warning',
    detalle: () => 'Nadie matriculado',
  },
  {
    clave: 'dormidos',
    etiqueta: (n) => `${n} ${n === 1 ? 'dormido' : 'dormidos'}`,
    ayuda: 'Tienen alumnos, pero ninguno ha entrado al curso en los últimos 30 días',
    punto: 'bg-info',
    detalle: (c) => `${c.alumnos} ${c.alumnos === 1 ? 'alumno' : 'alumnos'}, ninguno ha entrado en 30 días`,
  },
  {
    clave: 'con_nunca_entraron',
    etiqueta: (n) => `${n} con alumnos que no han entrado nunca`,
    ayuda: 'Hay actividad en el curso, pero a algún alumno no se le ha visto entrar jamás',
    punto: 'bg-muted-foreground/60',
    detalle: (c) => `${c.nunca_han_entrado} de ${c.alumnos} no han entrado nunca`,
  },
];

const VISIBLES = 8;
const MAX_TANDAS = 80;
const esperar = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

export default function ParaRevisar({ proyectoId, version, onVer }: {
  proyectoId: number;
  /** Cambia cuando se pulsa «Actualizar»: vuelve a revisar desde cero. */
  version: number;
  onVer: (curso: CursoMoodle) => void;
}) {
  const [datos, setDatos] = useState<RevisionCampus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Caso | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null); setAbierto(null);
    (async () => {
      try {
        for (let tanda = 0; tanda < MAX_TANDAS; tanda += 1) {
          const r = await moodleApi.revision(proyectoId, version > 0 && tanda === 0);
          if (!vivo) return;
          const d = r.data as RevisionCampus;
          setDatos(d);
          if (d.pendientes === 0) return;
          // Si su Moodle va justo de carga, se le deja respirar en vez de insistir.
          if (d.saturado) await esperar(Math.min(45, Math.max(2, d.espera_s)) * 1000 + 500);
          if (!vivo) return;
        }
      } catch (e) {
        if (vivo) setError((e as Error).message || 'No se pudo revisar');
      }
    })();
    return () => { vivo = false; };
  }, [proyectoId, version]);

  const caja = 'rounded-lg border border-border bg-card px-4 py-3 text-sm';

  if (error) return <p className={cn(caja, 'text-muted-foreground')} data-testid="para-revisar">No se pudo revisar el campus ahora: {error}</p>;
  if (!datos) return <p className={cn(caja, 'text-muted-foreground')} data-testid="para-revisar" aria-busy="true">Revisando los cursos del campus…</p>;

  const revisando = datos.pendientes > 0;
  const total = CASOS.reduce((n, c) => n + datos.hallazgos[c.clave].length, 0);
  const hechos = datos.revisados + datos.no_leidos;

  return (
    <div className={caja} data-testid="para-revisar">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-semibold">Para revisar</span>

        {revisando && (
          <span className="flex min-w-[14rem] flex-1 items-center gap-3 text-xs text-muted-foreground" aria-live="polite">
            <span className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((hechos / datos.total) * 100)}%` }} />
            </span>
            {datos.saturado
              ? `Su Moodle va justo de carga: espero un momento para no cargarlo… (${hechos} de ${datos.total} cursos)`
              : `Revisando… ${hechos} de ${datos.total} cursos`}
          </span>
        )}

        {!revisando && total === 0 && (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle size={16} weight="fill" className="text-success" /> Todo en orden: {datos.revisados} cursos activos revisados
          </span>
        )}

        {total > 0 && CASOS.map((c) => {
          const n = datos.hallazgos[c.clave].length;
          if (!n) return null;
          const activo = abierto === c.clave;
          return (
            <button
              key={c.clave}
              type="button"
              title={c.ayuda}
              aria-expanded={activo}
              onClick={() => setAbierto(activo ? null : c.clave)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                activo ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              )}
            >
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', c.punto)} />
              {c.etiqueta(n)}
              <CaretDown size={12} weight="bold" className={cn('transition-transform', activo && 'rotate-180')} />
            </button>
          );
        })}

        {!revisando && datos.no_leidos > 0 && (
          <span className="text-xs text-muted-foreground" title="Moodle no dejó leer su lista de alumnos">
            {datos.no_leidos} {datos.no_leidos === 1 ? 'curso no se pudo leer' : 'cursos no se pudieron leer'}
          </span>
        )}
      </div>

      {abierto && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border" data-testid="lista-para-revisar">
          {datos.hallazgos[abierto].slice(0, VISIBLES).map((c) => {
            const caso = CASOS.find((x) => x.clave === abierto)!;
            return (
              <li key={c.curso_id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nombre.trim()}</p>
                  <p className="text-xs text-muted-foreground">{caso.detalle(c)}</p>
                </div>
                <button type="button" onClick={() => onVer(c)} className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted">Ver</button>
              </li>
            );
          })}
          {datos.hallazgos[abierto].length > VISIBLES && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Y {datos.hallazgos[abierto].length - VISIBLES} más: búscalos en la tabla.</li>
          )}
        </ul>
      )}
    </div>
  );
}
