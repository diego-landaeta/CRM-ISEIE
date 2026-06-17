import { useEffect, useState, useCallback } from 'react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import { toast } from '@/shared/hooks/useToast';
import {
  CreditCard, ArrowsClockwise, CheckCircle, XCircle, WarningCircle, ArrowSquareOut,
  Link as LinkIcon, MagnifyingGlass, ArrowCounterClockwise,
} from '@phosphor-icons/react';

type Payment = {
  id: number;
  stripe_id: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  customer_email: string | null;
  customer_name: string | null;
  description: string | null;
  payment_method: string | null;
  disputed: boolean;
  refunded: boolean;
  refunded_amount: number | null;
  conversion_id: number | null;
  lead_id: number | null;
  lead_nombre: string | null;
  link_method: string | null;
  stripe_created_at: string;
};

type Stats = {
  total: number; succeeded: number; failed: number; disputed: number; refunded: number; unlinked: number;
  total_cobrado: number; total_refunded: number;
  sync: { last_sync_at: string | null; total_imported: number; last_error: string | null } | null;
};

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export default function StripePaymentsPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const pid = activeProject?.id;

  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filters, setFilters] = useState({ status: '', linked: '', search: '' });
  const [linkDialog, setLinkDialog] = useState<Payment | null>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ projectId: String(pid), limit: '100' });
      if (filters.status) qs.set('status', filters.status);
      if (filters.linked) qs.set('linked', filters.linked);
      if (filters.search) qs.set('search', filters.search);
      const [r1, r2] = await Promise.all([
        client.get<Payment[]>(`/stripe-payments?${qs}`),
        client.get<Stats>(`/stripe-payments/stats?projectId=${pid}`),
      ]);
      if (r1.success) setPayments(r1.data || []);
      if (r2.success) setStats(r2.data || null);
    } finally { setLoading(false); }
  }, [pid, filters]);

  useEffect(() => { load(); }, [load]);

  async function syncNow(fullHistory = false) {
    if (!pid) return;
    setSyncing(true);
    try {
      const res = await client.post<{ imported: number; pages: number }>(`/stripe-payments/sync`, { projectId: pid, fullHistory });
      if (res.success) {
        toast({ title: '✓ Sincronizado', description: `${res.data?.imported} pagos importados (${res.data?.pages} páginas)` });
        await load();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error || 'Sync falló', variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message || 'Error de red', variant: 'destructive' });
    } finally { setSyncing(false); }
  }

  if (!pid) {
    return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Pagos Stripe"
        subtitle={`Histórico de pagos sincronizados desde Stripe — ${activeProject?.nombre || ''}`}
        actions={(
          <div className="flex gap-2">
            <button onClick={() => syncNow(false)} disabled={syncing}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <ArrowsClockwise size={14} weight="bold" className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            <button onClick={() => syncNow(true)} disabled={syncing}
              title="Trae TODO el histórico desde Stripe (puede tardar varios minutos)"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              <ArrowCounterClockwise size={14} weight="bold" /> Importar histórico completo
            </button>
          </div>
        )}
      />

      {/* KPIs */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={CheckCircle} iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
            label="Cobrado" numericValue={Number(stats.total_cobrado)} format={(n) => fmt(Number(n))} />
          <KpiCard icon={XCircle} iconBg="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
            label="Fallidos" numericValue={stats.failed} />
          <KpiCard icon={WarningCircle} iconBg="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
            label="Disputas activas" numericValue={stats.disputed} />
          <KpiCard icon={LinkIcon} iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
            label="Sin asociar" numericValue={stats.unlinked} badge={stats.unlinked > 0 ? 'Revisar' : 'OK'}
            badgeColor={stats.unlinked > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'} />
        </div>
      )}

      {stats?.sync && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2 flex items-center justify-between flex-wrap gap-2">
          <span>Última sync: <strong>{fmtDate(stats.sync.last_sync_at)}</strong> · Total importados: <strong>{stats.sync.total_imported}</strong></span>
          {stats.sync.last_error && <span className="text-red-600">Error último intento: {stats.sync.last_error}</span>}
        </div>
      )}

      {/* Filtros */}
      <div className="bg-card border border-border rounded-md p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Email, nombre o stripe id…"
            className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-sm" />
        </div>
        <select value={filters.status} onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm">
          <option value="">Todos los estados</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select value={filters.linked} onChange={(e) => setFilters(f => ({ ...f, linked: e.target.value }))}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm">
          <option value="">Todos</option>
          <option value="yes">Asociados</option>
          <option value="no">Sin asociar</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cargando…</div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CreditCard size={32} className="text-muted-foreground mx-auto" weight="duotone" />
            <p className="font-semibold text-sm">Sin pagos sincronizados</p>
            <p className="text-xs text-muted-foreground">
              Pulsá <strong>Sincronizar</strong> para traer los últimos 30 días o <strong>Importar histórico completo</strong> para todo.
              Requiere tener la API key de Stripe guardada en <a href="/finanzas/integraciones" className="text-primary hover:underline">Integraciones</a>.
            </p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 border-y">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Fecha</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Cliente</th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground">Importe</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Estado</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Asociado a</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.stripe_created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.customer_name || '—'}</div>
                    <div className="text-xs text-muted-foreground">{p.customer_email || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {fmt(p.amount)}
                    {p.refunded && <div className="text-[10px] text-red-600">Reembolsado {p.refunded_amount ? fmt(p.refunded_amount) : ''}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={p.status} disputed={p.disputed} refunded={p.refunded} />
                  </td>
                  <td className="px-3 py-2">
                    {p.conversion_id ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                        <LinkIcon size={11} weight="bold" /> {p.lead_nombre || `Conv #${p.conversion_id}`}
                        <span className="text-muted-foreground">({p.link_method === 'auto_email_match' ? 'auto' : 'manual'})</span>
                      </span>
                    ) : (
                      <button onClick={() => setLinkDialog(p)}
                        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                        <LinkIcon size={11} weight="bold" /> Asociar
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <a href={`https://dashboard.stripe.com/payments/${p.stripe_id}`} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                      {p.stripe_id.slice(0, 12)}… <ArrowSquareOut size={10} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {linkDialog && (
        <LinkDialog payment={linkDialog} projectId={pid} onClose={() => setLinkDialog(null)} onLinked={() => { setLinkDialog(null); load(); }} />
      )}
    </div>
  );
}

function StatusBadge({ status, disputed, refunded }: { status: string; disputed: boolean; refunded: boolean }) {
  if (disputed) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">DISPUTA</span>;
  if (refunded) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">REEMBOLSO</span>;
  const map: Record<string, string> = {
    succeeded: 'bg-emerald-100 text-emerald-800',
    failed: 'bg-red-100 text-red-800',
    pending: 'bg-blue-100 text-blue-800',
  };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${map[status] || 'bg-muted text-muted-foreground'}`}>{status.toUpperCase()}</span>;
}

function LinkDialog({ payment, projectId, onClose, onLinked }: { payment: Payment; projectId: number; onClose: () => void; onLinked: () => void }) {
  const [search, setSearch] = useState(payment.customer_email || '');
  const [results, setResults] = useState<Array<{ id: number; nombre: string; email: string; status: string }>>([]);
  const [linking, setLinking] = useState<number | null>(null);

  useEffect(() => {
    if (!search) { setResults([]); return; }
    const timer = setTimeout(async () => {
      const res = await client.get<Array<{ id: number; nombre: string; email: string; status: string }>>(
        `/leads?projectId=${projectId}&search=${encodeURIComponent(search)}&limit=10&page=1`
      );
      if (res.success) setResults(res.data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, projectId]);

  async function link(leadId: number) {
    setLinking(leadId);
    try {
      const lead = results.find(l => l.id === leadId);
      const conv = await client.get<Array<{ id: number }>>(`/conversions?projectId=${projectId}&leadId=${leadId}&limit=1`);
      const conversionId = conv.success && conv.data?.[0]?.id;
      const res = await client.post(`/stripe-payments/${payment.id}/link`, { projectId, leadId, conversionId: conversionId || undefined });
      if (res.success) {
        toast({ title: '✓ Asociado', description: `Pago ${fmt(payment.amount)} asociado a ${lead?.nombre}` });
        onLinked();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setLinking(null); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Asociar pago a prospecto</h3>
          <p className="text-xs text-muted-foreground">
            {fmt(payment.amount)} de {payment.customer_email || 'cliente sin email'} — Stripe {payment.stripe_id.slice(0, 14)}…
          </p>
        </div>
        <div className="p-4 space-y-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar prospecto por nombre o email…"
            className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm" autoFocus />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {results.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">{search ? 'Sin coincidencias' : 'Empezá a escribir…'}</p>
            ) : results.map(l => (
              <button key={l.id} onClick={() => link(l.id)} disabled={linking === l.id}
                className="w-full text-left p-2 rounded-md hover:bg-muted/50 disabled:opacity-50 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{l.nombre}</div>
                  <div className="text-xs text-muted-foreground">{l.email} · {l.status}</div>
                </div>
                <span className="text-[11px] text-primary">{linking === l.id ? 'Asociando…' : 'Asociar'}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="p-3 border-t border-border flex justify-end">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
