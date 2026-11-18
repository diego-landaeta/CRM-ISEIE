import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PlugsConnected, Plus } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import WebhookCard from '../components/WebhookCard';
import type { Webhook } from '../lib/types';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

type WebhookListItem = Webhook & { awaiting_sample?: boolean };

export default function WebhooksPage() {
  const { activeProject } = useProjectContext();
  const navigate = useNavigate();
  const [webhooks, setWebhooks] = useState<WebhookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WebhookListItem | null>(null);
  const [creating, setCreating] = useState(false);
  // Estos webhooks son formularios con `kind='webhook'`: el servidor los guarda en
  // `/api/forms` y pide `forms.*`. Sin el permiso, el botón no sale (era un 403).
  const { can } = usePermission();
  const puedeCrear = can('forms.create');
  const puedeEditar = can('forms.edit');
  const puedeBorrar = can('forms.delete');

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const res = await client.get(`/forms?projectId=${activeProject.id}&kind=webhook`);
      if (res.success) setWebhooks((res.data as WebhookListItem[]) || []);
    } catch (err: any) {
      toast({ title: 'Error cargando webhooks', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  // CRM-147: quick-add via ?new=1 — crea un webhook y navega a su detalle.
  // Usamos un ref para no doble-disparar en StrictMode.
  const [searchParams, setSearchParams] = useSearchParams();
  const quickAddFiredRef = useRef(false);
  useEffect(() => {
    if (searchParams.get('new') === '1' && !quickAddFiredRef.current) {
      quickAddFiredRef.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
      // createNew necesita activeProject.id, lo haremos cuando esté listo.
      if (activeProject?.id && puedeCrear) createNew();
    }
  }, [searchParams, setSearchParams, activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createNew(): Promise<void> {
    if (!activeProject?.id || creating) return;
    setCreating(true);
    try {
      const res = await client.post('/forms', {
        project_id: activeProject.id,
        nombre: 'Nuevo webhook',
        kind: 'webhook',
        destination: 'lead',
        config: {},
        field_mapping: {},
        active: true,
      });
      if (res.success && res.data) {
        toast({ title: 'Webhook creado' });
        navigate(`/conexion/webhooks/prospectos/${res.data.id}`);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(w: WebhookListItem): Promise<void> {
    try {
      await client.patch(`/forms/${w.id}`, { active: !w.active });
      toast({ title: w.active ? 'Webhook apagado' : 'Webhook encendido' });
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  async function toggleListen(w: WebhookListItem): Promise<void> {
    try {
      if (w.awaiting_sample) await client.post(`/forms/${w.id}/listen/stop`);
      else await client.post(`/forms/${w.id}/listen`);
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await client.delete(`/forms/${deleteTarget.id}`);
      toast({ title: 'Eliminado' });
      load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Webhooks"
        subtitle={`${webhooks.length} en ${activeProject?.nombre || 'este proyecto'}`}
        actions={puedeCrear ? (
          <button
            onClick={createNew}
            disabled={creating}
            aria-label="Nuevo webhook"
            className="flex items-center gap-1 h-9 px-3 sm:px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50"
          >
            <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nuevo webhook</span>
          </button>
        ) : undefined}
      />

      {loading ? (
        <SkeletonTable rows={3} columns={3} />
      ) : webhooks.length === 0 ? (
        <EmptyState
          icon={PlugsConnected}
          title="Sin webhooks"
          description="Crea un webhook para recibir leads desde sistemas externos (Make, Zapier, n8n, integraciones custom)."
          action={puedeCrear ? (
            <button
              onClick={createNew}
              disabled={creating}
              className="flex items-center gap-1 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50"
            >
              <Plus size={14} weight="bold" /> Nuevo webhook
            </button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3">
          {webhooks.map((w) => (
            <WebhookCard
              key={w.id}
              webhook={w}
              onToggleActive={toggleActive}
              onToggleListen={toggleListen}
              onDelete={setDeleteTarget}
              puedeEditar={puedeEditar}
              puedeBorrar={puedeBorrar}
            />
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!deleteTarget}
          title="Eliminar webhook"
          message={`¿Eliminar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          tone="destructive"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </Suspense>
    </div>
  );
}
