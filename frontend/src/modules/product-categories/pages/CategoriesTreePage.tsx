import { useEffect, useState, useMemo } from 'react';
// TODO: el hermano usa `useProject` desde `@/shared/hooks/useProject` (no existe en
// CRM-ISEIE). Usamos `useProjectContext` del provider canonico de este repo.
import { useProjectContext } from '@/contexts/ProjectContext';
import {
  getTree,
  createCategory,
  updateCategory,
  deleteCategory,
  getCurrentSyncStatus,
  startWcSync,
  type CategoryNode,
  type WcRunStatus,
} from '../api/categories.api';
import {
  CaretDown,
  CaretRight,
  Tree,
  Plus,
  Pencil,
  Trash,
  X,
  MagnifyingGlass,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
} from '@phosphor-icons/react';

type SourceFilter = 'all' | 'manual' | 'wc' | 'wp_menu';

interface CategoryFormState {
  mode: 'create' | 'edit';
  id?: number;
  parent_id: number | null;
  parent_name?: string;
  nombre: string;
}

function badgeStyleFor(source: string) {
  if (source === 'wp_menu') return 'bg-purple-500/15 text-purple-400';
  if (source === 'wc') return 'bg-blue-500/15 text-blue-400';
  return 'bg-emerald-500/15 text-emerald-400';
}

