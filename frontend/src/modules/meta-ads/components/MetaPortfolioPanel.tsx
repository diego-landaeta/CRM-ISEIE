import { useEffect, useState } from 'react';
import { Plus, ArrowsClockwise, CaretDown, CaretRight, Buildings } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { metaPortfolioApi, MetaPortfolio, MetaPortfolioDiscoveredAccount } from '../api/metaPortfolio.api';
import { toast } from '@/shared/hooks/useToast';
import Select from '@/shared/components/ui/Select';
import { useConfirm } from '@/shared/components/ui/useConfirm';


const ESTADO_TONE: Record<string, string> = {
  nueva: 'bg-warning-soft text-warning-soft-foreground',
  asignada: 'bg-success-soft text-success-soft-foreground',
  ignorada: 'bg-muted text-muted-foreground',
  sin_acceso: 'bg-destructive-soft text-destructive-soft-foreground',
};
const ESTADO_LABEL: Record<string, string> = {
  nueva: 'Nueva', asignada: 'Asignada', ignorada: 'Ignorada', sin_acceso: 'Sin acceso',
};

/**
 * Submenu "Portfolios" del modulo Meta Ads (#198, gemela de CRM#212). A diferencia de
 * la cuenta de anuncios (ligada a UN campus), un portfolio es de todo el negocio:
 * conecta el Business Manager entero y las cuentas nuevas que aparezcan dentro se
 * descubren solas, sin tocar SSH ni la base.
 */
