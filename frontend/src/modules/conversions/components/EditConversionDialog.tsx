import { useEffect, useState } from 'react';
import { X, PencilSimple } from '@phosphor-icons/react';
import { conversionsApi, type Conversion } from '../api/conversions.api';
import { toast } from '@/shared/hooks/useToast';
import { formatCurrency } from '@/shared/lib/format';
import { useProducts } from '@/modules/products/hooks/useProducts';

interface Props {
  conversion: Conversion | null;
  onClose: () => void;
  onSaved?: () => void;
}

const METODOS = [
  { value: '', label: '— Sin especificar —' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'fraccionado', label: 'Fraccionado (cuotas)' },
];

// Editar conversión cargada previamente. Permite corregir importe_total (con
// descuentos/becas), producto, fechas, método de pago y notas. NO modifica
// pagos ya registrados; para eso usar el diálogo de pagos.
export default function EditConversionDialog({ conversion, onClose, onSaved }: Props) {
  const [producto, setProducto] = useState('');
  const [importeTotal, setImporteTotal] = useState('');
  const [metodoPago, setMetodoPago] = useState<string>('');
  const [fechaConversion, setFechaConversion] = useState('');
  const [fechaCompromiso, setFechaCompromiso] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  // Catálogo del proyecto para resolver el FK del programa por nombre.
  const { products } = useProducts((conversion as any)?.project_id, true);

  useEffect(() => {
    if (!conversion) return;
    setProducto(conversion.producto_contratado || '');
    setImporteTotal(String(conversion.importe_total));
    setMetodoPago(conversion.metodo_pago || '');
    setFechaConversion((conversion.fecha_conversion || '').slice(0, 10));
    setFechaCompromiso((conversion.fecha_compromiso_pago || '').slice(0, 10));
    setNotas(conversion.notas_pago || '');
  }, [conversion?.id]);

  async function handleSave() {
    if (!conversion) return;
    const total = Number(importeTotal);
    const pagado = Number(conversion.importe_pagado || 0);
    if (!isFinite(total) || total <= 0) {
      toast({ title: 'Importe total inválido', variant: 'destructive' });
      return;
    }
    if (total < pagado) {
      toast({
        title: 'Importe menor a lo ya pagado',
        description: `Ya cobrado: ${formatCurrency(pagado)}. El nuevo total debe ser ≥ a eso.`,
        variant: 'destructive',
      });
      return;
    }
    if (!producto.trim()) {
      toast({ title: 'Producto requerido', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const patch: any = {
        producto_contratado: producto.trim(),
        importe_total: total,
        notas_pago: notas.trim() || null,
        metodo_pago: metodoPago || null,
        fecha_compromiso_pago: fechaCompromiso || null,
      };
      // Si el nombre coincide con un programa del catálogo, vincula el FK (bug:
      // antes solo se guardaba el texto y el vínculo quedaba NULL).
      const matched = products.find((p) => (p.nombre || '').trim().toLowerCase() === producto.trim().toLowerCase());
      if (matched) patch.producto_contratado_id = matched.id;
      if (fechaConversion) patch.fecha_conversion = fechaConversion;
      await conversionsApi.update(conversion.id, patch);
      toast({ title: 'Conversión actualizada' });
      onSaved?.();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!conversion) return null;
  const pagado = Number(conversion.importe_pagado || 0);

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <PencilSimple size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Editar conversión</h3>
            <p className="text-xs text-muted-foreground">
              Corrige importe, producto, fechas o método de pago.
              {pagado > 0 && <span className="block mt-0.5">Ya cobrado: <strong>{formatCurrency(pagado)}</strong> (el nuevo total no puede ser menor).</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Producto contratado *</label>
            <input
              value={producto}
              onChange={(e) => setProducto(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Importe total (€)</label>
              <input
                type="number" step="0.01" min={0}
                value={importeTotal}
                onChange={(e) => setImporteTotal(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm tabular-nums"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Pagado: {formatCurrency(pagado)} · Pendiente actual: {formatCurrency((Number(importeTotal) || 0) - pagado)}
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Método de pago</label>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
              >
                {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Fecha de la venta</label>
              <input
                type="date" value={fechaConversion}
                onChange={(e) => setFechaConversion(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Fecha compromiso pago</label>
              <input
                type="date" value={fechaCompromiso}
                onChange={(e) => setFechaCompromiso(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Notas</label>
            <textarea
              value={notas} onChange={(e) => setNotas(e.target.value)}
              rows={3}
              placeholder="Beca 30%, acuerdo especial, etc."
              className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving}
            className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
