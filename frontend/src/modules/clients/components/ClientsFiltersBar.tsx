// Filtros operativos de Clientes. Mantiene el patrón visual de Prospectos,
// pero evita importes y estados de venta: solo contacto, programa y cuotas.

import { useEffect, useRef, useState } from 'react';
import { Funnel, MagnifyingGlass, X, CaretDown } from '@phosphor-icons/react';

interface Gestor { id: number; nombre: string }
interface Producto { id: number; nombre: string }

interface Props {
  user: { role?: string } | null;
  search: string;
  setSearch: (value: string) => void;
  filterResp: string;
  setFilterResp: (value: string) => void;
  filterProducto: string;
  setFilterProducto: (value: string) => void;
  filterInstallments: string;
  setFilterInstallments: (value: string) => void;
  sortBy: string;
  setSortBy: (value: string) => void;
  gestores: Gestor[];
  productos: Producto[];
  totalBackend: number;
}

const INSTALLMENT_LABELS: Record<string, string> = {
  pending: 'Con cuotas pendientes',
  completed: 'Cuotas completadas',
  no_plan: 'Sin plan de cuotas',
};

const SORT_LABELS: Record<string, string> = {
  nombre: 'Nombre A→Z',
  pagos: 'Más pagos registrados',
  cuotas_pendientes: 'Más cuotas pendientes',
  proximo_vencimiento: 'Próximo vencimiento',
};

export default function ClientsFiltersBar(props: Props) {
  const {
    user,
    search,
    setSearch,
    filterResp,
    setFilterResp,
    filterProducto,
    setFilterProducto,
    filterInstallments,
    setFilterInstallments,
    sortBy,
    setSortBy,
    gestores,
    productos,
    totalBackend,
  } = props;
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const activePills: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (search.trim()) {
    activePills.push({
      key: 'search',
      label: `🔎 "${search.slice(0, 20)}${search.length > 20 ? '…' : ''}"`,
      onClear: () => setSearch(''),
    });
  }
  if (filterResp === 'unassigned') {
    activePills.push({ key: 'resp', label: 'Sin gestora', onClear: () => setFilterResp('') });
  } else if (filterResp) {
    const manager = gestores.find((item) => String(item.id) === filterResp);
    activePills.push({
      key: 'resp',
      label: manager?.nombre || filterResp,
      onClear: () => setFilterResp(''),
    });
  }
  if (filterProducto) {
    const product = productos.find((item) => String(item.id) === filterProducto);
    const label = product?.nombre || filterProducto;
    activePills.push({
      key: 'product',
      label: label.length > 20 ? `${label.slice(0, 20)}…` : label,
      onClear: () => setFilterProducto(''),
    });
  }
  if (filterInstallments) {
    activePills.push({
      key: 'installments',
      label: INSTALLMENT_LABELS[filterInstallments] || filterInstallments,
      onClear: () => setFilterInstallments(''),
    });
  }

  function clearAll() {
    setSearch('');
    setFilterResp('');
    setFilterProducto('');
    setFilterInstallments('');
  }

  return (
    <div className="flex flex-wrap items-center gap-2 relative">
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`h-9 inline-flex items-center gap-1.5 px-3 rounded-md border text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
            activePills.length > 0
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border bg-card hover:bg-muted'
          }`}
        >
          <Funnel size={14} weight={activePills.length > 0 ? 'fill' : 'bold'} />
          Filtros
          {activePills.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
              {activePills.length}
            </span>
          )}
          <CaretDown
            size={11}
            weight="bold"
            className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
          />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 z-40 w-[min(540px,calc(100vw-2rem))] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              <Section title="Búsqueda">
                <div className="relative">
                  <MagnifyingGlass
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Nombre, email o teléfono…"
                    className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-muted/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </Section>

              <Section title="Filtros principales">
                {isAdmin && (
                  <Row label="Gestora">
                    <select
                      value={filterResp}
                      onChange={(event) => setFilterResp(event.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                    >
                      <option value="">Todas las gestoras</option>
                      <option value="unassigned">— Sin gestora —</option>
                      {gestores.map((manager) => (
                        <option key={manager.id} value={String(manager.id)}>
                          {manager.nombre}
                        </option>
                      ))}
                    </select>
                  </Row>
                )}

                <Row label="Programa">
                  <select
                    value={filterProducto}
                    onChange={(event) => setFilterProducto(event.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    <option value="">Todos los programas</option>
                    {productos.map((product) => (
                      <option key={product.id} value={String(product.id)}>
                        {product.nombre}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row label="Estado de cuotas">
                  <select
                    value={filterInstallments}
                    onChange={(event) => setFilterInstallments(event.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    <option value="">Cualquier estado</option>
                    {Object.entries(INSTALLMENT_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Row>

                <Row label="Orden">
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    {Object.entries(SORT_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </Row>
              </Section>

              <Section title="Resumen">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{totalBackend}</strong> clientes encontrados
                </p>
              </Section>
            </div>

            <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={clearAll}
                disabled={activePills.length === 0}
                className="h-8 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Limpiar todo
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>

      {activePills.map((pill) => (
        <span
          key={pill.key}
          className="inline-flex items-center gap-1 h-9 pl-2.5 pr-1.5 rounded-md bg-primary/10 text-primary text-xs font-semibold border border-primary/20"
        >
          {pill.label}
          <button
            type="button"
            onClick={pill.onClear}
            aria-label={`Quitar filtro ${pill.label}`}
            className="ml-0.5 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-primary/20"
          >
            <X size={10} weight="bold" />
          </button>
        </span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 border-b border-border last:border-b-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-2">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
