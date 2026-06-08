import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, GitMerge, MagnifyingGlass } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { rfcApi, RfcSummary, ESTADO_LABELS, ESTADO_COLORS } from '../api/changeRequests.api';
import { toast } from '@/shared/hooks/useToast';

// Lista de solicitudes de cambio (RFCs). Cualquier user ve las suyas;
// admin/PM/superadmin ven todas.
export default function ChangeRequestsPage() {
  const navigate = useNavigate();
  const { activeProject, user, projects } = useAuth() as { activeProject: { id?: number } | null; user: { role: string } | null; projects: Array<{ id: number; nombre: string }> };
  const [items, setItems] = useState<RfcSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [estadoFilter, setEstadoFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  // Selector de proyecto al crear. null = "General" (cross-proyecto / plataforma).
  // Default: el proyecto activo del header (lo más intuitivo); si no hay, "General".
  const [newProjectId, setNewProjectId] = useState<number | null>(activeProject?.id ?? null);

  // Cuando cambia el activeProject del header, actualizar el default del selector.
  useEffect(() => {
    if (activeProject?.id) setNewProjectId(activeProject.id);
  }, [activeProject?.id]);

  const fullVisibility = ['superadmin', 'admin', 'project_manager'].includes(user?.role || '');

  function load() {
    setLoading(true);
    // NO filtro por activeProject: la lista de solicitudes muestra TODAS las
    // accesibles al user (suyas si es gestor; todas si es PM/admin/superadmin).
    // Las RFC "General" siempre aparecen para los con visibilidad total.
    rfcApi.list({
      estado: estadoFilter || undefined,
    })
      .then((r: any) => setItems(r?.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [estadoFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (newTitle.trim().length < 3) {
      toast({ title: 'Escribe un título', description: 'Mínimo 3 caracteres. Ej: "Cambiar el logo del formulario de contacto".', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await rfcApi.create({ projectId: newProjectId ?? undefined, titulo: newTitle.trim() } as any);
      toast({ title: 'Solicitud creada', description: `Código: ${res.data?.codigo_rfc || ''}` });
      setNewTitle('');
      navigate(`/solicitudes-cambio/${res.data.id}`);
    } catch (err: any) {
      toast({ title: 'Error al crear', description: err?.data?.error || err?.message || 'fallo desconocido', variant: 'destructive' });
    } finally { setCreating(false); }
  }

  const filtered = search.trim()
    ? items.filter((it) => (it.titulo + ' ' + it.codigo_rfc + ' ' + (it.solicitante_nombre || '')).toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Solicitudes de cambio</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {fullVisibility
              ? 'Todas las solicitudes de cambio (RFC) del proyecto. Tú eres PM/Admin y puedes completar la parte técnica y aprobar.'
              : 'Tus solicitudes de cambio. Crea una nueva o consulta el estado de las existentes.'}
          </p>
        </div>
      </div>

      {/* Crear nueva */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground block">
          Nueva solicitud de cambio
        </label>
        <div className="flex gap-2 items-stretch flex-wrap sm:flex-nowrap">
          {/* Selector de proyecto: muestra siempre, default al proyecto activo.
             "General" cuando el cambio no aplica a un proyecto concreto. */}
          {(projects && projects.length > 0) && (
            <select
              value={newProjectId == null ? 'general' : String(newProjectId)}
              onChange={(e) => setNewProjectId(e.target.value === 'general' ? null : parseInt(e.target.value))}
              title="¿A qué proyecto va dirigida esta solicitud?"
              className="h-10 px-2 rounded-md border border-border bg-card text-sm min-w-[140px]"
            >
              <option value="general">📊 General</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          )}
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim().length >= 3) handleCreate(); }}
            placeholder="Título del cambio (ej. 'Cambiar logo en formulario de contacto')"
            className="flex-1 h-10 px-3 rounded-md border border-border bg-card text-sm"
            maxLength={300}
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus size={14} weight="bold" /> {creating ? 'Creando…' : 'Crear'}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {newProjectId == null
            ? 'Solicitud "General": el cambio aplica a la plataforma o a varios proyectos.'
            : `Esta solicitud quedará vinculada al proyecto seleccionado arriba.`}
        </p>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, título o solicitante…"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-sm"
          />
        </div>
        <select
          value={estadoFilter}
          onChange={(e) => setEstadoFilter(e.target.value)}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-muted/40 rounded animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <GitMerge size={36} weight="duotone" className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {search ? 'Sin resultados para tu búsqueda.' : 'Sin solicitudes todavía. Crea la primera arriba.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((it) => (
            <li key={it.id}
              onClick={() => navigate(`/solicitudes-cambio/${it.id}`)}
              className="bg-card border border-border rounded-lg p-4 hover:bg-muted/40 cursor-pointer transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-mono font-bold text-muted-foreground">{it.codigo_rfc}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ESTADO_COLORS[it.estado] || 'bg-muted'}`}>
                      {ESTADO_LABELS[it.estado] || it.estado}
                    </span>
                    {it.n_attachments > 0 && (
                      <span className="text-[10px] text-muted-foreground">📎 {it.n_attachments}</span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold truncate">{it.titulo}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Solicitado por <strong>{it.solicitante_nombre || '—'}</strong>
                    {it.proyecto_nombre && <> · {it.proyecto_nombre}</>}
                    {' · '}
                    {new Date(it.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
