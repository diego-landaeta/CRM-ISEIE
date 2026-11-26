import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowSquareOut, ArrowsClockwise, ChatCircleText, ClipboardText, Eye, ListChecks, MagnifyingGlass, Warning,
} from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import Iniciales from '@/shared/components/ui/Iniciales';
import { cn } from '@/shared/lib/utils';
import { casaPorTrozos } from '@/shared/lib/buscarPorTrozos';
import usePermission from '@/shared/hooks/usePermission';
import { SOLO_EN_PRUEBAS } from '@/shared/lib/enPruebas';
import { NivelCargaChip } from '@/modules/consultas/pages/MiCargaPage';
import type { NivelCarga } from '@/modules/consultas/api/consultas.api';
import {
  supervisionApi, type MiCampus, type TareaSupervisada, type TutorSupervisado,
} from '../api/tutores.api';
import { entregasPorCorregir } from './BandejaMiCampus';
import RedaccionEnMoodle from './RedaccionEnMoodle';

/*
  Supervisión de tutores (la dirección, 26/11/2026, para ISEIE): «un supervisor de tutores»
  que ve lo que hacen los demás tutores de sus campus. Una pestaña de «Mi campus» para
  quien tiene `tutores.supervisar`.

  SOLO LECTURA. Aquí no hay ningún botón que responda, corrija, mueva o asigne nada:
  eso sigue siendo de cada tutora (y lo corta el servidor, no solo la pantalla). Lo que
  se abre, se abre en Moodle, con la cuenta de Moodle de quien mira.

  A la izquierda, los tutores de sus campus con lo que tienen entre manos; a la
  derecha (debajo, en el móvil), el elegido: su «Mi campus», sus tareas y lo que
  redacta en Moodle. El elegido va en la dirección (`?tutor=`) para volver a él.
*/

const fecha = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const mensajeDe = (e: unknown, porDefecto: string) => {
  const x = e as { data?: { error?: string }; message?: string };
  return x?.data?.error || x?.message || porDefecto;
};

const chip = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium';
const enlace = 'inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-secundario font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Una cifra de la fila del tutor: con texto, nunca solo color. */
function Cifra({ n, uno, varios, aviso = false }: { n: number; uno: string; varios: string; aviso?: boolean }) {
  return (
    <span className={cn(chip, n > 0 && aviso
      ? 'bg-warning-soft text-warning-soft-foreground dark:bg-warning/15'
      : 'bg-muted text-muted-foreground')}>
      {plural(n, uno, varios)}
    </span>
  );
}

