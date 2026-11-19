import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowClockwise, ArrowSquareOut, XCircle } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import Select from '@/shared/components/ui/Select';
import { lista } from '@/shared/lib/lista';
import { cn } from '@/shared/lib/utils';
import usePermission from '@/shared/hooks/usePermission';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import {
  incidenciasApi, type Incidencia, type MetricasIncidencias, type EstadoIncidencia, type TipoIncidencia,
} from '../api/incidencias.api';
import { TIPOS, ORDEN_TIPOS, ESTADOS, GRAVEDADES, ENTIDADES, enlaceDe, fechaHora } from '../lib/incidencias';
import IncidenciaDialog, { type Persona, type Campus } from '../components/IncidenciaDialog';
import CifrasIncidencias from '../components/CifrasIncidencias';

/**
 * Incidencias (#253).
 *
 * Diego, 06/10: «un apartado de incidencias… estos errores capa 8 que
 * ocasionan. Que sea como la sección de soporte». Se registran para corregir,
 * no para señalar: saber quién necesita formación y en qué.
 *
 * Qué ve cada uno lo decide el servidor: superadmin, todas; un admin, las de
 * sus campus; una gestora, solo las suyas. Esta pantalla no filtra por rol,
 * solo enseña u oculta los botones de apuntar y editar, y la opción «todo el
 * CRM» del formulario (solo superadmin y soporte, PR #612).
 *
 * Sigue al selector de arriba: un campus, una empresa o «Todos».
 */

type Vista = 'lista' | 'cifras';

