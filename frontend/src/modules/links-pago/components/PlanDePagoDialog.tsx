import { useEffect, useState } from 'react';
import { CalendarCheck, CheckCircle, Copy, ArrowSquareOut, WarningCircle, LinkSimple } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { generarPlan, verPlan, type PlanDePago } from '../api/linksPago.api';
import { copiarLink, errorDe } from './CrearLinkAsistente';

/*
  «GENERAR PLAN DE PAGO» (Diego, 19/11/2026).

  Desde una venta con plan de cuotas: un link de Stripe por cada cuota pendiente,
  con su importe y su fecha. Cuando el alumno paga el link de una cuota, el cobro
  entra en la venta y salda ESA cuota.

    · lista las cuotas pendientes, con el link que ya tenga cada una;
    · «Generar los links» crea los que faltan (las que ya tienen link vivo no se
      repiten) y deja cada uno con «Copiar» y «Abrir»;
    · «Copiar todos» pega en el portapapeles un mensaje con cada cuota, su fecha
      y su link, listo para mandarlo por WhatsApp o por correo;
    · sin plan de cuotas, lo dice y explica dónde se crea.
  El servidor lo vuelve a comprobar todo (campus, alcance, lo pendiente).
*/

function dinero(n: unknown) {
  return `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function fecha(d: string | null) {
  if (!d) return 'sin fecha';
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
}

export default function PlanDePagoDialog({ conversionId, onClose }: { conversionId: number; onClose: () => void }) {
  const [plan, setPlan] = useState<PlanDePago | null>(null);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    verPlan(conversionId)
      .then((r) => { if (vigente) setPlan(r.data || null); })
      .catch((e) => { if (vigente) setError(`No se ha podido cargar el plan: ${errorDe(e)}`); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [conversionId]);

  const cuotas = plan?.cuotas || [];
  const sinLink = cuotas.filter((c) => !c.link_id);
  const conLink = cuotas.filter((c) => c.link_url);

  async function generar() {
    setGenerando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await generarPlan(conversionId);
      if (r.data) {
        setPlan(r.data);
        const n = r.data.creados || 0;
        setAviso(n ? `${n} link${n === 1 ? '' : 's'} creado${n === 1 ? '' : 's'}. Copia el mensaje y mándaselo al alumno.` : 'Todas las cuotas ya tenían su link.');
        window.dispatchEvent(new CustomEvent('links-pago:creado', { detail: { conversion_id: conversionId } }));
      }
    } catch (e) {
      setError(errorDe(e));
    } finally {
      setGenerando(false);
    }
  }

  function copiarTodos() {
    const v = plan?.venta;
    const lineas = conLink.map((c) => `· Cuota ${c.numero} (${dinero(c.importe)}, vence el ${fecha(c.vence)}): ${c.link_url}`);
    const texto = [`Hola${v?.lead_nombre ? `, ${v.lead_nombre}` : ''}. Estos son los links de pago de tu ${v?.producto_nombre || 'programa'}, uno por cuota:`, ...lineas].join('\n');
    copiarLink(texto);
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={generando ? undefined : onClose} />
        <div role="dialog" aria-modal="true" aria-labelledby="plan-pago-titulo" data-recorrido="links-plan"
          className="relative bg-card sm:rounded-lg border border-border w-full max-w-xl flex flex-col max-h-[100dvh] overflow-y-auto">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <CalendarCheck size={18} weight="regular" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="plan-pago-titulo" className="font-semibold text-base">Plan de pago</h3>
              <p className="text-xs text-muted-foreground">
                Un link de pago por cada cuota pendiente. Al pagar uno, se salda esa cuota de la venta.
              </p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {cargando && <p className="text-sm text-muted-foreground">Cargando las cuotas…</p>}

            {plan?.venta && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-semibold">{plan.venta.lead_nombre || 'Sin nombre'} · {plan.venta.producto_nombre || 'sin curso'}</p>
                <p className="text-xs text-muted-foreground">
                  Venta n.º {plan.venta.id} · total {dinero(plan.venta.importe_total)} · cobrado {dinero(plan.venta.cobrado)} · pendiente {dinero(plan.venta.pendiente)}
                </p>
              </div>
            )}

            {!cargando && plan && !cuotas.length && (
              <p className="text-sm flex items-start gap-1.5 text-warning-soft-foreground" data-recorrido="links-plan-sin-cuotas">
                <WarningCircle size={16} weight="fill" className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                Esta venta no tiene cuotas pendientes. Si va a plazos, crea antes su plan de cuotas en la ficha de la venta
                («Plan de cuotas»); si es un solo pago, usa «Crear link de pago».
              </p>
            )}

            {cuotas.length > 0 && (
              <ul className="divide-y divide-border border border-border rounded-md" data-recorrido="links-plan-cuotas">
                {cuotas.map((c) => (
                  <li key={c.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">Cuota {c.numero} · {dinero(c.importe)}</p>
                      <p className="text-xs text-muted-foreground">
                        Vence el {fecha(c.vence)}
                        {c.link_id ? ` · link n.º ${c.link_id} (${c.link_estado === 'abierto' ? 'abierto por el alumno' : 'sin pagar'})` : ' · sin link todavía'}
                      </p>
                    </div>
                    {c.link_url ? (
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => copiarLink(c.link_url as string)}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted">
                          <Copy size={13} weight="bold" aria-hidden="true" /> Copiar
                        </button>
                        <a href={c.link_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted">
                          <ArrowSquareOut size={13} weight="bold" aria-hidden="true" /> Abrir
                        </a>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">se crea al generar</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {aviso && (
              <p className="text-sm flex items-center gap-1.5 font-semibold text-success-soft-foreground" role="status">
                <CheckCircle size={16} weight="fill" aria-hidden="true" /> {aviso}
              </p>
            )}
            {error && (
              <p className="text-sm flex items-start gap-1.5 text-destructive" role="alert">
                <WarningCircle size={16} weight="fill" className="flex-shrink-0 mt-0.5" aria-hidden="true" /> {error}
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={generando}
              className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cerrar
            </button>
            {conLink.length > 0 && (
              <button type="button" onClick={copiarTodos} data-recorrido="links-plan-copiar"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                <Copy size={14} weight="bold" aria-hidden="true" /> Copiar todos
              </button>
            )}
            {sinLink.length > 0 && (
              <button type="button" onClick={generar} disabled={generando} data-recorrido="links-plan-generar"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
                <LinkSimple size={14} weight="bold" aria-hidden="true" />
                {generando ? 'Generando…' : `Generar ${sinLink.length === 1 ? 'el link' : `los ${sinLink.length} links`}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
