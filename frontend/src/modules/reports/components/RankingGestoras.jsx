// El ranking del mes, dibujado.
//
// Diego, 23/09: «añade una gráfica en reportes y eso de esto». Debajo hay una
// tabla con once columnas que lo dice todo, pero once columnas no se leen de un
// vistazo: para saber quién va primero hay que recorrerlas con el dedo. Esto
// contesta esa pregunta y nada más; el detalle sigue estando en la tabla, que
// es además la vista accesible de lo mismo.
//
// UNA SOLA MAGNITUD POR GRÁFICA, como en «Evolución de ventas»: se elige arriba
// qué se mira y todas las barras comparten escala. Un eje con euros y otro con
// tasa a la derecha deja dibujar la historia que uno quiera.
//
// BARRAS HORIZONTALES y no verticales: los nombres son largos y en vertical
// salen girados o recortados. En horizontal se leen.

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts';
import { Trophy } from '@phosphor-icons/react';

// La misma paleta de gráficas que el resto del CRM. No se inventa una nueva:
// el azul de «Evolución de ventas» ya está en producción y en las dos webs.
const BARRA = { claro: '#2a78d6', oscuro: '#3987e5' };
// Quien va primero, del mismo tono pero más marcado. El color NO es lo único
// que lo distingue --lleva su copa al lado del nombre-- porque un tono más de
// azul no lo separa quien no ve bien el color.
const LIDER = { claro: '#0f4c96', oscuro: '#8fc0f7' };
const REJILLA = { claro: '#e6e6e6', oscuro: '#2d2d2d' };
const TEXTO = { claro: '#6b6b6b', oscuro: '#9a9a9a' };

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
const num = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(n) || 0);
const pct = (n) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(n) || 0)} %`;

const MEDIDAS = [
  { clave: 'ventas', etiqueta: 'Ventas', fmt: num },
  { clave: 'vendido', etiqueta: 'Vendido', fmt: eur },
  { clave: 'cobrado', etiqueta: 'Cobrado', fmt: eur },
  { clave: 'tasa', etiqueta: 'Tasa de cierre', fmt: pct },
];

/** El nombre, corto: «María Dolores Flores Romero» no cabe en el eje. */
function corto(nombre) {
  const partes = String(nombre || '—').trim().split(/\s+/);
  if (partes.length <= 2) return partes.join(' ');
  return `${partes[0]} ${partes[1]}`;
}

export default function RankingGestoras({ asesoras = [], mes }) {
  const [medida, setMedida] = useState('ventas');
  const oscuro = usaTemaOscuro();
  const m = MEDIDAS.find((x) => x.clave === medida) || MEDIDAS[0];

  const datos = useMemo(() => {
    const filas = (asesoras || []).map((a) => ({
      nombre: corto(a.asesora),
      completo: a.asesora || '—',
      ventas: Number(a.ventas || 0),
      vendido: Number(a.vendido || 0),
      cobrado: Number(a.cobrado || 0),
      tasa: Number(a.tasa_conversion || 0),
      leads: Number(a.leads || 0),
    }));
    // De mayor a menor por lo que se está mirando: un ranking desordenado no es
    // un ranking. Recharts pinta la primera fila arriba, que es lo que se quiere.
    return filas
      .filter((f) => f[medida] > 0)
      .sort((a, b) => b[medida] - a[medida]);
  }, [asesoras, medida]);

  // Sin nadie con ese dato no se dibuja un lienzo vacío: se dice.
  if (!datos.length) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
        Nadie tiene {m.etiqueta.toLowerCase()} este mes.
      </div>
    );
  }

  const tope = datos[0][medida];
  // Sitio para el nombre: con cinco letras sobra ancho, con veinte se recorta.
  const anchoEje = Math.min(150, Math.max(78, ...datos.map((d) => d.nombre.length * 7)));
  // La altura crece con la gente. 30 px por barra se lee sin apretarse.
  const alto = Math.max(140, datos.length * 30 + 28);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Trophy size={13} weight="duotone" className="text-primary" />
          Ranking del mes
        </span>
        {/* Qué se mira. Una sola magnitud cada vez. */}
        <div className="ml-auto inline-flex flex-wrap gap-1" role="group" aria-label="Qué se compara">
          {MEDIDAS.map((x) => (
            <button
              key={x.clave}
              type="button"
              onClick={() => setMedida(x.clave)}
              aria-pressed={medida === x.clave}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                medida === x.clave
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {x.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: '100%', height: alto }}>
        <ResponsiveContainer>
          <BarChart
            data={datos}
            layout="vertical"
            margin={{ top: 4, right: 62, left: 0, bottom: 4 }}
            barCategoryGap={8}
          >
            {/* La rejilla, discreta y solo en el eje que se mide. */}
            <CartesianGrid horizontal={false} stroke={oscuro ? REJILLA.oscuro : REJILLA.claro} />
            <XAxis
              type="number"
              tickFormatter={m.fmt}
              tick={{ fontSize: 10, fill: oscuro ? TEXTO.oscuro : TEXTO.claro }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="nombre"
              width={anchoEje}
              tick={{ fontSize: 11, fill: oscuro ? TEXTO.oscuro : TEXTO.claro }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: oscuro ? '#ffffff10' : '#00000008' }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: `1px solid ${oscuro ? REJILLA.oscuro : REJILLA.claro}`,
                background: oscuro ? '#1a1a1a' : '#ffffff',
                color: oscuro ? '#f0f0f0' : '#1a1a1a',
              }}
              formatter={(v) => [m.fmt(v), m.etiqueta]}
              labelFormatter={(_, carga) => carga?.[0]?.payload?.completo || ''}
            />
            <Bar dataKey={medida} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {datos.map((d, i) => (
                <Cell
                  key={d.completo}
                  fill={i === 0
                    ? (oscuro ? LIDER.oscuro : LIDER.claro)
                    : (oscuro ? BARRA.oscuro : BARRA.claro)}
                />
              ))}
              {/* El número al final de su barra: leerlo en el eje obliga a
                  estimar, y con cuatro personas eso ya se hace mal. */}
              <LabelList
                dataKey={medida}
                position="right"
                formatter={m.fmt}
                style={{ fontSize: 10, fill: oscuro ? TEXTO.oscuro : TEXTO.claro }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {datos[0].completo} va en cabeza con {m.fmt(tope)}
        {mes ? ` en ${mes}` : ''}. El detalle de cada una, en la tabla de abajo.
      </p>
    </div>
  );
}
