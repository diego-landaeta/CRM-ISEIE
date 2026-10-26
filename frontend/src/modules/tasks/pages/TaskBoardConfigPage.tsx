import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowClockwise, ArrowDown, ArrowUp, Archive, ArrowCounterClockwise, Check, Lock, PencilSimple, Plus, Users, X,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import Select from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/button';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import { BOARD_COLORS, boardColor } from '../lib/taskUi';
import type { Assignee, TaskArea, TaskColumn, TaskExternalProject } from '../types';
import { EquiposConfig } from '../components/EquiposConfig';

type Pestana = 'columnas' | 'areas' | 'proyectos' | 'equipos';

const COLORES = Object.entries(BOARD_COLORS).map(([value, c]) => ({ value, label: c.label }));
const errorDe = (err: unknown) => (err instanceof Error && err.message) ? err.message : 'Inténtalo de nuevo.';
const fallo = (titulo: string, err: unknown) => toast({ title: titulo, description: errorDe(err), variant: 'destructive' });

// La vuelta al tablero, encima del título. En MultiCRM la pinta el propio
// PageHeader (`backTo`); el de ISEIE no la tiene y se le pasa como `breadcrumbs`.
const VOLVER = (
  <Link to="/tareas" className="text-xs text-muted-foreground hover:text-foreground">← Tablero</Link>
);

