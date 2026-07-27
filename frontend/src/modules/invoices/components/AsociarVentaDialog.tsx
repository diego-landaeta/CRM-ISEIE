import { useEffect, useState } from 'react';
import { LinkSimple } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice, LeadConversion } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number | string | null) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

// Opción B: asociar una factura YA existente a una venta (conversión) del cliente.
// Útil cuando el admin (Adriana) crea una factura suelta y luego la vincula a la venta.
export default function AsociarVentaDialog({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) {
  const [ventas, setVentas] = useState<LeadConversion[]>([]);
  const [sel, setSel] = useState<number | null>(invoice.conversion_id ?? null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!invoice.lead_id) { setLoading(false); return; }
      try {
        const res = await invoicesApi.leadFiscalData(invoice.lead_id);
        if (!cancel && res.success && res.data) setVentas(res.data.conversiones || []);
      } catch { /* noop */ } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [invoice.lead_id]);

  async function guardar() {
    if (!sel) return;
    setWorking(true);
    try {
      const res = await invoicesApi.asociarVenta(invoice.id, sel);
      if (res.success) { toast({ title: 'Factura asociada a la venta' }); onSaved(); }
      else toast({ title: 'Error', description: (res as { error?: string }).error || 'No se pudo asociar', variant: 'destructive' });
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo asociar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-base">Asociar a una venta — Factura Nº {invoice.codigo || ''}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Vincula esta factura a una venta del cliente <strong>{invoice.cliente_nombre}</strong>.</p>
        </div>
        <div className="p-4 space-y-2 text-sm">
          {loading ? <p className="text-muted-foreground text-xs">Cargando ventas…</p>
            : !invoice.lead_id ? <p className="text-amber-600 text-xs">Esta factura no tiene cliente vinculado.</p>
            : ventas.length === 0 ? <p className="text-amber-600 text-xs">El cliente no tiene ventas registradas.</p>
            : ventas.map((v) => (
              <label key={v.id} className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${sel === v.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}>
                <input type="radio" name="venta" checked={sel === v.id} onChange={() => setSel(v.id)} className="mt-1" />
                <span>
                  <span className="font-medium">{v.producto_contratado || v.producto_nombre || 'Venta'}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {fmt(v.importe_total)} · {v.fecha_conversion ? String(v.fecha_conversion).slice(0, 10) : 's/f'}
                    {invoice.conversion_id === v.id ? ' · (actual)' : ''}
                  </span>
                </span>
              </label>
            ))}
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={guardar} disabled={working || !sel || sel === invoice.conversion_id}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <LinkSimple size={14} weight="bold" /> {working ? 'Asociando…' : 'Asociar'}
          </button>
        </div>
      </div>
    </div>
  );
}