function FilaTutor({ t, elegido, elegir }: { t: TutorSupervisado; elegido: boolean; elegir: () => void }) {
  return (
    <li>
      <button type="button" onClick={elegir} aria-current={elegido ? 'true' : undefined}
        className={cn('flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          elegido ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted')}>
        <Iniciales nombre={t.nombre} />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-normal font-medium text-foreground">{t.nombre}</span>
            {t.es_redactora && <span className={cn(chip, 'bg-info-soft text-info-soft-foreground dark:bg-info/15')}>Redactora</span>}
            {!t.disponible && <span className={cn(chip, 'bg-muted text-muted-foreground')}>No disponible</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{t.campus.join(' · ') || 'Sin campus'}</span>
          <span className="flex flex-wrap gap-1">
            <Cifra n={t.consultas_abiertas} uno="consulta abierta" varios="consultas abiertas" aviso />
            <Cifra n={t.tareas_abiertas} uno="tarea" varios="tareas" />
            {t.por_desarrollar > 0 && <Cifra n={t.por_desarrollar} uno="por desarrollar" varios="por desarrollar" />}
          </span>
        </span>
      </button>
    </li>
  );
}

// ─── Su «Mi campus» ─────────────────────────────────────────────────────────

function SuCampus({ tutorId }: { tutorId: number }) {
  const [datos, setDatos] = useState<MiCampus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async (refrescar = false) => {
    setCargando(true);
    try {
      const r = await supervisionApi.miCampus(tutorId, refrescar);
      if (!r.success || !r.data || !Array.isArray(r.data.campus)) throw new Error('Respuesta sin campus');
      setDatos(r.data); setError(null);
    } catch (e) {
      setError(mensajeDe(e, 'No se ha podido leer su campus.'));
    } finally { setCargando(false); }
  }, [tutorId]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  const porCorregir = useMemo(() => entregasPorCorregir(datos), [datos]);
  const porResponder = useMemo(() => (datos?.campus || []).flatMap((c) => [
    ...c.cursos.flatMap((k) => k.dudas.map((d) => ({ clave: `d${d.consultaId}`, alumno: d.alumno, desde: d.desde, donde: `${k.nombre || 'Curso'} · ${c.campus}`, tipo: 'Consulta' }))),
    ...c.dudasSinCurso.map((d) => ({ clave: `d${d.consultaId}`, alumno: d.alumno, desde: d.desde, donde: c.campus, tipo: 'Consulta' })),
    ...c.cursos.flatMap((k) => (k.sinResponder || []).map((m) => ({ clave: `m${c.projectId}-${m.conversacionId}`, alumno: m.alumno, desde: m.desde, donde: `${k.nombre || 'Curso'} · ${c.campus}`, tipo: 'Mensaje de Moodle' }))),
    ...(c.sinResponderSinCurso || []).map((m) => ({ clave: `m${c.projectId}-${m.conversacionId}`, alumno: m.alumno, desde: m.desde, donde: c.campus, tipo: 'Mensaje de Moodle' })),
  ]), [datos]);

  if (error && !datos) {
    return (
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 dark:bg-destructive/15">
        <p className="text-normal font-semibold text-foreground">No se ha podido leer su campus</p>
        <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
        <Button size="sm" className="mt-3 h-8" onClick={() => cargar(true)}>Volver a intentarlo</Button>
      </div>
    );
  }
  if (!datos) return <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Leyendo su campus" />;

  const cursos = datos.campus.flatMap((c) => c.cursos.map((k) => ({ ...k, campus: c.campus, projectId: c.projectId })));
  return (
    <div className="space-y-4" aria-busy={cargando}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-secundario text-muted-foreground">
          Leído de Moodle a las {new Date(datos.leidoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <Button variant="outline" size="sm" disabled={cargando} onClick={() => cargar(true)} className="h-8 text-secundario">
          <ArrowsClockwise size={14} className={cn('mr-1.5', cargando && 'animate-spin')} aria-hidden />
          {cargando ? 'Leyendo…' : 'Actualizar'}
        </Button>
      </div>

      {(datos.sinConectar || []).length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
          Sin su cuenta de Moodle conectada en: {(datos.sinConectar || []).map((s) => s.campus).join(', ')}.
        </p>
      )}
      {datos.campus.filter((c) => c.error).map((c) => (
        <p key={c.projectId} role="alert" className="text-xs text-destructive">{c.campus}: {c.error}</p>
      ))}

      <section aria-labelledby={`resp-${tutorId}`} className="rounded-md border border-border">
        <h3 id={`resp-${tutorId}`} className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-normal font-semibold">
          <ChatCircleText size={15} aria-hidden /> Por responder <span className="text-muted-foreground">({porResponder.length})</span>
        </h3>
        {porResponder.length === 0
          ? <p className="px-3 py-3 text-secundario text-muted-foreground">Nada por responder: está al día.</p>
          : (
            <ul className="divide-y divide-border">
              {porResponder.map((x) => (
                <li key={x.clave} className="px-3 py-2">
                  <p className="text-normal font-medium">{x.alumno || 'Alumno'}</p>
                  <p className="text-xs text-muted-foreground">{x.tipo} · {x.donde} · desde el {fecha(x.desde)}</p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby={`corr-${tutorId}`} className="rounded-md border border-border">
        <h3 id={`corr-${tutorId}`} className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-normal font-semibold">
          <ClipboardText size={15} aria-hidden /> Por corregir <span className="text-muted-foreground">({porCorregir.length})</span>
        </h3>
        {porCorregir.length === 0
          ? <p className="px-3 py-3 text-secundario text-muted-foreground">Ninguna entrega sin nota.</p>
          : (
            <ul className="divide-y divide-border">
              {porCorregir.map((e) => (
                <li key={`${e.projectId}-${e.tareaId}-${e.alumnoId}`} className="px-3 py-2">
                  <p className="text-normal font-medium">{e.alumno || 'Alumno'} · {e.tarea || 'Tarea'}</p>
                  <p className="text-xs text-muted-foreground">{e.curso || 'Curso'} · {e.campus} · entregada el {fecha(e.entregadaAt)}</p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section aria-labelledby={`cursos-${tutorId}`} className="rounded-md border border-border">
        <h3 id={`cursos-${tutorId}`} className="border-b border-border px-3 py-2 text-normal font-semibold">
          Sus cursos en Moodle <span className="text-muted-foreground">({cursos.length})</span>
        </h3>
        {cursos.length === 0
          ? <p className="px-3 py-3 text-secundario text-muted-foreground">No tiene cursos en los campus que llevas.</p>
          : (
            <ul className="divide-y divide-border">
              {cursos.map((k) => (
                <li key={`${k.projectId}-${k.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-normal font-medium">{k.nombre || `Curso ${k.id}`}</span>
                    <span className="block text-xs text-muted-foreground">
                      {k.campus} · {plural(k.alumnos.length, 'alumno', 'alumnos')}
                      {' · '}{plural(k.tareas.reduce((s, t) => s + t.sinCorregir.length, 0), 'por corregir', 'por corregir')}
                    </span>
                  </span>
                  {k.url && (
                    <a href={k.url} target="_blank" rel="noopener noreferrer" className={enlace}>
                      Ver en Moodle <ArrowSquareOut size={12} aria-hidden /><span className="sr-only">(se abre en otra pestaña)</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {datos.pendientes.length > 0 && (
        <section aria-labelledby={`pend-${tutorId}`} className="rounded-md border border-border">
          <h3 id={`pend-${tutorId}`} className="border-b border-border px-3 py-2 text-normal font-semibold">
            Por desarrollar <span className="text-muted-foreground">({datos.pendientes.length})</span>
          </h3>
          <ul className="divide-y divide-border">
            {datos.pendientes.map((p) => (
              <li key={p.id} className="px-3 py-2">
                <p className="text-normal font-medium">{p.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {p.campus} · {p.estado.replace(/_/g, ' ')} · {p.fechaComprometida ? `para el ${fecha(p.fechaComprometida)}` : 'sin fecha'}
                  {' · '}{p.avance.modulos} % de módulos
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Sus tareas ─────────────────────────────────────────────────────────────

function SusTareas({ tutorId }: { tutorId: number }) {
  const { can } = usePermission();
  const veElTablero = can('tasks.view_all');
  const [tareas, setTareas] = useState<TareaSupervisada[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await supervisionApi.tareas(tutorId);
      if (!r.success || !Array.isArray(r.data)) throw new Error('Respuesta sin tareas');
      setTareas(r.data);
    } catch (e) { setError(mensajeDe(e, 'No se han podido leer sus tareas.')); }
  }, [tutorId]);
  useEffect(() => { setTareas(null); cargar(); }, [cargar]);

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 dark:bg-destructive/15">
        <p className="text-secundario text-foreground">{error}</p>
        <Button size="sm" className="mt-2 h-8" onClick={cargar}>Volver a intentarlo</Button>
      </div>
    );
  }
  if (!tareas) return <div className="h-32 animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Leyendo sus tareas" />;
  if (!tareas.length) {
    return <p className="rounded-md border border-dashed border-border px-3 py-4 text-secundario text-muted-foreground">No tiene tareas abiertas en el tablero de tutores ni en el de redactoras.</p>;
  }
  const hoy = new Date(new Date().toDateString()).getTime();
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {tareas.map((t) => {
        const vencida = t.estado !== 'hecha' && t.vence && new Date(t.vence).getTime() < hoy;
        return (
          <li key={t.id} className="space-y-1.5 px-3 py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-words text-normal font-medium">{t.titulo}</p>
              {veElTablero && (
                <Link to={`/tareas?id=${t.id}`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">Abrir en el tablero</Link>
              )}
            </div>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn(chip, t.estado === 'hecha' ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-foreground')}>{t.columna}</span>
              {t.prioridad === 'alta' && <span className={cn(chip, 'bg-warning-soft text-warning-soft-foreground')}>Prioridad alta</span>}
              {t.equipo && <span>{t.equipo}</span>}
              <span>· {t.vence ? <span className={vencida ? 'font-semibold text-destructive' : undefined}>{vencida ? 'venció' : 'vence'} el {fecha(t.vence)}</span> : 'sin fecha'}</span>
              <span>· {plural(t.comentarios, 'comentario', 'comentarios')}</span>
            </p>
            {t.ultimoComentario && (
              <blockquote className="border-l-2 border-border pl-2 text-xs text-muted-foreground">
                <span className="line-clamp-2 text-foreground">{t.ultimoComentario.texto}</span>
                <span>{t.ultimoComentario.autor || 'Alguien'} · {fecha(t.ultimoComentario.at)}</span>
              </blockquote>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── La pestaña ─────────────────────────────────────────────────────────────

type Seccion = 'campus' | 'tareas' | 'redaccion';

export default function SupervisionTutores() {
  const [params, setParams] = useSearchParams();
  const [tutores, setTutores] = useState<TutorSupervisado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [seccion, setSeccion] = useState<Seccion>('campus');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await supervisionApi.lista();
      if (!r.success || !Array.isArray(r.data?.tutores)) throw new Error('Respuesta sin tutores');
      setTutores(r.data.tutores);
    } catch (e) { setError(mensajeDe(e, 'No se ha podido leer la lista de tutores.')); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const elegidoId = Number(params.get('tutor')) || null;
  const elegido = tutores?.find((t) => t.id === elegidoId) || null;
  const elegir = (id: number | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('tutor', String(id)); else p.delete('tutor');
    setParams(p, { replace: true });
    setSeccion('campus');
  };
  const visibles = useMemo(() => (tutores || []).filter((t) => casaPorTrozos(buscar, t.nombre, t.email, t.campus.join(' '))), [tutores, buscar]);
  const secciones: Array<{ id: Seccion; label: string }> = [
    { id: 'campus', label: 'Su campus' },
    { id: 'tareas', label: 'Sus tareas' },
    ...(SOLO_EN_PRUEBAS && elegido?.es_redactora ? [{ id: 'redaccion' as Seccion, label: 'Lo que redacta' }] : []),
  ];

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-secundario text-muted-foreground">
        <Eye size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold text-foreground">Solo lectura.</strong> Lo que hacen los tutores de tus campus: su carga,
          lo que tienen por responder y por corregir, sus cursos y sus tareas. Responder y corregir sigue siendo de cada tutora.
        </span>
      </p>

      {error && !tutores && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-4 py-3 dark:bg-destructive/15">
          <p className="text-normal font-semibold text-foreground">No se ha podido leer la lista</p>
          <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
          <Button size="sm" className="mt-3 h-8" onClick={cargar}>Volver a intentarlo</Button>
        </div>
      )}
      {!tutores && !error && <div className="h-56 animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Leyendo los tutores" />}

      {tutores && tutores.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-secundario text-muted-foreground">
          No hay tutores en tus campus. Si tendría que haberlos, pide que te asignen el campus en tu usuario del CRM.
        </p>
      )}

      {tutores && tutores.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <section aria-label="Tutores de tus campus" className={cn('space-y-2', elegido && 'max-lg:hidden')}>
            {tutores.length > 6 && (
              <label className="relative block">
                <span className="sr-only">Buscar tutor</span>
                <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, correo o campus"
                  className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-3 text-normal text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
            )}
            <p className="text-xs text-muted-foreground">{plural(tutores.length, 'tutor', 'tutores')}</p>
            {visibles.length === 0 ? (
              <p className="text-secundario text-muted-foreground">
                Nadie con «{buscar}». <button type="button" className="font-medium text-primary hover:underline" onClick={() => setBuscar('')}>Quitar la búsqueda</button>
              </p>
            ) : (
              <ul className="space-y-1">
                {visibles.map((t) => <FilaTutor key={t.id} t={t} elegido={t.id === elegidoId} elegir={() => elegir(t.id)} />)}
              </ul>
            )}
          </section>

          <section aria-label={elegido ? `Lo que hace ${elegido.nombre}` : 'Tutor elegido'} className={cn('min-w-0', !elegido && 'max-lg:hidden')}>
            {!elegido ? (
              <div className="grid h-full min-h-40 place-items-center rounded-lg border border-dashed border-border px-4 text-center text-secundario text-muted-foreground">
                Elige un tutor para ver su campus y sus tareas.
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                <button type="button" onClick={() => elegir(null)}
                  className="inline-flex items-center gap-1 text-secundario font-medium text-primary hover:underline lg:hidden">
                  <ArrowLeft size={14} aria-hidden /> Todos los tutores
                </button>
                <div className="flex flex-wrap items-start gap-3">
                  <Iniciales nombre={elegido.nombre} tamano="md" />
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-semibold text-foreground">{elegido.nombre}</h2>
                    <p className="break-all text-xs text-muted-foreground">{elegido.email} · {elegido.campus.join(' · ')}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {[
                    ['Consultas abiertas', elegido.consultas_abiertas],
                    ['Alumnos activos', elegido.alumnos_activos],
                    ['Alumnos sin mensajes', elegido.alumnos_sin_mensajes],
                    ['Tareas abiertas', elegido.tareas_abiertas],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-md bg-muted/60 px-2.5 py-2">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-base font-semibold tabular-nums text-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Su carga:</span>
                  {elegido.carga ? (
                    <>
                      <NivelCargaChip nivel={elegido.carga.nivel as NivelCarga} />
                      {elegido.carga.texto && <span className="text-foreground">«{elegido.carga.texto}»</span>}
                      <span>· {fecha(elegido.carga.created_at)}{elegido.carga_desactualizada ? ' (desactualizada)' : ''}</span>
                    </>
                  ) : <span>no la ha dicho todavía</span>}
                  {!elegido.disponible && <span>· No disponible{elegido.motivo_no_disponible ? `: ${elegido.motivo_no_disponible}` : ''}</span>}
                </div>

                <div role="tablist" aria-label={`Lo que hace ${elegido.nombre}`} className="inline-flex max-w-full overflow-x-auto rounded-md bg-muted p-0.5">
                  {secciones.map((s) => (
                    <button key={s.id} type="button" role="tab" aria-selected={seccion === s.id} onClick={() => setSeccion(s.id)}
                      className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded px-3 text-secundario font-medium transition-colors',
                        seccion === s.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                      {s.id === 'tareas' && <ListChecks size={14} aria-hidden />}{s.label}
                    </button>
                  ))}
                </div>

                {seccion === 'campus' && <SuCampus key={`c-${elegido.id}`} tutorId={elegido.id} />}
                {seccion === 'tareas' && <SusTareas key={`t-${elegido.id}`} tutorId={elegido.id} />}
                {seccion === 'redaccion' && <RedaccionEnMoodle key={`r-${elegido.id}`} tutorId={elegido.id} supervision />}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
