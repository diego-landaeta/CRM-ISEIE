import { useEffect, useState, useCallback } from 'react';
import { Receipt, Eye, PaperPlaneTilt, CheckCircle, X, MagnifyingGlass, Gear, ArrowCounterClockwise, FileText } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import { invoicesApi, invoiceFaltantes } from '../api/invoices.api';
import type { Invoice, Issuer, VentaSinFactura } from '../api/invoices.api';
import InvoiceButton from '../components/InvoiceButton';
import EmitirBorradorDialog from '../components/EmitirBorradorDialog';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('es-ES') : '—';

const ESTADO_BADGE: Record<string, string> = {
  borrador: 'bg-amber-100 text-amber-800 border border-amber-300',
  emitida:  'bg-blue-100 text-blue-800',
  enviada:  'bg-amber-100 text-amber-800',
  pagada:   'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-red-100 text-red-800',
};

type Stats = { total: number; emitidas: number; enviadas: number; pagadas: number; canceladas: number; total_facturado: number; total_cobrado: number; total_iva: number };

export default function InvoicesPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const { user } = useAuth() as { user: { role?: string } | null };
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const pid = activeProject?.id;
  const loc = useLocation();
  const [tab, setTab] = useState<'facturas' | 'proformas'>(
    new URLSearchParams(loc.search).get('tab') === 'proformas' ? 'proformas' : 'facturas'
  );
  const esProformas = tab === 'proformas';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', estado: '', from: '', to: '' });
  const [sending, setSending] = useState<number | null>(null);
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  // Vista por SOCIEDAD (admin): '' = por proyecto; id = todas las facturas de esa
  // sociedad entre proyectos (global), con la columna Proyecto.
  const [filterIssuer, setFilterIssuer] = useState<string>('');
  const [allIssuers, setAllIssuers] = useState<Issuer[]>([]);
  const porSociedad = isAdmin && !!filterIssuer;
  const [ventasSinFactura, setVentasSinFactura] = useState<VentaSinFactura[]>([]);
  // Borrador que se está validando/emitiendo (abre el diálogo de completar datos)
  const [emittingInv, setEmittingInv] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      // Modo sociedad (admin): facturas globales de esa empresa emisora; el resto
      // (stats, emisores, ventas sin factura) sigue por proyecto activo.
      const listParams = porSociedad
        ? { issuerId: Number(filterIssuer), ...filters, tipo: esProformas ? 'proforma' : undefined, limit: 200 }
        : { projectId: pid, ...filters, tipo: esProformas ? 'proforma' : undefined, limit: 100 };
      const [r1, r2, r3, r4] = await Promise.all([
        invoicesApi.list(listParams),
        invoicesApi.stats(pid),
        invoicesApi.listIssuers(pid).catch(() => ({ success: false, data: [] as Issuer[] })),
        invoicesApi.ventasSinFactura(pid).catch(() => ({ success: false, data: [] as VentaSinFactura[] })),
      ]);
      if (r1.success) setInvoices(r1.data || []);
      if (r2.success) setStats(r2.data || null);
      if (r3.success) setIssuers(r3.data || []);
      if (r4.success) setVentasSinFactura(r4.data || []);
    } finally { setLoading(false); }
  }, [pid, filters, esProformas, porSociedad, filterIssuer]);
  useEffect(() => { load(); }, [load]);

  // Todas las sociedades (para el filtro por sociedad). Solo admin.
  useEffect(() => {
    if (!isAdmin) return;
    invoicesApi.listIssuers().then((r) => { if (r.success) setAllIssuers(r.data || []); }).catch(() => {});
  }, [isAdmin]);

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
    // Override opcional de empresa emisora (por defecto hereda la de la factura original)
    let issuerId: number | undefined;
    if (issuers.length > 1) {
      const opciones = issuers.map((i, idx) => `${idx + 1}. ${i.razon_social}${i.es_default ? ' (default)' : ''}`).join('\n');
      const sel = prompt(
        `Empresa que emite la rectificativa.\n` +
        `Dejá vacío para usar la misma de la factura original.\n\n${opciones}\n\nNº de empresa (o vacío):`,
        ''
      );
      if (sel && sel.trim()) {
        const n = parseInt(sel.trim(), 10);
        if (n >= 1 && n <= issuers.length) issuerId = issuers[n - 1].id;
      }
    }
    try {
      const res = await invoicesApi.rectificar(inv.id, { motivo: motivo || 'Anulación', issuerId });
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
          <div className="flex gap-2">
            <Link to={esProformas ? 'nueva?tipo=proforma' : 'nueva'}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              {esProformas ? <FileText size={14} weight="bold" /> : <Receipt size={14} weight="bold" />}
              {esProformas ? 'Nuevo presupuesto' : 'Nueva factura'}
            </Link>
            <Link to="configuracion"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
              <Gear size={14} weight="bold" /> Configuración
            </Link>
          </div>
        )}
      />

      {/* Pestañas: facturas fiscales vs proformas (presupuestos) */}
      <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1 text-sm font-semibold">
        {([['facturas', 'Facturas', Receipt], ['proformas', 'Presupuestos', FileText]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-4 h-8 rounded-md transition ${tab === k ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon size={14} weight="bold" /> {label}
          </button>
        ))}
      </div>

      {!esProformas && stats && (
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
        {isAdmin && (
          <select value={filterIssuer} onChange={(e) => setFilterIssuer(e.target.value)}
            title="Ver todas las facturas de una sociedad (global, entre proyectos)"
            className={`h-9 px-2 rounded-md border text-sm ${filterIssuer ? 'border-primary/50 bg-primary/5 text-primary font-semibold' : 'border-border bg-card'}`}>
            <option value="">Sociedad: por proyecto</option>
            {allIssuers.map((i) => <option key={i.id} value={String(i.id)}>{i.razon_social}</option>)}
          </select>
        )}
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

      {porSociedad && (
        <div className="text-xs rounded-md border border-primary/30 bg-primary/5 text-primary px-3 py-2">
          Mostrando <strong>todas las facturas</strong> de <strong>{allIssuers.find((i) => String(i.id) === filterIssuer)?.razon_social || 'la sociedad'}</strong> entre todos los proyectos (correlativo en orden). La columna <strong>Proyecto</strong> indica a quién pertenece cada factura.
        </div>
      )}

      {!porSociedad && !esProformas && ventasSinFactura.length > 0 && (
        <div className="bg-amber-50/60 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/40 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-200 dark:border-amber-900/40 flex items-center gap-2">
            <Receipt size={15} weight="bold" className="text-amber-600" />
            <span className="font-semibold text-sm">Ventas sin factura</span>
            <span className="text-[11px] text-muted-foreground">· {ventasSinFactura.length} venta{ventasSinFactura.length !== 1 ? 's' : ''} registrada{ventasSinFactura.length !== 1 ? 's' : ''} sin factura emitida</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-amber-100/40 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900/40">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">Fecha</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">Cliente</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground">Producto</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground">Importe</th>
                  <th className="px-3 py-2 text-right text-xs text-muted-foreground">Acción</th>
                </tr>
              </thead>
              <tbody>
                {ventasSinFactura.map((v) => (
                  <tr key={v.conversion_id} className="border-b border-amber-100 dark:border-amber-900/20 last:border-0">
                    <td className="px-3 py-2">{fmtDate(v.fecha_conversion)}</td>
                    <td className="px-3 py-2 font-medium">{v.cliente_nombre}</td>
                    <td className="px-3 py-2 text-muted-foreground">{v.producto_contratado || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(Number(v.importe_total))}</td>
                    <td className="px-3 py-2 text-right">
                      <InvoiceButton
                        projectId={pid}
                        leadId={v.lead_id}
                        conversionId={v.conversion_id}
                        items={[{ descripcion: v.producto_contratado || 'Servicio', cantidad: 1, precio_unitario: Number(v.importe_total) }]}
                        onInvoiced={load}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Receipt size={32} className="text-muted-foreground mx-auto" weight="duotone" />
            <p className="font-semibold text-sm">{esProformas ? 'Sin presupuestos todavía' : 'Sin facturas todavía'}</p>
            <p className="text-xs text-muted-foreground">{esProformas ? 'Genera uno con “Nuevo presupuesto”.' : 'Cuando emitas una factura desde una conversión aparecerá aquí.'}</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 border-y">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Código</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Fecha</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Cliente</th>
                {porSociedad && <th className="px-3 py-2 text-left text-xs text-muted-foreground">Proyecto</th>}
                <th className="px-3 py-2 text-right text-xs text-muted-foreground">Total</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Estado</th>
                <th className="px-3 py-2 text-right text-xs text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className={`border-b last:border-0 hover:bg-muted/30 ${inv.tipo === 'rectificativa' ? 'bg-rose-50/40 dark:bg-rose-950/10' : inv.tipo === 'proforma' ? 'bg-slate-50/60 dark:bg-slate-900/20' : ''}`}>
                  <td className="px-3 py-2 font-mono font-semibold">
                    {inv.codigo || <span className="text-muted-foreground italic">— sin numerar —</span>}
                    {inv.tipo === 'rectificativa' && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">ABONO</span>
                    )}
                    {inv.tipo === 'proforma' && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">PRESUPUESTO</span>
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
                  {porSociedad && (
                    <td className="px-3 py-2 text-xs text-muted-foreground">{inv.proyecto_nombre || '—'}</td>
                  )}
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${Number(inv.total) < 0 ? 'text-rose-600' : ''}`}>{fmt(Number(inv.total))}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[inv.estado] || 'bg-muted'}`}>
                      {inv.estado.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => invoicesApi.openPdf(inv.id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }))}
                        title="Ver PDF"
                        className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1">
                        <Eye size={11} /> PDF
                      </button>
                      {inv.estado === 'borrador' && (
                        <button onClick={() => setEmittingInv(inv)}
                          title="Validar los datos y emitir la factura (asigna número fiscal)"
                          className="h-7 px-2 rounded bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 inline-flex items-center gap-1">
                          <CheckCircle size={11} weight="bold" /> Validar y emitir
                        </button>
                      )}
                      {inv.estado !== 'borrador' && inv.estado !== 'cancelada' && inv.tipo !== 'proforma' && invoiceFaltantes(inv).length > 0 && (
                        <button onClick={() => setEmittingInv(inv)}
                          title={`Para descargar/enviar debes rellenar: ${invoiceFaltantes(inv).join(', ')}`}
                          className="h-7 px-2 rounded bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 inline-flex items-center gap-1">
                          <CheckCircle size={11} weight="bold" /> Completar datos
                        </button>
                      )}
                      {inv.estado !== 'borrador' && inv.estado !== 'pagada' && inv.estado !== 'cancelada' && inv.cliente_email && invoiceFaltantes(inv).length === 0 && (
                        <button onClick={() => send(inv)} disabled={sending === inv.id}
                          title="Enviar por email"
                          className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1 disabled:opacity-50">
                          <PaperPlaneTilt size={11} /> {sending === inv.id ? '…' : 'Email'}
                        </button>
                      )}
                      {inv.estado !== 'borrador' && inv.estado !== 'pagada' && inv.estado !== 'cancelada' && inv.tipo !== 'rectificativa' && inv.tipo !== 'proforma' && (
                        <button onClick={() => markPaid(inv)}
                          title="Marcar pagada"
                          className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1">
                          <CheckCircle size={11} /> Pagada
                        </button>
                      )}
                      {inv.estado !== 'borrador' && inv.tipo !== 'rectificativa' && inv.tipo !== 'proforma' && (
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

      {emittingInv && (
        <EmitirBorradorDialog
          invoice={emittingInv}
          onClose={() => setEmittingInv(null)}
          onEmitted={(codigo) => {
            setEmittingInv(null);
            toast({ title: '✓ Factura emitida', description: codigo });
            load();
          }}
        />
      )}
    </div>
  );
}
