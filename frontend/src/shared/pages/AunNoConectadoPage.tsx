import { Link } from 'react-router-dom';
import { PlugsConnected, ChartLineUp } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';

/**
 * Lo que sale en las pantallas que todavía no tienen datos reales detrás:
 * Campañas (Consolidado, Google Ads) y Tráfico orgánico.
 *
 * Antes enseñaban datos de EJEMPLO (`USE_MOCKS = true`): 12.480 clics
 * inventados y una «Última actualización» que no existía, y en Campañas › Meta
 * «0 €» mientras Publicidad decía 1.681 € (#216, revisión del 03/10). Nunca
 * datos inventados: hasta que existan Google Ads (#54) y Search Console (#36),
 * se dice que no está conectado.
 */
export default function AunNoConectadoPage({ titulo }: { titulo: string }) {
  return (
    <div className="space-y-5 pb-8">
      <PageHeader title={titulo} />
      <EmptyState
        icon={PlugsConnected}
        title="Aún no conectado"
        description="Esta pantalla todavía no tiene datos reales detrás. El gasto y los resultados de Meta están en Publicidad."
        action={(
          <Link
            to="/meta-ads"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors"
          >
            <ChartLineUp size={14} weight="bold" /> Ir a Publicidad › Meta Ads
          </Link>
        )}
      />
    </div>
  );
}
