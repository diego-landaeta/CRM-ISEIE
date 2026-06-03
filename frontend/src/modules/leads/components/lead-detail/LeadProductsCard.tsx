import { useEffect, useState } from 'react';
import { Plus, Package, X, PencilSimple, Check, MagnifyingGlass, Star } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface ProductItem {
  id: number | null; // null = principal (no es row de lead_products)
  product_id: number;
  product_nombre: string;
  responsable_id: number | null;
  responsable_nombre: string | null;
  status: string;
  notas: string | null;
  added_at: string;
  added_via: string;
  is_principal: boolean;
  added_by_nombre?: string | null;
}

interface User { id: number; nombre: string; role?: string }
interface Product { id: number; nombre: string }

interface Props {
  leadId: number;
  projectId: number;
  isAdmin: boolean;
}

const VIA_LABEL: Record<string, string> = {
  principal: 'Principal',
  manual: 'Añadido manual',
  auto_reincidente: 'Detección automática (reincidente)',
  webhook: 'Llegó por webhook',
  wc: 'WooCommerce',
};

export default function LeadProductsCard({ leadId, projectId, isAdmin }: Props) {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [gestores, setGestores] = useState<User[]>([]);

  function load() {
    setLoading(true);
    client.get<ProductItem[]>(`/leads/${leadId}/products`)
      .then((r: any) => setItems(r?.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carga catálogos para add/edit
  useEffect(() => {
    client.get<Product[]>('/products', { params: { projectId, limit: 500 } }).then((r: any) => setProducts(r?.data || [])).catch(() => {});
    client.get<User[]>('/users').then((r: any) => setGestores(((r?.data) || []).filter((u: User) => u.role === 'gestor' || u.role === 'admin'))).catch(() => {});
  }, [projectId]);

  async function removeItem(it: ProductItem) {
    if (!it.id || it.is_principal) return;
    if (!confirm(`Quitar "${it.product_nombre}" del lead?`)) return;
    try {
      await client.delete(`/leads/${leadId}/products/${it.id}`);
      toast({ title: 'Programa eliminado' });
      load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Package size={16} weight="duotone" className="text-blue-600" />
          Programas de interés
          <span className="text-[11px] font-normal text-muted-foreground">({items.length})</span>
        </h3>
        {!addOpen && (
          <button onClick={() => setAddOpen(true)} className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1">
            <Plus size={12} weight="bold" /> Añadir programa
          </button>
        )}
      </div>

      {addOpen && (
        <AddForm
          products={products.filter((p) => !items.some((i) => i.product_id === p.id))}
          gestores={gestores}
          onCancel={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); load(); }}
          leadId={leadId}
        />
      )}

      {loading ? (
        <div className="space-y-2 mt-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-12 bg-muted/40 rounded animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">Sin programas asociados.</p>
      ) : (
        <ul className="space-y-2 mt-2">
          {items.map((it) => (
            <li key={it.id != null ? `lp-${it.id}` : 'principal'} className={`border border-border rounded-md p-2.5 ${it.is_principal ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
              {editingId === it.id && it.id ? (
                <EditForm
                  item={it}
                  gestores={gestores}
                  leadId={leadId}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); load(); }}
                />
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      {it.is_principal && <Star size={12} weight="fill" className="text-amber-500" />}
                      <span className="truncate" title={it.product_nombre}>{it.product_nombre}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Gestor: {it.responsable_nombre || 'sin asignar'}
                      {it.status && ` · ${it.status}`}
                      {!it.is_principal && it.added_via !== 'manual' && (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted">
                          {VIA_LABEL[it.added_via] || it.added_via}
                        </span>
                      )}
                    </p>
                    {it.notas && <p className="text-[11px] text-muted-foreground italic mt-1 line-clamp-2">{it.notas}</p>}
                  </div>
                  {!it.is_principal && isAdmin && it.id != null && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => setEditingId(it.id!)} title="Editar gestor/notas" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <PencilSimple size={12} />
                      </button>
                      <button onClick={() => removeItem(it)} title="Quitar del lead" className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600">
                        <X size={12} weight="bold" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddForm({ products, gestores, onCancel, onAdded, leadId }: { products: Product[]; gestores: User[]; onCancel: () => void; onAdded: () => void; leadId: number }) {
  const [productId, setProductId] = useState<number | ''>('');
  const [responsableId, setResponsableId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const filtered = search.trim() ? products.filter((p) => p.nombre.toLowerCase().includes(search.toLowerCase())) : products;

  async function save() {
    if (!productId) { toast({ title: 'Selecciona un producto', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      await client.post(`/leads/${leadId}/products`, {
        product_id: productId,
        responsable_id: responsableId || null,
        notas: notas.trim() || null,
      });
      toast({ title: 'Programa añadido' });
      onAdded();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-muted/30 border border-border rounded-md p-3 space-y-2 mb-3">
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Programa *</label>
        <div className="relative mb-1">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…"
            className="w-full h-8 pl-7 pr-2 rounded border border-border bg-card text-xs" />
        </div>
        <select value={productId} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}
          className="w-full h-8 px-2 rounded border border-border bg-card text-xs">
          <option value="">— Selecciona —</option>
          {filtered.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Gestor (opcional)</label>
        <select value={responsableId} onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : '')}
          className="w-full h-8 px-2 rounded border border-border bg-card text-xs">
          <option value="">— Sin asignar —</option>
          {gestores.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Notas (opcional)</label>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
          className="w-full px-2 py-1 rounded border border-border bg-card text-xs resize-none" />
      </div>
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} disabled={saving} className="h-7 px-2 rounded text-[11px] text-muted-foreground hover:bg-muted">Cancelar</button>
        <button onClick={save} disabled={saving} className="h-7 px-3 rounded bg-primary text-white text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
          <Check size={11} weight="bold" /> {saving ? 'Guardando…' : 'Añadir'}
        </button>
      </div>
    </div>
  );
}

function EditForm({ item, gestores, leadId, onCancel, onSaved }: { item: ProductItem; gestores: User[]; leadId: number; onCancel: () => void; onSaved: () => void }) {
  const [responsableId, setResponsableId] = useState<number | ''>(item.responsable_id || '');
  const [notas, setNotas] = useState(item.notas || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await client.patch(`/leads/${leadId}/products/${item.id}`, {
        responsable_id: responsableId || null,
        notas: notas.trim() || null,
      });
      toast({ title: 'Actualizado' });
      onSaved();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold truncate">{item.product_nombre}</p>
      <select value={responsableId} onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : '')}
        className="w-full h-8 px-2 rounded border border-border bg-card text-xs">
        <option value="">— Sin asignar —</option>
        {gestores.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
      </select>
      <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
        placeholder="Notas"
        className="w-full px-2 py-1 rounded border border-border bg-card text-xs resize-none" />
      <div className="flex justify-end gap-1">
        <button onClick={onCancel} disabled={saving} className="h-7 px-2 rounded text-[11px] text-muted-foreground hover:bg-muted">Cancelar</button>
        <button onClick={save} disabled={saving} className="h-7 px-3 rounded bg-primary text-white text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}