/** «Bloqueada (cliente)» → «bloqueada_cliente»: la clave que guarda la tarea. */
function claveDe(nombre: string): string {
  return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

/**
 * «Configurar tablero» (Diego, 07/10): columnas, áreas y proyectos propios.
 * Solo con `tasks.manage`; el servidor lo vuelve a comprobar en cada llamada.
 */
export default function TaskBoardConfigPage() {
  const { can } = usePermission();
  const navigate = useNavigate();
  const [pestana, setPestana] = useState<Pestana>('columnas');

  if (!can('tasks.manage')) {
    return (
      <div className="space-y-4">
        <PageHeader title="Configurar tablero" breadcrumbs={VOLVER} />
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Configurar el tablero necesita el permiso «Tareas · configurar» (Configuración › Roles).
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Configurar tablero"
        subtitle="Columnas, áreas y proyectos propios del Equipo de Desarrollo"
        breadcrumbs={VOLVER}
        actions={<Button variant="outline" size="sm" className="h-9" onClick={() => navigate('/tareas')}>Volver al tablero</Button>}
      />
      <div role="tablist" aria-label="Qué configurar" className="inline-flex bg-muted p-0.5 rounded-md text-sm">
        {([['columnas', 'Columnas'], ['areas', 'Áreas'], ['proyectos', 'Proyectos propios'],
          ...(can('tasks.manage_teams') ? [['equipos', 'Equipos'] as const] : [])] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}
            className={`px-3 py-1.5 rounded font-medium ${pestana === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {l}
          </button>
        ))}
      </div>
      {pestana === 'columnas' && <Columnas />}
      {pestana === 'areas' && <Areas />}
      {pestana === 'proyectos' && <Proyectos />}
      {pestana === 'equipos' && can('tasks.manage_teams') && <EquiposConfig />}
    </div>
  );
}

/* --- Piezas comunes --- */

function useLista<T>(cargar: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setItems(await cargar());
    } catch (err) {
      setError(errorDe(err));
    } finally {
      setCargando(false);
    }
  }, [cargar]);
  useEffect(() => { recargar(); }, [recargar]);
  return { items, cargando, error, recargar };
}

function Estado({ cargando, error, vacio, onRetry, children }: {
  cargando: boolean; error: string | null; vacio: boolean; onRetry: () => void; children: ReactNode;
}) {
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft text-destructive-soft-foreground p-6 text-center space-y-3">
        <p className="text-sm font-semibold">No se pudo cargar</p>
        <p className="text-xs">{error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}><ArrowClockwise size={14} className="mr-1.5" /> Reintentar</Button>
      </div>
    );
  }
  if (cargando && vacio) return <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>;
  return <>{children}</>;
}

function Punto({ color }: { color: string | null | undefined }) {
  return <span className={`w-3 h-3 rounded-full flex-shrink-0 ${boardColor(color).dot}`} aria-hidden />;
}

/**
 * Subir o bajar una fila: se intercambia su orden con el de la vecina. Si
 * tenían el mismo (filas antiguas), se reparten de 10 en 10 antes.
 */
async function intercambiar<T extends { id: number; sort_order: number }>(
  lista: T[], i: number, d: -1 | 1, guardar: (id: number, sort_order: number) => Promise<unknown>
) {
  const a = lista[i];
  const b = lista[i + d];
  if (!a || !b) return;
  const ordenA = a.sort_order === b.sort_order ? (i + d + 1) * 10 : b.sort_order;
  const ordenB = a.sort_order === b.sort_order ? (i + 1) * 10 : a.sort_order;
  await guardar(a.id, ordenA);
  await guardar(b.id, ordenB);
}

function Archivada() {
  return <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Archivada</span>;
}

/** Fila editable: nombre y color, guardar o cancelar. */
function EditarNombreColor({ nombre, color, onGuardar, onCancelar, extra }: {
  nombre: string; color: string; onGuardar: (n: string, c: string) => Promise<void>; onCancelar: () => void; extra?: ReactNode;
}) {
  const [n, setN] = useState(nombre);
  const [c, setC] = useState(color);
  const [guardando, setGuardando] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!n.trim()) return;
    setGuardando(true);
    try { await onGuardar(n.trim(), c); } finally { setGuardando(false); }
  }
  return (
    <form onSubmit={enviar} className="flex flex-wrap items-center gap-2 flex-1">
      <input value={n} onChange={(e) => setN(e.target.value)} maxLength={150} aria-label="Nombre" className={`${inputClass} flex-1 min-w-[10rem]`} autoFocus />
      <Select<string> value={c} onChange={setC} options={COLORES} ariaLabel="Color" size="sm" className="w-32" />
      {extra}
      <Button type="submit" size="sm" className="h-9" disabled={!n.trim() || guardando}><Check size={14} className="mr-1" /> Guardar</Button>
      <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onCancelar}><X size={14} /></Button>
    </form>
  );
}

/* --- Columnas --- */

function Columnas() {
  const { items, cargando, error, recargar } = useLista<TaskColumn>(tasksApi.getColumns);
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('gray');
  const [editando, setEditando] = useState<number | null>(null);

  const activas = items.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const archivadas = items.filter((c) => !c.is_active);

  async function crear(e: FormEvent) {
    e.preventDefault();
    const key = claveDe(nombre);
    if (!key) return;
    try {
      await tasksApi.createColumn({ key, name: nombre.trim(), color });
      toast({ title: `Columna «${nombre.trim()}» creada` });
      setNombre('');
      recargar();
    } catch (err) { fallo('No se pudo crear la columna', err); }
  }

  async function mover(i: number, d: -1 | 1) {
    const orden = activas.map((c) => c.key);
    [orden[i], orden[i + d]] = [orden[i + d], orden[i]];
    try { await tasksApi.reorderColumns(orden); recargar(); } catch (err) { fallo('No se pudo ordenar', err); }
  }

  async function archivar(c: TaskColumn) {
    try { await tasksApi.archiveColumn(c.id); toast({ title: `«${c.name}» archivada` }); recargar(); } catch (err) { fallo('No se pudo archivar', err); }
  }

  async function recuperar(c: TaskColumn) {
    try { await tasksApi.updateColumn(c.id, { is_active: true }); recargar(); } catch (err) { fallo('No se pudo recuperar', err); }
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Las 4 fijas no se archivan: «En revisión» es lo que sale en «Por revisar» y «Hecha» la que cierra.
        Una columna con tareas tampoco: primero hay que moverlas.
      </p>
      <form onSubmit={crear} className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-center gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} placeholder="Nueva columna, p. ej. «Bloqueada»"
          aria-label="Nombre de la columna" className={`${inputClass} flex-1 min-w-[12rem]`} />
        <Select<string> value={color} onChange={setColor} options={COLORES} ariaLabel="Color" size="sm" className="w-32" />
        <Button type="submit" size="sm" className="h-9" disabled={!claveDe(nombre)}><Plus size={14} className="mr-1" /> Añadir</Button>
      </form>
      <Estado cargando={cargando} error={error} vacio={items.length === 0} onRetry={recargar}>
        <ul className="bg-card border border-border rounded-lg divide-y divide-border">
          {activas.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              {editando === c.id ? (
                <EditarNombreColor nombre={c.name} color={c.color} onCancelar={() => setEditando(null)}
                  onGuardar={async (n, col) => {
                    try { await tasksApi.updateColumn(c.id, { name: n, color: col }); setEditando(null); recargar(); }
                    catch (err) { fallo('No se pudo guardar', err); }
                  }} />
              ) : (
                <>
                  <Punto color={c.color} />
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  {c.is_system && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Columna fija"><Lock size={12} /> Fija</span>}
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${c.name}`}><ArrowUp size={14} /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === activas.length - 1} onClick={() => mover(i, 1)} aria-label={`Bajar ${c.name}`}><ArrowDown size={14} /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditando(c.id)} aria-label={`Renombrar ${c.name}`}><PencilSimple size={14} /></Button>
                  {!c.is_system && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => archivar(c)} aria-label={`Archivar ${c.name}`}><Archive size={14} /></Button>
                  )}
                </>
              )}
            </li>
          ))}
          {archivadas.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2 opacity-70">
              <Punto color={c.color} />
              <span className="flex-1 text-sm">{c.name}</span>
              <Archivada />
              <Button size="sm" variant="ghost" className="h-8" onClick={() => recuperar(c)}><ArrowCounterClockwise size={14} className="mr-1" /> Recuperar</Button>
            </li>
          ))}
        </ul>
      </Estado>
    </section>
  );
}

