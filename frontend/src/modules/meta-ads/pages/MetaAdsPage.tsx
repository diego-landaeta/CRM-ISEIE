import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ArrowsClockwise, PlugsConnected, Plugs, Trash, Receipt, Eye, CursorClick, Target, ChartLineUp, Warning } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { metaApi, MetaAccount, MetaCampaign, MetaDashboard, MetaRoiRow } from '../api/metaAds.api';
import { toast } from '@/shared/hooks/useToast';

const ConnectWizard = lazy(() => import('../components/ConnectWizard'));
const AssociateProductsDialog = lazy(() => import('../components/AssociateProductsDialog'));

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
  const [account, setAccount] = useState<MetaAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [dashboard, setDashboard] = useState<MetaDashboard | null>(null);
  const [roi, setRoi] = useState<MetaRoiRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<'campaigns' | 'roi'>('campaigns');
  const [associateOpen, setAssociateOpen] = useState<MetaCampaign | null>(null);

  // Rango de fechas — default últimos 30 días
  const today = new Date().toISOString().slice(0, 10);
  const def30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(def30);
  const [dateTo, setDateTo] = useState(today);

  function loadAccount() {
    if (!projectId) return;
    setLoading(true);
    metaApi.account(projectId)
      .then((r: any) => setAccount(r?.data || null))
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }

  function loadData() {
    if (!projectId || !account) return;
    metaApi.dashboard(projectId, { dateFrom, dateTo }).then((r: any) => setDashboard(r?.data || null)).catch(() => setDashboard(null));
    metaApi.campaigns(projectId, { dateFrom, dateTo }).then((r: any) => setCampaigns(r?.data || [])).catch(() => setCampaigns([]));
    metaApi.roi(projectId, { dateFrom, dateTo }).then((r: any) => setRoi(r?.data || [])).catch(() => setRoi([]));
  }

  useEffect(() => { loadAccount(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, [account?.id, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSync() {
    if (!projectId) return;
    setSyncing(true);
    try {
      await metaApi.sync(projectId);
      toast({ title: 'Sincronizado', description: 'Métricas actualizadas (último día)' });
      loadAccount();
      loadData();
    } catch (err: any) {
      toast({ title: 'Error al sincronizar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackfill() {
    if (!projectId) return;
    if (!confirm('Re-descargar 90 días desde Meta? Se ejecuta en background y tarda ~6-7 minutos.')) return;
    try {
      await metaApi.backfill(projectId, 90);
      toast({ title: 'Backfill iniciado', description: 'Se ejecuta en background. Recarga en unos minutos.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  async function handleDisconnect() {
    if (!projectId) return;
    if (!confirm('Desconectar la cuenta Meta? Se borrarán las credenciales y todas las campañas/métricas sincronizadas.')) return;
    try {
      await metaApi.disconnect(projectId);
      toast({ title: 'Cuenta desconectada' });
      setAccount(null);
      setCampaigns([]); setDashboard(null); setRoi([]);
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
  if (!account) {
    return (
      <Suspense fallback={null}>
        <ConnectWizard projectId={projectId} projectName={activeProject?.nombre} onConnected={loadAccount} />
      </Suspense>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Header con info de cuenta + acciones */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 flex items-center justify-center flex-shrink-0">
            <PlugsConnected size={20} weight="duotone" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight truncate">{account.ad_account_nombre || account.ad_account_id}</h1>
            <p className="text-xs text-muted-foreground">
              {account.ad_account_id} · {account.currency || '—'} ·{' '}
              Última sync: {fmtDate(account.last_synced_at)}{' '}
              {account.last_sync_status === 'in_progress' && <span className="text-amber-600">(en progreso…)</span>}
              {account.last_sync_status === 'error' && <span className="text-red-600">(error)</span>}
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
          <button onClick={handleDisconnect} title="Desconectar cuenta"
            className="h-9 px-3 rounded-md border border-red-200 dark:border-red-900 bg-card text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-1.5">
            <Plugs size={14} /> Desconectar
          </button>
        </div>
      </div>

      {/* Selector rango fechas */}
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

      {/* KPIs del dashboard */}
      {dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={Receipt} label="Gasto" value={fmtMoney(dashboard.totals.spend, currency)} tone="violet" />
          <KpiCard icon={Eye} label="Impresiones" value={fmtNum(dashboard.totals.impressions)} tone="blue" />
          <KpiCard icon={CursorClick} label="Leads" value={fmtNum(dashboard.totals.leads)} hint={`CTR ${dashboard.totals.ctr ? dashboard.totals.ctr.toFixed(2) + '%' : '—'}`} tone="emerald" />
          <KpiCard icon={Target} label="CPL" value={dashboard.totals.cpl != null ? fmtMoney(dashboard.totals.cpl, currency) : '—'} tone="amber" />
        </div>
      )}

      {/* Gráfica daily simple */}
      {dashboard && dashboard.daily.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <ChartLineUp size={16} weight="duotone" className="text-blue-600" />
            Evolución diaria
          </h3>
          <DailyChart daily={dashboard.daily} currency={currency} />
        </div>
      )}

      {/* Tabs Campañas / ROI */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex gap-1">
          <button onClick={() => setTab('campaigns')}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'campaigns' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            Campañas ({campaigns.length})
          </button>
          <button onClick={() => setTab('roi')}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'roi' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
            ROI (asociaciones manuales)
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
                    <tr key={c.campaign_id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <p className="font-medium truncate max-w-md" title={c.nombre}>{c.nombre}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{c.objective || '—'}</p>
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
                        <button onClick={() => setAssociateOpen(c)} className="text-[11px] text-primary hover:underline font-semibold">
                          Asociar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'roi' && (
          <RoiTable rows={roi} currency={currency} />
        )}
      </div>

      <Suspense fallback={null}>
        {associateOpen && (
          <AssociateProductsDialog
            open={!!associateOpen}
            projectId={projectId}
            campaign={associateOpen}
            onClose={() => setAssociateOpen(null)}
            onSaved={() => { setAssociateOpen(null); loadData(); }}
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
