import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, EyeSlash, X } from '@phosphor-icons/react';
import StatusDot from '@/shared/components/ui/StatusDot';
import { cn } from '@/shared/lib/utils';
import {
  moodleApi, type AlumnosDelCurso, type CursoMoodle, type EstructuraDelCurso, type RecursosDelCurso,
} from '../api/moodle.api';
import { ESTADO_DEL_CURSO, ESTADO_DEL_ENLACE, TIPO_DE_ACTIVIDAD, TIPO_DE_RECURSO, fecha } from '../lib/formato';

/**
 * El detalle de un curso, en un panel a la derecha: tres pestañas que se cargan cuando se
 * abren (cada una es una lectura a Moodle, no se piden las tres de golpe).
 *   · Alumnos: solo recuentos, nunca nombres ni correos.
 *   · Contenido: las secciones y las actividades de cada una.
 *   · Recursos externos: vídeos y enlaces de fuera, y si responden.
 */

type Pestana = 'alumnos' | 'contenido' | 'recursos';
const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: 'alumnos', etiqueta: 'Alumnos' },
  { clave: 'contenido', etiqueta: 'Contenido' },
  { clave: 'recursos', etiqueta: 'Recursos externos' },
];

interface Carga<T> { datos: T | null; cargando: boolean; error: string | null }
const vacia = <T,>(): Carga<T> => ({ datos: null, cargando: false, error: null });

function useLectura<T>(leer: () => Promise<{ data?: unknown }>) {
  const [estado, setEstado] = useState<Carga<T>>(vacia<T>());
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vigente = true;
    setEstado({ datos: null, cargando: true, error: null });
    leer().then((r) => { if (vigente) setEstado({ datos: r.data as T, cargando: false, error: null }); })
      .catch((e: Error) => { if (vigente) setEstado({ datos: null, cargando: false, error: e.message || 'No se pudo leer de Moodle' }); });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento]);
  return { ...estado, recargar: () => setIntento((n) => n + 1) };
}

function Cargando() {
  return <div className="space-y-2 animate-pulse" aria-busy="true"><div className="h-14 rounded bg-muted" /><div className="h-14 rounded bg-muted" /><div className="h-14 rounded bg-muted" /></div>;
}

function ErrorDeLectura({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      <p>{mensaje}</p>
      <button type="button" onClick={onReintentar} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline">
        <ArrowsClockwise size={13} weight="bold" /> Reintentar
      </button>
    </div>
  );
}

const cifra = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n);

function Dato({ etiqueta, valor, nota }: { etiqueta: string; valor: number | null | undefined; nota?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-2xl font-semibold tabular-nums">{cifra(valor)}</div>
      <div className="text-xs text-muted-foreground">{etiqueta}</div>
      {nota && <div className="mt-1 text-[11px] text-muted-foreground">{nota}</div>}
    </div>
  );
}

function PestanaAlumnos({ proyectoId, cursoId }: { proyectoId: number; cursoId: number }) {
  const { datos, cargando, error, recargar } = useLectura<AlumnosDelCurso>(() => moodleApi.alumnos(proyectoId, cursoId));
  if (cargando || (!datos && !error)) return <Cargando />;
  if (error) return <ErrorDeLectura mensaje={error} onReintentar={recargar} />;
  const activos = Object.entries(datos!).find(([k]) => /^activos_ultimos_\d+_dias$/.test(k));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Dato etiqueta="Matriculados" valor={datos!.matriculados} nota={datos!.otros_roles ? `+${datos!.otros_roles} con otro rol (profesores…)` : undefined} />
        <Dato etiqueta="Activos (últimos 30 días)" valor={activos?.[1] as number | null | undefined} />
        <Dato etiqueta="Suspendidos" valor={datos!.suspendidos} />
        <Dato etiqueta="Nunca han entrado" valor={datos!.nunca_han_entrado} />
        <Dato etiqueta="Han terminado" valor={datos!.terminados} nota={datos!.terminados === null ? 'Sin dato (ver el aviso de abajo)' : undefined} />
      </div>
      {!!datos!.avisos?.length && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {datos!.avisos!.map((a) => <li key={a}>· {a}</li>)}
        </ul>
      )}
    </div>
  );
}

