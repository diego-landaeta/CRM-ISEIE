import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowClockwise, ArrowLeft, CaretLeft, CaretRight, CheckCircle, MagnifyingGlass,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import PageHeader from '@/shared/components/ui/PageHeader';
import Select from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/button';
import { inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import { OPCIONES_VER, vistaInicialDe, type VerTablero } from '../lib/taskUi';
import {
  etiquetaDePeriodo, fechaYHora, hoyEnOficina, moverReferencia, rangoDePeriodo, type TipoPeriodo,
} from '../lib/periodo';
import type { Assignee, HistorialTarea, Team } from '../types';

/*
 * «HISTORIAL DE TAREAS» (CRM-ISEIE#419, Diego y Carlos, 10/11/2026). Sustituye a «Por
 * revisar»: quien hace la tarea la pasa a «Hecha» él mismo, así que ya no hay
 * una bandeja de «por aprobar» (tampoco para Carlos). Aquí queda lo hecho: quién
 * lo hizo, quién lo cerró y cuándo; por persona, equipo y periodo. Lo que se ve
 * es lo del tablero: cada uno lo suyo y lo de su equipo; con «Ver todo», todo
 * lo de su empresa.
 */

const PERIODOS: ReadonlyArray<{ value: TipoPeriodo; label: string }> = [
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mes' },
  { value: 'todo', label: 'Todo' },
];
const PASO_DE: Record<TipoPeriodo, string> = { dia: 'día', semana: 'semana', mes: 'mes', todo: '' };
const POR_PAGINA = 50;

const errorDe = (err: unknown) => (err instanceof Error && err.message) ? err.message : 'Error desconocido';

export default function TasksHistoryPage() {
  const { user } = useAuth();
  const { can } = usePermission();
  const navigate = useNavigate();

  const canViewAll = can('tasks.view_all');
  const canAssign = can('tasks.assign');
  const canViewOwn = can('tasks.view_own');
  const yo: number = user?.id ?? 0;

  // ISEIE no tiene el selector de empresa de la cabecera: como el tablero, no se
  // manda nada y el servidor lo acota a los campus de cada persona.
  const ambito = useMemo<tasksApi.Ambito>(() => ({}), []);

  const [ver, setVer] = useState<VerTablero>(() => vistaInicialDe(user).ver);
  const [personaId, setPersonaId] = useState<number | ''>('');
  const [equipo, setEquipo] = useState<string>(''); // '' = cualquiera, 'sin' = sin equipo, o el id
  const [busqueda, setBusqueda] = useState('');
  const [search, setSearch] = useState('');
  const [tipoPeriodo, setTipoPeriodo] = useState<TipoPeriodo>('mes');
  const [referencia, setReferencia] = useState<string>(() => hoyEnOficina());
  const rango = useMemo(() => rangoDePeriodo(tipoPeriodo, referencia), [tipoPeriodo, referencia]);
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<HistorialTarea[]>([]);
  const [paginacion, setPaginacion] = useState<tasksApi.Paginacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [equipos, setEquipos] = useState<Team[]>([]);
  const [personasVistas, setPersonasVistas] = useState<Array<{ id: number; nombre: string }>>([]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Cambiar un filtro vuelve a la primera página.
  useEffect(() => { setPagina(1); }, [ver, personaId, equipo, search, tipoPeriodo, referencia]);

  useEffect(() => {
    if (canViewAll || canAssign) tasksApi.getAssignees(ambito).then(setAssignees).catch(() => setAssignees([]));
    tasksApi.getTeams().then(setEquipos).catch(() => setEquipos([]));
  }, [canViewAll, canAssign, ambito]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const { filas: lista, paginacion: pag } = await tasksApi.getHistorial({
        ...(ver === 'todo' ? ambito : {}),
        ver,
        assigned_to: personaId || undefined,
        team_id: equipo === '' ? undefined : equipo === 'sin' ? 0 : Number(equipo),
        search: search || undefined,
        desde: rango?.desde,
        hasta: rango?.hasta,
        page: pagina,
        limit: POR_PAGINA,
      });
      setFilas(lista);
      setPaginacion(pag);
      setPersonasVistas((antes) => {
        const mapa = new Map(antes.map((p) => [p.id, p]));
        for (const f of lista) if (f.assigned_to && f.assigned_to_name) mapa.set(f.assigned_to, { id: f.assigned_to, nombre: f.assigned_to_name });
        return mapa.size === antes.length ? antes : [...mapa.values()];
      });
    } catch (err) {
      setFilas([]);
      setPaginacion(null);
      setError(errorDe(err));
    } finally {
      setCargando(false);
    }
  }, [ver, ambito, personaId, equipo, search, rango, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  const opcionesPersona = useMemo(() => {
    const base = assignees.length > 0 ? assignees.map((a) => ({ id: a.id, nombre: a.nombre })) : personasVistas;
    const lista = base.some((p) => p.id === yo) ? base : [{ id: yo, nombre: user?.nombre || 'Yo' }, ...base];
    return [...lista].sort((a, b) => (a.id === yo ? -1 : b.id === yo ? 1 : a.nombre.localeCompare(b.nombre, 'es')))
      .map((p) => ({ value: p.id as number | '', label: p.id === yo ? `${p.nombre} (yo)` : p.nombre }));
  }, [assignees, personasVistas, yo, user?.nombre]);
  const equiposActivos = equipos.filter((e) => e.is_active);

  if (!canViewOwn && !canViewAll) {
    return (
      <div className="space-y-4">
        <PageHeader title="Historial de tareas" />
        <p className="text-sm text-muted-foreground">
          Tu rol no tiene acceso al tablero de tareas. Si lo necesitas, pídeselo a quien gestiona los roles.
        </p>
      </div>
    );
  }

  const total = paginacion?.total ?? filas.length;
  const totalPaginas = paginacion?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Historial de tareas"
        subtitle="Lo hecho: quién lo hizo, quién lo cerró y cuándo"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/tareas')} aria-label="Volver al tablero">
              <ArrowLeft size={15} className="sm:mr-1.5" /> <span className="hidden sm:inline">Volver al tablero</span>
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={cargar} aria-label="Recargar">
              <ArrowClockwise size={16} />
            </Button>
          </div>
        )}
      />

      <div className="bg-card border border-border rounded-lg p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros del historial">
          <div className="relative flex-1 min-w-[11rem]">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar en título o descripción…"
              aria-label="Buscar" className={`${inputClass} pl-9`} />
          </div>
          <Select<VerTablero> value={ver} onChange={setVer} options={[...OPCIONES_VER]} ariaLabel="Ver" size="sm" className="w-36" />
          <Select<number | ''>
            value={personaId}
            onChange={setPersonaId}
            options={[{ value: '', label: 'Cualquier persona' }, ...opcionesPersona]}
            ariaLabel="Persona" size="sm" className="w-44"
          />
          {equiposActivos.length > 0 && (
            <Select<string>
              value={equipo}
              onChange={setEquipo}
              options={[
                { value: '', label: 'Cualquier equipo' },
                ...equiposActivos.map((e) => ({ value: String(e.id), label: e.name })),
                { value: 'sin', label: 'Sin equipo' },
              ]}
              ariaLabel="Equipo" size="sm" className="w-44"
            />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="tablist" aria-label="Periodo" className="inline-flex bg-muted p-0.5 rounded-md text-xs">
              {PERIODOS.map((p) => (
                <button key={p.value} type="button" role="tab" aria-selected={tipoPeriodo === p.value}
                  onClick={() => { setTipoPeriodo(p.value); setReferencia(hoyEnOficina()); }}
                  className={`px-2.5 py-1.5 rounded font-medium whitespace-nowrap ${tipoPeriodo === p.value ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            {tipoPeriodo !== 'todo' && (
              <>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`${PASO_DE[tipoPeriodo]} anterior`}
                  onClick={() => setReferencia((r) => moverReferencia(tipoPeriodo, r, -1))}>
                  <CaretLeft size={14} />
                </Button>
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`${PASO_DE[tipoPeriodo]} siguiente`}
                  onClick={() => setReferencia((r) => moverReferencia(tipoPeriodo, r, 1))}>
                  <CaretRight size={14} />
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="resumen-historial">
          {cargando ? 'Cargando…' : `${etiquetaDePeriodo(tipoPeriodo, rango)} · ${total} ${total === 1 ? 'tarea hecha' : 'tareas hechas'}`}
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft text-destructive-soft-foreground p-6 text-center space-y-3">
          <p className="font-semibold text-sm">No se pudo cargar el historial</p>
          <p className="text-xs">{error}</p>
          <Button size="sm" variant="outline" onClick={cargar}>
            <ArrowClockwise size={14} className="mr-1.5" /> Reintentar
          </Button>
        </div>
      ) : cargando && filas.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Cargando el historial…</p>
      ) : filas.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center space-y-2">
          <p className="text-sm font-semibold">No hay tareas hechas con estos filtros</p>
          <p className="text-sm text-muted-foreground">Cuando alguien pase una tarea a «Hecha», saldrá aquí.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <ul className="divide-y divide-border" data-testid="historial-tareas">
            {filas.map((f) => (
              <li key={f.id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/tareas?id=${f.id}`)}
                    className="text-left text-sm font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  >
                    {f.title}
                  </button>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {f.team_name && <span>{f.team_name}</span>}
                    {(f.project_name || f.external_project_name) && <span>{f.project_name || f.external_project_name}</span>}
                    {f.area_name && <span>{f.area_name}</span>}
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-3 text-xs lg:w-[32rem] lg:flex-shrink-0">
                  <div>
                    <dt className="font-semibold text-muted-foreground">La hizo</dt>
                    <dd>{f.assigned_to_name || 'Sin responsable'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-muted-foreground">La cerró</dt>
                    <dd className="inline-flex items-center gap-1">
                      <CheckCircle size={12} className="text-success" aria-hidden /> {f.completed_by_name || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-muted-foreground">Cuándo</dt>
                    <dd className="tabular-nums">{fechaYHora(f.completed_at)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>Página {pagina} de {totalPaginas}</span>
              <div className="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-7" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
