import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ArrowsClockwise, PlugsConnected, Receipt, Eye, CursorClick, Target, ChartLineUp, Warning, Gear, CaretRight, CaretDown, Plus, CaretUpDown } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { metaApi, MetaAccount, MetaCampaign, MetaDashboard, MetaRoiRow, MetaAdSet, MetaAd } from '../api/metaAds.api';
import { toast } from '@/shared/hooks/useToast';

const ConnectWizard = lazy(() => import('../components/ConnectWizard'));
const AssociateProductsDialog = lazy(() => import('../components/AssociateProductsDialog'));
const MetaSettingsPanel = lazy(() => import('../components/MetaSettingsPanel'));

function fmtMoney(n: number, currency = 'EUR') {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
}
function fmtNum(n: number) {
  return new Intl.NumberFormat('es-ES').format(n || 0);
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  PAUSED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  DELETED: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  ARCHIVED: 'bg-muted text-muted-foreground',
};

export default function MetaAdsPage() {
  const { activeProject } = useAuth() as { activeProject: { id?: number; nombre?: string } | null };
  const projectId = activeProject?.id;
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  // ID de la cuenta filtrada en la UI. null = "Todas" (agrega cross-cuentas, default).
  const [filterAccountId, setFilterAccountId] = useState<number | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const account = filterAccountId ? accounts.find((a) => a.id === filterAccountId) || null : accounts[0] || null;
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [dashboard, setDashboard] = useState<MetaDashboard | null>(null);
  const [roi, setRoi] = useState<MetaRoiRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'campaigns' | 'products' | 'roi' | 'config'>('campaigns');
  const [productsView, setProductsView] = useState<any[]>([]);
  const [associateOpen, setAssociateOpen] = useState<MetaCampaign | null>(null);
  const [associateAdSetOpen, setAssociateAdSetOpen] = useState<MetaAdSet | null>(null);

  // Rango de fechas — default últimos 30 días
  const today = new Date().toISOString().slice(0, 10);
  const def30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(def30);
  const [dateTo, setDateTo] = useState(today);

  function loadAccounts() {
    if (!projectId) return;
    setLoading(true);
    metaApi.accounts(projectId)
      .then((r: any) => setAccounts(r?.data || []))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }

  function loadData() {
    if (!projectId || accounts.length === 0) return;
    // Dashboard y campaigns suman cross-cuentas del proyecto. Si el usuario selecciona
    // una cuenta concreta, el backend NO filtra por cuenta todavía — para esa vista
    // detallada hay que iterar por accountId. Por ahora mostramos siempre el agregado.
    metaApi.dashboard(projectId, { dateFrom, dateTo }).then((r: any) => setDashboard(r?.data || null)).catch(() => setDashboard(null));
    metaApi.campaigns(projectId, { dateFrom, dateTo }).then((r: any) => setCampaigns(r?.data || [])).catch(() => setCampaigns([]));
    metaApi.roi(projectId, { dateFrom, dateTo }).then((r: any) => setRoi(r?.data || [])).catch(() => setRoi([]));
    metaApi.productsView(projectId, { dateFrom, dateTo }).then((r: any) => setProductsView(r?.data || [])).catch(() => setProductsView([]));
  }

  useEffect(() => { loadAccounts(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [accounts.length, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Acciones por cuenta concreta (las del header actúan sobre la cuenta seleccionada).
  async function handleSync() {
    if (!account) return;
    setSyncing(true);
    try {
      await metaApi.sync(account.id);
      toast({ title: 'Sincronizado', description: `${account.ad_account_nombre || account.ad_account_id} — métricas actualizadas` });
      loadAccounts();
      loadData();
    } catch (err: any) {
      toast({ title: 'Error al sincronizar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackfill() {
    if (!account) return;
    if (!confirm(`Re-descargar 90 días desde Meta para "${account.ad_account_nombre || account.ad_account_id}"? Tarda ~20 min (3 niveles).`)) return;
    try {
      await metaApi.backfill(account.id, 90);
      toast({ title: 'Backfill iniciado', description: 'Se ejecuta en background. Recarga en unos minutos.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  async function handleDisconnect() {
    if (!account) return;
    if (!confirm(`Desconectar "${account.ad_account_nombre || account.ad_account_id}"? Solo borra esta cuenta; las demás del proyecto no se tocan.`)) return;
    try {
      await metaApi.disconnect(account.id);
      toast({ title: 'Cuenta desconectada' });
      setFilterAccountId(null);
      loadAccounts();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  const currency = account?.currency || 'EUR';

  // Estados de página
  if (!projectId || projectId === -1) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-6 text-center text-sm text-amber-800 dark:text-amber-300">
        Selecciona un proyecto en la barra superior.
      </div>
    );
  }
  if (loading) {
    return <div className="h-40 bg-muted/40 rounded-lg animate-pulse" />;
  }
  if (accounts.length === 0 || showAddAccount) {
    return (
      <div className="space-y-3">
        {showAddAccount && (
          <button onClick={() => setShowAddAccount(false)}
            className="text-xs text-muted-foreground hover:text-foreground">
            ← Volver a las cuentas conectadas
          </button>
        )}
        <Suspense fallback={null}>
          <ConnectWizard
            projectId={projectId}
            projectName={activeProject?.nombre}
            onConnected={() => { setShowAddAccount(false); loadAccounts(); }}
          />
        </Suspense>
      </div>
    );
  }
  if (!account) return null;

  return (
    <div className="space-y-5 pb-8">
      {/* Header con selector de cuenta (cuando hay >1) + info + acciones */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 flex items-center justify-center flex-shrink-0">
            <PlugsConnected size={20} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            {accounts.length > 1 ? (
              <div className="relative inline-block">
                <select
                  value={account.id}
                  onChange={(e) => setFilterAccountId(parseInt(e.target.value))}
                  className="appearance-none h-7 pl-2 pr-6 rounded-md border border-border bg-card text-base font-bold tracking-tight max-w-md truncate cursor-pointer hover:bg-muted"
                  title="Cambiar cuenta"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.ad_account_nombre || a.ad_account_id}
                    </option>
                  ))}
                </select>
                <CaretUpDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
              </div>
            ) : (
              <h1 className="text-lg font-bold tracking-tight truncate">{account.ad_account_nombre || account.ad_account_id}</h1>
            )}
            <p className="text-xs text-muted-foreground">
              {account.ad_account_id} · {account.currency || '—'} ·{' '}
              Última sync: {fmtDate(account.last_synced_at)}{' '}
              {account.last_sync_status === 'in_progress' && <span className="text-amber-600">(en progreso…)</span>}
              {account.last_sync_status === 'error' && <span className="text-red-600">(error)</span>}
              {accounts.length > 1 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{accounts.length} cuentas</span>}
            </p>
            {account.last_sync_error && (
              <p className="text-[11px] text-red-600 mt-0.5 truncate" title={account.last_sync_error}>
                <Warning size={11} className="inline mr-0.5" />
                {account.last_sync_error}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={handleSync} disabled={syncing || account.last_sync_status === 'in_progress'}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted flex items-center gap-1.5 disabled:opacity-50">
            <ArrowsClockwise size={14} weight="bold" className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <button onClick={handleBackfill} title="Re-descargar últimos 90 días en background"
            className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted flex items-center gap-1.5">
            <ArrowsClockwise size={14} /> 90d
          </button>
          <button onClick={() => setShowAddAccount(true)} title="Conectar otra cuenta publicitaria al mismo proyecto"
            className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted flex items-center gap-1.5">
            <Plus size={14} weight="bold" /> Cuenta
          </button>
          <button onClick={() => setTab('config')} title="Configuración (token, cuenta, desconectar)"
            className={`h-9 px-3 rounded-md border text-sm font-medium flex items-center gap-1.5 ${tab === 'config' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted'}`}>
            <Gear size={14} weight="duotone" /> Configuración
          </button>
        </div>
      </div>

      {/* Selector rango fechas (oculto cuando estás en config) */}
      {tab !== 'config' && (
      <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2 flex-wrap">
        <label className="text-xs font-semibold text-muted-foreground">Rango:</label>
        <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 px-2 rounded-md border border-border bg-muted/50 text-sm" />
        <span className="text-xs text-muted-foreground">—</span>
        <input type="date" value={dateTo} min={dateFrom} max={today} onChange={(e) => setDateTo(e.target.value)}
          className="h-9 px-2 rounded-md border border-border bg-muted/50 text-sm" />
        <div className="flex gap-1 ml-2">
          {[{ d: 7, l: '7d' }, { d: 30, l: '30d' }, { d: 90, l: '90d' }].map(({ d, l }) => (
            <button key={l} onClick={() => { setDateFrom(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)); setDateTo(today); }}
              className="h-9 px-2 text-xs rounded-md border border-border bg-muted/50 hover:bg-muted">
              {l}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* KPIs del dashboard */}
      {tab !== 'config' && dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={Receipt} label="Gasto" value={fmtMoney(dashboard.totals.spend, currency)} tone="violet" />
          <KpiCard icon={Eye} label="Impresiones" value={fmtNum(dashboard.totals.impressions)} tone="blue" />
          <KpiCard icon={CursorClick} label="Leads" value={fmtNum(dashboard.totals.leads)} hint={`CTR ${dashboard.totals.ctr ? dashboard.totals.ctr.toFixed(2) + '%' : '—'}`} tone="emerald" />
          <KpiCard icon={Target} label="CPL" value={dashboard.totals.cpl != null ? fmtMoney(dashboard.totals.cpl, currency) : '—'} tone="amber" />
        </div>
      )}

      {/* Gráfica daily simple */}
      {tab !== 'config' && dashboard && dashboard.daily.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <ChartLineUp size={16} weight="duotone" className="text-blue-600" />
            Evolución diaria
          </h3>
          <DailyChart daily={dashboard.daily} currency={currency} />
        </div>
      )}

      {/* Tabs Campañas / ROI / Configuración */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex gap-1 flex-wrap">
          <button onClick={() => setTab('campaigns')}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'campaigns' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            Campañas ({campaigns.length})
          </button>
          <button onClick={() => setTab('products')}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'products' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            Por producto ({productsView.length})
          </button>
          <button onClick={() => setTab('roi')}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'roi' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            ROI (asociaciones manuales)
          </button>
          <button onClick={() => setTab('config')}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1.5 ${tab === 'config' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            <Gear size={13} weight="duotone" /> Configuración
          </button>
        </div>

        {tab === 'campaigns' && (
          <div className="overflow-x-auto">
            {campaigns.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Sin campañas en este rango. Si conectaste hace poco, espera al backfill o pulsa "90d".
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Campaña</th>
                    <th className="text-left px-3 py-2 font-medium">Estado</th>
                    <th className="text-right px-3 py-2 font-medium">Gasto</th>
                    <th className="text-right px-3 py-2 font-medium">Impr.</th>
                    <th className="text-right px-3 py-2 font-medium">Clicks · CTR</th>
                    <th className="text-right px-3 py-2 font-medium">Leads · CPL</th>
                    <th className="text-right px-3 py-2 font-medium w-24">Productos</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <CampaignRow
                      key={c.campaign_id}
                      c={c}
                      projectId={projectId}
                      currency={currency}
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      onAssociate={() => setAssociateOpen(c)}
                      onAssociateAdSet={(a) => setAssociateAdSetOpen(a)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'products' && (
          <ProductsViewTable rows={productsView} currency={currency} />
        )}

        {tab === 'roi' && (
          <RoiTable rows={roi} currency={currency} />
        )}

        {tab === 'config' && (
          <div className="p-4">
            <Suspense fallback={<div className="h-40 bg-muted/40 rounded animate-pulse" />}>
              <MetaSettingsPanel
                projectId={projectId}
                account={account}
                onChanged={() => { loadAccount(); loadData(); }}
                onDisconnect={handleDisconnect}
              />
            </Suspense>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        {associateOpen && (
          <AssociateProductsDialog
            open={!!associateOpen}
            projectId={projectId}
            scope={{ type: 'campaign', id: associateOpen.campaign_id, nombre: associateOpen.nombre }}
            onClose={() => setAssociateOpen(null)}
            onSaved={() => { setAssociateOpen(null); loadData(); }}
          />
        )}
        {associateAdSetOpen && (
          <AssociateProductsDialog
            open={!!associateAdSetOpen}
            projectId={projectId}
            scope={{ type: 'adset', id: associateAdSetOpen.adset_id, nombre: associateAdSetOpen.nombre }}
            onClose={() => setAssociateAdSetOpen(null)}
            onSaved={() => { setAssociateAdSetOpen(null); }}
          />
        )}
      </Suspense>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, hint, tone = 'blue' }: { icon: any; label: string; value: string; hint?: string; tone?: string }) {
  const toneMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400',
  };
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-md ${toneMap[tone]} flex items-center justify-center`}>
          <Icon size={16} weight="duotone" />
        </div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="text-2xl font-bold mt-2 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function DailyChart({ daily, currency }: { daily: MetaDashboard['daily']; currency: string }) {
  const max = useMemo(() => Math.max(1, ...daily.map((d) => d.spend)), [daily]);
  const maxLeads = useMemo(() => Math.max(1, ...daily.map((d) => d.leads)), [daily]);
  return (
    <div className="flex items-end gap-1 h-32 overflow-x-auto">
      {daily.map((d) => {
        const hSpend = (d.spend / max) * 100;
        const hLeads = (d.leads / maxLeads) * 100;
        return (
          <div key={d.date} className="flex flex-col items-center gap-1 min-w-[24px] group relative">
            <div className="flex items-end gap-0.5 h-24">
              <div className="w-2.5 bg-violet-400 rounded-t" style={{ height: `${hSpend}%` }} title={`Gasto: ${fmtMoney(d.spend, currency)}`} />
              <div className="w-2.5 bg-emerald-400 rounded-t" style={{ height: `${hLeads}%` }} title={`Leads: ${d.leads}`} />
            </div>
            <span className="text-[9px] text-muted-foreground rotate-45 origin-left">{d.date.slice(5)}</span>
            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover border border-border rounded p-2 text-[10px] shadow-lg z-10 whitespace-nowrap">
              <p className="font-semibold">{d.date}</p>
              <p>Gasto: {fmtMoney(d.spend, currency)}</p>
              <p>Leads: {d.leads}</p>
              <p>Clicks: {fmtNum(d.clicks)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Fila Campaña: expandible → muestra AdSets debajo (carga lazy).
// Tabla 3 niveles: Campaign → AdSet → Ad. Click en chevron toggle.

function CampaignRow({ c, projectId, currency, dateFrom, dateTo, onAssociate, onAssociateAdSet }:
  { c: MetaCampaign; projectId: number; currency: string; dateFrom: string; dateTo: string; onAssociate: () => void; onAssociateAdSet: (a: MetaAdSet) => void }) {
  const [open, setOpen] = useState(false);
  const [adsets, setAdSets] = useState<MetaAdSet[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || adsets) return;
    setLoading(true);
    metaApi.adsets(projectId, c.campaign_id, { dateFrom, dateTo })
      .then((r: any) => setAdSets(r?.data || []))
      .catch(() => setAdSets([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Si cambia el rango de fechas y ya estaba abierto, recargar.
  useEffect(() => { if (open) setAdSets(null); /* fuerza recarga */ }, [dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <tr className="border-t border-border hover:bg-muted/30">
        <td className="px-2 py-2.5">
          <div className="flex items-center gap-1">
            <button onClick={() => setOpen(!open)} title={open ? 'Cerrar' : 'Ver conjuntos'}
              className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded">
              {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate max-w-md" title={c.nombre}>{c.nombre}</p>
              <p className="text-[11px] text-muted-foreground truncate">{c.objective || '—'}</p>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_TONE[c.effective_status || c.status || ''] || 'bg-muted text-muted-foreground'}`}>
            {c.effective_status || c.status || '—'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(c.total_spend, currency)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(c.total_impressions)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          {fmtNum(c.total_clicks)}<br />
          <span className="text-muted-foreground">{c.ctr != null ? c.ctr.toFixed(2) + '%' : '—'}</span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-xs">
          <span className="font-semibold">{fmtNum(c.total_leads)}</span><br />
          <span className="text-muted-foreground">{c.cpl != null ? fmtMoney(c.cpl, currency) : '—'}</span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <button onClick={onAssociate} className="text-[11px] text-primary hover:underline font-semibold">
            Asociar
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/20">
          <td colSpan={7} className="px-0 py-0">
            {loading ? (
              <div className="px-8 py-3 text-xs text-muted-foreground">Cargando conjuntos…</div>
            ) : adsets && adsets.length === 0 ? (
              <div className="px-8 py-3 text-xs text-muted-foreground italic">Sin conjuntos en este rango (o backfill aún no incluye adsets).</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {(adsets || []).map((a) => (
                    <AdSetRow key={a.adset_id} a={a} projectId={projectId} currency={currency} dateFrom={dateFrom} dateTo={dateTo}
                      onAssociate={() => onAssociateAdSet(a)} />
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AdSetRow({ a, projectId, currency, dateFrom, dateTo, onAssociate }:
  { a: MetaAdSet; projectId: number; currency: string; dateFrom: string; dateTo: string; onAssociate: () => void }) {
  const [open, setOpen] = useState(false);
  const [ads, setAds] = useState<MetaAd[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || ads) return;
    setLoading(true);
    metaApi.ads(projectId, a.adset_id, { dateFrom, dateTo })
      .then((r: any) => setAds(r?.data || []))
      .catch(() => setAds([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { if (open) setAds(null); }, [dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <tr className="border-t border-border/50 hover:bg-muted/30">
        <td className="pl-8 pr-2 py-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setOpen(!open)} title={open ? 'Cerrar' : 'Ver anuncios'}
              className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded">
              {open ? <CaretDown size={10} weight="bold" /> : <CaretRight size={10} weight="bold" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-xs truncate max-w-md" title={a.nombre}>{a.nombre}</p>
              <p className="text-[10px] text-muted-foreground truncate">{a.optimization_goal || a.billing_event || '—'}</p>
            </div>
          </div>
        </td>
        <td className="px-3 py-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_TONE[a.effective_status || a.status || ''] || 'bg-muted text-muted-foreground'}`}>
            {a.effective_status || a.status || '—'}
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(a.total_spend, currency)}</td>
        <td className="px-3 py-2 text-right tabular-nums">{fmtNum(a.total_impressions)}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {fmtNum(a.total_clicks)} <span className="text-muted-foreground">· {a.ctr != null ? a.ctr.toFixed(2) + '%' : '—'}</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {fmtNum(a.total_leads)} <span className="text-muted-foreground">· {a.cpl != null ? fmtMoney(a.cpl, currency) : '—'}</span>
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={(e) => { e.stopPropagation(); onAssociate(); }}
            className="text-[11px] text-primary hover:underline font-semibold">
            Asociar
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={7} className="px-0 py-0">
            {loading ? (
              <div className="pl-14 py-2 text-xs text-muted-foreground">Cargando anuncios…</div>
            ) : ads && ads.length === 0 ? (
              <div className="pl-14 py-2 text-xs text-muted-foreground italic">Sin anuncios en este rango.</div>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {(ads || []).map((ad) => (
                    <AdRow key={ad.ad_id} ad={ad} currency={currency} />
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function AdRow({ ad, currency }: { ad: MetaAd; currency: string }) {
  return (
    <tr className="border-t border-border/30 hover:bg-muted/40">
      <td className="pl-14 pr-2 py-1.5">
        <p className="text-xs truncate max-w-md" title={ad.nombre}>{ad.nombre}</p>
        <p className="text-[10px] text-muted-foreground truncate font-mono">{ad.ad_id}</p>
      </td>
      <td className="px-3 py-1.5">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_TONE[ad.effective_status || ad.status || ''] || 'bg-muted text-muted-foreground'}`}>
          {ad.effective_status || ad.status || '—'}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(ad.total_spend, currency)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(ad.total_impressions)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {fmtNum(ad.total_clicks)} <span className="text-muted-foreground">· {ad.ctr != null ? ad.ctr.toFixed(2) + '%' : '—'}</span>
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">
        {fmtNum(ad.total_leads)} <span className="text-muted-foreground">· {ad.cpl != null ? fmtMoney(ad.cpl, currency) : '—'}</span>
      </td>
      <td />
    </tr>
  );
}

// Vista por producto: para cada producto asociado, qué campañas/adsets lo promocionan,
// gasto agregado (campaign + adset spend), leads Meta, ventas registradas y ROI.
function ProductsViewTable({ rows, currency }: { rows: any[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Ningún producto tiene asociaciones aún. Ve a Campañas → expande un conjunto → "Asociar" para vincular productos.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Producto</th>
            <th className="text-left px-3 py-2 font-medium">Campañas / Conjuntos activos</th>
            <th className="text-right px-3 py-2 font-medium">Gasto</th>
            <th className="text-right px-3 py-2 font-medium">Leads · CPL</th>
            <th className="text-right px-3 py-2 font-medium">Ventas · Facturado</th>
            <th className="text-right px-3 py-2 font-medium">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const roiTone = r.roi_pct == null ? '' : r.roi_pct >= 0 ? 'text-emerald-600' : 'text-red-600';
            return (
              <tr key={r.product_id} className="border-t border-border hover:bg-muted/30 align-top">
                <td className="px-4 py-2.5">
                  <p className="font-medium truncate max-w-xs" title={r.producto_nombre}>{r.producto_nombre}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {r.producto_precio != null && `${fmtMoney(r.producto_precio, currency)} · `}
                    {r.producto_activo ? <span className="text-emerald-600">activo</span> : <span>inactivo</span>}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  <ProductLinks links={r.links || []} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(r.spend, currency)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                  <span className="font-semibold">{fmtNum(r.leads_meta)}</span><br />
                  <span className="text-muted-foreground">{r.cpl != null ? fmtMoney(r.cpl, currency) : '—'}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                  <span className="font-semibold">{r.ventas}</span> · <span>{fmtMoney(r.facturado, currency)}</span><br />
                  <span className="text-muted-foreground">Cobrado: {fmtMoney(r.cobrado, currency)}</span>
                </td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${roiTone}`}>
                  {r.roi_pct == null ? '—' : `${r.roi_pct >= 0 ? '+' : ''}${r.roi_pct.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductLinks({ links }: { links: Array<{ scope: string; id: string; name: string; status: string | null }> }) {
  if (!links.length) return <span className="text-muted-foreground italic">—</span>;
  const camp = links.filter((l) => l.scope === 'campaign');
  const ads = links.filter((l) => l.scope === 'adset');
  return (
    <div className="space-y-1">
      {camp.map((l) => (
        <div key={l.id} className="flex items-center gap-1.5">
          <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 font-semibold">Camp</span>
          <span className="truncate max-w-xs" title={l.name}>{l.name}</span>
          {l.status && <span className={`text-[9px] px-1 py-0.5 rounded ${STATUS_TONE[l.status] || 'bg-muted'}`}>{l.status}</span>}
        </div>
      ))}
      {ads.map((l) => (
        <div key={l.id} className="flex items-center gap-1.5">
          <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 font-semibold">AdSet</span>
          <span className="truncate max-w-xs" title={l.name}>{l.name}</span>
          {l.status && <span className={`text-[9px] px-1 py-0.5 rounded ${STATUS_TONE[l.status] || 'bg-muted'}`}>{l.status}</span>}
        </div>
      ))}
    </div>
  );
}

function RoiTable({ rows, currency }: { rows: MetaRoiRow[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Sin datos de ROI. Asocia productos a las campañas (botón "Asociar" en la tabla de Campañas)
        para que el CRM cruce el gasto Meta con las ventas registradas.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-[11px] text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Campaña</th>
            <th className="text-left px-3 py-2 font-medium">Productos asociados</th>
            <th className="text-right px-3 py-2 font-medium">Gasto</th>
            <th className="text-right px-3 py-2 font-medium">Ventas · Facturado</th>
            <th className="text-right px-3 py-2 font-medium">Ganancia</th>
            <th className="text-right px-3 py-2 font-medium">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const roiTone = r.roi_pct == null ? '' : r.roi_pct >= 0 ? 'text-emerald-600' : 'text-red-600';
            return (
              <tr key={r.campaign_id} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <p className="font-medium truncate max-w-xs" title={r.nombre}>{r.nombre}</p>
                  <p className="text-[10px] text-muted-foreground">{r.status}</p>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {r.n_productos_asociados === 0
                    ? <span className="text-muted-foreground italic">— sin productos asociados —</span>
                    : <span className="truncate block max-w-md" title={r.productos_nombres || ''}>{r.productos_nombres}</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(r.spend, currency)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                  <span className="font-semibold">{r.ventas}</span> · <span>{fmtMoney(r.facturado, currency)}</span><br />
                  <span className="text-muted-foreground">Cobrado: {fmtMoney(r.cobrado, currency)}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(r.ganancia, currency)}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${roiTone}`}>
                  {r.roi_pct == null ? '—' : `${r.roi_pct >= 0 ? '+' : ''}${r.roi_pct.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
