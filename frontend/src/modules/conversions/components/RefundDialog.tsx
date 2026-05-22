import { useEffect, useState } from 'react';
import { ArrowCounterClockwise, Warning } from '@phosphor-icons/react';
import { conversionsApi, type Conversion } from '../api/conversions.api';
import { toast } from '@/shared/hooks/useToast';

interface Props {
  open: boolean;
  conversion: Conversion | null;
  onClose: () => void;
  onSaved?: () => void;
}

// FASE DE PRUEBA — diálogo para registrar una devolución sobre una conversión.
export default function RefundDialog({ open, conversion, onClose, onSaved }: Props) {
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setImporte('');
      setFecha(new Date().toISOString().slice(0, 10));
      setMotivo('');
    }
  }, [open]);

  if (!open || !conversion) return null;

  const pagado = Number(conversion.importe_pagado);

  async function handleSave() {
    if (!conversion) return;
    const n = Number(importe);
    if (!n || n <= 0) {
      toast({ title: 'Importe inválido', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await conversionsApi.createRefund(conversion.id, {
        importe: n,
        fecha,
        motivo: motivo || null,
      });
      if (res.success) {
        toast({ title: 'Devolución registrada', description: `${n.toFixed(2)}€` });
        onSaved?.();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
            <ArrowCounterClockwise size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base flex items-center gap-2">
              Registrar devolución
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 uppercase tracking-wide">Fase prueba</span>
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              {conversion.producto_contratado} · Pagado: {pagado.toFixed(2)}€
            </p>
          </div>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <Warning size={16} className="text-amber-600 flex-shrink-0 mt-0.5" weight="duotone" />
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              Esta funcionalidad está en <strong>fase de prueba</strong>. No se recomienda usar todavía en operativa real porque pueden perderse datos. El importe se registra pero no modifica el "pagado" original de la conversión (se calcula neto al leer).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Importe (€) *</label>
              <input
                type="number" step="0.01" min="0.01" max={pagado}
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                placeholder={pagado.toFixed(2)}
                className="w-full h-9 px-3 rounded-md border border-border bg-card text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Máx: {pagado.toFixed(2)}€</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 block">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-card text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">Motivo</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="¿Por qué se devuelve? (ej: cliente cancela, error de cobro...)"
              className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving}
            className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !importe}
            className="inline-flex items-center h-9 px-4 rounded-md bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Registrar devolución'}
          </button>
        </div>
      </div>
    </div>
  );
}
