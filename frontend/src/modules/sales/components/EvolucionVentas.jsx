import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { TrendUp, TrendDown, Minus } from '@phosphor-icons/react';
import client from '@/shared/api/client';

// Cómo va el periodo, contra el periodo justo anterior del mismo tamaño, y el
// año mes a mes debajo.
//
// Una sola magnitud por gráfica —nunca dos ejes—: se elige arriba qué se mira
// y las dos líneas (ahora y antes) comparten escala, que es la única forma de
// que la comparación signifique algo. Un eje con euros a la izquierda y tasa a
// la derecha deja dibujar la historia que uno quiera.
//
// La gestora ve esto también, pero recortado a lo suyo: el endpoint /sales/serie
// fuerza su responsableId en el servidor, no aquí.

const AHORA = { claro: '#2a78d6', oscuro: '#3987e5' };
const ANTES = { claro: '#8a8a8a', oscuro: '#9a9a9a' };

function usaTemaOscuro() {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

const eur = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(Number(n) || 0);
const num = (n) => new Intl.NumberFormat('es-ES').format(Number(n) || 0);
const pct = (n) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(n) || 0)}%`;

const MEDIDAS = [
  { clave: 'vendido', etiqueta: 'Vendido', fmt: eur },
  { clave: 'ventas', etiqueta: 'Ventas', fmt: num },
  { clave: 'cobrado', etiqueta: 'Cobrado', fmt: eur },
  { clave: 'leads', etiqueta: 'Leads', fmt: num },
  { clave: 'tasa', etiqueta: 'Tasa de cierre', fmt: pct },
];

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// 'YYYY-MM-DD' → '4 ago' · 'YYYY-MM' → 'ago'. Sin new Date(): esa cadena se
// interpreta como medianoche UTC y al oeste de Madrid retrocede un día.
function etiquetaPunto(p) {
  const t = String(p || '');
  const [, m, d] = t.split('-');
  if (!m) return t;
  const nombre = MES[Number(m) - 1] || m;
  return d ? `${Number(d)} ${nombre}` : nombre;
}

function Variacion({ v, invertir = false }) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  const plano = Math.abs(n) < 0.05;
  const bueno = invertir ? n < 0 : n > 0;
  const Icono = plano ? Minus : (n > 0 ? TrendUp : TrendDown);
  const color = plano ? 'text-muted-foreground'
    : bueno ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${color}`}>
      <Icono size={12} weight="bold" />
      {plano ? '=' : `${n > 0 ? '+' : ''}${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n)}%`}
    </span>
  );
}

function Aviso({ activo, payload, etiqueta, medida }) {
  if (!activo || !payload?.length) return null;
  const fila = payload[0]?.payload || {};
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg">
      <div className="font-semibold text-foreground mb-0.5">{etiqueta}</div>
      {payload.map((s) => (
        <div key={s.dataKey} className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
          {s.name}: <span className="text-foreground font-medium">{medida.fmt(s.value)}</span>
        </div>
      ))}
      {fila.etiquetaAnterior && (
        <div className="text-[10px] text-muted-foreground/70 mt-1">antes: {fila.etiquetaAnterior}</div>
      )}
    </div>
  );
}

