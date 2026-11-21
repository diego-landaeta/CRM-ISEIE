import { UserCircle } from '@phosphor-icons/react';
import type { Conversation } from '../api/messages.api';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

interface Props {
  conversation: Conversation;
  active: boolean;
  isOnline: boolean;
  onClick: () => void;
}

export default function ConversationItem({ conversation: c, active, isOnline, onClick }: Props) {
  const name = c.other_user?.nombre || 'Usuario';
  const preview = c.last_message?.body || '';
  const time = c.last_message?.created_at ? timeAgo(c.last_message.created_at) : '';
  const hasUnread = c.unread_count > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/40 ${
        active
          ? 'bg-primary/8 border-l-2 border-l-primary'
          : 'hover:bg-muted/40'
      }`}
    >
      <div className="relative flex-shrink-0">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center overflow-hidden">
          {c.other_user?.avatar_url
            ? <img src={c.other_user.avatar_url} alt="" className="w-full h-full object-cover" />
            : <UserCircle size={28} weight="fill" className="text-muted-foreground/70" />
          }
        </div>
               {isOnline && (
          <span className="absolute bottom-0 right-0 w-3 h-3 bg-success rounded-full border-2 border-card" />)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-sm truncate ${hasUnread ? 'font-bold' : 'font-medium'}`}>{name}</span>
          <span className={`text-[10px] flex-shrink-0 ${hasUnread ? 'text-success font-semibold' : 'text-muted-foreground'}`}>
            {time}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-xs truncate ${hasUnread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
            {preview || 'Sin mensajes'}
          </p>
          {hasUnread && (
          <span className="bg-success text-success-foreground text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center flex-shrink-0">
              {c.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
