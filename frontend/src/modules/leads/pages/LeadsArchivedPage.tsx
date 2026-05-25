import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash, ArrowCounterClockwise, Users, MagnifyingGlass } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import { useConfirm } from '@/shared/components/ui/useConfirm';

interface ArchivedLead {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  status: string;
  deleted_at: string;
  responsable_nombre?: string | null;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(d).slice(0, 16); }
}

export default function LeadsArchivedPage() {
  const navigate = useNavigate();
  const { activeProject, user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const [leads, setLeads] = useState<ArchivedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [restoring, setRestoring] = useState<number | null>(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const res = await client.get('/leads', {
        params: { projectId: activeProject.id, archived: true, limit: 200, includeConverted: true, search: search.trim() || undefined },
      } as any);
      const data = (res as any)?.data?.data ?? (res as any)?.data ?? [];
      setLeads(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast({ title: 'No se pudo cargar la papelera', description: err?.message || 'Error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeProject?.id, search]);

  useEffect(() => { load(); }, [load]);

  async function handleRestore(lead: ArchivedLead) {
    if (!isSuperadmin) return;
    if (!(await confirm({ title: 'Restaurar lead', message: `¿Restaurar "${lead.nombre}"? Volverá al estado "${lead.status}" donde estaba antes de eliminarse.`, confirmLabel: 'Restaurar' }))) return;
    setRestoring(lead.id);
    try {
      await client.patch(`/leads/${lead.id}/restore`, {});
      toast({ title: 'Lead restaurado', description: lead.nombre });
      await load();
    } catch (err: any) {
      toast({ title: 'No se pudo restaurar', description: err?.message || 'Error', variant: 'destructive' });
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => navigate('/leads')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1">
            <ArrowLeft size={12} weight="bold" /> Volver a Prospectos
          </button>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight inline-flex items-center gap-2">
            <Trash size={22} weight="duotone" className="text-muted-foreground" />
            Papelera de prospectos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Leads eliminados (soft-delete) del proyecto {activeProject?.nombre || '—'}. Sólo superadmin puede restaurarlos.
          </p>
        </div>
      </header>

      <div className="relative max-w-md">
        <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email, teléfono…"
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
        />
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.5fr_1fr_1fr_1.2fr_0.6fr] gap-4 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <div>Prospecto</div>
          <div>Estado al borrar</div>
          <div>Responsable</div>
          <div>Eliminado</div>
          <div className="text-right">Acción</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Cargando papelera…</div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mb-4">
              <Users size={26} weight="duotone" className="text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1.5">Papelera vacía</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Los leads que elimines aparecerán aquí durante 90 días antes del borrado definitivo.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {leads.map((l) => (
              <div key={l.id} className="px-4 md:px-5 py-3 md:grid md:grid-cols-[1.5fr_1fr_1fr_1.2fr_0.6fr] md:gap-4 md:items-center text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{l.nombre}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{l.email || l.telefono || '—'}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1 md:mt-0">{l.status}</div>
                <div className="text-xs text-muted-foreground truncate">{l.responsable_nombre || 'Sin asignar'}</div>
                <div className="text-xs text-muted-foreground tabular-nums">{fmtDate(l.deleted_at)}</div>
                <div className="text-right">
                  {isSuperadmin ? (
                    <button
                      onClick={() => handleRestore(l)}
                      disabled={restoring === l.id}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                    >
                      <ArrowCounterClockwise size={12} weight="bold" />
                      {restoring === l.id ? 'Restaurando…' : 'Restaurar'}
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground italic">solo superadmin</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
