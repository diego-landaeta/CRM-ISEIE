import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, MagnifyingGlass, ArrowsClockwise, Warning, X, SlidersHorizontal, ArrowClockwise, Compass } from '@phosphor-icons/react';
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
import { avatarColorFor, getInitials, inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import { TaskColumn } from '../components/TaskColumn';
import { TaskModal } from '../components/TaskModal';
import { TeamAreaMetrics, TeamTasksMetrics } from '../components/TeamTasksMetrics';
import { TasksReviewView } from '../components/TasksReviewView';
import { DEFAULT_COLUMNS, PRIORITY, boardColor, neighboursAt, puedeEditarTarea } from '../lib/taskUi';
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

// «Mi tablero» por defecto. Con permiso: «Por revisar» (su propia ruta,
// /tareas/revisar, para que el menú lleve directo), «Todo el equipo» o una
// persona concreta.
type Vista = 'mio' | 'revisar' | 'equipo' | number;
type Agrupar = 'persona' | 'area';

type Filtros = {
  search: string;
  projectId: number | '';
  externalProjectId: number | '';
  areaId: number | '';
  priority: TaskPriority | '';
  tag: string;
  vencidas: boolean;
  desde: string;
  hasta: string;
};

const SIN_FILTROS: Filtros = {
  search: '', projectId: '', externalProjectId: '', areaId: '', priority: '', tag: '', vencidas: false, desde: '', hasta: '',
};

type Carril = { id: string; titulo: string; color?: string | null; userId: number | null; tasks: Task[] };

const errorDe = (err: unknown) => (err instanceof Error && err.message) ? err.message : 'Error desconocido';

const CLAVE_EQUIPO = 'tareas.equipo';

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
  // Quien ve todo (superadmin, admin) entra en «Todo el equipo»; el resto, en lo
  // suyo (Diego, 09/10). Los permisos pueden llegar después del primer render:
  // hasta que la persona elija otra vista, se sigue esa regla.
  const [vistaTablero, setVistaTablero] = useState<Exclude<Vista, 'revisar'>>(canViewAll ? 'equipo' : 'mio');
  const vistaElegida = useRef(false);
  useEffect(() => {
    if (!vistaElegida.current) setVistaTablero(canViewAll ? 'equipo' : 'mio');
  }, [canViewAll]);
  const vista: Vista = enRevisar ? 'revisar' : vistaTablero;
  const [agrupar, setAgrupar] = useState<Agrupar>('persona');

  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [busqueda, setBusqueda] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [etiquetas, setEtiquetas] = useState<TagName[]>([]);
  const [areas, setAreas] = useState<TaskArea[]>([]);
  const [proyectosPropios, setProyectosPropios] = useState<TaskExternalProject[]>([]);
  const [columnas, setColumnas] = useState<TaskColumnType[]>([]);
  // Los equipos (26/10/2026): los que se ven, los suyos con su cargo, y el
  // elegido arriba —«Todos mis equipos», uno, o «Sin equipo»—, recordado aquí.
  const [equipos, setEquipos] = useState<Team[]>([]);
  const [misEquipos, setMisEquipos] = useState<MyTeam[]>([]);
  const [equipoElegido, setEquipoElegido] = useState<string>(() => {
    try { return localStorage.getItem(CLAVE_EQUIPO) || ''; } catch { return ''; }
  });
  const elegirEquipo = (v: string) => {
    setEquipoElegido(v);
    try { localStorage.setItem(CLAVE_EQUIPO, v); } catch { /* sin almacenamiento: solo esta vez */ }
  };
  const teamIdElegido = equipoElegido === '' ? undefined : equipoElegido === 'sin' ? 0 : Number(equipoElegido);

  const [metricas, setMetricas] = useState<TeamMemberMetric[]>([]);
  const [metricasArea, setMetricasArea] = useState<AreaMetric[]>([]);
  const [cargandoMetricas, setCargandoMetricas] = useState(false);
  const [porRevisar, setPorRevisar] = useState(0);
  const [arrastrando, setArrastrando] = useState<Task | null>(null);
  const [nueva, setNueva] = useState<{ status: TaskStatus } | null>(null);
  // El recorrido guiado (12/10): solo la primera vez, y cuando se pida con «Recorrido».
  const [recorrido, setRecorrido] = useState(false);

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
      if (vista === 'revisar') {
        setTasks(await tasksApi.getReviewTasks(ambito));
      } else {
        const assignedTo = vista === 'mio' ? yo : vista === 'equipo' ? undefined : vista;
        setTasks(await tasksApi.getTasks({
          // Mi tablero es mío, esté donde esté: el ámbito solo acota al equipo.
          ...(vista === 'mio' ? {} : ambito),
          assigned_to: assignedTo || undefined,
          team_id: teamIdElegido,
          search: filtros.search.trim() || undefined,
          project_id: filtros.projectId || undefined,
          external_project_id: filtros.externalProjectId || undefined,
          area_id: filtros.areaId || undefined,
          priority: filtros.priority || undefined,
          tag: filtros.tag || undefined,
          vencidas: filtros.vencidas || undefined,
          desde: filtros.desde || undefined,
          hasta: filtros.hasta || undefined,
        }));
      }
    } catch (err) {
      // Un error no es un tablero vacío: se dice y se puede reintentar.
      setTasks([]);
      setErrorCarga(errorDe(err));
    } finally {
      setCargando(false);
    }
  }, [vista, yo, filtros, ambito, teamIdElegido]);

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

  const cargarMetricas = useCallback(async () => {
    if (vista !== 'equipo' || !canViewAll) return;
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
      toast({ title: 'No se pudieron cargar las métricas del equipo', description: errorDe(err), variant: 'destructive' });
    } finally {
      setCargandoMetricas(false);
    }
  }, [vista, canViewAll, filtros.projectId, filtros.areaId, ambito]);

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

  // Los carriles: uno solo, o en «Todo el equipo» uno por persona o por área.
  const carriles: Carril[] = useMemo(() => {
    if (vista === 'revisar') return [];
    if (vista !== 'equipo') {
      const titulo = vista === 'mio' ? 'Mi tablero' : assignees.find((a) => a.id === vista)?.nombre || '';
      return [{ id: 'unico', titulo, userId: vista === 'mio' ? yo : vista, tasks }];
    }
    const grupos = new Map<string, Carril>();
    for (const t of tasks) {
      const porArea = agrupar === 'area';
      const id = porArea ? `a${t.area_id ?? 0}` : `u${t.assigned_to ?? 0}`;
      if (!grupos.has(id)) {
        grupos.set(id, porArea
          ? { id, titulo: t.area_name || 'Sin área', color: t.area_color, userId: null, tasks: [] }
          : { id, titulo: t.assigned_to_name || 'Sin responsable', userId: t.assigned_to, tasks: [] });
      }
      grupos.get(id)!.tasks.push(t);
    }
    return [...grupos.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  }, [vista, tasks, assignees, yo, agrupar]);

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
    const vecinas = neighboursAt(columna, index, t.id);
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

  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(SIN_FILTROS);

  const opcionesVista: Array<{ value: Vista; label: string }> = [
    { value: 'mio', label: 'Mi tablero' },
    ...(canClose || porRevisar > 0 ? [{ value: 'revisar' as Vista, label: `Por revisar (${porRevisar})` }] : []),
    ...(canViewAll || misEquipos.length > 0 ? [{ value: 'equipo' as Vista, label: canViewAll ? 'Todo el equipo' : 'Mis equipos' }] : []),
    ...(canViewAll ? assignees.filter((a) => a.id !== yo).map((a) => ({ value: a.id as Vista, label: a.nombre })) : []),
  ];
  useEffect(() => {
    if (cargando || vista === 'revisar' || !recorridoPendiente(CLAVE_RECORRIDO_TABLERO)) return undefined;
    const t = setTimeout(() => setRecorrido(true), 800);
    return () => clearTimeout(t);
  }, [cargando, vista]);

  function cambiarVista(v: Vista) {
    if (v === 'revisar') { navigate('/tareas/revisar'); return; }
    vistaElegida.current = true;
    setVistaTablero(v);
    if (enRevisar) navigate('/tareas');
  }

  // Al crear desde el tablero de otra persona, el responsable es esa persona.
  const defaultAssigneeId = typeof vista === 'number' ? vista : yo;

  // Sin «Ver lo suyo» ni «Ver todo» (Configuración › Roles), el servidor no da
  // tablero: se dice en vez de enseñar un error de carga.
  if (!canViewOwn && !canViewAll && !canClose) {
    return (
      <div className="space-y-4">
        <PageHeader title="Equipo de Desarrollo" />
        <p className="text-sm text-muted-foreground">
          Tu rol no tiene acceso al tablero de tareas. Si lo necesitas, pídeselo a quien gestiona los roles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={vista === 'revisar' ? 'Por revisar' : 'Equipo de Desarrollo'}
        subtitle={
          vista === 'revisar' ? 'Las tareas «En revisión» de todo el equipo, por fecha límite'
            : vista === 'equipo' ? `Todo el equipo, por ${agrupar === 'area' ? 'área' : 'persona'}`
              : 'Arrastra las tarjetas para avanzar o reordenarlas'
        }
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {equipos.length > 0 && vista !== 'revisar' && (
              <Select<string>
                value={equipoElegido}
                onChange={elegirEquipo}
                options={[
                  { value: '', label: 'Todos mis equipos' },
                  ...equipos.filter((e) => e.is_active).map((e) => ({
                    value: String(e.id),
                    label: equipos.some((o) => o.id !== e.id && o.name === e.name) ? `${e.name} · ${empresaCorta(e.empresa)}` : e.name,
                  })),
                  { value: 'sin', label: 'Sin equipo' },
                ]}
                ariaLabel="Qué equipo ver"
                size="sm"
                className="w-52"
              />
            )}
            {opcionesVista.length > 1 && (
              <span data-recorrido="vista">
                <Select<Vista> value={vista} onChange={cambiarVista} options={opcionesVista} ariaLabel="Qué tablero ver" size="sm" className="w-48" />
              </span>
            )}
            {canManage && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/tareas/configurar')} data-recorrido="configurar">
                <SlidersHorizontal size={15} className="mr-1.5" /> Configurar tablero
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9" onClick={() => setRecorrido(true)} title="Un recorrido por el tablero, paso a paso">
              <Compass size={15} className="mr-1.5" /> Recorrido
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={refrescar} aria-label="Recargar">
              <ArrowsClockwise size={16} />
            </Button>
            {canCreate && vista !== 'revisar' && (
              <Button size="sm" className="h-9" onClick={() => setNueva({ status: 'por_hacer' })} data-recorrido="nueva">
                <Plus size={15} weight="bold" className="mr-1.5" /> Nueva tarea
              </Button>
            )}
          </div>
        )}
      />

      {vista !== 'revisar' && (
        <>
          {/* El tablero se divide por áreas (Meta, WEB · WordPress · SEO…). */}
          {areasActivas.length > 0 && (
            <div role="tablist" aria-label="Áreas" className="flex flex-wrap gap-1.5" data-recorrido="areas">
              {[{ id: '' as number | '', name: 'Todas las áreas', color: null as string | null }, ...areasActivas].map((a) => {
                const activa = filtros.areaId === a.id;
                return (
                  <button
                    key={String(a.id)}
                    type="button"
                    role="tab"
                    aria-selected={activa}
                    onClick={() => setFiltros((f) => ({ ...f, areaId: a.id }))}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      activa ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'
                    }`}
                  >
                    {a.color && <span className={`w-2 h-2 rounded-full ${boardColor(a.color).dot}`} aria-hidden />}
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-2" data-recorrido="filtros">
            <div className="relative flex-1 min-w-[12rem]">
              <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en título o descripción…"
                aria-label="Buscar" className={`${inputClass} pl-9`} />
            </div>
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
            <Select<TaskPriority | ''>
              value={filtros.priority}
              onChange={(v) => setFiltros((f) => ({ ...f, priority: v }))}
              options={[{ value: '', label: 'Cualquier prioridad' }, ...(['alta', 'media', 'baja'] as const).map((p) => ({ value: p as TaskPriority | '', label: PRIORITY[p].label }))]}
              ariaLabel="Prioridad" size="sm" className="w-40"
            />
            <Select<string>
              value={filtros.tag}
              onChange={(v) => setFiltros((f) => ({ ...f, tag: v }))}
              options={[{ value: '', label: 'Cualquier etiqueta' }, ...etiquetas.map((t) => ({ value: t.name, label: `${t.name} (${t.total})` }))]}
              ariaLabel="Etiqueta" size="sm" className="w-40"
            />
            <label className="flex flex-col text-[11px] text-muted-foreground">
              Vence desde
              <input type="date" value={filtros.desde} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} className={`${inputClass} w-36`} />
            </label>
            <label className="flex flex-col text-[11px] text-muted-foreground">
              hasta
              <input type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} className={`${inputClass} w-36`} />
            </label>
            <Button type="button" variant={filtros.vencidas ? 'default' : 'outline'} size="sm" className="h-9" aria-pressed={filtros.vencidas}
              onClick={() => setFiltros((f) => ({ ...f, vencidas: !f.vencidas }))}>
              <Warning size={14} className="mr-1.5" /> Solo vencidas
            </Button>
            {hayFiltros && (
              <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setFiltros(SIN_FILTROS); setBusqueda(''); }}>
                <X size={14} className="mr-1" /> Quitar filtros
              </Button>
            )}
          </div>
        </>
      )}

      {vista === 'revisar' ? (
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
          {vista === 'equipo' && (
            <div className="space-y-2" data-recorrido="metricas">
              <div role="tablist" aria-label="Agrupar" className="inline-flex bg-muted p-0.5 rounded-md text-xs">
                {(['persona', 'area'] as const).map((g) => (
                  <button key={g} type="button" role="tab" aria-selected={agrupar === g} onClick={() => setAgrupar(g)}
                    className={`px-3 py-1 rounded font-medium ${agrupar === g ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    Por {g === 'persona' ? 'persona' : 'área'}
                  </button>
                ))}
              </div>
              {agrupar === 'persona' ? (
                <TeamTasksMetrics metrics={metricas} loading={cargandoMetricas} onSelectUser={(id) => setVistaTablero(id === yo ? 'mio' : id)} />
              ) : (
                <TeamAreaMetrics metrics={metricasArea} loading={cargandoMetricas} onSelectArea={(id) => setFiltros((f) => ({ ...f, areaId: id ?? '' }))} />
              )}
            </div>
          )}

          {cargando && tasks.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Cargando el tablero…</p>
          ) : vista === 'equipo' && carriles.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {hayFiltros ? 'Ninguna tarea cumple esos filtros.' : 'Nadie tiene tareas abiertas.'}
            </p>
          ) : (
            carriles.map((carril) => {
              // Se arrastra dentro de un mismo carril de persona: mover una
              // tarjeta no la cambia de responsable. Por área, la columna manda.
              const mismoCarril = arrastrando
                && (vista !== 'equipo' || agrupar === 'area' || arrastrando.assigned_to === carril.userId);
              return (
                <section key={carril.id} className="space-y-2">
                  {vista === 'equipo' && (
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      {agrupar === 'persona' ? (
                        <button type="button" onClick={() => carril.userId && setVistaTablero(carril.userId === yo ? 'mio' : carril.userId)}
                          className="inline-flex items-center gap-2 hover:underline">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${avatarColorFor(carril.userId || 0)}`}>
                            {getInitials(carril.titulo)}
                          </span>
                          {carril.titulo}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${boardColor(carril.color).dot}`} aria-hidden />
                          {carril.titulo}
                        </span>
                      )}
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">· {carril.tasks.length}</span>
                    </h2>
                  )}
                  <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory sm:snap-none -mx-4 px-4 lg:mx-0 lg:px-0" data-recorrido="columnas">
                    {columnasActivas.map((col) => {
                      const columna = carril.tasks.filter((t) => t.status === col.key);
                      return (
                        <TaskColumn
                          key={col.key}
                          status={col.key}
                          label={col.label}
                          dot={col.dot}
                          head={col.head}
                          tasks={columna}
                          dragging={mismoCarril ? arrastrando : null}
                          canCreate={canCreate && vista !== 'equipo' && (vista === 'mio' || canAssign)}
                          canDragTask={puedeArrastrar}
                          showAssignee={vista === 'equipo'}
                          conEquipos={equipos.length > 0}
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
              );
            })
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
