import { Link } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import { Ticket, Sparkle, ArrowRight } from '@phosphor-icons/react';
import { ETIQUETA_VERSION } from '@/shared/config/version';

/*
  Soporte. Aquí había una lista de novedades escrita a mano en abril
  («v0.1.0 · Beta inicial con polish profundo») que nadie actualizaba: con la
  3.0.0 en producción seguía diciendo 0.1.0 y «beta» (Diego, 25/11/2026). Lo
  nuevo de cada versión vive en Novedades; aquí, la versión y el enlace.
*/
export default function SoportePage() {
  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Soporte"
        subtitle="Ayuda, contacto y lo nuevo del CRM"
      />

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Ticket size={12} weight="regular" className="text-primary" />
        ¿Algo no funciona o tienes una idea? Usa el icono <strong className="text-foreground">flotante</strong> de la esquina inferior derecha para crear un ticket.
      </p>

      <Link
        to="/novedades"
        className="flex items-center gap-3 bg-card border border-border rounded-lg p-4 hover:border-primary/30 transition-colors"
      >
        <Sparkle size={18} weight="duotone" className="text-primary flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-sm">
            Novedades{ETIQUETA_VERSION ? ` de la ${ETIQUETA_VERSION}` : ''}
          </span>
          <span className="block text-xs text-muted-foreground">
            Lo nuevo y lo arreglado en cada versión del CRM.
          </span>
        </span>
        <ArrowRight size={14} weight="bold" className="text-muted-foreground flex-shrink-0" />
      </Link>
    </div>
  );
}
