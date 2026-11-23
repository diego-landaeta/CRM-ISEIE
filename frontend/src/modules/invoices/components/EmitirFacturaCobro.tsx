// «Emitir ya la factura de este cobro» (CRM#1043, gemela CRM-ISEIE#708).
//
// Ticket de soporte del 23/11: una gestora registró una venta en dos cuotas con
// la primera cobrada y el CRM solo le ofreció «¿hacer proforma?». Dijo que no y
// la venta se quedó en «Ventas sin factura» sin la factura de su cobro. Era la
// segunda vez.
//
// Con el freno del 14/09 ningún cobro se factura solo: espera en la cola de
// facturación. Este bloque sale donde se registra el cobro (la venta, un abono,
// una cuota) y dice qué pasa con su factura:
//   - con «Emitir desde la cola» (`facturas.cola`): la emite ya, con la MISMA
//     llamada que el botón de la cola (`POST /invoices/cola/generar`), con su
//     número, su orden y su aviso de posible duplicada (CRM#819);
//   - sin ese permiso: avisa de que el cobro queda en la cola y que la factura
//     la emite administración.
// Lo que ofrece sale de la misma cola que Facturación: un cobro que ya tiene su
// factura no se ofrece, así que nunca salen dos facturas del mismo cobro.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Receipt } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { invoicesApi } from '../api/invoices.api';
import { posibleDuplicada, preguntarSiEmitirDuplicada, type OtraFactura } from '../lib/posibleDuplicada';

type CobroEnCola = {
  payment_id: number;
  fecha: string;
  importe: number;
  origen?: 'stripe' | 'manual';
  es_el_siguiente?: boolean;
  posible_duplicada?: OtraFactura | null;
};
type FacturaDeVenta = { id: number; codigo: string | null; payment_id: number | null; tipo: string; estado: string };
type Respuesta = { project_id: number; cobros: CobroEnCola[]; facturas: FacturaDeVenta[]; puede_emitir?: boolean };

const euros = (n: unknown) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fechaCorta = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Qué es cada documento, en dos frases: lo que la gestora no sabía distinguir. */
export function QueEsCadaUna() {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground" data-testid="que-es-cada-una">
      <b>Factura del cobro</b>: la del dinero que ya ha entrado; cada cobro lleva la suya.
      {' '}<b>Proforma</b>: solo para lo que aún no se ha cobrado; es una factura de la serie que,
      {' '}al pagar, pasa a ser la factura (mismo número) y, si no paga, se anula con su abono.
    </p>
  );
}

/** Sin «Emitir desde la cola»: el cobro espera y lo emite administración. */
export function AvisoCobroEnCola() {
  return (
    <div role="note" data-testid="aviso-cobro-en-cola"
      className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-left">
      <p className="text-sm font-semibold text-warning-soft-foreground">La factura de este cobro la emite administración</p>
      <p className="mt-0.5 text-[13px] leading-snug text-warning-soft-foreground">
        El cobro queda en la <b>cola de facturación</b> y de ahí sale su factura, con su número.
        {' '}No hace falta que hagas una proforma: la proforma es solo para lo que aún no se ha cobrado.
      </p>
    </div>
  );
}

