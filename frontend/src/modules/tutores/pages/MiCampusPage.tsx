import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { soloEsTutorRedactor } from '@/shared/lib/roles';
import {
  ArrowSquareOut, ArrowsClockwise, CaretRight, ChatCircleText, CheckCircle, ClipboardText, Coins, GraduationCap, ListBullets, Warning,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import { Button } from '@/shared/components/ui/button';
import Iniciales from '@/shared/components/ui/Iniciales';
import { toast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/lib/utils';
import {
  tutoresApi, type MiCampus, type MiCampusCurso, type MiCampusPendiente,
} from '../api/tutores.api';
// Lo que hay que hacer en un solo sitio y el selector de campus (Diego, 24/11).
import {
  SelectorCampus, PorResponder, PorCorregir, entregasPorCorregir, leerCampusElegidos, guardarCampusElegidos,
} from '../components/BandejaMiCampus';
import { consultasApi, type ConsultaFila } from '@/modules/consultas/api/consultas.api';
// El % hecho con su barra: el mismo componente que la ficha del cliente (gemela de CRM#871).
import Progreso from '@/modules/moodle/components/ProgresoCurso';
// El recorrido guiado de la pantalla (#611): solo con el botón (#681).
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
// La redactora ve lo suyo (CRM#1026): su cuenta y su rol en los cursos que redacta. En pruebas.
import RedaccionEnMoodle from '../components/RedaccionEnMoodle';
import { SOLO_EN_PRUEBAS } from '@/shared/lib/enPruebas';

/*
  «Mi campus» (#408, gemela de CRM#681): lo que la tutora tiene que hacer hoy en Moodle.

  Jerarquía: primero lo que pide acción, todo junto (Diego, 24/11: un solo sitio para
  la tutora redactora): las consultas por responder, que se contestan aquí mismo, y
  las entregas por corregir, cada una con su «Corregir». Después, curso a curso, sus
  tareas y sus alumnos; y al lado, lo que tiene pendiente por desarrollar. Arriba, el
  selector de campus: todos juntos o uno o varios, y se recuerda. Las cifras se leen
  de Moodle en el momento (copia de dos minutos por campus en el servidor).

  Sistema: la escala de texto del CRM, filas con separadores finos (no tarjetas
  dentro de tarjetas), controles de 32 px y color solo para el estado y la acción.

  GEMELA de CRM#1084: aquí también se corrige desde el CRM (CorregirTareaPage, con el
  plugin de Moodle). «Mis cursos y comisiones» es un enlace de la cabecera, no una pestaña.
*/

const fechaCorta = (iso: string | null) => (iso
  ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  : '—');

function ultimoAcceso(iso: string | null) {
  if (!iso) return 'Nunca ha entrado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  return `Hace ${dias} días`;
}

/** Sin entrar al curso en una semana (o nunca): conviene escribirle antes de que lo deje. */
const DIAS_SIN_ENTRAR = 7;
function sinEntrar(iso: string | null) {
  return !iso || Date.now() - new Date(iso).getTime() >= DIAS_SIN_ENTRAR * 86400000;
}

/** «Vence en 19 días», «Vence hoy», «Vencido hace 3 días». */
function plazo(iso: string | null): { texto: string; vencido: boolean } | null {
  if (!iso) return null;
  const dias = Math.round((new Date(String(iso).slice(0, 10)).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  if (dias === 0) return { texto: 'Vence hoy', vencido: false };
  if (dias > 0) return { texto: `Vence en ${dias} ${dias === 1 ? 'día' : 'días'}`, vencido: false };
  return { texto: `Vencido hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, vencido: true };
}

const ESTADO_PENDIENTE: Record<string, string> = {
  pendiente_asignar: 'Sin asignar', asignado: 'Asignado', en_desarrollo: 'En desarrollo', publicado: 'Publicado',
};

/** Por qué un alumno sale con «—» en vez de un %: no se sabe, que no es «0 %». */
function sinProgreso(curso: MiCampusCurso) {
  if (curso.avisoProgreso) return curso.avisoProgreso;
  if (curso.seguimiento === false) return 'Este curso no tiene activado el seguimiento de finalización en Moodle';
  return 'Moodle no da su avance: el curso no tiene actividades con finalización';
}

const porCorregirDe = (k: MiCampusCurso) => k.tareas.reduce((s, t) => s + t.sinCorregir.length, 0);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

const accion = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-secundario font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1';

/** Una fila de «Por hacer»: qué es, de quién y el botón que lo resuelve. */
function PorHacer({ tono, icono, titulo, detalle, children }: {
  tono: 'corregir' | 'duda'; icono: React.ReactNode; titulo: string; detalle: string; children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md',
        tono === 'corregir' ? 'bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground' : 'bg-info-soft dark:bg-info/15 text-info-soft-foreground')}>
        {icono}
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-normal font-medium text-foreground sm:truncate">{titulo}</p>
        <p className="truncate text-secundario text-muted-foreground">{detalle}</p>
      </div>
      {children}
    </li>
  );
}

function Curso({ projectId, curso, abierto, alternar }: { projectId: number; curso: MiCampusCurso; abierto: boolean; alternar: () => void }) {
  const corregir = (tareaId: number) => `/mis-cursos/campus/tarea/${projectId}/${curso.id}/${tareaId}`;
  const conEntregas = curso.tareas.filter((t) => t.sinCorregir.length > 0);
  const porCorregir = porCorregirDe(curso);
  const dudas = curso.dudas.length;
  const alDia = porCorregir === 0 && dudas === 0;
  const panel = `curso-${curso.id}`;
  return (
    <li data-testid="curso-campus">
      <button type="button" onClick={alternar} data-recorrido="mi-campus-curso" aria-expanded={abierto} aria-controls={panel}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <GraduationCap size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-normal font-semibold text-foreground">{curso.nombre || `Curso ${curso.id}`}</span>
          <span className="flex flex-wrap gap-x-3 text-secundario">
            {porCorregir > 0 && <span className="font-medium text-warning">{plural(porCorregir, 'entrega por corregir', 'entregas por corregir')}</span>}
            {dudas > 0 && <span className="font-medium text-info-soft-foreground">{plural(dudas, 'duda', 'dudas')}</span>}
            {alDia && <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle size={12} weight="fill" className="text-success" aria-hidden /> Al día</span>}
            <span className="text-muted-foreground">{plural(curso.alumnos.length, 'alumno', 'alumnos')}</span>
            {curso.alumnos.some((a) => sinEntrar(a.ultimoAcceso)) && (
              <span className="text-muted-foreground" title={`Llevan ${DIAS_SIN_ENTRAR} días o más sin entrar al curso, o no han entrado nunca`}>
                · <span className="font-medium text-foreground">{curso.alumnos.filter((a) => sinEntrar(a.ultimoAcceso)).length} sin entrar</span> hace +{DIAS_SIN_ENTRAR} días
              </span>
            )}
          </span>
        </span>
        <CaretRight size={14} weight="bold" aria-hidden className={cn('shrink-0 text-muted-foreground transition-transform duration-200', abierto && 'rotate-90')} />
      </button>

      {abierto && (
        <div id={panel} className="border-t border-border bg-muted/20 px-4 pb-3 pt-1 sm:pl-[3.75rem]">
          {curso.error && (
            <p role="alert" className="mt-2 flex items-start gap-2 rounded-md bg-warning-soft dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-warning/35 px-3 py-2 text-secundario text-warning-soft-foreground">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> {curso.error}
            </p>
          )}

          {!alDia && (
            <ul className="divide-y divide-border" aria-label="Por hacer">
              {conEntregas.map((t) => (
                <PorHacer key={`t-${t.id}`} tono="corregir" icono={<ClipboardText size={15} weight="bold" />}
                  titulo={t.nombre || 'Tarea'}
                  detalle={`${t.sinCorregir.map((e) => e.alumno || 'Alumno').join(', ')} · entregada ${fechaCorta(t.sinCorregir[0]?.entregadaAt ?? null)}${t.entrega ? ` · fecha límite ${fechaCorta(t.entrega)}` : ''}`}>
                  <Link to={corregir(t.id)} className={cn(accion, 'border border-border bg-card text-foreground hover:bg-muted')}>
                    Corregir{t.sinCorregir.length > 1 ? ` (${t.sinCorregir.length})` : ''}
                  </Link>
                </PorHacer>
              ))}
              {curso.dudas.map((d) => (
                <PorHacer key={`d-${d.consultaId}`} tono="duda" icono={<ChatCircleText size={15} weight="bold" />}
                  titulo={d.alumno || 'Alumno'} detalle={`Espera respuesta desde el ${fechaCorta(d.desde)}`}>
                  <Link to={`/consultas/${d.consultaId}`} className={cn(accion, 'border border-border bg-card text-foreground hover:bg-muted')}>Responder</Link>
                </PorHacer>
              ))}
            </ul>
          )}

          <Link to={`/mis-cursos/campus/curso/${projectId}/${curso.id}`}
            className="-mx-2 mt-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-secundario font-medium text-primary hover:bg-muted/60">
            <ListBullets size={15} className="shrink-0" aria-hidden />
            <span className="flex-1">Ver el curso completo <span className="font-normal text-muted-foreground">· temas y todas las actividades</span></span>
            <CaretRight size={12} className="shrink-0" aria-hidden />
          </Link>

          {curso.tareas.length > 0 && (
            <div className="mt-2">
              <h3 className="py-1.5 text-tabla uppercase text-muted-foreground">Tareas del curso</h3>
              <ul className="divide-y divide-border">
                {curso.tareas.map((t) => (
                  <li key={t.id}>
                    <Link to={corregir(t.id)} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60">
                      <ClipboardText size={15} className="shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-secundario font-medium text-foreground">{t.nombre}</span>
                      {t.sinCorregir.length > 0
                        ? <span className="shrink-0 text-secundario font-medium text-warning">{plural(t.sinCorregir.length, 'por corregir', 'por corregir')}</span>
                        : <span className="shrink-0 text-secundario text-muted-foreground">{t.entrega ? `Fecha límite ${fechaCorta(t.entrega)}` : 'Al día'}</span>}
                      <CaretRight size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="group/alumnos mt-1">
            <summary className="-mx-2 flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2 text-secundario font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <CaretRight size={11} weight="bold" aria-hidden className="transition-transform group-open/alumnos:rotate-90" />
              Alumnos matriculados <span className="tabular-nums">({curso.alumnos.length})</span>
              <a href={curso.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
                Abrir el curso <ArrowSquareOut size={11} aria-hidden />
              </a>
            </summary>
            {curso.alumnos.length > 0 && (curso.avisoProgreso || curso.seguimiento === false) && (
              <p className="pb-1 text-secundario text-muted-foreground">
                {curso.avisoProgreso || 'Este curso no tiene activado el seguimiento de finalización en Moodle: el % hecho sale como «—».'}
              </p>
            )}
            {curso.alumnos.length === 0 ? (
              <p className="pb-2 text-secundario text-muted-foreground">Sin alumnos activos en este curso.</p>
            ) : (
              <table className="w-full">
                <thead className="sr-only sm:not-sr-only">
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="py-1.5 text-tabla uppercase text-muted-foreground">Alumno</th>
                    <th scope="col" className="hidden py-1.5 text-tabla uppercase text-muted-foreground sm:table-cell">Último acceso</th>
                    <th scope="col" className="hidden py-1.5 text-tabla uppercase text-muted-foreground sm:table-cell">Hecho</th>
                    <th scope="col" className="py-1.5"><span className="sr-only">Escribir</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...curso.alumnos].sort((x, y) => Number(sinEntrar(y.ultimoAcceso)) - Number(sinEntrar(x.ultimoAcceso))).map((a) => (
                    <tr key={a.id} data-testid="alumno-campus">
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2.5">
                          <Iniciales nombre={a.nombre} tamano="xs" />
                          <span className="min-w-0">
                            <span className="block truncate text-secundario font-medium text-foreground">{a.nombre || 'Sin nombre'}</span>
                            <span className="block truncate text-secundario text-muted-foreground sm:hidden">
                              {ultimoAcceso(a.ultimoAcceso)} · {a.progreso === null || a.progreso === undefined ? <span title={sinProgreso(curso)}>— hecho</span> : <span className="tabular-nums">{a.progreso}% hecho</span>}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className={cn('hidden py-2 pr-3 text-secundario tabular-nums sm:table-cell', sinEntrar(a.ultimoAcceso) ? 'font-medium text-warning' : 'text-muted-foreground')}>
                        {ultimoAcceso(a.ultimoAcceso)}
                      </td>
                      <td className="hidden py-2 pr-3 text-secundario sm:table-cell" data-testid="progreso-alumno">
                        <Progreso valor={a.progreso} motivo={sinProgreso(curso)} />
                      </td>
                      <td className="py-2 text-right">
                        <a href={a.mensajeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Escribir a ${a.nombre || 'este alumno'} en Moodle`}
                          className="inline-flex h-8 items-center rounded-md px-2 text-secundario font-medium text-primary hover:bg-muted">
                          Escribir
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </details>
        </div>
      )}
    </li>
  );
}

function PorDesarrollar({ lista }: { lista: MiCampusPendiente[] }) {
  return (
    <section aria-labelledby="mi-campus-pendientes" data-recorrido="mi-campus-por-desarrollar" className="rounded-lg border border-border bg-card">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
        <h2 id="mi-campus-pendientes" className="text-normal font-semibold text-foreground">Por desarrollar en Moodle</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-secundario font-medium tabular-nums text-muted-foreground">{lista.length}</span>
      </div>
      {lista.length === 0 ? (
        <p className="px-4 py-6 text-center text-secundario text-muted-foreground">No tienes cursos pendientes de desarrollar.</p>
      ) : (
        <ul className="divide-y divide-border">
          {lista.map((p) => {
            const pl = plazo(p.fechaComprometida);
            const hechos = [p.avance.foto, p.avance.video].filter(Boolean).length;
            return (
              <li key={p.id} className="space-y-2.5 px-4 py-3.5" data-testid="pendiente-campus">
                <div>
                  <p className="text-normal font-medium leading-snug text-foreground">{p.nombre}</p>
                  <p className="mt-0.5 text-secundario text-muted-foreground">
                    {p.campus} · {ESTADO_PENDIENTE[p.estado] || p.estado}
                    {pl && <> · <span className={pl.vencido ? 'font-medium text-destructive' : ''}>{pl.texto}</span></>}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-secundario">
                    <span className="text-muted-foreground">Módulos</span>
                    <span className="font-medium tabular-nums text-foreground">{p.avance.modulos}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.avance.modulos} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de los módulos">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(100, p.avance.modulos)}%` }} />
                  </div>
                  <ul className="flex gap-4 pt-0.5 text-secundario" aria-label={`Material: ${hechos} de 2 listos`}>
                    <Hito hecho={p.avance.foto} texto="Foto" />
                    <Hito hecho={p.avance.video} texto="Vídeo" />
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Hito({ hecho, texto }: { hecho: boolean; texto: string }) {
  return (
    <li className={cn('inline-flex items-center gap-1.5', hecho ? 'text-foreground' : 'text-muted-foreground')}>
      {hecho
        ? <CheckCircle size={14} weight="fill" className="text-success" aria-hidden />
        : <span aria-hidden className="h-3.5 w-3.5 rounded-full border-[1.5px] border-dashed border-muted-foreground/60" />}
      {texto}<span className="sr-only">{hecho ? ': listo' : ': falta'}</span>
    </li>
  );
}

/** «a», «a y b», «a, b y c». */
function enFrase(partes: React.ReactNode[]) {
  return partes.map((p, i) => (
    <span key={i}>{i > 0 && (i === partes.length - 1 ? ' y ' : ', ')}{p}</span>
  ));
}

/**
 * La línea de arriba (Carlos, 05/11): «X cursos por desarrollar · Y dudas sin responder ·
 * Z tareas por corregir». Sin campus conectado no se dice «al día» (no se sabe), pero los
 * cursos por desarrollar sí se saben: salen del CRM, no de Moodle.
 */
function Resumen({ porCorregir, dudas, porDesarrollar, conCampus }: { porCorregir: number; dudas: number; porDesarrollar: number; conCampus: boolean }) {
  const desarrollar = porDesarrollar > 0 && (
    <strong key="p" className="font-semibold text-primary">{plural(porDesarrollar, 'curso por desarrollar', 'cursos por desarrollar')}</strong>
  );
  if (!conCampus || (porCorregir === 0 && dudas === 0)) {
    if (!conCampus && !desarrollar) return null;
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-normal text-foreground" data-testid="resumen-mi-campus" data-recorrido="mi-campus-resumen">
        {conCampus && (
          <>
            <CheckCircle size={18} weight="fill" className="text-success" aria-hidden />
            <span>Estás al día: nada por corregir ni dudas sin contestar.</span>
          </>
        )}
        {desarrollar && <span>{conCampus ? (porDesarrollar === 1 ? 'Te queda' : 'Te quedan') : 'Tienes'} {desarrollar}.</span>}
      </p>
    );
  }
  const partes = [
    porCorregir > 0 && <strong key="c" className="font-semibold text-warning">{plural(porCorregir, 'entrega por corregir', 'entregas por corregir')}</strong>,
    dudas > 0 && <strong key="d" className="font-semibold text-info-soft-foreground">{plural(dudas, 'duda sin contestar', 'dudas sin contestar')}</strong>,
    desarrollar,
  ].filter(Boolean) as React.ReactNode[];
  return (
    <p className="text-seccion font-normal text-foreground" data-testid="resumen-mi-campus" data-recorrido="mi-campus-resumen">
      Hoy tienes {enFrase(partes)}.
    </p>
  );
}

export default function MiCampusPage() {
  // La redactora no tiene comisiones: sin el enlace (Diego, 24/11/2026).
  const { user } = useAuth() as { user: { role?: string; roles_extra?: string[] } | null };
  const soloRedactora = soloEsTutorRedactor(user);
  const [datos, setDatos] = useState<MiCampus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  // Los cursos con algo que hacer empiezan abiertos, como antes (Diego, 24/11: «todo abierto
  // como antes, no minimizado»), aunque lo pendiente también esté arriba, todo junto.
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  // Los campus que ve: [] = todos. Se recuerda en este navegador.
  const [elegidos, setElegidos] = useState<number[]>(leerCampusElegidos);
  const elegidosRef = useRef(elegidos);
  elegidosRef.current = elegidos;
  // Sus consultas abiertas, las de Consultas (no la copia de Moodle): se contestan aquí.
  const [consultas, setConsultas] = useState<ConsultaFila[] | null>(null);
  const [plazoHoras, setPlazoHoras] = useState(24);
  const [errorConsultas, setErrorConsultas] = useState<string | null>(null);

  const cargarConsultas = useCallback(async () => {
    try {
      const r = await consultasApi.mias({ estado: 'pendientes' });
      if (!Array.isArray(r?.data?.consultas)) throw new Error('Respuesta sin consultas');
      setConsultas(r.data.consultas.filter((c) => c.estado === 'abierta'));
      if (r?.data?.plazoHoras) setPlazoHoras(r.data.plazoHoras);
      setErrorConsultas(null);
    } catch {
      setErrorConsultas('No se han podido leer tus consultas.');
    }
  }, []);

  const cargar = useCallback(async (refrescar = false) => {
    setCargando(true);
    try {
      const r = await tutoresApi.miCampus(refrescar, elegidosRef.current);
      if (r.success && r.data) {
        setDatos(r.data); setError(null);
        // De entrada, abiertos los cursos con algo que hacer.
        if (!refrescar) {
          setAbiertos(new Set(r.data.campus.flatMap((c) => c.cursos
            .filter((k) => porCorregirDe(k) || k.dudas.length).map((k) => `${c.projectId}-${k.id}`))));
        }
        // Lo guardado ya no es suyo (otro campus, otra persona en este navegador): todos.
        if (elegidosRef.current.length && r.data.elegidos === null) {
          setElegidos([]); guardarCampusElegidos([]);
        }
      }
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      setError(err?.data?.error || err?.message || 'No se ha podido leer el campus.');
      if (refrescar) toast({ title: 'No se ha podido actualizar', variant: 'destructive' });
    } finally { setCargando(false); }
  }, []);
  // Se vuelve a leer al cambiar de campus.
  const claveCampus = elegidos.join(',');
  useEffect(() => { cargar(); }, [cargar, claveCampus]);
  useEffect(() => { cargarConsultas(); }, [cargarConsultas]);

  const elegirCampus = (ids: number[]) => { setElegidos(ids); guardarCampusElegidos(ids); };
  const actualizar = () => { cargar(true); cargarConsultas(); };

  // Lo que se ve: los campus elegidos (el servidor dice cuáles ha leído).
  const porResponder = useMemo(() => {
    if (consultas === null) return null;
    const filtro = datos?.elegidos?.length ? new Set(datos.elegidos) : null;
    return consultas.filter((c) => !filtro || filtro.has(Number(c.project_id)));
  }, [consultas, datos]);
  const porCorregir = useMemo(() => entregasPorCorregir(datos), [datos]);
  const respondida = (id: number) => {
    setConsultas((l) => (l || []).filter((c) => c.id !== id));
    // Y fuera también de su curso, sin esperar a la copia de Moodle.
    setDatos((d) => (d ? {
      ...d,
      campus: d.campus.map((c) => ({
        ...c,
        dudasSinCurso: c.dudasSinCurso.filter((x) => x.consultaId !== id),
        cursos: c.cursos.map((k) => ({ ...k, dudas: k.dudas.filter((x) => x.consultaId !== id) })),
      })),
    } : d));
  };

  const totales = useMemo(() => {
    const cursos = datos?.campus.flatMap((c) => c.cursos) || [];
    return {
      porCorregir: cursos.reduce((s, k) => s + porCorregirDe(k), 0),
      // Las dudas, las de Consultas en cuanto se han leído (las mismas que la lista de abajo).
      dudas: porResponder !== null ? porResponder.length
        : cursos.reduce((s, k) => s + k.dudas.length, 0) + (datos?.campus.reduce((s, c) => s + c.dudasSinCurso.length, 0) || 0),
    };
  }, [datos, porResponder]);
  const todosLosCampus = datos?.todosLosCampus || datos?.campus.map((c) => ({ projectId: c.projectId, campus: c.campus })) || [];

  const alternar = (clave: string) => setAbiertos((s) => {
    const n = new Set(s);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    return n;
  });

  const leido = datos ? new Date(datos.leidoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    // El margen de scroll de lo que señala el recorrido: que la barra fija no lo tape.
    <div className="mx-auto max-w-6xl space-y-5 [&_[data-recorrido]]:scroll-mt-40 max-sm:[&_[data-recorrido]]:scroll-mt-64">
      <PageHeader
        title="Mi campus"
        subtitle={leido ? `Tus cursos en Moodle · leído a las ${leido}` : 'Tus cursos en Moodle'}
        actions={(
          <>
            {/* El recorrido (#611): solo con el botón (#681). */}
            <VerRecorrido id="mi-campus" listo={!cargando} compacto />
            {/* En ISEIE «Mis cursos y comisiones» es un enlace, no una pestaña como
                en el 360: el paso del recorrido lo señala a él. */}
            {!soloRedactora && (
            <Link to="/mis-cursos" data-recorrido="mi-campus-comisiones" className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-secundario font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Coins size={14} aria-hidden /> Mis cursos y comisiones
            </Link>
            )}
            <Button data-recorrido="mi-campus-actualizar" variant="outline" size="sm" disabled={cargando} onClick={actualizar} className="h-8 text-secundario">
              <ArrowsClockwise size={14} className={cn('mr-1.5', cargando && 'animate-spin')} aria-hidden />
              {cargando ? 'Leyendo…' : 'Actualizar'}
            </Button>
          </>
        )}
      />

      {error && !datos && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft dark:bg-destructive/15 px-4 py-4">
          <p className="text-normal font-semibold text-foreground">No se ha podido leer tu campus</p>
          <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
          <Button size="sm" className="mt-3 h-8" onClick={() => cargar(true)}>Volver a intentarlo</Button>
        </div>
      )}

      {!datos && cargando && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true" aria-label="Leyendo tu campus">
          <div className="space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-56 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        </div>
      )}

      {datos && (
        <>
          {/* Uno o varios campus (Diego, 24/11): solo con más de uno. */}
          {todosLosCampus.length > 1 && (
            <SelectorCampus todos={todosLosCampus} elegidos={elegidos} cambiar={elegirCampus} cargando={cargando} />
          )}

          {/* Sin ningún campus conectado no se dice «estás al día»: no se sabe. */}
          <Resumen porCorregir={totales.porCorregir} dudas={totales.dudas} porDesarrollar={datos.pendientes.length} conCampus={datos.campus.length > 0} />

          {(datos.sinConectar?.length ?? 0) > 0 && (
            <section aria-labelledby="sin-conectar" data-recorrido="mi-campus-sin-conectar" className="rounded-lg border border-warning/40 bg-warning-soft dark:bg-transparent px-4 py-3">
              <h2 id="sin-conectar" className="flex items-center gap-2 text-normal font-semibold text-warning-soft-foreground">
                <Warning size={15} weight="bold" aria-hidden /> Campus en los que tu cuenta de Moodle no está conectada
              </h2>
              <ul className="mt-2 space-y-1.5">
                {datos.sinConectar!.map((s) => (
                  <li key={s.projectId} className="text-secundario text-foreground">
                    <strong className="font-semibold">{s.campus}:</strong> {s.motivo}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-secundario text-muted-foreground">
                Pide a coordinación que lo revise desde tu ficha de tutora (Tutores › tu nombre › Campus). Hasta entonces no verás ese campus aquí ni te llegarán sus consultas.
              </p>
            </section>
          )}

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className={cn("min-w-0 space-y-6", datos.campus.length === 0 && (datos.sinConectar?.length ?? 0) > 0 && "hidden lg:block")}>
              {datos.campus.length === 0 && !(datos.sinConectar?.length) && (
                <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
                  <GraduationCap size={24} className="mx-auto text-muted-foreground" aria-hidden />
                  <p className="mt-2 text-normal font-semibold text-foreground">Todavía no estás en ningún campus</p>
                  <p className="mx-auto mt-1 max-w-sm text-secundario text-muted-foreground">
                    Cuando administración te dé de alta en el Moodle de un campus, aquí verás tus cursos, lo que tienes por corregir y tus alumnos.
                  </p>
                </div>
              )}

              {/* Lo que hay que hacer, todo junto: responder y corregir sin ir curso a curso. */}
              {(datos.campus.length > 0 || (porResponder?.length ?? 0) > 0) && (
                <section aria-label="Por hacer" data-testid="bandeja-mi-campus" className="rounded-lg border border-border bg-card px-4 py-2">
                  <PorResponder consultas={porResponder} plazoHoras={plazoHoras} error={errorConsultas} respondida={respondida} />
                  <div className="my-1 border-t border-border" />
                  <PorCorregir entregas={porCorregir} />
                </section>
              )}

              {datos.campus.map((c) => (
                <section key={c.projectId} aria-labelledby={`campus-${c.projectId}`} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
                    <h2 id={`campus-${c.projectId}`} className="text-normal font-semibold text-foreground">
                      {c.campus} <span className="font-normal text-muted-foreground">· {plural(c.cursos.length, 'curso', 'cursos')}</span>
                    </h2>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-secundario font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                        Abrir el campus <ArrowSquareOut size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                  {c.error && (
                    <p role="alert" className="m-4 flex items-start gap-2 rounded-md bg-warning-soft dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-warning/35 px-3 py-2 text-secundario text-warning-soft-foreground">
                      <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> {c.error}
                    </p>
                  )}
                  {!c.error && c.cursos.length === 0 && (
                    <p className="px-4 py-8 text-center text-secundario text-muted-foreground">No figuras como profesora en ningún curso de este campus.</p>
                  )}
                  {c.cursos.length > 0 && (
                    <ul className="divide-y divide-border">
                      {c.cursos.map((k) => (
                        <Curso key={k.id} projectId={c.projectId} curso={k} abierto={abiertos.has(`${c.projectId}-${k.id}`)} alternar={() => alternar(`${c.projectId}-${k.id}`)} />
                      ))}
                    </ul>
                  )}
                  {c.dudasSinCurso.length > 0 && (
                    <p className="border-t border-border px-4 py-2.5 text-secundario text-muted-foreground">
                      Y {plural(c.dudasSinCurso.length, 'duda abierta', 'dudas abiertas')} de alumnos que no están en tus cursos ·{' '}
                      <Link to="/consultas" className="font-medium text-primary hover:underline">verlas en Consultas</Link>
                    </p>
                  )}
                </section>
              ))}
            </div>

            <aside className="lg:sticky lg:top-4">
              <PorDesarrollar lista={datos.pendientes} />
            </aside>
          </div>

          {/* Debajo, a todo el ancho (en la columna fija no cabría). Solo se pinta si es
              redactora: lo decide el componente con lo que contesta el servidor. */}
          {SOLO_EN_PRUEBAS && <RedaccionEnMoodle propia />}
        </>
      )}
    </div>
  );
}
