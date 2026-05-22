import { useState, useEffect, type FormEvent } from 'react';
import Portal from '@/shared/components/ui/portal';
import { X } from '@phosphor-icons/react';
import { conversionsApi, type Conversion } from '../api/conversions.api';
import { toast } from '@/shared/hooks/useToast';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import { formatCurrency } from '@/shared/lib/format';

interface PaymentForm {
  importe: string;
  fecha: string;
  notas: string;
}

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  conversion: Conversion | null;
  onPaid?: () => void;
}

export default function PaymentDialog({ open, onClose, conversion, onPaid }: PaymentDialogProps) {
  useEscapeKey(onClose, open);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PaymentForm>({
    importe: '',
    fecha: new Date().toISOString().slice(0, 10),
    notas: '',
  });

  useEffect(() => {
    if (open) {
      setForm({ importe: '', fecha: new Date().toISOString().slice(0, 10), notas: '' });
    }
  }, [open]);

  if (!open || !conversion) return null;

  const pendiente = Number(conversion.importe_total) - Number(conversion.importe_pagado);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!conversion) return;
    const importe = Number(form.importe);
    if (!importe || importe <= 0) {
      toast({ title: 'Importe invalido', variant: 'destructive' });
      return;
    }
    if (importe > pendiente) {
      toast({ title: 'Importe excede pendiente', description: `Pendiente: ${formatCurrency(pendiente)}`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await conversionsApi.addPayment(conversion.id, {
        importe,
        fecha: form.fecha,
        notas: form.notas || null,
      });
      if (res.success) {
        toast({ title: 'Pago registrado', description: formatCurrency(importe) });
        onPaid?.();
        onClose();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || 'Error desconocido', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

  return (
    <Portal>
      <div role="dialog" className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border w-full max-w-md mx-4 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Registrar abono</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{conversion.producto_contratado}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-muted">
              <X size={18} weight="bold" />
            </button>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 mb-4 text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-muted-foreground">Total:</span>
              <span className="font-semibold tabular-nums">{formatCurrency(conversion.importe_total)}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-muted-foreground">Pagado:</span>
              <span className="font-semibold text-green-600 tabular-nums">{formatCurrency(conversion.importe_pagado)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border">
              <span className="text-muted-foreground">Pendiente:</span>
              <span className="font-bold text-orange-600 tabular-nums">{formatCurrency(pendiente)}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Importe del abono (EUR) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={pendiente}
                value={form.importe}
                onChange={e => setForm({ ...form, importe: e.target.value })}
                placeholder={`Max ${formatCurrency(pendiente)}`}
                className={inputClass}
                autoFocus
                required
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Fecha</label>
              <input type="date" aria-label="Fecha del abono" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} className={inputClass} />
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notas</label>
              <input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Primer plazo, segunda cuota, etc..." className={inputClass} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Registrar abono'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
