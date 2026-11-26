import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowSquareOut, ArrowsClockwise, CaretRight, ChatCircleText, ClipboardText, GraduationCap, Info, MagnifyingGlass, Warning,
} from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import usePermission from '@/shared/hooks/usePermission';
import Progreso from '@/modules/moodle/components/ProgresoCurso';
import {
  tutoresApi, type MiCampusAdministracion, type AdminCursoDetalle, type AdminEntrega, type AdminConsulta, type AdminMensaje,
} from '../api/tutores.api';

/*
  «Mi campus» de administración (Diego, 25/11: «que los admin puedan verlo también y los
  superadmin»). Todo el Moodle de UN campus cada vez, leído con la conexión del campus
  (Integraciones › Moodle), no con una cuenta personal:

    · consultas por responder (las del CRM y los mensajes de Moodle de las tutoras enlazadas);
    · entregas por corregir, la más antigua primero;
    · los cursos, y al abrir uno sus alumnos con su % hecho (se lee al abrirlo).

  Solo lectura: «Abrir en Moodle». Donde quien mira es profesora del curso con su cuenta
  enlazada, «Corregir» como en su vista. El servidor guarda una copia de 5 minutos por campus;
  si la lectura tarda, contesta «leyendo» y aquí se vuelve a preguntar cada pocos segundos.
*/

const CLAVE_CAMPUS = 'miCampus.administracion.campus';
const POR_PAGINA = 20;
const CURSOS_POR_PAGINA = 25;
const REPETIR_MS = 4000;
const MAX_REPETICIONES = 45;

const leerCampus = (): number | null => {
  try { const n = Number(localStorage.getItem(CLAVE_CAMPUS)); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
};
const guardarCampus = (id: number) => { try { localStorage.setItem(CLAVE_CAMPUS, String(id)); } catch { /* sin almacenamiento */ } };

const fecha = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');
const hace = (iso: string | null) => {
  if (!iso) return '';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;
};
function ultimoAcceso(iso: string | null) {
  if (!iso) return 'Nunca ha entrado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'Hoy';
  return dias === 1 ? 'Ayer' : `Hace ${dias} días`;
}
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const nombres = (lista: Array<{ nombre: string | null }> | null | undefined) => (lista || []).map((p) => p.nombre || 'Sin nombre').join(', ');

const boton = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-secundario font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function EnMoodle({ href, texto = 'Abrir en Moodle' }: { href: string | null; texto?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={boton}>
      {texto} <ArrowSquareOut size={12} aria-hidden />
    </a>
  );
}

function Fila({ tono, icono, titulo, detalle, children }: {
  tono: 'corregir' | 'duda'; icono: React.ReactNode; titulo: string; detalle: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 sm:flex-nowrap">
      <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md',
        tono === 'corregir' ? 'bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground' : 'bg-info-soft dark:bg-info/15 text-info-soft-foreground')}>
        {icono}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-normal font-medium text-foreground">{titulo}</p>
        <p className="text-secundario text-muted-foreground">{detalle}</p>
      </div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  );
}

function VerMas({ total, visibles, mas }: { total: number; visibles: number; mas: () => void }) {
  if (total <= visibles) return null;
  return (
    <button type="button" onClick={mas} className="my-1 h-8 rounded-md px-2 text-secundario font-medium text-primary hover:bg-muted">
      Ver {Math.min(POR_PAGINA, total - visibles)} más <span className="font-normal text-muted-foreground">({total - visibles} sin ver)</span>
    </button>
  );
}