export default function EvolucionVentas({ projectId = null, from = null, to = null, responsableId = null }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [medidaClave, setMedidaClave] = useState('vendido');
  const [oscuro, setOscuro] = useState(usaTemaOscuro);

  useEffect(() => {
    const observador = new MutationObserver(() => setOscuro(usaTemaOscuro()));
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    const params = {};
    if (projectId) params.projectId = projectId;
    if (from && to) { params.from = from; params.to = to; }
    if (responsableId) params.responsableId = responsableId;
    client.get('/ventas/serie', { params })
      .then((r) => { if (vivo) setDatos(r.success ? r.data : null); })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudo cargar la evolución'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, from, to, responsableId]);

  const medida = MEDIDAS.find((m) => m.clave === medidaClave) || MEDIDAS[0];

  // Los dos periodos se emparejan por posición, no por fecha: son rangos
  // distintos y jamás coincidirían las etiquetas. El día 1 de ahora se compara
  // con el día 1 de antes.
  const comparado = useMemo(() => {
    if (!datos?.serie) return [];
    const antes = datos.anterior || [];
    return datos.serie.map((p, i) => ({
      punto: p.punto,
      etiqueta: etiquetaPunto(p.punto),
      etiquetaAnterior: antes[i] ? etiquetaPunto(antes[i].punto) : null,
      ahora: p[medida.clave] ?? 0,
      antes: antes[i] ? (antes[i][medida.clave] ?? 0) : null,
    }));
  }, [datos, medida.clave]);

  const meses = useMemo(() => (datos?.meses || []).map((p) => ({
    punto: p.punto,
    etiqueta: etiquetaPunto(p.punto),
    valor: p[medida.clave] ?? 0,
  })), [datos, medida.clave]);

  const cAhora = oscuro ? AHORA.oscuro : AHORA.claro;
  const cAntes = oscuro ? ANTES.oscuro : ANTES.claro;
  const rejilla = oscuro ? '#ffffff14' : '#0000000f';
  const tinta = oscuro ? '#9a9a9a' : '#6b6b6b';

  if (cargando) {
    return <div className="bg-card border border-border rounded-lg p-6 h-[420px] animate-pulse" />;
  }
  if (error) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }
  if (!datos) return null;

  const t = datos.totales || {};
  const ta = datos.totalesAnterior || {};
  const v = datos.variacion || {};
  const sinNada = !t.ventas && !t.vendido && !t.leads;

  return (
    <div className="bg-card border border-border rounded-lg p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-bold">Evolución</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {datos.granularidad === 'mes' ? 'Por meses' : 'Por días'} · comparado con{' '}
            {datos.rangoAnterior?.from} → {datos.rangoAnterior?.to}
          </p>
        </div>
        {/* Elegir la magnitud en vez de apilar ejes: una gráfica, una escala. */}
        <div className="flex flex-wrap gap-1">
          {MEDIDAS.map((m) => (
            <button
              key={m.clave} type="button" onClick={() => setMedidaClave(m.clave)}
              aria-pressed={m.clave === medidaClave}
              className={`h-7 px-2.5 rounded-md text-xs font-semibold transition-colors ${
                m.clave === medidaClave
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {m.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* La comparación en números, para no tener que medirla a ojo en la línea. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        {MEDIDAS.map((m) => (
          <button
            key={m.clave} type="button" onClick={() => setMedidaClave(m.clave)}
            className={`text-left rounded-md border p-2.5 transition-colors ${
              m.clave === medidaClave ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40'
            }`}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{m.etiqueta}</div>
            <div className="text-lg font-bold tabular-nums mt-0.5">{m.fmt(t[m.clave])}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {/* La tasa varía en puntos, no en porcentaje sobre porcentaje. */}
              {m.clave === 'tasa'
                ? <span className={`text-xs font-semibold tabular-nums ${
                    Math.abs(v.tasa || 0) < 0.005 ? 'text-muted-foreground'
                      : (v.tasa > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')
                  }`}>
                    {v.tasa > 0 ? '+' : ''}{new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v.tasa || 0)} pts
                  </span>
                : <Variacion v={v[m.clave]} />}
              <span className="text-[11px] text-muted-foreground/70 tabular-nums">antes {m.fmt(ta[m.clave])}</span>
            </div>
          </button>
        ))}
      </div>

      {sinNada ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No hay ventas ni leads en este periodo. Prueba con un rango más amplio.
        </p>
      ) : (
        <>
          <div className="h-[220px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={comparado} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={rejilla} vertical={false} />
                <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: tinta }}
                  axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={{ fontSize: 11, fill: tinta }} axisLine={false} tickLine={false} width={56}
                  tickFormatter={(n) => medida.fmt(n)} />
                <Tooltip content={(p) => (
                  <Aviso activo={p.active} payload={p.payload}
                    etiqueta={p.label} medida={medida} />
                )} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: tinta }} />
                <Line type="monotone" dataKey="antes" name="Periodo anterior" stroke={cAntes}
                  strokeWidth={2} strokeDasharray="4 3" dot={false} activeDot={{ r: 4 }}
                  isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="ahora" name="Este periodo" stroke={cAhora}
                  strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2 }}
                  isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {meses.length > 1 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Mes a mes · {medida.etiqueta}
              </h4>
              <div className="h-[132px] -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={meses} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={rejilla} vertical={false} />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: tinta }}
                      axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: tinta }} axisLine={false} tickLine={false} width={56}
                      tickFormatter={(n) => medida.fmt(n)} />
                    <Tooltip content={(p) => (
                      <Aviso activo={p.active} payload={p.payload} etiqueta={p.label} medida={medida} />
                    )} />
                    <Bar dataKey="valor" name={medida.etiqueta} fill={cAhora} radius={[4, 4, 0, 0]}
                      maxBarSize={38} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
