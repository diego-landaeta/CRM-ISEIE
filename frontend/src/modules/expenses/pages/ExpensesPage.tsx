import { lazy, Suspense, useEffect, useState } from 'react';
import { expensesApi, type Expense, type ExpenseCategory } from '../api/expenses.api';
import { useProjectContext } from '@/contexts/ProjectContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import { Plus, X, Receipt, Trash, PencilSimple } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

const CATEGORIAS: ExpenseCategory[] = [
  'salarios',
  'alquiler',
  'proveedores',
  'software',
  'publicidad',
  'impuestos',
  'servicios',
  'mantenimiento',
  'otros',
];

const CAT_COLORS: Record<string, string> = {
  salarios: 'bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400',
  alquiler: 'bg-purple-100 text-purple-800 dark:bg-purple-950/30 dark:text-purple-400',
  proveedores: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400',
  software: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400',
  publicidad: 'bg-pink-100 text-pink-800 dark:bg-pink-950/30 dark:text-pink-400',
  impuestos: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400',
  servicios: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-400',
  mantenimiento: 'bg-orange-100 text-orange-800 dark:bg-orange-950/30 dark:text-orange-400',
  otros: 'bg-muted text-muted-foreground',
};

function fmt(n: number | string) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}
function formatDate(d?: string | null) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ExpensesPage() {
  const { activeProject } = useProjectContext();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [{ cat: filterCat }, setUrlFilter] = useUrlFilters({ cat: '' });
  const setFilterCat = (v: string) => setUrlFilter({ cat: v });
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (activeProject?.id) params.projectId = activeProject.id;
      if (filterCat) params.categoria = filterCat;
      const res = await expensesApi.list(params);
      if (res.success && res.data) setExpenses(res.data);
    } catch (err: any) {
      toast({ title: 'Error cargando egresos', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [activeProject?.id, filterCat]);

  function handleDelete(id: number) { setPendingDelete(id); }
  async function doDelete() {
    if (pendingDelete === null) return;
    try {
      await expensesApi.delete(pendingDelete);
      toast({ title: 'Egreso eliminado' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally { setPendingDelete(null); }
  }

  const total = expenses.reduce((s, e) => s + Number(e.importe), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gastos"
        subtitle={`${expenses.length} registros • Total: ${fmt(total)}`}
        actions={
          <button
            onClick={() => { setEditing(null); setDialogOpen(true); }}
            aria-label="Nuevo gasto"
            className="inline-flex items-center gap-2 h-9 px-3 sm:px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nuevo gasto</span>
          </button>
        }
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Filtrar:</span>
        <Select<string>
          value={filterCat}
          onChange={setFilterCat}
          options={[
            { value: '', label: 'Todas las categorías' },
            ...CATEGORIAS.map(c => ({ value: c, label: c })),
          ]}
          ariaLabel="Filtrar por categoría"
          className="w-48"
        />
      </div>

      {loading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : expenses.length === 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <EmptyState
            icon={Receipt}
            title="Sin gastos"
            description="No hay gastos registrados"
            action={
              <button
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <Plus size={14} weight="bold" /> Crear el primero
              </button>
            }
          />
        </div>
      ) : (
        <>
          {/* Tabla escritorio */}
          <div className="hidden lg:block bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-2.5 font-bold">Fecha</th>
                  <th className="text-left px-5 py-2.5 font-bold">Concepto</th>
                  <th className="text-left px-5 py-2.5 font-bold">Categoría</th>
                  <th className="text-left px-5 py-2.5 font-bold">Proyecto</th>
                  <th className="text-right px-5 py-2.5 font-bold">Importe</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3">{formatDate(e.fecha)}</td>
                    <td className="px-5 py-3 font-semibold">
                      {e.concepto}
                      {e.notas && <div className="text-xs text-muted-foreground font-normal mt-0.5">{e.notas}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${CAT_COLORS[e.categoria] || CAT_COLORS.otros}`}>
                        {e.categoria}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{e.proyecto_nombre || <span className="italic">General</span>}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-bold">{fmt(e.importe)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => { setEditing(e); setDialogOpen(true); }}
                          aria-label="Editar gasto"
                          className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <PencilSimple size={14} weight="bold" />
                        </button>
                        <button
                          onClick={() => handleDelete(e.id)}
                          aria-label="Eliminar gasto"
                          className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <Trash size={14} weight="bold" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards mobile */}
          <div className="lg:hidden space-y-2">
            {expenses.map(e => (
              <div key={e.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${CAT_COLORS[e.categoria] || CAT_COLORS.otros}`}>
                      {e.categoria}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{formatDate(e.fecha)}</span>
                  </div>
                  <p className="text-sm font-semibold truncate">{e.concepto}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {e.proyecto_nombre || 'General'}{e.notas ? ` · ${e.notas}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className="text-sm font-bold tabular-nums">{fmt(e.importe)}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setEditing(e); setDialogOpen(true); }}
                      aria-label="Editar gasto"
                      className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
                    >
                      <PencilSimple size={13} weight="bold" />
                    </button>
                    <button
                      onClick={() => handleDelete(e.id)}
                      aria-label="Eliminar gasto"
                      className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash size={13} weight="bold" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        expense={editing}
        activeProjectId={activeProject?.id}
        onSaved={() => load()}
      />
      {pendingDelete !== null && (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={pendingDelete !== null}
            title="¿Eliminar gasto?"
            message="Este registro será eliminado permanentemente."
            tone="destructive"
            confirmLabel="Eliminar"
            onConfirm={doDelete}
            onCancel={() => setPendingDelete(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

interface ExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  expense: Expense | null;
  activeProjectId?: number | null;
  onSaved?: () => void;
}

function ExpenseDialog({ open, onClose, expense, activeProjectId, onSaved }: ExpenseDialogProps) {
  useEscapeKey(onClose, open);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    concepto: string;
    importe: string;
    categoria: ExpenseCategory;
    fecha: string;
    project_id: number | null;
    notas: string;
  }>({
    concepto: '',
    importe: '',
    categoria: 'otros',
    fecha: new Date().toISOString().slice(0, 10),
    project_id: activeProjectId || null,
    notas: '',
  });

  useEffect(() => {
    if (open) {
      if (expense) {
        setForm({
          concepto: expense.concepto,
          importe: String(expense.importe),
          categoria: expense.categoria,
          fecha: String(expense.fecha).slice(0, 10),
          project_id: expense.project_id ?? null,
          notas: expense.notas || '',
        });
      } else {
        setForm({
          concepto: '',
          importe: '',
          categoria: 'otros',
          fecha: new Date().toISOString().slice(0, 10),
          project_id: activeProjectId || null,
          notas: '',
        });
      }
    }
  }, [open, expense, activeProjectId]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.concepto || !form.importe) return;
    setSaving(true);
    try {
      const payload = {
        concepto: form.concepto,
        importe: Number(form.importe),
        categoria: form.categoria,
        fecha: form.fecha,
        project_id: form.project_id || null,
        notas: form.notas || null,
      };
      if (expense) {
        await expensesApi.update(expense.id, payload);
        toast({ title: 'Gasto actualizado' });
      } else {
        await expensesApi.create(payload);
        toast({ title: 'Gasto registrado', description: fmt(payload.importe) });
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

  return (
    <Portal>
      <div role="dialog" className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border w-full max-w-md mx-4 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{expense ? 'Editar gasto' : 'Nuevo gasto'}</h2>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1.5 rounded-lg hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Concepto *</label>
              <input value={form.concepto} onChange={e => setForm({ ...form, concepto: e.target.value })} placeholder="Alquiler oficina, salarios enero..." className={inputClass} required autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Importe (EUR) *</label>
                <input type="number" step="0.01" min="0.01" value={form.importe} onChange={e => setForm({ ...form, importe: e.target.value })} className={inputClass + ' tabular-nums'} required />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Fecha *</label>
                <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} className={inputClass} required />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Categoría</label>
              <Select<ExpenseCategory>
                value={form.categoria}
                onChange={(v) => setForm({ ...form, categoria: v })}
                options={CATEGORIAS.map(c => ({ value: c, label: c }))}
                ariaLabel="Categoría"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notas</label>
              <textarea value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-muted/50 text-sm outline-none resize-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
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
                {saving ? 'Guardando...' : (expense ? 'Guardar' : 'Crear gasto')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
