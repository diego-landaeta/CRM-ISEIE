import { useEffect, useState, useCallback } from 'react';
import { Receipt, Eye, PaperPlaneTilt, CheckCircle, X, MagnifyingGlass, Gear, ArrowCounterClockwise } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('es-ES') : '—';

const ESTADO_BADGE: Record<string, string> = {
  emitida:  'bg-blue-100 text-blue-800',
  enviada:  'bg-amber-100 text-amber-800',
  pagada:   'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-red-100 text-red-800',
};

type Stats = { total: number; emitidas: number; enviadas: number; pagadas: number; canceladas: number; total_facturado: number; total_cobrado: number; total_iva: number };

export default function InvoicesPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const pid = activeProject?.id;
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', estado: '', from: '', to: '' });
  const [sending, setSending] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        invoicesApi.list({ projectId: pid, ...filters, limit: 100 }),
        invoicesApi.stats(pid),
      ]);
      if (r1.success) setInvoices(r1.data || []);
      if (r2.success) setStats(r2.data || null);
    } finally { setLoading(false); }
  }, [pid, filters]);
  useEffect(() => { load(); }, [load]);

  async function send(inv: Invoice) {
    if (!inv.cliente_email) {
      toast({ title: 'Sin email', description: 'La factura no tiene email del cliente', variant: 'destructive' });
      return;
    }
    setSending(inv.id);
    try {
      const res = await invoicesApi.send(inv.id);
      if (res.success) {
        toast({ title: '✓ Enviada', description: `${inv.codigo} → ${inv.cliente_email}` });
        await load();
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSending(null); }
  }

  async function markPaid(inv: Invoice) {
    if (!confirm(`¿Marcar como pagada la factura ${inv.codigo}?`)) return;
    try {
      const res = await invoicesApi.markPaid(inv.id);
      if (res.success) {
        toast({ title: '✓ Pagada' });
        await load();
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  }

  async function rectificar(inv: Invoice) {
    const motivo = prompt(
      `Crear factura RECTIFICATIVA (de abono) de ${inv.codigo}.\n\n` +
      `Generará una factura con importe NEGATIVO (-${fmt(Number(inv.total))}) que anula la original.\n\n` +
      `Motivo (anulación / devolución / error importe):`,
      'Anulación'
    );
    if (motivo === null) return;
    try {
      const res = await invoicesApi.rectificar(inv.id, { motivo: motivo || 'Anulación' });
      if (res.success && res.data) {
        toast({ title: '✓ Rectificativa creada', description: res.data.codigo });
        await load();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  if (!pid) return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Facturas"
        subtitle={`Histórico fiscal — ${activeProject?.nombre || ''}`}
        actions={(
          <Link to="configuracion"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
            <Gear size={14} weight="bold" /> Configuración
          </Link>
        )}
      />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={Receipt} iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
            label="Total facturas" numericValue={stats.total} />
          <KpiCard icon={Receipt} iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
            label="Facturado" numericValue={Number(stats.total_facturado)} format={(n) => fmt(Number(n))} />
          <KpiCard icon={CheckCircle} iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
            label="Cobrado" numericValue={Number(stats.total_cobrado)} format={(n) => fmt(Number(n))} />
          <KpiCard icon={Receipt} iconBg="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
            label="IVA acumulado" numericValue={Number(stats.total_iva)} format={(n) => fmt(Number(n))} />
        </div>
      )}

      <div className="bg-card border border-border rounded-md p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Cliente, NIF, código…" className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-sm" />
        </div>
        <select value={filters.estado} onChange={(e) => setFilters(f => ({ ...f, estado: e.target.value }))}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm">
          <option value="">Todos los estados</option>
          <option value="emitida">Emitida</option>
          <option value="enviada">Enviada</option>
          <option value="pagada">Pagada</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <div className="flex items-center gap-1 text-xs">
          <label className="text-muted-foreground">Desde</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters(f => ({ ...f, from: e.target.value }))}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          <label className="text-muted-foreground ml-1">Hasta</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters(f => ({ ...f, to: e.target.value }))}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Receipt size={32} className="text-muted-foreground mx-auto" weight="duotone" />
            <p className="font-semibold text-sm">Sin facturas todavía</p>
            <p className="text-xs text-muted-foreground">Cuando emitas una factura desde una conversión aparecerá aquí.</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 border-y">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Código</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Fecha</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Cliente</th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground">Total</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Estado</th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className={`border-b last:border-0 hover:bg-muted/30 ${inv.tipo === 'rectificativa' ? 'bg-rose-50/40 dark:bg-rose-950/10' : ''}`}>
                  <td className="px-3 py-2 font-mono font-semibold">
                    {inv.codigo}
                    {inv.tipo === 'rectificativa' && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">ABONO</span>
                    )}
                    {inv.rectifica_codigo && (
                      <div className="text-[10px] text-muted-foreground font-normal">rectifica {inv.rectifica_codigo}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{fmtDate(inv.fecha_emision)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{inv.cliente_nombre}</div>
                    <div className="text-[11px] text-muted-foreground">{inv.cliente_nif}</div>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${Number(inv.total) < 0 ? 'text-rose-600' : ''}`}>{fmt(Number(inv.total))}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[inv.estado] || 'bg-muted'}`}>
                      {inv.estado.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => window.open(invoicesApi.pdfUrl(inv.id), '_blank')}
                        title="Ver PDF"
                        className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1">
                        <Eye size={11} /> PDF
                      </button>
                      {inv.estado !== 'pagada' && inv.estado !== 'cancelada' && inv.cliente_email && (
                        <button onClick={() => send(inv)} disabled={sending === inv.id}
                          title="Enviar por email"
                          className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1 disabled:opacity-50">
                          <PaperPlaneTilt size={11} /> {sending === inv.id ? '…' : 'Email'}
                        </button>
                      )}
                      {inv.estado !== 'pagada' && inv.estado !== 'cancelada' && inv.tipo !== 'rectificativa' && (
                        <button onClick={() => markPaid(inv)}
                          title="Marcar pagada"
                          className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1">
                          <CheckCircle size={11} /> Pagada
                        </button>
                      )}
                      {inv.tipo !== 'rectificativa' && (
                        <button onClick={() => rectificar(inv)}
                          title="Crear factura rectificativa (de abono)"
                          className="h-7 px-2 rounded border border-rose-300 text-[11px] text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1">
                          <ArrowCounterClockwise size={11} /> Abono
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
