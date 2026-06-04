import { useEffect, useState } from 'react';
import { X, Package, Check, MagnifyingGlass } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import client from '@/shared/api/client';
import { metaApi } from '../api/metaAds.api';
import { toast } from '@/shared/hooks/useToast';

interface Product { id: number; nombre: string; precio?: number | string; moneda?: string }
// Dialog parametrizado por scope: asocia productos a una CAMPAÑA o a un ADSET.
// Reutilizamos el mismo UI; cambia solo el endpoint según `scope`.
interface CampaignScope { type: 'campaign'; id: string; nombre: string }
interface AdSetScope { type: 'adset'; id: string; nombre: string }
type Scope = CampaignScope | AdSetScope;

interface Props {
  open: boolean;
  projectId: number;
  scope?: Scope;
  // Legacy prop — mantiene compat con código viejo que pasaba `campaign={...}`.
  campaign?: { campaign_id: string; nombre: string };
  onClose: () => void;
  onSaved?: () => void;
}

export default function AssociateProductsDialog({ open, projectId, scope: scopeProp, campaign, onClose, onSaved }: Props) {
  // Normalizar: si vino `campaign`, lo tratamos como scope campaign.
  const scope: Scope = scopeProp || (campaign
    ? { type: 'campaign', id: campaign.campaign_id, nombre: campaign.nombre }
    : { type: 'campaign', id: '', nombre: '' });

  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const fetchAssoc = scope.type === 'campaign'
      ? metaApi.associations(projectId, scope.id)
      : metaApi.adsetAssociations(projectId, scope.id);
    Promise.all([
      client.get<Product[]>(`/products`, { params: { projectId, limit: 500 } }),
      fetchAssoc,
    ])
      .then(([prodRes, assocRes]: any[]) => {
        setProducts(Array.isArray(prodRes?.data) ? prodRes.data : []);
        const ids = (assocRes?.data || []).map((a: any) => a.product_id);
        setSelected(new Set(ids));
      })
      .catch(() => { setProducts([]); setSelected(new Set()); })
      .finally(() => setLoading(false));
  }, [open, projectId, scope.type, scope.id]);

  if (!open) return null;

  const filtered = search.trim()
    ? products.filter((p) => p.nombre.toLowerCase().includes(search.toLowerCase()))
    : products;

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (scope.type === 'campaign') {
        await metaApi.setAssociations({
          project_id: projectId,
          campaign_id: scope.id,
          product_ids: Array.from(selected),
        });
      } else {
        await metaApi.setAdSetAssociations({
          project_id: projectId,
          adset_id: scope.id,
          product_ids: Array.from(selected),
        });
      }
      const targetLabel = scope.type === 'campaign' ? 'campaña' : 'conjunto';
      toast({ title: 'Productos asociados', description: `${selected.size} ${selected.size === 1 ? 'producto' : 'productos'} vinculados al ${targetLabel}` });
      onSaved?.();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div role="dialog" aria-modal="true" className="relative bg-card rounded-lg border border-border w-full max-w-lg flex flex-col max-h-[85vh]">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <Package size={18} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base">
                Asociar productos {scope.type === 'campaign' ? 'a la campaña' : 'al conjunto'}
              </h3>
              <p className="text-xs text-muted-foreground truncate" title={scope.nombre}>
                <strong>{scope.nombre}</strong>
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {scope.type === 'campaign'
                  ? 'Marca los programas que esta campaña promociona. El CRM cruzará el gasto Meta con las ventas para calcular ROI.'
                  : 'Marca los productos que este conjunto promociona. Más granular que asociar a campaña — recomendado cuando una sola campaña tiene varios adsets por producto.'}
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={18} /></button>
          </div>

          <div className="p-3 border-b border-border">
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…"
                className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-sm" />
            </div>
          </div>

          <div className="overflow-y-auto flex-1 min-h-[200px]">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-muted/40 rounded animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Sin productos en este proyecto.</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((p) => {
                  const isSel = selected.has(p.id);
                  return (
                    <li key={p.id}>
                      <button onClick={() => toggle(p.id)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 ${isSel ? 'bg-primary/5' : ''}`}>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${isSel ? 'border-primary bg-primary text-white' : 'border-border'}`}>
                          {isSel && <Check size={12} weight="bold" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.nombre}</p>
                          {p.precio && <p className="text-[11px] text-muted-foreground">{p.precio} {p.moneda || ''}</p>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-between items-center gap-2 p-4 border-t border-border bg-muted/20">
            <span className="text-xs text-muted-foreground">
              {selected.size} {selected.size === 1 ? 'producto' : 'productos'} seleccionado{selected.size === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button onClick={onClose} disabled={saving} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Guardando…' : 'Guardar asociaciones'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