/** El curso abierto: profesoras, tareas con lo que hay por corregir y alumnos con su % hecho. */
function DetalleDelCurso({ projectId, detalle, error, cargando, recargar }: {
  projectId: number; detalle: AdminCursoDetalle | null; error: string | null; cargando: boolean; recargar: () => void;
}) {
  if (cargando && !detalle) return <p className="py-3 text-secundario text-muted-foreground" aria-busy="true">Leyendo el curso en Moodle…</p>;
  if (error && !detalle) {
    return (
      <p role="alert" className="py-3 text-secundario text-warning-soft-foreground">
        {error} <button type="button" onClick={recargar} className="font-medium underline">Volver a intentarlo</button>
      </p>
    );
  }
  if (!detalle) return null;
  const motivo = detalle.avisoProgreso || (detalle.seguimiento === false
    ? 'Este curso no tiene activado el seguimiento de finalización en Moodle' : 'Moodle no da su avance');
  return (
    <div className="space-y-3 pb-3" data-testid="detalle-curso-admin">
      {detalle.error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-warning/35 px-3 py-2 text-secundario text-warning-soft-foreground">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> {detalle.error}
        </p>
      )}
      <p className="text-secundario text-muted-foreground">
        Profesoras: <span className="text-foreground">{detalle.profesoras.length ? nombres(detalle.profesoras) : 'ninguna en Moodle'}</span>
        {detalle.soyProfesora && <> · <span className="font-medium text-primary">das clase aquí con tu cuenta</span></>}
      </p>
      {detalle.tareas.length > 0 && (
        <div>
          <h4 className="py-1 text-tabla uppercase text-muted-foreground">Tareas</h4>
          <ul className="divide-y divide-border">
            {detalle.tareas.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <ClipboardText size={15} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-secundario font-medium text-foreground">{t.nombre || 'Tarea'}</span>
                {t.enGrupo
                  ? <span className="shrink-0 text-secundario text-muted-foreground">En grupo: se corrige en Moodle</span>
                  : t.sinCorregir.length > 0
                    ? <span className="shrink-0 text-secundario font-medium text-warning">{t.sinCorregir.length} por corregir</span>
                    : <span className="shrink-0 text-secundario text-muted-foreground">Al día</span>}
                {detalle.soyProfesora && !t.enGrupo && t.sinCorregir.length > 0
                  ? <Link to={`/mis-cursos/campus/tarea/${projectId}/${detalle.id}/${t.id}`} className={boton}>Corregir</Link>
                  : <EnMoodle href={t.sinCorregir.length ? t.corregirUrl : t.tareaUrl} texto="Moodle" />}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="py-1 text-tabla uppercase text-muted-foreground">Alumnos ({detalle.alumnos.length})</h4>
        {detalle.alumnos.length === 0 ? (
          <p className="text-secundario text-muted-foreground">Sin alumnos activos en este curso.</p>
        ) : (
          <table className="w-full">
            <thead className="sr-only sm:not-sr-only">
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 text-tabla uppercase text-muted-foreground">Alumno</th>
                <th scope="col" className="hidden py-1.5 text-tabla uppercase text-muted-foreground sm:table-cell">Último acceso</th>
                <th scope="col" className="py-1.5 text-tabla uppercase text-muted-foreground">Hecho</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detalle.alumnos.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3 text-secundario font-medium text-foreground">
                    <a href={a.mensajeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.nombre || 'Sin nombre'}</a>
                  </td>
                  <td className="hidden py-2 pr-3 text-secundario text-muted-foreground sm:table-cell">{ultimoAcceso(a.ultimoAcceso)}</td>
                  <td className="py-2 text-secundario" data-testid="progreso-alumno-admin"><Progreso valor={a.progreso ?? null} motivo={motivo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function CampusAdministracion({ alLeer }: {
  /** Para la cabecera de la página: la hora de lo leído y si tiene su cuenta enlazada. */
  alLeer?: (info: { leidoAt: string | null; tengoCuentaEnlazada: boolean }) => void;
}) {
  const { can } = usePermission();
  const veConsultas = can('consultas.view');
  const [datos, setDatos] = useState<MiCampusAdministracion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [campus, setCampus] = useState<number | null>(leerCampus);
  const [cursoFiltro, setCursoFiltro] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [verEntregas, setVerEntregas] = useState(POR_PAGINA);
  const [verConsultas, setVerConsultas] = useState(POR_PAGINA);
  const [verCursos, setVerCursos] = useState(CURSOS_POR_PAGINA);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [detalles, setDetalles] = useState<Record<number, { datos: AdminCursoDetalle | null; error: string | null; cargando: boolean }>>({});
  const repeticiones = useRef(0);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alLeerRef = useRef(alLeer);
  alLeerRef.current = alLeer;

  const cargar = useCallback(async (id: number | null, refrescar = false) => {
    if (reloj.current) clearTimeout(reloj.current);
    setCargando(true);
    try {
      const r = await tutoresApi.miCampusAdministracion(id, refrescar);
      if (!r.success || !r.data) throw new Error('Respuesta vacía');
      setDatos(r.data);
      setError(null);
      alLeerRef.current?.({ leidoAt: r.data.leidoAt, tengoCuentaEnlazada: r.data.tengoCuentaEnlazada });
      if (r.data.elegido && r.data.elegido !== id) setCampus(r.data.elegido);
      // Moodle sigue leyendo: se vuelve a preguntar (sin «refrescar», para no empezar otra lectura).
      if (r.data.leyendo && repeticiones.current < MAX_REPETICIONES) {
        repeticiones.current += 1;
        reloj.current = setTimeout(() => { cargar(r.data!.elegido); }, REPETIR_MS);
      } else {
        repeticiones.current = 0;
      }
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      setError(err?.data?.error || err?.message || 'No se ha podido leer el campus.');
    } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    repeticiones.current = 0;
    cargar(campus);
    return () => { if (reloj.current) clearTimeout(reloj.current); };
  }, [cargar, campus]);

  const elegirCampus = (id: number) => {
    guardarCampus(id);
    setCampus(id); setCursoFiltro(null); setAbierto(null); setDetalles({});
    setVerEntregas(POR_PAGINA); setVerConsultas(POR_PAGINA); setVerCursos(CURSOS_POR_PAGINA);
  };

  const c = datos?.campus || null;
  const projectId = c?.projectId ?? null;

  const leerCurso = useCallback(async (cursoId: number, refrescar = false) => {
    if (!projectId) return;
    setDetalles((d) => ({ ...d, [cursoId]: { datos: d[cursoId]?.datos ?? null, error: null, cargando: true } }));
    try {
      const r = await tutoresApi.cursoAdministracion(projectId, cursoId, refrescar);
      setDetalles((d) => ({ ...d, [cursoId]: { datos: r.data ?? null, error: null, cargando: false } }));
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      setDetalles((d) => ({ ...d, [cursoId]: { datos: d[cursoId]?.datos ?? null, error: err?.data?.error || err?.message || 'No se ha podido leer el curso.', cargando: false } }));
    }
  }, [projectId]);

  const abrirCurso = (cursoId: number) => {
    setAbierto((a) => (a === cursoId ? null : cursoId));
    if (!detalles[cursoId]) leerCurso(cursoId);
  };
  // Filtrar por curso: se abre ese curso (con sus alumnos) y las listas se quedan en él.
  const filtrarCurso = (cursoId: number | null) => {
    setCursoFiltro(cursoId);
    setVerEntregas(POR_PAGINA); setVerConsultas(POR_PAGINA);
    if (cursoId) { setAbierto(cursoId); if (!detalles[cursoId]) leerCurso(cursoId); }
  };

  const alumnosDelFiltro = useMemo(() => {
    if (!cursoFiltro) return null;
    const d = detalles[cursoFiltro]?.datos;
    return d ? new Set(d.alumnos.map((a) => a.id)) : null;
  }, [cursoFiltro, detalles]);

  const entregas = useMemo<AdminEntrega[]>(() => (c?.entregas || [])
    .filter((e) => !cursoFiltro || e.cursoId === cursoFiltro), [c, cursoFiltro]);
  const consultas = useMemo<AdminConsulta[]>(() => (c?.consultas || []).filter((q) => !cursoFiltro
    || q.cursoId === cursoFiltro || (alumnosDelFiltro && q.alumnoId != null && alumnosDelFiltro.has(q.alumnoId))), [c, cursoFiltro, alumnosDelFiltro]);
  const mensajes = useMemo<AdminMensaje[]>(() => (c?.mensajes || []).filter((m) => !cursoFiltro
    || (alumnosDelFiltro && alumnosDelFiltro.has(m.alumnoId))), [c, cursoFiltro, alumnosDelFiltro]);
  const porResponder = [...consultas.map((q) => ({ tipo: 'consulta' as const, q, desde: q.desde })),
    ...mensajes.map((m) => ({ tipo: 'mensaje' as const, m, desde: m.desde }))]
    .sort((a, b) => new Date(a.desde || 0).getTime() - new Date(b.desde || 0).getTime());

  const cursos = useMemo(() => {
    const t = busqueda.trim().toLocaleLowerCase('es');
    return (c?.cursos || []).filter((k) => (!cursoFiltro || k.id === cursoFiltro)
      && (!t || String(k.nombre || '').toLocaleLowerCase('es').includes(t) || String(k.id) === t));
  }, [c, busqueda, cursoFiltro]);
  const cursosOrdenados = useMemo(() => [...(c?.cursos || [])]
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')), [c]);

  if (!datos && cargando) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Leyendo el campus">
        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-56 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (error && !datos) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft dark:bg-destructive/15 px-4 py-4">
        <p className="text-normal font-semibold text-foreground">No se ha podido leer el campus</p>
        <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
        <Button size="sm" className="mt-3 h-8" onClick={() => cargar(campus, true)}>Volver a intentarlo</Button>
      </div>
    );
  }
  if (!datos) return null;
  if (!datos.todosLosCampus.length) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center" data-testid="admin-sin-campus">
        <GraduationCap size={24} className="mx-auto text-muted-foreground" aria-hidden />
        <p className="mt-2 text-normal font-semibold text-foreground">Ninguno de tus campus tiene el Moodle conectado</p>
        <p className="mx-auto mt-1 max-w-sm text-secundario text-muted-foreground">Se conecta en Integraciones › Moodle de cada campus.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="mi-campus-administracion">
      <p role="note" className="flex items-start gap-2 rounded-md bg-info-soft dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-info/35 px-3 py-2 text-secundario text-info-soft-foreground">
        <Info size={15} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Vista de administración: todo el campus.</strong> Todos los cursos del Moodle, leídos con la
          conexión del campus. Solo lectura: para responder o poner una nota, ábrelo en Moodle.
          {datos.tengoCuentaEnlazada && ' Donde das clase con tu cuenta, puedes corregir desde aquí.'}
        </span>
      </p>

      <div className="flex flex-wrap items-end gap-3">
        {datos.todosLosCampus.length > 1 && (
          <label className="flex flex-col gap-1 text-secundario font-medium text-muted-foreground">
            Campus
            <select value={datos.elegido ?? ''} onChange={(e) => elegirCampus(Number(e.target.value))} disabled={cargando}
              className="h-8 rounded-md border border-border bg-card px-2 text-secundario text-foreground">
              {datos.todosLosCampus.map((x) => <option key={x.projectId} value={x.projectId}>{x.campus}</option>)}
            </select>
          </label>
        )}
        {c && c.cursos.length > 0 && (
          <label className="flex min-w-0 flex-col gap-1 text-secundario font-medium text-muted-foreground">
            Curso
            <select value={cursoFiltro ?? ''} onChange={(e) => filtrarCurso(e.target.value ? Number(e.target.value) : null)}
              className="h-8 max-w-[22rem] rounded-md border border-border bg-card px-2 text-secundario text-foreground" data-testid="filtro-curso-admin">
              <option value="">Todos los cursos ({c.cursos.length})</option>
              {cursosOrdenados.map((k) => (
                <option key={k.id} value={k.id}>{k.nombre || `Curso ${k.id}`}{k.porCorregir ? ` · ${k.porCorregir} por corregir` : ''}</option>
              ))}
            </select>
          </label>
        )}
        <Button variant="outline" size="sm" disabled={cargando} onClick={() => { repeticiones.current = 0; cargar(datos.elegido, true); }} className="h-8 text-secundario">
          <ArrowsClockwise size={14} className={cn('mr-1.5', cargando && 'animate-spin')} aria-hidden />
          {cargando || datos.leyendo ? 'Leyendo…' : 'Actualizar'}
        </Button>
        {c?.url && <EnMoodle href={c.url} texto="Abrir el campus" />}
      </div>

      {datos.leyendo && (
        <p role="status" className="text-secundario text-muted-foreground" data-testid="admin-leyendo">
          Leyendo todos los cursos de Moodle, de dos en dos para no saturar el campus. {c ? 'Mientras, ves la lectura anterior.' : 'Puede tardar un minuto.'}
        </p>
      )}

      {c && (
        <>
          {c.error && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-warning-soft dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-warning/35 px-3 py-2 text-secundario text-warning-soft-foreground">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> {c.error}
            </p>
          )}
          {c.avisos.length > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-warning-soft dark:bg-transparent px-3 py-2 text-secundario text-warning-soft-foreground">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> {c.avisos.join(' ')}
            </p>
          )}

          <p className="text-seccion font-normal text-foreground" data-testid="resumen-admin">
            En {c.campus}{cursoFiltro ? ' (este curso)' : ''}:{' '}
            <strong className="font-semibold text-info-soft-foreground">{plural(porResponder.length, 'consulta por responder', 'consultas por responder')}</strong>{' y '}
            <strong className="font-semibold text-warning">{plural(entregas.length, 'entrega por corregir', 'entregas por corregir')}</strong>
            <span className="text-muted-foreground"> · {plural(c.cursos.length, 'curso', 'cursos')}</span>
          </p>

          <section aria-labelledby="admin-por-responder" className="rounded-lg border border-border bg-card px-4 py-2">
            <h2 id="admin-por-responder" className="py-2 text-normal font-semibold text-foreground">Consultas por responder</h2>
            {porResponder.length === 0 ? (
              <p className="pb-3 text-secundario text-muted-foreground">Nada esperando respuesta.</p>
            ) : (
              <ul className="divide-y divide-border">
                {porResponder.slice(0, verConsultas).map((x) => (x.tipo === 'consulta' ? (
                  <Fila key={`q-${x.q.consultaId}`} tono="duda" icono={<ChatCircleText size={15} weight="bold" />}
                    titulo={x.q.alumno || 'Alumno'}
                    detalle={<>{x.q.curso ? `${x.q.curso} · ` : ''}Tutora: {x.q.tutora || 'sin asignar'} · espera desde el {fecha(x.q.desde)} ({hace(x.q.desde)})</>}>
                    {veConsultas && <Link to={`/consultas/${x.q.consultaId}`} className={boton}>Ver en Consultas</Link>}
                    <EnMoodle href={x.q.moodleUrl} />
                  </Fila>
                ) : (
                  <Fila key={`m-${x.m.conversacionId}`} tono="duda" icono={<ChatCircleText size={15} weight="bold" />}
                    titulo={x.m.alumno || 'Alumno'}
                    detalle={<>Mensaje en Moodle a {x.m.tutora || 'su tutora'} sin responder desde el {fecha(x.m.desde)} ({hace(x.m.desde)})</>}>
                    <EnMoodle href={x.m.responderUrl} />
                  </Fila>
                )))}
              </ul>
            )}
            <VerMas total={porResponder.length} visibles={verConsultas} mas={() => setVerConsultas((n) => n + POR_PAGINA)} />
            {(c.mensajes.length > 0 || !cursoFiltro) && (
              <p className="pb-2 text-secundario text-muted-foreground">Los mensajes de Moodle son los de las tutoras enlazadas en el CRM.</p>
            )}
          </section>

          <section aria-labelledby="admin-por-corregir" className="rounded-lg border border-border bg-card px-4 py-2">
            <h2 id="admin-por-corregir" className="py-2 text-normal font-semibold text-foreground">
              Entregas por corregir <span className="font-normal text-muted-foreground">· la más antigua primero</span>
            </h2>
            {entregas.length === 0 ? (
              <p className="pb-3 text-secundario text-muted-foreground">Nada por corregir.</p>
            ) : (
              <ul className="divide-y divide-border" data-testid="entregas-admin">
                {entregas.slice(0, verEntregas).map((e) => (
                  <Fila key={`${e.tareaId}-${e.alumnoId}`} tono="corregir" icono={<ClipboardText size={15} weight="bold" />}
                    titulo={`${e.alumno || 'Alumno'} · ${e.tarea || 'Tarea'}`}
                    detalle={<>{e.curso || `Curso ${e.cursoId}`} · entregada el {fecha(e.entregadaAt)} ({hace(e.entregadaAt)}) · {e.profesoras.length ? `Profesora: ${nombres(e.profesoras)}` : 'Sin profesora en el curso'}</>}>
                    {e.puedoCorregir && <Link to={`/mis-cursos/campus/tarea/${c.projectId}/${e.cursoId}/${e.tareaId}`} className={boton}>Corregir</Link>}
                    <EnMoodle href={e.corregirUrl} />
                  </Fila>
                ))}
              </ul>
            )}
            <VerMas total={entregas.length} visibles={verEntregas} mas={() => setVerEntregas((n) => n + POR_PAGINA)} />
            {c.tareasEnGrupo > 0 && (
              <p className="pb-2 text-secundario text-muted-foreground">
                Y {plural(c.tareasEnGrupo, 'tarea en grupo', 'tareas en grupo')} con entregas: Moodle las guarda a nombre del grupo y se corrigen allí.
              </p>
            )}
          </section>

          <section aria-labelledby="admin-cursos" className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 id="admin-cursos" className="text-normal font-semibold text-foreground">
                Cursos <span className="font-normal text-muted-foreground">· alumnos y su % hecho al abrir cada uno</span>
              </h2>
              {!cursoFiltro && (
                <label className="relative">
                  <span className="sr-only">Buscar un curso</span>
                  <MagnifyingGlass size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setVerCursos(CURSOS_POR_PAGINA); }} placeholder="Buscar curso"
                    className="h-8 w-56 rounded-md border border-border bg-card pl-7 pr-2 text-secundario text-foreground" />
                </label>
              )}
            </div>
            {cursos.length === 0 ? (
              <p className="px-4 py-6 text-center text-secundario text-muted-foreground">Ningún curso con ese nombre.</p>
            ) : (
              <ul className="divide-y divide-border">
                {cursos.slice(0, verCursos).map((k) => {
                  const d = detalles[k.id];
                  const open = abierto === k.id;
                  return (
                    <li key={k.id} data-testid="curso-admin">
                      <button type="button" onClick={() => abrirCurso(k.id)} aria-expanded={open}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <GraduationCap size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-normal font-semibold text-foreground">{k.nombre || `Curso ${k.id}`}</span>
                          <span className="flex flex-wrap gap-x-3 text-secundario text-muted-foreground">
                            {k.porCorregir > 0 && <span className="font-medium text-warning">{plural(k.porCorregir, 'entrega por corregir', 'entregas por corregir')}</span>}
                            {!k.visible && <span>Oculto en Moodle</span>}
                            {k.profesoras && <span>{k.profesoras.length ? `Profesora: ${nombres(k.profesoras)}` : 'Sin profesora'}</span>}
                            {k.soyProfesora && <span className="font-medium text-primary">Das clase aquí</span>}
                            {k.error && <span className="text-warning">{k.error}</span>}
                          </span>
                        </span>
                        <CaretRight size={14} weight="bold" aria-hidden className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                      </button>
                      {open && (
                        <div className="border-t border-border bg-muted/20 px-4 pt-2 sm:pl-[3.25rem]">
                          <div className="flex flex-wrap gap-2 pb-2">
                            <EnMoodle href={k.url} texto="Abrir el curso en Moodle" />
                            <button type="button" onClick={() => leerCurso(k.id, true)} disabled={d?.cargando} className={boton}>
                              <ArrowsClockwise size={12} className={cn(d?.cargando && 'animate-spin')} aria-hidden /> Volver a leer
                            </button>
                          </div>
                          <DetalleDelCurso projectId={c.projectId} detalle={d?.datos ?? null} error={d?.error ?? null} cargando={Boolean(d?.cargando)} recargar={() => leerCurso(k.id, true)} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {cursos.length > verCursos && (
              <div className="border-t border-border px-4 py-1">
                <button type="button" onClick={() => setVerCursos((n) => n + CURSOS_POR_PAGINA)} className="h-8 rounded-md px-2 text-secundario font-medium text-primary hover:bg-muted">
                  Ver {Math.min(CURSOS_POR_PAGINA, cursos.length - verCursos)} cursos más <span className="font-normal text-muted-foreground">({cursos.length - verCursos} sin ver)</span>
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
