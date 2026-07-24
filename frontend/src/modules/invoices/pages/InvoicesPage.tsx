import { useEffect, useState, useCallback } from 'react';
import { Receipt, Eye, PaperPlaneTilt, CheckCircle, X, MagnifyingGlass, Gear, ArrowCounterClockwise, FileText, DownloadSimple } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import client from '@/shared/api/client';
import { formatDateNumeric } from '@/shared/lib/format';
import { invoicesApi, invoiceFaltantes } from '../api/invoices.api';
import type { Invoice, Issuer, VentaSinFactura } from '../api/invoices.api';
import InvoiceButton from '../components/InvoiceButton';
import EmitirBorradorDialog from '../components/EmitirBorradorDialog';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
// Usa el formateador compartido: parsea 'YYYY-MM-DD' como fecha LOCAL. Con
// new Date(s) las fechas puras se leen como UTC y en husos negativos
// (America/Caracas, Bogota…) se pintaban un dia antes.
const fmtDate = (s: string | null) => s ? formatDateNumeric(s) : '—';

const ESTADO_BADGE: Record<string, string> = {
  borrador: 'bg-amber-100 text-amber-800 border border-amber-300',
  emitida:  'bg-blue-100 text-blue-800',
  enviada:  'bg-amber-100 text-amber-800',
  pagada:   'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-red-100 text-red-800',
};

type Stats = { total: number; emitidas: number; enviadas: number; pagadas: number; canceladas: number; total_facturado: number; total_cobrado: number; total_iva: number };

