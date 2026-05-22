import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, Package, SquaresFour, List as ListIcon,
  Tag, CurrencyEur,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const ProductFormDialog = lazy(() => import('../components/ProductFormDialog'));

function formatMoney(n: any, currency = 'EUR') {
  const value = Number(n || 0);
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch { return `${Math.round(value)} ${currency}`; }
}

export default function ProductsPage() {
  const { activeProject } = useAuth();
  const projectId = activeProject?.id;

  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    client.get('/products', { params: { projectId, limit: 200 } })
      .then((r: any) => { if (!cancelled) setProducts(Array.isArray(r?.data) ? r.data : (r?.data?.data || [])); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  async function handleCreateProduct(data: any) {
    if (!projectId) return;
    try {
      const res: any = await client.post('/products', { ...data, projectId });
      if (res?.success !== false) {
        toast({ title: 'Producto creado', description: data.nombre });
        setFormOpen(false);
        setReloadKey((k) => k + 1);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'No se pudo crear', variant: 'destructive' });
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.trim().toLowerCase();
    return products.filter((p) =>
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Catálogo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeProject?.nombre ? `${activeProject.nombre} · ` : ''}Productos, cursos o servicios que vendes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus size={14} weight="bold" />
          Nuevo producto
        </button>
      </header>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-md border border-border bg-card self-start">
          <button
            onClick={() => setView('grid')}
            title="Vista de cuadrícula"
            className={`p-1.5 rounded transition-colors ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <SquaresFour size={14} weight={view === 'grid' ? 'fill' : 'regular'} />
          </button>
          <button
            onClick={() => setView('list')}
            title="Vista de lista"
            className={`p-1.5 rounded transition-colors ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ListIcon size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
            <Package size={26} weight="duotone" className="text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1.5">
            {products.length === 0 ? 'Sin productos todavía' : 'Sin resultados para tu búsqueda'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
            {products.length === 0
              ? 'Crea tu primer producto/curso para asignar a prospectos y generar conversiones.'
              : 'Prueba con otro término o limpia la búsqueda.'}
          </p>
          {products.length === 0 && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} weight="bold" />
              Crear primer producto
            </button>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to={`/products/${p.id}`}
              className="rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition-colors flex flex-col gap-2"
            >
              <div className="aspect-video rounded-md bg-muted overflow-hidden flex items-center justify-center">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.nombre} className="w-full h-full object-cover" />
                ) : (
                  <Package size={32} weight="duotone" className="text-muted-foreground/50" />
                )}
              </div>
              <div className="flex items-start justify-between gap-2 mt-1">
                <div className="font-semibold text-sm leading-tight truncate flex-1">{p.nombre}</div>
                {p.active === false && (
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">inactivo</span>
                )}
              </div>
              {p.sku && (
                <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Tag size={11} weight="duotone" />
                  {p.sku}
                </div>
              )}
              <div className="flex items-center justify-between text-xs mt-auto pt-2 border-t border-border">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <CurrencyEur size={11} weight="bold" />
                  <span className="font-semibold text-foreground tabular-nums">{formatMoney(p.precio, p.moneda || 'EUR')}</span>
                </span>
                {p.modalidad && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.modalidad}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to={`/products/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-md bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                {p.image_url
                  ? <img src={p.image_url} alt={p.nombre} className="w-full h-full object-cover" />
                  : <Package size={18} weight="duotone" className="text-muted-foreground/60" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{p.nombre}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {p.sku ? `${p.sku} · ` : ''}{p.modalidad || 'sin modalidad'}
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">{formatMoney(p.precio, p.moneda || 'EUR')}</div>
            </Link>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        <ProductFormDialog open={formOpen} onClose={() => setFormOpen(false)} product={null} onSubmit={handleCreateProduct} />
      </Suspense>
    </div>
  );
}
