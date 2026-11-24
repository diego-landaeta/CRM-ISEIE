import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowSquareOut, Article, CaretRight, ChatsCircle, ClipboardText, Cube, EyeSlash, File, Folder,
  LinkSimple, ListChecks, Lock, Notebook, Question, VideoCamera,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { EtiquetaEnPruebas } from '@/shared/components/ui/EnPruebas';
import { tutoresApi, type ActividadDelCurso, type CursoCompleto } from '../api/tutores.api';

/*
  EL CURSO COMPLETO (#408, gemela de CRM#681): lo que ve la profesora en Moodle, sin salir del CRM. Los
  temas en orden y, en cada uno, todas sus actividades y recursos, con lo oculto
  marcado y sus fechas. En las tareas, lo que tiene por corregir y el botón para
  corregir aquí; lo demás se abre en Moodle.
*/

const TIPOS: Record<string, { nombre: string; icono: Icon }> = {
  assign: { nombre: 'Tarea', icono: ClipboardText },
  quiz: { nombre: 'Cuestionario', icono: ListChecks },
  forum: { nombre: 'Foro', icono: ChatsCircle },
  chat: { nombre: 'Chat', icono: ChatsCircle },
  resource: { nombre: 'Archivo', icono: File },
  folder: { nombre: 'Carpeta', icono: Folder },
  page: { nombre: 'Página', icono: Article },
  book: { nombre: 'Libro', icono: Notebook },
  url: { nombre: 'Enlace', icono: LinkSimple },
  lesson: { nombre: 'Lección', icono: Notebook },
  scorm: { nombre: 'Paquete SCORM', icono: Cube },
  h5pactivity: { nombre: 'H5P', icono: Cube },
  bigbluebuttonbn: { nombre: 'Videoclase', icono: VideoCamera },
  feedback: { nombre: 'Encuesta', icono: Question },
  questionnaire: { nombre: 'Encuesta', icono: Question },
  choice: { nombre: 'Consulta', icono: Question },
  glossary: { nombre: 'Glosario', icono: Notebook },
  wiki: { nombre: 'Wiki', icono: Notebook },
  workshop: { nombre: 'Taller', icono: ClipboardText },
};
const tipoDe = (t: string | null) => TIPOS[t || ''] || { nombre: 'Actividad', icono: Cube };

/** Moodle manda las etiquetas de las fechas en su idioma («Due:», «Opens:»…): aquí, en el nuestro. */
function etiquetaFecha(etiqueta: string | null) {
  const e = String(etiqueta || '').toLowerCase();
  if (/due|entrega|vence/.test(e)) return 'Entrega';
  if (/open|abr/.test(e)) return 'Abre';
  if (/clos|cierr/.test(e)) return 'Cierra';
  if (/cut|límite|limite/.test(e)) return 'Límite';
  if (/start|inicio/.test(e)) return 'Empieza';
  return 'Fecha';
}
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

