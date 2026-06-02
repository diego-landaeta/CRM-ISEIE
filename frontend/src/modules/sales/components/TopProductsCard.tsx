import { useEffect, useState } from 'react';
import { Trophy } from '@phosphor-icons/react';
import client from '@/shared/api/client';

interface Row {
  product_id: number | null;
  producto: string;
  ventas: number;
  facturado: number;
  cobrado: number;
  ultima_venta: string | null;
}

interface Props {
  projectId?: number | null;
  responsableId?: number | null;
  /** null = all-time, número = últimos N días */
  days?: number | null;
  limit?: number;
  title?: string;
  className?: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
}

export default function TopProductsCard({ projectId, responsableId = null, days = null, limit = 5, title = 'Programas más vendidos', className = '' }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string | number> = { limit };
    if (projectId) params.projectId = projectId;
    if (days) params.days = days;
    if (responsableId) params.responsableId = responsableId;
    client.get<Row[]>('/sales/top-products', { params })
      .then((r) => { if (!cancelled) setRows(Array.isArray(r?.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, responsableId, days, limit]);

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Trophy size={16} weight="duotone" className="text-amber-500" />
          {title}
        </h3>
        <span className="text-[11px] text-muted-foreground">{days ? `Últimos ${days}d` : 'Histórico'}</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted/40 rounded animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">Sin ventas registradas todavía.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={`${r.product_id ?? 'np'}-${i}`} className="py-2 flex items-center gap-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                i === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                : i === 1 ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                : i === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300'
                : 'bg-muted text-muted-foreground'
              }`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" title={r.producto}>{r.producto}</p>
                <p className="text-[11px] text-muted-foreground">{r.ventas} {r.ventas === 1 ? 'venta' : 'ventas'} · cobrado {fmt(r.cobrado)}</p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{fmt(r.facturado)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
