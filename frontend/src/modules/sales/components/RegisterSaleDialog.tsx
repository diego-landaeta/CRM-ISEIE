import { useEffect, useState } from 'react';
import { Receipt, X, MagnifyingGlass, UserCheck, UserPlus } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import Portal from '@/shared/components/ui/portal';

interface Product { id: number; nombre: string; precio?: number | string; moneda?: string }
interface Project { id: number; nombre?: string }
interface LeadLite { id: number; nombre?: string; email?: string; telefono?: string; status?: string }
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

type Mode = 'existing' | 'new';

export default function RegisterSaleDialog({ open, onClose, project, onSaved }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<Mode>('existing');

  // Cliente nuevo
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');

  // Cliente existente (búsqueda)
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<LeadLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<LeadLite | null>(null);

  // Venta
  const [productoId, setProductoId] = useState<number | ''>('');
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [importeTotal, setImporteTotal] = useState<string>('');
  const [importePagado, setImportePagado] = useState<string>('');
  const [metodo, setMetodo] = useState('transferencia');
  const [fecha, setFecha] = useState(today);
  const [notas, setNotas] = useState('');

  // Pagos fraccionados (cuotas). Se activan al seleccionar metodo='fraccionado'.
  // Por defecto generamos N cuotas mensuales desde la fecha de pago, distribuyendo
  // el total a partes iguales (la última absorbe la diferencia para que sumen
  // exactamente el importe_total — contablemente correcto).
  const [numCuotas, setNumCuotas] = useState(3);
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState(today);
  const [installments, setInstallments] = useState<Array<{ importe_previsto: string; fecha_vencimiento: string }>>([]);
  const [installmentsDirty, setInstallmentsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('existing');
    setNombre(''); setEmail(''); setTelefono('');
    setClientSearch(''); setClientResults([]); setSelectedClient(null);
    setProductoId(''); setProductSearch('');
    setImporteTotal(''); setImportePagado(''); setMetodo('transferencia');
    setFecha(today); setNotas('');
  }, [open, today]);

  // Productos del proyecto
  useEffect(() => {
    if (!open || !project?.id) return;
    client.get<Product[]>('/products', { params: { projectId: project.id, limit: 500 } })
      .then((r) => setProducts(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setProducts([]));
  }, [open, project?.id]);

  // Búsqueda debounced de clientes existentes (leads convertidos del proyecto)
  useEffect(() => {
    if (mode !== 'existing' || !open || !project?.id) return;
    if (clientSearch.trim().length < 2) { setClientResults([]); return; }
    const handle = setTimeout(() => {
      setSearching(true);
      client.get<LeadLite[]>('/leads', { params: { projectId: project.id, status: 'convertido', search: clientSearch.trim(), limit: 20 } })
        .then((r) => setClientResults(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setClientResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [mode, open, project?.id, clientSearch]);

  const productoSel = products.find((p) => p.id === productoId);
  useEffect(() => {
    if (productoSel && !importeTotal && productoSel.precio) setImporteTotal(String(productoSel.precio));
  }, [productoSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helpers para pagos fraccionados (cuotas)
  function addMonths(isoDate: string, months: number): string {
    const d = new Date(isoDate);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function distributeInstallments(total: number, n: number, fechaInicio: string): Array<{ importe_previsto: string; fecha_vencimiento: string }> {
    if (!isFinite(total) || total <= 0 || n < 2) return [];
    const cuotaBase = Math.round((total / n) * 100) / 100;
    const result = [];
    for (let i = 0; i < n; i++) {
      const importe = i === n - 1
        ? Math.round((total - cuotaBase * (n - 1)) * 100) / 100
        : cuotaBase;
      result.push({ importe_previsto: String(importe), fecha_vencimiento: addMonths(fechaInicio, i) });
    }
    return result;
  }
  // Regenerar cuotas cuando cambien total / N / fecha inicio (si el user no las
  // ha editado a mano).
  useEffect(() => {
    if (metodo !== 'fraccionado') return;
    if (installmentsDirty) return;
    const totalNum = parseFloat(importeTotal);
    if (!totalNum || totalNum <= 0 || numCuotas < 2) { setInstallments([]); return; }
    setInstallments(distributeInstallments(totalNum, numCuotas, fechaPrimeraCuota));
  }, [metodo, importeTotal, numCuotas, fechaPrimeraCuota, installmentsDirty]);
  // Si cambia metodo a fraccionado, inicializa la fecha de primera cuota con la fecha del pago.
  useEffect(() => {
    if (metodo === 'fraccionado') {
      setFechaPrimeraCuota(fecha);
      setInstallmentsDirty(false);
    }
  }, [metodo]); // eslint-disable-line react-hooks/exhaustive-deps

  const installmentsSum = installments.reduce((acc, it) => acc + (parseFloat(it.importe_previsto) || 0), 0);
  const installmentsMismatch = metodo === 'fraccionado' && installments.length > 0
    && Math.abs(installmentsSum - parseFloat(importeTotal || '0')) > 0.01;

  if (!open) return null;

  const productosFiltrados = productSearch.trim()
    ? products.filter((p) => p.nombre.toLowerCase().includes(productSearch.toLowerCase()))
    : products;
  const isRetroactiva = fecha < today;

  function selectClient(c: LeadLite) {
    setSelectedClient(c);
    setNombre(c.nombre || '');
    setEmail(c.email || '');
    setTelefono(c.telefono || '');
    setClientSearch('');
    setClientResults([]);
  }
  function clearSelectedClient() {
    setSelectedClient(null);
    setNombre(''); setEmail(''); setTelefono('');
  }

  async function handleSave() {
    if (!project?.id) { toast({ title: 'Selecciona un proyecto', variant: 'destructive' }); return; }
    if (mode === 'existing' && !selectedClient) {
      toast({ title: 'Selecciona un cliente', description: 'Búscalo por nombre, email o teléfono.', variant: 'destructive' }); return;
    }
    if (mode === 'new') {
      if (!nombre.trim()) { toast({ title: 'Nombre requerido', variant: 'destructive' }); return; }
      if (!email.trim() && !telefono.trim()) {
        toast({ title: 'Email o teléfono requerido', variant: 'destructive' }); return;
      }
    }
    if (!productoId) { toast({ title: 'Producto requerido', variant: 'destructive' }); return; }
    const totalNum = parseFloat(importeTotal);
    if (!totalNum || totalNum <= 0) { toast({ title: 'Importe inválido', variant: 'destructive' }); return; }
    const pagadoNum = importePagado === '' ? totalNum : parseFloat(importePagado);
    if (pagadoNum < 0 || pagadoNum > totalNum) {
      toast({ title: 'Importe pagado inválido', description: 'Entre 0 y el total', variant: 'destructive' }); return;
    }
    // Validación específica de cuotas
    if (metodo === 'fraccionado') {
      if (installments.length < 2) {
        toast({ title: 'Cuotas requeridas', description: 'Configura al menos 2 cuotas o cambia el método.', variant: 'destructive' });
        return;
      }
      if (installmentsMismatch) {
        toast({ title: 'Las cuotas no suman el total', description: `Suma actual: ${installmentsSum.toFixed(2)} · Total: ${totalNum.toFixed(2)}`, variant: 'destructive' });
        return;
      }
      for (const it of installments) {
        const imp = parseFloat(it.importe_previsto);
        if (!isFinite(imp) || imp <= 0) {
          toast({ title: 'Cuota inválida', description: 'Todas las cuotas necesitan importe > 0', variant: 'destructive' });
          return;
        }
        if (!it.fecha_vencimiento) {
          toast({ title: 'Fecha de cuota faltante', variant: 'destructive' });
          return;
        }
      }
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        project_id: project.id,
        producto_interes_id: productoId,
        importe_total: totalNum,
        importe_pagado: pagadoNum,
        metodo_pago: metodo,
        fecha_pago: fecha,
        notas: notas.trim() || null,
      };
      if (metodo === 'fraccionado' && installments.length >= 2) {
        body.installments = installments.map(it => ({
          importe_previsto: parseFloat(it.importe_previsto),
          fecha_vencimiento: it.fecha_vencimiento,
        }));
      }
      if (mode === 'existing' && selectedClient) {
        body.lead_id = selectedClient.id;
      } else {
        body.nombre = nombre.trim();
        body.email = email.trim() || null;
        body.telefono = telefono.trim() || null;
      }
      const res = await client.post<{ sale_id: number; lead_id: number; retroactiva: boolean; duplicado: boolean }>('/sales', body);
      const data = res.data;
      const desc = mode === 'existing'
        ? `Venta añadida al cliente existente${data.retroactiva ? ' (histórica)' : ''}`
        : (data.retroactiva ? `Venta histórica registrada (${fecha})${data.duplicado ? ' — sobre cliente existente' : ''}` : `Venta registrada${data.duplicado ? ' — sobre cliente existente' : ''}`);
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
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={18} /></button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Toggle: existente / nuevo */}
            <div className="bg-muted/40 p-1 rounded-lg grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => { setMode('existing'); clearSelectedClient(); }}
                className={`h-9 rounded-md text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'existing' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <UserCheck size={14} weight="bold" /> Cliente existente
              </button>
              <button
                type="button"
                onClick={() => { setMode('new'); clearSelectedClient(); }}
                className={`h-9 rounded-md text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'new' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <UserPlus size={14} weight="bold" /> Cliente nuevo
              </button>
            </div>

            {/* MODO: cliente existente */}
            {mode === 'existing' && (
              <div className="space-y-3">
                {!selectedClient ? (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Buscar cliente *</label>
                    <div className="relative">
                      <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Nombre, email o teléfono…"
                        className="w-full h-10 pl-9 pr-3 rounded-md border border-border bg-card text-sm"
                      />
                    </div>
                    {clientSearch.trim().length > 0 && clientSearch.trim().length < 2 && (
                      <p className="text-[11px] text-muted-foreground mt-1">Escribe al menos 2 caracteres…</p>
                    )}
                    {searching && <p className="text-[11px] text-muted-foreground mt-1">Buscando…</p>}
                    {!searching && clientSearch.trim().length >= 2 && clientResults.length === 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        No se encontraron clientes. ¿Quizás es <button type="button" onClick={() => setMode('new')} className="text-primary font-semibold hover:underline">un cliente nuevo</button>?
                      </p>
                    )}
                    {clientResults.length > 0 && (
                      <div className="mt-1.5 border border-border rounded-md max-h-48 overflow-y-auto">
                        {clientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-0 border-border"
                          >
                            <p className="font-medium truncate">{c.nombre || '— sin nombre —'}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{c.email || '—'} {c.telefono ? `· ${c.telefono}` : ''}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-md p-3 flex items-start gap-3">
                    <UserCheck size={20} weight="duotone" className="text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{selectedClient.nombre || '— sin nombre —'}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{selectedClient.email || '—'} {selectedClient.telefono ? `· ${selectedClient.telefono}` : ''}</p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">Cliente seleccionado — se le añadirá una nueva venta.</p>
                    </div>
                    <button type="button" onClick={clearSelectedClient} className="text-[11px] text-muted-foreground hover:text-foreground underline flex-shrink-0">
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* MODO: cliente nuevo */}
            {mode === 'new' && (
              <div className="space-y-3">
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
              </div>
            )}

            {/* Producto + importes (común a ambos modos) */}
            <div className="border-t border-border pt-3 space-y-3">
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

              {/* Cuotas — solo cuando método es fraccionado */}
              {metodo === 'fraccionado' && (
                <div className="space-y-3 p-3 rounded-md border border-border bg-muted/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan de cuotas</span>
                    <button type="button"
                      onClick={() => { setInstallmentsDirty(false); }}
                      className="text-[10px] text-primary hover:underline">
                      Auto-distribuir
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">N° de cuotas</label>
                      <input type="number" min={2} max={36} value={numCuotas}
                        onChange={(e) => { setNumCuotas(parseInt(e.target.value) || 2); setInstallmentsDirty(false); }}
                        className="w-full h-9 px-3 rounded-md border border-border bg-card text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">1ª fecha de vencimiento</label>
                      <input type="date" value={fechaPrimeraCuota}
                        onChange={(e) => { setFechaPrimeraCuota(e.target.value); setInstallmentsDirty(false); }}
                        className="w-full h-9 px-3 rounded-md border border-border bg-card text-sm" />
                    </div>
                  </div>
                  {installments.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-[40px_1fr_1fr] gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
                        <span>#</span><span>Vencimiento</span><span className="text-right">Importe €</span>
                      </div>
                      {installments.map((it, idx) => (
                        <div key={idx} className="grid grid-cols-[40px_1fr_1fr] gap-2 items-center">
                          <span className="text-xs text-muted-foreground px-1">{idx + 1}</span>
                          <input type="date" value={it.fecha_vencimiento}
                            onChange={(e) => {
                              const next = [...installments];
                              next[idx] = { ...next[idx], fecha_vencimiento: e.target.value };
                              setInstallments(next); setInstallmentsDirty(true);
                            }}
                            className="h-8 px-2 rounded border border-border bg-card text-xs" />
                          <input type="number" min="0" step="0.01" value={it.importe_previsto}
                            onChange={(e) => {
                              const next = [...installments];
                              next[idx] = { ...next[idx], importe_previsto: e.target.value };
                              setInstallments(next); setInstallmentsDirty(true);
                            }}
                            className="h-8 px-2 rounded border border-border bg-card text-xs text-right" />
                        </div>
                      ))}
                      <div className={`text-[11px] text-right pt-1 ${installmentsMismatch ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                        Suma: {installmentsSum.toFixed(2)} € · Total: {(parseFloat(importeTotal) || 0).toFixed(2)} €
                        {installmentsMismatch && ' ⚠ no coinciden'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notas (opcional)</label>
                <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                  placeholder="Comentarios sobre la venta…"
                  className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none" />
              </div>
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
