import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, CurrencyEur, Users, Check, Clock, X, ArrowRight,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { useConfirm } from '@/shared/components/ui/useConfirm';

type Estado = 'pendiente' | 'pagado' | 'cancelado';

interface CommissionRow {
  id: number;
  conversion_id: number;
  user_id: number;
  user_nombre: string;
  product_nombre: string | null;
  producto_contratado: string;
  lead_nombre: string;
  conv_total: string | number;
  conv_pagado: string | number;
  importe_comision: string | number;
  porcentaje: string | number;
  estado: Estado;
  fecha_pago: string | null;
  fecha_compra: string;
  proyecto_nombre: string;
  created_at: string;
}

interface Stats {
  total: string | number;
  pagado: string | number;
  pendiente: string | number;
  cantidad: string | number;
}

const PERIODS: Record<string, { label: string; from: () => string | null; to: () => string | null }> = {
  current:  { label: 'Mes actual',   from: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: () => null },
  previous: { label: 'Mes pasado',   from: () => new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10), to: () => new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10) },
  ytd:      { label: 'Año en curso', from: () => `${new Date().getFullYear()}-01-01`, to: () => null },
  all:      { label: 'Todo',         from: () => null, to: () => null },
};

function fmt(n: number | string, currency = 'EUR'): string {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${Math.round(v)} ${currency}`;
  }
}

function pctFmt(n: number | string): string {
  return `${Math.round(Number(n || 0))}%`;
}

function KpiSmall({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'pending' | 'paid' | 'cancelled' }) {
  const accentClasses = {
    pending:   'text-amber-600 dark:text-amber-400',
    paid:      'text-emerald-600 dark:text-emerald-400',
    cancelled: 'text-rose-600 dark:text-rose-400',
  } as const;
  return (
    <div className="rounded-2xl bg-card border border-border p-5">
      <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${accent ? accentClasses[accent] : ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

const ESTADO_LABEL: Record<Estado, string> = { pendiente: 'Pendiente', pagado: 'Pagada', cancelado: 'Cancelada' };
const ESTADO_BADGE: Record<Estado, string> = {
  pendiente: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  pagado:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelado: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

export default function CommissionsPage() {
  const { user } = useAuth();
  const { activeProject } = useProjectContext();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [period, setPeriod] = useState('current');
  const [estadoFilter, setEstadoFilter] = useState<Estado | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<number | null>(null);

  const periodParams = useMemo(() => {
    const p = PERIODS[period];
    const params: Record<string, string> = {};
    const from = p?.from?.();
    const to = p?.to?.();
    if (from) params.from = from;
    if (to)   params.to = to;
    if (activeProject?.id) params.projectId = String(activeProject.id);
    return params;
  }, [period, activeProject?.id]);

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    try {
      const baseList = isAdmin ? '/commissions' : '/commissions/me';
      const baseStats = isAdmin ? '/commissions/stats' : '/commissions/me/stats';
      const qsParts = Object.entries(periodParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
      if (estadoFilter) qsParts.push(`estado=${estadoFilter}`);
      const qs = qsParts.length ? `?${qsParts.join('&')}` : '';
      const qsStats = Object.entries(periodParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const [listRes, statsRes] = await Promise.all([
        client.get(`${baseList}${qs}`).catch(() => ({ success: false, data: [] })),
        client.get(`${baseStats}${qsStats ? '?' + qsStats : ''}`).catch(() => ({ success: false, data: null })),
      ]);
      setRows(Array.isArray((listRes as any).data) ? (listRes as any).data : []);
      setStats((statsRes as any).data || null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [user?.id, periodParams, estadoFilter]);

  async function handlePay(row: CommissionRow) {
    if (row.estado !== 'pendiente') return;
    if (!(await confirm({ title: 'Marcar como pagada', message: `¿Marcar como pagada la comisión de ${row.user_nombre} (${fmt(row.importe_comision)})?`, confirmLabel: 'Marcar pagada' }))) return;
    setPaying(row.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await client.patch(`/commissions/${row.id}/pay`, { fecha_pago: today, notas: 'Pagada desde panel' });
      toast({ title: 'Comisión pagada', description: `${row.user_nombre}: ${fmt(row.importe_comision)}` });
      await loadAll();
    } catch (err: any) {
      toast({ title: 'No se pudo marcar como pagada', description: err?.message || 'Error', variant: 'destructive' });
    } finally {
      setPaying(null);
    }
  }

  const visible = useMemo(() => {
    if (!estadoFilter) return rows;
    return rows.filter((r) => r.estado === estadoFilter);
  }, [rows, estadoFilter]);

  const totalPagar = Number(stats?.pendiente || 0);
  const totalPagado = Number(stats?.pagado || 0);
  const cantidad = Number(stats?.cantidad || 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Comisiones</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? 'Calcula y paga las comisiones de tus gestores por cada venta cerrada.'
              : 'Estas son tus comisiones devengadas por las ventas que has cerrado.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 px-3 rounded-md bg-card border border-border text-sm focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          {isAdmin && (
            <button
              onClick={() => navigate('/roles')}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} weight="bold" />
              Nueva regla
            </button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiSmall label="Total a pagar"     value={fmt(totalPagar)}  hint={PERIODS[period].label} accent="pending" />
        <KpiSmall label="Pagado en periodo" value={fmt(totalPagado)} hint={`${rows.filter(r => r.estado === 'pagado').length} comisiones`} accent="paid" />
        <KpiSmall label="Comisiones"        value={String(cantidad)} hint="Total del periodo" />
        <KpiSmall label="Importe medio"     value={fmt(cantidad > 0 ? Number(stats?.total || 0) / cantidad : 0)} hint="Por comisión" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-border">
            <div>
              <h3 className="font-semibold tracking-tight">Comisiones del periodo</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Ordenadas por fecha de venta más reciente.</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <button
                onClick={() => setEstadoFilter(null)}
                className={`px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${estadoFilter === null ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >Todas</button>
              <button
                onClick={() => setEstadoFilter('pendiente')}
                className={`px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${estadoFilter === 'pendiente' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              ><Clock size={12} /> Pendientes</button>
              <button
                onClick={() => setEstadoFilter('pagado')}
                className={`px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${estadoFilter === 'pagado' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              ><Check size={12} /> Pagadas</button>
              <button
                onClick={() => setEstadoFilter('cancelado')}
                className={`px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${estadoFilter === 'cancelado' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              ><X size={12} /> Canceladas</button>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando comisiones…</div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                <CurrencyEur size={22} weight="duotone" className="text-muted-foreground" />
              </div>
              <h4 className="font-semibold text-foreground mb-1">
                {estadoFilter ? `Sin comisiones ${ESTADO_LABEL[estadoFilter].toLowerCase()}` : 'Sin comisiones en el periodo'}
              </h4>
              <p className="text-xs text-muted-foreground max-w-xs">
                Las comisiones se calculan automáticamente al cerrar una venta, según las reglas activas.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[1.4fr_1.2fr_0.8fr_0.5fr_0.7fr_0.7fr_0.4fr] gap-3 px-5 py-2.5 border-b border-border bg-muted/40 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <div>Gestor</div>
                <div>Producto</div>
                <div>Importe base</div>
                <div>%</div>
                <div className="text-right">Comisión</div>
                <div className="text-right">Estado</div>
                <div className="text-right"></div>
              </div>
              <div className="divide-y divide-border">
                {visible.map((r) => (
                  <div key={r.id} className="px-4 md:px-5 py-3 md:grid md:grid-cols-[1.4fr_1.2fr_0.8fr_0.5fr_0.7fr_0.7fr_0.4fr] md:gap-3 md:items-center hover:bg-muted/40 transition-colors">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.user_nombre}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.lead_nombre}</div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1 md:mt-0">{r.product_nombre || r.producto_contratado}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{fmt(r.conv_total)}</div>
                    <div className="text-xs tabular-nums">{pctFmt(r.porcentaje)}</div>
                    <div className="text-right font-semibold tabular-nums">{fmt(r.importe_comision)}</div>
                    <div className="text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${ESTADO_BADGE[r.estado]}`}>
                        {ESTADO_LABEL[r.estado]}
                      </span>
                    </div>
                    <div className="text-right">
                      {isAdmin && r.estado === 'pendiente' ? (
                        <button
                          onClick={() => handlePay(r)}
                          disabled={paying === r.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                        >
                          {paying === r.id ? 'Pagando…' : <>Pagar <ArrowRight size={10} weight="bold" /></>}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold tracking-tight mb-3 flex items-center gap-2">
              <Users size={16} weight="duotone" className="text-primary" />
              Reglas por gestor
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Define qué % cobra cada gestor por cada producto. Sin regla = 0%.
            </p>
            {isAdmin ? (
              <button
                onClick={() => navigate('/roles')}
                className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-muted hover:bg-muted/70 text-sm font-medium transition-colors text-foreground"
              >
                <Plus size={13} weight="bold" />
                Configurar reglas
              </button>
            ) : (
              <p className="text-xs text-muted-foreground italic">Sólo administradores pueden definir reglas.</p>
            )}
          </div>

          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5">
            <h3 className="font-semibold tracking-tight mb-3">Cómo funciona</h3>
            <ol className="space-y-2.5 text-xs text-muted-foreground">
              <li className="flex gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center">1</span>
                <span>Se define una <strong className="text-foreground">regla</strong>: gestor X cobra Y% por producto Z (o por todos).</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center">2</span>
                <span>Al cerrar una venta, se <strong className="text-foreground">crea la comisión</strong> automáticamente.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center">3</span>
                <span>Al final del mes, el admin <strong className="text-foreground">marca como pagadas</strong> las transferidas.</span>
              </li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
