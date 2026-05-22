import { Funnel, Lightning, ChartPieSlice, Phone, CalendarCheck, Users } from '@phosphor-icons/react';
import { STATUS_LABELS as ESTADO_LABELS } from '@/shared/components/ui/StatusBadge';
import { CHANNEL_LABELS as CANAL_LABELS } from '@/shared/components/ui/ChannelBadge';
import Select from '@/shared/components/ui/Select';
import type { Lead, Interaction, Reminder, LeadStatus } from '@/shared/types';

interface LeadSidebarProps {
  lead: Lead;
  interacciones: Interaction[];
  reminders: Reminder[];
  isAdmin: boolean;
  selectedEstado: LeadStatus | '';
  onSelectedEstadoChange: (s: LeadStatus | '') => void;
  statusLoading: boolean;
  onEstadoUpdate: () => void;
  onOpenInteraction: () => void;
  onOpenReminder: () => void;
  onOpenReassign: () => void;
}

export default function LeadSidebar({
  lead, interacciones, reminders, isAdmin,
  selectedEstado, onSelectedEstadoChange, statusLoading, onEstadoUpdate,
  onOpenInteraction, onOpenReminder, onOpenReassign,
}: LeadSidebarProps) {
  return (
    <div className="space-y-3">
      <div className="bg-card p-4 rounded-lg border border-border">
        <h3 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
          <Funnel size={14} weight="regular" className="text-muted-foreground" /> Cambiar estado
        </h3>
        <Select<LeadStatus | ''>
          value={selectedEstado}
          onChange={onSelectedEstadoChange}
          options={Object.entries(ESTADO_LABELS).map(([k, v]) => ({ value: k as LeadStatus, label: v }))}
          ariaLabel="Cambiar estado"
        />
        <button
          onClick={onEstadoUpdate}
          disabled={statusLoading || selectedEstado === lead.estado}
          className="w-full h-9 mt-2 bg-primary text-primary-foreground rounded-md text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          {statusLoading ? 'Guardando…' : selectedEstado === 'convertido' && lead.estado !== 'convertido' ? 'Convertir lead' : 'Actualizar'}
        </button>
      </div>

      <div className="bg-card p-4 rounded-lg border border-border">
        <h3 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
          <Lightning size={14} weight="regular" className="text-muted-foreground" /> Acciones rápidas
        </h3>
        <div className="space-y-2">
          <button
            onClick={onOpenInteraction}
            className="w-full h-9 rounded-md border border-border bg-card text-[13px] font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
          >
            <Phone size={14} weight="bold" /> Registrar interacción
          </button>
          <button
            onClick={onOpenReminder}
            className="w-full h-9 rounded-md border border-border bg-card text-[13px] font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
          >
            <CalendarCheck size={14} weight="bold" /> Programar recordatorio
          </button>
          {isAdmin && (
            <button
              onClick={onOpenReassign}
              className="w-full h-9 rounded-md border border-border bg-card text-[13px] font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
            >
              <Users size={14} weight="bold" /> Reasignar
            </button>
          )}
        </div>
      </div>

      <div className="bg-card p-4 rounded-lg border border-border">
        <h3 className="text-[13px] font-semibold mb-2 flex items-center gap-1.5">
          <ChartPieSlice size={14} weight="regular" className="text-muted-foreground" /> Resumen
        </h3>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Interacciones</span>
            <span className="font-semibold">{interacciones.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Recordatorios</span>
            <span className="font-semibold">{reminders.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cambios de estado</span>
            <span className="font-semibold">{(lead.statusHistory || []).length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Canal</span>
            <span className="font-semibold">{(lead.origen && CANAL_LABELS[lead.origen]) || lead.origen || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
