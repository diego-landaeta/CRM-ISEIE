import { Flask } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

/*
  Lo que todavía se está probando (#679/#681): de momento, el plugin del CRM en Moodle
  (Integraciones); después, «Mi campus» y corregir desde el CRM. Se dice en la propia
  pantalla, no solo en el menú, para que quien la usa sepa que puede cambiar y que
  conviene avisar si algo no cuadra. Es compartido (shared/components/ui) porque lo usan
  pantallas de varios módulos.
*/

/** La etiqueta corta, para cabeceras con poco sitio. */
export function EtiquetaEnPruebas({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border border-info/30 bg-info-soft px-2 py-0.5 text-tabla font-medium text-info-soft-foreground', className)}>
      <Flask size={11} weight="bold" aria-hidden /> En pruebas
    </span>
  );
}

/** El aviso entero, debajo de la cabecera de la sección. */
export default function AvisoEnPruebas({ que = 'Esta sección' }: { que?: string }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-secundario text-info-soft-foreground">
      <Flask size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
      <span><strong className="font-semibold">En pruebas.</strong> {que} todavía se está probando: puede cambiar. Si ves algo que no cuadra, díselo a coordinación.</span>
    </p>
  );
}