export default function EmitirFacturaCobro({ conversionId, paymentId = null, onEmitida }: {
  conversionId: number;
  /** El cobro recién apuntado. Sin él (venta recién registrada), el primero de la venta que espere en la cola. */
  paymentId?: number | null;
  onEmitida?: (factura: { id?: number; codigo?: string }) => void;
}) {
  const { can } = usePermission();
  const puedeCola = can('facturas.cola');
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [cobro, setCobro] = useState<CobroEnCola | null>(null);
  const [yaTiene, setYaTiene] = useState<FacturaDeVenta | null>(null);
  const [numero, setNumero] = useState('');
  const [sugerido, setSugerido] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [emitida, setEmitida] = useState<{ id?: number; codigo?: string } | null>(null);

  const cargar = useCallback(async () => {
    if (!puedeCola || !conversionId) return;
    setCargando(true);
    try {
      const r = await client.get<Respuesta>(`/invoices/cola/venta/${conversionId}`);
      const d = r?.data;
      const enCola = (d?.cobros || []).find((c) => (paymentId ? Number(c.payment_id) === Number(paymentId) : true)) || null;
      const suya = (d?.facturas || []).find((f) => f.tipo !== 'proforma'
        && (paymentId ? Number(f.payment_id) === Number(paymentId) : true)) || null;
      setProjectId(d?.project_id ?? null);
      setCobro(enCola);
      setYaTiene(enCola ? null : suya);
      setFallo(false);
      if (enCola) {
        // El siguiente número, como en la cola: se enseña y se puede cambiar.
        try {
          const s = await client.get<{ siguiente: number }>(`/invoices/siguiente-numero?projectId=${d.project_id}`);
          if (s?.success) { setSugerido(String(s.data.siguiente)); setNumero(String(s.data.siguiente)); }
        } catch { /* se escribe a mano */ }
      }
    } catch {
      setFallo(true);
    } finally {
      setCargando(false);
    }
  }, [puedeCola, conversionId, paymentId]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!puedeCola) return <AvisoCobroEnCola />;

  // La misma llamada y las mismas preguntas que «Generar factura» de la cola.
  async function mandar(forzar: boolean, confirmarDuplicada: boolean): Promise<void> {
    if (!cobro || !projectId) return;
    setEmitiendo(true);
    try {
      const r = await client.post<{ id?: number; codigo?: string }>('/invoices/cola/generar', {
        projectId, paymentId: cobro.payment_id,
        ...(forzar ? { forzar: true } : {}),
        ...(numero ? { numero: Number(numero) } : {}),
        ...(confirmarDuplicada ? { confirmar_duplicada: true } : {}),
      });
      if (r?.success) {
        setEmitida(r.data || {});
        toast({ title: 'Factura generada', description: r.data?.codigo || '' });
        onEmitida?.(r.data || {});
      }
    } catch (err) {
      const e = err as { data?: { error?: string; code?: string } };
      if (e?.data?.code === 'HAY_ANTERIORES' && !forzar) {
        // Hay cobros anteriores sin facturar: se pregunta antes de saltarse el orden.
        if (window.confirm(`${e.data.error}\n\n¿Emitirla igualmente, fuera de orden?`)) {
          setEmitiendo(false);
          return mandar(true, confirmarDuplicada);
        }
      } else if (!confirmarDuplicada && posibleDuplicada(err)) {
        if (await preguntarSiEmitirDuplicada(posibleDuplicada(err) as OtraFactura)) {
          setEmitiendo(false);
          return mandar(forzar, true);
        }
      } else if (e?.data?.code === 'NOT_IN_QUEUE') {
        // Ya la tiene (por ejemplo, salió sola): se dice y se vuelve a mirar.
        toast({ title: 'Este cobro ya no está en la cola', description: e.data.error });
        cargar();
      } else {
        toast({ title: 'No se pudo generar', description: e?.data?.error || 'Error desconocido', variant: 'destructive' });
      }
    } finally {
      setEmitiendo(false);
    }
  }

  async function emitir() {
    if (!cobro) return;
    // Si ya se sabe que se parece a otra factura (CRM#819), se pregunta antes.
    let confirmar = false;
    if (cobro.posible_duplicada) {
      if (!(await preguntarSiEmitirDuplicada(cobro.posible_duplicada))) return;
      confirmar = true;
    }
    return mandar(false, confirmar);
  }

  const verPdf = (id?: number) => {
    if (!id) return;
    invoicesApi.openPdf(id).catch((e: unknown) => toast({
      title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive',
    }));
  };

  const caja = 'rounded-lg border border-primary/40 bg-primary/5 p-3 text-left';

  if (cargando) {
    return <div className={caja}><p className="text-xs text-muted-foreground">Mirando la cola de facturación…</p></div>;
  }
  if (emitida || yaTiene) {
    const f = emitida || yaTiene;
    return (
      <div className={caja} data-testid="factura-del-cobro">
        <p className="text-sm font-semibold inline-flex items-center gap-1.5">
          <CheckCircle size={16} weight="fill" className="text-success" />
          {emitida ? `Factura ${f?.codigo || ''} emitida` : `Este cobro ya tiene su factura${f?.codigo ? ` ${f.codigo}` : ''}`}
        </p>
        {f?.id ? (
          <button type="button" onClick={() => verPdf(f.id)}
            className="mt-2 h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted">
            Ver el PDF
          </button>
        ) : null}
      </div>
    );
  }
  if (fallo || !cobro) {
    return (
      <div className={caja} data-testid="cobro-fuera-de-cola">
        <p className="text-xs text-muted-foreground">
          {fallo
            ? 'No se pudo mirar la cola de facturación. La factura de este cobro se emite desde Finanzas → Facturación.'
            : 'Este cobro no está en la cola de facturación (queda antes de la fecha «al día» o del año que se factura). Revísalo en Finanzas → Facturación.'}
        </p>
      </div>
    );
  }
  return (
    <div className={caja} data-testid="emitir-factura-cobro">
      <p className="text-xs text-muted-foreground">
        Ya se ha cobrado <b>{euros(cobro.importe)}</b>{fechaCorta(cobro.fecha) ? ` el ${fechaCorta(cobro.fecha)}` : ''}.
        {' '}Su factura espera en la <b>cola de facturación</b>; puedes emitirla ya, con su número.
      </p>
      <label className="mt-2 block text-[11px] font-medium text-muted-foreground" htmlFor={`numero-cobro-${cobro.payment_id}`}>
        Número de la factura
      </label>
      <input id={`numero-cobro-${cobro.payment_id}`} value={numero} inputMode="numeric" autoComplete="off"
        onChange={(e) => setNumero(e.target.value.replace(/[^0-9]/g, ''))}
        className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm tabular-nums" />
      {sugerido && <p className="mt-1 text-[11px] text-muted-foreground">El siguiente disponible es el {sugerido}. Puedes dejarlo o poner otro.</p>}
      <p className="mt-1.5 text-[11px] text-warning-soft-foreground">
        ⚠ Comprueba la numeración en el Excel de facturación primero.
      </p>
      {cobro.es_el_siguiente === false && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Hay cobros anteriores esperando en la cola: te preguntará si la emites fuera de orden.
        </p>
      )}
      <button type="button" onClick={emitir} disabled={emitiendo || !numero}
        className="mt-2.5 w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
        <Receipt size={16} weight="duotone" />
        {emitiendo ? 'Emitiendo…' : 'Emitir ya la factura de este cobro'}
      </button>
    </div>
  );
}
