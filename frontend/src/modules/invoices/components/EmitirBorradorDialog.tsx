import { useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

// Campo (fuera del componente para no perder el foco al re-render).
function F({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label} <span className="text-red-500">*</span></label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-full h-9 px-2 rounded border bg-background text-sm ${!value.trim() ? 'border-amber-400' : 'border-border'}`} />
    </div>
  );
}

// Diálogo "Validar y emitir": alerta de qué falta, permite completar los datos
// fiscales del cliente y emite (asigna número fiscal correlativo).
export default function EmitirBorradorDialog({ invoice, onClose, onEmitted }: { invoice: Invoice; onClose: () => void; onEmitted: (codigo: string, id: number) => void }) {
  const limpio = (v?: string | null) => (!v || String(v).trim() === '—' ? '' : String(v));
  const [nombre, setNombre] = useState(limpio(invoice.cliente_nombre));
  const [nif, setNif] = useState(limpio(invoice.cliente_nif));
  const [direccion, setDireccion] = useState(limpio(invoice.cliente_direccion));
  const [ciudad, setCiudad] = useState(limpio(invoice.cliente_ciudad));
  const [cp, setCp] = useState(limpio(invoice.cliente_cp));
  const [pais, setPais] = useState(limpio(invoice.cliente_pais) || 'España');
  const [working, setWorking] = useState(false);

  const completo = nombre.trim() && nif.trim() && direccion.trim() && ciudad.trim() && cp.trim() && pais.trim();

  async function emitir() {
    if (!completo) {
      toast({ title: 'Faltan datos', description: 'Completa todos los campos fiscales para emitir.', variant: 'destructive' });
      return;
    }
    setWorking(true);
    try {
      const res = await invoicesApi.emitir(invoice.id, {
        clienteNombre: nombre.trim(), clienteNif: nif.trim(), clienteDireccion: direccion.trim(),
        clienteCiudad: ciudad.trim(), clienteCp: cp.trim(), clientePais: pais.trim(),
      });
      if (res.success && res.data) onEmitted(res.data.codigo || '', invoice.id);
      else toast({ title: 'Error', description: (res as { error?: string }).error || 'No se pudo emitir', variant: 'destructive' });
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo emitir', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setWorking(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-base">Validar y emitir factura</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Borrador de <strong>{limpio(invoice.cliente_nombre) || 'cliente'}</strong> · {fmt(Number(invoice.total))}. Al emitir se asigna el número fiscal.
          </p>
        </div>
        <div className="p-4 space-y-3 text-sm">
          {!completo && (
            <div className="text-[11px] rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2">
              ⚠️ Para emitir la factura debes rellenar estos datos (marcados en ámbar).
            </div>
          )}
          <F label="Nombre" value={nombre} onChange={setNombre} />
          <div className="grid grid-cols-2 gap-3">
            <F label="NIF / DNI / CIF" value={nif} onChange={setNif} />
            <F label="Código postal" value={cp} onChange={setCp} />
          </div>
          <F label="Dirección fiscal" value={direccion} onChange={setDireccion} />
          <div className="grid grid-cols-2 gap-3">
            <F label="Ciudad" value={ciudad} onChange={setCiudad} />
            <F label="País" value={pais} onChange={setPais} />
          </div>
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={emitir} disabled={working || !completo}
            className="h-9 px-3 rounded-md bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1.5">
            <CheckCircle size={14} weight="bold" /> {working ? 'Emitiendo…' : 'Validar y emitir'}
          </button>
        </div>
      </div>
    </div>
  );
}
