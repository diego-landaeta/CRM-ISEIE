import { useCallback, useEffect, useState } from 'react';
import { CreditCard, CheckCircle, WarningCircle, ClockCountdown, ArrowSquareOut, Lightning } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import { verCobroAutomatico, cambiarCobroAutomatico, type CobroAutomatico, type CuotaCobroAuto } from '../api/linksPago.api';

/*
  COBRO AUTOMÁTICO DE LAS CUOTAS CON STRIPE (#680, 309; Diego, 19/11/2026).

  Lo que se ve de una venta con el cobro automático: la tarjeta que guardó el
  alumno (marca y cuatro cifras) y, cuota a cuota, qué tiene Stripe: si la cobrará
  sola y cuándo, si ya la cobró, si falló (y si hay reintento), o por qué no se
  puede programar. Va en el plan de pago y en la ficha de la venta.
*/

export function dinero(n: unknown) {
  return `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
export function fechaCorta(d: string | null | undefined) {
  if (!d) return 'sin fecha';
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
}

export function tarjetaTexto(t: CobroAutomatico['tarjeta']) {
  if (!t) return null;
  return `${t.marca ? `${t.marca.toUpperCase()} ` : ''}****${t.ultimos4 || '····'}${t.caduca ? ` (caduca ${t.caduca})` : ''}`;
}

const MOTIVOS: Record<string, string> = {
  insufficient_funds: 'sin saldo suficiente',
  authentication_required: 'el banco pide que el alumno confirme el pago',
  expired_card: 'tarjeta caducada',
  card_declined: 'el banco la ha rechazado',
  generic_decline: 'el banco la ha rechazado',
  lost_card: 'tarjeta bloqueada',
  stolen_card: 'tarjeta bloqueada',
};

/** Una línea por cuota: qué va a pasar con ella (o qué pasó). */
export function estadoDeCuota(c: CuotaCobroAuto, e: CobroAutomatico): { texto: string; tono: 'ok' | 'info' | 'warn' | 'bad' } {
  if (c.guarda_tarjeta) return { texto: 'La paga el alumno con su link y, al pagarla, guarda la tarjeta para las demás.', tono: 'info' };
  if (c.estado === 'cobrada') return { texto: 'Cobrada por Stripe.', tono: 'ok' };
  // CRM#1103: Stripe ya no la cobrará. Sigue pendiente: se cobra con un link.
  if (c.estado === 'cancelada') {
    return {
      texto: `Cobro automático cancelado en Stripe${c.cancelada_el ? ` el ${fechaCorta(c.cancelada_el)}` : ''}`
        + `${c.cancelada_motivo ? `: ${c.cancelada_motivo}` : '.'} Sigue pendiente: mándale un link de pago.`,
      tono: 'bad',
    };
  }
  if (c.estado === 'fallida') {
    const motivo = MOTIVOS[c.error_codigo || ''] || c.error_codigo || 'rechazada';
    return {
      texto: `Stripe no pudo cobrarla (${motivo}) · ${c.intentos} intento${c.intentos === 1 ? '' : 's'}. `
        + (c.reintento_el ? `Se reintenta una vez el ${fechaCorta(c.reintento_el)}.` : 'No se reintenta sola: el alumno tiene su link.'),
      tono: 'bad',
    };
  }
  if (c.problema) return { texto: `No se cobrará sola: ${c.problema}`, tono: 'warn' };
  if (!e.tarjeta) return { texto: 'Se programará en Stripe cuando el alumno guarde su tarjeta.', tono: 'info' };
  if (c.desfasada) return { texto: 'Cambio pendiente de pasar a Stripe (se hace solo en unos segundos).', tono: 'warn' };
  if (c.estado === 'programada') {
    return { texto: `Stripe la cobrará sola el ${fechaCorta(c.fecha_programada)} hacia las ${e.hora_de_cobro}:00 con ${tarjetaTexto(e.tarjeta)}.`, tono: 'ok' };
  }
  return { texto: 'Pendiente de programar en Stripe.', tono: 'info' };
}

const TONO = {
  ok: 'text-success-soft-foreground',
  info: 'text-muted-foreground',
  warn: 'text-warning-soft-foreground',
  bad: 'text-destructive',
};

export function CobroAutomaticoDetalle({ estado, onQuitar, quitando = false }: {
  estado: CobroAutomatico;
  onQuitar?: () => void;
  quitando?: boolean;
}) {
  const tarjeta = tarjetaTexto(estado.tarjeta);
  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-recorrido="cobro-automatico">
      <div className="flex flex-wrap items-center gap-2">
        <Lightning size={15} weight="fill" className="text-primary" aria-hidden="true" />
        <p className="text-sm font-semibold flex-1">Cobro automático con Stripe</p>
        {estado.activo
          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-soft-foreground"><CheckCircle size={13} weight="fill" aria-hidden="true" /> Activo</span>
          : estado.cancelado_en_stripe
            ? <span className="text-xs font-semibold text-destructive">Cancelado en Stripe</span>
            : <span className="text-xs font-semibold text-muted-foreground">Quitado</span>}
      </div>
      {!estado.activo && estado.cancelado_en_stripe && (
        <p role="alert" className="text-xs flex items-start gap-1.5 text-destructive">
          <WarningCircle size={13} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            Stripe dejó de cobrar las cuotas el {fechaCorta(estado.cancelado_en_stripe.el)}
            {estado.cancelado_en_stripe.motivo ? `: ${estado.cancelado_en_stripe.motivo}` : '.'} Las que quedaban siguen
            pendientes: mándale un link de pago de cada una desde el plan de cuotas.
          </span>
        </p>
      )}
      <p className="text-xs flex items-center gap-1.5">
        <CreditCard size={13} weight="bold" aria-hidden="true" />
        {tarjeta
          ? <span>Tarjeta guardada: <b>{tarjeta}</b></span>
          : <span className="text-muted-foreground">Sin tarjeta todavía: el alumno la guarda al pagar el link de la primera cuota.</span>}
      </p>
      {estado.sync_error && (
        <p role="alert" className="text-xs flex items-start gap-1.5 text-destructive">
          <WarningCircle size={13} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>Stripe no tiene el plan al día: {estado.sync_error} Se reintenta cada hora.</span>
        </p>
      )}
      {estado.cuotas.length > 0 && (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {estado.cuotas.map((c) => {
            const s = estadoDeCuota(c, estado);
            return (
              <li key={c.installment_id} className="py-1.5 text-xs">
                <p className="font-semibold">Cuota {c.numero} · {dinero(c.importe)} · vence el {fechaCorta(c.vence)}</p>
                <p className={`flex items-start gap-1 ${TONO[s.tono]}`}>
                  {s.tono === 'ok' ? <ClockCountdown size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : null}
                  <span>{s.texto}</span>
                  {c.url_pago && (
                    <a href={c.url_pago} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline">
                      link de pago <ArrowSquareOut size={11} aria-hidden="true" />
                    </a>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {estado.activo && onQuitar && (
        <button type="button" onClick={onQuitar} disabled={quitando} data-recorrido="cobro-automatico-quitar"
          className="h-8 px-2.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted disabled:opacity-50">
          {quitando ? 'Quitando…' : 'Quitar el cobro automático'}
        </button>
      )}
    </div>
  );
}

/**
 * La tarjeta de la ficha de la venta: solo si la venta tiene (o tuvo) cobro
 * automático. Se entera de los cambios del plan de pago por el evento
 * `links-pago:creado`.
 */
export default function CobroAutomaticoVenta({ conversionId }: { conversionId: number }) {
  const encendidos = useLinksPagoEncendidos();
  const { can } = usePermission();
  const [estado, setEstado] = useState<CobroAutomatico | null>(null);
  const [quitando, setQuitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const puedeVer = encendidos && (can('links_pago.crear') || can('links_pago.ver_todos'));

  const cargar = useCallback(() => {
    if (!puedeVer) return;
    verCobroAutomatico(conversionId).then((r) => setEstado(r.data || null)).catch(() => setEstado(null));
  }, [conversionId, puedeVer]);
  useEffect(() => {
    cargar();
    const alCambiar = () => cargar();
    window.addEventListener('links-pago:creado', alCambiar);
    return () => window.removeEventListener('links-pago:creado', alCambiar);
  }, [cargar]);

  if (!estado) return null;
  const tuvo = estado.activo || estado.cuotas.some((c) => c.estado);
  if (!tuvo) return null;

  async function quitar() {
    if (!confirm('¿Quitar el cobro automático? Stripe dejará de cobrar solas las cuotas de esta venta. La tarjeta se queda guardada por si se vuelve a activar.')) return;
    setQuitando(true);
    setError(null);
    try {
      const r = await cambiarCobroAutomatico(conversionId, false);
      setEstado(r.data || null);
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      setError(err?.data?.error || err?.message || 'Error de red');
    } finally { setQuitando(false); }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 lg:col-span-2">
      <CobroAutomaticoDetalle estado={estado} onQuitar={can('links_pago.cobro_automatico') ? quitar : undefined} quitando={quitando} />
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
