import { lazy, Suspense, useState } from 'react';
import { LinkSimple, CalendarCheck } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';

const CrearLinkAsistente = lazy(() => import('./CrearLinkAsistente'));
const PlanDePagoDialog = lazy(() => import('./PlanDePagoDialog'));

/*
  «Crear link de pago» y «Generar plan de pago» en cada venta (Diego, 19/11/2026:
  «ni en Ventas algo como crear enlace o generar plan de pago»). Va en la fila de
  la lista de Ventas y en la cabecera de la ficha de la venta. Solo con los links
  encendidos y el permiso de crearlos; una venta ya cobrada entera no los enseña.
*/
export default function AccionesCobroVenta({ leadId, conversionId, pendiente, compacto = false, soloPlan = false }: {
  leadId?: number | null;
  conversionId: number;
  /** Lo que queda por cobrar; 0 = cobrada entera (no se enseñan). Sin dato, se enseñan. */
  pendiente?: number | null;
  compacto?: boolean;
  /** Solo «Generar plan de pago» (donde «Crear link de pago» ya está al lado). */
  soloPlan?: boolean;
}) {
  const { can } = usePermission();
  const encendidos = useLinksPagoEncendidos();
  const [abierto, setAbierto] = useState<'link' | 'plan' | null>(null);
  if (!encendidos || !can('links_pago.crear') || !conversionId) return null;
  if (pendiente != null && Number(pendiente) <= 0) return null;

  const clase = compacto
    ? 'inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-card text-[11px] font-medium hover:bg-muted hover:text-primary'
    : 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted';
  const parar = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span className="inline-flex gap-1.5" onClick={parar}>
      {!soloPlan && <button type="button" className={clase} data-recorrido="ventas-crear-link" title="Crear un link de pago para esta venta"
        onClick={(e) => { e.stopPropagation(); setAbierto('link'); }}>
        <LinkSimple size={compacto ? 12 : 15} weight="bold" aria-hidden="true" /> {compacto ? 'Link' : 'Crear link de pago'}
      </button>}
      <button type="button" className={clase} data-recorrido="ventas-plan-pago" title="Un link de pago por cada cuota pendiente"
        onClick={(e) => { e.stopPropagation(); setAbierto('plan'); }}>
        <CalendarCheck size={compacto ? 12 : 15} weight="bold" aria-hidden="true" /> {compacto ? 'Plan' : 'Generar plan de pago'}
      </button>
      <Suspense fallback={null}>
        {abierto === 'link' && (
          <CrearLinkAsistente leadId={leadId ?? undefined} conversionId={conversionId} onClose={() => setAbierto(null)}
            onCreado={(l) => window.dispatchEvent(new CustomEvent('links-pago:creado', { detail: l }))} />
        )}
        {abierto === 'plan' && <PlanDePagoDialog conversionId={conversionId} onClose={() => setAbierto(null)} />}
      </Suspense>
    </span>
  );
}
