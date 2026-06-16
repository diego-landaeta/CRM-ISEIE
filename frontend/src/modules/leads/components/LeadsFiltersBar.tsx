// LeadsFiltersBar — v2 UI Prospectos.
// Reemplaza las 4 franjas (filtros, stats, quick-filters, leyenda) del LeadsPage v1
// por una sola fila compacta con:
//   - Botón "Filtros" que abre popover con TODO dentro (search, dropdowns, fechas,
//     orden, quick filters, duplicados/reincidentes, stats)
//   - Pildoras de filtros activos (clic en × las quita)
//   - Botón "Asignar pendientes" cuando aplica
//
// Cualquier modificación de filtros se notifica al padre via los setters; este
// componente NO mantiene estado propio (salvo `open` del popover).

import { useEffect, useRef, useState } from 'react';
import {
  Funnel, MagnifyingGlass, X, CaretDown, Lightning, WarningCircle,
} from '@phosphor-icons/react';
import SearchableSelect from '@/shared/components/ui/SearchableSelect';
import DateRangeFilter from './DateRangeFilter';
// ISEIE es single-project: NO usamos MultiProjectPicker (no aplica).

const STATUS_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  por_contactar: 'Por contactar',
  contactado: 'Contactado',
  en_seguimiento: 'En seguimiento',
  convertido: 'Convertido',
  no_interesado: 'No interesado',
  proxima_convocatoria: 'Próxima convocatoria',
};

const ORIGEN_LABELS: Record<string, string> = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok Ads',
  whatsapp: 'WhatsApp',
  organico: 'Orgánico',
  chatgpt_ia: 'ChatGPT IA',
  referido: 'Referido',
  directo: 'Directo',
};

const QUICK_LABELS: Record<string, string> = {
  urgent: 'Necesitan acción hoy',
  overdue: 'Vencidos',
  today: 'Hoy',
  tomorrow: 'Mañana',
  week: '7 días',
  'no-reminder': 'Sin programar',
  'no-contact': 'Sin contacto',
};

const SORT_LABELS: Record<string, string> = {
  recent_value: '📅 Día reciente · más valor (default)',
  urgency: '⚡ Urgencia (valor × frescura)',
  value: '💰 Más valor primero',
  recent: '🕒 Más recientes primero',
};

interface Props {
  activeProject: { id?: number | null; nombre?: string };
  gestores: Array<{ id: number; nombre: string }>;
  products: Array<{ id: number; nombre: string }>;
  user: { role?: string } | null;
  search: string; setSearch: (v: string) => void;
  filterEstado: string; setFilterEstado: (v: string) => void;
  filterOrigen: string; setFilterOrigen: (v: string) => void;
  filterResponsable: string; setFilterResponsable: (v: string) => void;
  filterProducto: string; setFilterProducto: (v: string) => void;
  dateFrom: string; dateTo: string; setDateRange: (from: string, to: string) => void;
  sortMode: string; setSortMode: (v: 'value' | 'recent' | 'urgency' | 'recent_value') => void;
  quickFilter: string; setQuickFilter: (v: string) => void;
  quickCounts: { overdue: number; today: number; tomorrow: number; week: number; noReminder: number; noContact: number; urgent: number };
  filterDup: boolean; setFilterDup: (v: boolean) => void;
  filterReincidente: boolean; setFilterReincidente: (v: boolean) => void;
  stats: Record<string, number> | null | undefined;
  leadsCount: number;
  filteredCount: number;
  onAssignPending: () => Promise<void> | void;
}

