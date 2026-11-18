import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

/*
  ANULAR UNA FACTURA EMITIDA (CRM#793, Diego 18/11/2026).

  Una emitida no se borra ni se cambia. Si hay que dejarla sin efecto se anula
  indicando el motivo: queda apuntado quién y por qué, y sale su abono
  (rectificativa) por lo que quede sin abonar. La factura sigue en la serie con
  su número, marcada como anulada, y su abono la deja a cero.
*/
export default function AnularFacturaDialog({ invoice, onClose, onAnulada }: {
  invoice: Invoice; onClose: () => void; onAnulada: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [working, setWorking] = useState(false);
  const valido = motivo.trim().length >= 3;

  async function anular() {
    if (!valido) return;
    setWorking(true);
    try {
      const res = await invoicesApi.anular(invoice.id, motivo.trim());
      if (res.success) {
        const abono = res.data?.abono?.codigo;
        toast({ title: `✓ ${invoice.codigo} anulada`, description: abono ? `Abono ${abono}` : undefined });
        onAnulada();
      } else {
        toast({ title: 'No se pudo anular', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo anular', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => !working && onClose()}>
      <div role="dialog" aria-labelledby="anular-factura-titulo"
        className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 id="anular-factura-titulo" className="font-semibold text-base">Anular la factura {invoice.codigo || ''}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{invoice.cliente_nombre} · {fmt(invoice.total)}</p>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Una factura emitida no se borra ni se cambia. Al anularla sigue en la serie con su número,
            marcada como anulada, y sale su <strong>abono</strong> (rectificativa) que la deja a cero.
            Queda apuntado quién la anuló y por qué.
          </p>
          <label className="space-y-1 block">
            <span className="text-xs font-medium">Motivo de la anulación</span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500}
              placeholder="Por ejemplo: cliente equivocado, cobro devuelto, emitida dos veces…"
              className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm resize-none" />
          </label>
          {!valido && motivo.length > 0 && (
            <p className="text-xs text-destructive">Escribe el motivo (al menos 3 letras).</p>
          )}
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} disabled={working} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={anular} disabled={working || !valido}
            title={valido ? undefined : 'Indica el motivo para poder anular'}
            className="h-9 px-3 rounded-md bg-destructive text-white text-sm font-semibold hover:bg-destructive/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <X size={14} weight="bold" /> {working ? 'Anulando…' : 'Anular y emitir su abono'}
          </button>
        </div>
      </div>
    </div>
  );
}
