import {
  ArrowSquareOut, ArrowsClockwise, CheckCircle, Clock, GraduationCap, Warning,
} from '@phosphor-icons/react';
import { formatDate } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import EmptyState from '@/shared/components/ui/EmptyState';
import { EtiquetaEnPruebas } from '@/shared/components/ui/EnPruebas';
import ProgresoCurso from '@/modules/moodle/components/ProgresoCurso';
import type { AvanceMoodle, CampusDelAlumno, CursoDelAlumno } from '../api/avanceMoodle.api';

/*
  El avance del alumno en Moodle, en su ficha (#532): por campus y curso, su último
  acceso, el % hecho, las notas y el estado. Para saber cómo va sin entrar en el campus.

  Los datos llegan de `useAvanceMoodle` (la ficha los pide al abrirse). Cada curso es una
  fila con separadores finos, no una tarjeta dentro de otra; el color va solo en el estado,
  y siempre con su texto al lado.
*/

function haceCuanto(iso: string | null) {
  if (!iso) return 'Nunca ha entrado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return `Hace ${dias} días`;
}

function Estado({ curso }: { curso: CursoDelAlumno }) {
  if (curso.estado === 'terminado') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-soft-foreground">
        <CheckCircle size={11} weight="fill" aria-hidden /> Terminado
      </span>
    );
  }
  if (curso.estado === 'sin_acceso') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-soft-foreground">
        <Clock size={11} weight="bold" aria-hidden />
        {curso.diasSinAcceso === null ? 'Nunca ha entrado' : `Sin acceso desde hace ${curso.diasSinAcceso} días`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info-soft-foreground">
      Activo
    </span>
  );
}

function Notas({ curso }: { curso: CursoDelAlumno }) {
  if (curso.errorNotas) return <p className="text-xs text-muted-foreground">Notas: {curso.errorNotas}</p>;
  const n = curso.notas;
  if (!n) return null;
  if (!n.final && n.actividades.length === 0) return <p className="text-xs text-muted-foreground">Aún sin notas.</p>;
  return (
    <div className="space-y-1 text-xs">
      {n.final && (
        <p>
          <span className="text-muted-foreground">Nota final: </span>
          <span className="font-semibold tabular-nums text-foreground">{n.final.texto ?? n.final.nota}</span>
          {n.final.maxima !== null && <span className="text-muted-foreground tabular-nums"> / {n.final.maxima}</span>}
        </p>
      )}
      {n.actividades.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer rounded text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            Notas por actividad ({n.actividades.length})
          </summary>
          <ul className="mt-1.5 divide-y divide-border/60 rounded-md border border-border">
            {n.actividades.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                <span className="min-w-0 break-words text-foreground">{a.nombre || 'Actividad sin nombre'}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold text-foreground">{a.texto ?? a.nota}</span>
                  {a.maxima !== null && <span className="text-muted-foreground"> / {a.maxima}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FilaCurso({ curso }: { curso: CursoDelAlumno }) {
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <a href={curso.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 break-words text-sm font-semibold text-foreground hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
          {curso.nombre || `Curso ${curso.id}`}
          <ArrowSquareOut size={12} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">(abre el curso en Moodle)</span>
        </a>
        <Estado curso={curso} />
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Matriculado</dt>
          <dd className="text-foreground">{curso.matriculadoEl ? formatDate(curso.matriculadoEl) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Último acceso</dt>
          <dd className="text-foreground" title={curso.ultimoAcceso ? new Date(curso.ultimoAcceso).toLocaleString('es-ES') : undefined}>
            {haceCuanto(curso.ultimoAcceso)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Hecho</dt>
          <dd>
            {curso.progreso === null
              ? <span className="text-muted-foreground" title="El curso no tiene activada la finalización de actividades en Moodle">Sin seguimiento</span>
              : <ProgresoCurso valor={curso.progreso} motivo="" />}
          </dd>
        </div>
      </dl>
      <Notas curso={curso} />
    </li>
  );
}

function BloqueCampus({ c }: { c: CampusDelAlumno }) {
  return (
    <section aria-label={`Campus ${c.campus}`} className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-foreground">{c.campus}</h4>
        {c.alumno && (
          <p className="text-xs text-muted-foreground">
            En el campus: {haceCuanto(c.alumno.ultimoAcceso).toLowerCase()}
            {' · '}
            <a href={c.alumno.perfilUrl} target="_blank" rel="noopener noreferrer"
              className="text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
              Perfil en Moodle
            </a>
          </p>
        )}
      </div>
      {c.alumno?.suspendido && (
        <p className="text-xs font-medium text-warning">Su cuenta del campus está suspendida.</p>
      )}
      {c.error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Warning size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          {c.error}
        </p>
      ) : c.cursos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No está matriculado en ningún curso de este campus.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {c.cursos.map((k) => <FilaCurso key={k.id} curso={k} />)}
        </ul>
      )}
      {c.avisoNotas && <p className="text-[11px] text-muted-foreground">{c.avisoNotas}</p>}
    </section>
  );
}

export default function AvanceMoodleBloque({
  datos, cargando, error, onActualizar,
}: { datos: AvanceMoodle | null; cargando: boolean; error: string | null; onActualizar: () => void }) {
  const cabecera = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Lo que dice Moodle de este alumno
          {datos?.diasSinAccesoMaximos ? ` · «sin acceso» a partir de ${datos.diasSinAccesoMaximos} días` : ''}
        </p>
        <EtiquetaEnPruebas />
      </div>
      <button type="button" onClick={onActualizar} disabled={cargando}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <ArrowsClockwise size={13} className={cn(cargando && 'animate-spin')} aria-hidden />
        {cargando ? 'Leyendo…' : 'Actualizar'}
      </button>
    </div>
  );

  if (cargando && !datos) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        {cabecera}
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <span className="sr-only">Leyendo el campus…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        {cabecera}
        <p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Warning size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          No se ha podido leer el campus: {error}
        </p>
      </div>
    );
  }
  if (!datos || datos.campus.length === 0) {
    return (
      <div className="space-y-3">
        {cabecera}
        <EmptyState
          icon={GraduationCap}
          title="Sin campus conectado"
          description="Ni el campus de este cliente ni los de sus compras tienen Moodle conectado (o no son campus tuyos)."
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {cabecera}
      {datos.campus.map((c) => <BloqueCampus key={c.projectId} c={c} />)}
    </div>
  );
}
