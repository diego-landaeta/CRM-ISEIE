import { useState, useEffect } from 'react';
import { X, Plus, Trash, FloppyDisk } from '@phosphor-icons/react';
import { invoicesApi, type Invoice, type InvoiceItem } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

interface Props {
  invoiceId: number;
  onClose: () => void;
  onSaved?: () => void;
}

// Corrección de una factura ya emitida/pagada (solo admin/superadmin): IVA,
// datos del cliente y concepto/importe de las líneas. Mantiene el número fiscal.
export default function EditInvoiceDialog({ invoiceId, onClose, onSaved }: Props) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [exento, setExento] = useState(true);
  const [ivaPct, setIvaPct] = useState(21);
  const [ivaIncluido, setIvaIncluido] = useState(false);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [cli, setCli] = useState({ nombre: '', nif: '', direccion: '', ciudad: '', cp: '', pais: '', email: '', telefono: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await invoicesApi.getOne(invoiceId);
        if (!alive) return;
        if (res.success && res.data) {
          const d = res.data;
          setInv(d);
          setExento(Number(d.iva_pct) === 0);
          setIvaPct(Number(d.iva_pct) || 21);
          setIvaIncluido(!!d.iva_incluido);
          setItems((d.items && d.items.length > 0)
            ? d.items.map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad) || 1, precio_unitario: Number(it.precio_unitario ?? (it as any).precio ?? 0) }))
            : [{ descripcion: '', cantidad: 1, precio_unitario: 0 }]);
          setCli({
            nombre: d.cliente_nombre || '', nif: d.cliente_nif || '', direccion: d.cliente_direccion || '',
            ciudad: d.cliente_ciudad || '', cp: d.cliente_cp || '', pais: d.cliente_pais || '',
            email: d.cliente_email || '', telefono: d.cliente_telefono || '',
          });
        }
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [invoiceId]);

  function setItem(i: number, patch: Partial<InvoiceItem>) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }
  const addItem = () => setItems(prev => [...prev, { descripcion: '', cantidad: 1, precio_unitario: 0 }]);
  const delItem = (i: number) => setItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const baseCalc = items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0);
  const ivaCalc = exento ? 0 : (ivaIncluido ? baseCalc - baseCalc / (1 + ivaPct / 100) : baseCalc * ivaPct / 100);
  const totalCalc = exento ? baseCalc : (ivaIncluido ? baseCalc : baseCalc + ivaCalc);

  async function save() {
    if (items.some(it => !String(it.descripcion).trim())) {
      toast({ title: 'Falta el concepto', description: 'Cada línea necesita una descripción.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await invoicesApi.corregir(invoiceId, {
        exento, ivaPct: exento ? 0 : ivaPct, ivaIncluido,
        items: items.map(it => ({ descripcion: String(it.descripcion).trim(), cantidad: Number(it.cantidad) || 1, precio_unitario: Number(it.precio_unitario) || 0 })),
        clienteNombre: cli.nombre, clienteNif: cli.nif, clienteDireccion: cli.direccion,
        clienteCiudad: cli.ciudad, clienteCp: cli.cp, clientePais: cli.pais,
        clienteEmail: cli.email, clienteTelefono: cli.telefono,
      });
      if (res.success) {
        toast({ title: '✓ Factura corregida', description: inv?.codigo || undefined });
        onSaved?.();
        onClose();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  const inputC = 'w-full h-9 px-2.5 rounded-md border border-border bg-card text-sm';

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="dialog" className="relative bg-card rounded-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 h-12 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-semibold text-sm">Editar factura {inv?.codigo ? `Nº ${inv.codigo}` : ''}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={16} weight="bold" /></button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : (
          <div className="p-5 space-y-4">
            {/* IVA */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={exento} onChange={e => setExento(e.target.checked)} />
                Exento de IVA (servicio académico)
              </label>
              {!exento && (
                <div className="flex items-center gap-3 flex-wrap">
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    IVA %
                    <input type="number" min="0" max="100" value={ivaPct} onChange={e => setIvaPct(Number(e.target.value) || 0)} className="w-20 h-8 px-2 rounded border border-border bg-card text-sm" />
                  </label>
                  <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <input type="checkbox" checked={ivaIncluido} onChange={e => setIvaIncluido(e.target.checked)} /> IVA incluido en el precio
                  </label>
                </div>
              )}
            </div>

            {/* Conceptos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-muted-foreground">Conceptos</span>
                <button onClick={addItem} className="text-xs text-primary hover:underline inline-flex items-center gap-1"><Plus size={12} weight="bold" /> Añadir línea</button>
              </div>
              {items.map((it, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input value={it.descripcion} onChange={e => setItem(i, { descripcion: e.target.value })} placeholder="Servicio académico: [programa]" className={inputC + ' flex-1'} />
                  <input type="number" min="1" value={it.cantidad} onChange={e => setItem(i, { cantidad: Number(e.target.value) || 1 })} className="w-16 h-9 px-2 rounded-md border border-border bg-card text-sm" title="Cantidad" />
                  <input type="number" step="0.01" min="0" value={it.precio_unitario} onChange={e => setItem(i, { precio_unitario: Number(e.target.value) || 0 })} className="w-24 h-9 px-2 rounded-md border border-border bg-card text-sm" title="Precio" />
                  <button onClick={() => delItem(i)} className="p-2 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600" title="Quitar"><Trash size={14} weight="bold" /></button>
                </div>
              ))}
              <div className="text-right text-xs text-muted-foreground space-y-0.5 pt-1">
                <div>Base: <span className="tabular-nums font-medium">{baseCalc.toFixed(2)} €</span></div>
                {!exento && <div>IVA ({ivaPct}%): <span className="tabular-nums font-medium">{ivaCalc.toFixed(2)} €</span></div>}
                <div className="text-sm text-foreground font-bold">Total: <span className="tabular-nums">{totalCalc.toFixed(2)} €</span></div>
              </div>
            </div>

            {/* Datos del cliente */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase text-muted-foreground">Datos del cliente</span>
              <div className="grid grid-cols-2 gap-2">
                <input value={cli.nombre} onChange={e => setCli({ ...cli, nombre: e.target.value })} placeholder="Nombre" className={inputC} />
                <input value={cli.nif} onChange={e => setCli({ ...cli, nif: e.target.value })} placeholder="NIF / DNI" className={inputC} />
                <input value={cli.direccion} onChange={e => setCli({ ...cli, direccion: e.target.value })} placeholder="Dirección" className={inputC + ' col-span-2'} />
                <input value={cli.ciudad} onChange={e => setCli({ ...cli, ciudad: e.target.value })} placeholder="Ciudad" className={inputC} />
                <input value={cli.cp} onChange={e => setCli({ ...cli, cp: e.target.value })} placeholder="Código postal" className={inputC} />
                <input value={cli.pais} onChange={e => setCli({ ...cli, pais: e.target.value })} placeholder="País" className={inputC} />
                <input value={cli.email} onChange={e => setCli({ ...cli, email: e.target.value })} placeholder="Email" className={inputC} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">Cancelar</button>
              <button onClick={save} disabled={saving} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 inline-flex items-center gap-1.5 disabled:opacity-50">
                <FloppyDisk size={15} weight="bold" /> {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
