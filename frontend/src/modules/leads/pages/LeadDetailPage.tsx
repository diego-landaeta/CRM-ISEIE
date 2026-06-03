import { useState, useEffect, useRef } from 'react';
import type { LeadStatus } from '@/shared/types';
import { useParams, useNavigate } from 'react-router-dom';
import { useLeadDetail } from '../hooks/useLeads';
import ConversionsTab from '@/modules/conversions/components/ConversionsTab';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { ArrowClockwise, CurrencyEur, WarningCircle } from '@phosphor-icons/react';
import { STATUS_LABELS as ESTADO_LABELS } from '@/shared/components/ui/StatusBadge';
import EmptyState from '@/shared/components/ui/EmptyState';
import LeadHeaderCard from '../components/lead-detail/LeadHeaderCard';
import LeadInfoCard from '../components/lead-detail/LeadInfoCard';
import LeadProductsCard from '../components/lead-detail/LeadProductsCard';
import LeadUtmsCard from '../components/lead-detail/LeadUtmsCard';
import LeadInteractionsCard, { InteractionDialog } from '../components/lead-detail/LeadInteractionsCard';
import LeadRemindersCard, { ReminderDialog } from '../components/lead-detail/LeadRemindersCard';
import LeadTimelineCard from '../components/lead-detail/LeadTimelineCard';
import LeadSidebar from '../components/lead-detail/LeadSidebar';
import LeadLossDialog from '../components/lead-detail/LeadLossDialog';
import LeadReassignDialog from '../components/lead-detail/LeadReassignDialog';
import MergeLeadDialog from '../components/MergeLeadDialog';
import LeadEmailDialog from '../components/LeadEmailDialog';
import LeadEmailsCard from '../components/LeadEmailsCard';
import EnrollSequenceModal from '../components/EnrollSequenceModal';

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="w-24 h-4 bg-muted rounded animate-pulse" />
      <div className="flex items-center gap-4 animate-pulse">
        <div className="w-12 h-12 rounded-full bg-muted" />
        <div>
          <div className="w-40 h-6 bg-muted rounded mb-2" />
          <div className="w-24 h-4 bg-muted rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-card p-6 rounded-lg border border-border animate-pulse">
            <div className="w-32 h-5 bg-muted rounded mb-5" />
            <div className="grid grid-cols-2 gap-5">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i}>
                  <div className="w-16 h-3 bg-muted rounded mb-2" />
                  <div className="w-28 h-4 bg-muted rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-card p-5 rounded-lg border border-border animate-pulse">
              <div className="w-24 h-4 bg-muted rounded mb-3" />
              <div className="w-full h-11 bg-muted rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    lead, timeline, interacciones, reminders, utms, loading, error, refetch,
    updateStatus, addInteraction: addInteractionRaw, addReminder: addReminderRaw,
    completeReminder: completeReminderRaw, reassign: reassignRaw, updateLead: updateLeadRaw,
  } = useLeadDetail(id);

  // Wrappers que descartan el ApiResponse para compatibilidad con sub-componentes
  // que esperan Promise<void>.
  const addInteraction = async (tipo: 'whatsapp' | 'llamada' | 'email' | 'nota', nota: string, fecha?: string): Promise<void> => {
    await addInteractionRaw(tipo, nota, fecha);
  };
  const addReminder = async (fecha: string, nota: string): Promise<void> => {
    await addReminderRaw(fecha, nota);
  };
  const completeReminder = async (remId: number): Promise<void> => {
    await completeReminderRaw(remId);
  };
  const reassign = async (responsable_id: number): Promise<void> => {
    await reassignRaw(responsable_id);
  };
  const updateLead = async (fields: Partial<import('@/shared/types').Lead>): Promise<void> => {
    await updateLeadRaw(fields);
  };

  const [selectedEstado, setSelectedEstado] = useState<LeadStatus | ''>('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const [gestores, setGestores] = useState([]);
  const scrollTimeoutRef = useRef(null);

  useEffect(() => () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  }, []);

  const [interactionOpen, setInteractionOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailRefreshKey, setEmailRefreshKey] = useState(0);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin || gestores.length > 0) return;
    client.get('/users?limit=100')
      .then((res) => { if (res.success) setGestores(res.data || []); })
      .catch(() => {});
  }, [isAdmin, gestores.length]);

  useEffect(() => {
    if (lead?.estado && !selectedEstado) {
      setSelectedEstado(lead.estado);
    }
  }, [lead, selectedEstado]);

  async function handleEstadoUpdate() {
    if (!selectedEstado || selectedEstado === lead.estado) return;

    if (selectedEstado === 'convertido') {
      toast({
        title: 'Registra la compra',
        description: 'Ve al apartado "Historial de compras" más abajo y registra la conversión con importe y método de pago.',
      });
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        document.querySelector('[data-section="compras"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }
    if (selectedEstado === 'no_interesado') {
      setLossOpen(true);
      return;
    }

    setStatusLoading(true);
    try {
      await updateStatus(selectedEstado, `Cambio manual a ${ESTADO_LABELS[selectedEstado]}`);
      toast({ title: 'Estado actualizado', description: `Cambiado a ${ESTADO_LABELS[selectedEstado]}` });
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleLossConfirm(reason) {
    if (!reason) return;
    setStatusLoading(true);
    try {
      await updateStatus('no_interesado', reason);
      toast({ title: 'Lead marcado como no interesado', description: `Motivo: ${reason}` });
      setLossOpen(false);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setStatusLoading(false);
    }
  }

  if (loading) return <LoadingSkeleton />;

  if (error || !lead) {
    return (
      <EmptyState
        icon={WarningCircle}
        title={error ? 'No se pudo cargar el lead' : 'Lead no encontrado'}
        description={error || 'El prospecto que buscas ya no existe o no tienes permisos para verlo.'}
        action={
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => navigate('/leads')}
              className="text-sm font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 rounded px-2 py-1"
            >
              Volver a Prospectos
            </button>
            {error && (
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground border border-border bg-card px-3 py-1.5 rounded-lg hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
              >
                <ArrowClockwise size={12} weight="bold" /> Reintentar
              </button>
            )}
          </div>
        }
        className="py-24"
      />
    );
  }

  return (
    <div className="space-y-5">
      <LeadLossDialog
        open={lossOpen}
        onClose={() => setLossOpen(false)}
        onConfirm={handleLossConfirm}
        loading={statusLoading}
      />
      <InteractionDialog
        open={interactionOpen}
        onClose={() => setInteractionOpen(false)}
        onSubmit={addInteraction}
      />
      <ReminderDialog
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        onSubmit={addReminder}
      />
      <LeadReassignDialog
        open={reassignOpen}
        gestores={gestores}
        onClose={() => setReassignOpen(false)}
        onSubmit={reassign}
      />
      <MergeLeadDialog
        open={mergeOpen}
        winner={lead}
        projectId={lead.project_id}
        onClose={() => setMergeOpen(false)}
        onMerged={() => { setMergeOpen(false); refetch?.(); }}
      />
      <LeadEmailDialog
        open={emailOpen}
        leadId={lead.id}
        leadName={lead.nombre}
        leadEmail={lead.email}
        onClose={() => setEmailOpen(false)}
        onSent={() => setEmailRefreshKey(k => k + 1)}
      />
      <EnrollSequenceModal
        open={enrollOpen}
        leadId={lead.id}
        onClose={() => setEnrollOpen(false)}
        onEnrolled={() => setEnrollOpen(false)}
      />

      <LeadHeaderCard
        lead={lead}
        isAdmin={isAdmin}
        onReassign={() => setReassignOpen(true)}
        onBack={() => navigate('/leads')}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <LeadInfoCard lead={lead} onUpdate={updateLead} />
          <LeadProductsCard leadId={lead.id} projectId={lead.project_id} isAdmin={isAdmin} />
          <LeadUtmsCard utms={utms} leadOrigen={lead.origen} />
          <LeadInteractionsCard
            interacciones={interacciones}
            onOpen={() => setInteractionOpen(true)}
          />
          <LeadEmailsCard
            leadId={lead.id}
            hasEmail={!!lead.email}
            onCompose={() => setEmailOpen(true)}
            onEnrollSequence={() => setEnrollOpen(true)}
            refreshKey={emailRefreshKey}
          />
          <div data-section="compras" className="bg-card p-5 rounded-lg border border-border">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <CurrencyEur size={16} weight="regular" /> Historial de compras
            </h3>
            <ConversionsTab
              lead={lead}
              projectId={lead.project_id}
              canManage={user?.role === 'admin' || user?.role === 'superadmin' || lead.responsable_id === user?.id}
            />
          </div>
          <LeadRemindersCard
            reminders={reminders}
            onOpen={() => setReminderOpen(true)}
            onComplete={completeReminder}
          />
          <LeadTimelineCard timeline={timeline} />
        </div>

        <LeadSidebar
          lead={lead}
          interacciones={interacciones}
          reminders={reminders}
          isAdmin={isAdmin}
          selectedEstado={selectedEstado}
          onSelectedEstadoChange={setSelectedEstado}
          statusLoading={statusLoading}
          onEstadoUpdate={handleEstadoUpdate}
          onOpenInteraction={() => setInteractionOpen(true)}
          onOpenReminder={() => setReminderOpen(true)}
          onOpenReassign={() => setReassignOpen(true)}
          onOpenMerge={() => setMergeOpen(true)}
        />
      </div>
    </div>
  );
}
