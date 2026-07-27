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
  dispute_id: string | null;
  dispute_status: string | null;
  dispute_reason: string | null;
  dispute_amount: number | null;
  dispute_evidence_due_by: string | null;
  dispute_my_decision: string | null;
  dispute_notes: string | null;
  refunded: boolean;
  refunded_amount: number | null;
  conversion_id: number | null;
  lead_id: number | null;
  lead_nombre: string | null;
  link_method: string | null;
  /** A qué pertenece el cobro: curso de la conversión y factura emitida por él. */
  producto_contratado?: string | null;
  factura_codigo?: string | null;
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
  const [filters, setFilters] = useState({ status: '', linked: '', search: '', from: '', to: '' });
  const [linkDialog, setLinkDialog] = useState<Payment | null>(null);
  const [disputeDialog, setDisputeDialog] = useState<Payment | null>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ projectId: String(pid), limit: '100' });
      if (filters.status) qs.set('status', filters.status);
      if (filters.linked) qs.set('linked', filters.linked);
      if (filters.search) qs.set('search', filters.search);
      if (filters.from) qs.set('from', new Date(filters.from).toISOString());
      if (filters.to) qs.set('to', new Date(filters.to + 'T23:59:59').toISOString());
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
        <div className="flex items-center gap-1 text-xs">
          <label className="text-muted-foreground">Desde</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters(f => ({ ...f, from: e.target.value }))}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          <label className="text-muted-foreground ml-1">Hasta</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters(f => ({ ...f, to: e.target.value }))}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          {(filters.from || filters.to) && (
            <button onClick={() => setFilters(f => ({ ...f, from: '', to: '' }))}
              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground">×</button>
          )}
        </div>
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
              Requiere tener la API key de Stripe guardada en <a href={`${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/finanzas/integraciones`} className="text-primary hover:underline">Integraciones</a>.
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
                <tr key={p.id}
                  className={`border-b last:border-0 hover:bg-muted/30 ${
                    !p.conversion_id && p.status === 'succeeded'
                      ? 'bg-red-50/70 dark:bg-red-950/20 border-l-2 border-l-red-500'
                      : ''}`}>
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
                    {p.disputed ? (
                      <button onClick={() => setDisputeDialog(p)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200"
                        title="Ver detalle de disputa">
                        DISPUTA ↗
                      </button>
                    ) : (
                      <StatusBadge status={p.status} disputed={false} refunded={p.refunded} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.conversion_id ? (
                      <div className="text-[11px] leading-tight">
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <LinkIcon size={11} weight="bold" /> {p.lead_nombre || `Conv #${p.conversion_id}`}
                          <span className="text-muted-foreground">({p.link_method?.startsWith('auto') ? 'auto' : 'manual'})</span>
                        </span>
                        {/* A qué pertenece: concepto/curso y su factura si ya se emitió */}
                        {(p.producto_contratado || p.description) && (
                          <div className="text-muted-foreground truncate max-w-[220px]" title={p.producto_contratado || p.description || ''}>
                            {p.producto_contratado || p.description}
                          </div>
                        )}
                        {p.factura_codigo && (
                          <div className="text-[10px] text-primary font-semibold">Factura {p.factura_codigo}</div>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => setLinkDialog(p)}
                        title="Este cobro no está asociado a ningún cliente: asócialo para que genere su factura"
                        className="text-[11px] font-bold text-red-700 dark:text-red-400 hover:underline inline-flex items-center gap-1 text-left">
                        <LinkIcon size={11} weight="bold" />
                        NO ASOCIADO A UN CLIENTE · ASOCIAR
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
      {disputeDialog && (
        <DisputeDialog payment={disputeDialog} onClose={() => setDisputeDialog(null)} onUpdated={() => { setDisputeDialog(null); load(); }} />
      )}
    </div>
  );
}

const DISPUTE_REASON_LABELS: Record<string, string> = {
  fraudulent: 'Fraude (cliente dice no autorizar)',
  duplicate: 'Cargo duplicado',
  product_not_received: 'Producto no recibido',
  product_unacceptable: 'Producto no aceptable',
  subscription_canceled: 'Suscripción cancelada',
  unrecognized: 'No reconoce el cargo',
  credit_not_processed: 'Reembolso no procesado',
  general: 'General',
  incorrect_account_details: 'Datos de cuenta incorrectos',
  insufficient_funds: 'Fondos insuficientes',
  bank_cannot_process: 'Banco no puede procesar',
  debit_not_authorized: 'Débito no autorizado',
  customer_initiated: 'Iniciada por cliente',
};

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  warning_needs_response: 'Aviso — necesita respuesta',
  warning_under_review: 'Aviso — en revisión',
  warning_closed: 'Aviso — cerrado',
  needs_response: 'Necesita respuesta',
  under_review: 'En revisión Stripe',
  charge_refunded: 'Reembolsado (caso cerrado)',
  won: 'Ganada',
  lost: 'Perdida',
};

const MY_DECISION_OPTIONS = [
  { value: 'pending', label: 'Pendiente de revisión', color: 'bg-amber-100 text-amber-800' },
  { value: 'contest', label: 'Vamos a impugnarla (es inválida)', color: 'bg-blue-100 text-blue-800' },
  { value: 'accept_refund', label: 'Aceptamos / reembolsamos', color: 'bg-purple-100 text-purple-800' },
  { value: 'won', label: 'Ganada', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'lost', label: 'Perdida', color: 'bg-red-100 text-red-800' },
  { value: 'closed', label: 'Cerrada', color: 'bg-zinc-200 text-zinc-700' },
];

function DisputeDialog({ payment, onClose, onUpdated }: { payment: Payment; onClose: () => void; onUpdated: () => void }) {
  const [decision, setDecision] = useState(payment.dispute_my_decision || 'pending');
  const [notes, setNotes] = useState(payment.dispute_notes || '');
  const [saving, setSaving] = useState(false);

  const dueBy = payment.dispute_evidence_due_by ? new Date(payment.dispute_evidence_due_by) : null;
  const hoursLeft = dueBy ? Math.max(0, Math.floor((dueBy.getTime() - Date.now()) / 3600000)) : null;
  const daysLeft = hoursLeft != null ? Math.floor(hoursLeft / 24) : null;
  const overdue = dueBy && dueBy.getTime() < Date.now();

  async function save() {
    setSaving(true);
    try {
      const res = await client.patch(`/stripe-payments/${payment.id}/dispute`, { decision, notes });
      if (res.success) {
        toast({ title: '✓ Decisión guardada' });
        onUpdated();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
            <WarningCircle size={22} weight="duotone" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base">Disputa — {fmt(payment.dispute_amount || payment.amount)}</h3>
            <p className="text-xs text-muted-foreground">
              {payment.customer_name || payment.customer_email} · Cobro original {fmt(payment.amount)} · {fmtDate(payment.stripe_created_at)}
            </p>
          </div>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {/* Banner deadline */}
          {dueBy && (
            <div className={`p-3 rounded-lg border ${overdue ? 'bg-red-50 border-red-300 text-red-900' : daysLeft! <= 2 ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'}`}>
              <p className="font-semibold text-xs">⏰ Fecha límite para responder a Stripe:</p>
              <p className="text-lg font-bold tabular-nums">{fmtDate(payment.dispute_evidence_due_by)}</p>
              <p className="text-xs">{overdue ? 'VENCIDO — Stripe ya decidió o pronto lo hará' : `Quedan ${daysLeft} días (${hoursLeft}h)`}</p>
            </div>
          )}

          {/* Info Stripe */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Razón Stripe</p>
              <p className="font-semibold">{DISPUTE_REASON_LABELS[payment.dispute_reason || ''] || payment.dispute_reason || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Estado en Stripe</p>
              <p className="font-semibold">{DISPUTE_STATUS_LABELS[payment.dispute_status || ''] || payment.dispute_status || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Email cliente</p>
              <p className="font-mono text-[11px]">{payment.customer_email || '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Asociado a lead</p>
              <p>{payment.lead_nombre || <span className="text-amber-600">Sin asociar</span>}</p>
            </div>
          </div>

          {/* Tu decisión */}
          <div className="border-t border-border pt-3">
            <label className="text-xs font-semibold uppercase text-muted-foreground">Tu decisión interna</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {MY_DECISION_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => setDecision(opt.value)}
                  className={`text-left p-2 rounded-md border text-xs ${decision === opt.value ? 'border-primary ring-2 ring-primary/20 ' + opt.color : 'border-border bg-card hover:bg-muted/30'}`}>
                  <div className="font-semibold">{opt.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Notas internas</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Por qué decidiste eso, evidencia que vas a usar, etc."
              className="w-full mt-1 px-3 py-2 rounded-md border border-border bg-background text-sm" />
          </div>
        </div>

        <div className="p-3 border-t border-border flex flex-wrap justify-between gap-2 bg-muted/20">
          {payment.dispute_id && (
            <a href={`https://dashboard.stripe.com/disputes/${payment.dispute_id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
              <ArrowSquareOut size={14} weight="bold" /> Responder en Stripe Dashboard
            </a>
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted">Cerrar</button>
            <button onClick={save} disabled={saving}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar decisión'}
            </button>
          </div>
        </div>
      </div>
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

interface LinkLead { id: number; nombre: string; email: string; status: string }
interface LinkVenta {
  id: number; producto_contratado: string | null; importe_total: number | string | null;
  importe_pagado: number | string | null; fecha_conversion: string | null;
}

// Asociar un cobro de Stripe a un cliente/prospecto y, sobre todo, A QUÉ VENTA.
// Paso 1: buscar (incluye clientes convertidos, no solo prospectos).
// Paso 2: elegir la venta concreta — antes cogía siempre la más reciente a ciegas.
function LinkDialog({ payment, projectId, onClose, onLinked }: { payment: Payment; projectId: number; onClose: () => void; onLinked: () => void }) {
  const [search, setSearch] = useState(payment.customer_email || '');
  const [results, setResults] = useState<LinkLead[]>([]);
  const [sel, setSel] = useState<LinkLead | null>(null);
  const [ventas, setVentas] = useState<LinkVenta[]>([]);
  const [loadingVentas, setLoadingVentas] = useState(false);
  const [linking, setLinking] = useState<number | null>(null);

  useEffect(() => {
    if (!search || sel) { if (!search) setResults([]); return; }
    const timer = setTimeout(async () => {
      // includeConverted: sin esto el backend filtra status <> 'convertido' y los CLIENTES
      // no aparecían nunca — solo prospectos.
      const res = await client.get<LinkLead[]>(
        `/leads?projectId=${projectId}&search=${encodeURIComponent(search)}&includeConverted=true&limit=10&page=1`
      );
      if (res.success) setResults(res.data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, projectId, sel]);

  async function elegirLead(lead: LinkLead) {
    setSel(lead); setLoadingVentas(true); setVentas([]);
    try {
      const res = await client.get<LinkVenta[]>(`/conversions/by-lead/${lead.id}`);
      if (res.success) setVentas(res.data || []);
    } catch { /* noop */ } finally { setLoadingVentas(false); }
  }

  async function link(conversionId?: number) {
    if (!sel) return;
    setLinking(conversionId || -1);
    try {
      const res = await client.post(`/stripe-payments/${payment.id}/link`, { projectId, leadId: sel.id, conversionId: conversionId || undefined });
      if (res.success) {
        toast({ title: '✓ Asociado', description: `Pago ${fmt(payment.amount)} asociado a ${sel.nombre}` });
        onLinked();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setLinking(null); }
  }

  const num = (v: number | string | null) => Number(v || 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">{sel ? '¿A qué venta se asocia?' : 'Asociar pago a un cliente o prospecto'}</h3>
          <p className="text-xs text-muted-foreground">
            {fmt(payment.amount)} de {payment.customer_email || 'cliente sin email'} — Stripe {payment.stripe_id.slice(0, 14)}…
          </p>
        </div>

        {!sel ? (
          <div className="p-4 space-y-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente o prospecto por nombre, email o teléfono…"
              className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm" autoFocus />
            <div className="max-h-72 overflow-y-auto space-y-1">
              {results.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">{search ? 'Sin coincidencias' : 'Empezá a escribir…'}</p>
              ) : results.map(l => (
                <button key={l.id} onClick={() => elegirLead(l)}
                  className="w-full text-left p-2 rounded-md hover:bg-muted/50 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{l.nombre}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.email || 'sin email'}</div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ml-2 ${l.status === 'convertido' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                    {l.status === 'convertido' ? 'CLIENTE' : 'PROSPECTO'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium truncate">{sel.nombre}</p>
              <button onClick={() => { setSel(null); setVentas([]); }} className="text-[11px] text-primary shrink-0 ml-2">← Cambiar</button>
            </div>
            {loadingVentas ? <p className="text-xs text-muted-foreground py-3">Cargando ventas…</p>
              : ventas.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-amber-600">Este cliente no tiene ventas registradas. Se puede asociar solo al cliente (sin importe ni factura).</p>
                  <button onClick={() => link(undefined)} disabled={linking !== null}
                    className="w-full h-9 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50">
                    {linking !== null ? 'Asociando…' : 'Asociar solo al cliente'}
                  </button>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1">
                  {ventas.map(v => {
                    const pend = num(v.importe_total) - num(v.importe_pagado);
                    return (
                      <button key={v.id} onClick={() => link(v.id)} disabled={linking !== null}
                        className="w-full text-left p-2 rounded-md border border-border hover:bg-muted/50 disabled:opacity-50">
                        <div className="text-sm font-medium truncate">{v.producto_contratado || 'Venta'}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmt(num(v.importe_total))} · cobrado {fmt(num(v.importe_pagado))} ·{' '}
                          <span className={pend > 0.01 ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                            {pend > 0.01 ? `pendiente ${fmt(pend)}` : 'saldada'}
                          </span>
                          {v.fecha_conversion ? ` · ${String(v.fecha_conversion).slice(0, 10)}` : ''}
                        </div>
                        <div className="text-[11px] text-primary mt-0.5">{linking === v.id ? 'Asociando…' : 'Asociar a esta venta'}</div>
                      </button>
                    );
                  })}
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Si ese cobro ya estaba registrado o ya tiene factura, se vincula sin volver a sumarlo.
                  </p>
                </div>
              )}
          </div>
        )}

        <div className="p-3 border-t border-border flex justify-end">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
