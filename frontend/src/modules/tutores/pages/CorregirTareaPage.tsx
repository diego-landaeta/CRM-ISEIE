import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowSquareOut, CaretLeft, CaretRight, CheckCircle, FileText, Warning,
} from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import Iniciales from '@/shared/components/ui/Iniciales';
import { toast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/lib/utils';
import { EtiquetaEnPruebas } from '@/shared/components/ui/EnPruebas';
import { usePluginMoodle } from '@/shared/lib/pluginMoodle';
import { tutoresApi, TIPOS_EN_LINEA, type EntregaDeTarea, type EstadoEntrega, type TareaParaCorregir } from '../api/tutores.api';

/*
  Corregir una tarea desde el CRM (#408, gemela de CRM#681), como las herramientas de corrección de
  siempre: a la izquierda los alumnos, en el centro lo que ha entregado el elegido y a
  la derecha la calificación, siempre a la vista junto a la entrega. Al guardar, la nota
  queda en Moodle a nombre de la tutora (plugin local_crm) y el alumno la ve en su campus.

  Poner la nota ESCRIBE en Moodle: va detrás del plugin del CRM (`usePluginMoodle`: en
  /staging y en local, y en producción con PLUGIN_MOODLE_EN_PRODUCCION=1 en el servidor). Apagado, se ven las entregas pero no hay formulario de nota: queda el
  enlace para corregir en Moodle (en el servidor, la ruta de calificar ni se monta).
*/

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const tamano = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const numero = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 2 });

type Filtro = 'sin_corregir' | 'calificada' | 'todas';
const FILTROS: Array<{ id: Filtro; texto: string }> = [
  { id: 'sin_corregir', texto: 'Pendientes' },
  { id: 'calificada', texto: 'Calificadas' },
  { id: 'todas', texto: 'Todos' },
];
const ORDEN: Record<EstadoEntrega, number> = { sin_corregir: 0, calificada: 1, sin_entregar: 2 };

/** La calificación de un alumno: la nota, «Por corregir» o «Sin entregar». `corto` = para la lista. */
function EstadoFila({ e, max, corto = false }: { e: EntregaDeTarea; max: number; corto?: boolean }) {
  if (e.estado === 'calificada') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-secundario font-medium tabular-nums text-success', corto && 'rounded bg-success-soft dark:bg-success/15 px-1.5 py-0.5 text-success-soft-foreground')}>
        {!corto && <CheckCircle size={12} weight="fill" aria-hidden />}
        {e.nota != null ? `${numero(e.nota)}${max ? ` / ${numero(max)}` : ''}` : 'Calificada'}
      </span>
    );
  }
  if (e.estado === 'sin_corregir') {
    return <span className={cn('text-secundario font-medium text-warning', corto && 'rounded bg-warning-soft dark:bg-warning/15 px-1.5 py-0.5 text-warning-soft-foreground')}>Por corregir</span>;
  }
  return <span className="text-secundario text-muted-foreground">{corto ? 'Sin entregar' : 'Todavía no ha entregado'}</span>;
}

/** ¿Cabe la calificación a la derecha? (las tres columnas, desde 1440 px) */
function useAncha() {
  const consulta = '(min-width: 1440px)';
  const [ancha, setAncha] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const cambio = () => setAncha(m.matches);
    m.addEventListener('change', cambio);
    return () => m.removeEventListener('change', cambio);
  }, []);
  return ancha;
}

