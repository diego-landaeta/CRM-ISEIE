// Selector de fecha con calendario popover. Sin deps externas:
// formatea ISO YYYY-MM-DD ↔ DD-MM-YYYY (es-ES) y abre un mini calendario
// navegable. Cierra al click fuera o ESC.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CaretLeft, CaretRight } from '@phosphor-icons/react';

interface DatePickerInputProps {
  value: string;                       // ISO 'YYYY-MM-DD'
  onChange: (iso: string) => void;
  className?: string;
  required?: boolean;
  ariaLabel?: string;
  /** Marca visual de error (border rojo). */
  invalid?: boolean;
}

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function fmtDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function DatePickerInput({ value, onChange, className = '', required, ariaLabel, invalid }: DatePickerInputProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selected = parseIso(value);
  const [cursor, setCursor] = useState<Date>(() => selected || new Date());

  // Si el valor cambia desde fuera (form reset), reposicionar cursor
  useEffect(() => {
    const d = parseIso(value);
    if (d) setCursor(d);
  }, [value]);

  // Cierre por click fuera o ESC
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Construye matriz 6×7 del mes mostrado, con días del mes anterior/siguiente
  // para rellenar la cuadrícula. La semana empieza en lunes.
  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const offset = (firstOfMonth.getDay() + 6) % 7; // Lunes = 0
    const start = new Date(year, month, 1 - offset);
    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === month });
    }
    return cells;
  }, [cursor]);

  const today = new Date();
  const todayIso = toIso(today);
  const selIso = selected ? toIso(selected) : '';

  const borderClass = invalid ? 'border-red-400 ring-2 ring-red-400/20' : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/10';

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel || 'Seleccionar fecha'}
        aria-haspopup="dialog"
        aria-expanded={open ? true : undefined}
        className={`w-full h-9 px-3 rounded-md border bg-muted/50 text-sm outline-none transition-all flex items-center gap-2 ${borderClass}`}
      >
        <Calendar size={14} className="text-muted-foreground shrink-0" weight="duotone" />
        <span className={selected ? '' : 'text-muted-foreground'}>
          {selected ? fmtDisplay(value) : (required ? 'Selecciona fecha *' : 'Selecciona fecha')}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute z-50 mt-1 left-0 w-72 max-w-[calc(100vw-1.5rem)] bg-card border border-border rounded-lg shadow-xl p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              aria-label="Mes anterior"
            >
              <CaretLeft size={14} />
            </button>
            <div className="text-sm font-semibold tabular-nums">
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </div>
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              aria-label="Mes siguiente"
            >
              <CaretRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-[10px] text-muted-foreground text-center font-medium py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {grid.map(({ date, inMonth }, i) => {
              const iso = toIso(date);
              const isSel = iso === selIso;
              const isToday = iso === todayIso;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(iso); setOpen(false); }}
                  className={[
                    'h-8 text-xs rounded transition-colors tabular-nums',
                    inMonth ? '' : 'text-muted-foreground/40',
                    isSel ? 'bg-primary text-primary-foreground font-semibold' : isToday ? 'ring-1 ring-primary/40' : 'hover:bg-muted',
                  ].join(' ')}
                  aria-label={iso}
                  aria-current={isSel ? 'date' : undefined}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => { onChange(todayIso); setCursor(today); setOpen(false); }}
              className="text-[11px] text-primary hover:underline"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
