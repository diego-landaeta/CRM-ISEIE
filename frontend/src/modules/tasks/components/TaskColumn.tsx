import { useState, type DragEvent } from 'react';
import { Plus, ListChecks } from '@phosphor-icons/react';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '../types';

interface TaskColumnProps {
  status: TaskStatus;
  label: string;
  dot: string;
  head: string;
  tasks: Task[];
  /** La tarjeta que se esta arrastrando, si viene de este carril. */
  dragging: Task | null;
  canCreate: boolean;
  canDragTask: (task: Task) => boolean;
  showAssignee: boolean;
  /** Si hay equipos: la tarjeta enseña «Equipo · Cargo» o «Sin equipo». */
  conEquipos?: boolean;
  /** El mes de donde viene una tarea sin cerrar de antes del periodo, o null. */
  vieneDe?: (task: Task) => string | null;
  onOpen: (task: Task) => void;
  onAdd: (status: TaskStatus) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, task: Task) => void;
  onDragEnd: () => void;
  /** Se suelta la tarjeta en la posicion `index` de esta columna. */
  onDropAt: (status: TaskStatus, index: number) => void;
}

/**
 * Una columna del tablero. Arrastre nativo de HTML, como Prospectos → Pipeline:
 * sin librerias. Mientras se arrastra, una linea marca donde caeria la tarjeta;
 * se calcula por la mitad de la tarjeta que hay debajo del cursor.
 */
export function TaskColumn({
  status, label, dot, head, tasks, dragging, canCreate, canDragTask, showAssignee, conEquipos = false, vieneDe,
  onOpen, onAdd, onDragStart, onDragEnd, onDropAt,
}: TaskColumnProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function overCard(e: DragEvent<HTMLDivElement>, task: Task) {
    if (!dragging) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const i = tasks.findIndex((t) => t.id === task.id);
    const index = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
    if (index !== dropIndex) setDropIndex(index);
  }

  function overColumn(e: DragEvent<HTMLDivElement>) {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Sobre el hueco de debajo de las tarjetas: al final.
    if (e.target === e.currentTarget && dropIndex !== tasks.length) setDropIndex(tasks.length);
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const index = dropIndex ?? tasks.length;
    setDropIndex(null);
    onDropAt(status, index);
  }

  const linea = <div className="h-0.5 rounded-full bg-primary mx-1" aria-hidden />;

  return (
    <section
      aria-label={label}
      className={`snap-start flex-shrink-0 w-[85vw] sm:w-[280px] flex flex-col rounded-lg transition-all ${
        dropIndex !== null ? 'ring-2 ring-primary/40 bg-muted/30' : ''
      }`}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
      }}
    >
      <div className={`rounded-lg px-3 py-2 mb-2 ${head}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
            <span className="text-[13px] font-semibold">{label}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[12px] font-semibold bg-card border border-border rounded-md px-2 py-0.5 tabular-nums">
              {tasks.length}
            </span>
            {canCreate && status !== 'hecha' && (
              <button
                type="button"
                onClick={() => onAdd(status)}
                aria-label={`Nueva tarea en ${label}`}
                className="p-1 rounded-md hover:bg-card text-muted-foreground hover:text-foreground"
              >
                <Plus size={14} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        className="space-y-2.5 flex-1 min-h-[160px] px-1 pb-2"
        onDragOver={overColumn}
        onDrop={drop}
      >
        {tasks.map((task, i) => (
          <div key={task.id} className="space-y-2.5">
            {dropIndex === i && linea}
            <TaskCard
              task={task}
              draggable={canDragTask(task)}
              showAssignee={showAssignee}
              conEquipos={conEquipos}
              vieneDe={vieneDe ? vieneDe(task) : null}
              onOpen={onOpen}
              onDragStart={onDragStart}
              onDragEnd={() => { setDropIndex(null); onDragEnd(); }}
              onDragOverCard={overCard}
            />
          </div>
        ))}
        {dropIndex === tasks.length && tasks.length > 0 && linea}
        {tasks.length === 0 && (
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center text-[13px] text-muted-foreground">
            <ListChecks size={20} className="mx-auto mb-1 opacity-40" />
            {dropIndex !== null ? 'Suelta aquí' : 'Sin tareas'}
          </div>
        )}
      </div>
    </section>
  );
}