export default function CorregirTareaPage() {
  const pluginMoodle = usePluginMoodle();
  const ancha = useAncha();
  const params = useParams();
  const projectId = Number(params.projectId);
  const cursoId = Number(params.cursoId);
  const tareaId = Number(params.tareaId);
  // ?alumno=: la entrega que se ha pulsado en «Mi campus» (Por corregir), abierta de entrada.
  const [busqueda] = useSearchParams();
  const alumnoPedido = Number(busqueda.get('alumno')) || null;
  const [datos, setDatos] = useState<TareaParaCorregir | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('sin_corregir');
  const [elegido, setElegido] = useState<number | null>(null);
  const [vista, setVista] = useState<'entrega' | 'enunciado'>('entrega');
  const [nota, setNota] = useState('');
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await tutoresApi.verTarea(projectId, cursoId, tareaId);
      if (r.success && r.data) {
        setDatos(r.data); setError(null);
        const pendientes = r.data.entregas.filter((e) => e.estado === 'sin_corregir');
        const pedida = alumnoPedido ? r.data.entregas.find((e) => e.alumnoId === alumnoPedido) : null;
        setElegido((actual) => actual ?? pedida?.alumnoId ?? (pendientes[0] || r.data.entregas[0])?.alumnoId ?? null);
        setFiltro((f) => (f === 'sin_corregir' && (pendientes.length === 0 || (pedida && pedida.estado !== 'sin_corregir')) ? 'todas' : f));
      }
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      setError(err?.data?.error || err?.message || 'No se ha podido abrir la tarea.');
    }
  }, [projectId, cursoId, tareaId, alumnoPedido]);
  useEffect(() => { cargar(); }, [cargar]);

  const todas = useMemo(() => [...(datos?.entregas || [])].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]
    || String(a.alumno || '').localeCompare(String(b.alumno || ''), 'es')), [datos]);
  const lista = useMemo(() => todas.filter((e) => filtro === 'todas' || e.estado === filtro), [todas, filtro]);
  const cuenta = (id: Filtro) => todas.filter((e) => id === 'todas' || e.estado === id).length;
  const actual = todas.find((e) => e.alumnoId === elegido) || null;
  const max = datos?.tarea.notaMax || 0;
  const admiteComentario = datos?.tarea.comentarios !== false;
  // Lo que no se corrige desde aquí: sin el plugin aprobado, nada; con él, ni escala o sin
  // nota, ni entregas en grupo.
  const soloEnMoodle = datos && (!pluginMoodle
    ? 'Poner la nota desde el CRM todavía no está disponible aquí. Corrígela en el campus.'
    : datos.tarea.enGrupo
      ? 'Es una tarea en grupo: Moodle guarda la entrega a nombre del grupo. Corrígela en el campus.'
      : !datos.tarea.calificable ? 'Esta tarea se califica con escala o sin nota numérica. Corrígela en el campus.' : null);

  // Al cambiar de alumno: su nota si ya la tiene (para revisarla), la entrega a la vista.
  useEffect(() => { setNota(actual?.nota != null ? String(actual.nota) : ''); setComentario(''); setVista('entrega'); }, [actual?.alumnoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const indice = todas.findIndex((e) => e.alumnoId === elegido);
  const ir = (paso: number) => { const e = todas[indice + paso]; if (e) setElegido(e.alumnoId); };

  async function guardar(siguiente: boolean) {
    if (!actual) return;
    const n = Number(String(nota).replace(',', '.'));
    if (nota.trim() === '' || !Number.isFinite(n) || n < 0 || (max > 0 && n > max)) {
      toast({ title: 'Revisa la nota', description: max > 0 ? `Tiene que estar entre 0 y ${numero(max)}.` : 'Tiene que ser un número.', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = await tutoresApi.calificar(projectId, cursoId, tareaId, { alumnoId: actual.alumnoId, nota: n, comentario: comentario.trim() });
      toast({ title: 'Nota guardada', description: `${actual.alumno}: ${numero(n)}${max ? ` / ${numero(max)}` : ''}. Ya la ve en el campus.` });
      if (comentario.trim() && !r.data?.comentario) {
        toast({ title: 'El comentario no se ha guardado', description: 'Esta tarea tiene desactivados los comentarios en Moodle. La nota sí está puesta.', variant: 'destructive' });
      }
      const otro = todas.find((e) => e.estado === 'sin_corregir' && e.alumnoId !== actual.alumnoId);
      await cargar();
      if (siguiente && otro) setElegido(otro.alumnoId);
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha podido guardar la nota', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-3 py-6">
        <Link to="/mis-cursos/campus" className="inline-flex items-center gap-1 text-normal font-medium text-primary hover:underline"><ArrowLeft size={14} aria-hidden /> Mi campus</Link>
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft dark:bg-destructive/15 p-4">
          <p className="text-normal font-semibold text-foreground">No se ha podido abrir la tarea</p>
          <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const campoNota = (alto: string) => (
    <div className={cn('flex items-center rounded-md border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20', alto)}>
      <input id="nota" inputMode="decimal" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="—"
        className="h-full min-w-0 flex-1 rounded-md bg-transparent px-3 text-seccion font-semibold tabular-nums text-foreground focus:outline-none" />
      {max > 0 && <span className="pr-3 text-normal text-muted-foreground">/ {numero(max)}</span>}
    </div>
  );
  const campoComentario = (filas: number) => (
    <textarea id="comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} rows={filas}
      disabled={!admiteComentario}
      placeholder={admiteComentario ? (actual?.estado === 'calificada' ? 'Si lo dejas vacío, se conserva el comentario que ya tenía.' : 'Opcional. Lo ve junto a la nota en el campus.') : 'Esta tarea tiene desactivados los comentarios en Moodle: solo se guarda la nota.'}
      className="block w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-normal leading-6 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/50" />
  );
  const yaTieneNota = actual?.estado === 'calificada' && (
    <p className="flex items-center gap-1 text-secundario text-muted-foreground"><Warning size={12} aria-hidden /> Ya tiene nota: si guardas, la cambias.</p>
  );

  /** La calificación en columna: a la derecha, en pantallas anchas. */
  const enMoodle = soloEnMoodle && (
    <div role="note" className="m-4 space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <p className="flex items-start gap-2 text-secundario text-foreground"><Warning size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden /> {soloEnMoodle}</p>
      <a href={datos?.tarea.moodleUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-normal font-medium text-foreground hover:bg-muted">
        Corregir en Moodle <ArrowSquareOut size={13} aria-hidden />
      </a>
    </div>
  );

  const calificacionLateral = actual && (
    <form onSubmit={(e) => { e.preventDefault(); guardar(true); }} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 p-4">
        <div>
          <p className="text-tabla uppercase text-muted-foreground">Estado</p>
          <p className="mt-1"><EstadoFila e={actual} max={max} /></p>
          {actual.entregadaAt && <p className="text-secundario text-muted-foreground">Entregada el {fecha(actual.entregadaAt)}</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="nota" className="text-tabla uppercase text-muted-foreground">Nota</label>
          {campoNota('h-12')}
          {yaTieneNota}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="comentario" className="text-tabla uppercase text-muted-foreground">Comentario para el alumno</label>
          {campoComentario(7)}
        </div>
      </div>
      <div className="space-y-2 border-t border-border p-4">
        <Button type="submit" className="h-9 w-full" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y siguiente'}</Button>
        <Button type="button" variant="outline" className="h-9 w-full" disabled={guardando} onClick={() => guardar(false)}>Guardar</Button>
      </div>
    </form>
  );

  /** La calificación en franja: debajo de la entrega, en pantallas medianas y pequeñas. */
  const calificacionFranja = actual && (
    <form onSubmit={(e) => { e.preventDefault(); guardar(true); }} className="space-y-2 bg-muted/20 px-4 py-3 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <label htmlFor="nota" className="text-tabla uppercase text-muted-foreground">Nota</label>
          {campoNota('h-10')}
        </div>
        <div className="space-y-1">
          <label htmlFor="comentario" className="text-tabla uppercase text-muted-foreground">Comentario para el alumno</label>
          {campoComentario(2)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {yaTieneNota}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={guardando} onClick={() => guardar(false)}>Guardar</Button>
          <Button type="submit" size="sm" className="h-9" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y siguiente'}</Button>
        </div>
      </div>
    </form>
  );

  return (
    <div className="-mx-2 flex min-h-[36rem] flex-col sm:mx-0 lg:h-[calc(100dvh-7.5rem)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        {/* La tarea, a todo lo ancho */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Link to="/mis-cursos/campus" aria-label="Volver a Mi campus" title="Volver a Mi campus"
            className="-ml-1 inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft size={16} aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-normal font-semibold text-foreground">{datos?.tarea.nombre || 'Tarea'}</h1>
              <EtiquetaEnPruebas className="hidden sm:inline-flex" />
            </div>
            <p className="truncate text-secundario text-muted-foreground">
              {datos ? `${cuenta('sin_corregir')} por corregir · ${cuenta('calificada')} calificadas · ${todas.length} alumnos${max ? ` · nota sobre ${numero(max)}` : ''}` : 'Cargando…'}
            </p>
          </div>
          {datos && (
            <a href={datos.tarea.moodleUrl} target="_blank" rel="noopener noreferrer" title="Abrir la tarea en Moodle"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-secundario font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <span className="hidden sm:inline">Abrir en Moodle</span><span className="sr-only sm:hidden">Abrir la tarea en Moodle</span>
              <ArrowSquareOut size={14} aria-hidden />
            </a>
          )}
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)] min-[1440px]:grid-cols-[19rem_minmax(0,1fr)_21rem]">
          {/* Los alumnos */}
          <nav aria-label="Alumnos" className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="shrink-0 border-b border-border p-2">
              <div className="grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5" role="tablist" aria-label="Filtrar alumnos">
                {FILTROS.map((f) => (
                  <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)}
                    className={cn('flex h-7 items-center justify-center gap-1 rounded px-1 text-secundario font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      filtro === f.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                    <span className="truncate">{f.texto}</span>
                    <span className="tabular-nums opacity-70">{datos ? cuenta(f.id) : ''}</span>
                  </button>
                ))}
              </div>
            </div>
            <ul className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1 lg:max-h-none">
              {!datos && [0, 1, 2].map((i) => <li key={i} className="flex gap-3 px-3 py-2.5"><span className="h-8 w-8 animate-pulse rounded-full bg-muted" /><span className="h-8 flex-1 animate-pulse rounded bg-muted" /></li>)}
              {datos && lista.length === 0 && (
                <li className="px-4 py-8 text-center">
                  {filtro === 'sin_corregir' && <CheckCircle size={20} weight="duotone" className="mx-auto mb-1.5 text-success" aria-hidden />}
                  <p className="text-secundario text-muted-foreground">{filtro === 'sin_corregir' ? 'No queda nada por corregir.' : 'Nadie en este filtro.'}</p>
                </li>
              )}
              {lista.map((e) => (
                <li key={e.alumnoId}>
                  <button type="button" onClick={() => setElegido(e.alumnoId)} aria-current={e.alumnoId === elegido ? 'true' : undefined}
                    className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      e.alumnoId === elegido ? 'bg-muted' : 'hover:bg-muted/60')}>
                    <Iniciales nombre={e.alumno} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn('truncate text-normal text-foreground', e.alumnoId === elegido ? 'font-semibold' : 'font-medium')}>{e.alumno || 'Alumno'}</span>
                        <span className="shrink-0"><EstadoFila e={e} max={max} corto /></span>
                      </span>
                      <span className="block truncate text-secundario text-muted-foreground">
                        {e.ultimoMensaje ? `${e.ultimoMensaje.deTutora ? 'Tú: ' : ''}${e.ultimoMensaje.texto}` : 'Sin mensajes'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* La entrega */}
          <section aria-label="Entrega" className="flex min-h-0 min-w-0 flex-col">
            {!actual ? (
              <div className="grid flex-1 place-items-center p-10 text-secundario text-muted-foreground">{datos ? 'Elige un alumno de la lista.' : ''}</div>
            ) : (
              <>
                <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
                  <Iniciales nombre={actual.alumno} tamano="md" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-normal font-semibold text-foreground">{actual.alumno}</h2>
                    <p className="truncate text-secundario text-muted-foreground">{actual.email}</p>
                  </div>
                  <div className="flex items-center">
                    <button type="button" onClick={() => ir(-1)} disabled={indice <= 0} aria-label="Alumno anterior" title="Alumno anterior"
                      className="inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><CaretLeft size={16} aria-hidden /></button>
                    <span className="min-w-[3rem] text-center text-secundario tabular-nums text-muted-foreground">{indice + 1} de {todas.length}</span>
                    <button type="button" onClick={() => ir(1)} disabled={indice < 0 || indice >= todas.length - 1} aria-label="Alumno siguiente" title="Alumno siguiente"
                      className="inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><CaretRight size={16} aria-hidden /></button>
                  </div>
                </div>

                {datos?.tarea.enunciado && (
                  <div className="flex shrink-0 gap-4 border-b border-border px-4 sm:px-6" role="tablist" aria-label="Ver">
                    {(['entrega', 'enunciado'] as const).map((v) => (
                      <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
                        className={cn('-mb-px border-b-2 py-2.5 text-secundario font-medium transition-colors',
                          vista === v ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                        {v === 'entrega' ? 'Entrega' : 'Enunciado'}
                      </button>
                    ))}
                  </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                  <div className="mx-auto max-w-3xl space-y-4">
                    {vista === 'enunciado' && datos ? (
                      <p className="whitespace-pre-wrap text-normal leading-7 text-foreground">{datos.tarea.enunciado}</p>
                    ) : actual.estado === 'sin_entregar' ? (
                      <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
                        <p className="text-normal font-medium text-foreground">Todavía no ha entregado</p>
                        {pluginMoodle && <p className="mt-1 text-secundario text-muted-foreground">Puedes ponerle nota igualmente, por ejemplo si la entregó por otra vía.</p>}
                      </div>
                    ) : (
                      <>
                        {actual.texto && <div className="whitespace-pre-wrap text-normal leading-7 text-foreground">{actual.texto}</div>}
                        {actual.archivos.length > 0 && (
                          <div>
                            <p className="mb-2 text-tabla uppercase text-muted-foreground">Archivos · {actual.archivos.length}</p>
                            <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
                              {actual.archivos.map((a, i) => (
                                <li key={`${i}-${a.nombre}`}>
                                  <button type="button"
                                    onClick={() => tutoresApi.abrirArchivo(projectId, cursoId, tareaId, actual.alumnoId, i, a.nombre).catch((err) => toast({ title: 'No se ha podido abrir', description: (err as Error).message, variant: 'destructive' }))}
                                    className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><FileText size={18} /></span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-normal font-medium text-foreground">{a.nombre}</span>
                                      <span className="text-secundario text-muted-foreground">{tamano(a.tamano)} · {TIPOS_EN_LINEA.has(String(a.tipo || '').toLowerCase()) ? 'Abrir' : 'Descargar'}</span>
                                    </span>
                                    <ArrowSquareOut size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {!actual.texto && actual.archivos.length === 0 && (
                          <p className="text-secundario text-muted-foreground">La entrega no tiene texto ni archivos.</p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* La calificación, aquí en pantallas medianas */}
                {!ancha && <div className="shrink-0 border-t border-border">{enMoodle || calificacionFranja}</div>}
              </>
            )}
          </section>

          {/* La calificación, a la derecha en pantallas anchas */}
          {ancha && <aside aria-label="Calificación" className="flex min-h-0 flex-col border-l border-border bg-muted/20">
            <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
              <h2 className="text-normal font-semibold text-foreground">Calificación</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{enMoodle || calificacionLateral}</div>
          </aside>}
        </div>
      </div>
    </div>
  );
}
