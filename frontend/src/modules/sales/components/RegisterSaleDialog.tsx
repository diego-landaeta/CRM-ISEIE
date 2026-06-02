import { useEffect, useState } from 'react';
import { Receipt, X } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import Portal from '@/shared/components/ui/portal';

interface Product { id: number; nombre: string; precio?: number | string; moneda?: string }
interface Project { id: number; nombre?: string }
interface Props {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  onSaved?: (result: { sale_id: number; lead_id: number; retroactiva: boolean }) => void;
}

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'fraccionado', label: 'Fraccionado' },
];

export default function RegisterSaleDialog({ open, onClose, project, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [productoId, setProductoId] = useState<number | ''>('');
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [importeTotal, setImporteTotal] = useState<string>('');
  const [importePagado, setImportePagado] = useState<string>('');
  const [metodo, setMetodo] = useState('transferencia');
  const [fecha, setFecha] = useState(today);
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNombre(''); setEmail(''); setTelefono(''); setProductoId(''); setProductSearch('');
    setImporteTotal(''); setImportePagado(''); setMetodo('transferencia');
    setFecha(today); setNotas('');
  }, [open, today]);

  useEffect(() => {
    if (!open || !project?.id) return;
    client.get<Product[]>('/products', { params: { projectId: project.id, limit: 500 } })
      .then((r) => setProducts(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setProducts([]));
  }, [open, project?.id]);

  const productoSel = products.find((p) => p.id === productoId);

  // Si el usuario eligió producto pero no puso importe, sugerir precio del producto.
  // IMPORTANTE: este effect va ANTES del early return para no violar Rules of Hooks.
  useEffect(() => {
    if (productoSel && !importeTotal && productoSel.precio) {
      setImporteTotal(String(productoSel.precio));
    }
  }, [productoSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const productosFiltrados = productSearch.trim()
    ? products.filter((p) => p.nombre.toLowerCase().includes(productSearch.toLowerCase()))
    : products;
  const isRetroactiva = fecha < today;

  async function handleSave() {
    if (!project?.id) { toast({ title: 'Selecciona un proyecto', variant: 'destructive' }); return; }
    if (!nombre.trim()) { toast({ title: 'Nombre requerido', variant: 'destructive' }); return; }
    if (!email.trim() && !telefono.trim()) {
      toast({ title: 'Email o teléfono requerido', variant: 'destructive' }); return;
    }
    if (!productoId) { toast({ title: 'Producto requerido', variant: 'destructive' }); return; }
    const totalNum = parseFloat(importeTotal);
    if (!totalNum || totalNum <= 0) { toast({ title: 'Importe inválido', variant: 'destructive' }); return; }
    const pagadoNum = importePagado === '' ? totalNum : parseFloat(importePagado);
    if (pagadoNum < 0 || pagadoNum > totalNum) {
      toast({ title: 'Importe pagado inválido', description: 'Debe estar entre 0 y el total', variant: 'destructive' }); return;
    }

    setSaving(true);
    try {
      const res = await client.post<{ sale_id: number; lead_id: number; retroactiva: boolean; duplicado: boolean }>(
        '/sales',
        {
          project_id: project.id,
          nombre: nombre.trim(),
          email: email.trim() || null,
          telefono: telefono.trim() || null,
          producto_interes_id: productoId,
          importe_total: totalNum,
          importe_pagado: pagadoNum,
          metodo_pago: metodo,
          fecha_pago: fecha,
          notas: notas.trim() || null,
        }
      );
      const data = res.data;
      const desc = data.retroactiva
        ? `Venta histórica registrada (${fecha})${data.duplicado ? ' — sobre cliente existente' : ''}`
        : `Venta registrada${data.duplicado ? ' — sobre cliente existente' : ''}`;
      toast({ title: 'Venta creada', description: desc });
      onSaved?.(data);
      onClose();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: e?.data?.error || e?.message || 'No se pudo registrar', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div role="dialog" aria-modal="true" className="relative bg-card rounded-lg border border-border w-full max-w-lg flex flex-col max-h-[90vh]">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <Receipt size={18} weight="regular" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base">Registrar venta</h3>
              <p className="text-xs text-muted-foreground">
                Por la fecha que pongas se considera <strong>histórica</strong> (anterior a hoy) o <strong>del día</strong>.
                Crea cliente + conversión + pago en un solo paso.
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={18} /></button>
          </div>

          <div className="p-5 space-y-3 overflow-y-auto">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre del cliente *</label>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
                <input value={telefono} onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+34..."
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">Requerido al menos uno de los dos.</p>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Producto *</label>
              <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Buscar producto…"
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm mb-1.5" />
              <select value={productoId} onChange={(e) => setProductoId(e.target.value ? Number(e.target.value) : '')}
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm">
                <option value="">— Selecciona —</option>
                {productosFiltrados.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.precio ? ` (${p.precio} ${p.moneda || ''})` : ''}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Importe total *</label>
                <input type="number" min="0" step="0.01" value={importeTotal}
                  onChange={(e) => setImporteTotal(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Importe pagado</label>
                <input type="number" min="0" step="0.01" value={importePagado}
                  onChange={(e) => setImportePagado(e.target.value)}
                  placeholder={`Por defecto: ${importeTotal || 'igual al total'}`}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Método de pago</label>
                <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm">
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Fecha de pago *
                  {isRetroactiva && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">Histórica</span>}
                </label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={today}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notas (opcional)</label>
              <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                placeholder="Comentarios sobre la venta…"
                className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none" />
            </div>
          </div>

          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button onClick={onClose} disabled={saving}
              className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Registrar venta'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
