import { useEffect, useState } from 'react';
import { Trophy } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { nombreDelRango } from '@/shared/lib/rangosDeFecha';

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
  /** Rango que manda desde la pantalla; tiene prioridad sobre days. */
  from?: string | null;
  to?: string | null;
  limit?: number;
  title?: string;
  className?: string;
  /** 'ventas' (por defecto): las ventas con algún cobro, como Ventas (#225).
      'facturado': lo facturado, como el resto del Dashboard (#224). */
  medida?: 'ventas' | 'facturado';
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

interface SinAsignar { ventas: number; facturado: number; cobrado?: number }
/** Ventas que aún no tienen ningún cobro (#225). */
interface SinCobro { ventas: number; importe: number }

// Fecha local AAAA-MM-DD, sin toISOString para no desfasar por zona horaria.
function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TopProductsCard({ projectId, responsableId = null, days = null, from = null, to = null, limit = 5, title = 'Programas más vendidos', className = '', medida = 'ventas' }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  // Las ventas que no dicen qué se vendió. Ya no compiten en el ranking, pero
  // tampoco se esconden: se enseñan debajo como lo que son, un agujero de
  // registro.
  const [sinAsignar, setSinAsignar] = useState<SinAsignar | null>(null);
  const [sinCobro, setSinCobro] = useState<SinCobro | null>(null);
  const [loading, setLoading] = useState(true);
  const esFacturado = medida === 'facturado';
  // Lo que enseña, dicho como es (#223): con un rango de la pantalla, ese
  // periodo («Este mes», «1–30 sep»); sin rango ni días, de verdad histórico.
  const periodo = (from && to ? nombreDelRango({ from, to }) : null)
    ?? (days ? `Últimos ${days}d` : 'Histórico');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string | number> = { limit };
    if (projectId) params.projectId = projectId;
    if (from && to) { params.from = from; params.to = to; } else if (days) params.days = days;
    if (responsableId) params.responsableId = responsableId;
    const peticion = esFacturado
      // LO FACTURADO (#224): el mismo endpoint que el bloque del equipo y que
      // «Productos vendidos». Los «últimos N días» se pasan a fechas.
      ? (() => {
        const fp: Record<string, string | number> = {};
        if (projectId) fp.projectId = projectId;
        if (params.issuerId) fp.issuerId = params.issuerId;
        if (responsableId) fp.responsableId = responsableId;
        if (from && to) { fp.from = from; fp.to = to; } else if (days) {
          const d = new Date(); d.setDate(d.getDate() - days);
          fp.from = isoLocal(d);
        }
        return client.get('/ventas/facturado', { params: fp }).then((r: any) => {
          if (cancelled) return;
          const d = r?.success ? r.data : null;
          setRows(Array.isArray(d?.productos) ? d.productos.slice(0, limit) : []);
          const sp = d?.sin_producto;
          setSinAsignar(sp && sp.ventas > 0 ? sp : null);
          setSinCobro(null);
        });
      })()
      : client.get<Row[]>('/ventas/top-products', { params })
        .then((r) => {
          if (cancelled) return;
          setRows(Array.isArray(r?.data) ? r.data : []);
          const sa = (r as unknown as { sinAsignar?: SinAsignar })?.sinAsignar;
          setSinAsignar(sa && sa.ventas > 0 ? sa : null);
          const sc = (r as unknown as { sinCobro?: SinCobro })?.sinCobro;
          setSinCobro(sc && sc.ventas > 0 ? sc : null);
        });
    peticion
      .catch(() => { if (!cancelled) { setRows([]); setSinAsignar(null); setSinCobro(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, responsableId, days, limit, from, to, esFacturado]);

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Trophy size={16} weight="duotone" className="text-amber-500" />
          {title}
        </h3>
        <span className="text-[11px] text-muted-foreground">{periodo}</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted/40 rounded animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 && !sinAsignar ? (
        <p className="text-xs text-muted-foreground text-center py-4">{from && to ? `Sin ventas en este periodo (${periodo}).` : 'Sin ventas registradas todavía.'}</p>
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
                <p className="text-[11px] text-muted-foreground">
                  {r.ventas} {esFacturado
                    ? (r.ventas === 1 ? 'venta facturada' : 'ventas facturadas')
                    : <>{r.ventas === 1 ? 'venta' : 'ventas'} · cobrado {fmt(r.cobrado)}</>}
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums">{fmt(r.facturado)}</span>
            </li>
          ))}
        </ul>
      )}

      {sinAsignar && (
        <p className="mt-3 pt-2.5 border-t border-border text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
          <strong>{sinAsignar.ventas}</strong>{' '}
          {sinAsignar.ventas === 1 ? 'venta no dice qué programa se vendió' : 'ventas no dicen qué programa se vendió'}
          {' '}({fmt(sinAsignar.facturado)}). No entran en este ranking porque «pendiente
          de registrar» no es un programa: hay que atarlas a una formación del catálogo
          para que cuenten.
        </p>
      )}

      {/* Las ventas sin ningún cobro no entran en el ranking —es la regla de
          Ventas— pero se dicen (#225): cuando se cobren, contarán. */}
      {sinCobro && (
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">{sinCobro.ventas}</strong>{' '}
          {sinCobro.ventas === 1 ? 'venta sin cobro' : 'ventas sin cobro'} ({fmt(sinCobro.importe)}, en proformas):
          entran en el ranking cuando se cobran.
        </p>
      )}
    </div>
  );
}
