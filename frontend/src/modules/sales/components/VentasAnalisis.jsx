import { Link } from 'react-router-dom';
import { ChartLineUp, DownloadSimple } from '@phosphor-icons/react';
import PanelResumen from '@/shared/components/PanelResumen';
import AsesorasPanel from '@/shared/components/AsesorasPanel';
import RankingsPanel from '@/shared/components/RankingsPanel';

// Los mismos numeros que Analisis · Reportes, aqui abajo en Ventas: el equipo
// mira Ventas a diario y tenia que cambiar de seccion para ver como va el mes.
//
// El periodo NO se elige aqui: lo manda el filtro de arriba, el mismo que
// gobierna el resto de la pantalla. Y las descargas siguen viviendo en
// Reportes — desde aqui solo se enlaza.

export default function VentasAnalisis({ projectId, projectName, from, to, reportesUrl = '/reports' }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-6">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <ChartLineUp size={20} weight="duotone" className="text-primary" />
            Cómo va el periodo
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

      <PanelResumen projectId={projectId} projectName={projectName} from={from} to={to} />
      <AsesorasPanel from={from} to={to} />
      <RankingsPanel from={from} to={to} />
    </section>
  );
}
