import { useEffect, useMemo, useState } from 'react';
import { GraduationCap } from '@phosphor-icons/react';
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
  className?: string;
  title?: string;
  /** Rango que manda desde la pantalla. Si viene, la tarjeta no pinta su
      propio selector: el periodo se elige una sola vez, arriba. */
  from?: string | null;
  to?: string | null;
}

type Period = 'hoy' | 'semana' | 'mes' | 'custom';

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

// Fecha local en YYYY-MM-DD (sin usar toISOString para no desfasar por zona horaria).
function isoLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeFor(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = isoLocal(today);
  if (period === 'semana') {
    const dow = today.getDay();               // 0=Dom … 6=Sáb
    const sinceMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - sinceMonday);
    return { from: isoLocal(monday), to };
  }
  if (period === 'mes') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoLocal(first), to };
  }
  if (period === 'custom') {
    return { from: customFrom || to, to: customTo || to };
  }
  return { from: to, to }; // hoy
}

const PERIODS: ReadonlyArray<{ key: Period; label: string }> = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'custom', label: 'Personalizado' },
];

export default function CursosVendidosCard({ projectId, responsableId = null, className = '', title = 'Cursos vendidos', from: fromProp = null, to: toProp = null }: Props) {
  const mandaFuera = !!(fromProp && toProp);
  // Arranca en el mes: al entrar interesa como va el mes, no si se ha vendido
  // algo en las ultimas horas. Con 'hoy' la tarjeta salia en blanco casi
  // siempre y parecia que el CRM no traia datos.
  const [period, setPeriod] = useState<Period>('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const propio = useMemo(() => rangeFor(period, customFrom, customTo), [period, customFrom, customTo]);
  const { from, to } = mandaFuera ? { from: fromProp as string, to: toProp as string } : propio;
  const customIncompleto = period === 'custom' && (!customFrom || !customTo);

  useEffect(() => {
    if (customIncompleto) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string | number> = { from, to, limit: 100 };
    if (projectId) params.projectId = projectId;
    if (responsableId) params.responsableId = responsableId;
    client.get<Row[]>('/ventas/top-products', { params })
      .then((r) => { if (!cancelled) setRows(Array.isArray(r?.data) ? r.data : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, responsableId, from, to, customIncompleto]);

  const totalCursos = rows.reduce((s, r) => s + (r.ventas || 0), 0);
  const totalFacturado = rows.reduce((s, r) => s + Number(r.facturado || 0), 0);

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <GraduationCap size={16} weight="duotone" className="text-primary" />
          {title}
        </h3>
        {/* Si el periodo lo manda la pantalla, la tarjeta no pinta su propio
            selector: se elige una sola vez, arriba. */}
        <div className="flex flex-wrap gap-1" hidden={mandaFuera}>
          {!mandaFuera && PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`h-6 px-2 rounded text-[11px] font-medium transition ${
                period === p.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!mandaFuera && period === 'custom' && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)}
            className="h-8 px-2 rounded border border-border bg-background text-xs" />
          <span className="text-muted-foreground">→</span>
          <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)}
            className="h-8 px-2 rounded border border-border bg-background text-xs" />
        </div>
      )}

      {/* Resumen del periodo */}
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <div className="text-3xl font-bold tabular-nums leading-none">{loading ? '—' : totalCursos}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{totalCursos === 1 ? 'curso vendido' : 'cursos vendidos'}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{fmt(totalFacturado)}</div>
          <div className="text-[11px] text-muted-foreground">facturado</div>
        </div>
      </div>

      {customIncompleto ? (
        <p className="text-xs text-muted-foreground text-center py-3">Elige las dos fechas del rango.</p>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">Sin cursos vendidos en este periodo.</p>
      ) : (
        <ul className="divide-y divide-border max-h-64 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={`${r.product_id ?? 'np'}-${i}`} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" title={r.producto}>{r.producto}</p>
                <p className="text-[11px] text-muted-foreground">cobrado {fmt(r.cobrado)}</p>
              </div>
              <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-primary/10 text-primary text-xs font-bold tabular-nums">
                {r.ventas}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
