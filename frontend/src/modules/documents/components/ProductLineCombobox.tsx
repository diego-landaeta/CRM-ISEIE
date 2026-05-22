import { useState, useRef, useEffect } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import type { Product } from '@/modules/products/api/products.api';

interface ProductLineComboboxProps {
  value: string;
  onChange: (descripcion: string) => void;
  /** Cuando el usuario elige un producto del catálogo. Recibe el producto entero
   *  para que el padre pueda autorrellenar precio (y otros campos). */
  onSelectProduct?: (p: Product) => void;
  products: Product[];
  placeholder?: string;
  className?: string;
}

const inp = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all';

/**
 * Input de descripción de línea de factura con autocomplete contra el catálogo
 * de productos del proyecto. Permite tanto seleccionar un producto existente
 * como escribir texto libre.
 */
export default function ProductLineCombobox({
  value, onChange, onSelectProduct, products, placeholder, className,
}: ProductLineComboboxProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = value
    ? products.filter(p => p.nombre.toLowerCase().includes(value.toLowerCase()))
    : products;

  function handlePick(p: Product) {
    onChange(p.nombre);
    onSelectProduct?.(p);
    setOpen(false);
  }

  return (
    <div className={`relative ${className || ''}`} ref={ref}>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        className={inp + ' pr-8'}
        placeholder={placeholder}
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Mostrar catálogo de productos"
        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      >
        <CaretDown size={12} weight="bold" />
      </button>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
          {filtered.slice(0, 12).map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePick(p)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-3 border-b border-border last:border-0"
            >
              <span className="truncate">{p.nombre}</span>
              {p.precio != null && p.precio !== '' && (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {Number(p.precio).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                </span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground italic">
              Sin coincidencias en el catálogo
            </div>
          )}
        </div>
      )}
    </div>
  );
}
