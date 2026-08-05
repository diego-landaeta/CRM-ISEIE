import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { GlobeHemisphereWest, Warning } from '@phosphor-icons/react';
import client from '@/shared/api/client';

// De dónde compran. El país sale del prefijo del teléfono, no de pais_fiscal:
// ese campo tiene 'España' por defecto en casi todos los registros y daría un
// 99% España con teléfonos latinoamericanos.
//
// Los que no tienen teléfono NO se esconden ni se reparten entre los demás:
// salen aparte, con su nombre, porque son trabajo pendiente de clasificar y
// taparlos haría creer que el mapa está completo.

const CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
const OSCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const GRIS = { claro: '#8a8a8a', oscuro: '#9a9a9a' };

const SIN_TELEFONO = '— sin teléfono —';

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

function Aviso({ activo, payload }) {
  if (!activo || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg">
      <div className="font-semibold text-foreground">{d.nombre}</div>
      <div className="text-muted-foreground tabular-nums">
        {eur(d.vendido)} · {num(d.ventas)} {d.ventas === 1 ? 'venta' : 'ventas'}
      </div>
      <div className="text-muted-foreground tabular-nums">
        {num(d.leads)} leads · {d.tasa}% de cierre
      </div>
    </div>
  );
}

export default function VentasPorPais({ projectId = null, from = null, to = null, responsableId = null, top = 8 }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [todos, setTodos] = useState(false);
  const [oscuro, setOscuro] = useState(usaTemaOscuro);

  useEffect(() => {
    const obs = new MutationObserver(() => setOscuro(usaTemaOscuro()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError(null);
    const params = {};
    if (projectId) params.projectId = projectId;
    if (from && to) { params.from = from; params.to = to; }
    if (responsableId) params.responsableId = responsableId;
    client.get('/sales/paises', { params })
      .then((r) => { if (vivo) setFilas(r.success ? (r.data || []) : []); })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudieron cargar los países'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, from, to, responsableId]);

  const { conPais, sinTelefono, total } = useMemo(() => {
    const limpias = filas.map((f) => ({
      nombre: f.pais === SIN_TELEFONO ? 'Sin teléfono · por clasificar' : (f.pais || 'Sin identificar'),
      sinTel: f.pais === SIN_TELEFONO || !f.pais,
      ventas: Number(f.ventas) || 0,
      clientes: Number(f.clientes) || 0,
      leads: Number(f.leads) || 0,
      vendido: Number(f.vendido) || 0,
      cobrado: Number(f.cobrado) || 0,
      tasa: Number(f.tasa_conversion) || 0,
    }));
    return {
      conPais: limpias.filter((f) => !f.sinTel),
      sinTelefono: limpias.find((f) => f.sinTel) || null,
      total: limpias.reduce((a, f) => a + f.vendido, 0),
    };
  }, [filas]);

  if (cargando) return <div className="bg-card border border-border rounded-lg p-6 h-[360px] animate-pulse" />;
  if (error) {
    return <div className="bg-card border border-border rounded-lg p-6 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!conPais.length && !sinTelefono) return null;

  const grafica = conPais.slice(0, top);
  const tabla = todos ? conPais : conPais.slice(0, top);
  const colores = oscuro ? OSCURO : CLARO;
  const rejilla = oscuro ? '#ffffff14' : '#0000000f';
  const tinta = oscuro ? '#9a9a9a' : '#6b6b6b';

  return (
    <div className="bg-card border border-border rounded-lg p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <GlobeHemisphereWest size={18} weight="duotone" className="text-muted-foreground" />
          <div>
            <h3 className="text-base font-bold">De dónde compran</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              País deducido del prefijo del teléfono · {conPais.length} países
            </p>
          </div>
        </div>
        {conPais.length > top && (
          <button type="button" onClick={() => setTodos((x) => !x)}
            className="h-7 px-2.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
            {todos ? `Ver solo el top ${top}` : `Ver los ${conPais.length}`}
          </button>
        )}
      </div>

      {grafica.length > 0 && (
        <div className="h-[220px] -ml-2 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={grafica} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={rejilla} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: tinta }} axisLine={false} tickLine={false}
                tickFormatter={eur} />
              <YAxis type="category" dataKey="nombre" width={124}
                tick={{ fontSize: 11, fill: tinta }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: rejilla }} content={(p) => <Aviso activo={p.active} payload={p.payload} />} />
              <Bar dataKey="vendido" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                {grafica.map((d, i) => <Cell key={d.nombre} fill={colores[i % colores.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left font-semibold py-1.5 pr-2">País</th>
              <th className="text-right font-semibold py-1.5 px-2">Leads</th>
              <th className="text-right font-semibold py-1.5 px-2">Ventas</th>
              <th className="text-right font-semibold py-1.5 px-2">Cierre</th>
              <th className="text-right font-semibold py-1.5 px-2">Vendido</th>
              <th className="text-right font-semibold py-1.5 pl-2">Cobrado</th>
            </tr>
          </thead>
          <tbody>
            {tabla.map((f, i) => (
              <tr key={f.nombre} className="border-b border-border/50 last:border-0">
                <td className="py-1.5 pr-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                    style={{ background: i < top ? colores[i % colores.length] : 'transparent' }} />
                  <span className="align-middle">{f.nombre}</span>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{num(f.leads)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{num(f.ventas)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{f.tasa}%</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{eur(f.vendido)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-muted-foreground">{eur(f.cobrado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sinTelefono && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2.5">
          <Warning size={15} weight="fill" className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 dark:text-amber-300">
            <strong>{num(sinTelefono.ventas)} ventas ({eur(sinTelefono.vendido)})</strong> sin teléfono, así que no
            se les puede asignar país. Son{' '}
            <strong>{total ? Math.round((sinTelefono.vendido / total) * 100) : 0}%</strong> de lo vendido:
            hasta clasificarlas, el reparto de arriba se queda corto.
          </div>
        </div>
      )}
    </div>
  );
}
