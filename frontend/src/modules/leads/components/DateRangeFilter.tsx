import { useEffect, useRef, useState } from 'react';
import { CalendarBlank, CaretDown, X } from '@phosphor-icons/react';

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}

function ymd(d: Date): string {
  // Local YYYY-MM-DD (NO usar toISOString — convierte a UTC y rompe presets
  // como "Hoy" cuando el usuario esta en TZ negativa por la noche).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetRange(preset: string): [string, string] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'hoy') {
    const f = ymd(today);
    return [f, f];
  }
  if (preset === 'ayer') {
    const y = new Date(today.getTime() - 86400000);
    const f = ymd(y);
    return [f, f];
  }
  if (preset === '7d') {
    const f = ymd(new Date(today.getTime() - 6 * 86400000));
    return [f, ymd(today)];
  }
  if (preset === '30d') {
    const f = ymd(new Date(today.getTime() - 29 * 86400000));
    return [f, ymd(today)];
  }
  return ['', ''];
}

// Filtro de rango de fechas con presets (hoy / ayer / 7d / 30d / custom).
// Pensado para que el usuario foque rápido en leads recientes sin que los
// caros viejos los tapen.
export default function DateRangeFilter({ from, to, onChange, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(preset: string) {
    const [f, t] = presetRange(preset);
    onChange(f, t);
    setOpen(false);
  }

  // Label legible del estado actual
  let label = 'Todas las fechas';
  if (from && to) {
    if (from === to) {
      const today = ymd(new Date());
      const yesterday = ymd(new Date(Date.now() - 86400000));
      if (from === today) label = 'Hoy';
      else if (from === yesterday) label = 'Ayer';
      else label = from;
    } else {
      label = `${from} → ${to}`;
    }
  } else if (from) {
    label = `Desde ${from}`;
  } else if (to) {
    label = `Hasta ${to}`;
  }

  const active = !!(from || to);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-9 inline-flex items-center gap-2 px-3 rounded-md border text-sm font-medium transition-colors ${
          active
            ? 'bg-primary/10 border-primary/40 text-primary'
            : 'border-border bg-muted/40 hover:bg-muted/60 text-foreground'
        }`}
        aria-expanded={open}
      >
        <CalendarBlank size={14} weight={active ? 'fill' : 'regular'} />
        <span className="whitespace-nowrap">{label}</span>
        {active && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange('', ''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange('', ''); } }}
            className="p-0.5 -mr-1 hover:text-foreground"
            aria-label="Limpiar fecha"
          >
            <X size={11} weight="bold" />
          </span>
        )}
        <CaretDown size={10} weight="bold" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-40 w-64 p-2">
          <div className="grid grid-cols-2 gap-1 mb-2">
            <button type="button" onClick={() => pick('hoy')} className="h-8 rounded text-xs font-medium border border-border bg-card hover:bg-muted">Hoy</button>
            <button type="button" onClick={() => pick('ayer')} className="h-8 rounded text-xs font-medium border border-border bg-card hover:bg-muted">Ayer</button>
            <button type="button" onClick={() => pick('7d')} className="h-8 rounded text-xs font-medium border border-border bg-card hover:bg-muted">Últ. 7 días</button>
            <button type="button" onClick={() => pick('30d')} className="h-8 rounded text-xs font-medium border border-border bg-card hover:bg-muted">Últ. 30 días</button>
          </div>
          <div className="border-t border-border pt-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Rango personalizado</p>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="date"
                value={from}
                onChange={(e) => onChange(e.target.value, to || e.target.value)}
                className="h-8 px-2 rounded border border-border bg-card text-xs"
                aria-label="Desde"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => onChange(from, e.target.value)}
                className="h-8 px-2 rounded border border-border bg-card text-xs"
                aria-label="Hasta"
              />
            </div>
          </div>
          {active && (
            <button
              type="button"
              onClick={() => { onChange('', ''); setOpen(false); }}
              className="w-full mt-2 h-7 rounded text-[11px] text-muted-foreground hover:bg-muted"
            >
              Quitar filtro de fecha
            </button>
          )}
        </div>
      )}
    </div>
  );
}