export default function InvoicesPage() {
  const { activeProject, projects, switchProject } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string; sociedad_emisora_id?: number | null };
    projects: Array<{ id: number; nombre: string; sociedad_emisora_id?: number | null }>;
    switchProject: (id: number) => void;
  };
  // Sociedad a la que se pide saltar (abre el aviso "entra a este proyecto").
  const [socPrompt, setSocPrompt] = useState<{ id: number; nombre: string } | null>(null);
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
  // Dentro de una sociedad: filtrar por uno de sus proyectos. '' = todos.
  const [filterProject, setFilterProject] = useState<string>('');
  const [allIssuers, setAllIssuers] = useState<Issuer[]>([]);
  const porSociedad = isAdmin && !!filterIssuer;
  // Proyectos que pertenecen a la sociedad seleccionada (para el filtro).
  const sociedadProjects = porSociedad
    ? (projects || []).filter((p) => p.sociedad_emisora_id != null && String(p.sociedad_emisora_id) === filterIssuer)
    : [];
  // Solo se ofrecen sociedades a las que el usuario tiene acceso — es decir, las
  // que son sociedad emisora de alguno de SUS proyectos. Nunca se cruza la
  // facturación entre sociedades: para ver otra hay que entrar a un proyecto suyo.
  const misSociedadIds = new Set((projects || []).map((p) => p.sociedad_emisora_id).filter((x) => x != null));
  const sociedadesVisibles = allIssuers.filter((i) => misSociedadIds.has(i.id));
  const proyectosDeSociedad = (issuerId: number) => (projects || []).filter((p) => p.sociedad_emisora_id === issuerId);
  const [ventasSinFactura, setVentasSinFactura] = useState<VentaSinFactura[]>([]);
  // Cobros de Stripe cobrados pero SIN cliente asociado: salen aqui igual que en
  // Pagos Stripe, porque hasta asociarlos no generan factura.
  const [stripeSinAsociar, setStripeSinAsociar] = useState<Array<{ id: number; customer_name: string | null; customer_email: string | null; amount: number; stripe_created_at: string }>>([]);
  // Borrador que se está validando/emitiendo (abre el diálogo de completar datos)
  const [emittingInv, setEmittingInv] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      // Modo sociedad (admin): facturas globales de esa empresa emisora; el resto
      // (stats, emisores, ventas sin factura) sigue por proyecto activo.
      const listParams = porSociedad
        ? { issuerId: Number(filterIssuer), ...(filterProject ? { projectId: Number(filterProject) } : {}), ...filters, tipo: esProformas ? 'proforma' : undefined, limit: 200 }
        : { projectId: pid, ...filters, tipo: esProformas ? 'proforma' : undefined, limit: 100 };
      const [r1, r2, r3, r4] = await Promise.all([
        invoicesApi.list(listParams),
        porSociedad
          ? invoicesApi.stats({ issuerId: Number(filterIssuer), projectId: filterProject ? Number(filterProject) : null })
          : invoicesApi.stats({ projectId: pid }),
        invoicesApi.listIssuers(pid).catch(() => ({ success: false, data: [] as Issuer[] })),
        invoicesApi.ventasSinFactura(pid).catch(() => ({ success: false, data: [] as VentaSinFactura[] })),
      ]);
      if (r1.success) setInvoices(r1.data || []);
      if (r2.success) setStats(r2.data || null);
      if (r3.success) setIssuers(r3.data || []);
      if (r4.success) setVentasSinFactura(r4.data || []);
      // Cobros Stripe sin asociar del proyecto (no bloqueante).
      client.get<typeof stripeSinAsociar>(`/stripe-payments?projectId=${pid}&linked=no&status=succeeded&facturables=1&limit=50`)
        .then((r) => { if (r.success) setStripeSinAsociar(r.data || []); })
        .catch(() => setStripeSinAsociar([]));
    } finally { setLoading(false); }
  }, [pid, filters, esProformas, porSociedad, filterIssuer, filterProject]);
  useEffect(() => { load(); }, [load]);

  // Al cambiar de sociedad, resetear el filtro de proyecto (los proyectos cambian).
  useEffect(() => { setFilterProject(''); }, [filterIssuer]);

  // Todas las sociedades (para el filtro por sociedad). Solo admin.
  useEffect(() => {
    if (!isAdmin) return;
    invoicesApi.listIssuers().then((r) => { if (r.success) setAllIssuers(r.data || []); }).catch(() => {});
  }, [isAdmin]);

  // Por defecto (admin): mostrar las facturas de la SOCIEDAD emisora del proyecto
  // (cruzando todos los proyectos de esa empresa), no solo las del proyecto activo.
  useEffect(() => {
    if (!isAdmin || issuers.length === 0) return;
    const soc = activeProject?.sociedad_emisora_id;
    const match = soc != null ? issuers.find((i) => i.id === soc) : null;
    const def = match || issuers.find((i) => (i as { es_default?: boolean }).es_default) || issuers[0];
    if (def) setFilterIssuer(String(def.id));
  }, [isAdmin, issuers, activeProject?.sociedad_emisora_id]);

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
              {esProformas ? 'Nueva proforma' : 'Nueva factura'}
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
        {([['facturas', 'Facturas', Receipt], ['proformas', 'Proformas', FileText]] as const).map(([k, label, Icon]) => (
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
        {isAdmin && sociedadesVisibles.length > 1 && (
          <select value={filterIssuer}
            onChange={(e) => {
              const id = Number(e.target.value);
              // No se cruza facturación entre sociedades: si piden otra, se avisa
              // y se ofrece el atajo para entrar a uno de sus proyectos.
              if (id && String(id) !== String(activeProject?.sociedad_emisora_id)) {
                const soc = sociedadesVisibles.find((s) => s.id === id);
                if (soc) setSocPrompt({ id, nombre: soc.razon_social });
                return;
              }
              setFilterIssuer(e.target.value);
            }}
            title="La facturación se consulta dentro de su sociedad. Para ver otra, entra a uno de sus proyectos."
            className={`h-9 px-2 rounded-md border text-sm ${filterIssuer ? 'border-primary/50 bg-primary/5 text-primary font-semibold' : 'border-border bg-card'}`}>
            {sociedadesVisibles.map((i) => <option key={i.id} value={String(i.id)}>{i.razon_social}</option>)}
          </select>
        )}
        {porSociedad && sociedadProjects.length > 0 && (
          <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)}
            title="Filtrar por un proyecto de esta sociedad"
            className={`h-9 px-2 rounded-md border text-sm ${filterProject ? 'border-primary/50 bg-primary/5 text-primary font-semibold' : 'border-border bg-card'}`}>
            <option value="">Todos los proyectos</option>
            {sociedadProjects.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
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
          Mostrando facturas de <strong>{allIssuers.find((i) => String(i.id) === filterIssuer)?.razon_social || 'la sociedad'}</strong>
          {filterProject
            ? <> · proyecto <strong>{sociedadProjects.find((p) => String(p.id) === filterProject)?.nombre}</strong>.</>
            : <> entre <strong>todos sus proyectos</strong> (correlativo en orden). La columna <strong>Proyecto</strong> indica a quién pertenece cada factura.</>}
        </div>
      )}

      {/* Cobros de Stripe sin asociar - tambien visibles aqui, no solo en Pagos Stripe.
          Hasta asociarlos a un cliente NO generan factura. */}
      {!esProformas && stripeSinAsociar.length > 0 && (
        <div className="bg-red-50/70 dark:bg-red-950/20 border border-red-300 dark:border-red-900/50 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-red-200 dark:border-red-900/40 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <X size={15} weight="bold" className="text-red-600" />
              <span className="font-semibold text-sm text-red-800 dark:text-red-300">Cobros de Stripe sin asociar</span>
              <span className="text-[11px] text-muted-foreground">
                &middot; {stripeSinAsociar.length} cobro{stripeSinAsociar.length !== 1 ? 's' : ''} sin cliente &mdash; <strong>no generan factura</strong> hasta asociarlos
              </span>
            </div>
            <Link to="/finanzas/pagos-stripe"
              className="h-8 px-3 rounded-md bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 inline-flex items-center gap-1">
              Asociar en Pagos Stripe &rarr;
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <tbody>
                {stripeSinAsociar.slice(0, 8).map((p) => (
                  <tr key={p.id} className="border-b border-red-100 dark:border-red-900/20 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.stripe_created_at)}</td>
                    <td className="px-3 py-2 font-medium">{p.customer_name || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.customer_email || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(Number(p.amount))}</td>
                    <td className="px-3 py-2 text-right">
                      <Link to="/finanzas/pagos-stripe" className="text-[11px] font-bold text-red-700 dark:text-red-400 hover:underline">
                        NO ASOCIADO &middot; ASOCIAR
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stripeSinAsociar.length > 8 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">y {stripeSinAsociar.length - 8} más…</div>
            )}
          </div>
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
            <p className="font-semibold text-sm">{esProformas ? 'Sin proformas todavía' : 'Sin facturas todavía'}</p>
            <p className="text-xs text-muted-foreground">{esProformas ? 'Genera una con “Nueva proforma”.' : 'Cuando emitas una factura desde una conversión aparecerá aquí.'}</p>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 border-y">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Código</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Fecha</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Cliente</th>
                {porSociedad && <th className="px-3 py-2 text-left text-xs text-muted-foreground">Proyecto</th>}
                <th className="px-3 py-2 text-left text-xs text-muted-foreground">Gestora</th>
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
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">PROFORMA</span>
                    )}
                    {/* Origen del cobro: factura generada automáticamente por un pago Stripe */}
                    {inv.metodo_pago === 'tarjeta_stripe' && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700" title="Factura generada por un pago de Stripe">STRIPE</span>
                    )}
                    {inv.moneda && inv.moneda !== 'EUR' && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Factura en moneda extranjera">{inv.moneda}</span>
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
                  <td className="px-3 py-2 text-xs text-muted-foreground">{inv.gestora_nombre || '—'}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${Number(inv.total) < 0 ? 'text-rose-600' : ''}`}>{fmt(Number(inv.total))}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ESTADO_BADGE[inv.estado] || 'bg-muted'}`}>
                      {inv.estado.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => {
                          const prelim = inv.estado !== 'borrador' && inv.tipo !== 'proforma' && invoiceFaltantes(inv).length > 0;
                          invoicesApi.openPdf(inv.id, prelim).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
                        }}
                        title={inv.estado !== 'borrador' && inv.tipo !== 'proforma' && invoiceFaltantes(inv).length > 0 ? 'Ver vista preliminar (con marca de agua — faltan datos del cliente)' : 'Ver PDF'}
                        className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1">
                        <Eye size={11} /> Ver
                      </button>
                      <button onClick={() => {
                          // Descargar = factura DEFINITIVA (sin marca de agua). El preliminar
                          // solo aplica a borradores (aún sin validez fiscal).
                          const prelim = inv.estado === 'borrador';
                          const fname = ((inv.codigo || `BORRADOR-${inv.id}`).replace('/', '-')) + '.pdf';
                          invoicesApi.downloadPdf(inv.id, fname, prelim).catch((e: unknown) => toast({ title: 'No se pudo descargar el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
                        }}
                        title="Descargar factura (PDF definitivo)"
                        className="h-7 px-2 rounded border border-border text-[11px] hover:bg-muted inline-flex items-center gap-1">
                        <DownloadSimple size={11} />
                      </button>
                      {inv.estado === 'borrador' && isAdmin && (
                        <Link to={`nueva?editId=${inv.id}`}
                          title="Editar esta factura abierta (solo admin/superadmin)"
                          className="h-7 px-2 rounded border border-sky-300 text-sky-700 dark:text-sky-300 text-[11px] font-semibold hover:bg-sky-50 dark:hover:bg-sky-950/30 inline-flex items-center gap-1">
                          <Gear size={11} weight="bold" /> Editar
                        </Link>
                      )}
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

      {/* Aviso: la facturación NO se cruza entre sociedades. Para ver otra hay que
          entrar a uno de sus proyectos — con atajo directo para cambiar. */}
      {socPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSocPrompt(null)}>
          <div className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-base">Entra a un proyecto de {socPrompt.nombre}</h3>
            <p className="text-sm text-muted-foreground">
              La facturación se consulta <strong>dentro de cada sociedad</strong>: no se mezclan facturas
              de sociedades distintas. Para ver la de <strong>{socPrompt.nombre}</strong>, entra a uno de sus proyectos:
            </p>
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {proyectosDeSociedad(socPrompt.id).map((p) => (
                <button key={p.id}
                  onClick={() => { switchProject(p.id); setSocPrompt(null); }}
                  className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-muted text-sm font-medium flex items-center justify-between">
                  <span>{p.nombre}</span>
                  <span className="text-[11px] text-primary font-semibold">Entrar →</span>
                </button>
              ))}
              {proyectosDeSociedad(socPrompt.id).length === 0 && (
                <p className="text-xs text-amber-600">No tienes proyectos asignados en esta sociedad.</p>
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setSocPrompt(null)} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