export default function LeadsFiltersBar(props: Props) {
  const {
    activeProject,
    gestores, products, user,
    search, setSearch, filterEstado, setFilterEstado,
    filterOrigen, setFilterOrigen, filterResponsable, setFilterResponsable,
    filterProducto, setFilterProducto, dateFrom, dateTo, setDateRange,
    sortMode, setSortMode, quickFilter, setQuickFilter, quickCounts,
    filterDup, setFilterDup, filterReincidente, setFilterReincidente,
    stats, leadsCount, filteredCount, onAssignPending,
  } = props;

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click fuera cierra el popover
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Conteo de filtros activos para el badge
  const activePills: Array<{ key: string; label: string; onClear: () => void }> = [];
  if (search.trim()) activePills.push({ key: 'search', label: `🔎 "${search.slice(0, 20)}${search.length > 20 ? '…' : ''}"`, onClear: () => setSearch('') });
  if (filterEstado) activePills.push({ key: 'estado', label: STATUS_LABELS[filterEstado] || filterEstado, onClear: () => setFilterEstado('') });
  if (filterOrigen) activePills.push({ key: 'origen', label: ORIGEN_LABELS[filterOrigen] || filterOrigen, onClear: () => setFilterOrigen('') });
  if (filterResponsable) {
    const label = filterResponsable === 'unassigned'
      ? 'Sin asignar'
      : gestores.find((g) => String(g.id) === filterResponsable)?.nombre || filterResponsable;
    activePills.push({ key: 'resp', label, onClear: () => setFilterResponsable('') });
  }
  if (filterProducto) {
    const label = products.find((p) => String(p.id) === filterProducto)?.nombre || filterProducto;
    activePills.push({ key: 'prod', label: label.length > 20 ? label.slice(0, 20) + '…' : label, onClear: () => setFilterProducto('') });
  }
  if (dateFrom || dateTo) activePills.push({ key: 'date', label: `${dateFrom || '...'} → ${dateTo || 'hoy'}`, onClear: () => setDateRange('', '') });
  if (quickFilter) activePills.push({ key: 'quick', label: QUICK_LABELS[quickFilter] || quickFilter, onClear: () => setQuickFilter('') });
  if (filterDup) activePills.push({ key: 'dup', label: 'Duplicados', onClear: () => setFilterDup(false) });
  if (filterReincidente) activePills.push({ key: 'rein', label: 'Reincidentes', onClear: () => setFilterReincidente(false) });

  function clearAll() {
    setSearch('');
    setFilterEstado('');
    setFilterOrigen('');
    setFilterResponsable('');
    setFilterProducto('');
    setDateRange('', '');
    setQuickFilter('');
    setFilterDup(false);
    setFilterReincidente(false);
  }

  const showAssignBtn = isAdmin
    && ((stats?.sin_asignar ?? 0) > 0 || filterResponsable === 'unassigned')
    && activeProject?.id && activeProject.id > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 relative">
      {/* Botón Filtros con popover */}
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
          <div className="absolute left-0 top-full mt-2 z-40 w-[min(560px,calc(100vw-2rem))] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
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
                <Row label="Estado">
                  <select
                    value={filterEstado}
                    onChange={(e) => setFilterEstado(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    <option value="">Todos los estados</option>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Row>
                <Row label="Canal">
                  <SearchableSelect
                    value={filterOrigen}
                    onChange={(v) => setFilterOrigen(v)}
                    options={Object.entries(ORIGEN_LABELS).map(([value, label]) => ({ value, label }))}
                    placeholder="Buscar canal…"
                    allLabel="Todos los canales"
                    ariaLabel="Canal"
                    maxWidth="100%"
                  />
                </Row>
                {isAdmin && (
                  <Row label="Gestor">
                    <SearchableSelect
                      value={filterResponsable}
                      onChange={(v) => setFilterResponsable(v)}
                      options={[
                        { value: 'unassigned', label: '— Sin asignar —' },
                        ...gestores.map((g) => ({ value: String(g.id), label: g.nombre })),
                      ]}
                      placeholder="Buscar gestor…"
                      allLabel="Todos los gestores"
                      ariaLabel="Gestor"
                      maxWidth="100%"
                    />
                  </Row>
                )}
                <Row label="Programa">
                  <SearchableSelect
                    value={filterProducto}
                    onChange={(v) => setFilterProducto(v)}
                    options={(products || []).map((p) => ({ value: String(p.id), label: p.nombre }))}
                    placeholder="Buscar programa…"
                    allLabel="Todos los programas"
                    ariaLabel="Programa"
                    maxWidth="100%"
                  />
                </Row>
                <Row label="Fechas">
                  <DateRangeFilter from={dateFrom} to={dateTo} onChange={(f, t) => setDateRange(f, t)} />
                </Row>
                <Row label="Orden">
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as 'value' | 'recent' | 'urgency' | 'recent_value')}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm"
                  >
                    {Object.entries(SORT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Row>
              </Section>

              {/* Filtros rápidos */}
              <Section title="Filtros rápidos">
                <div className="flex flex-wrap gap-1.5">
                  <QuickChip active={!quickFilter} onClick={() => setQuickFilter('')} label="Todos" />
                  <QuickChip active={quickFilter === 'urgent'} onClick={() => setQuickFilter('urgent')}
                    label="Necesitan acción hoy" count={quickCounts.urgent} tone="danger" />
                  <QuickChip active={quickFilter === 'overdue'} onClick={() => setQuickFilter('overdue')}
                    label="Vencidos" count={quickCounts.overdue} tone="danger" />
                  <QuickChip active={quickFilter === 'today'} onClick={() => setQuickFilter('today')}
                    label="Hoy" count={quickCounts.today} tone="warning" />
                  <QuickChip active={quickFilter === 'tomorrow'} onClick={() => setQuickFilter('tomorrow')}
                    label="Mañana" count={quickCounts.tomorrow} tone="default" />
                  <QuickChip active={quickFilter === 'week'} onClick={() => setQuickFilter('week')}
                    label="7 días" count={quickCounts.week} tone="default" />
                  <QuickChip active={quickFilter === 'no-reminder'} onClick={() => setQuickFilter('no-reminder')}
                    label="Sin programar" count={quickCounts.noReminder} tone="default" />
                  <QuickChip active={quickFilter === 'no-contact'} onClick={() => setQuickFilter('no-contact')}
                    label="Sin contacto" count={quickCounts.noContact} tone="default" />
                </div>
              </Section>

              {isAdmin && (
                <Section title="Avanzado (admin)">
                  <div className="flex flex-wrap gap-1.5">
                    <QuickChip active={filterDup} onClick={() => setFilterDup(!filterDup)}
                      label="Duplicados" tone="warning" />
                    <QuickChip active={filterReincidente} onClick={() => setFilterReincidente(!filterReincidente)}
                      label="Reincidentes" tone="danger" />
                  </div>
                </Section>
              )}

              {/* Stats compactos */}
              {stats && (
                <Section title="Resumen">
                  <div className="flex flex-wrap gap-1.5">
                    <StatPill label="Total" value={stats.total || 0} />
                    <StatPill label="Nuevos" value={stats.nuevo || 0} dot="#3b82f6" />
                    <StatPill label="Por contactar" value={stats.por_contactar || 0} dot="#f59e0b" />
                    <StatPill label="Contactados" value={stats.contactado || 0} dot="#10b981" />
                    <StatPill label="En seguimiento" value={stats.en_seguimiento || 0} dot="#eab308" />
                    <StatPill label="Convertidos" value={stats.convertido || 0} dot="#8b5cf6" />
                    <StatPill label="No interesado" value={stats.no_interesado || 0} dot="#ef4444" />
                  </div>
                  {quickFilter && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      <strong className="text-foreground">{filteredCount}</strong> filtrados
                      de <strong className="text-foreground">{leadsCount}</strong> cargados
                    </p>
                  )}
                </Section>
              )}
            </div>
            {/* Footer del popover */}
            <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
              <button
                onClick={clearAll}
                disabled={activePills.length === 0}
                className="h-8 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Limpiar todo
              </button>
              <button
                onClick={() => setOpen(false)}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pildoras de filtros activos */}
      {activePills.map((pill) => (
        <span
          key={pill.key}
          className="inline-flex items-center gap-1 h-9 pl-2.5 pr-1.5 rounded-md bg-primary/10 text-primary text-xs font-semibold border border-primary/20"
        >
          {pill.label}
          <button
            onClick={pill.onClear}
            aria-label={`Quitar filtro ${pill.label}`}
            className="ml-0.5 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-primary/20"
          >
            <X size={10} weight="bold" />
          </button>
        </span>
      ))}

      {/* Asignar pendientes (cuando aplica) */}
      {showAssignBtn && (
        <button
          onClick={onAssignPending}
          className="ml-auto h-9 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
          title="Aplica round-robin a todos los prospectos sin responsable"
        >
          <WarningCircle size={13} weight="fill" />
          Asignar pendientes
          {(stats?.sin_asignar ?? 0) > 0 && (
            <span className="bg-white text-amber-700 text-[10px] font-black px-1.5 py-0.5 rounded">
              {stats?.sin_asignar}
            </span>
          )}
        </button>
      )}

      {/* Indicador inline de "filtrados de cargados" cuando hay filtros */}
      {activePills.length > 0 && (
        <span className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground ${showAssignBtn ? '' : 'ml-auto'}`}>
          <Lightning size={11} weight="fill" className="text-primary" />
          <strong className="text-foreground">{filteredCount}</strong> filtrados
        </span>
      )}
    </div>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────
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
    <div className="grid grid-cols-[90px_1fr] items-center gap-2">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// Duplicados de LeadsPage para no acoplarnos a internal helpers. Si LeadsPage v1
// muere, estos quedan vivos aquí.
type ChipTone = 'default' | 'danger' | 'warning';
function QuickChip({ active, onClick, label, count, tone = 'default' }: { active: boolean; onClick: () => void; label: string; count?: number; tone?: ChipTone }) {
  const toneActive: string = ({
    default: 'bg-primary text-white',
    danger: 'bg-red-600 text-white',
    warning: 'bg-amber-600 text-white',
  } as Record<ChipTone, string>)[tone];
  const toneIdleCount: string = ({
    default: 'bg-primary/15 text-primary',
    danger: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  } as Record<ChipTone, string>)[tone];
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
        active ? toneActive : 'bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={`text-[10px] font-bold rounded-full px-1.5 ${active ? 'bg-white/20' : toneIdleCount}`}>{count}</span>
      )}
    </button>
  );
}
function StatPill({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-muted/40 flex-shrink-0">
      {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />}
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
