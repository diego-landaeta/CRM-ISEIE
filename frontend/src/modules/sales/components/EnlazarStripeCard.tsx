import { useCallback, useEffect, useState } from 'react';
import { LinkSimple } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { formatDate } from '@/shared/lib/format';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';

/**
 * «Este cargo de Stripe es ESE cobro», en la ficha de la venta (CRM#888).
 *
 * 18/11: alumnos con el pago hecho y facturado que salían pendientes, o a los
 * que se les volvía a apuntar el cobro y se les emitía otra factura. Un cargo
 * de Stripe sin enlazar al lado de un cobro apuntado a mano por otro importe
 * u otra fecha: «Asociar» no los reconocía como el mismo pago y creaba otro.
 *
 * Aquí se elige el cobro (con su factura, si la tiene) y el cargo se queda en
 * él: sin crear cobro ni factura. Solo sale si hay algún cargo suelto que
 * parezca de esta venta y quien mira puede enlazar cargos.
 */

type Cargo = { id: number; stripe_id: string; importe: number; fecha: string; customer_email?: string | null };
type Cobro = {
  id: number; importe: number; fecha: string; metodo: string | null;
  factura_id: number | null; factura_codigo: string | null; cuota_numero: string | null;
};

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

function textoCobro(c: Cobro) {
  const partes = [`${eur(c.importe)} del ${formatDate(c.fecha)}`];
  if (c.cuota_numero) partes.push(`cuota ${c.cuota_numero}`);
  partes.push(c.factura_codigo ? `factura ${c.factura_codigo}` : 'sin factura');
  return partes.join(' · ');
}

/** El cobro que más se parece al cargo: mismo importe y fecha más cercana. */
function sugerido(cargo: Cargo, cobros: Cobro[]): number | '' {
  if (!cobros.length) return '';
  const dist = (c: Cobro) => Math.abs(c.importe - cargo.importe) * 1000
    + Math.abs(new Date(c.fecha).getTime() - new Date(cargo.fecha).getTime()) / 86400000;
  return [...cobros].sort((a, b) => dist(a) - dist(b))[0].id;
}

export default function EnlazarStripeCard({ conversionId, onEnlazado }: {
  conversionId: number | string; onEnlazado?: () => void;
}) {
  const { can } = usePermission();
  const puede = can('stripe.edit');
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [eleccion, setEleccion] = useState<Record<number, number | ''>>({});
  const [enviando, setEnviando] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    if (!puede) return;
    try {
      const res = await client.get<{ cargos: Cargo[]; cobros: Cobro[] }>(`/stripe-payments/de-la-venta/${conversionId}`);
      if (res.success && res.data) {
        setCargos(res.data.cargos || []);
        setCobros(res.data.cobros || []);
        const ini: Record<number, number | ''> = {};
        for (const cg of res.data.cargos || []) ini[cg.id] = sugerido(cg, res.data.cobros || []);
        setEleccion(ini);
      }
    } catch {
      // Sin cargos que enlazar la tarjeta no sale; un fallo aquí no es motivo
      // para tapar la ficha.
    }
  }, [conversionId, puede]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!puede || cargos.length === 0) return null;

  async function enlazar(cargo: Cargo) {
    const cobroId = eleccion[cargo.id];
    if (!cobroId) return;
    setEnviando(cargo.id);
    try {
      await client.post(`/stripe-payments/${cargo.id}/link`, { conversionPaymentId: cobroId });
      toast({ title: 'Cargo enlazado', description: 'El cargo de Stripe queda en ese cobro. No se ha creado otro cobro ni otra factura.' });
      await cargar();
      onEnlazado?.();
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo enlazar', description: e?.data?.error || e?.message || '', variant: 'destructive' });
    } finally { setEnviando(null); }
  }

  return (
    <div className="bg-card border border-warning/40 rounded-lg p-4" data-recorrido="cargos-sin-enlazar">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold flex items-center gap-2">
          <LinkSimple size={16} weight="bold" /> Cargos de Stripe sin enlazar ({cargos.length})
        </h3>
        {/* El recorrido (18/11): solo con el botón (CRM#1012). */}
        <VerRecorrido id="cargos-sin-enlazar" compacto />
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Si el pago ya está apuntado (o facturado), enlaza el cargo con ese cobro. No se crea otro cobro ni otra factura.
      </p>
      <ul className="space-y-2">
        {cargos.map((cg, i) => (
          <li key={cg.id} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
            <span className="tabular-nums font-semibold whitespace-nowrap">{eur(cg.importe)}</span>
            <span className="text-muted-foreground whitespace-nowrap">{formatDate(cg.fecha)}</span>
            <select
              data-recorrido={i === 0 ? 'cargo-cobro' : undefined}
              aria-label={`Cobro para el cargo ${cg.stripe_id}`}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
              value={eleccion[cg.id] ?? ''}
              onChange={(e) => setEleccion((s) => ({ ...s, [cg.id]: e.target.value ? Number(e.target.value) : '' }))}
            >
              <option value="">Elige el cobro de este pago…</option>
              {cobros.map((c) => <option key={c.id} value={c.id}>{textoCobro(c)}</option>)}
            </select>
            <button
              type="button"
              data-recorrido={i === 0 ? 'cargo-enlazar' : undefined}
              disabled={!eleccion[cg.id] || enviando === cg.id}
              onClick={() => enlazar(cg)}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
            >
              {enviando === cg.id ? 'Enlazando…' : 'Enlazar'}
            </button>
          </li>
        ))}
      </ul>
      {cobros.length === 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Esta venta no tiene cobros sin cargo. Si el pago no está apuntado, asócialo desde Finanzas › Pagos Stripe.
        </p>
      )}
    </div>
  );
}
