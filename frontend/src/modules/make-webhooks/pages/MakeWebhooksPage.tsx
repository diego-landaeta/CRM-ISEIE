import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlugsConnected, Plus } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { toast } from '@/shared/hooks/useToast';

interface MakeWebhook {
  id: number;
  project_id: number;
  slug: string;
  label: string;
  mode: 'test' | 'active';
  total_received: number;
  total_created: number;
  total_errors: number;
  last_received_at: string | null;
  active: boolean;
}

export default function MakeWebhooksPage() {
  const { activeProject } = useProjectContext() as any;
  const navigate = useNavigate();
  const [items, setItems] = useState<MakeWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const res = await client.get(`/make-webhooks?projectId=${activeProject.id}`);
      if (res.success) setItems((res.data as MakeWebhook[]) || []);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  async function createNew() {
    if (!activeProject?.id || creating) return;
    setCreating(true);
    try {
      const res = await client.post('/make-webhooks', {
        project_id: activeProject.id,
        label: 'Nuevo conector Make',
        mode: 'test',
        field_mapping: {},
      });
      if (res.success && res.data) {
        toast({ title: 'Webhook creado en modo test' });
        navigate(`/make-webhooks/${res.data.id}`);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally { setCreating(false); }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Make Webhooks"
        subtitle={`Conectores desde Make.com hacia ${activeProject?.nombre || 'este proyecto'}`}
        actions={
          <button
            onClick={createNew}
            disabled={creating || !activeProject?.id}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus size={14} weight="bold" /> Nuevo conector
          </button>
        }
      />

      {loading ? (
        <SkeletonTable rows={3} columns={1} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PlugsConnected}
          title="Sin conectores Make"
          description="Crea uno para recibir leads desde un escenario de Make.com con la asesora ya asignada."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((w) => (
            <button
              key={w.id}
              onClick={() => navigate(`/make-webhooks/${w.id}`)}
              className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{w.label}</p>
                  <p className="text-[11px] text-muted-foreground font-mono truncate">/{w.slug}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  w.mode === 'active'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                }`}>
                  {w.mode === 'active' ? 'ACTIVO' : 'TEST'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Recibidos</p>
                  <p className="font-semibold tabular-nums">{w.total_received}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Leads creados</p>
                  <p className="font-semibold tabular-nums text-emerald-600">{w.total_created}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Errores</p>
                  <p className={`font-semibold tabular-nums ${w.total_errors > 0 ? 'text-red-600' : ''}`}>{w.total_errors}</p>
                </div>
              </div>
              {w.last_received_at && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  Ultimo: {new Date(w.last_received_at).toLocaleString('es-ES')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
