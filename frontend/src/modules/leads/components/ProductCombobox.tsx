import { useState, useRef, useEffect } from 'react';
import { MagnifyingGlass, Plus, X, CaretDown } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const inputClass = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary';

interface ProductOption {
  id: number;
  nombre: string;
  categoria_nombre?: string | null;
}

interface Props {
  value: string | undefined | null;
  onChange: (value: string) => void;
  products: ProductOption[];
  projectId: number | null | undefined;
  projectLabel?: string;
  onProductCreated?: (p: ProductOption) => void;
}

export default function ProductCombobox({ value, onChange, products, projectId, projectLabel = 'Producto', onProductCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = search
    ? products.filter(p => p.nombre.toLowerCase().includes(search.toLowerCase()))
    : products;

  const selected = products.find(p => p.nombre === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={inputClass + ' flex items-center justify-between text-left'}
      >
        <span className={selected ? '' : 'text-muted-foreground'}>
          {selected ? selected.nombre : `Buscar ${projectLabel.toLowerCase()}...`}
        </span>
        <CaretDown size={14} className="text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Escribe para buscar ${projectLabel.toLowerCase()}...`}
                className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-muted/50 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-muted/50 text-muted-foreground italic"
            >
              Sin {projectLabel.toLowerCase()} especifico
            </button>
            {filtered.map(p => (
              <button
                type="button"
                key={p.id}
                onClick={() => { onChange(p.nombre); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-muted/50 flex items-center justify-between ${value === p.nombre ? 'bg-primary/10 text-primary font-semibold' : ''}`}
              >
                <span>{p.nombre}</span>
                {p.categoria_nombre && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{p.categoria_nombre}</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && search && (
              <div className="px-4 py-3 text-sm text-muted-foreground text-center">
                Sin resultados para &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
          <div className="p-2 border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={() => { setNewOpen(true); setOpen(false); }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90"
            >
              <Plus size={14} weight="bold" /> Añadir {projectLabel.toLowerCase()} nuevo
            </button>
          </div>
        </div>
      )}

      {newOpen && (
        <NewProductDialog
          projectId={projectId}
          projectLabel={projectLabel}
          initialName={search}
          onClose={() => setNewOpen(false)}
          onCreated={(p) => {
            setNewOpen(false);
            onChange(p.nombre);
            onProductCreated?.(p);
          }}
        />
      )}
    </div>
  );
}

interface Category {
  id: number;
  nombre: string;
  parent_id?: number | null;
}

interface NewProductDialogProps {
  projectId: number | null | undefined;
  projectLabel: string;
  initialName?: string;
  onClose: () => void;
  onCreated: (p: ProductOption) => void;
}

function NewProductDialog({ projectId, projectLabel, initialName = '', onClose, onCreated }: NewProductDialogProps) {
  const [data, setData] = useState({ nombre: initialName, descripcion: '', categoria_id: '', subcategoria_id: '' });
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await client.get(`/product-categories/project/${projectId}`);
        if (res.success) setCategories(res.data || []);
      } catch {}
    })();
  }, [projectId]);

  const parentCategories = categories.filter(c => !c.parent_id);
  const subcategories = categories.filter(c => String(c.parent_id) === String(data.categoria_id));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data.nombre.trim()) return;
    setSaving(true);
    try {
      const res = await client.post('/products', {
        projectId,
        nombre: data.nombre.trim(),
        descripcion: data.descripcion || undefined,
        categoria_id: data.categoria_id ? Number(data.categoria_id) : null,
        subcategoria_id: data.subcategoria_id ? Number(data.subcategoria_id) : null,
      });
      if (res.success) {
        toast({ title: `${projectLabel} creado`, description: res.data.nombre });
        onCreated(res.data);
      }
    } catch (err) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <form onSubmit={handleSubmit} className="relative bg-card rounded-lg border border-border w-full max-w-md p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Nuevo {projectLabel.toLowerCase()}</h3>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded hover:bg-muted"><X size={18} /></button>
          </div>
          <div className="space-y-3">
            <input
              autoFocus required placeholder={`Nombre del ${projectLabel.toLowerCase()}`}
              value={data.nombre} onChange={e => setData({ ...data, nombre: e.target.value })}
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-2">
              <Select<string>
                value={data.categoria_id}
                onChange={(v) => setData({ ...data, categoria_id: v, subcategoria_id: '' })}
                options={[
                  { value: '', label: 'Sin categoria' },
                  ...parentCategories.map(c => ({ value: String(c.id), label: c.nombre })),
                ]}
                ariaLabel="Categoría"
              />
              <Select<string>
                value={data.subcategoria_id}
                onChange={(v) => setData({ ...data, subcategoria_id: v })}
                options={[
                  { value: '', label: subcategories.length ? 'Sin subcategoria' : '—' },
                  ...subcategories.map(c => ({ value: String(c.id), label: c.nombre })),
                ]}
                ariaLabel="Subcategoría"
                disabled={!subcategories.length}
              />
            </div>
            <textarea
              placeholder="Descripción (opcional)"
              value={data.descripcion} onChange={e => setData({ ...data, descripcion: e.target.value })}
              className={inputClass + ' h-20 py-2 resize-none'}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">{saving ? 'Guardando...' : `Crear ${projectLabel.toLowerCase()}`}</button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
