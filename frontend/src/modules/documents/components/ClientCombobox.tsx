import { useEffect, useRef, useState } from 'react';
import { MagnifyingGlass, X, User as UserIcon } from '@phosphor-icons/react';
import client from '@/shared/api/client';

export interface ClientPick {
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  dni?: string | null;
  direccion?: string | null;
}

interface LeadResult {
  id: number;
  nombre: string;
  email?: string;
  telefono?: string;
  dni?: string | null;
  direccion?: string | null;
  status?: string;
  estado?: string;
}

interface Props {
  projectId: number | null | undefined;
  value: string;
  onChange: (nombre: string) => void;
  /**
   * Llamado cuando el usuario selecciona un cliente existente. Recibe el
   * objeto completo para que el form pueda pre-rellenar otros campos
   * (DNI, dirección).
   */
  onSelect?: (client: ClientPick) => void;
  placeholder?: string;
}

const inp = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all';

export default function ClientCombobox({ projectId, value, onChange, onSelect, placeholder = 'Buscar cliente o escribir nombre nuevo…' }: Props) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Click fuera = cerrar
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Fetch con debounce 250ms
  useEffect(() => {
    if (!projectId || !value || value.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await client.get(
          `/leads?projectId=${projectId}&search=${encodeURIComponent(value)}&limit=8`,
          { signal: ctrl.signal },
        );
        if (ctrl.signal.aborted) return;
        if (res.success) setResults((res.data as LeadResult[]) || []);
      } catch (err: any) {
        if (err?.name !== 'AbortError') setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [projectId, value]);

  function handleSelect(c: LeadResult) {
    onChange(c.nombre);
    onSelect?.({
      nombre: c.nombre,
      email: c.email || null,
      telefono: c.telefono || null,
      dni: c.dni || null,
      direccion: c.direccion || null,
    });
    setOpen(false);
    setResults([]);
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={inp + ' pr-9'}
          autoComplete="off"
        />
        {value ? (
          <button
            type="button"
            onClick={() => { onChange(''); inputRef.current?.focus(); }}
            aria-label="Limpiar"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
          >
            <X size={14} />
          </button>
        ) : (
          <MagnifyingGlass size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        )}
      </div>

      {open && value.length >= 2 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Buscando…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Sin coincidencias. Se usará "<span className="font-semibold text-foreground">{value}</span>" como cliente nuevo.
            </div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleSelect(c)}
              className="w-full text-left px-3 py-2 hover:bg-muted flex items-start gap-2 border-b border-border last:border-0"
            >
              <UserIcon size={14} weight="regular" className="text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{c.nombre}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {c.email}
                  {c.telefono && ` · ${c.telefono}`}
                </p>
              </div>
              {(c.status === 'convertido' || c.estado === 'convertido') && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 font-semibold flex-shrink-0">
                  cliente
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
