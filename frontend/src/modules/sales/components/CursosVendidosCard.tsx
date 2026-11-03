import { useEffect, useMemo, useState } from 'react';
import { GraduationCap } from '@phosphor-icons/react';
import client from '@/shared/api/client';

interface Row {
  product_id: number | null;
  producto: string;
  ventas: number;
  facturado: number;
  cobrado?: number;
  ultima_venta?: string | null;
}

/** Lo que suma la tarjeta: lo da el servidor, no la suma de las filas. */
interface Totales { ventas: number; facturado: number }
/** Los abonos del periodo, fuera de cada producto (#534). `facturado` es negativo. */
interface Rectificativas extends Totales {
  productos: Array<{ product_id: number | null; producto: string; facturado: number }>;
}
/** Ventas que aún no tienen ningún cobro (#225). */
interface SinCobro { ventas: number; importe: number }

interface Props {
  projectId?: number | null;
  issuerId?: number | null;
  responsableId?: number | null;
  className?: string;
  title?: string;
  /** Rango que manda desde la pantalla. Si viene, la tarjeta no pinta su
      propio selector: el periodo se elige una sola vez, arriba. */
  from?: string | null;
  to?: string | null;
  /** Qué cuenta la tarjeta.
      · 'ventas' (Ventas): las ventas con algún cobro —la regla de las tarjetas
        de arriba— y las que aún no tienen ninguno, aparte (#225).
      · 'facturado' (Dashboard): lo facturado, de la misma consulta que el
        bloque del equipo, para que las dos cifras sean la misma (#224). */
  medida?: 'ventas' | 'facturado';
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

// Las ventas de una gestora compartidas salen a medias (0,5): un decimal basta.
function fmtNum(n: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n || 0);
}

