import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import {
  CalendarBlank, ChatCircle, CheckSquare, Clock, LinkSimple,
  PaperPlaneRight, Plus, Tag, Trash, User, X, Check, ArrowUUpLeft, Folder, Globe,
} from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { Button } from '@/shared/components/ui/button';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import { agruparPorEmpresa, type CampusDeEmpresa } from '../lib/campusPorEmpresa';
import {
  DEFAULT_COLUMNS, TAG_COLORS, armarCambiosDeTarea, fromDateInput, puedeEditarTarea, tagChip, toDateInput,
} from '../lib/taskUi';
import type {
  Assignee,
  TagColor,
  TaskArea,
  TaskColumn,
  TaskDetail,
  TaskExternalProject,
  TaskPriority,
  TaskStatus,
} from '../types';


interface TaskModalProps {
  open: boolean;
  taskId: number | null;
  initialStatus?: TaskStatus;
  initialProjectId?: number | null;
  defaultAssigneeId?: number | null;
  onClose: () => void;
  onChanged: () => void;
  currentUserId: number;
  /** `tasks.close`: aprobar, devolver, cerrar y reabrir. */
  canClose?: boolean;
  canAssign: boolean;
  /** `tasks.edit`: editar la tarea si es la persona asignada (o, con «Ver todo», cualquiera). */
  canEdit?: boolean;
  /** `tasks.view_all`: con «Editar», es el admin, que edita todas. */
  canViewAll?: boolean;
  canArchiveAny: boolean;
  assignees: Assignee[];
  /** Los campus que se pueden elegir (en ISEIE, todos los de la persona). */
  projects: CampusDeEmpresa[];
  areas?: TaskArea[];
  externalProjects?: TaskExternalProject[];
  columns?: TaskColumn[];
}

// La clase del campo es la de todo el CRM (shared/lib/ui.ts); el área de
// texto, la misma con su alto.
const textareaClass = `${inputClass.replace('h-9', 'min-h-[72px] py-2')} resize-y disabled:opacity-60`;

