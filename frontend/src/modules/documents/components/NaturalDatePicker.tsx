// Variante del DatePickerInput pensada para los campos del certificado, que
// guardan la fecha como texto natural en español ("7 de mayo de 2026") en
// lugar de ISO. Combina:
//   - input editable libre (para teclear formato custom)
//   - boton de calendario que abre popover; al elegir dia rellena con
//     formato natural es-ES.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, CaretLeft, CaretRight } from '@phosphor-icons/react';

interface NaturalDatePickerProps {
  value: string;
  onChange: (text: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
}

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_TITLE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function fmtNaturalEs(d: Date): string {
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

// Heuristica: intenta parsear "7 de mayo de 2026" o "23 de Noviembre de 2025"
// para posicionar el cursor del calendario en el mes/anio correcto al abrir.
function parseNaturalEs(text: string): Date | null {
  if (!text) return null;
  const m = text.toLowerCase().match(/^(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const monthIdx = MONTHS.indexOf(m[2]);
  const year = Number(m[3]);
  if (monthIdx < 0 || day < 1 || day > 31) return null;
  return new Date(year, monthIdx, day);
}

export default function NaturalDatePicker({
  value, onChange, className = '', placeholder, required, invalid, ariaLabel,
}: NaturalDatePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const parsed = parseNaturalEs(value);
  const [cursor, setCursor] = useState<Date>(() => parsed || new Date());

  useEffect(() => {
    const d = parseNaturalEs(value);
    if (d) setCursor(d);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const offset = (firstOfMonth.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === month });
    }
    return cells;
  }, [cursor]);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const selKey = parsed ? `${parsed.getFullYear()}-${parsed.getMonth()}-${parsed.getDate()}` : '';

  const inputBorder = invalid ? 'border-red-400 ring-2 ring-red-400/20' : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/10';

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className={`flex items-stretch h-9 rounded-md border bg-muted/50 transition-all ${inputBorder}`}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || (required ? 'Ej: 7 de mayo de 2026 *' : 'Ej: 7 de mayo de 2026')}
          aria-label={ariaLabel || 'Fecha (texto natural)'}
          className="flex-1 min-w-0 h-full px-3 bg-transparent text-sm outline-none rounded-md"
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Abrir calendario"
          aria-haspopup="dialog"
          aria-expanded={open ? true : undefined}
          className="px-2 h-full text-muted-foreground hover:text-foreground border-l border-border/60 hover:bg-muted transition-colors rounded-r-md"
        >
          <Calendar size={14} weight="duotone" />
        </button>
      </div>

      {open && (
        <div role="dialog" className="absolute z-50 mt-1 right-0 w-72 max-w-[calc(100vw-1.5rem)] bg-card border border-border rounded-lg shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              aria-label="Mes anterior"
            ><CaretLeft size={14} /></button>
            <div className="text-sm font-semibold tabular-nums">
              {MONTHS_TITLE[cursor.getMonth()]} {cursor.getFullYear()}
            </div>
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              aria-label="Mes siguiente"
            ><CaretRight size={14} /></button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-[10px] text-muted-foreground text-center font-medium py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {grid.map(({ date, inMonth }, i) => {
              const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
              const isSel = key === selKey;
              const isToday = key === todayKey;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onChange(fmtNaturalEs(date)); setOpen(false); }}
                  className={[
                    'h-8 text-xs rounded transition-colors tabular-nums',
                    inMonth ? '' : 'text-muted-foreground/40',
                    isSel ? 'bg-primary text-primary-foreground font-semibold' : isToday ? 'ring-1 ring-primary/40' : 'hover:bg-muted',
                  ].join(' ')}
                  aria-label={fmtNaturalEs(date)}
                  aria-current={isSel ? 'date' : undefined}
                >{date.getDate()}</button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => { onChange(fmtNaturalEs(today)); setCursor(today); setOpen(false); }}
              className="text-[11px] text-primary hover:underline"
            >Hoy</button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
