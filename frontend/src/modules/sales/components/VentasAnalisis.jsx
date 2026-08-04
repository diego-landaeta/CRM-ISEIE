import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartLineUp, DownloadSimple } from '@phosphor-icons/react';
import PanelResumen from '@/shared/components/PanelResumen';
import AsesorasPanel from '@/shared/components/AsesorasPanel';
import RankingsPanel from '@/shared/components/RankingsPanel';

// Los mismos números que Análisis · Reportes, aquí abajo en Ventas: el equipo
// mira Ventas a diario y tenía que cambiar de sección para ver cómo va el mes.
//
// No se duplica nada: son los mismos paneles que usa Reportes, así que si un
// número cambia allí cambia aquí. Y las descargas siguen viviendo en Reportes
// —no se repite el generador de ficheros—, desde aquí solo se enlaza.

const PERIODOS = {
  '30d': 'Últimos 30 días',
  '90d': 'Últimos 90 días',
  ytd: 'Año en curso',
  all: 'Todo 2026',
};

function rango(clave) {
  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (clave === 'ytd') return { from: `${hoy.getFullYear()}-01-01`, to: iso(hoy) };
  if (clave === 'all') return { from: '2026-01-01', to: iso(hoy) };
  const dias = clave === '90d' ? 90 : 30;
  return { from: iso(new Date(hoy.getTime() - dias * 86400000)), to: iso(hoy) };
}

export default function VentasAnalisis({ projectId, projectName, reportesUrl = '/reportes' }) {
  const [periodo, setPeriodo] = useState('ytd');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  // Las fechas a mano mandan sobre el botón de periodo.
  const r = desde && hasta ? { from: desde, to: hasta } : rango(periodo);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-6">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <ChartLineUp size={20} weight="duotone" className="text-primary" />
            Cómo va el mes
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Los mismos números de Análisis · Reportes. Pulsa cualquier cifra para ver los registros que hay detrás.
          </p>
        </div>
        <Link
          to={reportesUrl}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted"
        >
          <DownloadSimple size={15} weight="bold" />
          Descargar en Reportes
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(PERIODOS).map(([k, etiqueta]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setPeriodo(k); setDesde(''); setHasta(''); }}
            className={`h-8 px-3 rounded-md text-sm font-medium border transition-colors ${
              !desde && periodo === k
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border hover:bg-muted'
            }`}
          >
            {etiqueta}
          </button>
        ))}
        <span className="text-xs text-muted-foreground px-1">o entre fechas:</span>
        <input
          type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde"
          className="h-8 px-2 rounded-md border border-border bg-card text-sm"
        />
        <input
          type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta"
          className="h-8 px-2 rounded-md border border-border bg-card text-sm"
        />
        {(desde || hasta) && (
          <button
            type="button" onClick={() => { setDesde(''); setHasta(''); }}
            className="h-8 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted"
          >
            Quitar fechas
          </button>
        )}
      </div>

      <PanelResumen projectId={projectId} projectName={projectName} from={r.from} to={r.to} />
      <AsesorasPanel from={r.from} to={r.to} />
      <RankingsPanel from={r.from} to={r.to} />
    </section>
  );
}
