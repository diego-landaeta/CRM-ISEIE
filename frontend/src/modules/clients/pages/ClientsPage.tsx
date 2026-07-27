import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DownloadSimple,
  EnvelopeSimple,
  Trash,
  UserCheck,
  WhatsappLogo,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { toast } from '@/shared/hooks/useToast';
import type { Client } from '@/shared/types';
import ClientsFiltersBar from '../components/ClientsFiltersBar';

const SoftDeleteDialog = lazy(() => import('@/modules/leads/components/SoftDeleteDialog'));

function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

function cleanPhone(phone: string | null | undefined): string {
  return (phone || '').replace(/[^\d]/g, '');
}

function exportCSV(clients: Client[], filename: string): void {
  const rows = [
    [
      'Nombre',
      'Email',
      'Teléfono',
      'Gestora',
      'Programa',
      'Cuotas totales',
      'Cuotas pagadas',
      'Cuotas pendientes',
      'Pagos registrados',
      'Próximo vencimiento',
      'Último contacto',
    ],
    ...clients.map((item) => [
      item.nombre || '',
      item.email || '',
      item.telefono || '',
      item.responsable_nombre || '',
      (item.programas || []).join(' · '),
      Number(item.total_cuotas) || 0,
      Number(item.cuotas_pagadas) || 0,
      Number(item.cuotas_pendientes) || 0,
      Number(item.total_pagos) || 0,
      item.proximo_vencimiento ? item.proximo_vencimiento.slice(0, 10) : '',
      item.last_interaction_at ? item.last_interaction_at.slice(0, 10) : '',
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface QuickActionsProps {
  client: Client;
  onDelete?: (client: Client) => void;
}

function QuickActions({ client: item, onDelete }: QuickActionsProps) {
  const whatsapp = item.telefono ? cleanPhone(item.telefono) : null;
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
      {whatsapp && (
        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          title="WhatsApp"
          aria-label="Abrir WhatsApp"
          className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-950/40 text-muted-foreground hover:text-green-700 dark:hover:text-green-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <WhatsappLogo size={14} />
        </a>
      )}
      {item.email && (
        <a
          href={`mailto:${item.email}`}
          title="Email"
          aria-label="Enviar email"
          className="p-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-950/40 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <EnvelopeSimple size={14} />
        </a>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(item)}
          title="Eliminar cliente"
          aria-label="Eliminar cliente"
          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/40"
        >
          <Trash size={14} />
        </button>
      )}
    </div>
  );
}

function ProgramsCell({ programs }: { programs?: string[] }) {
  if (!programs?.length) {
    return <span className="text-xs text-muted-foreground/60">Sin programa</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 max-w-[260px]">
      <span className="text-xs font-medium truncate" title={programs.join(' · ')}>
        {programs[0]}
      </span>
      {programs.length > 1 && (
        <span className="text-[10px] text-muted-foreground">+{programs.length - 1} programas</span>
      )}
    </div>
  );
}

function InstallmentsCell({ client: item }: { client: Client }) {
  const total = Number(item.total_cuotas) || 0;
  const paid = Number(item.cuotas_pagadas) || 0;
  const pending = Number(item.cuotas_pendientes) || 0;

  if (total === 0) {
    return <span className="text-xs text-muted-foreground/60">Sin plan</span>;
  }

  return (
    <div className="min-w-[145px]">
      <span className="inline-flex px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-semibold">
        {total} {total === 1 ? 'cuota' : 'cuotas'}
      </span>
      <div className="mt-1 text-[10px] text-muted-foreground whitespace-nowrap">
        <span className="text-green-700 dark:text-green-400">{paid} pagadas</span>
        <span> · </span>
        <span className={pending > 0 ? 'text-orange-700 dark:text-orange-400' : ''}>
          {pending} pendientes
        </span>
      </div>
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

  const [urlFilters, setUrlFilters] = useUrlFilters({
    q: '',
    resp: '',
    prod: '',
    cuotas: '',
    sort: 'nombre',
    page: 1,
  });
  const {
    q: search,
    resp: filterResp,
    prod: filterProducto,
    cuotas: filterInstallments,
    sort: sortBy,
    page,
  } = urlFilters as {
    q: string;
    resp: string;
    prod: string;
    cuotas: string;
    sort: string;
    page: number;
  };

  const setSearch = useCallback(
    (value: string) => setUrlFilters({ q: value, page: 1 }),
    [setUrlFilters],
  );
  const setFilterResp = useCallback(
    (value: string) => setUrlFilters({ resp: value, page: 1 }),
    [setUrlFilters],
  );
  const setFilterProducto = useCallback(
    (value: string) => setUrlFilters({ prod: value, page: 1 }),
    [setUrlFilters],
  );
  const setFilterInstallments = useCallback(
    (value: string) => setUrlFilters({ cuotas: value, page: 1 }),
    [setUrlFilters],
  );
  const setSortBy = useCallback(
    (value: string) => setUrlFilters({ sort: value, page: 1 }),
    [setUrlFilters],
  );
  const setPage = useCallback(
    (value: number) => setUrlFilters({ page: value }),
    [setUrlFilters],
  );

  const [clients, setClients] = useState<Client[]>([]);
  const [totalBackend, setTotalBackend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [gestores, setGestores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [productos, setProductos] = useState<Array<{ id: number; nombre: string }>>([]);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const PAGE_SIZE = 500;

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  useEffect(() => {
    if (user?.role !== 'superadmin' && user?.role !== 'admin') return;
    if (!activeProject?.id) {
      setGestores([]);
      return;
    }
    client
      .get(`/users?active=true&role=gestor&projectId=${activeProject.id}&limit=100`)
      .then((response) => {
        if (response.success) {
          setGestores((response.data as Array<{ id: number; nombre: string }>) || []);
        }
      })
      .catch(() => setGestores([]));
  }, [user?.role, activeProject?.id]);

  useEffect(() => {
    if (!activeProject?.id) {
      setProductos([]);
      return;
    }
    client
      .get(`/products?projectId=${activeProject.id}&limit=500`)
      .then((response) => {
        if (response.success) {
          setProductos((response.data as Array<{ id: number; nombre: string }>) || []);
        }
      })
      .catch(() => setProductos([]));
  }, [activeProject?.id]);

  const abortRef = useRef<AbortController | null>(null);
  const fetchClients = useCallback(async () => {
    if (!activeProject?.id) {
      setClients([]);
      setTotalBackend(0);
      setLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const params = new URLSearchParams({
        projectId: String(activeProject.id),
        conConversion: 'true',
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterResp === 'unassigned') params.set('unassigned', 'true');
      else if (filterResp) params.set('responsableId', filterResp);
      if (filterProducto) params.set('productId', filterProducto);
      if (filterInstallments) params.set('installmentStatus', filterInstallments);

      const response = await client.get(`/leads?${params.toString()}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.success) {
        setClients((response.data as Client[]) || []);
        setTotalBackend(
          Number((response as { pagination?: { total?: number } }).pagination?.total) || 0,
        );
      }
    } catch (error: unknown) {
      const requestError = error as { name?: string; message?: string };
      if (requestError?.name === 'AbortError') return;
      toast({
        title: 'Error',
        description: requestError?.message || 'No se pudieron cargar los clientes',
        variant: 'destructive',
      });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [
    activeProject?.id,
    page,
    debouncedSearch,
    filterResp,
    filterProducto,
    filterInstallments,
  ]);

  useEffect(() => {
    fetchClients();
    return () => abortRef.current?.abort();
  }, [fetchClients]);

  const sortedClients = [...clients].sort((a, b) => {
    if (sortBy === 'pagos') {
      return (Number(b.total_pagos) || 0) - (Number(a.total_pagos) || 0);
    }
    if (sortBy === 'cuotas_pendientes') {
      return (Number(b.cuotas_pendientes) || 0) - (Number(a.cuotas_pendientes) || 0);
    }
    if (sortBy === 'proximo_vencimiento') {
      const aDue = a.proximo_vencimiento
        ? new Date(a.proximo_vencimiento).getTime()
        : Number.POSITIVE_INFINITY;
      const bDue = b.proximo_vencimiento
        ? new Date(b.proximo_vencimiento).getTime()
        : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    }
    return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
  });

  const hasActiveFilters = Boolean(
    search.trim() || filterResp || filterProducto || filterInstallments,
  );
  const totalPages = Math.max(1, Math.ceil(totalBackend / PAGE_SIZE));

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Clientes"
        subtitle={`Lista de clientes en ${activeProject?.nombre || 'el proyecto'} — ${
          hasActiveFilters ? `${totalBackend} encontrados` : `${totalBackend} clientes`
        }`}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ClientsFiltersBar
          user={user}
          search={search}
          setSearch={setSearch}
          filterResp={filterResp}
          setFilterResp={setFilterResp}
          filterProducto={filterProducto}
          setFilterProducto={setFilterProducto}
          filterInstallments={filterInstallments}
          setFilterInstallments={setFilterInstallments}
          sortBy={sortBy}
          setSortBy={setSortBy}
          gestores={gestores}
          productos={productos}
          totalBackend={totalBackend}
        />
        {sortedClients.length > 0 && (
          <button
            type="button"
            onClick={() => exportCSV(
              sortedClients,
              `clientes-${activeProject?.nombre || 'crm'}-${new Date().toISOString().slice(0, 10)}.csv`,
            )}
            title="Exportar CSV"
            aria-label="Exportar clientes a CSV"
            className="h-9 px-3 rounded-md border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium flex-shrink-0"
          >
            <DownloadSimple size={14} weight="bold" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <SkeletonTable rows={8} columns={8} className="border-0 rounded-none" />
        ) : sortedClients.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title="Sin clientes"
            description="No hay clientes que coincidan con los filtros seleccionados"
          />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                    <th className="text-left px-4 py-2.5 font-bold">Email</th>
                    <th className="text-left px-4 py-2.5 font-bold">Teléfono</th>
                    <th className="text-left px-4 py-2.5 font-bold">Programa</th>
                    <th className="text-left px-4 py-2.5 font-bold">Gestora</th>
                    <th className="text-left px-4 py-2.5 font-bold">Cuotas</th>
                    <th className="text-center px-4 py-2.5 font-bold">Pagos</th>
                    <th className="text-left px-4 py-2.5 font-bold">Próximo vencimiento</th>
                    <th className="text-left px-4 py-2.5 font-bold">Último contacto</th>
                    <th className="text-right px-4 py-2.5 font-bold pr-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClients.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                      onClick={() => navigate(`/clients/${item.id}`)}
                    >
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">{item.nombre}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.email || '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
                        {item.telefono || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ProgramsCell programs={item.programas} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {item.responsable_nombre || 'Sin gestora'}
                      </td>
                      <td className="px-4 py-3">
                        <InstallmentsCell client={item} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex min-w-8 justify-center px-2 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 text-xs font-semibold tabular-nums">
                          {Number(item.total_pagos) || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(item.proximo_vencimiento)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {item.last_interaction_at
                          ? formatDate(item.last_interaction_at)
                          : 'Sin contacto'}
                      </td>
                      <td className="px-4 py-3 text-right pr-3">
                        <QuickActions
                          client={item}
                          onDelete={isSuperadmin ? setDeleteClient : undefined}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-border">
              {sortedClients.map((item) => {
                const totalInstallments = Number(item.total_cuotas) || 0;
                const paidInstallments = Number(item.cuotas_pagadas) || 0;
                const pendingInstallments = Number(item.cuotas_pendientes) || 0;
                return (
                  <div
                    key={item.id}
                    onClick={() => navigate(`/clients/${item.id}`)}
                    className="p-4 space-y-3 cursor-pointer active:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{item.nombre}</div>
                        <div className="text-xs text-muted-foreground truncate">{item.email}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {item.responsable_nombre || 'Sin gestora'}
                        </div>
                      </div>
                      <QuickActions
                        client={item}
                        onDelete={isSuperadmin ? setDeleteClient : undefined}
                      />
                    </div>

                    <div className="text-xs">
                      <span className="text-muted-foreground">Programa: </span>
                      {item.programas?.length
                        ? `${item.programas[0]}${item.programas.length > 1 ? ` +${item.programas.length - 1}` : ''}`
                        : 'Sin programa'}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/50 p-2.5">
                        <div className="text-muted-foreground">Cuotas</div>
                        <div className="font-semibold mt-0.5">
                          {totalInstallments > 0 ? `${totalInstallments} en total` : 'Sin plan'}
                        </div>
                        {totalInstallments > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {paidInstallments} pagadas · {pendingInstallments} pendientes
                          </div>
                        )}
                      </div>
                      <div className="rounded-md bg-muted/50 p-2.5">
                        <div className="text-muted-foreground">Pagos registrados</div>
                        <div className="font-semibold mt-0.5 tabular-nums">
                          {Number(item.total_pagos) || 0}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                      <span>Próxima cuota: {formatDate(item.proximo_vencimiento)}</span>
                      <span>
                        Contacto: {item.last_interaction_at
                          ? formatDate(item.last_interaction_at)
                          : 'Sin contacto'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {totalBackend > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border text-xs">
            <span className="text-muted-foreground">
              Página <strong className="text-foreground">{page}</strong> de{' '}
              <strong className="text-foreground">{totalPages}</strong> · {totalBackend} clientes
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1 || loading}
                className="h-8 px-3 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
              >
                ← Anterior
              </button>
              <button
                type="button"
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

      <Suspense fallback={null}>
        <SoftDeleteDialog
          open={!!deleteClient}
          lead={deleteClient}
          onClose={() => setDeleteClient(null)}
          onDeleted={() => {
            setClients((current) => current.filter((item) => item.id !== deleteClient?.id));
            setTotalBackend((current) => Math.max(0, current - 1));
            setDeleteClient(null);
            toast({ title: 'Cliente eliminado' });
          }}
        />
      </Suspense>
    </div>
  );
}