export default function CursosVendidosCard({ projectId, issuerId = null, responsableId = null, className = '', title, from: fromProp = null, to: toProp = null, medida = 'ventas' }: Props) {
  const mandaFuera = !!(fromProp && toProp);
  // Arranca en el mes: al entrar interesa como va el mes, no si se ha vendido
  // algo en las ultimas horas. Con 'hoy' la tarjeta salia en blanco casi
  // siempre y parecia que el CRM no traia datos.
  const [period, setPeriod] = useState<Period>('mes');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [totales, setTotales] = useState<Totales | null>(null);
  // Las ventas que no dicen qué programa. Antes la tarjeta las dejaba fuera de
  // su total sin decirlo: es la venta de 200 € que faltaba en ISEIE (#225).
  const [sinPrograma, setSinPrograma] = useState<Totales | null>(null);
  const [sinCobro, setSinCobro] = useState<SinCobro | null>(null);
  // LAS RECTIFICATIVAS, APARTE (#534). Restaban dentro de su producto y
  // dejaban filas como «Cuentoterapia −541,67 €»: ahora cada producto enseña
  // lo facturado y los abonos van en su fila. El total de arriba no cambia.
  const [rectificativas, setRectificativas] = useState<Rectificativas | null>(null);
  const [loading, setLoading] = useState(true);

  const propio = useMemo(() => rangeFor(period, customFrom, customTo), [period, customFrom, customTo]);
  const { from, to } = mandaFuera ? { from: fromProp as string, to: toProp as string } : propio;
  const customIncompleto = period === 'custom' && (!customFrom || !customTo);
  const esFacturado = medida === 'facturado';

  useEffect(() => {
    const limpiar = () => { setRows([]); setTotales(null); setSinPrograma(null); setSinCobro(null); setRectificativas(null); };
    if (customIncompleto) { limpiar(); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string | number> = { from, to };
    if (projectId) params.projectId = projectId;
    if (issuerId) params.issuerId = issuerId;
    if (responsableId) params.responsableId = responsableId;
    const peticion = esFacturado
      // LO FACTURADO (#224): la misma consulta que el bloque del equipo.
      ? client.get('/ventas/facturado', { params }).then((r: any) => {
        if (cancelled) return;
        const d = r?.success ? r.data : null;
        setRows(Array.isArray(d?.productos) ? d.productos : []);
        setTotales(d?.total || null);
        const sp = d?.sin_producto;
        setSinPrograma(sp && (sp.ventas > 0 || sp.facturado !== 0) ? sp : null);
        const re = d?.rectificativas;
        setRectificativas(re && Number(re.facturado) !== 0 ? re : null);
        setSinCobro(null);
      })
      // LAS VENTAS (#225): con algún cobro, como las tarjetas de arriba.
      : client.get('/ventas/top-products', { params: { ...params, limit: 100 } }).then((r: any) => {
        if (cancelled) return;
        setRows(Array.isArray(r?.data) ? r.data : []);
        setTotales(r?.totales ? { ventas: r.totales.ventas, facturado: r.totales.facturado } : null);
        const sa = r?.sinAsignar;
        setSinPrograma(sa && sa.ventas > 0 ? { ventas: sa.ventas, facturado: sa.facturado } : null);
        setSinCobro(r?.sinCobro && r.sinCobro.ventas > 0 ? r.sinCobro : null);
        setRectificativas(null);
      });
    peticion
      .catch(() => { if (!cancelled) limpiar(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, issuerId, responsableId, from, to, customIncompleto, esFacturado]);

  // En ISEIE todo lo que se vende son formaciones: se llaman cursos.
  const etiqueta = { singular: 'Curso', plural: 'Cursos' };

  // EL TOTAL LO DA EL SERVIDOR. Sumar las filas dejaba fuera las ventas sin
  // programa y, con un año entero, las que no cabían en el LIMIT. La suma de
  // las filas queda solo como red por si un servidor viejo no manda totales.
  const totalCursos = totales ? Number(totales.ventas) || 0
    : rows.reduce((s, r) => s + (r.ventas || 0), 0) + (sinPrograma?.ventas || 0);
  const totalImporte = totales ? Number(totales.facturado) || 0
    : rows.reduce((s, r) => s + Number(r.facturado || 0), 0) + Number(sinPrograma?.facturado || 0);
  const vacia = rows.length === 0 && !sinPrograma && !rectificativas;

  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <GraduationCap size={16} weight="duotone" className="text-primary" />
          {title || `${etiqueta.plural} vendidos`}
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
          <div className="text-3xl font-bold tabular-nums leading-none">{loading ? '—' : fmtNum(totalCursos)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {esFacturado
              ? (totalCursos === 1 ? 'venta facturada' : 'ventas facturadas')
              : (totalCursos === 1 ? `${etiqueta.singular.toLowerCase()} vendido` : `${etiqueta.plural.toLowerCase()} vendidos`)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{fmt(totalImporte)}</div>
          {/* Lo que dice la cifra, con su nombre: «facturado» solo cuando son
              facturas. Antes ponía «facturado» a lo vendido. */}
          <div className="text-[11px] text-muted-foreground">{esFacturado ? 'facturado' : 'vendido'}</div>
        </div>
      </div>

      {/* Las que aún no tienen ningún cobro, al lado y sin sumar (#225). Diego:
          «se enseñan aparte, como "ventas sin cobro (en proformas)"; cuando se
          cobran pasan a contar como venta». */}
      {!loading && sinCobro && (
        <p className="mb-3 px-1 text-[11px] text-muted-foreground">
          + <strong className="text-foreground tabular-nums">{fmtNum(sinCobro.ventas)}</strong>{' '}
          sin cobro · <span className="tabular-nums">{fmt(sinCobro.importe)}</span> (proformas):
          cuentan como venta cuando se cobran.
        </p>
      )}

      {customIncompleto ? (
        <p className="text-xs text-muted-foreground text-center py-3">Elige las dos fechas del rango.</p>
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />
          ))}
        </div>
      ) : vacia ? (
        <p className="text-xs text-muted-foreground text-center py-3">
          {esFacturado ? 'Nada facturado en este periodo.' : 'Sin cursos vendidos en este periodo.'}
        </p>
      ) : (
        <ul className="divide-y divide-border max-h-64 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={`${r.product_id ?? 'np'}-${i}`} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" title={r.producto}>{r.producto}</p>
                <p className="text-[11px] text-muted-foreground">
                  {esFacturado ? `facturado ${fmt(r.facturado)}` : `cobrado ${fmt(r.cobrado || 0)}`}
                </p>
              </div>
              <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-primary/10 text-primary text-xs font-bold tabular-nums">
                {fmtNum(r.ventas)}
              </span>
            </li>
          ))}
          {/* Dentro de la lista y del total: si no, la lista no suma lo que dice
              arriba. Es un agujero de registro y se dice como tal. */}
          {sinPrograma && (
            <li className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate text-warning-soft-foreground">Sin programa asignado</p>
                <p className="text-[11px] text-muted-foreground">
                  {esFacturado ? 'facturado' : 'vendido'} {fmt(sinPrograma.facturado)} · hay que atarlas a una formación del catálogo
                </p>
              </div>
              <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-warning-soft text-warning-soft-foreground text-xs font-bold tabular-nums">
                {fmtNum(sinPrograma.ventas)}
              </span>
            </li>
          )}
          {/* Los abonos, en su fila y dentro del total: la lista suma lo de
              arriba y ningún producto sale en negativo (#534). */}
          {rectificativas && (
            <li className="py-2 flex items-center gap-3"
              title={rectificativas.productos.map((x) => `${x.producto}: ${fmt(x.facturado)}`).join('\n')}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">Rectificativas (abonos)</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {fmt(rectificativas.facturado)} · {rectificativas.productos.map((x) => x.producto).join(', ')}
                </p>
              </div>
              <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-full bg-muted text-muted-foreground text-xs font-bold tabular-nums"
                aria-label={`${fmtNum(rectificativas.ventas)} ventas con abono`}>
                {fmtNum(rectificativas.ventas)}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
