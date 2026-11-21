import { useState } from 'react';
import { Check, Trash } from '@phosphor-icons/react';
import type { Message } from '../api/messages.api';
import LeadCard from './LeadCard';

interface Props {
  message: Message;
  isOwn: boolean;
  onDelete?: () => void;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ message: m, isOwn, onDelete }: Props) {
  const [hover, setHover] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-2 group`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setConfirming(false); }}
    >
      <div className="relative max-w-[70%]">
        {isOwn && onDelete && hover && (
          <div className="absolute -left-8 top-1/2 -translate-y-1/2">
            {confirming ? (
              <button
                onClick={() => { onDelete(); setConfirming(false); }}
                className="w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[10px] font-bold hover:bg-destructive/80 transition-colors"
                title="Confirmar eliminar"
              >
                ?
              </button>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="w-6 h-6 rounded-full bg-muted/80 text-muted-foreground flex items-center justify-center hover:bg-destructive/20 hover:text-destructive transition-colors"
                title="Eliminar mensaje"
              >
                <Trash size={12} weight="bold" />
              </button>
            )}
          </div>
        )}

        <div className={`px-3 py-2 text-[13px] leading-relaxed shadow-sm ${
          isOwn
            ? 'bg-success text-success-foreground rounded-xl rounded-tr-sm'
            : 'bg-card border border-border text-foreground rounded-xl rounded-tl-sm'
        }`}>
          {!isOwn && (
            <p className="text-[11px] font-semibold mb-0.5 text-primary">{m.sender_nombre}</p>
          )}
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
          {m.referenced_lead_id && (
            <LeadCard leadId={m.referenced_lead_id} isOwn={isOwn} />
          )}
          <span className={`flex items-center gap-0.5 justify-end mt-1 ${isOwn ? 'text-white/50' : 'text-muted-foreground'}`}>
            <span className="text-[10px]">{formatTime(m.created_at)}</span>
            {isOwn && <Check size={12} weight="bold" />}
          </span>
        </div>
      </div>
    </div>
  );
}
