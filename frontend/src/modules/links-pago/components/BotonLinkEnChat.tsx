import { useState } from 'react';
import { LinkSimple } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import CrearLinkAsistente from './CrearLinkAsistente';

/*
  «ENVIAR LINK DE PAGO» EN EL CHAT DE WHATSAPP (CRM#983; Diego, 21/11/2026).

  En la barra del chat, junto a «Plantillas»: abre el asistente sencillo (curso,
  pago único o cuotas) con el prospecto de la conversación, y al crearlo «Enviar
  en este chat» lo manda ahí con su mensaje (saludo, curso, importe y
  caducidad). El link queda en la ficha y en «Links de pago», como los demás.
  Solo en una conversación con prospecto y para quien crea links.
*/
export default function BotonLinkEnChat({ leadId, conversacionId, usuarioId, className, onEnviado }: {
  leadId: number | null | undefined;
  conversacionId: number | null | undefined;
  usuarioId?: number | null;
  className?: string;
  onEnviado?: () => void;
}) {
  const { can } = usePermission();
  const encendidos = useLinksPagoEncendidos();
  const [abierto, setAbierto] = useState(false);
  if (!encendidos || !can('links_pago.crear') || !leadId || !conversacionId) return null;
  return (
    <>
      <button type="button" className={className || 'wa-btn-plantillas'} onClick={() => setAbierto(true)}
        aria-label="Enviar link de pago" title="Crear un link de pago y mandarlo en este chat">
        <LinkSimple size={15} />
        <span>Link de pago</span>
      </button>
      {abierto && (
        <CrearLinkAsistente leadId={leadId} conversacionId={conversacionId} usuarioId={usuarioId}
          onClose={() => setAbierto(false)} onEnviado={() => { onEnviado?.(); }} />
      )}
    </>
  );
}
