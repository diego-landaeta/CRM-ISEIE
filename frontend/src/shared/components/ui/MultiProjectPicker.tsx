import { useEffect, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass, Check } from '@phosphor-icons/react';

export interface ProjectLite {
  id: number;
  nombre?: string;
  slug?: string;
}

interface Props {
  projects: ProjectLite[];
  selected: number[];      // ids; vacío = sólo el activo
  onChange: (ids: number[]) => void;
  activeProjectId?: number | null;
  className?: string;
}

// Selector multi-proyecto con búsqueda y checkboxes.
// "Sólo activo" = selected vacío (la página decide qué hacer).
export default function MultiProjectPicker({
  projects,
  selected,
  onChange,
  activeProjectId,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filtered = q
    ? projects.filter((p) => (p.nombre || '').toLowerCase().includes(q.toLowerCase()))
    : projects;

  function toggle(id: number) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  const label =
    selected.length === 0
      ? 'Sólo proyecto activo'
      : selected.length === projects.length
      ? `Todos (${projects.length})`
      : `${selected.length} proyecto${selected.length > 1 ? 's' : ''}`;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 inline-flex items-center gap-2 px-3 rounded-md border border-border bg-muted/40 text-sm hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-expanded={open}
      >
        <span className="text-foreground">{label}</span>
        <CaretDown size={11} weight="bold" className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-40 w-72 max-w-[calc(100vw-1.5rem)] max-h-96 flex flex-col">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar proyecto..."
                className="w-full h-8 pl-7 pr-2 rounded-md border border-border bg-card text-sm outline-none focus:border-primary"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button type="button" onClick={() => onChange([])}
                className="flex-1 h-7 rounded text-[11px] font-medium border border-border bg-card hover:bg-muted">
                Sólo activo
              </button>
              <button type="button" onClick={() => onChange(projects.map((p) => p.id))}
                className="flex-1 h-7 rounded text-[11px] font-medium border border-border bg-card hover:bg-muted">
                Todos
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">Sin resultados</div>
            )}
            {filtered.map((p) => {
              const checked = selected.includes(p.id);
              const isActive = activeProjectId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 ${checked ? 'bg-primary/5' : ''}`}
                  title={p.nombre}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-primary border-primary text-white' : 'border-border bg-card'}`}>
                    {checked && <Check size={10} weight="bold" />}
                  </span>
                  <span className="truncate flex-1">{p.nombre}</span>
                  {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">activo</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