/* --- Áreas --- */

function Areas() {
  const { items, cargando, error, recargar } = useLista<TaskArea>(tasksApi.getAreas);
  const [personas, setPersonas] = useState<Assignee[]>([]);
  const [asignaciones, setAsignaciones] = useState<Array<{ user_id: number; area_id: number }>>([]);
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('gray');
  const [editando, setEditando] = useState<number | null>(null);
  const [miembros, setMiembros] = useState<number | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  const cargarAsignaciones = useCallback(() => {
    tasksApi.getUserAreaAssignments().then(setAsignaciones).catch(() => setAsignaciones([]));
  }, []);
  useEffect(() => {
    tasksApi.getAssignees().then(setPersonas).catch(() => setPersonas([]));
    cargarAsignaciones();
  }, [cargarAsignaciones]);

  const de = (areaId: number) => asignaciones.filter((a) => a.area_id === areaId).map((a) => a.user_id);
  const ordenadas = [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  async function moverArea(i: number, d: -1 | 1) {
    try {
      await intercambiar(ordenadas, i, d, (id, sort_order) => tasksApi.updateArea(id, { sort_order }));
      recargar();
    } catch (err) { fallo('No se pudo ordenar', err); }
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    try { await tasksApi.createArea({ name: nombre.trim(), color }); toast({ title: `Área «${nombre.trim()}» creada` }); setNombre(''); recargar(); }
    catch (err) { fallo('No se pudo crear el área', err); }
  }

  async function activar(a: TaskArea, activa: boolean) {
    try { await tasksApi.updateArea(a.id, { is_active: activa }); recargar(); } catch (err) { fallo('No se pudo cambiar', err); }
  }

  async function guardarMiembros(areaId: number) {
    try {
      await tasksApi.setAreaMembers(areaId, [...seleccion]);
      toast({ title: 'Personas del área guardadas' });
      setMiembros(null);
      cargarAsignaciones();
    } catch (err) { fallo('No se pudieron guardar las personas', err); }
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">Cada persona puede estar en una o varias áreas. Una tarea va, si se quiere, en un área.</p>
      <form onSubmit={crear} className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-center gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} placeholder="Nueva área, p. ej. «SEO»"
          aria-label="Nombre del área" className={`${inputClass} flex-1 min-w-[12rem]`} />
        <Select<string> value={color} onChange={setColor} options={COLORES} ariaLabel="Color" size="sm" className="w-32" />
        <Button type="submit" size="sm" className="h-9" disabled={!nombre.trim()}><Plus size={14} className="mr-1" /> Añadir</Button>
      </form>
      <Estado cargando={cargando} error={error} vacio={items.length === 0} onRetry={recargar}>
        {items.length === 0 ? (
          <p className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">Todavía no hay áreas.</p>
        ) : (
          <ul className="bg-card border border-border rounded-lg divide-y divide-border">
            {ordenadas.map((a, i) => (
              <li key={a.id} className={`px-3 py-2 space-y-2 ${a.is_active ? '' : 'opacity-70'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {editando === a.id ? (
                    <EditarNombreColor nombre={a.name} color={a.color} onCancelar={() => setEditando(null)}
                      onGuardar={async (n, c) => {
                        try { await tasksApi.updateArea(a.id, { name: n, color: c }); setEditando(null); recargar(); }
                        catch (err) { fallo('No se pudo guardar', err); }
                      }} />
                  ) : (
                    <>
                      <Punto color={a.color} />
                      <span className="flex-1 text-sm font-medium">{a.name}</span>
                      {!a.is_active && <Archivada />}
                      <span className="text-xs text-muted-foreground tabular-nums">{de(a.id).length} personas</span>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => { setMiembros(a.id); setSeleccion(new Set(de(a.id))); }}>
                        <Users size={14} className="mr-1" /> Personas
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => moverArea(i, -1)} aria-label={`Subir ${a.name}`}><ArrowUp size={14} /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === ordenadas.length - 1} onClick={() => moverArea(i, 1)} aria-label={`Bajar ${a.name}`}><ArrowDown size={14} /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditando(a.id)} aria-label={`Renombrar ${a.name}`}><PencilSimple size={14} /></Button>
                      {a.is_active ? (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => activar(a, false)} aria-label={`Archivar ${a.name}`}><Archive size={14} /></Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => activar(a, true)}><ArrowCounterClockwise size={14} className="mr-1" /> Recuperar</Button>
                      )}
                    </>
                  )}
                </div>
                {miembros === a.id && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                    {personas.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hay personas con tablero.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                        {personas.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:bg-muted">
                            <input type="checkbox" className="h-4 w-4 accent-primary" checked={seleccion.has(p.id)}
                              onChange={(e) => setSeleccion((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(p.id); else n.delete(p.id);
                                return n;
                              })} />
                            {p.nombre}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setMiembros(null)}>Cancelar</Button>
                      <Button size="sm" onClick={() => guardarMiembros(a.id)}>Guardar</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Estado>
    </section>
  );
}

/* --- Proyectos propios --- */

function Proyectos() {
  const { items, cargando, error, recargar } = useLista<TaskExternalProject>(tasksApi.getExternalProjects);
  const [nombre, setNombre] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState('gray');
  const [editando, setEditando] = useState<number | null>(null);
  const [urlEdicion, setUrlEdicion] = useState('');

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    try {
      await tasksApi.createExternalProject({ name: nombre.trim(), url: url.trim() || null, color });
      toast({ title: `Proyecto «${nombre.trim()}» creado` });
      setNombre(''); setUrl('');
      recargar();
    } catch (err) { fallo('No se pudo crear el proyecto', err); }
  }

  const ordenados = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);

  async function moverProyecto(i: number, d: -1 | 1) {
    try {
      await intercambiar(ordenados.map((p) => ({ ...p, sort_order: p.sort_order ?? 0 })), i, d,
        (id, sort_order) => tasksApi.updateExternalProject(id, { sort_order }));
      recargar();
    } catch (err) { fallo('No se pudo ordenar', err); }
  }

  async function activar(p: TaskExternalProject, activo: boolean) {
    try { await tasksApi.updateExternalProject(p.id, { is_active: activo }); recargar(); } catch (err) { fallo('No se pudo cambiar', err); }
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Lo que no es un campus del CRM: Opynio, una web nueva, un cliente externo. Una tarea lleva un campus o un proyecto propio, nunca los dos.
      </p>
      <form onSubmit={crear} className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-center gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={150} placeholder="Nuevo proyecto, p. ej. «Opynio»"
          aria-label="Nombre del proyecto" className={`${inputClass} flex-1 min-w-[12rem]`} />
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} placeholder="https://… (opcional)"
          aria-label="Dirección web" className={`${inputClass} flex-1 min-w-[12rem]`} />
        <Select<string> value={color} onChange={setColor} options={COLORES} ariaLabel="Color" size="sm" className="w-32" />
        <Button type="submit" size="sm" className="h-9" disabled={!nombre.trim()}><Plus size={14} className="mr-1" /> Añadir</Button>
      </form>
      <Estado cargando={cargando} error={error} vacio={items.length === 0} onRetry={recargar}>
        {items.length === 0 ? (
          <p className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">Todavía no hay proyectos propios.</p>
        ) : (
          <ul className="bg-card border border-border rounded-lg divide-y divide-border">
            {ordenados.map((p, i) => (
              <li key={p.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${p.is_active ? '' : 'opacity-70'}`}>
                {editando === p.id ? (
                  <EditarNombreColor
                    nombre={p.name}
                    color={p.color}
                    onCancelar={() => setEditando(null)}
                    extra={<input type="url" value={urlEdicion} onChange={(e) => setUrlEdicion(e.target.value)} placeholder="https://…"
                      aria-label="Dirección web" className={`${inputClass} flex-1 min-w-[10rem]`} />}
                    onGuardar={async (n, c) => {
                      try { await tasksApi.updateExternalProject(p.id, { name: n, color: c, url: urlEdicion.trim() || null }); setEditando(null); recargar(); }
                      catch (err) { fallo('No se pudo guardar', err); }
                    }}
                  />
                ) : (
                  <>
                    <Punto color={p.color} />
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate max-w-[16rem]">{p.url}</a>
                    )}
                    <span className="flex-1" />
                    {!p.is_active && <Archivada />}
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => moverProyecto(i, -1)} aria-label={`Subir ${p.name}`}><ArrowUp size={14} /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === ordenados.length - 1} onClick={() => moverProyecto(i, 1)} aria-label={`Bajar ${p.name}`}><ArrowDown size={14} /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditando(p.id); setUrlEdicion(p.url || ''); }} aria-label={`Editar ${p.name}`}><PencilSimple size={14} /></Button>
                    {p.is_active ? (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => activar(p, false)} aria-label={`Archivar ${p.name}`}><Archive size={14} /></Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => activar(p, true)}><ArrowCounterClockwise size={14} className="mr-1" /> Recuperar</Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Estado>
    </section>
  );
}
