import { useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

// Cambiar SOLO la fecha de emisión y/o de pago de una factura. Para admins y para
// usuarios con el permiso editar_fechas_factura. No toca importes ni conceptos.
export default function EditarFechasDialog({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) {
  const [fechaEmision, setFechaEmision] = useState(d10(invoice.fecha_emision));
  const [fechaPago, setFechaPago] = useState(d10(invoice.fecha_pago));
  const [working, setWorking] = useState(false);

  async function guardar() {
    if (!fechaEmision && !fechaPago) return;
    setWorking(true);
    try {
      const body: { fechaEmision?: string; fechaPago?: string } = {};
      if (fechaEmision) body.fechaEmision = fechaEmision;
      if (fechaPago) body.fechaPago = fechaPago;
      const res = await invoicesApi.updateFechas(invoice.id, body);
      if (res.success) { toast({ title: 'Fechas actualizadas' }); onSaved(); }
      else toast({ title: 'Error', description: (res as { error?: string }).error || 'No se pudo guardar', variant: 'destructive' });
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo guardar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-base">Editar fechas — Factura Nº {invoice.codigo || ''}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Cambia solo la fecha de emisión y/o de pago. No afecta importes ni conceptos.</p>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div>
            <label className="text-[11px] text-muted-foreground">Fecha de emisión</label>
            <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)}
              className="w-full h-9 px-2 rounded border border-border bg-background text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Fecha de pago</label>
            <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
              className="w-full h-9 px-2 rounded border border-border bg-background text-sm" />
          </div>
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={guardar} disabled={working || (!fechaEmision && !fechaPago)}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <CalendarBlank size={14} weight="bold" /> {working ? 'Guardando…' : 'Guardar fechas'}
          </button>
        </div>
      </div>
    </div>
  );
}
