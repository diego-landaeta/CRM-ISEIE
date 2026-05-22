import { useState } from 'react';
import { payableApi } from '../api/payable.api';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import { X } from '@phosphor-icons/react';

function fmt(n: number | string | null | undefined): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}

interface Payable {
  id: number;
  proveedor?: string;
  concepto?: string;
  importe_pendiente?: number | string;
}

interface Props {
  payable: Payable;
  onClose: () => void;
  onSaved: () => void;
}

export default function PaymentDialog({ payable, onClose, onSaved }: Props) {
  const pendiente = Number(payable.importe_pendiente || 0);
  const [data, setData] = useState<{
    importe: number | string;
    fecha_pago: string;
    metodo: string;
    referencia: string;
    notas: string;
  }>({
    importe: pendiente, fecha_pago: new Date().toISOString().slice(0, 10),
    metodo: 'transferencia', referencia: '', notas: '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.importe) return;
    setSaving(true);
    try {
      await payableApi.addPayment(payable.id, { ...data, importe: Number(data.importe) });
      toast({ title: 'Pago registrado' });
      onSaved();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <form onSubmit={handleSubmit} className="relative bg-card rounded-lg border border-border w-full max-w-md p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Registrar pago</h2>
              <p className="text-xs text-muted-foreground">{payable.proveedor} — {payable.concepto}</p>
              <p className="text-xs text-orange-600 dark:text-orange-400 font-semibold mt-1 tabular-nums">Pendiente: {fmt(pendiente)}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground block mb-1">Importe</label>
              <input required type="number" step="0.01" max={String(pendiente)} value={data.importe} onChange={e => setData({ ...data, importe: e.target.value })} className={inputClass + ' tabular-nums'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground block mb-1">Fecha</label>
                <input type="date" value={data.fecha_pago} onChange={e => setData({ ...data, fecha_pago: e.target.value })} className={inputClass} required />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground block mb-1">Método</label>
                <Select<string>
                  value={data.metodo}
                  onChange={(v) => setData({ ...data, metodo: v })}
                  options={[
                    { value: 'transferencia', label: 'Transferencia' },
                    { value: 'tarjeta', label: 'Tarjeta' },
                    { value: 'efectivo', label: 'Efectivo' },
                    { value: 'otros', label: 'Otros' },
                  ]}
                  ariaLabel="Método de pago"
                />
              </div>
            </div>
            <input placeholder="Referencia (opcional)" value={data.referencia} onChange={e => setData({ ...data, referencia: e.target.value })} className={inputClass} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {saving ? 'Guardando...' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
