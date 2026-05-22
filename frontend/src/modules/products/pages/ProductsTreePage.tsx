import { useEffect, useState, useMemo } from 'react';
import { useProjectContext as useProject } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import {
  getTree,
  type CategoryNode,
} from '@/modules/product-categories/api/categories.api';
import {
  CaretDown,
  CaretRight,
  Tree,
  Package,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';

interface Product {
  id: number;
  nombre: string;
  precio: number | null;
  moneda: string | null;
  sku: string | null;
  categoria_id: number | null;
  categoria_nombre: string | null;
  active: boolean;
}

function NodeItem({
  node,
  depth,
  selectedId,
  onSelect,
  search,
}: {
  node: CategoryNode;
  depth: number;
  selectedId: number | null;
  onSelect: (n: CategoryNode | null) => void;
  search: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  const matchesSearch = !search || node.nombre.toLowerCase().includes(search.toLowerCase());
  const childMatches = node.children.some((c) => containsSearch(c, search));
  if (!matchesSearch && !childMatches) return null;

  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded text-sm cursor-pointer ${
          isSelected ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onSelect(isSelected ? null : node)}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen((o) => !o); }}
          className="flex-shrink-0 w-4 flex items-center justify-center"
        >
          {hasChildren ? (
            open ? <CaretDown size={12} /> : <CaretRight size={12} />
          ) : null}
        </button>
        <span className="truncate flex-1">{node.nombre}</span>
        {node.productos_count > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {node.productos_count}
          </span>
        )}
      </div>
      {hasChildren && open && (
        <div>
          {node.children.map((c) => (
            <NodeItem key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

function containsSearch(node: CategoryNode, search: string): boolean {
  if (!search) return true;
  if (node.nombre.toLowerCase().includes(search.toLowerCase())) return true;
  return node.children.some((c) => containsSearch(c, search));
}

export default function ProductsTreePage() {
  const { activeProject } = useProject();
  const projectId = activeProject?.id;

  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [selected, setSelected] = useState<CategoryNode | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  // Cargar árbol
  useEffect(() => {
    if (!projectId) return;
    setLoadingTree(true);
    getTree(projectId)
      .then(setTree)
      .finally(() => setLoadingTree(false));
  }, [projectId]);

  // Cargar productos al cambiar selección
  useEffect(() => {
    if (!projectId) return;
    setLoadingProducts(true);
    const url = selected
      ? `/products?projectId=${projectId}&categoryId=${selected.id}`
      : `/products?projectId=${projectId}`;
    client
      .get(url)
      .then((res: any) => setProducts((res.data as Product[]) || []))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [projectId, selected]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products;
    const q = productSearch.toLowerCase();
    return products.filter(
      (p) =>
        p.nombre.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q),
    );
  }, [products, productSearch]);

  const totalProducts = products.length;

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center gap-3 mb-4">
        <Package size={24} className="text-primary" />
        <h1 className="text-2xl font-semibold">Productos por categoría</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Sidebar árbol */}
        <aside className="border rounded-lg bg-card">
          <div className="flex items-center gap-2 p-3 border-b">
            <Tree size={16} className="text-primary" />
            <span className="font-medium text-sm">Categorías</span>
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X size={12} /> Quitar filtro
              </button>
            )}
          </div>
          <div className="p-2 border-b">
            <div className="flex items-center gap-2">
              <MagnifyingGlass size={14} className="text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar categoría…"
                className="flex-1 text-xs px-1 py-0.5 bg-transparent border-b focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="p-1 max-h-[600px] overflow-y-auto">
            <div
              className={`flex items-center gap-1 py-1.5 px-3 rounded text-sm cursor-pointer ${
                !selected ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted/50'
              }`}
              onClick={() => setSelected(null)}
            >
              <span className="flex-1">Todos los productos</span>
            </div>
            {loadingTree && <div className="text-xs text-muted-foreground p-3">Cargando…</div>}
            {!loadingTree &&
              tree.map((node) => (
                <NodeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  search={search}
                />
              ))}
          </div>
        </aside>

        {/* Listado */}
        <main className="border rounded-lg bg-card overflow-hidden">
          <div className="p-3 border-b flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium text-sm">
                {selected ? selected.nombre : 'Todos los productos'}
              </div>
              <div className="text-xs text-muted-foreground">
                {loadingProducts ? 'Cargando…' : `${totalProducts} producto${totalProducts !== 1 ? 's' : ''}`}
                {productSearch && filteredProducts.length !== totalProducts &&
                  ` · ${filteredProducts.length} coinciden con "${productSearch}"`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MagnifyingGlass size={14} className="text-muted-foreground" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Buscar producto/SKU…"
                className="text-sm px-2 py-1 bg-background border rounded focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {loadingProducts && (
            <div className="p-8 text-center text-muted-foreground text-sm">Cargando productos…</div>
          )}

          {!loadingProducts && filteredProducts.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {selected ? 'Esta categoría no tiene productos' : 'Sin productos'}
            </div>
          )}

          {!loadingProducts && filteredProducts.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Nombre</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">SKU</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Categoría</th>
                  <th className="text-right px-3 py-2 font-medium">Precio</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => (
                  <tr key={p.id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{p.nombre}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden md:table-cell">
                      {p.sku || '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                      {p.categoria_nombre || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p.precio != null ? `${p.precio.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${p.moneda || 'EUR'}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </main>
      </div>
    </div>
  );
}
