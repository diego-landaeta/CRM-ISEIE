import { Info } from '@phosphor-icons/react';
import { frasesDelAviso, tituloDelAviso, type DatosDelAviso } from '../lib/avisoCuotas';

/*
  El recuadro «cómo se cobra» de un plan en cuotas (Diego, 24/11/2026: «que salga
  sí o sí»). Siempre visible mientras haya cuotas, antes de «Crear link» o de
  «Registrar conversión», con las cifras reales del plan. Las frases, en
  `lib/avisoCuotas.ts`.
*/
export default function AvisoComoSeCobra({ datos, className = '' }: { datos: DatosDelAviso; className?: string }) {
  return (
    <div role="note" aria-label="Cómo se cobra" data-testid="aviso-como-se-cobra" data-recorrido="aviso-como-se-cobra"
      className={`flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm text-foreground ${className}`}>
      <Info size={16} weight="fill" className="mt-0.5 flex-shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">{tituloDelAviso(datos)}</p>
        <p className="text-xs leading-relaxed">{frasesDelAviso(datos).join(' ')}</p>
      </div>
    </div>
  );
}