export default function IncidenciasPage() {
  const { can } = usePermission();
  const { user } = useAuth() as { user: { id?: number; role?: string } | null };
  // Como el servidor (`veTodoElCrm`): superadmin y soporte, solo como rol principal.
  const veTodo = ['superadmin', 'soporte'].includes(user?.role || '');
  const { projects, isAllProjects, activeProject, activeIssuerId } = useProjectContext() as {
    projects: Campus[]; isAllProjects: boolean; activeProject: { id: number | null } | null; activeIssuerId: number | null;
  };
  const puedeVer = can('incidencias.view');
  const puedeApuntar = can('incidencias.create');
  const puedeEditar = can('incidencias.edit');
  const yo = user?.id ?? null;

  const [vista, setVista] = useState<Vista>('lista');
  const [filas, setFilas] = useState<Incidencia[]>([]);
  const [total, setTotal] = useState(0);
  const [cifras, setCifras] = useState<MetricasIncidencias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoIncidencia | ''>('');
  const [tipo, setTipo] = useState<TipoIncidencia | ''>('');
  const [persona, setPersona] = useState<number | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [abierta, setAbierta] = useState<Incidencia | null | 'nueva'>(null);
  const [pagina, setPagina] = useState(1);
  const [cargandoMas, setCargandoMas] = useState(false);

  // El ámbito de arriba: una empresa, un campus o nada («Todos»).
  const ambito = useMemo(() => {
    if (activeIssuerId) return { issuerId: activeIssuerId };
    if (!isAllProjects && activeProject?.id) return { projectId: activeProject.id };
    return {};
  }, [activeIssuerId, isAllProjects, activeProject?.id]);

  // Los filtros de la lista son también los de las cifras: así el total de
  // «Por persona, tipo y mes» es el número de la lista.
  const filtros = useMemo(() => ({
    ...ambito, estado: estado || undefined, tipo: tipo || undefined, causadaPor: persona ?? undefined,
  }), [ambito, estado, tipo, persona]);

  const cargar = useCallback(async () => {
    if (!puedeVer) { setCargando(false); return; }
    setCargando(true);
    setError(null);
    try {
      const [l, m] = await Promise.all([incidenciasApi.listar(filtros), incidenciasApi.metricas(filtros)]);
      if (!l.success) throw new Error(l.error || 'No se pudieron leer las incidencias');
      setFilas(lista(l.data));
      setPagina(1);
      setTotal(l.pagination?.total ?? lista(l.data).length);
      setCifras(m.success ? (m.data as MetricasIncidencias) : null);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron leer las incidencias');
    } finally {
      setCargando(false);
    }
  }, [filtros, puedeVer]);

  useEffect(() => { cargar(); }, [cargar]);

  // Más de 200: la siguiente página, debajo de las que ya hay.
  async function verMas() {
    setCargandoMas(true);
    try {
      const r = await incidenciasApi.listar(filtros, pagina + 1);
      if (r.success) { setFilas((v) => [...v, ...(lista(r.data) as Incidencia[])]); setPagina((p) => p + 1); }
    } finally {
      setCargandoMas(false);
    }
  }

  // Las personas, para «quién la causó» y el filtro. Solo hacen falta a quien
  // apunta o edita: la gestora ve los nombres que ya trae cada incidencia.
  // Las da Incidencias y no /users: un admin, solo las de sus campus, que son
  // las que el servidor acepta al guardar.
  useEffect(() => {
    if (!puedeApuntar && !puedeEditar) return;
    incidenciasApi.personas()
      .then((r) => setPersonas(lista(r?.data).map((u: any) => ({ id: u.id, nombre: u.nombre }))))
      .catch(() => {});
  }, [puedeApuntar, puedeEditar]);

  // Para el filtro: las personas de la lista y las de las cifras, aunque no
  // estén en /users (la gestora no lo puede leer).
  const opcionesPersona = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of personas) m.set(p.id, p.nombre);
    for (const p of cifras?.porPersona || []) if (p.userId) m.set(p.userId, p.nombre || `Usuario ${p.userId}`);
    return [{ value: null as number | null, label: 'Cualquiera' },
      ...[...m].sort((a, b) => a[1].localeCompare(b[1])).map(([id, nombre]) => ({ value: id as number | null, label: nombre }))];
  }, [personas, cifras]);

  const hayFiltro = Boolean(estado || tipo || persona);

  // Sin permiso, un aviso propio en vez del error de la API (quien escribe la
  // dirección a mano: el menú no se la enseña).
  if (!puedeVer) {
    return (
      <div className="space-y-4">
        <PageHeader title="Incidencias" />
        <div className="rounded-md border border-border bg-card p-8 text-center space-y-1">
          <p className="text-sm font-medium">Esta pantalla no está entre tus permisos</p>
          <p className="text-xs text-muted-foreground">Si necesitas ver las incidencias, pídeselo a quien administra tu campus.</p>
        </div>
      </div>
    );
  }

  async function abrir(inc: Incidencia) {
    // La ficha entera, con sus adjuntos: la lista no los trae.
    const r = await incidenciasApi.porId(inc.id).catch(() => null);
    setAbierta(r?.success && r.data ? (r.data as Incidencia) : inc);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidencias"
        subtitle="Qué salió mal, cómo se arregló y quién necesita formación."
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={cargar} disabled={cargando} aria-label="Actualizar" title="Actualizar"
              className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md border border-border hover:bg-muted disabled:opacity-50">
              <ArrowClockwise size={15} className={cargando ? 'animate-spin' : ''} />
              {/* En el móvil, solo el icono: con el texto el título se quedaba en «Incide…». */}
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            {puedeApuntar && (
              <button type="button" onClick={() => setAbierta('nueva')}
                className="inline-flex items-center gap-1.5 text-sm h-9 px-3 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90">
                <Plus size={14} weight="bold" /> Nueva incidencia
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border overflow-hidden" role="tablist" aria-label="Vista">
          {(['lista', 'cifras'] as Vista[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
              className={cn('px-4 py-1.5 text-sm font-medium transition-colors',
                vista === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
              {v === 'lista' ? `Lista${total ? ` (${total})` : ''}` : 'Por persona, tipo y mes'}
            </button>
          ))}
        </div>
      </div>

      {vista === 'lista' && (
        <div className="rounded-md border border-border bg-card p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-secundario text-muted-foreground min-w-[150px]">
            Estado
            <Select<EstadoIncidencia | ''> value={estado} onChange={setEstado} size="sm" ariaLabel="Estado"
              options={[{ value: '', label: 'Todos' },
                ...(Object.keys(ESTADOS) as EstadoIncidencia[]).map((k) => ({ value: k as EstadoIncidencia | '', label: ESTADOS[k].label }))]} />
          </label>
          <label className="flex flex-col gap-1 text-secundario text-muted-foreground min-w-[150px]">
            Tipo
            <Select<TipoIncidencia | ''> value={tipo} onChange={setTipo} size="sm" ariaLabel="Tipo"
              options={[{ value: '', label: 'Todos' },
                ...ORDEN_TIPOS.map((k) => ({ value: k as TipoIncidencia | '', label: TIPOS[k].label }))]} />
          </label>
          <label className="flex flex-col gap-1 text-secundario text-muted-foreground min-w-[180px]">
            Quién la causó
            <Select<number | null> value={persona} onChange={setPersona} size="sm" ariaLabel="Quién la causó" options={opcionesPersona} />
          </label>
          {hayFiltro && (
            <button type="button" onClick={() => { setEstado(''); setTipo(''); setPersona(null); }}
              className="text-xs text-muted-foreground hover:text-foreground underline py-2">
              Quitar filtros
            </button>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">
          <XCircle size={16} weight="fill" className="shrink-0" /> {error}
        </div>
      )}

      {vista === 'cifras' ? (
        cifras ? <CifrasIncidencias m={cifras} onPersona={(id) => { setPersona(id); setVista('lista'); }} />
          : !cargando && <p className="p-8 text-center text-sm text-muted-foreground">No se pudieron leer las cifras.</p>
      ) : (
        <div className="rounded-md border border-border bg-card overflow-hidden">
          {cargando && !filas.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Leyendo las incidencias…</p>
          ) : !filas.length ? (
            <div className="p-8 text-center space-y-1">
              <p className="text-sm font-medium">No hay incidencias</p>
              <p className="text-xs text-muted-foreground">
                {hayFiltro ? 'Con estos filtros no sale ninguna. Prueba a quitar alguno.'
                  : puedeApuntar ? 'Cuando algo salga mal, apúntalo con «Nueva incidencia».'
                    : 'No hay ninguna que te toque.'}
              </p>
            </div>
          ) : (
            <>
            {/* En el móvil, una tarjeta por incidencia: la tabla se salía por la
                derecha y «Qué pasó», que es lo que se viene a leer, quedaba fuera. */}
            <ul className="sm:hidden divide-y divide-border">
              {filas.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => abrir(i)} className="w-full text-left p-3 space-y-1.5 hover:bg-muted/30">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded', ESTADOS[i.estado].clase)}>{ESTADOS[i.estado].label}</span>
                      <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded', GRAVEDADES[i.gravedad].clase)}>{GRAVEDADES[i.gravedad].label}</span>
                      {i.tipos.map((t) => (
                        <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{TIPOS[t]?.label || t}</span>
                      ))}
                    </div>
                    <p className="text-sm line-clamp-3">{i.quePaso}</p>
                    <p className="text-xs text-muted-foreground">
                      {fechaHora(i.ocurrioAt)} · {i.projectName || i.sociedadName || 'Todo el CRM'}
                      {i.causadaPorNombre ? ` · ${i.causadaPorNombre}` : ''}
                      {i.entidadTipo ? ` · ${ENTIDADES[i.entidadTipo]}${i.entidadId ? ` ${i.entidadId}` : ''}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Cuándo</th>
                    <th className="text-left font-medium px-3 py-2">Dónde</th>
                    <th className="text-left font-medium px-3 py-2">Tipo</th>
                    <th className="text-left font-medium px-3 py-2 min-w-[260px]">Qué pasó</th>
                    <th className="text-left font-medium px-3 py-2">Quién</th>
                    <th className="text-left font-medium px-3 py-2">Sobre qué</th>
                    <th className="text-left font-medium px-3 py-2">Gravedad</th>
                    <th className="text-left font-medium px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((i) => {
                    const enlace = enlaceDe(i.entidadTipo, i.entidadId, { ventaId: i.entidadVentaId, nombre: i.entidadNombre });
                    return (
                      <tr key={i.id} className="border-t border-border align-top hover:bg-muted/30 cursor-pointer"
                        onClick={() => abrir(i)}>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fechaHora(i.ocurrioAt)}</td>
                        <td className="px-3 py-2 text-xs">
                          {i.projectName || i.sociedadName || <span className="text-muted-foreground">Todo el CRM</span>}
                          {i.crm === 'multicrm' && <span className="block text-muted-foreground">360 CRM</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {i.tipos.map((t) => (
                              <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground whitespace-nowrap">{TIPOS[t]?.label || t}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" className="text-left hover:underline line-clamp-2"
                            onClick={(e) => { e.stopPropagation(); abrir(i); }}>
                            {i.quePaso}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {i.causadaPorNombre || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          {i.entidadTipo ? (
                            <span className="inline-flex items-center gap-1">
                              {ENTIDADES[i.entidadTipo]}{i.entidadId ? ` ${i.entidadId}` : ''}
                              {enlace && (
                                <Link to={enlace} onClick={(e) => e.stopPropagation()} title="Abrir la ficha" aria-label="Abrir la ficha"
                                  className="text-muted-foreground hover:text-foreground"><ArrowSquareOut size={13} /></Link>
                              )}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap', GRAVEDADES[i.gravedad].clase)}>
                            {GRAVEDADES[i.gravedad].label}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('text-[11px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap', ESTADOS[i.estado].clase)}>
                            {ESTADOS[i.estado].label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filas.length < total && (
              <div className="border-t border-border p-3 text-center">
                <button type="button" onClick={verMas} disabled={cargandoMas}
                  className="text-sm h-9 px-3 rounded-md border border-border hover:bg-muted disabled:opacity-50">
                  {cargandoMas ? 'Cargando…' : `Ver más (${filas.length} de ${total})`}
                </button>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {abierta && (
        <IncidenciaDialog
          incidencia={abierta === 'nueva' ? null : abierta}
          soloLectura={abierta !== 'nueva' && !puedeEditar}
          personas={personas}
          campus={projects || []}
          dondeInicial={activeIssuerId ? `e:${activeIssuerId}` : (!isAllProjects && activeProject?.id ? `p:${activeProject.id}` : '')}
          veTodo={veTodo}
          yo={yo}
          onCerrar={() => setAbierta(null)}
          onGuardada={() => { setAbierta(null); cargar(); }}
        />
      )}
    </div>
  );
}
