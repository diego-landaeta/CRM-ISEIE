import { useEffect, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass, X } from '@phosphor-icons/react';

export interface SearchableOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  allLabel?: string;
  className?: string;
  ariaLabel?: string;
  maxWidth?: string;
}

// Select con búsqueda: input filtrable + dropdown.
// Pensado para listas largas (programas, gestores) donde el <select> nativo no escala.
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Buscar...',
  allLabel = 'Todos',
  className = '',
  ariaLabel,
  maxWidth = '220px',
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label || allLabel;
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div ref={wrapRef} className={`relative ${className}`} style={{ maxWidth }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-expanded={open}
        className="h-9 w-full pl-3 pr-8 rounded-md border border-border bg-muted/40 text-sm text-left flex items-center gap-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 hover:bg-muted/60"
      >
        <span className={`truncate flex-1 ${value ? 'text-foreground' : 'text-muted-foreground'}`}>{selectedLabel}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(''); } }}
            className="text-muted-foreground hover:text-foreground p-0.5 -mr-1"
            aria-label="Limpiar"
          >
            <X size={12} weight="bold" />
          </span>
        )}
        <CaretDown size={11} weight="bold" className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg z-40 max-h-80 overflow-hidden flex flex-col" style={{ minWidth: maxWidth }}>
          <div className="p-2 border-b border-border">
            <div className="relative">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={placeholder}
                className="w-full h-8 pl-7 pr-2 rounded-md border border-border bg-card text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted ${!value ? 'bg-primary/10 text-primary font-medium' : ''}`}
            >
              {allLabel}
            </button>
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">Sin resultados</div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted ${value === o.value ? 'bg-primary/10 text-primary font-medium' : ''}`}
                title={o.label}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
