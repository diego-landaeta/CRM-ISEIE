import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { accountingApi } from '../api/accounting.api';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import {
  CurrencyEur, WarningCircle, Wallet, Receipt, CaretLeft, CaretRight,
  ListBullets, CalendarBlank, Coins,
} from '@phosphor-icons/react';

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
const fmt0 = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
function formatDate(d: string | null) { return d ? new Date(d + (String(d).length <= 10 ? 'T00:00:00' : '')).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
// Fecha local YYYY-MM-DD sin desfase de huso.
function ymd(dt: Date) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

interface Row {
  tipo: 'cuota' | 'venta'; ref_id: number; conversion_id: number; lead_id: number;
  cliente: string; cliente_email: string | null; producto: string;
  project_id: number; proyecto_nombre: string;
  responsable_id: number | null; gestora_nombre: string | null;
  cuota_numero: number | null; importe: number; vence: string | null; vencido: boolean;
}

export default function ReceivablePage() {
  const navigate = useNavigate();
  const { activeProject, projects } = useProjectContext();
  const { user } = useAuth() as { user: { role?: string } | null };
  const isGestor = user?.role === 'gestor';

  const [items, setItems] = useState<Row[]>([]);
  const [gestoras, setGestoras] = useState<{ id: number; nombre: string }[]>([]);
  const [resumen, setResumen] = useState<{ total_pendiente: number; total_vencido: number; count: number; count_vencidas: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<'lista' | 'calendario'>('lista');
  const [projectId, setProjectId] = useState<string>(''); // '' = proyecto activo
  const [gestoraId, setGestoraId] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [cal, setCal] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selDay, setSelDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pid = projectId || activeProject?.id || undefined;
      const params: Record<string, string | number> = {};
      if (pid) params.projectId = Number(pid);
      if (gestoraId) params.responsableId = Number(gestoraId);
      // El calendario SIEMPRE trae todas las cuotas (se navega por mes visualmente);
      // el periodo Desde/Hasta solo aplica en la vista Lista.
      if (view === 'lista' && from) params.from = from;
      if (view === 'lista' && to) params.to = to;
      const res = await accountingApi.receivable(params);
      if (res.success && res.data) {
        setItems(res.data.items || []);
        setGestoras(res.data.gestoras || []);
        setResumen(res.data.resumen || null);
      }
    } finally { setLoading(false); }
  }, [projectId, gestoraId, from, to, view, activeProject?.id]);
  useEffect(() => { load(); }, [load]);

  const visibles = useMemo(() => soloVencidas ? items.filter(r => r.vencido) : items, [items, soloVencidas]);

  // ---- Calendario: buckets por día ----
  const porDia = useMemo(() => {
    const map: Record<string, { total: number; count: number; vencidas: number }> = {};
    for (const r of items) {
      if (!r.vence) continue;
      const key = String(r.vence).slice(0, 10);
      const b = map[key] || (map[key] = { total: 0, count: 0, vencidas: 0 });
      b.total += Number(r.importe); b.count += 1; if (r.vencido) b.vencidas += 1;
    }
    return map;
  }, [items]);

  const celdas = useMemo(() => {
    const first = new Date(cal.y, cal.m, 1);
    const startOffset = (first.getDay() + 6) % 7; // Lunes primero
    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let k = 0; k < 42; k++) {
      const date = new Date(cal.y, cal.m, 1 - startOffset + k);
      cells.push({ date, inMonth: date.getMonth() === cal.m });
    }
    return cells;
  }, [cal]);

  const hoy = ymd(new Date());
  const itemsDelDia = useMemo(() => selDay ? items.filter(r => r.vence && String(r.vence).slice(0, 10) === selDay) : [], [items, selDay]);

  function irMes(delta: number) {
    setSelDay(null);
    setCal(prev => { const d = new Date(prev.y, prev.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  }
  // El calendario muestra TODAS las cuotas (no se ata al periodo Desde/Hasta).
  function verMesEnCalendario() { setView('calendario'); }

  const totalPend = resumen?.total_pendiente ?? visibles.reduce((s, r) => s + r.importe, 0);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Cuentas por cobrar"
        subtitle={isGestor ? 'Tus cobros pendientes y sus vencimientos' : 'Cobros pendientes por gestora, proyecto y periodo'}
        actions={
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button onClick={() => setView('lista')} className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium ${view === 'lista' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>
              <ListBullets size={14} weight="bold" /> Lista
            </button>
            <button onClick={verMesEnCalendario} className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium border-l border-border ${view === 'calendario' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>
              <CalendarBlank size={14} weight="bold" /> Calendario
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Receipt} iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400" label="Cobros pendientes" numericValue={resumen?.count ?? visibles.length} />
        <KpiCard icon={Wallet} iconBg="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400" label="Total pendiente" numericValue={totalPend} format={fmt} />
        <KpiCard icon={WarningCircle} iconBg={(resumen?.count_vencidas || 0) > 0 ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400' : 'bg-muted text-muted-foreground'} label="Vencidas" numericValue={resumen?.count_vencidas ?? 0} />
        <KpiCard icon={Coins} iconBg="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400" label="Importe vencido" numericValue={resumen?.total_vencido ?? 0} format={fmt} />
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Proyecto</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-card text-sm min-w-[160px]">
            <option value="">{activeProject?.nombre || 'Proyecto activo'}</option>
            {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        {!isGestor && (
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Gestora</label>
            <select value={gestoraId} onChange={e => setGestoraId(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-card text-sm min-w-[150px]">
              <option value="">Todas</option>
              {gestoras.map(g => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
        )}
        {view === 'lista' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">Desde</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-muted-foreground">Hasta</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { l: 'Este mes', f: () => { const d = new Date(); setFrom(ymd(new Date(d.getFullYear(), d.getMonth(), 1))); setTo(ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))); } },
                { l: 'Próx. mes', f: () => { const d = new Date(); setFrom(ymd(new Date(d.getFullYear(), d.getMonth() + 1, 1))); setTo(ymd(new Date(d.getFullYear(), d.getMonth() + 2, 0))); } },
                { l: 'Todas', f: () => { setFrom(''); setTo(''); } },
              ].map(b => (
                <button key={b.l} onClick={b.f} className="h-9 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted">{b.l}</button>
              ))}
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-1 h-9">
                <input type="checkbox" checked={soloVencidas} onChange={e => setSoloVencidas(e.target.checked)} /> Solo vencidas
              </label>
            </div>
          </>
        )}
        {view === 'calendario' && (
          <p className="text-xs text-muted-foreground self-center">El calendario muestra todas las cuotas por su fecha de cobro. Usa ◀ ▶ para cambiar de mes.</p>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : view === 'calendario' ? (
        <div className="bg-card border border-border rounded-lg p-3">
          {/* Nav mes */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => irMes(-1)} className="p-1.5 rounded-md hover:bg-muted"><CaretLeft size={16} weight="bold" /></button>
            <h3 className="text-sm font-bold">{MES[cal.m]} {cal.y}</h3>
            <button onClick={() => irMes(1)} className="p-1.5 rounded-md hover:bg-muted"><CaretRight size={16} weight="bold" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-foreground mb-1">
            {DIAS.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {celdas.map((c, idx) => {
              const key = ymd(c.date);
              const b = porDia[key];
              const esHoy = key === hoy;
              const sel = key === selDay;
              return (
                <button key={idx} onClick={() => setSelDay(sel ? null : key)}
                  className={`min-h-[62px] rounded-md border p-1 text-left transition-colors ${c.inMonth ? 'bg-card' : 'bg-muted/30 text-muted-foreground'} ${sel ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted/40'}`}>
                  <div className={`text-[11px] font-semibold ${esHoy ? 'text-primary' : ''}`}>{c.date.getDate()}</div>
                  {b && (
                    <div className="mt-0.5 space-y-0.5">
                      <div className={`text-[10px] font-bold tabular-nums leading-tight ${b.vencidas ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}`}>{fmt0(b.total)}</div>
                      <div className="text-[9px] text-muted-foreground">{b.count} cobro{b.count !== 1 ? 's' : ''}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selDay && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="text-xs font-bold text-muted-foreground mb-2">Cobros del {formatDate(selDay)}</div>
              {itemsDelDia.length === 0 ? <p className="text-sm text-muted-foreground">Nada ese día.</p> : (
                <ul className="space-y-1.5">
                  {itemsDelDia.map(r => (
                    <li key={`${r.tipo}-${r.ref_id}`}>
                      <button onClick={() => navigate(`/leads/${r.lead_id}`)} className="w-full text-left flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/40">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{r.cliente} {r.cuota_numero ? <span className="text-[10px] font-bold text-primary">· Cuota {r.cuota_numero}</span> : ''}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{r.producto} · {r.proyecto_nombre}{r.gestora_nombre ? ` · ${r.gestora_nombre}` : ''}</div>
                        </div>
                        <span className={`tabular-nums font-bold text-sm ${r.vencido ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}`}>{fmt(r.importe)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : visibles.length === 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <EmptyState icon={CurrencyEur} title="Nada por cobrar" description="No hay cobros pendientes con estos filtros." />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Concepto</th>
                  <th className="text-left px-4 py-2.5 font-bold">Proyecto</th>
                  <th className="text-left px-4 py-2.5 font-bold">Gestora</th>
                  <th className="text-right px-4 py-2.5 font-bold">Pendiente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Vence</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(r => (
                  <tr key={`${r.tipo}-${r.ref_id}`} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/leads/${r.lead_id}`)}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.cliente}</div>
                      <div className="text-xs text-muted-foreground">{r.cliente_email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.producto}
                      {r.cuota_numero ? <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Cuota {r.cuota_numero}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.proyecto_nombre}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.gestora_nombre || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-orange-600 dark:text-orange-400">{fmt(r.importe)}</td>
                    <td className="px-4 py-3">
                      {r.vence ? (
                        <span className={r.vencido ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                          {r.vencido && <WarningCircle size={12} weight="fill" className="inline mr-1" />}
                          {formatDate(r.vence)}
                        </span>
                      ) : <span className="text-muted-foreground">Sin fecha</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-border">
            {visibles.map(r => (
              <button key={`${r.tipo}-${r.ref_id}`} type="button" onClick={() => navigate(`/leads/${r.lead_id}`)} className="w-full text-left p-4 space-y-1.5 hover:bg-muted/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.cliente} {r.cuota_numero ? <span className="text-[10px] font-bold text-primary">· Cuota {r.cuota_numero}</span> : ''}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.producto} · {r.proyecto_nombre}</div>
                  </div>
                  <span className="tabular-nums font-bold text-orange-600 dark:text-orange-400 flex-shrink-0">{fmt(r.importe)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{r.gestora_nombre || '—'}</span>
                  {r.vence ? (
                    <span className={r.vencido ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}>
                      {r.vencido && <WarningCircle size={11} weight="fill" className="inline mr-0.5" />}Vence {formatDate(r.vence)}
                    </span>
                  ) : <span className="text-muted-foreground">Sin fecha</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
