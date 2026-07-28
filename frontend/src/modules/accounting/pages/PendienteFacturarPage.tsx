// PendienteFacturarPage — lista de ventas creadas por el backfill (importe 0)
// o cualquier conversion con importe_total = 0, para que las gestoras las
// completen con el importe real.

import { useState, useEffect, useCallback } from 'react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { Receipt, PencilSimple, X, FloppyDisk, ArrowSquareOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';

interface Conversion {
  id: number;
  lead_id: number;
  lead_nombre?: string;
  lead_email?: string;
  producto_contratado?: string | null;
  producto_contratado_id?: number | null;
  importe_total: number | string;
  importe_pagado: number | string;
  fecha_conversion?: string;
  metodo_pago?: string | null;
  notas_pago?: string | null;
  proyecto_nombre?: string;
}

const PAYMENT_METHODS = [
  { value: '', label: '— Sin especificar —' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'fraccionado', label: 'Fraccionado' },
];

function fmt(n: number | string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

const PER_PAGE = 50;

export default function PendienteFacturarPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const navigate = useNavigate();
  const [items, setItems] = useState<Conversion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Conversion | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      // Paginado: antes pedia 100 y el contador mentia en cuanto habia mas.
      const res = await client.get<Conversion[]>(
        `/conversions?projectId=${activeProject.id}&pendingBilling=true&page=${page}&limit=${PER_PAGE}`
      );
      if (res.success) {
        setItems(res.data || []);
        setTotal(((res as { pagination?: { total?: number } }).pagination?.total) ?? (res.data?.length || 0));
      }
    } catch (err) {
      const e = err as { message?: string };
      toast({ title: 'Error', description: e?.message || 'No se pudo cargar la lista', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [activeProject?.id, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [activeProject?.id]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Pendientes de facturar"
        subtitle={`Ventas registradas sin importe — completar para que aparezcan en facturación${activeProject?.nombre ? ` (${activeProject.nombre})` : ''}`}
      />

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-sm">
        <p className="text-amber-900 dark:text-amber-300">
          <strong>¿Por qué aparecen aquí?</strong> Estas ventas existen porque el lead se marcó como "convertido" sin
          que se registrara el importe. Edita cada una para añadir el precio real y se reflejará en el dashboard
          financiero.
        </p>
      </div>

      {loading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <EmptyState
            icon={Receipt}
            title="No hay ventas pendientes"
            description="Todas las conversiones tienen importe registrado. Cuando una venta nueva quede sin importe aparecerá aquí."
          />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{total}</strong> ventas sin importe en este proyecto.
          </p>

          {/* Tabla escritorio */}
          <div className="hidden lg:block bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Programa</th>
                  <th className="text-left px-4 py-2.5 font-bold">Fecha conversión</th>
                  <th className="text-right px-4 py-2.5 font-bold">Importe actual</th>
                  <th className="text-right px-4 py-2.5 font-bold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/leads/${c.lead_id}`)} className="font-semibold text-primary hover:underline">
                        {c.lead_nombre || `Lead #${c.lead_id}`}
                      </button>
                      {c.lead_email && <p className="text-xs text-muted-foreground">{c.lead_email}</p>}
                    </td>
                    <td className="px-4 py-3">{c.producto_contratado || <span className="italic text-muted-foreground">Sin programa</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(c.fecha_conversion)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-700 dark:text-amber-400">
                      {fmt(c.importe_total)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditing(c)}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
                      >
                        <PencilSimple size={13} weight="bold" /> Completar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards mobile */}
          <div className="lg:hidden space-y-2">
            {items.map((c) => (
              <div key={c.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
                <div>
                  <button onClick={() => navigate(`/leads/${c.lead_id}`)} className="font-semibold text-primary hover:underline">
                    {c.lead_nombre || `Lead #${c.lead_id}`}
                  </button>
                  {c.lead_email && <p className="text-xs text-muted-foreground">{c.lead_email}</p>}
                </div>
                <p className="text-xs text-muted-foreground">{c.producto_contratado || 'Sin programa'} · {fmtDate(c.fecha_conversion)}</p>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold tabular-nums text-amber-700">{fmt(c.importe_total)}</span>
                  <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                    <PencilSimple size={13} weight="bold" /> Completar
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1 text-sm">
              <span className="text-muted-foreground">
                {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de {total}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}
                  className="h-8 px-3 rounded-md border border-border disabled:opacity-40 hover:bg-muted">Anterior</button>
                <span className="text-muted-foreground tabular-nums">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
                  className="h-8 px-3 rounded-md border border-border disabled:opacity-40 hover:bg-muted">Siguiente</button>
              </div>
            </div>
          )}
        </>
      )}

      {editing && (
        <EditDialog
          conversion={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Dialog de edición ────────────────────────────────────────────────────
function EditDialog({ conversion, onClose, onSaved }: { conversion: Conversion; onClose: () => void; onSaved: () => void }) {
  const [importeTotal, setImporteTotal] = useState(String(conversion.importe_total || ''));
  const [importePagado, setImportePagado] = useState(String(conversion.importe_pagado || ''));
  const [metodo, setMetodo] = useState(conversion.metodo_pago || '');
  const [producto, setProducto] = useState(conversion.producto_contratado || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    const total = parseFloat(importeTotal);
    const pagado = parseFloat(importePagado || '0');
    if (!isFinite(total) || total <= 0) {
      toast({ title: 'Importe inválido', description: 'El importe total debe ser > 0', variant: 'destructive' });
      return;
    }
    if (pagado > total) {
      toast({ title: 'Importe pagado inválido', description: 'No puede ser mayor que el total', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        importe_total: total,
        importe_pagado: pagado,
        producto_contratado: producto.trim() || conversion.producto_contratado || 'Sin programa',
      };
      if (metodo) body.metodo_pago = metodo;
      await client.patch(`/conversions/${conversion.id}`, body);
      toast({ title: 'Venta actualizada', description: 'Ya aparece en facturación' });
      onSaved();
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div role="dialog" aria-modal="true" className="relative bg-card rounded-lg border border-border w-full max-w-md flex flex-col">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <Receipt size={18} weight="regular" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base">Completar venta</h3>
              <p className="text-xs text-muted-foreground truncate">{conversion.lead_nombre} · {fmtDate(conversion.fecha_conversion)}</p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={18} /></button>
          </div>
          <div className="p-5 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Programa contratado</label>
              <input
                value={producto}
                onChange={(e) => setProducto(e.target.value)}
                placeholder="Nombre del programa..."
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Importe total *</label>
                <input
                  type="number" min="0" step="0.01" value={importeTotal}
                  onChange={(e) => setImporteTotal(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Importe pagado</label>
                <input
                  type="number" min="0" step="0.01" value={importePagado}
                  onChange={(e) => setImportePagado(e.target.value)}
                  placeholder={importeTotal || '0'}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Método de pago</label>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm">
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <a
              href={`/leads/${conversion.lead_id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowSquareOut size={11} weight="bold" /> Ver perfil del cliente
            </a>
          </div>
          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button onClick={onClose} disabled={saving}
              className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={save} disabled={saving}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              <FloppyDisk size={13} weight="bold" /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
