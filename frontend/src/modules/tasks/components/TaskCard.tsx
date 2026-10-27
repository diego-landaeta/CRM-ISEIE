import type { DragEvent } from 'react';
import { Buildings, CalendarBlank, ChatCircle, CheckCircle, CheckSquare, ClockCounterClockwise, DotsSixVertical, LinkSimple, Rocket, WarningCircle } from '@phosphor-icons/react';
import { avatarColorFor, getInitials } from '@/shared/lib/ui';
import { PRIORITY, dueInfo, tagChip, boardColor } from '../lib/taskUi';
import { fechaCorta, fechaYHora } from '../lib/periodo';
import type { Task } from '../types';

interface TaskCardProps {
  task: Task;
  draggable: boolean;
  showAssignee: boolean;
  conEquipos?: boolean;
  /** Sin cerrar y creada antes del periodo: el mes de donde viene. */
  vieneDe?: string | null;
  onOpen: (task: Task) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, task: Task) => void;
  onDragEnd: () => void;
  onDragOverCard: (e: DragEvent<HTMLDivElement>, task: Task) => void;
}

export function TaskCard({
  task, draggable, showAssignee, conEquipos = false, vieneDe = null, onOpen, onDragStart, onDragEnd, onDragOverCard,
}: TaskCardProps) {
  const prioridad = PRIORITY[task.priority] || PRIORITY.media;
  const vence = dueInfo(task);
  const total = task.checklist_total || 0;
  const hechos = task.checklist_completed || 0;

  return (
    <div
      data-recorrido="tarjeta"
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOverCard(e, task)}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(task);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Abrir tarea ${task.title}`}
      className={`bg-card border border-border border-l-4 ${prioridad.border} rounded-lg p-3 space-y-2.5 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } hover:shadow-md hover:border-primary/40 transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-1`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold leading-snug break-words min-w-0 flex-1">{task.title}</p>
        {draggable && (
          <DotsSixVertical size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
        )}
      </div>

      {/* Badges de Equipo, Área, Proyecto y Prioridad */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* El equipo y el cargo de quien la lleva (26/10/2026): «Desarrollo y SEO · Miembro». */}
        {conEquipos && (task.team_name ? (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${boardColor(task.team_color || 'gray').chip}`}>
            {task.team_name}{task.assigned_cargo ? ` · ${task.assigned_cargo}` : ''}
          </span>
        ) : (
          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Sin equipo</span>
        ))}
        {task.priority === 'alta' ? (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${prioridad.chip}`}>
            <WarningCircle size={10} weight="fill" />
            Alta
          </span>
        ) : (
          <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${prioridad.chip}`}>
            {prioridad.label}
          </span>
        )}

        {task.area_name && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${boardColor(task.area_color).chip}`}>
            {task.area_name}
          </span>
        )}

        {/* Campus y proyecto propio se distinguen: un campus del CRM no es lo
            mismo que Opynio o un cliente externo. */}
        {task.project_name && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-secondary/80 border border-border/50 rounded px-1.5 py-0.5 truncate max-w-[140px]" title={`Campus: ${task.project_name}`}>
            <Buildings size={10} aria-hidden /> {task.project_name}
          </span>
        )}
        {task.external_project_name && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium border rounded px-1.5 py-0.5 truncate max-w-[140px] ${boardColor(task.external_project_color).chip}`} title={`Proyecto propio: ${task.external_project_name}`}>
            <Rocket size={10} aria-hidden /> {task.external_project_name}
          </span>
        )}
      </div>

      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.map((t) => (
            <span key={t.id} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tagChip(t.color)}`}>
              {t.name}
            </span>
          ))}
        </div>
      )}

      {/* Cuándo se creó y cuándo se terminó (Diego, 27/10/2026). */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
        <span title={`Creada el ${fechaYHora(task.created_at)}${task.created_by_name ? ` por ${task.created_by_name}` : ''}`}>
          Creada {fechaCorta(task.created_at)}
        </span>
        {/* Sin cerrar de un mes anterior: pasa a este (Diego, 27/10/2026). */}
        {vieneDe && (
          <span className="inline-flex items-center gap-0.5 font-medium text-warning" title="Sigue abierta: viene de un periodo anterior">
            <ClockCounterClockwise size={10} weight="bold" aria-hidden /> Viene de {vieneDe}
          </span>
        )}
        {task.status === 'hecha' && task.completed_at && (
          <span className="inline-flex items-center gap-0.5 text-success font-medium" title={`Terminada el ${fechaYHora(task.completed_at)}`}>
            <CheckCircle size={10} weight="fill" aria-hidden /> Terminada {fechaCorta(task.completed_at)}
          </span>
        )}
      </div>

      <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground pt-0.5">
        {vence && (
          <span className={`inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded ${vence.classes}`} title="Fecha límite">
            <CalendarBlank size={10} weight="bold" />
            {vence.label}
          </span>
        )}
        {total > 0 && (
          <span className={`inline-flex items-center gap-1 tabular-nums ${hechos === total ? 'text-success font-semibold' : ''}`}>
            <CheckSquare size={12} />
            {hechos}/{total}
          </span>
        )}
        {(task.comments_count || 0) > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ChatCircle size={12} />
            {task.comments_count}
          </span>
        )}
        {(task.links_count || 0) > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <LinkSimple size={12} />
            {task.links_count}
          </span>
        )}
        {showAssignee && task.assigned_to && (
          <span
            className={`ml-auto w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold ${avatarColorFor(task.assigned_to)} shadow-sm`}
            title={task.assigned_to_name || ''}
          >
            {getInitials(task.assigned_to_name)}
          </span>
        )}
      </div>
    </div>
  );
}
