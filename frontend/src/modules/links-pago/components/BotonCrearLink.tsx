import { useState } from 'react';
import { LinkSimple } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import CrearLinkAsistente from './CrearLinkAsistente';
import type { LinkDePago } from '../api/linksPago.api';

/*
  «Crear link de pago» en la CABECERA de la ficha del prospecto y de la venta
  (Diego, 19/11: la tarjeta de abajo no la encontraba nadie). Abre el mismo
  asistente que la pantalla «Links de pago», ya con el prospecto (y la venta)
  elegidos. Solo con los links encendidos y el permiso de crearlos.
*/
export default function BotonCrearLink({ leadId, conversionId, onCreado, className = '' }: {
  leadId?: number | null;
  conversionId?: number | null;
  onCreado?: (link: LinkDePago) => void;
  className?: string;
}) {
  const { can } = usePermission();
  const encendidos = useLinksPagoEncendidos();
  const [abierto, setAbierto] = useState(false);
  if (!encendidos || !can('links_pago.crear') || (!leadId && !conversionId)) return null;
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} data-recorrido="links-crear-cabecera"
        className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 ${className}`}>
        <LinkSimple size={15} weight="bold" aria-hidden="true" /> Crear link de pago
      </button>
      {abierto && (
        <CrearLinkAsistente leadId={leadId} conversionId={conversionId}
          onClose={() => setAbierto(false)}
          onCreado={(l) => {
            onCreado?.(l);
            // La tarjeta de la ficha se refresca sola al volver a pintarse.
            window.dispatchEvent(new CustomEvent('links-pago:creado', { detail: l }));
          }} />
      )}
    </>
  );
}
