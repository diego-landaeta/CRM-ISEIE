import { useEffect, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { FechasDeLaFactura } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
const legible = (v?: string | null) => {
  const s = d10(v);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

/*
  CAMBIAR LA FECHA DE UNA FACTURA (Diego, 19/11/2026: «habilita la edición para
  que puedan editar las fechas»).

  Solo las fechas: el número, el importe y el cliente de una emitida siguen sin
  cambiarse (CRM#793). Y la de emisión, solo en su sitio de la serie: entre la
  fecha del número anterior y la del siguiente, porque el número y la fecha van
  juntos. El selector ya viene limitado a ese rango y debajo se dice por qué.
  Cada cambio queda apuntado (quién, cuándo, de qué fecha a cuál) y se ve aquí.
*/
export default function EditarFechasDialog({ invoice, onClose, onSaved }: { invoice: { id: number; codigo: string | null; fecha_emision: string | null; fecha_pago: string | null }; onClose: () => void; onSaved: () => void }) {
  const [fechaEmision, setFechaEmision] = useState(d10(invoice.fecha_emision));
  const [fechaPago, setFechaPago] = useState(d10(invoice.fecha_pago));
  const [info, setInfo] = useState<FechasDeLaFactura | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    invoicesApi.fechas(invoice.id)
      .then((r) => { if (r.success && r.data) setInfo(r.data); })
      .catch(() => setInfo(null));
  }, [invoice.id]);

  // El rango: entre la del número anterior y la del siguiente, y dentro de su año.
  const min = info?.desde ? d10(info.desde) : (info?.ano ? `${info.ano}-01-01` : undefined);
  const max = info?.hasta ? d10(info.hasta) : (info?.ano ? `${info.ano}-12-31` : undefined);
  const fueraDeRango = !!fechaEmision && ((min && fechaEmision < min) || (max && fechaEmision > max));
  const cambiaEmision = fechaEmision && fechaEmision !== d10(invoice.fecha_emision);
  const cambiaPago = fechaPago && fechaPago !== d10(invoice.fecha_pago);

  let rango = '';
  if (info?.desde && info?.hasta) rango = `entre el ${legible(info.desde)} (${info.desde_codigo}) y el ${legible(info.hasta)} (${info.hasta_codigo})`;
  else if (info?.desde) rango = `a partir del ${legible(info.desde)} (${info.desde_codigo})`;
  else if (info?.hasta) rango = `hasta el ${legible(info.hasta)} (${info.hasta_codigo})`;

  async function guardar() {
    if (!cambiaEmision && !cambiaPago) return;
    setWorking(true);
    try {
      const body: { fechaEmision?: string; fechaPago?: string } = {};
      if (cambiaEmision) body.fechaEmision = fechaEmision;
      if (cambiaPago) body.fechaPago = fechaPago;
      const res = await invoicesApi.updateFechas(invoice.id, body);
      if (res.success) { toast({ title: 'Fecha cambiada', description: invoice.codigo || undefined }); onSaved(); }
      else toast({ title: 'No se pudo cambiar', description: (res as { error?: string }).error || 'No se pudo guardar', variant: 'destructive' });
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo cambiar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => !working && onClose()}>
      <div role="dialog" aria-labelledby="cambiar-fecha-titulo" className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 id="cambiar-fecha-titulo" className="font-semibold text-base">Cambiar fecha — Factura {invoice.codigo || ''}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Solo cambian las fechas. El número, el importe y el cliente de una factura emitida no se tocan.
          </p>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div>
            <label htmlFor="cambiar-fecha-emision" className="text-[11px] text-muted-foreground">Fecha de emisión</label>
            <input id="cambiar-fecha-emision" type="date" value={fechaEmision} min={min} max={max}
              onChange={(e) => setFechaEmision(e.target.value)}
              className={`w-full h-9 px-2 rounded border bg-background text-sm ${fueraDeRango ? 'border-destructive' : 'border-border'}`} />
            <p className="text-[11px] text-muted-foreground mt-1">
              El número y la fecha van juntos: para que la serie siga en orden, esta factura puede ir
              {rango ? <> <strong>{rango}</strong>.</> : ' en cualquier día de su año.'}
            </p>
            {fueraDeRango && (
              <p className="text-[11px] text-destructive mt-1">Esa fecha desordena la serie: elige una del rango.</p>
            )}
          </div>
          <div>
            <label htmlFor="cambiar-fecha-pago" className="text-[11px] text-muted-foreground">Fecha de pago</label>
            <input id="cambiar-fecha-pago" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
              className="w-full h-9 px-2 rounded border border-border bg-background text-sm" />
          </div>
          {info && info.historial.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-2">
              <p className="text-[11px] font-semibold mb-1">Cambios de fecha</p>
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                {info.historial.map((h) => (
                  <li key={h.id}>
                    {legible(h.created_at)} · {h.usuario || 'Alguien'}:
                    {h.fecha_emision_antes !== h.fecha_emision_despues && <> emisión {legible(h.fecha_emision_antes)} → {legible(h.fecha_emision_despues)}</>}
                    {h.fecha_pago_antes !== h.fecha_pago_despues && <> · pago {legible(h.fecha_pago_antes) || '—'} → {legible(h.fecha_pago_despues) || '—'}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} disabled={working} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={guardar} disabled={working || fueraDeRango || (!cambiaEmision && !cambiaPago)}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <CalendarBlank size={14} weight="bold" /> {working ? 'Guardando…' : 'Cambiar fecha'}
          </button>
        </div>
      </div>
    </div>
  );
}
