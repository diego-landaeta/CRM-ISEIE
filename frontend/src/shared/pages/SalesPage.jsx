import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, Receipt, Funnel, Download, ArrowRight,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';

const RegisterSaleDialog = lazy(() => import('@/modules/sales/components/RegisterSaleDialog'));
const TopProductsCard = lazy(() => import('@/modules/sales/components/TopProductsCard'));

const STATUS_FILTERS = [
  { id: 'all',       label: 'Todas' },
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'pagado',    label: 'Pagadas' },
  { id: 'parcial',   label: 'Parciales' },
];

const STATUS_BADGE = {
  pendiente: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  parcial:   'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  pagado:    'bg-[hsl(var(--iseie-green))]/10 text-[hsl(var(--iseie-green))]',
  cancelado: 'bg-muted text-muted-foreground',
};

function formatMoney(n, currency = 'EUR') {
  const value = Number(n || 0);
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

function formatDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(d).slice(0, 10);
  }
}

function deriveStatus(c) {
  const total = Number(c.importe_total || 0);
  const pagado = Number(c.importe_pagado || 0);
  if (total <= 0) return 'pendiente';
  if (pagado >= total) return 'pagado';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

function KpiSmall({ label, value, hint, tone }) {
  const toneClass = {
    paid:    'text-[hsl(var(--iseie-green))]',
    pending: 'text-amber-600 dark:text-amber-400',
    over:    'text-rose-600 dark:text-rose-400',
  }[tone] || '';
  return (
    <div className="rounded-2xl bg-card border border-border p-5">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

export default function SalesPage() {
  const { activeProject } = useAuth();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const projectId = activeProject?.id;

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    client.get('/conversions', { params: { projectId, limit: 200 } })
      .then((r) => { if (!cancelled) setList(Array.isArray(r?.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setList([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  const enriched = useMemo(
    () => (list || []).map((c) => ({ ...c, _status: deriveStatus(c) })),
    [list]
  );

  const counts = useMemo(() => {
    const acc = { all: enriched.length, pendiente: 0, pagado: 0, parcial: 0 };
    for (const c of enriched) acc[c._status] = (acc[c._status] || 0) + 1;
    return acc;
  }, [enriched]);

  const kpis = useMemo(() => {
    const total = enriched.reduce((s, c) => s + Number(c.importe_total || 0), 0);
    const pagado = enriched.reduce((s, c) => s + Number(c.importe_pagado || 0), 0);
    const pendiente = total - pagado;
    return { total, pagado, pendiente, count: enriched.length };
  }, [enriched]);

  const filtered = useMemo(() => {
    let out = enriched;
    if (status !== 'all') out = out.filter((c) => c._status === status);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((c) =>
        (c.lead_nombre || '').toLowerCase().includes(q) ||
        (c.lead_email  || '').toLowerCase().includes(q) ||
        (c.producto_nombre || '').toLowerCase().includes(q) ||
        (c.referencia || '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [enriched, status, search]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conversiones, pagos y devoluciones — {activeProject?.nombre || ''}.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              if (!filtered.length) return;
              const rows = [
                ['Fecha', 'Prospecto', 'Email', 'Producto', 'Total', 'Pagado', 'Pendiente', 'Estado', 'Método'],
                ...filtered.map((c) => [
                  c.fecha_compra ? new Date(c.fecha_compra).toLocaleDateString('es-ES') : '',
                  c.lead_nombre || '',
                  c.lead_email || '',
                  c.producto_contratado || '',
                  Number(c.importe_total || 0).toFixed(2),
                  Number(c.importe_pagado || 0).toFixed(2),
                  (Number(c.importe_total || 0) - Number(c.importe_pagado || 0)).toFixed(2),
                  c.estado_pago || '',
                  c.metodo_pago || '',
                ]),
              ];
              const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `ventas_${activeProject?.slug || 'crm'}_${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={!filtered.length}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors text-foreground flex-1 sm:flex-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={14} weight="bold" />
            Exportar
          </button>
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors flex-1 sm:flex-none"
          >
            <Plus size={14} weight="bold" />
            Nueva venta
          </button>
        </div>
      </header>

      <Suspense fallback={null}>
        <RegisterSaleDialog
          open={registerOpen}
          project={activeProject}
          onClose={() => setRegisterOpen(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      </Suspense>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiSmall label="Total facturado"    value={formatMoney(kpis.total)}     hint={`${kpis.count} conversiones`} />
        <KpiSmall label="Cobrado"            value={formatMoney(kpis.pagado)}    tone="paid"    hint={counts.pagado ? `${counts.pagado} pagadas` : '—'} />
        <KpiSmall label="Pendiente de cobro" value={formatMoney(kpis.pendiente)} tone="pending" hint={counts.parcial ? `${counts.parcial} parciales` : '—'} />
        <KpiSmall label="Sin cobrar"         value={String(counts.pendiente)}    tone="over"    hint="conversiones sin pago" />
      </section>

      <Suspense fallback={null}>
        <TopProductsCard projectId={projectId} days={null} limit={10} title="Programas más vendidos (histórico)" />
      </Suspense>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por prospecto, producto o referencia…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium transition-colors ${
                status === s.id
                  ? 'bg-foreground text-background'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
              <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold ${
                status === s.id ? 'bg-background/15' : 'bg-muted'
              }`}>
                {counts[s.id] || 0}
              </span>
            </button>
          ))}
          <button className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground transition-colors" title="Más filtros">
            <Funnel size={14} />
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.5fr_1.2fr_0.9fr_0.9fr_0.7fr_0.6fr] gap-4 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <div>Prospecto</div>
          <div>Producto</div>
          <div className="text-right">Total</div>
          <div className="text-right">Pagado</div>
          <div className="text-center">Estado</div>
          <div className="text-right">Acciones</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mb-4">
              <Receipt size={26} weight="duotone" className="text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1.5">
              {enriched.length === 0 ? 'Sin ventas registradas' : 'Sin resultados para este filtro'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {enriched.length === 0
                ? 'Las ventas aparecen aquí cuando un prospecto convierte. Se generan comisiones automáticamente si hay reglas activas.'
                : 'Limpia el filtro o la búsqueda para ver el resto.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((c) => {
              const status = c._status;
              return (
                <Link
                  key={c.id}
                  to={`/leads/${c.lead_id}`}
                  className="block px-4 md:px-5 py-3 hover:bg-muted/40 transition-colors md:grid md:grid-cols-[1.5fr_1.2fr_0.9fr_0.9fr_0.7fr_0.6fr] md:gap-4 md:items-center text-sm"
                >
                  {/* Mobile: card stack. Desktop: cells en grid. */}
                  <div className="flex items-start justify-between gap-3 md:block min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{c.lead_nombre || '—'}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{c.lead_email || `lead #${c.lead_id}`}</div>
                    </div>
                    <span className={`md:hidden inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[status] || ''}`}>
                      {status}
                    </span>
                  </div>
                  <div className="min-w-0 mt-1 md:mt-0">
                    <div className="truncate text-xs md:text-sm">{c.producto_nombre || '—'}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDate(c.fecha_conversion || c.created_at)}</div>
                  </div>
                  <div className="flex justify-between gap-4 md:block mt-2 md:mt-0 md:text-right text-sm">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground md:hidden">Total</span>
                    <span className="tabular-nums font-medium">{formatMoney(c.importe_total, c.moneda || 'EUR')}</span>
                  </div>
                  <div className="flex justify-between gap-4 md:block md:text-right text-sm">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground md:hidden">Pagado</span>
                    <span className="tabular-nums text-muted-foreground">{formatMoney(c.importe_pagado, c.moneda || 'EUR')}</span>
                  </div>
                  <div className="hidden md:flex md:justify-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[status] || ''}`}>
                      {status}
                    </span>
                  </div>
                  <div className="hidden md:flex md:justify-end items-center gap-1 text-xs text-primary">
                    Ver <ArrowRight size={12} weight="bold" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