export function TaskModal({
  open, taskId, initialStatus = 'por_hacer', initialProjectId = null, defaultAssigneeId = null, onClose, onChanged,
  currentUserId, canClose = false, canAssign, canEdit = true, canViewAll = false, canArchiveAny, assignees, projects,
  areas = [], externalProjects = [], columns = [],
}: TaskModalProps) {
  useEscapeKey(onClose, open);
  const editando = taskId != null;

  const [tab, setTab] = useState<'detalles' | 'historial'>('detalles');
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmarArchivo, setConfirmarArchivo] = useState(false);
  const [devolviendo, setDevolviendo] = useState(false);
  const [motivoDevolucion, setMotivoDevolucion] = useState('');
  const [mostrarDialogoDevolver, setMostrarDialogoDevolver] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('por_hacer');
  const [priority, setPriority] = useState<TaskPriority>('media');
  const [dueDate, setDueDate] = useState('');
  const [projectSelection, setProjectSelection] = useState<string>(''); // 'campus:1' o 'ext:2' o ''
  const [areaId, setAreaId] = useState<number | ''>('');
  const [assignedTo, setAssignedTo] = useState<number>(currentUserId);
  // El supervisor (26/10/2026): lo pone quien puede asignar.
  const [supervisorId, setSupervisorId] = useState<number | ''>('');

  const [nuevoPaso, setNuevoPaso] = useState('');
  const [nuevoComentario, setNuevoComentario] = useState('');
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('');
  const [colorEtiqueta, setColorEtiqueta] = useState<TagColor>('sky');
  const [nuevoEnlace, setNuevoEnlace] = useState('');
  const [tituloEnlace, setTituloEnlace] = useState('');

  // Lo decide la clave `tasks.close`, no el rol: lo que se cambie en
  // Configuración › Roles manda también aquí.
  const tienePermisoCierre = canClose;
  // Quien la supervisa la aprueba o la devuelve aunque no tenga la clave.
  const esSupervisor = !!task && task.supervisor_id === currentUserId;
  const gruposDeCampus = useMemo(() => agruparPorEmpresa(projects), [projects]);
  // Una tarea ya guardada con un campus de otra empresa no pierde el suyo al abrirla.
  const campusFuera = task?.project_id && !projects.some((p) => p.id === task.project_id)
    ? { id: task.project_id, nombre: task.project_name || `Campus ${task.project_id}` }
    : null;

  const rellenar = useCallback((t: TaskDetail) => {
    setTask(t);
    setTitle(t.title);
    setDescription(t.description || '');
    setStatus(t.status);
    setPriority(t.priority);
    setDueDate(toDateInput(t.due_date));
    if (t.project_id) setProjectSelection(`campus:${t.project_id}`);
    else if (t.external_project_id) setProjectSelection(`ext:${t.external_project_id}`);
    else setProjectSelection('');
    setAreaId(t.area_id ?? '');
    setAssignedTo(t.assigned_to ?? currentUserId);
    setSupervisorId(t.supervisor_id ?? '');
  }, [currentUserId]);

  const recargar = useCallback(async (id: number) => {
    try {
      rellenar(await tasksApi.getTaskById(id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast({ title: 'No se pudo abrir la tarea', description: msg, variant: 'destructive' });
      onClose();
    }
  }, [rellenar, onClose]);

  useEffect(() => {
    if (!open) return;
    setTab('detalles');
    setConfirmarArchivo(false);
    setMostrarDialogoDevolver(false);
    setMotivoDevolucion('');

    if (taskId != null) {
      setCargando(true);
      recargar(taskId).finally(() => setCargando(false));
    } else {
      setTask(null);
      setTitle('');
      setDescription('');
      setStatus(initialStatus);
      setPriority('media');
      setDueDate('');
      setProjectSelection(initialProjectId ? `campus:${initialProjectId}` : '');
      setAreaId('');
      setAssignedTo(defaultAssigneeId ?? currentUserId);
    }
  }, [open, taskId, initialStatus, initialProjectId, defaultAssigneeId, currentUserId, recargar]);

  if (!open) return null;

  const columnasDisponibles = columns.length > 0 ? columns : DEFAULT_COLUMNS.map((c, i) => ({
    id: i + 1,
    key: c.key,
    name: c.label,
    color: 'gray',
    sort_order: (i + 1) * 10,
    is_system: true,
    is_active: true,
  }));

  const opcionesEstado = columnasDisponibles
    .filter((c) => tienePermisoCierre || (c.key !== 'hecha' && (!editando || task?.status !== 'hecha')))
    .map((c) => ({ value: c.key, label: c.name }));

  const estadoBloqueado = editando && task?.status === 'hecha' && !tienePermisoCierre;
  // Al crear, todo se puede. Al editar, el admin y la persona asignada (Diego,
  // 08/10 y WhatsApp 09/10): los demás la ven y la comentan con los campos
  // bloqueados, y quien tiene «Asignar» puede reasignarla.
  const soloLectura = editando && !!task && !puedeEditarTarea(task, currentUserId, { edit: canEdit, viewAll: canViewAll });

  // Solo la gente a la que se le puede asignar (un colaborador sin campus,
  // solo el superadmin), más quien ya la lleva, para que el desplegable la enseñe.
  const opcionesResponsable = (assignees.length ? assignees : [{ id: currentUserId, nombre: 'Yo', email: '', role: '' }])
    .filter((a: Assignee) => a.asignable !== false || a.id === (task?.assigned_to ?? currentUserId))
    .map((a) => ({ value: a.id, label: a.id === currentUserId ? `${a.nombre} (yo)` : a.nombre }));
  // Supervisor: cualquiera del equipo al que se le pueda asignar, menos quien la lleva.
  const opcionesSupervisor = assignees
    .filter((a: Assignee) => (a.asignable !== false || a.id === task?.supervisor_id) && a.id !== assignedTo)
    .map((a) => ({ value: a.id, label: a.id === currentUserId ? `${a.nombre} (yo)` : a.nombre }));
  if (task?.supervisor_id && !opcionesSupervisor.some((o) => o.value === task.supervisor_id)) {
    opcionesSupervisor.push({ value: task.supervisor_id, label: task.supervisor_name || `Persona ${task.supervisor_id}` });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: 'El título es obligatorio', variant: 'destructive' });
      return;
    }

    setGuardando(true);
    let parsedProjectId: number | null = null;
    let parsedExternalProjectId: number | null = null;

    if (projectSelection.startsWith('campus:')) {
      parsedProjectId = parseInt(projectSelection.replace('campus:', ''), 10);
    } else if (projectSelection.startsWith('ext:')) {
      parsedExternalProjectId = parseInt(projectSelection.replace('ext:', ''), 10);
    }

    const basePayload = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: fromDateInput(dueDate),
      project_id: parsedProjectId,
      external_project_id: parsedExternalProjectId,
      area_id: areaId ? Number(areaId) : null,
    };

    try {
      if (editando) {
        const { mover, actualizar } = armarCambiosDeTarea({
          base: basePayload, actual: task!, estadoAntes: task!.status, estadoNuevo: status, canAssign, assignedTo,
        });
        const supervisorNuevo = supervisorId || null;
        if (canAssign && (task!.supervisor_id ?? null) !== supervisorNuevo) {
          (actualizar as Record<string, unknown>).supervisor_id = supervisorNuevo;
        }
        if (mover) await tasksApi.moveTask(task!.id, { status: mover });
        if (Object.keys(actualizar).length > 0) await tasksApi.updateTask(task!.id, actualizar);
        toast({ title: 'Tarea actualizada' });
      } else {
        const createPayload = {
          ...basePayload,
          status,
          assigned_to: canAssign ? (assignedTo || null) : currentUserId,
          ...(canAssign && supervisorId ? { supervisor_id: Number(supervisorId) } : {}),
        };
        await tasksApi.createTask(createPayload);
        toast({ title: 'Tarea creada' });
      }
      onChanged();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      toast({ title: 'No se pudo guardar la tarea', description: msg, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  }

  async function cambio(operacion: () => Promise<unknown>, errorTitulo: string, onOk?: () => void) {
    try {
      await operacion();
      onChanged();
      if (task) await recargar(task.id);
      onOk?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error en la operación';
      toast({ title: errorTitulo, description: msg, variant: 'destructive' });
    }
  }

  async function archivar() {
    if (!task) return;
    try {
      await tasksApi.archiveTask(task.id);
      toast({ title: 'Tarea archivada' });
      onChanged();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al archivar';
      toast({ title: 'No se pudo archivar la tarea', description: msg, variant: 'destructive' });
    } finally {
      setConfirmarArchivo(false);
    }
  }

  async function aprobarTarea() {
    if (!task) return;
    try {
      await tasksApi.approveTask(task.id);
      toast({ title: 'Tarea aprobada y marcada como Hecha' });
      onChanged();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al aprobar';
      toast({ title: 'No se pudo aprobar la tarea', description: msg, variant: 'destructive' });
    }
  }

  async function devolverTarea() {
    if (!task || !motivoDevolucion.trim()) {
      toast({ title: 'Debes indicar el motivo de la devolución', variant: 'destructive' });
      return;
    }
    setDevolviendo(true);
    try {
      await tasksApi.returnTask(task.id, motivoDevolucion.trim());
      toast({ title: 'Tarea devuelta a En curso con comentario registrado' });
      onChanged();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al devolver';
      toast({ title: 'No se pudo devolver la tarea', description: msg, variant: 'destructive' });
    } finally {
      setDevolviendo(false);
      setMostrarDialogoDevolver(false);
    }
  }

  const puedeArchivar = editando && task && (canArchiveAny || task.created_by === currentUserId);

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-xs">
        <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-card rounded-xl border border-border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          
          {/* Cabecera */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {editando ? `Tarea #${task?.id ?? '…'}` : 'Nueva tarea'}
              </span>
              {editando && (
                <div className="flex rounded-lg bg-muted p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setTab('detalles')}
                    className={`px-2.5 py-1 rounded-md transition-colors ${tab === 'detalles' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Detalles
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('historial')}
                    className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${tab === 'historial' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <Clock size={12} /> Historial
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {/* Acciones de Revisión si la tarea está en revisión */}
              {editando && task?.status === 'en_revision' && (tienePermisoCierre || esSupervisor) && (
                <div className="flex items-center gap-1.5 mr-2">
                  <Button type="button" size="sm" variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs h-7.5 px-2" onClick={() => setMostrarDialogoDevolver(true)}>
                    <ArrowUUpLeft size={13} className="mr-1" /> Devolver
                  </Button>
                  <Button type="button" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7.5 px-2.5" onClick={aprobarTarea}>
                    <Check size={13} className="mr-1" /> Aprobar
                  </Button>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ventana"
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Contenido con Scroll */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {cargando ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Cargando datos de la tarea…</div>
            ) : tab === 'historial' && task ? (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actividad registrada</h3>
                {task.events.length === 0 && <p className="text-sm text-muted-foreground">No hay eventos guardados.</p>}
                <ul className="divide-y divide-border border border-border rounded-lg">
                  {task.events.map((ev) => (
                    <li key={ev.id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="font-semibold text-foreground">{ev.user_name || 'Sistema'}</span>
                        <span className="tabular-nums">{new Date(ev.created_at).toLocaleString('es-ES')}</span>
                      </div>
                      <p className="text-muted-foreground">
                        {ev.event_type === 'created' && 'Creó esta tarea'}
                        {ev.event_type === 'status_changed' && `La movió a «${columnasDisponibles.find((c) => c.key === ev.details?.new_status)?.name || String(ev.details?.new_status || '')}»`}
                        {ev.event_type === 'assigned' && 'Modificó la asignación'}
                        {ev.event_type === 'updated' && 'Actualizó los datos'}
                        {ev.event_type === 'comment' && 'Añadió un comentario'}
                        {ev.event_type === 'checklist' && 'Modificó la lista de comprobación'}
                        {ev.event_type === 'tag' && 'Modificó las etiquetas'}
                        {ev.event_type === 'link' && 'Añadió o quitó un enlace'}
                        {ev.event_type === 'archived' && 'Archivó la tarea'}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <form id="task-form" onSubmit={handleSubmit} className="space-y-4">
                {soloLectura && (
                  <p className="text-xs rounded-md border border-border bg-muted/50 px-3 py-2 text-muted-foreground">
                    Solo la editan el admin y la persona asignada. Puedes verla y comentarla{canAssign ? ', y reasignarla' : ''}.
                  </p>
                )}
                <div>
                  <label className="block text-xs font-semibold mb-1">Título *</label>
                  <input
                    type="text"
                    required
                    value={title}
                    disabled={soloLectura}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="¿Qué hay que hacer?"
                    className={inputClass}
                    autoFocus={!editando}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">Descripción</label>
                  <textarea
                    value={description}
                    disabled={soloLectura}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Detalles, contexto o pasos iniciales…"
                    className={textareaClass}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Estado</label>
                    <select
                      value={status}
                      disabled={estadoBloqueado || soloLectura}
                      onChange={(e) => setStatus(e.target.value as TaskStatus)}
                      className={inputClass}
                    >
                      {opcionesEstado.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {estadoBloqueado && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">Solo quienes tienen permiso pueden reabrir tareas completadas.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1">Prioridad</label>
                    <select
                      value={priority}
                      disabled={soloLectura}
                      onChange={(e) => setPriority(e.target.value as TaskPriority)}
                      className={inputClass}
                    >
                      <option value="baja">Baja</option>
                      <option value="media">Media</option>
                      <option value="alta">Alta</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 flex items-center gap-1">
                      <CalendarBlank size={12} /> Fecha límite
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      disabled={soloLectura}
                      onChange={(e) => setDueDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1 flex items-center gap-1">
                      <User size={12} /> Responsable
                    </label>
                    <select
                      value={assignedTo}
                      disabled={!canAssign}
                      onChange={(e) => setAssignedTo(Number(e.target.value))}
                      className={inputClass}
                    >
                      {opcionesResponsable.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {!canAssign && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">Tus tareas son para ti.</p>
                    )}
                  </div>
                </div>

                {(canAssign || task?.supervisor_id) && (
                  <div>
                    <label className="block text-xs font-semibold mb-1 flex items-center gap-1">
                      <User size={12} /> Supervisor
                    </label>
                    <select
                      value={supervisorId}
                      disabled={!canAssign}
                      onChange={(e) => setSupervisorId(e.target.value ? Number(e.target.value) : '')}
                      className={inputClass}
                    >
                      <option value="">Sin supervisor</option>
                      {opcionesSupervisor.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      La ve, le llega un correo al ponerla y cuando esté «En revisión», y la aprueba o la devuelve.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1 flex items-center gap-1">
                      <Folder size={12} /> Proyecto / Ámbito
                    </label>
                    <select
                      value={projectSelection}
                      disabled={soloLectura}
                      onChange={(e) => setProjectSelection(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Sin proyecto</option>
                      {/* Un grupo por empresa, no «Campus» a secas (Diego, 10/10). */}
                      {gruposDeCampus.map((g) => (
                        <optgroup key={`empresa:${g.empresaId ?? 'sin'}`} label={g.empresa}>
                          {g.campus.map((p) => (
                            <option key={`campus:${p.id}`} value={`campus:${p.id}`}>{p.nombre}</option>
                          ))}
                        </optgroup>
                      ))}
                      {campusFuera && (
                        <optgroup label="De otra empresa">
                          <option value={`campus:${campusFuera.id}`}>{campusFuera.nombre}</option>
                        </optgroup>
                      )}
                      {externalProjects.length > 0 && (
                        <optgroup label="Proyectos propios">
                          {externalProjects.map((ep) => (
                            <option key={`ext:${ep.id}`} value={`ext:${ep.id}`}>{ep.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1 flex items-center gap-1">
                      <Globe size={12} /> Área de trabajo
                    </label>
                    <select
                      value={areaId}
                      disabled={soloLectura}
                      onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : '')}
                      className={inputClass}
                    >
                      <option value="">Sin área específica</option>
                      {areas.map((ar) => (
                        <option key={ar.id} value={ar.id}>{ar.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Submódulos cuando la tarjeta ya existe */}
                {editando && task && (
                  <>
                    <fieldset disabled={soloLectura} className="space-y-0 min-w-0">
                    {/* Lista de comprobación */}
                    <section className="pt-4 border-t border-border space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <CheckSquare size={14} /> Lista de comprobación
                        {task.checklist.length > 0 && (
                          <span className="tabular-nums normal-case">
                            · {task.checklist.filter((i) => i.is_completed).length}/{task.checklist.length}
                          </span>
                        )}
                      </h3>
                      <ul className="space-y-1.5">
                        {task.checklist.map((item) => (
                          <li key={item.id} className="flex items-center gap-2 text-sm group">
                            <input
                              type="checkbox"
                              checked={item.is_completed}
                              onChange={(e) => cambio(
                                () => tasksApi.updateChecklistItem(task.id, item.id, { is_completed: e.target.checked }),
                                'No se pudo actualizar el elemento'
                              )}
                              className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                            />
                            <span className={`flex-1 break-words ${item.is_completed ? 'line-through text-muted-foreground' : ''}`}>
                              {item.title}
                            </span>
                            <button
                              type="button"
                              onClick={() => cambio(() => tasksApi.deleteChecklistItem(task.id, item.id), 'No se pudo borrar el elemento')}
                              aria-label="Borrar elemento"
                              className="hover:text-destructive text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            >
                              <Trash size={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={nuevoPaso}
                          onChange={(e) => setNuevoPaso(e.target.value)}
                          placeholder="Añadir paso o comprobación…"
                          className={inputClass}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (nuevoPaso.trim()) {
                                cambio(
                                  () => tasksApi.addChecklistItem(task.id, { title: nuevoPaso.trim() }),
                                  'No se pudo añadir el paso',
                                  () => setNuevoPaso('')
                                );
                              }
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={!nuevoPaso.trim()}
                          onClick={() => cambio(
                            () => tasksApi.addChecklistItem(task.id, { title: nuevoPaso.trim() }),
                            'No se pudo añadir el paso',
                            () => setNuevoPaso('')
                          )}
                        >
                          <Plus size={14} /> Añadir
                        </Button>
                      </div>
                    </section>

                    {/* Etiquetas */}
                    <section className="pt-4 border-t border-border space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <Tag size={14} /> Etiquetas
                      </h3>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {task.tags.map((t) => (
                          <span key={t.id} className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${tagChip(t.color)}`}>
                            {t.name}
                            <button
                              type="button"
                              onClick={() => cambio(() => tasksApi.deleteTag(task.id, t.id), 'No se pudo quitar la etiqueta')}
                              className="hover:opacity-80"
                              aria-label={`Quitar etiqueta ${t.name}`}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={nuevaEtiqueta}
                          onChange={(e) => setNuevaEtiqueta(e.target.value)}
                          placeholder="Nueva etiqueta…"
                          maxLength={50}
                          className={inputClass}
                        />
                        <select
                          value={colorEtiqueta}
                          onChange={(e) => setColorEtiqueta(e.target.value as TagColor)}
                          className="px-2 py-2 text-sm bg-background border border-border rounded-md"
                        >
                          {Object.entries(TAG_COLORS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!nuevaEtiqueta.trim()}
                          onClick={() => cambio(
                            () => tasksApi.addTag(task.id, { name: nuevaEtiqueta.trim(), color: colorEtiqueta }),
                            'No se pudo añadir la etiqueta',
                            () => setNuevaEtiqueta('')
                          )}
                        >
                          <Plus size={14} />
                        </Button>
                      </div>
                    </section>

                    {/* Enlaces */}
                    <section className="pt-4 border-t border-border space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <LinkSimple size={14} /> Enlaces
                      </h3>
                      <ul className="space-y-1">
                        {task.links.map((l) => (
                          <li key={l.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/40 border border-border group">
                            <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium truncate mr-2">
                              {l.title || l.url}
                            </a>
                            <button
                              type="button"
                              onClick={() => cambio(() => tasksApi.deleteLink(task.id, l.id), 'No se pudo quitar el enlace')}
                              className="hover:text-destructive text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label="Quitar enlace"
                            >
                              <Trash size={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="url"
                          value={nuevoEnlace}
                          onChange={(e) => setNuevoEnlace(e.target.value)}
                          placeholder="https://…"
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={tituloEnlace}
                          onChange={(e) => setTituloEnlace(e.target.value)}
                          placeholder="Título del enlace (opcional)"
                          className={inputClass}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!nuevoEnlace.trim()}
                        onClick={() => cambio(
                          () => tasksApi.addLink(task.id, { url: nuevoEnlace.trim(), title: tituloEnlace.trim() || null }),
                          'No se pudo añadir el enlace',
                          () => { setNuevoEnlace(''); setTituloEnlace(''); }
                        )}
                      >
                        Añadir enlace
                      </Button>
                    </section>

                    </fieldset>

                    {/* Comentarios: los puede escribir cualquiera que la vea. */}
                    <section className="pt-4 border-t border-border space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <ChatCircle size={14} /> Comentarios
                        {task.comments.length > 0 && <span className="tabular-nums normal-case">· {task.comments.length}</span>}
                      </h3>
                      <ul className="space-y-2">
                        {task.comments.map((c) => (
                          <li key={c.id} className="rounded-md bg-muted/50 border border-border px-3 py-2 group">
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground">{c.user_name}</span>
                              <span className="flex items-center gap-2 tabular-nums">
                                {new Date(c.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                                {(canArchiveAny || c.user_id === currentUserId) && (
                                  <button
                                    type="button"
                                    onClick={() => cambio(() => tasksApi.deleteComment(task.id, c.id), 'No se pudo borrar el comentario')}
                                    aria-label="Borrar comentario"
                                    className="hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                                  >
                                    <Trash size={12} />
                                  </button>
                                )}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{c.content}</p>
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2 items-end">
                        <textarea
                          value={nuevoComentario}
                          onChange={(e) => setNuevoComentario(e.target.value)}
                          rows={2}
                          maxLength={5000}
                          placeholder="Escribe un comentario…"
                          className={textareaClass}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="h-9"
                          disabled={!nuevoComentario.trim()}
                          onClick={() => cambio(
                            () => tasksApi.addComment(task.id, { content: nuevoComentario.trim() }),
                            'No se pudo publicar el comentario',
                            () => setNuevoComentario('')
                          )}
                        >
                          <PaperPlaneRight size={14} className="mr-1" /> Enviar
                        </Button>
                      </div>
                    </section>
                  </>
                )}
              </form>
            )}
          </div>

          {/* Pie */}
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-muted/20">
            <div>
              {puedeArchivar && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmarArchivo(true)}>
                  <Trash size={15} className="mr-1.5" /> Archivar
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                {editando ? 'Cerrar' : 'Cancelar'}
              </Button>
              {tab === 'detalles' && !cargando && (!soloLectura || canAssign) && (
                <Button type="submit" form="task-form" size="sm" disabled={guardando}>
                  {guardando ? 'Guardando…' : editando ? 'Guardar' : 'Crear tarea'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmarArchivo}
        title="¿Archivar esta tarea?"
        message="Sale del tablero, pero no se borra: sigue contando en «Todo el equipo»."
        confirmLabel="Archivar"
        tone="destructive"
        onConfirm={archivar}
        onCancel={() => setConfirmarArchivo(false)}
      />

      {/* Diálogo de Devolución de Tarea */}
      {mostrarDialogoDevolver && (
        <Portal>
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-foreground">Devolver tarea a «En curso»</h3>
                <button type="button" onClick={() => setMostrarDialogoDevolver(false)} className="text-muted-foreground hover:text-foreground">
                  <X size={16} />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Indica qué correcciones o puntos faltan para que el responsable pueda completarla. Se publicará como comentario y se enviará notificación.
              </p>
              <div>
                <label className="block text-xs font-semibold mb-1">Motivo / Qué falta *</label>
                <textarea
                  rows={3}
                  required
                  value={motivoDevolucion}
                  onChange={(e) => setMotivoDevolucion(e.target.value)}
                  placeholder="Explica qué debe revisarse o corregirse…"
                  className={textareaClass}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setMostrarDialogoDevolver(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!motivoDevolucion.trim() || devolviendo}
                  onClick={devolverTarea}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {devolviendo ? 'Devolviendo…' : 'Devolver tarea'}
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Portal>
  );
}
