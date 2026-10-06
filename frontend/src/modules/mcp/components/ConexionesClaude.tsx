import { useCallback, useEffect, useState } from 'react';
import { Plus, Robot, PencilSimple, Trash, ArrowClockwise, PlugsConnected } from '@phosphor-icons/react';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { ponerAmbito, TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';
import { lista } from '@/shared/lib/lista';
import { conectoresApi, type Campus, type Conector } from '@/modules/connectors/api/connectors.api';
import ParaQuien from '@/modules/connectors/components/ParaQuien';
import DialogoConexionClaude from './DialogoConexionClaude';
import UrlParaClaude from './UrlParaClaude';

/**
 * Las conexiones de Claude, en Conexión → MCP.
 *
 * Diego, 29/09: «que funcione por empresa y todos los proyectos, y puedas ver
 * quién gestiona o quién creó un MCP y en dónde; Antonio solo puede consultar y
 * ver los de su empresa, en cambio Manuel Casas puede ver TODO en todos lados».
 *
 * Sigue lo que esté puesto arriba: «Todos los proyectos» enseña todo lo que la
 * persona puede ver, una empresa lo de esa empresa y un campus lo de ese campus.
 * Qué ve cada uno lo decide el servidor (`connectors.controller.js`): el super
 * admin, todo; un admin, lo de sus campus y sus empresas, nunca lo de todo el
 * sistema.
 */

function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ConexionesClaude() {
  const { activeProject, activeIssuerId, activeIssuer, isAllProjects } = useProjectContext() as {
    activeProject: { id: number; nombre?: string } | null;
    activeIssuerId: number | null;
    activeIssuer: { nombre?: string } | null;
    isAllProjects: boolean;
  };
  const { user, projects } = useAuth() as {
    user: { role?: string } | null;
    projects: Campus[];
  };
  const esSuperadmin = user?.role === 'superadmin';
  const projectId = !activeIssuerId && !isAllProjects && activeProject?.id && activeProject.id !== TODOS_LOS_PROYECTOS
    ? activeProject.id : null;
  const ambito = activeIssuerId
    ? (activeIssuer?.nombre || 'Esta empresa')
    : projectId ? (activeProject?.nombre || 'Este campus') : (esSuperadmin ? 'Todo el sistema' : 'Todas tus empresas');

  const [conexiones, setConexiones] = useState<Conector[]>([]);
  const [cargando, setCargando] = useState(true);
  // `undefined` = cerrado; `null` = alta; una conexión = cambio.
  const [editando, setEditando] = useState<Conector | null | undefined>(undefined);
  const [urlClaude, setUrlClaude] = useState<{ token: string; nombre: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject: projectId ? { id: projectId } : null });
      const r = await conectoresApi.listar(params, 'mcp');
      setConexiones(r.success ? lista<Conector>(r.data) : []);
    } catch (e) {
      toast({ title: 'No se pudieron cargar las conexiones', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [activeIssuerId, projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function urlNueva(c: Conector) {
    if (c.mcp_mio && !window.confirm('Se va a crear una URL nueva y la que tienes ahora en Claude dejará de funcionar. ¿Seguir?')) return;
    try {
      const r = await conectoresApi.mcpUrl(c.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      setUrlClaude({ token: r.data.token, nombre: c.label });
      cargar();
    } catch (e) {
      toast({ title: 'No se pudo sacar la URL', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function borrar(c: Conector) {
    const gente = c.personas_con_url || 0;
    if (!window.confirm(`Se va a borrar la conexión «${c.label}».\n\n${gente
      ? `${gente === 1 ? 'La persona que tiene' : `Las ${gente} personas que tienen`} URL dejará${gente === 1 ? '' : 'n'} de poder consultar el CRM desde Claude al momento.`
      : 'Nadie tiene URL todavía.'} ¿Seguir?`)) return;
    try {
      const r = await conectoresApi.borrar(c.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      toast({ title: 'Conexión borrada' });
      cargar();
    } catch (e) {
      toast({ title: 'No se pudo borrar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-border flex flex-wrap items-center gap-2">
        <PlugsConnected size={18} weight="bold" className="text-primary" />
        <div className="flex-1 min-w-[200px]">
          <h2 className="font-semibold text-sm">Conexiones de Claude</h2>
          <p className="text-xs text-muted-foreground">
            {ambito} · para quién es cada una, quién la creó y quién tiene su URL
          </p>
        </div>
        <button type="button" onClick={cargar} disabled={cargando} aria-label="Actualizar"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-bold hover:bg-muted disabled:opacity-50">
          <ArrowClockwise size={14} className={cargando ? 'animate-spin' : ''} />
        </button>
        <button type="button" onClick={() => setEditando(null)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">
          <Plus size={14} weight="bold" /> Nueva conexión con Claude
        </button>
      </div>

      {cargando && !conexiones.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : !conexiones.length ? (
        <EmptyState icon={Robot} title="Todavía no hay conexiones aquí"
          description="Una conexión da a cada persona una URL para Claude acotada a un campus, a una empresa entera o, si eres super admin, a todo el sistema." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] uppercase text-muted-foreground">
                <th className="text-left font-bold px-4 py-2.5">Conexión</th>
                <th className="text-left font-bold px-4 py-2.5">Para quién</th>
                <th className="text-left font-bold px-4 py-2.5">Creada por</th>
                <th className="text-left font-bold px-4 py-2.5">Con URL</th>
                <th className="text-left font-bold px-4 py-2.5">Último uso</th>
                <th className="text-left font-bold px-4 py-2.5">Tu URL</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {conexiones.map((c) => (
                <tr key={c.id} className={`border-b border-border last:border-0 ${c.active ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{c.label}</p>
                    {!c.active && <p className="text-[11px] text-muted-foreground">Apagada: sus URLs no traen nada</p>}
                  </td>
                  <td className="px-4 py-3"><ParaQuien c={c} /></td>
                  <td className="px-4 py-3">
                    <p>{c.creado_por || '—'}</p>
                    <p className="text-[11px] text-muted-foreground">{fecha(c.created_at)}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" title={(c.con_url || []).join(', ') || undefined}>
                    {c.personas_con_url
                      ? <>{c.personas_con_url} · <span className="text-xs">{(c.con_url || []).slice(0, 3).join(', ')}{(c.con_url || []).length > 3 ? '…' : ''}</span></>
                      : 'Nadie'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fecha(c.ultimo_uso_claude)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {c.mcp_mio && <code className="text-[12px] text-muted-foreground">{c.mcp_mio.prefijo}…</code>}
                      <button type="button" onClick={() => urlNueva(c)} disabled={!c.active}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                        <Robot size={12} /> {c.mcp_mio ? 'URL nueva' : 'Sacar mi URL'}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {c.puede_tocar && (
                      <>
                        <button type="button" title="Editar" aria-label={`Editar ${c.label}`} onClick={() => setEditando(c)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                          <PencilSimple size={15} />
                        </button>
                        <button type="button" title="Borrar" aria-label={`Borrar ${c.label}`} onClick={() => borrar(c)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-muted">
                          <Trash size={15} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando !== undefined && (
        <DialogoConexionClaude
          conexion={editando}
          projectId={projectId}
          issuerId={activeIssuerId}
          proyectos={projects || []}
          esSuperadmin={esSuperadmin}
          onCerrar={() => setEditando(undefined)}
          onGuardado={(d) => {
            setEditando(undefined);
            cargar();
            if (d?.mcp?.token) setUrlClaude({ token: d.mcp.token, nombre: d.label });
          }}
        />
      )}
      {urlClaude && <UrlParaClaude token={urlClaude.token} nombre={urlClaude.nombre} onCerrar={() => setUrlClaude(null)} />}
    </div>
  );
}
