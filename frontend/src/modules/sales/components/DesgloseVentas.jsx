import { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartPieSlice } from '@phosphor-icons/react';
import client from '@/shared/api/client';

// De qué se compone lo vendido, en dos repartos: qué se vende (máster, curso,
// diplomado, servicio) y de dónde viene el dinero (matrícula o cuota del plan).
//
// Los colores son una paleta categórica fija —siempre el mismo color para el
// mismo concepto, aunque el filtro cambie el orden—, validada para daltonismo
// y para los dos temas. Cada porción lleva además su etiqueta y su tabla
// debajo, así que la identidad nunca depende solo del color.

const CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#8a8a8a'];
const OSCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#9a9a9a'];

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

function Aviso({ activo, payload, total }) {
  if (!activo || !payload?.length) return null;
  const d = payload[0].payload;
  const pct = total ? Math.round((d.importe / total) * 1000) / 10 : 0;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg">
      <div className="font-semibold text-foreground">{d.tipo}</div>
      <div className="text-muted-foreground tabular-nums">
        {eur(d.importe)} · {pct}% · {d.n} {d.n === 1 ? 'venta' : 'ventas'}
      </div>
    </div>
  );
}

function Tarta({ titulo, datos, colores, campoN }) {
  const total = datos.reduce((a, d) => a + d.importe, 0);
  if (!datos.length || total === 0) {
    return (
      <div className="flex-1 min-w-[260px]">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">{titulo}</h4>
        <p className="text-xs text-muted-foreground/70 py-8 text-center">Sin datos en este periodo.</p>
      </div>
    );
  }
  return (
    <div className="flex-1 min-w-[260px]">
      <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">{titulo}</h4>
      <div className="h-[168px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={datos} dataKey="importe" nameKey="tipo"
              innerRadius={44} outerRadius={72} paddingAngle={2} stroke="none"
              isAnimationActive={false}
            >
              {datos.map((d, i) => <Cell key={d.tipo} fill={colores[i % colores.length]} />)}
            </Pie>
            <Tooltip content={(p) => <Aviso activo={p.active} payload={p.payload} total={total} />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* La tabla es la que manda: el color solo acompaña. */}
      <table className="w-full text-xs mt-1">
        <tbody>
          {datos.map((d, i) => (
            <tr key={d.tipo} className="border-t border-border/60">
              <td className="py-1 pr-2">
                <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                  style={{ background: colores[i % colores.length] }} />
                <span className="align-middle">{d.tipo}</span>
              </td>
              <td className="py-1 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                {d[campoN]} {campoN === 'n' ? '' : ''}
              </td>
              <td className="py-1 pl-3 text-right tabular-nums font-semibold whitespace-nowrap">{eur(d.importe)}</td>
              <td className="py-1 pl-2 text-right tabular-nums text-muted-foreground w-12">
                {Math.round((d.importe / total) * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DesgloseVentas({ projectId, from, to, responsableId = null }) {
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [oscuro, setOscuro] = useState(usaTemaOscuro);

  useEffect(() => {
    const ob = new MutationObserver(() => setOscuro(usaTemaOscuro()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    if (!projectId) return undefined;
    let vivo = true;
    setCargando(true);
    const p = new URLSearchParams({ projectId: String(projectId) });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (responsableId) p.set('responsableId', String(responsableId));
    client.get(`/sales/desglose?${p}`)
      .then((r) => { if (vivo) setData(r.success ? r.data : null); })
      .catch(() => { if (vivo) setData(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, from, to, responsableId]);

  const colores = oscuro ? OSCURO : CLARO;

  const formacion = useMemo(
    () => (data?.porFormacion || []).map((d) => ({ ...d, n: d.ventas })), [data]);
  const cobro = useMemo(
    () => (data?.porCobro || []).map((d) => ({ ...d, n: d.cobros })), [data]);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ChartPieSlice size={16} weight="duotone" className="text-primary" />
          De qué se compone
        </h3>
        {data?.totales ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {data.totales.ventas} ventas · {eur(data.totales.vendido)} vendido · ticket {eur(data.totales.ticket)}
          </span>
        ) : null}
      </div>

      {cargando ? (
        <p className="text-xs text-muted-foreground py-8 text-center">Cargando…</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          <Tarta titulo="Qué se vende" datos={formacion} colores={colores} campoN="n" />
          <Tarta titulo="De dónde viene el dinero que entró" datos={cobro} colores={colores} campoN="n" />
        </div>
      )}
    </div>
  );
}
