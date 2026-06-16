// ClientsFiltersBar — v2 UI Clientes.
// Mismo patrón que LeadsFiltersBar: un botón "Filtros" que abre un popover con
// TODOS los filtros agrupados + pildoras de activos junto al botón.
//
// Filtros que maneja:
//   - búsqueda (debounced en el padre)
//   - gestor (responsable)
//   - producto
//   - rango de fechas (última compra)
//   - estado de pago (pagado/parcial/sin pagar/sin ventas) — client-side
//   - orden (recent, facturado, cobrado, pendiente, nombre)

import { useEffect, useRef, useState } from 'react';
import { Funnel, MagnifyingGlass, X, CaretDown } from '@phosphor-icons/react';

interface Gestor { id: number; nombre: string }
interface Producto { id: number; nombre: string }

interface Props {
  user: { role?: string } | null;
  search: string; setSearch: (v: string) => void;
  filterResp: string; setFilterResp: (v: string) => void;
  filterProducto: string; setFilterProducto: (v: string) => void;
  filterEstadoPago: string; setFilterEstadoPago: (v: string) => void;
  dateFrom: string; setDateFrom: (v: string) => void;
  dateTo: string; setDateTo: (v: string) => void;
  sortBy: string; setSortBy: (v: string) => void;
  gestores: Gestor[];
  productos: Producto[];
  totalBackend: number;
  filteredCount: number;
}

const ESTADO_PAGO_LABELS: Record<string, string> = {
  pagado: 'Pagados',
  parcial: 'Pago parcial',
  sin_pagar: 'Sin pagar',
  sin_ventas: 'Sin compras registradas',
};

const SORT_LABELS: Record<string, string> = {
  recent: 'Más reciente',
  facturado: 'Más facturado',
  cobrado: 'Más cobrado',
  pendiente: 'Más pendiente de cobro',
  nombre: 'Nombre A→Z',
};

export default function ClientsFiltersBar(props: Props) {
  const {
    user, search, setSearch, filterResp, setFilterResp,
    filterProducto, setFilterProducto, filterEstadoPago, setFilterEstadoPago,
    dateFrom, setDateFrom, dateTo, setDateTo, sortBy, setSortBy,
    gestores, productos, totalBackend, filteredCount,
  } = props;
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Lista de pildoras activas
  const activePills: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (search.trim()) activePills.push({ key: 'search', label: `🔎 "${search.slice(0, 20)}${search.length > 20 ? '…' : ''}"`, onClear: () => setSearch('') });
  if (filterResp === 'unassigned') activePills.push({ key: 'resp', label: 'Sin asignar', onClear: () => setFilterResp('') });
  else if (filterResp) {
    const g = gestores.find((x) => String(x.id) === filterResp);
    activePills.push({ key: 'resp', label: g?.nombre || filterResp, onClear: () => setFilterResp('') });
  }
  if (filterProducto) {
    const p = productos.find((x) => String(x.id) === filterProducto);
    const label = p?.nombre || filterProducto;
    activePills.push({ key: 'prod', label: label.length > 20 ? label.slice(0, 20) + '…' : label, onClear: () => setFilterProducto('') });
  }
  if (filterEstadoPago) activePills.push({ key: 'pago', label: ESTADO_PAGO_LABELS[filterEstadoPago] || filterEstadoPago, onClear: () => setFilterEstadoPago('') });
  if (dateFrom || dateTo) activePills.push({ key: 'date', label: `${dateFrom || '...'} → ${dateTo || 'hoy'}`, onClear: () => { setDateFrom(''); setDateTo(''); } });

  function clearAll() {
    setSearch('');
    setFilterResp('');
    setFilterProducto('');
    setFilterEstadoPago('');
    setDateFrom('');
    setDateTo('');
  }

  return (
    <div className="flex flex-wrap items-center gap-2 relative">
      {/* Botón Filtros */}
      <div className="relative" ref={popoverRef}>
        <button
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
          <CaretDown size={11} weight="bold" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 z-40 w-[min(540px,calc(100vw-2rem))] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              {/* Búsqueda */}
              <Section title="Búsqueda">
                <div className="relative">
                  <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nombre, email o teléfono…"
                    className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-muted/40 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </Section>

              {/* Filtros principales */}
              <Section title="Filtros principales">
                {isAdmin && (
                  <Row label="Gestor">
                    <select
                      value={filterResp}
                      onChange={(e) => setFilterResp(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                    >
                      <option value="">Todos los gestores</option>
                      <option value="unassigned">— Sin asignar —</option>
                      {gestores.map((g) => <option key={g.id} value={String(g.id)}>{g.nombre}</option>)}
                    </select>
                  </Row>
                )}
                <Row label="Programa">
                  <select
                    value={filterProducto}
                    onChange={(e) => setFilterProducto(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    <option value="">Todos los programas</option>
                    {productos.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
                  </select>
                </Row>
                <Row label="Estado pago">
                  <select
                    value={filterEstadoPago}
                    onChange={(e) => setFilterEstadoPago(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    <option value="">Cualquier estado de pago</option>
                    {Object.entries(ESTADO_PAGO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Row>
                <Row label="Última compra desde">
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full h-9 px-2 rounded-md border border-border bg-muted/40 text-sm" />
                </Row>
                <Row label="Última compra hasta">
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    className="w-full h-9 px-2 rounded-md border border-border bg-muted/40 text-sm" />
                </Row>
                <Row label="Orden">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Row>
              </Section>

              {/* Resumen */}
              <Section title="Resumen">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{filteredCount}</strong> clientes mostrados
                  {activePills.length > 0 ? ` de ${totalBackend} totales` : ''}
                </p>
              </Section>
            </div>
            {/* Footer */}
            <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
              <button onClick={clearAll} disabled={activePills.length === 0}
                className="h-8 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40">
                Limpiar todo
              </button>
              <button onClick={() => setOpen(false)}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pildoras activas */}
      {activePills.map((pill) => (
        <span key={pill.key}
          className="inline-flex items-center gap-1 h-9 pl-2.5 pr-1.5 rounded-md bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
          {pill.label}
          <button onClick={pill.onClear} aria-label={`Quitar filtro ${pill.label}`}
            className="ml-0.5 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-primary/20">
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
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
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