export default function MetaPortfolioPanel() {
  const { projects } = useProjectContext() as { projects: Array<{ id: number; nombre: string }> };
  const [portfolios, setPortfolios] = useState<MetaPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const [nombre, setNombre] = useState('');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const confirm = useConfirm();

  function load() {
    setLoading(true);
    metaPortfolioApi.list()
      .then((r: any) => setPortfolios(r?.data || []))
      .catch(() => setPortfolios([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function handleConnect() {
    if (!businessId.trim()) {
      toast({ title: 'Business ID requerido', variant: 'destructive' });
      return;
    }
    if (!token || token.length < 20) {
      toast({ title: 'Token vacio o demasiado corto', variant: 'destructive' });
      return;
    }
    setConnecting(true);
    try {
      await metaPortfolioApi.connect({ business_id: businessId.trim(), nombre: nombre.trim() || undefined, access_token: token.trim() });
      toast({ title: 'Portfolio conectado', description: 'Pulsa "Sincronizar" para traer sus cuentas.' });
      setShowConnect(false);
      setBusinessId(''); setNombre(''); setToken('');
      load();
    } catch (err: any) {
      toast({ title: 'No se pudo conectar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setConnecting(false);
    }
  }

   async function handleDisconnect(p: MetaPortfolio) {
    if (!(await confirm({ title: 'Desconectar portfolio', message: `Desconectar el portfolio "${p.nombre || p.business_id}"? Las cuentas ya asignadas a un campus no se tocan.`, tone: 'destructive', confirmLabel: 'Desconectar' }))) return;
    try {
      await metaPortfolioApi.disconnect(p.id);
      toast({ title: 'Portfolio desconectado' });
      load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  if (loading) return <div className="h-32 bg-muted/40 rounded-lg animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold tracking-tight">Portfolios de Meta conectados</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Conecta un Business Manager entero: las cuentas publicitarias nuevas que se creen dentro
            aparecen solas en la bandeja de abajo, sin conectarlas a mano.
          </p>
        </div>
        <button onClick={() => setShowConnect(!showConnect)}
          className="h-9 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted flex items-center gap-1.5 flex-shrink-0">
          <Plus size={14} weight="bold" /> {showConnect ? 'Cancelar' : 'Conectar portfolio'}
        </button>
      </div>

      {showConnect && (
        <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Business ID (Business Manager)</label>
            <input value={businessId} onChange={(e) => setBusinessId(e.target.value.trim())} placeholder="1234567890123456"
              className="w-full h-9 px-2 rounded-md border border-border bg-card text-xs font-mono" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Nombre (opcional, para identificarlo)</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Business Manager principal"
              className="w-full h-9 px-2 rounded-md border border-border bg-card text-xs" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Access Token (con acceso al Business Manager)</label>
            <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={2} placeholder="EAAxxx..."
              className="w-full px-2 py-1.5 rounded-md border border-border bg-card text-xs font-mono resize-none" />
            <p className="text-[11px] text-muted-foreground mt-1">Se valida contra Meta antes de guardarse.</p>
          </div>
          <div className="flex justify-end">
            <button onClick={handleConnect} disabled={connecting}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
              {connecting ? 'Validando con Meta...' : 'Conectar'}
            </button>
          </div>
        </div>
      )}

      {portfolios.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">Ningun portfolio conectado todavia.</p>
      ) : (
        <div className="space-y-3">
          {portfolios.map((p) => (
            <PortfolioRow key={p.id} portfolio={p} projects={projects}
              open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              onDisconnect={() => handleDisconnect(p)} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioRow({ portfolio, projects, open, onToggle, onDisconnect, onChanged }: {
  portfolio: MetaPortfolio; projects: Array<{ id: number; nombre: string }>;
  open: boolean; onToggle: () => void; onDisconnect: () => void; onChanged: () => void;
}) {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      const r: any = await metaPortfolioApi.sync(portfolio.id);
      toast({ title: 'Sincronizado', description: `${r?.data?.nuevas || 0} cuenta(s) nueva(s) de ${r?.data?.cuentasVistas || 0} vistas.` });
      onChanged();
    } catch (err: any) {
      toast({ title: 'Error al sincronizar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onToggle} title={open ? 'Cerrar bandeja' : 'Ver bandeja de cuentas'}
            className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0">
            {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
          </button>
          <Buildings size={16} className="text-muted-foreground flex-shrink-0" weight="duotone" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{portfolio.nombre || portfolio.business_id}</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{portfolio.business_id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-[11px] text-muted-foreground text-right">
            <p>Ultima sync: {portfolio.last_synced_at ? new Date(portfolio.last_synced_at).toLocaleString('es-ES') : '-'}</p>
            {portfolio.last_sync_status === 'error' && <p className="text-destructive truncate max-w-[200px]" title={portfolio.last_sync_error || ''}>Error: {portfolio.last_sync_error}</p>}
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="h-8 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted flex items-center gap-1.5 disabled:opacity-50">
            <ArrowsClockwise size={13} weight="bold" className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button onClick={onDisconnect}
            className="h-8 px-3 rounded-md border border-destructive/30 bg-card text-xs font-semibold text-destructive hover:bg-destructive-soft">
            Desconectar
          </button>
        </div>
      </div>
      {open && <DiscoveredAccountsTray portfolioId={portfolio.id} projects={projects} />}
    </div>
  );
}

function DiscoveredAccountsTray({ portfolioId, projects }: { portfolioId: number; projects: Array<{ id: number; nombre: string }> }) {
  const [rows, setRows] = useState<MetaPortfolioDiscoveredAccount[] | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    metaPortfolioApi.listDiscovered(portfolioId)
      .then((r: any) => setRows(r?.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, [portfolioId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="px-3 py-3 border-t border-border text-xs text-muted-foreground">Cargando bandeja...</div>;
  if (!rows || rows.length === 0) {
    return <div className="px-3 py-3 border-t border-border text-xs text-muted-foreground italic">Sin cuentas descubiertas todavia. Pulsa "Sincronizar".</div>;
  }
  return (
    <div className="border-t border-border divide-y divide-border">
      {rows.map((r) => (
        <DiscoveredAccountRow key={r.id} row={r} projects={projects} onChanged={load} />
      ))}
    </div>
  );
}

function DiscoveredAccountRow({ row, projects, onChanged }: {
  row: MetaPortfolioDiscoveredAccount; projects: Array<{ id: number; nombre: string }>; onChanged: () => void;
}) {
  const [projectId, setProjectId] = useState<number | ''>(row.campus_sugerido_id ?? '');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const accionable = row.estado === 'nueva' || row.estado === 'sin_acceso';

  async function handleAssign() {
    if (!projectId) {
      toast({ title: 'Elige un campus', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await metaPortfolioApi.assign(row.id, Number(projectId));
      toast({ title: 'Cuenta asignada', description: 'Empieza el backfill de 90 dias en background.' });
      onChanged();
    } catch (err: any) {
      toast({ title: 'No se pudo asignar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  async function handleIgnore() {
    if (!(await confirm({ title: 'Ignorar cuenta', message: `Ignorar "${row.nombre || row.ad_account_id}"? No volvera a salir en la bandeja.`, tone: 'destructive', confirmLabel: 'Ignorar' }))) return;
    setBusy(true);
    try {
      await metaPortfolioApi.ignore(row.id);
      toast({ title: 'Cuenta ignorada' });
      onChanged();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium truncate" title={row.nombre || ''}>{row.nombre || row.ad_account_id}</p>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${ESTADO_TONE[row.estado] || 'bg-muted'}`}>
            {ESTADO_LABEL[row.estado] || row.estado}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground font-mono truncate">{row.ad_account_id}</p>
      </div>
      {accionable && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Select<number | ''>
            value={projectId}
            onChange={setProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.nombre }))}
            placeholder={row.campus_sugerido_nombre ? `Sugerido: ${row.campus_sugerido_nombre}` : 'Elige campus...'}
            size="sm"
            className="min-w-[160px]"
          />
          <button onClick={handleAssign} disabled={busy}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
            Asignar
          </button>
          <button onClick={handleIgnore} disabled={busy}
            className="h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
            Ignorar
          </button>
        </div>
      )}
    </div>
  );
}