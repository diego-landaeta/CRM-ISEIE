import { useEffect, useState, useCallback, lazy, Suspense, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import ClientsFiltersBar from '../components/ClientsFiltersBar';
import {
  UserCheck, EnvelopeSimple, WhatsappLogo, ShoppingCart, DownloadSimple, Trash, Plus,
} from '@phosphor-icons/react';

const RegisterSaleDialog = lazy(() => import('@/modules/sales/components/RegisterSaleDialog'));
import type { Client } from '@/shared/types';
import { useAuth } from '@/contexts/AuthContext';

function exportCSV(clients: Client[], filename: string): void {
  const fmtNum = (n: number | string) => Number(n || 0).toFixed(2);
  const rows = [
    ['Nombre', 'Email', 'Teléfono', 'Responsable', 'Compras', 'Facturado (€)', 'Cobrado (€)', 'Pendiente (€)', 'Última compra', 'Último contacto'],
    ...clients.map(c => [
      c.nombre || '',
      c.email || '',
      c.telefono || '',
      c.responsable_nombre || '',
      c.conversiones,
      fmtNum(c.total_compras),
      fmtNum(c.total_pagado),
      fmtNum(c.pendiente),
      c.ultima_compra ? new Date(c.ultima_compra).toLocaleDateString('es-ES') : '',
      c.last_interaction_at ? new Date(c.last_interaction_at).toLocaleDateString('es-ES') : '',
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
import { toast } from '@/shared/hooks/useToast';

const ConversionDialog = lazy(() => import('@/modules/conversions/components/ConversionDialog'));
const SoftDeleteDialog = lazy(() => import('@/modules/leads/components/SoftDeleteDialog'));

function fmt(n: number | string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}

function formatRelative(dateStr: string | null | undefined, { future = false }: { future?: boolean } = {}): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = future ? d.getTime() - now.getTime() : now.getTime() - d.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays < 0) return future ? `hace ${-diffDays}d` : null;
  if (diffDays === 0) return 'hoy';
  if (diffDays === 1) return future ? 'mañana' : 'ayer';
  if (diffDays < 7) return future ? `en ${diffDays}d` : `hace ${diffDays}d`;
  if (diffDays < 30) return future ? `en ${Math.round(diffDays / 7)} sem` : `hace ${Math.round(diffDays / 7)} sem`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function cleanPhone(phone: string | null | undefined): string {
  return (phone || '').replace(/[^\d]/g, '');
}

interface QuickActionsProps {
  client: Client;
  onUpsell?: (c: Client) => void;
  onDelete?: (c: Client) => void;
}

function QuickActions({ client: c, onUpsell, onDelete }: QuickActionsProps) {
  const wa = c.telefono ? cleanPhone(c.telefono) : null;
  return (
    <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
      {wa && (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label="Abrir WhatsApp"
          className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-950/40 text-muted-foreground hover:text-green-700 dark:hover:text-green-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
          <WhatsappLogo size={14} weight="regular" />
        </a>
      )}
      {c.email && (
        <a href={`mailto:${c.email}`} title="Email" aria-label="Enviar email"
          className="p-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-950/40 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
          <EnvelopeSimple size={14} weight="regular" />
        </a>
      )}
      {onUpsell && (
        <button onClick={() => onUpsell(c)} title="Nueva venta / upsell" aria-label="Registrar nueva venta o upsell"
          className="p-1.5 rounded hover:bg-violet-100 dark:hover:bg-violet-950/40 text-muted-foreground hover:text-violet-700 dark:hover:text-violet-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
          <ShoppingCart size={14} weight="regular" />
        </button>
      )}
      {onDelete && (
        <button onClick={() => onDelete(c)} title="Eliminar cliente (soft delete)" aria-label="Eliminar cliente"
          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/40">
          <Trash size={14} weight="regular" />
        </button>
      )}
    </div>
  );
}

export default function ClientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const { activeProject } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string };
  };
  // Filtros persistidos en URL para deep-linking + refresh-safe.
  // Server-side: search, resp(id), prod(id), from, to. Client-side: estado_pago + sort.
  const [urlFilters, setUrlFilters] = useUrlFilters({
    q: '', resp: '', prod: '', estado_pago: '', from: '', to: '', sort: 'recent', page: 1,
  });
  const { q: search, resp: filterResp, prod: filterProducto, estado_pago: filterEstadoPago, from: dateFrom, to: dateTo, sort: sortBy, page } = urlFilters as {
    q: string; resp: string; prod: string; estado_pago: string; from: string; to: string; sort: string; page: number;
  };
  const setSearch = useCallback((v: string) => setUrlFilters({ q: v, page: 1 }), [setUrlFilters]);
  const setFilterResp = useCallback((v: string) => setUrlFilters({ resp: v, page: 1 }), [setUrlFilters]);
  const setFilterProducto = useCallback((v: string) => setUrlFilters({ prod: v, page: 1 }), [setUrlFilters]);
  const setFilterEstadoPago = useCallback((v: string) => setUrlFilters({ estado_pago: v, page: 1 }), [setUrlFilters]);
  const setDateFrom = useCallback((v: string) => setUrlFilters({ from: v, page: 1 }), [setUrlFilters]);
  const setDateTo = useCallback((v: string) => setUrlFilters({ to: v, page: 1 }), [setUrlFilters]);
  const setSortBy = useCallback((v: string) => setUrlFilters({ sort: v, page: 1 }), [setUrlFilters]);
  const setPage = useCallback((v: number) => setUrlFilters({ page: v }), [setUrlFilters]);

  const [clients, setClients] = useState<Client[]>([]);
  const [totalBackend, setTotalBackend] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [gestores, setGestores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [productos, setProductos] = useState<Array<{ id: number; nombre: string }>>([]);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [saleOpen, setSaleOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const PAGE_SIZE = 50;

  // Debounce búsqueda 350ms
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  // Cargar gestores (solo admin/superadmin)
  useEffect(() => {
    if (user?.role !== 'superadmin' && user?.role !== 'admin') return;
    client.get('/users?limit=200').then((r) => {
      if (r.success) setGestores(((r.data as Array<{ id: number; nombre: string }>) || []));
    }).catch(() => { /* ignore */ });
  }, [user?.role]);

  // Cargar productos del proyecto activo
  useEffect(() => {
    if (!activeProject?.id) { setProductos([]); return; }
    client.get(`/products?projectId=${activeProject.id}&limit=500`).then((r) => {
      if (r.success) setProductos(((r.data as Array<{ id: number; nombre: string }>) || []));
    }).catch(() => setProductos([]));
  }, [activeProject?.id]);

  // Fetch principal con filtros server-side
  const abortRef = useRef<AbortController | null>(null);
  const fetchClients = useCallback(async () => {
    if (!activeProject?.id) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('projectId', String(activeProject.id));
      params.set('status', 'convertido');
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterResp === 'unassigned') params.set('unassigned', 'true');
      else if (filterResp) params.set('responsableId', filterResp);
      if (filterProducto) params.set('productId', filterProducto);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await client.get(`/leads?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.success) {
        setTotalBackend(Number((res as { pagination?: { total?: number } }).pagination?.total) || 0);
        const enriched = await Promise.all(((res.data as Array<Client>) || []).map(async (l) => {
          try {
            const cr = await client.get(`/conversions/by-lead/${l.id}`);
            const convs = cr.success ? (cr.data as Array<{ importe_total?: number; importe_pagado?: number; fecha_compra?: string; created_at?: string }>) : [];
            const total = convs.reduce((s, c) => s + Number(c.importe_total || 0), 0);
            const pagado = convs.reduce((s, c) => s + Number(c.importe_pagado || 0), 0);
            const lastConv = convs[0]?.fecha_compra || convs[0]?.created_at;
            return { ...l, conversiones: convs.length, total_compras: total, total_pagado: pagado, pendiente: total - pagado, ultima_compra: lastConv } as Client;
          } catch {
            return { ...l, conversiones: 0, total_compras: 0, total_pagado: 0, pendiente: 0 } as Client;
          }
        }));
        // El enriquecimiento es async y no lleva signal: si el proyecto cambió
        // mientras tanto, no pisar la lista del proyecto activo (bug: cargaba
        // clientes de otro proyecto).
        if (controller.signal.aborted) return;
        setClients(enriched);
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'AbortError') return;
      toast({ title: 'Error', description: e?.message || 'No se pudieron cargar los clientes', variant: 'destructive' });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [activeProject?.id, page, debouncedSearch, filterResp, filterProducto, dateFrom, dateTo, reloadKey]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  // Filtro estado_pago se aplica client-side (depende del enrichment de conversiones)
  let filtered: Client[] = clients;
  if (filterEstadoPago) {
    filtered = filtered.filter((c) => {
      const total = Number(c.total_compras) || 0;
      const pagado = Number(c.total_pagado) || 0;
      if (filterEstadoPago === 'pagado') return total > 0 && pagado >= total;
      if (filterEstadoPago === 'parcial') return pagado > 0 && pagado < total;
      if (filterEstadoPago === 'sin_pagar') return total > 0 && pagado === 0;
      if (filterEstadoPago === 'sin_ventas') return total === 0;
      return true;
    });
  }
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'facturado') return (Number(b.total_compras) || 0) - (Number(a.total_compras) || 0);
    if (sortBy === 'cobrado') return (Number(b.total_pagado) || 0) - (Number(a.total_pagado) || 0);
    if (sortBy === 'pendiente') return (Number(b.pendiente) || 0) - (Number(a.pendiente) || 0);
    if (sortBy === 'nombre') return (a.nombre || '').localeCompare(b.nombre || '');
    const ua = a.ultima_compra ? new Date(a.ultima_compra).getTime() : 0;
    const ub = b.ultima_compra ? new Date(b.ultima_compra).getTime() : 0;
    return ub - ua;
  });

  const hasActiveFilters = !!(search.trim() || filterResp || filterProducto || filterEstadoPago || dateFrom || dateTo);
  const clearAllFilters = useCallback(() => {
    (setUrlFilters as unknown as { reset: () => void }).reset();
  }, [setUrlFilters]);
  const totalPages = Math.max(1, Math.ceil(totalBackend / PAGE_SIZE));

  const totalFacturado = filtered.reduce((s, c) => s + Number(c.total_compras), 0);
  const totalCobrado = filtered.reduce((s, c) => s + Number(c.total_pagado), 0);
  const totalPendiente = filtered.reduce((s, c) => s + Number(c.pendiente), 0);

  const [upsellLead, setUpsellLead] = useState<Client | null>(null);
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);

  function handleUpsell(c: Client): void {
    setUpsellLead(c);
  }

  function handleDelete(c: Client): void {
    setDeleteClient(c);
  }

  async function handleUpsellCreated() {
    setUpsellLead(null);
    toast({ title: 'Venta registrada', description: 'Se actualizó el historial del cliente' });
    // Recargar datos del cliente
    if (activeProject?.id) {
      const res = await client.get(`/leads?projectId=${activeProject.id}&status=convertido&limit=100`);
      if (res.success) {
        const enriched = await Promise.all((res.data || []).map(async (l) => {
          try {
            const cr = await client.get(`/conversions/by-lead/${l.id}`);
            const convs = cr.success ? cr.data : [];
            const total = convs.reduce((s, c) => s + Number(c.importe_total || 0), 0);
            const pagado = convs.reduce((s, c) => s + Number(c.importe_pagado || 0), 0);
            const lastConv = convs[0]?.fecha_compra || convs[0]?.created_at;
            return { ...l, conversiones: convs.length, total_compras: total, total_pagado: pagado, pendiente: total - pagado, ultima_compra: lastConv };
          } catch { return { ...l, conversiones: 0, total_compras: 0, total_pagado: 0, pendiente: 0 }; }
        }));
        setClients(enriched);
      }
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <PageHeader
          title="Clientes"
          subtitle={`Prospectos convertidos en ${activeProject?.nombre || 'todos los proyectos'} — ${hasActiveFilters ? `${filtered.length} de ${totalBackend} (filtrados)` : `${totalBackend} clientes`}`}
        />
        {activeProject?.id && (
          <button
            type="button"
            onClick={() => setSaleOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 self-start sm:self-auto"
          >
            <Plus size={14} weight="bold" />
            Registrar venta
          </button>
        )}
      </div>

      <Suspense fallback={null}>
        <RegisterSaleDialog
          open={saleOpen}
          project={activeProject}
          onClose={() => setSaleOpen(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      </Suspense>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Total facturado</p>
          <p className="text-xl font-semibold tabular-nums">{fmt(totalFacturado)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Total cobrado</p>
          <p className="text-xl font-semibold tabular-nums text-green-600">{fmt(totalCobrado)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Pendiente de cobro</p>
          <p className="text-xl font-semibold tabular-nums text-orange-600">{fmt(totalPendiente)}</p>
        </div>
      </div>

      {/* Barra de filtros FUERA del card de la tabla: el card lleva overflow-hidden
          (para recortar las esquinas de la tabla) y eso recortaba el popover de
          "Filtros". Va como fila propia encima del card, igual que en Prospectos. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ClientsFiltersBar
          user={user}
          search={search} setSearch={setSearch}
          filterResp={filterResp} setFilterResp={setFilterResp}
          filterProducto={filterProducto} setFilterProducto={setFilterProducto}
          filterEstadoPago={filterEstadoPago} setFilterEstadoPago={setFilterEstadoPago}
          dateFrom={dateFrom} setDateFrom={setDateFrom}
          dateTo={dateTo} setDateTo={setDateTo}
          sortBy={sortBy} setSortBy={setSortBy}
          gestores={gestores}
          productos={productos}
          totalBackend={totalBackend}
          filteredCount={filtered.length}
        />
        {filtered.length > 0 && (
          <button
            onClick={() => exportCSV(filtered, `clientes-${activeProject?.nombre || 'crm'}-${new Date().toISOString().slice(0,10)}.csv`)}
            title="Exportar CSV"
            aria-label="Exportar clientes a CSV"
            className="h-9 px-3 rounded-md border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium flex-shrink-0"
          >
            <DownloadSimple size={14} weight="bold" /> <span className="hidden sm:inline">CSV</span>
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <SkeletonTable rows={5} columns={6} className="border-0 rounded-none" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="Sin clientes"
            description="Los prospectos marcados como 'convertido' aparecerán aquí con su historial de compras"
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                    <th className="text-left px-4 py-2.5 font-bold">Email</th>
                    <th className="text-left px-4 py-2.5 font-bold">Teléfono</th>
                    <th className="text-center px-4 py-2.5 font-bold">Compras</th>
                    <th className="text-right px-4 py-2.5 font-bold">Facturado</th>
                    <th className="text-right px-4 py-2.5 font-bold">Pendiente</th>
                    <th className="text-left px-4 py-2.5 font-bold">Última compra</th>
                    <th className="text-left px-4 py-2.5 font-bold">Último contacto</th>
                    <th className="text-right px-4 py-2.5 font-bold pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/clients/${c.id}`)}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{c.nombre}</div>
                        <div className="text-xs text-muted-foreground">{c.responsable_nombre || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{c.telefono || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-semibold">{c.conversiones}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(c.total_compras)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${Number(c.pendiente) > 0 ? 'text-orange-600' : 'text-muted-foreground'}`}>
                        {fmt(c.pendiente)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.ultima_compra ? formatRelative(c.ultima_compra) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.last_interaction_at ? formatRelative(c.last_interaction_at) : <span className="text-muted-foreground/60">Sin contacto</span>}
                      </td>
                      <td className="px-4 py-3 text-right pr-3">
                        <QuickActions client={c} onUpsell={handleUpsell} onDelete={isSuperadmin ? handleDelete : undefined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {filtered.map((c) => (
                <div
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  className="p-4 space-y-2 cursor-pointer active:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{c.nombre}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-semibold flex-shrink-0">
                      {c.conversiones} {c.conversiones === 1 ? 'compra' : 'compras'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Facturado</div>
                      <div className="tabular-nums font-semibold">{fmt(c.total_compras)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Pendiente</div>
                      <div className={`tabular-nums font-semibold ${Number(c.pendiente) > 0 ? 'text-orange-600' : 'text-muted-foreground'}`}>{fmt(c.pendiente)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border/60">
                    <div className="flex flex-col gap-0.5 text-[11px]">
                      {c.ultima_compra && <span className="text-muted-foreground">Compra: <span className="text-foreground">{formatRelative(c.ultima_compra)}</span></span>}
                      {c.last_interaction_at && <span className="text-muted-foreground">Contacto: <span className="text-foreground">{formatRelative(c.last_interaction_at)}</span></span>}
                    </div>
                    <QuickActions client={c} onUpsell={handleUpsell} onDelete={isSuperadmin ? handleDelete : undefined} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Paginación server-side */}
        {totalBackend > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border text-xs">
            <span className="text-muted-foreground">
              Página <strong className="text-foreground">{page}</strong> de <strong className="text-foreground">{totalPages}</strong> · {totalBackend} clientes en total
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1 || loading}
                className="h-8 px-3 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages || loading}
                className="h-8 px-3 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nueva venta / upsell — dialog inline */}
      <Suspense fallback={null}>
        <ConversionDialog
          open={!!upsellLead}
          onClose={() => setUpsellLead(null)}
          lead={upsellLead}
          projectId={activeProject?.id}
          onCreated={handleUpsellCreated}
        />
      </Suspense>

      {/* Soft delete (solo superadmin) — reusa el mismo dialog que ficha de lead */}
      <Suspense fallback={null}>
        <SoftDeleteDialog
          open={!!deleteClient}
          lead={deleteClient}
          onClose={() => setDeleteClient(null)}
          onDeleted={() => {
            setClients((prev) => prev.filter((x) => x.id !== deleteClient?.id));
            setDeleteClient(null);
            toast({ title: 'Cliente eliminado' });
          }}
        />
      </Suspense>
    </div>
  );
}
