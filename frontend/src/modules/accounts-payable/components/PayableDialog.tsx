import { useState } from 'react';
import { payableApi } from '../api/payable.api';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import { X } from '@phosphor-icons/react';

const CATEGORIES = ['salarios', 'alquiler', 'proveedores', 'software', 'publicidad', 'impuestos', 'servicios', 'mantenimiento', 'otros'];

interface Props {
  projectId: number | null | undefined;
  onClose: () => void;
  onSaved: () => void;
}

export default function PayableDialog({ projectId, onClose, onSaved }: Props) {
  const [data, setData] = useState({
    proveedor: '', concepto: '', categoria: 'proveedores',
    importe_total: '', fecha_factura: new Date().toISOString().slice(0, 10),
    fecha_compromiso_pago: '', notas: '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.proveedor?.trim()) {
      toast({ title: 'Proveedor requerido', variant: 'destructive' });
      return;
    }
    if (!data.concepto?.trim()) {
      toast({ title: 'Concepto requerido', variant: 'destructive' });
      return;
    }
    const importe = Number(data.importe_total);
    if (!data.importe_total || isNaN(importe) || importe <= 0) {
      toast({ title: 'Importe inválido', description: 'Debe ser mayor que 0.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await payableApi.create({
        ...data,
        project_id: projectId || null,
        importe_total: importe,
        fecha_compromiso_pago: data.fecha_compromiso_pago || null,
      });
      toast({ title: 'Factura creada' });
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
        <form onSubmit={handleSubmit} className="relative bg-card rounded-lg border border-border w-full max-w-lg mx-3 sm:mx-0 p-6 space-y-3 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Nueva factura por pagar</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input required placeholder="Proveedor" value={data.proveedor} onChange={e => setData({ ...data, proveedor: e.target.value })} className={inputClass} />
            <Select<string>
              value={data.categoria}
              onChange={(v) => setData({ ...data, categoria: v })}
              options={CATEGORIES.map(c => ({ value: c, label: c }))}
              ariaLabel="Categoría"
            />
            <input required placeholder="Concepto" value={data.concepto} onChange={e => setData({ ...data, concepto: e.target.value })} className={inputClass + ' col-span-2'} />
            <input required type="number" step="0.01" placeholder="Importe total" value={data.importe_total} onChange={e => setData({ ...data, importe_total: e.target.value })} className={inputClass + ' tabular-nums'} />
            <div></div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground block mb-1">Fecha factura</label>
              <input type="date" value={data.fecha_factura} onChange={e => setData({ ...data, fecha_factura: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground block mb-1">Vence</label>
              <input type="date" value={data.fecha_compromiso_pago} onChange={e => setData({ ...data, fecha_compromiso_pago: e.target.value })} className={inputClass} />
            </div>
            <textarea placeholder="Notas (opcional)" value={data.notas} onChange={e => setData({ ...data, notas: e.target.value })} className={inputClass + ' col-span-2 h-20 py-2 resize-none'} />
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
              {saving ? 'Guardando...' : 'Crear factura'}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
