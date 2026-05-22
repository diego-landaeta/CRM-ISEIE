import { useEffect, useState, type FormEvent } from 'react';
import { commissionsApi, type CommissionRule } from '../api/commissions.api';
import Portal from '@/shared/components/ui/portal';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import { Gear, X, Plus, Trash } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import type { User, Project } from '@/shared/types';

const inputClass = 'h-9 px-3 rounded-lg border border-border bg-card text-sm';

interface ProductOption {
  id: number;
  nombre: string;
}

interface NewRuleForm {
  project_id: string;
  user_id: string;
  product_id: string;
  pct: string;
  base_calc: 'cobrado' | 'vendido';
}

interface Props {
  onClose: () => void;
  onSaved?: () => void;
}

export default function RulesDialog({ onClose, onSaved }: Props) {
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState<NewRuleForm>({ project_id: '', user_id: '', product_id: '', pct: '', base_calc: 'cobrado' });
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const [r, u, pj] = await Promise.all([
        commissionsApi.listRules(),
        client.get('/users?active=true'),
        client.get('/projects'),
      ]);
      if (r.success) setRules(r.data || []);
      if (u.success) setUsers(((u.data?.users || u.data || []) as User[]).filter((x) => x.role === 'gestor' || x.role === 'admin'));
      if (pj.success) setProjects((pj.data as Project[]) || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!newRule.project_id) { setProducts([]); return; }
    (async () => {
      try {
        const r = await client.get(`/products/${newRule.project_id}`);
        if (r.success) setProducts((r.data as ProductOption[]) || []);
      } catch {}
    })();
  }, [newRule.project_id]);

  async function handleAdd(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!newRule.project_id || !newRule.user_id || newRule.pct === '') return;
    try {
      await commissionsApi.createRule({
        project_id: Number(newRule.project_id),
        user_id: Number(newRule.user_id),
        product_id: newRule.product_id ? Number(newRule.product_id) : null,
        pct: Number(newRule.pct),
        base_calc: newRule.base_calc || 'cobrado',
      });
      toast({ title: 'Regla guardada' });
      setNewRule({ project_id: '', user_id: '', product_id: '', pct: '', base_calc: 'cobrado' });
      await load();
      onSaved?.();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  function handleDelete(id: number): void { setPendingDelete(id); }
  async function doDelete(): Promise<void> {
    if (pendingDelete === null) return;
    try {
      await commissionsApi.deleteRule(pendingDelete);
      await load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
    finally { setPendingDelete(null); }
  }

  async function handleEditPct(rule: CommissionRule, newPct: string): Promise<void> {
    try {
      await commissionsApi.updateRule(rule.id, { pct: Number(newPct) });
      await load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card sm:rounded-lg border border-border w-full max-w-3xl flex flex-col h-full sm:h-auto sm:max-h-[90vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <h2 className="text-lg font-semibold">Reglas de comision</h2>
              <p className="text-xs text-muted-foreground">% que cobra cada gestor por cada producto/formacion</p>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded hover:bg-muted"><X size={18} /></button>
          </div>

          <div className="overflow-y-auto p-6 space-y-5">
            <form onSubmit={handleAdd} className="p-4 bg-muted/30 rounded-md border border-border space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Nueva regla</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <Select<string>
                  value={newRule.project_id}
                  onChange={(v) => setNewRule({ ...newRule, project_id: v, product_id: '' })}
                  options={[
                    { value: '', label: 'Proyecto' },
                    ...projects.map(p => ({ value: String(p.id), label: p.nombre })),
                  ]}
                  ariaLabel="Proyecto"
                />
                <Select<string>
                  value={newRule.user_id}
                  onChange={(v) => setNewRule({ ...newRule, user_id: v })}
                  options={[
                    { value: '', label: 'Gestor' },
                    ...users.map(u => ({ value: String(u.id), label: u.nombre })),
                  ]}
                  ariaLabel="Gestor"
                />
                <Select<string>
                  value={newRule.product_id}
                  onChange={(v) => setNewRule({ ...newRule, product_id: v })}
                  options={[
                    { value: '', label: 'Todas las ventas (generica)' },
                    ...products.map(p => ({ value: String(p.id), label: p.nombre })),
                  ]}
                  ariaLabel="Producto"
                  disabled={!newRule.project_id}
                />
                <div className="flex gap-1">
                  <input type="number" min="0" max="100" step="0.01" placeholder="%" value={newRule.pct} onChange={e => setNewRule({ ...newRule, pct: e.target.value })} className={inputClass + ' flex-1'} required />
                  <button type="submit" aria-label="Añadir regla" className="px-3 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-primary/40">
                    <Plus size={12} weight="bold" />
                  </button>
                </div>
                <Select<'cobrado' | 'vendido'>
                  value={newRule.base_calc}
                  onChange={(v) => setNewRule({ ...newRule, base_calc: v })}
                  options={[
                    { value: 'cobrado', label: 'Calcular sobre lo cobrado (cuando cliente paga)' },
                    { value: 'vendido', label: 'Calcular sobre lo vendido (al firmar venta)' },
                  ]}
                  ariaLabel="Base de cálculo"
                  className="col-span-4"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Si producto vacio = aplica a TODAS las ventas del gestor en ese proyecto. Producto especifico = override.</p>
            </form>

            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : rules.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-border rounded-md">
                <Gear size={32} className="text-muted-foreground/30 mx-auto mb-2" weight="regular" />
                <p className="text-sm font-semibold">Sin reglas configuradas</p>
                <p className="text-xs text-muted-foreground">Crea una regla para empezar a generar comisiones automaticamente</p>
              </div>
            ) : (
              <div className="space-y-1">
                {rules.map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-3 bg-muted/20 hover:bg-muted/40 rounded-lg group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{r.user_nombre}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-sm">{r.product_nombre}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{r.project_nombre}</span>
                      </div>
                    </div>
                    <input
                      type="number" min="0" max="100" step="0.01"
                      defaultValue={r.pct}
                      onBlur={e => { if (Number(e.target.value) !== Number(r.pct)) handleEditPct(r, e.target.value); }}
                      className="w-20 h-9 px-2 rounded-lg border border-border bg-card text-sm text-right font-bold"
                    />
                    <span className="text-sm font-bold">%</span>
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500 opacity-0 group-hover:opacity-100">
                      <Trash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog open={pendingDelete !== null} title="¿Eliminar regla?" message="Esta regla de comisión será eliminada permanentemente." onConfirm={doDelete} onCancel={() => setPendingDelete(null)} />
    </Portal>
  );
}