function Actividad({ a, projectId, cursoId }: { a: ActividadDelCurso; projectId: number; cursoId: number }) {
  const { nombre: tipo, icono: Icono } = tipoDe(a.tipo);
  const porCorregir = a.tarea?.porCorregir ?? 0;
  const enElCrm = a.tarea?.corregibleEnElCrm;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md',
        porCorregir > 0 ? 'bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground' : 'bg-muted text-muted-foreground')}>
        <Icono size={16} weight={porCorregir > 0 ? 'bold' : 'regular'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-normal font-medium', a.visible ? 'text-foreground' : 'text-muted-foreground')}>{a.nombre || tipo}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-secundario text-muted-foreground">
          <span>{tipo}</span>
          {!a.visible && <span className="inline-flex items-center gap-1"><EyeSlash size={12} aria-hidden /> Oculta para los alumnos</span>}
          {a.restringida && a.visible && <span className="inline-flex items-center gap-1"><Lock size={12} aria-hidden /> Con restricciones</span>}
          {a.fechas.slice(0, 2).map((f) => <span key={f.at + (f.etiqueta || '')}>{etiquetaFecha(f.etiqueta)} {fechaCorta(f.at)}</span>)}
          {porCorregir > 0 && <span className="font-medium text-warning">{porCorregir} por corregir</span>}
        </span>
      </span>
      {a.tarea && enElCrm ? (
        <Link to={`/mis-cursos/campus/tarea/${projectId}/${cursoId}/${a.tarea.id}`}
          className={cn('inline-flex h-8 shrink-0 items-center rounded-md px-3 text-secundario font-medium',
            porCorregir > 0 ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border bg-card text-foreground hover:bg-muted')}>
          {porCorregir > 0 ? 'Corregir' : 'Ver'}
        </Link>
      ) : (
        <a href={a.url || undefined} target="_blank" rel="noopener noreferrer" aria-label={`Abrir «${a.nombre || tipo}» en Moodle`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-secundario font-medium text-foreground hover:bg-muted">
          <span className="hidden sm:inline">Moodle</span> <ArrowSquareOut size={13} aria-hidden />
        </a>
      )}
    </li>
  );
}

export default function CursoCompletoPage() {
  const params = useParams();
  const projectId = Number(params.projectId);
  const cursoId = Number(params.cursoId);
  const [datos, setDatos] = useState<CursoCompleto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await tutoresApi.verCurso(projectId, cursoId);
      if (r.success && r.data) { setDatos(r.data); setError(null); }
    } catch (e) {
      const x = e as { data?: { error?: string }; message?: string };
      setError(x?.data?.error || x?.message || 'No se ha podido leer el curso.');
    } finally { setCargando(false); }
  }, [projectId, cursoId]);
  useEffect(() => { cargar(); }, [cargar]);

  const resumen = useMemo(() => {
    const todas = (datos?.secciones || []).flatMap((s) => s.actividades);
    return {
      actividades: todas.length,
      porCorregir: todas.reduce((n, a) => n + (a.tarea?.porCorregir ?? 0), 0),
      ocultas: todas.filter((a) => !a.visible).length,
    };
  }, [datos]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start gap-3">
        <Link to="/mis-cursos/campus" aria-label="Volver a Mi campus" title="Volver a Mi campus"
          className="-ml-1 mt-0.5 inline-grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft size={16} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-titulo font-semibold text-foreground">{datos?.curso.nombre || (cargando ? 'Cargando el curso…' : 'Curso')}</h1>
            <EtiquetaEnPruebas />
          </div>
          {datos && (
            <p className="text-secundario text-muted-foreground">
              {datos.secciones.length} temas · {resumen.actividades} actividades · {datos.curso.alumnos} alumnos
              {resumen.porCorregir > 0 && <> · <span className="font-medium text-warning">{resumen.porCorregir} por corregir</span></>}
              {resumen.ocultas > 0 && <> · {resumen.ocultas} ocultas</>}
            </p>
          )}
        </div>
        {datos && (
          <a href={datos.curso.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-secundario font-medium text-foreground hover:bg-muted">
            <span className="hidden sm:inline">Abrir en Moodle</span> <ArrowSquareOut size={14} aria-hidden />
          </a>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft dark:bg-destructive/15 p-4">
          <p className="text-normal font-semibold text-foreground">No se ha podido abrir el curso</p>
          <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
          <Button size="sm" className="mt-3 h-8" onClick={cargar}>Volver a intentarlo</Button>
        </div>
      )}

      {!datos && cargando && (
        <div className="space-y-3" aria-busy="true" aria-label="Leyendo el curso">
          {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
      )}

      {datos && datos.secciones.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-secundario text-muted-foreground">Este curso todavía no tiene temas ni actividades.</p>
      )}

      {datos?.secciones.map((s) => (
        <details key={s.id} open={s.actividades.length > 0} className="group overflow-hidden rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <CaretRight size={13} weight="bold" aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-normal font-semibold', s.visible ? 'text-foreground' : 'text-muted-foreground')}>
                {s.nombre || (s.numero === 0 ? 'General' : `Tema ${s.numero}`)}
              </span>
              <span className="text-secundario text-muted-foreground">
                {s.actividades.length === 1 ? '1 actividad' : `${s.actividades.length} actividades`}
                {!s.visible && ' · oculto para los alumnos'}
              </span>
            </span>
            {s.actividades.some((a) => (a.tarea?.porCorregir ?? 0) > 0) && (
              <span className="shrink-0 rounded-full bg-warning-soft dark:bg-warning/15 px-2 py-0.5 text-tabla font-medium text-warning-soft-foreground">Por corregir</span>
            )}
          </summary>
          {s.actividades.length > 0 ? (
            <ul className="divide-y divide-border border-t border-border px-4">
              {s.actividades.map((a) => <Actividad key={a.cmid} a={a} projectId={projectId} cursoId={cursoId} />)}
            </ul>
          ) : (
            <p className="border-t border-border px-4 py-3 text-secundario text-muted-foreground">Sin actividades en este tema.</p>
          )}
        </details>
      ))}
    </div>
  );
}
