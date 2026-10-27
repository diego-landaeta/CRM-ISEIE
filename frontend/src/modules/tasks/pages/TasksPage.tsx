import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, ArrowsClockwise, Warning, X, SlidersHorizontal, ArrowClockwise, Compass,
  CaretLeft, CaretRight, ChartBar, ListChecks, ArrowLeft,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import RecorridoGuiado, { recorridoPendiente } from '@/shared/components/ui/RecorridoGuiado';
import { CLAVE_RECORRIDO_TABLERO, PASOS_TABLERO } from '../lib/recorridoTablero';
import Select from '@/shared/components/ui/Select';
import { agruparPorEmpresa, campusConEmpresa, empresaCorta } from '../lib/campusPorEmpresa';
import { Button } from '@/shared/components/ui/button';
import { inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import { TaskColumn } from '../components/TaskColumn';
import { TaskModal } from '../components/TaskModal';
import { TeamAreaMetrics, TeamTasksMetrics } from '../components/TeamTasksMetrics';
import { TasksReviewView } from '../components/TasksReviewView';
import {
  DEFAULT_COLUMNS, OPCIONES_VER, PRIORITY, boardColor, filtroDeVista, neighboursAt, puedeEditarTarea, vistaInicialDe,
  type VerTablero,
} from '../lib/taskUi';
import {
  etiquetaDePeriodo, hoyEnOficina, moverReferencia, rangoDePeriodo, textoDelPeriodo, vieneDeAntes, type TipoPeriodo,
} from '../lib/periodo';
import type {
  AreaMetric,
  Assignee,
  TagName,
  Task,
  TaskArea,
  TaskColumn as TaskColumnType,
  TaskExternalProject,
  TaskPriority,
  TaskStatus,
  TeamMemberMetric,
  Team,
  MyTeam,
} from '../types';

/*
 * UN SOLO TABLERO (Diego, 27/10/2026): «Esto tiene que tener fecha de cuándo se
 * creó y cuándo se terminó, y clasificarla en vistas por día, semana y mes, PERO
 * QUE SEA UN SOLO TABLERO TODO Y YA CON FILTROS, NO MÚLTIPLES TABLEROS.»
 *
 * Cuatro columnas con todo lo que se ve según los filtros; nada de un bloque de
 * columnas por persona. La persona es un filtro más. «Ver» (Mis tareas / Mi
 * equipo / Todo) sustituye al selector de antes, y el servidor manda: «Todo»
 * nunca abre más de lo que deja el permiso. «Por revisar» sigue en su ruta.
 */

type Filtros = {
  search: string;
  personaId: number | '';
  equipo: string; // '' = cualquiera, 'sin' = sin equipo, o el id
  projectId: number | '';
  externalProjectId: number | '';
  areaId: number | '';
  priority: TaskPriority | '';
  tag: string;
  vencidas: boolean;
};

const SIN_FILTROS: Filtros = {
  search: '', personaId: '', equipo: '', projectId: '', externalProjectId: '', areaId: '', priority: '', tag: '', vencidas: false,
};

const PERIODOS: ReadonlyArray<{ value: TipoPeriodo; label: string }> = [
  { value: 'dia', label: 'Hoy' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mes' },
  { value: 'todo', label: 'Todo' },
];
const PASO_DE: Record<TipoPeriodo, string> = { dia: 'día', semana: 'semana', mes: 'mes', todo: '' };

const errorDe = (err: unknown) => (err instanceof Error && err.message) ? err.message : 'Error desconocido';

export default function TasksPage() {
  const { user } = useAuth();
  const { projects } = useProjectContext() as { projects: Parameters<typeof campusConEmpresa>[0] };
  const { can } = usePermission();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const yo: number = user?.id ?? 0;
  // Todo por clave (Configuración › Roles), nunca por rol.
  const canViewAll = can('tasks.view_all');
  const canAssign = can('tasks.assign');
  const canArchiveAny = can('tasks.delete');
  const canCreate = can('tasks.create');
  const canClose = can('tasks.close');
  const canManage = can('tasks.manage');
  const canEdit = can('tasks.edit');
  const canViewOwn = can('tasks.view_own');

  // El ámbito (#245, Diego 08/10). En MultiCRM es la empresa o el campus de la
  // cabecera; ISEIE no tiene ese selector, así que el tablero va siempre como
  // allí con «Todos los proyectos»: no se manda nada y el servidor lo acota a
  // los campus de cada persona (`proyectosDelAmbito`, por `user_projects`).
  // Superadmin y soporte, todo.
  const ambito = useMemo<tasksApi.Ambito>(() => ({}), []);

  const enRevisar = location.pathname.endsWith('/tareas/revisar');
  // Al entrar: «Mis tareas» (Diego, 26/10/2026); admin y superadmin, «Todo» del
  // mes en curso (27/10/2026). No se recuerda la última elección.
  const [inicio] = useState(() => vistaInicialDe(user));
  const [ver, setVer] = useState<VerTablero>(inicio.ver);

  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [busqueda, setBusqueda] = useState('');
  // El periodo: el de entrada (arriba); Hoy, Esta semana, Este mes o Todo, y moverse.
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>(inicio.periodo);
  const [referencia, setReferencia] = useState<string>(() => hoyEnOficina());
  const rango = useMemo(() => rangoDePeriodo(tipoPeriodo, referencia), [tipoPeriodo, referencia]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [etiquetas, setEtiquetas] = useState<TagName[]>([]);
  const [areas, setAreas] = useState<TaskArea[]>([]);
  const [proyectosPropios, setProyectosPropios] = useState<TaskExternalProject[]>([]);
  const [columnas, setColumnas] = useState<TaskColumnType[]>([]);
  const [equipos, setEquipos] = useState<Team[]>([]);
  const [misEquipos, setMisEquipos] = useState<MyTeam[]>([]);
  // Las personas que han salido en el tablero: para el filtro de quien no ve la lista del equipo.
  const [personasVistas, setPersonasVistas] = useState<Array<{ id: number; nombre: string }>>([]);

  const [verCifras, setVerCifras] = useState(false);
  const [cifrasPor, setCifrasPor] = useState<'persona' | 'area'>('persona');
  const [metricas, setMetricas] = useState<TeamMemberMetric[]>([]);
  const [metricasArea, setMetricasArea] = useState<AreaMetric[]>([]);
  const [cargandoMetricas, setCargandoMetricas] = useState(false);
  const [porRevisar, setPorRevisar] = useState(0);
  const [arrastrando, setArrastrando] = useState<Task | null>(null);
  const [nueva, setNueva] = useState<{ status: TaskStatus } | null>(null);
  // El recorrido guiado (12/10): solo la primera vez, y cuando se pida con «Recorrido».
  const [recorrido, setRecorrido] = useState(false);

  const teamIdElegido = filtros.equipo === '' ? undefined : filtros.equipo === 'sin' ? 0 : Number(filtros.equipo);

  // Por empresa, no por campus (Diego, 10/10). En MultiCRM, con una empresa o un
  // campus en la cabecera, solo los de esa empresa. En ISEIE no hay cabecera:
  // son todos los campus de la persona, agrupados por empresa (lo mismo que
  // allí con «Todos los proyectos»).
  const misCampus = useMemo(() => campusConEmpresa(projects), [projects]);
  const variasEmpresas = useMemo(() => agruparPorEmpresa(misCampus).length > 1, [misCampus]);
  const opcionesCampus = useMemo(
    () => agruparPorEmpresa(misCampus).flatMap((g) => g.campus.map((c) => ({
      value: c.id as number | '',
      label: variasEmpresas ? `${c.nombre} · ${empresaCorta(g.empresa)}` : c.nombre,
    }))),
    [misCampus, variasEmpresas]
  );
  // Si se cambia de empresa con un campus de la otra en el filtro, se quita.
  useEffect(() => {
    if (filtros.projectId && !misCampus.some((c) => c.id === filtros.projectId)) {
      setFiltros((f) => ({ ...f, projectId: '' }));
    }
  }, [misCampus, filtros.projectId]);
  const areasActivas = useMemo(() => areas.filter((a) => a.is_active), [areas]);
  const proyectosActivos = useMemo(() => proyectosPropios.filter((p) => p.is_active), [proyectosPropios]);

  // Quien solo ve lo suyo (sin «Ver todo», sin asignar y sin equipos): la persona es él.
  const soloLoSuyo = !canViewAll && !canAssign && misEquipos.length === 0;

  // La tarea abierta va en la URL (?id=): los avisos de la campana y del
  // correo abren justo esa tarjeta.
  const abiertaId = Number(searchParams.get('id')) || null;
  const abrir = (id: number) => setSearchParams((p) => { p.set('id', String(id)); return p; });
  const cerrar = useCallback(() => {
    setNueva(null);
    setSearchParams((p) => { p.delete('id'); return p; });
  }, [setSearchParams]);

  // La búsqueda espera a que se deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => (f.search === busqueda ? f : { ...f, search: busqueda })), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const cargarTareas = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      if (enRevisar) {
        setTasks(await tasksApi.getReviewTasks(ambito));
      } else {
        const lista = await tasksApi.getTasks({
          // Lo mío y lo de mi equipo son míos, esté donde esté: el ámbito de
          // arriba solo acota «Todo».
          ...(ver === 'todo' ? ambito : {}),
          ...filtroDeVista(ver),
          team_id: teamIdElegido,
          assigned_to: filtros.personaId || undefined,
          search: filtros.search.trim() || undefined,
          project_id: filtros.projectId || undefined,
          external_project_id: filtros.externalProjectId || undefined,
          area_id: filtros.areaId || undefined,
          priority: filtros.priority || undefined,
          tag: filtros.tag || undefined,
          vencidas: filtros.vencidas || undefined,
          periodo_desde: rango?.desde,
          periodo_hasta: rango?.hasta,
        });
        setTasks(lista);
        setPersonasVistas((antes) => {
          const mapa = new Map(antes.map((p) => [p.id, p]));
          for (const t of lista) if (t.assigned_to && t.assigned_to_name) mapa.set(t.assigned_to, { id: t.assigned_to, nombre: t.assigned_to_name });
          return mapa.size === antes.length ? antes : [...mapa.values()];
        });
      }
    } catch (err) {
      // Un error no es un tablero vacío: se dice y se puede reintentar.
      setTasks([]);
      setErrorCarga(errorDe(err));
    } finally {
      setCargando(false);
    }
  }, [enRevisar, ver, filtros, ambito, teamIdElegido, rango]);

  // Lo que no cambia al arrastrar: se pide al entrar y al volver de configurar.
  const cargarCatalogos = useCallback(() => {
    tasksApi.getAreas().then(setAreas).catch(() => setAreas([]));
    tasksApi.getExternalProjects().then(setProyectosPropios).catch(() => setProyectosPropios([]));
    tasksApi.getColumns().then(setColumnas).catch(() => setColumnas([]));
    if (canViewAll || canAssign) tasksApi.getAssignees(ambito).then(setAssignees).catch(() => setAssignees([]));
    tasksApi.getTeams().then(setEquipos).catch(() => setEquipos([]));
    tasksApi.getMyTeams().then(setMisEquipos).catch(() => setMisEquipos([]));
  }, [canViewAll, canAssign, ambito]);

  const cargarEtiquetas = useCallback(() => {
    tasksApi.getTagNames(ambito).then(setEtiquetas).catch(() => setEtiquetas([]));
  }, [ambito]);

  const conCifras = verCifras && canViewAll && ver === 'todo' && !enRevisar;
  const cargarMetricas = useCallback(async () => {
    if (!conCifras) return;
    setCargandoMetricas(true);
    try {
      const pid = filtros.projectId || undefined;
      const [personas, porArea] = await Promise.all([
        tasksApi.getTeamMetrics(pid, filtros.areaId || undefined, ambito),
        tasksApi.getTeamMetricsByArea(pid, ambito),
      ]);
      setMetricas(personas);
      setMetricasArea(porArea);
    } catch (err) {
      toast({ title: 'No se pudieron cargar las cifras del equipo', description: errorDe(err), variant: 'destructive' });
    } finally {
      setCargandoMetricas(false);
    }
  }, [conCifras, filtros.projectId, filtros.areaId, ambito]);

  const cargarPorRevisar = useCallback(async () => {
    try {
      setPorRevisar((await tasksApi.getReviewCount(ambito)).count);
    } catch {
      setPorRevisar(0);
    }
  }, [ambito]);

  useEffect(() => { cargarTareas(); }, [cargarTareas]);
  useEffect(() => { cargarCatalogos(); cargarEtiquetas(); }, [cargarCatalogos, cargarEtiquetas]);
  useEffect(() => { cargarMetricas(); }, [cargarMetricas]);
  useEffect(() => { cargarPorRevisar(); }, [cargarPorRevisar]);

  const refrescar = useCallback(() => {
    cargarTareas();
    cargarMetricas();
    cargarPorRevisar();
    cargarEtiquetas();
  }, [cargarTareas, cargarMetricas, cargarPorRevisar, cargarEtiquetas]);

  // Las columnas activas, en el orden que se les dio en «Configurar tablero».
  const columnasActivas = useMemo(() => {
    const activas = columnas.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order);
    if (activas.length === 0) return DEFAULT_COLUMNS;
    return activas.map((c) => ({ key: c.key as TaskStatus, label: c.name, dot: boardColor(c.color).dot, head: boardColor(c.color).head }));
  }, [columnas]);
  const nombreColumna = (key: string) => columnasActivas.find((c) => c.key === key)?.label || key;

  // Arrastrar es mover (26/10/2026): lo dice el servidor de cada tarjeta
  // (el responsable, el supervisor o un superadmin). Sin el dato, la regla de antes.
  const puedeArrastrar = (t: Task) => (t.puede_mover ?? puedeEditarTarea(t, yo, { edit: canEdit, viewAll: canViewAll }))
    && (canClose || t.status !== 'hecha' || user?.role === 'superadmin' || t.supervisor_id === yo);

  function empezarArrastre(e: DragEvent<HTMLDivElement>, t: Task) {
    setArrastrando(t);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(t.id));
  }

  async function soltar(columna: Task[], status: TaskStatus, index: number) {
    const t = arrastrando;
    setArrastrando(null);
    if (!t) return;

    // La regla de «Hecha», también aquí para no hacer un viaje que el servidor rechazaría.
    if (status === 'hecha' && t.status !== 'hecha' && !canClose) {
      toast({ title: 'No puedes cerrar tareas', description: 'Llévala a «En revisión» y la revisarán.', variant: 'destructive' });
      return;
    }
    // El orden de una columna es el de cada responsable (el servidor ordena por
    // persona): en el tablero único, las vecinas son las de la misma persona.
    const deLaPersona = columna.filter((x) => x.assigned_to === t.assigned_to);
    const indice = columna.slice(0, index).filter((x) => x.assigned_to === t.assigned_to).length;
    const vecinas = neighboursAt(deLaPersona, indice, t.id);
    if (!vecinas && status === t.status) return; // se soltó donde estaba

    // Se pinta ya en su sitio y luego se confirma con el servidor.
    const pos = (id: number | null | undefined) => tasks.find((x) => x.id === id)?.position;
    const prev = pos(vecinas?.prev_id);
    const next = pos(vecinas?.next_id);
    const provisional = prev != null && next != null ? (prev + next) / 2
      : prev != null ? prev + 1000 : next != null ? next / 2 : Number.MAX_SAFE_INTEGER;
    const antes = tasks;
    setTasks((ts) => ts
      .map((x) => (x.id === t.id ? { ...x, status, position: provisional } : x))
      .sort((a, b) => a.position - b.position));

    try {
      await tasksApi.moveTask(t.id, { status, prev_id: vecinas?.prev_id ?? null, next_id: vecinas?.next_id ?? null });
      if (status !== t.status) toast({ title: `Movida a «${nombreColumna(status)}»` });
      cargarTareas();
      if (status === 'en_revision' || t.status === 'en_revision') cargarPorRevisar();
    } catch (err) {
      setTasks(antes);
      toast({ title: 'No se pudo mover la tarea', description: errorDe(err), variant: 'destructive' });
    }
  }

  useEffect(() => {
    if (cargando || enRevisar || !recorridoPendiente(CLAVE_RECORRIDO_TABLERO)) return undefined;
    const t = setTimeout(() => setRecorrido(true), 800);
    return () => clearTimeout(t);
  }, [cargando, enRevisar]);

  // Las opciones de cada filtro.
  const opcionesPersona = useMemo(() => {
    const base = assignees.length > 0 ? assignees.map((a) => ({ id: a.id, nombre: a.nombre })) : personasVistas;
    const yoMismo = { id: yo, nombre: user?.nombre || 'Yo' };
    const lista = base.some((p) => p.id === yo) ? base : [yoMismo, ...base];
    return [...lista].sort((a, b) => (a.id === yo ? -1 : b.id === yo ? 1 : a.nombre.localeCompare(b.nombre, 'es')))
      .map((p) => ({ value: p.id as number | '', label: p.id === yo ? `${p.nombre} (yo)` : p.nombre }));
  }, [assignees, personasVistas, yo, user?.nombre]);
  const nombreEquipo = (e: Team) => (equipos.some((o) => o.id !== e.id && o.name === e.name) ? `${e.name} · ${empresaCorta(e.empresa)}` : e.name);
  const equiposActivos = equipos.filter((e) => e.is_active);

  // Los filtros activos, para verlos y quitarlos uno a uno.
  const activos: Array<{ clave: string; texto: string; quitar: () => void }> = [];
  const quitar = (k: keyof Filtros) => () => {
    if (k === 'search') setBusqueda('');
    setFiltros((f) => ({ ...f, [k]: SIN_FILTROS[k] }));
  };
  if (filtros.search) activos.push({ clave: 'search', texto: `«${filtros.search}»`, quitar: quitar('search') });
  if (filtros.personaId) activos.push({ clave: 'persona', texto: `Persona: ${opcionesPersona.find((o) => o.value === filtros.personaId)?.label || '…'}`, quitar: quitar('personaId') });
  if (filtros.equipo) {
    const e = equipos.find((x) => String(x.id) === filtros.equipo);
    activos.push({ clave: 'equipo', texto: `Equipo: ${filtros.equipo === 'sin' ? 'sin equipo' : e ? nombreEquipo(e) : '…'}`, quitar: quitar('equipo') });
  }
  if (filtros.areaId) activos.push({ clave: 'area', texto: `Área: ${areasActivas.find((a) => a.id === filtros.areaId)?.name || '…'}`, quitar: quitar('areaId') });
  if (filtros.tag) activos.push({ clave: 'tag', texto: `Etiqueta: ${filtros.tag}`, quitar: quitar('tag') });
  if (filtros.priority) activos.push({ clave: 'prioridad', texto: `Prioridad: ${PRIORITY[filtros.priority].label.toLowerCase()}`, quitar: quitar('priority') });
  if (filtros.projectId) activos.push({ clave: 'campus', texto: `Campus: ${opcionesCampus.find((o) => o.value === filtros.projectId)?.label || '…'}`, quitar: quitar('projectId') });
  if (filtros.externalProjectId) activos.push({ clave: 'propio', texto: `Proyecto: ${proyectosActivos.find((p) => p.id === filtros.externalProjectId)?.name || '…'}`, quitar: quitar('externalProjectId') });
  if (filtros.vencidas) activos.push({ clave: 'vencidas', texto: 'Solo vencidas', quitar: quitar('vencidas') });
  if (rango) activos.push({ clave: 'periodo', texto: etiquetaDePeriodo(tipoPeriodo, rango), quitar: () => setTipoPeriodo('todo') });

  function quitarFiltros() {
    setFiltros(SIN_FILTROS);
    setBusqueda('');
    setTipoPeriodo('todo');
    setReferencia(hoyEnOficina());
  }

  function elegirPeriodo(tipo: TipoPeriodo) {
    setTipoPeriodo(tipo);
    setReferencia(hoyEnOficina());
  }

  // Al crear con una persona filtrada (y pudiendo asignar), es para ella.
  const defaultAssigneeId = filtros.personaId && canAssign ? Number(filtros.personaId) : yo;

  // Sin «Ver lo suyo» ni «Ver todo» (Configuración › Roles), el servidor no da
  // tablero: se dice en vez de enseñar un error de carga.
  if (!canViewOwn && !canViewAll && !canClose) {
    return (
      <div className="space-y-4">
        <PageHeader title="Tablero de tareas" />
        <p className="text-sm text-muted-foreground">
          Tu rol no tiene acceso al tablero de tareas. Si lo necesitas, pídeselo a quien gestiona los roles.
        </p>
      </div>
    );
  }

  const subtitulo = enRevisar ? 'Las tareas «En revisión» de todo el equipo, por fecha límite'
    : ver === 'mias' ? 'Lo que llevas, lo que supervisas y lo que creaste'
      : ver === 'equipo' ? 'Lo tuyo y lo de tus equipos' : 'Todo lo que puedes ver del equipo';

  return (
    <div className="space-y-4">
      <PageHeader
        title={enRevisar ? 'Por revisar' : 'Tablero de tareas'}
        subtitle={subtitulo}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {enRevisar ? (
              <Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/tareas')} aria-label="Volver al tablero">
                <ArrowLeft size={15} className="sm:mr-1.5" /> <span className="hidden sm:inline">Volver al tablero</span>
              </Button>
            ) : (canClose || porRevisar > 0) && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/tareas/revisar')} aria-label={`Por revisar (${porRevisar})`}>
                <ListChecks size={15} className="sm:mr-1.5" /> <span className="hidden sm:inline">Por revisar </span>({porRevisar})
              </Button>
            )}
            {canManage && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/tareas/configurar')} data-recorrido="configurar" aria-label="Configurar tablero">
                <SlidersHorizontal size={15} className="sm:mr-1.5" /> <span className="hidden sm:inline">Configurar tablero</span>
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9" onClick={() => setRecorrido(true)} title="Un recorrido por el tablero, paso a paso" aria-label="Recorrido">
              <Compass size={15} className="sm:mr-1.5" /> <span className="hidden sm:inline">Recorrido</span>
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={refrescar} aria-label="Recargar">
              <ArrowsClockwise size={16} />
            </Button>
            {canCreate && !enRevisar && (
              <Button size="sm" className="h-9" onClick={() => setNueva({ status: 'por_hacer' })} data-recorrido="nueva">
                <Plus size={15} weight="bold" className="mr-1.5" /> <span className="hidden sm:inline">Nueva tarea</span><span className="sm:hidden">Nueva</span>
              </Button>
            )}
          </div>
        )}
      />

      {!enRevisar && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-2.5" data-recorrido="filtros">
          {/* Los filtros, en una sola fila (se parte en el móvil) y combinables. */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros del tablero">
            <div className="relative flex-1 min-w-[11rem]">
              <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en título o descripción…"
                aria-label="Buscar" className={`${inputClass} pl-9`} />
            </div>
            <span data-recorrido="vista">
              <Select<VerTablero> value={ver} onChange={setVer} options={[...OPCIONES_VER]} ariaLabel="Ver" size="sm" className="w-36" />
            </span>
            <Select<number | ''>
              value={soloLoSuyo ? yo : filtros.personaId}
              onChange={(v) => setFiltros((f) => ({ ...f, personaId: v }))}
              options={[{ value: '', label: 'Cualquier persona' }, ...opcionesPersona]}
              disabled={soloLoSuyo}
              ariaLabel="Persona" size="sm" className="w-44"
            />
            {equiposActivos.length > 0 && (
              <Select<string>
                value={filtros.equipo}
                onChange={(v) => setFiltros((f) => ({ ...f, equipo: v }))}
                options={[
                  { value: '', label: 'Cualquier equipo' },
                  ...equiposActivos.map((e) => ({ value: String(e.id), label: nombreEquipo(e) })),
                  { value: 'sin', label: 'Sin equipo' },
                ]}
                ariaLabel="Equipo" size="sm" className="w-44"
              />
            )}
            {areasActivas.length > 0 && (
              <Select<number | ''>
                value={filtros.areaId}
                onChange={(v) => setFiltros((f) => ({ ...f, areaId: v }))}
                options={[{ value: '', label: 'Cualquier área' }, ...areasActivas.map((a) => ({ value: a.id as number | '', label: a.name }))]}
                ariaLabel="Área" size="sm" className="w-44"
              />
            )}
            <Select<string>
              value={filtros.tag}
              onChange={(v) => setFiltros((f) => ({ ...f, tag: v }))}
              options={[{ value: '', label: 'Cualquier etiqueta' }, ...etiquetas.map((t) => ({ value: t.name, label: `${t.name} (${t.total})` }))]}
              ariaLabel="Etiqueta" size="sm" className="w-40"
            />
            <Select<TaskPriority | ''>
              value={filtros.priority}
              onChange={(v) => setFiltros((f) => ({ ...f, priority: v }))}
              options={[{ value: '', label: 'Cualquier prioridad' }, ...(['alta', 'media', 'baja'] as const).map((p) => ({ value: p as TaskPriority | '', label: PRIORITY[p].label }))]}
              ariaLabel="Prioridad" size="sm" className="w-40"
            />
            <Select<number | ''>
              value={filtros.projectId}
              onChange={(v) => setFiltros((f) => ({ ...f, projectId: v }))}
              options={[{ value: '', label: 'Cualquier campus' }, ...opcionesCampus]}
              ariaLabel="Campus" size="sm" className="w-44"
            />
            {proyectosActivos.length > 0 && (
              <Select<number | ''>
                value={filtros.externalProjectId}
                onChange={(v) => setFiltros((f) => ({ ...f, externalProjectId: v }))}
                options={[{ value: '', label: 'Cualquier proyecto propio' }, ...proyectosActivos.map((p) => ({ value: p.id as number | '', label: p.name }))]}
                ariaLabel="Proyecto propio" size="sm" className="w-48"
              />
            )}
            <Button type="button" variant={filtros.vencidas ? 'default' : 'outline'} size="sm" className="h-9" aria-pressed={filtros.vencidas}
              onClick={() => setFiltros((f) => ({ ...f, vencidas: !f.vencidas }))}>
              <Warning size={14} className="mr-1.5" /> Solo vencidas
            </Button>

            {/* El periodo: la «vista por día, semana y mes». */}
            <div className="flex flex-wrap items-center gap-1.5" data-recorrido="periodo">
              <div role="tablist" aria-label="Periodo" className="inline-flex bg-muted p-0.5 rounded-md text-xs">
                {PERIODOS.map((p) => (
                  <button key={p.value} type="button" role="tab" aria-selected={tipoPeriodo === p.value}
                    onClick={() => elegirPeriodo(p.value)}
                    className={`px-2.5 py-1.5 rounded font-medium whitespace-nowrap ${tipoPeriodo === p.value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {tipoPeriodo !== 'todo' && (
                <>
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`${PASO_DE[tipoPeriodo]} anterior`}
                    title={`${PASO_DE[tipoPeriodo]} anterior`}
                    onClick={() => setReferencia((r) => moverReferencia(tipoPeriodo, r, -1))}>
                    <CaretLeft size={14} />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`${PASO_DE[tipoPeriodo]} siguiente`}
                    title={`${PASO_DE[tipoPeriodo]} siguiente`}
                    onClick={() => setReferencia((r) => moverReferencia(tipoPeriodo, r, 1))}>
                    <CaretRight size={14} />
                  </Button>
                </>
              )}
              <div className="w-36">
                <input type="date" aria-label="Ir a la fecha" value={tipoPeriodo === 'todo' ? '' : referencia}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setReferencia(e.target.value);
                    if (tipoPeriodo === 'todo') setTipoPeriodo('dia');
                  }}
                  className={`${inputClass} !h-8`} />
              </div>
            </div>
          </div>

          {/* Lo que hay: el periodo y sus cuentas, y los filtros activos. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <p className="text-muted-foreground" aria-live="polite" data-testid="resumen-periodo">
              {cargando ? 'Cargando…' : textoDelPeriodo(tipoPeriodo, rango, tasks)}
            </p>
            {activos.map((a) => (
              <span key={a.clave} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 pl-2.5 pr-1 py-0.5">
                {a.texto}
                <button type="button" onClick={a.quitar} aria-label={`Quitar ${a.texto}`} className="rounded-full p-0.5 hover:bg-muted">
                  <X size={11} />
                </button>
              </span>
            ))}
            {activos.length > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={quitarFiltros}>
                <X size={12} className="mr-1" /> Quitar filtros
              </Button>
            )}
            {canViewAll && ver === 'todo' && (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs ml-auto" aria-pressed={verCifras}
                onClick={() => setVerCifras((v) => !v)} data-recorrido="metricas">
                <ChartBar size={13} className="mr-1" /> {verCifras ? 'Ocultar cifras' : 'Cifras del equipo'}
              </Button>
            )}
          </div>
        </div>
      )}

      {enRevisar ? (
        <TasksReviewView
          tasks={tasks}
          loading={cargando}
          error={errorCarga}
          onRetry={cargarTareas}
          onOpenTask={(t) => abrir(t.id)}
          onChanged={refrescar}
        />
      ) : errorCarga ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft text-destructive-soft-foreground p-6 text-center space-y-3">
          <p className="font-semibold text-sm">No se pudieron cargar las tareas</p>
          <p className="text-xs">{errorCarga}</p>
          <Button size="sm" variant="outline" onClick={cargarTareas}>
            <ArrowClockwise size={14} className="mr-1.5" /> Reintentar
          </Button>
        </div>
      ) : (
        <>
          {conCifras && (
            <div className="space-y-2">
              <div role="tablist" aria-label="Cifras por" className="inline-flex bg-muted p-0.5 rounded-md text-xs">
                {(['persona', 'area'] as const).map((g) => (
                  <button key={g} type="button" role="tab" aria-selected={cifrasPor === g} onClick={() => setCifrasPor(g)}
                    className={`px-3 py-1 rounded font-medium ${cifrasPor === g ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    Por {g === 'persona' ? 'persona' : 'área'}
                  </button>
                ))}
              </div>
              {/* Pulsar una fila no abre otro tablero: filtra este. */}
              {cifrasPor === 'persona' ? (
                <TeamTasksMetrics metrics={metricas} loading={cargandoMetricas} onSelectUser={(id) => setFiltros((f) => ({ ...f, personaId: id }))} />
              ) : (
                <TeamAreaMetrics metrics={metricasArea} loading={cargandoMetricas} onSelectArea={(id) => setFiltros((f) => ({ ...f, areaId: id ?? '' }))} />
              )}
            </div>
          )}

          {cargando && tasks.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Cargando el tablero…</p>
          ) : (
            <section aria-label="Tablero" data-testid="tablero-unico" className="space-y-2">
              {tasks.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-2">
                  {activos.length > 0 ? 'Ninguna tarea cumple esos filtros.' : 'No hay tareas que enseñar.'}
                </p>
              )}
              <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory sm:snap-none -mx-4 px-4 lg:mx-0 lg:px-0" data-recorrido="columnas">
                {columnasActivas.map((col) => {
                  const columna = tasks.filter((t) => t.status === col.key);
                  return (
                    <TaskColumn
                      key={col.key}
                      status={col.key}
                      label={col.label}
                      dot={col.dot}
                      head={col.head}
                      tasks={columna}
                      dragging={arrastrando}
                      canCreate={canCreate}
                      canDragTask={puedeArrastrar}
                      showAssignee
                      conEquipos={equipos.length > 0}
                      vieneDe={(t) => vieneDeAntes(t, rango)}
                      onOpen={(t) => abrir(t.id)}
                      onAdd={(status) => setNueva({ status })}
                      onDragStart={empezarArrastre}
                      onDragEnd={() => setArrastrando(null)}
                      onDropAt={(status, index) => soltar(columna, status, index)}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {recorrido && (
        <RecorridoGuiado pasos={PASOS_TABLERO} clave={CLAVE_RECORRIDO_TABLERO} alCerrar={() => setRecorrido(false)} />
      )}

      <TaskModal
        open={abiertaId != null || nueva != null}
        taskId={abiertaId}
        initialStatus={nueva?.status}
        initialProjectId={filtros.projectId || null}
        defaultAssigneeId={defaultAssigneeId}
        onClose={cerrar}
        onChanged={refrescar}
        currentUserId={yo}
        canAssign={canAssign}
        canEdit={canEdit}
        canViewAll={canViewAll}
        canArchiveAny={canArchiveAny}
        canClose={canClose}
        assignees={assignees}
        projects={misCampus}
        areas={areasActivas}
        externalProjects={proyectosActivos}
        columns={columnas.filter((c) => c.is_active)}
        equipos={equipos}
        misEquipos={misEquipos}
        initialTeamId={teamIdElegido ? teamIdElegido : null}
        esSuperadmin={user?.role === 'superadmin'}
      />
    </div>
  );
}
