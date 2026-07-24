import { Link } from 'react-router-dom';
import { ArrowLeft, CaretRight, Lightning, WarningCircle, Link as LinkIcon, FileText } from '@phosphor-icons/react';
import StatusBadge from '@/shared/components/ui/StatusBadge';
import { getLeadPriority, getPriorityStyle } from '../../lib/leadPriority';
import { avatarColor, getInitials } from './InfoField';
import type { Lead } from '@/shared/types';

interface LeadHeaderCardProps {
  lead: Lead;
  isAdmin: boolean;
  onReassign: () => void;
  onBack: () => void;
}

export default function LeadHeaderCard({ lead, isAdmin, onReassign, onBack }: LeadHeaderCardProps) {
  return (
    <>
      {lead.lead_duplicado_de && (
        <div role="alert" className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
          <WarningCircle size={20} weight="bold" className="flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm flex-1">
            <span className="font-bold">Prospecto duplicado</span> — este email ya existe en el sistema.
          </div>
          <Link
            to={`/leads/${lead.lead_duplicado_de}`}
            className="text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          >
            <LinkIcon size={12} weight="bold" /> Ver original #{lead.lead_duplicado_de}
          </Link>
        </div>
      )}

      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link to="/leads" className="hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded px-1">
          Prospectos
        </Link>
        <CaretRight size={10} weight="bold" className="opacity-50" />
        <span className="text-foreground font-medium truncate max-w-[200px]">{lead.nombre}</span>
      </nav>

      <div className={`bg-card border border-border border-l-4 ${getPriorityStyle(getLeadPriority(lead)).borderClass} rounded-xl p-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold flex-shrink-0 ${avatarColor(lead.id)}`}>
              {getInitials(lead.nombre)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-semibold truncate">{lead.nombre}</h1>
                <StatusBadge status={lead.estado} showIcon />
              </div>
              <p className="text-muted-foreground text-xs mt-0.5">
                Prospecto #{lead.id} · creado {lead.created_at ? new Date(lead.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'}
                {lead.proyecto_nombre && <> · {lead.proyecto_nombre}</>}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {isAdmin && (
              <button
                onClick={onReassign}
                aria-label="Reasignar"
                className="h-9 px-3 rounded-lg border border-border bg-secondary text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
              >
                <Lightning size={14} weight="bold" /> <span className="hidden sm:inline">Reasignar</span>
              </button>
            )}
            <Link
              to={`/accounting/facturas/nueva?tipo=proforma&leadId=${lead.id}`}
              aria-label="Emitir proforma"
              title="Emitir una proforma (presupuesto) para este prospecto, sin convertir"
              className="h-9 px-3 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 text-sm font-medium hover:bg-sky-100 dark:hover:bg-sky-950/50 transition-colors flex items-center gap-2"
            >
              <FileText size={14} weight="bold" /> <span className="hidden sm:inline">Proforma</span>
            </Link>
            <button
              onClick={onBack}
              aria-label="Volver a prospectos"
              className="h-9 px-3 rounded-lg border border-border bg-secondary text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
            >
              <ArrowLeft size={14} weight="bold" />
              <span className="hidden sm:inline">Volver</span>
            </button>
          </div>
        </div>
      </div>

    </>
  );
}
