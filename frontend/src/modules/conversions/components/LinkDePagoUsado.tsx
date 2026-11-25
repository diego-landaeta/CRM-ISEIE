import { useEffect, useState } from 'react';
import { CheckCircle, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';
import { buscarCobro, pareceDeStripe, acortarReferencia, ES_BUENO, type CobroDeLaReferencia } from '../api/linkUsado.api';

/*
  «LINK DE PAGO USADO» EN LA VENTA (CRM-ISEIE#762, gemela de CRM#1107; Diego, 24/11/2026).

  La inicial ya se pagó con otro link de pago o con Stripe. La gestora pega el
  link (https://buy.stripe.com/…) o el id del cobro (plink_, cs_, pi_ o ch_) y, al
  registrar la venta, el CRM lo busca en Stripe con la clave del campus y une ese
  cobro al pago inicial de la venta, aunque el alumno pagara con otro correo.

  «Buscar en Stripe» dice antes lo que va a pasar, sin unir nada:
    · lo encuentra: importe, fecha y con qué correo pagó;
    · ya está unido a otra venta: no se moverá (y esa venta y esta contarían lo
      mismo dos veces: hay que mirarlo);
    · el importe no es el de la inicial, o hay varios cobros: no se unirá;
    · no lo encuentra: se guarda como referencia, como hasta ahora.
  Se guarda igual en la referencia del pago inicial (`referencia_pago_inicial`).
*/

interface Props {
  projectId: number;
  /** Lo que pagó de inicial (para elegir el cobro y avisar si no cuadra). */
  importe: number;
  value: string;
  onChange: (v: string) => void;
}

export default function LinkDePagoUsado({ projectId, importe, value, onChange }: Props) {
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<CobroDeLaReferencia | null>(null);
  // Lo encontrado vale para lo que se buscó: si cambia el texto o el importe, se vuelve a buscar.
  useEffect(() => { setResultado(null); }, [value, importe]);

  const deStripe = pareceDeStripe(value);

  async function buscar() {
    if (!deStripe || !projectId) return;
    setBuscando(true);
    try {
      const r = await buscarCobro(projectId, value, importe);
      setResultado(r.data || null);
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      setResultado({ estado: 'error', mensaje: err?.data?.error || err?.message || 'No se ha podido buscar en Stripe.' });
    } finally { setBuscando(false); }
  }

  const bueno = resultado ? ES_BUENO.includes(resultado.estado) : false;

  return (
    <div className="space-y-1.5" data-recorrido="venta-link-usado">
      <Field label="Link de pago usado (opcional)" htmlFor="venta-ref-inicial"
        hint="El link de buy.stripe.com o el id del cobro (plink_, cs_, pi_, ch_). Al registrar, el CRM une ese cobro a esta venta aunque pagara con otro correo.">
        <div className="flex gap-2">
          <input id="venta-ref-inicial" autoComplete="off" value={value} onChange={(e) => onChange(acortarReferencia(e.target.value))} maxLength={500}
            placeholder="https://buy.stripe.com/…" className={inputClass} />
          <button type="button" onClick={buscar} disabled={!deStripe || buscando || !projectId}
            className="inline-flex items-center gap-1 h-10 px-3 rounded-md border border-border bg-card text-sm font-medium whitespace-nowrap hover:bg-muted disabled:opacity-50">
            <MagnifyingGlass size={14} weight="bold" aria-hidden="true" /> {buscando ? 'Buscando…' : 'Buscar en Stripe'}
          </button>
        </div>
      </Field>
      {resultado && (
        <p role="status" data-testid="link-usado-resultado"
          className={`flex items-start gap-1.5 text-[11px] leading-snug rounded-md px-2.5 py-1.5 ${bueno
            ? 'bg-success-soft text-success-soft-foreground' : 'bg-warning-soft text-warning-soft-foreground'}`}>
          {bueno
            ? <CheckCircle size={14} weight="fill" className="mt-px flex-shrink-0" aria-hidden="true" />
            : <WarningCircle size={14} weight="fill" className="mt-px flex-shrink-0" aria-hidden="true" />}
          <span>{resultado.mensaje}</span>
        </p>
      )}
    </div>
  );
}
