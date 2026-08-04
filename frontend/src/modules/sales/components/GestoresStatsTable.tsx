import { useEffect, useState } from 'react';
import { Users, PencilSimple, X, Check } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface GestorRow {
  user_id: number;
  nombre: string;
  email: string;
  role: string;
  is_available: boolean;
  ventas: number;
  facturado: number;
  cobrado: number;
  meta_ventas: number | null;
  meta_facturacion: number | null;
  meta_set_by?: string | null;
  progreso_ventas_pct: number | null;
  progreso_facturacion_pct: number | null;
}

interface Props {
  projectId?: number | null;
  className?: string;
  /** Si false, no muestra columna de acciones (modo solo lectura) */
  canEdit?: boolean;
  /** Mes (YYYY-MM) que manda desde la pantalla. */
  periodo?: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function currentPeriodo() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function GestoresStatsTable({ projectId, className = '', canEdit = true, periodo: periodoProp }: Props) {
  const [rows, setRows] = useState<GestorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVentas, setEditVentas] = useState('');
  const [editFact, setEditFact] = useState('');
  const [saving, setSaving] = useState(false);
  // El mes que diga el filtro de arriba; si no viene, el actual.
  const periodo = periodoProp || currentPeriodo();

  function load() {
    setLoading(true);
    const params: Record<string, string | number> = {};
    if (projectId) params.projectId = projectId;
    // El periodo NO se enviaba: la tabla pedia siempre el valor por defecto del
    // backend y salia todo a cero aunque arriba se estuviera mirando el año.
    if (periodo) params.periodo = periodo;
    client.get<{ gestores: GestorRow[] }>('/sales/gestores-stats', { params })
      .then((r) => { setRows(r?.data?.gestores || []); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [projectId, periodo]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(row: GestorRow) {
    setEditingId(row.user_id);
    setEditVentas(String(row.meta_ventas ?? ''));
    setEditFact(String(row.meta_facturacion ?? ''));
  }

  async function saveEdit(row: GestorRow) {
    setSaving(true);
    try {
      await client.post('/sales/goals', {
        user_id: row.user_id,
        project_id: projectId || null,
        periodo_yyyymm: periodo,
        meta_ventas: Number(editVentas) || 0,
        meta_facturacion: Number(editFact) || 0,
      });
      toast({ title: `Meta actualizada para ${row.nombre}` });
      setEditingId(null);
      load();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users size={16} weight="duotone" className="text-blue-600" />
          Equipo de ventas — {periodo === 'all' ? 'histórico' : periodo}
        </h3>
        <span className="text-[11px] text-muted-foreground">{rows.length} {rows.length === 1 ? 'gestor' : 'gestores'}</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-10 bg-muted/40 rounded animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No hay gestores activos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2 font-medium">Gestor</th>
                <th className="text-right py-2 font-medium">Ventas / Meta</th>
                <th className="text-right py-2 font-medium">Facturado / Meta</th>
                <th className="text-right py-2 font-medium">Cobrado</th>
                {canEdit && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isEditing = editingId === r.user_id;
                const pctV = r.progreso_ventas_pct ?? 0;
                const pctF = r.progreso_facturacion_pct ?? 0;
                return (
                  <tr key={r.user_id} className="border-b last:border-0 border-border">
                    <td className="py-2.5 pr-2">
                      <p className="font-medium text-[13px] truncate" title={r.email}>{r.nombre}</p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        <span className="capitalize">{r.role}</span>
                        {!r.is_available && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">No recibe leads</span>}
                      </p>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {isEditing ? (
                        <input type="number" min="0" value={editVentas} onChange={(e) => setEditVentas(e.target.value)}
                          className="w-20 h-8 px-2 rounded border border-border bg-card text-right text-sm" />
                      ) : (
                        <>
                          <span className="font-semibold">{r.ventas}</span>
                          <span className="text-muted-foreground"> / {r.meta_ventas ?? '—'}</span>
                          {r.meta_ventas != null && r.meta_ventas > 0 && (
                            <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden ml-auto" style={{ maxWidth: 100 }}>
                              <div className={`h-full ${pctV >= 100 ? 'bg-emerald-500' : pctV >= 50 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pctV}%` }} />
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {isEditing ? (
                        <input type="number" min="0" step="0.01" value={editFact} onChange={(e) => setEditFact(e.target.value)}
                          className="w-24 h-8 px-2 rounded border border-border bg-card text-right text-sm" />
                      ) : (
                        <>
                          <span className="font-semibold">{fmt(r.facturado)}</span>
                          <span className="text-muted-foreground text-xs block">{r.meta_facturacion != null ? `meta ${fmt(r.meta_facturacion)}` : 'sin meta'}</span>
                          {r.meta_facturacion != null && r.meta_facturacion > 0 && (
                            <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden ml-auto" style={{ maxWidth: 100 }}>
                              <div className={`h-full ${pctF >= 100 ? 'bg-emerald-500' : pctF >= 50 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pctF}%` }} />
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-green-600">{fmt(r.cobrado)}</td>
                    {canEdit && (
                      <td className="py-2.5 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setEditingId(null)} disabled={saving} className="p-1.5 rounded hover:bg-muted text-muted-foreground"><X size={14} /></button>
                            <button onClick={() => saveEdit(r)} disabled={saving} className="p-1.5 rounded hover:bg-emerald-100 text-emerald-600"><Check size={14} weight="bold" /></button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(r)} title="Establecer meta" className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary">
                            <PencilSimple size={13} />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
