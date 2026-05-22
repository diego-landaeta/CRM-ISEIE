import { useEffect, useState, useMemo } from 'react';
import { Package, MagnifyingGlass, Info, X } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface ProductLite {
  id: number;
  nombre: string;
  sku?: string | null;
  precio?: number | string | null;
}

interface LeadLite {
  id: number;
  nombre?: string;
  project_id?: number;
  producto_interes_id?: number | null;
  producto_interes?: string | null;
  producto_nombre?: string | null;
  landing_url?: string | null;
}

interface Props {
  open: boolean;
  lead: LeadLite | null;
  onClose: () => void;
  onSaved?: () => void;
}

// Diálogo para cambiar el producto vinculado a un lead.
// Tras guardar, si el lead tiene landing_url y el slug no coincidía con el
// producto, el backend APRENDE el alias y futuros leads desde esa URL
// se vincularán automáticamente.
export default function ChangeProductDialog({ open, lead, onClose, onSaved }: Props) {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && lead?.project_id) {
      setSearch('');
      setSelectedId(lead.producto_interes_id || null);
      setLoading(true);
      client.get(`/products?projectId=${lead.project_id}&active=true&limit=500`)
        .then((r) => { if (r.success) setProducts(r.data || []); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, lead?.project_id, lead?.producto_interes_id]);

  // Normaliza para búsqueda: quita acentos, espacios extra, lowercase.
  // Así "master" matchea "Máster" y "fonoaudiologia" matchea "Fonoaudiología".
  const norm = (s: string) =>
    String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim();

  const filtered = useMemo(() => {
    if (!search) return products;
    // Soporta múltiples palabras: "master genero" matchea "Máster en X de Género"
    const tokens = norm(search).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return products;
    return products.filter((p) => {
      const haystack = norm(`${p.nombre || ''} ${p.sku || ''}`);
      return tokens.every((t) => haystack.includes(t));
    });
  }, [products, search]);

  if (!open || !lead) return null;

  // Extrae el slug final de la landing_url para mostrar el aprendizaje
  const slug = (() => {
    if (!lead.landing_url) return null;
    try {
      const u = new URL(lead.landing_url);
      const parts = u.pathname.split('/').filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    } catch { return null; }
  })();

  async function handleSave() {
    if (!selectedId || !lead) return;
    setSaving(true);
    try {
      const res = await client.patch(`/leads/${lead.id}`, { producto_interes_id: selectedId });
      if (res.success) {
        const target = products.find((p) => p.id === selectedId);
        toast({
          title: 'Producto actualizado',
          description: slug
            ? `Vinculado a "${target?.nombre || 'producto'}". El CRM aprenderá el slug "${slug}" para futuros leads.`
            : `Vinculado a "${target?.nombre || 'producto'}"`,
        });
        onSaved?.();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!lead) return;
    setSaving(true);
    try {
      const res = await client.patch(`/leads/${lead.id}`, { producto_interes_id: null });
      if (res.success) {
        toast({ title: 'Producto desvinculado' });
        onSaved?.();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Package size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Vincular / cambiar producto</h3>
            <p className="text-xs text-muted-foreground truncate">{lead.nombre}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {/* Banner explicando el aprendizaje */}
          {slug && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800">
              <Info size={16} className="text-violet-600 flex-shrink-0 mt-0.5" weight="duotone" />
              <div className="text-[11px] text-violet-800 dark:text-violet-300">
                <p className="font-semibold mb-0.5">El CRM va a aprender este mapeo</p>
                <p>Landing URL del lead: <code className="bg-violet-100 dark:bg-violet-900/40 px-1 rounded">{slug}</code>. Tras guardar, futuros leads desde esta URL se vincularán automáticamente al producto que elijas.</p>
              </div>
            </div>
          )}

          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o SKU..."
              className="w-full h-10 pl-9 pr-3 rounded-md border border-border bg-muted/40 text-sm"
              autoFocus
            />
          </div>

          <div className="border border-border rounded-md max-h-96 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-xs text-muted-foreground text-center">Cargando catálogo...</p>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">
                {search ? (
                  <>
                    <p className="italic mb-2">Sin resultados para "<strong className="text-foreground">{search}</strong>"</p>
                    <p className="text-[10px] leading-relaxed">
                      Si este producto no existe en el catálogo, no puedes vincularlo.<br/>
                      Opciones:<br/>
                      · Importa el catálogo del otro sitio (ej. <code>mxn.fonoaprende.com</code>) como segundo origen.<br/>
                      · Renombra el producto ES para que incluya el sinónimo (ej. añade "Fonoaudiología" al título).<br/>
                      · O busca un equivalente más general en el catálogo.
                    </p>
                  </>
                ) : 'No hay productos en el catálogo'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-3 ${
                      selectedId === p.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      selectedId === p.id ? 'border-primary bg-primary' : 'border-border'
                    }`}>
                      {selectedId === p.id && <span className="block w-1.5 h-1.5 rounded-full bg-white m-auto mt-0.5" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{p.nombre}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {p.sku ? `SKU: ${p.sku}` : 'Sin SKU'}
                        {p.precio ? ` · ${p.precio}€` : ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center gap-2 p-4 border-t border-border bg-muted/20">
          {lead.producto_interes_id ? (
            <button onClick={handleClear} disabled={saving}
              className="text-xs text-muted-foreground hover:text-red-600 underline">
              Desvincular producto actual
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving}
              className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || !selectedId || selectedId === lead.producto_interes_id}
              className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Vincular producto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