function NodeRow({
  node,
  depth,
  search,
  hideEmpty,
  sourceFilter,
  onCreate,
  onEdit,
  onDelete,
}: {
  node: CategoryNode;
  depth: number;
  search: string;
  hideEmpty: boolean;
  sourceFilter: SourceFilter;
  onCreate: (parent: CategoryNode) => void;
  onEdit: (node: CategoryNode) => void;
  onDelete: (node: CategoryNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  // Filtros: si este nodo no matchea pero algun descendiente si, aun lo mostramos
  const matchesSelf =
    (!search || node.nombre.toLowerCase().includes(search.toLowerCase())) &&
    (!hideEmpty || node.productos_count > 0 || hasChildren) &&
    (sourceFilter === 'all' || node.source === sourceFilter);

  const visibleChildren = node.children.filter((c) =>
    nodeMatchesRecursive(c, search, hideEmpty, sourceFilter),
  );

  if (!matchesSelf && visibleChildren.length === 0) return null;

  return (
    <div>
      <div
        className="group flex items-center gap-2 py-2 hover:bg-muted/50 rounded px-2"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && setOpen((o) => !o)}
          className="flex-shrink-0"
        >
          {hasChildren ? (
            open ? <CaretDown size={16} /> : <CaretRight size={16} />
          ) : (
            <span style={{ width: 16, display: 'inline-block' }} />
          )}
        </button>
        <span className="font-medium truncate">{node.nombre}</span>
        {node.productos_count > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
            {node.productos_count}
          </span>
        )}
        <span
          className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded ${badgeStyleFor(node.source)}`}
        >
          {node.source}
        </span>
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            title="Crear subcategoria"
            onClick={() => onCreate(node)}
            className="p-1 hover:bg-primary/10 rounded text-primary"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            title="Editar"
            onClick={() => onEdit(node)}
            className="p-1 hover:bg-amber-500/10 rounded text-amber-500"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            title="Borrar"
            onClick={() => onDelete(node)}
            className="p-1 hover:bg-destructive/10 rounded text-destructive"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
      {hasChildren && open && (
        <div>
          {visibleChildren.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              search={search}
              hideEmpty={hideEmpty}
              sourceFilter={sourceFilter}
              onCreate={onCreate}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function nodeMatchesRecursive(
  node: CategoryNode,
  search: string,
  hideEmpty: boolean,
  sourceFilter: SourceFilter,
): boolean {
  const self =
    (!search || node.nombre.toLowerCase().includes(search.toLowerCase())) &&
    (!hideEmpty || node.productos_count > 0 || node.children.length > 0) &&
    (sourceFilter === 'all' || node.source === sourceFilter);
  if (self) return true;
  return node.children.some((c) => nodeMatchesRecursive(c, search, hideEmpty, sourceFilter));
}

function FormModal({
  state,
  onCancel,
  onSubmit,
  saving,
}: {
  state: CategoryFormState;
  onCancel: () => void;
  onSubmit: (nombre: string) => void;
  saving: boolean;
}) {
  const [nombre, setNombre] = useState(state.nombre);
  const isEdit = state.mode === 'edit';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">
            {isEdit ? 'Editar categoria' : state.parent_id ? 'Nueva subcategoria' : 'Nueva categoria raiz'}
          </h3>
          <button onClick={onCancel} className="p-1 hover:bg-muted rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {state.parent_name && (
            <div className="text-sm text-muted-foreground">
              Bajo: <span className="font-mono">{state.parent_name}</span>
            </div>
          )}
          <div>
            <label className="text-sm text-muted-foreground block mb-1">Nombre</label>
            <input
              autoFocus
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nombre.trim()) onSubmit(nombre.trim());
              }}
              className="w-full px-3 py-2 border rounded bg-background"
              placeholder="Ej: Adicciones y conductas compulsivas"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm hover:bg-muted rounded">
            Cancelar
          </button>
          <button
            onClick={() => nombre.trim() && onSubmit(nombre.trim())}
            disabled={!nombre.trim() || saving}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : isEdit ? 'Guardar' : 'Crear'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CategoriesTreePage() {
  const { activeProject } = useProjectContext();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  // Form modal
  const [form, setForm] = useState<CategoryFormState | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync status (polling)
  // TODO: depende del modulo `woocommerce` no portado todavia. Mientras no exista,
  // el polling devolvera 404 y el banner permanecera oculto.
  const [sync, setSync] = useState<WcRunStatus | null>(null);
  const [syncStarting, setSyncStarting] = useState(false);

  useEffect(() => {
    if (!activeProject?.id) return;
    let cancel = false;
    async function tick() {
      try {
        const s = await getCurrentSyncStatus(activeProject!.id);
        if (cancel) return;
        setSync(s);
        // Si termino (success/error) y antes estaba running, recargar arbol
        if (s && s.status !== 'running' && sync?.status === 'running') {
          await reload();
        }
      } catch { /* silencioso */ }
    }
    tick();
    const interval = setInterval(tick, sync?.status === 'running' ? 3000 : 30000);
    return () => { cancel = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, sync?.status]);

  async function handleStartSync() {
    if (!activeProject?.id) return;
    setSyncStarting(true);
    try {
      await startWcSync(activeProject.id);
      const s = await getCurrentSyncStatus(activeProject.id);
      setSync(s);
    } catch (e) {
      alert(`No se pudo iniciar el sync: ${(e as Error).message}`);
    } finally {
      setSyncStarting(false);
    }
  }

  async function reload() {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const data = await getTree(activeProject.id);
      setTree(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Error al cargar el arbol');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id]);

  function openCreateRoot() {
    setForm({ mode: 'create', parent_id: null, nombre: '' });
  }
  function openCreateChild(parent: CategoryNode) {
    setForm({ mode: 'create', parent_id: parent.id, parent_name: parent.nombre, nombre: '' });
  }
  function openEdit(node: CategoryNode) {
    setForm({ mode: 'edit', id: node.id, parent_id: node.parent_id, nombre: node.nombre });
  }
  async function handleDelete(node: CategoryNode) {
    const msg = node.children.length > 0
      ? `"${node.nombre}" tiene ${node.children.length} subcategorias. Borrar de todas formas?`
      : `Borrar "${node.nombre}"?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteCategory(node.id);
      await reload();
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    }
  }
  async function handleSubmit(nombre: string) {
    if (!form || !activeProject?.id) return;
    setSaving(true);
    try {
      if (form.mode === 'create') {
        await createCategory({
          project_id: activeProject.id,
          parent_id: form.parent_id,
          nombre,
        });
      } else if (form.mode === 'edit' && form.id) {
        await updateCategory(form.id, { nombre });
      }
      setForm(null);
      await reload();
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    let total = 0;
    let productos = 0;
    function walk(n: CategoryNode[]) {
      for (const x of n) {
        total++;
        productos += x.productos_count;
        walk(x.children);
      }
    }
    walk(tree);
    return { total, productos };
  }, [tree]);

  return (
    <div className="container mx-auto py-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Tree size={28} className="text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">Arbol de categorias</h1>
            <p className="text-sm text-muted-foreground">
              Jerarquia N niveles. Pasa el raton sobre un nodo para ver acciones.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartSync}
            disabled={syncStarting || sync?.status === 'running'}
            className="px-3 py-2 text-sm border rounded hover:bg-muted flex items-center gap-2 disabled:opacity-50"
          >
            <ArrowsClockwise size={16} className={sync?.status === 'running' ? 'animate-spin' : ''} />
            {sync?.status === 'running' ? 'Sincronizando...' : 'Sincronizar WC'}
          </button>
          <button
            onClick={openCreateRoot}
            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 flex items-center gap-2"
          >
            <Plus size={16} /> Categoria raiz
          </button>
        </div>
      </div>

      {/* Banner de progreso del sync */}
      {sync && (
        <div className={`mb-4 p-3 rounded-lg border text-sm flex items-center gap-3 ${
          sync.status === 'running' ? 'bg-blue-500/10 border-blue-500/30' :
          sync.status === 'success' ? 'bg-emerald-500/10 border-emerald-500/30' :
          'bg-destructive/10 border-destructive/30'
        }`}>
          {sync.status === 'running' && <ArrowsClockwise size={18} className="animate-spin text-blue-500" />}
          {sync.status === 'success' && <CheckCircle size={18} className="text-emerald-500" />}
          {sync.status === 'error' && <WarningCircle size={18} className="text-destructive" />}
          <div className="flex-1">
            {sync.status === 'running' && (
              <span>
                Sincronizacion en curso. <strong>{sync.elapsed_seconds}s</strong> transcurridos
                {sync.total_fetched ? ` - ${sync.total_fetched} traidos / ${sync.total_created} nuevos / ${sync.total_updated} actualizados` : ''}
              </span>
            )}
            {sync.status === 'success' && (
              <span>
                Ultima sync OK. <strong>{sync.total_fetched}</strong> productos
                ({sync.total_created} nuevos, {sync.total_updated} actualizados, {sync.total_skipped} omitidos)
                - {sync.elapsed_seconds}s - finalizo {new Date(sync.finished_at!).toLocaleTimeString()}
              </span>
            )}
            {sync.status === 'error' && (
              <span>
                Error en ultima sync: <strong>{sync.error_message || 'desconocido'}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 border rounded-lg bg-muted/30">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <MagnifyingGlass size={16} className="text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre..."
            className="flex-1 px-2 py-1 text-sm bg-transparent border-b focus:outline-none focus:border-primary"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          className="px-3 py-1.5 text-sm border rounded bg-background"
        >
          <option value="all">Todos los origenes</option>
          <option value="manual">Solo manuales</option>
          <option value="wc">Solo WC</option>
          <option value="wp_menu">Solo del menu WP</option>
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
          />
          Ocultar vacias
        </label>
      </div>

      {loading && <div className="text-muted-foreground">Cargando arbol...</div>}

      {error && (
        <div className="bg-destructive/10 text-destructive rounded p-3 text-sm">{error}</div>
      )}

      {!loading && !error && tree.length === 0 && (
        <div className="bg-muted rounded p-8 text-center text-muted-foreground">
          Sin categorias en este proyecto.
          <br />
          <button onClick={openCreateRoot} className="text-primary hover:underline mt-2 inline-block">
            Crear la primera
          </button>
        </div>
      )}

      {!loading && tree.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground mb-3">
            <strong>{stats.total}</strong> categorias - <strong>{stats.productos}</strong> productos asignados
          </div>
          <div className="border rounded-lg p-2 bg-card">
            {tree
              .filter((n) => nodeMatchesRecursive(n, search, hideEmpty, sourceFilter))
              .map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  search={search}
                  hideEmpty={hideEmpty}
                  sourceFilter={sourceFilter}
                  onCreate={openCreateChild}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
          </div>
        </>
      )}

      {form && (
        <FormModal
          state={form}
          onCancel={() => setForm(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      )}
    </div>
  );
}