function PestanaContenido({ proyectoId, cursoId }: { proyectoId: number; cursoId: number }) {
  const { datos, cargando, error, recargar } = useLectura<EstructuraDelCurso>(() => moodleApi.estructura(proyectoId, cursoId));
  if (cargando || (!datos && !error)) return <Cargando />;
  if (error) return <ErrorDeLectura mensaje={error} onReintentar={recargar} />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {datos!.total_secciones} secciones · {datos!.total_actividades} actividades
        {Object.keys(datos!.por_tipo).length > 0 && ` (${Object.entries(datos!.por_tipo).map(([t, n]) => `${n} ${(TIPO_DE_ACTIVIDAD[t] ?? t).toLowerCase()}`).join(', ')})`}
      </p>
      <div className="space-y-1.5">
        {datos!.secciones.map((s) => (
          <details key={s.numero} className="rounded-lg border border-border" open={s.numero === 0 && s.total_actividades > 0}>
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
              <span className="flex items-center gap-1.5">
                {s.nombre}
                {!s.visible && <EyeSlash size={14} className="text-muted-foreground" aria-label="Sección oculta" />}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{s.total_actividades}</span>
            </summary>
            {s.actividades.length > 0 && (
              <ul className="divide-y divide-border border-t border-border">
                {s.actividades.map((a, i) => (
                  <li key={`${a.nombre}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                    <span className={cn('truncate', !a.visible && 'text-muted-foreground')}>{a.nombre || '(sin nombre)'}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {!a.visible && <EyeSlash size={13} aria-label="Oculta" />}
                      {TIPO_DE_ACTIVIDAD[a.tipo] ?? a.tipo}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

function PestanaRecursos({ proyectoId, cursoId }: { proyectoId: number; cursoId: number }) {
  const [comprobar, setComprobar] = useState(false);
  const { datos, cargando, error, recargar } = useLectura<RecursosDelCurso>(() => moodleApi.recursos(proyectoId, cursoId, comprobar));
  if (cargando || (!datos && !error)) {
    return <><Cargando />{comprobar && <p className="mt-2 text-xs text-muted-foreground">Comprobando los enlaces…</p>}</>;
  }
  if (error) return <ErrorDeLectura mensaje={error} onReintentar={recargar} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {datos!.total_recursos_externos === 0
            ? 'Este curso no tiene recursos externos.'
            : `${datos!.total_recursos_externos} recursos externos (${Object.entries(datos!.por_tipo).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${TIPO_DE_RECURSO[t] ?? t}`).join(', ')})`}
        </p>
        {datos!.total_recursos_externos > 0 && !comprobar && (
          <button type="button" onClick={() => { setComprobar(true); recargar(); }} className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted">
            Comprobar si responden
          </button>
        )}
        {comprobar && datos!.enlaces_rotos !== undefined && (
          <span className="text-xs font-medium">{datos!.enlaces_rotos === 0 ? 'Ninguno roto' : `${datos!.enlaces_rotos} rotos`}</span>
        )}
      </div>
      {datos!.recursos.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {datos!.recursos.map((r, i) => {
            const e = r.estado ? ESTADO_DEL_ENLACE[r.estado] : null;
            return (
              <li key={`${r.url}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.nombre || TIPO_DE_RECURSO[r.tipo]}</div>
                  <div className="truncate text-xs text-muted-foreground">{TIPO_DE_RECURSO[r.tipo]} · {r.seccion}</div>
                </div>
                {e && <StatusDot tono={e.tono} className="shrink-0 pt-0.5">{e.etiqueta}</StatusDot>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function DetalleCurso({ curso, proyectoId, onCerrar }: { curso: CursoMoodle; proyectoId: number; onCerrar: () => void }) {
  const [pestana, setPestana] = useState<Pestana>('alumnos');
  // Cada pestaña se lee la primera vez que se abre; al volver a ella no se pide otra vez.
  const [visitadas, setVisitadas] = useState<Set<Pestana>>(new Set(['alumnos']));
  const abrir = (p: Pestana) => { setPestana(p); setVisitadas((v) => new Set(v).add(p)); };
  const e = ESTADO_DEL_CURSO[curso.estado];

  const cerrarConEsc = useCallback((ev: KeyboardEvent) => { if (ev.key === 'Escape') onCerrar(); }, [onCerrar]);
  useEffect(() => {
    document.addEventListener('keydown', cerrarConEsc);
    return () => document.removeEventListener('keydown', cerrarConEsc);
  }, [cerrarConEsc]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="detalle-curso">
      <button type="button" aria-label="Cerrar el detalle" onClick={onCerrar} className="absolute inset-0 bg-black/30" />
      <aside role="dialog" aria-modal="true" aria-label={curso.nombre.trim()} className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug">{curso.nombre.trim()}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <StatusDot tono={e.tono}>{e.etiqueta}</StatusDot>
              {curso.categoria && <span>{curso.categoria}</span>}
              <span>{fecha(curso.inicio)} → {fecha(curso.fin)}</span>
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded p-1.5 hover:bg-muted"><X size={18} /></button>
        </header>

        <div role="tablist" aria-label="Detalle del curso" className="flex gap-1 border-b border-border px-3">
          {PESTANAS.map((p) => (
            <button
              key={p.clave}
              type="button"
              role="tab"
              aria-selected={pestana === p.clave}
              onClick={() => abrir(p.clave)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium focus:outline-none focus-visible:bg-muted',
                pestana === p.clave ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4" role="tabpanel">
          {visitadas.has('alumnos') && <div hidden={pestana !== 'alumnos'}><PestanaAlumnos proyectoId={proyectoId} cursoId={curso.curso_id} /></div>}
          {visitadas.has('contenido') && <div hidden={pestana !== 'contenido'}><PestanaContenido proyectoId={proyectoId} cursoId={curso.curso_id} /></div>}
          {visitadas.has('recursos') && <div hidden={pestana !== 'recursos'}><PestanaRecursos proyectoId={proyectoId} cursoId={curso.curso_id} /></div>}
        </div>
      </aside>
    </div>
  );
}
