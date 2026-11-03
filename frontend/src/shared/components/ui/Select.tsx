import { useEffect, useId, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

export type SelectOption<T> = { value: T; label: string };

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  size?: 'sm' | 'md';
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** El `id` del botón, para que la etiqueta de un `Field` (`htmlFor`) lo enfoque. */
  id?: string;
}

export default function Select<T>({
  value,
  onChange,
  options,
  size = 'md',
  placeholder,
  ariaLabel,
  disabled,
  className,
  id,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number>(-1);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => Object.is(o.value, value));

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (listRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => Object.is(o.value, value));
    setHighlighted(idx >= 0 ? idx : 0);
    listRef.current?.focus();
  }, [open, options, value]);

  useEffect(() => {
    if (!open || highlighted < 0) return;
    const el = listRef.current?.querySelectorAll('[role="option"]')[highlighted] as HTMLElement | undefined;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlighted]);

  function commit(idx: number) {
    const opt = options[idx];
    if (opt) onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onButtonKey(e: ReactKeyboardEvent) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  // Como el desplegable del navegador: una letra salta a la siguiente opción
  // que empieza por ella (sin mirar tildes ni mayúsculas). En listas largas
  // —el catálogo, las facturas, los campus— es como se elige con el teclado.
  function saltarPorLetra(letra: string): void {
    const plano = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const l = plano(letra);
    const n = options.length;
    for (let paso = 1; paso <= n; paso++) {
      const i = ((highlighted < 0 ? -1 : highlighted) + paso) % n;
      if (plano(options[i].label.replace(/^[^\p{L}\p{N}]+/u, '')).startsWith(l)) { setHighlighted(i); return; }
    }
  }

  function onListKey(e: ReactKeyboardEvent) {
    if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      saltarPorLetra(e.key);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0) commit(highlighted);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlighted(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlighted(options.length - 1);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const triggerCls =
    size === 'sm'
      ? 'h-7 px-2 text-[11px] gap-1.5'
      : 'h-9 px-3 text-sm gap-2';
  const itemCls =
    size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-sm';

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onButtonKey}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={cn(
          // El mismo fondo, borde y esquinas que `inputClass` (#106): al lado de una
          // casilla de texto, el desplegable salía casi blanco y más redondeado,
          // y dos campos de la misma fila no se veían iguales.
          'w-full flex items-center rounded-md border border-border bg-muted/50 text-foreground transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary',
          'hover:bg-muted/70 disabled:opacity-50 disabled:cursor-not-allowed',
          triggerCls,
        )}
      >
        <span className={cn('flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <CaretDown
          size={size === 'sm' ? 10 : 12}
          weight="bold"
          className={cn('text-muted-foreground transition-transform flex-shrink-0', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onListKey}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-[60] overflow-y-auto max-h-60 rounded-lg border border-border bg-card shadow-2xl py-1 outline-none animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150"
        >
          {options.map((opt, idx) => {
            const isSelected = Object.is(opt.value, value);
            const isHigh = idx === highlighted;
            return (
              <li
                key={String(opt.value) + ':' + idx}
                role="option"
                aria-selected={isSelected ? 'true' : 'false'}
                // onMouseMove y no onMouseEnter: al saltar con una letra la lista se
                // desplaza, pasa por debajo del ratón quieto y «entraba» en otra opción,
                // que pisaba la elegida con el teclado (visto en la prueba a mano, #106).
                onMouseMove={() => { if (highlighted !== idx) setHighlighted(idx); }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(idx);
                }}
                className={cn(
                  'flex items-center gap-2 cursor-pointer transition-colors',
                  itemCls,
                  isHigh ? 'bg-secondary text-foreground' : 'text-foreground/90',
                  isSelected && 'font-semibold',
                )}
              >
                <span className="flex-1 truncate">{opt.label}</span>
                {isSelected && <Check size={size === 'sm' ? 10 : 12} weight="bold" className="text-primary flex-shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
