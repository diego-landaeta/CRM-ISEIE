import { useEffect, useId, useRef, useState } from 'react';
import { X, ShoppingCart } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import Portal from '@/shared/components/ui/portal';
import SearchableSelect from '@/shared/components/ui/SearchableSelect';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import { toast } from '@/shared/hooks/useToast';
import { formatCurrency, formatDate } from '@/shared/lib/format';
import VentaYaExisteAviso, { ventaYaExistente, type VentaExistente } from '@/modules/conversions/components/VentaYaExisteAviso';
import type { CargoSinEnlazar } from './tipos';

/*
  «CREAR LA VENTA» DESDE UN CARGO DE STRIPE (CRM#906).

  El alumno y el importe vienen del cargo; quien lo hace elige el programa y la
  vendedora. El servidor crea la venta y le apunta el cobro con el cargo, que
  queda enlazado. Si el alumno ya tiene una venta de ese programa, el aviso de
  venta repetida (CRM#898) ofrece apuntar el cobro en esa venta o crear otra.
*/

interface Opciones {
  productos: { id: number; nombre: string; precio: number | null }[];
  vendedoras: { id: number; nombre: string; role: string }[];
}

interface Props {
  cargo: CargoSinEnlazar;
  onClose: () => void;
  onHecho: () => void;
}

const entrada = 'h-9 w-full rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export default function CrearVentaDialog({ cargo, onClose, onHecho }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null);
  const [productoId, setProductoId] = useState('');
  const [vendedoraId, setVendedoraId] = useState(cargo.ficha?.responsable_id ? String(cargo.ficha.responsable_id) : '');
  const [nombre, setNombre] = useState(cargo.customer_name || '');
  const [email, setEmail] = useState(cargo.customer_email || '');
  const [total, setTotal] = useState(String(cargo.importe));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repetida, setRepetida] = useState<VentaExistente | null>(null);
  useModalAccesible(ref, { open: !repetida, onClose, bloqueado: enviando });

  useEffect(() => {
    let vivo = true;
    client.get<Opciones>(`/stripe-payments/conciliacion/opciones?projectId=${cargo.project_id}`)
      .then((r) => { if (vivo) setOpciones(r.data as Opciones); })
      .catch((e) => { if (vivo) setErrorOpciones(e?.data?.error || e?.message || 'No se pudieron cargar los programas'); });
    return () => { vivo = false; };
  }, [cargo.project_id]);

  const totalNum = Number(String(total).replace(',', '.'));
  const totalMal = !(totalNum > 0) || totalNum + 0.005 < Number(cargo.importe);
  const listo = Boolean(productoId && vendedoraId && !totalMal && (cargo.ficha || nombre.trim()));

  async function crear(forzar = false) {
    setEnviando(true); setError(null);
    try {
      await client.post(`/stripe-payments/${cargo.id}/crear-venta`, {
        productoId: Number(productoId),
        vendedoraId: Number(vendedoraId),
        importeTotal: totalNum,
        ...(cargo.ficha ? {} : { nombre: nombre.trim(), email: email.trim() || null }),
        ...(forzar ? { forzar: true } : {}),
      });
      toast({ title: 'Venta creada', description: `Con el cobro de ${formatCurrency(cargo.importe)} del cargo de Stripe ya enlazado.` });
      onHecho();
    } catch (e: unknown) {
      const existente = ventaYaExistente(e);
      if (existente) { setRepetida(existente); return; }
      const err = e as { data?: { error?: string }; message?: string };
      setError(err?.data?.error || err?.message || 'No se pudo crear la venta');
    } finally { setEnviando(false); }
  }

  /** «Apuntar el cobro en esa venta» desde el aviso: el cargo se enlaza con la venta que existe. */
  async function apuntarEnLaQueExiste(v: VentaExistente) {
    await client.post(`/stripe-payments/${cargo.id}/link`, { conversionId: v.id, leadId: v.lead_id });
    toast({ title: 'Cobro apuntado', description: `En la venta ${v.id}${v.alumno ? ` de ${v.alumno}` : ''}.` });
  }

  if (repetida) {
    return (
      <VentaYaExisteAviso
        venta={repetida}
        onCancelar={() => setRepetida(null)}
        onCrearIgualmente={async () => { setRepetida(null); await crear(true); }}
        onApuntarCobro={apuntarEnLaQueExiste}
        onCobroApuntado={onHecho}
      />
    );
  }

  const productos = (opciones?.productos || []).map((p) => ({ value: String(p.id), label: p.nombre }));

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-end sm:items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={() => !enviando && onClose()} />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId}
          className="relative bg-card sm:rounded-lg border border-border w-full max-w-lg max-h-[92vh] flex flex-col">
          <div className="px-5 pt-5 pb-3 flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <ShoppingCart size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="text-base font-semibold">Crear la venta</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Con el cobro de <strong className="text-foreground tabular-nums">{formatCurrency(cargo.importe)}</strong> del {formatDate(cargo.fecha)} ya apuntado y enlazado.
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={enviando} aria-label="Cerrar"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0">
              <X size={16} />
            </button>
          </div>

          <form className="px-5 pb-4 space-y-3 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); if (listo && !enviando) crear(); }}>
            {cargo.ficha ? (
              <p className="text-sm bg-muted/50 rounded-md p-2.5">
                <span className="text-muted-foreground">Alumno:</span> <strong>{cargo.ficha.nombre}</strong>
                <span className="block text-xs text-muted-foreground">Ya tiene ficha con este correo: la venta va en ella.</span>
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="block mb-1 font-medium">Alumno</span>
                  <input className={entrada} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={200} autoComplete="off" />
                </label>
                <label className="block text-sm">
                  <span className="block mb-1 font-medium">Correo</span>
                  <input className={entrada} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="off" />
                </label>
              </div>
            )}

            <div className="text-sm">
              <span className="block mb-1 font-medium" id={`${tituloId}-programa`}>Programa</span>
              <SearchableSelect value={productoId} onChange={setProductoId} options={productos}
                allLabel={opciones ? 'Elige el programa' : 'Cargando…'} placeholder="Buscar programa…"
                ariaLabel="Programa" maxWidth="100%" />
            </div>

            <label className="block text-sm">
              <span className="block mb-1 font-medium">Vendedora</span>
              <select className={entrada} value={vendedoraId} onChange={(e) => setVendedoraId(e.target.value)} required>
                <option value="">Elige la vendedora</option>
                {(opciones?.vendedoras || []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </label>

            <label className="block text-sm">
              <span className="block mb-1 font-medium">Total de la venta</span>
              <input className={entrada} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={totalMal} />
              <span className={`block mt-1 text-xs ${totalMal ? 'text-destructive' : 'text-muted-foreground'}`}>
                {totalMal ? `No puede ser menor que lo cobrado (${formatCurrency(cargo.importe)}).` : 'Si es un pago a plazos, pon el total del programa: lo que falta queda pendiente.'}
              </span>
            </label>

            {errorOpciones && <p role="alert" className="text-sm text-destructive">{errorOpciones}</p>}
            {error && <p role="alert" className="text-sm bg-destructive-soft text-destructive-soft-foreground rounded-md p-2.5">{error}</p>}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>

          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button type="button" onClick={onClose} disabled={enviando}
              className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={() => crear()} disabled={!listo || enviando}
              className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {enviando ? 'Creando…' : 'Crear la venta'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
