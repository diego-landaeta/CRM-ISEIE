import { useState } from 'react';
import {
  WhatsappLogo, EnvelopeSimple, CalendarPlus, CheckCircle, Lightning, PencilSimple, Trash, Flag,
} from '@phosphor-icons/react';
import { fillTemplate } from '../hooks/useWhatsappTemplates';
import { cleanPhone } from '../lib/leadFormat';

interface LeadLite {
  id: number;
  nombre?: string;
  telefono?: string | null;
  estado?: string;
}

interface WhatsappTemplate {
  id: string | number;
  label: string;
  text: string;
}

interface Props {
  lead: LeadLite;
  onMarkContacted?: (lead: LeadLite) => void;
  onConvert?: (lead: LeadLite) => void;
  onLogInteraction?: (lead: LeadLite, kind: string) => void;
  onCreateReminder?: (lead: LeadLite) => void;
  onEnrollSequence?: (lead: LeadLite) => void;
  onSoftDelete?: (lead: LeadLite) => void;  // superadmin
  onReportSpam?: (lead: LeadLite) => void;  // cualquier rol
  templates?: WhatsappTemplate[];
  projectName?: string;
  onEditTemplates?: () => void;
}

/**
 * Iconos de acción rápida en cada fila/card de lead. Mantiene su propio
 * estado para el menú desplegable de plantillas WhatsApp.
 */
export default function QuickActions({
  lead,
  onMarkContacted,
  onConvert,
  onLogInteraction,
  onCreateReminder,
  onEnrollSequence,
  onSoftDelete,
  onReportSpam,
  templates,
  projectName,
  onEditTemplates,
}: Props) {
  const wa = lead.telefono ? cleanPhone(lead.telefono) : null;
  const [waMenuOpen, setWaMenuOpen] = useState(false);

  function openWhatsappWithTemplate(tpl: WhatsappTemplate | null) {
    const text = tpl ? fillTemplate(tpl.text, { lead, projectName }) : '';
    const url = `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    window.open(url, '_blank', 'noopener');
    onLogInteraction?.(lead, 'whatsapp');
    setWaMenuOpen(false);
  }

  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {wa && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setWaMenuOpen((o) => !o)}
            title="WhatsApp con plantilla"
            className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-950/40 text-muted-foreground hover:text-green-700 dark:hover:text-green-400 transition-colors"
          >
            <WhatsappLogo size={14} weight="regular" />
          </button>
          {waMenuOpen && (
            <>
              <div className="fixed inset-0 !m-0 z-30" onClick={() => setWaMenuOpen(false)} />
              <div
                className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md py-1 min-w-60 z-40"
                style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}
              >
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Plantillas</div>
                <button
                  type="button"
                  onClick={() => openWhatsappWithTemplate(null)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2"
                >
                  <WhatsappLogo size={12} weight="regular" /> Mensaje en blanco
                </button>
                {(templates || []).map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => openWhatsappWithTemplate(tpl)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                    title={tpl.text}
                  >
                    <span className="font-medium block truncate">{tpl.label}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{tpl.text}</span>
                  </button>
                ))}
                {onEditTemplates && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      onClick={() => { onEditTemplates(); setWaMenuOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 text-muted-foreground"
                    >
                      <PencilSimple size={12} weight="regular" /> Editar plantillas
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {onEnrollSequence && (
        <button
          onClick={() => onEnrollSequence(lead)}
          title="Enrolar en secuencia de email"
          className="p-1.5 rounded hover:bg-amber-100 dark:hover:bg-amber-950/40 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
        >
          <EnvelopeSimple size={14} weight="regular" />
        </button>
      )}
      {onCreateReminder && (
        <button
          onClick={() => onCreateReminder(lead)}
          title="Programar siguiente contacto"
          className="p-1.5 rounded hover:bg-blue-100 dark:hover:bg-blue-950/40 text-muted-foreground hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
        >
          <CalendarPlus size={14} weight="regular" />
        </button>
      )}
      {lead.estado !== 'contactado' && lead.estado !== 'convertido' && lead.estado !== 'no_interesado' && onMarkContacted && (
        <button
          onClick={() => onMarkContacted(lead)}
          title="Marcar contactado"
          className="p-1.5 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
        >
          <CheckCircle size={14} weight="regular" />
        </button>
      )}
      {lead.estado !== 'convertido' && onConvert && (
        <button
          onClick={() => onConvert(lead)}
          title="Convertir a cliente"
          className="p-1.5 rounded hover:bg-violet-100 dark:hover:bg-violet-950/40 text-muted-foreground hover:text-violet-700 dark:hover:text-violet-400 transition-colors"
        >
          <Lightning size={14} weight="regular" />
        </button>
      )}
      {onReportSpam && (
        <button
          onClick={() => onReportSpam(lead)}
          title="Reportar como spam (revisa superadmin)"
          className="p-1.5 rounded hover:bg-orange-100 dark:hover:bg-orange-950/40 text-muted-foreground hover:text-orange-700 dark:hover:text-orange-400 transition-colors"
        >
          <Flag size={14} weight="regular" />
        </button>
      )}
      {onSoftDelete && (
        <button
          onClick={() => onSoftDelete(lead)}
          title="Eliminar (superadmin)"
          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-muted-foreground hover:text-red-700 dark:hover:text-red-400 transition-colors"
        >
          <Trash size={14} weight="regular" />
        </button>
      )}
    </div>
  );
}
