import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, CurrencyEur, ArrowSquareOut, Phone } from '@phosphor-icons/react';
import client from '@/shared/api/client';

interface LeadInfo {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  estado: string;
  producto_nombre: string | null;
  valor_estimado: number | null;
  responsable_nombre: string | null;
}

const ESTADO_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  por_contactar: 'Por contactar',
  contactado: 'Contactado',
  en_seguimiento: 'Seguimiento',
  convertido: 'Convertido',
  no_interesado: 'No interesado',
};

interface Props {
  leadId: number;
  isOwn: boolean;
}

export default function LeadCard({ leadId, isOwn }: Props) {
  const [lead, setLead] = useState<LeadInfo | null>(null);

  useEffect(() => {
    client.get(`/leads/${leadId}`)
      .then(r => { if (r.success) setLead(r.data); })
      .catch(() => {});
  }, [leadId]);

  if (!lead) {
    return (
      <div className={`mt-1.5 px-3 py-2 rounded-lg text-[11px] ${
        isOwn ? 'bg-white/10' : 'bg-muted/50 border border-border'
      }`}>
        <span className={isOwn ? 'text-white/60' : 'text-muted-foreground'}>Cargando prospecto...</span>
      </div>
    );
  }

  const cardBg = isOwn ? 'bg-success/40' : 'bg-muted/40 border border-border';
  const textPrimary = isOwn ? 'text-white' : 'text-foreground';
  const textSecondary = isOwn ? 'text-white/60' : 'text-muted-foreground';
  const tagBg = isOwn ? 'bg-white/15 text-white/80' : 'bg-muted text-muted-foreground';

  return (
    <Link
      to={`/leads/${lead.id}`}
      className={`block mt-2 rounded-lg overflow-hidden transition-opacity hover:opacity-90 ${cardBg}`}
    >
      <div className="px-3 py-2.5 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isOwn ? 'bg-white/15' : 'bg-primary/10'}`}>
              <User size={15} weight="fill" className={isOwn ? 'text-white/70' : 'text-primary'} />
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-semibold truncate ${textPrimary}`}>{lead.nombre}</p>
              <p className={`text-[10px] truncate ${textSecondary}`}>{lead.email}</p>
            </div>
          </div>
          <ArrowSquareOut size={11} className={textSecondary} />
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tagBg}`}>
            {ESTADO_LABEL[lead.estado] || lead.estado}
          </span>
          {lead.producto_nombre && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${tagBg}`}>
              {lead.producto_nombre}
            </span>
          )}
          {lead.valor_estimado != null && lead.valor_estimado > 0 && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-0.5 ${tagBg}`}>
              <CurrencyEur size={9} />{lead.valor_estimado}
            </span>
          )}
        </div>

        {/* Footer */}
        {(lead.telefono || lead.responsable_nombre) && (
          <div className={`flex items-center gap-3 text-[10px] ${textSecondary}`}>
            {lead.telefono && <span className="flex items-center gap-1"><Phone size={10} />{lead.telefono}</span>}
            {lead.responsable_nombre && <span>Resp: {lead.responsable_nombre}</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
