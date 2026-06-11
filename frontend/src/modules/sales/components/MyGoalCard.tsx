import { useEffect, useState } from 'react';
import { Target, PencilSimple, X, Check } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface MyStats {
  user_id: number;
  nombre?: string;
  ventas: number;
  facturado: number;
  cobrado: number;
  meta_ventas: number | null;
  meta_facturacion: number | null;
  meta_set_by?: string | null;
  meta_notas?: string | null;
  progreso_ventas_pct: number | null;
  progreso_facturacion_pct: number | null;
  periodo?: string;
}

interface Props {
  projectId?: number | null;
  className?: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function currentPeriodo() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MyGoalCard({ projectId, className = '' }: Props) {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [metaVentas, setMetaVentas] = useState('');
  const [metaFact, setMetaFact] = useState('');
  const [saving, setSaving] = useState(false);
  const periodo = currentPeriodo();

  function load() {
    setLoading(true);
    const params: Record<string, string | number> = {};
    if (projectId) params.projectId = projectId;
    client.get<MyStats>('/sales/my-stats', { params })
      .then((r) => { setStats(r?.data || null); })
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editing && stats) {
      setMetaVentas(String(stats.meta_ventas ?? ''));
      setMetaFact(String(stats.meta_facturacion ?? ''));
    }
  }, [editing, stats]);

  async function save() {
    if (!stats?.user_id) return;
    setSaving(true);
    try {
      await client.post('/sales/goals', {
        user_id: stats.user_id,
        project_id: projectId || null,
        periodo_yyyymm: periodo,
        meta_ventas: Number(metaVentas) || 0,
        meta_facturacion: Number(metaFact) || 0,
      });
      toast({ title: 'Meta actualizada' });
      setEditing(false);
      load();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className={`bg-card border border-border rounded-lg p-4 h-32 animate-pulse ${className}`} />;
  }
  if (!stats) return null;

  const hasMeta = stats.meta_ventas != null || stats.meta_facturacion != null;
  const pctV = stats.progreso_ventas_pct ?? 0;
  const pctF = stats.progreso_facturacion_pct ?? 0;

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Target size={16} weight="duotone" className="text-emerald-600" />
          Mi meta del mes
        </h3>
        <span className="text-[11px] text-muted-foreground">{periodo}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Ventas hechas</p>
          <p className="text-xl font-bold tabular-nums">{stats.ventas}{stats.meta_ventas != null && <span className="text-sm text-muted-foreground font-normal"> / {stats.meta_ventas}</span>}</p>
          {stats.meta_ventas != null && stats.meta_ventas > 0 && (
            <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${pctV >= 100 ? 'bg-emerald-500' : pctV >= 50 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pctV}%` }} />
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Facturado</p>
          <p className="text-xl font-bold tabular-nums">{fmt(stats.facturado)}{stats.meta_facturacion != null && <span className="text-sm text-muted-foreground font-normal"> / {fmt(stats.meta_facturacion)}</span>}</p>
          {stats.meta_facturacion != null && stats.meta_facturacion > 0 && (
            <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${pctF >= 100 ? 'bg-emerald-500' : pctF >= 50 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pctF}%` }} />
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0" placeholder="Meta ventas" value={metaVentas} onChange={(e) => setMetaVentas(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            <input type="number" min="0" step="0.01" placeholder="Meta facturación €" value={metaFact} onChange={(e) => setMetaFact(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} disabled={saving} className="h-8 px-3 rounded-md border border-border text-xs hover:bg-muted flex items-center gap-1">
              <X size={12} /> Cancelar
            </button>
            <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90 flex items-center gap-1">
              <Check size={12} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-[11px] text-muted-foreground">
            {hasMeta
              ? (stats.meta_set_by ? `Meta puesta por ${stats.meta_set_by}` : 'Meta personal')
              : 'Sin meta configurada para este mes'}
          </p>
          <button onClick={() => setEditing(true)} className="text-[11px] text-primary font-semibold hover:underline flex items-center gap-1">
            <PencilSimple size={11} weight="bold" /> {hasMeta ? 'Editar' : 'Poner meta'}
          </button>
        </div>
      )}
    </div>
  );
}
