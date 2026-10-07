import { useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice } from '../api/invoices.api';
import { formatDateNumeric } from '@/shared/lib/format';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

// Hoy en la hora de quien lo usa, no en UTC: a las 21:00 en Caracas ya es mañana en UTC.
function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const METODOS: Array<[string, string]> = [
  ['transferencia', 'Transferencia'],
  ['tarjeta', 'Tarjeta'],
  ['bizum', 'Bizum'],
  ['efectivo', 'Efectivo'],
  ['paypal', 'PayPal'],
  ['otro', 'Otro'],
];

/*
  «Cobrada» en una proforma. Una proforma no se marca pagada: se apunta el cobro
  en su venta y la proforma pasa a ser la factura, con su numero y su fecha.
  Antes eran dos pantallas (la venta y la cola de facturacion) y nada lo decia;
  Yolanda se quedo sin saber como hacerlo.
*/
export default function CobrarProformaDialog({ invoice, onClose, onSaved }: {
  invoice: Invoice; onClose: () => void; onSaved: () => void;
}) {
  const pendiente = Number(invoice.pendiente_de_la_venta ?? invoice.total ?? 0);
  const [importe, setImporte] = useState(pendiente > 0 ? pendiente.toFixed(2) : '');
  const [fecha, setFecha] = useState(hoy());
  const [metodo, setMetodo] = useState('transferencia');
  const [working, setWorking] = useState(false);

  const cifra = Number(String(importe).replace(',', '.'));
  const valido = Number.isFinite(cifra) && cifra > 0 && /^\d{4}-\d{2}-\d{2}$/.test(fecha);
  const salda = valido && cifra >= pendiente - 0.01;

  async function guardar() {
    if (!valido) return;
    setWorking(true);
    try {
      const res = await invoicesApi.cobrarProforma(invoice.id, { importe: cifra, fecha, metodo });
      if (res.success) {
        const pagada = res.data?.estado === 'pagada';
        toast({
          title: `✓ ${invoice.codigo} ya es factura`,
          description: pagada ? 'Pagada: el cobro cubre la venta.' : 'Emitida: queda parte de la venta por cobrar.',
        });
        onSaved();
      } else {
        toast({ title: 'No se pudo', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast({ title: 'No se pudo', description: err?.message, variant: 'destructive' });
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => !working && onClose()}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-base">Proforma cobrada — Nº {invoice.codigo || ''}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{invoice.cliente_nombre}</p>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Se apunta el cobro en la venta y la proforma pasa a ser la <strong>factura Nº {invoice.codigo}</strong>,
            con su número y su fecha ({invoice.fecha_emision ? formatDateNumeric(invoice.fecha_emision) : '—'}).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium">Fecha del cobro</span>
              <input type="date" value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Importe (€)</span>
              <input type="number" inputMode="decimal" step="0.01" min="0" value={importe}
                onChange={(e) => setImporte(e.target.value)}
                className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm tabular-nums" />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-xs font-medium">Cómo pagó</span>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
              className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm">
              {METODOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Falta por cobrar de la venta: <strong className="tabular-nums">{fmt(pendiente)}</strong>.{' '}
            {valido && (salda
              ? 'Con este cobro queda saldada y la factura sale pagada.'
              : 'Es un cobro parcial: la factura sale emitida y pasa a pagada cuando se cobre el resto.')}
          </p>
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} disabled={working} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={guardar} disabled={working || !valido}
            className="h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <CheckCircle size={14} weight="bold" /> {working ? 'Guardando…' : 'Apuntar cobro y facturar'}
          </button>
        </div>
      </div>
    </div>
  );
}
