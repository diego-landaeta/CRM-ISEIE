import { useState, useEffect } from 'react';
import { MagnifyingGlass, Package, CurrencyEur, X } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';

interface ProductOption {
  id: number;
  nombre: string;
  sku: string | null;
  precio: number | null;
  moneda: string | null;
  modalidad: string | null;
  project_nombre?: string;
}

interface Props {
  open: boolean;
  onSelect: (product: ProductOption) => void;
  onClose: () => void;
}

export default function ProductPicker({ open, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const { projects, activeProject } = useProjectContext();

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setLoading(true);

    const pids = projects?.map((p: any) => p.id) || (activeProject?.id ? [activeProject.id] : []);

    Promise.all(
      pids.map((pid: number) =>
        client.get(`/products?projectId=${pid}&active=true&limit=30`)
          .then(r => {
            const projName = projects?.find((p: any) => p.id === pid)?.nombre || '';
            return (r.success ? r.data : []).map((p: any) => ({ ...p, project_nombre: projName }));
          })
          .catch(() => [])
      )
    ).then(results => {
      setProducts(results.flat());
    }).finally(() => setLoading(false));
  }, [open, projects, activeProject?.id]);

  const filtered = search
    ? products.filter(p =>
        p.nombre.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase())
      )
    : products;

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[400px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-xl z-50 max-h-80 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-sm font-semibold">Compartir producto</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X size={16} /></button>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-muted/50 border-0 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && <p className="text-xs text-muted-foreground text-center py-4">Buscando...</p>}
        {!loading && filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Sin productos</p>}
        {filtered.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 text-left transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-warning-soft flex items-center justify-center flex-shrink-0">
              <Package size={16} weight="fill" className="text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium truncate block">{p.nombre}</span>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                {p.project_nombre && <span className="text-primary/70">{p.project_nombre}</span>}
                {p.modalidad && <span>· {p.modalidad}</span>}
                {p.precio != null && (
                  <span className="flex items-center gap-0.5 font-semibold text-foreground">
                    <CurrencyEur size={10} />{p.precio} {p.moneda || ''}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
